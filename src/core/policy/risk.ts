// Risk engine (spec §8.5): deterministic, versioned policy. An LLM never decides; this function does.
import type { Policy, RiskDecision, SignalCode, VerificationResult } from "@/core/contracts";
import { formatMinor } from "@/core/money";

export interface RiskInput {
  verification: VerificationResult;
  amountMinor: number;
  policy: Policy;
  now: Date;
  worker: { trustScore: number; paypalEmailChangedAt: Date | null };
  history: {
    pairCompletedReleases: number; // previous paid milestones between this payer and worker
    workerAvgReleaseMinor: number; // 0 when no history
    workerReleasesLastHour: number;
    payerDisputeRate: number; // 0..1
  };
  /** Extra cap from an agent's Intent Mandate (conditions.maxAutoReleaseMinor). */
  mandateMaxAutoReleaseMinor?: number;
  baseChallengeWindowSeconds: number; // from config (demo uses 15)
  mandateMaxChallengeWindowSeconds?: number;
}

export interface Signal {
  code: SignalCode | "ABOVE_AUTO_RELEASE_LIMIT";
  points: number;
  detail: string;
}

export interface RiskOutcome {
  score: number;
  decision: RiskDecision;
  signals: Signal[];
  reasons: string[]; // why this decision, in plain English
  challengeWindowSeconds: number;
  explanation: string;
}

export function computeRisk(input: RiskInput): RiskOutcome {
  const { verification: v, policy: p } = input;
  const w = p.weights;
  const signals: Signal[] = [];
  const add = (code: Signal["code"], points: number, detail: string) => {
    if (points !== 0) signals.push({ code, points: Math.round(points), detail });
  };

  if (v.confidence < p.autoReleaseMinConfidence) {
    const shortfall = Math.min(1, (p.autoReleaseMinConfidence - v.confidence) / 0.25);
    add("LOW_VERIFICATION_CONFIDENCE", w.LOW_VERIFICATION_CONFIDENCE * shortfall, `Verification confidence ${Math.round(v.confidence * 100)}%`);
  }
  for (const c of v.criteria) {
    if (c.verdict === "unclear") add("CRITERION_UNCLEAR", w.CRITERION_UNCLEAR, `Criterion ${c.criterionId} could not be confirmed`);
    if (c.verdict === "fail") add("CRITERION_FAIL", w.CRITERION_FAIL, `Criterion ${c.criterionId} failed: ${c.rationale}`);
  }
  const flagSignal: Record<string, SignalCode> = {
    DUP_IMAGE: "DUP_IMAGE",
    GPS_MISMATCH: "GPS_MISMATCH",
    EXIF_TIME_MISMATCH: "EXIF_TIME_MISMATCH",
    NO_EXIF: "NO_EXIF",
    INJECTION_SUSPECTED: "INJECTION_SUSPECTED",
  };
  const seen = new Set<string>();
  for (const f of v.deterministicFlags) {
    const code = flagSignal[f.code];
    if (code && !seen.has(code)) {
      seen.add(code);
      add(code, w[code], f.detail);
    }
  }
  if (input.history.workerAvgReleaseMinor > 0 && input.amountMinor > 3 * input.history.workerAvgReleaseMinor) {
    add("AMOUNT_ANOMALY", w.AMOUNT_ANOMALY, `${formatMinor(input.amountMinor)} is more than 3x this worker's average payout`);
  }
  if (input.worker.trustScore < 40) add("LOW_TRUST", w.LOW_TRUST, `Worker trust score ${input.worker.trustScore}`);
  if (input.worker.trustScore > 80) add("HIGH_TRUST", w.HIGH_TRUST, `Worker trust score ${input.worker.trustScore}`);
  if (input.history.pairCompletedReleases === 0) add("FIRST_TIME_PAIR", w.FIRST_TIME_PAIR, "First job between this payer and worker");
  if (input.worker.paypalEmailChangedAt && input.now.getTime() - input.worker.paypalEmailChangedAt.getTime() < p.payoutDestRecentHours * 3600_000) {
    add("PAYOUT_DEST_RECENT", w.PAYOUT_DEST_RECENT, `PayPal payout email changed in the last ${p.payoutDestRecentHours} hours`);
  }
  if (input.history.workerReleasesLastHour >= 3) add("VELOCITY", w.VELOCITY, `${input.history.workerReleasesLastHour} payouts to this worker in the last hour`);
  if (input.history.payerDisputeRate > 0.3) add("PAYER_DISPUTE_RATE", w.PAYER_DISPUTE_RATE, `Payer disputes ${Math.round(input.history.payerDisputeRate * 100)}% of milestones`);

  const score = Math.max(0, Math.min(100, signals.reduce((a, s) => a + s.points, 0)));
  const flagCodes = v.deterministicFlags.map((f) => f.code);
  const reasons: string[] = [];
  let decision: RiskDecision = "AUTO_RELEASE";

  const hardHold = flagCodes.filter((c) => p.hardHoldFlags.includes(c));
  if (hardHold.length) reasons.push(`Hard hold: ${hardHold.join(", ")}`);
  if (score >= p.holdAt) reasons.push(`Score ${score} is at or above the hold threshold ${p.holdAt}`);
  if (hardHold.length || score >= p.holdAt) {
    decision = "HOLD";
  } else {
    const limit = Math.min(p.maxAutoReleaseAmountMinor, input.mandateMaxAutoReleaseMinor ?? Number.MAX_SAFE_INTEGER);
    if (v.overall !== "pass") reasons.push(`Verification is ${v.overall}, not pass`);
    if (score >= p.reviewAt) reasons.push(`Score ${score} is at or above the review threshold ${p.reviewAt}`);
    if (v.injectionSuspected || flagCodes.some((c) => p.forceReviewFlags.includes(c))) reasons.push("Evidence contains instruction-like text");
    if (input.amountMinor > limit) {
      reasons.push(`${formatMinor(input.amountMinor)} is above the automatic release limit of ${formatMinor(limit)}`);
      signals.push({ code: "ABOVE_AUTO_RELEASE_LIMIT", points: 0, detail: `Auto-release limit ${formatMinor(limit)}` });
    }
    if (reasons.length) decision = "HUMAN_REVIEW";
  }

  // Riskier releases wait longer; trusted workers wait less. Capped by the agent's mandate.
  const factor = (1 + score / 50) * (input.worker.trustScore > 80 ? 0.5 : 1);
  let challengeWindowSeconds = Math.round(input.baseChallengeWindowSeconds * factor);
  if (input.mandateMaxChallengeWindowSeconds) challengeWindowSeconds = Math.min(challengeWindowSeconds, input.mandateMaxChallengeWindowSeconds);

  return { score, decision, signals, reasons, challengeWindowSeconds, explanation: explain(decision, score, v, signals, reasons, challengeWindowSeconds) };
}

