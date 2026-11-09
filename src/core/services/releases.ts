// Release orchestration (spec §8.5, §10, T207): challenge windows, human approvals and rejections,
// and the mandate-revocation pause. Money still only moves through TreasuryService, behind gate G3.
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { approvals, jobs, milestones, releases, riskAssessments } from "@/core/db/schema";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { formatMinor } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import { assertTransition, canTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import { JobError } from "./jobs";
import type { PolicyService } from "./policy";
import type { ReputationService } from "./reputation";
import { TreasuryError, type TreasuryService } from "./treasury";

const PAUSABLE = ["APPROVED_AUTO", "CHALLENGE_WINDOW", "APPROVED_ADMIN"] as const;

export class ReleaseService {
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly treasury: TreasuryService,
    private readonly attestations: AttestationService,
    private readonly audit: AuditService,
    private readonly reputation: ReputationService,
    private readonly policy: PolicyService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
  ) {}

  /** Executes every release whose challenge window has ended. DB-driven, so restarts are safe. */
  async processDueWindows(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const due = await this.db
        .select({ id: releases.id })
        .from(releases)
        .where(and(eq(releases.status, "WAITING_WINDOW"), lte(releases.challengeEndsAt, this.clock.now())));
      for (const r of due) await this.executeAfterWindow(r.id).catch((err) => console.error("release failed", r.id, err));
      return due.length;
    } finally {
      this.ticking = false;
    }
  }

  private async executeAfterWindow(releaseId: string): Promise<void> {
    const moved = await this.db.transaction(async (tx) => {
      const [rel] = await tx.select().from(releases).where(eq(releases.id, releaseId)).for("update");
      const [ms] = await tx.select().from(milestones).where(eq(milestones.id, rel.milestoneId)).for("update");
      if (rel.status !== "WAITING_WINDOW" || ms.status !== "CHALLENGE_WINDOW") return null;
      assertTransition("MILESTONE", ms.status, "RELEASING");
      await tx.update(milestones).set({ status: "RELEASING", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      return ms;
    });
    if (!moved) return;
    this.events.publish(`job:${moved.jobId}`, "release.window_closed", `Challenge window closed for milestone ${moved.seq}; checking the mandate before payout`);
    await this.pay(releaseId, moved, "system:release_timer");
  }

  /** Calls Treasury (which runs gate G3 right before the PayPal call). A G3 denial pauses the milestone. */
  private async pay(releaseId: string, ms: typeof milestones.$inferSelect, actor: string): Promise<void> {
    try {
      await this.treasury.executeRelease(releaseId, actor);
    } catch (err) {
      if (err instanceof TreasuryError && err.code === "GUARD_DENIED") {
        await this.db.transaction(async (tx) => {
          const [fresh] = await tx.select().from(milestones).where(eq(milestones.id, ms.id)).for("update");
          if (canTransition("MILESTONE", fresh.status, "PAUSED_MANDATE")) {
            await tx.update(milestones).set({ status: "PAUSED_MANDATE", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
          }
        });
        this.events.publish(`job:${ms.jobId}`, "release.paused", `${err.message}`);
        return;
      }
      throw err;
    }
  }

  private async requireReviewable(milestoneId: string) {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!ms) throw new JobError("NOT_FOUND", "Milestone not found");
    if (ms.status !== "NEEDS_REVIEW" && ms.status !== "HELD") throw new JobError("INVALID_STATE", `Milestone is ${ms.status}, not waiting for review`);
    return ms;
  }

  /** Admin approves a reviewed or held milestone: an attested override, then an immediate payout. */
  async approve(args: { milestoneId: string; adminId: string; note: string }): Promise<void> {
    const ms = await this.requireReviewable(args.milestoneId);
    const feeMinor = await this.treasury.feeShare(ms.jobId, ms.seq);
    const releaseId = newId("rel");
    await this.db.transaction(async (tx) => {
      assertTransition("MILESTONE", ms.status, "APPROVED_ADMIN");
      await tx.insert(approvals).values({ id: newId("apr"), entityType: "milestone", entityId: ms.id, requestedBy: "system:risk_engine", decidedBy: args.adminId, decision: "approve", note: args.note });
      await tx.insert(releases).values({ id: releaseId, milestoneId: ms.id, amountMinor: ms.amountMinor - ms.releasedMinor, feeMinor, decisionSource: "admin", status: "CREATED" });
      assertTransition("MILESTONE", "APPROVED_ADMIN", "RELEASING");
      await tx.update(milestones).set({ status: "RELEASING", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      await this.attestations.append(
        { jobId: ms.jobId, type: "decision", subjectId: ms.id, payload: { milestoneSeq: ms.seq, decision: "APPROVED_BY_ADMIN", previous: ms.status, adminId: args.adminId, note: args.note, releaseId } },
        tx,
      );
      await this.audit.append({ actor: `admin:${args.adminId}`, action: "milestone.admin_approved", entityType: "milestone", entityId: ms.id, payload: { note: args.note, releaseId } }, tx);
    });
    this.events.publish(`job:${ms.jobId}`, "decision.admin_approved", `Admin approved milestone ${ms.seq}: ${args.note}`);
    await this.pay(releaseId, ms, `admin:${args.adminId}`);
  }

  /** Admin rejects: the worker may resubmit. Confirmed fraud (held for a duplicate photo) lowers trust. */
  async reject(args: { milestoneId: string; adminId: string; reason: string }): Promise<void> {
    const ms = await this.requireReviewable(args.milestoneId);
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId));
    const [risk] = await this.db.select().from(riskAssessments).where(eq(riskAssessments.milestoneId, ms.id)).orderBy(desc(riskAssessments.createdAt)).limit(1);
    const fraud = ms.status === "HELD" && JSON.stringify(risk?.flagsJson ?? []).includes("DUP_IMAGE");
    const policy = await this.policy.active();
    let trust: number | null = null;
    await this.db.transaction(async (tx) => {
      assertTransition("MILESTONE", ms.status, "REJECTED");
      await tx.update(milestones).set({ status: "REJECTED", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      await tx.insert(approvals).values({ id: newId("apr"), entityType: "milestone", entityId: ms.id, requestedBy: "system:risk_engine", decidedBy: args.adminId, decision: "reject", note: args.reason });
      if (fraud && job.workerId) {
        trust = await this.reputation.apply(tx, { userId: job.workerId, delta: policy.trustDeltas.fraud_confirmed, reason: "fraud_confirmed", refType: "milestone", refId: ms.id });
      }
      await this.attestations.append(
        { jobId: ms.jobId, type: "decision", subjectId: ms.id, payload: { milestoneSeq: ms.seq, decision: "REJECTED_BY_ADMIN", adminId: args.adminId, reason: args.reason, fraudConfirmed: fraud } },
        tx,
      );
      await this.audit.append({ actor: `admin:${args.adminId}`, action: "milestone.rejected", entityType: "milestone", entityId: ms.id, payload: { reason: args.reason, fraud } }, tx);
    });
    this.events.publish(
      `job:${ms.jobId}`,
      "decision.rejected",
      `Admin rejected milestone ${ms.seq}: ${args.reason}.${fraud ? ` Fraud confirmed; worker trust is now ${trust}.` : ""} The worker can submit new proof.`,
    );
  }

  /** Revocation (spec §7.4): pending releases under the mandate pause; escrowed funds stay put. */
  async pauseForMandate(intentMandateId: string, reason: string): Promise<number> {
    const affected = await this.db
      .select({ ms: milestones })
      .from(milestones)
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .where(and(eq(jobs.intentMandateId, intentMandateId), inArray(milestones.status, [...PAUSABLE])));
    for (const { ms } of affected) {
      await this.db.transaction(async (tx) => {
        await tx.update(milestones).set({ status: "PAUSED_MANDATE", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
        await tx
          .update(releases)
          .set({ status: "CANCELLED", updatedAt: this.clock.now() })
          .where(and(eq(releases.milestoneId, ms.id), inArray(releases.status, ["CREATED", "WAITING_WINDOW"])));
        await this.attestations.append(
          { jobId: ms.jobId, type: "revocation", subjectId: intentMandateId, payload: { milestoneSeq: ms.seq, previous: ms.status, reason } },
          tx,
        );
      });
      this.events.publish(`job:${ms.jobId}`, "release.paused", `Mandate revoked: payout for milestone ${ms.seq} is paused. ${formatMinor(ms.amountMinor)} stays held for this job until the payer decides.`);
    }
    return affected.length;
  }

  /** Payer approves completion in person after a pause: attested, then G3 re-runs with a payer decision. */
  async resumePaused(args: { milestoneId: string; payerId: string }): Promise<void> {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, args.milestoneId));
    const [job] = ms ? await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId)) : [];
    if (!ms || !job) throw new JobError("NOT_FOUND", "Milestone not found");
    if (job.payerId !== args.payerId) throw new JobError("FORBIDDEN", "Only the payer can release a paused milestone");
    if (ms.status !== "PAUSED_MANDATE") throw new JobError("INVALID_STATE", "Milestone is not paused");
    const feeMinor = await this.treasury.feeShare(job.id, ms.seq);
    const releaseId = newId("rel");
    await this.db.transaction(async (tx) => {
      assertTransition("MILESTONE", ms.status, "RELEASING");
      await tx.update(milestones).set({ status: "RELEASING", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      await tx.insert(releases).values({ id: releaseId, milestoneId: ms.id, amountMinor: ms.amountMinor - ms.releasedMinor, feeMinor, decisionSource: "payer", status: "CREATED" });
      await tx.insert(approvals).values({ id: newId("apr"), entityType: "release", entityId: releaseId, requestedBy: "system:mandate_guard", decidedBy: args.payerId, decision: "approve", note: "Payer approved completion after the mandate was revoked" });
      await this.attestations.append(
        { jobId: job.id, type: "decision", subjectId: ms.id, payload: { milestoneSeq: ms.seq, decision: "APPROVED_BY_PAYER_AFTER_PAUSE", payerId: args.payerId, releaseId } },
        tx,
      );
    });
    await this.pay(releaseId, ms, `user:${args.payerId}`);
  }

  /** Payer cancels a paused milestone: its amount and fee share go back through a PayPal refund. */
  async cancelPaused(args: { milestoneId: string; payerId: string }): Promise<void> {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, args.milestoneId));
    const [job] = ms ? await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId)) : [];
    if (!ms || !job) throw new JobError("NOT_FOUND", "Milestone not found");
    if (job.payerId !== args.payerId) throw new JobError("FORBIDDEN", "Only the payer can cancel this milestone");
    if (ms.status !== "PAUSED_MANDATE") throw new JobError("INVALID_STATE", "Milestone is not paused");
    // The margin goes back with the work; PayPal's non-refundable costs stay earned, so cancelling never loses money.
    const kept = await this.treasury.nonRefundableFeeShare(job.id, ms.seq);
    const amount = ms.amountMinor - ms.releasedMinor + (await this.treasury.feeShare(job.id, ms.seq)) - kept;
    await this.treasury.retainFee({ jobId: job.id, refType: "milestone_cancel", refId: ms.id, feeMinor: kept });
    await this.treasury.refund({ jobId: job.id, amountMinor: amount, reason: `Milestone ${ms.seq} cancelled after the agent's mandate was revoked`, actor: `user:${args.payerId}` });
    await this.db.transaction(async (tx) => {
      assertTransition("MILESTONE", ms.status, "CANCELLED");
      await tx.update(milestones).set({ status: "CANCELLED", updatedAt: this.clock.now() }).where(eq(milestones.id, ms.id));
      await this.attestations.append({ jobId: job.id, type: "decision", subjectId: ms.id, payload: { milestoneSeq: ms.seq, decision: "CANCELLED_BY_PAYER", refundedMinor: amount } }, tx);
    });
  }
}
