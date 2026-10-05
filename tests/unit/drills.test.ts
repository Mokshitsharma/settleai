// T502 failure drills: the system must degrade safely, never move money twice, and recover.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter, MOCK_WEBHOOK_HEADER } from "@/core/adapters/paypal/mock";
import type { StubLlmAdapter } from "@/core/adapters/llm/stub";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openDb, openTestDb } from "@/core/db/client";
import { milestones, payouts, releases, webhookEvents } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { FixedClock } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import { escrowCode } from "@/core/services/ledger";
import { sampleJobSpec } from "../fixtures/contracts";
import { T0 } from "../helpers";

const SHOP = { lat: 22.7533, lng: 75.8937 };
const opened: Container[] = [];
afterAll(async () => {
  for (const c of opened) await c.dbHandle.close().catch(() => {});
});

async function world(opts: { payments?: MockPayPalAdapter; llm?: LlmPort; dataDir?: string; clock?: FixedClock } = {}) {
  const dbHandle = opts.dataDir ? await openDb({ dataDir: opts.dataDir }) : await openTestDb();
  await seed(dbHandle.db);
  const clock = opts.clock ?? new FixedClock(T0);
  const paypal = opts.payments ?? new MockPayPalAdapter();
  const c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15" }), { dbHandle, clock, payments: paypal, llm: opts.llm ?? createStubLlm() });
  opened.push(c);
  return { c, clock, paypal };
}

async function verifiedMilestone(w: Awaited<ReturnType<typeof world>>) {
  const job = await w.c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  const order = await w.c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  w.paypal.approveOrder(order.orderId);
  await w.c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await w.c.deliverMockWebhooks();
  await w.c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  w.clock.advance(10 * 60_000);
  const m1 = (await w.c.jobs.detail(job.id))!.milestones[0];
  const bytes = await makeSamplePhoto({ seed: `drill-${job.id}`, caption: "x", takenAt: new Date(w.clock.now().getTime() - 60_000), location: SHOP });
  await w.c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg" });
  await w.c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  const card = await w.c.verification.run(m1.id);
  return { jobId: job.id, m1: m1.id, card };
}

describe("failure drills", () => {
  it("webhook storm: 50 concurrent copies of the capture event post the ledger once", async () => {
    const w = await world();
    const job = await w.c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
    const order = await w.c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
    w.paypal.approveOrder(order.orderId);
    await w.c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
    const events = w.paypal.drainOutbox();
    const capture = events.find((e) => e.eventType === "PAYMENT.CAPTURE.COMPLETED")!;
    const body = JSON.stringify({ id: capture.id, event_type: capture.eventType, resource: capture.resource });
    const resent = (i: number) => JSON.stringify({ id: `${capture.id}-retry-${i}`, event_type: capture.eventType, resource: capture.resource });
    const outcomes = await Promise.all([
      ...Array.from({ length: 25 }, () => w.c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, body)),
      ...Array.from({ length: 25 }, (_, i) => w.c.webhooks.process({ [MOCK_WEBHOOK_HEADER]: "1" }, resent(i))),
    ]);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(await w.c.ledger.balance(escrowCode(job.id))).toBe(10200);
    expect((await w.c.dbHandle.db.select().from(webhookEvents)).length).toBe(26); // 1 original + 25 distinct resends
    expect(await w.c.ledger.checkInvariants()).toEqual([]);
  });

  it("PayPal payout outage: the release fails safely, escrow is intact, and a retry pays exactly once", async () => {
    const outage = new MockPayPalAdapter();
    const w = await world({ payments: outage });
    const { jobId, m1 } = await verifiedMilestone(w);
    const original = outage.createPayout.bind(outage);
    outage.createPayout = async () => {
      throw new Error("ECONNRESET: PayPal unreachable");
    };
    w.clock.advance(60_000);
    await w.c.releases.processDueWindows(); // logs the failure, does not throw
    const [rel] = await w.c.dbHandle.db.select().from(releases).where(eq(releases.milestoneId, m1));
    expect(rel.status).toBe("PAYOUT_FAILED");
    expect(await w.c.ledger.balance(escrowCode(jobId))).toBe(10200);

    outage.createPayout = original;
    expect((await w.c.treasury.executeRelease(rel.id, "admin:retry")).status).toBe("PAYOUT_SUCCEEDED");
    expect(await w.c.treasury.executeRelease(rel.id, "admin:retry-again")).toMatchObject({ status: "PAYOUT_SUCCEEDED" });
    const rows = await w.c.dbHandle.db.select().from(payouts).where(eq(payouts.releaseId, rel.id));
    expect(rows.map((r) => r.status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
    expect(await w.c.ledger.checkInvariants()).toEqual([]);
  });

  it("LLM outage (network errors): verification degrades to human review, nothing is paid", async () => {
    const llm = createStubLlm() as StubLlmAdapter;
    const failing: LlmPort = {
      provider: "stub",
      model: "down",
      structured: async (req) => {
        if (req.agent === "verification") throw new Error("fetch failed: ETIMEDOUT");
        return llm.structured(req);
      },
    };
    const w = await world({ llm: failing });
    const { m1, card } = await verifiedMilestone(w);
    expect(card?.decision).not.toBe("AUTO_RELEASE");
    const [ms] = await w.c.dbHandle.db.select().from(milestones).where(eq(milestones.id, m1));
    expect(["NEEDS_REVIEW", "HELD"]).toContain(ms.status);
    expect(w.paypal.outbox.some((e) => e.eventType.startsWith("PAYMENT.PAYOUTS"))).toBe(false);
  });

  it("database restart: a challenge window that ends while the app is down still pays out after restart", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "settleai-drill-"));
    const clock = new FixedClock(T0);
    const paypal = new MockPayPalAdapter();
    const first = await world({ dataDir: dir, clock, payments: paypal });
    const { jobId, m1, card } = await verifiedMilestone(first);
    expect(card?.decision).toBe("AUTO_RELEASE");
    await first.c.dbHandle.close();
    opened.splice(opened.indexOf(first.c), 1);

    // "Restart": a new process opens the same database; the window has ended in the meantime.
    clock.advance(10 * 60_000);
    const dbHandle = await openDb({ dataDir: dir });
    const c2 = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15" }), { dbHandle, clock, payments: paypal, llm: createStubLlm() });
    opened.push(c2);
    expect(await c2.releases.processDueWindows()).toBe(1);
    const [ms] = await c2.dbHandle.db.select().from(milestones).where(eq(milestones.id, m1));
    expect(ms.status).toBe("RELEASED");
    expect(await c2.ledger.balance(escrowCode(jobId))).toBe(10200 - 4000 - 80);
    expect((await c2.audit.verifyChain()).ok).toBe(true);
    await c2.dbHandle.close();
    opened.splice(opened.indexOf(c2), 1);
    await rm(dir, { recursive: true, force: true });
  });
});
