// Canonical JSON (RFC 8785, via the reviewed `canonicalize` package) and SHA-256 hashing.
// Never write custom cryptography here; only compose reviewed libraries.
import canonicalizeImpl from "canonicalize";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export function canonicalize(value: unknown): string {
  const out = canonicalizeImpl(value);
  if (out === undefined) throw new Error("Value cannot be canonicalized");
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

/** Constant-time comparison for hex digests and tokens. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
