// Jobs and milestones: create from a confirmed JobSpec, edit before funding, accept, and read models.
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { fundingOrders, jobs, milestones, payouts, proofs, refunds, releases, riskAssessments, users } from "@/core/db/schema";
import { JobSpec, type Role } from "@/core/contracts";
import type { EventHub } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { feeForAmount } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import type { DecisionCard } from "@/core/policy/decision-card";
import { assertTransition, type JobStatus } from "@/core/state/machines";
import type { AuditService } from "./audit";
import type { MandateBindingService } from "./binding";
import type { MandateGuardService } from "./guard";
import { escrowCode, type LedgerService } from "./ledger";

export class JobError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_STATE" | "INVALID_SPEC" | "PAYOUT_EMAIL_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

export type JobRow = typeof jobs.$inferSelect;
export type MilestoneRow = typeof milestones.$inferSelect;

export interface MoneyStrip {
  fundedMinor: number;
  inEscrowMinor: number;
  releasedMinor: number;
  refundedMinor: number;
}

export interface JobDetail {
  job: JobRow;
  milestones: MilestoneRow[];
  funding: (typeof fundingOrders.$inferSelect)[];
  releases: (typeof releases.$inferSelect)[];
  payouts: (typeof payouts.$inferSelect)[];
  money: MoneyStrip;
  payer: { id: string; name: string };
  worker: { id: string; name: string; trustScore: number } | null;
  proofs: (typeof proofs.$inferSelect)[];
  /** Latest Decision Card per milestone id. */
  decisions: Record<string, DecisionCard>;
}

export class JobService {
  constructor(
    private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
    private readonly feeBps: number,
    private readonly binding: MandateBindingService,
    private readonly guard: MandateGuardService,
  ) {}

  async setStatus(tx: DbOrTx, job: JobRow, to: JobStatus): Promise<void> {
    assertTransition("JOB", job.status, to);
    await tx.update(jobs).set({ status: to, updatedAt: this.clock.now() }).where(eq(jobs.id, job.id));
  }

  /**
   * Creates a job and its signed Job Mandate. Agent-created jobs (createdBy "api_client:<id>") are signed by
   * the agent and must already have passed Mandate Guard G1; pass the same `tx` so spend and job commit together.
   */
  async createFromSpec(
    args: { payerId: string; spec: unknown; createdBy: string; intentMandateId?: string; requestNonce?: string },
    outerTx?: DbOrTx,
  ): Promise<JobRow> {
    const parsed = JobSpec.safeParse(args.spec);
    if (!parsed.success) throw new JobError("INVALID_SPEC", parsed.error.issues[0]?.message ?? "Invalid job spec");
    const spec = parsed.data;
    const id = newId("job");
    const agentClientId = args.createdBy.startsWith("api_client:") ? args.createdBy.slice("api_client:".length) : null;
    // Keys are loaded before the transaction (PGlite single connection rule).
    const signer = await this.binding.signerFor(agentClientId ? { type: "client", id: agentClientId } : { type: "user", id: args.payerId });
    const run = async (tx: DbOrTx) => {
      await tx.insert(jobs).values({
        id,
        payerId: args.payerId,
        title: spec.title,
        category: spec.category,
        specJson: spec,
        totalMinor: spec.totalAmountMinor,
        feeMinor: feeForAmount(spec.totalAmountMinor, this.feeBps),
        status: "SCOPED",
        createdBy: args.createdBy,
        locationJson: spec.location ?? null,
        intentMandateId: args.intentMandateId ?? null,
      });
      await tx.insert(milestones).values(
        spec.milestones.map((m) => ({
          id: newId("ms"),
          jobId: id,
          seq: m.seq,
          title: m.title,
          amountMinor: m.amountMinor,
          dueAt: new Date(m.dueAt),
          criteriaJson: m.acceptanceCriteria,
        })),
      );
      await this.audit.append(
        { actor: args.createdBy, action: "job.created", entityType: "job", entityId: id, payload: { totalMinor: spec.totalAmountMinor, title: spec.title } },
        tx,
      );
      await this.binding.createJobMandate(
        { jobId: id, spec, payerId: args.payerId, intentMandateId: args.intentMandateId, agentClientId, nonce: args.requestNonce },
        tx,
        signer,
        agentClientId ? "agent" : "principal",
      );
    };
    if (outerTx) await run(outerTx);
    else await this.db.transaction(run);
    this.events.publish(`job:${id}`, "job.created", agentClientId ? `Agent created job: ${spec.title}` : `Job created: ${spec.title}`);
    return (await this.getRow(id, outerTx))!;
  }

