#!/bin/bash
# Weekly hiring-posts search (2026-11-12) — systemd user timer job-posts.timer (Mondays 07:30,
# Persistent catch-up), after job-scan. claude -p (Opus alias) with web search looks for posts
# from the last 8 days where a founder, product leader or hiring manager says they are hiring a
# product manager at an AI-native company (the Sam Packard post at Ramp is the model: it named
# who to message and what to send). Writes one vault note, rewritten each week:
#   /mnt/c/MCP/job search/2026 ai pm/Hiring posts — weekly.md
# Never writes Excel, never grades a seat (a session reads the full posting first, rule 13),
# never contacts anyone. OK only if the note exists and its frontmatter `updated:` is today.

LOG_FILE="$HOME/.claude/hooks/job-posts.log"
OUTPUT_DIR="$HOME/.claude/logs"
DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"
NOTE="$DIR/Hiring posts — weekly.md"
TODAY=$(date +%Y-%m-%d)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { log "FAIL: claude CLI not found"; exit 1; }

log "START"

PROMPT="You are a scheduled weekly job for Daniel's job search. Today is $TODAY.

Rules: never read anything under /mnt/c/MCP/Confidential/. Never write or edit the Excel tracker or any file except the one note named below. Never register, sign up, post, comment, log in, or contact anyone. Only certain facts: every item needs a link you opened or a search result you can cite; mark anything you could not confirm. Plain language, no shorthand, no emojis.

Goal: find public posts from the last 8 days where a founder, executive, product leader or hiring manager says they are hiring a product manager (founding PM, first PM, head of product, senior or principal PM, AI PM, product lead) at an AI-native company. Personal posts matter most because they often say who to message and what to send (example: a Ramp leader wrote 'DM me or Yeno Konya with something you've built'). Job-board listings alone are not the goal; the weekly scan covers those.

1. Read the targeting rules: the 'Targeting' section of \"$DIR/CLAUDE.md\" (company size, emerging over incumbents, markets, the production AI rule). Read the seats already tracked: run \`cd \"$DIR\" && python3 -c \"import openpyxl,tracker;ws=openpyxl.load_workbook(tracker.XLSX,read_only=True,data_only=True)['Pipeline'];[print(r[0],'|',r[1],'|',r[4]) for r in ws.iter_rows(min_row=2,values_only=True) if r[0]]\"\` (company, role, status).
2. Web search, several phrasings, for example: site:linkedin.com/posts hiring \"founding product manager\" AI; site:linkedin.com/posts \"we're hiring\" \"product manager\" agents; \"hiring our first PM\" AI; site:x.com hiring founding PM AI; Hacker News and Substack posts from founders hiring PMs. Prefer New York, then San Francisco and remote US; major markets in Europe or Asia are fine, say where.
3. For each post found: who posted (name and title), company, the role, location, what the post asks candidates to do or send (quote it, at most 20 words), the post date, the link, and the job posting link if the post names one. Mark 'Already tracked' when the company and role are in the tracker list from step 1. Add one line, marked 'Claude's read', on whether it looks to fit the targeting rules and why. Do not grade or rank seats.
4. Write \"$NOTE\" (replace it entirely) with frontmatter: title: \"Hiring posts — weekly\", updated: $TODAY, source: \"scheduled-agent\", tags: career, job-search. Open with one paragraph: which searches ran, how many results were read, what could not be read (LinkedIn often hides posts behind a login) and why. Then 'New this week' (not already tracked, best fits first), then 'Already tracked', then 'Searches that found nothing'. Say 'nothing found' rather than padding.
5. End your reply with one line exactly in this form: posts=N new=N tracked=N"

OUTPUT_FILE="$OUTPUT_DIR/job-posts-$TODAY.txt"
mkdir -p "$OUTPUT_DIR"
OUTPUT=$(cd "$DIR" && claude -p "$PROMPT" \
    --model opus \
    --allowedTools "Bash,Read,Write,Glob,Grep,WebSearch,WebFetch" \
    --permission-mode bypassPermissions 2>&1)
EXIT_CODE=$?
echo "$OUTPUT" > "$OUTPUT_FILE"

if [ "$EXIT_CODE" -ne 0 ]; then
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -1)"
    exit 1
fi
if [ ! -f "$NOTE" ]; then
    log "FAIL: run finished but $NOTE was not written"
    exit 1
fi
if ! grep -q "^updated: \"\?$TODAY" "$NOTE"; then
    log "FAIL: note frontmatter updated: is not $TODAY (last week's note left in place)"
    exit 1
fi
log "OK: $(echo "$OUTPUT" | tail -1)"
