// pnpm ai:check — runs Scoping, Verification and the Arbiter through the real services on the real model
// (PayPal stays mocked here, so this spends no sandbox money) and fails if any agent run used the stub.
import "./_env";
import { desc } from "drizzle-orm";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { scopeJob } from "@/core/agents/scoping";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { buildLlm, createContainer } from "@/core/container";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import type { LlmPort } from "@/core/ports/llm";
import type { DisputeProposal, JobSpec } from "@/core/contracts";
import { openTestDb } from "@/core/db/client";
import { agentRuns } from "@/core/db/schema";
import { seed } from "@/core/db/seed";

async function main() {
  const cfg = loadConfig({ ...process.env, APP_MODE: "MOCK", CHALLENGE_WINDOW_SECONDS: "3600" });
  if (cfg.llmProvider === "stub") throw new Error("No LLM key configured: this check only runs on a real model");
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const paypal = new MockPayPalAdapter();
  const c = await createContainer(cfg, { dbHandle, payments: paypal });
  console.log(`Provider ${c.llm.provider}, model ${c.llm.model}`);

  const scoped = await scopeJob(
    { db: dbHandle.db, llm: c.llm },
    { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar in Indore by 6 pm today. Budget $100.", payerId: "usr_ravi", now: c.clock.now(), entityId: "ai_check" },
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

  const m1 = (await c.jobs.detail(job.id))!.milestones[0];
  const criteria = m1.criteriaJson as JobSpec["milestones"][number]["acceptanceCriteria"];
  const location = criteria.find((x) => x.evidenceType === "geo")?.params?.location ?? spec.location ?? { lat: 22.7196, lng: 75.8577 };
  const photo = await makeSamplePhoto({ seed: "ai-check", caption: "20 cartons of tea", takenAt: new Date(c.clock.now().getTime() - 60_000), location });
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes: photo, declaredMime: "image/jpeg" });
  await c.proofs.addText({ milestoneId: m1.id, workerId: "usr_asha", text: "Picked up 20 cartons of tea at the agreed place." });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  const card = await c.verification.run(m1.id);
  console.log(`Verification: decision ${card?.decision}, model ${card?.model}\n  ${card?.explanation}`);

  console.log(`  flags: ${JSON.stringify(card?.signals ?? [])}`.slice(0, 500));
  for (const r of await dbHandle.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt))) console.log(`  run ${r.agent} ${r.status} ${r.model} ${JSON.stringify(r.outputJson).slice(0, 700)}`);
  const runs = await dbHandle.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt));
  for (const r of runs) console.log(`run ${r.agent}: status ${r.status}, model ${r.model}, ${r.latencyMs} ms, tokens ${r.tokensIn}/${r.tokensOut}`);
  const stub = runs.filter((r) => r.model === "stub");
  const failed = runs.filter((r) => r.status === "fallback");
  if (stub.length) throw new Error(`${stub.length} agent runs used the stub`);
  if (failed.length) console.log(`WARNING: ${failed.length} runs fell back to human review`);
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
  const scoped = await scope({ db: dbHandle.db, llm: stub }, { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100.", payerId: "usr_ravi", now: c.clock.now(), entityId: "ai_check2" });
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
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes: await makeSamplePhoto({ seed: "ai-check-2", caption: "20 cartons", takenAt: new Date(c.clock.now().getTime() - 60_000), location }), declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  await c.verification.run(m1.id);
  const dispute = await c.disputes.open({ milestoneId: m1.id, userId: "usr_ravi", reason: "Some cartons arrived crushed" });
  await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_ravi", text: "6 of 20 cartons arrived crushed and the tea was spilled" });
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
