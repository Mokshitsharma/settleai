// Job and Payment Mandates (spec §7.2, T205). A Job Mandate binds the exact spec, milestones and criteria
// by hash; the worker countersigns on acceptance. A Payment Mandate carries per-milestone settlement
// conditions and is bound to the PayPal order through custom_id.
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { mandates } from "@/core/db/schema";
import {
  JobMandatePayload,
  PaymentMandatePayload,
  type JobSpec,
  type MandateEnvelope,
  type SignerRole,
} from "@/core/contracts";
import { newId, newNonce } from "@/core/ids";
import { hashCanonical } from "@/core/mandates/canonical";
import { buildEnvelope, signEnvelopePart } from "@/core/mandates/envelope";
import type { ClockPort } from "@/core/ports/clock";
import type { AttestationService } from "./attestations";
import type { KeyService, Signer } from "./keys";

export const DIRECT_PREFIX = "direct:";

export function specHashes(spec: JobSpec) {
  return {
    jobSpecHash: hashCanonical(spec),
    milestonesHash: hashCanonical(spec.milestones.map(({ seq, title, amountMinor, dueAt }) => ({ seq, title, amountMinor, dueAt }))),
    criteriaHash: hashCanonical(spec.milestones.map((m) => ({ seq: m.seq, criteria: m.acceptanceCriteria }))),
  };
}

export const milestoneCriteriaHash = (spec: JobSpec, seq: number) =>
  hashCanonical(spec.milestones.find((m) => m.seq === seq)?.acceptanceCriteria ?? []);

type MandateRow = typeof mandates.$inferSelect;
const toEnvelope = (m: MandateRow) => ({ payload: m.payloadJson, payloadHash: m.payloadHash, signatures: m.signaturesJson }) as MandateEnvelope;

export class MandateBindingService {
  constructor(
    private readonly db: Db,
    private readonly keys: KeyService,
    private readonly attestations: AttestationService,
    private readonly clock: ClockPort,
  ) {}

  /** Signs as a user (payer/worker, managed demo key) or an agent client. */
  private async signer(owner: { type: "user" | "client"; id: string }) {
    await this.keys.ensureManagedKey(owner.type, owner.id);
    const s = await this.keys.managedSigner(owner.id);
    if (!s) throw new Error(`No signing key for ${owner.type} ${owner.id}`);
    return s;
  }

  /**
   * Creates the Job Mandate for a confirmed spec. Any previous Job Mandate for the job is superseded
   * (spec edits after signing create a new version). Must be called OUTSIDE an open transaction for key
   * creation, then `tx` is used for writes.
   */
  async createJobMandate(
    args: { jobId: string; spec: JobSpec; payerId: string; intentMandateId?: string | null; agentClientId?: string | null; nonce?: string },
    tx: DbOrTx,
    signer: Signer,
    role: SignerRole,
  ): Promise<MandateEnvelope> {
    const now = new Date(Math.floor(this.clock.now().getTime() / 1000) * 1000);
    const payload = JobMandatePayload.parse({
      type: "job",
      version: 1,
      id: newId("jmd"),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(),
      parentIntentId: args.intentMandateId ?? `${DIRECT_PREFIX}${args.payerId}`,
      payerId: args.payerId,
      agentClientId: args.agentClientId ?? undefined,
      ...specHashes(args.spec),
      totalMinor: args.spec.totalAmountMinor,
      currency: "USD",
      nonce: args.nonce ?? newNonce(),
    });
    const envelope = buildEnvelope(payload, [await signEnvelopePart(payload, signer.privateKey, signer.keyId, role)]);
    await tx
      .update(mandates)
      .set({ status: "revoked", revokedReason: "superseded by a new spec version", revokedAt: now })
      .where(and(eq(mandates.type, "job"), eq(mandates.subjectId, args.jobId), eq(mandates.status, "active")));
    await tx.insert(mandates).values({
      id: payload.id,
      type: "job",
      parentId: args.intentMandateId ?? null,
      issuerId: args.agentClientId ?? args.payerId,
      subjectId: args.jobId,
      payloadJson: payload,
      payloadHash: envelope.payloadHash,
      signaturesJson: envelope.signatures,
      status: "active",
      nonce: payload.nonce,
      notBefore: now,
      notAfter: new Date(payload.expiresAt),
    });
    await this.attestations.append(
      {
        jobId: args.jobId,
        type: "mandate",
        subjectId: payload.id,
        payload: { mandateType: "job", payloadHash: envelope.payloadHash, parentIntentId: payload.parentIntentId, signers: envelope.signatures.map((s) => ({ role: s.role, keyId: s.keyId })), totalMinor: payload.totalMinor },
      },
      tx,
    );
    return envelope;
  }

  async signerFor(owner: { type: "user" | "client"; id: string }) {
    return this.signer(owner);
  }

