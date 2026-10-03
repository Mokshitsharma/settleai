import { describe, expect, it } from "vitest";
import defaultPolicy from "@/core/policy/default.json";
import { Policy, type VerificationResult } from "@/core/contracts";
import { mergeVerification } from "@/core/agents/verification";
import { computeRisk, type RiskInput } from "@/core/policy/risk";

const policy = Policy.parse(defaultPolicy);

const pass: VerificationResult = {
  milestoneId: "ms_1",
  overall: "pass",
  confidence: 0.92,
  criteria: [
    { criterionId: "c1", verdict: "pass", confidence: 0.92, evidenceRefs: ["p1"], rationale: "ok" },
    { criterionId: "c2", verdict: "pass", confidence: 1, evidenceRefs: ["p1"], rationale: "ok" },
  ],
  deterministicFlags: [],
  injectionSuspected: false,
  summaryForHumans: "ok",
};

const base = (over: Partial<RiskInput> = {}): RiskInput => ({
  verification: pass,
  amountMinor: 6000,
  policy,
  now: new Date("2026-10-20T11:00:00Z"),
  worker: { trustScore: 62, paypalEmailChangedAt: null },
  history: { pairCompletedReleases: 4, workerAvgReleaseMinor: 5000, workerReleasesLastHour: 0, payerDisputeRate: 0 },
  baseChallengeWindowSeconds: 15,
  ...over,
});

describe("risk engine (Appendix B scenarios)", () => {
  it("S01 clean proof with history: AUTO_RELEASE, score 0, short challenge window", () => {
    const r = computeRisk(base());
    expect(r).toMatchObject({ decision: "AUTO_RELEASE", score: 0, challengeWindowSeconds: 15 });
    expect(r.explanation).toMatch(/Released automatically: 2 of 2 criteria verified with 92% confidence/);
  });

  it("first-time pair adds 10 but still auto-releases", () => {
    const r = computeRisk(base({ history: { pairCompletedReleases: 0, workerAvgReleaseMinor: 0, workerReleasesLastHour: 0, payerDisputeRate: 0 } }));
    expect(r).toMatchObject({ decision: "AUTO_RELEASE", score: 10 });
  });

  it("S03 duplicate image: hard HOLD regardless of score", () => {
    const v = { ...pass, overall: "inconclusive" as const, deterministicFlags: [{ code: "DUP_IMAGE", severity: "critical" as const, detail: "Photo matches job X" }] };
    const r = computeRisk(base({ verification: v }));
    expect(r.decision).toBe("HOLD");
    expect(r.explanation).toBe("Held: Photo matches job X. No money moves until an admin reviews it.");
  });

  it("S02 GPS mismatch with a failed geo criterion: at least HUMAN_REVIEW", () => {
    const v: VerificationResult = {
      ...pass,
      overall: "partial",
      criteria: [pass.criteria[0], { ...pass.criteria[1], verdict: "fail", rationale: "5 km away" }],
      deterministicFlags: [{ code: "GPS_MISMATCH", severity: "critical", detail: "5.0 km away" }],
    };
    expect(["HUMAN_REVIEW", "HOLD"]).toContain(computeRisk(base({ verification: v })).decision);
  });

  it("S06 injection suspected: never auto-releases", () => {
    const v = { ...pass, injectionSuspected: true, deterministicFlags: [{ code: "INJECTION_SUSPECTED", severity: "critical" as const, detail: "x" }] };
    expect(computeRisk(base({ verification: v })).decision).not.toBe("AUTO_RELEASE");
  });

  it("S09 new low-trust worker with a large amount: HUMAN_REVIEW", () => {
    const r = computeRisk(base({ worker: { trustScore: 35, paypalEmailChangedAt: null }, amountMinor: 30000, history: { pairCompletedReleases: 0, workerAvgReleaseMinor: 2000, workerReleasesLastHour: 0, payerDisputeRate: 0 } }));
    expect(r.decision).toBe("HUMAN_REVIEW");
    expect(r.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["LOW_TRUST", "FIRST_TIME_PAIR", "AMOUNT_ANOMALY"]));
  });

  it("S10 payout email changed an hour ago: PAYOUT_DEST_RECENT and HUMAN_REVIEW", () => {
    const r = computeRisk(base({ worker: { trustScore: 62, paypalEmailChangedAt: new Date("2026-10-20T10:00:00Z") } }));
    expect(r.decision).toBe("HUMAN_REVIEW");
    expect(r.signals.map((s) => s.code)).toContain("PAYOUT_DEST_RECENT");
  });

  it("amounts above the agent mandate's auto-release limit go to a person", () => {
    const r = computeRisk(base({ mandateMaxAutoReleaseMinor: 5000 }));
    expect(r.decision).toBe("HUMAN_REVIEW");
    expect(r.reasons[0]).toMatch(/above the automatic release limit of \$50.00/);
  });
});

describe("verification merge", () => {
  const criteria = [
    { id: "c1", text: "Photo", evidenceType: "photo" as const, check: "ai_visual" as const },
    { id: "c2", text: "GPS", evidenceType: "geo" as const, check: "deterministic" as const },
  ];
  const det = (verdict: "pass" | "fail", critical = false) => ({
    flags: critical ? [{ code: "GPS_MISMATCH", severity: "critical" as const, detail: "far" }] : [],
    criteria: [{ criterionId: "c2", verdict, confidence: 1, evidenceRefs: [], rationale: "r" }],
    injectionSuspected: false,
    injectionSpans: [],
  });
  const aiPass = { criteria: [{ criterionId: "c1", verdict: "pass" as const, confidence: 0.95, evidenceRefs: ["p"], rationale: "ok" }, { criterionId: "c2", verdict: "pass" as const, confidence: 1, evidenceRefs: [], rationale: "model tries to override" }], confidence: 0.95, injectionSuspected: false, summaryForHumans: "ok" };

  it("deterministic failures override AI passes", () => {
    const r = mergeVerification("ms", criteria, det("fail", true), aiPass);
    expect(r.criteria.find((c) => c.criterionId === "c2")?.verdict).toBe("fail");
    expect(r.overall).toBe("partial");
  });

  it("a critical flag caps an all-pass verdict at inconclusive", () => {
    const r = mergeVerification("ms", criteria, det("pass", true), aiPass);
    expect(r.overall).toBe("inconclusive");
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  it("AI unavailable: AI criteria are unclear and confidence is 0", () => {
    const r = mergeVerification("ms", criteria, det("pass"), null);
    expect(r).toMatchObject({ overall: "inconclusive", confidence: 0 });
  });
});
