# Demo video script (draft)

Target 2:45, hard stop under 2:58. English only. No music. Burned-in captions. Tech names as plain text, no logos.
Recorded against {{LIVE_URL}} with the LIVE badge visible. On screen: seeded demo data and sandbox accounts only.
Never on screen: a terminal with env vars, `.env.local`, or any real email.

Model output, scores and PayPal ids are whatever the recorded run produces. Do not retype or mock them. The voiceover
below avoids quoting a model's exact words; if a run's verdict differs from a beat, re-record that beat or change the
line to match it.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:05 | Title card: **SettleAI**. "Agents will hire people. Who answers for it?" | (none) |
| 0:05–0:15 | Plain text on dark: an agent, a gig worker, a payment, and a question mark | "AI agents are starting to spend money and hire people. When an agent overspends, or the work never happens, who is accountable?" |
| 0:15–0:30 | Architecture frame: Mandate, Guard, PayPal hold, Proof checks, Release or Dispute, Signed receipt | "SettleAI is the accountability layer. A person signs what an agent may do. The money waits, proof is checked, and every decision leaves a receipt anyone can verify." |
| 0:30–0:42 | Mandates page: the plain-language mandate, the signature, the budget meter. LIVE badge in view | "Ravi signs a mandate: delivery jobs only, up to one hundred fifty dollars each, four hundred in total." |
| 0:42–0:58 | ProcureBot's job appears; **Fund with PayPal**; sandbox checkout; back to the job; Held in escrow; order id {{ORDER_ID}}, capture id {{CAPTURE_ID}} | "His agent hires a courier. He funds it on the PayPal sandbox, with Orders version two. The capture is real, and the money is a ledgered hold on the platform account." |
| 0:58–1:12 | **Moment 1.** Agent tries the out-of-scope $500 hire; Denial Card with reason codes; budget meter unchanged | "Now the agent tries a five hundred dollar job outside its mandate. Mandate Guard is deterministic code. It denies this before any money moves, and it cites the reason." |
| 1:12–1:32 | Worker phone view; real photo and location; Agent Activity stream; Decision Card showing the real model name; challenge window; payout id {{PAYOUT_BATCH_ID}}; trust score up | "The worker submits a photo. Rules check location, time and duplicates first. Then a vision model judges each criterion. Policy decides, a short challenge window passes, and PayPal Payouts pays the worker." |
| 1:32–1:47 | **Moment 2.** Same photo on another job; `DUP_IMAGE`; HOLD; AG Grid risk queue with the row open | "Here a worker reuses that photo on a different job. The perceptual hash catches it, the payout is held, and it lands in the risk queue for a person. No money moves." |
| 1:47–2:07 | **Moment 3.** Payer disputes and adds a damage photo and a statement; Arbiter proposal; fault class; the mandate clause in view; both accept; refund id {{REFUND_ID}}; ledger balanced | "A payer disputes a delivery and adds evidence. The arbiter proposes a split and a liability finding that cites the exact mandate clause, the criteria and the evidence. Both accept. PayPal pays one share and refunds the other, and the ledger balances." |
| 2:07–2:22 | **Moment 4.** Download receipt; /verify all green; change one byte; red, pointing to the broken link | "Every step is signed into a receipt. Anyone can verify it offline, without trusting us. Change one byte, and verification fails, and points to the broken link." |
| 2:22–2:37 | Results table, labelled "repeatable test fixtures": 0 bad proofs auto-paid across 28 scenarios, 49 of 49 tampers caught | "In our repeatable test scenarios, no bad proof was auto-paid, and every tampered receipt was caught. Next: production key custody, a regulated partner, and PayPal Invoicing." |
| 2:37–2:45 | Honesty line as text: "PayPal sandbox, test money. Ledgered hold. AP2-inspired mandates, not official AP2 and not endorsed by PayPal." | "This runs on the PayPal sandbox with test money. The mandates are inspired by AP2. They are not official, and not PayPal-endorsed." |
| 2:45–2:50 | End card: {{LIVE_URL}}, github.com/Mokshitsharma/settleai, "Built for the PayPal AI Hackathon 2026" | (none) |

## Recording notes

- Warm the server first and let the first page load finish before recording.
- Set `CHALLENGE_WINDOW_SECONDS` long enough for the dispute beat; the recorder waits on page state, not guesses.
- Trim waits in the edit; never speed up or fake a result.
- Check the Decision Card and the Arbiter panel show a real model name, and the stub banner is absent.
