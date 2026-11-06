import { config } from "@/core/config";

/** Full-width notice whenever AI answers are canned, so a stub result is never mistaken for a real model's. */
export function StubBanner() {
  if (config().llmProvider !== "stub") return null;
  return (
    <p role="status" className="bg-hold-wash px-4 py-2 text-center text-sm font-medium text-hold">
      AI agents are running on the offline stub: answers are canned fixtures, not from a real model.
    </p>
  );
}

/** Always-visible label so judges are never misled about where money moves and which AI runs. */
export function ModeBadge() {
  const cfg = config();
  const live = cfg.mode === "LIVE";
  return (
    <span className="flex items-center gap-2 text-xs">
      <span
        title={live ? `PayPal ${cfg.PAYPAL_ENV}: test money only` : "Simulated PayPal: no money moves"}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${
          live ? "bg-seal-wash text-seal" : "bg-hold-wash text-hold"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-seal" : "bg-hold"}`} />
        {live ? `PayPal ${cfg.PAYPAL_ENV}` : "Mock PayPal"}
      </span>
      <span
        title="Model used by the AI agents"
        className={cfg.llmProvider === "stub" ? "rounded-full bg-hold-wash px-2.5 py-1 font-semibold text-hold" : "hidden text-ink-faint sm:inline"}
      >
        {cfg.llmProvider === "stub" ? "Offline AI stub" : `AI: ${cfg.llmModel}`}
      </span>
    </span>
  );
}
