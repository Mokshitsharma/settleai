# Video checklist

Checked on 7 Nov 2026 against `docs/video/settleai-demo.mp4`.

| Rule | Result |
|---|---|
| Strictly under 3:00 (target under 2:50) | 2:11.5 by ffprobe (131.53 s); the editor fails the build at 2:58 or more |
| Format | H.264, 1920x1080, 30 fps, AAC audio |
| English throughout | Yes: voiceover, captions, cards |
| Burned-in captions | Yes (drawtext); `captions.srt` also provided for upload |
| No music | None; see `LICENSES.md` |
| Title card and end card | Title: "SettleAI / Agents will hire people. Who answers for it?" End: live URL, repo URL, "Built for the PayPal AI Hackathon 2026" |
| No third-party logos or trademarks | Frames checked every 3 s: only SettleAI and the PayPal sandbox checkout (sponsor); demo images have no logos, QR codes or readable brands |
| No secrets or env files | No terminal, `.env.local`, keys or tokens on screen |
| No real personal data | Seeded demo names (Ravi Traders, Asha K., Meera) and sandbox accounts only; the sandbox checkout greets its test buyer as "John" |
| Recorded against the live site, LIVE badge visible | Yes: "PayPal sandbox" badge and model names in the header |
| Real PayPal sandbox evidence | Real order, capture and payout; capture confirmed by PayPal webhook; settlement through PayPal |
| Real AI output, not the stub | Decision Card "verified by qwen/qwen3.8-27b"; Arbiter proposal and liability finding from the real model |
| Moment 1 | Out-of-mandate request denied with reason codes, nothing created |
| Moment 2 | The first job's photo reused on a second job, held for a person, shown in the AG Grid review queue |
| Moment 3 | Liability finding that cites the Payment Mandate clause, with criteria and evidence |
| Moment 4 | Showcase receipt verifies in the browser; a one-byte change fails with a pointer |
| Stable link shown | `/receipt/showcase` |
| Waits | Real waits (2-minute proof wait, PayPal and model latency) trimmed or sped up; nothing altered |
| Thumbnail | `thumbnail.png`, 1280x720, SettleAI name over a dispute frame, no third-party logos |
| Frame fill | Fixed before upload: the recorder placed the page in the top-left of the 1920x1080 frame; the editor now crops and scales it to fill (re-checked on a contact sheet) |
