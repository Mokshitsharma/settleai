# python scripts/edit-video.py — cuts .data/video/raw.webm into the demo video using marks.json and the voiceover, adds title,
# text and end cards, burns in captions, checks the length and writes docs/video/settleai-demo.mp4 plus a thumbnail.
# Free tools only: ffmpeg/ffprobe. Waits are trimmed or sped up; nothing on screen is altered or faked.
import json, os, subprocess, sys

FF = "E:/tools/ffmpeg/bin/ffmpeg.exe"
FP = "E:/tools/ffmpeg/bin/ffprobe.exe"
V = ".data/video"
OUT = "docs/video"
FONT = "C\\:/Windows/Fonts/arial.ttf"
FONTB = "C\\:/Windows/Fonts/arialbd.ttf"
LIVE = "settleai-07ue.onrender.com"
REPO = "github.com/Mokshitsharma/settleai"
W, H, FPS = 1920, 1080, 30
# Playwright records the 1536x864 page into the top-left of its 1920x1080 frame; crop it, then scale it to fill.
CROP = "1536:864:0:0"
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "160k"]

def run(args):
    r = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg failed: {r.stderr[-800:]}")

def dur(path):
    return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)

def load(path):
    out = {}
    for m in json.load(open(path)):
        out.setdefault(m["name"].split(":")[0], m["t"])
    return out
M = load(f"{V}/marks1.json")  # part 1: landing to dispute settlement, in raw1.webm
N = load(f"{V}/marks2.json")  # part 2: reused photo, risk queue, receipts, in raw2.webm
vo = {i["id"]: i for i in json.load(open(f"{V}/vo/durations.json"))}
for src, names in ((M, ["mandates", "agent-out-of-scope", "denied", "agent-in-scope", "agent-allowed", "job-created", "fund-clicked", "paypal-checkout", "paypal-review", "paypal-returned", "funded", "proof-photo", "submitted", "decision", "dispute-opened", "evidence-added", "liability-finding", "settled"]), (N, ["reused-photo", "held", "risk-queue", "showcase", "showcase-verified", "verify-page", "tamper-failed"])):
    for need in names:
        if need not in src:
            sys.exit(f"marks lack '{need}': a recording did not finish")

SCREEN = {
    "mandate": [(M["mandates"], M["agent-out-of-scope"])],
    "denied": [(M["agent-out-of-scope"], M["denied"] + 3.5)],
    "fund": [(M["agent-in-scope"], M["agent-allowed"] + 2.5), (M["job-created"], M["fund-clicked"] + 1.5), (M["paypal-checkout"], M["paypal-review"] + 2), (M["paypal-returned"], M["paypal-returned"] + 2), (M["funded"] - 1, M["funded"] + 3)],
    "proof": [(M["proof-photo"] - 1.5, M["submitted"] + 2), (M["decision"] - 6, M["decision"] + 4)],
    "dispute": [(M["dispute-opened"] - 4, M["evidence-added"] + 1), (M["liability-finding"] - 2, M["liability-finding"] + 5), (M["settled"] - 1, M["settled"] + 4)],
    "fraud": [(N["reused-photo"] - 2, N["reused-photo"] + 1, 2), (N["held"] - 1, N["held"] + 4, 2), (N["risk-queue"], N["risk-queue"] + 4, 2)],
    "receipt": [(N["showcase"], N["showcase-verified"] + 4, 2), (N["verify-page"], N["tamper-failed"] + 5, 2)],
}
CARDS = {
    "problem": ["Agents will hire people.", "Who answers for it?"],
    "what": ["Mandate  >  Guard  >  PayPal hold  >  Proof checks", ">  Release or dispute  >  Signed receipt", "", "SettleAI: the accountability layer for agentic commerce"],
    "results": ["Repeatable test scenarios (offline fixtures):", "0 bad proofs auto-paid in 28 scenarios", "49 of 49 tampered receipts caught"],
    "honest": ["PayPal sandbox, test money. Funds are a ledgered hold.", "Mandates are AP2-inspired: not official AP2,", "not endorsed by PayPal or Google.", "Demo images are illustrative and AI-generated."],
}
ORDER = ["problem", "what", "mandate", "denied", "fund", "proof", "dispute", "fraud", "receipt", "results", "honest"]

