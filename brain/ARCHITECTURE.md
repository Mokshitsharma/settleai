# Architecture

Author: Mokshit Sharma

```mermaid
flowchart LR
    Payer[Payer] --> App[src/app]
    Agent[AI agent] --> MCP[src/mcp]
    Worker[Worker] --> App
    MCP --> Services[src/core/services]
    App --> Services
    Services --> Guard[Mandate Guard]
    Services --> Agents[src/core/agents]
    Services --> Checks[src/core/checks]
    Services --> PayPal[src/core/adapters: PayPal or mock]
    Services --> Ledger[(Double-entry ledger in Postgres or PGlite)]
    Services --> Verifier[src/core/verifier: signed receipts]
```

## Money flow

PayPal has no native escrow here. SettleAI captures to the platform account and tracks a ledgered hold until release or refund.

## Deployment shape

A single Next.js app. `docker-compose.yml` adds Postgres. On the Render free plan it uses embedded PGlite, so the demo restarts fresh.
