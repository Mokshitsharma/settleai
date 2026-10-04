import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getContainer } from "@/core/container";
import { jobs, mandateChecks } from "@/core/db/schema";
import { pageUser } from "@/lib/page-auth";
import { MandateCard } from "../mandate-card";
import { EmptyState, JobStatusPill, Money, Panel, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Mandate" };
export const dynamic = "force-dynamic";

const GATE: Record<string, string> = { G1: "Hire", G2: "Fund / accept", G3: "Payout", G4: "Dispute settlement" };

/** Mandate detail (spec §13.1): terms, spend, every Mandate Guard check and the jobs it covers. */
export default async function MandatePage({ params }: PageProps<"/mandates/[id]">) {
  const user = await pageUser(["payer", "admin"]);
  const { id } = await params;
  const c = await getContainer();
  const mandate = await c.mandates.get(id);
  if (!mandate || mandate.envelope.payload.type !== "intent") notFound();
  if (user.role !== "admin" && mandate.envelope.payload.issuer.userId !== user.id) redirect("/mandates");
  const [checks, covered] = await Promise.all([
    c.dbHandle.db.select().from(mandateChecks).where(eq(mandateChecks.mandateId, id)).orderBy(desc(mandateChecks.createdAt)).limit(100),
    c.dbHandle.db.select().from(jobs).where(eq(jobs.intentMandateId, id)).orderBy(desc(jobs.createdAt)),
  ]);

  return (
    <main className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section>
        <Link href="/mandates" className="text-sm text-signal hover:text-signal-ink">
          All mandates
        </Link>
        <div className="mt-3">
          <MandateCard mandate={mandate} />
        </div>
        <h2 className="mt-8 text-lg font-semibold">Jobs hired under it</h2>
        <div className="mt-3 space-y-2">
          {covered.length ? (
            covered.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-[10px] border border-vellum bg-surface px-4 py-3 hover:border-ink-faint">
                <span className="min-w-0 truncate font-medium">{j.title}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <Money minor={j.totalMinor} />
                  <JobStatusPill status={j.status} />
                </span>
              </Link>
            ))
          ) : (
            <EmptyState title="No jobs yet" />
          )}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Every check the Mandate Guard made</h2>
        <p className="mt-1 text-sm text-ink-soft">Each hire, funding and payout under this mandate is checked first. Denials are signed into the proof chain.</p>
        {checks.length ? (
          <Panel className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-vellum text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Gate</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((k) => (
                  <tr key={k.id} className="border-b border-vellum align-top last:border-0">
                    <td className="num whitespace-nowrap px-3 py-2 text-ink-soft">
                      {k.createdAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="px-3 py-2">{GATE[k.gate] ?? k.gate}</td>
                    <td className="px-3 py-2">
                      <Pill tone={k.result === "allow" ? "good" : k.result === "step_up" ? "warn" : "bad"}>{k.result === "step_up" ? "needs approval" : k.result}</Pill>
                    </td>
                    <td className="px-3 py-2">
                      {k.reasonCodes.length ? <span className="block font-mono text-xs text-deny">{k.reasonCodes.join(" ")}</span> : null}
                      <span className="text-ink-soft">{k.action === "check_action" ? "Dry run. " : ""}</span>
                      {k.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        ) : (
          <div className="mt-3">
            <EmptyState title="No checks yet" />
          </div>
        )}
      </section>
    </main>
  );
}
