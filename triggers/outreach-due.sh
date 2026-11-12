#!/bin/bash
# Outreach follow-ups — systemd user timer outreach-due.timer (daily 07:15, Persistent catch-up).
# No model: runs outreach_view.py --due in the vault job-search folder, which reads the Excel
# tracker (read-only), rewrites the send list in the week note and the outreach plan's status block, and prints
# follow-ups due that were not pushed before (key<TAB>text). Each goes on Daniel's Tactical
# checklist in Phone Notes; its key is then recorded so it is pushed once.
# Log lines: "<ts> OK: due=N pushed=N" / "<ts> FAIL ...".

LOG_FILE="$HOME/.claude/hooks/outreach-due.log"
DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"
export OUTREACH_STATE="${OUTREACH_STATE:-$HOME/.claude/hooks/outreach-due.sent}"
TACTICAL="${TACTICAL_ADD:-$HOME/projects/active/phone-notes/scripts/tactical-add.mjs}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
PY=$(command -v python3) || { log "FAIL: python3 not found"; exit 1; }
command -v node &>/dev/null || { log "FAIL: node not found"; exit 1; }
[ -f "$DIR/outreach_view.py" ] || { log "FAIL: $DIR/outreach_view.py missing"; exit 1; }

log "START"
out=$(cd "$DIR" && "$PY" outreach_view.py --due 2>&1)
code=$?
[ "$code" -eq 0 ] || { log "FAIL (exit $code): $(printf '%s\n' "$out" | tail -1)"; exit 1; }

due=0; pushed=0; failed=0
while IFS=$'\t' read -r key text; do
    [ -n "$key" ] && [ -n "$text" ] || continue
    due=$((due + 1))
    if node "$TACTICAL" "Follow up, $text" --from "Outreach cadence" >/dev/null 2>&1; then
        echo "$key" >> "$OUTREACH_STATE"; pushed=$((pushed + 1))
    else
        failed=$((failed + 1))
    fi
done <<< "$out"

if [ "$failed" -eq 0 ]; then
    log "OK: due=$due pushed=$pushed"
else
    log "FAIL: due=$due pushed=$pushed failed=$failed (Tactical write)"
    exit 1
fi
