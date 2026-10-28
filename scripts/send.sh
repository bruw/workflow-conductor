#!/usr/bin/env bash
# Usage: scripts/send.sh -l '/conductor'; sleep 1; scripts/send.sh Enter
set -euo pipefail

SESSION="conductor-dev"
exec tmux send-keys -t "=$SESSION:" "$@"
