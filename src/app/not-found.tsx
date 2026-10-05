import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg py-16">
      <h1 className="text-3xl font-bold tracking-tight">Nothing here</h1>
      <p className="mt-2 text-ink-soft">
        This page does not exist, or the job or receipt it points to has not been created yet. Receipts appear once a job is funded.
      </p>
      <div className="mt-6 flex gap-4 text-sm font-semibold">
        <Link href="/jobs" className="text-signal hover:text-signal-ink">
          Go to jobs
        </Link>
        <Link href="/verify" className="text-signal hover:text-signal-ink">
          Verify a receipt
        </Link>
      </div>
    </main>
  );
}
