// pnpm verify:audit — recomputes every audit_log hash and reports the first broken link.
import { loadConfig } from "@/core/config";
import { openDb } from "@/core/db/client";
import { AuditService } from "@/core/services/audit";

async function main() {
  const cfg = loadConfig();
  const h = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.PGLITE_DATA_DIR });
  const result = await new AuditService(h.db).verifyChain();
  await h.close();
  if (result.ok) {
    console.log(`Audit chain OK (${result.checked} entries).`);
  } else {
    console.error(`Audit chain BROKEN at seq ${result.brokenAtSeq}: ${result.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
