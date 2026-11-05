#!/bin/bash
# Automated Notion vault sync
# Runs every 6 hours (systemd notion-sync.timer). Requires Notion token in ~/.notion_token
# The token file is only ever read here: a failure, of any kind, never changes it.

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

# What the importer prints on a real 401 (notion_sync.ts). A bare "401" or "forbidden" is not proof:
# page titles and error text can contain those words, and a 403 is one page, not a dead token.
AUTH_FAILED='^Fatal: Error: Auth failed'
# A connection that never came up. Costs one retry; the next run is 6 hours away.
NETWORK_FAILED='^Fatal: .*(AggregateError|Timeout|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND)'

run_sync() {
    OUTPUT=$(NOTION_TOKEN="$NOTION_TOKEN" npm run notion:sync 2>&1)
    EXIT_CODE=$?
}

log "START: Running Notion sync..."
run_sync
if [ $EXIT_CODE -ne 0 ] && echo "$OUTPUT" | grep -qE "$NETWORK_FAILED"; then
    log "RETRY: connection problem, trying once more: $(echo "$OUTPUT" | grep -E "$NETWORK_FAILED" | tail -1)"
    sleep "${NOTION_RETRY_WAIT_S:-60}"
    run_sync
fi

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
    log "OK: $SUMMARY"
elif echo "$OUTPUT" | grep -qE "$AUTH_FAILED"; then
    log "AUTH_EXPIRED: Notion token is no longer valid. Update ~/.notion_token"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | grep -v '^npm notice' | tail -3 | tr '\n' ' ')"
fi

exit 0
