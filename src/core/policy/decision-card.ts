import type { RiskDecision, VerificationResult } from "@/core/contracts";
import type { Signal } from "./risk";

/** Decision Card payload (spec §13.2): everything a person needs to understand an automated decision. */
export interface DecisionCard {
  milestoneId: string;
  decision: RiskDecision;
  score: number;
  policyVersion: number;
  signals: Signal[];
  reasons: string[];
  explanation: string;
  verification: Pick<VerificationResult, "overall" | "confidence" | "injectionSuspected" | "summaryForHumans" | "deterministicFlags">;
  criteria: { criterionId: string; text: string; check: string; verdict: "pass" | "fail" | "unclear"; confidence: number; rationale: string; evidenceRefs: string[] }[];
  challengeWindowSeconds: number;
  model: string;
  verifiedAt: string;
}
