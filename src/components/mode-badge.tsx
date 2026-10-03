import { config } from "@/core/config";

/** Always-visible MOCK / LIVE label so judges are never misled about where money moves. */
export function ModeBadge() {
  const cfg = config();
  const live = cfg.mode === "LIVE";
  return (
    <span
      title={live ? `PayPal ${cfg.PAYPAL_ENV} (test money)` : "Mock PayPal: no real or sandbox money moves"}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide " +
        (live ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900")
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + (live ? "bg-emerald-600" : "bg-amber-600")} />
      {live ? `LIVE · PayPal ${cfg.PAYPAL_ENV}` : "MOCK MODE"}
      <span className="font-normal opacity-70">· AI: {cfg.llmProvider === "stub" ? "offline stub" : cfg.llmModel}</span>
    </span>
  );
}
