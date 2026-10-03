import { z } from "zod";
import { MinorAmount } from "./common";

export const FaultClass = z.enum([
  "WORKER_NONPERFORMANCE",
  "WORKER_PARTIAL",
  "PAYER_UNSUPPORTED_CLAIM",
  "SPEC_AMBIGUITY",
  "AGENT_SCOPE_VIOLATION",
  "PLATFORM_FAILURE",
]);
export type FaultClass = z.infer<typeof FaultClass>;

export const DisputeProposal = z.object({
  disputeId: z.string(),
  findings: z.object({
    agreedFacts: z.array(z.string()),
    contestedFacts: z.array(z.string()),
    evidenceAssessment: z.array(
      z.object({ evidenceId: z.string(), weight: z.number().min(0).max(1), note: z.string() }),
    ),
  }),
  proposal: z.object({
    releaseToWorkerMinor: MinorAmount,
    refundToPayerMinor: MinorAmount,
    rationale: z.string(),
    criteriaOutcome: z.array(z.object({ criterionId: z.string(), met: z.boolean(), note: z.string() })),
  }),
  liability: z.object({
    faultClass: FaultClass,
    bearer: z.enum(["worker", "payer", "shared", "platform", "agent_principal"]),
    basis: z.array(z.string()),
    mandateComplianceReportId: z.string(),
  }),
  confidence: z.number().min(0).max(1),
  alternatives: z
    .array(z.object({ releaseToWorkerMinor: MinorAmount, refundToPayerMinor: MinorAmount, why: z.string() }))
    .max(2),
  precedentsUsed: z.array(z.string()),
  requiresHuman: z.boolean(),
  reasonsIfHuman: z.array(z.string()),
});
export type DisputeProposal = z.infer<typeof DisputeProposal>;

/** Hard invariant enforced in code, never in prompts: release + refund = disputed amount. */
export function assertProposalInvariant(p: DisputeProposal, disputedAmountMinor: number): void {
  const { releaseToWorkerMinor: release, refundToPayerMinor: refund } = p.proposal;
  if (release + refund !== disputedAmountMinor) {
    throw new Error(`Dispute proposal invariant violated: ${release} + ${refund} != ${disputedAmountMinor}`);
  }
}
