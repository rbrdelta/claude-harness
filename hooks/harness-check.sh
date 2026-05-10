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

# --- 4. Git hygiene: active projects ---
for dir in ~/projects/active/*/; do
    [ ! -d "$dir" ] && continue
    name=$(basename "$dir")
    if [ ! -d "$dir/.git" ]; then
        # Skip parent dirs that only contain nested git repos (e.g. web/)
        has_nested_git=false
        for sub in "$dir"*/; do
            [ -d "$sub/.git" ] && has_nested_git=true && break
        done
        $has_nested_git && continue
        warnings="${warnings}NO GIT: $name. "
    else
        uncommitted=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l)
        if [ "$uncommitted" -gt 10 ]; then
            warnings="${warnings}DIRTY($uncommitted): $name. "
        fi
    fi
done
# Also check nested active dirs (e.g. ~/projects/active/web/*)
for dir in ~/projects/active/*/*/; do
    [ ! -d "$dir" ] && continue
    [ -d "$dir/.git" ] || continue  # only flag git repos here, not every subfolder
    name=$(basename "$(dirname "$dir")")/$(basename "$dir")
    uncommitted=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l)
    if [ "$uncommitted" -gt 10 ]; then
        warnings="${warnings}DIRTY($uncommitted): $name. "
    fi
done

# --- 5. Remote-control bridge (informational) ---
if ! pgrep -f "claude remote-control" > /dev/null 2>&1; then
    warnings="${warnings}BRIDGE DOWN. "
fi

# --- 5a. Remote-control log size (flag if >1MB so we can prune/rotate) ---
RC_LOG="$HOME/.claude/remote-control-health.log"
if [ -f "$RC_LOG" ]; then
    rc_bytes=$(stat -c %s "$RC_LOG" 2>/dev/null)
    if [ -n "$rc_bytes" ] && [ "$rc_bytes" -gt 1000000 ]; then
        rc_mb=$(( rc_bytes / 1048576 ))
        warnings="${warnings}REMOTE-CTL LOG ${rc_mb}MB. "
    fi
fi

# --- 5b. Retro prep ready ---
# Banner if a Retro Prep doc exists with no matching Retrospective written after it.
INBOX="/mnt/c/MCP/Inbox"
latest_prep=$(ls -t "$INBOX"/Retro\ Prep\ —\ *.md 2>/dev/null | head -1)
if [ -n "$latest_prep" ]; then
    prep_date=$(basename "$latest_prep" | sed -E 's/^Retro Prep — (.+)\.md$/\1/')
    matching_retro="$INBOX/Retrospective — ${prep_date}.md"
    walked=false
    if [ -f "$matching_retro" ] && [ "$matching_retro" -nt "$latest_prep" ]; then
        walked=true
    fi
    if ! $walked; then
        warnings="${warnings}RETRO PREP READY (${prep_date}): run /retro. "
    fi
fi

# --- 6. Catch-up sync: if vault sync is stale and key exists, fire it now ---
SYNC_SCRIPT="$HOME/.claude/hooks/vault-sync.sh"
KEY_FILE="$HOME/.claude_session_key"
VAULT_LOG="$HOME/.claude/hooks/vault-sync.log"

if [ -f "$SYNC_SCRIPT" ] && [ -f "$KEY_FILE" ]; then
    key_content=$(cat "$KEY_FILE" | tr -d '[:space:]')
    if [ -n "$key_content" ]; then
        needs_sync=false
        if [ ! -f "$VAULT_LOG" ]; then
            needs_sync=true
        else
            last_ok=$(grep "OK:" "$VAULT_LOG" 2>/dev/null | tail -1 | cut -d' ' -f1-2)
            if [ -z "$last_ok" ]; then
                needs_sync=true
            else
                last_ts=$(date -d "$last_ok" +%s 2>/dev/null)
                now=$(date +%s)
                age_hours=$(( (now - last_ts) / 3600 ))
                [ "$age_hours" -ge 8 ] && needs_sync=true
            fi
        fi
        if $needs_sync; then
            nohup bash "$SYNC_SCRIPT" > /dev/null 2>&1 &
        fi
    fi
fi

# --- 7. Output ---
if [ -n "$warnings" ]; then
    echo "HARNESS: ${warnings}Run /harness for details."
fi

exit 0
