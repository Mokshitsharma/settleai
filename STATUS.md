# SettleAI hackathon status

**Cutoff (confirmed by owner): 12 Nov 2026, 12:00 PM PT = 13 Nov, 1:30 AM IST.** Target: submit 11 Nov IST.
**Requirement:** the live demo must stay up and free through 15 Dec 2026 (judging period).

Audited 6 Nov 2026 on `hardening-gaps` (30e6574) plus 17 uncommitted changes from the security session. Spec on disk is
v2.0, not v2.1; the build plan is §19. History and deviations remain in `docs/STATUS.md`.

## Results

| Check | Result |
|---|---|
| `pnpm test` | 443/443 passed |
| `pnpm typecheck`, `pnpm build`, `pnpm demo:smoke` | Pass |
| `pnpm lint` (run before the security session's final edits) | 0 errors, 1 warning (`k6/load-test.js`) |
| `pnpm audit --prod` (same run) | 0 known vulnerabilities |
| `pnpm e2e` (before those edits settled) | 7/10; the 3 failures passed on re-run, so slow dev compiles are the likely cause |
| `pnpm eval` | 28/28, 2 skipped (S07, S08), **offline stub only** |
| Production server memory | 313 MB after light use; Render free allows 512 MB |

Branches: `main` 213c106 (pushed). `hardening/2026-10` (98c466f) has 9 unmerged commits. `hardening-gaps` has those plus 2.

## Status by task

| Task | Status | Evidence |
|---|---|---|
| T001 scaffold, CI | DONE | Checks above; `.github/workflows/ci.yml` (CI run itself not checked) |
| T002 ports, mocks, badge | DONE | `src/core/container.ts`, `src/components/mode-badge.tsx` |
| T003 schema, migrations | DONE | `tests/db/migrations.test.ts` |
| T004 contracts | DONE | `tests/unit/contracts.test.ts` |
| T005 ledger, audit chain | DONE | `tests/property/money-properties.test.ts`, smoke "ledger invariants hold" |
| T006 docs | PARTIAL | Exists; `docs/paypal-notes.md` is stale on pending items |
| T101 live orders, webhooks | PARTIAL | Create and capture verified live (see live flow); webhook delivery awaits a public URL |
| T102 payouts, refunds | DONE | Live flow: payout SUCCESS, refund COMPLETED |
| T111 agent runtime | DONE | `tests/unit/agents.test.ts`, S18 |
| T112 Scoping | PARTIAL | Stub passes; live blocked by LLM key |
| T121 crypto | DONE | `tests/unit/crypto.test.ts`, `canonical.test.ts` |
| T122 mandate service | DONE | `tests/unit/mandates.test.ts`, 50-way cap race |
| T131 auth, funding UI | PARTIAL | Works in mock; LIVE is a link plus "I approved it", no JS SDK, no return URL |
| T132 mandate UI | DONE | e2e sign and revoke |
| T141 seed, fixtures, deploy | PARTIAL | Seed works; no deploy found; proofs are generated samples |
| T201 deterministic checks | DONE | `tests/unit/checks.test.ts` |
| T202 Verification Agent | PARTIAL | Stub only. Unknown whether a live vision model passes generated sample photos |
| T203 risk engine | DONE | `tests/unit/risk.test.ts` |
| T204 Guard G1-G3 | PARTIAL | All codes implemented; 5 not named in any test (below) |
| T205 mandate lineage | DONE | J1 smoke; custom_id binding on the real order path |
| T206 attestations | DONE | Smoke "proof chains verify" |
| T207 revocation pause | DONE | S23, S30 |
| T208 UI components | DONE | e2e |
| T209, T307 e2e journeys | PARTIAL | All 10 passed across runs; 3 flaky on first compile |
| T301 disputes, Arbiter | PARTIAL | J3 passes; finding cites criteria and evidence, **not a mandate clause** |
| T302 reputation, Concierge | PARTIAL | Reputation done; **Concierge missing** (grep finds no agent) |
| T303 MCP, ProcureBot | PARTIAL | `tests/unit/mcp.test.ts` passes; live mode needs xAI only, which has no key |
| T304 verifier, receipts | DONE | `tests/unit/receipts.test.ts`, e2e J7, S25 49/49 |
| T305 reconciliation | DONE (mock) | `tests/unit/reconciliation.test.ts`; not run live |
| T306 dispute, chain UI | DONE | e2e J3, J7 |
| T401 AG Grid | DONE | 6 admin grid pages, CSV export; Community only, no AG Studio; `/jobs` grid unconfirmed |
| T402 eval | PARTIAL | Stub only; S07, S08 not built; `EVAL_LIVE` never recorded |
| T403 policy editor | DONE | `tests/e2e/admin.spec.ts` |
| T404 design, a11y | PARTIAL | axe and phone e2e pass; screens not reviewed by eye; default Next assets in `public/` |
| T405 P2 items | MISSING | No Invoicing, Elastic, APIMatic, Postman |
| T406 AP2 write-up | DONE | `docs/AP2-EXTENSION.md` |
| T501 security review | PARTIAL | `docs/SECURITY-REVIEW.md`; new key decision open |
| T502 failure drills | DONE | `tests/unit/drills.test.ts` |
| T503 performance | PARTIAL | 65 ms is stub latency; no live number |
| T504 deploy | MISSING | No live URL found |
| T601-T605 ship | MISSING | README partial; no video or Devpost text |

## Explicit checks

| Area | Status | Evidence |
|---|---|---|
| Orders create | DONE (real) | Real sandbox order through the app, 6 Nov |
| Orders capture | DONE (real) | Live flow, capture COMPLETED |
| Payouts | DONE (real) | Live flow, SUCCESS, on the US sandbox business account |
| Refunds | DONE (real) | Live flow, COMPLETED |
| Webhook verification | PARTIAL | Code calls PayPal's verify API. List is empty, `PAYPAL_WEBHOOK_ID` unset, unsigned POST gets 500 |
| Invoicing, Agent Toolkit | MISSING | Not in code or `package.json`; app token has the invoicing scope |
| LLM | DONE (real) | `pnpm ai:check`; Scoping, Verification and Arbiter on real models |
| Contract tests | Not real | `tests/fixtures/paypal` is hand-written, not recorded |
| Mandates | PARTIAL | Signing, G1-G4, revocation work. Guard is agent-job only at G1 (direct jobs skip by design) |
| Reason codes without a named test | Gap | `NOT_YET_VALID`, `CHAIN_INVALID`, `COUNTERPARTY_REJECTED`, `STEP_UP_REQUIRED`, `RELEASE_CONDITION_UNMET` (S28 covers step-up via result) |
| Verification | PARTIAL | GPS, EXIF, duplicate hash real; LLM verdict stub only |
| Offline verifier, tamper test | DONE | CLI, `/verify`, e2e J7 |
| PAYPAL docs recheck | PARTIAL | Payouts paths and webhook names confirmed today. Item status enum and Toolkit docs could not be read |
| Spec event name | Note | v2 lists `PAYMENT.CAPTURE.DECLINED`; handler accepts both. `CAPTURE.REFUNDED` and payout batch events are ignored |

## The 4 demo moments

| Moment | Mock | Live |
|---|---|---|
| 1. Out-of-mandate denied | ✅ smoke J6, e2e | Should work (no PayPal call); ProcureBot live needs a key |
| 2. Reused photo held | ✅ smoke J2, e2e | Duplicate check is deterministic; payment path blocked |
| 3. Liability cites the mandate | ⚠️ cites criteria and evidence only | ❌ LLM and payout blocked |
| 4. Offline verify, one-byte tamper | ✅ smoke J7, e2e | Should work |

## Submission checklist

- ❌ Live URL on Render
- ❌ Zero-setup demo logins, live (✅ locally; not deployed)
- ✅ MOCK/LIVE badge (note: shows the model name even when its key is invalid)
- ❌ Public GitHub repo (private)
- ✅ MIT LICENSE
- ❌ README complete: has setup, diagram, PayPal, AI and honesty note; **quick start now needs a key**, "142 tests" is stale, cites nonexistent `tests/failure_drills/`, says eval without saying stub, no live URL or sandbox buyer login
- ❌ Demo video under 3 minutes on YouTube
- ❌ Devpost write-up
- ❌ Impact evidence pack

## Judging criteria (my estimate, out of 5)

| Criterion | Today | Weakest point |
|---|---|---|
| Technological Implementation | 3 | Core money path is not proven on the sandbox |
| Design | 3 | Coherent and accessible; not reviewed by eye; Concierge absent |
| Potential Impact | 2 | No evidence pack |
| Innovation | 4 | Strong idea; live agent not shown |
| Presentation | 1 | **Weakest:** no video, URL or write-up |

## Sponsor prize

**AG Grid.** Six grid views already exist, and PayPal's blog lists it as the largest sponsor prize ($5,000 first). APIMatic's
prize centres on its Context Plugin, which is not used. Risk: the blog pitches AG Studio and we use Community only.
Prize-stacking limit comes from `docs/STATUS.md`; confirm on Devpost.

# Plan

## MUST

1. **You:** US sandbox business account, sandbox buyer and worker accounts, new app credentials.
2. **You:** a working LLM key (Groq, free).
3. Decide zero-key handling for the demo key (see Decisions).
4. Worker PayPal email configurable, so payouts reach a sandbox account (seed uses `example.com`).
5. Fix LIVE checkout: return URL or JS SDK buttons. Run fund, capture, webhook, payout, refund on sandbox.
6. Deploy to Render, register webhook, run live smoke from a clean browser and phone.
7. Live LLM run of Scoping, Verification and Arbiter; fix sample-photo verdicts if they fail.
8. Demo moment 3: liability basis cites the mandate clause (real logic, no hardcoding).
9. ProcureBot live on Groq, with scripted fallback.
10. README fixes, including live URL, sandbox login and stub disclosure.
11. Video script (beat by beat, under 2:50), recording, YouTube upload.
12. Devpost draft, impact evidence pack, screenshots.
13. **You:** make the repo public, submit.

## SHOULD

- Concierge, read tools only plus confirm cards (P1; you named it in the audit)
- Invoicing through the Agent Toolkit (strengthens PayPal + AI)
- `EVAL_LIVE=1` run, reported separately from stub numbers
- Tests naming the 5 uncovered reason codes
- Handle refund and batch webhooks; recorded sandbox fixtures
- Visual polish pass; replace default assets
- Fix e2e first-compile flakiness

## CUT (proposed; nothing is cut until you approve)

- S07, S08 document proofs (disclosed in README)
- JS SDK v6, if a return URL gives a stable checkout
- AG Studio, APIMatic, Elastic, A2A card, claim flow, notifications, currency display
- k6 load test, Terraform apply
- Always-on hosting and external storage (free plan resets data on restart; say so in the README)

## Days (IST)

| Date | Work |
|---|---|
| 6 Nov | Audit done. You: items 1-2 and decisions |
| 7 Nov | `hackathon/final`: items 3-5, live money path on sandbox |
| 8 Nov | Items 6-9. Feature freeze at night (spec) |
| 9 Nov | SHOULD items that are safe; item 10; video script and Devpost draft; evidence pack |
| 10 Nov | Bug fixes only. **Full demo rehearsal.** Record video |
| 11 Nov | Final smoke, upload, public repo, **submit**. Buffer: 12 Nov |

## Decisions needed

1. Demo key: generate a random key at seed when unset (keeps zero-key, no published key; recommended), or keep requiring it.
2. Approve the CUT list.
3. Which branch to build from: `hardening-gaps` plus the security session's uncommitted changes (recommended).
4. Free Render (cold start and data reset; recommended by your free-only rule) vs anything paid.

# Session log

## 6 Nov 2026

- **Committed:** security changes as `08ca596` on `hardening-gaps` (443/443), then `hackathon/final` from it.
- **Fixed:** random demo key at seed; Arbiter findings cite a real mandate clause, criteria and evidence; PayPal breaker tripped by seeded payout lookups, the real cause of the flaky J1 (e2e 10/10, three consecutive runs, now on a production build); LIVE checkout return and auto-capture; polling safety net for missed webhooks; stub banner; wake-up notice; reseed on boot; `.env.example` names only.
- **Secret scan:** gitleaks 8.28.0, full history, 30 commits, 0 findings. `.env` and `.env.local` are ignored and were never committed. History still holds the removed demo key and old local compose values (not production credentials).
- **Real AI (`pnpm ai:check`):** Scoping and the Arbiter work on `openai/gpt-oss-120b`, Verification calls `qwen/qwen3.8-27b`. Groq's free tier allows 8,000 tokens a minute per model; a 429 waits for retry-after, then falls back to a person.
- **Blocked:** payouts return 403 `PAYOUT_NOT_AVAILABLE` on `APP-1J968271LM1368825`, the old India app; the new app's credentials are not in `.env.local`.
- **Blocked:** generated sample photos do not pass the real model, which reads them as graphics. The auto-release path needs real photos.
- **Requirement:** the live demo must stay up and free through 15 Dec 2026.

## 6 Nov 2026, later

- **`pnpm live:flow` not run:** `.env.local` still holds `APP-1J968271LM1368825` (old app) and no `SANDBOX_BUYER_PASSWORD`. PayPal evidence: order, capture, payout batch and refund ids pending.
- **Groq:** one real call each to `qwen/qwen3.8-27b` and `openai/gpt-oss-120b` returned 200. The key in `.env.local` is still the one pasted in chat, so it is not rotated yet.
- **ProcureBot live:** ran on `openai/gpt-oss-20b` through MCP against a local server; out-of-scope hires denied, in-scope job created.
- **Render:** `render.yaml` provisions one free web service and no database; the demo uses embedded PGlite, so Render's 30-day free Postgres expiry does not apply. Boot restores a build-time template (about 6 s here). Wake time on 0.1 CPU to be measured after deploy.
- **Photos:** `demo-photos/` (git-ignored) and `pnpm photos:prepare` are ready; names must start with pickup, dropoff or damage.
- **Drafts:** `docs/video/SCRIPT.md`, `docs/DEVPOST.md`.

## 6 Nov 2026, 23:30

- **New PayPal app confirmed:** `APP-7AG6617399957750C`.
- **Payout 403 cleared:** direct $1 sandbox payout returned 201, batch `VNCSGP8CUS53S` (a probe, not the full flow).
- **`pnpm live:flow` not run:** `SANDBOX_BUYER_PASSWORD` is empty in `.env.local`. Order, capture, payout and refund evidence pending.
- **Groq key not rotated in `.env.local`:** its SHA-256 still matches the key pasted in chat, and that key still answers.
- **Done:** funding records `confirmedVia` (webhook or poll) with tests both ways; per-key, per-caller and daily model budgets plus a global daily cap; classifier handles "move" and plurals, and service words win.

## 6 Nov 2026, 23:30: live PayPal sandbox flow PASSED

`pnpm live:flow` on app `APP-7AG6617399957750C`, run at 2026-11-06T17:59:07Z. Each id below was read back from PayPal afterwards. Full record: `docs/live-evidence.json`.

| Step | PayPal id | Result |
|---|---|---|
| Order (buyer approved in the sandbox checkout) | `92519580C8449544Y` | $102.00 |
| Capture | `5MN932607D407762A` | COMPLETED at capture; PayPal now reports PARTIALLY_REFUNDED after the refund |
| Payout batch / item (dispute share to worker) | `PLC3LNKRSJPHS` / `Z75WDLUTTSDMN` | SUCCESS, $28.00 |
| Refund (dispute share plus fee to payer) | `0MB22901981041614` | COMPLETED, $12.24 |

Earlier probe: batch `VNCSGP8CUS53S`, item `UTMBHJ9JNRFJN`, final status SUCCESS, $1.00, transaction `71479612EW818183A`.

The order and capture both carry `custom_id` `smd_EX21P43VRR_3eafbb35fce231e5`, the Payment Mandate binding. PayPal's fee left a net of $97.95 on the capture; the ledger does not record PayPal's fees (the optional `PAYPAL_FEES` account), so its balance runs above the real sandbox balance by that fee.

Limits of this run: the AI steps used the labelled stub, because it tests PayPal (`pnpm ai:check` tests the AI). Funding and payout were confirmed by polling PayPal; no webhook is registered until there is a public URL, so webhook delivery and signature checks are still unproven live.

Groq: the pasted key returns 401 (revoked); the new key differs by hash and works on both models.

## 7 Nov 2026: Render out-of-memory fix

Cause: V8's optimizing WASM compiler during PGlite startup, on top of pnpm, corepack and tsx at runtime.
Fix: standalone server started with plain node and `--liftoff-only`; compiled boot script; `exifr` external (also ends the "Couldn't load fs/zlib" lines); sharp cache off, concurrency 1.

Peak RSS on Windows with a 512 MB job-object limit. No Docker or WSL on this machine, so this is not the requested Linux container test.

| Phase | Before | After |
|---|---|---|
| Boot and restore | 782 MB | 257 MB |
| Server idle | 295 MB (833 MB startup peak) | 294 MB (313 MB startup peak) |
| Full flow: real Scoping and Verification, 12 MP upload, admin pages | 375 MB (833 MB peak) | 357 MB (381 MB peak) |

Not yet covered: the Arbiter on the real model through this server (needs real photos), and any Linux measurement. `/api/health` now reports `memoryMb`, the real test on Render.

## 7 Nov 2026: live on Render, fees in the ledger

- **Render, real instance:** boot peak 272 MB, running 347 MB (512 MB limit), after a real Scoping call and a real order. Full-flow peak there still to be measured.
- **Webhook:** `6NN14642KV692410V` registered for the deployed URL. Delivery and signature checks still to be tested.
- **PayPal fees:** capture, payout item and returned refund fees are now ledger entries. Second live run: ledger PayPal balance $57.46, PayPal's own figures $57.46, match. `/v1/reporting/balances` returns 403 for this app, so the check uses PayPal's per-transaction figures, not the account balance.

| Step | PayPal id | Result |
|---|---|---|
| Order | `4G283250RL9728624` | $102.00 |
| Capture | `2CX57095YV3744058` | COMPLETED, fee $4.05 |
| Payout batch / item | `AL89VSYKMY5DE` / `UJP754LS4GNJN` | SUCCEEDED, $28.00, fee $0.25 |
| Refund | `2GS3988820212835P` | COMPLETED, $12.24, no fee returned |

- **Signing key:** `key_mAY01ASyQW6Rs5thTXH27L_G`. Private key in `.secrets/` (git-ignored), public key published in the README.
- **Economics note:** PayPal's fee on a $102 capture ($4.05) is about twice the $2.00 platform fee, and a refund does not return it. A real product would need to price this in.

## Reconciliation limit

Per-transaction figures match exactly: the ledger's PayPal balance equals PayPal's reported capture, fee, payout and refund amounts (live flow: $57.46 both). The account balance itself can't be read: `/v1/reporting/balances` returns 403 `NOT_AUTHORIZED` for this app.

## 7 Nov 2026: fee model and post-deploy checks

- **Fee model:** payer pays the work, PayPal's costs at cost, and a 2% margin. Fee for a $100.00 job with 2 payouts: $6.72 ($4.72 processing, $2.00 margin). The processing part is not refundable, because PayPal keeps its fee on a refund. Mock mode has no PayPal costs and keeps the plain 2%.
- **Live proof:** order `39046161HY1431018` $106.72, capture `5LC81630BG623970F` fee $4.21 (3.49% + $0.49 predicts $4.21), payout batch `YLKA7AD5ZJJ78` fee $0.25, refund `5DR979248V917034Y` $12.24. Ledger PayPal balance $62.02 equals PayPal's figures. This run stops with milestone 2 still in escrow; finished, the job keeps about $2.01.
- **Wake-up:** 74.4 s after 17 idle minutes (one sample; wording now ~75s).
- **Deployed flow:** real AI, sandbox checkout, admin approval and payout through the live site. Peak RSS 390 MB of 512 MB. Unsigned webhook: 400. Receipt verified against the published key.
- **Webhook delivery:** PayPal generated the events; server-side receipt not yet shown, so `/api/health` now reports verified events. Check after the next deploy.
- **Flaky `audit.test.ts`:** one failure, cause not found. Not reproduced in 30 runs alone, 5 full-suite runs, or a full run each under memory pressure (1.1 GB free) and CPU starvation (8 spinning threads). Test results now persist in `.data/last-test-results.json`, so a repeat leaves its error. No assertion changed.
- **11 Nov, before making the repo public:** re-run gitleaks over the full git history.

## 7 Nov 2026: showcase receipt

- **Permanent receipt:** `/receipt/showcase` and `/api/receipts/showcase` serve `assets/showcase/receipt.json`, the frozen signed record of one real job. Frozen rather than recreated at boot: ES256 signatures are randomized, and re-running would need PayPal ids for payments that never happened.
- **Interim version (no real photos yet):** job `job_01M6TB47DAMERFAP7RWPSSAMD6`, COMPLETED. Order `0UK22737FP450481C`, capture `4S025822MT775383E`, payout batches `GRANS43HHT8WQ` and `F7N48A3YCQL3U`, both SUCCEEDED, no dispute. Models: `qwen/qwen3.8-27b`, `openai/gpt-oss-120b`. Milestone 1 AUTO_RELEASE; milestone 2 HUMAN_REVIEW, then approved by a person. To be replaced with `pnpm showcase:make` once real photos are in, for the dispute and Arbiter path.
- **Fee model proven on a finished job:** fee $6.72, PayPal charged $4.71, $2.01 kept.
- **Correction:** generated sample images are not always refused by the real model. Milestone 1 auto-released on one at 95%, with a text confirmation and location. Verdicts vary between runs.

## 7 Nov 2026: post-deploy checks on 5116cf2

- **Webhook delivery and signatures proven live:** verified events rose 42 to 46 during one live flow: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED, PAYMENT.PAYOUTS-ITEM.SUCCEEDED, PAYMENT.PAYOUTSBATCH.SUCCESS. That baseline included seeded mock events; the count now excludes them. Unsigned POST: 400.
- **Webhook-first not seen live:** PayPal emitted the capture event about 20 s after capture, so the status check confirmed funding at about 31 s and the webhook arrived as a harmless duplicate. Webhook-first is covered by unit tests only.
- **Full flow:** order `5MN58212YH506970K`, capture `0MV37703H8255825X`; peak RSS 401 MB of 512 MB; receipt verified against the published key.
- **Fix:** demo mandates are reissued hourly while the server runs. Otherwise an uptime ping would let them expire during judging.

## 7 Nov 2026: restart check, wake-up, secret scan

- **Showcase restart check:** identical SHA-256 before and after a sleep and wake (`a5eb30bb2ff18a93...`), same as the committed file; verifies against the published key; page returns 200.
- **Wake-up:** 74.4 s and 72.5 s after 17 idle minutes. Wording stays ~75s.
- **gitleaks:** 21 `jwt` findings in `assets/showcase/receipt.json`, all public ES256 signatures, checked by decoding each. `.gitleaks.toml` allows only that rule on only that file. A control confirmed the same token is still caught in other files and API keys are still caught everywhere.

## 7 Nov 2026: owner decisions, polish, impact pack

- **CUT (roadmap):** Concierge agent (F17), and tests that name `MANDATE_NOT_YET_VALID`, `MANDATE_CHAIN_INVALID`, `MANDATE_COUNTERPARTY_REJECTED`, `STEP_UP_REQUIRED` and `RELEASE_CONDITION_UNMET` directly. The codes exist and are enforced; only the named tests are missing.
- **Invoicing through the Agent Toolkit:** only if polish and the impact pack are done before 9 Nov night and the gate passes.
- **Visual polish (no behaviour change):** liability finding as a callout with the cited clause; failing receipt checks highlighted, with a count; larger evidence thumbnails; "Four things to try" on the landing page.
- **Impact pack:** `docs/impact/` with sourced statistics, a conversation guide and a template. Real conversations pending (owner); no quotes or numbers invented.
- **Screenshots:** after the real photos.

## 7 Nov 2026: demo images and real-AI happy path

- **Images:** illustrative demo images, AI-generated. Pickups and dropoff-1 at 1536 x 1024; damage-1 and damage-2 at 1024 x 687, right edge trimmed to 900 px to remove a visible Gemini watermark (owner's decision; disclosed in README and DEVPOST). dropoff-2 left out: a perceptual near-duplicate of dropoff-1 (distance 1). One drop-off image is enough: 0 of 66 variant pairs fall within the duplicate threshold.
- **Fixes (owner-approved):** scoping rule B (a photo criterion may not go to a person where the template uses AI vision); the Verification agent now sees the job title and summary, as delimited untrusted data; demo requests say "2 cartons", matching the images; real 2-minute waits before proofs, no backdated timestamps; drop-off proof text "Received by Ravi at the front door".
- **Real-AI happy path passed:** milestone 1 AUTO_RELEASE 0.95; milestone 2 AUTO_RELEASE 0.95 with no risk signals; both released. Damage dispute: Arbiter (Qwen, with the damage image) WORKER_PARTIAL 50/50 at 0.85, citing the Payment Mandate clause, criteria and evidence.

# After submission

Requirement: the demo stays live and free through 15 Dec 2026.

- [ ] Set up a free uptime ping every 10 minutes for 1 to 15 Dec.
- [ ] Redeploy once around 30 Nov, so the demo history is fresh.
