import type { Metadata } from "next";
import { getContainer } from "@/core/container";
import { formatMinor } from "@/core/money";
import { DataGrid, type ColumnSpec } from "@/components/data-grid";
import { FundingChart } from "@/components/funding-chart";
import { Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

const JOB_COLUMNS: ColumnSpec[] = [
  { field: "title", header: "Job", kind: "link", flex: 2 },
  {
    field: "status",
    header: "Status",
    kind: "status",
    width: 150,
    tones: { COMPLETED: "good", FUNDED: "good", IN_PROGRESS: "info", DISPUTED: "bad", AWAITING_FUNDING: "warn", SCOPED: "info", CANCELLED: "neutral" },
  },
  { field: "totalMinor", header: "Worker gets", kind: "money", width: 130 },
  { field: "initiatedBy", header: "Hired by", width: 120 },
  { field: "worker", header: "Worker", width: 120 },
  { field: "createdAt", header: "Created", kind: "datetime", width: 170 },
];

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[10px] border border-vellum bg-surface p-4">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="num mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {note ? <p className="mt-0.5 text-xs text-ink-faint">{note}</p> : null}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "No data" : `${Math.round(v * 100)}%`);

export default async function AdminOverview() {
  const c = await getContainer();
  const [k, daily, jobs] = await Promise.all([c.analytics.kpis(), c.analytics.dailyFunding(14), c.analytics.jobsGrid()]);
  return (
    <main>
      <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
      <p className="mt-1 text-ink-soft">
        {k.openReviews ? `${k.openReviews} milestone${k.openReviews === 1 ? "" : "s"} waiting for your review.` : "Nothing is waiting for review."}
      </p>

      <section aria-label="Key numbers" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Funded through PayPal, all time" value={formatMinor(k.fundedMinor)} note={`${k.jobs} jobs, ${k.agentJobs} hired by AI agents`} />
        <Tile label="Paid to workers" value={formatMinor(k.paidOutMinor)} />
        <Tile label="Paid without a person" value={pct(k.autoReleaseRate)} note="Automatic releases among normal payouts" />
        <Tile label="Median time to payout" value={k.medianMinutesToPayout === null ? "No data" : `${Math.round(k.medianMinutesToPayout)} min`} note="Decision to PayPal payout, incl. challenge window" />
        <Tile label="Dispute rate" value={pct(k.disputeRate)} note="Disputes per verified milestone" />
        <Tile label="Stopped before money moved" value={`${k.fraudHeld + k.guardDenials}`} note={`${k.fraudHeld} held proofs, ${k.guardDenials} agent requests denied`} />
      </section>

      <Panel className="mt-6 p-5">
        <h2 className="font-semibold">Money held by PayPal per day</h2>
        <div className="mt-3">
          <FundingChart data={daily} />
        </div>
      </Panel>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">All jobs</h2>
        <DataGrid rows={jobs} columns={JOB_COLUMNS} exportName="settleai-jobs" height={460} />
      </section>
    </main>
  );
}
