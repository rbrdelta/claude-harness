#!/bin/bash
# Weekly Retro Prep — runs via local cron, Fridays at 10pm
# Outputs a PREP DOC (data + open questions) for Daniel to walk through via /retro.
# Does NOT produce conclusions or verdicts — those come from the live /retro session.

LOG_FILE="$HOME/.claude/hooks/weekly-sprint-review.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/claude-harness"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

# --- July 2026 focus pace nudge (self-expires after 2026-07-31) ---
# Pushes a Telegram readout of core-window pace vs 4/week. Independent of the
# retro-prep run below; no-op outside the July focus window.
TODAY=$(date +%Y-%m-%d)
if [[ "$TODAY" > "2026-06-30" && "$TODAY" < "2026-08-01" ]]; then
    CHARTER="/mnt/c/MCP/Inbox/July 2026 Charter — Research PM, All-In.md"
    if [ -f "$CHARTER" ]; then
        dow=$(date +%u)
        WK=$(date -d "-$((dow-1)) days" +%Y-%m-%d)
        N=$(grep -oE '^\| 2026-[0-9]{2}-[0-9]{2} ' "$CHARTER" 2>/dev/null \
            | tr -d '| ' | awk -v w="$WK" '$1 >= w' | wc -l | tr -d ' ')
        TG_TOKEN="$(grep TELEGRAM_BOT_TOKEN "$HOME/.claude/channels/telegram/.env" 2>/dev/null | cut -d= -f2)"
        TG_CHAT_ID="8691823610"
        if [ -n "$TG_TOKEN" ]; then
            if [ "$N" -lt 4 ]; then PACE="Behind pace — $((4-N)) to go this week."; else PACE="On pace."; fi
            MSG="[July Focus] Core windows this week: ${N}/4. ${PACE} Spine: Shadow Ledger strain arc + Anticipation Prototype."
            curl -s -o /dev/null "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
                -d "chat_id=${TG_CHAT_ID}" -d "text=${MSG}"
            log "July focus nudge sent: ${N}/4"
        fi
    fi
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running weekly retro prep..."

PROMPT='You are preparing data for Daniel'\''s weekly retrospective. You are NOT writing conclusions, verdicts, or pattern-match summaries. Your job is to surface data + open questions so Daniel can walk through the prep doc himself via /retro.

## Hard rules
- NO verdict line. NO "Week N: [summary]" closer.
- NO conclusions about whether things "moved" or "stalled" — present evidence, let Daniel judge.
- NO Claude-coined framings (no "themes," "buckets," "patterns emerging"). Surface raw signals.
- Open questions go at the end. Daniel answers them in /retro, not you.

## Task

Read the following files from the vault at /mnt/c/MCP:

1. `/mnt/c/MCP/Inbox/Master Backlog.md` — current sprint items + checkbox state
2. `/mnt/c/MCP/Inbox/PM Decisions — 2026-03-27.md` — prioritization decisions
3. All sprint contracts and handoffs from the past 7 days: `ls -lt /mnt/c/MCP/Inbox/Sprint* /mnt/c/MCP/Inbox/*Handoff* 2>/dev/null | head -20`
4. All debriefs from the past 7 days: `ls -lt /mnt/c/MCP/Inbox/Debrief* 2>/dev/null | head -10`

## Surface this data (no interpretation)

### Sprint items — current checkbox state
For each item in the 30-day shipping sprint, copy the checkbox line verbatim from the backlog. If a checkbox flipped this week, note the date from the handoff. Do not assess "in progress" vs "not started" — just show the state.

### Sprint metrics from this week
For each sprint contract found in the past 7 days, extract:
- Sprint name + date
- Mode declared (Crystallization/Discovery/Execution) — if field is missing, say "(no mode field)"
- Predicted drafts/cycles — if missing, say "(not predicted)"
- Actual drafts/cycles from the matching handoff — if missing, say "(not captured)"
- Mode match (Yes/No) from handoff — if missing, say "(not captured)"
- Frame held (Yes/No) from handoff — if missing or N/A, say so

Present this as a table. Don'\''t comment on it.

### Walk-through triggers fired
List which sprints from this week fired a walk-through trigger (drafts >50% over prediction, mode mismatch, frame did not hold, discovery mode, or "couldn'\''t articulate" flag). Just the list.

### Claude Code usage
Run `python3 ~/.claude/hooks/session-stats.py --trends-md --months 1` and include its output as a "## Claude Code Usage" section.

## Open questions for Daniel (the actual handoff)

End the prep doc with 3-5 open questions for Daniel to answer in /retro. Examples (do NOT copy verbatim — generate from the actual data):
- "Sprint X declared Crystallization but mode-match was No. What was the work actually?"
- "Drafts on Sprint Y exceeded prediction by 80%. Was the frame depth wrong upfront, or did the work shift mid-sprint?"
- "Three sprints this week skipped the Mode field. Should the contract template enforce it, or is the field optional?"

Questions should target framework adjustment decisions, not status updates.

## Output

Write the prep doc to `/mnt/c/MCP/Inbox/Retro Prep — [today'\''s date YYYY-MM-DD].md` with frontmatter:
```
---
title: "Retro Prep — [date]"
source: weekly-cron
tags:
  - retro-prep
status: active
---
```

End the file with this exact line:
`Ready for /retro walk-through. Open questions above.`'

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
    PREP_FILE=$(ls -t /mnt/c/MCP/Inbox/Retro\ Prep\ —\ *.md 2>/dev/null | head -1)
    log "OK: prep doc written to $PREP_FILE — run /retro to walk through"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
