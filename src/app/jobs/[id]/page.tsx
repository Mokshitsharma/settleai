import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { AcceptanceCriterion, JobSpec } from "@/core/contracts";
import { getContainer } from "@/core/container";
import { pageUser } from "@/lib/page-auth";
import { ActivityPanel } from "@/components/activity-panel";
import { DecisionCardView } from "@/components/decision-card";
import { DisputePanel, OpenDispute, type DisputeProps } from "@/components/dispute-panel";
import { ProofChainView } from "@/components/proof-chain";
import type { DisputeProposal } from "@/core/contracts";
import { AcceptButton, FundPanel } from "@/components/job-actions";
import { AdminReview, ChallengeCountdown, PausedChoice, SubmitProofLink } from "@/components/milestone-actions";
import { MoneyStrip } from "@/components/money-strip";
import { Hash, JobStatusPill, MilestoneStatusPill, Money, Panel, Pill } from "@/components/ui";

export const metadata: Metadata = { title: "Job" };
export const dynamic = "force-dynamic";

const CHECK_LABEL: Record<AcceptanceCriterion["check"], string> = {
  deterministic: "Checked by rule",
  ai_visual: "Checked by AI vision",
  ai_text: "Checked by AI",
  human: "Checked by a person",
};

export default async function JobPage({ params, searchParams }: PageProps<"/jobs/[id]">) {
  const user = await pageUser();
  const { id } = await params;
  const query = await searchParams;
  const c = await getContainer();
  // Snapshot events BEFORE reading the job: anything newer than the page's data then arrives over the
  // stream as unseen and triggers a refresh (reading in the other order can miss an update).
  const initialEvents = c.events.recent(`job:${id}`);
  const d = await c.jobs.detail(id);
  if (!d) notFound();
  const { job, milestones, money } = d;
  const visible = user.role === "admin" || job.payerId === user.id || job.workerId === user.id || (user.role === "worker" && job.status === "FUNDED");
  if (!visible) redirect("/jobs");
  const spec = job.specJson as JobSpec;
  const funding = d.funding.find((f) => f.status === "CONFIRMED");
  const isPayer = user.role === "payer" && job.payerId === user.id;
  const isWorker = user.role === "worker" && job.workerId === user.id;
  const proofImages = Object.fromEntries(d.proofs.filter((p) => p.kind === "photo").map((p) => [p.id, true]));
  const viewer = user.role === "admin" ? "admin" : isPayer ? "payer" : isWorker ? "worker" : "other";
  const disputeViews = await c.disputes.forJob(job.id);
  const disputesByMilestone: Record<string, DisputeProps[]> = {};
  for (const v of disputeViews) {
    const side = (uid: string) => (uid === job.payerId ? ("payer" as const) : ("worker" as const));
    (disputesByMilestone[v.dispute.milestoneId] ??= []).push({
      id: v.dispute.id,
      status: v.dispute.status,
      reason: v.dispute.reason,
      openedBySide: side(v.dispute.openedBy),
      deadlineAt: v.dispute.deadlineAt.toISOString(),
      disputedAmountMinor: v.disputedAmountMinor,
      evidence: v.evidence.map((e) => ({ id: e.id, side: side(e.submitterId), kind: e.kind, content: e.content })),
      proposal: v.proposal ? { ...(v.proposal.proposalJson as DisputeProposal), payerResponse: v.proposal.payerResponse, workerResponse: v.proposal.workerResponse } : null,
      reportSummary: v.report?.summary ?? null,
      reportClauses: v.report?.clauses ?? [],
      resolution: (v.dispute.resolutionJson as DisputeProps["resolution"]) ?? null,
    });
  }
  const chain = await c.attestations.chain(job.id);
  const chainOk = (await c.attestations.verify(job.id)).ok;
  const waiting = Object.fromEntries(d.releases.filter((r) => r.status === "WAITING_WINDOW" && r.challengeEndsAt).map((r) => [r.milestoneId, r.challengeEndsAt!.toISOString()]));

  return (
    <main className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <JobStatusPill status={job.status} />
            <span className="text-sm capitalize text-ink-soft">{job.category.replace("_", " ")}</span>
            {spec.location ? <span className="text-sm text-ink-soft">{spec.location.label}</span> : null}
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">{job.title}</h1>
          {spec.summary.trim() !== job.title.trim() && !spec.summary.startsWith(job.title) ? (
            <p className="mt-2 max-w-[70ch] text-ink-soft">{spec.summary}</p>
          ) : null}
        </header>

        <Panel className="p-5">
          <h2 className="sr-only">Money</h2>
          <MoneyStrip {...money} expectedMinor={job.totalMinor + job.feeMinor} />
          {funding?.paypalCaptureId ? (
            <p className="mt-3 text-xs text-ink-faint">
              PayPal capture <Hash value={funding.paypalCaptureId} chars={20} /> confirmed by PayPal
            </p>
          ) : null}
        </Panel>

        <section>
          <h2 className="text-lg font-semibold">Milestones</h2>
          <ol className="mt-3 space-y-4">
            {milestones.map((m) => {
              const criteria = m.criteriaJson as AcceptanceCriterion[];
              return (
                <li key={m.id}>
                  <Panel as="article" className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="num text-sm font-semibold text-signal">Milestone {m.seq}</p>
                        <h3 className="text-lg font-semibold">{m.title}</h3>
                        <p className="text-sm text-ink-soft">
                          Due {new Date(m.dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST
                        </p>
                      </div>
                      <div className="text-right">
                        <Money minor={m.amountMinor} className="text-lg font-semibold" />
                        <div className="mt-1">
                          <MilestoneStatusPill status={m.status} />
                        </div>
                      </div>
                    </div>
                    <h4 className="mt-4 text-sm font-semibold">Paid when all of these are proven</h4>
                    <ul className="mt-2 space-y-2">
                      {criteria.map((cr) => (
                        <li key={cr.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-vellum pt-2 text-sm">
                          <span>{cr.text}</span>
                          <span className="text-xs text-ink-faint">{CHECK_LABEL[cr.check]}</span>
                        </li>
                      ))}
                    </ul>
                    {d.decisions[m.id] ? <DecisionCardView card={d.decisions[m.id]} proofImages={proofImages} /> : null}
                    {m.status === "CHALLENGE_WINDOW" && waiting[m.id] ? <ChallengeCountdown endsAt={waiting[m.id]} /> : null}
                    {isWorker && (m.status === "ACTIVE" || m.status === "REJECTED") ? <SubmitProofLink milestoneId={m.id} resubmit={m.status === "REJECTED"} /> : null}
                    {user.role === "admin" && (m.status === "NEEDS_REVIEW" || m.status === "HELD") ? <AdminReview milestoneId={m.id} /> : null}
                    {isPayer && m.status === "PAUSED_MANDATE" ? <PausedChoice milestoneId={m.id} /> : null}
                    {(disputesByMilestone[m.id] ?? []).map((dp) => (
                      <DisputePanel key={dp.id} d={dp} viewer={viewer} />
                    ))}
                    {isPayer && (m.status === "CHALLENGE_WINDOW" || m.status === "SUBMITTED") ? <OpenDispute milestoneId={m.id} label="Dispute this milestone" /> : null}
                    {isWorker && m.status === "REJECTED" ? <OpenDispute milestoneId={m.id} label="Dispute the rejection" /> : null}
                    {(m.status === "VERIFYING" || m.status === "SUBMITTED") ? (
                      <p className="mt-3 text-sm text-ink-soft">Checking the proof now. Follow each step in the live activity panel.</p>
                    ) : null}
                  </Panel>
                </li>
              );
            })}
          </ol>
        </section>

        {chain.length ? (
          <Panel className="p-5">
            <details>
              <summary className="cursor-pointer text-lg font-semibold">Proof chain</summary>
              <p className="mt-1 text-sm text-ink-soft">
                Every step of this job is a signed record linked to the one before it. Anyone can check the receipt offline.
              </p>
              <div className="mt-4">
                <ProofChainView chain={chain} ok={chainOk} />
              </div>
            </details>
            {d.funding.some((f) => f.status === "CONFIRMED") ? (
              <div className="mt-4 flex flex-wrap gap-4 border-t border-vellum pt-3 text-sm">
                <a href={`/receipt/${job.id}`} className="font-semibold text-signal hover:text-signal-ink">
                  Open the public receipt
                </a>
                <a href={`/api/receipts/${job.id}?download`} className="font-semibold text-signal hover:text-signal-ink">
                  Download receipt file
                </a>
              </div>
            ) : null}
          </Panel>
        ) : null}

        {spec.riskNotes.length ? (
          <Panel className="border-hold/40 bg-hold-wash/40 p-4">
            <h2 className="text-sm font-semibold text-hold">Risk notes from the scoping agent</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {spec.riskNotes.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-6">
        {isPayer && (job.status === "SCOPED" || job.status === "AWAITING_FUNDING") ? (
          <Panel className="p-5">
            <h2 className="mb-3 font-semibold">Fund this job</h2>
            <FundPanel
              jobId={job.id}
              totalMinor={job.totalMinor}
              feeMinor={job.feeMinor}
              returnedOrderId={query.paypal === "approved" && typeof query.token === "string" ? query.token : undefined}
              captured={d.funding.some((f) => f.status === "CAPTURED")}
            />
          </Panel>
        ) : null}
        {user.role === "worker" && job.status === "FUNDED" ? (
          <Panel className="p-5">
            <h2 className="font-semibold">Take this job</h2>
            <p className="mb-3 mt-1 text-sm text-ink-soft">
              <Money minor={job.totalMinor} className="font-semibold text-ink" /> is already held by PayPal for you.
              {job.createdBy.startsWith("api_client:") ? " This job was created by an AI agent within its owner's signed mandate." : ""}
            </p>
            <AcceptButton jobId={job.id} hasPayPalEmail={Boolean(user.paypalEmail)} />
          </Panel>
        ) : null}
        <Panel className="p-5 text-sm">
          <h2 className="font-semibold">People</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-soft">Payer</dt>
            <dd>{d.payer.name}</dd>
            <dt className="text-ink-soft">Worker</dt>
            <dd>
              {d.worker ? (
                <>
                  {d.worker.name} <Pill tone={d.worker.trustScore >= 60 ? "good" : d.worker.trustScore >= 40 ? "neutral" : "warn"}>trust {d.worker.trustScore}</Pill>
                </>
              ) : (
                "Not yet assigned"
              )}
            </dd>
            <dt className="text-ink-soft">Job id</dt>
            <dd>
              <Hash value={job.id} chars={18} />
            </dd>
          </dl>
        </Panel>
        <ActivityPanel jobId={job.id} initial={initialEvents} />
      </div>
    </main>
  );
}
