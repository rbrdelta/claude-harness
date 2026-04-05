#!/bin/bash
# Weekly Sprint Review — runs via local cron, Fridays at 10pm
# Uses claude -p to run headlessly. No remote-control bridge needed.

LOG_FILE="$HOME/.claude/hooks/weekly-sprint-review.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/web/rowbyroh-website"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running weekly sprint review..."

PROMPT='You are Daniel'\''s /architect running a weekly sprint review.

## Task

Read the following files from the vault at /mnt/c/MCP and produce a progress assessment:

1. Read `/mnt/c/MCP/Inbox/Master Backlog.md` — check the "30-Day Shipping Sprint (2026-03-27 → 2026-04-27)" section
2. Read `/mnt/c/MCP/Inbox/PM Decisions — 2026-03-27.md` — the prioritization decisions
3. Read `/mnt/c/MCP/Inbox/Architect Handoff — 2026-03-27.md` — the original gap analysis

## Assessment

For each of the 7 sprint items, assess current status:
- Done (checkbox checked in backlog, or evidence of completion in the repo/vault)
- In progress (partial evidence)
- Not started

Check for evidence:
- Deadweight GitHub repo: run `ls ~/projects/active/deadweight/.git` and check if there'\''s a remote with `cd ~/projects/active/deadweight && git remote -v`
- Blog post / write-up: search vault with `grep -r '\''freight audit'\'' /mnt/c/MCP/Inbox/` or similar
- Eval suite: check for test files in Deadweight project
- Property manager calls: search vault for notes about composter outreach

## Readiness Scores

Update the three readiness scores based on what actually shipped:
- AI PM (Agentic Systems): baseline 65-70%
- Claude Certified Architect — Foundations: baseline 80-85%
- Solo Founder (Freight/Composter): baseline 55-60%

Be honest. If nothing moved, say so directly.

## Output

1. Write the assessment as a new markdown file at `/mnt/c/MCP/Inbox/Weekly Sprint Review — [today'\''s date YYYY-MM-DD].md` with this frontmatter:
```
---
title: "Weekly Sprint Review — [date]"
source: architect-session
tags:
  - handoff
  - architect
  - sprint-review
status: active
---
```

2. Update the Master Backlog checkboxes at `/mnt/c/MCP/Inbox/Master Backlog.md` to reflect current state (check off completed items).

3. End with a one-line verdict: "Week N: [summary]"'

OUTPUT_FILE="$OUTPUT_DIR/sprint-review-$(date +%Y-%m-%d).txt"
mkdir -p "$OUTPUT_DIR"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \
    --model claude-sonnet-4-6 \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
    --permission-mode bypassPermissions \
    2>&1)
EXIT_CODE=$?

echo "$OUTPUT" > "$OUTPUT_FILE"

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | grep -oP 'Week \d+:.*' | head -1)
    [ -z "$SUMMARY" ] && SUMMARY=$(echo "$OUTPUT" | tail -3 | head -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
