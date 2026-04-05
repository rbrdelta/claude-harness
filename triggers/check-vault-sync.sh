#!/bin/bash
# Session-start check: are all vault sync sources healthy?
# Checks Claude.ai, Notion, and Apple Notes sync logs.

check_source() {
    local name="$1"
    local log_file="$2"
    local stale_hours="$3"

    if [ ! -f "$log_file" ]; then
        echo "$name: NO LOG"
        return
    fi

    # Get last entry (any type)
    local last_entry=$(tail -1 "$log_file" 2>/dev/null)

    # Get last successful sync time from log
    local last_ok=$(grep "OK:" "$log_file" | tail -1 | cut -d' ' -f1-2)

    if [ -z "$last_ok" ]; then
        echo "$name: NEVER SYNCED"
        return
    fi

    local last_sync=$(date -d "$last_ok" +%s 2>/dev/null)
    local now=$(date +%s)
    local age_hours=$(( (now - last_sync) / 3600 ))

    # Check if last entry was a failure
    if echo "$last_entry" | grep -q "AUTH_EXPIRED"; then
        echo "$name: AUTH EXPIRED (last OK ${age_hours}h ago)"
    elif echo "$last_entry" | grep -q "FAIL"; then
        echo "$name: FAILING (last OK ${age_hours}h ago)"
    elif [ "$age_hours" -ge "$stale_hours" ]; then
        echo "$name: STALE (${age_hours}h)"
    fi
}

warnings=""

# Claude.ai — cron every 8h, stale after 24h
w=$(check_source "CLAUDE.AI SYNC" "$HOME/.claude/hooks/vault-sync.log" 24)
[ -n "$w" ] && warnings="$warnings$w. "

# Notion — cron daily, stale after 48h
w=$(check_source "NOTION SYNC" "$HOME/.claude/hooks/notion-sync.log" 48)
[ -n "$w" ] && warnings="$warnings$w. "

# Apple Notes — manual, stale after 7 days
w=$(check_source "APPLE NOTES" "$HOME/.claude/hooks/apple-sync.log" 168)
[ -n "$w" ] && warnings="$warnings$w. "

# Check cron service
if ! pgrep -x cron > /dev/null 2>&1; then
    warnings="${warnings}CRON NOT RUNNING. "
fi

if [ -n "$warnings" ]; then
    echo "VAULT SYNC: ${warnings}Run /sync for details."
fi

exit 0
