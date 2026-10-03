// Decision Card (spec §13.2): verdict, score, signals with weights, per-criterion results with evidence,
// policy version and a plain-English explanation. Shared by worker, payer and admin views.
import type { DecisionCard as Card } from "@/core/policy/decision-card";
import { Pill, type Tone } from "./ui";

const DECISION: Record<Card["decision"], { label: string; tone: Tone; ring: string }> = {
  AUTO_RELEASE: { label: "Approved by policy", tone: "good", ring: "var(--seal)" },
  HUMAN_REVIEW: { label: "Needs a person", tone: "warn", ring: "var(--hold)" },
  HOLD: { label: "Held", tone: "bad", ring: "var(--deny)" },
};

const VERDICT: Record<string, { mark: string; color: string; label: string }> = {
  pass: { mark: "✓", color: "var(--seal)", label: "Passed" },
  fail: { mark: "✕", color: "var(--deny)", label: "Failed" },
  unclear: { mark: "?", color: "var(--hold)", label: "Unclear" },
};

const SIGNAL_LABEL: Record<string, string> = {
  LOW_VERIFICATION_CONFIDENCE: "Low verification confidence",
  CRITERION_UNCLEAR: "Criterion unclear",
  CRITERION_FAIL: "Criterion failed",
  DUP_IMAGE: "Photo used before",
  GPS_MISMATCH: "Wrong location",
  EXIF_TIME_MISMATCH: "Capture time off",
  NO_EXIF: "No photo metadata",
  INJECTION_SUSPECTED: "Instructions hidden in evidence",
  AMOUNT_ANOMALY: "Unusual amount",
  LOW_TRUST: "Low trust score",
  HIGH_TRUST: "High trust score",
  FIRST_TIME_PAIR: "First job together",
  PAYOUT_DEST_RECENT: "Payout email just changed",
  VELOCITY: "Many recent payouts",
  PAYER_DISPUTE_RATE: "Payer disputes often",
  ABOVE_AUTO_RELEASE_LIMIT: "Above auto-release limit",
};

function Gauge({ score, color }: { score: number; color: string }) {
  const r = 26;
  const circumference = Math.PI * r; // half circle
  return (
    <svg width="72" height="44" viewBox="0 0 72 44" role="img" aria-label={`Risk score ${score} of 100`}>
      <path d="M8 38 A28 28 0 0 1 64 38" fill="none" stroke="var(--vellum)" strokeWidth="7" strokeLinecap="round" transform="translate(0 0)" />
      <path
        d={`M10 38 A${r} ${r} 0 0 1 62 38`}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(Math.min(score, 100) / 100) * circumference} ${circumference}`}
      />
      <text x="36" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)" className="num">
        {score}
      </text>
    </svg>
  );
}

export function DecisionCardView({ card, proofImages }: { card: Card; proofImages: Record<string, boolean> }) {
  const d = DECISION[card.decision];
  const evidence = [...new Set(card.criteria.flatMap((c) => c.evidenceRefs))].filter((id) => proofImages[id]);
  return (
    <section aria-label="Decision" className="mt-4 rounded-[10px] border-2 p-4" style={{ borderColor: d.ring }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Pill tone={d.tone}>{d.label}</Pill>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed">{card.explanation}</p>
        </div>
        <div className="text-center text-xs text-ink-faint">
          <Gauge score={card.score} color={d.ring} />
          <div>risk score</div>
        </div>
      </div>

      {evidence.length ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {evidence.map((id) => (
            // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked proof images
            <img key={id} src={`/api/proofs/${id}/image`} alt={`Evidence ${id}`} className="h-24 w-32 shrink-0 rounded-md border border-vellum object-cover" />
          ))}
        </div>
      ) : null}

      <ul className="mt-3 space-y-1.5 text-sm">
        {card.criteria.map((c) => {
          const v = VERDICT[c.verdict];
          return (
            <li key={c.criterionId} className="grid grid-cols-[1.25rem_1fr] gap-x-2">
              <span aria-label={v.label} className="font-bold" style={{ color: v.color }}>
                {v.mark}
              </span>
              <span>
                {c.text}
                <span className="block text-xs text-ink-soft">{c.rationale}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {card.signals.some((s) => s.points !== 0) ? (
        <div className="mt-3 border-t border-vellum pt-2">
          <h4 className="text-xs font-semibold text-ink-soft">What moved the score</h4>
          <ul className="mt-1 space-y-0.5 text-xs">
            {card.signals
              .filter((s) => s.points !== 0)
              .map((s, i) => (
                <li key={`${s.code}-${i}`} className="flex justify-between gap-3">
                  <span>
                    {SIGNAL_LABEL[s.code] ?? s.code}: <span className="text-ink-soft">{s.detail}</span>
                  </span>
                  <span className="num shrink-0 font-semibold">{s.points > 0 ? `+${s.points}` : s.points}</span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-ink-faint">
        Policy v{card.policyVersion}, verified by {card.model === "stub" ? "the offline AI stub" : card.model === "none" ? "rules only" : card.model}
      </p>
    </section>
  );
}
