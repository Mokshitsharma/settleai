"use client";

import { Button } from "@/components/ui";

/** Unexpected errors: say what happened and what is safe, and offer a retry. No stack traces to users. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg py-16">
      <h1 className="text-3xl font-bold tracking-tight">This page failed to load</h1>
      <p className="mt-2 text-ink-soft">
        Something went wrong on our side. No money moves because of a page error: payouts only happen after the Mandate Guard and the ledger agree.
      </p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  );
}
