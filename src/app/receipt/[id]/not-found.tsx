import Link from "next/link";

/** Jobs people create live in a demo database that resets; the receipts they downloaded stay valid. */
export default function ReceiptNotFound() {
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">This receipt is no longer on the demo server</h1>
      <p className="mt-3 text-ink-soft">
        The demo resets after idle time, so jobs created here do not stay online. A receipt you downloaded still verifies offline, because it
        carries its own signatures.
      </p>
      <p className="mt-4">
        <Link href="/verify" className="font-semibold text-signal underline">
          Verify a downloaded receipt
        </Link>{" "}
        or{" "}
        <Link href="/receipt/showcase" className="font-semibold text-signal underline">
          see the permanent showcase receipt
        </Link>
        .
      </p>
    </main>
  );
}
