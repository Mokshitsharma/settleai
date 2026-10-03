import { config } from "@/core/config";

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
      <span className="hidden text-ink-faint sm:inline" title="Model used by the AI agents">
        {cfg.llmProvider === "stub" ? "Offline AI stub" : cfg.llmModel}
      </span>
    </span>
  );
}
