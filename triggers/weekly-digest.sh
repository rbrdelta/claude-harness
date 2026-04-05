#!/bin/bash
# Weekly Status Digest — runs via local cron, Sundays at 1pm
# Uses claude -p to run headlessly. No remote-control bridge needed.

LOG_FILE="$HOME/.claude/hooks/weekly-digest.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/web/rowbyroh-website"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running weekly status digest..."

PROMPT='You are running as a scheduled weekly status digest agent on Daniel'\''s machine.

Your job:
1. Read `/mnt/c/MCP/Meta/NorthStar.md` to understand active projects, ventures, and next actions.
2. Search the vault for task-related notes:
   - Glob for `/mnt/c/MCP/Inbox/Tasks*` and `/mnt/c/MCP/Inbox/Weekly Digest*`
   - Grep across `/mnt/c/MCP/Sources/Claude-Conversations/` for recent action items, decisions, and commitments (search for patterns like '\''TODO'\'', '\''action item'\'', '\''next step'\'', '\''blocker'\'')
3. Read the most recent Weekly Digest note if one exists to compare progress.
4. Generate a weekly status rollup with these sections:
   - **Completed This Week** — tasks/commitments that were resolved
   - **In Progress** — active work across all projects
   - **Blocked** — items waiting on external dependencies
   - **Recommended Focus** — what to prioritize in the coming week, based on NorthStar priorities and blockers
5. Write the rollup to `/mnt/c/MCP/Inbox/Weekly Digest — YYYY-MM-DD.md` (use today'\''s date) with frontmatter:
   ```
   ---
   title: "Weekly Digest — YYYY-MM-DD"
   created: YYYY-MM-DDT13:00:00Z
   source: "scheduled-agent"
   tags:
     - digest
     - weekly
   status: "active"
   ---
   ```

Be concise. Focus on what changed, what'\''s stuck, and what matters most.'

OUTPUT_FILE="$OUTPUT_DIR/weekly-digest-$(date +%Y-%m-%d).txt"
mkdir -p "$OUTPUT_DIR"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \
    --model claude-sonnet-4-6 \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
    --permission-mode bypassPermissions \
    2>&1)
EXIT_CODE=$?

echo "$OUTPUT" > "$OUTPUT_FILE"

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -3 | head -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
