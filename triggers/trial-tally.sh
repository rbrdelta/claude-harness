#!/bin/bash
# Trial tally — systemd trial-tally.timer, 23:50 nightly (tools/trial-tally.mjs). Binaries resolved here, not via .bashrc.
LOG_FILE="$HOME/.claude/hooks/trial-tally.log"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node &>/dev/null || { echo "$(date -Is) FAIL: node not found" >> "$LOG_FILE"; exit 1; }
exec node "$HOME/projects/active/claude-harness/tools/trial-tally.mjs"
