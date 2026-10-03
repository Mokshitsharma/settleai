// pnpm db:migrate | pnpm db:seed | pnpm db:reset
import { rm } from "node:fs/promises";
import { loadConfig } from "@/core/config";
import { openDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";

async function main() {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  if (cmd === "reset") {
    if (cfg.DATABASE_URL) throw new Error("db:reset only wipes the local PGlite database; refusing with DATABASE_URL set");
    await rm(cfg.PGLITE_DATA_DIR ?? ".data/pglite", { recursive: true, force: true });
  }
  const h = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.PGLITE_DATA_DIR });
  console.log(`Migrations applied (${h.driver}).`);
  if (cmd === "seed" || cmd === "reset") {
    await seed(h.db);
    console.log("Seed data loaded.");
  }
  await h.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
