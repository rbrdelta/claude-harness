#!/bin/bash
# PostToolUse hook — auto-push backlog to Notion when config changes.
# Fires after Edit/Write; checks if the target was backlog_epics.json.
# Requires NOTION_TOKEN in environment (set in .zshenv).

INPUT=$(cat)

# Extract tool name and file path from hook JSON
TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
TOOL_INPUT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('tool_input',{})))" 2>/dev/null)

# Only fire on Edit or Write
case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

# Check if the file is backlog_epics.json
if ! echo "$TOOL_INPUT" | grep -q "backlog_epics.json"; then
  exit 0
fi

# Need NOTION_TOKEN
if [ -z "$NOTION_TOKEN" ]; then
  exit 0
fi

# Run push in background — don't block the session
SCRIPT_DIR="$HOME/projects/active/obsidian-mcp"
(
  cd "$SCRIPT_DIR" && \
  VAULT_PATH=/mnt/c/MCP node dist/importers/notion_backlog_push.js 2>&1 | \
  while read -r line; do
    echo "[auto-push] $line" >> "$HOME/.claude/logs/backlog-push-$(date +%Y-%m-%d).log"
  done
) &

exit 0
