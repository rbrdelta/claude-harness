#!/bin/bash
# Weekly Retro Prep — systemd weekly-sprint-review.timer, Sundays 18:00.
# On success it opens the retro window (tools/retro-window.mjs): the retro session starts right away, for Sunday
# night (Daniel, 2026-11-22), and the retro holds one Now slot through Tuesday.
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
From the thought synthesis (`/mnt/c/MCP/Inbox/Thought Synthesis.md`, updated just before this prep): copy its "What changed" section and its "Live themes" (at most five; the rest of the note is reference and is not shown). Thoughts the synthesis closed as done this week: list them in one line each, so Daniel can pull any back. If the synthesis did not run, say so.

## 5. New seats this week
Copy `__SEATS_FILE__` here as written (the week'\''s postings, read and graded before this prep). If the file is missing or empty, say in one line that seat grading did not run this week, so the retro grades them. Do not grade seats yourself.

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

# New seats: the week's postings, read and graded before the retro (Daniel, 2026-11-10: "please research these
# new opportunities before the retro as part of the weekly retro prep"; "You can write the excel without a
# session."). Built 2026-11-23 after two weekly scans went ungraded: the scan ran Monday, after this prep, and
# nothing read it. job-scan.timer now runs Sunday 17:00; if today's scan is missing, run it here.
JOB_DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"
SEATS_FILE="$OUTPUT_DIR/retro-seats-$(date +%Y-%m-%d).md"
grep -q "^$(date +%Y-%m-%d) .* OK: new=" "$HOME/.claude/hooks/job-scan.log" 2>/dev/null \
    || bash "$WORK_DIR/triggers/job-scan.sh" || log "WARN: job scan failed before seat grading; see job-scan.log"
SEATS_PROMPT="Grade the week's new postings for Daniel's job search, unattended, before his weekly retro. Never submit an application, contact anyone, or draft outreach.
1. Read in full, no slicing: '$JOB_DIR/CLAUDE.md' (the folder's rules; follow them, especially rules 9, 10, 12 and 13, the targeting rules, and the Sidekick lessons of 2026-11-23) and '$JOB_DIR/screen_sim/JUDGE.md'.
2. Read '$JOB_DIR/Job scan — weekly.md'. The seats to grade: every line under 'New since last scan' and 'New on YC jobs', plus any seat a scan listed in the last 21 days that has no row in the Excel Pipeline sheet (see the 'Grade the week's postings' line in 'node ~/projects/active/daily-standard/scripts/ds.mjs backlog --json' for ones left over).
3. For each seat, check Pipeline first (same link, or same company and role). Already there: say so, and if its Status is Closed or Applied note that the posting is back. Not there: fetch the full posting (Ashby: https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true; Greenhouse: boards-api.greenhouse.io; YC: the data-page JSON on the job page) and save it to '$JOB_DIR/jds/<company>__<role>.txt'. Read it whole before judging; a posting you could not fetch is listed as not read, never graded.
4. Give every seat a Want (rule 10, appeal only, office-day adjustments). At Want 5 or more, write a screen judgment per JUDGE.md into '$JOB_DIR/screen_sim/judgments_scan_$(date +%Y%m%d)_<resume>/' against the resume text the newest results_*.json in screen_sim used, run 'python3 screen_sim.py <resume> <folder>' from '$JOB_DIR', and give a Human read. Fit and Tier per rule 12. Below Want 5: record only, with the reason.
5. Write Excel ('$JOB_DIR/tracker.py' names the file): copy it to '$OUTPUT_DIR/job_tracker_backup_$(date +%Y%m%d).xlsx' first, re-read the sheet, append one row per new seat with the columns a recent row uses (Source 'Weekly scan <date>' or 'YC jobs (weekly scan <date>)'), and apply 'Pipeline postings that closed' (Status Closed, a dated note saying what the status was). If the save fails (the file is open in Excel), write nothing and say so. Then run verify_tracker.py, score_view.py and outreach_view.py in '$JOB_DIR'.
6. Write '$SEATS_FILE': first what was read, what wasn't, and why; then the seats by tier (tier 1, 2, 3, 4), one line each with company, role, link, Want / Human / Screen, and the main gap in plain words; then record-only seats counted by reason; then postings already in Excel that came back; then closures applied; then whether Excel was written and verify_tracker's result. Plain words, no shorthand."
( cd "$WORK_DIR" && claude -p "$SEATS_PROMPT" --model opus --allowedTools "Bash,Read,Write,Edit,Glob,Grep" --permission-mode bypassPermissions >/dev/null 2>&1 )
[ -s "$SEATS_FILE" ] || log "WARN: seat grading produced nothing; the prep says so"

PROMPT="${PROMPT//__SESSIONS_FILE__/$SESSIONS_FILE}"
PROMPT="${PROMPT//__MOMENTS_FILE__/$MOMENTS_FILE}"
PROMPT="${PROMPT//__SEATS_FILE__/$SEATS_FILE}"

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
