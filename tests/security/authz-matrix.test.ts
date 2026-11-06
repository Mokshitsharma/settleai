// Authorization matrix: every API route handler is called as every role (anonymous, payer, worker, admin,
// and an AI agent holding a valid API key). Disallowed roles must get 401/403 before any work happens;
// allowed roles must get past the auth check. Agents can never reach a human (fund/pay) endpoint.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/core/auth/session";
import type { Container } from "@/core/container";
import type { Role } from "@/core/contracts";

const state: { user: SessionUser | null; container: Promise<Container> | null } = { user: null, container: null };

vi.mock("@/core/auth/session", () => ({
  DEMO_USERS: { payer: "usr_ravi", worker: "usr_asha", admin: "usr_meera" },
  SESSION_COOKIE: "settleai_session",
  currentUser: async () => state.user,
  setSessionCookie: async () => {},
  clearSession: async () => {},
  issueSession: async () => "token",
}));
vi.mock("@/core/container", async (orig) => ({ ...(await orig<typeof import("@/core/container")>()), getContainer: () => state.container }));
vi.mock("@/core/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/core/rate-limit")>()), enforce: () => {} }));

type Caller = "anon" | Role | "agent";
const CALLERS: Caller[] = ["anon", "payer", "worker", "admin", "agent"];
const USERS: Record<Role, SessionUser> = {
  payer: { id: "usr_ravi", name: "Ravi", role: "payer", email: "ravi@example.com", paypalEmail: null, trustScore: 50 },
  worker: { id: "usr_asha", name: "Asha", role: "worker", email: "asha@example.com", paypalEmail: "asha@example.com", trustScore: 70 },
  admin: { id: "usr_meera", name: "Meera", role: "admin", email: "meera@example.com", paypalEmail: null, trustScore: 50 },
};

/** Who may pass authentication for each route+method. "public" routes need no identity. */
const ANY_USER: Caller[] = ["payer", "worker", "admin"];
const MATRIX: Record<string, Caller[] | "public" | "skip"> = {
  "POST admin/agents/[id]": ["admin"],
  "GET admin/policy": ["admin"],
  "PUT admin/policy": ["admin"],
  "GET agent-clients": ["payer", "admin"],
  "POST agent/jobs/[id]/confirm": ["agent"],
  "GET agent/jobs/[id]/proof-chain": ["agent"],
  "GET agent/jobs/[id]": ["agent"],
  "GET agent/jobs": ["agent"],
  "POST agent/jobs": ["agent"],
  "POST agent/mandates/[id]/check": ["agent"],
  "GET agent/mandates/[id]": ["agent"],
  "GET agent/mandates": ["agent"],
  "GET agent/milestones/[id]/decision": ["agent"],
  "POST agent/milestones/[id]/dispute": ["agent"],
  "POST auth/demo-login": "public",
  "POST auth/logout": "skip", // only clears the caller's own cookie
  "POST dev/agent-request": ["payer"],
  "POST dev/mock-paypal/approve": ["payer"],
  "POST dev/sample-proof": ["worker"],
  "POST dev/sample-damage": ["payer", "worker"],
  "POST dev/simulate-webhook": ["admin"],
  "GET dispute-evidence/[id]/image": ANY_USER,
  "POST disputes/[id]/evidence": ["payer", "worker"],
  "POST disputes/[id]/propose": ["payer", "worker"],
  "POST disputes/[id]/resolve": ["admin"],
  "POST disputes/[id]/respond": ["payer", "worker"],
  "GET events/stream": ["admin"], // the firehose without ?jobId is admin only; job channels need party membership
  "GET health": "public",
  "POST jobs/[id]/accept": ["worker"],
  "POST jobs/[id]/fund/capture": ["payer"],
  "POST jobs/[id]/fund": ["payer"],
  "GET jobs/[id]": ANY_USER,
  "PATCH jobs/[id]/spec": ["payer"],
  "GET jobs": ANY_USER,
  "POST jobs": ["payer"],
  "POST jobs/scope": ["payer"],
  "GET keys/platform": "public",
  "POST keys": ANY_USER,
  "POST mandates/[id]/revoke": ["payer", "admin"],
  "GET mandates/[id]": ["payer", "admin"],
  "POST mandates/check": ["payer"],
  "POST mandates/draft": ["payer"],
  "GET mandates": ["payer", "admin"],
  "POST mandates": ["payer"],
  "POST milestones/[id]/approve": ["admin"],
  "POST milestones/[id]/cancel": ["payer"],
  "POST milestones/[id]/dispute": ["payer", "worker"],
  "POST milestones/[id]/proofs": ["worker"],
  "POST milestones/[id]/reject": ["admin"],
  "POST milestones/[id]/resume": ["payer"],
  "POST milestones/[id]/submit": ["worker"],
  "GET proofs/[id]/image": ANY_USER,
  "GET receipts/[id]": "public",
  "POST verify": "public",
  "POST webhooks/paypal": "public",
};

