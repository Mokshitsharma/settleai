import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";

export const metadata: Metadata = { title: "AI runs" };
export const dynamic = "force-dynamic";

const COLUMNS: ColumnSpec[] = [
  { field: "at", header: "When", kind: "datetime", width: 170 },
  { field: "agent", header: "Agent", width: 120 },
  { field: "status", header: "Result", kind: "status", width: 130, tones: { ok: "good", invalid_output: "warn", error: "bad", fallback: "bad" } },
  { field: "model", header: "Model", width: 120 },
  { field: "promptVersion", header: "Prompt", kind: "code", width: 140 },
  { field: "latencyMs", header: "Latency ms", kind: "number", width: 110 },
  { field: "tokensIn", header: "Tokens in", kind: "number", width: 100 },
  { field: "tokensOut", header: "Tokens out", kind: "number", width: 100 },
  { field: "entity", header: "About", kind: "code", flex: 1 },
  { field: "output", header: "Output (start)", kind: "code", flex: 2 },
  { field: "trace", header: "Trace", kind: "code", width: 200, hide: true },
];

export default async function TracesPage() {
  const c = await getContainer();
  const rows = await c.analytics.tracesGrid();
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">AI runs</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        Every agent call with its prompt version, model, tokens, latency and output. Invalid outputs are retried once, then fall back to a person.
      </p>
      <div className="mt-6">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-ai-runs" height={600} />
      </div>
    </main>
  );
}
