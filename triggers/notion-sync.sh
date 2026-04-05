#!/bin/bash
# Automated Notion vault sync
# Runs daily via cron. Requires Notion token in ~/.notion_token

TOKEN_FILE="$HOME/.notion_token"
SYNC_DIR="$HOME/projects/active/obsidian-mcp"
LOG_FILE="$HOME/.claude/hooks/notion-sync.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Check if token file exists
if [ ! -f "$TOKEN_FILE" ]; then
    log "SKIP: No token file at $TOKEN_FILE"
    exit 0
fi

NOTION_TOKEN=$(cat "$TOKEN_FILE" | tr -d '[:space:]')

if [ -z "$NOTION_TOKEN" ]; then
    log "SKIP: Token file is empty"
    exit 0
fi

# Load nvm and run sync
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$SYNC_DIR" || { log "FAIL: Could not cd to $SYNC_DIR"; exit 1; }

log "START: Running Notion sync..."
OUTPUT=$(NOTION_TOKEN="$NOTION_TOKEN" npm run notion:sync 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
    log "OK: $SUMMARY"
else
    if echo "$OUTPUT" | grep -qi "401\|unauthorized\|forbidden\|invalid.*token"; then
        log "AUTH_EXPIRED: Notion token is no longer valid. Update ~/.notion_token"
        echo "" > "$TOKEN_FILE"
    else
        log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
    fi
fi

exit 0
