# python scripts/edit-video.py — cuts .data/video/raw1.webm and raw2.webm into the demo video using marks1.json, marks2.json
# and the voiceover (.data/video/vo, from scripts/tts-voiceover.py). Opens on the denial card, holds each key card with a
# slow zoom, adds title and end cards, and writes .data/video/assembled.mp4 and captions.srt for scripts/burn-captions.py.
# Free tools only: ffmpeg/ffprobe. Waits are trimmed or sped up; zooms enlarge real frames; nothing on screen is altered.
import json, os, subprocess, sys

FF = "E:/tools/ffmpeg/bin/ffmpeg.exe"
FP = "E:/tools/ffmpeg/bin/ffprobe.exe"
V = ".data/video"
FONT = "C\\:/Windows/Fonts/arial.ttf"
FONTB = "C\\:/Windows/Fonts/arialbd.ttf"
LIVE = "settleai-07ue.onrender.com"
REPO = "github.com/Mokshitsharma/settleai"
W, H, FPS = 1920, 1080, 30
# Playwright records the 1536x864 page into the top-left of its 1920x1080 frame; crop it, then scale it to fill.
CROP = "1536:864:0:0"
PAGE_SCALE = W / 1536  # mark boxes are in 1536x864 viewport pixels
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "160k"]
BG = "0x14213D"

def run(args):
    r = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"ffmpeg failed: {r.stderr[-800:]}")

def dur(path):
    return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)

def load(path):
    out = {}
    for m in json.load(open(path)):
        out.setdefault(m["name"].split(":")[0], m)
    return out
M = load(f"{V}/marks1.json")  # part 1: landing to dispute settlement and the job's receipt, in raw1.webm
N = load(f"{V}/marks2.json")  # part 2: reused photo, risk queue, receipts, in raw2.webm
for src, names in ((M, ["mandates", "agent-out-of-scope", "denied", "agent-in-scope", "agent-allowed", "job-created", "fund-clicked", "paypal-checkout", "paypal-review", "paypal-returned", "funded", "proof-photo", "submitted", "decision-card", "dispute-opened", "evidence-added", "liability-finding", "settled", "evidence"]), (N, ["reused-photo", "held", "risk-queue", "showcase", "showcase-verified", "verify-page", "tamper-failed"])):
    for need in names:
        if need not in src:
            sys.exit(f"marks lack '{need}': a recording did not finish")
t = lambda src, k: src[k]["t"]
vo = {i["id"]: i for i in json.load(open(f"{V}/vo/durations.json"))}

# Beat lengths in seconds: the voiceover plus room to read the key card. Total about 2:43.
LENGTH = {"cold": 8, "title": 9, "mandate": 13, "denied": 16, "fund": 15, "proof": 16, "fraud": 15, "dispute": 26, "evidence": 13, "receipt": 19, "close": 12}
# Each screen beat: plain segments (start, end, raw file), then a zoom hold on a marked card (marks, name, seconds).
SCREEN = {
    "mandate": ([(t(M, "landing") + 2, t(M, "agent-out-of-scope"), 1)], (M, "mandates", 0)),
    "denied": ([(t(M, "agent-out-of-scope") - 1, t(M, "denied") + 3.5, 1)], (M, "denied", 7)),
    "fund": ([(t(M, "agent-in-scope"), t(M, "agent-allowed") + 2, 1), (t(M, "job-created"), t(M, "fund-clicked") + 1.5, 1), (t(M, "paypal-checkout"), t(M, "paypal-review") + 2, 1), (t(M, "paypal-returned"), t(M, "paypal-returned") + 2, 1), (t(M, "funded") - 1, t(M, "funded") + 3, 1)], None),
    "proof": ([(t(M, "proof-photo") - 1.5, t(M, "submitted") + 2, 1)], (M, "decision-card", 5)),
    "fraud": ([(t(N, "reused-photo") - 2, t(N, "reused-photo") + 1, 2), (t(N, "risk-queue"), t(N, "risk-queue") + 4, 2)], (N, "held", 5)),
    "dispute": ([(t(M, "dispute-opened") - 4, t(M, "evidence-added") + 1, 1), (t(M, "settled") - 1, t(M, "settled") + 3, 1)], ({"_raw": 1, "lf": {"t": t(M, "settled") - 2.2, "box": {"x": 284, "y": 112, "width": 596, "height": 152}}}, "lf", 6)),  # the finding, scrolled into view, boxed by hand
    # The permanent showcase receipt (a real sandbox job): its PayPal order, capture and payout ids, boxed by hand.
    "evidence": ([], ({"ids": {"t": t(N, "showcase") + 2.0, "box": {"x": 384, "y": 240, "width": 768, "height": 156}}}, "ids", 13)),
    "receipt": ([(t(N, "showcase"), t(N, "showcase-verified") + 3, 2), (t(N, "verify-page"), t(N, "tamper-failed"), 2)], (N, "tamper-failed", 6)),
}
# In the fraud and dispute beats the zoom hold sits between the plain segments, where it happens on screen.
HOLD_AT = {"fraud": 1, "dispute": 1}

