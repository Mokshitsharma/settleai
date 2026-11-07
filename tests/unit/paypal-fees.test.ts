// PayPal's own fees are ledger entries, so the ledger's PayPal balance equals what PayPal reports. Figures match the live
// sandbox run: a $102.00 capture cost $4.05, a payout item $0.25, and the refund returned no fee.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalAdapter } from "@/core/adapters/paypal/live";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { milestones, payouts, releases } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { newId } from "@/core/ids";
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
