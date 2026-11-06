# Technical requirements

Author: Mokshit Sharma

## Stack

Next.js 16.4.5, React 19.2.8, Drizzle ORM 0.45, Postgres or embedded PGlite, pnpm 9.15.9, Vitest and Playwright.

## Modules

| Path | Responsibility |
|---|---|
| `src/core/services` | Jobs, funding, treasury, ledger, verification, releases, disputes, mandates |
| `src/core/agents` | Scoping, verification and arbiter agents, with offline stubs |
| `src/core/mandates`, `src/core/verifier` | Canonical JSON, ES256 JWS, proof chain, offline verifier |
| `src/core/adapters` | PayPal (live REST and mock), LLM, storage |
| `src/core/checks`, `src/core/policy`, `src/core/state` | Proof checks, policy and state |
| `src/core/queue`, `src/core/events`, `src/core/reliability` | Background work and events |
| `src/mcp` | MCP server |
| `src/app` | Pages and API routes |

## Data model

Drizzle tables include `users`, `apiClients`, `jobs`, `milestones`, `fundingOrders`, `proofs`, `verifications`, `riskAssessments`, `releases`, `payouts`, `disputes`, `refunds`, `ledgerAccounts`, `ledgerEntries`, `ledgerTxns`, `auditLog`, `webhookEvents`, `policies`, `signingKeys`, `mandates`, `mandateChecks`, `outboxEvents`, `deadLetters` and `evalRuns`.

## Environment variables (names only)

`APP_MODE`, `DATABASE_URL`, `PGLITE_DATA_DIR`, `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `LLM_PROVIDER`, `LLM_MODEL`, `XAI_API_KEY`, `GROQ_API_KEY`, `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `PLATFORM_FEE_BPS`, `CHALLENGE_WINDOW_SECONDS`, `DISPUTE_EVIDENCE_WINDOW_SECONDS`, `PAYOUT_KILL_SWITCH`, `SESSION_SECRET`, `API_KEY_PEPPER`, `PLATFORM_SIGNING_KEY_JWK`, `KEY_MODE`, `POSTGRES_PASSWORD`. See `.env.example` for the full list.

## Performance notes

The README states load figures are unmeasured estimates. Measured in this review: only the test run.
