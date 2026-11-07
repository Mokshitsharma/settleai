// pnpm platform:key — creates the platform's ES256 signing key once. The private key goes to .secrets/ (git-ignored) and
// is never printed; set it on the host as PLATFORM_SIGNING_KEY_JWK. The public key goes to docs/platform-public-key.json,
// in the format `pnpm verify-receipt --platform-keys` reads. Refuses to replace an existing key.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { exportJWK, generateKeyPair } from "jose";
import { ALG, keyIdFor, toPublicJwk } from "@/core/mandates/jws";

const PRIVATE_FILE = ".secrets/platform-signing-key.jwk";
const PUBLIC_FILE = "docs/platform-public-key.json";

async function main() {
  if (existsSync(PRIVATE_FILE)) throw new Error(`${PRIVATE_FILE} already exists; replacing it would orphan issued receipts`);
  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(privateKey);
  const publicJwk = toPublicJwk(jwk);
  const keyId = await keyIdFor(publicJwk);
  mkdirSync(".secrets", { recursive: true });
  writeFileSync(PRIVATE_FILE, JSON.stringify(jwk), { mode: 0o600 });
  writeFileSync(PUBLIC_FILE, `${JSON.stringify({ keyIds: [keyId], keys: [{ keyId, alg: ALG, publicJwk, status: "active" }] }, null, 2)}\n`);
  console.log(`Key ${keyId}: private key in ${PRIVATE_FILE}, public key in ${PUBLIC_FILE}.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
