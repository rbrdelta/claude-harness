#!/bin/bash
# SessionStart hook — pull Notion backlog changes into config.
# Runs in background, logs results. Skips if no NOTION_TOKEN.

source ~/.zshenv 2>/dev/null

[ -z "$NOTION_TOKEN" ] && exit 0

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/backlog-pull-$(date +%Y-%m-%d).log"
SCRIPT_DIR="$HOME/projects/active/obsidian-mcp"

# Only run if compiled script exists
[ -f "$SCRIPT_DIR/dist/importers/notion_backlog_pull.js" ] || exit 0

(
  cd "$SCRIPT_DIR" && \
  VAULT_PATH=/mnt/c/MCP node dist/importers/notion_backlog_pull.js 2>&1 | \
  while read -r line; do
    echo "$(date -Iseconds) $line" >> "$LOG_FILE"
  done
) &

exit 0
