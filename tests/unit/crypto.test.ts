import { exportJWK, generateKeyPair, type JWK } from "jose";
import { describe, expect, it } from "vitest";
import type { IntentMandatePayload } from "@/core/contracts";
import { hashCanonical } from "@/core/mandates/canonical";
import {
  attestationHash,
  buildEnvelope,
  sealAttestation,
  signEnvelopePart,
  verifyAttestationChain,
  verifyEnvelope,
  type KeyRecord,
} from "@/core/mandates/envelope";
import { keyIdFor, signCanonical, verifyCanonical } from "@/core/mandates/jws";
import { sampleIntentMandate } from "../fixtures/contracts";

// Known-answer vector: the PUBLIC example P-256 key from RFC 7515 Appendix A.3 (not a secret). Verification of this exact
// string must keep passing across library upgrades (ES256 signatures are randomized, so we pin verify).
const KAT_PUBLIC: JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};
const KAT_PRIVATE: JWK = { ...KAT_PUBLIC, d: "jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI" };

async function freshKey() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, publicJwk, keyId: await keyIdFor(publicJwk) };
}

function registry(...keys: { keyId: string; publicJwk: JWK }[]) {
  const map = new Map<string, KeyRecord>(
    keys.map((k) => [k.keyId, { ...k, ownerType: "user", ownerId: "usr_ravi", status: "active", createdAt: "2026-01-01T00:00:00Z" }]),
  );
  return (kid: string) => map.get(kid);
}

/** Every leaf path in a JSON value, for exhaustive tamper tests. */
function leafPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, Array.isArray(value) ? Number(k) : k]));
  }
  return [prefix];
}

function mutateAt(obj: unknown, path: (string | number)[]): unknown {
  const copy = structuredClone(obj) as Record<string | number, unknown>;
  let node = copy as Record<string | number, unknown>;
  for (const p of path.slice(0, -1)) node = node[p] as Record<string | number, unknown>;
  const last = path[path.length - 1];
  const v = node[last];
  node[last] = typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : `${String(v)}x`;
  return copy;
}

describe("JWS ES256 over canonical JSON", () => {
  it("known-answer: the pinned key signs and verifies; thumbprint key id is stable", async () => {
    expect(await keyIdFor(KAT_PUBLIC)).toBe(await keyIdFor({ ...KAT_PUBLIC }));
    const kid = await keyIdFor(KAT_PUBLIC);
    const jws = await signCanonical({ b: 1, a: 2 }, KAT_PRIVATE, kid);
    expect(await verifyCanonical(jws, { a: 2, b: 1 }, KAT_PUBLIC)).toEqual({ ok: true, keyId: kid });
  });

  it("rejects a different payload, a different key and a flipped signature byte", async () => {
    const k = await freshKey();
    const other = await freshKey();
    const jws = await signCanonical({ amount: 15000 }, k.privateKey, k.keyId);
    expect((await verifyCanonical(jws, { amount: 15001 }, k.publicJwk)).ok).toBe(false);
    expect((await verifyCanonical(jws, { amount: 15000 }, other.publicJwk)).ok).toBe(false);
    const sig = jws.split(".")[2];
    const flipped = jws.slice(0, -sig.length) + (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect((await verifyCanonical(flipped, { amount: 15000 }, k.publicJwk)).ok).toBe(false);
  });

  it("refuses alg=none and HS256 tokens", async () => {
    const k = await freshKey();
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const none = `${enc({ alg: "none" })}.${enc({ amount: 1 })}.`;
    expect((await verifyCanonical(none, { amount: 1 }, k.publicJwk)).ok).toBe(false);
  });
});

describe("mandate envelope", () => {
  it("verifies, and any single-field change to the payload breaks it", async () => {
    const k = await freshKey();
    const payload: IntentMandatePayload = { ...sampleIntentMandate, issuer: { userId: "usr_ravi", keyId: k.keyId } };
    const env = buildEnvelope(payload, [await signEnvelopePart(payload, k.privateKey, k.keyId, "principal")]);
    const resolve = registry(k);
    expect(await verifyEnvelope(env, resolve)).toMatchObject({ ok: true });

    const paths = leafPaths(payload);
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      const tamperedPayload = mutateAt(payload, path) as IntentMandatePayload;
      // Attacker keeps the original signature and hash.
      const r1 = await verifyEnvelope({ ...env, payload: tamperedPayload }, resolve);
      expect(r1.ok, `tamper at ${path.join(".")}`).toBe(false);
      // Attacker also recomputes the hash; the signature must still fail.
      const r2 = await verifyEnvelope({ ...env, payload: tamperedPayload, payloadHash: hashCanonical(tamperedPayload) }, resolve);
      expect(r2.ok, `tamper+rehash at ${path.join(".")}`).toBe(false);
    }
  });

  it("rejects unknown and revoked keys, and keys created after the check time", async () => {
    const k = await freshKey();
    const env = buildEnvelope(sampleIntentMandate, [await signEnvelopePart(sampleIntentMandate, k.privateKey, k.keyId, "principal")]);
    expect((await verifyEnvelope(env, () => undefined)).problems[0]).toMatch(/unknown key/);
    const revoked = (kid: string) => ({ ...registry(k)(kid)!, status: "revoked" as const });
    expect((await verifyEnvelope(env, revoked)).ok).toBe(false);
    expect((await verifyEnvelope(env, registry(k), { requireActiveAt: "2025-12-31T00:00:00Z" })).ok).toBe(false);
  });

  it("regression: a key created a moment after the (second-rounded) document time still verifies", async () => {
    const k = await freshKey();
    const env = buildEnvelope(sampleIntentMandate, [await signEnvelopePart(sampleIntentMandate, k.privateKey, k.keyId, "principal")]);
    const justAfter = (kid: string) => ({ ...registry(k)(kid)!, createdAt: "2026-10-20T09:00:00.734Z" });
    expect((await verifyEnvelope(env, justAfter, { requireActiveAt: "2026-10-20T09:00:00.000Z" })).ok).toBe(true);
  });
});

