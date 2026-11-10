# SettleAI: mock judge review, round 2

Reviewer role: the same strict PayPal AI Hackathon 2026 judge as in `JUDGE_REVIEW.md`, skimming for 5 to 10 minutes.
Date: 10 Nov 2026. Compared with round 1 (7 Nov, 7.6 / 10).

**What I looked at:** the live site after the 10 Nov deploy (Playwright at 1920x1080: landing, agent denial, a full funded
job on the PayPal sandbox with real models, a dispute inside the 10-minute window, the reused-photo hold, every AG Grid
view, the showcase receipt and a tampered receipt), the rebuilt video (contact sheets every 3 s), README, DEVPOST.md,
the five Devpost images and the impact pack.

## Overall: 8.1 / 10 (was 7.6)

The packaging now matches the engineering. The video opens on the denial and gives each moment time to land. The Devpost
page no longer contradicts itself. The AG Grid screens look like a deliberate use of the product. What still costs points:
a synthetic voice, a dispute path that takes a judge about four minutes and a PayPal sandbox login, and an ops console that
is denser than a consumer demo.

## Round 1 items

| # | Round 1 item | Now |
|---|---|---|
| 1 | Devpost "real photos" contradiction | Fixed: Challenges says the model flagged early generated images, we used more realistic AI-generated ones, disclosed them, and kept rule checks as ground truth. No conflicting claim in README, Devpost, UI, code comments or video |
| 2 | Broken AG Grid columns | Fixed and deployed: every grid measured, no collapsed or clipped columns; `Decided` widened again for a 2-digit hour; Devpost lists the AG Grid features used |
| 3 | 75 s cold start | Fixed for judging: an external ping every 10 minutes through 16 Dec; README and Devpost say so |
| 4 | Unreachable dispute window | Fixed: 10-minute window on live; landing card 3, README and Devpost walk the judge through it, including the one-minute wait the fast-proof rule needs |
| 5 | Rushed video, disclaimer ending | Fixed: 2:42, cold open on the denial card, 4 moments held 5 to 13 s with zooms, one sandbox-evidence beat, ends on the product and URLs; disclaimer is one small line |
| 6 | Flat TTS voice | Improved: Kokoro-82M replaces Piper LJ Speech; still synthetic (script in `voiceover.txt` for a human re-record) |
| 7 | No quantified impact | Fixed: three cited figures and a named first user; interview placeholders removed |
| 8 | Jargon on screen | Fixed: plain-English clause first, raw clause under Details; "shared by both sides"; "(1 check)"; model ids in a tooltip; "Held by PayPal for this job" |
| 9 | README top | Fixed: one-liner, hero image, "Try it in 60 seconds", one evidence table, the n = 2 injection figure in a footnote |
| 10 | Agent Toolkit gap | Fixed: "Why the agent never holds the PayPal write tools", with the Agent Toolkit for Invoicing named as next |
| 11 | Screenshot 2 crop | Fixed: request plus the full denial card, no expired mandate |

## Criteria scores

| Criterion | Round 1 | Round 2 | One-line reason |
|---|---|---|---|
| Technological Implementation | 9 | **9** | Unchanged and still the strongest part: real Orders, Payouts, webhooks, ledger, guard at four gates, verifiable receipts, MCP, 500+ tests |
| Design | 7 | **8** | Grid, liability card and wording are clean; the admin console is still dense, and the ledger's internal account is still called "Escrow" |
| Potential Impact | 6.5 | **7** | Cited numbers and a named first user; no user interviews or pilot, which the pack now says plainly |
| Innovation | 8 | **8** | Unchanged: conditional settlement plus liability findings that cite a signed clause |
| Presentation | 6.5 | **8** | The video is now paced for a skimming judge and starts on the wow; the voice is still synthetic |

## Prize fit

| Prize | Round 1 | Round 2 | Why |
|---|---|---|---|
| Best Use of Agentic Commerce | 8.5 | **9** | The cold open is exactly this prize's question, answered in code |
| Best Use of PayPal + AI | 7.5 | **8** | The write-tools rationale turns the missing Agent Toolkit into a design choice |
| Most Impactful | 6 | **7** | Quantified, but no real users yet |
| Most Creative | 6.5 | **7** | The receipt tamper moment and the cited liability finding are memorable |
| Best Demo Delivery | 5.5 | **7.5** | Warm server, reachable dispute, a 2:42 cut; the synthetic voice and the long dispute path hold it back |
| AG Grid (sponsor, the one we enter) | 5 | **7.5** | A clean, filterable review queue and ledger in the hero images, with the features listed |

## Remaining risks

1. **The dispute path is long for a judge:** fund in the sandbox (needs the buyer login from the private testing field),
   accept, wait a minute, submit, then dispute. Judges who skip it still see the finding in the video and on the showcase
   receipt.
2. **Live dependencies during 1 to 15 Dec:** the Groq free tier (rate limits fall back to human review, which is safe but
   less impressive), the Render free plan's 512 MB, and the cron ping. Check health weekly.
3. **Synthetic voice** may still cost a little on Best Demo Delivery; a human re-record from `voiceover.txt` is the only
   remaining video upgrade.
4. **Two "escrow" words remain on purpose:** the ledger's internal account name and the Guard's denial messages ("Funds stay
   in escrow"), left because the Guard was out of scope for this pass. Devpost explains the ledgered hold.
5. **Submission mechanics:** the repo must be public, the video public on YouTube, and only the AG Grid sponsor prize
   selected. Run gitleaks before making the repo public.
6. **Screenshot 5** was taken before the `Decided` width fix (the "am" of one row clips by a few pixels); retake it after
   the next deploy.
