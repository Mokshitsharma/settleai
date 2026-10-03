import Link from "next/link";
import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { pageUser } from "@/lib/page-auth";
import { EmptyState, JobStatusPill, Money } from "@/components/ui";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const HEADINGS = { payer: "Your jobs", worker: "Jobs for you", admin: "All jobs" } as const;

export default async function JobsPage() {
  const user = await pageUser();
  const c = await getContainer();
  const jobs = await c.jobs.listFor(user);
  const open = user.role === "worker" ? jobs.filter((j) => j.status === "FUNDED" && !j.workerId) : [];
  const mine = user.role === "worker" ? jobs.filter((j) => j.workerId === user.id) : jobs;

  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{HEADINGS[user.role]}</h1>
          <p className="mt-1 text-ink-soft">Signed in as {user.name}</p>
        </div>
        {user.role === "payer" ? (
          <Link href="/new" className="rounded-md bg-signal px-4 py-2 text-sm font-semibold text-white hover:bg-signal-ink">
            Describe a new job
          </Link>
        ) : null}
      </div>

      {user.role === "worker" ? (
        <section className="mt-8">
          <h2 className="font-semibold">Funded and open to accept</h2>
          <p className="text-sm text-ink-soft">The money for these jobs is already held by PayPal.</p>
          <JobTable jobs={open} empty="No open jobs right now." />
        </section>
      ) : null}

      <section className="mt-8">
        {user.role === "worker" ? <h2 className="font-semibold">Accepted by you</h2> : null}
        <JobTable
          jobs={mine}
          empty={user.role === "payer" ? "No jobs yet. Describe one in plain words and the scoping agent drafts it." : "Nothing here yet."}
        />
      </section>
    </main>
  );
}

function JobTable({ jobs, empty }: { jobs: Awaited<ReturnType<Awaited<ReturnType<typeof getContainer>>["jobs"]["listFor"]>>; empty: string }) {
  if (jobs.length === 0) return <div className="mt-3"><EmptyState title={empty} /></div>;
  return (
    <div className="mt-3 overflow-x-auto rounded-[10px] border border-vellum bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-vellum text-ink-soft">
          <tr>
            <th className="px-4 py-2.5 font-medium">Job</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Worker gets</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Created by</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-b border-vellum last:border-0 hover:bg-paper">
              <td className="px-4 py-3">
                <Link href={`/jobs/${j.id}`} className="font-semibold text-ink hover:text-signal">
                  {j.title}
                </Link>
                <div className="text-xs capitalize text-ink-faint">{j.category.replace("_", " ")}</div>
              </td>
              <td className="px-4 py-3">
                <JobStatusPill status={j.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Money minor={j.totalMinor} className="font-semibold" />
              </td>
              <td className="hidden px-4 py-3 text-ink-soft sm:table-cell">
                {j.createdBy.startsWith("api_client:") ? "AI agent" : "Person"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
