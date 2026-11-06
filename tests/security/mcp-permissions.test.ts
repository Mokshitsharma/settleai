// MCP tool permissions: an AI agent connected over MCP can never fund, capture, release, refund or approve.
// Three independent proofs: (1) the tool surface has no money-moving tool and every tool maps to an allowlisted
// read/create/dispute route under /api/agent; (2) the HTTP backend can only reach /api/agent/*; (3) calling every
// tool against a real, funded system with a valid agent key moves no money (ledger and PayPal mock unchanged).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { AgentApi, authenticateAgent } from "@/core/agent-api";
import { createStubLlm } from "@/core/agents/stub-fixtures";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { ledgerEntries, payouts, refunds, releases } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { directBackend } from "@/mcp/direct-backend";
import { createSettleMcpServer, httpBackend, type SettleBackend } from "@/mcp/server";
import { T0 } from "../helpers";

const EXPECTED_TOOLS = ["check_action", "confirm_job", "create_job", "get_decision", "get_job_status", "get_mandate", "get_proof_chain", "list_jobs", "list_mandates", "request_dispute"];
const MONEY_WORDS = /fund|pay|capture|release|refund|approve|resolve|transfer|withdraw|settle/i;
/** Every backend route an MCP tool may reach. Nothing here moves money. */
const ALLOWED_ROUTES: [string, RegExp][] = [
  ["GET", /^\/mandates$/],
  ["GET", /^\/mandates\/[^/]+$/],
  ["POST", /^\/mandates\/[^/]+\/check$/],
  ["POST", /^\/jobs$/],
  ["GET", /^\/jobs(\?status=[^/]*)?$/],
  ["GET", /^\/jobs\/[^/]+$/],
  ["POST", /^\/jobs\/[^/]+\/confirm$/],
  ["GET", /^\/jobs\/[^/]+\/proof-chain$/],
  ["GET", /^\/milestones\/[^/]+\/decision$/],
  ["POST", /^\/milestones\/[^/]+\/dispute$/],
];

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  list_mandates: {},
  get_mandate: { mandateId: "mnd_x" },
  check_action: { mandateId: "mnd_x", amountMinor: 100, description: "deliver a box" },
  create_job: { mandateId: "mnd_x", description: "Deliver 2 boxes to Vijay Nagar", budgetMinor: 1000 },
  confirm_job: { jobId: "job_x" },
  get_job_status: { jobId: "job_x" },
  list_jobs: { status: "FUNDED" },
  get_decision: { milestoneId: "ms_x" },
  request_dispute: { milestoneId: "ms_x", reason: "late delivery" },
  get_proof_chain: { jobId: "job_x" },
};

async function connect(backend: SettleBackend) {
  const server = createSettleMcpServer(backend);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "perm-test", version: "1.0.0" });
  await client.connect(clientT);
  return client;
}

describe("MCP tool surface", () => {
  it("exposes exactly the reviewed tools, none of which names a money action", async () => {
    const client = await connect({ call: async () => ({}) });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    for (const t of tools) expect(t.name, t.name).not.toMatch(MONEY_WORDS);
  });

  it("every tool only reaches allowlisted agent routes (recorded backend)", async () => {
    const calls: [string, string][] = [];
    const client = await connect({ call: async (method, path) => (calls.push([method, path]), { allowed: true, created: true, decision: { reasonCodes: [], message: "" } }) });
    for (const [name, args] of Object.entries(SAMPLE_ARGS)) await client.callTool({ name, arguments: args });
    expect(calls).toHaveLength(EXPECTED_TOOLS.length);
    for (const [method, path] of calls) {
      expect(ALLOWED_ROUTES.some(([m, re]) => m === method && re.test(path)), `${method} ${path}`).toBe(true);
      expect(path.replace(/\/(mnd|job|ms)_x/g, "")).not.toMatch(/fund|capture|payout|release|refund|approve|resolve/);
    }
  });

  it("the HTTP backend can only call /api/agent/* with the agent's bearer key", async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const client = await connect(httpBackend("https://settle.example/", "sk_agent"));
      for (const [name, args] of Object.entries(SAMPLE_ARGS)) await client.callTool({ name, arguments: args });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen).toHaveLength(EXPECTED_TOOLS.length);
    for (const s of seen) expect(s).toMatch(/^(GET|POST) https:\/\/settle\.example\/api\/agent\/\S+ Bearer sk_agent$/);
  });

  it("AgentApi (the server side of every tool) has no money-moving method", () => {
    const methods = Object.getOwnPropertyNames(AgentApi.prototype).filter((m) => m !== "constructor");
    expect(methods.length).toBeGreaterThanOrEqual(10);
    for (const m of methods) expect(m, m).not.toMatch(/fund|pay|capture|release|refund|approve|resolve|settle/i);
  });
});

