import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getContainer } from "@/core/container";
import { formatMinor } from "@/core/money";
import { SHOWCASE_ID, showcaseBundle } from "@/core/receipts/showcase";
import { verifyReceipt } from "@/core/verifier/receipt";
import { MoneyStrip } from "@/components/money-strip";
import { ProofChainView } from "@/components/proof-chain";
import { VerifyThisReceipt } from "@/components/receipt-verifier";
import { Seal } from "@/components/seal";
import { Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Receipt" };
export const dynamic = "force-dynamic";

/** Public, shareable proof of settlement (spec F21). No names, emails or exact addresses. */
export default async function ReceiptPage({ params }: PageProps<"/receipt/[id]">) {
  const { id } = await params;
  const isShowcase = id === SHOWCASE_ID;
  const bundle = isShowcase ? await showcaseBundle() : await (await getContainer()).receipts.build(id);
  if (!bundle) notFound();
  const chainOk = isShowcase ? (await verifyReceipt(bundle)).ok : (await (await getContainer()).attestations.verify(id)).ok;

  return (
    <main className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm text-ink-soft">Receipt for a {bundle.job.agentInitiated ? "job hired by an AI agent" : "job"} settled through PayPal</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{bundle.job.title}</h1>
          <p className="mt-1 text-ink-soft">
            {bundle.job.category.replace("_", " ")}
            {bundle.job.locationLabel ? `, ${bundle.job.locationLabel}` : ""}. Worker share {formatMinor(bundle.job.totalMinor)}.
          </p>
        </div>
        <Seal hash={bundle.mandates.payment.payloadHash} label={chainOk ? "Verified" : "Broken"} tone={chainOk ? "good" : "bad"} size={96} />
      </div>

      <Panel className="mt-6 p-5">
        <MoneyStrip {...bundle.ledger} expectedMinor={bundle.job.totalMinor + bundle.job.feeMinor} />
        <p className="mt-3 text-xs text-ink-faint">
          PayPal order {bundle.paypal.orderId ?? "n/a"}, capture {bundle.paypal.captureId ?? "n/a"}
          {bundle.paypal.payoutItemIds.length ? `, payouts ${bundle.paypal.payoutItemIds.join(", ")}` : ""}
          {bundle.paypal.refundIds.length ? `, refunds ${bundle.paypal.refundIds.join(", ")}` : ""} (masked)
        </p>
      </Panel>

      <p role="note" className="mt-4 text-sm text-ink-soft">
        {isShowcase
          ? "The permanent showcase: the signed record of one real job on the PayPal sandbox with test money, frozen so this page and its signatures never change."
          : "The demo resets after idle time, so this page will not stay online. Download the receipt: a downloaded receipt still verifies offline."}
      </p>

      <Panel className="mt-6 p-5">
        <h2 className="text-lg font-semibold">Fees</h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-ink-soft">Charged to the payer: PayPal processing, at cost</dt>
          <dd className="num text-right">{formatMinor(bundle.fees.processingFeeMinor)}</dd>
          <dt className="text-ink-soft">Charged to the payer: SettleAI margin</dt>
          <dd className="num text-right">{formatMinor(bundle.fees.serviceFeeMinor - bundle.fees.processingFeeMinor)}</dd>
          <dt className="text-ink-soft">Actually charged by PayPal so far</dt>
          <dd className="num text-right">{formatMinor(bundle.fees.paypalChargedMinor)}</dd>
        </dl>
      </Panel>

      <Panel className="mt-6 p-5">
        <h2 className="text-lg font-semibold">Check it yourself</h2>
        <p className="mt-1 text-sm text-ink-soft">
          The verifier runs in your browser: it checks every signature, hash link and mandate, and that money only moved when the signed conditions were met.
          Download the file to check it offline with <code className="font-mono text-xs">pnpm verify-receipt</code>, or change one byte and watch it fail on the{" "}
          <a href="/verify" className="text-signal underline">verify page</a>.
        </p>
        <div className="mt-4 flex flex-wrap items-start gap-4">
          <VerifyThisReceipt jobId={id} />
          <a href={`/api/receipts/${id}?download`} className="rounded-md border border-vellum bg-surface px-4 py-2 text-sm font-semibold hover:border-ink-faint">
            Download receipt file
          </a>
        </div>
      </Panel>

      <Panel className="mt-6 p-5">
        <h2 className="text-lg font-semibold">Proof chain</h2>
        <div className="mt-3">
          <ProofChainView chain={bundle.attestations} ok={chainOk} />
        </div>
      </Panel>
    </main>
  );
}
