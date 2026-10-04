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

## Phase 2: Intelligence and enforcement (13–19 Oct): DONE 2026-10-03

1. T201/T202 Deterministic checks (dHash duplicates, EXIF time + GPS, MIME sniffing, geo radius incl. per-criterion pickup location, timing, injection scan incl. EXIF text); Verification Agent with delimited data and a deterministic merge where rules and critical flags always win.
2. T203 Versioned risk engine (all §8.5 signals, Appendix B scenarios S01-S11 tested), Decision Card, plain-English explanations, risk-scaled challenge windows.
3. T204/T205/T206 Mandate Guard G1/G2/G3 with every reason code, step-up, recorded checks and attested denials; signed Job Mandates (spec hashes, worker countersignature, re-signed on edit) and Payment Mandates bound to PayPal custom_id; attestations at every state change.
4. T207 Challenge-window timer, admin approve/reject (attested overrides, fraud lowers trust), revocation pauses pending payouts with payer resume or refund; next milestone opens after payout; trust rises on success.
5. T208/T209 Decision Card, Denial Card, live activity with auto-refresh, mobile worker proof capture (camera, location, demo sample photos), agent request panel; e2e J1 (verify, window, payout), J2 (reused photo, hold, reject), mandate denial. 96 unit/integration + 5 e2e green; `pnpm demo:smoke` now runs J1, J2 and J6.

### Phase 2 deviations and leftovers
- **No pg-boss:** PGlite cannot host it. Background work is a DB-driven in-process timer (restart-safe because state lives in the DB) plus fire-and-forget verification. Revisit if Render runs a separate worker.
- **Perceptual hash is a 64-bit difference hash (dHash)** implemented on sharp; robust to recompression and resizing (tested). Not a security primitive.
- **Risk narrator is a deterministic template**, not an LLM: explanations are always accurate and free. An LLM narrator can be added later behind the same field.
- **Managed keys sign Job/Payment Mandates** for payers, workers and agents (KEY_MODE both). Intent Mandates can still be signed in the browser. Production would use passkeys or a KMS.
- Agent jobs: a G1 dry run happens before scoping (geofence deferred until the location is known), then the binding G1 + spend reservation + job creation run in one transaction.
- **Demo endpoints** (`/api/dev/sample-proof`, `/api/dev/agent-request`) exist so judges can exercise every path without a phone or an MCP client; all generated evidence is labelled as demo samples.
- Contract change: `AcceptanceCriterion.params.location` (where a criterion's proof must be taken, e.g. the pickup point).
- Still open from T141: 12 historical jobs for analytics (Phase 4 needs them) and the staging deploy (needs Render access).

## Phase 3: Accountability features (20–26 Oct): DONE 2026-10-04

1. T301 Disputes: open (freezes payout), evidence from both sides, deterministic mandate-compliance report, Arbiter Agent with liability (fault class, bearer, basis), invariants enforced in code (exact split, report is ground truth, injection or low confidence escalates), accept/reject, admin resolution, gate G4, PayPal payout + refund (incl. unearned fee), trust effects, agent suspension on AGENT_SCOPE_VIOLATION. S14, S15, S26 tested.
2. T303 Agent REST API (`/api/agent/*`, Bearer API key, scopes, suspension) and MCP server (`src/mcp/server.ts`, 10 tools) tested through a real MCP client; ProcureBot reference agent (scripted, and live with Grok function calling) verified end to end over stdio + HTTP.
3. T304 Receipt bundles (no personal data), pure offline verifier (CLI `pnpm verify-receipt`, `/verify` page in the browser, `POST /api/verify`), public `/receipt/[id]` page, published platform keys for pinning. S25 tamper tests: every attestation field, recomputed hashes, full re-signing by an attacker (caught by key pinning), mandate swapping (caught by anchoring/lineage).
4. T305 Reconciliation service and `pnpm reconcile`: missed webhooks repaired through the normal path, other mismatches reported; no double counting on repeated success.
5. T306/T307 Dispute UI, proof chain viewer, mandate detail page with every guard check, receipt and verify pages; e2e J3 (dispute 70/30 via UI) and J7 (browser verification + one-byte tamper). 124 unit/integration + 7 e2e green; `pnpm demo:smoke` runs J1, J2, J6, J7.

### Phase 3 deviations, fixes and leftovers
- **Bug found and fixed:** key-validity check compared DB-clock key times (ms) with second-rounded document times, so brand-new keys made genuine receipts fail. Now a documented 5-minute skew allowance (`KEY_CLOCK_SKEW_MS`), with a regression test.
- **Bug found and fixed:** the job page could miss a live update if an event landed between reading the job and snapshotting events. Events are now snapshotted first.
- Disputed payouts no longer earn the "successful release" trust bonus; dispute outcomes carry their own trust effects.
- The agent cannot fund: `confirm_job` returns an approval link; the human funds through PayPal (spec J4).
- Agents' Job Mandates are signed with the agent's managed key held by SettleAI (the MCP server authenticates with the agent's API key). Production would let the agent hold its own key.
- Receipts include full mandate payloads (opaque user ids, city-level geofence) so signatures verify; exact job coordinates are not included.
- **T302 Concierge not built** (F17, on the cut list). Reputation is done. Elastic precedents (F22) not built (no Elastic prize).
- A2A agent card (F34, P2) not built.

### Open items / needs from owner
- PayPal sandbox Client ID + Secret before Phase 5 (strongly recommended for the "Best Use of PayPal" prize and Stage One viability).
- `XAI_API_KEY` in `.env.local` to test the live Scoping, Verification and Arbiter agents and ProcureBot live mode (everything works on the offline stub meanwhile).
- Real delivery photos taken in Indore (pickup, drop-off, a damaged-goods photo for the dispute scene).
- Render account access for the staging deploy.

## Track sections
- A. Payments and ledger: reconciliation done; next LIVE sandbox run of the PayPal adapter (needs credentials), JS SDK v6 buttons.
- B. Agents and verification: verification, risk, arbiter done; next eval harness (T402) and live-model checks.
- C. Mandates and proof: guard, MCP, verifier done; next AP2 write-up (T406), policy editor (T403).
- D. Product and UI: all journey screens exist; next AG Grid dashboards (T401, sponsor prize) and the visual pass (T404).
- E. Platform and QA: J1-J3, J6, J7 e2e done; next seed history for analytics, staging deploy, CI on GitHub.
