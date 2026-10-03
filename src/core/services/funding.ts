// Funding via PayPal Orders v2 (spec §6.2 flow A). The job becomes FUNDED only when the
// PAYMENT.CAPTURE.COMPLETED webhook confirms the capture: the webhook is the source of truth.
import { and, count, desc, eq } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { fundingOrders, jobs, milestones } from "@/core/db/schema";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { hashCanonical } from "@/core/mandates/canonical";
import type { ClockPort } from "@/core/ports/clock";
import type { PaymentsPort } from "@/core/ports/payments";
import { assertTransition } from "@/core/state/machines";
import type { AuditService } from "./audit";
import { JobError, type JobService } from "./jobs";

/** PayPal custom_id binding (spec §7.7): smd_<jobShortId>_<first 16 hex of the Payment Mandate hash>. */
export function paypalCustomId(jobId: string, paymentMandateHash: string): string {
  return `smd_${jobId.slice(-10)}_${paymentMandateHash.slice(0, 16)}`;
}

export class FundingService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsPort,
    private readonly jobs: JobService,
    private readonly audit: AuditService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
  ) {}

  /** Creates the PayPal order for milestones total + platform fee. Idempotent per attempt. */
  async start(args: { jobId: string; payerId: string }) {
    const job = await this.jobs.getRow(args.jobId);
    if (!job) throw new JobError("NOT_FOUND", "Job not found");
    if (job.payerId !== args.payerId) throw new JobError("FORBIDDEN", "Only the payer can fund this job");
    if (job.status !== "SCOPED" && job.status !== "AWAITING_FUNDING") throw new JobError("INVALID_STATE", `Job is ${job.status}`);
    const ms = await this.db.select().from(milestones).where(eq(milestones.jobId, job.id));
    if (job.totalMinor <= 0 || ms.some((m) => m.amountMinor <= 0)) {
      throw new JobError("INVALID_SPEC", "Every milestone needs an amount before funding");
    }

    // Reuse an open order instead of creating a second one (double-click safe).
    const [open] = await this.db
      .select()
      .from(fundingOrders)
      .where(and(eq(fundingOrders.jobId, job.id), eq(fundingOrders.status, "CREATED")))
      .orderBy(desc(fundingOrders.createdAt))
      .limit(1);
    if (open?.paypalOrderId) {
      return { fundingId: open.id, orderId: open.paypalOrderId, amountMinor: open.amountMinor, approveUrl: (open.rawJson as { approveUrl?: string })?.approveUrl };
    }

    const [{ n }] = await this.db.select({ n: count() }).from(fundingOrders).where(eq(fundingOrders.jobId, job.id));
    const attempt = n + 1;
    const fundingId = newId("fund");
    const amountMinor = job.totalMinor + job.feeMinor;
    const requestId = `fund_${job.id}_${attempt}`;
    // Until the Payment Mandate exists (T205), bind the order to the hash of the confirmed job spec.
    const customId = paypalCustomId(job.id, hashCanonical(job.specJson));
    await this.db.insert(fundingOrders).values({ id: fundingId, jobId: job.id, amountMinor, status: "CREATED", requestId });

    const order = await this.payments.createOrder({
      requestId,
      amountMinor,
      currency: "USD",
      customId,
      invoiceId: fundingId,
      description: `SettleAI escrow: ${job.title}`,
    });
    await this.db.transaction(async (tx) => {
      await tx
        .update(fundingOrders)
        .set({ paypalOrderId: order.orderId, rawJson: { approveUrl: order.approveUrl, customId, order: order.raw as object }, updatedAt: this.clock.now() })
        .where(eq(fundingOrders.id, fundingId));
      const [fresh] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      if (fresh.status === "SCOPED") await this.jobs.setStatus(tx, fresh, "AWAITING_FUNDING");
      await this.audit.append(
        { actor: `user:${args.payerId}`, action: "funding.order_created", entityType: "job", entityId: job.id, payload: { fundingId, orderId: order.orderId, amountMinor, customId } },
        tx,
      );
    });
    this.events.publish(`job:${job.id}`, "funding.order_created", `PayPal order ${order.orderId} created for escrow`);
    return { fundingId, orderId: order.orderId, amountMinor, approveUrl: order.approveUrl };
  }

  /** Captures an approved order. Ledger and FUNDED status follow from the capture webhook. */
  async capture(args: { jobId: string; payerId: string; orderId: string }) {
    const [funding] = await this.db
      .select()
      .from(fundingOrders)
      .where(and(eq(fundingOrders.jobId, args.jobId), eq(fundingOrders.paypalOrderId, args.orderId)));
    if (!funding) throw new JobError("NOT_FOUND", "Funding order not found");
    const job = await this.jobs.getRow(args.jobId);
    if (!job || job.payerId !== args.payerId) throw new JobError("FORBIDDEN", "Only the payer can capture");
    if (funding.status === "CAPTURED" || funding.status === "CONFIRMED") {
      return { status: funding.status, captureId: funding.paypalCaptureId };
    }
    const capture = await this.payments.captureOrder(args.orderId, `cap_${funding.id}`);
    if (capture.status !== "COMPLETED" && capture.status !== "PENDING") {
      await this.db.update(fundingOrders).set({ status: "FAILED", updatedAt: this.clock.now() }).where(eq(fundingOrders.id, funding.id));
      throw new JobError("INVALID_STATE", `PayPal capture ${capture.status}`);
    }
    if (capture.amountMinor !== funding.amountMinor) {
      // Never silently accept a different amount; reconciliation and an admin decide.
      await this.audit.append({ actor: "system", action: "funding.amount_mismatch", entityType: "job", entityId: job.id, payload: { expected: funding.amountMinor, captured: capture.amountMinor } });
    }
    await this.db.transaction(async (tx) => {
      const [f] = await tx.select().from(fundingOrders).where(eq(fundingOrders.id, funding.id)).for("update");
      if (f.status === "CREATED" || f.status === "APPROVED") {
        assertTransition("FUNDING", f.status, "CAPTURED");
        await tx
          .update(fundingOrders)
          .set({ status: "CAPTURED", paypalCaptureId: capture.captureId, updatedAt: this.clock.now() })
          .where(eq(fundingOrders.id, f.id));
      } else if (!f.paypalCaptureId) {
        await tx.update(fundingOrders).set({ paypalCaptureId: capture.captureId }).where(eq(fundingOrders.id, f.id));
      }
    });
    this.events.publish(`job:${job.id}`, "funding.captured", `PayPal captured ${capture.captureId}; waiting for webhook confirmation`);
    return { status: "CAPTURED", captureId: capture.captureId };
  }
}
