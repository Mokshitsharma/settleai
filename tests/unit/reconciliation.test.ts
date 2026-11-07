import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_WEBHOOK_HEADER, MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { auditLog, fundingOrders, milestones, payouts, releases } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { newId } from "@/core/ids";
import { FixedClock } from "@/core/ports/clock";
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

async function paidMilestone() {
  const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  mock.approveOrder(order.orderId);
  await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await c.deliverMockWebhooks();
  await c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  const [m] = await c.dbHandle.db.select().from(milestones).where(eq(milestones.jobId, job.id));
  await c.dbHandle.db.update(milestones).set({ status: "RELEASING" }).where(eq(milestones.id, m.id));
  const relId = newId("rel");
  await c.dbHandle.db.insert(releases).values({ id: relId, milestoneId: m.id, amountMinor: m.amountMinor, feeMinor: 0, decisionSource: "admin", status: "CREATED" });
  await c.treasury.executeRelease(relId, "admin:test");
  return (await c.dbHandle.db.select().from(payouts).where(eq(payouts.releaseId, relId)))[0];
}

describe("reconciliation (F20)", () => {
  it("is clean when ledger, records and PayPal agree", async () => {
    await paidMilestone();
    expect(await c.reconciliation.run()).toMatchObject({ ok: true, repaired: [], mismatches: [], unverifiable: 0 });
  });

  it("detects a payout PayPal later reports as RETURNED", async () => {
    const p = await paidMilestone();
    mock.forcePayoutStatus(p.paypalItemId!, "RETURNED");
    const report = await c.reconciliation.run();
    expect(report.ok).toBe(false);
    expect(report.mismatches).toContainEqual(expect.objectContaining({ kind: "payout_status", ref: p.id, detail: "SettleAI says SUCCEEDED, PayPal says RETURNED" }));
  });

  it("repairs a missed webhook through the normal path, without double counting", async () => {
    const p = await paidMilestone();
    // Simulate the webhook never being applied: our records still say the payout is in flight.
    await c.dbHandle.db.update(payouts).set({ status: "PROCESSING" }).where(eq(payouts.id, p.id));
    await c.dbHandle.db.update(releases).set({ status: "PAYOUT_PENDING" }).where(eq(releases.id, p.releaseId));
    const [rel] = await c.dbHandle.db.select().from(releases).where(eq(releases.id, p.releaseId));
    const [before] = await c.dbHandle.db.select().from(milestones).where(eq(milestones.id, rel.milestoneId));
    mock.forcePayoutStatus(p.paypalItemId!, "SUCCEEDED");

    const report = await c.reconciliation.run();
    expect(report.repaired).toContain(`payout ${p.id}: PROCESSING -> SUCCEEDED`);
    const [after] = await c.dbHandle.db.select().from(milestones).where(eq(milestones.id, rel.milestoneId));
    expect(after.releasedMinor).toBe(before.releasedMinor);
    expect(await c.ledger.checkInvariants()).toEqual([]);
  });

  it("repeated lookups of payouts this process did not make do not open the PayPal breaker", async () => {
    await paidMilestone();
    const other = new MockPayPalAdapter();
    const c2 = await createContainer(loadConfig({}), { dbHandle: c.dbHandle, clock: new FixedClock(T0), payments: other });
    for (let i = 0; i < 6; i++) expect((await c2.reconciliation.run()).unverifiable).toBeGreaterThan(0);
    expect(c2.paypalBreaker.state).toBe("closed");
  });

  it("in LIVE mode, seeded mock payouts are unverifiable, not mismatches, and PayPal is not asked", async () => {
    await paidMilestone();
    const live = new Proxy(new MockPayPalAdapter(), {
      get: (t, k, r) => (k === "mode" ? "LIVE" : k === "getPayoutItem" ? () => { throw new Error("must not call PayPal"); } : Reflect.get(t, k, r)),
    });
    const c2 = await createContainer(loadConfig({}), { dbHandle: c.dbHandle, clock: new FixedClock(T0), payments: live });
    const report = await c2.reconciliation.run();
    expect(report.mismatches.filter((m) => m.kind === "payout_lookup_failed")).toEqual([]);
    expect(report.unverifiable).toBeGreaterThan(0);
  });

  it("repairInFlight confirms a captured job when the webhook never arrived, once", async () => {
    const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
    const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
    mock.approveOrder(order.orderId);
    await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
    mock.drainOutbox(); // the webhook is lost
    expect((await c.jobs.getRow(job.id))!.status).toBe("AWAITING_FUNDING");
    expect(await c.reconciliation.repairInFlight()).toHaveLength(1);
    expect((await c.jobs.getRow(job.id))!.status).toBe("FUNDED");
    expect(await c.reconciliation.repairInFlight()).toEqual([]);
    expect((await c.jobs.detail(job.id))!.money.fundedMinor).toBe(order.amountMinor);
    await expect(c.ledger.checkInvariants()).resolves.toEqual([]);
  });

  it("repairInFlight applies a payout result when the webhook never arrived", async () => {
    const p = await paidMilestone();
    mock.drainOutbox(); // the payout webhook is lost, so SettleAI still sees it in flight (as with real, asynchronous PayPal)
    await c.dbHandle.db.update(payouts).set({ status: "PROCESSING" }).where(eq(payouts.id, p.id));
    await c.reconciliation.repairInFlight();
    expect((await c.dbHandle.db.select().from(payouts).where(eq(payouts.id, p.id)))[0].status).toBe("SUCCEEDED");
  });

  it("repairInFlight leaves a fresh capture to the webhook during the grace period, then steps in", async () => {
    const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
    const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
    mock.approveOrder(order.orderId);
    await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
    mock.drainOutbox();
    expect(await c.reconciliation.repairInFlight({ fundingGraceMs: 20_000, now: new Date(T0.getTime() + 5_000) })).toEqual([]);
    expect((await c.jobs.getRow(job.id))!.status).toBe("AWAITING_FUNDING");
    expect(await c.reconciliation.repairInFlight({ fundingGraceMs: 20_000, now: new Date(T0.getTime() + 21_000) })).toHaveLength(1);
    expect((await c.jobs.getRow(job.id))!.status).toBe("FUNDED");
  });

  describe("how funding was confirmed", () => {
    async function capturedJob() {
      const job = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
      const order = await c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
      mock.approveOrder(order.orderId);
      await c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
      return { job, order };
    }
    const funded = async (jobId: string) => {
      const [f] = await c.dbHandle.db.select().from(fundingOrders).where(eq(fundingOrders.jobId, jobId));
      const chain = await c.attestations.chain(jobId);
      const att = chain.filter((a) => a.payload.kind === "funding_captured");
      const audit = await c.dbHandle.db.select().from(auditLog).where(and(eq(auditLog.action, "job.funded"), eq(auditLog.entityId, jobId)));
      return { via: (f.rawJson as { confirmedVia?: string }).confirmedVia, att, audit };
    };

    it("webhook first: recorded as webhook-confirmed, and a later poll changes nothing", async () => {
      const { job, order } = await capturedJob();
      await c.deliverMockWebhooks();
      const after = await funded(job.id);
      expect(after.via).toBe("webhook");
      expect(after.att.map((a) => a.payload.confirmedVia)).toEqual(["webhook"]);
      expect(after.audit.map((a) => a.actor)).toEqual(["paypal"]);

      expect(await c.reconciliation.repairInFlight()).toEqual([]);
      const again = await funded(job.id);
      expect(again.via).toBe("webhook");
      expect(again.att).toHaveLength(1);
      expect((await c.jobs.detail(job.id))!.money.fundedMinor).toBe(order.amountMinor);
    });

    it("poll first: recorded as poll-confirmed, and a late webhook does not overwrite it or post twice", async () => {
      const { job, order } = await capturedJob();
      const late = mock.drainOutbox();
      await c.reconciliation.repairInFlight();
      const after = await funded(job.id);
      expect(after.via).toBe("poll");
      expect(after.audit.map((a) => a.actor)).toEqual(["system:reconciliation"]);

      for (const e of late) await c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, JSON.stringify({ id: e.id, event_type: e.eventType, resource: e.resource }));
      const again = await funded(job.id);
      expect(again.via).toBe("poll");
      expect(again.att).toHaveLength(1);
      expect((await c.jobs.detail(job.id))!.money.fundedMinor).toBe(order.amountMinor);
      await expect(c.ledger.checkInvariants()).resolves.toEqual([]);
    });
  });
});
