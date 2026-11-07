// Demo seed (spec §16.1, T141): ProcureBot agent client and its pre-signed Intent Mandates.
// Mandates are signed with Ravi's managed demo key and are valid from seed time, so re-seed before demos.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, gt } from "drizzle-orm";
import type { Container } from "@/core/container";
import { sha256Hex } from "@/core/mandates/canonical";
import { apiClients, mandates } from "./schema";

export const PROCUREBOT_CLIENT_ID = "cli_procurebot";

export function hashApiKey(key: string, pepper: string): string {
  return sha256Hex(`${pepper}:${key}`);
}

const REISSUE_MARGIN_MS = 2 * 3600_000;

const INDORE = { lat: 22.7196, lng: 75.8577, radiusKm: 25, label: "Indore" };

/** Where a local (non-deployed) seed keeps its generated key, so `pnpm procurebot` can read it. Git-ignored. */
export function procurebotKeyFile(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.PROCUREBOT_KEY_FILE ?? ".data/procurebot-key");
}

// No key is ever published in this repository. PROCUREBOT_API_KEY wins when set. Otherwise each seed uses a random key:
// locally it is saved to a git-ignored file (and reused, so re-seeding keeps working); on a deployment it is never
// stored or logged, so the agent API stays closed until the owner sets a key.
function procurebotKey(c: Container): string {
  if (process.env.PROCUREBOT_API_KEY) return process.env.PROCUREBOT_API_KEY;
  const deployed = process.env.NODE_ENV === "production" || Boolean(c.config.DATABASE_URL);
  const key = `sk_${randomBytes(24).toString("hex")}`;
  if (deployed) return key;
  const file = procurebotKeyFile();
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

export async function seedDemo(c: Container): Promise<{ mandateIds: string[] }> {
  const db = c.dbHandle.db;
  await db
    .insert(apiClients)
    .values({
      id: PROCUREBOT_CLIENT_ID,
      ownerUserId: "usr_ravi",
      name: "ProcureBot",
      keyHash: hashApiKey(procurebotKey(c), c.config.API_KEY_PEPPER),
      scopes: ["jobs:create", "jobs:read", "proofs:read", "disputes:open"],
      capPerJobMinor: 15000,
      capPerDayMinor: 40000,
    })
    .onConflictDoNothing();

  // Skip if ProcureBot holds an active mandate with time left. Otherwise issue fresh ones: a restored template can hold
  // expired mandates, and a server kept awake never reboots, so the app also calls this hourly.
  const existing = await db
    .select({ id: mandates.id })
    .from(mandates)
    .where(and(eq(mandates.subjectId, PROCUREBOT_CLIENT_ID), eq(mandates.status, "active"), gt(mandates.notAfter, new Date(c.clock.now().getTime() + REISSUE_MARGIN_MS))));
  if (existing.length) return { mandateIds: existing.map((m) => m.id) };

  const keyId = await c.keys.ensureManagedKey("user", "usr_ravi");
  const ids: string[] = [];
  const plans = [
    // Main demo mandate: delivery, $150 per job, $400 total, 24 h, step-up above $100.
    { categories: ["delivery"] as const, maxPerJobMinor: 15000, maxTotalMinor: 40000, maxJobsPerDay: 5, stepUpAboveMinor: 10000 },
    // Narrower mandate for the scope-violation scene: on-site services only, $50 per job.
    { categories: ["onsite_service"] as const, maxPerJobMinor: 5000, maxTotalMinor: 10000, maxJobsPerDay: 2, stepUpAboveMinor: 5000 },
  ];
  for (const p of plans) {
    const { payload } = await c.mandates.draftIntent({
      issuerUserId: "usr_ravi",
      keyId,
      agentClientId: PROCUREBOT_CLIENT_ID,
      categories: [...p.categories],
      maxPerJobMinor: p.maxPerJobMinor,
      maxTotalMinor: p.maxTotalMinor,
      maxJobsPerDay: p.maxJobsPerDay,
      ttlSeconds: c.config.MANDATE_DEFAULT_TTL_SECONDS,
      geoFence: INDORE,
      minTrustScore: 40,
      requirePayPalEmail: true,
      prohibitedKeywords: ["gift card", "crypto", "cash"],
      stepUpAboveMinor: p.stepUpAboveMinor,
      maxAutoReleaseMinor: 5000,
      maxChallengeWindowSeconds: c.config.CHALLENGE_WINDOW_SECONDS,
    });
    const jws = await c.mandates.signWithManagedKey("usr_ravi", payload);
    ids.push((await c.mandates.createIntent({ userId: "usr_ravi", payload, jws })).id);
  }
  return { mandateIds: ids };
}
