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

mkdir -p "$REPO/.capture"
: > "$DEBUG_LOG"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" -c "$REPO" \
  "claude --plugin-dir '$REPO' --debug --debug-file '$DEBUG_LOG'"

echo "session:   $SESSION (${COLS}x${ROWS})"
echo "debug log: $DEBUG_LOG"
echo "attach:    tmux attach -t $SESSION"
echo "send keys: scripts/send.sh '/conductor' Enter"
echo "capture:   scripts/capture.sh"
echo "stop:      tmux kill-session -t $SESSION"
