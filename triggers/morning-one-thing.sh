#!/bin/bash
# Morning one-thing message — systemd morning-one-thing.timer, 07:30 (tools/morning-one-thing.mjs).
# Binaries resolved here, not via .bashrc.
LOG_FILE="$HOME/.claude/hooks/morning-one-thing.log"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v node &>/dev/null || { echo "$(date -Is) FAIL: node not found" >> "$LOG_FILE"; exit 1; }
exec node "$HOME/projects/active/claude-harness/tools/morning-one-thing.mjs"
