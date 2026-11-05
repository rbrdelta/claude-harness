#!/bin/bash
# Backlog worker — systemd backlog-worker.timer, nightly at 1:30, after the midnight PM run has marked items.
# The work is in tools/backlog-worker.mjs. Binaries resolved here, not via .bashrc. One run at a time.
LOG_FILE="$HOME/.claude/hooks/backlog-worker.log"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL: claude CLI not found" >> "$LOG_FILE"; exit 1; }
command -v node &>/dev/null || { echo "$(date '+%Y-%m-%d %H:%M:%S') FAIL: node not found" >> "$LOG_FILE"; exit 1; }
exec 9>"$HOME/.claude/backlog-worker.lock"
flock -n 9 || exit 0
exec node "$HOME/projects/active/claude-harness/tools/backlog-worker.mjs"