  /** Payer edits milestones and criteria before funding. Re-opens funding if an order was pending. */
  async updateSpec(args: { jobId: string; payerId: string; spec: unknown }): Promise<JobRow> {
    const parsed = JobSpec.safeParse(args.spec);
    if (!parsed.success) throw new JobError("INVALID_SPEC", parsed.error.issues[0]?.message ?? "Invalid job spec");
    const spec = parsed.data;
    const signer = await this.binding.signerFor({ type: "user", id: args.payerId });
    await this.db.transaction(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, args.jobId)).for("update");
      if (!job) throw new JobError("NOT_FOUND", "Job not found");
      if (job.payerId !== args.payerId) throw new JobError("FORBIDDEN", "Only the payer can edit this job");
      if (job.status !== "SCOPED" && job.status !== "AWAITING_FUNDING") {
        throw new JobError("INVALID_STATE", "The job can only be edited before it is funded");
      }
      if (job.status === "AWAITING_FUNDING") {
        await this.setStatus(tx, job, "SCOPED");
        await tx
          .update(fundingOrders)
          .set({ status: "FAILED", updatedAt: this.clock.now() })
          .where(and(eq(fundingOrders.jobId, job.id), inArray(fundingOrders.status, ["CREATED", "APPROVED"])));
      }
      await tx.delete(milestones).where(eq(milestones.jobId, job.id));
      await tx.insert(milestones).values(
        spec.milestones.map((m) => ({
          id: newId("ms"),
          jobId: job.id,
          seq: m.seq,
          title: m.title,
          amountMinor: m.amountMinor,
          dueAt: new Date(m.dueAt),
          criteriaJson: m.acceptanceCriteria,
        })),
      );
      await tx
        .update(jobs)
        .set({
          title: spec.title,
          category: spec.category,
          specJson: spec,
          totalMinor: spec.totalAmountMinor,
          feeMinor: feeForAmount(spec.totalAmountMinor, this.feeBps),
          locationJson: spec.location ?? null,
          updatedAt: this.clock.now(),
        })
        .where(eq(jobs.id, job.id));
      await this.audit.append(
        { actor: `user:${args.payerId}`, action: "job.spec_edited", entityType: "job", entityId: job.id, payload: { totalMinor: spec.totalAmountMinor } },
        tx,
      );
      // A new spec version needs a new signature: the previous Job Mandate is superseded.
      await this.binding.createJobMandate(
        { jobId: job.id, spec, payerId: args.payerId, intentMandateId: job.intentMandateId },
        tx,
        signer,
        "principal", // the payer re-signs any edited spec, including agent-drafted ones
      );
    });
    return (await this.getRow(args.jobId))!;
  }

  /** Worker accepts a funded job. Requires a PayPal payout email (spec §6.5). Activates milestone 1. */
  async accept(args: { jobId: string; workerId: string }): Promise<JobRow> {
    const signer = await this.binding.signerFor({ type: "user", id: args.workerId });
    await this.db.transaction(async (tx) => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, args.jobId)).for("update");
      if (!job) throw new JobError("NOT_FOUND", "Job not found");
      if (job.status !== "FUNDED") throw new JobError("INVALID_STATE", "Only funded jobs can be accepted");
      const [worker] = await tx.select().from(users).where(eq(users.id, args.workerId));
      if (!worker || worker.role !== "worker") throw new JobError("FORBIDDEN", "Only workers can accept jobs");
      if (!worker.paypalEmail) throw new JobError("PAYOUT_EMAIL_REQUIRED", "Add your PayPal email before accepting jobs");
      const g2 = await this.guard.g2Counterparty({ jobId: job.id, worker }, tx);
      if (g2.result !== "allow") throw new JobError("FORBIDDEN", g2.message);
      await this.binding.countersign({ jobId: job.id, workerId: worker.id }, tx, signer);
      await this.setStatus(tx, job, "IN_PROGRESS");
      await tx.update(jobs).set({ workerId: worker.id }).where(eq(jobs.id, job.id));
      const [first] = await tx.select().from(milestones).where(eq(milestones.jobId, job.id)).orderBy(asc(milestones.seq)).limit(1);
      assertTransition("MILESTONE", first.status, "ACTIVE");
      await tx.update(milestones).set({ status: "ACTIVE", activatedAt: this.clock.now(), updatedAt: this.clock.now() }).where(eq(milestones.id, first.id));
      await this.audit.append(
        { actor: `user:${worker.id}`, action: "job.accepted", entityType: "job", entityId: job.id, payload: { workerId: worker.id } },
        tx,
      );
    });
    this.events.publish(`job:${args.jobId}`, "job.accepted", "Worker accepted the job; milestone 1 is active");
    return (await this.getRow(args.jobId))!;
  }

  async getRow(jobId: string, t: DbOrTx = this.db): Promise<JobRow | undefined> {
    const [job] = await t.select().from(jobs).where(eq(jobs.id, jobId));
    return job;
  }

  async detail(jobId: string): Promise<JobDetail | undefined> {
    const job = await this.getRow(jobId);
    if (!job) return undefined;
    const [ms, funding, rel, refundRows, payer, worker] = await Promise.all([
      this.db.select().from(milestones).where(eq(milestones.jobId, jobId)).orderBy(asc(milestones.seq)),
      this.db.select().from(fundingOrders).where(eq(fundingOrders.jobId, jobId)).orderBy(desc(fundingOrders.createdAt)),
      this.db
        .select({ r: releases })
        .from(releases)
        .innerJoin(milestones, eq(milestones.id, releases.milestoneId))
        .where(eq(milestones.jobId, jobId)),
      this.db.select().from(refunds).where(eq(refunds.jobId, jobId)),
      this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, job.payerId)),
      job.workerId
        ? this.db.select({ id: users.id, name: users.name, trustScore: users.trustScore }).from(users).where(eq(users.id, job.workerId))
        : Promise.resolve([]),
    ]);
    const releaseRows = rel.map((x) => x.r);
    const msIds = ms.map((m) => m.id);
    const [proofRows, riskRows] = msIds.length
      ? await Promise.all([
          this.db.select().from(proofs).where(inArray(proofs.milestoneId, msIds)).orderBy(asc(proofs.createdAt)),
          this.db.select().from(riskAssessments).where(inArray(riskAssessments.milestoneId, msIds)).orderBy(asc(riskAssessments.createdAt)),
        ])
      : [[], []];
    const decisions: Record<string, DecisionCard> = {};
    for (const r of riskRows) decisions[r.milestoneId] = r.cardJson as DecisionCard; // ascending, so the latest wins
    const payoutRows = releaseRows.length
      ? await this.db.select().from(payouts).where(inArray(payouts.releaseId, releaseRows.map((r) => r.id)))
      : [];
    const confirmed = funding.filter((f) => f.status === "CONFIRMED");
    return {
      job,
      milestones: ms,
      funding,
      releases: releaseRows,
      payouts: payoutRows,
      money: {
        fundedMinor: confirmed.reduce((a, f) => a + f.amountMinor, 0),
        inEscrowMinor: await this.ledger.balance(escrowCode(jobId)),
        releasedMinor: ms.reduce((a, m) => a + m.releasedMinor, 0),
        refundedMinor: refundRows.filter((r) => r.status === "COMPLETED").reduce((a, r) => a + r.amountMinor, 0),
      },
      payer: payer[0],
      worker: worker[0] ?? null,
      proofs: proofRows,
      decisions,
    };
  }

  /** Jobs visible to a user: payers see theirs, workers see theirs plus funded jobs open to accept, admins see all. */
  async listFor(user: { id: string; role: Role }): Promise<JobRow[]> {
    const q = this.db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(200);
    if (user.role === "admin") return q;
    if (user.role === "payer") return q.where(eq(jobs.payerId, user.id));
    return q.where(or(eq(jobs.workerId, user.id), eq(jobs.status, "FUNDED")));
  }
}
