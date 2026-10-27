// Shared full-system world for the hardening tests: seeded in-memory PGlite, fixed clock, mock PayPal, stub LLM.
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { makeSamplePhoto } from "@/core/checks/sample-photos";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { FixedClock } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import { sampleJobSpec } from "./fixtures/contracts";
import { T0 } from "./helpers";

export const SHOP = { lat: 22.7533, lng: 75.8937 };

export interface World {
  c: Container;
  clock: FixedClock;
  paypal: MockPayPalAdapter;
}

export async function world(opts: { payments?: MockPayPalAdapter; llm?: LlmPort; env?: Record<string, string> } = {}): Promise<World> {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const clock = new FixedClock(T0);
  const paypal = opts.payments ?? new MockPayPalAdapter();
  const c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "15", ...opts.env }), { dbHandle, clock, payments: paypal, llm: opts.llm ?? createStubLlm() });
  return { c, clock, paypal };
}

/** Creates, funds (through the webhook) and accepts the sample job. */
export async function fundedJob(w: World) {
  const job = await w.c.jobs.createFromSpec({ payerId: "usr_ravi", spec: sampleJobSpec, createdBy: "user:usr_ravi" });
  const order = await w.c.funding.start({ jobId: job.id, payerId: "usr_ravi" });
  w.paypal.approveOrder(order.orderId);
  await w.c.funding.capture({ jobId: job.id, payerId: "usr_ravi", orderId: order.orderId });
  await w.c.deliverMockWebhooks();
  await w.c.jobs.accept({ jobId: job.id, workerId: "usr_asha" });
  w.clock.advance(10 * 60_000);
  return job;
}

/** Funded job whose first milestone has a clean proof and has been verified. */
export async function verifiedMilestone(w: World) {
  const job = await fundedJob(w);
  const m1 = (await w.c.jobs.detail(job.id))!.milestones[0];
  const bytes = await makeSamplePhoto({ seed: `world-${job.id}`, caption: "x", takenAt: new Date(w.clock.now().getTime() - 60_000), location: SHOP });
  await w.c.proofs.addPhoto({ milestoneId: m1.id, workerId: "usr_asha", bytes, declaredMime: "image/jpeg" });
  await w.c.proofs.submit({ milestoneId: m1.id, workerId: "usr_asha" });
  const card = await w.c.verification.run(m1.id);
  return { jobId: job.id, m1: m1.id, card };
}
