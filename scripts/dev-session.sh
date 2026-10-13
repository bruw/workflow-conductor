#!/usr/bin/env bash
# Starts a detached tmux session running Claude Code with this mod loaded.
# Real-paint harness: drive it with scripts/send.sh, read it with scripts/capture.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${CONDUCTOR_SESSION:-conductor-dev}"
COLS="${CONDUCTOR_COLS:-160}"
ROWS="${CONDUCTOR_ROWS:-50}"
# Without --debug-file the log goes to ~/.claude/debug/<session-id>.txt;
# a fixed path lets capture.sh find it.
DEBUG_LOG="$REPO/.capture/debug.log"

# Extra mods to load beside this one, colon-separated paths (e.g. the probe:
# CONDUCTOR_EXTRA_PLUGIN_DIRS=spikes/probe scripts/dev-session.sh).
EXTRA=""
IFS=':' read -ra EXTRA_DIRS <<< "${CONDUCTOR_EXTRA_PLUGIN_DIRS:-}"
# (An empty array is unbound under `set -u` before bash 4.4.) Paths are quoted for the shell tmux runs the command in.
for dir in ${EXTRA_DIRS[@]+"${EXTRA_DIRS[@]}"}; do
  [ -n "$dir" ] || continue
  case "$dir" in /*) ;; *) dir="$REPO/$dir" ;; esac
  EXTRA="$EXTRA --plugin-dir $(printf '%q' "$dir")"
done

mkdir -p "$REPO/.capture"
: > "$DEBUG_LOG"

# `=`: this session and no other whose name starts with its name.
tmux kill-session -t "=$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$REPO" \
  "claude --plugin-dir $(printf '%q' "$REPO")$EXTRA --debug --debug-file $(printf '%q' "$DEBUG_LOG")"

echo "session:   $SESSION (${COLS}x${ROWS})"
echo "debug log: $DEBUG_LOG"
echo "attach:    tmux attach -t '=$SESSION'"
echo "send keys: scripts/send.sh '/conductor' Enter"
echo "capture:   scripts/capture.sh"
echo "stop:      tmux kill-session -t '=$SESSION'"
