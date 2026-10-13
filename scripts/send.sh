#!/usr/bin/env bash
# Usage: scripts/send.sh '/conductor' Enter
set -euo pipefail

SESSION="${CONDUCTOR_SESSION:-conductor-dev}"
exec tmux send-keys -t "=$SESSION:" "$@"
