// ES256 compact JWS over canonical JSON bytes (spec §7.2). Pure functions with no database or Node
// dependencies, so the same code runs on the server, in the offline verifier CLI and in the browser.
// Only reviewed libraries are used: jose (JWS/JWK), canonicalize (RFC 8785), @noble/hashes (SHA-256).
import { CompactSign, calculateJwkThumbprint, compactVerify, importJWK, type CryptoKey, type JWK } from "jose";
import { canonicalize, hashCanonical, timingSafeEqualStr } from "./canonical";

export const ALG = "ES256";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SigningKey = CryptoKey | Uint8Array | JWK;

/** keyId = "key_" + first 24 chars of the RFC 7638 JWK thumbprint. Stable for a given public key. */
export async function keyIdFor(publicJwk: JWK): Promise<string> {
  return `key_${(await calculateJwkThumbprint(publicJwk, "sha256")).slice(0, 24)}`;
}

/** Strip private material; throws if the result still looks private. */
export function toPublicJwk(jwk: JWK): JWK {
  const { kty, crv, x, y } = jwk;
  if (kty !== "EC" || crv !== "P-256" || !x || !y) throw new Error("Expected an EC P-256 JWK");
  return { kty, crv, x, y };
}

async function asKey(key: SigningKey): Promise<CryptoKey | Uint8Array> {
  if (key instanceof Uint8Array) return key;
  if (typeof (key as CryptoKey).type === "string" && "algorithm" in (key as CryptoKey)) return key as CryptoKey;
  return (await importJWK(key as JWK, ALG)) as CryptoKey;
}

/** Sign canonical(value) as an attached-payload compact JWS. */
export async function signCanonical(value: unknown, privateKey: SigningKey, keyId: string): Promise<string> {
  return new CompactSign(encoder.encode(canonicalize(value)))
    .setProtectedHeader({ alg: ALG, kid: keyId, typ: "settleai+jws" })
    .sign(await asKey(privateKey));
}

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: string };

/** Verify a JWS and check that its payload is exactly canonical(value). */
export async function verifyCanonical(jws: string, value: unknown, publicJwk: JWK): Promise<VerifyResult> {
  try {
    const { payload, protectedHeader } = await compactVerify(jws, await importJWK(toPublicJwk(publicJwk), ALG), {
      algorithms: [ALG],
    });
    if (!timingSafeEqualStr(decoder.decode(payload), canonicalize(value))) {
      return { ok: false, reason: "signed bytes do not match the canonical payload" };
    }
    return { ok: true, keyId: String(protectedHeader.kid ?? "") };
  } catch (err) {
    return { ok: false, reason: `signature invalid: ${(err as Error).message}` };
  }
}

/** Read the key id from a JWS header without verifying it (to look up the public key first). */
export function jwsKeyId(jws: string): string | undefined {
  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(jws.split(".")[0] ?? ""))) as { kid?: string };
    return header.kid;
  } catch {
    return undefined;
  }
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export { hashCanonical };
