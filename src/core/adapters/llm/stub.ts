import type { LlmPort, StructuredRequest, StructuredResponse } from "@/core/ports/llm";

type FixtureFn = (req: StructuredRequest<unknown>) => unknown;

/**
 * Deterministic offline LLM. Outputs are fixtures keyed by `${agent}:${fixtureKey}` (or `${agent}:default`).
 * Demo mode and CI never touch the network. Fixtures are still validated against the request schema.
 */
export class StubLlmAdapter implements LlmPort {
  readonly provider = "stub" as const;
  readonly model = "stub";
  private fixtures = new Map<string, FixtureFn>();

  register(agent: string, key: string, fixture: unknown | FixtureFn): this {
    this.fixtures.set(`${agent}:${key}`, typeof fixture === "function" ? (fixture as FixtureFn) : () => fixture);
    return this;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const fn =
      this.fixtures.get(`${req.agent}:${req.fixtureKey ?? "default"}`) ?? this.fixtures.get(`${req.agent}:default`);
    if (!fn) throw new Error(`StubLlmAdapter: no fixture for ${req.agent}:${req.fixtureKey ?? "default"}`);
    const output = req.schema.parse(fn(req as StructuredRequest<unknown>));
    return { output, model: this.model, tokensIn: 0, tokensOut: 0, latencyMs: 0 };
  }
}
