#!/bin/bash
# Weekly Retro Prep — systemd weekly-sprint-review.timer, Sundays 18:00.
# On success it opens the retro window: the retro holds one Now slot Monday and Tuesday (tools/retro-window.mjs).
# Outputs a PREP DOC (data + open questions) for Daniel to walk through via /retro.
# Does NOT produce conclusions or verdicts — those come from the live /retro session.

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
- NO conclusions about whether things "moved" or "stalled" — present evidence, let Daniel judge.
- Where you see something emerging across the data (a theme, a tension, a lesson), say it on its own line starting "Claude'\''s read:" with the evidence. Daniel leads the thinking and decides what holds (Daniel, 2026-10-29: "if you see things emerging, like, you shouldn'\''t hold back. You should be a thought partner."). Never present your read as his conclusion.
- Open questions go at the end. Daniel answers them in /retro, not you.

## Format (Daniel, 2026-10-23)
Three parts, in this order, then open questions. Clarity on what we keep, add and remove, and why. Signal over noise: if a part has nothing, say so in one line.

Start the doc with one line: days since the last retro. The last retro is the newest `/mnt/c/MCP/Inbox/Retrospective — *.md` file, or the newest work item with id retro-YYYY-MM-DD and status done in `node ~/projects/active/daily-standard/scripts/ds.mjs backlog --json`. Also list any retro-* item marked skipped since then, with its recorded reason.

## 1. Threads to close
Copy the judge'\''s ranking from `__JUDGE_FILE__` verbatim (it was produced by a separate reviewer from the Notion Thought Review list). Add one line on top: the count of undecided threads and the age of the oldest (`python3 ~/projects/active/claude-harness/triggers/thought-scrub/publish.py stats`). Do not rewrite Daniel'\''s quoted words.

## 2. Build review: __BUILD_NAME__ (`__BUILD_DIR__`)
Facts only, no verdicts. Gather:
- Ship date (first deploy or first commit in `git log --reverse`) and the original problem, quoted from its plan, README or project CLAUDE.md.
- Feature list as it stands (README / plan / code).
- Changes since ship: `git log --oneline` count, sorted into added, fixed, trimmed (removed) from the commit messages. Pull requests if any (`gh pr list --state all`).
- Size then vs now: tracked lines of code at the first commit and at HEAD.
- Evidence of use, from the project'\''s own data where it exists (Daily Standard: completions per week from `ds.mjs pending`/backlog history; Phone Notes: notes pulled into `/mnt/c/MCP/Sources/Phone-Notes/` per week; others: say "no usage data — unknown"). Never estimate usage.
- Anything built that is not used, and anything trimmed since ship.
End with these questions for Daniel, unanswered: Does it solve the problem it was built for? Did it grow beyond that, and was the growth warranted? What should be trimmed?

