import { z } from "zod";

export const Severity = z.enum(["info", "warn", "critical"]);

export const DeterministicFlag = z.object({ code: z.string(), severity: Severity, detail: z.string() });
export type DeterministicFlag = z.infer<typeof DeterministicFlag>;

export const VerificationResult = z.object({
  milestoneId: z.string(),
  overall: z.enum(["pass", "partial", "fail", "inconclusive"]),
  confidence: z.number().min(0).max(1),
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      verdict: z.enum(["pass", "fail", "unclear"]),
      confidence: z.number().min(0).max(1),
      evidenceRefs: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  deterministicFlags: z.array(DeterministicFlag),
  injectionSuspected: z.boolean(),
  summaryForHumans: z.string(),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const RiskDecision = z.enum(["AUTO_RELEASE", "HUMAN_REVIEW", "HOLD"]);
export type RiskDecision = z.infer<typeof RiskDecision>;
