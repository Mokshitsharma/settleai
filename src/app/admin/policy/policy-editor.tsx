"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Policy } from "@/core/contracts";
import { api } from "@/lib/api";
import { Button, Panel } from "@/components/ui";

const FIELDS: { key: keyof Policy; label: string; help: string; step?: number }[] = [
  { key: "reviewAt", label: "Send to a person at risk score", help: "Scores at or above this need human review" },
  { key: "holdAt", label: "Hold at risk score", help: "Scores at or above this are held; no money moves" },
  { key: "autoReleaseMinConfidence", label: "Minimum verification confidence", help: "Below this, confidence adds risk (0 to 1)", step: 0.01 },
  { key: "maxAutoReleaseAmountMinor", label: "Largest automatic payout, cents", help: "Bigger milestones always need a person" },
  { key: "dupImagePhashMaxDistance", label: "Duplicate photo distance, bits", help: "Perceptual hash difference treated as the same photo" },
  { key: "gpsDefaultRadiusM", label: "Default GPS radius, metres", help: "Used when a criterion sets no radius" },
  { key: "exifWindowMinutes", label: "Photo freshness, minutes", help: "Photos older than this at submission are flagged" },
  { key: "payoutDestRecentHours", label: "Recent payout email change, hours", help: "A change inside this window adds risk" },
];

export function PolicyEditor({ policy }: { policy: Policy }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Policy>(policy);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const setNum = (key: keyof Policy, value: string) => setDraft({ ...draft, [key]: Number(value) });
  const setWeight = (code: string, value: string) => setDraft({ ...draft, weights: { ...draft.weights, [code]: Number(value) } });

  return (
    <Panel className="mt-6 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="font-medium">{f.label}</span>
            <input
              type="number"
              step={f.step ?? 1}
              value={String(draft[f.key])}
              onChange={(e) => setNum(f.key, e.target.value)}
              className="num mt-1 block w-full rounded-md border border-vellum px-3 py-2 outline-none focus:border-signal"
            />
            <span className="mt-0.5 block text-xs text-ink-faint">{f.help}</span>
          </label>
        ))}
      </div>
      <h3 className="mt-6 text-sm font-semibold">Signal weights (risk points)</h3>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {Object.entries(draft.weights).map(([code, w]) => (
          <label key={code} className="text-xs">
            <span className="font-mono text-ink-soft">{code}</span>
            <input
              type="number"
              value={String(w)}
              onChange={(e) => setWeight(code, e.target.value)}
              className="num mt-0.5 block w-full rounded-md border border-vellum px-2 py-1.5 text-sm outline-none focus:border-signal"
            />
          </label>
        ))}
      </div>
      <label className="mt-6 block text-sm font-medium">
        Why are you changing it?
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recorded in the audit log" className="mt-1 block w-full rounded-md border border-vellum px-3 py-2 outline-none focus:border-signal" />
      </label>
      <Button
        className="mt-4"
        disabled={busy || note.trim().length < 3}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { policy: p } = await api<{ policy: Policy }>("/api/admin/policy", { method: "PUT", body: { policy: draft, note } });
            setSaved(p.version);
            setNote("");
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save as a new version
      </Button>
      {saved ? <p className="mt-2 text-sm text-seal">Version {saved} is active. The next decision uses it.</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </Panel>
  );
}
