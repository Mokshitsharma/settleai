// Intent Mandates: draft, sign (browser or managed key), create, revoke, and spend counters (spec §7).
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { apiClients, mandates, spendCounters } from "@/core/db/schema";
import {
  IntentMandatePayload,
  type Category,
  type IntentMandatePayload as IntentPayload,
  type MandateEnvelope,
  type ReasonCode,
} from "@/core/contracts";
import { newId, newNonce } from "@/core/ids";
import { buildEnvelope, signEnvelopePart, verifyEnvelope } from "@/core/mandates/envelope";
import { renderIntentMandate } from "@/core/mandates/plain-language";
import type { ClockPort } from "@/core/ports/clock";
import type { AuditService } from "./audit";
import type { KeyService } from "./keys";

export const MAX_MANDATE_TTL_SECONDS = 30 * 24 * 3600;
const CLOCK_SKEW_MS = 10 * 60 * 1000;

export class MandateError extends Error {
  constructor(
    readonly code: ReasonCode | "MANDATE_NOT_FOUND" | "MANDATE_INVALID_REQUEST" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
  }
}

export interface IntentDraftInput {
  issuerUserId: string;
  keyId: string;
  agentClientId: string;
  humanPresence?: "present" | "not_present";
  categories: Category[];
  maxPerJobMinor: number;
  maxTotalMinor: number;
  maxJobsPerDay: number;
  ttlSeconds: number;
  geoFence?: { lat: number; lng: number; radiusKm: number; label?: string };
  minTrustScore: number;
  requirePayPalEmail: boolean;
  prohibitedKeywords?: string[];
  stepUpAboveMinor: number;
  maxAutoReleaseMinor: number;
  maxChallengeWindowSeconds: number;
}

