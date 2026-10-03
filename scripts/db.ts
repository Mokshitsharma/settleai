// pnpm db:migrate | pnpm db:seed | pnpm db:reset
import "./_env";
import { rm } from "node:fs/promises";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import { openDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { seedDemo } from "@/core/db/seed-demo";

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
    const c = await createContainer(cfg, { dbHandle: h });
    const { mandateIds } = await seedDemo(c);
    console.log(`Seed data loaded. ProcureBot mandates: ${mandateIds.join(", ")}`);
  }
  await h.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
