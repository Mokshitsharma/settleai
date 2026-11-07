// PayPal's own fees are ledger entries, so the ledger's PayPal balance equals what PayPal reports. Figures match the live
// sandbox run: a $102.00 capture cost $4.05, a payout item $0.25, and the refund returned no fee.
import { and, eq } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalAdapter } from "@/core/adapters/paypal/live";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { milestones, payouts, releases } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { newId } from "@/core/ids";
import { serviceFee } from "@/core/money";
import { FixedClock } from "@/core/ports/clock";
import { ACCOUNTS } from "@/core/services/ledger";
import { sampleJobSpec } from "../fixtures/contracts";
import { T0 } from "../helpers";

let c: Container;
let mock: MockPayPalAdapter;
const CAPTURE_FEE = 405;
const PAYOUT_FEE = 25;

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  mock = new MockPayPalAdapter({ fees: { captureMinor: CAPTURE_FEE, payoutMinor: PAYOUT_FEE } });
  c = await createContainer(loadConfig({}), { dbHandle, clock: new FixedClock(T0), payments: mock });
});
afterAll(() => c.dbHandle.close());

async function fund() {
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  mock.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  return { job, order };
}
const balances = async () => ({ paypal: await c.ledger.balance(ACCOUNTS.PAYPAL_BALANCE.code), fees: await c.ledger.balance(ACCOUNTS.PAYPAL_FEES.code) });

describe("PayPal fees in the ledger", () => {
  it("records the capture fee from the webhook, leaves escrow whole, and a replay does not charge twice", async () => {
    const before = await balances();
    const { job, order } = await fund();
    const events = mock.drainOutbox();
    const deliver = () => Promise.all(events.map((e) => c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, JSON.stringify({ id: e.id, event_type: e.eventType, resource: e.resource }))));
    await deliver();
    await deliver();
    const after = await balances();
    expect(after.paypal - before.paypal).toBe(order.amountMinor - CAPTURE_FEE);
    expect(Math.abs(after.fees - before.fees)).toBe(CAPTURE_FEE);
    expect((await c.jobs.detail(job.id))!.money.fundedMinor).toBe(order.amountMinor);
    await expect(c.ledger.checkInvariants()).resolves.toEqual([]);
  });

  it("records the capture fee when funding is confirmed by polling, once", async () => {
    const before = await balances();
    const { order } = await fund();
    mock.drainOutbox();
    await c.reconciliation.repairInFlight();
    await c.reconciliation.repairInFlight();
    expect((await balances()).paypal - before.paypal).toBe(order.amountMinor - CAPTURE_FEE);
  });

  it("the balance matches PayPal's figures through capture, payout and refund", async () => {
    const before = await balances();
    const { job, order } = await fund();
    await c.deliverMockWebhooks();
    await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
    const [m] = await c.dbHandle.db.select().from(milestones).where(and(eq(milestones.jobId, job.id), eq(milestones.seq, 1)));
    await c.dbHandle.db.update(milestones).set({ status: "RELEASING" }).where(eq(milestones.id, m.id));
    const relId = newId("rel");
    await c.dbHandle.db.insert(releases).values({ id: relId, milestoneId: m.id, amountMinor: m.amountMinor, feeMinor: 0, decisionSource: "admin", status: "CREATED" });
    await c.treasury.executeRelease(relId, "admin:test");
    await c.deliverMockWebhooks();
    expect((await c.dbHandle.db.select().from(payouts).where(eq(payouts.releaseId, relId)))[0].status).toBe("SUCCEEDED");
    const refundMinor = 1224;
    await c.treasury.refund({ jobId: job.id, amountMinor: refundMinor, reason: "test", actor: "admin:test" });

    const reportedByPayPal = order.amountMinor - CAPTURE_FEE - m.amountMinor - PAYOUT_FEE - refundMinor;
    expect((await balances()).paypal - before.paypal).toBe(reportedByPayPal);
    await expect(c.ledger.checkInvariants()).resolves.toEqual([]);
  });

  it("a zero fee writes no ledger entry", async () => {
    await expect(c.ledger.recordPayPalFee({ refType: "refund", refId: "none", feeMinor: 0 })).resolves.toBeNull();
    await expect(c.ledger.recordPayPalFeeReturned({ refType: "refund", refId: "none", feeMinor: 0 })).resolves.toBeNull();
  });
});

