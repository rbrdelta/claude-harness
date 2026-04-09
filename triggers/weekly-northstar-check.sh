#!/bin/bash
# NorthStar Freshness Check — runs via local cron, Wednesdays at 1pm
# Uses claude -p to run headlessly. No remote-control bridge needed.

LOG_FILE="$HOME/.claude/hooks/weekly-northstar-check.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/claude-harness"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running NorthStar freshness check..."

PROMPT='You are running as a scheduled NorthStar freshness check agent on Daniel'\''s machine.

Your job:
1. Read `/mnt/c/MCP/Meta/NorthStar.md`.
2. Check the `updated` field in the YAML frontmatter. Calculate how many days since last update.
3. If the file was updated within the last 7 days, write a single line to `/home/rbr01/.claude/hooks/northstar-check.log`: "YYYY-MM-DD HH:MM:SS OK: NorthStar updated N days ago" and stop.
4. If it'\''s older than 7 days:
   a. Search for recent activity in the vault — Grep `/mnt/c/MCP/Sources/Claude-Conversations/` for files modified in the last 7 days (use `ls -lt` via Bash).
   b. Read the 3-5 most recently modified conversation notes.
   c. Compare the topics/decisions in those conversations against NorthStar'\''s sections: Next Actions, Blockers, Active Projects, Venture Portfolio.
   d. Identify which NorthStar sections are likely stale — e.g., a blocker that was resolved, a next action that was completed, a venture status that changed.
   e. Write an alert note to `/mnt/c/MCP/Inbox/NorthStar Stale Alert.md` with frontmatter:
      ```
      ---
      title: "NorthStar Stale Alert"
      created: YYYY-MM-DDT13:00:00Z
      source: "scheduled-agent"
      tags:
        - meta
        - alert
      status: "active"
      ---
      ```
      Include: days since last update, which sections appear stale, and specific evidence from recent conversations.
   f. Also log: "YYYY-MM-DD HH:MM:SS STALE: NorthStar is N days old. Alert written to Inbox."

Be specific about what'\''s stale and why. Don'\''t just say '\''Blockers may be outdated'\'' — say which blocker and what conversation suggests it changed.'

OUTPUT_FILE="$OUTPUT_DIR/northstar-check-$(date +%Y-%m-%d).txt"
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
