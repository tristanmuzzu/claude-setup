#!/usr/bin/env bash
# Start a cinematic-3D project from the skill's template.
#   ~/.claude/skills/cinematic-3d/scripts/new.sh <dest-dir>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:?usage: new.sh <dest-dir>}"
if [ -e "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
  echo "refusing: $dest exists and is not empty" >&2
  exit 1
fi
mkdir -p "$dest"
cp -r "$here/template/." "$dest/"
cd "$dest"
chmod +x scripts/*.sh 2>/dev/null || true
npm install --no-audit --no-fund
# 3D fonts (typeface JSON) from the bundled @fontsource packages.
F=node_modules/@fontsource
mkdir -p public/fonts
node scripts/font2typeface.mjs $F/inter/files/inter-latin-800-normal.woff public/fonts/inter-800.typeface.json
node scripts/font2typeface.mjs $F/courier-prime/files/courier-prime-latin-700-normal.woff public/fonts/courier-700.typeface.json
node scripts/font2typeface.mjs $F/jetbrains-mono/files/jetbrains-mono-latin-800-normal.woff public/fonts/jbmono-800.typeface.json
REEL_STUDIO="${REEL_STUDIO:-$HOME/reel-studio}"
PY="$REEL_STUDIO/tools/venv/bin/python"
[ -x "$PY" ] || PY=python3
"$PY" scripts/sfx.py public/sfx
node scripts/codestats.mjs public/demo/code.json src/kit src/demo scripts
npx tsc -p .
echo "ready: $dest  (npx remotion studio, or node scripts/stills.mjs LookBeauty 0,15,25,35)"
