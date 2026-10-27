// Circuit breaker for one external dependency (PayPal). After `failureThreshold` consecutive failures the
// circuit opens and calls fail fast with CircuitOpenError, without reaching the network, for `cooldownMs`.
// Then one trial call is allowed (half-open): success closes the circuit, failure re-opens it.
// A CircuitOpenError therefore guarantees the provider never saw the request, so it is always safe to retry.
import type { PaymentsPort } from "@/core/ports/payments";

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN";
  constructor(readonly dependency: string) {
    super(`${dependency} circuit is open: call not attempted`);
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
  /** Which errors count as dependency failures. Default: everything except errors marked non-retryable. */
  isFailure?: (err: unknown) => boolean;
}

const defaultIsFailure = (err: unknown) => !(err && typeof err === "object" && "retryable" in err && (err as { retryable: boolean }).retryable === false);

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state_: CircuitState = "closed";
  private trialInFlight = false;
  readonly name: string;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly isFailure: (err: unknown) => boolean;

  constructor(opts: CircuitBreakerOptions) {
    this.name = opts.name;
    this.threshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.isFailure = opts.isFailure ?? defaultIsFailure;
  }

  get state(): CircuitState {
    if (this.state_ === "open" && this.now() - this.openedAt >= this.cooldownMs) this.state_ = "half_open";
    return this.state_;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open") throw new CircuitOpenError(this.name);
    if (state === "half_open") {
      if (this.trialInFlight) throw new CircuitOpenError(this.name);
      this.trialInFlight = true;
    }
    try {
      const out = await fn();
      this.failures = 0;
      this.state_ = "closed";
      return out;
    } catch (err) {
      if (this.isFailure(err)) {
        this.failures++;
        if (state === "half_open" || this.failures >= this.threshold) {
          this.state_ = "open";
          this.openedAt = this.now();
        }
      }
      throw err;
    } finally {
      if (state === "half_open") this.trialInFlight = false;
    }
  }
}

const GUARDED: readonly (keyof PaymentsPort)[] = ["createOrder", "captureOrder", "createPayout", "getPayoutItem", "refundCapture", "verifyWebhook"];

/**
 * Wraps every network method of a PaymentsPort in the breaker. Other members (mode, mock helpers) pass
 * through untouched, and `instanceof` still sees the wrapped adapter's class.
 */
export function withCircuitBreaker<P extends PaymentsPort>(payments: P, breaker: CircuitBreaker): P {
  return new Proxy(payments, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || !GUARDED.includes(prop as keyof PaymentsPort)) return value;
      return (...args: unknown[]) => breaker.exec(() => (Reflect.get(target, prop) as (...a: unknown[]) => Promise<unknown>).apply(target, args));
    },
  });
}