def raw(n):
    return f"{V}/raw{n}.webm"

def segment(name, i, a, b, n):
    p = f"{V}/seg-{name}-{i}.mp4"
    run(["-ss", f"{max(0, a):.2f}", "-to", f"{b:.2f}", "-i", raw(n), "-an", "-vf", f"crop={CROP},scale={W}:{H}:flags=lanczos,fps={FPS}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", p])
    return p

def zoom_hold(name, marks, key, seconds, n, overlay=None):
    """A real frame at the mark, slowly zoomed onto the marked card (smoothstep over 1.6 s), then held."""
    m = marks[key]
    frame = f"{V}/frame-{name}.png"
    run(["-ss", f"{m['t'] + 0.3:.2f}", "-i", raw(n), "-frames:v", "1", "-vf", f"crop={CROP},scale={W}:{H}:flags=lanczos", frame])
    box = m.get("box")
    if box:
        bx, by, bw, bh = (box["x"] * PAGE_SCALE, box["y"] * PAGE_SCALE, box["width"] * PAGE_SCALE, box["height"] * PAGE_SCALE)
        pad = 60
        z1 = max(1.0, min(2.2, W / (bw + 2 * pad), H / (bh + 2 * pad)))
        cx, cy = bx + bw / 2, by + bh / 2
    else:
        z1, cx, cy = 1.12, W / 2, H / 2
    frames = int(seconds * FPS)
    ramp = 1.6 * FPS
    S = 2  # zoompan works on a 2x upscale to avoid jitter
    s = f"(min(on/{ramp:.1f},1)*min(on/{ramp:.1f},1)*(3-2*min(on/{ramp:.1f},1)))"
    z = f"(1+({z1 - 1:.4f})*{s})"
    x = f"max(0,min(iw-iw/zoom,({W / 2 * S:.1f}+({(cx - W / 2) * S:.1f})*{s})-iw/zoom/2))"
    y = f"max(0,min(ih-ih/zoom,({H / 2 * S:.1f}+({(cy - H / 2) * S:.1f})*{s})-ih/zoom/2))"
    vf = f"scale={W * S}:{H * S},zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps={FPS}"
    if overlay:
        o = overlay.replace(":", "\\:").replace("'", "\u2019")
        vf += f",drawbox=x=0:y=50:w=iw:h=150:color={BG}@0.9:t=fill,drawtext=fontfile='{FONTB}':text='{o}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=95"
    p = f"{V}/hold-{name}.mp4"
    run(["-loop", "1", "-i", frame, "-vf", vf, "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", p])
    return p

def concat(name, parts):
    lst = f"{V}/list-{name}.txt"
    open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    out = f"{V}/joined-{name}.mp4"
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
    return out

def with_audio(name, video, seconds, audio, speed=1.0):
    out = f"{V}/beat-{name}.mp4"
    run(["-i", video, "-i", audio, "-vf", f"setpts={speed:.4f}*PTS,fps={FPS},tpad=stop_mode=clone:stop_duration=3", "-af", f"adelay=300|300,apad=whole_dur={seconds}", "-t", f"{seconds:.2f}", *ENC, out])
    return out

