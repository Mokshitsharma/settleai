import Link from "next/link";
import { SHOWCASE_ID } from "@/core/receipts/showcase";
import type { Metadata } from "next";
import { VerifyUpload } from "@/components/receipt-verifier";

export const metadata: Metadata = { title: "Verify a receipt" };

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">Verify a receipt</h1>
      <p className="mt-2 text-ink-soft">
        A SettleAI receipt carries the signed mandates, every signed step of the job and the public keys to check them. You do not need to trust
        SettleAI: if any field was changed after signing, verification fails and shows where.
      </p>
      <div className="mt-6">
        <VerifyUpload />
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        No receipt to hand?{" "}
        <a href={`/api/receipts/${SHOWCASE_ID}?download`} className="font-semibold text-signal underline">
          Download the showcase receipt
        </a>{" "}
        or{" "}
        <Link href="/receipt/showcase" className="font-semibold text-signal underline">
          open its page
        </Link>
        . Change one byte in the file and see verification fail.
      </p>
    </main>
  );
}
