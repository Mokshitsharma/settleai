// Verification pipeline (spec §8.4–8.5): deterministic checks -> AI verification -> merge -> risk decision
// -> milestone transition (and a release in its challenge window for AUTO_RELEASE). Any failure degrades
// to human review; nothing here can move money.
import { and, avg, count, eq, gte, isNotNull, ne } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import { jobs, mandates, milestones, proofs, releases, riskAssessments, users, verifications } from "@/core/db/schema";
import type { AcceptanceCriterion, IntentMandatePayload, JobSpec } from "@/core/contracts";
import { verifyMilestone } from "@/core/agents/verification";
import { VERIFICATION_PROMPT_VERSION } from "@/core/agents/verification/prompt";
import { runDeterministicChecks, type ProofForChecks } from "@/core/checks/deterministic";
import { forModel, type ExifInfo } from "@/core/checks/image";
import type { EventHub } from "@/core/events/hub";
import { emitterFor } from "@/core/events/hub";
import { newId } from "@/core/ids";
import type { DecisionCard } from "@/core/policy/decision-card";
import { computeRisk } from "@/core/policy/risk";
import type { ClockPort } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import type { StoragePort } from "@/core/ports/storage";
import { assertTransition } from "@/core/state/machines";
import type { AttestationService } from "./attestations";
import type { AuditService } from "./audit";
import type { PolicyService } from "./policy";
import type { ProofService } from "./proofs";
import type { TreasuryService } from "./treasury";

export class VerificationService {
  constructor(
    private readonly db: Db,
    private readonly llm: LlmPort,
    private readonly storage: StoragePort,
    private readonly proofs: ProofService,
    private readonly policy: PolicyService,
    private readonly treasury: TreasuryService,
    private readonly attestations: AttestationService,
    private readonly audit: AuditService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
    private readonly opts: { baseChallengeWindowSeconds: number },
  ) {}

