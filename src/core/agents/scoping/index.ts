// Scoping Agent: natural-language request -> JobSpec (spec §8.3). Deterministic guards run after the model:
// stated amounts must be respected exactly, and prohibited content is flagged.
import { z } from "zod";
import prohibited from "@/core/policy/prohibited.json";
import { Category, JobSpec } from "@/core/contracts";
import { parseMajor } from "@/core/money";
import { dataBlock, runAgent, type AgentDeps, type AgentResult } from "../runtime";
import { SCOPING_PROMPT_VERSION, SCOPING_SYSTEM_PROMPT } from "./prompt";
import { CATEGORY_TEMPLATES, KNOWN_PLACES } from "./templates";

const AMOUNT_RE = /(?:\$|usd\s?|us\$)\s?(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)|(\d{1,7}(?:\.\d{1,2})?)\s?(?:usd|dollars?)\b/gi;

/** Every explicit USD amount in the text, in minor units. */
export function statedAmounts(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) out.push(parseMajor((m[1] ?? m[2]).replaceAll(",", "")));
  return out;
}

export function prohibitedHits(text: string): string[] {
  const lower = text.toLowerCase();
  return prohibited.keywords.filter((k) => lower.includes(k));
}

export function guessCategory(text: string): Category {
  if (/\b(deliver|delivery|pick ?up|parcel|courier|carton|drop[- ]?off|ship)\b/i.test(text)) return "delivery";
  if (/\b(design|logo|document|report|pdf|write|translate|spreadsheet|deck|data entry|figma)\b/i.test(text)) return "digital_deliverable";
  return "onsite_service";
}

/** JobSpec plus the deterministic "never invent amounts" rule. Used as the schema, so violations trigger a retry. */
export function jobSpecFor(text: string) {
  const amounts = statedAmounts(text);
  return JobSpec.superRefine((spec, ctx) => {
    if (amounts.length === 0 && spec.totalAmountMinor > 0) {
      ctx.addIssue({ code: "custom", path: ["totalAmountMinor"], message: "No amount was stated; set amounts to 0 and ask for the budget" });
    }
    if (amounts.length === 0 && spec.clarifyingQuestions.length === 0) {
      ctx.addIssue({ code: "custom", path: ["clarifyingQuestions"], message: "Ask for the budget in clarifyingQuestions" });
    }
    if (amounts.length === 1 && spec.totalAmountMinor !== amounts[0]) {
      ctx.addIssue({ code: "custom", path: ["totalAmountMinor"], message: `The payer stated ${amounts[0]} minor units; the total must equal it exactly` });
    }
  });
}

export interface ScopeInput {
  text: string;
  payerId: string;
  now: Date;
  entityId: string; // draft id used for tracing
}

export async function scopeJob(deps: AgentDeps, input: ScopeInput): Promise<AgentResult<JobSpec>> {
  const category = guessCategory(input.text);
  const places = KNOWN_PLACES.filter((p) => p.match.test(input.text)).map(({ label, lat, lng }) => ({ label, lat, lng }));
  const userMessage = [
    `Current time: ${input.now.toISOString()}`,
    `Likely category: ${category}`,
    `Category template: ${JSON.stringify(CATEGORY_TEMPLATES[category])}`,
    places.length ? `Known locations mentioned: ${JSON.stringify(places)}` : "No known location matched.",
    dataBlock("user_request", input.text),
  ].join("\n\n");

  deps.emit?.("agent.step", "Scoping: reading the request", { agent: "scoping" });
  const result = await runAgent(deps, {
    agent: "scoping",
    promptVersion: SCOPING_PROMPT_VERSION,
    entityType: "job_draft",
    entityId: input.entityId,
    system: SCOPING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: userMessage }] }],
    schema: jobSpecFor(input.text) as unknown as z.ZodType<JobSpec>,
    schemaName: "JobSpec",
    inputRef: `text:${input.text.length}chars`,
  });
  if (!result.ok) return result;

  // Deterministic post-checks that only add warnings; they never raise amounts or loosen criteria.
  const hits = prohibitedHits(input.text);
  const spec = { ...result.output };
  if (hits.length) {
    spec.riskNotes = [...spec.riskNotes, `Prohibited terms found: ${hits.join(", ")}. This job needs review.`];
    spec.confidence = Math.min(spec.confidence, 0.3);
  }
  deps.emit?.("agent.step", `Scoping: ${spec.milestones.length} milestone(s), ${spec.milestones.reduce((n, m) => n + m.acceptanceCriteria.length, 0)} acceptance criteria`, {
    agent: "scoping",
  });
  return { ...result, output: spec };
}