function humanDuration(s: number): string {
  if (s < 120) return `${s}-second`;
  if (s < 7200) return `${Math.round(s / 60)}-minute`;
  return `${Math.round(s / 3600)}-hour`;
}

/** "an 18-second", "a 15-second": numbers read aloud as eight, eleven or eighteen take "an". */
function article(phrase: string): string {
  return `${/^(8|11|18)/.test(phrase) ? "an" : "a"} ${phrase}`;
}

function explain(decision: RiskDecision, score: number, v: VerificationResult, signals: Signal[], reasons: string[], window: number): string {
  const passed = v.criteria.filter((c) => c.verdict === "pass").length;
  const top = [...signals].filter((s) => s.points > 0).sort((a, b) => b.points - a.points)[0];
  if (decision === "AUTO_RELEASE") {
    return `Released automatically: ${passed} of ${v.criteria.length} criteria verified with ${Math.round(v.confidence * 100)}% confidence and a risk score of ${score}${top ? ` (${top.detail.toLowerCase()})` : ""}. The payer has ${article(humanDuration(window))} window to dispute before PayPal pays out.`;
  }
  if (decision === "HOLD") {
    const critical = v.deterministicFlags.find((f) => f.severity === "critical");
    return `Held: ${critical ? critical.detail : reasons[0]}. No money moves until an admin reviews it.`;
  }
  return `Needs a person: ${reasons.join("; ")}. Risk score ${score}.`;
}
