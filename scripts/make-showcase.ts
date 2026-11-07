// pnpm showcase:make — runs one real job and freezes its signed receipt as assets/showcase/receipt.json: PayPal sandbox,
// the real model, and the stable platform key from .secrets/. Refuses the stub and refuses any other key. With real demo
// photos installed it takes the full path (auto-release, dispute, Arbiter); without them a person approves each milestone.
// Run it only to replace the showcase. The result is committed, and is never regenerated at runtime.
import "./_env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { renderDemoPhoto } from "@/core/checks/demo-photos";
import { makeProofPhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { scopeJob } from "@/core/agents/scoping";
import type { DisputeProposal, JobSpec } from "@/core/contracts";
import { openTestDb } from "@/core/db/client";
import { agentRuns, payouts, refunds } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { verifyReceipt } from "@/core/verifier/receipt";
import { buyerApproves } from "./_buyer";

const RETURN_BASE = "https://settleai.invalid";
const REQUEST = "Deliver cartons of tea from Rajwada to Vijay Nagar in Indore by 6 pm today. Budget $100.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, seconds = 240): Promise<T> {
  for (const started = Date.now(); Date.now() - started < seconds * 1000; await sleep(5000)) {
    const v = await fn();
    if (v) return v;
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function submitProof(c: Container, spec: JobSpec, m: { id: string; title: string; criteriaJson: unknown }) {
  const criteria = m.criteriaJson as JobSpec["milestones"][number]["acceptanceCriteria"];
  const location = criteria.find((x) => x.evidenceType === "geo")?.params?.location ?? spec.location!;
  const bytes = await makeProofPhoto({
    kind: /pick/i.test(m.title) ? "pickup" : "dropoff",
    seed: `showcase-${m.id}`,
    caption: `${m.title}: ${spec.title}`.slice(0, 60),
    takenAt: new Date(c.clock.now().getTime() - 90_000),
    location,
  });
  await c.proofs.addPhoto({ milestoneId: m.id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg", source: "demo_sample" });
  await c.proofs.addText({ milestoneId: m.id, workerId: "usr_asha", text: `${m.title} done as agreed.` });
  await c.proofs.addGeo({ milestoneId: m.id, workerId: "usr_asha", lat: location.lat, lng: location.lng, accuracyM: 10 });
  await c.proofs.submit({ milestoneId: m.id, workerId: "usr_asha" });
  return c.verification.run(m.id);
}

async function main() {
  const { SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD, PAYPAL_ENV = "sandbox" } = process.env;
  if (PAYPAL_ENV !== "sandbox") throw new Error("Sandbox only");
  if (!SANDBOX_BUYER_EMAIL || !SANDBOX_BUYER_PASSWORD) throw new Error("Set the sandbox buyer login in .env.local");
  const published = JSON.parse(readFileSync("docs/platform-public-key.json", "utf8")) as { keyIds: string[] };
  const jwk = readFileSync(".secrets/platform-signing-key.jwk", "utf8");

  const cfg = loadConfig({ ...process.env, APP_MODE: "LIVE", PLATFORM_SIGNING_KEY_JWK: jwk, CHALLENGE_WINDOW_SECONDS: "45", DISPUTE_EVIDENCE_WINDOW_SECONDS: "45" });
  if (cfg.llmProvider === "stub") throw new Error("The showcase must use a real model");
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const c = await createContainer(cfg, { dbHandle });
  const db = dbHandle.db;
  if (!published.keyIds.includes((await c.keys.platformSigner()).keyId)) throw new Error("This is not the published platform key");

  const scoped = await scopeJob({ db, llm: c.llm }, { text: REQUEST, payerId: "usr_ravi", now: c.clock.now(), entityId: "showcase" });
  if (!scoped.ok) throw new Error(`Scoping fell back: ${scoped.error}`);
  const spec = scoped.output as JobSpec;
  console.log(`Scoping (${scoped.model}): ${spec.milestones.length} milestones`);
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi", baseUrl: RETURN_BASE });
  await buyerApproves(order.approveUrl!, RETURN_BASE, SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD);
  const captured = await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await until("FUNDED", async () => {
    await c.reconciliation.repairInFlight();
    return (await c.jobs.getRow(job.id))!.status === "FUNDED";
  });
  console.log(`Order ${order.orderId}, capture ${captured.captureId}`);
  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });

  let disputeDone = false;
  const count = (await c.jobs.detail(job.id))!.milestones.length;
  for (let seq = 1; seq <= count; seq++) {
    const m = (await c.jobs.detail(job.id))!.milestones.find((x) => x.seq === seq)!;
    await sleep(65_000); // stay inside Groq's free tokens-per-minute budget, so a rate limit does not decide the outcome
    const card = await submitProof(c, spec, m);
    console.log(`Milestone ${seq}: ${card?.decision} by ${card?.model}; ${card?.explanation}`);
    const damage = await renderDemoPhoto("damage", "showcase");
    if (card?.decision === "AUTO_RELEASE" && !disputeDone && damage) {
      const dispute = await c.disputes.open({ milestoneId: m.id, userId: "usr_ravi", reason: "Some cartons arrived damaged" });
      await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_ravi", text: "Part of the order arrived damaged; photo attached.", photo: new Uint8Array(damage) });
      await sleep(65_000);
      const proposal = await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" });
      const p = proposal?.proposalJson as DisputeProposal | undefined;
      if (!p) throw new Error("The Arbiter fell back to a person; run again rather than freeze this");
      console.log(`Arbiter: ${p.liability.faultClass}, release ${p.proposal.releaseToWorkerMinor}, refund ${p.proposal.refundToPayerMinor}, requiresHuman ${p.requiresHuman}\n  basis ${p.liability.basis.join(" | ")}`);
      if (p.requiresHuman) throw new Error("The Arbiter asked for a person; run again rather than freeze this");
      await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: true });
      await c.disputes.respond({ disputeId: dispute.id, userId: "usr_asha", accept: true });
      disputeDone = true;
    } else if (card?.decision === "AUTO_RELEASE") {
      await until("challenge window", async () => {
        await c.releases.processDueWindows();
        return !["CHALLENGE_WINDOW", "APPROVED_AUTO"].includes((await c.jobs.detail(job.id))!.milestones[seq - 1].status);
      });
    } else {
      await c.releases.approve({ milestoneId: m.id, adminId: "usr_meera", note: "Reviewed by a person: the demo proof was checked and approved." });
    }
    await until(`milestone ${seq} to settle`, async () => {
      await c.reconciliation.repairInFlight();
      const pending = await db.select().from(payouts);
      return pending.every((p) => !["CREATED", "PROCESSING", "PENDING"].includes(p.status));
    });
  }

  const bundle = await until("a finished job", async () => {
    await c.reconciliation.repairInFlight();
    const b = await c.receipts.build(job.id);
    return b && !JSON.stringify(b).includes('"payoutStatus":"PENDING"') ? b : null;
  });
  const result = await verifyReceipt(bundle, { trustedPlatformKeyIds: published.keyIds });
  if (!result.ok) throw new Error(`Refusing to freeze a receipt that does not verify: ${JSON.stringify(result).slice(0, 400)}`);

  const pay = await db.select().from(payouts);
  const ref = await db.select().from(refunds).where(eq(refunds.jobId, job.id));
  mkdirSync("assets/showcase", { recursive: true });
  writeFileSync("assets/showcase/receipt.json", `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(
    "docs/showcase-evidence.json",
    `${JSON.stringify({ madeAt: new Date().toISOString(), jobId: job.id, jobStatus: bundle.job.status, env: "sandbox", models: [...new Set((await db.select().from(agentRuns)).map((r) => r.model))], orderId: order.orderId, captureId: captured.captureId, payouts: pay.map((p) => ({ batch: p.paypalBatchId, item: p.paypalItemId, status: p.status, amountMinor: p.amountMinor })), refunds: ref.map((r) => ({ id: r.paypalRefundId, status: r.status, amountMinor: r.amountMinor })), fees: bundle.fees, ledger: bundle.ledger, disputeWithArbiter: disputeDone, realPhotos: Boolean(await renderDemoPhoto("pickup", "x")) }, null, 2)}\n`,
  );
  console.log(`Frozen: assets/showcase/receipt.json (job ${job.id}, ${bundle.job.status}). Dispute with Arbiter: ${disputeDone}`);
  await dbHandle.close();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
