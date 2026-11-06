// ProcureBot: the reference buyer agent (spec F33). It connects to SettleAI ONLY through the MCP server,
// exactly like any third-party agent would.
//   pnpm procurebot                      scripted run (reliable for the demo video)
//   PROCUREBOT_MODE=live pnpm procurebot an LLM (xAI Grok) decides which tools to call
// Env: SETTLEAI_URL (default http://localhost:3000), SETTLEAI_API_KEY (default: the demo key), XAI_API_KEY.
import "./_env";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, readFileSync } from "node:fs";
import { procurebotKeyFile } from "@/core/db/seed-demo";

const TASK =
  process.argv.slice(2).join(" ") ||
  "Ravi Traders needs 20 cartons of tea moved from Rajwada to his shop in Vijay Nagar today; budget $100. He also wants the office AC repaired; budget $500.";

type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean };
const textOf = (r: ToolResult) => r.content?.map((c) => c.text ?? "").join("\n") ?? "";

function say(who: string, msg: string) {
  console.log(`\n${who === "agent" ? "ProcureBot" : who === "tool" ? "  SettleAI" : "  ->"}: ${msg}`);
}

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("src/mcp/server.ts")],
    env: {
      ...process.env,
      SETTLEAI_URL: process.env.SETTLEAI_URL ?? "http://localhost:3000",
      SETTLEAI_API_KEY: process.env.SETTLEAI_API_KEY ?? process.env.PROCUREBOT_API_KEY ?? (existsSync(procurebotKeyFile()) ? readFileSync(procurebotKeyFile(), "utf8").trim() : ""),
    } as Record<string, string>,
    stderr: "inherit",
  });
  const client = new Client({ name: "procurebot", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  say("call", `${name}(${JSON.stringify(args)})`);
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  say("tool", textOf(r).split("\n").slice(0, 12).join("\n            "));
  return r;
}

const firstJson = (r: ToolResult) => JSON.parse(textOf(r).replace(/^[^{[]*\n\n/, ""));

/** Deterministic run used for the video: check authority, get denied, hire within scope, hand to the human. */
async function scripted(client: Client) {
  say("agent", `Task: ${TASK}`);
  const mandates = firstJson(await call(client, "list_mandates", {})) as { mandateId: string; status: string; scope: { categories: string[] } }[];
  const m = mandates.find((x) => x.status === "active" && x.scope.categories.includes("delivery"));
  if (!m) throw new Error("No active delivery mandate. Sign one on the Agent mandates page.");
  say("agent", "First the AC repair. Let me check whether my mandate allows it.");
  await call(client, "check_action", { mandateId: m.mandateId, amountMinor: 50000, description: "Repair the office AC", category: "onsite_service" });
  say("agent", "The check says no, but I will try anyway to show the guard holds.");
  await call(client, "create_job", { mandateId: m.mandateId, description: "Repair the office AC at Ravi Traders, Palasia", budgetMinor: 50000 });
  say("agent", "Denied before any money moved. I will tell Ravi. Now the delivery, which is inside my mandate.");
  const created = firstJson(
    await call(client, "create_job", { mandateId: m.mandateId, description: "Deliver 20 cartons of tea from Rajwada to Ravi's shop in Vijay Nagar today", budgetMinor: 10000 }),
  ) as { created: boolean; jobId?: string };
  if (!created.created || !created.jobId) return;
  const confirm = firstJson(await call(client, "confirm_job", { jobId: created.jobId })) as { approvalUrl: string };
  await call(client, "get_job_status", { jobId: created.jobId });
  say("agent", `Done. Ravi: please review and fund the delivery with PayPal at ${confirm.approvalUrl}. The AC repair is outside what you allowed me to buy.`);
}

/** Live mode: a real model picks the tools (OpenAI-compatible function calling on Groq or xAI). */
async function live(client: Client) {
  const useXai = process.env.LLM_PROVIDER === "xai" || !process.env.GROQ_API_KEY;
  const key = useXai ? process.env.XAI_API_KEY : process.env.GROQ_API_KEY;
  if (!key) throw new Error("PROCUREBOT_MODE=live needs GROQ_API_KEY or XAI_API_KEY");
  const endpoint = useXai ? "https://api.x.ai/v1/chat/completions" : "https://api.groq.com/openai/v1/chat/completions";
  const model = process.env.PROCUREBOT_MODEL ?? (useXai ? "grok-4.7" : "openai/gpt-oss-120b");
  say("agent", `Model: ${model}`);
  const { tools } = await client.listTools();
  const fnTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema } }));
  const messages: Record<string, unknown>[] = [
    {
      role: "system",
      content:
        "You are ProcureBot, an AI agent that hires people on behalf of Ravi Traders through SettleAI tools. Always check your mandate before hiring. " +
        "Amounts are integers in US cents. Never try to fund or pay; hand created jobs to the human with confirm_job. If a request is denied, explain the reason codes to the human and do not retry outside the mandate. Finish with a short summary for Ravi.",
    },
    { role: "user", content: TASK },
  ];
  say("agent", `Task: ${TASK}`);
  for (let step = 0; step < 12; step++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.2, messages, tools: fnTools, tool_choice: "auto" }),
    });
    if (!res.ok) throw new Error(`Model request failed with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] };
    const msg = data.choices[0].message;
    messages.push(msg as unknown as Record<string, unknown>);
    if (msg.content) say("agent", msg.content);
    if (!msg.tool_calls?.length) return;
    for (const tc of msg.tool_calls) {
      const r = await call(client, tc.function.name, JSON.parse(tc.function.arguments || "{}"));
      messages.push({ role: "tool", tool_call_id: tc.id, content: textOf(r) });
    }
  }
  say("agent", "Stopping after 12 steps.");
}

async function main() {
  const client = await connect();
  try {
    if (process.env.PROCUREBOT_MODE === "live") await live(client);
    else await scripted(client);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("ProcureBot failed:", (err as Error).message);
  process.exit(1);
});
