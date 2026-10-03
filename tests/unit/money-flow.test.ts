import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { jobs, milestones, releases, users, webhookEvents } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { newId } from "@/core/ids";
import { FixedClock } from "@/core/ports/clock";
import { escrowCode } from "@/core/services/ledger";
import { canTransition, assertTransition, IllegalTransitionError } from "@/core/state/machines";
import { sampleJobSpec } from "../fixtures/contracts";
import { T0 } from "../helpers";

let c: Container;
let mock: MockPayPalAdapter;

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  mock = new MockPayPalAdapter();
  c = await createContainer(loadConfig({}), { dbHandle, clock: new FixedClock(T0), payments: mock });
});
afterAll(() => c.dbHandle.close());

async function fundedJob() {
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  mock.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  return job;
}

describe("state machines", () => {
  it("allows legal and rejects illegal transitions", () => {
    expect(canTransition("JOB", "AWAITING_FUNDING", "FUNDED")).toBe(true);
    expect(canTransition("JOB", "DRAFT", "FUNDED")).toBe(false);
    expect(() => assertTransition("RELEASE", "PAYOUT_SUCCEEDED", "PAYOUT_PENDING")).toThrow(IllegalTransitionError);
    expect(canTransition("MILESTONE", "CHALLENGE_WINDOW", "PAUSED_MANDATE")).toBe(true);
  });
});

describe("funding (J1 start) in MOCK mode", () => {
  it("creates an order, captures, and becomes FUNDED only via the webhook", async () => {
    const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
    expect(job.feeMinor).toBe(200);
    const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
    expect(order.amountMinor).toBe(10200);
    // Double click returns the same open order.
    expect((await c.funding.start({ jobId: job.id, payerId: "usr_ravi" })).orderId).toBe(order.orderId);

    mock.approveOrder(order.orderId);
    await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
    expect((await c.jobs.getRow(job.id))!.status).toBe("AWAITING_FUNDING"); // not yet: webhook is the source of truth

    await c.deliverMockWebhooks();
    const detail = (await c.jobs.detail(job.id))!;
    expect(detail.job.status).toBe("FUNDED");
    expect(detail.money).toMatchObject({ fundedMinor: 10200, inEscrowMinor: 10200 });
    expect(await c.attestations.verify(job.id)).toMatchObject({ ok: true, checked: 1 });
  });

  it("a replayed or out-of-order webhook is a no-op (S13)", async () => {
    const job = await fundedJob();
    const [evt] = await c.dbHandle.db.select().from(webhookEvents).where(eq(webhookEvents.eventType, "PAYMENT.CAPTURE.COMPLETED"));
    const raw = evt.payload as { id: string; event_type: string; resource: object };
    const body = JSON.stringify({ id: raw.id, event_type: raw.event_type, resource: raw.resource });
    expect(await c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, body)).toBe("duplicate");
    // Same capture, new event id (PayPal resend): state machine ignores it.
    const resent = JSON.stringify({ id: "MOCK-EVT-RESEND", event_type: raw.event_type, resource: raw.resource });
    expect(await c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, resent)).toBe("ignored");
    expect(await c.ledger.checkInvariants()).toEqual([]);
    expect(await c.webhooks.process({}, body)).toBe("rejected"); // unsigned
    void job;
  });

  it("refuses to fund a job with zero amounts", async () => {
    const zero = structuredClone(sampleJobSpec);
    zero.milestones.forEach((m) => (m.amountMinor = 0));
    zero.totalAmountMinor = 0;
    const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: zero, createdBy: "user:usr_ravi" });
    await expect(c.funding.start({ jobId: job.id, payerId: "usr_ravi" })).rejects.toMatchObject({ code: "INVALID_SPEC" });
  });
});

