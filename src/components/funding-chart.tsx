"use client";

// Daily confirmed funding, stacked by who initiated the job (spec F35). Two categorical series validated
// with the dataviz palette checker: human #2B4BEE, agent #C2569B (CVD ΔE 15.1, all checks pass).
import { useState } from "react";
import type { DailyFunding } from "@/core/services/analytics";
import { formatMinor } from "@/core/money";

const SERIES = [
  { key: "humanMinor", label: "Hired by a person", color: "#2B4BEE" },
  { key: "agentMinor", label: "Hired by an AI agent", color: "#C2569B" },
] as const;

export function FundingChart({ data }: { data: DailyFunding[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = Math.max(1, ...data.map((d) => d.humanMinor + d.agentMinor));
  const niceMax = Math.ceil(max / 5000) * 5000;
  const slot = plotW / data.length;
  const barW = Math.min(28, slot * 0.6);
  const y = (v: number) => plotH - (v / niceMax) * plotH;
  const ticks = [0, niceMax / 2, niceMax];

  return (
    <figure>
      <div className="mb-2 flex flex-wrap gap-4 text-sm" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily funding over the last 14 days, split by person or AI agent">
        <g transform={`translate(${pad.left},${pad.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--vellum)" strokeWidth={1} />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--ink-faint)" className="num">
                {formatMinor(t).replace(".00", "")}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * slot + (slot - barW) / 2;
            const hY = y(d.humanMinor);
            const aTop = y(d.humanMinor + d.agentMinor);
            const both = d.humanMinor > 0 && d.agentMinor > 0;
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* Hit target bigger than the bar */}
                <rect x={i * slot} y={0} width={slot} height={plotH} fill="transparent" />
                {d.humanMinor > 0 ? <rect x={x} y={hY} width={barW} height={plotH - hY} rx={d.agentMinor > 0 ? 0 : 4} fill={SERIES[0].color} /> : null}
                {d.agentMinor > 0 ? <rect x={x} y={aTop} width={barW} height={Math.max(0, hY - aTop - (both ? 2 : 0))} rx={4} fill={SERIES[1].color} /> : null}
                {i % 2 === 0 || i === data.length - 1 ? (
                  <text x={i * slot + slot / 2} y={plotH + 17} textAnchor="middle" fontSize={11} fill="var(--ink-faint)">
                    {new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {hover !== null ? (
        <p role="status" className="mt-1 text-sm">
          <span className="font-semibold">{new Date(data[hover].day).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</span>: {formatMinor(data[hover].humanMinor)} hired by a person,{" "}
          {formatMinor(data[hover].agentMinor)} by an AI agent
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-faint">Hover a day for exact amounts.</p>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-soft">Show as a table</summary>
        <table className="mt-2 w-full max-w-md text-left">
          <thead className="text-ink-soft">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Person</th>
              <th className="py-1 text-right font-medium">AI agent</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-t border-vellum">
                <td className="py-1">{d.day}</td>
                <td className="num py-1 text-right">{formatMinor(d.humanMinor)}</td>
                <td className="num py-1 text-right">{formatMinor(d.agentMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
