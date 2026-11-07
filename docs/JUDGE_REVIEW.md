# SettleAI: mock judge review

Reviewer role: a strict PayPal AI Hackathon 2026 judge spending 5–10 minutes skimming.
Date: 7 Nov 2026. Planned submission: 11 Nov. Cutoff: 13 Nov, 1:30 AM IST (12 Nov, 12:00 PT).

**What I looked at:** README.md, docs/DEVPOST.md, docs/video/SCRIPT.md, captions.srt and YOUTUBE.md, the five Devpost images, a few source lines (the review-queue columns, the challenge-window config), and one curl pass over the live site. I didn't run any tests or watch the video frames. I made three web searches for rival entries and found none public yet.

---

## Overall: 7.6 / 10

The engineering is in the top tier for a hackathon. The idea is sharp and on-theme: agents spend money, so who is accountable? The project is very honest about its limits.

What costs it points is how it's packaged. The video is a 2-minute sprint through eleven beats. One Devpost section contradicts the AI-image disclosure. The AG Grid screenshot shows a broken grid. The live demo has a 75 s cold start and an 8–15 s challenge window that a judge can't realistically hit. All of these can be fixed by 10 Nov.

## 30-second test

| Surface | Problem clear? | "Wow" clear? | Notes |
|---|---|---|---|
| Video opening (0:00–0:23) | Yes. "When an agent overspends, or the work never happens, who is accountable?" | Partly | The wow shows up at 0:32 (the denial). Before that come two text cards of narration. Show the red "Denied before any money moved" card within the first 10 s. |
| README top | Yes. The bold one-liner is strong. | No | The quoted paragraph below it is dense ("AP2-style mandates… deterministic Mandate Guard… signed receipt"). A judge sees no picture or GIF before "Live demo". |
| Landing page | Yes. The headline and the signed-mandate card are excellent. | Partly | The first visit takes **75 s** (measured: `/` returned 200 in 75.4 s). Many judges will close the tab first. The header shows raw model IDs (`qwen/qwen3.8-27b + openai/gpt-oss-120b`), which is jargon above the fold. |

Verdict: it passes the problem test but only half-passes the wow test. The best moment (an agent denied, with reason codes) should come first everywhere.

## Criteria scores

| Criterion | Score | One-line reason |
|---|---|---|
| Technological Implementation | **9** | Real Orders v2, Payouts, refunds and webhooks with dedupe, a double-entry ledger, a deterministic guard at four gates, JWS receipts with an offline verifier, MCP, and 450+ tests. Hard to beat. |
| Design | **7** | The landing and the Decision Card are clean. The AG Grid review queue renders broken (see red flags), and the liability card shows raw tokens (`verification.pass, risk.not_hold`) and "borne by shared". |
| Potential Impact | **6.5** | The problem is real, but the pitch never puts a number on it (gig payments, chargebacks, agent spend) and names no buyer. "Ravi Traders in Indore" is good texture with no market size behind it. |
| Innovation | **8** | Conditional settlement, liability findings that cite a signed mandate clause, and verifiable receipts form a fresh layer on top of AP2-style mandates. Clearly beyond "chatbot plus checkout". |
| Presentation | **6.5** | The voiceover is clear and honest, but the video is rushed (around 11 s per beat, about 2:05 of the 3:00 allowed) and ends on a disclaimer. The Devpost page reads well but contains a contradiction and a fragile judge path. |

Weighted roughly equally, that comes to about **7.4–7.8**.

## Prize fit

| Prize | Fit | Why |
|---|---|---|
| Best Use of Agentic Commerce | **8.5** | The strongest fit. It's literally about agents spending under mandates, and MCP plus ProcureBot prove it. |
| Best Use of PayPal + AI | **7.5** | Deep PayPal use with AI on the critical path. It doesn't use the **PayPal Agent Toolkit**, which judges from PayPal may look for, and "What's next" admits that. One sentence on why it isn't used (agents must never hold write tools) turns the gap into a design choice. |
| Most Impactful | **6** | Needs a quantified problem and a named user segment. |
| Most Creative | **6.5** | Creative in its architecture, not in its demo. The emotional hook is thin. |
| Best Demo Delivery | **5.5** | The video pacing, the cold start and the short challenge window all work against this prize. |
| AG Grid (sponsor) | **5** | The submitted grid screenshot shows collapsed **Job** and **Flags** columns showing a single letter ("D", "N") with blank headers, and a clipped "Decided" column. To a sponsor judge that looks like misuse of their product. It's fixable in an hour, and fixing it raises the fit to 7–7.5. |

