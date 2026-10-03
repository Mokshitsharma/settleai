// TreasuryService: the ONLY code path that calls PayPal money-out endpoints (Payouts, Refunds).
// Deterministic, never driven directly by an LLM. Claim-then-call pattern makes every payout idempotent.
import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { fundingOrders, jobs, milestones, payouts, refunds, releases, users } from "@/core/db/schema";
import type { GuardDecision } from "@/core/contracts";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { formatMinor, splitProportional } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import { TERMINAL_PAYOUT_FAILURES, type PaymentsPort, type PayoutItemStatus } from "@/core/ports/payments";
import { assertTransition, canTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import { escrowCode, type LedgerService } from "./ledger";
import type { PolicyService } from "./policy";
import type { ReputationService } from "./reputation";

export class TreasuryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "KILL_SWITCH"
      | "NO_PAYOUT_EMAIL"
      | "INVALID_STATE"
      | "GUARD_DENIED"
      | "INSUFFICIENT_ESCROW"
      | "NOT_FUNDED",
    message: string,
    readonly decision?: GuardDecision,
  ) {
    super(message);
  }
}

/** Mandate Guard gate G3, injected so Treasury cannot be called without it once wired (T207). */
export type ReleaseGuard = (args: { releaseId: string; jobId: string; amountMinor: number }) => Promise<GuardDecision>;

export class TreasuryService {
  constructor(
    private readonly db: Db,
    private readonly payments: PaymentsPort,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly attestations: AttestationService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
    private readonly opts: { killSwitch: boolean; releaseGuard?: ReleaseGuard },
    private readonly reputation: ReputationService,
    private readonly policy: PolicyService,
  ) {}

