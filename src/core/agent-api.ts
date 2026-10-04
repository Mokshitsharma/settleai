// Agent-facing API (spec §12.2–12.3). One implementation behind both the REST routes (/api/agent/*) and
// the MCP server. Every job creation goes through Mandate Guard G1; agents never fund, release or pay.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { guessCategory } from "@/core/agents/scoping";
import type { Container } from "@/core/container";
import { Category } from "@/core/contracts";
import { apiClients, jobs, mandates, milestones, riskAssessments } from "@/core/db/schema";
import { hashApiKey } from "@/core/db/seed-demo";
import { newId } from "@/core/ids";
import { timingSafeEqualStr } from "@/core/mandates/canonical";
import { formatMinor } from "@/core/money";
import type { DecisionCard } from "@/core/policy/decision-card";

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type AgentClient = typeof apiClients.$inferSelect;

export async function authenticateAgent(c: Container, authorization: string | null): Promise<AgentClient> {
  const key = /^Bearer\s+(\S+)$/i.exec(authorization ?? "")?.[1];
  if (!key) throw new AgentApiError(401, "UNAUTHENTICATED", "Send your API key as: Authorization: Bearer <key>");
  const hash = hashApiKey(key, c.config.API_KEY_PEPPER);
  const [client] = await c.dbHandle.db.select().from(apiClients).where(eq(apiClients.keyHash, hash));
  if (!client || !timingSafeEqualStr(client.keyHash, hash)) throw new AgentApiError(401, "UNAUTHENTICATED", "Unknown API key");
  if (client.status !== "active") throw new AgentApiError(403, "AGENT_SUSPENDED", `This agent is ${client.status}. Its owner must re-enable it.`);
  return client;
}

export const CreateJobArgs = z.object({
  mandateId: z.string().min(1),
  description: z.string().trim().min(10).max(2000),
  budgetMinor: z.number().int().positive(),
  deadline: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  requestNonce: z.string().min(8).max(100).optional(),
});

export const CheckActionArgs = z.object({
  mandateId: z.string().min(1),
  action: z.literal("create_job").default("create_job"),
  amountMinor: z.number().int().positive(),
  category: Category.optional(),
  description: z.string().max(2000).default(""),
});

export class AgentApi {
  constructor(
    private readonly c: Container,
    private readonly client: AgentClient,
  ) {}

  private requireScope(scope: string) {
    if (!this.client.scopes.includes(scope)) throw new AgentApiError(403, "SCOPE_MISSING", `This API key lacks the ${scope} scope`);
  }

  private async ownJob(jobId: string) {
    const [job] = await this.c.dbHandle.db.select().from(jobs).where(eq(jobs.id, jobId));
    if (!job || job.createdBy !== `api_client:${this.client.id}`) throw new AgentApiError(404, "NOT_FOUND", "No job with that id was created by this agent");
    return job;
  }

  private async ownMandate(mandateId: string) {
    const m = await this.c.mandates.get(mandateId);
    if (!m || m.envelope.payload.type !== "intent" || m.envelope.payload.agent.clientId !== this.client.id) {
      throw new AgentApiError(404, "NOT_FOUND", "No mandate with that id was issued to this agent");
    }
    return m;
  }

  async getMandate(mandateId: string) {
    const m = await this.ownMandate(mandateId);
    const p = m.envelope.payload;
    if (p.type !== "intent") throw new AgentApiError(404, "NOT_FOUND", "Not an intent mandate");
    return {
      mandateId: m.id,
      status: m.status,
      plainLanguage: m.plainLanguage,
      validUntil: p.notAfter,
      scope: { categories: p.scope.categories, maxPerJobMinor: p.scope.maxPerJobMinor, maxTotalMinor: p.scope.maxTotalMinor, maxJobsPerDay: p.scope.maxJobsPerDay, area: p.scope.geoFence ? `${p.scope.geoFence.radiusKm} km around ${p.scope.geoFence.label ?? "the given point"}` : "anywhere" },
      spentMinor: m.spentMinor,
      remainingMinor: m.remainingMinor,
      jobsToday: m.jobsToday,
      stepUpAboveMinor: p.conditions.stepUpAboveMinor,
    };
  }

  /** Dry run of Mandate Guard G1 so the agent can plan within its authority. */
  async checkAction(raw: unknown) {
    const args = CheckActionArgs.parse(raw);
    await this.ownMandate(args.mandateId);
    const decision = await this.c.guard.g1CreateJob({
      mandateId: args.mandateId,
      clientId: this.client.id,
      category: args.category ?? guessCategory(args.description),
      text: args.description,
      amountMinor: args.amountMinor,
      dryRun: true,
    });
    return { allowed: decision.result === "allow", ...decision };
  }

