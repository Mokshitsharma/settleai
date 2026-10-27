import { describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { PayPalApiError } from "@/core/adapters/paypal/live";
import { backoffDelayMs } from "@/core/reliability/backoff";
import { CircuitBreaker, CircuitOpenError, withCircuitBreaker } from "@/core/reliability/circuit-breaker";

const fail = () => Promise.reject(new Error("ECONNRESET"));

describe("backoff with full jitter", () => {
  it("grows exponentially up to the cap and stays within [0, ceiling)", () => {
    const opts = { baseMs: 1000, capMs: 30_000 };
    expect(backoffDelayMs(1, { ...opts, random: () => 0.999 })).toBe(999);
    expect(backoffDelayMs(3, { ...opts, random: () => 0.5 })).toBe(2000);
    expect(backoffDelayMs(20, { ...opts, random: () => 0.5 })).toBe(15_000); // capped
    expect(backoffDelayMs(4, { ...opts, random: () => 0 })).toBe(0);
    for (let a = 1; a < 40; a++) {
      const d = backoffDelayMs(a, opts);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(30_000);
    }
  });
  it("rejects invalid attempts", () => {
    expect(() => backoffDelayMs(0, { baseMs: 1, capMs: 1 })).toThrow();
  });
});

describe("circuit breaker", () => {
  it("opens after N consecutive failures, fails fast without calling, then half-opens after cooldown", async () => {
    let now = 0;
    let calls = 0;
    const b = new CircuitBreaker({ name: "paypal", failureThreshold: 3, cooldownMs: 1000, now: () => now });
    for (let i = 0; i < 3; i++) await expect(b.exec(() => (calls++, fail()))).rejects.toThrow("ECONNRESET");
    expect(b.state).toBe("open");
    await expect(b.exec(async () => (calls++, "x"))).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toBe(3); // the open circuit never reached the dependency
    now = 1000;
    expect(b.state).toBe("half_open");
    await expect(b.exec(() => (calls++, fail()))).rejects.toThrow(); // failed trial re-opens
    expect(b.state).toBe("open");
    now = 2000;
    expect(await b.exec(async () => "ok")).toBe("ok");
    expect(b.state).toBe("closed");
  });

  it("allows only one trial call while half-open", async () => {
    let now = 0;
    const b = new CircuitBreaker({ name: "x", failureThreshold: 1, cooldownMs: 10, now: () => now });
    await expect(b.exec(fail)).rejects.toThrow();
    now = 10;
    let release!: () => void;
    const trial = b.exec(() => new Promise<string>((r) => (release = () => r("ok"))));
    await expect(b.exec(async () => "second")).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    expect(await trial).toBe("ok");
  });

  it("a success resets the failure count; 4xx validation errors do not trip it", async () => {
    const b = new CircuitBreaker({ name: "x", failureThreshold: 2 });
    await expect(b.exec(fail)).rejects.toThrow();
    await b.exec(async () => 1);
    await expect(b.exec(fail)).rejects.toThrow();
    expect(b.state).toBe("closed");
    for (let i = 0; i < 5; i++) await expect(b.exec(() => Promise.reject(new PayPalApiError(422, "INVALID")))).rejects.toThrow();
    expect(b.state).toBe("closed");
    for (let i = 0; i < 2; i++) await expect(b.exec(() => Promise.reject(new PayPalApiError(503, "UNAVAILABLE")))).rejects.toThrow();
    expect(b.state).toBe("open");
  });

  it("withCircuitBreaker guards network methods and passes the rest through", async () => {
    const mock = new MockPayPalAdapter();
    const b = new CircuitBreaker({ name: "paypal", failureThreshold: 1 });
    const p = withCircuitBreaker(mock, b);
    expect(p).toBeInstanceOf(MockPayPalAdapter);
    expect(p.mode).toBe("MOCK");
    expect(p.drainOutbox()).toEqual([]);
    mock.createPayout = fail;
    await expect(p.createPayout({} as never)).rejects.toThrow("ECONNRESET");
    await expect(p.refundCapture({} as never)).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
