#!/bin/bash
# Outreach follow-ups — systemd user timer outreach-due.timer (daily 07:15, Persistent catch-up).
# No model: runs outreach_view.py --due in the vault job-search folder, which reads the Excel
# tracker (read-only), rewrites the send list in the week note and the outreach plan's status block, and prints
# follow-ups due that were not pushed before (key<TAB>text). They go on the day's outreach work
# item in the Daily Standard backlog ("M/D job search outreach", tools/outreach-to-backlog.mjs);
# each key is then recorded so it is pushed once. Not the Tactical checklist (Daniel, 2026-11-17
# retro: the checklist duplicated the backlog; job-search inputs live in the backlog only).
# Log lines: "<ts> OK: due=N pushed=N" / "<ts> FAIL ...".

LOG_FILE="$HOME/.claude/hooks/outreach-due.log"
DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"
export OUTREACH_STATE="${OUTREACH_STATE:-$HOME/.claude/hooks/outreach-due.sent}"
TO_BACKLOG="${OUTREACH_TO_BACKLOG:-$HOME/projects/active/claude-harness/tools/outreach-to-backlog.mjs}"

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

due=$(printf '%s\n' "$out" | grep -c $'\t')
[ "$due" -gt 0 ] || { log "OK: due=0 pushed=0"; exit 0; }
err=$(mktemp)
keys=$(printf '%s\n' "$out" | grep $'\t' | node "$TO_BACKLOG" 2>"$err")
code=$?
if [ "$code" -eq 0 ] && [ -n "$keys" ]; then
    printf '%s\n' "$keys" >> "$OUTREACH_STATE"
    log "OK: due=$due pushed=$(printf '%s\n' "$keys" | grep -c .)"
    rm -f "$err"
else
    log "FAIL: due=$due pushed=0 (backlog write: $(grep -v -i warning "$err" | tail -1))"
    rm -f "$err"
    exit 1
fi
