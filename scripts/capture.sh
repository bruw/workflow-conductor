#!/usr/bin/env bash
# Writes the dev session's screen and the mod's recent debug lines to .capture/ and prints both.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="conductor-dev"
OUT="$REPO/.capture"
DEBUG_LOG="$OUT/debug.log"

mkdir -p "$OUT"
tmux capture-pane -p -t "=$SESSION:" > "$OUT/screen.txt"
if [ -f "$DEBUG_LOG" ]; then
  { grep -i conductor "$DEBUG_LOG" || true; } | tail -n 80 > "$OUT/debug.txt"
else
  : > "$OUT/debug.txt"
fi

echo "=== $OUT/screen.txt ==="
cat "$OUT/screen.txt"
echo "=== $OUT/debug.txt ==="
cat "$OUT/debug.txt"