## 3. Subtraction candidates
Bias to add is the default; this section counters it. List, with the evidence for each, things that may no longer earn their place. Facts only, no verdicts:
- Skills in ~/.claude/skills with no invocation in the last 30 days (grep session transcripts under ~/.claude/projects for "skill":"<name>" or <command-name>/<name>).
- Scheduled jobs whose log in ~/.claude/hooks/*.log shows FAIL on every run this week, or OK with nothing done (e.g. 0 imported every day).
- Hooks in ~/.claude/settings.json whose script is missing, date-expired, or errors in its log.
- Open work items (ds.mjs backlog --json) untouched for 21+ days, and the count in now (cap is 3).
- Memory files in ~/.claude/projects/-home-rbr01/memory/ whose open loop has a past date, or that repeat a rule already in ~/.claude/CLAUDE.md.
End the section with: "Which of these go, plus one more?"

## Open questions for Daniel
3-5 questions drawn only from the three parts above, each pointing at a decision (keep, park, close, trim, promote). No status questions.

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

# One shipped build per week, in rotation from the week of 2026-10-25.
BUILDS=("Daily Standard|$HOME/projects/active/daily-standard" "Phone Notes|$HOME/projects/active/phone-notes" "Claude Harness|$HOME/projects/active/claude-harness" "Prototipo|$HOME/.claude/skills/prototipo" "Sound Lab|$HOME/projects/active/sound-lab" "Partswatch|$HOME/projects/active/partswatch" "rowbyroh-website|$HOME/projects/active/web/rowbyroh-website" "Obsidian MCP|$HOME/projects/active/obsidian-mcp")
WEEK=$(( ( $(date +%s) - $(date -d 2026-10-25 +%s) ) / 604800 ))
BUILD="${BUILDS[$(( (WEEK % ${#BUILDS[@]} + ${#BUILDS[@]}) % ${#BUILDS[@]} ))]}"

# Build moments: once a week, both sides of the week's sessions, kept only when they clear a strict bar.
# They land in the same Notion list (Batch "Build moment") so they get decided and closed like Daniel's threads.
mkdir -p "$OUTPUT_DIR"
SESSIONS_FILE="$OUTPUT_DIR/retro-sessions-$(date +%Y-%m-%d).md"
MOMENTS_FILE="$OUTPUT_DIR/retro-moments-$(date +%Y-%m-%d).json"
python3 "$WORK_DIR/tools/day-digest.py" --hours 168 --both --max-chars 600000 > "$SESSIONS_FILE" 2>>"$LOG_FILE"
MOMENTS_PROMPT="Read $SESSIONS_FILE in full (page through it with offsets): this week's Claude Code sessions between Daniel and Claude, each line labeled Daniel: or Claude:. Find build moments, and only three kinds count: (1) a result that surprised one of them (a prediction was wrong, a number came back different, something failed in a way nobody expected); (2) a decision whose reason applies beyond its project; (3) a correction, where one of them pushed back and the frame changed. Routine progress, fixes with no surprise, status updates and plans are NOT moments. Drop anything about Daniel's day job (JPMC). Keep at most 8, the strongest only; zero is a fine answer. Write a JSON array to $MOMENTS_FILE, each element: {\"thought\": \"<one plain line naming the moment, max 100 chars>\", \"quote\": \"<2-6 verbatim lines from the file, each kept with its Daniel: or Claude: label, max 1500 chars>\", \"source\": \"Claude Code\", \"where\": \"<project or directory>\", \"written\": \"<YYYY-MM-DD>\", \"strength\": \"Ready\" or \"Seed\" or \"Fragment\", \"flags\": []}. Quote, never paraphrase. Write [] if nothing qualifies."
( cd "$WORK_DIR" && claude -p "$MOMENTS_PROMPT" --model opus --allowedTools "Read,Write" --permission-mode bypassPermissions >/dev/null 2>&1 )
if [ -s "$MOMENTS_FILE" ]; then
    python3 "$WORK_DIR/triggers/thought-scrub/publish.py" rows "$MOMENTS_FILE" "Build moment" >> "$LOG_FILE" 2>&1 || log "WARN: build moments not added to Notion"
else
    log "WARN: build-moments pass produced nothing"
fi

# The judge: a separate reviewer (Opus) ranks undecided threads, so the prep does not grade its own pile.
THREADS_FILE="$OUTPUT_DIR/retro-threads-$(date +%Y-%m-%d).json"
JUDGE_FILE="$OUTPUT_DIR/retro-judge-$(date +%Y-%m-%d).md"
python3 "$WORK_DIR/triggers/thought-scrub/publish.py" open > "$THREADS_FILE" 2>>"$LOG_FILE" || log "WARN: could not list open threads"
JUDGE_PROMPT="You are the judge for Daniel's weekly retro. Trim hard: he wants signal, not everything. $THREADS_FILE lists undecided threads (thought, strength, source, batch, created date, Notion url). Batch 'Build moment' rows are moments from his sessions with Claude, quoted with Daniel:/Claude: labels; every other batch is Daniel's own words. Judge which are seeds with real potential and which are noise. Write markdown to $JUDGE_FILE with three lists: (1) 'Your threads: decide this week', at most 5 non-Build-moment rows; (2) 'Build moments: decide this week', at most 3 Build moment rows, and after them one line on what this week's build moments reveal, if anything (no line if nothing); (3) 'Probably noise, close in bulk', at most 15 rows of any batch. Each entry: the thought quoted exactly, strength, date, url, and one line on why. Leave everything else out. Never paraphrase his words. If there are no undecided threads, write 'No undecided threads.'"
( cd "$WORK_DIR" && claude -p "$JUDGE_PROMPT" --model opus --allowedTools "Read,Write" --permission-mode bypassPermissions >/dev/null 2>&1 )
[ -s "$JUDGE_FILE" ] || { echo "Judge did not run this week; see weekly-sprint-review.log." > "$JUDGE_FILE"; log "WARN: judge produced nothing"; }
PROMPT="${PROMPT//__JUDGE_FILE__/$JUDGE_FILE}"
PROMPT="${PROMPT//__BUILD_NAME__/${BUILD%%|*}}"
PROMPT="${PROMPT//__BUILD_DIR__/${BUILD#*|}}"

OUTPUT_FILE="$OUTPUT_DIR/sprint-review-$(date +%Y-%m-%d).txt"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \
    --model sonnet \
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
