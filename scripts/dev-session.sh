#!/usr/bin/env bash
# Starts a detached tmux session running Claude Code with this mod loaded.
# Real-paint harness: drive it with scripts/send.sh, read it with scripts/capture.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="${CONDUCTOR_SESSION:-conductor-dev}"
COLS="${CONDUCTOR_COLS:-160}"
ROWS="${CONDUCTOR_ROWS:-50}"
# A fixed path lets capture.sh find the log: without --debug-file its name is the session id.
DEBUG_LOG="$REPO/.capture/debug.log"

# CONDUCTOR_EXTRA_PLUGIN_DIRS: more mods to load beside this one, as colon-separated paths.
# They collect in "$@", which `set -u` allows empty on any bash.
set --
rest="${CONDUCTOR_EXTRA_PLUGIN_DIRS:-}"
while [ -n "$rest" ]; do
  dir="${rest%%:*}"
  case "$rest" in *:*) rest="${rest#*:}" ;; *) rest="" ;; esac
  [ -n "$dir" ] || continue
  case "$dir" in /*) ;; *) dir="$REPO/$dir" ;; esac
  set -- "$@" --plugin-dir "$dir"
done

mkdir -p "$REPO/.capture"
: > "$DEBUG_LOG"

# `=`: this session and no other whose name starts with its name.
tmux kill-session -t "=$SESSION" 2>/dev/null || true
# Given as separate arguments, the command runs with no shell, so no path needs quoting.
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$REPO" \
  claude --plugin-dir "$REPO" "$@" --debug --debug-file "$DEBUG_LOG"

echo "session:   $SESSION (${COLS}x${ROWS})"
echo "debug log: $DEBUG_LOG"
echo "attach:    tmux attach -t '=$SESSION'"
echo "send keys: scripts/send.sh '/conductor' Enter"
echo "capture:   scripts/capture.sh"
echo "stop:      tmux kill-session -t '=$SESSION'"
