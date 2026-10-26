# Security Policy & STRIDE Threat Model

## 1. Overview & Security Posture
SettleAI is an autonomous escrow, verification, and disbursement infrastructure for agent-driven commerce. It guarantees financial safety by strictly isolating untrusted AI agents from funds, enforcing double-entry ledger conservation, mandating cryptographic proof-of-work attestations, and enforcing challenge windows before automated PayPal payouts.

---

## 2. Protected Assets & Trust Boundaries

| Asset | Sensitivity | Protection Mechanism |
|---|---|---|
| **Escrow Funds** | Critical | Isolated ledger; PayPal sandbox/live integration with two-phase commit; debit=credit conservation. |
| **Payer/Agent Mandates** | High | Ed25519 canonical signed envelopes (`canonicalize`), spend limits, nonce replay guards. |
| **Dispute & Evidence Photos** | High | Metadata extraction (EXIF), perceptual hash (`sharp` 50MP cap, decompression-bomb defense), S3 signed URLs. |
| **Audit Log Chain** | High | SHA-256 hash-chained immutable event stream with serialised concurrency. |
| **API Keys & Secrets** | Critical | Key peppers (`API_KEY_PEPPER`), session secrets, non-root execution, zero secrets in git. |

---

## 3. STRIDE Threat Model Mapped to Test Suites

| STRIDE Threat | Description & Attack Vector | Defense Mechanism | Test Verification |
|---|---|---|---|
| **Spoofing** | Attacker impersonates an authorized Agent or Payer to submit false proofs or authorize jobs. | Ed25519 signature checks on mandate envelopes; Bearer token authentication with SHA-256 peppered hashing. | `tests/unit/crypto.test.ts`<br>`tests/security/authz-matrix.test.ts` |
| **Tampering** | Rogue worker or attacker modifies milestone payment amount or evidence metadata in transit. | Cryptographic attestation receipts (`S25`); any single-byte payload change invalidates verification hash. | `tests/unit/receipts.test.ts` (`S25 tamper detection`) |
| **Repudiation** | Payer disputes an authorized release after completion, claiming the agent had no budget authority. | Cryptographic mandate audit log with strict sequence IDs; irreversible signed commitments. | `tests/unit/audit.test.ts`<br>`tests/unit/mandates.test.ts` |
| **Information Disclosure** | Unauthorized user accesses disputes, sensitive images, or ledger state of another tenant. | Strict RBAC authorization matrix covering all 239 routes; image payload downscaling before LLM context. | `tests/security/authz-matrix.test.ts`<br>`tests/security/limits-and-headers.test.ts` |
| **Denial of Service** | Decompression bombs (giant images), webhook storms, or excessive API hammering. | 50 MP / 12 MB sharp limits; token-bucket sliding window rate limiting; 50-client webhook idempotency locks. | `tests/security/limits-and-headers.test.ts`<br>`tests/unit/drills.test.ts` |
| **Elevation of Privilege** | Autonomous MCP Agent attempts to directly disburse funds or bypass the Mandate Guard. | Tool permission boundaries; MCP server exposes only job creation and proof query tools—funds are unreachable by agent. | `tests/unit/mcp.test.ts`<br>`tests/security/authz-matrix.test.ts` |

---

## 4. MCP Agent Tool Boundaries
Under no circumstances may an LLM agent invoke financial release or refund endpoints. MCP agents only interact through:
1. `create_hire_request` (evaluated through Mandate Guard G1)
2. `get_hire_status`
3. `list_hire_proofs`

All payouts require:
- Mandate verification (G1)
- Autonomous verification or human review (G2)
- Challenge window expiry (G3)
- Signed release authorization to the payment adapter

---

## 5. Vulnerability Reporting
If you identify a security issue, please do NOT file a public issue. Report details to `security@settleai.dev`. All validated vulnerabilities are addressed with highest priority.
