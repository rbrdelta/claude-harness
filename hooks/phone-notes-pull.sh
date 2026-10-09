#!/bin/bash
# Timer job (phone-notes-pull.timer, every 30 min) — pull changed phone notes from D1 into
# the vault at Sources/Phone-Notes. Outcome lands in ~/.claude/phone-notes/status.json, which
# phone-notes-check.sh reads at session start. nvm sourced here: timers don't read .bashrc.
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
NODE=$(command -v node) || { echo "phone-notes pull: node not found"; exit 1; }
exec timeout 120 "$NODE" "$HOME/projects/active/phone-notes/scripts/pull.mjs"
