import { formatMinor } from "@/core/money";

/** Always-visible money position for a job: where every cent of the PayPal capture sits right now. */
export function MoneyStrip({
  fundedMinor,
  inEscrowMinor,
  releasedMinor,
  refundedMinor,
  expectedMinor,
}: {
  fundedMinor: number;
  inEscrowMinor: number;
  releasedMinor: number;
  refundedMinor: number;
  expectedMinor: number;
}) {
  const base = Math.max(fundedMinor, expectedMinor, 1);
  const fees = Math.max(0, fundedMinor - inEscrowMinor - releasedMinor - refundedMinor);
  const segments = [
    { key: "Paid to worker", minor: releasedMinor, color: "var(--seal)" },
    { key: "Refunded to payer", minor: refundedMinor, color: "var(--hold)" },
    { key: "Platform fee", minor: fees, color: "var(--ink-faint)" },
    { key: "Held in escrow", minor: inEscrowMinor, color: "var(--signal)" },
  ];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-vellum" aria-hidden>
        {segments.map((s) => (s.minor > 0 ? <div key={s.key} style={{ width: `${(s.minor / base) * 100}%`, background: s.color }} /> : null))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {segments
          .filter((s) => s.key !== "Platform fee" || s.minor > 0)
          .map((s) => (
            <div key={s.key}>
              <dt className="flex items-center gap-1.5 text-ink-soft">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.key}
              </dt>
              <dd className="num text-base font-semibold">{formatMinor(s.minor)}</dd>
            </div>
          ))}
      </dl>
      {fundedMinor === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Nothing captured yet. Funding needed: {formatMinor(expectedMinor)}.</p>
      ) : null}
    </div>
  );
}
