import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Evaluation" };
export const dynamic = "force-dynamic";

interface Report {
  generatedAt: string;
  llm: string;
  metrics: Record<string, number | null>;
  results: { id: string; title: string; category: string; expected: string; actual: string; pass: boolean; latencyMs: number; skipped?: string; error?: string }[];
}

const COLUMNS: ColumnSpec[] = [
  { field: "id", header: "ID", width: 80 },
  { field: "result", header: "Result", kind: "status", width: 110, tones: { pass: "good", fail: "bad", skipped: "neutral" } },
  { field: "category", header: "Area", width: 120 },
  { field: "title", header: "Scenario", flex: 2 },
  { field: "expected", header: "Expected", flex: 2 },
  { field: "actual", header: "Actual", flex: 2 },
  { field: "latencyMs", header: "Time ms", kind: "number", width: 100 },
];

const HEADLINES: { key: string; label: string; target: string; good: (v: number) => boolean; suffix: string }[] = [
  { key: "falseReleaseRatePct", label: "Bad proofs paid automatically", target: "target 0%", good: (v) => v === 0, suffix: "%" },
  { key: "mandateFalseAllowRatePct", label: "Out-of-mandate requests allowed", target: "target 0%", good: (v) => v === 0, suffix: "%" },
  { key: "tamperDetectionPct", label: "Receipt tampering caught", target: "target 100%", good: (v) => v === 100, suffix: "%" },
  { key: "injectionDetectionPct", label: "Prompt injection caught", target: "target 100%", good: (v) => v === 100, suffix: "%" },
  { key: "autoReleaseRecallPct", label: "Clean proofs paid automatically", target: "higher is faster", good: (v) => v >= 90, suffix: "%" },
  { key: "arbiterInvariantViolations", label: "Dispute splits that did not add up", target: "target 0", good: (v) => v === 0, suffix: "" },
];

export default async function EvalPage() {
  let report: Report | null = null;
  try {
    report = JSON.parse(await readFile(path.join(process.cwd(), "eval/report.json"), "utf8")) as Report;
  } catch {
    report = null;
  }
  if (!report) {
    return (
      <main>
        <h1 className="text-3xl font-bold tracking-tight">Evaluation</h1>
        <div className="mt-6">
          <EmptyState title="No evaluation report yet">Run pnpm eval to create one.</EmptyState>
        </div>
      </main>
    );
  }
  const m = report.metrics;
  const rows = report.results.map((r) => ({ ...r, result: r.skipped ? "skipped" : r.pass ? "pass" : "fail", actual: r.skipped ? r.skipped : (r.error ?? r.actual) }));
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Evaluation</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        The spec&apos;s {m.scenarios} test scenarios run end to end through the real services: {m.passed} of {m.ran} passed
        {m.skipped ? `, ${m.skipped} not applicable yet` : ""}. Agents: {report.llm}. Run{" "}
        {new Date(report.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST.
      </p>
      <section aria-label="Headline numbers" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {HEADLINES.map((h) => {
          const v = m[h.key];
          const ok = typeof v === "number" && h.good(v);
          return (
            <div key={h.key} className={`rounded-[10px] border p-4 ${ok ? "border-seal/40 bg-seal-wash/40" : "border-vellum bg-surface"}`}>
              <p className="text-sm text-ink-soft">{h.label}</p>
              <p className="num mt-1 text-2xl font-bold">{v === null || v === undefined ? "n/a" : `${v}${h.suffix}`}</p>
              <p className="text-xs text-ink-faint">{h.target}</p>
            </div>
          );
        })}
      </section>
      <div className="mt-6">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-eval" height={640} />
      </div>
    </main>
  );
}