def screen_beat(name, seconds, audio):
    segs, hold = SCREEN[name]
    hold_s = hold[2] if hold else 0
    plain = [segment(name, i, a, b, n) for i, (a, b, n) in enumerate(segs)]
    parts = []
    if plain:
        total = sum(dur(p) for p in plain)
        factor = (seconds - hold_s) / total  # under 1 speeds up waits
        if factor > 1:  # never slow footage down: the spare time goes to the hold on the key card
            hold_s += seconds - hold_s - total
            factor = 1.0
        print(f"{name}: {total:.1f}s of screen at x{1 / factor:.2f}, hold {hold_s:.1f}s")
        for i, p in enumerate(plain):
            sped = f"{V}/sped-{name}-{i}.mp4"
            run(["-i", p, "-vf", f"setpts={factor:.4f}*PTS,fps={FPS}", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", sped])
            parts.append(sped)
    if hold:
        h = zoom_hold(name, hold[0], hold[1], hold_s, 1 if (hold[0] is M or hold[0].get("_raw") == 1) else 2)
        parts.insert(HOLD_AT.get(name, len(parts)), h)
    return with_audio(name, concat(name, parts), seconds, audio)

def text_filter(lines, size=56):
    gap = int(size * 1.6)
    y0 = (H - gap * len(lines)) // 2
    parts = []
    for i, (line, sz, bold, color) in enumerate(lines):
        if not line:
            continue
        txt = line.replace(":", "\\:").replace("'", "\u2019")
        parts.append(f"drawtext=fontfile='{FONTB if bold else FONT}':text='{txt}':fontcolor={color}:fontsize={sz}:x=(w-text_w)/2:y={y0 + i * gap}")
    return ",".join(parts) or "null"

def card(name, lines, seconds, audio):
    out = f"{V}/beat-{name}.mp4"
    args = ["-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:r={FPS}:d={seconds}", "-i", audio]
    args += ["-vf", text_filter(lines), "-af", f"adelay=300|300,apad=whole_dur={seconds}", "-t", str(seconds), *ENC, out]
    run(args)
    return out

beats, srt, clock = [], [], 0.0
def add(path, seconds, caption):
    global clock
    if caption is None:  # the beat shows its words on screen already
        beats.append(path)
        clock += seconds
        return
    words = caption.split()
    chunks, cur = [], []
    for w in words:
        cur.append(w)
        if len(" ".join(cur)) > 46 and len(cur) > 1:
            chunks.append(" ".join(cur[:-1]))
            cur = [w]
    chunks.append(" ".join(cur))
    speech = vo_len - 0.2
    at = clock + 0.3
    for c in chunks:
        d = speech * len(c.split()) / len(words)
        srt.append((at, at + d, c))
        at += d
    beats.append(path)
    clock += seconds

WHITE, SOFT = "0xF4F6FA", "0xB8C2D6"
ORDER = ["cold", "title", "mandate", "denied", "fund", "proof", "fraud", "dispute", "evidence", "receipt", "close"]
for name in ORDER:
    item = vo[name]
    vo_len = item["seconds"]
    seconds = LENGTH[name]
    if vo_len + 0.8 > seconds:
        sys.exit(f"{name}: voiceover {vo_len}s does not fit in {seconds}s")
    audio = f"{V}/vo/{name}.wav"
    if name == "cold":
        h = zoom_hold("cold", M, "denied", seconds, 1, overlay="When an AI agent spends money, who is accountable?")
        add(with_audio("cold", h, seconds, audio), seconds, None)
    elif name == "title":
        add(card("title", [("SettleAI", 120, True, WHITE), ("", 0, False, WHITE), ("Agents will hire people.", 58, False, WHITE), ("SettleAI makes sure the work was done before PayPal pays.", 46, False, SOFT)], seconds, audio), seconds, item["text"])
    elif name == "close":
        lines = [("SettleAI", 96, True, WHITE), ("", 0, False, WHITE), (f"Try it:  {LIVE}", 54, False, WHITE), (f"Code:  {REPO}", 54, False, WHITE), ("", 0, False, WHITE), ("Built for the PayPal AI Hackathon 2026", 40, False, SOFT), ("", 0, False, WHITE),
                 ("PayPal sandbox, test money. Mandates are AP2-inspired, not official AP2 or endorsed. Demo images are AI-generated.", 26, False, SOFT)]
        add(card("close", lines, seconds, audio), seconds, item["text"])
    else:
        add(screen_beat(name, seconds, audio), seconds, item["text"])

lst = f"{V}/list-all.txt"
open(lst, "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in beats))
run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", f"{V}/assembled.mp4"])
json.dump({n: round(sum(LENGTH[k] for k in ORDER[:i]), 2) for i, n in enumerate(ORDER)}, open(f"{V}/beat-starts.json", "w"), indent=2)

def ts(s):
    h, rem = divmod(s, 3600); m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int(round((sec % 1) * 1000)):03d}"
with open(f"{V}/captions.srt", "w", encoding="utf-8") as f:
    for i, (a, b, c) in enumerate(srt, 1):
        f.write(f"{i}\n{ts(a)} --> {ts(b)}\n{c}\n\n")
print(f"assembled {clock:.1f}s; now run scripts/burn-captions.py (captions, length check, thumbnail)")
