#!/usr/bin/env bash
# Wizard template. Everything above the STAGES marker is library and is
# identical in every wizard: never hand-edit it. Author stages below the marker.
#
# Run:  bash <this-script>          normal
#       DRY_RUN=1 bash <this-script>  print actions, change nothing
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
TOTAL_STAGES="${TOTAL_STAGES:-0}"
STAGE_NO=0
ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-$(mktemp -d -t wizard-backup-XXXXXX)}"
ROLLBACK_NOTES=()

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; RST=$'\033[0m'
else
  B=''; DIM=''; GRN=''; YEL=''; RED=''; RST=''
fi

die() { printf '%s\n' "${RED}$*${RST}" >&2; exit 1; }
say() { printf '%s\n' "$*"; }
step() { printf '  %s %s\n' "${GRN}>${RST}" "$*"; }
note() { printf '  %s%s%s\n' "$DIM" "$*" "$RST"; }
warn() { printf '  %s%s%s\n' "$YEL" "$*" "$RST"; }

# stage "Title" - clears the screen and prints the header. One focused task per
# stage, so nothing the human needs scrolls out of view.
stage() {
  STAGE_NO=$((STAGE_NO + 1))
  if [ -t 1 ]; then clear; fi
  printf '%s\n' "${B}Stage ${STAGE_NO}/${TOTAL_STAGES}: $1${RST}"
  printf '%s\n\n' "${DIM}$(printf '%.0s-' $(seq 1 60))${RST}"
}

# open_url <url> - opens in the human's browser, and always prints it so a
# headless or remote session still works.
open_url() {
  local url="$1"
  step "Opening: $url"
  if [ "$DRY_RUN" = "1" ]; then note "(dry run, not opened)"; return 0; fi
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then open "$url" >/dev/null 2>&1 || true
  elif command -v wslview >/dev/null 2>&1; then wslview "$url" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then cmd.exe //c start "" "$url" >/dev/null 2>&1 || true
  else note "No URL opener found. Open it by hand."; fi
}

# ask <VAR_NAME> <prompt> [default] - visible input.
ask() {
  local var="$1" prompt="$2" default="${3:-}" reply=''
  if [ -n "$default" ]; then
    read -r -p "  $prompt [$default]: " reply || true
    reply="${reply:-$default}"
  else
    while [ -z "$reply" ]; do
      read -r -p "  $prompt: " reply || die "No input available (stdin closed). Run this wizard in a terminal."
    done
  fi
  printf -v "$var" '%s' "$reply"
}

# ask_secret <VAR_NAME> <prompt> - hidden input. Never echoed, never logged.
ask_secret() {
  local var="$1" prompt="$2" reply=''
  while [ -z "$reply" ]; do
    read -r -s -p "  $prompt: " reply || die "No input available (stdin closed). Run this wizard in a terminal."
    printf '\n'
  done
  printf -v "$var" '%s' "$reply"
}

# confirm <question> - default no. Returns non-zero when declined.
confirm() {
  local reply=''
  read -r -p "  $1 [y/N]: " reply || true
  case "$reply" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

pause() { read -r -p "  ${DIM}Press Enter when done.${RST}" _ || true; }

# backup_file <path> - copies into BACKUP_DIR and records the rollback line.
backup_file() {
  local f="$1"
  [ -e "$f" ] || return 0
  local dest
  dest="$BACKUP_DIR/$(printf '%s' "$f" | tr '/' '_')"
  if [ "$DRY_RUN" = "1" ]; then note "(dry run) would back up $f"; return 0; fi
  cp -p "$f" "$dest"
  ROLLBACK_NOTES+=("cp '$dest' '$f'")
  note "Backed up to $dest"
}

# write_env <KEY> <value> - idempotent upsert into ENV_FILE.
write_env() {
  local key="$1" value="$2"
  if [ "$DRY_RUN" = "1" ]; then step "(dry run) would set $key in $ENV_FILE"; return 0; fi
  backup_file "$ENV_FILE"
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    # grep -v exits 1 when it filters every line, which set -e would treat as
    # fatal. An empty result is the correct result here.
    grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
    mv "$tmp" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  step "Set $key in $ENV_FILE"
}

# set_secret <NAME> <value> / set_var <NAME> <value> - GitHub Actions.
set_secret() {
  command -v gh >/dev/null 2>&1 || { warn "gh not installed, skipping secret $1"; return 0; }
  if [ "$DRY_RUN" = "1" ]; then step "(dry run) would set secret $1"; return 0; fi
  printf '%s' "$2" | gh secret set "$1" --body - >/dev/null && step "Set repo secret $1"
}
set_var() {
  command -v gh >/dev/null 2>&1 || { warn "gh not installed, skipping variable $1"; return 0; }
  if [ "$DRY_RUN" = "1" ]; then step "(dry run) would set variable $1"; return 0; fi
  gh variable set "$1" --body "$2" >/dev/null && step "Set repo variable $1"
}

# run_cmd <description> <command...> - shows the command, confirms, runs it with
# the human's own authority. This is the point of a wizard for anything the
# agent is not permitted to do itself. Always back up first.
run_cmd() {
  local desc="$1"; shift
  step "$desc"
  printf '  %s%s%s\n' "$DIM" "$*" "$RST"
  if [ "$DRY_RUN" = "1" ]; then note "(dry run, not executed)"; return 0; fi
  confirm "Run it?" || { warn "Skipped."; return 0; }
  "$@"
}

finish() {
  if [ -t 1 ]; then clear; fi
  printf '%s\n\n' "${B}${GRN}Done.${RST}"
  if [ ${#ROLLBACK_NOTES[@]} -gt 0 ]; then
    printf '%s\n' "${B}Rollback${RST}"
    printf '%s\n' "  Backups: $BACKUP_DIR"
    for line in "${ROLLBACK_NOTES[@]}"; do printf '  %s\n' "$line"; done
    printf '\n'
  fi
}

# ============================ STAGES ============================
# Author below. One `stage` call per step, in dependency order. Set
# TOTAL_STAGES to the number you wrote. Open the URL before asking for its
# value, use ask_secret for anything secret, back up before any mutation, and
# confirm before anything irreversible.

TOTAL_STAGES=1

stage "Example: capture an API key"
say "Replace this stage. It shows the shape only."
open_url "https://example.com/dashboard/api-keys"
step "Developers, then API keys, then Reveal test key, then copy it."
ask_secret EXAMPLE_KEY "Paste the test key"
write_env "EXAMPLE_API_KEY" "$EXAMPLE_KEY"

finish
