# Video checklist

Checked on 10 Nov 2026 against `docs/video/settleai-demo.mp4` (contact sheets every 3 s, plus key frames).

| Rule | Result |
|---|---|
| Strictly under 3:00 (target 2:40 to 2:50) | 2:42 by ffprobe (162.03 s); `burn-captions.py` fails the build at 2:55 or more |
| Format | H.264 (libx264, preset veryfast), 1920x1080, 30 fps, AAC audio |
| Opening | 0:00 to 0:08 on the red "Denied before any money moved" card, with "When an AI agent spends money, who is accountable?" |
| Four moments, each held on its key card with a slow zoom | Denial with reason codes; reused photo held; liability finding citing the mandate (plain-English clause); tampered receipt fails |
| Real PayPal sandbox evidence | Funded through the sandbox checkout, capture confirmed by webhook; showcase receipt shows real order, capture and payout ids (masked) |
| Real AI output, not the stub | Decision Card from the real vision model; Arbiter proposal and liability finding from the real model |
| No promised split | The voiceover says "a liability finding"; this run's Arbiter paid the worker in full (claim not supported) |
| End | Product end card: live URL, repo URL, "Built for the PayPal AI Hackathon 2026"; disclaimer as one small line, not spoken |
| English, burned-in captions | Yes; `captions.srt` also provided for upload |
| Voice | Kokoro-82M (Apache-2.0), voice `af_heart`; `voiceover.txt` for a human re-record; see `LICENSES.md` |
| No music | None |
| No third-party logos | Only SettleAI and the PayPal sandbox checkout (sponsor) |
| No secrets or personal data | No terminal, env files or keys on screen; seeded demo names and sandbox accounts only |
| Waits | Real waits trimmed or sped up (funding x1.9); zooms enlarge real frames; nothing altered |
| Thumbnail | `thumbnail.png`, 1280x720: the liability finding with "SettleAI / When an AI agent spends, who is liable?" |
