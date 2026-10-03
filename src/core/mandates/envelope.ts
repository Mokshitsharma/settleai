// Mandate envelopes and attestation chains: pure build/verify logic shared by server, CLI and browser.
import type { JWK } from "jose";
import type { Attestation, MandateEnvelope, MandatePayload, SignerRole } from "@/core/contracts";
import { MandateEnvelope as MandateEnvelopeSchema } from "@/core/contracts";
import { canonicalize, hashCanonical, sha256Hex, timingSafeEqualStr } from "./canonical";
import { signCanonical, verifyCanonical, type SigningKey } from "./jws";

export interface KeyRecord {
  keyId: string;
  publicJwk: JWK;
  ownerType: "user" | "client" | "platform";
  ownerId: string;
  status: "active" | "retired" | "revoked";
  createdAt: string; // ISO
  retiredAt?: string | null;
}

export type KeyResolver = (keyId: string) => KeyRecord | undefined | Promise<KeyRecord | undefined>;

export async function signEnvelopePart(payload: MandatePayload, key: SigningKey, keyId: string, role: SignerRole) {
  return { keyId, role, jws: await signCanonical(payload, key, keyId) };
}

export function buildEnvelope(payload: MandatePayload, signatures: MandateEnvelope["signatures"]): MandateEnvelope {
  return { payload, payloadHash: hashCanonical(payload), signatures };
}

export interface EnvelopeCheck {
  ok: boolean;
  problems: string[];
  signers: { keyId: string; role: SignerRole; ownerId?: string }[];
}

/**
 * Verifies schema, payload hash and every signature. `requireActiveAt` (ISO) additionally requires each
 * key to have been valid at that moment (created before it, and not retired or revoked by then).
 */
export async function verifyEnvelope(
  envelope: unknown,
  resolveKey: KeyResolver,
  opts: { requireActiveAt?: string } = {},
): Promise<EnvelopeCheck> {
  const problems: string[] = [];
  const parsed = MandateEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) return { ok: false, problems: [`schema: ${parsed.error.issues[0]?.message}`], signers: [] };
  const env = parsed.data;
  if (!timingSafeEqualStr(env.payloadHash, hashCanonical(env.payload))) problems.push("payloadHash does not match payload");

  const signers: EnvelopeCheck["signers"] = [];
  for (const sig of env.signatures) {
    const key = await resolveKey(sig.keyId);
    if (!key) {
      problems.push(`unknown key ${sig.keyId}`);
      continue;
    }
    if (key.status === "revoked") problems.push(`key ${sig.keyId} is revoked`);
    if (opts.requireActiveAt) {
      const at = Date.parse(opts.requireActiveAt);
      if (Date.parse(key.createdAt) > at) problems.push(`key ${sig.keyId} did not exist at ${opts.requireActiveAt}`);
      if (key.retiredAt && Date.parse(key.retiredAt) <= at) problems.push(`key ${sig.keyId} was retired before ${opts.requireActiveAt}`);
    }
    const result = await verifyCanonical(sig.jws, env.payload, key.publicJwk);
    if (!result.ok) problems.push(`${sig.role} signature: ${result.reason}`);
    else if (result.keyId !== sig.keyId) problems.push(`JWS kid ${result.keyId} != declared ${sig.keyId}`);
    else signers.push({ keyId: sig.keyId, role: sig.role, ownerId: key.ownerId });
  }
  return { ok: problems.length === 0, problems, signers };
}

// ---- Attestation chain ----------------------------------------------------------------------

export const CHAIN_GENESIS = "GENESIS";

export type UnsignedAttestation = Omit<Attestation, "hash" | "signature">;

/** hash = sha256(canonical(attestation without hash and signature)). */
export function attestationHash(a: UnsignedAttestation): string {
  return sha256Hex(canonicalize(a));
}

export async function sealAttestation(a: UnsignedAttestation, key: SigningKey): Promise<Attestation> {
  const hash = attestationHash(a);
  const signature = await signCanonical({ attestationHash: hash }, key, a.signer.keyId);
  return { ...a, hash, signature };
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  brokenAt?: { seq: number; id: string; reason: string };
}

/** Verifies payload hashes, hash links, sequence and signatures of one job's attestation chain. */
export async function verifyAttestationChain(chain: Attestation[], resolveKey: KeyResolver): Promise<ChainCheck> {
  const sorted = [...chain].sort((a, b) => a.seq - b.seq);
  let prev = CHAIN_GENESIS;
  for (const [i, a] of sorted.entries()) {
    const fail = (reason: string): ChainCheck => ({ ok: false, checked: i, brokenAt: { seq: a.seq, id: a.id, reason } });
    if (a.seq !== i) return fail(`expected seq ${i}`);
    if (a.prevHash !== prev) return fail("prevHash does not link to the previous attestation");
    if (!timingSafeEqualStr(a.payloadHash, hashCanonical(a.payload))) return fail("payloadHash does not match payload");
    const { hash, signature, ...unsigned } = a;
    if (!timingSafeEqualStr(hash, attestationHash(unsigned))) return fail("hash mismatch (attestation altered)");
    const key = await resolveKey(a.signer.keyId);
    if (!key) return fail(`unknown signing key ${a.signer.keyId}`);
    const sig = await verifyCanonical(signature, { attestationHash: hash }, key.publicJwk);
    if (!sig.ok) return fail(`signature: ${sig.reason}`);
    prev = hash;
  }
  return { ok: true, checked: sorted.length };
}