describe("MCP tools against a live system cannot move money", () => {
  let c: Container;
  afterAll(() => c?.dbHandle.close());

  it("calling every tool, including on a funded job with a verified milestone, posts nothing to the ledger or PayPal", async () => {
    const dbHandle = await openTestDb();
    await seed(dbHandle.db);
    const paypal = new MockPayPalAdapter();
    const clock = new FixedClock(T0);
    c = await createContainer(loadConfig({ CHALLENGE_WINDOW_SECONDS: "3600" }), { dbHandle, clock, payments: paypal, llm: createStubLlm() });
    const [mandateId] = (await seedDemo(c)).mandateIds;
    const agent = await authenticateAgent(c, `Bearer ${process.env.PROCUREBOT_API_KEY}`);
    const client = await connect(directBackend(new AgentApi(c, agent)));
    const json = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]?.text ?? "").replace(/^[^{[]*\n\n/, ""));

    // The agent creates and confirms a job; the human payer funds it (agents cannot).
    const created = json(await client.callTool({ name: "create_job", arguments: { mandateId, description: "Deliver 5 boxes from Rajwada to Vijay Nagar", budgetMinor: 4000, requestNonce: "perm_nonce_1" } }));
    expect(created.created).toBe(true);
    await client.callTool({ name: "confirm_job", arguments: { jobId: created.jobId } });
    const order = await c.funding.start({ jobId: created.jobId, payerId: "usr_ravi" });
    paypal.approveOrder(order.orderId);
    await c.funding.capture({ jobId: created.jobId, payerId: "usr_ravi", orderId: order.orderId });
    await c.deliverMockWebhooks();
    const detail = (await c.jobs.detail(created.jobId))!;
    const msId = detail.milestones[0].id;

    const snapshot = async () => ({
      entries: (await c.dbHandle.db.select().from(ledgerEntries)).length,
      releases: (await c.dbHandle.db.select().from(releases)).length,
      payouts: (await c.dbHandle.db.select().from(payouts)).length,
      refunds: (await c.dbHandle.db.select().from(refunds)).length,
      paypalEvents: paypal.outbox.length,
    });
    const before = await snapshot();
    expect(before.entries).toBeGreaterThan(0); // the job really is funded

    const real: Record<string, Record<string, unknown>> = {
      list_mandates: {},
      get_mandate: { mandateId },
      check_action: { mandateId, amountMinor: 4000, description: "Deliver 5 boxes from Rajwada to Vijay Nagar" },
      list_jobs: {},
      get_job_status: { jobId: created.jobId },
      get_decision: { milestoneId: msId },
      get_proof_chain: { jobId: created.jobId },
      confirm_job: { jobId: created.jobId },
      request_dispute: { milestoneId: msId, reason: "agent wants its money back" },
      create_job: { mandateId, description: "Deliver 5 boxes from Rajwada to Vijay Nagar and pay the worker now", budgetMinor: 4000, requestNonce: "perm_nonce_2" },
    };
    for (const [name, args] of Object.entries(real)) await client.callTool({ name, arguments: args });
    // Unknown / invented money tools are rejected by the MCP server itself.
    for (const name of ["release_payment", "fund_job", "refund", "approve_milestone"]) {
      const r = (await client.callTool({ name, arguments: {} }).catch((e: Error) => ({ isError: true, err: e.message }))) as { isError?: boolean };
      expect(r.isError, name).toBe(true);
    }
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(await c.ledger.checkInvariants()).toEqual([]);
  });
});
