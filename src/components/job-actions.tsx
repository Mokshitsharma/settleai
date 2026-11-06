"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatMinor } from "@/core/money";
import { api } from "@/lib/api";
import { Button } from "./ui";

interface FundResponse {
  fundingId: string;
  orderId: string;
  amountMinor: number;
  approveUrl?: string;
  mode: "MOCK" | "LIVE";
}

/**
 * Funding: create the PayPal order, have the buyer approve it, then capture. In MOCK mode a clearly
 * labelled simulated PayPal sheet stands in for the popup; in LIVE mode the buyer approves on PayPal sandbox.
 */
export function FundPanel({
  jobId,
  totalMinor,
  feeMinor,
  returnedOrderId,
  captured,
}: {
  jobId: string;
  totalMinor: number;
  feeMinor: number;
  /** Set when PayPal sent the buyer back after approving: capture right away. */
  returnedOrderId?: string;
  /** PayPal captured the money and SettleAI is waiting for PayPal's confirmation. */
  captured?: boolean;
}) {
  const router = useRouter();
  const captureStarted = useRef(false);
  const [order, setOrder] = useState<FundResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!returnedOrderId || captured || captureStarted.current) return;
    captureStarted.current = true;
    void run(async () => {
      await api(`/api/jobs/${jobId}/fund/capture`, { body: { orderId: returnedOrderId } });
      router.replace(`/jobs/${jobId}`);
      router.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnedOrderId, captured, jobId]);

  useEffect(() => {
    if (!captured) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [captured, router]);

  if (captured || (returnedOrderId && !error)) {
    return (
      <p role="status" className="text-sm">
        {captured ? "PayPal captured the payment. Waiting for PayPal to confirm it…" : "Payment approved. Capturing with PayPal…"}
      </p>
    );
  }

  const start = () => run(async () => setOrder(await api<FundResponse>(`/api/jobs/${jobId}/fund`, { method: "POST" })));
  const approveAndCapture = () =>
    run(async () => {
      if (!order) return;
      if (order.mode === "MOCK") await api("/api/dev/mock-paypal/approve", { body: { orderId: order.orderId } });
      await api(`/api/jobs/${jobId}/fund/capture`, { body: { orderId: order.orderId } });
      setOrder(null);
      router.refresh();
    });

  return (
    <div>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
        <dt className="text-ink-soft">Milestones</dt>
        <dd className="num text-right">{formatMinor(totalMinor)}</dd>
        <dt className="text-ink-soft">Platform fee</dt>
        <dd className="num text-right">{formatMinor(feeMinor)}</dd>
        <dt className="font-semibold">You pay now</dt>
        <dd className="num text-right font-semibold">{formatMinor(totalMinor + feeMinor)}</dd>
      </dl>
      <p className="mt-3 text-sm text-ink-soft">PayPal holds this in escrow. The worker is paid per milestone only after proof is verified.</p>

      {!order ? (
        <Button onClick={start} disabled={busy} className="mt-4 w-full">
          {busy ? "Creating PayPal order…" : "Fund with PayPal"}
        </Button>
      ) : order.mode === "MOCK" ? (
        <div role="dialog" aria-label="Simulated PayPal checkout" className="mt-4 rounded-[10px] border-2 border-dashed border-hold bg-hold-wash/50 p-4">
          <p className="text-xs font-semibold text-hold">Simulated PayPal checkout (mock mode, no money moves)</p>
          <p className="mt-2 text-sm">
            Order <code className="font-mono text-xs">{order.orderId}</code> for <span className="num font-semibold">{formatMinor(order.amountMinor)}</span>
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={approveAndCapture} disabled={busy} className="flex-1">
              {busy ? "Paying…" : `Pay ${formatMinor(order.amountMinor)}`}
            </Button>
            <Button variant="secondary" onClick={() => setOrder(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <a href={order.approveUrl} className="block rounded-md bg-[#ffc439] px-4 py-2 text-center text-sm font-semibold text-ink">
            Approve on PayPal sandbox
          </a>
          <p className="text-xs text-ink-soft">You come back here after approving, and the payment is captured automatically.</p>
        </div>
      )}
      {error ? <p role="alert" className="mt-3 text-sm text-deny">{error}</p> : null}
    </div>
  );
}

export function AcceptButton({ jobId, hasPayPalEmail }: { jobId: string; hasPayPalEmail: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        className="w-full"
        disabled={busy || !hasPayPalEmail}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/jobs/${jobId}/accept`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Accepting…" : "Accept job"}
      </Button>
      {!hasPayPalEmail ? <p className="mt-2 text-sm text-hold">Add a PayPal email to your profile to get paid.</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-deny">{error}</p> : null}
    </div>
  );
}
