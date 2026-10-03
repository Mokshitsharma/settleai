// Demo seed (spec §16.1, T141): ProcureBot agent client and its pre-signed Intent Mandates.
// Mandates are signed with Ravi's managed demo key and are valid from seed time, so re-seed before demos.
import { and, eq } from "drizzle-orm";
import type { Container } from "@/core/container";
import { sha256Hex } from "@/core/mandates/canonical";
import { apiClients, mandates } from "./schema";

export const PROCUREBOT_CLIENT_ID = "cli_procurebot";
/** Demo-only API key for the reference agent. Never use a fixed key outside the demo. */
export const DEMO_PROCUREBOT_KEY = "sk_demo_procurebot_9f2c";

export function hashApiKey(key: string, pepper: string): string {
  return sha256Hex(`${pepper}:${key}`);
}

const INDORE = { lat: 22.7196, lng: 75.8577, radiusKm: 25, label: "Indore" };

export async function seedDemo(c: Container): Promise<{ mandateIds: string[] }> {
  const db = c.dbHandle.db;
  await db
    .insert(apiClients)
    .values({
      id: PROCUREBOT_CLIENT_ID,
      ownerUserId: "usr_ravi",
      name: "ProcureBot",
      keyHash: hashApiKey(process.env.PROCUREBOT_API_KEY ?? DEMO_PROCUREBOT_KEY, c.config.API_KEY_PEPPER),
      scopes: ["jobs:create", "jobs:read", "proofs:read", "disputes:open"],
      capPerJobMinor: 15000,
      capPerDayMinor: 40000,
    })
    .onConflictDoNothing();

  // Skip if ProcureBot already holds an active mandate.
  const existing = await db
    .select({ id: mandates.id })
    .from(mandates)
    .where(and(eq(mandates.subjectId, PROCUREBOT_CLIENT_ID), eq(mandates.status, "active")));
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
