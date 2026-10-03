"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobSpec } from "@/core/contracts";
import { formatMinor, parseMajor } from "@/core/money";
import { api } from "@/lib/api";
import { Button, Panel } from "@/components/ui";

const EXAMPLES = [
  "Deliver 20 cartons of tea from Rajwada to my shop in Vijay Nagar by 6 pm today. Budget $100.",
  "Design a logo for my tea shop as a PNG with a light and a dark version. Budget $60.",
  "Fix the leaking kitchen tap at our Palasia office tomorrow morning. Budget $40.",
];

interface Step {
  message: string;
  at: string;
}

/** Reads the scoping endpoint's SSE response from a POST (EventSource only supports GET). */
async function streamScope(text: string, onStep: (s: Step) => void): Promise<{ spec?: JobSpec; error?: string }> {
  const res = await fetch("/api/jobs/scope", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    return { error: data.error?.message ?? "The scoping agent is unavailable" };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: { spec?: JobSpec; error?: string } = { error: "No result" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === "step") onStep(parsed);
      if (event === "result") outcome = { spec: parsed.spec };
      if (event === "fallback") outcome = { error: `The scoping agent could not produce a valid draft (${parsed.error}). Try rephrasing.` };
    }
  }
  return outcome;
}

export function ScopeStudio() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [spec, setSpec] = useState<JobSpec | null>(null);
  const [busy, setBusy] = useState<"scoping" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function draft() {
    setBusy("scoping");
    setError(null);
    setSteps([]);
    setSpec(null);
    const result = await streamScope(text, (s) => setSteps((prev) => [...prev, s]));
    if (result.spec) setSpec(result.spec);
    else setError(result.error ?? "Something went wrong");
    setBusy(null);
  }

  function updateMilestone(i: number, patch: Partial<JobSpec["milestones"][number]>) {
    if (!spec) return;
    const milestones = spec.milestones.map((m, j) => (j === i ? { ...m, ...patch } : m));
    setSpec({ ...spec, milestones, totalAmountMinor: milestones.reduce((a, m) => a + m.amountMinor, 0) });
  }

  async function create() {
    if (!spec) return;
    setBusy("creating");
    setError(null);
    try {
      const { job } = await api<{ job: { id: string } }>("/api/jobs", { body: { spec } });
      router.push(`/jobs/${job.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const unpriced = spec?.milestones.some((m) => m.amountMinor <= 0);

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section>
        <label htmlFor="job-text" className="text-sm font-semibold">
          What needs doing?
        </label>
        <textarea
          id="job-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder="Who, what, where, by when, and your budget"
          className="mt-2 w-full rounded-md border border-vellum bg-surface px-3 py-2.5 leading-relaxed outline-none focus:border-signal"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-vellum bg-surface px-3 py-1 text-left text-xs text-ink-soft hover:border-ink-faint hover:text-ink">
              {ex.split(".")[0]}
            </button>
          ))}
        </div>
        <Button onClick={draft} disabled={busy !== null || text.trim().length < 10} className="mt-4">
          {busy === "scoping" ? "Drafting milestones…" : spec ? "Redraft" : "Draft milestones"}
        </Button>

        {steps.length ? (
          <ol aria-live="polite" className="mt-6 space-y-2 border-l-2 border-vellum pl-4 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="text-ink-soft">
                {s.message}
              </li>
            ))}
          </ol>
        ) : null}
        {error ? <p role="alert" className="mt-4 text-sm text-deny">{error}</p> : null}
      </section>

      <section aria-label="Draft job">
        {!spec ? (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[10px] border border-dashed border-vellum p-8 text-center text-sm text-ink-soft">
            The draft appears here: milestones, amounts and the proof each one needs.
          </div>
        ) : (
          <Panel className="p-5">
            <input
              aria-label="Job title"
              value={spec.title}
              onChange={(e) => setSpec({ ...spec, title: e.target.value })}
              className="w-full rounded border border-transparent bg-transparent text-xl font-semibold outline-none hover:border-vellum focus:border-signal"
            />
            <p className="mt-1 text-sm capitalize text-ink-soft">
              {spec.category.replace("_", " ")}
              {spec.location ? `, ${spec.location.label}` : ""}
            </p>

            {spec.clarifyingQuestions.length ? (
              <div className="mt-4 rounded-md bg-hold-wash p-3 text-sm">
                <p className="font-semibold text-hold">The agent needs answers before this can be funded</p>
                <ul className="mt-1 list-disc pl-5">
                  {spec.clarifyingQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ol className="mt-5 space-y-5">
              {spec.milestones.map((m, i) => (
                <li key={m.seq} className="border-t border-vellum pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <input
                      aria-label={`Milestone ${m.seq} title`}
                      value={m.title}
                      onChange={(e) => updateMilestone(i, { title: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent font-semibold outline-none hover:border-vellum focus:border-signal"
                    />
                    <label className="flex items-center gap-1 text-sm">
                      <span className="text-ink-soft">$</span>
                      <input
                        aria-label={`Milestone ${m.seq} amount in dollars`}
                        inputMode="decimal"
                        defaultValue={(m.amountMinor / 100).toFixed(2)}
                        onBlur={(e) => {
                          try {
                            updateMilestone(i, { amountMinor: Math.max(0, parseMajor(e.target.value || "0")) });
                          } catch {
                            e.target.value = (m.amountMinor / 100).toFixed(2);
                          }
                        }}
                        className="num w-24 rounded-md border border-vellum px-2 py-1 text-right outline-none focus:border-signal"
                      />
                    </label>
                  </div>
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {m.acceptanceCriteria.map((cr, k) => (
                      <li key={cr.id} className="flex items-start gap-2">
                        <input
                          aria-label={`Criterion ${cr.id}`}
                          value={cr.text}
                          onChange={(e) =>
                            updateMilestone(i, {
                              acceptanceCriteria: m.acceptanceCriteria.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)),
                            })
                          }
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent text-ink-soft outline-none hover:border-vellum focus:border-signal"
                        />
                        {m.acceptanceCriteria.length > 1 ? (
                          <button
                            type="button"
                            aria-label={`Remove criterion ${cr.id}`}
                            onClick={() => updateMilestone(i, { acceptanceCriteria: m.acceptanceCriteria.filter((_, j) => j !== k) })}
                            className="px-1 text-ink-faint hover:text-deny"
                          >
                            ×
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>

            <div className="mt-5 flex items-center justify-between border-t border-vellum pt-4">
              <span className="text-sm text-ink-soft">Worker receives in total</span>
              <span className="num text-xl font-semibold">{formatMinor(spec.totalAmountMinor)}</span>
            </div>
            <Button onClick={create} disabled={busy !== null || unpriced} className="mt-4 w-full">
              {busy === "creating" ? "Creating job…" : "Create job"}
            </Button>
            {unpriced ? <p className="mt-2 text-sm text-hold">Set an amount for every milestone first.</p> : null}
          </Panel>
        )}
      </section>
    </div>
  );
}
