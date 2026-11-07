// Receipt bundle format and the offline verifier (spec §7.6). Pure code: runs in Node (CLI, server) and
// in the browser (/verify) with no SettleAI server involved.
import type { JWK } from "jose";
import type {
  Attestation,
  IntentMandatePayload,
  JobMandatePayload,
  MandateEnvelope,
  PaymentMandatePayload,
} from "@/core/contracts";
import { verifyAttestationChain, verifyEnvelope, type KeyRecord } from "@/core/mandates/envelope";
import { keyIdFor } from "@/core/mandates/jws";

export const RECEIPT_FORMAT = "settleai.receipt";

export interface ReceiptBundle {
  format: typeof RECEIPT_FORMAT;
  version: 1;
  publicId: string;
  issuedAt: string;
  job: {
    title: string;
    category: string;
    status: string;
    currency: "USD";
    totalMinor: number;
    feeMinor: number;
    agentInitiated: boolean;
    locationLabel: string | null; // label only; exact coordinates are never published
  };
  mandates: { intent: MandateEnvelope | null; job: MandateEnvelope; payment: MandateEnvelope };
  attestations: Attestation[];
  keys: KeyRecord[];
  paypal: { orderId: string | null; captureId: string | null; payoutItemIds: string[]; refundIds: string[] }; // masked
  /** Not signed, like the ledger summary: the signed part is funding.processingFeeMinor in the Payment Mandate. */
  fees: { serviceFeeMinor: number; processingFeeMinor: number; paypalChargedMinor: number };
  ledger: { fundedMinor: number; releasedMinor: number; refundedMinor: number; inEscrowMinor: number };
}

export interface ReceiptCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  pointer?: string; // where the problem is, e.g. "attestations[7] (seq 7, settlement)"
}

export interface ReceiptVerification {
  ok: boolean;
  checks: ReceiptCheck[];
  warnings: string[];
}

