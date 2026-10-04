// Deterministic offline Arbiter. Uses the same evidence the model would see:
// - verified delivery and no counter-evidence from the payer   -> PAYER_UNSUPPORTED_CLAIM, full release
// - verification failed                                          -> WORKER_NONPERFORMANCE, full refund
// - verified, but the payer brings evidence of a partial problem -> WORKER_PARTIAL, split by the share claimed
import type { DisputeProposal } from "@/core/contracts";
import type { StructuredRequest } from "@/core/ports/llm";

interface Ctx {
  disputeId: string;
  disputedAmountMinor: number;
  openedBy: "payer" | "worker";
  milestone: { criteria: { id: string; text: string }[] };
  verification: { overall?: string } | null;
  complianceReport: { id: string };
  evidenceIds: string[];
}

export function stubArbitrate(req: StructuredRequest<unknown>): DisputeProposal {
  const all = req.messages.flatMap((m) => m.content).map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const ctx = JSON.parse(/<context>\n([\s\S]*?)\n<\/context>/.exec(all)?.[1] ?? "{}") as Ctx;
  const statements = /<statements>\n([\s\S]*?)\n<\/statements>/.exec(all)?.[1] ?? "";
  const payerLines = statements.split("\n").filter((l) => /, payer[,\]]/.test(l));
  const payerPhotos = [...all.matchAll(/Evidence image (\S+):/g)].map((m) => m[1]);
  const total = ctx.disputedAmountMinor;
  const verified = ctx.verification?.overall === "pass";
  const payerEvidence = payerLines.filter((l) => l.replace(/^\[[^\]]+\]\s*/, "").trim().length > 20).length + payerPhotos.length;
  const injected = statements.includes("[removed: instruction-like text]");

  // A stated share like "6 of 20" or "30%" sets the refund share; otherwise 30 percent.
  const ofMatch = /(\d+)\s*(?:of|out of)\s*(\d+)/i.exec(payerLines.join(" "));
  const pctMatch = /(\d{1,2})\s*%/.exec(payerLines.join(" "));
  const share = ofMatch ? Number(ofMatch[1]) / Math.max(1, Number(ofMatch[2])) : pctMatch ? Number(pctMatch[1]) / 100 : 0.3;

  let release: number;
  let faultClass: DisputeProposal["liability"]["faultClass"];
  let bearer: DisputeProposal["liability"]["bearer"];
  let rationale: string;
  if (!verified) {
    release = 0;
    faultClass = "WORKER_NONPERFORMANCE";
    bearer = "worker";
    rationale = "The milestone's acceptance criteria were not verified, so the payer is refunded.";
  } else if (payerEvidence === 0) {
    release = total;
    faultClass = "PAYER_UNSUPPORTED_CLAIM";
    bearer = "payer";
    rationale = "Delivery was verified and the payer gave no evidence supporting the claim, so the worker is paid in full.";
  } else {
    release = Math.round((total * (1 - Math.min(1, Math.max(0, share)))) / 100) * 100;
    release = Math.min(total, Math.max(0, release));
    faultClass = "WORKER_PARTIAL";
    bearer = "worker";
    rationale = `Delivery was verified, but the payer's evidence shows about ${Math.round(share * 100)}% of the order was not as agreed. The worker is paid for the rest.`;
  }
  const criteria = ctx.milestone?.criteria ?? [];
  return {
    disputeId: ctx.disputeId,
    findings: {
      agreedFacts: verified ? ["The worker submitted proof that passed automatic verification"] : ["Automatic verification did not pass"],
      contestedFacts: payerLines.length ? ["Whether the delivered goods matched the order"] : [],
      evidenceAssessment: ctx.evidenceIds.map((id) => ({ evidenceId: id, weight: payerPhotos.includes(id) ? 0.8 : 0.5, note: payerPhotos.includes(id) ? "Photo submitted with the claim" : "Written statement" })),
    },
    proposal: {
      releaseToWorkerMinor: release,
      refundToPayerMinor: total - release,
      rationale,
      criteriaOutcome: criteria.map((c, i) => ({
        criterionId: c.id,
        met: faultClass === "PAYER_UNSUPPORTED_CLAIM" || (faultClass === "WORKER_PARTIAL" && i > 0),
        note: faultClass === "WORKER_PARTIAL" && i === 0 ? "Partly met according to the payer's evidence" : verified ? "Verified" : "Not verified",
      })),
    },
    liability: { faultClass, bearer, basis: [...criteria.slice(0, 1).map((c) => `criterion:${c.id}`), ...ctx.evidenceIds.slice(0, 3).map((e) => `evidence:${e}`)], mandateComplianceReportId: ctx.complianceReport?.id ?? "" },
    confidence: injected ? 0.5 : payerEvidence > 0 && verified ? 0.78 : 0.86,
    alternatives:
      faultClass === "WORKER_PARTIAL"
        ? [{ releaseToWorkerMinor: Math.round(total / 2), refundToPayerMinor: total - Math.round(total / 2), why: "An even split if the damage cannot be attributed" }]
        : [],
    precedentsUsed: [],
    requiresHuman: injected,
    reasonsIfHuman: injected ? ["A statement contains instruction-like text"] : [],
  };
}
