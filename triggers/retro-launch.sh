#!/bin/bash
# Retro launcher — systemd retro-launch.timer, every 5 minutes. Starts the retro session once Daniel slots
# the retro on the Daily Standard (tools/retro-launch.mjs). Binaries resolved here, not via .bashrc.
LOG_FILE="$HOME/.claude/hooks/retro-launch.log"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
CLAUDE=$(command -v claude) || { echo "$(date -Is) FAIL: claude CLI not found" >> "$LOG_FILE"; exit 1; }
command -v node &>/dev/null || { echo "$(date -Is) FAIL: node not found" >> "$LOG_FILE"; exit 1; }
command -v tmux &>/dev/null || { echo "$(date -Is) FAIL: tmux not found" >> "$LOG_FILE"; exit 1; }
RETRO_CLAUDE="$CLAUDE" exec node "$HOME/projects/active/claude-harness/tools/retro-launch.mjs"
