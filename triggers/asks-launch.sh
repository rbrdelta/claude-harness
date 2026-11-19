#!/bin/bash
# Ask session launcher — systemd asks-launch.timer, 07:30, 08:30 and 09:30. Starts at most one session a day
# with the open asks for Daniel to burn down (tools/asks-launch.mjs). Binaries resolved here, not via .bashrc.
LOG_FILE="$HOME/.claude/hooks/asks-launch.log"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
CLAUDE=$(command -v claude) || { echo "$(date -Is) FAIL: claude CLI not found" >> "$LOG_FILE"; exit 1; }
command -v node &>/dev/null || { echo "$(date -Is) FAIL: node not found" >> "$LOG_FILE"; exit 1; }
command -v tmux &>/dev/null || { echo "$(date -Is) FAIL: tmux not found" >> "$LOG_FILE"; exit 1; }
ASKS_CLAUDE="$CLAUDE" exec node "$HOME/projects/active/claude-harness/tools/asks-launch.mjs"
