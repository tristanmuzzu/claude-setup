"""Procedural sound design bank for cinematic 3D films. Deterministic, offline.

    ../reel/tools/venv/bin/python scripts/sfx.py public/sfx

Writes 48 kHz mono WAVs:
  hit.wav      sub impact for hard cuts and title lands (sine drop 70->34 Hz + click)
  boom.wav     bigger impact with a long tail, for the opening and the CTA
  whoosh.wav   filtered-noise sweep for whip pans and pass wipes (0.5 s, peak at 0.32 s)
  tick1-4.wav  key clicks for typing (vary them so typing never machine-guns)
  pad.wav      warm minor-ninth pad swell, 3 s, for holds under the voice
  riser.wav    1.2 s noise + pitch riser that ends on its last sample (place so it ends on a cut)
  blip.wav     short UI blip for HUD tags
  room.wav     low room tone, loopable, so silence never sounds dead
"""

import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
rng = np.random.default_rng(7)


def write(path: Path, y: np.ndarray, peak=0.9):
    y = y / max(1e-9, np.abs(y).max()) * peak
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())


def t(sec):
    return np.arange(int(sec * SR)) / SR


def env(n, a, d, curve=4.0):
    x = np.arange(n) / SR
    att = np.clip(x / max(a, 1e-4), 0, 1)
    dec = np.exp(-np.maximum(0, x - a) * curve / max(d, 1e-4))
    return att * dec


def lp(y, hz, order=4):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), y)


def hp(y, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), y)


def bp(y, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), y)


def sub_hit(dur=1.2, f0=72, f1=34, click=0.35):
    x = t(dur)
    f = f1 + (f0 - f1) * np.exp(-x * 9)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env(len(x), 0.004, dur * 0.55, 3.5)
    cl = hp(rng.standard_normal(len(x)), 2500) * env(len(x), 0.0005, 0.02, 6) * click
    return np.tanh(1.6 * (body + cl))


def whoosh(dur=0.55, peak=0.32):
    x = t(dur)
    n = rng.standard_normal(len(x))
    out = np.zeros_like(n)
    # sweep a band through the noise, block by block
    blk = 512
    for i in range(0, len(n), blk):
        c = (i / SR) / dur
        fc = 300 + 5200 * np.sin(np.pi * min(1, c / (peak / dur * 2))) ** 2 if c < peak / dur * 2 else 300 + 5200 * np.exp(-(c - peak / dur * 2) * 6)
        seg = n[max(0, i - 2048): i + blk]
        f = bp(seg, max(80, fc * 0.6), min(20000, fc * 1.6))
        out[i: i + blk] = f[-len(n[i: i + blk]):]
    shape = np.exp(-((x - peak) ** 2) / (2 * (dur * 0.16) ** 2))
    return out * shape


def tick(seed):
    r = np.random.default_rng(seed)
    x = t(0.06)
    n = r.standard_normal(len(x))
    body = bp(n, 1800 + r.uniform(-300, 300), 5200) * env(len(x), 0.0004, 0.012, 5)
    thump = np.sin(2 * np.pi * (180 + r.uniform(-20, 20)) * x) * env(len(x), 0.001, 0.02, 5) * 0.5
    return body + thump


def pad(dur=3.2, root=110.0):
    x = t(dur)
    notes = [root, root * 1.189, root * 1.498, root * 2.0, root * 2.245]  # m9 voicing
    y = np.zeros_like(x)
    for i, f in enumerate(notes):
        for det in (-0.12, 0.0, 0.11):
            ff = f * (1 + det / 100 * 6)
            # soft saw from a few harmonics
            for h in range(1, 7):
                y += np.sin(2 * np.pi * ff * h * x + i + h) / (h ** 1.4) * 0.25
    y = lp(y, 1400)
    e = np.clip(x / (dur * 0.35), 0, 1) ** 1.6 * np.clip((dur - x) / (dur * 0.4), 0, 1)
    return y * e


def riser(dur=1.2):
    x = t(dur)
    n = hp(rng.standard_normal(len(x)), 800) * (x / dur) ** 2.2
    f = 220 * (2 ** (x / dur * 2))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (x / dur) ** 2 * 0.4
    y = n * 0.6 + tone
    y[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
    return y


def blip():
    x = t(0.09)
    return np.sin(2 * np.pi * 1320 * x) * env(len(x), 0.001, 0.03, 4) + np.sin(2 * np.pi * 1980 * x) * env(len(x), 0.001, 0.02, 4) * 0.4


def room(dur=4.0):
    x = t(dur)
    n = lp(rng.standard_normal(len(x)), 320) * 0.6 + lp(rng.standard_normal(len(x)), 2400) * 0.05
    fade = int(0.05 * SR)
    n[:fade] *= np.linspace(0, 1, fade)
    n[-fade:] *= np.linspace(1, 0, fade)
    return n


def main(out_dir: str):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    write(out / "hit.wav", sub_hit())
    write(out / "boom.wav", sub_hit(2.6, 80, 30, 0.5) + np.concatenate([np.zeros(int(0.02 * SR)), lp(rng.standard_normal(int(2.58 * SR)), 900) * env(int(2.58 * SR), 0.01, 1.4, 3) * 0.25]))
    write(out / "whoosh.wav", whoosh(), 0.8)
    for i in range(4):
        write(out / f"tick{i + 1}.wav", tick(i + 11), 0.6)
    write(out / "pad.wav", pad(), 0.7)
    write(out / "pad_hi.wav", pad(3.2, 146.83), 0.7)
    write(out / "riser.wav", riser(), 0.75)
    write(out / "blip.wav", blip(), 0.5)
    write(out / "room.wav", room(), 0.3)
    print("wrote", sorted(p.name for p in out.glob("*.wav")))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "public/sfx")
