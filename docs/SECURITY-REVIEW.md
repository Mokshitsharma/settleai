# Security review (Phase 5, T501)

Reviewed 2026-10-05 against the threat model in docs/SPEC.md §7.8 and the security table in §14. Every mitigation
below is backed by a test; the test name or scenario id is given so it can be re-run.

## Threat model

| Threat | Mitigation | Evidence |
|---|---|---|
| Forged or modified mandate | ES256 JWS over RFC 8785 canonical JSON; payload hash; key registry; lineage checks | `crypto.test.ts` (every field of a signed mandate tampered, with and without re-hashing), eval S19 |
| Replay of a mandate or job | Single-use nonces with unique constraints; `MANDATE_REPLAY` at G1 | `mandates.test.ts`, eval S24, `mcp.test.ts` |
| Agent exceeds scope (incl. prompt-injected agent) | Mandate Guard runs in the service layer after any model output; no code path around it | eval S16, S21, S22, S29; `pipeline.test.ts` |
| Race between revocation and release | Revocation pauses pending releases; G3 re-checks immediately before the PayPal call | eval S23, S30 (no payout call is made) |
| Overspending through concurrency | Spend counters updated under a row lock on the mandate | 50-way race in `mandates.test.ts`, eval S17 |
| Stolen agent API key | Keys stored as peppered SHA-256; per-key rate limit; scopes; caps, expiry, step-up; admin can suspend instantly | `mcp.test.ts` (suspended key refused), `rate-limit.test.ts` |
| Worker fraud (reused or fake proof) | Perceptual-hash duplicates, EXIF time and GPS checks, AI verification, risk engine, challenge window | eval S02 to S04, J2 e2e |
| Prompt injection in evidence | Delimited data blocks; regex scan of text and EXIF; spans neutralized before the model; forces review | eval S06, `checks.test.ts` |
| Collusion to farm trust | Trust deltas capped by policy; disputed payouts earn no success bonus | `disputes.test.ts` |
| Platform key compromise | Key ids in every signature, published key history, verifier pins platform keys | `receipts.test.ts` (attacker re-signs the whole chain and is caught) |
| Privacy leakage through receipts | Receipts carry opaque ids and city-level labels only; proof images and EXIF GPS are party-only | `receipts.test.ts` (no emails or coordinates in the bundle) |
| Clock manipulation | Enforcement uses the server ClockPort only; row timestamps come from the same clock | `time-source.ts`, all suites run on fixed clocks |
| Double payment | Claim-then-call payouts, PayPal-Request-Id, unique sender ids, idempotent ledger keys | eval S12, `money-flow.test.ts`, `drills.test.ts` |
| Webhook forgery or replay | LIVE: PayPal verify-webhook-signature; dedupe on event id; state-machine-safe handlers. MOCK: webhook URL refuses all requests | eval S13, `drills.test.ts` (50-event storm) |

## Findings in this review and fixes

1. **Webhook URL accepted mock-signed events in MOCK mode.** On a mock deployment anyone could have marked a funding
   as confirmed. Fixed: the HTTP route refuses all requests in MOCK mode (mock events are delivered internally).
2. **No rate limiting.** Fixed: token buckets per IP and per user for writes, a tighter budget for AI-backed routes
   (cost control), and per-key limits on the agent API; `429` with `Retry-After`.
3. **Default session secret on a deployment.** Sessions would have been signed with a value published in the repo.
   Fixed: deployments (production or a `DATABASE_URL`) get a random per-process secret if none is configured.
4. **Non-image dispute photo returned a 500.** Fixed: returns a 400 with a clear message.
5. **Public test key looked like a secret.** The known-answer test uses the public RFC 7515 A.3 example key; now labelled.

Earlier phases also fixed: key-validity clock skew (genuine receipts could fail), a live-page update race, mock PayPal
id collisions across processes, and database-clock timestamps.

## Checks run

- `pnpm audit --prod`: no known vulnerabilities.
- Secret scan of the working tree and the full git history: no keys, tokens or private keys committed;
  `.env*` and `.data/` (platform dev key, uploads, database) are ignored.
- WCAG 2.1 AA audit (axe-core) of 8 key pages: no serious or critical issues.

## Accepted risks (hackathon scope, stated plainly)

- **Demo login:** anyone can sign in as any demo role, including admin, by design for judges. It only controls sandbox
  or mock money. A real deployment would remove `/api/auth/demo-login`.
- **Managed demo keys** are held by SettleAI (encrypted at rest with AES-256-GCM). Production would use passkeys or a KMS/HSM.
- **In-process rate limiter and timers** assume a single instance; multiple instances need a shared store.
- **Malware scanning** of uploads is not implemented; images are re-encoded before storage, which strips embedded payloads.
- **No third-party security review** has been done. A production system holding customer funds needs one, plus licensing
  or a regulated partner.
