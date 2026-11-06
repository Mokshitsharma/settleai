import { beforeEach, describe, expect, it } from "vitest";
import { _resetForTests, chargeAgentLlm, enforce, LIMITS, RateLimitError, take, withGlobalLlmBudget } from "@/core/rate-limit";

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

describe("agent key budgets for the model", () => {
  beforeEach(() => _resetForTests());

  it("a caller on a shared key gets a burst of 2, and others on that key still get through", () => {
    chargeAgentLlm("cli_a", "1.1.1.1");
    chargeAgentLlm("cli_a", "1.1.1.1");
    expect(() => chargeAgentLlm("cli_a", "1.1.1.1")).toThrow(RateLimitError);
    expect(() => chargeAgentLlm("cli_a", "2.2.2.2")).not.toThrow();
  });

  it("the whole key is capped however many callers it has, and other keys are unaffected", () => {
    for (let i = 0; i < 6; i++) chargeAgentLlm("cli_a", `ip-${i}`);
    expect(() => chargeAgentLlm("cli_a", "ip-new")).toThrow(RateLimitError);
    expect(() => chargeAgentLlm("cli_b", "ip-new")).not.toThrow();
  });

  it("the global daily budget stops real model calls, and the error reaches the caller", async () => {
    let calls = 0;
    const llm = withGlobalLlmBudget({ provider: "fake", structured: async () => ++calls });
    for (let i = 0; i < LIMITS.llmGlobalDaily.capacity; i++) await llm.structured();
    expect(() => llm.structured()).toThrow(RateLimitError);
    expect(calls).toBe(LIMITS.llmGlobalDaily.capacity);
    expect(llm.provider).toBe("fake");
  });
});
