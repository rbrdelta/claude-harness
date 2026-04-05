#!/bin/bash
# Automated Claude.ai vault sync
# Runs via cron every 8 hours. Requires session key in ~/.claude_session_key
# If key is missing or expired, logs the failure and exits cleanly.

KEY_FILE="$HOME/.claude_session_key"
SYNC_DIR="$HOME/projects/active/obsidian-mcp"
LOG_FILE="$HOME/.claude/hooks/vault-sync.log"
SYNC_INDEX="/mnt/c/MCP/Sources/Claude-Conversations/.claude_sync_index.json"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Check if key file exists
if [ ! -f "$KEY_FILE" ]; then
    log "SKIP: No session key file at $KEY_FILE"
    exit 0
fi

SESSION_KEY=$(cat "$KEY_FILE" | tr -d '[:space:]')

if [ -z "$SESSION_KEY" ]; then
    log "SKIP: Session key file is empty"
    exit 0
fi

# Check if sync is needed (skip if less than 6 hours old)
if [ -f "$SYNC_INDEX" ]; then
    last_sync=$(stat -c %Y "$SYNC_INDEX" 2>/dev/null)
    now=$(date +%s)
    age_hours=$(( (now - last_sync) / 3600 ))
    if [ "$age_hours" -lt 6 ]; then
        log "SKIP: Last sync was ${age_hours}h ago (threshold: 6h)"
        exit 0
    fi
fi

# Load nvm and run sync
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$SYNC_DIR" || { log "FAIL: Could not cd to $SYNC_DIR"; exit 1; }

log "START: Running vault sync..."
OUTPUT=$(CLAUDE_SESSION_KEY="$SESSION_KEY" npm run sync 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    # Extract summary line
    SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
    log "OK: $SUMMARY"
else
    # Check if it's an auth error (expired key)
    if echo "$OUTPUT" | grep -qi "401\|unauthorized\|forbidden\|invalid.*session\|expired"; then
        log "AUTH_EXPIRED: Session key is no longer valid. Run: claude-sync-key"
        # Clear the key so we don't keep retrying with a bad one
        echo "" > "$KEY_FILE"
    else
        log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
    fi
fi

exit 0
