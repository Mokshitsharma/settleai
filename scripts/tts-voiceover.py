# python scripts/tts-voiceover.py <kokoro-model-dir> — speaks docs/video/voiceover.json with Kokoro-82M (Apache-2.0) through
# kokoro-onnx (MIT), offline. Writes .data/video/vo/<id>.wav and durations.json for scripts/edit-video.py.
# Model files (kokoro-v1.0.onnx, voices-v1.0.bin) come from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0).
# Run it with a Python that has kokoro-onnx and soundfile installed (a separate venv is fine).
import json, os, sys

import soundfile as sf
from kokoro_onnx import Kokoro

VOICE = os.environ.get("TTS_VOICE", "af_heart")
SPEED = float(os.environ.get("TTS_SPEED", "0.95"))
model_dir = sys.argv[1] if len(sys.argv) > 1 else "."
kokoro = Kokoro(os.path.join(model_dir, "kokoro-v1.0.onnx"), os.path.join(model_dir, "voices-v1.0.bin"))
out = ".data/video/vo"
os.makedirs(out, exist_ok=True)
durations = []
for item in json.load(open("docs/video/voiceover.json", encoding="utf-8")):
    samples, rate = kokoro.create(item["text"], voice=VOICE, speed=SPEED, lang="en-us")
    sf.write(f"{out}/{item['id']}.wav", samples, rate)
    seconds = round(len(samples) / rate, 2)
    durations.append({"id": item["id"], "text": item["text"], "seconds": seconds})
    print(f"{item['id']}: {seconds}s")
json.dump(durations, open(f"{out}/durations.json", "w", encoding="utf-8"), indent=2)
print(f"total speech {sum(d['seconds'] for d in durations):.1f}s, voice {VOICE}, speed {SPEED}")
