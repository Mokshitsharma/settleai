import { z } from "zod";
import { Category, Currency, Hex64, IsoDateTime, MinorAmount } from "./common";

export const SignerRole = z.enum(["principal", "agent", "worker", "platform", "admin"]);
export type SignerRole = z.infer<typeof SignerRole>;

export const Signature = z.object({ keyId: z.string(), role: SignerRole, jws: z.string() });

export const IntentMandatePayload = z.object({
  type: z.literal("intent"),
  version: z.literal(1),
  id: z.string(),
  createdAt: IsoDateTime,
  notBefore: IsoDateTime,
  notAfter: IsoDateTime,
  issuer: z.object({ userId: z.string(), keyId: z.string() }),
  agent: z.object({ clientId: z.string(), name: z.string() }),
  humanPresence: z.enum(["present", "not_present"]),
  scope: z.object({
    categories: z.array(Category).min(1),
    currency: Currency,
    maxPerJobMinor: MinorAmount,
    maxTotalMinor: MinorAmount,
    maxJobsPerDay: z.number().int().positive(),
    geoFence: z
      .object({ lat: z.number(), lng: z.number(), radiusKm: z.number().positive(), label: z.string().optional() })
      .optional(),
    counterparty: z.object({ minTrustScore: z.number().min(0).max(100), requirePayPalEmail: z.boolean() }),
    prohibitedKeywords: z.array(z.string()).optional(),
  }),
  conditions: z.object({
    requireVerificationBeforeRelease: z.literal(true), // cannot be false in v2
    stepUpAboveMinor: MinorAmount,
    maxAutoReleaseMinor: MinorAmount,
    maxChallengeWindowSeconds: z.number().int().positive(),
  }),
  nonce: z.string().min(8),
});
export type IntentMandatePayload = z.infer<typeof IntentMandatePayload>;

export const JobMandatePayload = z.object({
  type: z.literal("job"),
  version: z.literal(1),
  id: z.string(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  parentIntentId: z.string(),
  payerId: z.string(),
  agentClientId: z.string().optional(),
  workerId: z.string().optional(),
  jobSpecHash: Hex64,
  milestonesHash: Hex64,
  criteriaHash: Hex64,
  totalMinor: MinorAmount,
  currency: Currency,
  nonce: z.string().min(8),
});
export type JobMandatePayload = z.infer<typeof JobMandatePayload>;

export const SettlementRequirement = z.enum(["verification.pass", "risk.not_hold", "mandate.active"]);

export const PaymentMandatePayload = z.object({
  type: z.literal("payment"),
  version: z.literal(1),
  id: z.string(),
  createdAt: IsoDateTime,
  parentJobMandateId: z.string(),
  parentIntentId: z.string(),
  funding: z.object({
    amountMinor: MinorAmount,
    feeMinor: MinorAmount,
    /** The part of the fee that passes PayPal's costs through; not refundable, because PayPal keeps it on a refund. */
    processingFeeMinor: MinorAmount.optional(),
    currency: Currency,
    paypalOrderRef: z.string(),
  }),
  settlementConditions: z.array(
    z.object({
      milestoneSeq: z.number().int().positive(),
      amountMinor: MinorAmount,
      criteriaHash: Hex64,
      releasePolicyVersion: z.number().int().positive(),
      challengeWindowSeconds: z.number().int().nonnegative(),
      requires: z.array(SettlementRequirement).min(1),
    }),
  ),
  agentPresence: z.boolean(),
  nonce: z.string().min(8),
});
export type PaymentMandatePayload = z.infer<typeof PaymentMandatePayload>;

export const MandatePayload = z.discriminatedUnion("type", [
  IntentMandatePayload,
  JobMandatePayload,
  PaymentMandatePayload,
]);
export type MandatePayload = z.infer<typeof MandatePayload>;

/** Envelope: { payload, payloadHash, signatures } where payloadHash = sha256(canonical(payload)). */
export const MandateEnvelope = z.object({
  payload: MandatePayload,
  payloadHash: Hex64,
  signatures: z.array(Signature).min(1),
});
export type MandateEnvelope = z.infer<typeof MandateEnvelope>;

export const ReasonCode = z.enum([
  "MANDATE_SIGNATURE_INVALID",
  "MANDATE_EXPIRED",
  "MANDATE_NOT_YET_VALID",
  "MANDATE_REVOKED",
  "MANDATE_CHAIN_INVALID",
  "MANDATE_SCOPE_VIOLATION",
  "MANDATE_CAP_EXCEEDED",
  "MANDATE_RATE_EXCEEDED",
  "MANDATE_GEO_VIOLATION",
  "MANDATE_COUNTERPARTY_REJECTED",
  "MANDATE_REPLAY",
  "STEP_UP_REQUIRED",
  "RELEASE_CONDITION_UNMET",
]);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const Gate = z.enum(["G1", "G2", "G3", "G4"]);
export type Gate = z.infer<typeof Gate>;

export const GuardDecision = z.object({
  result: z.enum(["allow", "deny", "step_up"]),
  gate: Gate,
  reasonCodes: z.array(ReasonCode),
  message: z.string(),
});
export type GuardDecision = z.infer<typeof GuardDecision>;