## Competition

No rival entries were public yet (three searches; the official gallery is at paypalaihackathon.devpost.com). Based on typical entries for this theme:

**Where we're stronger**
- Most entries will be "an LLM calls PayPal create-order through the Agent Toolkit". SettleAI argues the opposite (an LLM must never hold the money tool) and shows code enforcing it. That's a memorable thesis.
- Real sandbox evidence (order, capture, payout batch and refund IDs), webhook-confirmed funding, and a ledger that conserves money.
- Verifiable receipts with tamper detection, which nobody else is likely to have.
- Honesty: AP2-inspired wording, a ledgered hold rather than "escrow", disclosed AI images, unbuilt features listed.

**Where a simpler entry could beat us**
- **A one-flow demo with a human story.** For example: "my agent booked and paid a plumber in 60 seconds", shown in one continuous take, with a real voice and no jargon. Judges skimming 10 projects reward clarity over depth.
- **Uses the Agent Toolkit or PayPal's own agentic products by name.** PayPal judges may score "uses our new thing" higher.
- **A demo that loads instantly.** A judge who waits 75 s, or who can't open a dispute because the 8 s window closed, scores the demo lower whatever the depth.
- **A consumer-facing UI** feels more "impactful" than an ops console full of hashes and reason codes.

## Red flags

1. **Contradiction about the images (high).** DEVPOST.md, "Challenges": "*A real model refused our fake photos… so the demo uses real photos.*" The same page, the README and the video then say the demo images are **AI-generated**. A judge who notices will doubt every other claim. Rewrite that bullet to match what is actually true now.
2. **Broken AG Grid screenshot (high, for the sponsor prize).** The `Job` (flex 2) and `Flags` (flex 1) columns in `src/app/admin/risk/page.tsx` collapse to about 1 character with no header text. `Decided` is cut off at the right edge.
3. **A judge can't hit the challenge window (high, demo).** The Decision Card says "an 8-second window to dispute" (`render.yaml` sets `CHALLENGE_WINDOW_SECONDS=15`). "Four things to try" #3 asks the judge to dispute during that window. Most judges will miss it and conclude the feature doesn't work. It also reads as a toy setting.
4. **75 s cold start (high).** It's disclosed, but it's still the first impression. Judging runs 1–15 Dec, so the instance needs to be kept warm throughout.
5. **"Escrow" wording slips.** The landing page says "held in escrow" and the job page shows "Held in escrow". The Devpost and README carefully say "ledgered hold" and "no native escrow". Make them consistent: "Held by PayPal for this job" or "Held (ledgered)".
6. **Jargon on screen.** Raw model IDs in the header, `verification.pass, risk.not_hold, mandate.active hold`, `pmd_01M6V8…#settlementConditions[milestoneSeq=1]`, "borne by shared", "(1 checks)". These are fine in a details drawer but not on the hero card of the liability screenshot.
7. **Weak statistics presented as strengths.** "Prompt injection caught 100%, CI [15.8%, 100%], n = 2" and "bad proofs paid 0%, CI up to 36.9%, n = 8". A statistically literate judge reads these as "barely tested". The README also prints the evidence twice (two near-identical tables).
8. **Video pacing and ending.** The video covers eleven beats in about 2:05, roughly 11 s of screen per idea, with sped-up waits. It ends on a legal disclaimer instead of the product. The YouTube chapters list "Moment 3" before "Moment 2", which reads as a mistake.
9. **TTS voice.** Piper LJ Speech is flat and audibly synthetic. It's acceptable and disclosed, but it costs points for Best Demo Delivery. A human voice, even a non-native one, scores better for warmth.
10. **AP2 wording.** This is handled well everywhere ("AP2-inspired, not official, not endorsed"). Don't change it. Just don't spend the video's final 10 s on it; one on-screen line is enough.
11. **Screenshot 2 is badly cropped.** It cuts off the denial reason mid-sentence and shows an "Expired" mandate that distracts. Crop it to the request and the red denial card.

