#!/bin/bash
# Automated Claude.ai vault sync
# Runs via cron every 8 hours. Requires session key in ~/.claude_session_key
# If key is missing or expired, logs the failure and exits cleanly.

KEY_FILE="$HOME/.claude_session_key"
SYNC_DIR="$HOME/projects/active/obsidian-mcp"
LOG_FILE="$HOME/.claude/hooks/vault-sync.log"
SYNC_INDEX="/mnt/c/MCP/Sources/Claude-Conversations/.claude_sync_index.json"
ALERT_LOCKFILE="/tmp/vault-sync-alert.lock"

# Telegram alert config
TG_TOKEN="$(cat "$HOME/.claude/channels/telegram/.env" 2>/dev/null | grep TELEGRAM_BOT_TOKEN | cut -d= -f2)"
TG_CHAT_ID="8691823610"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Send a Telegram alert, at most once per 24h per message type
alert() {
    local type="$1" msg="$2"
    local lock="${ALERT_LOCKFILE}.${type}"
    if [ -f "$lock" ]; then
        local lock_age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || echo 0) ))
        [ "$lock_age" -lt 86400 ] && return
    fi
    if [ -n "$TG_TOKEN" ]; then
        curl -s -o /dev/null "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
            -d "chat_id=${TG_CHAT_ID}" -d "text=${msg}"
        touch "$lock"
    fi
}

# Load nvm early — needed for both Claude and Apple syncs
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$SYNC_DIR" || { log "FAIL: Could not cd to $SYNC_DIR"; exit 1; }

# --- Claude.ai sync ---
SKIP_CLAUDE=false

if [ ! -f "$KEY_FILE" ]; then
    log "SKIP: No session key file at $KEY_FILE"
    alert "key_missing" "[harness] Claude.ai sync: no key file. Create ~/.claude_session_key with your session key."
    SKIP_CLAUDE=true
fi

if [ "$SKIP_CLAUDE" = false ]; then
    SESSION_KEY=$(cat "$KEY_FILE" | tr -d '[:space:]')
    if [ -z "$SESSION_KEY" ]; then
        log "SKIP: Session key file is empty"
        alert "key_empty" "[harness] Claude.ai sync key is empty. Refresh: Desktop F12 > Cookies > sessionKey, then write to ~/.claude_session_key"
        SKIP_CLAUDE=true
    fi
fi

if [ "$SKIP_CLAUDE" = false ] && [ -f "$SYNC_INDEX" ]; then
    last_sync=$(stat -c %Y "$SYNC_INDEX" 2>/dev/null)
    now=$(date +%s)
    age_hours=$(( (now - last_sync) / 3600 ))
    if [ "$age_hours" -lt 6 ]; then
        log "SKIP: Last sync was ${age_hours}h ago (threshold: 6h)"
        SKIP_CLAUDE=true
    fi
fi

if [ "$SKIP_CLAUDE" = false ]; then
    log "START: Running vault sync..."
    OUTPUT=$(CLAUDE_SESSION_KEY="$SESSION_KEY" npm run sync 2>&1)
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
        log "OK: $SUMMARY"
    else
        if echo "$OUTPUT" | grep -qi "401\|unauthorized\|forbidden\|invalid.*session\|expired"; then
            log "AUTH_EXPIRED: Session key is no longer valid. Run: claude-sync-key"
            echo "" > "$KEY_FILE"
            alert "auth_expired" "[harness] Claude.ai session key expired. Refresh: Desktop F12 > Cookies > sessionKey, then write to ~/.claude_session_key"
        else
            log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
            alert "sync_fail" "[harness] Claude.ai sync failed (exit $EXIT_CODE). Check vault-sync.log."
        fi
    fi
fi

# --- Apple Notes sync ---
# Picks up exports from iPhone Shortcut → iCloud Drive.
# No-op if no new files landed since last sync.
APPLE_LOG="$HOME/.claude/hooks/apple-sync.log"

apple_log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$APPLE_LOG"
}

apple_log "START: Running Apple Notes sync..."
APPLE_OUTPUT=$(npm run apple:sync 2>&1)
APPLE_EXIT=$?

if [ $APPLE_EXIT -eq 0 ]; then
    APPLE_SUMMARY=$(echo "$APPLE_OUTPUT" | grep -oP '\{.*\}' | tail -1)
    apple_log "OK: $APPLE_SUMMARY"
else
    apple_log "FAIL (exit $APPLE_EXIT): $(echo "$APPLE_OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
