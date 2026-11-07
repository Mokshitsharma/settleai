// pnpm live:flow — one full money flow against the real PayPal sandbox through the real services:
// create order -> buyer approves in the sandbox checkout -> capture COMPLETED -> payout to the worker -> refund.
// The AI steps use the labelled offline stub here because this script tests PayPal; `pnpm ai:check` tests the AI.
// Sandbox only. Prints PayPal ids, never credentials, and writes them to docs/live-evidence.json.
import "./_env";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { chromium } from "@playwright/test";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { scopeJob } from "@/core/agents/scoping";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import type { JobSpec } from "@/core/contracts";
import { openTestDb } from "@/core/db/client";
import { fundingOrders, payouts, refunds } from "@/core/db/schema";
import { seed } from "@/core/db/seed";

const RETURN_BASE = "https://settleai.invalid";

async function buyerApproves(approveUrl: string, email: string, password: string): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const returned = page.waitForRequest((r) => r.url().startsWith(RETURN_BASE), { timeout: 150_000 });
    await page.goto(approveUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#email").fill(email, { timeout: 60_000 });
    if (await page.locator("#btnNext").isVisible()) await page.locator("#btnNext").click();
    await page.locator("#password").fill(password, { timeout: 60_000 });
    await page.locator("#btnLogin").click();
    await page.locator('#payment-submit-btn, [data-testid="submit-button-initial"]').first().click({ timeout: 90_000 });
    await returned;
  } catch (err) {
    await page.screenshot({ path: ".data/live-flow-checkout-failure.png" }).catch(() => {});
    throw new Error(`Sandbox checkout did not complete at ${new URL(page.url()).pathname}: ${(err as Error).message.split("\n")[0]}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const { SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD, SANDBOX_WORKER_EMAIL, PAYPAL_ENV = "sandbox" } = process.env;
  if (PAYPAL_ENV !== "sandbox") throw new Error("live:flow only runs against the sandbox");
  if (!SANDBOX_BUYER_EMAIL || !SANDBOX_BUYER_PASSWORD || !SANDBOX_WORKER_EMAIL) throw new Error("Set SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD and SANDBOX_WORKER_EMAIL in .env.local");

  const cfg = loadConfig({ ...process.env, APP_MODE: "LIVE", LLM_PROVIDER: "stub", CHALLENGE_WINDOW_SECONDS: "3600" });
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const c = await createContainer(cfg, { dbHandle, llm: createStubLlm() });
  const db = dbHandle.db;
  const evidence: Record<string, unknown> = { at: new Date().toISOString(), env: "sandbox" };
  const save = () => writeFileSync("docs/live-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);

  const scoped = await scopeJob({ db, llm: c.llm }, { text: "Deliver 20 cartons of tea from Rajwada to Vijay Nagar by 6 pm. Budget $100.", payerId: "usr_ravi", now: c.clock.now(), entityId: "live_flow" });
  if (!scoped.ok) throw new Error(scoped.error);
  const spec = scoped.output as JobSpec;
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec, createdBy: "user:usr_ravi" });

  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi", baseUrl: RETURN_BASE });
  evidence.orderId = order.orderId;
  evidence.orderAmountMinor = order.amountMinor;
  console.log(`1. Order created: ${order.orderId}`);
  save();

  await buyerApproves(order.approveUrl!, SANDBOX_BUYER_EMAIL, SANDBOX_BUYER_PASSWORD);
  console.log("2. Buyer approved in the sandbox checkout");

  const captured = await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  evidence.captureId = captured.captureId;
  const remote = await c.payments.getCapture(captured.captureId!);
  evidence.captureStatus = remote.status;
  console.log(`3. Capture ${captured.captureId}: ${remote.status}`);
  save();
  if (remote.status !== "COMPLETED") throw new Error(`Capture is ${remote.status}, not COMPLETED`);
  await c.reconciliation.repairInFlight();
  if ((await c.jobs.getRow(job.id))!.status !== "FUNDED") throw new Error("Job did not reach FUNDED");
  evidence.fundingStatus = (await db.select().from(fundingOrders).where(eq(fundingOrders.jobId, job.id)))[0].status;

  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  const m1 = (await c.jobs.detail(job.id))!.milestones[0];
  const location = (m1.criteriaJson as JobSpec["milestones"][number]["acceptanceCriteria"]).find((x) => x.evidenceType === "geo")?.params?.location ?? spec.location!;
  const photo = await makeSamplePhoto({ seed: `live-${Date.now()}`, caption: "20 cartons", takenAt: new Date(c.clock.now().getTime() - 60_000), location });
  await c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes: photo, declaredMime: "image/jpeg", source: "demo_sample" });
  await c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  await c.verification.run(m1.id);

  // A dispute split settles through both money paths: Payouts for the worker's share, Refunds for the payer's.
  const dispute = await c.disputes.open({ milestoneId: m1.id, userId: "usr_ravi", reason: "Some cartons arrived crushed" });
  await c.disputes.addEvidence({ disputeId: dispute.id, userId: "usr_ravi", text: "6 of 20 cartons arrived crushed and the tea was spilled" });
  await c.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" });
  await c.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: true });
  await c.disputes.respond({ disputeId: dispute.id, userId: "usr_asha", accept: true });

  const refund = (await db.select().from(refunds).where(eq(refunds.jobId, job.id)))[0];
  evidence.refundId = refund?.paypalRefundId;
  evidence.refundStatus = refund?.status;
  evidence.refundAmountMinor = refund?.amountMinor;
  console.log(`4. Refund ${refund?.paypalRefundId}: ${refund?.status}`);
  save();

  // Payout items settle asynchronously; ask PayPal until the item has a final status.
  for (let i = 0; i < 24; i++) {
    const [p] = await db.select().from(payouts);
    evidence.payoutBatchId = p?.paypalBatchId;
    evidence.payoutItemId = p?.paypalItemId;
    evidence.payoutStatus = p?.status;
    evidence.payoutAmountMinor = p?.amountMinor;
    evidence.payoutFailure = p?.failureReason ?? undefined;
    if (p && !["CREATED", "PROCESSING", "PENDING"].includes(p.status)) break;
    await new Promise((r) => setTimeout(r, 10_000));
    await c.reconciliation.repairInFlight();
  }
  console.log(`5. Payout batch ${evidence.payoutBatchId}, item ${evidence.payoutItemId}: ${evidence.payoutStatus}${evidence.payoutFailure ? ` (${evidence.payoutFailure})` : ""}`);
  save();

  const problems = await c.ledger.checkInvariants();
  evidence.ledgerInvariantsOk = problems.length === 0;

  // The ledger's PayPal balance must equal what PayPal itself reports having moved.
  const paypalCapture = await c.payments.getCapture(captured.captureId!);
  const paypalPayout = await c.payments.getPayoutBatch(String(evidence.payoutBatchId));
  const expected = paypalCapture.amountMinor - (paypalCapture.paypalFeeMinor ?? 0) - Number(evidence.payoutAmountMinor) - (paypalPayout.paypalFeeMinor ?? 0) - (refund?.amountMinor ?? 0);
  const actual = await c.ledger.balance("PAYPAL_BALANCE");
  evidence.paypalCaptureFeeMinor = paypalCapture.paypalFeeMinor;
  evidence.paypalPayoutFeeMinor = paypalPayout.paypalFeeMinor;
  evidence.ledgerPaypalBalanceMinor = actual;
  evidence.paypalReportedNetMinor = expected;
  console.log(`   Ledger PayPal balance ${actual}, PayPal's own figures ${expected}: ${actual === expected ? "match" : "MISMATCH"}`);
  if (actual !== expected) problems.push(`ledger PayPal balance ${actual} differs from PayPal's figures ${expected}`);
  save();
  console.log(`6. Ledger invariants ${problems.length === 0 ? "hold" : `FAILED: ${problems.join("; ")}`}. Evidence: docs/live-evidence.json`);
  await dbHandle.close();
  if (evidence.payoutStatus !== "SUCCEEDED" || refund?.status !== "COMPLETED" || problems.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