const API_DIR = path.resolve("src/app/api");
function routeFiles(dir = API_DIR): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === "route.ts" ? [p] : [];
  });
}
const routes = routeFiles().map((f) => path.relative(API_DIR, path.dirname(f)).split(path.sep).join("/"));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

let agentKey = "";
beforeAll(async () => {
  const { MockPayPalAdapter } = await import("@/core/adapters/paypal/mock");
  const { loadConfig } = await import("@/core/config");
  const { createContainer } = await import("@/core/container");
  const { openTestDb } = await import("@/core/db/client");
  const { seed } = await import("@/core/db/seed");
  const { seedDemo } = await import("@/core/db/seed-demo");
  const { FixedClock } = await import("@/core/ports/clock");
  const { T0 } = await import("../helpers");
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  const c = await createContainer(loadConfig({}), { dbHandle, clock: new FixedClock(T0), payments: new MockPayPalAdapter() });
  await seedDemo(c);
  state.container = Promise.resolve(c);
  agentKey = process.env.PROCUREBOT_API_KEY!;
});
afterAll(async () => (await state.container)?.dbHandle.close());

type Handler = (req: Request, ctx: unknown) => Promise<Response>;
async function load(route: string): Promise<Record<string, Handler>> {
  return import(/* @vite-ignore */ path.join(API_DIR, route, "route.ts"));
}

async function call(route: string, method: string, caller: Caller): Promise<number> {
  const mod = await load(route);
  state.user = caller === "anon" || caller === "agent" ? null : USERS[caller];
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (caller === "agent") headers.authorization = `Bearer ${agentKey}`;
  const url = `http://localhost/api/${route.replace(/\[id\]/g, "does_not_exist")}`;
  const req = new Request(url, { method, headers, body: method === "GET" ? undefined : "{}" });
  const res = await mod[method](req, { params: Promise.resolve({ id: "does_not_exist" }) });
  if (res.body && route === "events/stream") await res.body.cancel().catch(() => {});
  return res.status;
}

describe("authorization matrix", () => {
  it("every route handler is listed in the matrix (no unreviewed endpoint)", async () => {
    const found: string[] = [];
    for (const r of routes) {
      const mod = await load(r);
      for (const m of METHODS) if (typeof mod[m] === "function") found.push(`${m} ${r}`);
    }
    expect(found.sort()).toEqual(Object.keys(MATRIX).sort());
  });

  const cases = Object.entries(MATRIX).filter(([, v]) => v !== "skip" && v !== "public") as [string, Caller[]][];
  for (const [key, allowed] of cases) {
    const [method, route] = key.split(" ");
    for (const caller of CALLERS) {
      const ok = allowed.includes(caller);
      it(`${key} as ${caller}: ${ok ? "passes auth" : "refused"}`, async () => {
        const status = await call(route, method, caller);
        if (ok) expect([401, 403]).not.toContain(status);
        else expect([401, 403]).toContain(status);
      });
    }
  }

  it("public endpoints answer anonymous callers without an auth error", async () => {
    for (const [key, v] of Object.entries(MATRIX)) {
      if (v !== "public" || key.includes("webhooks")) continue;
      const [method, route] = key.split(" ");
      expect([401, 403], key).not.toContain(await call(route, method, "anon"));
    }
  });

  it("an agent API key cannot fund, capture, approve or pay through any human endpoint", async () => {
    const money = Object.keys(MATRIX).filter((k) => /fund|capture|approve|resolve|mock-paypal|simulate-webhook/.test(k));
    expect(money.length).toBeGreaterThanOrEqual(6);
    for (const key of money) {
      const [method, route] = key.split(" ");
      expect([401, 403], key).toContain(await call(route, method, "agent"));
    }
  });

  it("forged PayPal webhooks over HTTP are refused in mock mode", async () => {
    expect(await call("webhooks/paypal", "POST", "anon")).toBe(404);
  });
});
