#!/bin/bash
# Weekly vault reclassification
# Re-applies the current taxonomy (domain/mode/lifecycle tags) to all notes.
# Local, rule-based — no API calls. Runs in seconds for ~800 notes.
# Idempotent: unchanged notes are skipped.

SYNC_DIR="$HOME/projects/active/obsidian-mcp"
LOG_FILE="$HOME/.claude/hooks/vault-reclassify.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$SYNC_DIR" || { log "FAIL: Could not cd to $SYNC_DIR"; exit 1; }

log "START: Running vault reclassification..."
OUTPUT=$(VAULT_PATH=/mnt/c/MCP npx ts-node src/importers/reclassify.ts 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | grep -oP '\{.*\}' | tail -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
