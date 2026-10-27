// Transactional outbox, dead-letter table, PayPal circuit breaker wiring, and webhook replay / out-of-order
// delivery. Everything runs offline against the mock PayPal adapter.
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { MockPayPalAdapter, MOCK_WEBHOOK_HEADER } from "@/core/adapters/paypal/mock";
import { deadLetters, milestones, outboxEvents, payouts, releases, webhookEvents } from "@/core/db/schema";
import { OutboxService } from "@/core/services/outbox";
import { escrowCode } from "@/core/services/ledger";
import { CircuitOpenError } from "@/core/reliability/circuit-breaker";
import { sampleJobSpec } from "../fixtures/contracts";
import { fundedJob, verifiedMilestone, world, type World } from "../world";

const H = { [MOCK_WEBHOOK_HEADER]: "1" };
const open: World[] = [];
async function mk(opts: Parameters<typeof world>[0] = {}) {
  const w = await world(opts);
  open.push(w);
  return w;
}
afterEach(async () => {
  for (const w of open.splice(0)) await w.c.dbHandle.close().catch(() => {});
});

describe("outbox worker", () => {
  it("retries with backoff, then dead-letters after maxAttempts; enqueue is idempotent per dedupe key", async () => {
    const w = await mk();
    const ob = new OutboxService(w.c.dbHandle.db, w.clock, { baseMs: 1000, capMs: 8000, random: () => 0.5 });
    let calls = 0;
    ob.on("payout.retry", async () => {
      calls++;
      throw new Error("still down");
    });
    await ob.enqueue(w.c.dbHandle.db, { topic: "payout.retry", dedupeKey: "k1", payload: { releaseId: "r" }, maxAttempts: 3 });
    await ob.enqueue(w.c.dbHandle.db, { topic: "payout.retry", dedupeKey: "k1", payload: { releaseId: "r" }, maxAttempts: 3 });
    expect(await w.c.dbHandle.db.select().from(outboxEvents)).toHaveLength(1);

    expect(await ob.runDue()).toMatchObject({ claimed: 1, retried: 1 });
    let [row] = await w.c.dbHandle.db.select().from(outboxEvents);
    expect(row.attempts).toBe(1);
    expect(row.availableAt.getTime() - w.clock.now().getTime()).toBe(500); // 0.5 * 1000 * 2^0
    expect((await ob.runDue()).claimed).toBe(0); // not due yet
    w.clock.advance(500);
    expect(await ob.runDue()).toMatchObject({ claimed: 1, retried: 1 });
    [row] = await w.c.dbHandle.db.select().from(outboxEvents);
    expect(row.availableAt.getTime() - w.clock.now().getTime()).toBe(1000); // 0.5 * 1000 * 2^1
    w.clock.advance(1000);
    expect(await ob.runDue()).toMatchObject({ claimed: 1, dead: 1 });
    expect(calls).toBe(3);
    [row] = await w.c.dbHandle.db.select().from(outboxEvents);
    expect(row.status).toBe("dead");
    const dlq = await w.c.dbHandle.db.select().from(deadLetters);
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({ outboxId: row.id, attempts: 3, lastError: "still down" });
  });

  it("marks done on success, re-arms a finished key, and fails rows with no handler", async () => {
    const w = await mk();
    const ob = new OutboxService(w.c.dbHandle.db, w.clock, { baseMs: 10, capMs: 10, random: () => 0 });
    const seen: unknown[] = [];
    ob.on("webhook.redispatch", async (p) => void seen.push(p));
    await ob.enqueue(w.c.dbHandle.db, { topic: "webhook.redispatch", dedupeKey: "a", payload: { n: 1 } });
    expect((await ob.runDue()).done).toBe(1);
    await ob.enqueue(w.c.dbHandle.db, { topic: "webhook.redispatch", dedupeKey: "a", payload: { n: 2 } });
    expect((await ob.runDue()).done).toBe(1);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    await ob.enqueue(w.c.dbHandle.db, { topic: "payout.ambiguous", dedupeKey: "b", payload: {}, maxAttempts: 1 });
    expect((await ob.runDue()).dead).toBe(1);
  });

  it("an enqueue inside a rolled-back transaction leaves no outbox row", async () => {
    const w = await mk();
    await w.c.dbHandle.db
      .transaction(async (tx) => {
        await w.c.outbox.enqueue(tx, { topic: "payout.retry", dedupeKey: "rb", payload: {} });
        throw new Error("rollback");
      })
      .catch(() => {});
    expect(await w.c.dbHandle.db.select().from(outboxEvents)).toHaveLength(0);
  });
});

