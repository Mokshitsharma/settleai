# SettleAI status

Phase plan: docs/SPEC.md §19. Feature freeze 8 Nov 2026; submit by 11 Nov 2026.

## Official rules check (2026-10-03): overrides the spec where they differ

- **Deadline: 12 Nov 2026, 12:00 pm PT** = 20:00 UTC = 01:30 IST on 13 Nov. Target remains submit by 11 Nov.
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

## Phase 4: Proof of quality (27 Oct to 2 Nov): DONE 2026-10-05

1. T401 AG Grid admin console: overview KPIs, daily funding chart split person vs agent (validated palette), jobs, review queue, disputes, ledger with invariant and PayPal-match badges, mandate checks with agent suspend/re-enable, AI runs; search, filters, CSV export.
2. T402 Evaluation harness (`pnpm eval`): 28/28 Appendix B scenarios pass, 2 skipped (file-upload proofs not built). False-release 0%, mandate false-allow 0%, tamper detection 100% (49/49), injection detection 100%, arbiter invariant violations 0. Report at /admin/eval.
3. T403 Versioned risk policy editor with diffs and audit; the next decision uses the new version (tested).
4. T404 WCAG AA pass (axe-core on 8 pages, tokens darkened to 5.1:1), phone-sized checks (no horizontal scroll), not-found and error pages.
5. T406 docs/AP2-EXTENSION.md, written against the current AP2 repository (open/closed mandates, SD-JWT VCs).
6. Seeded two weeks of history through the real services; every seeded receipt verifies.

### Phase 4 deviations and fixes
- **Fix:** row timestamps came from the database clock; now from the app ClockPort via a time source (spec: server ClockPort only).
- **Fix:** mock PayPal ids collided across processes; now tagged per process.
- AG Grid Community only (no Enterprise row grouping); AG Studio not used.
- T405 P2 items (Elastic precedents, Invoicing, APIMatic SDK, Postman) not built. APIMatic/Postman remain options for a sponsor prize, but only one sponsor prize can be won and AG Grid is the target.

## Phase 5: Hardening (3 to 6 Nov): IN PROGRESS 2026-10-05

1. T501 Security review: docs/SECURITY-REVIEW.md. Fixed: mock webhooks accepted over HTTP, no rate limiting, default session secret on deployments, 500 on non-image dispute photo. `pnpm audit` clean; no secrets in git history.
2. T502 Failure drills (`drills.test.ts`): webhook storm, PayPal payout outage and retry, LLM network outage, database restart with a pending challenge window. All pass.
3. T503 Performance: verification pipeline averages ~80 ms on the offline stub; live-model latency to be measured once an xAI key is available. Images are downscaled to 1024 px for the model; agent calls cap tokens (2048).
4. T504 Deploy: **blocked** on Render access (render.yaml ready).

### Open items / needs from owner
- **PayPal sandbox Client ID + Secret** (biggest remaining risk: Stage One requires real PayPal sandbox integration).
- **`XAI_API_KEY`** in `.env.local` to test live Scoping, Verification, Arbiter and ProcureBot live mode, and measure latency.
- **Render account access** for the deployment (T504).
- Real delivery photos taken in Indore (pickup, drop-off, damaged goods) for the demo video.

## Judge-review fixes (7 Nov 2026)
- Source: docs/JUDGE_REVIEW.md items 1, 2, 4, 5, 7, 10 plus impact figures. No new features; the video is untouched (re-recorded Tuesday).
- AG Grid: flex columns get a minimum width, tighter cell padding, compact dates with a full-date tooltip; the review queue fits without clipping. Screenshots 2 (cropped) and 5 retaken locally.
- Dispute reachability: live demo challenge window raised to 10 minutes (render.yaml `CHALLENGE_WINDOW_SECONDS=600`; set it in the Render dashboard too). Chosen over a seeded dispute-ready job because it needs no fake verified proof.
- Wording: "Held by PayPal for this job" replaces "Held in escrow" in the UI; liability card shows a plain-English clause with raw IDs under Details; model IDs moved to a header tooltip.
- Docs: Devpost image contradiction fixed, sourced impact figures, "Why the agent never holds the PayPal write tools", AG Grid feature list; README hero image and one evidence table. Screenshot 4 retake waits for the post-deploy recorder run.

## Final judge pass (9 Nov 2026)
- Phase 0: JUDGE_REVIEW items 1, 2, 7, 9, 10 were done in d830f62 but **not deployed** (Render deploys `main`; the live site still served the old grid, "held in escrow" and raw model ids). Items 3 (warm), 4 (dispute reach), 5, 6 (video, voice) and 8 (residual wording) remained.
- Decision (item 7): keep the 10-minute live challenge window, not a seeded dispute-ready job. Seeded history is funded with mock PayPal ids, so a dispute's refund on the live sandbox would fail; a reachable real path beats a fake one. Instructions now say: fund in the sandbox, accept, wait one minute (proof under a minute is flagged TOO_FAST, threshold unchanged), dispute within 10 minutes. The proof form says so too.
- Decision (Guard): `guard.ts` denial messages still say "Funds stay in escrow" because the Guard is out of scope for this pass; every other UI string says the money is held by PayPal for the job. The admin KPI is "Funded through PayPal, all time" (e2e locator text updated to match, same assertion).
- Impact pack: interview section and guide removed (no interviews were run); NYC figure stated as "nearly three in four" because the source gives both 73% and 74%.
- Video: new 11-beat script (cold open on the denial, four moments with zoom holds, sandbox evidence beat, end on product); Kokoro-82M (Apache-2.0) voice replaces Piper LJ Speech; `voiceover.txt` exported.
- Keep-warm: cron-job.org pings /api/health every 10 minutes until 16 Dec (set up by the owner, confirmed 10 Nov).
- Phases 3-5 (10 Nov): live recording (real sandbox and models), five screenshots retaken (2 and 4 centred on 1920x1080), video rebuilt at 2:42 with Kokoro voice, contact sheets reviewed; evidence beat uses the showcase receipt because a fresh job's payout was not yet confirmed when filmed. Re-judged in docs/JUDGE_REVIEW_2.md: 8.1/10 (was 7.6).

## Track sections
- A. Payments and ledger: done in MOCK; next a LIVE sandbox run of the PayPal adapter and JS SDK v6 buttons (needs credentials).
- B. Agents and verification: done on the stub; next live-model runs and `EVAL_LIVE=1 pnpm eval`.
- C. Mandates and proof: done.
- D. Product and UI: done; final polish after live data.
- E. Platform and QA: 132 unit/integration + 10 e2e; next deploy, README and video (Phase 6).
