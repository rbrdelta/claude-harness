#!/bin/bash
# Apple Notes vault sync wrapper
# Manual trigger (no cron — requires iPhone Shortcut first)
# Logs to the same format as vault-sync.sh and notion-sync.sh

SYNC_DIR="$HOME/projects/active/obsidian-mcp"
LOG_FILE="$HOME/.claude/hooks/apple-sync.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$SYNC_DIR" || { log "FAIL: Could not cd to $SYNC_DIR"; exit 1; }

log "START: Running Apple Notes sync..."
OUTPUT=$(npm run apple:sync 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