describe("live adapter reads fees from PayPal's response shapes", () => {
  const adapter = (body: unknown) =>
    new PayPalAdapter({
      clientId: "id",
      clientSecret: "secret",
      env: "sandbox",
      fetchImpl: (async (input: string | URL) =>
        String(input).endsWith("/oauth2/token") ? Response.json({ access_token: "t", expires_in: 3600 }) : Response.json(body)) as typeof fetch,
    });

  it("capture: seller_receivable_breakdown.paypal_fee", async () => {
    const r = await adapter({ id: "C1", status: "COMPLETED", amount: { value: "102.00" }, seller_receivable_breakdown: { paypal_fee: { value: "4.05" } } }).getCapture("C1");
    expect(r.paypalFeeMinor).toBe(405);
  });

  it("payout batch: items[].payout_item_fee", async () => {
    const r = await adapter({ items: [{ payout_item_id: "I1", transaction_status: "SUCCESS", payout_item_fee: { value: "0.25" } }] }).getPayoutBatch("B1");
    expect(r).toMatchObject({ status: "SUCCEEDED", itemId: "I1", paypalFeeMinor: 25 });
  });

  it("refund: seller_payable_breakdown.paypal_fee", async () => {
    const r = await adapter({ id: "R1", status: "COMPLETED", seller_payable_breakdown: { paypal_fee: { value: "0.00" } } }).refundCapture({ requestId: "r", captureId: "C1", amountMinor: 100, currency: "USD", invoiceId: "i", noteToPayer: "n" });
    expect(r.paypalFeeReturnedMinor).toBe(0);
  });
});

