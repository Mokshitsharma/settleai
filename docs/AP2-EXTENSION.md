# SettleAI mandates and AP2

> Stub (T006). The full write-up is task T406. Before finalizing, read the AP2 reference repository
> (google-agentic-commerce/AP2) and align field names and signing formats where practical (spec §7.1, VERIFY).

SettleAI mandates are **AP2-inspired**. They are not official AP2 and are not endorsed by PayPal or Google.

| AP2 concept | SettleAI artifact | What SettleAI adds |
|---|---|---|
| Intent Mandate | IntentMandate | Service categories, per-job and total caps, geofence, counterparty trust floor, step-up thresholds, mandatory verification before release, expiry, revocation |
| Cart Mandate | JobMandate | Hash-bound job spec with machine-checkable acceptance criteria; worker countersignature |
| Payment Mandate | PaymentMandate | Per-milestone settlement conditions, release policy version, challenge window, agent-presence flag |
| Receipts | Attestations + Proof Chain | Evidence, verification and decision attestations; offline verifier |
| (none) | Liability attribution | Fault classes grounded in mandate clauses, criteria and evidence |

## Differences from the AP2 reference format

To be completed in T406.