  /** Runs the full pipeline for a SUBMITTED milestone. Returns the Decision Card. */
  async run(milestoneId: string): Promise<DecisionCard | null> {
    const [ms0] = await this.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!ms0 || ms0.status !== "SUBMITTED") return null;
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, ms0.jobId));
    const emit = emitterFor(this.events, `job:${job.id}`);
    assertTransition("MILESTONE", "SUBMITTED", "VERIFYING");
    await this.db.update(milestones).set({ status: "VERIFYING", updatedAt: this.clock.now() }).where(eq(milestones.id, ms0.id));

    try {
      return await this.pipeline(ms0.id, job, emit);
    } catch (err) {
      // Graceful degradation (spec §8.1): any failure sends the milestone to a person.
      console.error("verification pipeline failed", err);
      await this.db.update(milestones).set({ status: "NEEDS_REVIEW", updatedAt: this.clock.now() }).where(eq(milestones.id, ms0.id));
      emit("agent.fallback", "Verification failed unexpectedly; sent to human review");
      return null;
    }
  }

  private async pipeline(milestoneId: string, job: typeof jobs.$inferSelect, emit: ReturnType<typeof emitterFor>): Promise<DecisionCard> {
    const [ms] = await this.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    const spec = job.specJson as JobSpec;
    const criteria = ms.criteriaJson as AcceptanceCriterion[];
    const policy = await this.policy.active();
    const now = this.clock.now();
    const round = await this.proofs.currentRound(ms.id);

    // 1. Deterministic checks.
    emit("agent.step", "Extracting EXIF and checking for duplicate photos");
    const prior = await this.db
      .select({ proofId: proofs.id, milestoneId: proofs.milestoneId, jobId: milestones.jobId, sha256: proofs.sha256, phash: proofs.phash })
      .from(proofs)
      .innerJoin(milestones, eq(milestones.id, proofs.milestoneId))
      .where(and(ne(proofs.milestoneId, ms.id), isNotNull(proofs.phash)));
    const forChecks: ProofForChecks[] = round.map((p) => ({
      id: p.id,
      kind: p.kind,
      sha256: p.sha256,
      phash: p.phash,
      sniffedMime: p.mime,
      declaredMime: (p.exifJson as { declaredMime?: string } | null)?.declaredMime ?? null,
      exif: p.kind === "photo" ? (p.exifJson as ExifInfo) : null,
      geo: p.kind === "geo" && p.geoLat !== null && p.geoLng !== null ? { lat: p.geoLat, lng: p.geoLng } : null,
      text: p.textContent,
    }));
    const det = runDeterministicChecks(forChecks, {
      milestone: { id: ms.id, dueAt: ms.dueAt, activatedAt: ms.activatedAt, criteria },
      jobLocation: spec.location ?? null,
      submittedAt: now,
      priorImages: prior,
      policy,
    });
    for (const f of det.flags) emit("agent.step", `${f.severity === "critical" ? "Flag" : "Note"}: ${f.code.replaceAll("_", " ").toLowerCase()} (${f.detail})`, { flag: f.code });
    for (const c of det.criteria) emit("agent.step", `Rule check ${c.criterionId}: ${c.verdict} (${c.rationale})`);

    // 2. AI verification on downscaled images and delimited text.
    const images = await Promise.all(
      round.filter((p) => p.kind === "photo" && p.storageKey).slice(0, 4).map(async (p) => ({ proofId: p.id, base64: await forModel(await this.storage.get(p.storageKey!)) })),
    );
    const texts = round.filter((p) => p.kind === "text" && p.textContent).map((p) => ({ proofId: p.id, text: p.textContent! }));
    const { result, model, latencyMs } = await verifyMilestone(
      { db: this.db, llm: this.llm, emit },
      {
        milestoneId: ms.id,
        criteria,
        images,
        texts,
        deterministic: det,
        job: { title: job.title, summary: spec.summary },
        metadata: { milestoneTitle: ms.title, dueAt: ms.dueAt.toISOString(), location: spec.location?.label ?? null, takenAt: det.takenAt ?? null },
      },
    );
    for (const c of result.criteria) emit("agent.step", `Criterion ${c.criterionId}: ${c.verdict}`);
    const verificationId = newId("ver");
    await this.db.transaction(async (tx) => {
      await tx.insert(verifications).values({
        id: verificationId,
        milestoneId: ms.id,
        resultJson: result,
        overall: result.overall,
        confidence: result.confidence,
        model,
        promptVersion: VERIFICATION_PROMPT_VERSION,
        latencyMs,
      });
      await this.attestations.append(
        {
          jobId: job.id,
          type: "verification",
          subjectId: verificationId,
          payload: {
            milestoneSeq: ms.seq,
            overall: result.overall,
            confidence: result.confidence,
            flags: result.deterministicFlags.map((f) => f.code),
            criteria: result.criteria.map((c) => ({ id: c.criterionId, verdict: c.verdict })),
            proofIds: round.map((p) => p.id),
            model,
          },
        },
        tx,
      );
    });

    // 3. Risk decision (deterministic, versioned policy).
    const [worker] = await this.db.select().from(users).where(eq(users.id, job.workerId!));
    const history = await this.history(job.payerId, worker.id, now);
    let mandateCaps: { maxAuto?: number; maxWindow?: number } = {};
    if (job.intentMandateId) {
      const [m] = await this.db.select().from(mandates).where(eq(mandates.id, job.intentMandateId));
      const p = m?.payloadJson as IntentMandatePayload | undefined;
      mandateCaps = { maxAuto: p?.conditions.maxAutoReleaseMinor, maxWindow: p?.conditions.maxChallengeWindowSeconds };
    }
    const risk = computeRisk({
      verification: result,
      amountMinor: ms.amountMinor - ms.releasedMinor,
      policy,
      now,
      worker: { trustScore: worker.trustScore, paypalEmailChangedAt: worker.paypalEmailChangedAt },
      history,
      mandateMaxAutoReleaseMinor: mandateCaps.maxAuto,
      baseChallengeWindowSeconds: this.opts.baseChallengeWindowSeconds,
      mandateMaxChallengeWindowSeconds: mandateCaps.maxWindow,
    });
    emit("agent.step", `Risk score ${risk.score}: ${risk.decision.replace("_", " ")}`, { decision: risk.decision, score: risk.score });

    const card: DecisionCard = {
      milestoneId: ms.id,
      decision: risk.decision,
      score: risk.score,
      policyVersion: policy.version,
      signals: risk.signals,
      reasons: risk.reasons,
      explanation: risk.explanation,
      verification: {
        overall: result.overall,
        confidence: result.confidence,
        injectionSuspected: result.injectionSuspected,
        summaryForHumans: result.summaryForHumans,
        deterministicFlags: result.deterministicFlags,
      },
      criteria: criteria.map((c) => {
        const v = result.criteria.find((x) => x.criterionId === c.id)!;
        return { criterionId: c.id, text: c.text, check: c.check, verdict: v.verdict, confidence: v.confidence, rationale: v.rationale, evidenceRefs: v.evidenceRefs };
      }),
      challengeWindowSeconds: risk.challengeWindowSeconds,
      model,
      verifiedAt: now.toISOString(),
    };

    const nextStatus = risk.decision === "AUTO_RELEASE" ? "APPROVED_AUTO" : risk.decision === "HOLD" ? "HELD" : "NEEDS_REVIEW";
    const amountMinor = ms.amountMinor - ms.releasedMinor;
    const feeMinor = await this.treasury.feeShare(job.id, ms.seq);
    await this.db.transaction(async (tx) => {
      const assessmentId = newId("risk");
      await tx.insert(riskAssessments).values({
        id: assessmentId,
        milestoneId: ms.id,
        verificationId,
        score: risk.score,
        flagsJson: result.deterministicFlags,
        decision: risk.decision,
        policyVersion: policy.version,
        explanation: risk.explanation,
        cardJson: card,
      });
      assertTransition("MILESTONE", "VERIFYING", nextStatus);
      await tx.update(milestones).set({ status: nextStatus, updatedAt: now }).where(eq(milestones.id, ms.id));
      await this.attestations.append(
        {
          jobId: job.id,
          type: "decision",
          subjectId: assessmentId,
          payload: { milestoneSeq: ms.seq, decision: risk.decision, score: risk.score, policyVersion: policy.version, signals: risk.signals.map((s) => s.code), reasons: risk.reasons },
        },
        tx,
      );
      if (risk.decision === "AUTO_RELEASE") {
        const releaseId = newId("rel");
        const challengeEndsAt = new Date(now.getTime() + risk.challengeWindowSeconds * 1000);
        await tx.insert(releases).values({ id: releaseId, milestoneId: ms.id, amountMinor, feeMinor, decisionSource: "auto", status: "WAITING_WINDOW", challengeEndsAt });
        assertTransition("MILESTONE", "APPROVED_AUTO", "CHALLENGE_WINDOW");
        await tx.update(milestones).set({ status: "CHALLENGE_WINDOW" }).where(eq(milestones.id, ms.id));
        await this.attestations.append(
          { jobId: job.id, type: "release", subjectId: releaseId, payload: { milestoneSeq: ms.seq, amountMinor, feeMinor, decisionSource: "auto", challengeEndsAt: challengeEndsAt.toISOString() } },
          tx,
        );
      }
      await this.audit.append(
        { actor: "system:risk_engine", action: `milestone.${risk.decision.toLowerCase()}`, entityType: "milestone", entityId: ms.id, payload: { score: risk.score, policyVersion: policy.version } },
        tx,
      );
    });
    emit(
      risk.decision === "AUTO_RELEASE" ? "decision.auto_release" : risk.decision === "HOLD" ? "decision.hold" : "decision.review",
      risk.explanation,
    );
    if (risk.decision !== "AUTO_RELEASE") this.events.publish("admin", "admin.review", `Milestone ${ms.seq} of "${job.title}" needs review: ${risk.decision}`);
    return card;
  }

  private async history(payerId: string, workerId: string, now: Date) {
    const paid = and(eq(releases.status, "PAYOUT_SUCCEEDED"), eq(jobs.workerId, workerId));
    const [pair] = await this.db
      .select({ n: count() })
      .from(releases)
      .innerJoin(milestones, eq(milestones.id, releases.milestoneId))
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .where(and(paid, eq(jobs.payerId, payerId)));
    const [stats] = await this.db
      .select({ avg: avg(releases.amountMinor) })
      .from(releases)
      .innerJoin(milestones, eq(milestones.id, releases.milestoneId))
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .where(paid);
    const [recent] = await this.db
      .select({ n: count() })
      .from(releases)
      .innerJoin(milestones, eq(milestones.id, releases.milestoneId))
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .where(and(paid, gte(releases.updatedAt, new Date(now.getTime() - 3600_000))));
    return {
      pairCompletedReleases: pair.n,
      workerAvgReleaseMinor: Math.round(Number(stats.avg ?? 0)),
      workerReleasesLastHour: recent.n,
      payerDisputeRate: 0, // disputes arrive in Phase 3 (T301)
    };
  }
}
