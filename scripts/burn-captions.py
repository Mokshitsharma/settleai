# python scripts/burn-captions.py — burns .data/video/captions.srt into assembled.mp4 with ffmpeg drawtext (the subtitles
# filter hangs on Windows while it scans fonts), checks the length, and makes the thumbnail.
import json, os, re, subprocess, sys

FF = "E:/tools/ffmpeg/bin/ffmpeg.exe"
FP = "E:/tools/ffmpeg/bin/ffprobe.exe"
V = ".data/video"
OUT = "docs/video"
FONT = "C\\:/Windows/Fonts/arial.ttf"
FONTB = "C\\:/Windows/Fonts/arialbd.ttf"

def dur(path):
    return float(subprocess.run([FP, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True).stdout)

def secs(t):
    h, m, s = t.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)

blocks = open(f"{V}/captions.srt", encoding="utf-8").read().strip().split("\n\n")
os.makedirs(f"{V}/cap", exist_ok=True)
filters = []
for i, b in enumerate(blocks):
    lines = b.splitlines()
    a, z = [secs(x.strip()) for x in lines[1].split("-->")]
    path = f"{V}/cap/{i:03d}.txt"
    open(path, "w", encoding="utf-8").write(" ".join(lines[2:]))
    rel = path.replace(":", "\\:")
    filters.append(f"drawtext=fontfile='{FONT}':textfile='{rel}':fontcolor=white:fontsize=44:box=1:boxcolor=black@0.62:boxborderw=14:x=(w-text_w)/2:y=h-140:enable='between(t,{a:.2f},{z:.2f})'")
script = f"{V}/captions.filter"
open(script, "w", encoding="utf-8").write(",".join(filters))
final = f"{OUT}/settleai-demo.mp4"
r = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", f"{V}/assembled.mp4", "-/vf", script, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "copy", final], capture_output=True, text=True)
if r.returncode:
    sys.exit(f"caption burn failed: {r.stderr[-600:]}")
length = dur(final)
print(f"FINAL {final}: {length:.2f}s")
if length >= 175:
    sys.exit(f"FAIL: {length:.1f}s is not under 2:55")
import shutil; shutil.copyfile(f"{V}/captions.srt", f"{OUT}/captions.srt")

# Thumbnail: the liability finding from the dispute beat's zoom hold, darkened, with the project name.
starts = json.load(open(f"{V}/beat-starts.json"))
at = starts["dispute"] + 13
r = subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", f"{V}/assembled.mp4", "-frames:v", "1", "-vf", f"scale=1280:720,eq=brightness=-0.2,drawbox=x=0:y=400:w=iw:h=250:color=0x14213D@0.92:t=fill,drawtext=fontfile='{FONTB}':text='SettleAI':fontcolor=white:fontsize=110:x=60:y=430,drawtext=fontfile='{FONT}':text='When an AI agent spends, who is liable?':fontcolor=white:fontsize=48:x=64:y=575", f"{OUT}/thumbnail.png"], capture_output=True, text=True)
if r.returncode:
    sys.exit(f"thumbnail failed: {r.stderr[-400:]}")
print("thumbnail written from", round(at, 1), "s")
