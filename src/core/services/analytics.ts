// Admin analytics and grid data sources (spec §13.1 /admin pages, F12, F35). Read-only; every number is
// derived from the ledger, releases, disputes and guard checks, never stored separately.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/core/db/client";
import {
  agentRuns,
  apiClients,
  disputeProposals,
  disputes,
  fundingOrders,
  jobs,
  ledgerAccounts,
  ledgerEntries,
  ledgerTxns,
  mandateChecks,
  milestones,
  releases,
  riskAssessments,
  users,
} from "@/core/db/schema";
import type { DisputeProposal } from "@/core/contracts";

export interface Kpis {
  fundedMinor: number;
  paidOutMinor: number;
  jobs: number;
  agentJobs: number;
  autoReleaseRate: number | null; // share of paid releases that needed no person
  medianMinutesToPayout: number | null; // proof submitted -> PayPal payout succeeded
  disputeRate: number | null; // disputes per verified milestone
  fraudHeld: number;
  guardDenials: number;
  openReviews: number;
}

export interface DailyFunding {
  day: string; // YYYY-MM-DD
  humanMinor: number;
  agentMinor: number;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export class AnalyticsService {
  constructor(private readonly db: Db) {}

  async kpis(): Promise<Kpis> {
    const [fundings, allJobs, rels, ms, risks, disputeRows, denials] = await Promise.all([
      this.db.select({ jobId: fundingOrders.jobId, amount: fundingOrders.amountMinor }).from(fundingOrders).where(eq(fundingOrders.status, "CONFIRMED")),
      this.db.select({ id: jobs.id, createdBy: jobs.createdBy }).from(jobs),
      this.db.select().from(releases).where(eq(releases.status, "PAYOUT_SUCCEEDED")),
      this.db.select({ id: milestones.id, status: milestones.status }).from(milestones),
      this.db.select({ milestoneId: riskAssessments.milestoneId, decision: riskAssessments.decision, at: riskAssessments.createdAt }).from(riskAssessments),
      this.db.select({ id: disputes.id }).from(disputes),
      this.db
        .select({ id: mandateChecks.id })
        .from(mandateChecks)
        .where(and(eq(mandateChecks.result, "deny"), inArray(mandateChecks.action, ["create_job", "create_job_precheck"]))),
    ]);
    const normal = rels.filter((r) => r.decisionSource !== "dispute");
    // Time to payout: first decision for the milestone -> payout success (proxy for submit -> paid).
    const firstDecision = new Map<string, Date>();
    for (const r of risks) if (!firstDecision.has(r.milestoneId) || r.at < firstDecision.get(r.milestoneId)!) firstDecision.set(r.milestoneId, r.at);
    const minutes = normal
      .filter((r) => firstDecision.has(r.milestoneId))
      .map((r) => (r.updatedAt.getTime() - firstDecision.get(r.milestoneId)!.getTime()) / 60_000)
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);
    const verified = new Set(risks.map((r) => r.milestoneId)).size;
    return {
      fundedMinor: fundings.reduce((a, f) => a + f.amount, 0),
      paidOutMinor: rels.reduce((a, r) => a + r.amountMinor, 0),
      jobs: allJobs.length,
      agentJobs: allJobs.filter((j) => j.createdBy.startsWith("api_client:")).length,
      autoReleaseRate: normal.length ? normal.filter((r) => r.decisionSource === "auto").length / normal.length : null,
      medianMinutesToPayout: minutes.length ? minutes[Math.floor(minutes.length / 2)] : null,
      disputeRate: verified ? disputeRows.length / verified : null,
      fraudHeld: risks.filter((r) => r.decision === "HOLD").length,
      guardDenials: denials.length,
      openReviews: ms.filter((m) => m.status === "NEEDS_REVIEW" || m.status === "HELD").length,
    };
  }

  /** Daily confirmed funding split by who initiated the job (spec F35: agent vs human). */
  async dailyFunding(days = 14): Promise<DailyFunding[]> {
    const rows = await this.db
      .select({ amount: fundingOrders.amountMinor, at: fundingOrders.updatedAt, createdBy: jobs.createdBy, jobCreated: jobs.createdAt })
      .from(fundingOrders)
      .innerJoin(jobs, eq(jobs.id, fundingOrders.jobId))
      .where(eq(fundingOrders.status, "CONFIRMED"));
    const end = new Date();
    const out: DailyFunding[] = [];
    for (let i = days - 1; i >= 0; i--) out.push({ day: day(new Date(end.getTime() - i * 86_400_000)), humanMinor: 0, agentMinor: 0 });
    for (const r of rows) {
      // Seeded history funds jobs on their (back-dated) creation day; use the job's day for both.
      const slot = out.find((d) => d.day === day(r.jobCreated));
      if (!slot) continue;
      if (r.createdBy.startsWith("api_client:")) slot.agentMinor += r.amount;
      else slot.humanMinor += r.amount;
    }
    return out;
  }

  async jobsGrid() {
    const rows = await this.db
      .select({ id: jobs.id, title: jobs.title, status: jobs.status, category: jobs.category, totalMinor: jobs.totalMinor, createdBy: jobs.createdBy, createdAt: jobs.createdAt, worker: users.name })
      .from(jobs)
      .leftJoin(users, eq(users.id, jobs.workerId))
      .orderBy(desc(jobs.createdAt));
    return rows.map((r) => ({ ...r, initiatedBy: r.createdBy.startsWith("api_client:") ? "AI agent" : "Person", createdAt: r.createdAt.toISOString(), link: `/jobs/${r.id}` }));
  }

