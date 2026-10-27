// Disputes (spec §8.6, §7.5, journey J3): open -> evidence window -> compliance report + Arbiter proposal
// -> both accept (or admin resolves) -> gate G4 -> PayPal payout for the worker's share + PayPal refund
// for the payer's share. Invariants live here in code, never in prompts.
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import {
  apiClients,
  complianceReports,
  disputeEvidence,
  disputeProposals,
  disputes,
  jobs,
  mandateChecks,
  mandates,
  milestones,
  releases,
  riskAssessments,
  verifications,
} from "@/core/db/schema";
import { DisputeProposal, assertProposalInvariant, type AcceptanceCriterion, type FaultClass } from "@/core/contracts";
import { arbitrate, type ComplianceReport } from "@/core/agents/arbiter";
import { forModel } from "@/core/checks/image";
import { emitterFor, type EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { formatMinor } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import type { StoragePort } from "@/core/ports/storage";
import { assertTransition, canTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import type { MandateGuardService } from "./guard";
import { JobError } from "./jobs";
import { escrowCode, type LedgerService } from "./ledger";
import type { PolicyService } from "./policy";
import type { ReputationService } from "./reputation";
import type { TreasuryService } from "./treasury";

export const DISPUTABLE = ["SUBMITTED", "CHALLENGE_WINDOW", "REJECTED"] as const;

type DisputeRow = typeof disputes.$inferSelect;
type ProposalRow = typeof disputeProposals.$inferSelect;

export interface DisputeView {
  dispute: DisputeRow;
  evidence: (typeof disputeEvidence.$inferSelect)[];
  proposal: ProposalRow | null;
  report: ComplianceReport | null;
  disputedAmountMinor: number;
}

/**
 * Money split of a settled dispute (pure, property-tested): the worker's share plus the payer's refund always
 * equal the disputed amount, and the milestone's platform fee is split in the same proportion (the payer gets
 * back the fee that was never earned). Rounding never creates or loses a cent.
 */
export function disputeSettlementSplit(args: { disputedMinor: number; releaseToWorkerMinor: number; feeShareMinor: number }) {
  const { disputedMinor: disputed, releaseToWorkerMinor: release, feeShareMinor: fee } = args;
  const refundToPayerMinor = disputed - release;
  const releaseFeeMinor = disputed > 0 ? Math.round((fee * release) / disputed) : 0;
  const feeRefundMinor = fee - releaseFeeMinor;
  return { refundToPayerMinor, releaseFeeMinor, feeRefundMinor, refundTotalMinor: refundToPayerMinor + feeRefundMinor };
}

export class DisputeService {
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly llm: LlmPort,
    private readonly storage: StoragePort,
    private readonly treasury: TreasuryService,
    private readonly guard: MandateGuardService,
    private readonly ledger: LedgerService,
    private readonly attestations: AttestationService,
    private readonly audit: AuditService,
    private readonly reputation: ReputationService,
    private readonly policy: PolicyService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
    private readonly opts: { evidenceWindowSeconds: number },
  ) {}

  private async party(jobId: string, userId: string): Promise<{ job: typeof jobs.$inferSelect; side: "payer" | "worker" }> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job) throw new JobError("NOT_FOUND", "Job not found");
    if (job.payerId === userId) return { job, side: "payer" };
    if (job.workerId === userId) return { job, side: "worker" };
    throw new JobError("FORBIDDEN", "Only the payer or the worker can take part in this dispute");
  }

  /** Opening a dispute freezes the milestone: any waiting payout is cancelled before it fires. */
  async open(args: { milestoneId: string; userId: string; reason: string }): Promise<DisputeRow> {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, args.milestoneId));
    if (!ms) throw new JobError("NOT_FOUND", "Milestone not found");
    const { job, side } = await this.party(ms.jobId, args.userId);
    if (!(DISPUTABLE as readonly string[]).includes(ms.status)) {
      throw new JobError("INVALID_STATE", ms.status === "RELEASED" ? "This milestone has already been paid" : `A ${ms.status.toLowerCase().replace("_", " ")} milestone cannot be disputed`);
    }
    const id = newId("dsp");
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(milestones).where(eq(milestones.id, ms.id)).for("update");
      assertTransition("MILESTONE", fresh.status, "DISPUTED");
      await tx.update(milestones).set({ status: "DISPUTED", updatedAt: now }).where(eq(milestones.id, ms.id));
      await tx
        .update(releases)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(and(eq(releases.milestoneId, ms.id), inArray(releases.status, ["CREATED", "WAITING_WINDOW"])));
      const [j] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      if (canTransition("JOB", j.status, "DISPUTED")) await tx.update(jobs).set({ status: "DISPUTED", updatedAt: now }).where(eq(jobs.id, job.id));
      await tx.insert(disputes).values({
        id,
        milestoneId: ms.id,
        openedBy: args.userId,
        reason: args.reason,
        status: "EVIDENCE_WINDOW",
        deadlineAt: new Date(now.getTime() + this.opts.evidenceWindowSeconds * 1000),
      });
      await this.attestations.append(
        { jobId: job.id, type: "dispute", subjectId: id, payload: { event: "opened", milestoneSeq: ms.seq, openedBy: side, disputedAmountMinor: ms.amountMinor - ms.releasedMinor } },
        tx,
      );
      await this.audit.append({ actor: `user:${args.userId}`, action: "dispute.opened", entityType: "dispute", entityId: id, payload: { milestoneId: ms.id, reason: args.reason } }, tx);
    });
    this.events.publish(
      `job:${job.id}`,
      "dispute.opened",
      `${side === "payer" ? "Payer" : "Worker"} disputed milestone ${ms.seq}. The payout is frozen; both sides can add evidence for ${this.opts.evidenceWindowSeconds} seconds.`,
    );
    return (await this.db.select().from(disputes).where(eq(disputes.id, id)))[0];
  }

  async addEvidence(args: { disputeId: string; userId: string; text?: string; photo?: Uint8Array }): Promise<void> {
    const d = await this.get(args.disputeId);
    if (!d || d.dispute.status !== "EVIDENCE_WINDOW") throw new JobError("INVALID_STATE", "Evidence can only be added while the dispute is open for evidence");
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    const { job, side } = await this.party(ms.jobId, args.userId);
    const rows: (typeof disputeEvidence.$inferInsert)[] = [];
    if (args.text?.trim()) rows.push({ id: newId("dev"), disputeId: d.dispute.id, submitterId: args.userId, kind: "text", content: args.text.trim().slice(0, 2000) });
    if (args.photo?.length) {
      const evId = newId("dev");
      const key = `disputes/${d.dispute.id}/${evId}.jpg`;
      const sharp = (await import("sharp")).default;
      const { assertImageLimits, MAX_IMAGE_PIXELS } = await import("@/core/checks/image");
      let reencoded: Uint8Array;
      try {
        await assertImageLimits(args.photo);
        reencoded = new Uint8Array(await sharp(args.photo, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer());
      } catch {
        throw new JobError("INVALID_SPEC", "That file could not be read as an image");
      }
      await this.storage.put(key, reencoded, "image/jpeg");
      rows.push({ id: evId, disputeId: d.dispute.id, submitterId: args.userId, kind: "photo", storageKey: key });
    }
    if (!rows.length) throw new JobError("INVALID_SPEC", "Add a statement or a photo");
    await this.db.transaction(async (tx) => {
      await tx.insert(disputeEvidence).values(rows);
      for (const r of rows) {
        await this.attestations.append({ jobId: job.id, type: "dispute", subjectId: r.id!, payload: { event: "evidence", party: side, kind: r.kind } }, tx);
      }
    });
    this.events.publish(`job:${job.id}`, "dispute.evidence", `${side === "payer" ? "Payer" : "Worker"} added ${rows.map((r) => (r.kind === "photo" ? "a photo" : "a statement")).join(" and ")} to the dispute`);
  }

  /** Deterministic mandate-compliance report (spec §7.5): system truth the Arbiter cannot override. */
  async complianceReport(disputeId: string, jobId: string): Promise<ComplianceReport> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId));
    const id = newId("cr");
    let checks: ComplianceReport["checks"] = [];
    const violations: string[] = [];
    if (job.intentMandateId) {
      const rows = await this.db
        .select()
        .from(mandateChecks)
        .where(eq(mandateChecks.mandateId, job.intentMandateId))
        .orderBy(asc(mandateChecks.createdAt));
      const [intent] = await this.db.select().from(mandates).where(eq(mandates.id, job.intentMandateId));
      // Checks that concern this job: G1 creation (by nonce) and later gates on this job's releases.
      const jobReleases = (await this.db.select({ id: releases.id }).from(releases).innerJoin(milestones, eq(milestones.id, releases.milestoneId)).where(eq(milestones.jobId, jobId))).map((r) => r.id);
      const [jm] = await this.db.select().from(mandates).where(and(eq(mandates.type, "job"), eq(mandates.subjectId, jobId))).orderBy(asc(mandates.createdAt)).limit(1);
      const relevant = rows.filter((r) => (r.gate === "G1" && r.action === "create_job" && r.requestRef === jm?.nonce) || (r.requestRef !== null && jobReleases.includes(r.requestRef)));
      checks = relevant.map((r) => ({ gate: r.gate, action: r.action, result: r.result, reasonCodes: r.reasonCodes, at: r.createdAt.toISOString() }));
      const created = jm?.createdAt;
      if (intent?.revokedAt && created && created > intent.revokedAt) violations.push("job_created_after_revocation");
      if (intent?.notAfter && created && created > intent.notAfter) violations.push("job_created_after_expiry");
      if (!relevant.some((r) => r.gate === "G1" && r.result === "allow")) violations.push("no_allowing_g1_check_for_job");
      // An automatic payout that completed after the revocation would mean the guard was bypassed.
      if (intent?.revokedAt) {
        const paidAuto = await this.db
          .select({ updatedAt: releases.updatedAt })
          .from(releases)
          .innerJoin(milestones, eq(milestones.id, releases.milestoneId))
          .where(and(eq(milestones.jobId, jobId), eq(releases.decisionSource, "auto"), eq(releases.status, "PAYOUT_SUCCEEDED")));
        if (paidAuto.some((r) => r.updatedAt > intent.revokedAt!)) violations.push("auto_payout_after_revocation");
      }
    }
    const report: ComplianceReport = {
      id,
      jobId,
      agentInitiated: Boolean(job.intentMandateId),
      intentMandateId: job.intentMandateId,
      checks,
      violations,
      agentScopeViolation: violations.length > 0,
      summary: !job.intentMandateId
        ? "Direct job created and funded by the payer in person; no agent mandate applies."
        : violations.length
          ? `Out-of-mandate actions found: ${violations.join(", ")}.`
          : `Every agent action on this job passed the Mandate Guard (${checks.length} checks).`,
    };
    await this.db.insert(complianceReports).values({ id, disputeId, jobId, resultJson: report });
    return report;
  }

  /** Runs the Arbiter (window closed, or a party asked to proceed). Low confidence or rejection escalates. */
  async propose(disputeId: string): Promise<ProposalRow | null> {
    const d = await this.get(disputeId);
    if (!d || d.dispute.status !== "EVIDENCE_WINDOW") return null;
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId));
    const emit = emitterFor(this.events, `job:${job.id}`);
    const report = await this.complianceReport(disputeId, job.id);
    emit("agent.step", `Compliance report: ${report.summary}`);
    const [ver] = await this.db.select().from(verifications).where(eq(verifications.milestoneId, ms.id)).orderBy(desc(verifications.createdAt)).limit(1);
    const [risk] = await this.db.select().from(riskAssessments).where(eq(riskAssessments.milestoneId, ms.id)).orderBy(desc(riskAssessments.createdAt)).limit(1);
    const side = (uid: string) => (uid === job.payerId ? ("payer" as const) : ("worker" as const));
    const images = await Promise.all(
      d.evidence.filter((e) => e.kind === "photo" && e.storageKey).slice(0, 4).map(async (e) => ({ evidenceId: e.id, base64: await forModel(await this.storage.get(e.storageKey!)) })),
    );
    const { proposal, model } = await arbitrate(
      { db: this.db, llm: this.llm, emit },
      {
        disputeId,
        disputedAmountMinor: d.disputedAmountMinor,
        milestone: { seq: ms.seq, title: ms.title, criteria: (ms.criteriaJson as AcceptanceCriterion[]).map(({ id, text }) => ({ id, text })) },
        verification: ver?.resultJson ?? null,
        decision: risk?.cardJson ?? null,
        statements: d.evidence.filter((e) => e.kind === "text").map((e) => ({ evidenceId: e.id, party: side(e.submitterId), kind: e.kind, text: e.content ?? "" })),
        images,
        report,
        openedBy: side(d.dispute.openedBy),
        reason: d.dispute.reason,
      },
    );

    const now = this.clock.now();
    const proposalId = newId("dpr");
    await this.db.transaction(async (tx) => {
      if (!proposal) {
        assertTransition("DISPUTE", "EVIDENCE_WINDOW", "ESCALATED");
        await tx.update(disputes).set({ status: "ESCALATED", updatedAt: now }).where(eq(disputes.id, disputeId));
        return;
      }
      assertProposalInvariant(proposal, d.disputedAmountMinor);
      await tx.insert(disputeProposals).values({ id: proposalId, disputeId, proposalJson: proposal, confidence: proposal.confidence, status: proposal.requiresHuman ? "ESCALATED" : "PROPOSED" });
      const next = proposal.requiresHuman ? "ESCALATED" : "AI_PROPOSED";
      assertTransition("DISPUTE", "EVIDENCE_WINDOW", next);
      await tx.update(disputes).set({ status: next, updatedAt: now }).where(eq(disputes.id, disputeId));
      await this.attestations.append(
        {
          jobId: job.id,
          type: "dispute",
          subjectId: proposalId,
          payload: {
            event: "proposal",
            releaseToWorkerMinor: proposal.proposal.releaseToWorkerMinor,
            refundToPayerMinor: proposal.proposal.refundToPayerMinor,
            faultClass: proposal.liability.faultClass,
            bearer: proposal.liability.bearer,
            basis: proposal.liability.basis,
            complianceReportId: report.id,
            requiresHuman: proposal.requiresHuman,
            model,
          },
        },
        tx,
      );
    });
    if (!proposal) {
      emit("dispute.escalated", "The arbiter could not produce a valid proposal; an admin will decide.");
      return null;
    }
    emit(
      proposal.requiresHuman ? "dispute.escalated" : "dispute.proposed",
      `Arbiter proposes ${formatMinor(proposal.proposal.releaseToWorkerMinor)} to the worker and ${formatMinor(proposal.proposal.refundToPayerMinor)} back to the payer (${proposal.liability.faultClass.replaceAll("_", " ").toLowerCase()}).${proposal.requiresHuman ? " An admin must confirm." : " Both sides can accept or reject."}`,
    );
    if (proposal.requiresHuman) this.events.publish("admin", "admin.review", `Dispute ${disputeId} escalated to admin`);
    return (await this.db.select().from(disputeProposals).where(eq(disputeProposals.id, proposalId)))[0];
  }

  /** Lets a party skip the rest of the evidence window (demo friendliness; the window still bounds it). */
  async proposeNow(args: { disputeId: string; userId: string }) {
    const d = await this.get(args.disputeId);
    if (!d) throw new JobError("NOT_FOUND", "Dispute not found");
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    await this.party(ms.jobId, args.userId);
    return this.propose(args.disputeId);
  }

  async respond(args: { disputeId: string; userId: string; accept: boolean }): Promise<void> {
    const d = await this.get(args.disputeId);
    if (!d?.proposal || d.dispute.status !== "AI_PROPOSED") throw new JobError("INVALID_STATE", "There is no proposal waiting for a response");
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    const { job, side } = await this.party(ms.jobId, args.userId);
    const response = args.accept ? "accept" : "reject";
    const now = this.clock.now();
    const outcome = await this.db.transaction(async (tx): Promise<"waiting" | "accepted" | "escalated"> => {
      const [p] = await tx.select().from(disputeProposals).where(eq(disputeProposals.id, d.proposal!.id)).for("update");
      const patch = side === "payer" ? { payerResponse: response as "accept" | "reject" } : { workerResponse: response as "accept" | "reject" };
      await tx.update(disputeProposals).set({ ...patch, updatedAt: now }).where(eq(disputeProposals.id, p.id));
      const payer = side === "payer" ? response : p.payerResponse;
      const worker = side === "worker" ? response : p.workerResponse;
      await this.attestations.append({ jobId: job.id, type: "dispute", subjectId: p.id, payload: { event: "response", party: side, response } }, tx);
      if (payer === "reject" || worker === "reject") {
        assertTransition("DISPUTE", "AI_PROPOSED", "ESCALATED");
        await tx.update(disputes).set({ status: "ESCALATED", updatedAt: now }).where(eq(disputes.id, d.dispute.id));
        return "escalated";
      }
      if (payer === "accept" && worker === "accept") {
        assertTransition("DISPUTE", "AI_PROPOSED", "ACCEPTED_BOTH");
        await tx.update(disputes).set({ status: "ACCEPTED_BOTH", updatedAt: now }).where(eq(disputes.id, d.dispute.id));
        return "accepted";
      }
      return "waiting";
    });
    this.events.publish(`job:${job.id}`, `dispute.${side}_${response}`, `${side === "payer" ? "Payer" : "Worker"} ${args.accept ? "accepted" : "rejected"} the arbiter's proposal`);
    if (outcome === "escalated") this.events.publish(`job:${job.id}`, "dispute.escalated", "A side rejected the proposal; an admin will decide.");
    if (outcome === "accepted") {
      const p = DisputeProposal.parse(d.proposal.proposalJson);
      await this.execute(d.dispute.id, p.proposal.releaseToWorkerMinor, p.liability.faultClass, "both_parties");
    }
  }

  /** Admin decides an escalated dispute (attested; the admin's identity and reason are on the chain). */
  async adminResolve(args: { disputeId: string; adminId: string; releaseToWorkerMinor: number; faultClass: FaultClass; note: string }): Promise<void> {
    const d = await this.get(args.disputeId);
    if (!d || d.dispute.status !== "ESCALATED") throw new JobError("INVALID_STATE", "Only escalated disputes can be resolved by an admin");
    if (args.releaseToWorkerMinor < 0 || args.releaseToWorkerMinor > d.disputedAmountMinor) throw new JobError("INVALID_SPEC", "Release must be between zero and the disputed amount");
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    await this.db.transaction(async (tx) => {
      assertTransition("DISPUTE", "ESCALATED", "ADMIN_RESOLVED");
      await tx.update(disputes).set({ status: "ADMIN_RESOLVED", updatedAt: this.clock.now() }).where(eq(disputes.id, d.dispute.id));
      await this.attestations.append(
        { jobId: ms.jobId, type: "dispute", subjectId: d.dispute.id, payload: { event: "admin_resolved", adminId: args.adminId, releaseToWorkerMinor: args.releaseToWorkerMinor, faultClass: args.faultClass, note: args.note } },
        tx,
      );
      await this.audit.append({ actor: `admin:${args.adminId}`, action: "dispute.admin_resolved", entityType: "dispute", entityId: d.dispute.id, payload: { releaseToWorkerMinor: args.releaseToWorkerMinor, faultClass: args.faultClass } }, tx);
    });
    await this.execute(d.dispute.id, args.releaseToWorkerMinor, args.faultClass, "admin");
  }

  /** Gate G4, then Treasury: payout for the worker's share and refund (plus unearned fee) for the payer's. */
  private async execute(disputeId: string, releaseToWorkerMinor: number, faultClass: FaultClass, resolvedBy: "both_parties" | "admin"): Promise<void> {
    const d = (await this.get(disputeId))!;
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, d.dispute.milestoneId));
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, ms.jobId));
    const disputed = d.disputedAmountMinor;
    const feeShare = await this.treasury.feeShare(job.id, ms.seq);
    const { refundToPayerMinor, releaseFeeMinor: releaseFee } = disputeSettlementSplit({ disputedMinor: disputed, releaseToWorkerMinor, feeShareMinor: feeShare });
    const g4 = await this.guard.g4Settle({
      disputeId,
      jobId: job.id,
      milestoneSeq: ms.seq,
      disputedAmountMinor: disputed,
      releaseToWorkerMinor,
      refundToPayerMinor,
      escrowMinor: await this.ledger.balance(escrowCode(job.id)),
      resolvedBy,
    });
    if (g4.result !== "allow") {
      this.events.publish(`job:${job.id}`, "dispute.blocked", g4.message);
      throw new JobError("FORBIDDEN", g4.message);
    }

    if (releaseToWorkerMinor > 0) {
      const releaseId = newId("rel");
      await this.db.insert(releases).values({ id: releaseId, milestoneId: ms.id, amountMinor: releaseToWorkerMinor, feeMinor: releaseFee, decisionSource: "dispute", status: "CREATED" });
      await this.treasury.executeRelease(releaseId, `dispute:${disputeId}`);
    }
    // The payer gets the refunded share back plus the platform fee that was never earned on it.
    const refundTotal = refundToPayerMinor + (feeShare - releaseFee);
    if (refundTotal > 0) {
      await this.treasury.refund({
        jobId: job.id,
        amountMinor: refundTotal,
        reason: `Dispute on milestone ${ms.seq}: ${formatMinor(refundToPayerMinor)} refunded`,
        actor: `dispute:${disputeId}`,
        disputeId,
      });
    }

    const policy = await this.policy.active();
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(milestones).where(eq(milestones.id, ms.id)).for("update");
      if (canTransition("MILESTONE", fresh.status, "RESOLVED")) await tx.update(milestones).set({ status: "RESOLVED", updatedAt: now }).where(eq(milestones.id, ms.id));
      assertTransition("DISPUTE", d.dispute.status === "ADMIN_RESOLVED" ? "ADMIN_RESOLVED" : "ACCEPTED_BOTH", "EXECUTED");
      await tx
        .update(disputes)
        .set({ status: "EXECUTED", resolutionJson: { releaseToWorkerMinor, refundToPayerMinor, faultClass, resolvedBy }, updatedAt: now })
        .where(eq(disputes.id, disputeId));

      // Trust effects (spec §7.5).
      const deltas: { userId: string; delta: number; reason: string }[] = [];
      if (faultClass === "WORKER_NONPERFORMANCE" && job.workerId) deltas.push({ userId: job.workerId, delta: policy.trustDeltas.dispute_lost, reason: "dispute_lost" });
      if (faultClass === "WORKER_PARTIAL" && job.workerId) deltas.push({ userId: job.workerId, delta: Math.round(policy.trustDeltas.dispute_lost / 2), reason: "dispute_partial" });
      if (faultClass === "PAYER_UNSUPPORTED_CLAIM") {
        deltas.push({ userId: job.payerId, delta: policy.trustDeltas.dispute_lost, reason: "dispute_lost" });
        if (job.workerId) deltas.push({ userId: job.workerId, delta: policy.trustDeltas.dispute_won, reason: "dispute_won" });
      }
      for (const x of deltas) await this.reputation.apply(tx, { ...x, refType: "dispute", refId: disputeId });
      if (faultClass === "AGENT_SCOPE_VIOLATION" && job.createdBy.startsWith("api_client:")) {
        await tx.update(apiClients).set({ status: "suspended", updatedAt: now }).where(eq(apiClients.id, job.createdBy.slice("api_client:".length)));
      }

      // The job continues with its next milestone, or completes.
      const all = await tx.select().from(milestones).where(eq(milestones.jobId, job.id)).orderBy(asc(milestones.seq));
      const next = all.find((m) => m.seq > ms.seq && m.status === "PENDING");
      if (next) await tx.update(milestones).set({ status: "ACTIVE", activatedAt: now, updatedAt: now }).where(eq(milestones.id, next.id));
      const [j] = await tx.select().from(jobs).where(eq(jobs.id, job.id)).for("update");
      const done = all.every((m) => m.id === ms.id || ["RELEASED", "RESOLVED", "CANCELLED"].includes(m.status));
      const to = done ? "COMPLETED" : "IN_PROGRESS";
      if (j.status === "DISPUTED" && canTransition("JOB", j.status, to)) await tx.update(jobs).set({ status: to, updatedAt: now }).where(eq(jobs.id, job.id));

      await this.attestations.append(
        { jobId: job.id, type: "settlement", subjectId: disputeId, payload: { event: "dispute_settled", milestoneSeq: ms.seq, releaseToWorkerMinor, refundToPayerMinor, feeRefundedMinor: feeShare - releaseFee, faultClass, resolvedBy } },
        tx,
      );
    });
    this.events.publish(
      `job:${job.id}`,
      "dispute.executed",
      `Dispute settled: ${formatMinor(releaseToWorkerMinor)} paid to the worker and ${formatMinor(refundToPayerMinor)} refunded to the payer through PayPal.`,
    );
  }

  /** Disputes whose evidence window has closed get their Arbiter proposal (DB-driven, restart safe). */
  async processDueWindows(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const due = await this.db.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.status, "EVIDENCE_WINDOW"), lte(disputes.deadlineAt, this.clock.now())));
      for (const x of due) await this.propose(x.id).catch((err) => console.error("arbiter failed", x.id, err));
      return due.length;
    } finally {
      this.ticking = false;
    }
  }

  async get(disputeId: string): Promise<DisputeView | null> {
    const [dispute] = await this.db.select().from(disputes).where(eq(disputes.id, disputeId));
    if (!dispute) return null;
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, dispute.milestoneId));
    const evidence = await this.db.select().from(disputeEvidence).where(eq(disputeEvidence.disputeId, disputeId)).orderBy(asc(disputeEvidence.createdAt));
    const [proposal] = await this.db.select().from(disputeProposals).where(eq(disputeProposals.disputeId, disputeId)).orderBy(desc(disputeProposals.createdAt)).limit(1);
    const [report] = await this.db.select().from(complianceReports).where(eq(complianceReports.disputeId, disputeId)).orderBy(desc(complianceReports.createdAt)).limit(1);
    // Once settled, the disputed amount is what was split (the milestone's paid amount has since changed).
    const resolution = dispute.resolutionJson as { releaseToWorkerMinor: number; refundToPayerMinor: number } | null;
    return {
      dispute,
      evidence,
      proposal: proposal ?? null,
      report: (report?.resultJson as ComplianceReport) ?? null,
      disputedAmountMinor: resolution ? resolution.releaseToWorkerMinor + resolution.refundToPayerMinor : ms.amountMinor - ms.releasedMinor,
    };
  }

  async forJob(jobId: string): Promise<DisputeView[]> {
    const rows = await this.db
      .select({ id: disputes.id })
      .from(disputes)
      .innerJoin(milestones, eq(milestones.id, disputes.milestoneId))
      .where(eq(milestones.jobId, jobId))
      .orderBy(asc(disputes.createdAt));
    return (await Promise.all(rows.map((r) => this.get(r.id)))).filter((x): x is DisputeView => x !== null);
  }
}
