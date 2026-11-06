// pnpm db:migrate | pnpm db:seed | pnpm db:reset
import "./_env";
import { cp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import { openDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { seedDemo } from "@/core/db/seed-demo";
import { seedHistory } from "@/core/db/seed-history";
import { count } from "drizzle-orm";
import { jobs } from "@/core/db/schema";

async function main() {
  const cmd = process.argv[2];
  const cfg = loadConfig();
  const dataDir = cfg.PGLITE_DATA_DIR ?? ".data/pglite";
  const templateDir = `${dataDir}-template`;
  // Boot on a small server: restore the pristine database made at build time instead of seeding two weeks of history.
  if (cmd === "boot" && existsSync(templateDir)) {
    await rm(dataDir, { recursive: true, force: true });
    await cp(templateDir, dataDir, { recursive: true });
    const h = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir });
    const c = await createContainer(cfg, { dbHandle: h });
    const { mandateIds } = await seedDemo(c); // demo mandates last 24 hours, so an old template gets fresh ones
    console.log(`Clean demo restored. ProcureBot mandates: ${mandateIds.join(", ")}`);
    await h.close();
    const peakMb = Math.round(process.resourceUsage().maxRSS / 1024);
    await writeFile(".data/boot-peak-rss-mb", String(peakMb));
    console.log(`Boot peak RSS: ${peakMb} MB`);
    return;
  }
  if (cmd === "reset" || cmd === "template" || cmd === "boot") {
    if (cfg.DATABASE_URL) throw new Error("db:reset only wipes the local PGlite database; refusing with DATABASE_URL set");
    await rm(cfg.PGLITE_DATA_DIR ?? ".data/pglite", { recursive: true, force: true });
  }
  const h = await openDb({ databaseUrl: cfg.DATABASE_URL, dataDir: cfg.PGLITE_DATA_DIR });
  console.log(`Migrations applied (${h.driver}).`);
  if (cmd === "seed" || cmd === "reset" || cmd === "template" || cmd === "boot") {
    await seed(h.db);
    const c = await createContainer(cfg, { dbHandle: h });
    const { mandateIds } = await seedDemo(c);
    const [{ n }] = await h.db.select({ n: count() }).from(jobs);
    if (n === 0 && process.env.SEED_HISTORY !== "false") {
      const made = await seedHistory(cfg, h);
      console.log(`Demo history: ${made} past jobs over two weeks.`);
    }
    console.log(`Seed data loaded. ProcureBot mandates: ${mandateIds.join(", ")}`);
  }
  await h.close();
  if (cmd === "template") {
    await rm(templateDir, { recursive: true, force: true });
    await cp(dataDir, templateDir, { recursive: true });
    console.log(`Template saved to ${templateDir}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
