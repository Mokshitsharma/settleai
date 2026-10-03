// Key registry (spec §7.3). Public keys live in signing_keys (history stays published so old
// signatures remain verifiable). Private keys: browser keys never reach the server; managed demo keys
// are AES-256-GCM encrypted at rest; the platform key comes from PLATFORM_SIGNING_KEY_JWK.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { exportJWK, generateKeyPair, importJWK, type CryptoKey, type JWK } from "jose";
import type { Db, DbOrTx } from "@/core/db/client";
import { managedKeys, signingKeys } from "@/core/db/schema";
import type { KeyRecord } from "@/core/mandates/envelope";
import { ALG, keyIdFor, toPublicJwk } from "@/core/mandates/jws";

export interface Signer {
  keyId: string;
  privateKey: CryptoKey;
}

const subtle = globalThis.crypto.subtle;

async function deriveWrappingKey(secret: string): Promise<globalThis.CryptoKey> {
  const material = await subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("settleai-managed-keys-v1"), info: new Uint8Array() },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class KeyService {
  private wrapKey?: Promise<globalThis.CryptoKey>;
  private platform?: Promise<Signer>;
  // Decrypted managed signers, cached so callers can load them before opening a transaction.
  private managed = new Map<string, Signer>();

  constructor(
    private readonly db: Db,
    private readonly opts: { secret: string; platformJwk?: string; devKeyFile?: string },
  ) {}

  private wrapping() {
    return (this.wrapKey ??= deriveWrappingKey(this.opts.secret));
  }

  async registerPublicKey(
    ownerType: KeyRecord["ownerType"],
    ownerId: string,
    jwk: JWK,
    tx: DbOrTx = this.db,
  ): Promise<string> {
    const publicJwk = toPublicJwk(jwk);
    const keyId = await keyIdFor(publicJwk);
    await tx.insert(signingKeys).values({ id: keyId, ownerType, ownerId, publicJwk, alg: ALG }).onConflictDoNothing();
    const [row] = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
    if (row.ownerId !== ownerId) throw new Error("This public key is already registered to another owner");
    return keyId;
  }

  async resolve(keyId: string, tx: DbOrTx = this.db): Promise<KeyRecord | undefined> {
    const [row] = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId));
    if (!row) return undefined;
    return {
      keyId: row.id,
      publicJwk: row.publicJwk as JWK,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      retiredAt: row.retiredAt?.toISOString() ?? null,
    };
  }

  async listPublic(): Promise<KeyRecord[]> {
    const rows = await this.db.select().from(signingKeys);
    return rows.map((row) => ({
      keyId: row.id,
      publicJwk: row.publicJwk as JWK,
      ownerType: row.ownerType,
      ownerId: row.ownerId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      retiredAt: row.retiredAt?.toISOString() ?? null,
    }));
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.db.update(signingKeys).set({ status: "revoked", retiredAt: new Date() }).where(eq(signingKeys.id, keyId));
  }

  // ---- Platform key -------------------------------------------------------------------------

  /** Platform signer: PLATFORM_SIGNING_KEY_JWK, else a dev key persisted in .data (never committed). */
  platformSigner(): Promise<Signer> {
    return (this.platform ??= this.loadPlatform());
  }

  private async loadPlatform(): Promise<Signer> {
    let privateJwk: JWK;
    if (this.opts.platformJwk) {
      privateJwk = JSON.parse(this.opts.platformJwk) as JWK;
    } else {
      privateJwk = await this.loadOrCreateDevKey();
    }
    const keyId = await this.registerPublicKey("platform", "platform", privateJwk);
    return { keyId, privateKey: (await importJWK(privateJwk, ALG)) as CryptoKey };
  }

  private async loadOrCreateDevKey(): Promise<JWK> {
    const file = this.opts.devKeyFile;
    if (file) {
      try {
        return JSON.parse(await readFile(file, "utf8")) as JWK;
      } catch {
        // fall through and create one
      }
    }
    const { privateKey } = await generateKeyPair(ALG, { extractable: true });
    const jwk = await exportJWK(privateKey);
    if (file) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(jwk), { mode: 0o600 });
    }
    return jwk;
  }

  // ---- Managed demo keys --------------------------------------------------------------------

  /** Returns the owner's managed key id, creating the key on first use. */
  async ensureManagedKey(ownerType: "user" | "client", ownerId: string): Promise<string> {
    const cached = this.managed.get(ownerId);
    if (cached) return cached.keyId;
    const [existing] = await this.db.select().from(managedKeys).where(eq(managedKeys.ownerId, ownerId));
    if (existing) return existing.keyId;
    const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
    const privateJwk = await exportJWK(privateKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await subtle.encrypt({ name: "AES-GCM", iv }, await this.wrapping(), new TextEncoder().encode(JSON.stringify(privateJwk))),
    );
    const blob = Buffer.concat([iv, ct]).toString("base64");
    return this.db.transaction(async (tx) => {
      const keyId = await this.registerPublicKey(ownerType, ownerId, await exportJWK(publicKey), tx);
      await tx.insert(managedKeys).values({ keyId, ownerType, ownerId, encryptedPrivateJwk: blob }).onConflictDoNothing();
      const [row] = await tx.select().from(managedKeys).where(eq(managedKeys.ownerId, ownerId));
      return row.keyId;
    });
  }

  async managedSigner(ownerId: string): Promise<Signer | undefined> {
    const cached = this.managed.get(ownerId);
    if (cached) return cached;
    const [row] = await this.db.select().from(managedKeys).where(eq(managedKeys.ownerId, ownerId));
    if (!row) return undefined;
    const raw = Buffer.from(row.encryptedPrivateJwk, "base64");
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, await this.wrapping(), raw.subarray(12));
    const jwk = JSON.parse(new TextDecoder().decode(plain)) as JWK;
    const signer = { keyId: row.keyId, privateKey: (await importJWK(jwk, ALG)) as CryptoKey };
    this.managed.set(ownerId, signer);
    return signer;
  }
}
