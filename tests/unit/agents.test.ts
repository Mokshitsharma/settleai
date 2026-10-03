import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StubLlmAdapter } from "@/core/adapters/llm/stub";
import { runAgent } from "@/core/agents/runtime";
import { scopeJob, statedAmounts } from "@/core/agents/scoping";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { JobSpec } from "@/core/contracts";
import { agentRuns } from "@/core/db/schema";
import { EventHub, emitterFor } from "@/core/events/hub";
import { T0, testWorld, type TestWorld } from "../helpers";
import { sampleJobSpec } from "../fixtures/contracts";

let w: TestWorld;
beforeAll(async () => {
  w = await testWorld();
});
afterAll(() => w.h.close());

describe("agent runtime", () => {
  it("retries once with the validation error, then falls back (S18) and traces every attempt", async () => {
    let calls = 0;
    const llm = new StubLlmAdapter().register("broken", "default", () => {
      calls++;
      return { nope: true };
    });
    const hub = new EventHub();
    const result = await runAgent(
      { db: w.db, llm, emit: emitterFor(hub, "job:j1") },
      {
        agent: "broken", promptVersion: "t@1", entityType: "test", entityId: "e1", system: "s",
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], schema: JobSpec, schemaName: "JobSpec",
      },
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
    const runs = await w.db.select().from(agentRuns).where(eq(agentRuns.entityId, "e1"));
    expect(runs.map((r) => r.status).sort()).toEqual(["fallback", "invalid_output", "invalid_output"]);
    expect(new Set(runs.map((r) => r.traceId)).size).toBe(1);
    expect(hub.recent("job:j1").map((e) => e.type)).toContain("agent.fallback");
  });

  it("succeeds on the second attempt when the retry fixes the output", async () => {
    let calls = 0;
    const llm = new StubLlmAdapter().register("flaky", "default", () => (++calls === 1 ? { bad: 1 } : sampleJobSpec));
    const result = await runAgent(
      { db: w.db, llm },
      {
        agent: "flaky", promptVersion: "t@1", entityType: "test", entityId: "e2", system: "s",
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }], schema: JobSpec, schemaName: "JobSpec",
      },
    );
    expect(result.ok).toBe(true);
  });
});

describe("scoping agent (stub)", () => {
  const scope = (text: string) => scopeJob({ db: w.db, llm: createStubLlm() }, { text, payerId: "usr_ravi", now: T0, entityId: "draft" });

  it("parses stated amounts in minor units", () => {
    expect(statedAmounts("Budget $102.50, tip 5 dollars")).toEqual([10250, 500]);
    expect(statedAmounts("no money here")).toEqual([]);
  });

  it("splits a stated total exactly across delivery milestones", async () => {
    const r = await scope("Deliver 20 cartons from Rajwada to my shop in Vijay Nagar by 6 pm. Budget $100.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.category).toBe("delivery");
    expect(r.output.totalAmountMinor).toBe(10000);
    expect(r.output.milestones.map((m) => m.amountMinor)).toEqual([4000, 6000]);
    expect(r.output.location?.label).toBe("Vijay Nagar, Indore"); // drop-off, where final proof is checked
  });

  it("never invents amounts: no budget -> zero amounts and a clarifying question", async () => {
    const r = await scope("Design a logo for my tea shop as a PNG");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.totalAmountMinor).toBe(0);
    expect(r.output.clarifyingQuestions[0]).toMatch(/budget/i);
  });

  it("rejects model output whose total differs from the stated budget", async () => {
    const liar = new StubLlmAdapter().register("scoping", "default", () => ({ ...sampleJobSpec }));
    const r = await scopeJob({ db: w.db, llm: liar }, { text: "Deliver boxes, budget $250", payerId: "usr_ravi", now: T0, entityId: "d2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/stated 25000/);
  });

  it("flags prohibited content and lowers confidence", async () => {
    const r = await scope("Deliver gift card codes to Palasia, pay $50");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.riskNotes.join(" ")).toMatch(/gift card/);
      expect(r.output.confidence).toBeLessThanOrEqual(0.3);
    }
  });
});
