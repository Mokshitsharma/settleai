// Migrations 0002 (outbox, dead letters, eval tables) and 0003 (read-model views) are additive: they apply on
// a fresh database, leave existing tables untouched, and the views agree with the ledger service.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { evalResults, evalRuns } from "@/core/db/schema";
import { escrowCode } from "@/core/services/ledger";
import { verifiedMilestone, world, type World } from "../world";

const MIG = path.resolve("src/core/db/migrations");
let w: World;
afterAll(() => w?.c.dbHandle.close());

const rows = async <T,>(q: ReturnType<typeof sql>) => ((await w.c.dbHandle.db.execute(q)) as unknown as { rows: T[] }).rows;

describe("hardening migrations", () => {
  it("0002 and 0003 contain no destructive statements", () => {
    for (const f of ["0002_outbox_eval.sql", "0003_read_models.sql"]) {
      const text = readFileSync(path.join(MIG, f), "utf8");
      expect(text, f).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|RENAME|ALTER\s+COLUMN)\b/i);
      const alters = text.match(/ALTER TABLE "([a-z_]+)"/g) ?? [];
      for (const a of alters) expect(["eval_results"], f).toContain(a.replace(/ALTER TABLE "|"/g, ""));
    }
    const journal = JSON.parse(readFileSync(path.join(MIG, "meta/_journal.json"), "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toEqual(["0000_init", "0001_managed_keys", "0002_outbox_eval", "0003_read_models"]);
  });

  it("applies on a fresh database and creates the new tables and views", async () => {
    w = await world();
    const tables = await rows<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = tables.map((t) => t.table_name);
    for (const t of ["outbox_events", "dead_letters", "eval_runs", "eval_results", "ledger_entries", "payouts"]) expect(names).toContain(t);
    const views = (await rows<{ table_name: string }>(sql`select table_name from information_schema.views where table_schema = 'public'`)).map((v) => v.table_name);
    expect(views.sort()).toEqual(["v_account_balances", "v_agent_run_daily", "v_agent_run_stats", "v_eval_run_summary", "v_ledger_txn_balance", "v_outbox_health"]);
  });

  it("read-model views match LedgerService balances and every txn is balanced", async () => {
    const { jobId } = await verifiedMilestone(w);
    w.clock.advance(20_000);
    await w.c.releases.processDueWindows();
    await w.c.deliverMockWebhooks();
    const [escrow] = await rows<{ balance_minor: string }>(sql`select balance_minor from v_account_balances where code = ${escrowCode(jobId)}`);
    expect(Number(escrow.balance_minor)).toBe(await w.c.ledger.balance(escrowCode(jobId)));
    const [pp] = await rows<{ balance_minor: string }>(sql`select balance_minor from v_account_balances where code = 'PAYPAL_BALANCE'`);
    expect(Number(pp.balance_minor)).toBe(await w.c.ledger.balance("PAYPAL_BALANCE"));
    const unbalanced = await rows(sql`select * from v_ledger_txn_balance where not balanced`);
    expect(unbalanced).toEqual([]);
    const txns = await rows<{ kind: string }>(sql`select kind from v_ledger_txn_balance order by created_at`);
    expect(txns.map((t) => t.kind)).toEqual(["funding", "release"]);
  });

  it("agent-run analytics views aggregate the AI traces", async () => {
    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from agent_runs`);
    expect(n).toBeGreaterThan(0);
    const stats = await rows<{ agent: string; runs: number; p95_latency_ms: number }>(sql`select * from v_agent_run_stats`);
    expect(stats.reduce((a, s) => a + s.runs, 0)).toBe(n);
    expect(stats.some((s) => s.agent === "verification")).toBe(true);
    const daily = await rows<{ runs: number }>(sql`select * from v_agent_run_daily`);
    expect(daily.reduce((a, d) => a + d.runs, 0)).toBe(n);
  });

  it("eval tables enforce one result per scenario per run and feed the summary view", async () => {
    const db = w.c.dbHandle.db;
    const at = new Date();
    await db.insert(evalRuns).values({ id: "run_t", gitSha: "x", datasetHash: "d", seed: 1, variant: "ai", llm: "stub", scenarios: 2, metricsJson: {}, startedAt: at, finishedAt: at });
    await db.insert(evalResults).values([
      { id: "r1", runId: "run_t", scenarioId: "G001", family: "clean", pass: true, latencyMs: 10 },
      { id: "r2", runId: "run_t", scenarioId: "G002", family: "gps", pass: false, latencyMs: 30 },
    ]);
    await expect(db.insert(evalResults).values({ id: "r3", runId: "run_t", scenarioId: "G001", family: "clean", pass: true })).rejects.toThrow();
    await expect(db.insert(evalResults).values({ id: "r4", runId: "missing", scenarioId: "G9", family: "x", pass: true })).rejects.toThrow();
    const [s] = await rows<{ results: number; passed: number }>(sql`select * from v_eval_run_summary where run_id = 'run_t'`);
    expect(s).toMatchObject({ results: 2, passed: 1 });
  });

  it("outbox health view reports counts per topic and status", async () => {
    await w.c.outbox.enqueue(w.c.dbHandle.db, { topic: "payout.retry", dedupeKey: "health-1", payload: {} });
    const h = await rows<{ topic: string; status: string; events: number }>(sql`select * from v_outbox_health`);
    expect(h).toContainEqual(expect.objectContaining({ topic: "payout.retry", status: "pending", events: 1 }));
  });
});
