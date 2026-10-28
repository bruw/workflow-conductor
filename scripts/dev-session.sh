#!/usr/bin/env bash
# Starts a detached tmux session running Claude Code with this mod loaded.
# Real-paint harness: drive it with scripts/send.sh, read it with scripts/capture.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="conductor-dev"
# A fixed path lets capture.sh find the log: without --debug-file its name is the session id.
DEBUG_LOG="$REPO/.capture/debug.log"

mkdir -p "$REPO/.capture"
: > "$DEBUG_LOG"

# `=`: this session and no other whose name starts with its name.
tmux kill-session -t "=$SESSION" 2>/dev/null || true
# Given as separate arguments, the command runs with no shell, so no path needs quoting.
tmux new-session -d -s "$SESSION" -x 160 -y 50 -c "$REPO" \
  claude --plugin-dir "$REPO" --debug --debug-file "$DEBUG_LOG"

echo "session:   $SESSION"
echo "debug log: $DEBUG_LOG"
echo "attach:    tmux attach -t '=$SESSION'"
echo "send keys: scripts/send.sh -l '/conductor'; sleep 1; scripts/send.sh Enter"
echo "capture:   scripts/capture.sh"
echo "stop:      tmux kill-session -t '=$SESSION'"
