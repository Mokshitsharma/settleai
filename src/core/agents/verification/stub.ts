// Deterministic offline Verification Agent. Visual criteria pass when a photo exists and no critical flag
// was raised; text criteria pass when a confirmation text exists. It never sees anything the rules missed,
// which is exactly why the rules run first.
import type { StructuredRequest } from "@/core/ports/llm";
import type { AiVerification } from "./index";

interface Ctx {
  aiCriteria: { id: string; text: string; evidenceType: string }[];
  deterministicFlags: { code: string; severity: string }[];
  proofIds: string[];
}

export function stubVerify(req: StructuredRequest<unknown>): AiVerification {
  const parts = req.messages.flatMap((m) => m.content);
  const all = parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
  const ctx = JSON.parse(/<context>\n([\s\S]*?)\n<\/context>/.exec(all)?.[1] ?? "{}") as Ctx;
  const proofText = /<proof_data>\n([\s\S]*?)\n<\/proof_data>/.exec(all)?.[1] ?? "";
  const imageProofs = [...all.matchAll(/Image for proof (\S+):/g)].map((m) => m[1]);
  const textProofs = [...proofText.matchAll(/^\[(\S+)\] (.+)$/gm)].filter((m) => m[2].trim().length >= 2);
  const critical = ctx.deterministicFlags?.some((f) => f.severity === "critical");
  const injected = proofText.includes("[removed: instruction-like text]");

  const criteria = (ctx.aiCriteria ?? []).map((c) => {
    if (c.evidenceType === "text") {
      return textProofs.length && !injected
        ? { criterionId: c.id, verdict: "pass" as const, confidence: 0.9, evidenceRefs: textProofs.map((m) => m[1]), rationale: `Confirmation text provided: "${textProofs[0][2].slice(0, 60)}"` }
        : { criterionId: c.id, verdict: "unclear" as const, confidence: 0.4, evidenceRefs: [], rationale: injected ? "Text contains instruction-like content" : "No confirmation text was submitted" };
    }
    return imageProofs.length
      ? { criterionId: c.id, verdict: (critical ? "unclear" : "pass") as "pass" | "unclear", confidence: critical ? 0.5 : 0.92, evidenceRefs: imageProofs, rationale: critical ? "Photo present, but a rule check failed" : "Photo shows the expected goods at the location" }
      : { criterionId: c.id, verdict: "unclear" as const, confidence: 0.3, evidenceRefs: [], rationale: "No photo was submitted" };
  });
  const pass = criteria.every((c) => c.verdict === "pass");
  return {
    criteria,
    confidence: pass ? 0.92 : 0.5,
    injectionSuspected: injected,
    summaryForHumans: pass ? "The photos and confirmation match every criterion." : "Some criteria could not be confirmed from the evidence.",
  };
}
