"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuardDecision } from "@/core/contracts";
import { parseMajor } from "@/core/money";
import { api } from "@/lib/api";
import { Button, Panel } from "@/components/ui";

const PRESETS = [
  { label: "In scope", description: "Deliver 10 boxes of tea from Rajwada to Vijay Nagar today", budget: "80", category: "delivery" },
  { label: "Out of scope", description: "Buy gift card codes and repair the office AC", budget: "500", category: "delivery" },
];

interface Result {
  ok?: boolean;
  jobId?: string;
  decision: GuardDecision;
}

/** Denial Card (spec §13.2): reason codes, the clause violated, and what the agent can do instead. */
function DecisionResult({ result }: { result: Result }) {
  const allowed = result.decision.result === "allow";
  return (
    <div role="status" className={`mt-4 rounded-[10px] border-2 p-4 ${allowed ? "border-seal bg-seal-wash/40" : "border-deny bg-deny-wash/40"}`}>
      <p className={`font-semibold ${allowed ? "text-seal" : "text-deny"}`}>{allowed ? "Allowed by the mandate" : "Denied before any money moved"}</p>
      {result.decision.reasonCodes.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {result.decision.reasonCodes.map((c) => (
            <li key={c}>
              <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-deny">{c}</code>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed">{result.decision.message}</p>
      {result.jobId ? (
        <Link href={`/jobs/${result.jobId}`} className="mt-3 inline-block text-sm font-semibold text-signal hover:text-signal-ink">
          Review and fund the job the agent created
        </Link>
      ) : null}
    </div>
  );
}

export function AgentRequestPanel({ mandates }: { mandates: { id: string; label: string; categories: string[] }[] }) {
  const router = useRouter();
  // Presets are about deliveries, so start on a mandate that covers deliveries when there is one.
  const forCategory = (category: string) => mandates.find((m) => m.categories.includes(category))?.id ?? mandates[0]?.id ?? "";
  const [mandateId, setMandateId] = useState(() => forCategory("delivery"));
  const [description, setDescription] = useState(PRESETS[0].description);
  const [budget, setBudget] = useState(PRESETS[0].budget);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"check" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "check" | "send") {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const amountMinor = parseMajor(budget);
      const r =
        kind === "check"
          ? await api<Result>("/api/mandates/check", { body: { mandateId, description, amountMinor } })
          : await api<Result>("/api/dev/agent-request", { body: { mandateId, description, budgetMinor: amountMinor } });
      setResult(r);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!mandates.length) return null;
  return (
    <Panel className="p-5">
      <h2 className="text-lg font-semibold">Send a request as the agent</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Runs exactly what the agent&apos;s API call runs: the Mandate Guard decides, then the scoping agent drafts the job. The live agent
        connects through MCP; this button lets you try it without one.
      </p>
      <div className="mt-3 flex gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setDescription(p.description);
              setBudget(p.budget);
              setMandateId(forCategory(p.category));
              setResult(null);
            }}
            className="rounded-full border border-vellum px-3 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium">
        Mandate
        <select value={mandateId} onChange={(e) => setMandateId(e.target.value)} className="mt-1 w-full rounded-md border border-vellum bg-surface px-3 py-2 outline-none focus:border-signal">
          {mandates.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-sm font-medium">
        The agent asks to hire for
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-vellum bg-surface px-3 py-2 outline-none focus:border-signal" />
      </label>
      <label className="mt-3 block text-sm font-medium">
        Budget, USD
        <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className="num mt-1 w-32 rounded-md border border-vellum bg-surface px-3 py-2 outline-none focus:border-signal" />
      </label>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => go("send")} disabled={busy !== null || !mandateId}>
          {busy === "send" ? "Agent is asking…" : "Send as agent"}
        </Button>
        <Button variant="secondary" onClick={() => go("check")} disabled={busy !== null || !mandateId}>
          {busy === "check" ? "Checking…" : "Only check, don't create"}
        </Button>
      </div>
      {result ? <DecisionResult result={result} /> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-deny">{error}</p> : null}
    </Panel>
  );
}
