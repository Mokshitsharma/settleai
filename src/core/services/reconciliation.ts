// Reconciliation (spec F20, §11.2): compares SettleAI's ledger and payout records with PayPal and reports
// mismatches. Pending payouts whose webhook never arrived are repaired through the normal, state-machine-safe
// path; anything else is reported for a person, never silently "fixed".
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { fundingOrders, ledgerTxns, payouts, refunds } from "@/core/db/schema";
import { toPayPalValue } from "@/core/ports/payments";
import type { WebhookService } from "./webhooks";
import type { PaymentsPort } from "@/core/ports/payments";
import type { LedgerService } from "./ledger";
import type { TreasuryService } from "./treasury";

export interface ReconciliationReport {
  ok: boolean;
  checked: { fundings: number; payouts: number; refunds: number };
  repaired: string[];
  mismatches: { kind: string; ref: string; detail: string }[];
  /** Payouts PayPal could not be asked about (e.g. made by another process's mock). Not mismatches. */
  unverifiable: number;
}

export class ReconciliationService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsPort,
    private readonly ledger: LedgerService,
    private readonly treasury: TreasuryService,
    private readonly webhooks: WebhookService,
  ) {}

  /**
   * Webhooks can be late, and a sleeping free server misses them entirely. This asks PayPal directly about captures and
   * payouts still in flight and applies the answer through the same state-machine-safe paths. Returns what changed.
   */
  async repairInFlight(): Promise<string[]> {
    const repaired: string[] = [];
    const captured = await this.db.select().from(fundingOrders).where(eq(fundingOrders.status, "CAPTURED"));
    for (const f of captured) {
      if (!f.paypalCaptureId) continue;
      try {
        const remote = await this.payments.getCapture(f.paypalCaptureId);
        if (remote.status !== "COMPLETED") continue;
        const outcome = await this.webhooks.confirmCapture(remote.captureId, f.paypalOrderId ?? remote.orderId, toPayPalValue(remote.amountMinor));
        if (outcome === "processed") repaired.push(`funding ${f.id}: confirmed from PayPal`);
      } catch (err) {
        console.error("capture status check failed", f.id, (err as Error).message);
      }
    }
    const inFlight = await this.db.select().from(payouts).where(inArray(payouts.status, ["PROCESSING", "PENDING"]));
    for (const p of inFlight) {
      if (!p.paypalBatchId) continue;
      try {
        const remote = await this.payments.getPayoutBatch(p.paypalBatchId);
        if (remote.status === "PENDING" && (p.paypalItemId || !remote.itemId)) continue;
        const applied = await this.treasury.applyPayoutStatus({ payoutId: p.id, status: remote.status, itemId: remote.itemId, failureReason: remote.failureReason }, "system:reconciliation");
        if (applied === "applied") repaired.push(`payout ${p.id}: ${p.status} -> ${remote.status}`);
      } catch (err) {
        console.error("payout status check failed", p.id, (err as Error).message);
      }
    }
    return repaired;
  }

  async run(): Promise<ReconciliationReport> {
    const mismatches: ReconciliationReport["mismatches"] = [];
    const repaired: string[] = [];
    let unverifiable = 0;
    const posted = new Set((await this.db.select({ k: ledgerTxns.idempotencyKey }).from(ledgerTxns)).map((r) => r.k));

    const fundings = await this.db.select().from(fundingOrders).where(eq(fundingOrders.status, "CONFIRMED"));
    for (const f of fundings) {
      if (!posted.has(`fund:${f.id}`)) mismatches.push({ kind: "funding_not_in_ledger", ref: f.id, detail: `Capture ${f.paypalCaptureId} is confirmed but has no ledger entry` });
    }

    const pays = await this.db.select().from(payouts).where(inArray(payouts.status, ["PROCESSING", "PENDING", "SUCCEEDED", "UNCLAIMED", "ONHOLD"]));
    for (const p of pays) {
      // Seeded demo history was paid by the mock; PayPal cannot be asked about those ids.
      if (p.paypalItemId?.startsWith("MOCK-") && this.payments.mode === "LIVE") {
        unverifiable++;
        continue;
      }
      if (!p.paypalItemId) {
        mismatches.push({ kind: "payout_without_item", ref: p.id, detail: "PayPal never returned a payout item id for this batch" });
        continue;
      }
      let remote;
      try {
        remote = await this.payments.getPayoutItem(p.paypalItemId);
      } catch (err) {
        if (this.payments.mode === "MOCK") {
          unverifiable++;
          continue;
        }
        mismatches.push({ kind: "payout_lookup_failed", ref: p.id, detail: (err as Error).message });
        continue;
      }
      if (remote.status === p.status) {
        if (p.status === "SUCCEEDED" && !posted.has(`release:${p.releaseId}`)) {
          mismatches.push({ kind: "payout_not_in_ledger", ref: p.id, detail: "Payout succeeded at PayPal but the ledger has no release entry" });
        }
        continue;
      }
      if (p.status === "PROCESSING" || p.status === "PENDING" || p.status === "UNCLAIMED" || p.status === "ONHOLD") {
        // A missed webhook: apply PayPal's status through the same path a webhook would use.
        const applied = await this.treasury.applyPayoutStatus({ payoutId: p.id, status: remote.status, itemId: p.paypalItemId, failureReason: remote.failureReason }, "system:reconciliation");
        if (applied === "applied") repaired.push(`payout ${p.id}: ${p.status} -> ${remote.status}`);
        else mismatches.push({ kind: "payout_status", ref: p.id, detail: `SettleAI says ${p.status}, PayPal says ${remote.status}` });
      } else {
        mismatches.push({ kind: "payout_status", ref: p.id, detail: `SettleAI says ${p.status}, PayPal says ${remote.status}` });
      }
    }

    const refundRows = await this.db.select().from(refunds).where(and(eq(refunds.status, "COMPLETED")));
    for (const r of refundRows) {
      if (!posted.has(`refund:${r.id}`)) mismatches.push({ kind: "refund_not_in_ledger", ref: r.id, detail: "Refund completed but has no ledger entry" });
    }

    for (const problem of await this.ledger.checkInvariants()) mismatches.push({ kind: "ledger_invariant", ref: "ledger", detail: problem });

    return {
      ok: mismatches.length === 0,
      checked: { fundings: fundings.length, payouts: pays.length, refunds: refundRows.length },
      repaired,
      mismatches,
      unverifiable,
    };
  }
}
