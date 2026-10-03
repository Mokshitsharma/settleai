// Agent-initiated jobs (journey J4): an external agent asks to hire within its Intent Mandate.
// Order matters: G1 dry run -> Scoping Agent proposes -> G1 again on the exact proposal, with the spend
// reservation and the job creation in ONE transaction. The LLM never decides whether the hire is allowed.
import type { Db } from "@/core/db/client";
import type { GuardDecision, JobSpec } from "@/core/contracts";
import { guessCategory, scopeJob } from "@/core/agents/scoping";
import type { EventHub } from "@/core/events/hub";
import { emitterFor } from "@/core/events/hub";
import { newId } from "@/core/ids";
import { formatMinor } from "@/core/money";
import type { ClockPort } from "@/core/ports/clock";
import type { LlmPort } from "@/core/ports/llm";
import type { MandateBindingService } from "./binding";
import type { MandateGuardService } from "./guard";
import type { JobRow, JobService } from "./jobs";
import type { MandateService } from "./mandates";

export interface AgentJobRequest {
  clientId: string;
  mandateId: string;
  description: string;
  budgetMinor: number;
  requestNonce: string; // idempotency: the same request can never create two jobs
  location?: { lat: number; lng: number };
}

export type AgentJobResult =
  | { ok: true; job: JobRow; spec: JobSpec; decision: GuardDecision }
  | { ok: false; decision: GuardDecision; stage: "precheck" | "scoping" | "final" };

export class AgentJobService {
  constructor(
    private readonly db: Db,
    private readonly llm: LlmPort,
    private readonly guard: MandateGuardService,
    private readonly mandates: MandateService,
    private readonly binding: MandateBindingService,
    private readonly jobs: JobService,
    private readonly events: EventHub,
    private readonly clock: ClockPort,
  ) {}

  async create(req: AgentJobRequest): Promise<AgentJobResult> {
    const emit = emitterFor(this.events, "admin");
    const category = guessCategory(req.description);
    const pre = await this.guard.g1CreateJob({
      mandateId: req.mandateId,
      clientId: req.clientId,
      category,
      text: req.description,
      amountMinor: req.budgetMinor,
      location: req.location,
      requestNonce: req.requestNonce,
      dryRun: true,
    });
    if (pre.result !== "allow") {
      emit("guard.denied", `Mandate Guard denied an agent request: ${pre.reasonCodes.join(", ")}`, { codes: pre.reasonCodes });
      return { ok: false, decision: pre, stage: "precheck" };
    }

    // The budget is stated in the text, so the Scoping Agent's never-invent-amounts guard enforces it exactly.
    const scoped = await scopeJob(
      { db: this.db, llm: this.llm, emit },
      { text: `${req.description}\nBudget: ${formatMinor(req.budgetMinor)}.`, payerId: "agent", now: this.clock.now(), entityId: newId("draft") },
    );
    if (!scoped.ok) {
      return { ok: false, stage: "scoping", decision: { result: "deny", gate: "G1", reasonCodes: [], message: `The scoping agent could not produce a valid job (${scoped.error}). Nothing was created.` } };
    }
    const spec = scoped.output;
    const mandate = await this.mandates.get(req.mandateId);
    const payerId = mandate?.envelope.payload.type === "intent" ? mandate.envelope.payload.issuer.userId : "";
    // Load the agent's key before the transaction (PGlite single-connection rule).
    await this.binding.signerFor({ type: "client", id: req.clientId });

    const outcome = await this.db.transaction(async (tx) => {
      const decision = await this.guard.g1CreateJob(
        {
          mandateId: req.mandateId,
          clientId: req.clientId,
          category: spec.category,
          text: `${req.description}\n${spec.title}\n${spec.summary}`,
          amountMinor: spec.totalAmountMinor,
          location: spec.location ? { lat: spec.location.lat, lng: spec.location.lng } : req.location,
          requestNonce: req.requestNonce,
        },
        tx,
      );
      if (decision.result !== "allow") return { decision };
      const job = await this.jobs.createFromSpec(
        { payerId, spec, createdBy: `api_client:${req.clientId}`, intentMandateId: req.mandateId, requestNonce: req.requestNonce },
        tx,
      );
      return { decision, job };
    });
    if (!outcome.job) return { ok: false, decision: outcome.decision, stage: "final" };
    return { ok: true, job: outcome.job, spec, decision: outcome.decision };
  }
}
