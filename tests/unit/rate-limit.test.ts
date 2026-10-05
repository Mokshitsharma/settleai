import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, enforce, RateLimitError, take } from "@/core/rate-limit";

beforeEach(() => _resetForTests());

describe("rate limiter", () => {
  it("allows a burst up to capacity, then asks the caller to wait", () => {
    const limit = { capacity: 3, refillPerMinute: 60 };
    const t = 1_000_000;
    expect([take("k", limit, t), take("k", limit, t), take("k", limit, t)]).toEqual([0, 0, 0]);
    expect(take("k", limit, t)).toBe(1); // one token per second
  });

  it("refills over time and keys are independent", () => {
    const limit = { capacity: 1, refillPerMinute: 6 };
    expect(take("a", limit, 0)).toBe(0);
    expect(take("a", limit, 0)).toBeGreaterThan(0);
    expect(take("b", limit, 0)).toBe(0);
    expect(take("a", limit, 10_000)).toBe(0); // 6 per minute = one every 10 s
  });

  it("enforce throws a typed error with a retry hint", () => {
    const limit = { capacity: 1, refillPerMinute: 1 };
    enforce("x", limit);
    expect(() => enforce("x", limit)).toThrow(RateLimitError);
  });
});
