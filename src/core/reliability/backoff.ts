// Exponential backoff with full jitter (AWS Architecture Blog, "Exponential Backoff and Jitter").
// delay = random(0, min(cap, base * 2^(attempt-1))). Used only for idempotent work (outbox handlers).
export interface BackoffOptions {
  baseMs: number;
  capMs: number;
  /** Returns a number in [0, 1). Injected so tests are deterministic. */
  random?: () => number;
}

export function backoffDelayMs(attempt: number, opts: BackoffOptions): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error(`attempt must be a positive integer, got ${attempt}`);
  const ceiling = Math.min(opts.capMs, opts.baseMs * 2 ** Math.min(attempt - 1, 30));
  const r = (opts.random ?? Math.random)();
  return Math.floor(Math.max(0, Math.min(r, 0.999999)) * ceiling);
}
