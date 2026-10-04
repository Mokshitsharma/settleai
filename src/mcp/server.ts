// SettleAI MCP server (spec §12.3, F16). Gives any MCP-capable agent mandate-aware tools for hiring people.
// Run: SETTLEAI_URL=https://... SETTLEAI_API_KEY=sk_... tsx src/mcp/server.ts   (stdio transport)
// The server is a thin client of SettleAI's agent REST API, so every call passes Mandate Guard on the server.
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/** What the tools need from SettleAI: HTTP in production, direct calls in tests. */
export interface SettleBackend {
  call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown>;
}

export function httpBackend(baseUrl: string, apiKey: string): SettleBackend {
  return {
    async call(method, path, body) {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent${path}`, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } };
      if (!res.ok) throw new Error(`${data.error?.code ?? res.status}: ${data.error?.message ?? res.statusText}`);
      return data;
    },
  };
}

const result = (data: unknown, summary?: string) => ({
  content: [{ type: "text" as const, text: `${summary ? `${summary}\n\n` : ""}${JSON.stringify(data, null, 2)}` }],
});

const failure = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (err as Error).message }] });

async function run<T>(fn: () => Promise<T>, summarize?: (data: T) => string) {
  try {
    const data = await fn();
    return result(data, summarize?.(data));
  } catch (err) {
    return failure(err);
  }
}

export function createSettleMcpServer(backend: SettleBackend): McpServer {
  const server = new McpServer(
    { name: "settleai", version: "0.3.0" },
    {
      instructions:
        "SettleAI lets you hire people for real-world work within a mandate your human principal signed. Check your mandate first (get_mandate or check_action). " +
        "Amounts are integers in US cents. You can create and track jobs, but you can never fund or pay: the principal funds jobs through PayPal, " +
        "and payouts happen only after the worker's proof is verified. A denied request returns reason codes; relay them to your principal.",
    },
  );

  server.registerTool(
    "list_mandates",
    { title: "List my mandates", description: "Mandates your principal signed for you: what you may hire, budgets, area and validity." },
    () => run(() => backend.call("GET", "/mandates")),
  );

  server.registerTool(
    "get_mandate",
    { title: "Get mandate", description: "Scope, remaining budget, validity and status of one mandate.", inputSchema: { mandateId: z.string() } },
    ({ mandateId }) => run(() => backend.call("GET", `/mandates/${encodeURIComponent(mandateId)}`)),
  );

  server.registerTool(
    "check_action",
    {
      title: "Check an action",
      description: "Dry run of the Mandate Guard: would creating this job be allowed? Nothing is created.",
      inputSchema: {
        mandateId: z.string(),
        amountMinor: z.number().int().positive().describe("Budget in US cents"),
        description: z.string().describe("What you want done"),
        category: z.enum(["delivery", "digital_deliverable", "onsite_service"]).optional(),
      },
    },
    (args) =>
      run(
        () => backend.call("POST", `/mandates/${encodeURIComponent(args.mandateId)}/check`, args) as Promise<{ allowed: boolean; message: string }>,
        (d) => (d.allowed ? "ALLOWED" : `DENIED: ${d.message}`),
      ),
  );

  server.registerTool(
    "create_job",
    {
      title: "Create a job",
      description:
        "Ask SettleAI to hire someone. The Mandate Guard checks your mandate first; if allowed, the scoping agent turns the description into paid milestones with proof requirements. Returns the job or a denial with reason codes.",
      inputSchema: {
        mandateId: z.string(),
        description: z.string().min(10).describe("Who, what, where and by when"),
        budgetMinor: z.number().int().positive().describe("Total budget in US cents"),
        deadline: z.string().optional().describe("ISO 8601 deadline"),
        location: z.object({ lat: z.number(), lng: z.number() }).optional(),
        requestNonce: z.string().min(8).optional().describe("Idempotency key: reuse it when retrying the same request"),
      },
    },
    (args) =>
      run(
        () => backend.call("POST", "/jobs", args) as Promise<{ created: boolean; decision: { reasonCodes: string[]; message: string } }>,
        (d) => (d.created ? "CREATED. Call confirm_job so your principal can fund it." : `DENIED (${d.decision.reasonCodes.join(", ")}): ${d.decision.message}`),
      ),
  );

  server.registerTool(
    "confirm_job",
    { title: "Confirm a job", description: "Hand a created job to your principal for review and PayPal funding. Returns the approval link.", inputSchema: { jobId: z.string() } },
    ({ jobId }) => run(() => backend.call("POST", `/jobs/${encodeURIComponent(jobId)}/confirm`)),
  );

  server.registerTool(
    "get_job_status",
    { title: "Job status", description: "Status, money position and milestone states of a job you created, with the next action.", inputSchema: { jobId: z.string() } },
    ({ jobId }) => run(() => backend.call("GET", `/jobs/${encodeURIComponent(jobId)}`)),
  );

  server.registerTool(
    "list_jobs",
    { title: "List my jobs", description: "Jobs you created, optionally filtered by status.", inputSchema: { status: z.string().optional() } },
    ({ status }) => run(() => backend.call("GET", `/jobs${status ? `?status=${encodeURIComponent(status)}` : ""}`)),
  );

  server.registerTool(
    "get_decision",
    { title: "Verification decision", description: "Verification result and decision for a milestone of your job.", inputSchema: { milestoneId: z.string() } },
    ({ milestoneId }) => run(() => backend.call("GET", `/milestones/${encodeURIComponent(milestoneId)}/decision`)),
  );

  server.registerTool(
    "request_dispute",
    { title: "Open a dispute", description: "Dispute a milestone on behalf of your principal. Freezes its payout.", inputSchema: { milestoneId: z.string(), reason: z.string().min(5) } },
    ({ milestoneId, reason }) => run(() => backend.call("POST", `/milestones/${encodeURIComponent(milestoneId)}/dispute`, { reason })),
  );

  server.registerTool(
    "get_proof_chain",
    { title: "Proof chain", description: "Signed attestations for a job and a link to its offline-verifiable receipt.", inputSchema: { jobId: z.string() } },
    ({ jobId }) => run(() => backend.call("GET", `/jobs/${encodeURIComponent(jobId)}/proof-chain`)),
  );

  return server;
}

async function main() {
  const url = process.env.SETTLEAI_URL ?? "http://localhost:3000";
  const key = process.env.SETTLEAI_API_KEY;
  if (!key) {
    console.error("Set SETTLEAI_API_KEY (and SETTLEAI_URL) to run the SettleAI MCP server.");
    process.exit(2);
  }
  const server = createSettleMcpServer(httpBackend(url, key));
  await server.connect(new StdioServerTransport());
  console.error(`SettleAI MCP server connected (backend ${url})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
