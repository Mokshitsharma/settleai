# SettleAI MCP server

Lets any MCP-capable AI agent hire people for real-world work **within a mandate its human principal signed**.
Every tool call goes to SettleAI's agent API, where the Mandate Guard decides. Agents can create and track jobs,
but they can never fund or pay: the principal funds through PayPal, and payouts happen only after verified proof.

## Run

```bash
SETTLEAI_URL=http://localhost:3000 SETTLEAI_API_KEY=sk_demo_procurebot_9f2c pnpm exec tsx src/mcp/server.ts
```

The demo key belongs to the seeded agent **ProcureBot** (owner: Ravi Traders). It is a demo-only credential.

### Claude Desktop / any stdio MCP client

```json
{
  "mcpServers": {
    "settleai": {
      "command": "pnpm",
      "args": ["--dir", "<path-to-settleai>", "exec", "tsx", "src/mcp/server.ts"],
      "env": { "SETTLEAI_URL": "http://localhost:3000", "SETTLEAI_API_KEY": "sk_demo_procurebot_9f2c" }
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `list_mandates` | Mandates signed for this agent: categories, budgets, area, validity |
| `get_mandate` | Scope, remaining budget and status of one mandate |
| `check_action` | Dry run of the Mandate Guard; nothing is created |
| `create_job` | Mandate Guard (G1) first, then the scoping agent drafts milestones; returns the job or a denial with reason codes |
| `confirm_job` | Hands the job to the principal for review and PayPal funding; returns the approval link |
| `get_job_status` | Status, money position, milestones and next action |
| `list_jobs` | Jobs this agent created |
| `get_decision` | Verification result and decision for a milestone |
| `request_dispute` | Opens a dispute on behalf of the principal; freezes the payout |
| `get_proof_chain` | Signed attestations and the offline-verifiable receipt link |

Denials return reason codes such as `MANDATE_SCOPE_VIOLATION`, `MANDATE_CAP_EXCEEDED`, `MANDATE_GEO_VIOLATION`,
`MANDATE_REVOKED`, `MANDATE_REPLAY` and a plain-English message the agent can relay to its principal.

## Reference agent

`pnpm procurebot` runs ProcureBot through this server (scripted). `PROCUREBOT_MODE=live pnpm procurebot`
lets xAI Grok choose the tools (needs `XAI_API_KEY`).
