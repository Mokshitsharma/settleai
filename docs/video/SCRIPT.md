# Demo video script (as recorded)

Final cut: `docs/video/settleai-demo.mp4`, built by `scripts/record-demo.mjs` (live site, 1920x1080) and `scripts/edit-video.py`
(cuts, captions, cards). English, no music, burned-in captions, no third-party logos (PayPal sandbox screens only, as sponsor).
Voice: Piper TTS, LJ Speech voice (public domain), see `LICENSES.md`. Real waits (the 2-minute proof wait, PayPal and model
latency) are trimmed or sped up; nothing on screen is altered.

Order: title card, then the beats below, then the end card (live URL, repo URL, "Built for the PayPal AI Hackathon 2026").

| On screen | Voiceover |
|---|---|
| Text card: "Agents will hire people. Who answers for it?" | AI agents are starting to spend money and hire people. When an agent overspends, or the work never happens, who is accountable? |
| Text card: the flow in one frame (mandate, guard, PayPal hold, proof checks, release or dispute, signed receipt) | SettleAI is the accountability layer. A person signs what an agent may do. The money waits, proof is checked, and every decision leaves a receipt anyone can verify. |
| Payer's Agent mandates page with the signed ProcureBot mandate and budget meter; PayPal sandbox badge in view | Ravi has signed a mandate for his agent: delivery jobs only, up to one hundred fifty dollars each, four hundred in total. |
| Moment 1: Out of scope, Send as agent; Denial Card with reason codes; nothing created | The agent tries a five hundred dollar job outside that mandate. Mandate Guard is deterministic code. It denies the request before any money moves, and says why. |
| In-scope hire (real scoping), Fund with PayPal, sandbox checkout, back to the job, funded by PayPal | Inside the mandate, the agent hires a courier. Ravi funds the job on the PayPal sandbox, with Orders version two. The money is held on the platform account until the work is proven. |
| Worker submits an illustrative demo image; checks run; Decision Card shows the real model's verdict (AUTO_RELEASE) | The worker submits a photo. Rules check location, time and duplicates first. Then a vision model judges each criterion, and policy approves the release. |
| Moment 3: payer disputes in the challenge window, adds a damage image; Arbiter proposal and the Liability finding citing the mandate clause; both accept; settled through PayPal | Ravi disputes the delivery and adds a photo of the damage. The arbiter returns a liability finding that cites the mandate clause, the criteria and the evidence. Both sides accept, and PayPal settles it. |
| Moment 2: a second job; the first job's photo reused; held for a person; AG Grid review queue | Someone reuses that photo on another job. The perceptual hash catches it, the payout is held, and it waits in the risk queue for a person. |
| Moment 4: /receipt/showcase verifies in the browser; /verify with a one-byte change fails and points at the broken link | Every step is signed into a receipt. Anyone can verify it, without trusting us. Change one byte, and verification fails, pointing to the broken link. |
| Text card: results from the repeatable test scenarios | In our repeatable test scenarios, no bad proof was auto-paid, and every tampered receipt was caught. Next: production key custody, a regulated partner, and PayPal Invoicing. |
| Text card: sandbox, ledgered hold, AP2-inspired, AI-generated demo images | This runs on the PayPal sandbox with test money. The mandates are inspired by AP2. They are not official, and not endorsed by PayPal. |
