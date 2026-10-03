import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Driver-agnostic database handle: PGlite (embedded, zero setup) or node-postgres (DATABASE_URL). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "src/core/db/migrations");

export interface DbHandle {
  db: Db;
  driver: "pglite" | "postgres";
  close(): Promise<void>;
}

/**
 * - DATABASE_URL set   -> real Postgres (Render, CI with a service container)
 * - otherwise          -> PGlite persisted in `dataDir` (default .data/pglite), or in-memory when dataDir is "memory://"
 */
export async function openDb(opts: { databaseUrl?: string; dataDir?: string; migrate?: boolean } = {}): Promise<DbHandle> {
  const runMigrations = opts.migrate ?? true;
  if (opts.databaseUrl) {
    const db = drizzlePg(opts.databaseUrl, { schema });
    if (runMigrations) await migratePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return { db: db as unknown as Db, driver: "postgres", close: () => db.$client.end() };
  }
  const dataDir = opts.dataDir ?? ".data/pglite";
  if (dataDir !== "memory://") await mkdir(dataDir, { recursive: true }); // PGlite does not create parents
  const client = dataDir === "memory://" ? new PGlite() : new PGlite(dataDir);
  const db = drizzlePglite({ client, schema });
  if (runMigrations) await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Db, driver: "pglite", close: () => client.close() };
}

/** Fresh, migrated in-memory database for tests. */
export function openTestDb(): Promise<DbHandle> {
  return openDb({ dataDir: "memory://" });
}
