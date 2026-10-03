// Plain-language rendering of an Intent Mandate, shown to the human before signing (spec Appendix E).
import type { IntentMandatePayload } from "@/core/contracts";
import { formatMinor } from "@/core/money";

const CATEGORY_LABEL: Record<string, string> = {
  delivery: "delivery services",
  digital_deliverable: "digital work (files and documents)",
  onsite_service: "on-site services",
};

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function renderIntentMandate(p: IntentMandatePayload, timeZone = "Asia/Kolkata"): string {
  const s = p.scope;
  const c = p.conditions;
  const where = s.geoFence ? ` within ${s.geoFence.radiusKm} km of ${s.geoFence.label ?? `${s.geoFence.lat}, ${s.geoFence.lng}`}` : "";
  const until = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(p.notAfter));

  const parts = [
    `Allow ${p.agent.name} to hire ${list(s.categories.map((x) => CATEGORY_LABEL[x] ?? x))}${where}, up to ${formatMinor(s.maxPerJobMinor)} per job and ${formatMinor(s.maxTotalMinor)} in total, at most ${s.maxJobsPerDay} job${s.maxJobsPerDay === 1 ? "" : "s"} a day`,
  ];
  const counterparty: string[] = [];
  if (s.counterparty.requirePayPalEmail) counterparty.push("have a PayPal email");
  if (s.counterparty.minTrustScore > 0) counterparty.push(`a trust score of at least ${s.counterparty.minTrustScore}`);
  if (counterparty.length) parts[0] += `, only with workers who ${list(counterparty)}`;
  parts[0] += ".";
  if (s.prohibitedKeywords?.length) parts.push(`Jobs mentioning ${list(s.prohibitedKeywords.map((k) => `"${k}"`))} are refused.`);
  parts.push("Payments are released only after the work is verified.");
  parts.push(`I must approve any job above ${formatMinor(c.stepUpAboveMinor)}.`);
  parts.push(`This permission ends on ${until} and I can revoke it at any time.`);
  return parts.join(" ");
}
