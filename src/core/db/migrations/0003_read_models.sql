-- Read models for the admin console and analytics (hardening 2026-10). Views only: additive, no table changes.
-- Plain SELECTs never take row locks in Postgres (MVCC), so dashboards built on these views cannot block
-- LedgerService.post, which locks ledger_accounts FOR UPDATE. The views can also be pointed at a read replica.
CREATE VIEW "v_account_balances" AS
SELECT a.id AS account_id,
       a.code,
       a.type,
       a.job_id,
       coalesce(sum(e.debit_minor), 0)::bigint AS debit_minor,
       coalesce(sum(e.credit_minor), 0)::bigint AS credit_minor,
       (CASE WHEN a.type IN ('asset', 'expense') THEN coalesce(sum(e.debit_minor), 0) - coalesce(sum(e.credit_minor), 0)
             ELSE coalesce(sum(e.credit_minor), 0) - coalesce(sum(e.debit_minor), 0) END)::bigint AS balance_minor,
       count(e.id)::int AS entries
FROM ledger_accounts a
LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id, a.code, a.type, a.job_id;
--> statement-breakpoint
CREATE VIEW "v_ledger_txn_balance" AS
SELECT t.id AS txn_id,
       t.kind,
       t.idempotency_key,
       t.created_at,
       coalesce(sum(e.debit_minor), 0)::bigint AS debit_minor,
       coalesce(sum(e.credit_minor), 0)::bigint AS credit_minor,
       (coalesce(sum(e.debit_minor), 0) = coalesce(sum(e.credit_minor), 0)) AS balanced
FROM ledger_txns t
LEFT JOIN ledger_entries e ON e.txn_id = t.id
GROUP BY t.id, t.kind, t.idempotency_key, t.created_at;
--> statement-breakpoint
CREATE VIEW "v_agent_run_stats" AS
SELECT agent,
       model,
       count(*)::int AS runs,
       count(*) FILTER (WHERE status = 'ok')::int AS ok_runs,
       count(*) FILTER (WHERE status = 'fallback')::int AS fallback_runs,
       count(*) FILTER (WHERE status IN ('error', 'invalid_output'))::int AS failed_runs,
       round(avg(latency_ms))::int AS avg_latency_ms,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
       sum(tokens_in)::bigint AS tokens_in,
       sum(tokens_out)::bigint AS tokens_out
FROM agent_runs
GROUP BY agent, model;
--> statement-breakpoint
CREATE VIEW "v_agent_run_daily" AS
SELECT date_trunc('day', created_at) AS day,
       agent,
       count(*)::int AS runs,
       count(*) FILTER (WHERE status <> 'ok')::int AS non_ok_runs,
       round(avg(latency_ms))::int AS avg_latency_ms
FROM agent_runs
GROUP BY 1, 2;
--> statement-breakpoint
CREATE VIEW "v_outbox_health" AS
SELECT topic,
       status,
       count(*)::int AS events,
       min(available_at) AS oldest_available_at,
       max(attempts) AS max_attempts_seen
FROM outbox_events
GROUP BY topic, status;
--> statement-breakpoint
CREATE VIEW "v_eval_run_summary" AS
SELECT r.id AS run_id,
       r.variant,
       r.llm,
       r.scenarios,
       count(x.id)::int AS results,
       count(x.id) FILTER (WHERE x.pass)::int AS passed,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY x.latency_ms) AS p50_latency_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY x.latency_ms) AS p95_latency_ms,
       r.finished_at
FROM eval_runs r
LEFT JOIN eval_results x ON x.run_id = r.id
GROUP BY r.id, r.variant, r.llm, r.scenarios, r.finished_at;
