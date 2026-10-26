#!/bin/bash
# Weekly job scan — systemd user timer job-scan.timer (Mondays 07:00, Persistent catch-up).
# No model: runs job_scan.py in the vault job-search folder, which reads the Excel tracker
# (read-only) and rewrites the vault note "Job scan — weekly.md". Never writes Excel.
# Log lines: "<ts> OK: new=N closed=N unreadable=N manual=N current=N" / "<ts> FAIL ...".
# harness-check.sh reads the log: stale after 9 days, and names new/closed postings for 3 days.

LOG_FILE="$HOME/.claude/hooks/job-scan.log"
DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

PY=$(command -v python3) || { log "FAIL: python3 not found"; exit 1; }
[ -f "$DIR/job_scan.py" ] || { log "FAIL: $DIR/job_scan.py missing"; exit 1; }

log "START"
out=$(cd "$DIR" && "$PY" job_scan.py 2>&1)
code=$?
last=$(printf '%s\n' "$out" | tail -1)
if [ "$code" -eq 0 ]; then
    log "OK: $last"
else
    log "FAIL (exit $code): $last"
    exit 1
fi
