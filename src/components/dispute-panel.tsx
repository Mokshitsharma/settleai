"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DisputeProposal, FaultClass } from "@/core/contracts";
import { formatMinor, parseMajor } from "@/core/money";
import { api } from "@/lib/api";
import { Button, Pill, type Tone } from "./ui";

export interface DisputeProps {
  id: string;
  status: string;
  reason: string;
  openedBySide: "payer" | "worker";
  deadlineAt: string;
  disputedAmountMinor: number;
  evidence: { id: string; side: "payer" | "worker"; kind: string; content: string | null }[];
  proposal: (DisputeProposal & { payerResponse: string | null; workerResponse: string | null }) | null;
  reportSummary: string | null;
  resolution: { releaseToWorkerMinor: number; refundToPayerMinor: number; faultClass: string; resolvedBy: string } | null;
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  EVIDENCE_WINDOW: { label: "Collecting evidence", tone: "warn" },
  AI_PROPOSED: { label: "Proposal ready", tone: "info" },
  ESCALATED: { label: "With an admin", tone: "bad" },
  ACCEPTED_BOTH: { label: "Accepted by both", tone: "good" },
  ADMIN_RESOLVED: { label: "Decided by admin", tone: "good" },
  EXECUTED: { label: "Settled", tone: "good" },
};

const FAULT: Record<FaultClass, string> = {
  WORKER_NONPERFORMANCE: "Worker did not perform",
  WORKER_PARTIAL: "Work partly done",
  PAYER_UNSUPPORTED_CLAIM: "Claim not supported by evidence",
  SPEC_AMBIGUITY: "Unclear agreement, shared",
  AGENT_SCOPE_VIOLATION: "Agent acted outside its mandate",
  PLATFORM_FAILURE: "Platform failure",
};

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    busy,
    error,
    run: async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}

