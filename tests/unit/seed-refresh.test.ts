// Demo mandates last 24 hours. A server kept awake never reboots, so they must be reissued while it runs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { T0 } from "../helpers";

const HOUR = 3600_000;
let c: Container;
let clock: FixedClock;

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  clock = new FixedClock(T0);
  c = await createContainer(loadConfig({}), { dbHandle, clock, payments: new MockPayPalAdapter() });
});
afterAll(() => c.dbHandle.close());

describe("demo mandates on a server that never restarts", () => {
  it("keeps the same mandates while they have time left", async () => {
    const first = await seedDemo(c);
    clock.advance(20 * HOUR);
    expect((await seedDemo(c)).mandateIds.sort()).toEqual(first.mandateIds.sort());
  });

  it("reissues before they expire, so there is never a gap, and the new ones allow a hire", async () => {
    const first = await seedDemo(c);
    clock.advance(3 * HOUR); // 23 hours in: under the 2-hour margin only once 22 hours have passed
    const next = await seedDemo(c);
    expect(next.mandateIds).toHaveLength(2);
    expect(next.mandateIds.some((id) => first.mandateIds.includes(id))).toBe(false);
    const decision = await c.guard.g1CreateJob({ mandateId: next.mandateIds[0], clientId: "cli_procurebot", category: "delivery", text: "Deliver cartons", amountMinor: 5000, requestNonce: "refresh-test-1", dryRun: true, agentPrecheck: true });
    expect(decision.result).toBe("allow");
  });
});
