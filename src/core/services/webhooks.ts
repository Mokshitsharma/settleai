// PayPal webhook processing (spec §6.3): verify signature, dedupe on paypal_event_id, dispatch.
// Handlers are state-machine safe: late or out-of-order events are ignored, never re-applied.
import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { fundingOrders, jobs, webhookEvents } from "@/core/db/schema";
import { mapPayoutStatus } from "@/core/adapters/paypal/live";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { formatMinor } from "@/core/money";
import { fromPayPalValue, type PaymentsPort, type WebhookEvent } from "@/core/ports/payments";
import type { ClockPort } from "@/core/ports/clock";
import { canTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import type { LedgerService } from "./ledger";
import type { OutboxService } from "./outbox";
import type { TreasuryService } from "./treasury";

export type WebhookOutcome = "rejected" | "duplicate" | "processed" | "ignored";

export class WebhookService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsPort,
    private readonly ledger: LedgerService,
    private readonly treasury: TreasuryService,
    private readonly audit: AuditService,
    private readonly attestations: AttestationService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
    private readonly outbox?: OutboxService,
  ) {}

  async process(headers: Record<string, string>, body: string): Promise<WebhookOutcome> {
    const event = await this.payments.verifyWebhook(headers, body);
    if (!event) return "rejected";
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ id: newId("whe"), paypalEventId: event.id, eventType: event.eventType, payload: event.raw as object })
      .onConflictDoNothing({ target: webhookEvents.paypalEventId })
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return "duplicate";

    let outcome: WebhookOutcome;
    try {
      outcome = await this.dispatch(event);
    } catch (err) {
      // The event is already stored (and deduped), so PayPal's own resend would be dropped as a duplicate.
      // The outbox re-dispatches it from the stored payload with backoff instead (same transaction as the mark).
      await this.db.transaction(async (tx) => {
        await tx.update(webhookEvents).set({ status: "failed" }).where(eq(webhookEvents.id, inserted[0].id));
        await this.outbox?.enqueue(tx, { topic: "webhook.redispatch", dedupeKey: `whr:${inserted[0].id}`, payload: { webhookEventId: inserted[0].id } });
      });
      throw err;
    }
    await this.db
      .update(webhookEvents)
      .set({ status: outcome === "processed" ? "processed" : "ignored", processedAt: this.clock.now() })
      .where(eq(webhookEvents.id, inserted[0].id));
    return outcome;
  }

  /** Outbox handler: re-runs a stored webhook whose first dispatch failed. Handlers are state-machine safe. */
  async redispatch(webhookEventId: string): Promise<WebhookOutcome> {
    const [row] = await this.db.select().from(webhookEvents).where(eq(webhookEvents.id, webhookEventId));
    if (!row || row.status !== "failed") return "ignored";
    const raw = row.payload as { id: string; event_type: string; resource: Record<string, unknown> };
    const outcome = await this.dispatch({ id: row.paypalEventId, eventType: row.eventType, resource: raw.resource ?? {}, raw });
    await this.db
      .update(webhookEvents)
      .set({ status: outcome === "processed" ? "processed" : "ignored", processedAt: this.clock.now() })
      .where(eq(webhookEvents.id, row.id));
    return outcome;
  }

  private async dispatch(event: WebhookEvent): Promise<WebhookOutcome> {
    const r = event.resource as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (event.eventType) {
      case "CHECKOUT.ORDER.APPROVED":
        return "ignored"; // capture is explicit (spec §6.3)
      case "PAYMENT.CAPTURE.COMPLETED":
        return this.onCaptureCompleted(String(r.id), r.supplementary_data?.related_ids?.order_id, r.amount?.value);
      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.DECLINED":
      case "PAYMENT.CAPTURE.REVERSED":
        await this.audit.append({ actor: "paypal", action: "funding.flagged", entityType: "capture", entityId: String(r.id), payload: { eventType: event.eventType } });
        this.events.publish("admin", "admin.alert", `${event.eventType} for capture ${r.id}`);
        return "processed";
      default:
        if (event.eventType.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
          const applied = await this.treasury.applyPayoutStatus(
            {
              senderItemId: r.payout_item?.sender_item_id,
              itemId: r.payout_item_id,
              status: mapPayoutStatus(String(r.transaction_status ?? "")),
              failureReason: r.errors?.name,
            },
            "paypal",
          );
          return applied === "applied" ? "processed" : "ignored";
        }
        return "ignored";
    }
  }

  private async onCaptureCompleted(captureId: string, orderId: string | undefined, value: string | undefined): Promise<WebhookOutcome> {
    const result = await this.db.transaction(async (tx) => {
      const [funding] = await tx
        .select()
        .from(fundingOrders)
        .where(or(eq(fundingOrders.paypalCaptureId, captureId), orderId ? eq(fundingOrders.paypalOrderId, orderId) : undefined))
        .for("update");
      if (!funding || funding.status === "CONFIRMED" || funding.status === "FAILED") return null;
      const amountMinor = value ? fromPayPalValue(value) : funding.amountMinor;
      await tx
        .update(fundingOrders)
        .set({ status: "CONFIRMED", paypalCaptureId: captureId, updatedAt: this.clock.now() })
        .where(eq(fundingOrders.id, funding.id));
      await this.ledger.recordFunding({ jobId: funding.jobId, fundingId: funding.id, amountMinor }, tx);
      const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, funding.jobId))).for("update");
      if (canTransition("JOB", job.status, "FUNDED")) {
        await tx.update(jobs).set({ status: "FUNDED", updatedAt: this.clock.now() }).where(eq(jobs.id, job.id));
      }
      await this.audit.append(
        { actor: "paypal", action: "job.funded", entityType: "job", entityId: job.id, payload: { captureId, amountMinor, fundingId: funding.id } },
        tx,
      );
      await this.attestations.append(
        { jobId: job.id, type: "evidence", subjectId: funding.id, payload: { kind: "funding_captured", captureId, orderId: funding.paypalOrderId, amountMinor } },
        tx,
      );
      return { jobId: job.id, amountMinor };
    });
    if (!result) return "ignored";
    this.events.publish(`job:${result.jobId}`, "job.funded", `Escrow funded: ${formatMinor(result.amountMinor)} confirmed by PayPal webhook`);
    return "processed";
  }
}
