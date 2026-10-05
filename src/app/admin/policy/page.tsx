import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { diffPolicy } from "@/core/services/policy";
import { Panel, Pill } from "@/components/ui";
import { PolicyEditor } from "./policy-editor";

export const metadata: Metadata = { title: "Risk policy" };
export const dynamic = "force-dynamic";

export default async function PolicyPage() {
  const c = await getContainer();
  const [active, history] = await Promise.all([c.policy.active(), c.policy.history()]);
  return (
    <main className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section>
        <h1 className="text-3xl font-bold tracking-tight">Risk policy</h1>
        <p className="mt-1 max-w-[64ch] text-ink-soft">
          The rules that turn verification results into decisions. Saving creates a new version; the next decision uses it, and every Decision Card names
          the version it was made under.
        </p>
        <PolicyEditor policy={active} />
      </section>
      <section>
        <h2 className="text-lg font-semibold">Version history</h2>
        <ol className="mt-3 space-y-3">
          {history.map((h, i) => {
            const prev = history[i + 1];
            const changes = prev ? diffPolicy(prev.json, h.json) : [];
            return (
              <li key={h.version}>
                <Panel className="p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Version {h.version}</span>
                    {h.active ? <Pill tone="good">Active</Pill> : null}
                  </div>
                  <p className="text-xs text-ink-faint">
                    {new Date(h.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST, by {h.createdBy}
                  </p>
                  {changes.length ? (
                    <ul className="mt-2 space-y-0.5 font-mono text-xs">
                      {changes.map((ch) => (
                        <li key={ch}>{ch}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-ink-soft">{prev ? "No changes" : "Initial policy"}</p>
                  )}
                </Panel>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
