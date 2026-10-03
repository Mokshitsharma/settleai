"use client";

import { useEffect, useState } from "react";

interface ActivityEvent {
  id: number;
  type: string;
  at: string;
  message: string;
}

const DOT: Record<string, string> = {
  "agent.fallback": "var(--hold)",
  "payout.failed": "var(--deny)",
  "payout.succeeded": "var(--seal)",
  "job.funded": "var(--seal)",
  "admin.alert": "var(--deny)",
};

/** Live feed of agent and money events for a job (SSE). The hero of the demo (spec §13.2). */
export function ActivityPanel({ jobId, initial }: { jobId: string; initial: ActivityEvent[] }) {
  const [events, setEvents] = useState<ActivityEvent[]>(initial);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/events/stream?jobId=${encodeURIComponent(jobId)}`);
    const onEvent = (e: MessageEvent) => {
      const data = JSON.parse(e.data) as ActivityEvent;
      setEvents((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data].slice(-60)));
    };
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = onEvent;
    const types = ["agent.step", "agent.done", "agent.fallback", "job.created", "job.funded", "job.accepted", "funding.order_created", "funding.captured", "payout.submitted", "payout.succeeded", "payout.failed", "payout.status", "refund.completed", "refund.pending"];
    types.forEach((t) => es.addEventListener(t, onEvent as EventListener));
    return () => es.close();
  }, [jobId]);

  return (
    <aside aria-live="polite" className="rounded-[10px] border border-vellum bg-surface">
      <div className="flex items-center justify-between border-b border-vellum px-4 py-3">
        <h2 className="font-semibold">Live activity</h2>
        <span className={`text-xs ${connected ? "text-seal" : "text-ink-faint"}`}>{connected ? "Connected" : "Connecting"}</span>
      </div>
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-soft">Agent steps and PayPal updates appear here as they happen.</p>
      ) : (
        <ol className="max-h-[420px] space-y-3 overflow-y-auto px-4 py-4">
          {[...events].reverse().map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[e.type] ?? "var(--signal)" }} />
              <div>
                <p className="leading-snug">{e.message}</p>
                {/* Formatted in the viewer's own timezone, so server and client text legitimately differ. */}
                <time className="num text-xs text-ink-faint" dateTime={e.at} suppressHydrationWarning>
                  {new Date(e.at).toLocaleTimeString()}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
