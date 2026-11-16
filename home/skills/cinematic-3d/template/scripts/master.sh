#!/usr/bin/env bash
# Master and QA a rendered film: loudness to -14 LUFS / -1 dBTP (Instagram),
# black-frame check, and an unprompted transcript of the voice.
#   scripts/master.sh out/film-raw.mp4 [out/film.mp4]
set -euo pipefail
in="$1"
out="${2:-${in%-raw.mp4}.mp4}"
[ "$out" = "$in" ] && out="${in%.mp4}-master.mp4"

# Two-pass loudnorm so the level is exact, not estimated.
stats=$(ffmpeg -hide_banner -i "$in" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$stats" | python3 -I -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -v error -y -i "$in" -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 256k -movflags +faststart "$out"

echo "== $out"
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact "$out"
ffmpeg -hide_banner -i "$out" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I:|True peak:|Peak:)" | tail -2
black=$(ffmpeg -hide_banner -i "$out" -vf "blackdetect=d=0.03:pix_th=0.06" -an -f null - 2>&1 | grep -c black_start || true)
echo "black segments: $black"

REEL_STUDIO="${REEL_STUDIO:-$HOME/reel-studio}"
if [ -x "$REEL_STUDIO/tools/venv/bin/python" ]; then
  "$REEL_STUDIO/tools/venv/bin/python" -I -c '
import sys, subprocess, numpy as np
from faster_whisper import WhisperModel
raw = subprocess.run(["ffmpeg","-v","error","-i",sys.argv[1],"-f","f32le","-ac","1","-ar","16000","-"],capture_output=True).stdout
m = WhisperModel("small.en", device="cpu", compute_type="int8")
segs, _ = m.transcribe(np.frombuffer(raw, np.float32), language="en")
print("heard:", " ".join(s.text.strip() for s in segs))
' "$out" 2>/dev/null || echo "transcript skipped"
fi
