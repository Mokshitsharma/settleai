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
| T101 live orders, webhooks | PARTIAL | Order create works on sandbox; capture never completed; no webhook registered |
| T102 payouts, refunds | BROKEN (live) | Probe: `403 PAYOUT_NOT_AVAILABLE`; refund never run live; mock passes |
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
| Orders capture | PARTIAL | Reaches PayPal (`422 ORDER_NOT_APPROVED` when unapproved); success path never run |
| Payouts | BROKEN | `403 PAYOUT_NOT_AVAILABLE`. Notes blame the India-region account; needs a US sandbox business account |
| Refunds | PARTIAL | Code calls the real endpoint; never run live |
| Webhook verification | PARTIAL | Code calls PayPal's verify API. List is empty, `PAYPAL_WEBHOOK_ID` unset, unsigned POST gets 500 |
| Invoicing, Agent Toolkit | MISSING | Not in code or `package.json`; app token has the invoicing scope |
| LLM | BROKEN (live) | Groq key returns 401; xAI key commented out |
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