## Top 3 risks

1. **The judge's first two minutes fail:** a 75 s cold start, then a dispute window that closes before they click. The result is a low demo score and doubt about the depth claims.
2. **Credibility damage from the "real photos vs AI-generated" contradiction** on the Devpost page.
3. **The AG Grid sponsor prize (the one sponsor prize we target) is lost** because the hero grid screenshot looks broken.

## Top 10 improvements (ranked by score gain ÷ effort; all safe to finish by the night of 10 Nov)

| # | Change | Hours | Criterion | Type |
|---|---|---|---|---|
| 1 | Fix the Devpost "Challenges" bullet about images so it matches the AI-generated disclosure (for example: the vision model flagged early generated images as graphics, so we regenerated more realistic ones, labelled them as AI-generated demo samples, and kept rule checks as ground truth). | 0.25 | Presentation, credibility | Devpost text |
| 2 | Fix the review-queue column widths (give `job` and `flags` a `minWidth`, or fixed widths, and let `Decided` fit), then retake screenshot 5. Add one Devpost line saying which AG Grid features are used (filters, quick search, CSV export, status renderers). | 1 | Design, AG Grid prize | UI + Devpost image |
| 3 | Keep the live demo warm from submission through 15 Dec (an external uptime ping every 10 min, or a paid Render instance for the judging period). Change the "~75s" note to state that the demo is kept warm. | 0.5 | Demo delivery | Ops |
| 4 | Make the dispute path reachable: seed a job that is always in its challenge window (or give jobs a "Dispute" button for a longer window, e.g. 10 min, in demo mode), and update "Four things to try" #3 to point at it directly. | 1.5 | Demo delivery, Presentation | Code (config + seed) |
| 5 | Re-edit the video: open on the red denial card (0–8 s) with the "who is accountable?" line over it. Slow down to fewer beats (cut or merge the flow card and the results card), and use the full ~2:50. Hold each key card for 4–6 s, with a zoom or highlight on the reason codes, the liability finding and the "verification failed" link. End on the product and the URL, with the disclaimer as one small on-screen line rather than a spoken ending. | 3 | Presentation, Demo delivery | Video |
| 6 | Re-record the voiceover with a human voice (or at least a more natural TTS voice), using the same script. | 1.5 | Presentation, Demo delivery | Video |
| 7 | Add a quantified "why now" to the Devpost Inspiration and README top: 2–3 sourced figures (gig and freelance payment disputes, small business late or unpaid invoices, agentic commerce forecasts) and a named first user ("small businesses that outsource deliveries and repairs"). The impact-pack template already exists, so fill it in. | 1 | Potential Impact | Devpost text, README |
| 8 | Clean up the jargon on the liability card and the header: plain-English clause text first ("Milestone 1 pays only if the photo checks pass, risk isn't on hold, and the mandate is still active"), raw IDs behind a "Details" toggle. Fix "borne by shared" (say "shared by both sides") and "(1 checks)". Change "Held in escrow" to "Held by PayPal". Move model IDs from the header into a tooltip. Retake screenshot 4. | 1.5 | Design, Presentation | UI |
| 9 | Tighten the README top: a 10-second GIF or screenshot right under the one-liner, one evidence table (delete the duplicate), and move the small-n injection row (n = 2) into a footnote or raise n with more injection fixtures. | 1 | Presentation | README |
| 10 | Add one Devpost paragraph, "Why not give the agent the PayPal Agent Toolkit?", framing the deliberate choice (agents get read and create tools through MCP; only the Treasury, after the Guard, calls PayPal writes), and naming the Toolkit for Invoicing as next. Recrop screenshot 2 to the denial card, and renumber the YouTube chapters in on-screen order. | 0.75 | Best Use of PayPal + AI, Presentation | Devpost text, image |

Total: about 12 hours. Items 1–3 (about 1.75 h) carry the largest risk reduction and should be done first. If time runs short, skip item 6 before skipping item 5.

Don't add features. Everything above is about clarity, reachability and credibility.
