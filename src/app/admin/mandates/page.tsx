import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";
import { Panel, Pill } from "@/components/ui";
import { AgentStatusToggle } from "./agent-status";

export const metadata: Metadata = { title: "Agents and mandates" };
export const dynamic = "force-dynamic";

const COLUMNS: ColumnSpec[] = [
  { field: "at", header: "When", kind: "datetime", width: 170 },
  { field: "gate", header: "Gate", width: 80 },
  { field: "action", header: "Action", width: 120 },
  { field: "result", header: "Result", kind: "status", width: 110, tones: { allow: "good", deny: "bad", step_up: "warn" } },
  { field: "reasons", header: "Reason codes", kind: "code", flex: 1 },
  { field: "message", header: "Message", flex: 2 },
  { field: "mandate", header: "Mandate", kind: "link", width: 200 },
];

export default async function AdminMandates() {
  const c = await getContainer();
  const [rows, clients] = await Promise.all([c.analytics.mandateChecksGrid(), c.analytics.agentClients()]);
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Agents and mandates</h1>
      <p className="mt-1 max-w-[70ch] text-ink-soft">Every decision the Mandate Guard made, at every gate. Suspend an agent to refuse all its API calls immediately.</p>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((a) => (
          <Panel key={a.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold">{a.name}</p>
              <p className="text-xs text-ink-soft">Owned by {a.owner}</p>
              <div className="mt-1">
                <Pill tone={a.status === "active" ? "good" : "bad"}>{a.status}</Pill>
              </div>
            </div>
            <AgentStatusToggle clientId={a.id} status={a.status} />
          </Panel>
        ))}
      </section>
      <div className="mt-6">
        <DataGrid rows={rows} columns={COLUMNS} exportName="settleai-mandate-checks" />
      </div>
    </main>
  );
}
