#!/usr/bin/env bash
# Thin wrapper over tmux send-keys for the dev session.
# Usage: scripts/send.sh '/conductor' Enter
set -euo pipefail

SESSION="${CONDUCTOR_SESSION:-conductor-dev}"
exec tmux send-keys -t "$SESSION" "$@"
