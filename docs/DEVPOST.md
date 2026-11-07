# SettleAI: Devpost write-up (draft)

**Agents will hire people. SettleAI makes sure the work was done before PayPal pays, and says who is liable when it was not.**

Live demo: https://settleai-07ue.onrender.com
Code: https://github.com/Mokshitsharma/settleai (MIT)

> **Honest positioning.** SettleAI holds funds as a **ledgered hold**: money is captured to the platform's PayPal account and released by Payouts, because PayPal has no native escrow here. Its mandates are **AP2-inspired, not official AP2 and not endorsed by PayPal or Google**. Everything runs on the PayPal sandbox with test money. A production system holding customer funds would need licensing or a regulated partner.

## Inspiration

AI agents are starting to buy things for people. Signed mandates can prove a person authorized an agent to pay, but for real-world services that isn't enough. Did the courier deliver? What if the agent overspends, or a worker reuses an old photo? Today, nobody can say who is accountable. Small businesses and gig workers feel this most: they pay up front with no recourse, or they wait and argue over whether work was done.

## What it does

1. **A person signs an Intent Mandate** in plain language: what the agent may hire, spending caps, area and expiry. It can be revoked instantly.
2. **An agent hires through an MCP server.** Mandate Guard, deterministic code that no prompt can talk its way past, allows or denies each request with a reason code, before any money moves.
3. **The job is funded through PayPal** and held in a double-entry ledger, with the Payment Mandate's hash carried in the order's `custom_id`.
4. **The worker submits proof.** Rules check GPS, photo time and duplicate images first. Then a vision model judges each acceptance criterion.
5. **Policy decides:** release after a challenge window, send to a person, or hold. A reused photo is caught and held.
6. **Disputes end in a liability finding** that cites the specific mandate clause, the criteria and the evidence. Code enforces that the split adds up exactly.
7. **Every step is signed into a receipt** that anyone can verify offline. Change one byte and verification fails, pointing to the broken link.

## How we built it

**PayPal APIs**

| API | How SettleAI uses it |
|---|---|
| Orders v2 (create, capture) | Funds a job. Buyers approve in PayPal's sandbox checkout and return to the job for capture |
| Payouts v1 | Pays each milestone, only after Mandate Guard's final check immediately before the call |
| Payments v2 (capture refund) | Returns the payer's share of a dispute or cancellation, bounded by remaining escrow |
| Webhooks, with signature verification | Confirms funding and payout state, deduplicated by event id and safe for out-of-order delivery |
| Payments and Payouts lookups | A safety net that asks PayPal directly when a webhook is late or missed |

**Fees:** the payer pays the work plus PayPal's processing costs at cost plus a 2% SettleAI margin, shown separately at checkout and on the receipt, so a job never runs at a loss; the processing part isn't refunded because PayPal keeps its fee on a refund.

Sandbox evidence from a full run: order `92519580C8449544Y`, capture `5MN932607D407762A`, payout batch `PLC3LNKRSJPHS`, refund `0MB22901981041614`.

**AI on the critical path**

LLMs propose, policy decides, the ledger records, PayPal moves money. No model has a tool that moves funds.

| Agent | Model (Groq) | Where it sits |
|---|---|---|
| Scoping | `openai/gpt-oss-120b` | Turns plain words into paid milestones with checkable criteria. Never invents amounts |
| Verification | `qwen/qwen3.8-27b` (vision) | Judges each criterion from photos and text, after the rule checks. Rule failures always win |
| Dispute Arbiter | `openai/gpt-oss-120b` | Proposes a split and a fault class. A deterministic compliance report is ground truth |
| ProcureBot (reference agent) | `openai/gpt-oss-20b` | Plans within its mandate through MCP tools. It can't fund or pay |

Every output is schema-validated, retried once, then falls back to a person. Every run is traced with its model, tokens and latency. If the app is ever running on the offline stub, a banner says so.

**Trust layer:** RFC 8785 canonical JSON, SHA-256 and ES256 signatures from reviewed libraries; a hash-linked proof chain; an offline verifier in both a CLI and the browser. **Sponsor tool:** AG Grid powers the admin console's ledger, risk queue, disputes, mandate checks and AI runs.

## Challenges we ran into