describe("PayPal circuit breaker + outbox (payout outage drill)", () => {
  it("open circuit: no PayPal call, release parked, retried by the outbox after recovery, paid exactly once", async () => {
    const paypal = new MockPayPalAdapter();
    const w = await mk({ payments: paypal });
    const { jobId, m1, card } = await verifiedMilestone(w);
    expect(card?.decision).toBe("AUTO_RELEASE");
    const real = paypal.createPayout.bind(paypal);
    let attempts = 0;
    paypal.createPayout = async () => {
      attempts++;
      throw new Error("ECONNRESET");
    };
    // Five network failures open the breaker (threshold 5).
    for (let i = 0; i < 5; i++) await w.c.paypalBreaker.exec(() => paypal.createPayout({} as never)).catch(() => {});
    expect(w.c.paypalBreaker.state).toBe("open");
    attempts = 0;

    w.clock.advance(20_000);
    await w.c.releases.processDueWindows();
    expect(attempts).toBe(0); // fail-fast: the request never left the process
    const [rel] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.milestoneId, m1));
    expect(rel.status).toBe("PAYOUT_FAILED");
    const [evt] = await w.c.dbHandle.db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, `por:${rel.id}`));
    expect(evt).toMatchObject({ topic: "payout.retry", status: "pending" });
    expect(await w.c.ledger.balance(escrowCode(jobId))).toBe(10200);

    paypal.createPayout = real;
    w.clock.advance(31_000); // cooldown over: half-open trial allowed
    const s = await w.c.outbox.runDue();
    expect(s.done).toBe(1);
    const [after] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.id, rel.id));
    expect(after.status).toBe("PAYOUT_SUCCEEDED");
    expect(w.c.paypalBreaker.state).toBe("closed");
    const rows = await w.c.dbHandle.db.select().from(payouts).where(eq(payouts.releaseId, rel.id));
    expect(rows.filter((r) => r.status === "SUCCEEDED")).toHaveLength(1);
    expect(rows.find((r) => r.status === "FAILED")?.failureReason).toMatch(/circuit is open/);
    const [ms] = await w.c.dbHandle.db.select().from(milestones).where(eq(milestones.id, m1));
    expect(ms.status).toBe("RELEASED");
    expect(await w.c.ledger.checkInvariants()).toEqual([]);
    expect((await w.c.outbox.runDue()).claimed).toBe(0);
  });

  it("ambiguous failure (may have reached PayPal) is dead-lettered, never retried automatically", async () => {
    const paypal = new MockPayPalAdapter();
    const w = await mk({ payments: paypal });
    const { m1 } = await verifiedMilestone(w);
    paypal.createPayout = async () => {
      throw new Error("socket hang up after request sent");
    };
    w.clock.advance(20_000);
    await w.c.releases.processDueWindows();
    const [rel] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.milestoneId, m1));
    expect(rel.status).toBe("PAYOUT_FAILED");
    const pending = await w.c.dbHandle.db.select().from(outboxEvents).where(eq(outboxEvents.status, "pending"));
    expect(pending).toHaveLength(0);
    const dlq = await w.c.dbHandle.db.select().from(deadLetters);
    expect(dlq).toHaveLength(1);
    expect(dlq[0]).toMatchObject({ topic: "payout.ambiguous" });
    expect(dlq[0].payload).toMatchObject({ releaseId: rel.id });
  });

  it("the breaker error type marks a call as never attempted", () => {
    expect(new CircuitOpenError("paypal").code).toBe("CIRCUIT_OPEN");
  });
});