  /** Platform fee share for one milestone: the job fee split proportionally to milestone amounts. */
  async feeShare(jobId: string, milestoneSeq: number): Promise<number> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    const ms = await this.db.select().from(milestones).where(eq(milestones.jobId, jobId)).orderBy(asc(milestones.seq));
    if (job.feeMinor === 0 || ms.every((m) => m.amountMinor === 0)) return 0;
    const shares = splitProportional(job.feeMinor, ms.map((m) => Math.max(m.amountMinor, 0)));
    return shares[ms.findIndex((m) => m.seq === milestoneSeq)] ?? 0;
  }

  /**
   * Executes an approved release via PayPal Payouts. Safe to call repeatedly: the first call claims the
   * release (PAYOUT_PENDING + a unique payouts row); later calls return the existing payout.
   */
  async executeRelease(releaseId: string, actor: string): Promise<{ status: string; payoutId: string }> {
    if (this.opts.killSwitch) throw new TreasuryError("KILL_SWITCH", "All payouts are paused by the kill switch");

    // Phase 1: claim inside a transaction.
    const claim = await this.db.transaction(async (tx) => {
      const [rel] = await tx.select().from(releases).where(eq(releases.id, releaseId)).for("update");
      if (!rel) throw new TreasuryError("NOT_FOUND", "Release not found");
      if (rel.status === "PAYOUT_PENDING" || rel.status === "PAYOUT_SUCCEEDED") {
        const [existing] = await tx.select().from(payouts).where(eq(payouts.releaseId, rel.id)).orderBy(asc(payouts.createdAt));
        return { kind: "existing" as const, status: rel.status, payoutId: existing?.id ?? "" };
      }
      if (!canTransition("RELEASE", rel.status, "PAYOUT_PENDING")) {
        throw new TreasuryError("INVALID_STATE", `Release is ${rel.status}`);
      }
      const [ms] = await tx.select().from(milestones).where(eq(milestones.id, rel.milestoneId));
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, ms.jobId));
      const [worker] = job.workerId ? await tx.select().from(users).where(eq(users.id, job.workerId)) : [];
      if (!worker?.paypalEmail) throw new TreasuryError("NO_PAYOUT_EMAIL", "Worker has no PayPal email on file");

      const escrow = await this.ledger.balance(escrowCode(job.id), tx);
      if (escrow < rel.amountMinor + rel.feeMinor) throw new TreasuryError("INSUFFICIENT_ESCROW", "Escrow does not cover this release");

      const [{ n }] = await tx.select({ n: count() }).from(payouts).where(eq(payouts.releaseId, rel.id));
      const senderItemId = n === 0 ? rel.id : `${rel.id}-r${n}`; // retries need a fresh PayPal id
      const payoutId = newId("po");
      await tx.insert(payouts).values({
        id: payoutId,
        releaseId: rel.id,
        senderItemId,
        amountMinor: rel.amountMinor,
        status: "CREATED",
      });
      await tx.update(releases).set({ status: "PAYOUT_PENDING", payoutId, updatedAt: this.clock.now() }).where(eq(releases.id, rel.id));
      return { kind: "claimed" as const, rel, ms, job, worker, payoutId, senderItemId };
    });
    if (claim.kind === "existing") return { status: claim.status, payoutId: claim.payoutId };
    const { rel, ms, job, worker, payoutId, senderItemId } = claim;

    // Gate G3 runs immediately before the PayPal call (spec §7.4). Wired to Mandate Guard in T207.
    if (this.opts.releaseGuard) {
      const decision = await this.opts.releaseGuard({ releaseId: rel.id, jobId: job.id, amountMinor: rel.amountMinor });
      if (decision.result !== "allow") {
        await this.markPayoutFailed(payoutId, rel.id, `GUARD_${decision.reasonCodes.join("+")}`, true);
        throw new TreasuryError("GUARD_DENIED", decision.message, decision);
      }
    }

    this.events.publish(`job:${job.id}`, "payout.submitted", `Payout of ${formatMinor(rel.amountMinor)} submitted to PayPal`);
    let result;
    try {
      result = await this.payments.createPayout({
        requestId: `rel_${senderItemId}`,
        senderBatchId: senderItemId,
        senderItemId,
        receiverEmail: worker.paypalEmail!,
        amountMinor: rel.amountMinor,
        currency: "USD",
        note: `SettleAI: ${job.title}, milestone ${ms.seq} (${ms.title})`,
      });
    } catch (err) {
      await this.markPayoutFailed(payoutId, rel.id, (err as Error).message.slice(0, 200), false);
      throw err;
    }
    await this.db
      .update(payouts)
      .set({ paypalBatchId: result.batchId, paypalItemId: result.itemId ?? null, rawJson: result.raw as object, status: "PROCESSING", updatedAt: this.clock.now() })
      .where(eq(payouts.id, payoutId));
    await this.applyPayoutStatus({ payoutId, status: result.status, itemId: result.itemId, failureReason: result.failureReason }, actor);
    const [fresh] = await this.db.select().from(releases).where(eq(releases.id, rel.id));
    return { status: fresh.status, payoutId };
  }

  private async markPayoutFailed(payoutId: string, releaseId: string, reason: string, cancelRelease: boolean) {
    await this.db.transaction(async (tx) => {
      await tx.update(payouts).set({ status: "FAILED", failureReason: reason, updatedAt: this.clock.now() }).where(eq(payouts.id, payoutId));
      await tx
        .update(releases)
        .set({ status: cancelRelease ? "CANCELLED" : "PAYOUT_FAILED", updatedAt: this.clock.now() })
        .where(eq(releases.id, releaseId));
    });
  }

  /**
   * Applies a payout item status from the API response, a webhook or polling. State-machine safe:
   * stale or repeated updates are ignored. On SUCCEEDED: ledger, milestone RELEASED, attestation.
   */
  async applyPayoutStatus(
    args: { payoutId?: string; senderItemId?: string; itemId?: string; status: PayoutItemStatus; failureReason?: string },
    actor = "system",
  ): Promise<"applied" | "ignored"> {
    const outcome = await this.db.transaction(async (tx) => {
      const where = args.payoutId
        ? eq(payouts.id, args.payoutId)
        : args.senderItemId
          ? eq(payouts.senderItemId, args.senderItemId)
          : eq(payouts.paypalItemId, args.itemId ?? "");
      const [po] = await tx.select().from(payouts).where(where).for("update");
      if (!po) return { applied: false as const };
      if (po.status === args.status || (po.status !== "CREATED" && !canTransition("PAYOUT", po.status, args.status))) {
        return { applied: false as const };
      }
      await tx
        .update(payouts)
        .set({ status: args.status, paypalItemId: po.paypalItemId ?? args.itemId ?? null, failureReason: args.failureReason ?? null, updatedAt: this.clock.now() })
        .where(eq(payouts.id, po.id));
      const [rel] = await tx.select().from(releases).where(eq(releases.id, po.releaseId)).for("update");
      const [ms] = await tx.select().from(milestones).where(eq(milestones.id, rel.milestoneId)).for("update");

      if (args.status === "SUCCEEDED" && rel.status === "PAYOUT_PENDING") {
        assertTransition("RELEASE", rel.status, "PAYOUT_SUCCEEDED");
        await tx.update(releases).set({ status: "PAYOUT_SUCCEEDED", updatedAt: this.clock.now() }).where(eq(releases.id, rel.id));
        await this.ledger.recordRelease({ jobId: ms.jobId, releaseId: rel.id, payoutMinor: rel.amountMinor, feeMinor: rel.feeMinor }, tx);
        const releasedMinor = ms.releasedMinor + rel.amountMinor;
        const fullyReleased = releasedMinor >= ms.amountMinor;
        await tx
          .update(milestones)
          .set({
            releasedMinor,
            status: fullyReleased && canTransition("MILESTONE", ms.status, "RELEASED") ? "RELEASED" : ms.status,
            updatedAt: this.clock.now(),
          })
          .where(eq(milestones.id, ms.id));
        await this.audit.append(
          { actor, action: "release.paid", entityType: "release", entityId: rel.id, payload: { payoutId: po.id, amountMinor: rel.amountMinor, itemId: args.itemId ?? po.paypalItemId } },
          tx,
        );
        await this.attestations.append(
          {
            jobId: ms.jobId,
            type: "settlement",
            subjectId: rel.id,
            payload: {
              milestoneSeq: ms.seq,
              amountMinor: rel.amountMinor,
              feeMinor: rel.feeMinor,
              payoutItemId: args.itemId ?? po.paypalItemId,
              payoutStatus: "SUCCEEDED",
              decisionSource: rel.decisionSource,
            },
          },
          tx,
        );
        if (fullyReleased) await this.activateNextMilestone(tx, ms.jobId, ms.seq);
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, ms.jobId));
        let trust: number | null = null;
        if (job.workerId) {
          const policy = await this.policy.active(tx);
          trust = await this.reputation.apply(tx, { userId: job.workerId, delta: policy.trustDeltas.release_success, reason: "release_success", refType: "release", refId: rel.id });
        }
        await this.maybeCompleteJob(tx, ms.jobId);
        return {
          applied: true as const,
          jobId: ms.jobId,
          message: `PayPal payout succeeded: ${formatMinor(rel.amountMinor)} to the worker${trust !== null ? `; trust score now ${trust}` : ""}`,
          type: "payout.succeeded",
        };
      }
      if (TERMINAL_PAYOUT_FAILURES.includes(args.status) && rel.status === "PAYOUT_PENDING") {
        await tx.update(releases).set({ status: "PAYOUT_FAILED", updatedAt: this.clock.now() }).where(eq(releases.id, rel.id));
        await this.audit.append(
          { actor, action: "release.payout_failed", entityType: "release", entityId: rel.id, payload: { status: args.status, reason: args.failureReason ?? null } },
          tx,
        );
        return { applied: true as const, jobId: ms.jobId, message: `PayPal payout ${args.status}; funds stay in escrow`, type: "payout.failed" };
      }
      return { applied: true as const, jobId: ms.jobId, message: `Payout status ${args.status}`, type: "payout.status" };
    });
    if (!outcome.applied) return "ignored";
    this.events.publish(`job:${outcome.jobId}`, outcome.type, outcome.message);
    return "applied";
  }

  private async activateNextMilestone(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], jobId: string, afterSeq: number) {
    const ms = await tx.select().from(milestones).where(eq(milestones.jobId, jobId)).orderBy(asc(milestones.seq));
    const next = ms.find((m) => m.seq > afterSeq && m.status === "PENDING");
    if (next) await tx.update(milestones).set({ status: "ACTIVE", activatedAt: this.clock.now(), updatedAt: this.clock.now() }).where(eq(milestones.id, next.id));
  }

  private async maybeCompleteJob(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], jobId: string) {
    const ms = await tx.select().from(milestones).where(eq(milestones.jobId, jobId));
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
    if (ms.every((m) => m.status === "RELEASED" || m.status === "RESOLVED") && canTransition("JOB", job.status, "COMPLETED")) {
      await tx.update(jobs).set({ status: "COMPLETED", updatedAt: this.clock.now() }).where(eq(jobs.id, jobId));
    }
  }

  /** Refund part of the escrow to the payer via Payments v2 capture refund. Never more than escrow. */
  async refund(args: { jobId: string; amountMinor: number; reason: string; actor: string; disputeId?: string }) {
    const [funding] = await this.db
      .select()
      .from(fundingOrders)
      .where(and(eq(fundingOrders.jobId, args.jobId), eq(fundingOrders.status, "CONFIRMED")));
    if (!funding?.paypalCaptureId) throw new TreasuryError("NOT_FUNDED", "Job has no confirmed capture to refund");
    const escrow = await this.ledger.balance(escrowCode(args.jobId));
    if (args.amountMinor <= 0 || args.amountMinor > escrow) {
      throw new TreasuryError("INSUFFICIENT_ESCROW", `Refund ${args.amountMinor} exceeds escrow ${escrow}`);
    }
    const refundId = newId("rfd");
    await this.db.insert(refunds).values({
      id: refundId,
      jobId: args.jobId,
      disputeId: args.disputeId ?? null,
      requestId: `ref_${refundId}`,
      amountMinor: args.amountMinor,
      status: "CREATED",
    });
    const result = await this.payments.refundCapture({
      requestId: `ref_${refundId}`,
      captureId: funding.paypalCaptureId,
      amountMinor: args.amountMinor,
      currency: "USD",
      invoiceId: funding.id,
      noteToPayer: args.reason,
    });
    await this.db.transaction(async (tx) => {
      await tx
        .update(refunds)
        .set({ paypalRefundId: result.refundId, status: result.status, rawJson: result.raw as object, updatedAt: this.clock.now() })
        .where(eq(refunds.id, refundId));
      if (result.status === "COMPLETED") {
        await this.ledger.recordRefund({ jobId: args.jobId, refundId, amountMinor: args.amountMinor }, tx);
        await this.audit.append(
          { actor: args.actor, action: "refund.completed", entityType: "job", entityId: args.jobId, payload: { refundId, amountMinor: args.amountMinor, paypalRefundId: result.refundId } },
          tx,
        );
      }
    });
    this.events.publish(`job:${args.jobId}`, "refund." + result.status.toLowerCase(), `Refund of ${formatMinor(args.amountMinor)}: ${result.status}`);
    return { refundId, status: result.status };
  }
}
