import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// A deployment never runs on the secrets published in this repository: the API key pepper must be set, and the
// ProcureBot agent key must be its own, not the public demo key. Local runs keep working with zero secrets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { authenticateAgent } from "@/core/agent-api";
import { loadConfig } from "@/core/config";
import { createContainer } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { seed } from "@/core/db/seed";
import { procurebotKeyFile, seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { T0 } from "../helpers";

const KEY = process.env.PROCUREBOT_API_KEY!;
const deployedEnv = { DATABASE_URL: "postgres://deployed.example/settleai", API_KEY_PEPPER: "a-real-pepper" };

async function containerFor(env: Record<string, string>) {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  return createContainer(loadConfig(env), { dbHandle, clock: new FixedClock(T0), payments: new MockPayPalAdapter() });
}

afterEach(() => {
  vi.unstubAllEnvs();
  process.env.PROCUREBOT_API_KEY = KEY;
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
  it("uses the configured key when one is set", async () => {
    const c = await containerFor({});
    await seedDemo(c);
    await expect(authenticateAgent(c, `Bearer ${process.env.PROCUREBOT_API_KEY}`)).resolves.toBeTruthy();
  });

  it("locally, with no key set, generates a random one, saves it to the ignored file and reuses it", async () => {
    vi.stubEnv("PROCUREBOT_KEY_FILE", path.join(mkdtempSync(path.join(tmpdir(), "settleai-key-")), "key"));
    delete process.env.PROCUREBOT_API_KEY;
    const c = await containerFor({});
    await seedDemo(c);
    const key = readFileSync(procurebotKeyFile(), "utf8").trim();
    expect(key).toMatch(/^sk_[0-9a-f]{48}$/);
    await expect(authenticateAgent(c, `Bearer ${key}`)).resolves.toBeTruthy();
    const again = await containerFor({});
    await seedDemo(again);
    expect(readFileSync(procurebotKeyFile(), "utf8").trim()).toBe(key);
    await expect(authenticateAgent(again, `Bearer ${key}`)).resolves.toBeTruthy();
  });

  it("on a deployment with no key set, seeds but stores no key, and the removed public key is refused", async () => {
    vi.stubEnv("PROCUREBOT_KEY_FILE", path.join(mkdtempSync(path.join(tmpdir(), "settleai-key-")), "key"));
    delete process.env.PROCUREBOT_API_KEY;
    const c = await containerFor(deployedEnv);
    await seedDemo(c);
    expect(existsSync(procurebotKeyFile())).toBe(false);
    await expect(authenticateAgent(c, "Bearer sk_demo_procurebot_9f2c")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("does the same on a production deployment on the embedded database (Render free plan)", async () => {
    vi.stubEnv("PROCUREBOT_KEY_FILE", path.join(mkdtempSync(path.join(tmpdir(), "settleai-key-")), "key"));
    const c = await containerFor({});
    delete process.env.PROCUREBOT_API_KEY;
    vi.stubEnv("NODE_ENV", "production");
    await seedDemo(c);
    expect(existsSync(procurebotKeyFile())).toBe(false);
    await expect(authenticateAgent(c, "Bearer sk_demo_procurebot_9f2c")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("is replaced by the deployment's own key, and any other key does not work", async () => {
    process.env.PROCUREBOT_API_KEY = "sk_live_own_key_for_test";
    const c = await containerFor(deployedEnv);
    await seedDemo(c);
    await expect(authenticateAgent(c, "Bearer sk_live_own_key_for_test")).resolves.toBeTruthy();
    await expect(authenticateAgent(c, `Bearer other-${KEY}`)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
