// Dispute Arbiter (spec §8.6, §7.5). The model proposes a split and a fault class; code enforces the
// invariants and the compliance report's ground truth. The Arbiter never executes payments.
import type { DisputeProposal, FaultClass } from "@/core/contracts";
import { DisputeProposal as DisputeProposalSchema } from "@/core/contracts";
import { scanForInjection } from "@/core/checks/deterministic";
import type { LlmContent } from "@/core/ports/llm";
import { dataBlock, runAgent, type AgentDeps } from "../runtime";
import { ARBITER_PROMPT_VERSION, ARBITER_SYSTEM_PROMPT } from "./prompt";

export interface ComplianceReport {
  id: string;
  jobId: string;
  agentInitiated: boolean;
  intentMandateId: string | null;
  checks: { gate: string; action: string; result: string; reasonCodes: string[]; at: string }[];
  violations: string[];
  agentScopeViolation: boolean;
  summary: string;
}

export interface ArbiterInput {
  disputeId: string;
  disputedAmountMinor: number;
  milestone: { seq: number; title: string; criteria: { id: string; text: string }[] };
  verification: unknown;
  decision: unknown;
  statements: { evidenceId: string; party: "payer" | "worker"; kind: string; text: string }[];
  images: { evidenceId: string; base64: string }[];
  report: ComplianceReport;
  openedBy: "payer" | "worker";
  reason: string;
}

const DEFAULT_BEARER: Record<FaultClass, DisputeProposal["liability"]["bearer"]> = {
  WORKER_NONPERFORMANCE: "worker",
  WORKER_PARTIAL: "worker",
  PAYER_UNSUPPORTED_CLAIM: "payer",
  SPEC_AMBIGUITY: "shared",
  AGENT_SCOPE_VIOLATION: "agent_principal",
  PLATFORM_FAILURE: "platform",
};

/**
 * Hard rules applied to whatever the model returns (spec §8.6): exact split, no negatives, compliance
 * report is ground truth, suspicious or low-confidence cases go to a person.
 */
export function enforceProposal(raw: DisputeProposal, input: ArbiterInput, injected: boolean): DisputeProposal {
  const p: DisputeProposal = structuredClone(raw);
  p.disputeId = input.disputeId;
  p.liability.mandateComplianceReportId = input.report.id;
  const reasons = [...p.reasonsIfHuman];

  const release = p.proposal.releaseToWorkerMinor;
  const refund = p.proposal.refundToPayerMinor;
  if (release < 0 || refund < 0 || release + refund !== input.disputedAmountMinor) {
    // Never trust arithmetic from the model: keep its release share, clamp, and recompute the refund.
    const clamped = Math.max(0, Math.min(input.disputedAmountMinor, release));
    p.proposal.releaseToWorkerMinor = clamped;
    p.proposal.refundToPayerMinor = input.disputedAmountMinor - clamped;
    reasons.push("The proposed amounts did not add up to the disputed amount and were corrected");
    p.requiresHuman = true;
  }
  p.alternatives = p.alternatives.filter((a) => a.releaseToWorkerMinor >= 0 && a.refundToPayerMinor >= 0 && a.releaseToWorkerMinor + a.refundToPayerMinor === input.disputedAmountMinor);

  if (input.report.agentScopeViolation) {
    // Ground truth: an out-of-mandate action got through. The payer is made whole; the agent's principal bears it.
    p.liability = {
      faultClass: "AGENT_SCOPE_VIOLATION",
      bearer: "agent_principal",
      basis: [...new Set([...input.report.violations.map((v) => `compliance:${v}`), ...p.liability.basis])],
      mandateComplianceReportId: input.report.id,
    };
    p.proposal.releaseToWorkerMinor = 0;
    p.proposal.refundToPayerMinor = input.disputedAmountMinor;
  } else if (p.liability.faultClass === "AGENT_SCOPE_VIOLATION") {
    reasons.push("The model claimed a mandate violation that the compliance report does not show");
    p.liability.faultClass = "SPEC_AMBIGUITY";
    p.liability.bearer = "shared";
    p.requiresHuman = true;
  }
  if (!p.liability.bearer) p.liability.bearer = DEFAULT_BEARER[p.liability.faultClass];
  if (injected) {
    reasons.push("A statement contains instructions aimed at the arbiter");
    p.requiresHuman = true;
  }
  if (p.confidence < 0.6) {
    reasons.push(`Arbiter confidence is only ${Math.round(p.confidence * 100)}%`);
    p.requiresHuman = true;
  }
  p.reasonsIfHuman = [...new Set(reasons)];
  return DisputeProposalSchema.parse(p);
}

export async function arbitrate(deps: AgentDeps, input: ArbiterInput): Promise<{ proposal: DisputeProposal | null; model: string; traceId: string }> {
  const injectedSpans = scanForInjection(input.statements.map((s) => s.text));
  const context = {
    disputeId: input.disputeId,
    disputedAmountMinor: input.disputedAmountMinor,
    openedBy: input.openedBy,
    milestone: input.milestone,
    verification: input.verification,
    decision: input.decision,
    complianceReport: input.report,
    evidenceIds: [...input.statements.map((s) => s.evidenceId), ...input.images.map((i) => i.evidenceId)],
  };
  const content: LlmContent[] = [
    { type: "text", text: `<context>\n${JSON.stringify(context)}\n</context>` },
    {
      type: "text",
      text: dataBlock(
        "statements",
        [`[reason, ${input.openedBy}] ${input.reason}`, ...input.statements.map((s) => `[${s.evidenceId}, ${s.party}, ${s.kind}] ${s.text}`)]
          .map((t) => injectedSpans.reduce((acc, span) => acc.split(span).join("[removed: instruction-like text]"), t))
          .join("\n"),
      ),
    },
    ...input.images.flatMap((img): LlmContent[] => [
      { type: "text", text: `Evidence image ${img.evidenceId}:` },
      { type: "image", mediaType: "image/jpeg", base64: img.base64 },
    ]),
  ];
  deps.emit?.("agent.step", "Dispute arbiter is weighing the evidence");
  const run = await runAgent(deps, {
    agent: "arbiter",
    promptVersion: ARBITER_PROMPT_VERSION,
    entityType: "dispute",
    entityId: input.disputeId,
    system: ARBITER_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    schema: DisputeProposalSchema,
    schemaName: "DisputeProposal",
  });
  if (!run.ok) return { proposal: null, model: "none", traceId: run.traceId };
  return { proposal: enforceProposal(run.output, input, injectedSpans.length > 0), model: run.model, traceId: run.traceId };
}
