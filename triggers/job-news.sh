#!/bin/bash
# Monthly company + thesis news — systemd user timer job-news.timer (first Monday of the month,
# 08:00, Persistent catch-up). claude -p (Opus alias) searches the web for news on the companies
# in the Excel Companies tab (Connect first) and on the research thesis, and writes one vault note:
#   /mnt/c/MCP/job search/2026 ai pm/Company and thesis news — YYYY-MM.md
# Never writes Excel. OK only if this month's note exists after the run.

LOG_FILE="$HOME/.claude/hooks/job-news.log"
OUTPUT_DIR="$HOME/.claude/logs"
DIR="${JOB_SEARCH_DIR:-/mnt/c/MCP/job search/2026 ai pm}"
MONTH=$(date +%Y-%m)
NOTE="$DIR/Company and thesis news — $MONTH.md"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { log "FAIL: claude CLI not found"; exit 1; }

log "START"

PROMPT="You are a scheduled monthly news job for Daniel's job search. Today is $(date +%Y-%m-%d).

Rules: never read anything under /mnt/c/MCP/Confidential/. Never write or edit the Excel tracker or any file except the one note named below. Plain language: no shorthand, no codes; say what each thing is.

1. Read the companies: run \`cd \"$DIR\" && python3 -c \"import openpyxl,tracker;ws=openpyxl.load_workbook(tracker.XLSX,read_only=True,data_only=True)['Companies'];[print(r[:3]) for r in ws.iter_rows(values_only=True)]\"\` (company, label, Daniel's why). Also read \"$DIR/CLAUDE.md\" section on Companies, and the research thesis in /home/rbr01/projects/active/sound-lab (README) for context: human-model interaction (understand, influence, anticipate how models behave), functional emotions, whether sound and tone reach a model's emotional representations, open-weight audio models.
2. Web search news from the last 35 days:
   a. Every company labeled Connect: launches, research posts or papers, funding, leadership hires, anything touching voice, emotion, expressiveness, model behavior, evals, interpretability. Name people worth contacting when they publish something.
   b. Companies labeled Apply: funding, layoffs, acquisitions, leadership changes only.
   c. Pivot watch companies: one line each only if something material happened, and say whether it answers the question in Daniel's row.
   d. Thesis news, any source: functional emotions in models, emotion or prosody in audio and speech models, interpretability of audio models, model-behavior evals. Prefer primary sources (papers, lab blogs).
3. Write \"$NOTE\" with frontmatter (title, created, source: \"scheduled-agent\", tags: career, job-search, research). Sections: What matters this month (at most 5 lines, the things worth acting on), Connect companies, Apply companies, Pivot watch, Thesis news. Every item has a date and a link. Say \"nothing found\" rather than padding. Mark anything you could not verify.
4. End your reply with one line: the number of items written."

OUTPUT_FILE="$OUTPUT_DIR/job-news-$(date +%Y-%m-%d).txt"
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
log "OK: $(echo "$OUTPUT" | tail -1)"
