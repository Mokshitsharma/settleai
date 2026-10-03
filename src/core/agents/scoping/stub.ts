// Deterministic offline Scoping Agent used by the stub LLM (demo mode with zero keys, CI).
// It follows the same rules as the real prompt so MOCK demos still behave sensibly.
import type { JobSpec } from "@/core/contracts";
import type { StructuredRequest } from "@/core/ports/llm";
import { splitProportional } from "@/core/money";
import { guessCategory, prohibitedHits, statedAmounts } from "./index";
import { CATEGORY_TEMPLATES, KNOWN_PLACES } from "./templates";

function requestText(req: StructuredRequest<unknown>): string {
  const all = req.messages.flatMap((m) => m.content).map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return /<user_request>\n([\s\S]*?)\n<\/user_request>/.exec(all)?.[1] ?? all;
}

function nowFrom(req: StructuredRequest<unknown>): Date {
  const all = req.messages.flatMap((m) => m.content).map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const iso = /Current time: (\S+)/.exec(all)?.[1];
  return iso ? new Date(iso) : new Date();
}

export function stubScope(req: StructuredRequest<unknown>): JobSpec {
  const text = requestText(req);
  const now = nowFrom(req);
  const category = guessCategory(text);
  const template = CATEGORY_TEMPLATES[category];
  const amounts = statedAmounts(text);
  const total = amounts.length === 1 ? amounts[0] : amounts.length > 1 ? Math.max(...amounts) : 0;
  const parts = total > 0 ? splitProportional(total, template.map((t) => t.share)) : template.map(() => 0);
  // The job location is where the final proof is checked: for deliveries the destination, which is
  // usually the last place mentioned ("from Rajwada to Vijay Nagar").
  const place = KNOWN_PLACES.filter((p) => p.match.test(text) && p.label !== "Indore")
    .map((p) => ({ p, at: text.search(p.match) }))
    .sort((a, b) => b.at - a.at)[0]?.p ?? KNOWN_PLACES.find((p) => p.match.test(text));
  const questions: string[] = [];
  if (total === 0) questions.push("What is your total budget for this job in USD?");
  if (amounts.length > 1) questions.push("You mentioned several amounts. Which one is the total budget?");
  if (!place && category !== "digital_deliverable") questions.push("What is the exact address or area for this job?");
  const hits = prohibitedHits(text);
  const firstLine = text.split(/[.\n]/)[0].trim();

  return {
    title: firstLine.length > 4 ? firstLine.slice(0, 80) : `New ${category.replace("_", " ")} job`,
    category,
    summary: text.trim().slice(0, 400),
    currency: "USD",
    totalAmountMinor: parts.reduce((a, b) => a + b, 0),
    location: place && category !== "digital_deliverable" ? { lat: place.lat, lng: place.lng, radiusM: 150, label: place.label } : undefined,
    milestones: template.map((t, i) => ({
      seq: i + 1,
      title: t.title,
      description: t.description,
      amountMinor: parts[i],
      dueAt: new Date(now.getTime() + t.hoursFromNow * 3600_000).toISOString(),
      acceptanceCriteria: t.criteria,
    })),
    clarifyingQuestions: questions.slice(0, 3),
    riskNotes: hits.length ? [`Request mentions prohibited terms: ${hits.join(", ")}`] : [],
    confidence: hits.length ? 0.2 : place || category === "digital_deliverable" ? 0.85 : 0.6,
  };
}