  /** Risk queue: milestones waiting for a person, plus every recent decision for context. */
  async riskGrid() {
    const rows = await this.db
      .select({ r: riskAssessments, ms: milestones, job: jobs, worker: users.name })
      .from(riskAssessments)
      .innerJoin(milestones, eq(milestones.id, riskAssessments.milestoneId))
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .leftJoin(users, eq(users.id, jobs.workerId))
      .orderBy(desc(riskAssessments.createdAt))
      .limit(500);
    return rows.map(({ r, ms, job, worker }) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      job: job.title,
      milestone: `${ms.seq}. ${ms.title}`,
      worker: worker ?? "",
      amountMinor: ms.amountMinor,
      decision: r.decision,
      score: r.score,
      flags: ((r.flagsJson as { code: string }[]) ?? []).map((f) => f.code).join(", "),
      status: ms.status,
      waiting: ms.status === "NEEDS_REVIEW" || ms.status === "HELD" ? "Waiting for you" : "",
      policyVersion: r.policyVersion,
      link: `/jobs/${job.id}`,
    }));
  }

  async disputesGrid() {
    const rows = await this.db
      .select({ d: disputes, ms: milestones, job: jobs })
      .from(disputes)
      .innerJoin(milestones, eq(milestones.id, disputes.milestoneId))
      .innerJoin(jobs, eq(jobs.id, milestones.jobId))
      .orderBy(desc(disputes.createdAt));
    const props = rows.length ? await this.db.select().from(disputeProposals).where(inArray(disputeProposals.disputeId, rows.map((r) => r.d.id))) : [];
    return rows.map(({ d, ms, job }) => {
      const p = props.filter((x) => x.disputeId === d.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const proposal = p?.proposalJson as DisputeProposal | undefined;
      const res = d.resolutionJson as { releaseToWorkerMinor: number; refundToPayerMinor: number; faultClass: string; resolvedBy: string } | null;
      return {
        id: d.id,
        at: d.createdAt.toISOString(),
        job: job.title,
        milestone: `${ms.seq}. ${ms.title}`,
        reason: d.reason,
        status: d.status,
        faultClass: res?.faultClass ?? proposal?.liability.faultClass ?? "",
        releaseMinor: res?.releaseToWorkerMinor ?? proposal?.proposal.releaseToWorkerMinor ?? null,
        refundMinor: res?.refundToPayerMinor ?? proposal?.proposal.refundToPayerMinor ?? null,
        confidence: proposal ? Math.round(proposal.confidence * 100) : null,
        resolvedBy: res?.resolvedBy ?? "",
        link: `/jobs/${job.id}`,
      };
    });
  }

  async ledgerGrid() {
    const rows = await this.db
      .select({ e: ledgerEntries, a: ledgerAccounts, t: ledgerTxns })
      .from(ledgerEntries)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
      .innerJoin(ledgerTxns, eq(ledgerTxns.id, ledgerEntries.txnId))
      .orderBy(desc(ledgerEntries.createdAt))
      .limit(2000);
    return rows.map(({ e, a, t }) => ({
      id: e.id,
      at: e.createdAt.toISOString(),
      txn: e.txnId,
      kind: t.kind,
      account: a.code.startsWith("ESCROW:") ? "Escrow" : a.code === "PAYPAL_BALANCE" ? "PayPal balance" : a.code === "FEE_REVENUE" ? "Fee revenue" : a.code,
      job: a.jobId ?? "",
      debitMinor: e.debitMinor || null,
      creditMinor: e.creditMinor || null,
      ref: `${e.refType}:${e.refId}`,
    }));
  }

  async mandateChecksGrid() {
    const rows = await this.db.select().from(mandateChecks).orderBy(desc(mandateChecks.createdAt)).limit(1000);
    return rows.map((k) => ({
      id: k.id,
      at: k.createdAt.toISOString(),
      mandate: k.mandateId,
      gate: k.gate,
      action: k.action === "check_action" ? "dry run" : k.action === "create_job_precheck" ? "agent hire (pre-check)" : k.action.replaceAll("_", " "),
      result: k.result,
      reasons: k.reasonCodes.join(" "),
      message: k.message,
      link: k.mandateId.startsWith("mnd_") ? `/mandates/${k.mandateId}` : "",
    }));
  }

  async agentClients() {
    return this.db
      .select({ id: apiClients.id, name: apiClients.name, status: apiClients.status, owner: users.name, scopes: apiClients.scopes })
      .from(apiClients)
      .innerJoin(users, eq(users.id, apiClients.ownerUserId));
  }

  async tracesGrid() {
    const rows = await this.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(1000);
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      agent: r.agent,
      entity: `${r.entityType}:${r.entityId}`,
      status: r.status,
      model: r.model,
      promptVersion: r.promptVersion,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      latencyMs: r.latencyMs,
      trace: r.traceId,
      output: JSON.stringify(r.outputJson ?? {}).slice(0, 300),
    }));
  }
}