- **Our stub was hiding real failures.** The offline AI stub kept tests repeatable, but the first run on a real model failed schema validation in Scoping, and rate limits turned clean proofs into human reviews. We now send the schema explicitly, route text and vision to separate models, and honor retry-after.
- **A real model refused our fake photos.** The vision model looked at our generated sample images and called them graphics, not photographs. It was right, so the demo uses real photos.
- **A subtle reliability bug.** Looking up seeded payouts counted as PayPal failures, which tripped the circuit breaker and disabled funding for 30 seconds. What looked like a flaky test was a real bug.
- **PayPal regional limits.** Payouts return `PAYOUT_NOT_AVAILABLE` for an India-region sender, so the platform runs on a US sandbox business account.
- **Revocation races.** A mandate can be revoked while a payout is pending, so it's re-checked inside the release transaction and again immediately before the PayPal call.

## Accomplishments we're proud of

- An agent's out-of-mandate action is denied before any money moves, whatever the model proposes.
- In 28 repeatable scenarios run on fixtures, no bad proof was auto-paid, and 49 of 49 single-field receipt tampers were caught. Two document-upload scenarios are skipped because that feature isn't built.
- 450+ unit and integration tests, 10 browser journeys including a WCAG AA audit and a phone-sized run, and failure drills for webhook storms and PayPal and LLM outages.

## What we learned

Limits inside a prompt aren't limits; enforcement has to sit in code after the model. Test against the real provider early, because a perfect stub can hide everything. And a receipt only builds trust if someone can check it without trusting you.

## What's next

PayPal Invoicing through the Agent Toolkit, a Concierge agent, document deliverables, production key custody (KMS or HSM), a regulated partner, and a third-party security review.

## Built with

PayPal Orders v2, Payouts v1, Payments v2, Webhooks · Groq (Qwen, gpt-oss) · Model Context Protocol · Next.js · TypeScript · PGlite · Drizzle ORM · Zod · jose · canonicalize · @noble/hashes · sharp · exifr · AG Grid Community · Vitest · Playwright · Render

**Demo images:** the delivery and damage pictures used for demo proofs are **illustrative demo images, AI-generated**, not photographs of real deliveries. They are labelled as demo samples on every proof; their metadata is stripped and the demo stamps its own time and location. A visible generator watermark was trimmed from two of them; the files keep their invisible provenance marks.

## Testing instructions for judges

**Live:** https://settleai-07ue.onrender.com. First load may take ~75s while the free server wakes up. The demo resets after idle time, so jobs you create don't stay online; a receipt you downloaded still verifies offline.

**Permanent showcase:** https://settleai-07ue.onrender.com/receipt/showcase is the signed receipt of one real job on the PayPal sandbox. It never changes, and it verifies at /verify or offline against the public key in the README. The header badge shows `PayPal sandbox` and the AI model in use.

No sign-up: click **Payer**, **Worker** or **Admin** on the landing page. To pay in the sandbox checkout, use the sandbox buyer login given in Devpost's private testing field.

| Try | Click | You should see |
|---|---|---|
| Hire and fund | Payer, **New job**, describe a delivery, **Create job**, **Fund with PayPal** | Milestones with criteria, PayPal sandbox checkout, then Held in escrow |
| Get paid | Worker, open the job, **Accept**, **Submit proof**, **Photo at the right place** | Live checks and a Decision Card with the model's name, then a challenge window and payout |
| Fraud caught | Worker, on another job, **Photo reused from another job** | Held, with no money moved |
| Agent denied | Payer, **Agent mandates**, **Out of scope**, **Send as agent** | Reason codes, and nothing created |
| Dispute | Payer, **Dispute this milestone** during the challenge window | A split and a liability finding citing the mandate clause |
| Revoke | Payer, **Revoke** a mandate during a challenge window | The payout pauses before any PayPal call |
| Verify | Open the [showcase receipt](https://settleai-07ue.onrender.com/receipt/showcase), or a job's **Open the public receipt**, or go to **/verify** | All green; change one byte and it fails, pointing at the broken link |
| Operate | **Admin** | AG Grid console: KPIs, review queue, disputes, ledger, guard checks, AI runs |

**Local, no keys:** `pnpm install && pnpm db:reset && pnpm dev`, then open http://localhost:3000. With no keys, PayPal and AI run as clearly labelled mocks.
