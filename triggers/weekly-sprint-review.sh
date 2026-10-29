#!/bin/bash
# Weekly Retro Prep — systemd weekly-sprint-review.timer, Sundays 18:00.
# On success it opens the retro window: the retro holds one Now slot Monday and Tuesday (tools/retro-window.mjs).
# Outputs a PREP DOC (data + open questions) for Daniel to walk through via /retro.
# Claude's read is allowed, marked as such; Daniel's conclusions come from the live /retro session.

LOG_FILE="$HOME/.claude/hooks/weekly-sprint-review.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/claude-harness"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

# Headless run: SessionStart hooks that assume a human check HARNESS_SCHEDULED
export HARNESS_SCHEDULED=1

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# Native installer puts claude in ~/.local/bin, which cron/systemd PATH lacks.
export PATH="$HOME/.local/bin:$PATH"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running weekly retro prep..."

PROMPT='You are preparing data for Daniel'\''s weekly retrospective. You are NOT writing conclusions, verdicts, or pattern-match summaries. Your job is to surface data + open questions so Daniel can walk through the prep doc himself via /retro.

## Hard rules
- NO verdict line. NO "Week N: [summary]" closer.
- Progress claims need evidence (a commit, a work item closed, a result, an application sent). Where nothing can be evidenced, say nothing moved. Daniel judges what it means.
- Where you see something emerging across the data (a theme, a tension, a lesson), say it on its own line starting "Claude'\''s read:" with the evidence. Daniel leads the thinking and decides what holds (Daniel, 2026-10-29: "if you see things emerging, like, you shouldn'\''t hold back. You should be a thought partner."). Never present your read as his conclusion.
- Open questions go at the end. Daniel answers them in /retro, not you.

## Format (Daniel, 2026-10-29)
The retro asks first whether the week moved the needle on what matters, then reviews every build, then what to cut, then what is emerging from his thoughts. Daniel: "We should be actively questioning and challenging ourselves. Are we doing the important things?" Signal over noise: if a part has nothing, say so in one line.

Start the doc with one line: days since the last retro. The last retro is the newest `/mnt/c/MCP/Inbox/Retrospective — *.md` file, or the newest work item with id retro-YYYY-MM-DD and status done in `node ~/projects/active/daily-standard/scripts/ds.mjs backlog --json`. Also list any retro-* item marked skipped since then, with its recorded reason.

Sources for the week: `__SESSIONS_FILE__` (the sessions of the past 7 days, each line labeled Daniel: or Claude:; page through it with offsets), `git log --since="7 days ago"` in every repo under ~/projects/active/ and ~/.claude/skills, work items closed this week (`ds.mjs backlog --json`, closedAt), and `__MOMENTS_FILE__` (the build moments of the week).

## 1. Did we move the needle?
Daniel: "based on the things that we actually discussed and did this week, did we actually move the needle or make progress in the things that matter to us? ... And in what ways did we make progress? If you can'\''t accurately capture that and articulate that, then we haven'\''t done the right things."
- What matters: the newest PRIORITIES section of /mnt/c/MCP/Meta/NorthStar.md, quoted. For each priority: what moved this week, with evidence (commit, work item closed, application sent, result), or "nothing moved" if nothing did. Progress means the objective moved, not that sessions happened.
- Where the week went: the projects and topics the sessions and commits went to, roughly how much of the week each took (by sessions and commits), and which of them map to no priority.
- Claude'\''s read: are we doing the important things? Say it plainly, including when the honest answer is no or when effort was spread across too many things.

## 2. Build review
Every project with commits or sessions this week, however many. Daniel: "if there'\''s 10 things to review because we spread ourselves too thin, then the takeaway and the bigger picture should be, why are we working on 10 projects?" For each: what was built or changed (from commits), what we did right, what we did wrong, what we learned (use the build moments, quoted with their Daniel:/Claude: labels), and which priority it served. Then Claude'\''s read across the builds: what to improve, what to eliminate, and whether the number of projects itself is the finding.
End with: "What did we do right, what did we do wrong, what did we learn, what do we eliminate?"

