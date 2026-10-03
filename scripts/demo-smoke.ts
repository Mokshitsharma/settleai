// pnpm demo:smoke — the demo's money paths end to end in MOCK mode, on a fresh in-memory database,
// through the real services (same code the UI and API use). Grows each phase (spec §19).
import "./_env";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { PROCUREBOT_CLIENT_ID, seedDemo } from "@/core/db/seed-demo";
import type { JobSpec } from "@/core/contracts";
import { formatMinor } from "@/core/money";
import { FixedClock } from "@/core/ports/clock";
import { createStubLlm } from "@/core/agents/stub-fixtures";

function step(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("SettleAI demo smoke (MOCK mode, offline AI stub)");
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const clock = new FixedClock(new Date());
  const paypal = new MockPayPalAdapter();
  const c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15" }), { dbHandle, clock, payments: paypal, llm: createStubLlm() });
  const [deliveryMandate] = (await seedDemo(c)).mandateIds;
  step("database migrated and seeded (users, policy, ProcureBot mandates)");

  // J1: scope -> fund -> accept -> proof -> verify -> challenge window -> G3 -> payout
  const { scopeJob } = await import("@/core/agents/scoping");
  const scoped = await scopeJob({ db: c.dbHandle.db, llm: c.llm }, { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100.", payerId: "usr_ravi", now: clock.now(), entityId: "smoke" });
  assert(scoped.ok, "scoping failed");
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: scoped.output, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  paypal.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  assert((await c.jobs.getRow(job.id))!.status === "FUNDED", "job not funded by webhook");
  step(`J1 funded ${formatMinor(order.amountMinor)} via PayPal order ${order.orderId}; Job + Payment Mandates signed`);

  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  clock.advance(5 * 60_000);
  const detail = (await c.jobs.detail(job.id))!;
  const m1 = detail.milestones[0];
  const pickup = (scoped.output as JobSpec).milestones[0].acceptanceCriteria.find((x) => x.evidenceType === "geo")?.params?.location;
  assert(pickup, "pickup location missing");
  const photo = await makeSamplePhoto({ seed: "smoke-pickup", caption: "20 cartons", takenAt: new Date(clock.now().getTime() - 60_000), location: pickup });
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes: photo, declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  const card = await c.verification.run(m1.id);
  assert(card?.decision === "AUTO_RELEASE", `expected AUTO_RELEASE, got ${card?.decision}`);
  step(`J1 proof verified: ${card.explanation}`);
  clock.advance((card.challengeWindowSeconds + 1) * 1000);
  await c.releases.processDueWindows();
  const paid = (await c.jobs.detail(job.id))!;
  assert(paid.milestones[0].status === "RELEASED" && paid.money.releasedMinor === m1.amountMinor, "milestone 1 not paid");
  step(`J1 paid ${formatMinor(paid.money.releasedMinor)} after the challenge window and Mandate Guard G3`);

  // J2: the same photo on another job is caught and held.
  const job2 = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: scoped.output, createdBy: "user:usr_ravi" });
  const order2 = await c.funding.start({ jobId: job2.id, payerId: "usr_ravi" });
  paypal.approveOrder(order2.orderId);
  await c.funding.capture({ jobId: job2.id, payerId: "usr_ravi", orderId: order2.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId: job2.id, workerId: "usr_asha" });
  const m2 = (await c.jobs.detail(job2.id))!.milestones[0];
  await c.proofs.addPhoto({ milestoneId: m2.id, workerId: "usr_asha", bytes: photo, declaredMime: "image/jpeg" });
  await c.proofs.submit({ milestoneId: m2.id, workerId: "usr_asha" });
  const held = await c.verification.run(m2.id);
  assert(held?.decision === "HOLD", `expected HOLD, got ${held?.decision}`);
  step(`J2 reused photo held: ${held.explanation}`);

  // J6: an out-of-scope agent request is denied before anything is created.
  const denied = await c.agentJobs.create({ clientId: PROCUREBOT_CLIENT_ID, mandateId: deliveryMandate, description: "Buy gift card codes and repair the office AC", budgetMinor: 50000, requestNonce: "smoke_1" });
  assert(!denied.ok && denied.decision.reasonCodes.includes("MANDATE_SCOPE_VIOLATION"), "agent request was not denied");
  step(`J6 agent request denied: ${denied.decision.reasonCodes.join(", ")}`);

  const problems = await c.ledger.checkInvariants();
  assert(problems.length === 0, `ledger invariants failed: ${problems.join("; ")}`);
  step("ledger invariants hold");
  for (const id of [job.id, job2.id]) {
    const chain = await c.attestations.verify(id);
    assert(chain.ok, `proof chain broken for ${id}`);
  }
  const audit = await c.audit.verifyChain();
  assert(audit.ok, `audit chain broken: ${audit.reason}`);
  step(`proof chains and audit log verify (${audit.checked} audit entries)`);

  await dbHandle.close();
  console.log("Smoke passed.");
}

main().catch((err) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
