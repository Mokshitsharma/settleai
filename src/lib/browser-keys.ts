// Browser signing keys (spec §7.3): ECDSA P-256 generated with WebCrypto as NON-EXTRACTABLE and stored
// in IndexedDB. Only the public JWK is ever sent to the server. Signing uses the same canonical-JSON JWS
// code as the server and the verifier.
import { signCanonical } from "@/core/mandates/jws";
import { api } from "./api";

const DB_NAME = "settleai-keys";
const STORE = "keys";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredKey {
  keyId: string;
  pair: CryptoKeyPair;
}

export function browserKeysSupported(): boolean {
  return typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && Boolean(crypto.subtle);
}

/** Returns this browser's key for the user, creating and registering it on first use. */
export async function getBrowserKey(userId: string): Promise<StoredKey> {
  const existing = await idb<StoredKey | undefined>("readonly", (s) => s.get(userId) as IDBRequest<StoredKey | undefined>);
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const { keyId } = await api<{ keyId: string }>("/api/keys", {
    body: { publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y } },
  });
  const stored = { keyId, pair };
  await idb("readwrite", (s) => s.put(stored, userId));
  return stored;
}

export async function signWithBrowserKey(userId: string, payload: unknown): Promise<{ keyId: string; jws: string }> {
  const { keyId, pair } = await getBrowserKey(userId);
  return { keyId, jws: await signCanonical(payload, pair.privateKey, keyId) };
}
