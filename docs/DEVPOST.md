# SettleAI: Devpost write-up (draft)

**Agents will hire people. SettleAI makes sure the work was done before PayPal pays, and says who is liable when it was not.**

Live demo: https://settleai-07ue.onrender.com
Code: https://github.com/Mokshitsharma/settleai (MIT)

> **Honest positioning.** SettleAI holds funds as a **ledgered hold**: money is captured to the platform's PayPal account and released by Payouts, because PayPal has no native escrow here. Its mandates are **AP2-inspired, not official AP2 and not endorsed by PayPal or Google**. Everything runs on the PayPal sandbox with test money. A production system holding customer funds would need licensing or a regulated partner.

## Inspiration

AI agents are starting to buy things for people. Signed mandates can prove a person authorized an agent to pay, but for real-world services that isn't enough. Did the courier deliver? What if the agent overspends, or a worker reuses an old photo? Today, nobody can say who is accountable. Small businesses and gig workers feel this most: they pay up front with no recourse, or they wait and argue over whether work was done.

The numbers say this is already a problem before agents arrive, and agents will scale it:

- **Nearly three in four freelancers** in New York had faced nonpayment or late payment ([*Freelancing in New York 2019*](https://www.nyc.gov/assets/mome/pdf/freelancing-ny-report-09062019.pdf), NYC Mayor's Office of Media and Entertainment, Freelancers Union and Upwork).
- **62.6% of invoices** sent by UK small businesses in the past year were paid late (FreeAgent survey, reported by [Financial IT](https://financialit.net/news/cash-management/sme-cash-flow-crisis-nearly-two-thirds-invoices-paid-late-across-uk)).
- **Up to $1 trillion** of US retail revenue could be orchestrated by AI agents by 2030, and $3–5 trillion globally (McKinsey, [*The agentic commerce opportunity*](https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants), October 2025). That forecast covers goods; services, where proof of work matters most, come next.

**Our first users: small businesses that outsource deliveries and repairs**, such as a trader in Indore whose agent books couriers, and the couriers who want to be paid the moment the proof checks out.

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

**Why the agent never holds the PayPal write tools**

Most agent payment demos hand the model a "create order" or "send payout" tool. SettleAI deliberately doesn't. Through the MCP server, an agent gets only read and create tools: it can draft and track jobs within its signed mandate, but it can't fund, pay or refund. Only the deterministic Treasury calls PayPal write APIs, and only after the Mandate Guard allows it, with the final check made immediately before each payout call. A prompt injection or a confused model can at worst propose a job that the Guard then denies; it can't move money. That's also why we didn't wire the PayPal Agent Toolkit's payment tools into the agent. Next, we'll use the Agent Toolkit for Invoicing, where an agent drafting an invoice for a person to approve fits the same rule.

**Trust layer:** RFC 8785 canonical JSON, SHA-256 and ES256 signatures from reviewed libraries; a hash-linked proof chain; an offline verifier in both a CLI and the browser. **Sponsor tool:** AG Grid powers the admin console's ledger, risk queue, disputes, mandate checks and AI runs.

AG Grid Community features used: the Theming API (Quartz, styled with our design tokens), typed column filters (text, number and date), sorting and column resizing, a quick filter that searches every column, custom cell renderers for status pills and job links, CSV export, pagination and header and cell tooltips.

## Challenges we ran into

- **Our stub was hiding real failures.** The offline AI stub kept tests repeatable, but the first run on a real model failed schema validation in Scoping, and rate limits turned clean proofs into human reviews. We now send the schema explicitly, route text and vision to separate models, and honor retry-after.
- **A real model saw through our first demo images.** The vision model looked at our early generated sample images and called them graphics, not photographs. It was right. We replaced them with more realistic AI-generated images, disclosed them as illustrative demo images on every proof, and kept the deterministic checks (GPS, time, duplicate photo) as ground truth that the model can't override.
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

## Gallery (docs/devpost/, 1920x1080, from the live site)

1. `1-landing.png`: landing page with the PayPal sandbox badge and the four things to try
2. `2-denied-before-money-moves.png`: an out-of-mandate agent request denied with reason codes
3. `3-decision-card-real-model.png`: Decision Card with the real vision model's verdict and a webhook-confirmed capture
4. `4-liability-finding-cites-mandate.png`: Arbiter proposal and the liability finding citing the Payment Mandate, settled through PayPal
5. `5-ag-grid-risk-queue.png`: AG Grid review queue with the reused photo held

Video: under 3 minutes on YouTube (link added at upload). Thumbnail and captions in `docs/video/`.

## Built with

PayPal Orders v2, Payouts v1, Payments v2, Webhooks · Groq (Qwen, gpt-oss) · Model Context Protocol · Next.js · TypeScript · PGlite · Drizzle ORM · Zod · jose · canonicalize · @noble/hashes · sharp · exifr · AG Grid Community · Vitest · Playwright · Render

**Demo images:** the delivery and damage pictures used for demo proofs are **illustrative demo images, AI-generated**, not photographs of real deliveries. They are labelled as demo samples on every proof; their metadata is stripped and the demo stamps its own time and location. A visible generator watermark was trimmed from two of them; the files keep their invisible provenance marks.

## Testing instructions for judges

**Live:** https://settleai-07ue.onrender.com. The server is pinged every 10 minutes during judging so it stays awake; if the first load is still slow (up to ~75s), the free server was waking up. The demo resets after idle time, so jobs you create don't stay online; a receipt you downloaded still verifies offline.

**Permanent showcase:** https://settleai-07ue.onrender.com/receipt/showcase is the signed receipt of one real job on the PayPal sandbox: two milestones verified by the vision model, and a dispute settled by the Arbiter with a liability finding that cites the mandate. It never changes, and it verifies at /verify or offline against the public key in the README. The header badge shows `PayPal sandbox`; hover "Real AI models" to see which models are in use.

No sign-up: click **Payer**, **Worker** or **Admin** on the landing page. To pay in the sandbox checkout, use the sandbox buyer login given in Devpost's private testing field.

| Try | Click | You should see |
|---|---|---|
| Hire and fund | Payer, **New job**, describe a delivery, **Create job**, **Fund with PayPal** | Milestones with criteria, PayPal sandbox checkout, then "Held by PayPal for this job" |
| Get paid | Worker, open the job, **Accept**, wait one minute, **Submit proof**, **Photo at the right place** | Live checks and a Decision Card with the model's name, then a 10-minute challenge window and payout |
| Fraud caught | Worker, on another job, **Photo reused from another job** | Held, with no money moved |
| Agent denied | Payer, **Agent mandates**, **Out of scope**, **Send as agent** | Reason codes, and nothing created |
| Dispute | After **Get paid**, switch to Payer, open the same job, **Dispute this milestone** within 10 minutes | A split and a liability finding citing the mandate clause |
| Revoke | Payer, **Revoke** a mandate during a challenge window | The payout pauses before any PayPal call |
| Verify | Open the [showcase receipt](https://settleai-07ue.onrender.com/receipt/showcase), or a job's **Open the public receipt**, or go to **/verify** | All green; change one byte and it fails, pointing at the broken link |
| Operate | **Admin** | AG Grid console: KPIs, review queue, disputes, ledger, guard checks, AI runs |

**Connect your own AI agent (optional).** SettleAI's agent API and MCP server accept the ProcureBot key given in the private
testing-instructions field. Run the MCP server locally against the live site:

```bash
git clone https://github.com/Mokshitsharma/settleai && cd settleai && pnpm install
SETTLEAI_URL=https://settleai-07ue.onrender.com SETTLEAI_API_KEY=<key from the testing field> pnpm mcp
```

Or let the reference agent do it: `SETTLEAI_URL=https://settleai-07ue.onrender.com SETTLEAI_API_KEY=<key> pnpm procurebot`.
Hires the guard denies cost nothing; allowed hires are rate-limited per key and per caller, so one tester cannot use up the
shared model budget.

**Local, no keys:** `pnpm install && pnpm db:reset && pnpm dev`, then open http://localhost:3000. With no keys, PayPal and AI run as clearly labelled mocks.