describe("the service fee covers PayPal's costs", () => {
  const LIVE = { marginBps: 200, processingBps: 349, processingFixedMinor: 49, payoutItemFeeMinor: 25 };
  const paypalCut = (charge: number) => Math.round((charge * LIVE.processingBps) / 10000) + LIVE.processingFixedMinor;

  it("worked example: a $100.00 job with 2 payouts", () => {
    const fee = serviceFee(10000, 2, LIVE);
    expect(fee).toEqual({ feeMinor: 672, processingMinor: 472, marginMinor: 200 });
    expect(10000 + fee.feeMinor - paypalCut(10000 + fee.feeMinor) - 2 * 25).toBeGreaterThanOrEqual(10000 + fee.marginMinor);
  });

  it("no PayPal costs (mock mode): the fee is exactly the margin, as before", () => {
    expect(serviceFee(10000, 2, { marginBps: 200, processingBps: 0, processingFixedMinor: 0, payoutItemFeeMinor: 0 })).toEqual({ feeMinor: 200, processingMinor: 0, marginMinor: 200 });
  });

  it("for any job, after PayPal's cut the platform holds the work, the payout fees and the margin", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 100_000_00 }), fc.integer({ min: 1, max: 10 }), (total, items) => {
        const fee = serviceFee(total, items, LIVE);
        const charge = total + fee.feeMinor;
        expect(fee.processingMinor + fee.marginMinor).toBe(fee.feeMinor);
        expect(charge - paypalCut(charge) - items * LIVE.payoutItemFeeMinor).toBeGreaterThanOrEqual(total + fee.marginMinor);
      }),
    );
  });

  describe("through real services, SettleAI never ends a job below zero", () => {
    let live: Container;
    let pp: MockPayPalAdapter;
    beforeAll(async () => {
      const dbHandle = await openTestDb();
      await seed(dbHandle.db);
      pp = new MockPayPalAdapter({ fees: { captureBps: 349, captureFixedMinor: 49, payoutMinor: 25 } });
      live = await createContainer(loadConfig({ PAYPAL_FEE_BPS: "349", PAYPAL_FEE_FIXED_MINOR: "49", PAYOUT_ITEM_FEE_MINOR: "25" }), { dbHandle, clock: new FixedClock(T0), payments: pp });
    });
    afterAll(() => live.dbHandle.close());

    const kept = async () => (await live.ledger.balance(ACCOUNTS.FEE_REVENUE.code)) - (await live.ledger.balance(ACCOUNTS.PAYPAL_FEES.code));

    async function funded() {
      const job = await live.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
      const order = await live.funding.start({ jobId: job.id, payerId: "usr_ravi" });
      pp.approveOrder(order.orderId);
      await live.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
      await live.deliverMockWebhooks();
      await live.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
      return { job: (await live.jobs.getRow(job.id))!, order };
    }

    it("the signed Payment Mandate carries the processing part", async () => {
      const { job } = await funded();
      const fee = serviceFee(job.totalMinor, sampleJobSpec.milestones.length, live.config.fees);
      expect(job.feeMinor).toBe(fee.feeMinor);
      const bundle = await live.receipts.build(job.id);
      expect(bundle!.fees).toMatchObject({ serviceFeeMinor: fee.feeMinor, processingFeeMinor: fee.processingMinor });
      expect(bundle!.fees.paypalChargedMinor).toBeGreaterThan(0);
      expect(bundle!.mandates.payment.payload).toMatchObject({ funding: { processingFeeMinor: fee.processingMinor, feeMinor: fee.feeMinor } });
    });

    async function disputed() {
      const { job } = await funded();
      const m = (await live.jobs.detail(job.id))!.milestones[0];
      const location = (m.criteriaJson as { evidenceType: string; params?: { location?: { lat: number; lng: number } } }[]).find((x) => x.evidenceType === "geo")?.params?.location ?? sampleJobSpec.location!;
      const bytes = await makeSamplePhoto({ seed: `fee-${job.id}`, caption: "cartons", takenAt: new Date(T0.getTime() - 60_000), location });
      await live.proofs.addPhoto({ milestoneId: m.id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg" });
      await live.proofs.submit({ milestoneId: m.id, workerId: "usr_asha" });
      await live.verification.run(m.id);
      const dispute = await live.disputes.open({ milestoneId: m.id, userId: "usr_ravi", reason: "Not delivered" });
      await live.disputes.proposeNow({ disputeId: dispute.id, userId: "usr_ravi" });
      await live.disputes.respond({ disputeId: dispute.id, userId: "usr_ravi", accept: false });
      return { job, m, dispute };
    }

    it("full refund through a real dispute: only the margin goes back, PayPal's costs stay covered", async () => {
      const { job, m, dispute } = await disputed();
      const before = await kept();
      await live.disputes.adminResolve({ disputeId: dispute.id, adminId: "usr_meera", releaseToWorkerMinor: 0, faultClass: "WORKER_NONPERFORMANCE", note: "Not delivered" });
      const processing = await live.treasury.nonRefundableFeeShare(job.id, m.seq);
      const share = await live.treasury.feeShare(job.id, m.seq);
      expect(processing).toBeGreaterThan(0);
      const detail = (await live.jobs.detail(job.id))!;
      expect(detail.money.refundedMinor).toBe(m.amountMinor + share - processing);
      expect((await kept()) - before).toBe(processing);
      await expect(live.ledger.checkInvariants()).resolves.toEqual([]);
    });

    it("a dispute split through real services leaves the margin share positive and the ledger balanced", async () => {
      const { job, m, dispute } = await disputed();
      const before = await kept();
      await live.disputes.adminResolve({ disputeId: dispute.id, adminId: "usr_meera", releaseToWorkerMinor: Math.round(m.amountMinor * 0.7), faultClass: "WORKER_PARTIAL", note: "Partly damaged" });
      await live.deliverMockWebhooks();
      const detail = (await live.jobs.detail(job.id))!;
      expect(detail.money.refundedMinor).toBeGreaterThan(0);
      // Fee earned on this milestone minus PayPal's $0.25 payout fee: the milestone's processing share pays for it.
      expect((await kept()) - before).toBeGreaterThan(0);
      await expect(live.ledger.checkInvariants()).resolves.toEqual([]);
    });
  });
});
