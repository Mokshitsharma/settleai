// pnpm ai:check — runs Scoping, Verification and the Arbiter through the real services on the real model
// (PayPal stays mocked here, so this spends no sandbox money) and fails if any agent run used the stub.
import "./_env";
import { desc } from "drizzle-orm";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { scopeJob } from "@/core/agents/scoping";
import { renderDemoPhoto } from "@/core/checks/demo-photos";
import { makeProofPhoto, makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { buildLlm, createContainer } from "@/core/container";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import type { LlmPort } from "@/core/ports/llm";
import type { DisputeProposal, JobSpec } from "@/core/contracts";
import { openTestDb } from "@/core/db/client";
import { agentRuns } from "@/core/db/schema";
import { seed } from "@/core/db/seed";

async function main() {
  const cfg = loadConfig({ ...process.env, APP_MODE: "MOCK", CHALLENGE_WINDOW_SECONDS: "30" });
  if (cfg.llmProvider === "stub") throw new Error("No LLM key configured: this check only runs on a real model");
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const paypal = new MockPayPalAdapter();
  const c = await createContainer(cfg, { dbHandle, payments: paypal });
  console.log(`Provider ${c.llm.provider}, model ${c.llm.model}`);

  const scoped = await scopeJob(
    { db: dbHandle.db, llm: c.llm },
    { text: "Deliver 2 cartons of tea from Rajwada to Vijay Nagar in Indore by 6 pm today. Budget $100.", payerId: "usr_ravi", now: c.clock.now(), entityId: "ai_check" },
  );
  if (!scoped.ok) throw new Error(`Scoping fell back: ${scoped.error}`);
  const spec = scoped.output as JobSpec;
  console.log(`Scoping: ${spec.milestones.length} milestones, total ${spec.totalAmountMinor}, confidence ${spec.confidence}`);

  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  paypal.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });

  // Every milestone, with the installed demo images when present (DEMO_PHOTOS_DIR), else the generated sample.
  for (const m of (await c.jobs.detail(job.id))!.milestones) {
    const criteria = m.criteriaJson as JobSpec["milestones"][number]["acceptanceCriteria"];
    const location = criteria.find((x) => x.evidenceType === "geo")?.params?.location ?? spec.location ?? { lat: 22.7196, lng: 75.8577 };
    // Real time between the milestone starting and the proof: under a minute is flagged TOO_FAST. Nothing is backdated.
    await new Promise((r) => setTimeout(r, 130_000));
    const photo = await makeProofPhoto({ kind: /pick/i.test(m.title) ? "pickup" : "dropoff", seed: `ai-check-${m.id}`, caption: m.title, takenAt: c.clock.now(), location });
    await c.proofs.addPhoto({ milestoneId: m.id, workerId: "usr_asha", bytes: photo, declaredMime: "image/jpeg", source: "demo_sample" });
    await c.proofs.addText({ milestoneId: m.id, workerId: "usr_asha", text: /drop/i.test(m.title) ? "Received by Ravi at the front door" : `${m.title} done as agreed.` });
    await c.proofs.addGeo({ milestoneId: m.id, workerId: "usr_asha", lat: location.lat, lng: location.lng, accuracyM: 10 });
    await c.proofs.submit({ milestoneId: m.id, workerId: "usr_asha" });
    const card = await c.verification.run(m.id);
    console.log(`Milestone ${m.seq} (${m.title}): decision ${card?.decision}, model ${card?.model}
  ${card?.explanation}`);
    const [run] = (await dbHandle.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt))).filter((r) => r.agent === "verification");
    console.log(`  criteria: ${criteria.map((x) => `${x.id} ${x.check}/${x.evidenceType}: ${x.text}`).join(" | ")}`);
    console.log(`  signals: ${JSON.stringify(card?.signals ?? []).slice(0, 400)}`);
    console.log(`  model said: ${run ? JSON.stringify(run.outputJson).slice(0, 700) : "(no verification model run)"}`);
    if (card?.decision !== "AUTO_RELEASE") {
      console.log(`HAPPY PATH STOPPED at milestone ${m.seq}: ${card?.decision}`);
      break;
    }
    for (let i = 0; i < 40 && (await c.jobs.detail(job.id))!.milestones.find((x) => x.id === m.id)!.status !== "RELEASED"; i++) {
      await new Promise((r) => setTimeout(r, 5_000));
      await c.releases.processDueWindows();
      await c.deliverMockWebhooks();
    }
    console.log(`  milestone ${m.seq} status after the challenge window: ${(await c.jobs.detail(job.id))!.milestones.find((x) => x.id === m.id)!.status}`);
  }
  console.log("No stub runs in Scoping or Verification.");
  await dbHandle.close();
  await arbiterCheck(cfg);
}

/** A dispute needs a verified milestone, so only here the verification step is the stub. The Arbiter is the real model. */
async function arbiterCheck(cfg: ReturnType<typeof loadConfig>) {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const paypal = new MockPayPalAdapter();
  const real = buildLlm(cfg);
  const stub = createStubLlm();
  const llm: LlmPort = { provider: real.provider, model: real.model, structured: (req) => (req.agent === "arbiter" ? real : stub).structured(req) };
  const c = await createContainer(cfg, { dbHandle, payments: paypal, llm });
  const { scopeJob: scope } = await import("@/core/agents/scoping");
  const scoped = await scope({ db: dbHandle.db, llm: stub }, { text: "Deliver 2 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100.", payerId: "usr_ravi", now: c.clock.now(), entityId: "ai_check2" });
  if (!scoped.ok) throw new Error(scoped.error);
  const spec = scoped.output as JobSpec;
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  paypal.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  const m1 = (await c.jobs.detail(job.id))!.milestones[0];
  const location = (m1.criteriaJson as JobSpec["milestones"][number]["acceptanceCriteria"]).find((x) => x.evidenceType === "geo")?.params?.location ?? spec.location!;
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes: await makeSamplePhoto({ seed: "ai-check-2", caption: "20 cartons", takenAt: c.clock.now(), location }), declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  await c.verification.run(m1.id);
  const dispute = await c.disputes.open({ milestoneId: m1.id, userId: "usr_ravi", reason: "Some cartons arrived crushed" });
  const damage = await renderDemoPhoto("damage", "ai-check-damage");
  if (!damage) throw new Error("No damage image installed");
  await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_ravi", text: "One carton arrived crushed and torn open; photo attached.", photo: new Uint8Array(damage) });
  await new Promise((r) => setTimeout(r, 65_000));
  const proposal = await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" });
  const p = proposal?.proposalJson as DisputeProposal | undefined;
  const [run] = (await dbHandle.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt))).filter((r) => r.agent === "arbiter");
  console.log(`Arbiter run: status ${run?.status}, model ${run?.model}, ${run?.latencyMs} ms`);
  if (!p) throw new Error(`Arbiter fell back: ${JSON.stringify(run?.outputJson).slice(0, 400)}`);
  console.log(`Arbiter: ${p.liability.faultClass}, release ${p.proposal.releaseToWorkerMinor}, refund ${p.proposal.refundToPayerMinor}, confidence ${p.confidence}, requiresHuman ${p.requiresHuman}`);
  console.log(`  basis: ${p.liability.basis.join(" | ")}`);
  console.log(`  rationale: ${p.proposal.rationale}`);
  if (run?.model === "stub") throw new Error("Arbiter used the stub");
  await dbHandle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