export function OpenDispute({ milestoneId, label }: { milestoneId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun();
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="mt-3">
        {label}
      </Button>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-vellum p-3">
      <label htmlFor={`reason-${milestoneId}`} className="text-sm font-semibold">
        What went wrong?
      </label>
      <textarea id={`reason-${milestoneId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-vellum px-3 py-2 text-sm outline-none focus:border-signal" />
      <div className="mt-2 flex gap-2">
        <Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => run(() => api(`/api/milestones/${milestoneId}/dispute`, { body: { reason } }))}>
          Open dispute and freeze payout
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </div>
  );
}

function SplitBar({ release, refund }: { release: number; refund: number }) {
  const total = Math.max(release + refund, 1);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-vellum" aria-hidden>
        <div style={{ width: `${(release / total) * 100}%`, background: "var(--seal)" }} />
        <div style={{ width: `${(refund / total) * 100}%`, background: "var(--hold)" }} />
      </div>
      <div className="mt-1.5 flex justify-between text-sm">
        <span>
          Worker gets <span className="num font-semibold">{formatMinor(release)}</span>
        </span>
        <span>
          Payer gets back <span className="num font-semibold">{formatMinor(refund)}</span>
        </span>
      </div>
    </div>
  );
}

export function DisputePanel({ d, viewer }: { d: DisputeProps; viewer: "payer" | "worker" | "admin" | "other" }) {
  const { busy, error, run } = useRun();
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [adminRelease, setAdminRelease] = useState(((d.proposal?.proposal.releaseToWorkerMinor ?? Math.round(d.disputedAmountMinor / 2)) / 100).toFixed(2));
  const [adminFault, setAdminFault] = useState<FaultClass>(d.proposal?.liability.faultClass ?? "SPEC_AMBIGUITY");
  const [adminNote, setAdminNote] = useState("");
  const status = STATUS[d.status] ?? { label: d.status, tone: "neutral" as Tone };
  const party = viewer === "payer" || viewer === "worker";
  const myResponse = d.proposal ? (viewer === "payer" ? d.proposal.payerResponse : viewer === "worker" ? d.proposal.workerResponse : null) : null;

  async function addEvidence() {
    const form = new FormData();
    if (text.trim()) form.append("text", text.trim());
    if (photo) form.append("photo", photo);
    const res = await fetch(`/api/disputes/${d.id}/evidence`, { method: "POST", body: form });
    if (!res.ok) throw new Error(((await res.json()) as { error?: { message: string } }).error?.message ?? "Could not add evidence");
    setText("");
    setPhoto(null);
  }

  return (
    <section aria-label="Dispute" className="mt-4 rounded-[10px] border-2 border-deny/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Dispute over {formatMinor(d.disputedAmountMinor)}</h4>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Opened by the {d.openedBySide}: “{d.reason}”
      </p>

      {d.evidence.length ? (
        <ul className="mt-3 space-y-2 text-sm">
          {d.evidence.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="w-14 shrink-0 text-xs font-semibold capitalize text-ink-faint">{e.side}</span>
              {e.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked evidence image
                <img src={`/api/dispute-evidence/${e.id}/image`} alt={`Evidence from the ${e.side}`} className="h-20 w-28 rounded-md border border-vellum object-cover" />
              ) : (
                <span>{e.content}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {d.status === "EVIDENCE_WINDOW" && party ? (
        <div className="mt-3 rounded-md bg-paper p-3">
          <p className="text-xs text-ink-soft" suppressHydrationWarning>
            Evidence closes at {new Date(d.deadlineAt).toLocaleTimeString()}. Then the arbiter proposes a split.
          </p>
          <textarea
            aria-label="Your statement"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Your side, with facts: what, how many, when"
            className="mt-2 w-full rounded-md border border-vellum bg-surface px-3 py-2 text-sm outline-none focus:border-signal"
          />
          <input aria-label="Evidence photo" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="mt-2 block text-sm" />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || (!text.trim() && !photo)} onClick={() => run(addEvidence)}>
              Add evidence
            </Button>
            <Button disabled={busy} onClick={() => run(() => api(`/api/disputes/${d.id}/propose`, { method: "POST" }))}>
              {busy ? "Working…" : "Ask the arbiter now"}
            </Button>
          </div>
        </div>
      ) : null}

      {d.proposal ? (
        <div className="mt-4 rounded-md border border-vellum bg-surface p-3">
          <p className="text-sm font-semibold">{d.status === "EXECUTED" && d.resolution?.resolvedBy === "admin" ? "Arbiter proposal (overruled by admin)" : "Arbiter proposal"}</p>
          <div className="mt-2">
            <SplitBar release={d.proposal.proposal.releaseToWorkerMinor} refund={d.proposal.proposal.refundToPayerMinor} />
          </div>
          <p className="mt-3 text-sm leading-relaxed">{d.proposal.proposal.rationale}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-soft">Liability</dt>
            <dd className="font-semibold">
              {FAULT[d.proposal.liability.faultClass]} <span className="font-normal text-ink-soft">(borne by {d.proposal.liability.bearer.replace("_", " ")})</span>
            </dd>
            <dt className="text-ink-soft">Based on</dt>
            <dd>
              {d.proposal.liability.basis.map((b) => (
                <code key={b} className="mr-1.5 font-mono text-xs text-ink-soft">
                  {b}
                </code>
              ))}
            </dd>
            {d.reportSummary ? (
              <>
                <dt className="text-ink-soft">Mandate check</dt>
                <dd>{d.reportSummary}</dd>
              </>
            ) : null}
            <dt className="text-ink-soft">Confidence</dt>
            <dd className="num">{Math.round(d.proposal.confidence * 100)}%</dd>
          </dl>
          {d.proposal.findings.contestedFacts.length ? <p className="mt-2 text-xs text-ink-soft">Contested: {d.proposal.findings.contestedFacts.join("; ")}</p> : null}
          {d.proposal.reasonsIfHuman.length ? <p className="mt-2 text-xs text-deny">Needs a person: {d.proposal.reasonsIfHuman.join("; ")}</p> : null}
          <p className="mt-2 text-xs text-ink-faint">
            Payer: {d.proposal.payerResponse ?? "no answer yet"}. Worker: {d.proposal.workerResponse ?? "no answer yet"}.
          </p>
          {d.status === "AI_PROPOSED" && party && !myResponse ? (
            <div className="mt-3 flex gap-2">
              <Button disabled={busy} onClick={() => run(() => api(`/api/disputes/${d.id}/respond`, { body: { accept: true } }))}>
                Accept
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/disputes/${d.id}/respond`, { body: { accept: false } }))}>
                Reject and ask an admin
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {d.status === "ESCALATED" && viewer === "admin" ? (
        <div className="mt-4 rounded-md border border-vellum p-3 text-sm">
          <p className="font-semibold">Your decision</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label>
              Worker gets, USD
              <input inputMode="decimal" value={adminRelease} onChange={(e) => setAdminRelease(e.target.value)} className="num mt-1 block w-28 rounded-md border border-vellum px-2 py-1.5" />
            </label>
            <label>
              Liability
              <select value={adminFault} onChange={(e) => setAdminFault(e.target.value as FaultClass)} className="mt-1 block rounded-md border border-vellum px-2 py-1.5">
                {(Object.keys(FAULT) as FaultClass[]).map((f) => (
                  <option key={f} value={f}>
                    {FAULT[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea aria-label="Reason for the decision" value={adminNote} onChange={(e) => setAdminNote(e.target.value)} rows={2} placeholder="Why? Recorded in the proof chain." className="mt-2 w-full rounded-md border border-vellum px-3 py-2" />
          <Button
            className="mt-2"
            disabled={busy || adminNote.trim().length < 3}
            onClick={() => run(() => api(`/api/disputes/${d.id}/resolve`, { body: { releaseToWorkerMinor: parseMajor(adminRelease || "0"), faultClass: adminFault, note: adminNote } }))}
          >
            Settle dispute
          </Button>
        </div>
      ) : null}

      {d.resolution ? (
        <p className="mt-3 rounded-md bg-seal-wash px-3 py-2 text-sm text-seal">
          Settled through PayPal: {formatMinor(d.resolution.releaseToWorkerMinor)} paid to the worker, {formatMinor(d.resolution.refundToPayerMinor)} refunded to the payer.
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </section>
  );
}
