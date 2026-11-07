"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "./ui";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
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
  };
  return { busy, error, run };
}

/** Live countdown for the payer's challenge window; refreshes the page when the payout should be going out. */
export function ChallengeCountdown({ endsAt }: { endsAt: string }) {
  const router = useRouter();
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        clearInterval(t);
        setTimeout(() => router.refresh(), 2500);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [endsAt, router]);
  return (
    <p className="mt-3 rounded-md bg-hold-wash px-3 py-2 text-sm text-hold" suppressHydrationWarning>
      {left > 0 ? (
        <>
          Payer can dispute for{" "}
          <span className="num font-semibold" suppressHydrationWarning>
            {left}s
          </span>{" "}
          more, then PayPal pays out.
        </>
      ) : (
        "Challenge window closed: checking the mandate and paying out."
      )}
    </p>
  );
}

export function AdminReview({ milestoneId }: { milestoneId: string }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 rounded-md border border-vellum p-3">
      <label htmlFor={`note-${milestoneId}`} className="text-sm font-semibold">
        Your decision
      </label>
      <textarea
        id={`note-${milestoneId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What did you check? This is recorded in the proof chain."
        className="mt-1 w-full rounded-md border border-vellum px-3 py-2 text-sm outline-none focus:border-signal"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy || note.trim().length < 3} onClick={() => run(() => api(`/api/milestones/${milestoneId}/approve`, { body: { note } }))}>
          Approve and pay
        </Button>
        <Button variant="danger" disabled={busy || note.trim().length < 3} onClick={() => run(() => api(`/api/milestones/${milestoneId}/reject`, { body: { reason: note } }))}>
          Reject
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </div>
  );
}

export function PausedChoice({ milestoneId }: { milestoneId: string }) {
  const { busy, error, run } = useAction();
  return (
    <div className="mt-3 rounded-md bg-deny-wash p-3 text-sm">
      <p>The agent&apos;s mandate was revoked, so this payout stopped. The money is still held by PayPal for this job. You decide:</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => api(`/api/milestones/${milestoneId}/resume`, { method: "POST" }))}>
          I approve the work, pay it
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => run(() => api(`/api/milestones/${milestoneId}/cancel`, { method: "POST" }))}>
          Cancel and refund me
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-deny">{error}</p> : null}
    </div>
  );
}

export function SubmitProofLink({ milestoneId, resubmit }: { milestoneId: string; resubmit: boolean }) {
  return (
    <Link href={`/worker/submit/${milestoneId}`} className="mt-3 inline-flex rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-signal-ink">
      {resubmit ? "Submit new proof" : "Submit proof"}
    </Link>
  );
}
