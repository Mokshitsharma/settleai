"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MandateView } from "@/core/services/mandates";
import { formatMinor } from "@/core/money";
import { api } from "@/lib/api";
import { Seal } from "@/components/seal";
import { Button, Hash, Panel, Pill } from "@/components/ui";

const STATUS = {
  active: { label: "Active", tone: "good" },
  revoked: { label: "Revoked", tone: "bad" },
  expired: { label: "Expired", tone: "neutral" },
  exhausted: { label: "Budget used up", tone: "neutral" },
  consumed: { label: "Used", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
} as const;

/** Mandate Card (spec §13.2): plain-language terms, budget meter, validity, seal and a Revoke button. */
export function MandateCard({ mandate, fresh = false }: { mandate: MandateView; fresh?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = mandate.envelope.payload;
  if (p.type !== "intent") return null;
  const total = p.scope.maxTotalMinor;
  const pct = Math.min(100, Math.round((mandate.spentMinor / Math.max(total, 1)) * 100));
  const status = STATUS[mandate.status as keyof typeof STATUS] ?? STATUS.draft;
  const active = mandate.status === "active";
  const keyMode = mandate.envelope.signatures[0]?.keyId;

  async function revoke() {
    if (!confirm(`Revoke ${p.type === "intent" ? p.agent.name : "this agent"}'s permission now? Pending payouts under it will pause.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/mandates/${mandate.id}/revoke`, { body: { reason: "Revoked by principal" } });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel as="article" className={`p-5 ${active ? "" : "bg-paper"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">
              <Link href={`/mandates/${mandate.id}`} className="hover:text-signal">
                {p.agent.name}
              </Link>
            </h3>
            <Pill tone={status.tone}>{status.label}</Pill>
          </div>
          <p className="mt-3 leading-relaxed">{mandate.plainLanguage}</p>
        </div>
        <div className="shrink-0">
          <Seal hash={mandate.envelope.payloadHash} label={active ? "Signed" : status.label} tone={active ? "good" : mandate.status === "revoked" ? "bad" : "ink"} size={84} animate={fresh} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span className="text-ink-soft">Spent</span>
          <span className="num">
            {formatMinor(mandate.spentMinor)} of {formatMinor(total)}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-vellum" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
          <div className="h-full rounded-full bg-signal" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-vellum pt-3 text-xs text-ink-faint">
        <span>
          Hash <Hash value={mandate.envelope.payloadHash} chars={16} /> key <Hash value={keyMode ?? ""} chars={14} />
        </span>
        {mandate.revokedAt ? (
          <span>
            Revoked {new Date(mandate.revokedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST
          </span>
        ) : null}
        {active ? (
          <Button variant="danger" onClick={revoke} disabled={busy} className="px-3 py-1.5 text-xs">
            {busy ? "Revoking…" : "Revoke"}
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </Panel>
  );
}