describe("attestation chain", () => {
  async function chainOf(n: number) {
    const k = await freshKey();
    const chain = [];
    let prev = "GENESIS";
    for (let i = 0; i < n; i++) {
      const payload = { step: i, amountMinor: 1000 * i };
      const a = await sealAttestation(
        {
          id: `att_${i}`,
          jobId: "job_1",
          seq: i,
          type: "decision",
          subjectId: "m_1",
          payloadHash: hashCanonical(payload),
          payload,
          signer: { role: "platform", keyId: k.keyId },
          prevHash: prev as "GENESIS",
          createdAt: "2026-10-20T09:00:00.000Z",
        },
        k.privateKey,
      );
      prev = a.hash;
      chain.push(a);
    }
    return { chain, resolve: registry(k) };
  }

  it("verifies an intact chain", async () => {
    const { chain, resolve } = await chainOf(5);
    expect(await verifyAttestationChain(chain, resolve)).toEqual({ ok: true, checked: 5 });
  });

  it("points to the broken link when a payload, hash or link is altered", async () => {
    const { chain, resolve } = await chainOf(5);
    const t1 = structuredClone(chain);
    t1[2].payload = { step: 2, amountMinor: 999999 };
    expect((await verifyAttestationChain(t1, resolve)).brokenAt).toMatchObject({ seq: 2, reason: /payloadHash/ });

    const t2 = structuredClone(chain);
    t2[3].payload = { step: 3, amountMinor: 1 };
    t2[3].payloadHash = hashCanonical(t2[3].payload);
    expect((await verifyAttestationChain(t2, resolve)).brokenAt).toMatchObject({ seq: 3, reason: /hash mismatch/ });

    const t3 = structuredClone(chain);
    t3.splice(1, 1);
    expect((await verifyAttestationChain(t3, resolve)).ok).toBe(false);
  });

  it("an attacker who recomputes every hash still fails on signatures", async () => {
    const { chain, resolve } = await chainOf(3);
    const forged = structuredClone(chain);
    forged[1].payload = { step: 1, amountMinor: 5 };
    forged[1].payloadHash = hashCanonical(forged[1].payload);
    const { hash: _h, signature: _s, ...unsigned } = forged[1];
    forged[1].hash = attestationHash(unsigned);
    forged[2].prevHash = forged[1].hash as "GENESIS";
    const { hash: _h2, signature: _s2, ...unsigned2 } = forged[2];
    forged[2].hash = attestationHash(unsigned2);
    expect((await verifyAttestationChain(forged, resolve)).brokenAt).toMatchObject({ seq: 1, reason: /signature/ });
  });
});
