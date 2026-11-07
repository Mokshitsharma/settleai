// Verification Agent (spec §8.4): AI verdicts for AI-checked criteria, then a deterministic merge where
// rule-based results and critical flags always win over the model.
import { z } from "zod";
import type { AcceptanceCriterion, DeterministicFlag, VerificationResult } from "@/core/contracts";
import type { DeterministicOutcome } from "@/core/checks/deterministic";
import type { LlmContent } from "@/core/ports/llm";
import { dataBlock, runAgent, type AgentDeps } from "../runtime";
import { VERIFICATION_PROMPT_VERSION, VERIFICATION_SYSTEM_PROMPT } from "./prompt";

export const AiVerification = z.object({
  criteria: z.array(
    z.object({
      criterionId: z.string(),
      verdict: z.enum(["pass", "fail", "unclear"]),
      confidence: z.number().min(0).max(1),
      evidenceRefs: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  injectionSuspected: z.boolean(),
  summaryForHumans: z.string(),
});
export type AiVerification = z.infer<typeof AiVerification>;

export interface VerificationInput {
  milestoneId: string;
  criteria: AcceptanceCriterion[];
  images: { proofId: string; base64: string }[];
  texts: { proofId: string; text: string }[];
  deterministic: DeterministicOutcome;
  metadata: Record<string, unknown>;
  /** What the payer asked for (title and summary), so criteria like "the expected quantity" can be judged. Untrusted. */
  job?: { title: string; summary: string };
}

/** Deterministic merge (spec §8.4 step 4). Never lets the model override rules or critical flags. */
export function mergeVerification(
  milestoneId: string,
  criteria: AcceptanceCriterion[],
  det: DeterministicOutcome,
  ai: AiVerification | null,
): VerificationResult {
  const merged = criteria.map((c) => {
    if (c.check === "deterministic") {
      return det.criteria.find((d) => d.criterionId === c.id) ?? { criterionId: c.id, verdict: "unclear" as const, confidence: 0, evidenceRefs: [], rationale: "Not checked" };
    }
    if (c.check === "human") {
      return { criterionId: c.id, verdict: "unclear" as const, confidence: 0, evidenceRefs: [], rationale: "Needs a person to confirm" };
    }
    const v = ai?.criteria.find((x) => x.criterionId === c.id);
    return v ?? { criterionId: c.id, verdict: "unclear" as const, confidence: 0, evidenceRefs: [], rationale: ai ? "The AI gave no verdict" : "AI verification unavailable" };
  });

  const critical = det.flags.some((f) => f.severity === "critical");
  const anyFail = merged.some((c) => c.verdict === "fail");
  const anyPass = merged.some((c) => c.verdict === "pass");
  const anyUnclear = merged.some((c) => c.verdict === "unclear");
  let overall: VerificationResult["overall"] = anyFail ? (anyPass ? "partial" : "fail") : anyUnclear ? "inconclusive" : "pass";
  if (critical && overall === "pass") overall = "inconclusive"; // spec: a critical flag caps the verdict

  const criteriaConfidence = merged.length ? Math.min(...merged.map((c) => c.confidence)) : 0;
  const confidence = Math.max(0, Math.min(ai ? ai.confidence : 0, criteriaConfidence, critical ? 0.5 : 1));
  const flags: DeterministicFlag[] = [...det.flags];
  const injectionSuspected = det.injectionSuspected || Boolean(ai?.injectionSuspected);
  if (ai?.injectionSuspected && !det.injectionSuspected) {
    flags.push({ code: "INJECTION_SUSPECTED", severity: "critical", detail: "The verification model found instructions aimed at it inside the evidence" });
  }
  return {
    milestoneId,
    overall,
    confidence: Number(confidence.toFixed(3)),
    criteria: merged,
    deterministicFlags: flags,
    injectionSuspected,
    summaryForHumans: ai?.summaryForHumans ?? "Automatic verification could not run; a person needs to review this milestone.",
  };
}

export async function verifyMilestone(deps: AgentDeps, input: VerificationInput): Promise<{ result: VerificationResult; model: string; traceId: string; latencyMs: number }> {
  const aiCriteria = input.criteria.filter((c) => c.check === "ai_visual" || c.check === "ai_text");
  let ai: AiVerification | null = null;
  let model = "none";
  let traceId = "";
  let latencyMs = 0;

  if (aiCriteria.length) {
    const context = {
      milestoneId: input.milestoneId,
      aiCriteria: aiCriteria.map(({ id, text, evidenceType }) => ({ id, text, evidenceType })),
      deterministicFlags: input.deterministic.flags,
      deterministicCriteria: input.deterministic.criteria,
      metadata: input.metadata,
      proofIds: [...input.images.map((i) => i.proofId), ...input.texts.map((t) => t.proofId)],
    };
    const content: LlmContent[] = [
      { type: "text", text: `<context>\n${JSON.stringify(context)}\n</context>` },
      // The payer's job description is untrusted too, so it is delimited data like the proof text.
      ...(input.job
        ? [{ type: "text" as const, text: dataBlock("job_request", neutralize(`${input.job.title}\n${input.job.summary}`, input.deterministic.injectionSpans)) }]
        : []),
      // Spans that matched the injection scan are neutralized before the model sees them (spec §8.8).
      {
        type: "text",
        text: dataBlock(
          "proof_data",
          input.texts.map((t) => `[${t.proofId}] ${neutralize(t.text, input.deterministic.injectionSpans)}`).join("\n") || "(no text submitted)",
        ),
      },
      ...input.images.flatMap((img): LlmContent[] => [
        { type: "text", text: `Image for proof ${img.proofId}:` },
        { type: "image", mediaType: "image/jpeg", base64: img.base64 },
      ]),
    ];
    deps.emit?.("agent.step", `Verification: checking ${aiCriteria.length} criteria with AI`, { agent: "verification" });
    const run = await runAgent(deps, {
      agent: "verification",
      promptVersion: VERIFICATION_PROMPT_VERSION,
      entityType: "milestone",
      entityId: input.milestoneId,
      system: VERIFICATION_SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      schema: AiVerification,
      schemaName: "VerificationResult",
      inputRef: `proofs:${context.proofIds.join(",")}`,
    });
    traceId = run.traceId;
    if (run.ok) {
      ai = { ...run.output, criteria: run.output.criteria.filter((c) => aiCriteria.some((a) => a.id === c.criterionId)) };
      model = run.model;
      latencyMs = run.latencyMs;
    }
  }
  const result = mergeVerification(input.milestoneId, input.criteria, input.deterministic, aiCriteria.length ? ai : { criteria: [], confidence: 1, injectionSuspected: false, summaryForHumans: "All criteria were checked by rules." });
  return { result, model, traceId, latencyMs };
}

function neutralize(text: string, spans: string[]): string {
  return spans.reduce((t, s) => t.split(s).join("[removed: instruction-like text]"), text);
}
