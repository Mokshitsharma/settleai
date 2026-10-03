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

## Phase 1: Core loops (6–12 Oct): DONE 2026-10-03 (ahead of schedule)

1. T101/T102 Live PayPal REST adapter verified against official OpenAPI specs (docs/paypal-notes.md); webhook pipeline (verify, dedupe, state-machine-safe); Treasury payouts (claim-then-call, retries with fresh ids, kill switch) and escrow-bounded refunds.
2. T111/T112 Agent runtime (Zod, one retry with error feedback, HUMAN_REVIEW fallback, agent_runs traces, SSE); Scoping Agent with templates, never-invent-amounts guard, prohibited-content flags, deterministic offline stub.
3. T121/T122 ES256 JWS over RFC 8785 canonical JSON; envelopes; signed hash-linked attestation chain; Intent Mandates (draft, browser or managed signing, revoke); row-locked spend counters (50-way race test).
4. T131/T132 Demo auth with role switcher; landing, jobs, job detail (money strip, milestones, live activity), job intake with streamed scoping, mock PayPal checkout; mandate composer with plain-language preview, in-browser WebCrypto signing, revoke.
5. T141 ProcureBot client and two pre-signed mandates in seed; Playwright e2e (J1 fund+accept, mandate sign+revoke) green; render.yaml. 63 unit/integration tests + 2 e2e green; production build green.

### Phase 1 deviations and leftovers
- Prompts live in `prompt.ts` (versioned constant) instead of `prompt.md`, so they bundle without filesystem reads in production.
- Funding in LIVE mode uses the PayPal approve link + "capture now" button; switch to **PayPal JS SDK v6** buttons once sandbox credentials exist (must test against sandbox, not guess).
- Human-created jobs are funded without Job/Payment Mandates for now; mandate lineage binding is T205. `custom_id` currently binds the order to the job-spec hash.
- Fee on refunds: refunds return principal only; unearned fee share on cancellation/dispute is handled in T301.
- **Not done from T141, moved to Phase 2 start:** proof photo fixtures with EXIF/GPS (needed by T201) and 12 historical jobs (need the release flow). Render deploy needs the owner's Render account; plan names in render.yaml must be checked in the dashboard.
- Proof uploads use local disk; Render disks are ephemeral, so production needs S3/R2 (D3) before Phase 5.

### Open items / needs from owner
- PayPal sandbox Client ID + Secret before Phase 5 (strongly recommended for the "Best Use of PayPal" prize and Stage One viability).
- `XAI_API_KEY` in `.env.local` to test the live Scoping Agent (everything works on the offline stub meanwhile).
- Real delivery photos taken in Indore (pickup and drop-off, with location on) would make the AI vision demo far more convincing than synthetic fixtures.
- Render account access when we are ready to deploy (target: staging in Phase 2).

## Track sections
- A. Payments and ledger: done for Phase 1; next T207 release path through Mandate Guard G3.
- B. Agents and verification: runtime + Scoping done; next T201 deterministic checks, T202 Verification Agent, T203 risk engine.
- C. Mandates and proof: crypto, mandates, attestations done; next T204 Mandate Guard, T205 Job/Payment Mandate binding, T206 attestations at every state change.
- D. Product and UI: core pages done with the "signed and sealed" design; next T208 Decision Card, Denial Card, worker proof upload.
- E. Platform and QA: e2e + CI done; next proof fixtures, J2 e2e, staging deploy.
