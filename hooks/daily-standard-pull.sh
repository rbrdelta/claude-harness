#!/bin/bash
# SessionStart hook — pull new Daily Standard completions from Cloudflare D1 and report
# anything not yet recorded in the harness. Silent when everything is current.
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
DS="$HOME/projects/active/daily-standard/scripts/ds.mjs"
[ -f "$DS" ] || exit 0
NODE=$(command -v node) || { echo "DAILY STANDARD: node not found"; exit 0; }
timeout 8 "$NODE" "$DS" pull >/dev/null 2>&1
"$NODE" "$DS" status 2>/dev/null
exit 0