  async activeJobMandate(jobId: string, t: DbOrTx = this.db): Promise<MandateRow | undefined> {
    const [m] = await t
      .select()
      .from(mandates)
      .where(and(eq(mandates.type, "job"), eq(mandates.subjectId, jobId), inArray(mandates.status, ["active", "consumed"])))
      .orderBy(desc(mandates.createdAt))
      .limit(1);
    return m;
  }

  /** Worker countersigns the Job Mandate on acceptance (same canonical payload, new signature). */
  async countersign(args: { jobId: string; workerId: string }, tx: DbOrTx, signer: Signer): Promise<void> {
    const m = await this.activeJobMandate(args.jobId, tx);
    if (!m) throw new Error("Job has no Job Mandate to countersign");
    const env = toEnvelope(m);
    if (env.signatures.some((s) => s.role === "worker")) return;
    const sig = await signEnvelopePart(env.payload, signer.privateKey, signer.keyId, "worker");
    const signatures = [...env.signatures, sig];
    await tx.update(mandates).set({ signaturesJson: signatures, updatedAt: this.clock.now() }).where(eq(mandates.id, m.id));
    await this.attestations.append(
      { jobId: args.jobId, type: "mandate", subjectId: m.id, payload: { mandateType: "job", event: "worker_countersigned", workerId: args.workerId, keyId: signer.keyId } },
      tx,
    );
  }

  /** Payment Mandate with settlement conditions per milestone; its hash is bound into PayPal custom_id. */
  async createPaymentMandate(
    args: {
      jobId: string;
      spec: JobSpec;
      fundingId: string;
      amountMinor: number;
      feeMinor: number;
      processingFeeMinor?: number;
      policyVersion: number;
      challengeWindowSeconds: number;
      agentPresence: boolean;
    },
    tx: DbOrTx,
    signer: Signer,
  ): Promise<MandateEnvelope> {
    const jm = await this.activeJobMandate(args.jobId, tx);
    if (!jm) throw new Error("Job has no Job Mandate");
    const jobPayload = jm.payloadJson as JobMandatePayload;
    const now = new Date(Math.floor(this.clock.now().getTime() / 1000) * 1000);
    const payload = PaymentMandatePayload.parse({
      type: "payment",
      version: 1,
      id: newId("pmd"),
      createdAt: now.toISOString(),
      parentJobMandateId: jm.id,
      parentIntentId: jobPayload.parentIntentId,
      funding: { amountMinor: args.amountMinor, feeMinor: args.feeMinor, processingFeeMinor: args.processingFeeMinor, currency: "USD", paypalOrderRef: args.fundingId },
      settlementConditions: args.spec.milestones.map((m) => ({
        milestoneSeq: m.seq,
        amountMinor: m.amountMinor,
        criteriaHash: milestoneCriteriaHash(args.spec, m.seq),
        releasePolicyVersion: args.policyVersion,
        challengeWindowSeconds: args.challengeWindowSeconds,
        requires: ["verification.pass", "risk.not_hold", "mandate.active"],
      })),
      agentPresence: args.agentPresence,
      nonce: newNonce(),
    });
    const envelope = buildEnvelope(payload, [await signEnvelopePart(payload, signer.privateKey, signer.keyId, "principal")]);
    await tx
      .update(mandates)
      .set({ status: "revoked", revokedReason: "superseded by a new funding attempt", revokedAt: now })
      .where(and(eq(mandates.type, "payment"), eq(mandates.subjectId, args.jobId), eq(mandates.status, "active")));
    await tx.insert(mandates).values({
      id: payload.id,
      type: "payment",
      parentId: jm.id,
      issuerId: jobPayload.payerId,
      subjectId: args.jobId,
      payloadJson: payload,
      payloadHash: envelope.payloadHash,
      signaturesJson: envelope.signatures,
      status: "active",
      nonce: payload.nonce,
      notBefore: now,
    });
    await this.attestations.append(
      {
        jobId: args.jobId,
        type: "mandate",
        subjectId: payload.id,
        payload: { mandateType: "payment", payloadHash: envelope.payloadHash, parentJobMandateId: jm.id, amountMinor: args.amountMinor, agentPresence: args.agentPresence },
      },
      tx,
    );
    return envelope;
  }

  async lineage(jobId: string): Promise<MandateEnvelope[]> {
    const rows = await this.db.select().from(mandates).where(eq(mandates.subjectId, jobId)).orderBy(desc(mandates.createdAt));
    const out: MandateEnvelope[] = [];
    const job = rows.find((r) => r.type === "job" && r.status !== "revoked");
    const pay = rows.find((r) => r.type === "payment" && r.status !== "revoked");
    if (job?.parentId) {
      const [intent] = await this.db.select().from(mandates).where(eq(mandates.id, job.parentId));
      if (intent) out.push(toEnvelope(intent));
    }
    if (job) out.push(toEnvelope(job));
    if (pay) out.push(toEnvelope(pay));
    return out;
  }
}
