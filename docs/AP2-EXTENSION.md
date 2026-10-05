# SettleAI and AP2: conditional settlement for agent-hired work

> **Status of this note.** Written against the AP2 reference repository (`google-agentic-commerce/AP2`, `main`, read on 5 Oct 2026:
> `docs/ap2/agent_authorization.md`, `payment_mandate.md`, `checkout_mandate.md`, `code/sdk/python/ap2/models/mandate.py`).
> SettleAI mandates are **AP2-inspired**. They are not an AP2 implementation, not AP2-compliant, and not endorsed by Google or PayPal.

## The gap

AP2 answers *"did a human authorize this agent to pay, within these limits?"* It does this with a verifiable
chain of mandates: the user signs an **open** mandate with constraints, and the agent binds it to a specific transaction
as a **closed** mandate (a key-binding JWT signed with the key named in the open mandate's `cnf` claim). In AP2's own
words, the Payment Mandate exists "to help the network/issuer build trust into the agentic transaction."

That is authorization at the moment of payment. For **services done by people** (a delivery, a repair, a design),
paying is the start of the risk, not the end. Nothing in an authorization chain says whether the work was done, when the
money may move, or who is liable if it was not. SettleAI is a working answer to that second question, built on the same
mental model.

## Mapping

| AP2 (current repository) | SettleAI artifact | Correspondence | What SettleAI adds |
|---|---|---|---|
| Open mandate signed by the user, with constraints, bound to an agent | **Intent Mandate** (`type: "intent"`) | Same role: the user's standing authority for one agent | Service categories, per-job and total caps, jobs per day, geofence, counterparty trust floor and PayPal-email requirement, prohibited keywords, step-up threshold, max auto-release amount, **mandatory verification before release**, instant revocation |
| Closed Checkout Mandate (`vct: mandate.checkout.1`): bound to one merchant checkout (`checkout_hash`) | **Job Mandate** (`type: "job"`) | Same role: the authority narrowed to one concrete transaction | Hashes of the exact job spec, milestones and **machine-checkable acceptance criteria**; the **worker countersigns** on acceptance; any spec edit supersedes it with a new signed version |
| Payment Mandate with constraints (amount range, budget, allowed payees, execution date, recurrence) | **Payment Mandate** (`type: "payment"`) | Same role: the payment authorization tied to the transaction | Per-milestone **settlement conditions**: `verification.pass`, `risk.not_hold`, `mandate.active`, a release policy version and a challenge window. Its hash rides in the PayPal order's `custom_id` |
| Payment receipt | **Attestations + Proof Chain + receipt bundle** | Evidence that the transaction happened | Signed, hash-linked records of evidence, verification, risk decision, release, settlement, dispute, revocation and every **denial**, verifiable offline |
| (not covered) | **Liability finding** | n/a | A dispute arbiter assigns a fault class (`WORKER_PARTIAL`, `PAYER_UNSUPPORTED_CLAIM`, `AGENT_SCOPE_VIOLATION`, ...) grounded in mandate clauses, criteria and evidence ids, checked against a deterministic mandate-compliance report |

## How enforcement works

The **Mandate Guard** is deterministic code that runs after any model output and before any state change or money
movement, at four gates:

- **G1 hire:** signature, validity window, revocation, agent identity, category, prohibited terms, geofence, nonce replay,
  per-job and total caps with row-locked spend counters (a 50-way concurrent test never overspends).
- **G2 fund / accept:** lineage and validity; step-up above the threshold needs the human; the accepting worker must meet
  the counterparty rules.
- **G3 payout,** immediately before the PayPal call: the Payment Mandate verifies and covers the amount; verification
  passed and risk is not HOLD (or a person approved); the Intent Mandate is still active. Revoking a mandate during the
  challenge window pauses the payout with **no PayPal call made** (tested, scenario S30).
- **G4 dispute settlement:** release plus refund equals the disputed amount and never exceeds escrow.

Every evaluation is recorded; every denial becomes a signed attestation, so refusals are part of the proof chain.

## Format differences (honest list)

| Topic | AP2 | SettleAI today | Path to alignment |
|---|---|---|---|
| Credential format | SD-JWT verifiable credentials (`dc+sd-jwt`), `vct` types | Compact JWS (ES256) over RFC 8785 canonical JSON, in an envelope `{payload, payloadHash, signatures[]}` | Issue the Intent Mandate as an SD-JWT VC with a SettleAI `vct` (e.g. `mandate.settleai.intent.1`) |
| Selective disclosure | Yes (`_sd`, disclosures) | No; receipts avoid personal data instead (opaque ids, city-level geofence) | Make the geofence and counterparty claims selectively disclosable |
| Agent binding | `cnf` key in the open mandate; agent signs a key-binding JWT | Agent identified by `agent.clientId`; its key is registered server-side and signs the Job Mandate | Put the agent's public key in `cnf`; sign the Job Mandate as a KB-JWT |
| User signing surface | Trusted Surface, OpenID4VP presentation | In-browser WebCrypto key (non-extractable, IndexedDB) or a clearly labelled demo key held by SettleAI | Passkeys / OpenID4VP wallet |
| Payment rails | Network/issuer-facing Payment Mandate | PayPal Orders v2 capture to the platform, PayPal Payouts on release, PayPal refunds on disputes; mandate hash bound into `custom_id` | Unchanged; PayPal does not consume SettleAI mandates natively, SettleAI enforces them on its own side |

## Limits

- Everything runs on the PayPal sandbox (or a mock) with test money; there is no native PayPal escrow here, only a
  ledgered hold (capture, then Payouts).
- Managed demo keys exist so judges can try the flow from any device; production would use passkeys or a KMS/HSM.
- The compliance report and verifier check what SettleAI recorded. A live PayPal cross-check is a separate
  reconciliation step (`pnpm reconcile`), not part of the offline receipt check.
- Holding customer funds in production needs licensing or a regulated partner and a third-party security review.