## 3. Subtraction candidates
Bias to add is the default; this section counters it. List, with the evidence for each, things that may no longer earn their place. Facts only, no verdicts:
- Skills in ~/.claude/skills with no invocation in the last 30 days (grep session transcripts under ~/.claude/projects for "skill":"<name>" or <command-name>/<name>).
- Scheduled jobs whose log in ~/.claude/hooks/*.log shows FAIL on every run this week, or OK with nothing done (e.g. 0 imported every day).
- Hooks in ~/.claude/settings.json whose script is missing, date-expired, or errors in its log.
- Open work items (ds.mjs backlog --json) untouched for 21+ days, and the count in now (cap is 3).
- Memory files in ~/.claude/projects/-home-rbr01/memory/ whose open loop has a past date, or that repeat a rule already in ~/.claude/CLAUDE.md.
End the section with: "Which of these go, plus one more?"

## 4. What is emerging
From the thought synthesis (`/mnt/c/MCP/Inbox/Thought Synthesis.md`, updated just before this prep): copy its "What changed" section, then name the two or three clusters that bear most on the priorities in part 1, with one line each on why. Thoughts the synthesis closed as done this week: list them in one line each, so Daniel can pull any back. If the synthesis did not run, say so.

## Open questions for Daniel
3-5 questions drawn from the parts above, the first on part 1 (are we doing the important things). No status questions.

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

# Build moments: once a week, both sides of the week's sessions, kept only when they clear a strict bar.
# They feed the build review directly (since 2026-10-29 they no longer go to the Notion thought list).
mkdir -p "$OUTPUT_DIR"
SESSIONS_FILE="$OUTPUT_DIR/retro-sessions-$(date +%Y-%m-%d).md"
MOMENTS_FILE="$OUTPUT_DIR/retro-moments-$(date +%Y-%m-%d).json"
python3 "$WORK_DIR/tools/day-digest.py" --hours 168 --both --max-chars 600000 > "$SESSIONS_FILE" 2>>"$LOG_FILE"
MOMENTS_PROMPT="Read $SESSIONS_FILE in full (page through it with offsets): this week's Claude Code sessions between Daniel and Claude, each line labeled Daniel: or Claude:. Find build moments, and only three kinds count: (1) a result that surprised one of them (a prediction was wrong, a number came back different, something failed in a way nobody expected); (2) a decision whose reason applies beyond its project; (3) a correction, where one of them pushed back and the frame changed. Routine progress, fixes with no surprise, status updates and plans are NOT moments. Drop anything about Daniel's day job (JPMC). Keep at most 8, the strongest only; zero is a fine answer. Write a JSON array to $MOMENTS_FILE, each element: {\"thought\": \"<one plain line naming the moment, max 100 chars>\", \"quote\": \"<2-6 verbatim lines from the file, each kept with its Daniel: or Claude: label, max 1500 chars>\", \"source\": \"Claude Code\", \"where\": \"<project or directory>\", \"written\": \"<YYYY-MM-DD>\", \"strength\": \"Ready\" or \"Seed\" or \"Fragment\", \"flags\": []}. Quote, never paraphrase. Write [] if nothing qualifies."
( cd "$WORK_DIR" && claude -p "$MOMENTS_PROMPT" --model opus --allowedTools "Read,Write" --permission-mode bypassPermissions >/dev/null 2>&1 )
[ -s "$MOMENTS_FILE" ] || { echo "[]" > "$MOMENTS_FILE"; log "WARN: build-moments pass produced nothing"; }

# Thought synthesis: the week's open thoughts traced to their context and folded into the living note.
bash "$WORK_DIR/triggers/thought-synthesis.sh" || log "WARN: thought synthesis failed; see thought-synthesis.log"

PROMPT="${PROMPT//__SESSIONS_FILE__/$SESSIONS_FILE}"
PROMPT="${PROMPT//__MOMENTS_FILE__/$MOMENTS_FILE}"

OUTPUT_FILE="$OUTPUT_DIR/sprint-review-$(date +%Y-%m-%d).txt"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \
    --model opus \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
    --permission-mode bypassPermissions \
    2>&1)
EXIT_CODE=$?

echo "$OUTPUT" > "$OUTPUT_FILE"

# Success = a prep doc dated TODAY exists. exit 0 + any old prep file is not
# success (false-OK observed 2026-07-20: run produced nothing, logged OK).
PREP_FILE="/mnt/c/MCP/Inbox/Retro Prep — $(date +%Y-%m-%d).md"
if [ $EXIT_CODE -eq 0 ] && [ -f "$PREP_FILE" ]; then
    log "OK: prep doc written to $PREP_FILE — run /retro to walk through"
    node "$WORK_DIR/tools/retro-window.mjs" open >> "$LOG_FILE" 2>&1 || log "FAIL: retro-window open"
else
    log "FAIL (exit $EXIT_CODE): no prep doc dated today. Output tail: $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit 0