export interface VerifyOptions {
  /** Platform key ids published by SettleAI (fetched separately). Without them the platform key is not pinned. */
  trustedPlatformKeyIds?: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export async function verifyReceipt(input: unknown, opts: VerifyOptions = {}): Promise<ReceiptVerification> {
  const checks: ReceiptCheck[] = [];
  const warnings: string[] = [];
  const add = (c: ReceiptCheck) => checks.push(c);

  // 1. Shape
  const b = input as ReceiptBundle;
  if (!isObj(b) || b.format !== RECEIPT_FORMAT || !isObj(b.mandates) || !Array.isArray(b.attestations) || !Array.isArray(b.keys)) {
    add({ id: "format", label: "Receipt format", ok: false, detail: "This is not a SettleAI receipt bundle" });
    return { ok: false, checks, warnings };
  }
  add({ id: "format", label: "Receipt format", ok: true, detail: `SettleAI receipt v${b.version} for job ${b.publicId}` });

  // 2. Keys: every key id must be the thumbprint of its key, and the platform key must be pinned.
  const keyProblems: string[] = [];
  for (const [i, k] of b.keys.entries()) {
    try {
      if ((await keyIdFor(k.publicJwk as JWK)) !== k.keyId) keyProblems.push(`keys[${i}] id does not match its public key`);
    } catch {
      keyProblems.push(`keys[${i}] is not a valid public key`);
    }
  }
  const platformKeys = b.keys.filter((k) => k.ownerType === "platform").map((k) => k.keyId);
  if (opts.trustedPlatformKeyIds) {
    const untrusted = platformKeys.filter((k) => !opts.trustedPlatformKeyIds!.includes(k));
    if (untrusted.length) keyProblems.push(`platform key ${untrusted[0]} is not one SettleAI published`);
  } else {
    warnings.push("The platform key was not pinned to SettleAI's published keys; signatures prove internal consistency only.");
  }
  add({
    id: "keys",
    label: "Signing keys",
    ok: keyProblems.length === 0,
    detail: keyProblems[0] ?? `${b.keys.length} public keys, each bound to its key id${opts.trustedPlatformKeyIds ? "; platform key matches SettleAI's published key" : ""}`,
    pointer: keyProblems.length ? "keys" : undefined,
  });
  const resolve = (kid: string) => b.keys.find((k) => k.keyId === kid);

  // 3. Mandate signatures
  const named: [string, MandateEnvelope | null][] = [
    ["intent", b.mandates.intent],
    ["job", b.mandates.job],
    ["payment", b.mandates.payment],
  ];
  for (const [name, env] of named) {
    if (!env) continue;
    const r = await verifyEnvelope(env, resolve, { requireActiveAt: (env.payload as { createdAt: string }).createdAt });
    add({
      id: `mandate.${name}`,
      label: `${name[0].toUpperCase()}${name.slice(1)} mandate signature`,
      ok: r.ok,
      detail: r.ok ? `Signed by ${r.signers.map((s) => s.role).join(" and ")}` : r.problems[0],
      pointer: r.ok ? undefined : `mandates.${name}`,
    });
  }

  // 4. Lineage: payment -> job -> intent
  const intent = b.mandates.intent?.payload as IntentMandatePayload | undefined;
  const job = b.mandates.job?.payload as JobMandatePayload | undefined;
  const pay = b.mandates.payment?.payload as PaymentMandatePayload | undefined;
  const lineage: string[] = [];
  if (!job || !pay) lineage.push("job or payment mandate missing");
  else {
    if (pay.parentJobMandateId !== job.id) lineage.push("payment mandate does not point to the job mandate");
    if (pay.parentIntentId !== job.parentIntentId) lineage.push("payment and job mandates name different intents");
    if (intent) {
      if (job.parentIntentId !== intent.id) lineage.push("job mandate does not point to the intent mandate");
      if (job.agentClientId !== intent.agent.clientId) lineage.push("job was signed for a different agent than the intent allows");
    } else if (!job.parentIntentId.startsWith("direct:")) lineage.push("intent mandate missing for an agent job");
  }
  add({ id: "lineage", label: "Mandate lineage", ok: lineage.length === 0, detail: lineage[0] ?? (intent ? "Payment mandate, job mandate and intent mandate link correctly" : "Direct job: payment mandate links to the payer's job mandate"), pointer: lineage.length ? "mandates" : undefined });

  // 5. Proof chain: hashes, links, signatures; and it must vouch for exactly these mandates.
  const chain = await verifyAttestationChain(b.attestations, resolve);
  add({
    id: "chain",
    label: "Proof chain",
    ok: chain.ok,
    detail: chain.ok ? `${chain.checked} attestations, every link and signature verifies` : `Broken at seq ${chain.brokenAt?.seq}: ${chain.brokenAt?.reason}`,
    pointer: chain.ok ? undefined : `attestations[${chain.brokenAt?.seq}] (${b.attestations.find((a) => a.seq === chain.brokenAt?.seq)?.type ?? "?"})`,
  });
  const anchored = (env: MandateEnvelope | null) =>
    !env || b.attestations.some((a) => a.type === "mandate" && a.subjectId === (env.payload as { id: string }).id && a.payload.payloadHash === env.payloadHash);
  const unanchored = [job && !anchored(b.mandates.job) ? "job" : null, pay && !anchored(b.mandates.payment) ? "payment" : null].filter(Boolean);
  add({
    id: "anchoring",
    label: "Mandates anchored in the chain",
    ok: unanchored.length === 0,
    detail: unanchored.length ? `The ${unanchored[0]} mandate in this bundle is not the one the platform recorded` : "The platform-signed chain records these exact mandate hashes",
    pointer: unanchored.length ? `mandates.${unanchored[0]}` : undefined,
  });

  // 6. Actions inside the mandate at their time
  const scope: string[] = [];
  if (intent && job) {
    if (job.totalMinor > intent.scope.maxPerJobMinor) scope.push(`job total ${job.totalMinor} exceeds the per-job cap ${intent.scope.maxPerJobMinor}`);
    const t = Date.parse(job.createdAt);
    if (t < Date.parse(intent.notBefore) || t >= Date.parse(intent.notAfter)) scope.push("job was created outside the intent mandate's validity window");
  }
  const revocationAt = b.attestations.filter((a) => a.type === "revocation").map((a) => Date.parse(a.createdAt)).sort()[0];
  const autoAfterRevocation = b.attestations.find((a) => a.type === "settlement" && a.payload.decisionSource === "auto" && revocationAt !== undefined && Date.parse(a.createdAt) > revocationAt);
  if (autoAfterRevocation) scope.push(`automatic payout (seq ${autoAfterRevocation.seq}) happened after the mandate was revoked`);
  add({ id: "scope", label: "Actions within the mandate", ok: scope.length === 0, detail: scope[0] ?? (intent ? "Job size and timing were inside the signed mandate; no payout after revocation" : "No agent mandate applies to this direct job"), pointer: autoAfterRevocation ? `attestations[${autoAfterRevocation.seq}] (settlement)` : scope.length ? "mandates.job" : undefined });

  // 7. Money and settlement conditions
  const money: string[] = [];
  let pointer: string | undefined;
  if (pay) {
    let paidOut = 0;
    let refunded = 0;
    const perMilestone = new Map<number, number>();
    for (const a of b.attestations.filter((x) => x.type === "settlement")) {
      const p = a.payload as Record<string, number | string>;
      const seq = Number(p.milestoneSeq);
      const released = Number(p.event === "dispute_settled" ? p.releaseToWorkerMinor : p.amountMinor);
      // A dispute's payout is recorded twice: in "dispute_settled", and in the payout's own settlement once PayPal confirms
      // it, which on real PayPal comes later. Count the payout's record when there is one, whatever the order.
      if (p.event !== "dispute_settled" || !b.attestations.some((x) => x.type === "settlement" && x.payload.decisionSource === "dispute" && Number(x.payload.milestoneSeq) === seq)) {
        paidOut += released;
        perMilestone.set(seq, (perMilestone.get(seq) ?? 0) + released);
      }
      if (p.event === "dispute_settled") refunded += Number(p.refundToPayerMinor) + Number(p.feeRefundedMinor ?? 0);
      const cond = pay.settlementConditions.find((c) => c.milestoneSeq === seq);
      if (!cond) {
        money.push(`settlement for milestone ${seq} has no settlement condition`);
        pointer ??= `attestations[${a.seq}] (settlement)`;
      } else if ((perMilestone.get(seq) ?? 0) > cond.amountMinor) {
        money.push(`milestone ${seq} paid more than its signed amount`);
        pointer ??= `attestations[${a.seq}] (settlement)`;
      }
      // Automatic payouts need a passing verification and an AUTO_RELEASE decision earlier in the chain.
      if (p.decisionSource === "auto") {
        const earlier = b.attestations.filter((x) => x.seq < a.seq && Number(x.payload.milestoneSeq) === seq);
        const verified = earlier.some((x) => x.type === "verification" && x.payload.overall === "pass");
        const decided = earlier.some((x) => x.type === "decision" && x.payload.decision === "AUTO_RELEASE");
        if (!verified || !decided) {
          money.push(`automatic payout for milestone ${seq} lacks a passing verification and AUTO_RELEASE decision`);
          pointer ??= `attestations[${a.seq}] (settlement)`;
        }
      }
    }
    if (paidOut + refunded > pay.funding.amountMinor) {
      money.push(`payouts and refunds (${paidOut + refunded}) exceed the funded amount (${pay.funding.amountMinor})`);
    }
    add({
      id: "money",
      label: "Money and settlement conditions",
      ok: money.length === 0,
      detail: money[0] ?? `Funded ${pay.funding.amountMinor}, paid out ${paidOut}, refunded ${refunded} (minor units); every payout met its settlement conditions`,
      pointer,
    });
  }

  warnings.push("PayPal transaction ids are masked; a live PayPal lookup is not part of the offline check.");
  return { ok: checks.every((c) => c.ok), checks, warnings };
}

/** Masks a PayPal id for publication: keeps a short prefix and the last 4 characters. */
export function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id.length <= 8 ? `…${id.slice(-4)}` : `${id.slice(0, 4)}…${id.slice(-4)}`;
}
