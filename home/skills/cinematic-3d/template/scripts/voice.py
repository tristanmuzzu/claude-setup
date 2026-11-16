"""Voiceover + word timings for a cinematic-3D film.

    "$REEL_STUDIO/tools/venv/bin/python" scripts/voice.py <script.json> <out_dir>

script.json: {"voice": {"am_michael": 0.4, "am_fenrir": 0.6}, "speed": 1.0, "lead": 0.3,
              "lines": [{"id": "hook", "say": "This isn't footage.", "after": 0.25}, ...]}

Uses the reel studio's Kokoro engine (misaki phonemes, lexicon, cache,
Whisper word timings). Lines are laid end to end with `after` seconds of air
behind each. Writes <out_dir>/vo.wav (48 kHz mono) and <out_dir>/timing.json:
  {"fps": 30, "total": frames, "lines": {"hook": {"from": f, "to": f, "words": [[word, f0, f1], ...]}}}
Frames are absolute. Picture cuts should land on a line's `from` or a word.
"""

import json
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

import os

# The reel studio (set REEL_STUDIO) owns the Kokoro models, the lexicon and the voice cache.
REEL = Path(os.environ.get("REEL_STUDIO", str(Path.home() / "reel-studio")))
sys.path.insert(0, str(REEL / "studio"))
sys.path.insert(0, str(REEL))
from voice import Engine  # noqa: E402

FPS = 30
SR = 24000


def main(script_path: str, out_dir: str):
    spec = json.loads(Path(script_path).read_text())
    mix = spec.get("voice", {"am_michael": 0.4, "am_fenrir": 0.6})
    speed = spec.get("speed", 1.0)
    eng = Engine()
    t = spec.get("lead", 0.3)
    chunks, lines = [], {}
    for ln in spec["lines"]:
        y, heard = eng.sentence(ln["say"], mix, ln.get("speed", speed))
        start = t
        pad = int(round((start * SR))) - sum(len(c) for c in chunks)
        if pad > 0:
            chunks.append(np.zeros(pad, np.float32))
        chunks.append(y)
        dur = len(y) / SR
        lines[ln["id"]] = {
            "say": ln["say"],
            "from": round(start * FPS),
            "to": round((start + dur) * FPS),
            "words": [[w, round((start + a) * FPS), round((start + b) * FPS)] for w, a, b in heard],
        }
        t = start + dur + ln.get("after", 0.25)
    tail = spec.get("tail", 1.0)
    audio = np.concatenate(chunks + [np.zeros(int(tail * SR), np.float32)])
    audio = audio / max(1e-6, np.abs(audio).max()) * 0.89
    a48 = resample_poly(audio, 2, 1).astype(np.float32)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out / "vo.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes((np.clip(a48, -1, 1) * 32767).astype(np.int16).tobytes())
    total = int(np.ceil(len(audio) / SR * FPS))
    (out / "timing.json").write_text(json.dumps({"fps": FPS, "total": total, "lines": lines}, indent=1))
    for k, v in lines.items():
        print(f"{k:10s} {v['from']:4d}-{v['to']:4d}  {v['say']}")
    print("total frames", total)


if __name__ == "__main__":
    main(*sys.argv[1:3])
