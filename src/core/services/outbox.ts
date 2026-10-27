// Transactional outbox (ADR 0002). Producers call enqueue() with the SAME transaction handle that changes
// state, so the side effect is recorded if and only if the state change commits. The worker (runDue) claims
// due rows with FOR UPDATE SKIP LOCKED (safe with several app instances), runs the topic handler outside the
// claim transaction, and on failure reschedules with exponential backoff + full jitter. After maxAttempts the
// row is marked dead and copied to dead_letters for a person to inspect. Handlers must be idempotent.
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/core/db/client";
import { deadLetters, outboxEvents } from "@/core/db/schema";
import { newId } from "@/core/ids";
import type { ClockPort } from "@/core/ports/clock";
import { backoffDelayMs, type BackoffOptions } from "@/core/reliability/backoff";

export type OutboxTopic = "webhook.redispatch" | "payout.retry" | "payout.ambiguous";
export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface OutboxOptions extends BackoffOptions {
  /** How long a claimed row stays invisible to other workers while its handler runs. */
  leaseMs?: number;
  defaultMaxAttempts?: number;
}

export interface RunSummary {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

export class OutboxService {
  private readonly handlers = new Map<OutboxTopic, OutboxHandler>();
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly clock: ClockPort,
    private readonly opts: OutboxOptions = { baseMs: 2_000, capMs: 5 * 60_000 },
  ) {}

  on(topic: OutboxTopic, handler: OutboxHandler): void {
    this.handlers.set(topic, handler);
  }

  /**
   * Records a side effect inside the caller's transaction. Idempotent per dedupeKey: a row that is already
   * pending is left alone; a finished row is re-armed (status back to pending, attempts reset).
   */
  async enqueue(tx: DbOrTx, e: { topic: OutboxTopic; dedupeKey: string; payload: Record<string, unknown>; maxAttempts?: number }): Promise<void> {
    await tx
      .insert(outboxEvents)
      .values({
        id: newId("obx"),
        topic: e.topic,
        dedupeKey: e.dedupeKey,
        payload: e.payload,
        maxAttempts: e.maxAttempts ?? this.opts.defaultMaxAttempts ?? 6,
        availableAt: this.clock.now(),
      })
      .onConflictDoUpdate({
        target: outboxEvents.dedupeKey,
        set: { status: "pending", attempts: 0, availableAt: this.clock.now(), payload: e.payload, lastError: null },
        setWhere: sql`${outboxEvents.status} = 'done'`,
      });
  }

  /** Parks an event straight in the dead-letter table (work that must not be retried automatically). */
  async deadLetterNow(tx: DbOrTx, e: { topic: OutboxTopic; dedupeKey: string; payload: Record<string, unknown>; error: string }): Promise<void> {
    const id = newId("obx");
    const inserted = await tx
      .insert(outboxEvents)
      .values({ id, topic: e.topic, dedupeKey: e.dedupeKey, payload: e.payload, status: "dead", attempts: 0, maxAttempts: 1, lastError: e.error, availableAt: this.clock.now() })
      .onConflictDoNothing({ target: outboxEvents.dedupeKey })
      .returning({ id: outboxEvents.id });
    if (inserted.length === 0) return;
    await tx.insert(deadLetters).values({ id: newId("dlq"), outboxId: id, topic: e.topic, payload: e.payload, attempts: 0, lastError: e.error });
  }

  /** Processes up to `limit` due events. Re-entrant calls in the same process are skipped. */
  async runDue(limit = 20): Promise<RunSummary> {
    const summary: RunSummary = { claimed: 0, done: 0, retried: 0, dead: 0 };
    if (this.running) return summary;
    this.running = true;
    try {
      const now = this.clock.now();
      const leaseUntil = new Date(now.getTime() + (this.opts.leaseMs ?? 60_000));
      const claimed = await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(outboxEvents)
          .where(and(eq(outboxEvents.status, "pending"), lte(outboxEvents.availableAt, now)))
          .orderBy(asc(outboxEvents.availableAt))
          .limit(limit)
          .for("update", { skipLocked: true });
        for (const r of rows) await tx.update(outboxEvents).set({ availableAt: leaseUntil }).where(eq(outboxEvents.id, r.id));
        return rows;
      });
      summary.claimed = claimed.length;
      for (const row of claimed) {
        const handler = this.handlers.get(row.topic as OutboxTopic);
        try {
          if (!handler) throw new Error(`No handler for topic ${row.topic}`);
          await handler(row.payload as Record<string, unknown>);
          await this.db.update(outboxEvents).set({ status: "done", attempts: row.attempts + 1, lastError: null }).where(eq(outboxEvents.id, row.id));
          summary.done++;
        } catch (err) {
          const attempts = row.attempts + 1;
          const message = (err as Error).message?.slice(0, 500) ?? String(err);
          if (attempts >= row.maxAttempts) {
            await this.db.transaction(async (tx) => {
              await tx.update(outboxEvents).set({ status: "dead", attempts, lastError: message }).where(eq(outboxEvents.id, row.id));
              await tx
                .insert(deadLetters)
                .values({ id: newId("dlq"), outboxId: row.id, topic: row.topic, payload: row.payload as object, attempts, lastError: message })
                .onConflictDoNothing({ target: deadLetters.outboxId });
            });
            summary.dead++;
          } else {
            const delay = backoffDelayMs(attempts, this.opts);
            await this.db
              .update(outboxEvents)
              .set({ attempts, lastError: message, availableAt: new Date(this.clock.now().getTime() + delay) })
              .where(eq(outboxEvents.id, row.id));
            summary.retried++;
          }
        }
      }
      return summary;
    } finally {
      this.running = false;
    }
  }
}
