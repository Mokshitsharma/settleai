// A deployment never runs on the secrets published in this repository: the API key pepper must be set, and the
// ProcureBot agent key must be its own, not the public demo key. Local runs keep working with zero secrets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { authenticateAgent } from "@/core/agent-api";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { DEMO_PROCUREBOT_KEY, seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { T0 } from "../helpers";

const deployedEnv = { DATABASE_URL: "postgres://deployed.example/settleai", API_KEY_PEPPER: "a-real-pepper" };

async function containerFor(env: Record<string, string>) {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  return createContainer(loadConfig(env), { dbHandle, clock: new FixedClock(T0), payments: new MockPayPalAdapter() });
}

afterEach(() => {
  delete process.env.PROCUREBOT_API_KEY;
  vi.unstubAllEnvs();
});

describe("API key pepper", () => {
  it("starts locally with no secrets set", () => {
    expect(() => loadConfig({})).not.toThrow();
  });

  it("refuses to start a deployment on the published default", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/API_KEY_PEPPER/);
    expect(() => loadConfig({ DATABASE_URL: deployedEnv.DATABASE_URL })).toThrow(/API_KEY_PEPPER/);
  });

  it("starts a deployment once a pepper is set, with a random session secret", () => {
    const cfg = loadConfig({ NODE_ENV: "production", API_KEY_PEPPER: "a-real-pepper" });
    expect(cfg.API_KEY_PEPPER).toBe("a-real-pepper");
    expect(cfg.SESSION_SECRET.startsWith("dev-only")).toBe(false);
  });
});

describe("ProcureBot demo key", () => {
  it("is used locally when no key is set", async () => {
    const c = await containerFor({});
    await seedDemo(c);
    await expect(authenticateAgent(c, `Bearer ${DEMO_PROCUREBOT_KEY}`)).resolves.toBeTruthy();
  });

  it("is refused on a deployment, which must set its own key", async () => {
    const c = await containerFor(deployedEnv);
    await expect(seedDemo(c)).rejects.toThrow(/PROCUREBOT_API_KEY/);
  });

  it("is refused on a production deployment on the embedded database too (Render free plan)", async () => {
    const c = await containerFor({});
    vi.stubEnv("NODE_ENV", "production");
    await expect(seedDemo(c)).rejects.toThrow(/PROCUREBOT_API_KEY/);
  });

  it("is replaced by the deployment's own key, and the public one no longer works", async () => {
    process.env.PROCUREBOT_API_KEY = "sk_live_own_key_for_test";
    const c = await containerFor(deployedEnv);
    await seedDemo(c);
    await expect(authenticateAgent(c, "Bearer sk_live_own_key_for_test")).resolves.toBeTruthy();
    await expect(authenticateAgent(c, `Bearer ${DEMO_PROCUREBOT_KEY}`)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