  async createJob(raw: unknown) {
    this.requireScope("jobs:create");
    const args = CreateJobArgs.parse(raw);
    await this.ownMandate(args.mandateId);
    const description = args.deadline ? `${args.description}\nDeadline: ${args.deadline}` : args.description;
    const r = await this.c.agentJobs.create({
      clientId: this.client.id,
      mandateId: args.mandateId,
      description,
      budgetMinor: args.budgetMinor,
      requestNonce: args.requestNonce ?? newId("req"),
      location: args.location,
    });
    if (!r.ok) return { created: false, decision: r.decision };
    this.c.events.publish("admin", "agent.job_created", `${this.client.name} created "${r.job.title}" for ${formatMinor(r.job.totalMinor)}`);
    return {
      created: true,
      jobId: r.job.id,
      status: r.job.status,
      title: r.spec.title,
      totalMinor: r.spec.totalAmountMinor,
      milestones: r.spec.milestones.map((m) => ({ seq: m.seq, title: m.title, amountMinor: m.amountMinor, dueAt: m.dueAt, criteria: m.acceptanceCriteria.map((c) => c.text) })),
      nextStep: "Call confirm_job so the human principal can review and fund it with PayPal.",
      decision: r.decision,
    };
  }

  /** The agent cannot fund: confirming hands the job to the human principal for approval and PayPal funding. */
  async confirmJob(jobId: string, baseUrl: string) {
    const job = await this.ownJob(jobId);
    this.c.events.publish(`job:${job.id}`, "agent.confirm_requested", `${this.client.name} asks the payer to review and fund this job`);
    return { jobId: job.id, status: job.status, approvalUrl: `${baseUrl.replace(/\/$/, "")}/jobs/${job.id}`, message: "The payer must open this link, review the milestones and fund it with PayPal. Agents cannot move money." };
  }

  async getJobStatus(jobId: string) {
    this.requireScope("jobs:read");
    const job = await this.ownJob(jobId);
    const d = (await this.c.jobs.detail(job.id))!;
    const next =
      job.status === "SCOPED" || job.status === "AWAITING_FUNDING"
        ? "Waiting for the payer to fund it with PayPal"
        : job.status === "FUNDED"
          ? "Funded; waiting for a worker to accept"
          : job.status === "COMPLETED"
            ? "Done"
            : "Worker is delivering; proofs are verified before each payout";
    return {
      jobId: job.id,
      title: job.title,
      status: job.status,
      nextAction: next,
      money: d.money,
      milestones: d.milestones.map((m) => ({ id: m.id, seq: m.seq, title: m.title, status: m.status, amountMinor: m.amountMinor, releasedMinor: m.releasedMinor })),
    };
  }

  async listJobs(status?: string) {
    this.requireScope("jobs:read");
    const rows = await this.c.dbHandle.db.select().from(jobs).where(eq(jobs.createdBy, `api_client:${this.client.id}`)).orderBy(desc(jobs.createdAt)).limit(50);
    return rows.filter((j) => !status || j.status === status).map((j) => ({ jobId: j.id, title: j.title, status: j.status, totalMinor: j.totalMinor }));
  }

  async getDecision(milestoneId: string) {
    this.requireScope("proofs:read");
    const [ms] = await this.c.dbHandle.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!ms) throw new AgentApiError(404, "NOT_FOUND", "Milestone not found");
    await this.ownJob(ms.jobId);
    const [r] = await this.c.dbHandle.db.select().from(riskAssessments).where(eq(riskAssessments.milestoneId, ms.id)).orderBy(desc(riskAssessments.createdAt)).limit(1);
    if (!r) return { milestoneId, status: ms.status, decision: null, message: "Not verified yet" };
    const card = r.cardJson as DecisionCard;
    return { milestoneId, status: ms.status, decision: card.decision, score: card.score, explanation: card.explanation, criteria: card.criteria.map((c) => ({ text: c.text, verdict: c.verdict })) };
  }

  /** Opens a dispute on behalf of the agent's principal (the payer). */
  async requestDispute(milestoneId: string, reason: string) {
    this.requireScope("disputes:open");
    const [ms] = await this.c.dbHandle.db.select().from(milestones).where(eq(milestones.id, milestoneId));
    if (!ms) throw new AgentApiError(404, "NOT_FOUND", "Milestone not found");
    const job = await this.ownJob(ms.jobId);
    const d = await this.c.disputes.open({ milestoneId, userId: job.payerId, reason: `[${this.client.name} on behalf of the payer] ${reason}` });
    return { disputeId: d.id, status: d.status, evidenceUntil: d.deadlineAt.toISOString() };
  }

  async getProofChain(jobId: string, baseUrl: string) {
    const job = await this.ownJob(jobId);
    const chain = await this.c.attestations.chain(job.id);
    const check = await this.c.attestations.verify(job.id);
    return {
      jobId: job.id,
      verified: check.ok,
      attestations: chain.map((a) => ({ seq: a.seq, type: a.type, at: a.createdAt, hash: a.hash.slice(0, 16) })),
      receiptUrl: `${baseUrl.replace(/\/$/, "")}/receipt/${job.id}`,
    };
  }

  /** Mandates issued to this agent (so it can discover its authority). */
  async listMandates() {
    const rows = await this.c.dbHandle.db
      .select({ id: mandates.id })
      .from(mandates)
      .where(and(eq(mandates.type, "intent"), eq(mandates.subjectId, this.client.id)))
      .orderBy(desc(mandates.createdAt));
    return Promise.all(rows.map((r) => this.getMandate(r.id)));
  }
}
