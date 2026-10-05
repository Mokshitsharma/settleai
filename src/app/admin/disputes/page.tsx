import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";

export const metadata: Metadata = { title: "Disputes" };
export const dynamic = "force-dynamic";

const COLUMNS: ColumnSpec[] = [
  { field: "job", header: "Job", kind: "link", flex: 2 },
  { field: "milestone", header: "Milestone", width: 130 },
  { field: "status", header: "Status", kind: "status", width: 140, tones: { EXECUTED: "good", ESCALATED: "bad", AI_PROPOSED: "info", EVIDENCE_WINDOW: "warn" } },
  { field: "faultClass", header: "Liability", kind: "status", width: 200, tones: { WORKER_PARTIAL: "warn", WORKER_NONPERFORMANCE: "bad", PAYER_UNSUPPORTED_CLAIM: "info", AGENT_SCOPE_VIOLATION: "bad", SPEC_AMBIGUITY: "neutral" } },
  { field: "releaseMinor", header: "To worker", kind: "money", width: 110 },
  { field: "refundMinor", header: "To payer", kind: "money", width: 110 },
  { field: "confidence", header: "Arbiter confidence", kind: "percent", width: 150 },
  { field: "resolvedBy", header: "Settled by", width: 120 },
  { field: "reason", header: "Reason", flex: 1 },
  { field: "at", header: "Opened", kind: "datetime", width: 170 },
];

export default async function DisputesPage() {
  const c = await getContainer();
  const rows = await c.analytics.disputesGrid();
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Disputes</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">Every dispute with the arbiter&apos;s liability finding and how it was settled through PayPal. Escalated ones need you.</p>
      <div className="mt-6">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-disputes" emptyMessage="No disputes yet." />
      </div>
    </main>
  );
}
