#!/bin/bash
# SessionStart hook — full harness health check
# Must complete in <5s. Surfaces warnings for broken components.
# Replaces check-vault-sync.sh (subsumes all its checks + more).

warnings=""

# --- 1. Cron service ---
if ! pgrep -x cron > /dev/null 2>&1; then
    warnings="${warnings}CRON DOWN. "
fi

# --- 2. Vault sync sources ---
check_sync_source() {
    local name="$1" log_file="$2" stale_hours="$3"
    [ ! -f "$log_file" ] && echo "$name: NO LOG" && return
    local last_ok=$(grep "OK:" "$log_file" | tail -1 | cut -d' ' -f1-2)
    [ -z "$last_ok" ] && echo "$name: NEVER SYNCED" && return
    local last_sync=$(date -d "$last_ok" +%s 2>/dev/null)
    local now=$(date +%s)
    local age_hours=$(( (now - last_sync) / 3600 ))
    local last_entry=$(tail -1 "$log_file")
    if echo "$last_entry" | grep -q "AUTH_EXPIRED"; then
        echo "$name: AUTH EXPIRED (${age_hours}h)"
    elif echo "$last_entry" | grep -q "FAIL"; then
        echo "$name: FAILING (${age_hours}h)"
    elif echo "$last_entry" | grep -q "SKIP.*empty"; then
        echo "$name: KEY EMPTY (${age_hours}h)"
    elif [ "$age_hours" -ge "$stale_hours" ]; then
        echo "$name: STALE (${age_hours}h)"
    fi
}

w=$(check_sync_source "CLAUDE.AI SYNC" "$HOME/.claude/hooks/vault-sync.log" 24)
[ -n "$w" ] && warnings="$warnings$w. "
w=$(check_sync_source "NOTION SYNC" "$HOME/.claude/hooks/notion-sync.log" 48)
[ -n "$w" ] && warnings="$warnings$w. "
w=$(check_sync_source "APPLE NOTES" "$HOME/.claude/hooks/apple-sync.log" 168)
[ -n "$w" ] && warnings="$warnings$w. "

# --- 3. Weekly agent jobs ---
check_agent_job() {
    local name="$1" log_file="$2" stale_days="$3"
    [ ! -f "$log_file" ] && return  # No warning if never ran — first run hasn't happened yet
    local last_ok=$(grep "OK:" "$log_file" | tail -1 | cut -d' ' -f1-2)
    [ -z "$last_ok" ] && echo "$name: NEVER COMPLETED" && return
    local last_run=$(date -d "$last_ok" +%s 2>/dev/null)
    local now=$(date +%s)
    local age_days=$(( (now - last_run) / 86400 ))
    local last_entry=$(tail -1 "$log_file")
    if echo "$last_entry" | grep -q "FAIL"; then
        echo "$name: LAST RUN FAILED"
    elif [ "$age_days" -ge "$stale_days" ]; then
        echo "$name: STALE (${age_days}d)"
    fi
}

w=$(check_agent_job "SPRINT REVIEW" "$HOME/.claude/hooks/weekly-sprint-review.log" 10)
[ -n "$w" ] && warnings="$warnings$w. "
w=$(check_agent_job "NORTHSTAR" "$HOME/.claude/hooks/weekly-northstar-check.log" 10)
[ -n "$w" ] && warnings="$warnings$w. "
w=$(check_agent_job "DIGEST" "$HOME/.claude/hooks/weekly-digest.log" 10)
[ -n "$w" ] && warnings="$warnings$w. "

# --- 4. Remote-control bridge (informational) ---
if ! pgrep -f "claude remote-control" > /dev/null 2>&1; then
    warnings="${warnings}BRIDGE DOWN. "
fi

# --- 5. Output ---
if [ -n "$warnings" ]; then
    echo "HARNESS: ${warnings}Run /harness for details."
fi

exit 0
