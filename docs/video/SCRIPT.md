# Demo video script

Final cut: `docs/video/settleai-demo.mp4`, 2:42 (162.0 s by ffprobe). Built by `scripts/record-demo.mjs` (live site, 1920x1080, real PayPal
sandbox and real models), `scripts/tts-voiceover.py` (voice), `scripts/edit-video.py` (cuts, zooms, cards) and
`scripts/burn-captions.py` (captions, length check, thumbnail). English, no music, burned-in captions. The only third-party
screens are the PayPal sandbox checkout (the sponsor).

Voice: Kokoro-82M (Apache-2.0), voice `af_heart`, run offline through kokoro-onnx; see `LICENSES.md`. The same words are in
`voiceover.txt` for a human re-record. Real waits (the one-minute proof wait, PayPal and model latency) are trimmed or sped
up. Zooms enlarge real frames; nothing on screen is altered.

Structure: a cold open on the strongest moment, then four moments, each held 5 to 7 seconds on its key card with a slow
zoom, one beat of real PayPal sandbox evidence, and an end card on the product. The disclaimer is one small line on the end
card and is not spoken.

| Time | Beat | On screen | Voiceover |
|---|---|---|---|
| 0:00 | Cold open (8 s) | Zoom onto the red "Denied before any money moved" card; caption bar: "When an AI agent spends money, who is accountable?" | When an AI agent spends money, who is accountable? |
| 0:08 | Title (9 s) | Card: SettleAI. Agents will hire people. SettleAI makes sure the work was done before PayPal pays. | This is SettleAI. It makes sure the work was done before PayPal pays, and it says who is liable when it wasn't. |
| 0:17 | Setup (13 s) | Payer's Agent mandates page: the signed ProcureBot mandate and its budget; PayPal sandbox badge in view | Ravi runs a small shop. His AI agent can hire couriers for him, but only within limits he signs: delivery jobs, up to a hundred and fifty dollars each. |
| 0:30 | **Moment 1** (16 s) | Out of scope, Send as agent; zoom hold on the denial card with its reason codes; nothing created | Now the agent tries to book a five hundred dollar repair job. That's outside the limits. The check is plain code, not a prompt. It says no, and why, before any money moves. |
| 0:46 | Fund (15 s) | In-scope hire, Fund with PayPal, sandbox checkout, back to the job: funded, held by PayPal for this job | Inside the limits, the agent books a delivery. Ravi pays through PayPal checkout, in the sandbox. PayPal holds the money for this job until the work is proven. |
| 1:01 | Proof (16 s) | Worker submits a demo image; live checks; zoom hold on the Decision Card (approved by policy, model named) | The courier sends a photo. Simple rules check the place, the time, and whether the photo was used before. Then an AI model checks each requirement, and the payment is approved. |
| 1:17 | **Moment 2** (15 s) | Second job, the same photo reused; zoom hold on the held decision ("already submitted for another job"); the AG Grid review queue | On a second job, someone sends the same photo again. It's caught. Nothing is paid, and the job waits for a person in the review queue. |
| 1:32 | **Moment 3** (26 s) | First job: payer disputes in the 10-minute window and adds a damage image; zoom hold on the liability finding with its plain-English clause; settled through PayPal | Back on the first job, Ravi says one carton arrived damaged. An AI arbiter weighs both sides and writes a liability finding. It cites the exact clause Ravi signed. Both sides accept, and PayPal settles it. |
| 1:58 | Sandbox evidence (13 s) | Zoom hold on the permanent showcase receipt (a real sandbox job): PayPal order, capture and two payout ids (masked) | This is a real job on the PayPal sandbox. The order, the capture, and both payouts, each with its own PayPal ID. |
| 2:11 | **Moment 4** (19 s) | Showcase receipt verifies in the browser; /verify with a one-character change; zoom hold on "Receipt failed verification" and the broken link | Every step is signed into a receipt. Anyone can check it in the browser, without trusting us. Change a single character, and the check fails, and shows what was changed. |
| 2:30 | End card (12 s) | SettleAI; Try it: settleai-07ue.onrender.com; Code: github.com/Mokshitsharma/settleai; Built for the PayPal AI Hackathon 2026; one small line: sandbox, AP2-inspired (not official or endorsed), AI-generated demo images | AI agents are about to spend real money. SettleAI makes them accountable. Try it yourself at the link on screen. |

The liability beat never promises a particular split: the Arbiter proposes one, code checks that it adds up, and both sides
accept or an admin decides.

## Rebuild

```bash
node scripts/record-demo.mjs https://settleai-07ue.onrender.com            # part 1 -> rename raw.webm/marks.json to raw1/marks1
node scripts/record-demo.mjs https://settleai-07ue.onrender.com --part2    # part 2 -> raw2/marks2
<venv-python> scripts/tts-voiceover.py <kokoro-model-dir>
python scripts/edit-video.py && python scripts/burn-captions.py
```
