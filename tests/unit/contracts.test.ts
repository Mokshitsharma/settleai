import { describe, expect, it } from "vitest";
import defaultPolicy from "@/core/policy/default.json";
import { DisputeProposal, IntentMandatePayload, JobSpec, Policy, assertProposalInvariant } from "@/core/contracts";
import { sampleDisputeProposal, sampleIntentMandate, sampleJobSpec } from "../fixtures/contracts";

describe("contracts", () => {
  it("sample fixtures validate", () => {
    expect(() => JobSpec.parse(sampleJobSpec)).not.toThrow();
    expect(() => IntentMandatePayload.parse(sampleIntentMandate)).not.toThrow();
    expect(() => DisputeProposal.parse(sampleDisputeProposal)).not.toThrow();
    expect(() => Policy.parse(defaultPolicy)).not.toThrow();
  });

  it("JobSpec total must equal the sum of milestones", () => {
    const bad = { ...sampleJobSpec, totalAmountMinor: sampleJobSpec.totalAmountMinor + 1 };
    expect(JobSpec.safeParse(bad).success).toBe(false);
  });

  it("JobSpec rejects float amounts and more than 3 clarifying questions", () => {
    const floaty = structuredClone(sampleJobSpec);
    floaty.milestones[0].amountMinor = 10.5;
    expect(JobSpec.safeParse(floaty).success).toBe(false);
    expect(JobSpec.safeParse({ ...sampleJobSpec, clarifyingQuestions: ["a", "b", "c", "d"] }).success).toBe(false);
  });

  it("Intent Mandate cannot disable verification before release", () => {
    const bad = structuredClone(sampleIntentMandate);
    (bad.conditions as { requireVerificationBeforeRelease: boolean }).requireVerificationBeforeRelease = false;
    expect(IntentMandatePayload.safeParse(bad).success).toBe(false);
  });

  it("dispute invariant: release + refund = disputed amount", () => {
    expect(() => assertProposalInvariant(sampleDisputeProposal, 6000)).not.toThrow();
    expect(() => assertProposalInvariant(sampleDisputeProposal, 6001)).toThrow(/invariant/);
  });
});
