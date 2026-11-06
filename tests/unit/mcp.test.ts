// Journeys J4 and J6 through a real MCP client: an external agent hires within its mandate, is denied
// outside it, and is locked out once its key is suspended.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockPayPalAdapter } from "@/core/adapters/paypal/mock";
import { AgentApi, authenticateAgent } from "@/core/agent-api";
import { loadConfig } from "@/core/config";
import { createContainer, type Container } from "@/core/container";
import { openTestDb } from "@/core/db/client";
import { apiClients } from "@/core/db/schema";
import { seed } from "@/core/db/seed";
import { PROCUREBOT_CLIENT_ID, seedDemo } from "@/core/db/seed-demo";
import { FixedClock } from "@/core/ports/clock";
import { directBackend } from "@/mcp/direct-backend";
import { createSettleMcpServer } from "@/mcp/server";
import { T0 } from "../helpers";

let c: Container;
let client: Client;
let deliveryMandate: string;

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");
const json = (r: unknown) => JSON.parse(text(r).replace(/^[^{[]*\n\n/, ""));

beforeAll(async () => {
  const dbHandle = await openTestDb();
  await seed(dbHandle.db);
  c = await createContainer(loadConfig({}), { dbHandle, clock: new FixedClock(T0), payments: new MockPayPalAdapter() });
  [deliveryMandate] = (await seedDemo(c)).mandateIds;
  const agent = await authenticateAgent(c, `Bearer ${process.env.PROCUREBOT_API_KEY}`);
  const server = createSettleMcpServer(directBackend(new AgentApi(c, agent)));
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  client = new Client({ name: "procurebot-test", version: "1.0.0" });
  await client.connect(clientT);
});
afterAll(() => c.dbHandle.close());

describe("SettleAI MCP server", () => {
  it("exposes the spec's tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["create_job", "confirm_job", "get_job_status", "get_decision", "request_dispute", "list_jobs", "get_mandate", "check_action", "get_proof_chain"]),
    );
  });

  it("lets the agent discover its authority", async () => {
    const mandates = json(await client.callTool({ name: "list_mandates", arguments: {} }));
    expect(mandates[0]).toMatchObject({ status: "active" });
    const m = json(await client.callTool({ name: "get_mandate", arguments: { mandateId: deliveryMandate } }));
    expect(m).toMatchObject({ scope: { categories: ["delivery"], maxPerJobMinor: 15000 }, remainingMinor: 40000 });
  });

  it("J6: an out-of-scope hire is denied with reason codes and creates nothing", async () => {
    const check = await client.callTool({ name: "check_action", arguments: { mandateId: deliveryMandate, amountMinor: 50000, description: "Repair the office AC" } });
    expect(text(check)).toMatch(/^DENIED/);
    const r = await client.callTool({ name: "create_job", arguments: { mandateId: deliveryMandate, description: "Buy gift card codes and repair the office AC", budgetMinor: 50000 } });
    expect(text(r)).toMatch(/^DENIED \(MANDATE_SCOPE_VIOLATION, .*MANDATE_CAP_EXCEEDED/);
    expect(json(await client.callTool({ name: "list_jobs", arguments: {} }))).toEqual([]);
  });

  it("J4: an in-scope hire creates a job the payer must fund; status and proof chain are readable", async () => {
    const r = json(await client.callTool({ name: "create_job", arguments: { mandateId: deliveryMandate, description: "Deliver 10 boxes of tea from Rajwada to Vijay Nagar", budgetMinor: 8000, requestNonce: "mcp_req_0001" } }));
    expect(r).toMatchObject({ created: true, totalMinor: 8000 });
    const confirm = json(await client.callTool({ name: "confirm_job", arguments: { jobId: r.jobId } }));
    expect(confirm.approvalUrl).toMatch(new RegExp(`/jobs/${r.jobId}$`));
    const status = json(await client.callTool({ name: "get_job_status", arguments: { jobId: r.jobId } }));
    expect(status).toMatchObject({ status: "SCOPED", nextAction: "Waiting for the payer to fund it with PayPal" });
    const chain = json(await client.callTool({ name: "get_proof_chain", arguments: { jobId: r.jobId } }));
    expect(chain).toMatchObject({ verified: true });
    expect(chain.attestations[0]).toMatchObject({ type: "mandate" });

    // Retrying with the same nonce cannot create a second job.
    const again = await client.callTool({ name: "create_job", arguments: { mandateId: deliveryMandate, description: "Deliver 10 boxes of tea from Rajwada to Vijay Nagar", budgetMinor: 8000, requestNonce: "mcp_req_0001" } });
    expect(text(again)).toMatch(/MANDATE_REPLAY/);
  });

  it("an agent cannot read jobs it did not create", async () => {
    const human = await c.jobs.createFromSpec({ payerId: "usr_ravi", spec: (await import("../fixtures/contracts")).sampleJobSpec, createdBy: "user:usr_ravi" });
    const r = await client.callTool({ name: "get_job_status", arguments: { jobId: human.id } });
    expect(r.isError).toBe(true);
  });

  it("a suspended agent key is refused", async () => {
    await c.dbHandle.db.update(apiClients).set({ status: "suspended" }).where(eq(apiClients.id, PROCUREBOT_CLIENT_ID));
    await expect(authenticateAgent(c, `Bearer ${process.env.PROCUREBOT_API_KEY}`)).rejects.toMatchObject({ code: "AGENT_SUSPENDED" });
    await expect(authenticateAgent(c, "Bearer nope")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