export interface MandateView {
  id: string;
  status: string;
  envelope: MandateEnvelope;
  plainLanguage: string;
  spentMinor: number;
  remainingMinor: number;
  jobsToday: number;
  revokedAt: string | null;
  revokedReason: string | null;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export class MandateService {
  constructor(
    private readonly db: Db,
    private readonly keys: KeyService,
    private readonly audit: AuditService,
    private readonly clock: ClockPort,
  ) {}

  /** Server builds the payload (ids, nonce and timestamps come from the server clock). The human then signs it. */
  async draftIntent(input: IntentDraftInput): Promise<{ payload: IntentPayload; plainLanguage: string }> {
    const [client] = await this.db.select().from(apiClients).where(eq(apiClients.id, input.agentClientId));
    if (!client || client.ownerUserId !== input.issuerUserId) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Unknown agent client for this user");
    }
    if (input.maxPerJobMinor > input.maxTotalMinor) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Per-job cap cannot exceed the total cap");
    }
    if (input.ttlSeconds <= 0 || input.ttlSeconds > MAX_MANDATE_TTL_SECONDS) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Validity must be between 1 second and 30 days");
    }
    const now = new Date(Math.floor(this.clock.now().getTime() / 1000) * 1000);
    const payload = IntentMandatePayload.parse({
      type: "intent",
      version: 1,
      id: newId("mnd"),
      createdAt: now.toISOString(),
      notBefore: now.toISOString(),
      notAfter: new Date(now.getTime() + input.ttlSeconds * 1000).toISOString(),
      issuer: { userId: input.issuerUserId, keyId: input.keyId },
      agent: { clientId: client.id, name: client.name },
      humanPresence: input.humanPresence ?? "not_present",
      scope: {
        categories: input.categories,
        currency: "USD",
        maxPerJobMinor: input.maxPerJobMinor,
        maxTotalMinor: input.maxTotalMinor,
        maxJobsPerDay: input.maxJobsPerDay,
        geoFence: input.geoFence,
        counterparty: { minTrustScore: input.minTrustScore, requirePayPalEmail: input.requirePayPalEmail },
        prohibitedKeywords: input.prohibitedKeywords?.length ? input.prohibitedKeywords : undefined,
      },
      conditions: {
        requireVerificationBeforeRelease: true,
        stepUpAboveMinor: input.stepUpAboveMinor,
        maxAutoReleaseMinor: input.maxAutoReleaseMinor,
        maxChallengeWindowSeconds: input.maxChallengeWindowSeconds,
      },
      nonce: newNonce(),
    });
    return { payload, plainLanguage: renderIntentMandate(payload) };
  }

  /** Managed-key mode: the server signs on the user's behalf with their encrypted demo key (clearly labelled in UI). */
  async signWithManagedKey(userId: string, payload: IntentPayload): Promise<string> {
    const signer = await this.keys.managedSigner(userId);
    if (!signer || signer.keyId !== payload.issuer.keyId) {
      throw new MandateError("FORBIDDEN", "No managed key for this user, or key does not match the draft");
    }
    return (await signEnvelopePart(payload, signer.privateKey, signer.keyId, "principal")).jws;
  }

  /** Verifies the principal's signature and stores the mandate as ACTIVE. */
  async createIntent(args: { userId: string; payload: unknown; jws: string }): Promise<MandateView> {
    const parsed = IntentMandatePayload.safeParse(args.payload);
    if (!parsed.success) throw new MandateError("MANDATE_INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid mandate");
    const payload = parsed.data;
    if (payload.issuer.userId !== args.userId) throw new MandateError("FORBIDDEN", "You can only sign mandates as yourself");

    const now = this.clock.now().getTime();
    if (Math.abs(Date.parse(payload.createdAt) - now) > CLOCK_SKEW_MS) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Draft is stale; create a new draft");
    }
    if (Date.parse(payload.notAfter) <= now) throw new MandateError("MANDATE_EXPIRED", "Mandate is already expired");
    if (Date.parse(payload.notAfter) - Date.parse(payload.notBefore) > MAX_MANDATE_TTL_SECONDS * 1000) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Validity longer than 30 days");
    }
    if (payload.scope.maxPerJobMinor > payload.scope.maxTotalMinor) {
      throw new MandateError("MANDATE_INVALID_REQUEST", "Per-job cap cannot exceed the total cap");
    }
    const [client] = await this.db.select().from(apiClients).where(eq(apiClients.id, payload.agent.clientId));
    if (!client || client.ownerUserId !== args.userId) throw new MandateError("MANDATE_INVALID_REQUEST", "Unknown agent client");

    const envelope = buildEnvelope(payload, [{ keyId: payload.issuer.keyId, role: "principal", jws: args.jws }]);
    const check = await verifyEnvelope(envelope, (kid) => this.keys.resolve(kid));
    const principal = check.signers.find((s) => s.role === "principal");
    if (!check.ok || !principal || principal.ownerId !== args.userId) {
      throw new MandateError("MANDATE_SIGNATURE_INVALID", check.problems.join("; ") || "Signer does not own this key");
    }

    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(mandates)
        .values({
          id: payload.id,
          type: "intent",
          issuerId: args.userId,
          subjectId: payload.agent.clientId,
          payloadJson: payload,
          payloadHash: envelope.payloadHash,
          signaturesJson: envelope.signatures,
          status: "active",
          nonce: payload.nonce,
          notBefore: new Date(payload.notBefore),
          notAfter: new Date(payload.notAfter),
        })
        .onConflictDoNothing()
        .returning({ id: mandates.id });
      if (inserted.length === 0) throw new MandateError("MANDATE_REPLAY", "This mandate (or its nonce) was already used");
      await this.audit.append(
        {
          actor: `user:${args.userId}`,
          action: "mandate.intent.signed",
          entityType: "mandate",
          entityId: payload.id,
          payload: { payloadHash: envelope.payloadHash, agentClientId: payload.agent.clientId, keyId: payload.issuer.keyId },
        },
        tx,
      );
    });
    return (await this.get(payload.id))!;
  }

  async revoke(args: { mandateId: string; actorUserId: string; actorRole: string; reason: string }): Promise<MandateView> {
    await this.db.transaction(async (tx) => {
      const [m] = await tx.select().from(mandates).where(eq(mandates.id, args.mandateId)).for("update");
      if (!m) throw new MandateError("MANDATE_NOT_FOUND", "Mandate not found");
      if (m.issuerId !== args.actorUserId && args.actorRole !== "admin") throw new MandateError("FORBIDDEN", "Only the issuer or an admin can revoke");
      if (m.status === "revoked") return;
      await tx
        .update(mandates)
        .set({ status: "revoked", revokedAt: this.clock.now(), revokedReason: args.reason, updatedAt: this.clock.now() })
        .where(eq(mandates.id, args.mandateId));
      await this.audit.append(
        {
          actor: `${args.actorRole === "admin" ? "admin" : "user"}:${args.actorUserId}`,
          action: "mandate.revoked",
          entityType: "mandate",
          entityId: args.mandateId,
          payload: { reason: args.reason },
        },
        tx,
      );
    });
    return (await this.get(args.mandateId))!;
  }

  async get(id: string, t: DbOrTx = this.db): Promise<MandateView | undefined> {
    const [m] = await t.select().from(mandates).where(eq(mandates.id, id));
    if (!m) return undefined;
    return this.toView(m, t);
  }

  async listForIssuer(userId: string): Promise<MandateView[]> {
    const rows = await this.db
      .select()
      .from(mandates)
      .where(and(eq(mandates.issuerId, userId), eq(mandates.type, "intent")))
      .orderBy(desc(mandates.createdAt));
    return Promise.all(rows.map((m) => this.toView(m, this.db)));
  }

  private async toView(m: typeof mandates.$inferSelect, t: DbOrTx): Promise<MandateView> {
    const envelope = { payload: m.payloadJson, payloadHash: m.payloadHash, signatures: m.signaturesJson } as MandateEnvelope;
    const payload = m.payloadJson as IntentPayload;
    const { spent, jobsToday } = await this.spendTotals(t, m.id);
    const expired = m.status === "active" && m.notAfter && m.notAfter.getTime() <= this.clock.now().getTime();
    return {
      id: m.id,
      status: expired ? "expired" : m.status,
      envelope,
      plainLanguage: m.type === "intent" ? renderIntentMandate(payload) : "",
      spentMinor: spent,
      remainingMinor: m.type === "intent" ? Math.max(0, payload.scope.maxTotalMinor - spent) : 0,
      jobsToday,
      revokedAt: m.revokedAt?.toISOString() ?? null,
      revokedReason: m.revokedReason,
    };
  }

  private async spendTotals(t: DbOrTx, mandateId: string) {
    const today = utcDay(this.clock.now());
    const [row] = await t
      .select({
        spent: sql<string>`coalesce(sum(${spendCounters.spentMinor}), 0)`,
        jobsToday: sql<string>`coalesce(sum(case when ${spendCounters.day} = ${today} then ${spendCounters.jobsCount} else 0 end), 0)`,
      })
      .from(spendCounters)
      .where(eq(spendCounters.intentMandateId, mandateId));
    return { spent: Number(row.spent), jobsToday: Number(row.jobsToday) };
  }

  /**
   * Atomically checks and records spend against an Intent Mandate's caps. Must run inside the caller's
   * transaction. Locks the mandate row so concurrent requests serialize: the cap can never be exceeded.
   */
  async reserveSpend(
    tx: DbOrTx,
    args: { mandateId: string; amountMinor: number; countsAsJob: boolean },
  ): Promise<{ ok: true } | { ok: false; codes: ReasonCode[]; message: string }> {
    const [m] = await tx.select().from(mandates).where(eq(mandates.id, args.mandateId)).for("update");
    if (!m) return { ok: false, codes: ["MANDATE_CHAIN_INVALID"], message: "Mandate not found" };
    const scope = (m.payloadJson as IntentPayload).scope;
    const { spent, jobsToday } = await this.spendTotals(tx, m.id);
    const codes: ReasonCode[] = [];
    const reasons: string[] = [];
    if (args.amountMinor > scope.maxPerJobMinor) {
      codes.push("MANDATE_CAP_EXCEEDED");
      reasons.push(`amount exceeds the per-job cap`);
    } else if (spent + args.amountMinor > scope.maxTotalMinor) {
      codes.push("MANDATE_CAP_EXCEEDED");
      reasons.push(`only ${scope.maxTotalMinor - spent} minor units of budget remain`);
    }
    if (args.countsAsJob && jobsToday + 1 > scope.maxJobsPerDay) {
      codes.push("MANDATE_RATE_EXCEEDED");
      reasons.push(`daily limit of ${scope.maxJobsPerDay} jobs reached`);
    }
    if (codes.length) return { ok: false, codes, message: reasons.join("; ") };

    const day = utcDay(this.clock.now());
    await tx
      .insert(spendCounters)
      .values({ id: newId("spc"), intentMandateId: m.id, day, spentMinor: 0, jobsCount: 0 })
      .onConflictDoNothing();
    await tx
      .update(spendCounters)
      .set({
        spentMinor: sql`${spendCounters.spentMinor} + ${args.amountMinor}`,
        jobsCount: sql`${spendCounters.jobsCount} + ${args.countsAsJob ? 1 : 0}`,
        version: sql`${spendCounters.version} + 1`,
      })
      .where(and(eq(spendCounters.intentMandateId, m.id), eq(spendCounters.day, day)));
    return { ok: true };
  }
}
