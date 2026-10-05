import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";

export const metadata: Metadata = { title: "Review queue" };
export const dynamic = "force-dynamic";

const COLUMNS: ColumnSpec[] = [
  { field: "waiting", header: "", kind: "status", width: 140, tones: { "Waiting for you": "bad" } },
  { field: "job", header: "Job", kind: "link", flex: 2 },
  { field: "milestone", header: "Milestone", width: 130 },
  { field: "decision", header: "Decision", kind: "status", width: 140, tones: { AUTO_RELEASE: "good", HUMAN_REVIEW: "warn", HOLD: "bad" } },
  { field: "score", header: "Risk", kind: "number", width: 85 },
  { field: "flags", header: "Flags", kind: "code", flex: 1 },
  { field: "amountMinor", header: "Amount", kind: "money", width: 110 },
  { field: "worker", header: "Worker", width: 110 },
  { field: "status", header: "Milestone now", kind: "status", width: 150, tones: { RELEASED: "good", RESOLVED: "good", NEEDS_REVIEW: "warn", HELD: "bad", REJECTED: "bad" } },
  { field: "at", header: "Decided", kind: "datetime", width: 170 },
  { field: "policyVersion", header: "Policy", kind: "number", width: 85, hide: true },
];

export default async function RiskQueue() {
  const c = await getContainer();
  const rows = await c.analytics.riskGrid();
  // Waiting items first; then everything else newest first.
  rows.sort((a, b) => Number(Boolean(b.waiting)) - Number(Boolean(a.waiting)));
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Review queue</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        Every automated decision, with the ones waiting for a person on top. Open a job to see the Decision Card with the evidence side by side,
        then approve or reject it.
      </p>
      <div className="mt-6">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-decisions" />
      </div>
    </main>
  );
}
