# SettleAI status

Phase plan: docs/SPEC.md §19. Feature freeze 8 Nov 2026; submit by 11 Nov 2026.

## Official rules check (2026-10-03): overrides the spec where they differ

- **Deadline: 12 Nov 2026, 12:00 pm PT** (spec said 2:00 pm) = 20:00 UTC = ~01:30 IST on 13 Nov. Target remains submit by 11 Nov.
- **Judging: 1–15 Dec 2026.** Hosted demo, sandbox credentials and LLM budget must stay alive until 15 Dec.
- Demo access: hosted URL **or** complete local setup instructions. Provide both: Render URL + zero-key MOCK quick start + sandbox buyer login in README.
- Must integrate the **PayPal sandbox**: Stage One checks it "reasonably applies the required APIs". MOCK-only is a real risk, so we need sandbox credentials before Phase 5.
- Stage Two criteria, equally weighted: Technological Implementation, Design, Potential Impact, Innovation, Presentation. **Tie-break uses Technological Implementation first.** "Design" means a complete, coherent product, not a proof of concept.
- **Prize stacking:** at most one Grand Prize *or* one Honorable Mention (Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce) **plus one Sponsor Prize**.
- Sponsor prize target: **AG Grid** (1st $5k). Render and APIMatic are useful but only one sponsor prize can be won. **Elastic, Channel3 and Bryntum have no or irrelevant prizes**, so F22 (Elastic precedents) drops to the bottom of the cut list.
- PayPal AI resources worth using for "Technological Implementation" and the agentic prize: PayPal Agent Toolkit and the PayPal MCP server (docs.paypal.ai). Evaluate in T302/T303 for Concierge and ProcureBot.
- Funding UI should use the **PayPal JavaScript SDK v6** in LIVE mode (T131).
- Video: under 3 minutes, public on YouTube, no copyrighted music or third-party trademarks without permission.
- Public GitHub repo with the license visible in the About section.

## Phase 0: Foundation and contracts (3–5 Oct): DONE 2026-10-03

1. T001 Next.js 16 + TS strict + Tailwind, Drizzle, Vitest, ESLint, GitHub Actions CI.
2. T002 Ports (Payments, Llm, Storage, Search, Clock) with mock adapters; xAI Grok adapter; MOCK/LIVE badge; `/api/health`.
3. T003 Schema and migration for all §9 tables including mandates, spend counters and attestations; seed skeleton.
4. T004 Zod contracts for JobSpec, mandates, attestations, VerificationResult, DisputeProposal and policy, with fixtures.
5. T005 Double-entry ledger (balanced, idempotent, escrow never negative, property-tested) and hash-chained audit log; `pnpm demo:smoke` green.
6. T006 CLAUDE.md, .env.example, docs stubs, MIT license.

### Deviations from spec (with reasons)
- **PGlite instead of Docker Postgres for local and demo.** Docker is not installed on the dev machine; PGlite is real Postgres in WASM, keeps zero-setup. Real Postgres is used when `DATABASE_URL` is set (Render, CI).
- **xAI Grok instead of Anthropic as the live LLM** (decision D2 by owner). Same `LlmPort`; offline stub for demo and CI.
- **PayPal in MOCK mode** until sandbox credentials arrive (owner decision). Live adapter methods throw until T101/T102.
- **Extra table `ledger_txns`** holding a unique idempotency key per money movement, so a retried release or refund can never double-post.
- **Audit hash covers seq, actor, action, entity and payload** (spec says payload only), so metadata cannot be altered either.

### Open items / needs from owner
- PayPal sandbox Client ID + Secret before Phase 5 (strongly recommended for the "Best Use of PayPal" prize and Stage One viability).
- `XAI_API_KEY` in `.env.local` when live AI testing starts (Phase 1, T111).

## Track sections
- A. Payments and ledger: ledger + mock PayPal done; live adapter pending (T101).
- B. Agents and verification: LlmPort, stub and xAI adapters ready; agent runtime next (T111).
- C. Mandates and proof: canonical JSON and hashing done; signing/verification next (T121).
- D. Product and UI: placeholder landing with mode badge; real UI starts T131.
- E. Platform and QA: CI, smoke script; seed fixtures next (T141).