def text_filter(lines, size=56, start_y=None):
    gap = int(size * 1.6)
    y0 = start_y if start_y is not None else (H - gap * len(lines)) // 2
    parts = []
    for i, line in enumerate(lines):
        if not line:
            continue
        t = line.replace(":", "\\:").replace("'", "\u2019")
        parts.append(f"drawtext=fontfile='{FONT}':text='{t}':fontcolor=0xF4F6FA:fontsize={size}:x=(w-text_w)/2:y={y0 + i * gap}")
    return ",".join(parts) or "null"

def card(name, lines, seconds, audio=None, size=56):
    out = f"{V}/beat-{name}.mp4"
    args = ["-f", "lavfi", "-i", f"color=c=0x14213D:s={W}x{H}:r={FPS}:d={seconds}"]
    args += (["-i", audio] if audio else ["-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo:d={seconds}"])
    args += ["-vf", text_filter(lines, size), "-af", f"apad=whole_dur={seconds}", "-t", str(seconds), *ENC, out]
    run(args)
    return out

def screen_beat(name, segs, seconds, audio):
    parts = []
    for i, seg in enumerate(segs):
        a, b = seg[0], seg[1]
        src = f"{V}/raw{seg[2] if len(seg) > 2 else 1}.webm"
        p = f"{V}/seg-{name}-{i}.mp4"
        run(["-ss", f"{max(0, a):.2f}", "-to", f"{b:.2f}", "-i", src, "-an", "-vf", f"crop={CROP},scale={W}:{H}:flags=lanczos,fps={FPS}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", p])
        parts.append(p)
    lst = f"{V}/list-{name}.txt"
    open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    joined = f"{V}/joined-{name}.mp4"
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined])
    raw = dur(joined)
    factor = seconds / raw  # under 1 speeds up waits; over 1 slows gently
    out = f"{V}/beat-{name}.mp4"
    run(["-i", joined, "-i", audio, "-vf", f"setpts={factor:.4f}*PTS,fps={FPS}", "-af", f"apad=whole_dur={seconds}", "-t", f"{seconds:.2f}", *ENC, out])
    print(f"{name}: {raw:.1f}s of screen fitted to {seconds:.1f}s (x{1 / factor:.2f})")
    return out

beats, srt, clock = [], [], 0.0
def add(path, seconds, caption=None):
    global clock
    if caption:
        words = caption.split()
        chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 46 and len(cur) > 1:
                chunks.append(" ".join(cur[:-1]))
                cur = [w]
        chunks.append(" ".join(cur))
        speech = vo_len - 0.3
        t = clock + 0.2
        for c in chunks:
            d = speech * len(c.split()) / len(words)
            srt.append((t, t + d, c))
            t += d
    beats.append(path)
    clock += seconds

# Title card
add(card("title", ["SettleAI", "", "Agents will hire people. Who answers for it?"], 4, size=64), 4)
for name in ORDER:
    item = vo[name]
    vo_len = item["seconds"]
    seconds = round(vo_len + 1.0, 2)
    audio = f"{V}/vo/{name}.wav"
    if name in CARDS:
        add(card(name, CARDS[name], seconds, audio, size=52 if name == "what" else 58), seconds, item["text"])
    else:
        add(screen_beat(name, SCREEN[name], seconds, audio), seconds, item["text"])
add(card("end", [f"Live demo: {LIVE}", f"Code: {REPO}", "", "Built for the PayPal AI Hackathon 2026"], 6, size=56), 6)

lst = f"{V}/list-all.txt"
open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in beats))
run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", f"{V}/assembled.mp4"])

def ts(s):
    h, rem = divmod(s, 3600); m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int(round((sec % 1) * 1000)):03d}"
with open(f"{V}/captions.srt", "w", encoding="utf-8") as f:
    for i, (a, b, c) in enumerate(srt, 1):
        f.write(f"{i}\n{ts(a)} --> {ts(b)}\n{c}\n\n")
print("assembled; now run scripts/burn-captions.py (captions, length check, thumbnail)")
