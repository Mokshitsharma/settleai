// Mandate Guard (spec §7.4): deterministic enforcement at G1 (create), G2 (fund / counterparty),
// G3 (release, immediately before the payout call). Runs after any LLM output and before any state change
// or money movement; there is no code path around it. Every evaluation is recorded; denials are attested.
import { and, desc, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { approvals, jobs, mandateChecks, mandates, milestones, releases, riskAssessments, verifications } from "@/core/db/schema";
import type { Category, Gate, GuardDecision, IntentMandatePayload, PaymentMandatePayload, ReasonCode } from "@/core/contracts";
import { distanceMeters, formatDistance } from "@/core/checks/geo";
import { newId } from "@/core/ids";
import { verifyEnvelope } from "@/core/mandates/envelope";
import { formatMinor } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import type { KeyService } from "./keys";
import type { MandateService } from "./mandates";

type MandateRow = typeof mandates.$inferSelect;

export interface G1Request {
  mandateId: string;
  clientId: string;
  category: Category;
  text: string;
  amountMinor: number;
  location?: { lat: number; lng: number };
  requestNonce?: string;
  dryRun?: boolean;
}

const CATEGORY_LABEL: Record<string, string> = { delivery: "delivery", digital_deliverable: "digital work", onsite_service: "on-site services" };

export class MandateGuardService {
  constructor(
    private readonly db: Db,
    private readonly keys: KeyService,
    private readonly mandates: MandateService,
    private readonly attestations: AttestationService,
    private readonly audit: AuditService,
    private readonly clock: ClockPort,
  ) {}

  /** Signature, validity window and revocation: checked at every gate. */
  private async basics(t: DbOrTx, m: MandateRow | undefined): Promise<{ codes: ReasonCode[]; reasons: string[] }> {
    const codes: ReasonCode[] = [];
    const reasons: string[] = [];
    if (!m) return { codes: ["MANDATE_CHAIN_INVALID"], reasons: ["the mandate does not exist"] };
    const envelope = { payload: m.payloadJson, payloadHash: m.payloadHash, signatures: m.signaturesJson };
    const check = await verifyEnvelope(envelope, (kid) => this.keys.resolve(kid, t));
    if (!check.ok) {
      codes.push("MANDATE_SIGNATURE_INVALID");
      reasons.push(`its signature does not verify (${check.problems[0]})`);
    }
    const now = this.clock.now().getTime();
    if (m.notBefore && now < m.notBefore.getTime()) {
      codes.push("MANDATE_NOT_YET_VALID");
      reasons.push("it is not valid yet");
    }
    if (m.notAfter && now >= m.notAfter.getTime()) {
      codes.push("MANDATE_EXPIRED");
      reasons.push(`it expired on ${m.notAfter.toISOString()}`);
    }
    if (m.status === "revoked") {
      codes.push("MANDATE_REVOKED");
      reasons.push("it was revoked by its owner");
    }
    return { codes, reasons };
  }

  private async record(
    t: DbOrTx,
    args: { mandateId: string; gate: Gate; action: string; decision: GuardDecision; requestRef?: string; chainJobId: string },
  ): Promise<void> {
    await t.insert(mandateChecks).values({
      id: newId("mchk"),
      mandateId: args.mandateId,
      gate: args.gate,
      action: args.action,
      result: args.decision.result,
      reasonCodes: args.decision.reasonCodes,
      message: args.decision.message,
      requestRef: args.requestRef ?? null,
    });
    if (args.decision.result !== "allow") {
      await this.attestations.append(
        {
          jobId: args.chainJobId,
          type: "denial",
          subjectId: args.mandateId,
          payload: { gate: args.gate, action: args.action, result: args.decision.result, reasonCodes: args.decision.reasonCodes, message: args.decision.message },
        },
        t,
      );
      await this.audit.append(
        { actor: "system:mandate_guard", action: `guard.${args.decision.result}`, entityType: "mandate", entityId: args.mandateId, payload: { gate: args.gate, action: args.action, codes: args.decision.reasonCodes } },
        t,
      );
    }
  }

  /**
   * G1: an agent asks to create a job. On ALLOW (and not a dry run) the spend is reserved in the same
   * transaction, so concurrent requests cannot exceed the caps.
   */
  async g1CreateJob(req: G1Request, tx?: DbOrTx): Promise<GuardDecision> {
    const run = async (t: DbOrTx): Promise<GuardDecision> => {
      const [m] = await t.select().from(mandates).where(eq(mandates.id, req.mandateId));
      const { codes, reasons } = await this.basics(t, m);
      const p = m?.payloadJson as IntentMandatePayload | undefined;
      if (m && (m.type !== "intent" || p?.agent.clientId !== req.clientId)) {
        codes.push("MANDATE_CHAIN_INVALID");
        reasons.push("it was not issued to this agent");
      }
      if (p) {
        if (!p.scope.categories.includes(req.category)) {
          codes.push("MANDATE_SCOPE_VIOLATION");
          reasons.push(`the category ${CATEGORY_LABEL[req.category] ?? req.category} is not allowed (allowed: ${p.scope.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")})`);
        }
        const lower = req.text.toLowerCase();
        const banned = (p.scope.prohibitedKeywords ?? []).filter((k) => lower.includes(k.toLowerCase()));
        if (banned.length) {
          if (!codes.includes("MANDATE_SCOPE_VIOLATION")) codes.push("MANDATE_SCOPE_VIOLATION");
          reasons.push(`the request mentions prohibited terms (${banned.join(", ")})`);
        }
        // A dry run before scoping may not know the location yet; the final check always requires it.
        if (p.scope.geoFence && (req.location || !req.dryRun)) {
          if (!req.location) {
            codes.push("MANDATE_GEO_VIOLATION");
            reasons.push(`no job location was given and the mandate only allows work within ${p.scope.geoFence.radiusKm} km of ${p.scope.geoFence.label ?? "its area"}`);
          } else {
            const d = distanceMeters(req.location, p.scope.geoFence);
            if (d > p.scope.geoFence.radiusKm * 1000) {
              codes.push("MANDATE_GEO_VIOLATION");
              reasons.push(`the job is ${formatDistance(d)} from ${p.scope.geoFence.label ?? "the allowed area"} (limit ${p.scope.geoFence.radiusKm} km)`);
            }
          }
        }
        if (req.requestNonce) {
          const [dup] = await t
            .select({ id: mandates.id })
            .from(mandates)
            .where(and(eq(mandates.type, "job"), eq(mandates.nonce, req.requestNonce)));
          if (dup) {
            codes.push("MANDATE_REPLAY");
            reasons.push("this request was already used to create a job");
          }
        }
      }

      if (!codes.length && p) {
        if (req.dryRun) {
          const view = await this.mandates.get(req.mandateId, t);
          if (req.amountMinor > p.scope.maxPerJobMinor) codes.push("MANDATE_CAP_EXCEEDED");
          else if (view && req.amountMinor > view.remainingMinor) codes.push("MANDATE_CAP_EXCEEDED");
          if (view && view.jobsToday + 1 > p.scope.maxJobsPerDay) codes.push("MANDATE_RATE_EXCEEDED");
          if (codes.length) reasons.push(capReason(req.amountMinor, p, view?.remainingMinor));
        } else {
          const r = await this.mandates.reserveSpend(t, { mandateId: req.mandateId, amountMinor: req.amountMinor, countsAsJob: true });
          if (!r.ok) {
            codes.push(...r.codes);
            reasons.push(capReason(req.amountMinor, p));
          }
        }
      } else if (p && req.amountMinor > p.scope.maxPerJobMinor) {
        codes.push("MANDATE_CAP_EXCEEDED");
        reasons.push(capReason(req.amountMinor, p));
      }

      const decision: GuardDecision = codes.length
        ? { result: "deny", gate: "G1", reasonCodes: [...new Set(codes)], message: denialMessage(reasons, p) }
        : {
            result: "allow",
            gate: "G1",
            reasonCodes: [],
            message: `Allowed: ${CATEGORY_LABEL[req.category]} job for ${formatMinor(req.amountMinor)} is inside ${p!.agent.name}'s mandate.`,
          };
      await this.record(t, {
        mandateId: req.mandateId,
        gate: "G1",
        action: req.dryRun ? "check_action" : "create_job",
        decision,
        requestRef: req.requestNonce,
        chainJobId: `intent:${req.mandateId}`,
      });
      return decision;
    };
    return tx ? run(tx) : this.db.transaction(run);
  }

  /** G4: dispute settlement, immediately before the payout and refund calls. */
  async g4Settle(req: G4Request, t: DbOrTx = this.db): Promise<GuardDecision> {
    const [job] = await t.select().from(jobs).where(eq(jobs.id, req.jobId));
    const [pm] = await t
      .select()
      .from(mandates)
      .where(and(eq(mandates.type, "payment"), eq(mandates.subjectId, req.jobId)))
      .orderBy(desc(mandates.createdAt))
      .limit(1);
    let decision: GuardDecision;
    if (pm) {
      const check = await verifyEnvelope({ payload: pm.payloadJson, payloadHash: pm.payloadHash, signatures: pm.signaturesJson }, (kid) => this.keys.resolve(kid, t));
      const cond = (pm.payloadJson as PaymentMandatePayload).settlementConditions.find((c) => c.milestoneSeq === req.milestoneSeq);
      decision = check.ok
        ? evaluateG4(req, cond)
        : { result: "deny", gate: "G4", reasonCodes: ["MANDATE_SIGNATURE_INVALID"], message: "Settlement blocked: the Payment Mandate signature does not verify. Funds stay in escrow." };
    } else {
      decision = evaluateG4(req, undefined);
    }
    await this.record(t, { mandateId: job.intentMandateId ?? pm?.id ?? `job:${req.jobId}`, gate: "G4", action: "settle_dispute", decision, requestRef: req.disputeId, chainJobId: req.jobId });
    return decision;
  }

  /** G2 (funding): lineage and validity for agent-created jobs. The payer clicking Fund is the human approval. */
  async g2Fund(args: { jobId: string; humanApproved: boolean }, t: DbOrTx = this.db): Promise<GuardDecision> {
    const [job] = await t.select().from(jobs).where(eq(jobs.id, args.jobId));
    if (!job?.intentMandateId) return { result: "allow", gate: "G2", reasonCodes: [], message: "Direct job: funded by the payer in person." };
    const [m] = await t.select().from(mandates).where(eq(mandates.id, job.intentMandateId));
    const { codes, reasons } = await this.basics(t, m);
    const p = m?.payloadJson as IntentMandatePayload | undefined;
    let result: GuardDecision["result"] = codes.length ? "deny" : "allow";
    if (!codes.length && p && job.totalMinor > p.conditions.stepUpAboveMinor && !args.humanApproved) {
      codes.push("STEP_UP_REQUIRED");
      reasons.push(`${formatMinor(job.totalMinor)} is above the ${formatMinor(p.conditions.stepUpAboveMinor)} approval threshold`);
      result = "step_up";
    }
    const decision: GuardDecision = {
      result,
      gate: "G2",
      reasonCodes: codes,
      message: codes.length ? denialMessage(reasons, p) : `Allowed: funding approved by the payer within ${p?.agent.name}'s mandate.`,
    };
    await this.record(t, { mandateId: job.intentMandateId, gate: "G2", action: "fund", decision, chainJobId: job.id });
    return decision;
  }

  /** G2 (counterparty): the accepting worker must meet the mandate's trust floor and have a PayPal email. */
  async g2Counterparty(args: { jobId: string; worker: { id: string; trustScore: number; paypalEmail: string | null } }, t: DbOrTx = this.db): Promise<GuardDecision> {
    const [job] = await t.select().from(jobs).where(eq(jobs.id, args.jobId));
    if (!job?.intentMandateId) return { result: "allow", gate: "G2", reasonCodes: [], message: "Direct job." };
    const [m] = await t.select().from(mandates).where(eq(mandates.id, job.intentMandateId));
    const p = m?.payloadJson as IntentMandatePayload;
    const reasons: string[] = [];
    if (args.worker.trustScore < p.scope.counterparty.minTrustScore) reasons.push(`your trust score ${args.worker.trustScore} is below the required ${p.scope.counterparty.minTrustScore}`);
    if (p.scope.counterparty.requirePayPalEmail && !args.worker.paypalEmail) reasons.push("a PayPal email is required");
    const decision: GuardDecision = reasons.length
      ? { result: "deny", gate: "G2", reasonCodes: ["MANDATE_COUNTERPARTY_REJECTED"], message: `This job's mandate does not allow you to take it: ${reasons.join("; ")}.` }
      : { result: "allow", gate: "G2", reasonCodes: [], message: "Worker meets the mandate's counterparty rules." };
    await this.record(t, { mandateId: job.intentMandateId, gate: "G2", action: "accept", decision, chainJobId: job.id });
    return decision;
  }

  /**
   * G3: immediately before the payout call. Settlement conditions from the Payment Mandate must hold:
   * verification passed (or a person approved), risk is not HOLD (or a person approved), and the
   * Intent Mandate is still active (or the payer approved completion in person).
   */
  async g3Release(args: { releaseId: string }, t: DbOrTx = this.db): Promise<GuardDecision> {
    const [rel] = await t.select().from(releases).where(eq(releases.id, args.releaseId));
    const [ms] = await t.select().from(milestones).where(eq(milestones.id, rel.milestoneId));
    const [job] = await t.select().from(jobs).where(eq(jobs.id, ms.jobId));
    const codes: ReasonCode[] = [];
    const reasons: string[] = [];
    const humanDecision = rel.decisionSource !== "auto";

    // Lineage: the job's Payment Mandate must exist, verify, and cover this milestone and amount.
    const [pm] = await t
      .select()
      .from(mandates)
      .where(and(eq(mandates.type, "payment"), eq(mandates.subjectId, job.id)))
      .orderBy(desc(mandates.createdAt))
      .limit(1);
    if (!pm) {
      codes.push("MANDATE_CHAIN_INVALID");
      reasons.push("the job has no Payment Mandate");
    } else {
      const check = await verifyEnvelope({ payload: pm.payloadJson, payloadHash: pm.payloadHash, signatures: pm.signaturesJson }, (kid) => this.keys.resolve(kid, t));
      const cond = (pm.payloadJson as PaymentMandatePayload).settlementConditions.find((c) => c.milestoneSeq === ms.seq);
      if (!check.ok) {
        codes.push("MANDATE_SIGNATURE_INVALID");
        reasons.push("the Payment Mandate signature does not verify");
      } else if (!cond || rel.amountMinor > cond.amountMinor) {
        codes.push("MANDATE_CHAIN_INVALID");
        reasons.push(`the release of ${formatMinor(rel.amountMinor)} is not covered by the Payment Mandate`);
      }
    }

    if (!humanDecision) {
      const [v] = await t.select().from(verifications).where(eq(verifications.milestoneId, ms.id)).orderBy(desc(verifications.createdAt)).limit(1);
      const [r] = await t.select().from(riskAssessments).where(eq(riskAssessments.milestoneId, ms.id)).orderBy(desc(riskAssessments.createdAt)).limit(1);
      if (v?.overall !== "pass") {
        codes.push("RELEASE_CONDITION_UNMET");
        reasons.push("verification has not passed");
      }
      if (!r || r.decision === "HOLD") {
        codes.push("RELEASE_CONDITION_UNMET");
        reasons.push("the risk decision is HOLD");
      }
    }

    let mandateId = pm?.id ?? `job:${job.id}`;
    if (job.intentMandateId) {
      mandateId = job.intentMandateId;
      const [m] = await t.select().from(mandates).where(eq(mandates.id, job.intentMandateId));
      const basics = await this.basics(t, m);
      // A payer approval or a dispute settlement both parties (or an admin) agreed to is a human decision.
      const payerApproved = rel.decisionSource === "payer" || rel.decisionSource === "dispute";
      if (basics.codes.length && !payerApproved) {
        codes.push(...basics.codes);
        reasons.push(...basics.reasons.map((r) => `the agent's mandate is no longer valid: ${r}`));
      }
      const p = m?.payloadJson as IntentMandatePayload | undefined;
      if (p && !humanDecision && rel.amountMinor > p.conditions.maxAutoReleaseMinor) {
        const [approved] = await t
          .select()
          .from(approvals)
          .where(and(eq(approvals.entityType, "release"), eq(approvals.entityId, rel.id), eq(approvals.decision, "approve")));
        if (!approved) {
          codes.push("STEP_UP_REQUIRED");
          reasons.push(`${formatMinor(rel.amountMinor)} is above the ${formatMinor(p.conditions.maxAutoReleaseMinor)} automatic release limit`);
        }
      }
    }

    const unique = [...new Set(codes)];
    const decision: GuardDecision = unique.length
      ? { result: unique.includes("STEP_UP_REQUIRED") && unique.length === 1 ? "step_up" : "deny", gate: "G3", reasonCodes: unique, message: `Payout blocked: ${reasons.join("; ")}. Funds stay in escrow.` }
      : { result: "allow", gate: "G3", reasonCodes: [], message: "Settlement conditions met." };
    await this.record(t, { mandateId, gate: "G3", action: "release", decision, requestRef: rel.id, chainJobId: job.id });
    return decision;
  }
}

export interface G4Request {
  disputeId: string;
  jobId: string;
  milestoneSeq: number;
  disputedAmountMinor: number;
  releaseToWorkerMinor: number;
  refundToPayerMinor: number;
  escrowMinor: number;
  resolvedBy: "both_parties" | "admin";
}

/** G4 (dispute settlement): pure checks; the service records the decision. */
export function evaluateG4(req: G4Request, paymentCondition: { amountMinor: number } | undefined): GuardDecision {
  const reasons: string[] = [];
  const codes: ReasonCode[] = [];
  if (!paymentCondition) {
    codes.push("MANDATE_CHAIN_INVALID");
    reasons.push("the milestone is not covered by the job's Payment Mandate");
  }
  if (req.releaseToWorkerMinor < 0 || req.refundToPayerMinor < 0 || req.releaseToWorkerMinor + req.refundToPayerMinor !== req.disputedAmountMinor) {
    codes.push("RELEASE_CONDITION_UNMET");
    reasons.push("release plus refund must equal the disputed amount");
  }
  if (paymentCondition && req.disputedAmountMinor > paymentCondition.amountMinor) {
    codes.push("RELEASE_CONDITION_UNMET");
    reasons.push("the disputed amount exceeds the milestone's settlement condition");
  }
  if (req.disputedAmountMinor > req.escrowMinor) {
    codes.push("RELEASE_CONDITION_UNMET");
    reasons.push("escrow does not cover the disputed amount");
  }
  return codes.length
    ? { result: "deny", gate: "G4", reasonCodes: [...new Set(codes)], message: `Settlement blocked: ${reasons.join("; ")}. Funds stay in escrow.` }
    : { result: "allow", gate: "G4", reasonCodes: [], message: `Settlement allowed: resolved by ${req.resolvedBy === "admin" ? "an admin" : "both parties"}.` };
}

function capReason(amountMinor: number, p: IntentMandatePayload, remainingMinor?: number): string {
  if (amountMinor > p.scope.maxPerJobMinor) return `${formatMinor(amountMinor)} exceeds the ${formatMinor(p.scope.maxPerJobMinor)} per-job limit`;
  if (remainingMinor !== undefined && amountMinor > remainingMinor) return `only ${formatMinor(remainingMinor)} of the ${formatMinor(p.scope.maxTotalMinor)} budget remains`;
  return `the ${formatMinor(p.scope.maxTotalMinor)} total budget or ${p.scope.maxJobsPerDay}-jobs-a-day limit would be exceeded`;
}

/** Appendix E style: what was violated, that nothing happened, and what the agent may do instead. */
function denialMessage(reasons: string[], p?: IntentMandatePayload): string {
  const instead = p
    ? ` The agent may retry with a ${p.scope.categories.map((c) => CATEGORY_LABEL[c] ?? c).join(" or ")} job up to ${formatMinor(p.scope.maxPerJobMinor)}.`
    : "";
  return `Request denied: ${reasons.join("; ")}. Nothing was created and no money moved.${instead}`;
}