describe("treasury (T102)", () => {
  async function releaseFor(jobId: string, seq: number, amountMinor?: number) {
    const [ms] = await c.dbHandle.db.select().from(milestones).where(eq(milestones.jobId, jobId));
    const all = await c.dbHandle.db.select().from(milestones).where(eq(milestones.jobId, jobId));
    const m = all.find((x) => x.seq === seq) ?? ms;
    await c.dbHandle.db.update(milestones).set({ status: "RELEASING" }).where(eq(milestones.id, m.id));
    const id = newId("rel");
    await c.dbHandle.db.insert(releases).values({
      id,
      milestoneId: m.id,
      amountMinor: amountMinor ?? m.amountMinor,
      feeMinor: await c.treasury.feeShare(jobId, seq),
      decisionSource: "admin",
      status: "CREATED",
    });
    return id;
  }

  it("pays out, books the ledger, settles the milestone and is idempotent", async () => {
    const job = await fundedJob();
    await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
    const relId = await releaseFor(job.id, 1);
    const first = await c.treasury.executeRelease(relId, "admin:usr_meera");
    expect(first.status).toBe("PAYOUT_SUCCEEDED");
    const again = await c.treasury.executeRelease(relId, "admin:usr_meera");
    expect(again).toEqual(first); // no second payout
    await c.deliverMockWebhooks(); // the SUCCEEDED webhook arrives after the API response: ignored
    const detail = (await c.jobs.detail(job.id))!;
    expect(detail.money.releasedMinor).toBe(4000);
    expect(detail.money.inEscrowMinor).toBe(10200 - 4000 - 80);
    expect(detail.milestones[0].status).toBe("RELEASED");
    expect(await c.attestations.verify(job.id)).toMatchObject({ ok: true, checked: 2 });
    expect(await c.ledger.checkInvariants()).toEqual([]);
  });

  it("refunds from escrow and refuses to refund more than remains", async () => {
    const job = await fundedJob();
    await c.treasury.refund({ jobId: job.id, amountMinor: 2000, reason: "Partial cancel", actor: "admin:usr_meera" });
    expect(await c.ledger.balance(escrowCode(job.id))).toBe(8200);
    await expect(c.treasury.refund({ jobId: job.id, amountMinor: 9000, reason: "x", actor: "admin" })).rejects.toMatchObject({
      code: "INSUFFICIENT_ESCROW",
    });
  });

  it("blocks payouts when the worker has no PayPal email, and when the kill switch is on", async () => {
    const job = await fundedJob();
    await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
    await c.dbHandle.db.update(users).set({ paypalEmail: null }).where(eq(users.id, "usr_asha"));
    const relId = await releaseFor(job.id, 1);
    await expect(c.treasury.executeRelease(relId, "admin")).rejects.toMatchObject({ code: "NO_PAYOUT_EMAIL" });
    await c.dbHandle.db.update(users).set({ paypalEmail: "asha.worker@example.com" }).where(eq(users.id, "usr_asha"));
    const killed = await createContainer(loadConfig({ PAYOUT_KILL_SWITCH: "true" }), { dbHandle: c.dbHandle, payments: mock });
    await expect(killed.treasury.executeRelease(relId, "admin")).rejects.toMatchObject({ code: "KILL_SWITCH" });
  });

  it("a failed payout leaves funds in escrow and can be retried with a fresh PayPal id", async () => {
    const failing = new MockPayPalAdapter({ payoutFailRate: 1 });
    const job = await fundedJob();
    await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
    const relId = await releaseFor(job.id, 1);
    const cf = await createContainer(loadConfig({}), { dbHandle: c.dbHandle, payments: failing });
    expect((await cf.treasury.executeRelease(relId, "admin")).status).toBe("PAYOUT_FAILED");
    expect(await c.ledger.balance(escrowCode(job.id))).toBe(10200);
    const retry = await c.treasury.executeRelease(relId, "admin");
    expect(retry.status).toBe("PAYOUT_SUCCEEDED");
    const [jobRow] = await c.dbHandle.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(jobRow.status).toBe("IN_PROGRESS");
  });
});
