// Phase 0 placeholder landing page. The designed landing page (pitch, diagram, "Try the demo") is T404.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-widest text-black/50 dark:text-white/50">
        PayPal AI Hackathon 2026
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">
        AP2 proves a human authorized an agent to pay. SettleAI proves the work was done before the money moves.
      </h1>
      <p className="text-lg text-black/70 dark:text-white/70">
        Mandates authorize. Evidence verifies. Policy decides. PayPal settles. The proof chain remembers.
      </p>
      <p className="text-sm text-black/50 dark:text-white/50">
        System status: <a className="underline" href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
