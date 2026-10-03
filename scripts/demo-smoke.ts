// pnpm demo:smoke — end-to-end money flow in MOCK mode against a fresh in-memory database.
// Phase 0 scope: seed -> fund via mock PayPal -> release via mock Payout -> refund -> invariants + audit chain.
// Grows each phase until it runs journeys J1-J7 (Section 19).
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { openTestDb } from "@/core/db/client";
import { jobs } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { feeForAmount, formatMinor } from "@/core/money";
import { AuditService } from "@/core/services/audit";
import { LedgerService, escrowCode } from "@/core/services/ledger";

function step(msg: string) {
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("SettleAI demo smoke (MOCK mode)");
  const h = await openTestDb();
  const ledger = new LedgerService(h.db);
  const audit = new AuditService(h.db);
  const paypal = new MockPayPalAdapter();
  await seed(h.db);
  step("database migrated and seeded");

  const jobId = "job_smoke";
  const total = 10000;
  const fee = feeForAmount(total, 200);
  await h.db.insert(jobs).values({
    id: jobId, payerId: "usr_ravi", workerId: "usr_asha", title: "Smoke delivery", category: "delivery",
    specJson: {}, totalMinor: total, feeMinor: fee, status: "AWAITING_FUNDING", createdBy: "user:usr_ravi",
  });

  const order = await paypal.createOrder({
    requestId: `fund_${jobId}_1`, amountMinor: total + fee, currency: "USD",
    customId: `smd_${jobId}_0000000000000000`, invoiceId: "fund_smoke", description: "Smoke delivery",
  });
  paypal.approveOrder(order.orderId);
  const capture = await paypal.captureOrder(order.orderId, `cap_${jobId}_1`);
  await ledger.recordFunding({ jobId, fundingId: "fund_smoke", amountMinor: capture.amountMinor });
  await audit.append({ actor: "user:usr_ravi", action: "job.funded", entityType: "job", entityId: jobId, payload: { captureId: capture.captureId } });
  step(`funded ${formatMinor(capture.amountMinor)} (order ${order.orderId}, capture ${capture.captureId})`);

  const m1 = 4000;
  const m1Fee = feeForAmount(m1, 200);
  const payout = await paypal.createPayout({
    requestId: "rel_smoke_1", senderBatchId: "rel_smoke_1", senderItemId: "rel_smoke_1",
    receiverEmail: "asha.worker@example.com", amountMinor: m1, currency: "USD", note: "Milestone 1",
  });
  if (payout.status !== "SUCCEEDED") throw new Error(`payout ${payout.status}`);
  await ledger.recordRelease({ jobId, releaseId: "rel_smoke_1", payoutMinor: m1, feeMinor: m1Fee });
  // Replaying the same release must be a no-op.
  const replay = await ledger.recordRelease({ jobId, releaseId: "rel_smoke_1", payoutMinor: m1, feeMinor: m1Fee });
  if (!replay.duplicate) throw new Error("release replay was not idempotent");
  step(`released ${formatMinor(m1)} via payout ${payout.itemId}; replay was a no-op`);

  const refund = await paypal.refundCapture({
    requestId: "ref_smoke_1", captureId: capture.captureId, amountMinor: 2000, currency: "USD", invoiceId: "fund_smoke", noteToPayer: "Partial refund",
  });
  await ledger.recordRefund({ jobId, refundId: "ref_smoke_1", amountMinor: 2000 });
  step(`refunded ${formatMinor(2000)} (${refund.refundId})`);

  const escrow = await ledger.balance(escrowCode(jobId));
  const expected = total + fee - m1 - m1Fee - 2000;
  if (escrow !== expected) throw new Error(`escrow ${escrow} != expected ${expected}`);
  step(`escrow balance ${formatMinor(escrow)} matches expectation`);

  const problems = await ledger.checkInvariants();
  if (problems.length) throw new Error(`ledger invariants failed: ${problems.join("; ")}`);
  step("ledger invariants hold");

  const chain = await audit.verifyChain();
  if (!chain.ok) throw new Error(`audit chain broken: ${chain.reason}`);
  step(`audit chain verifies (${chain.checked} entries)`);

  await h.close();
  console.log("Smoke passed.");
}

main().catch((err) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
