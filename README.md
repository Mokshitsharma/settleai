# SettleAI

**The accountability layer for agentic commerce: mandates, verified outcomes, PayPal settlement.**

> AP2 proves a human authorized an agent to pay. SettleAI proves the work was done before the money moves, and decides who is liable when it was not.

Built for the PayPal AI Hackathon 2026. Status: Phase 3 of 6 complete (disputes, MCP agents, offline receipts). See [docs/STATUS.md](docs/STATUS.md).

## Quick start (zero keys needed)

```bash
pnpm install
pnpm db:reset      # creates and seeds a local embedded Postgres (PGlite) in .data/
pnpm dev           # http://localhost:3000  (health: /api/health)
pnpm test          # unit and integration tests
pnpm demo:smoke    # end-to-end money flow in MOCK mode
```

With no keys set, the app runs in **MOCK mode**: PayPal calls go to a deterministic mock and AI calls go to an offline stub. The header badge always shows which mode is active.

Optional `.env.local` (see [.env.example](.env.example)):

```bash
LLM_PROVIDER=xai
XAI_API_KEY=...            # Grok for live AI agents
PAYPAL_CLIENT_ID=...       # PayPal sandbox; switches payments to LIVE (sandbox) mode
PAYPAL_CLIENT_SECRET=...
```

## For AI agents (MCP)

Any MCP-capable agent can hire through SettleAI within the mandate its human signed. See [src/mcp/README.md](src/mcp/README.md).

```bash
pnpm dev                 # in one terminal
pnpm procurebot          # the reference agent hires via MCP: one request denied, one created
```

## Verify a receipt offline

```bash
curl -o receipt.json "http://localhost:3000/api/receipts/<jobId>"
curl -o keys.json http://localhost:3000/api/keys/platform
pnpm verify-receipt receipt.json --platform-keys keys.json
```

Change one byte in `receipt.json` and run it again: verification fails and points at the broken link. The same verifier runs in the browser at `/verify`.

## Honest positioning

- Everything runs in the PayPal sandbox (or a mock) with test money.
- SettleAI mandates are AP2-inspired and extend the idea to conditional settlement. They are not official AP2 and are not endorsed by PayPal or Google.
- PayPal has no native escrow product here. SettleAI uses a ledgered hold: funds are captured to the platform account and released by Payouts.
- A production system holding customer funds needs licensing or a regulated partner, a KMS or HSM for keys, and a third-party security review.

## License

[MIT](LICENSE)
