// In-process token-bucket rate limiter (spec §14 Abuse): per IP, per user and per agent client, with a
// tighter budget for routes that call an LLM (cost control). Single-instance deployments only; a
// multi-instance deployment would move the buckets to Postgres or Redis.

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface Limit {
  capacity: number; // burst size
  refillPerMinute: number;
}

export const LIMITS = {
  /** Any write from a signed-in user or IP. */
  write: { capacity: 60, refillPerMinute: 60 },
  /** Routes that run an AI agent (scoping, verification submit, arbiter, agent create_job). */
  llm: { capacity: 10, refillPerMinute: 10 },
  /** Agent API calls per client key. */
  agent: { capacity: 60, refillPerMinute: 120 },
} as const satisfies Record<string, Limit>;

const buckets = new Map<string, Bucket>();

/** Returns 0 when allowed, otherwise the seconds to wait. */
export function take(key: string, limit: Limit, now = Date.now()): number {
  const b = buckets.get(key) ?? { tokens: limit.capacity, updatedAt: now };
  const refill = ((now - b.updatedAt) / 60_000) * limit.refillPerMinute;
  b.tokens = Math.min(limit.capacity, b.tokens + refill);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return Math.ceil(((1 - b.tokens) / limit.refillPerMinute) * 60);
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear(); // bounded memory under abuse
  return 0;
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds} seconds.`);
  }
}

export function enforce(key: string, limit: Limit): void {
  const wait = take(key, limit);
  if (wait > 0) throw new RateLimitError(wait);
}

/** Client IP from the proxy headers Render (and most hosts) set; falls back to a constant. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function _resetForTests(): void {
  buckets.clear();
}