describe("webhooks: replay, out-of-order delivery, and failed dispatch recovery", () => {
  it("replaying the exact same event is a duplicate; a re-sent event with a new id is ignored by the state machine", async () => {
    const w = await mk();
    const job = await fundedJob(w);
    const [evt] = await w.c.dbHandle.db.select().from(webhookEvents).where(eq(webhookEvents.eventType, "PAYMENT.CAPTURE.COMPLETED"));
    const raw = evt.payload as { id: string; event_type: string; resource: object };
    for (let i = 0; i < 5; i++) expect(await w.c.webhooks.process(H, JSON.stringify(raw))).toBe("duplicate");
    expect(await w.c.webhooks.process(H, JSON.stringify({ ...raw, id: "EVT-NEW-ID" }))).toBe("ignored");
    expect(await w.c.ledger.balance(escrowCode(job.id))).toBe(10200);
    expect(await w.c.ledger.checkInvariants()).toEqual([]);
  });

  it("out of order: late PENDING / FAILED / repeated SUCCEEDED payout events after success change nothing", async () => {
    const w = await mk();
    const { jobId, m1 } = await verifiedMilestone(w);
    w.clock.advance(20_000);
    await w.c.releases.processDueWindows();
    await w.c.deliverMockWebhooks();
    const [rel] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.milestoneId, m1));
    expect(rel.status).toBe("PAYOUT_SUCCEEDED");
    const [po] = await w.c.dbHandle.db.select().from(payouts).where(eq(payouts.releaseId, rel.id));
    const escrowBefore = await w.c.ledger.balance(escrowCode(jobId));
    for (const status of ["PENDING", "FAILED", "SUCCESS"]) {
      const body = {
        id: `EVT-LATE-${status}`,
        event_type: `PAYMENT.PAYOUTS-ITEM.${status === "SUCCESS" ? "SUCCEEDED" : status}`,
        resource: { payout_item_id: po.paypalItemId, transaction_status: status, payout_item: { sender_item_id: po.senderItemId } },
      };
      expect(await w.c.webhooks.process(H, JSON.stringify(body))).toBe("ignored");
    }
    const [relAfter] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.id, rel.id));
    expect(relAfter.status).toBe("PAYOUT_SUCCEEDED");
    expect(await w.c.ledger.balance(escrowCode(jobId))).toBe(escrowBefore);
    expect(await w.c.ledger.checkInvariants()).toEqual([]);
  });

  it("out of order: a payout event for an unknown item is ignored, not an error", async () => {
    const w = await mk();
    const body = { id: "EVT-EARLY", event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", resource: { payout_item_id: "UNKNOWN", transaction_status: "SUCCESS", payout_item: { sender_item_id: "nope" } } };
    expect(await w.c.webhooks.process(H, JSON.stringify(body))).toBe("ignored");
  });

  it("a capture webhook whose dispatch crashes is re-dispatched by the outbox and funds the job once", async () => {
    const paypal = new MockPayPalAdapter();
    const w = await mk({ payments: paypal });
    const job = await w.c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
    const order = await w.c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
    paypal.approveOrder(order.orderId);
    await w.c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
    const capture = paypal.drainOutbox().find((e) => e.eventType === "PAYMENT.CAPTURE.COMPLETED")!;
    const body = JSON.stringify({ id: capture.id, event_type: capture.eventType, resource: capture.resource });

    // Simulate a crash inside the ledger posting on first delivery.
    const original = w.c.ledger.recordFunding.bind(w.c.ledger);
    w.c.ledger.recordFunding = async () => {
      throw new Error("db connection reset");
    };
    await expect(w.c.webhooks.process(H, body)).rejects.toThrow("db connection reset");
    expect(await w.c.webhooks.process(H, body)).toBe("duplicate"); // the provider resend is deduped
    expect(await w.c.ledger.balance(escrowCode(job.id))).toBe(0); // so without the outbox the event is lost
    const [evt] = await w.c.dbHandle.db.select().from(outboxEvents);
    expect(evt.topic).toBe("webhook.redispatch");

    w.c.ledger.recordFunding = original;
    expect((await w.c.outbox.runDue()).done).toBe(1);
    expect(await w.c.ledger.balance(escrowCode(job.id))).toBe(10200);
    const [stored] = await w.c.dbHandle.db.select().from(webhookEvents).where(eq(webhookEvents.paypalEventId, capture.id));
    expect(stored.status).toBe("processed");
    expect(await w.c.webhooks.redispatch(stored.id)).toBe("ignored");
    expect(await w.c.ledger.balance(escrowCode(job.id))).toBe(10200);
  });
});
