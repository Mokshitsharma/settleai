import { openTestDb, type DbHandle } from "@/core/db/client";
import { apiClients } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { FixedClock } from "@/core/ports/clock";
import { AuditService } from "@/core/services/audit";
import { AttestationService } from "@/core/services/attestations";
import { KeyService } from "@/core/services/keys";
import { LedgerService } from "@/core/services/ledger";
import { MandateService } from "@/core/services/mandates";

export const T0 = new Date("2026-10-20T09:00:00.000Z");

/** Fresh seeded in-memory database with core services and a fixed clock. */
export async function testWorld() {
  const h: DbHandle = await openTestDb();
  await seed(h.db);
  const clock = new FixedClock(T0);
  const audit = new AuditService(h.db);
  const keys = new KeyService(h.db, { secret: "test-secret" });
  await keys.platformSigner();
  const ledger = new LedgerService(h.db);
  const attestations = new AttestationService(h.db, keys, clock);
  const mandates = new MandateService(h.db, keys, audit, clock);
  await h.db
    .insert(apiClients)
    .values({
      id: "cli_testbot",
      ownerUserId: "usr_ravi",
      name: "TestBot",
      keyHash: "hash_testbot",
      scopes: ["jobs:create"],
      capPerJobMinor: 15000,
      capPerDayMinor: 40000,
    })
    .onConflictDoNothing();
  return { h, db: h.db, clock, audit, keys, ledger, attestations, mandates };
}

export type TestWorld = Awaited<ReturnType<typeof testWorld>>;
