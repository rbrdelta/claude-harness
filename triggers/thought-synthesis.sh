#!/bin/bash
# Thought synthesis — run by weekly-sprint-review.sh before the prep (or by hand for the backlog).
# Daniel, 2026-10-29: "The point is not to capture each of them independently. It's for you to start
# synthesizing them. So that has to be a separate job."
# 1. context pass (Sonnet): trace each open thought to its source and to what came of it
# 2. synthesis pass (Opus): fold them into the living note, propose closes for thoughts already done
# 3. apply: done thoughts -> Closed, the rest -> Synthesized, each with its reason on the Notion row
# Personal-flagged rows are left out and stay open.
# Usage: thought-synthesis.sh [limit]   (default 40, oldest first)

LOG_FILE="$HOME/.claude/hooks/thought-synthesis.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/claude-harness"
NOTE="/mnt/c/MCP/Inbox/Thought Synthesis.md"
LIMIT="${1:-40}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"
STAMP=$(date +%Y-%m-%d-%H%M)
BATCH_FILE="$OUTPUT_DIR/synthesis-batch-$STAMP.json"
CONTEXT_FILE="$OUTPUT_DIR/synthesis-context-$STAMP.json"
DECISIONS_FILE="$OUTPUT_DIR/synthesis-decisions-$STAMP.json"
PUBLISH="$WORK_DIR/triggers/thought-scrub/publish.py"

python3 "$PUBLISH" open 2>>"$LOG_FILE" | python3 -c "
import json, sys
rows = [r for r in json.load(sys.stdin) if 'Personal' not in r.get('flags', [])]
json.dump(rows[:int(sys.argv[1])], open(sys.argv[2], 'w'), indent=1)
print(len(rows[:int(sys.argv[1])]))" "$LIMIT" "$BATCH_FILE" > "$OUTPUT_DIR/.synthesis-count" 2>>"$LOG_FILE" \
    || { log "FAIL: could not list open thoughts"; exit 1; }
COUNT=$(cat "$OUTPUT_DIR/.synthesis-count")
if [ "$COUNT" = "0" ]; then
    log "OK: no open thoughts to synthesize"
    exit 0
fi

CONTEXT_PROMPT="Gather context for Daniel's captured thoughts. Facts only; do not cluster or interpret. Input: $BATCH_FILE (thought, quote, where, written, source, url). For each row:
- Claude Code rows: 'where' names a session id prefix ('Claude Code session d1538f96 (shadow-ledger)'). Find ~/.claude/projects/*/<prefix>*.jsonl, find the user message holding the quote, read what came just before (what prompted it) and the turns after (what was done).
- iPhone, Notion, Obsidian, Claude.ai rows: find the source note in /mnt/c/MCP/Sources/ by grepping the quote; note what surrounds it and its date.
- Then check whether it was acted on: ~/.claude/CLAUDE.md, ~/.claude/projects/-home-rbr01/memory/, /mnt/c/MCP/Meta/NorthStar.md, the vault, repos in ~/projects/active/ (README, notes, CAPABILITIES.md, git log --oneline), and work items (node ~/projects/active/daily-standard/scripts/ds.mjs backlog).
Never read, search or list /mnt/c/MCP/Confidential/ (exclude it from every grep). Change nothing.
Write a JSON array to $CONTEXT_FILE, one element per row: {\"url\", \"thought\", \"said_in_full\": <verbatim, short>, \"written\", \"prompted_by\": <one or two sentences>, \"came_of_it\": <outcome with evidence: path, commit, date, or 'no follow-up found'>, \"status\": \"done\" | \"partly\" | \"open\" | \"unclear\"}. Say 'not found' rather than guess."
( cd "$WORK_DIR" && claude -p "$CONTEXT_PROMPT" --model sonnet --allowedTools "Bash,Read,Grep,Glob,Write" --permission-mode bypassPermissions >/dev/null 2>&1 )
if [ ! -s "$CONTEXT_FILE" ]; then
    log "FAIL: context pass produced nothing ($COUNT thoughts)"
    exit 1
fi

SYNTH_PROMPT="You keep Daniel's thought synthesis: $NOTE (create it if missing). Daniel, 2026-10-29: \"The point is not to capture each of them independently. It's for you to start synthesizing them\", into \"themes or posts or thoughts or a thesis or some kind of statement about the work that I'm doing or what I've learned or what is emerging or what is interesting or what might be worth sharing.\" He leads the thinking; you are a thought partner: \"if you see things emerging, like, you shouldn't hold back.\" His original ideas, conclusions and thesis are his; your read is marked as yours.

Read the note, then $CONTEXT_FILE (new thoughts with their context). Also read /mnt/c/MCP/Meta/NorthStar.md (the newest PRIORITIES section) so you can say how a cluster bears on what matters to him.

Rewrite the note in place:
- Frontmatter: title \"Thought Synthesis\", source: thought-synthesis, tags [synthesis], updated: today.
- '## What changed (<today>)' at the top: new clusters, clusters that grew, thoughts closed as done. Replace this section each run.
- One '## <cluster name>' per cluster. Under each: his quotes verbatim with date and source (never paraphrase his words); what came of each; then 'Claude's read:' what is emerging (a theme, a post, a thesis statement, a tension, an opportunity) and how it bears on his priorities; then 'Could become:' post / work item / thesis / nothing yet. Merge new thoughts into existing clusters where they fit; start a new cluster only when none fits. A cluster of one is fine.
- '## Done' at the end: thoughts the record shows already happened, each with where it landed (one line each, kept across runs).
- Day-job (JPMC) material never goes in.

Then write a JSON array to $DECISIONS_FILE with one element for EVERY url in the context file: {\"url\", \"decision\": \"Closed\" if status is done and the outcome is clearly evidenced, otherwise \"Synthesized\", \"why\": \"Done: <where it landed>\" or \"In cluster: <cluster name>\"}."
( cd "$WORK_DIR" && claude -p "$SYNTH_PROMPT" --model opus --allowedTools "Read,Write,Edit,Grep,Glob" --permission-mode bypassPermissions >/dev/null 2>&1 )
if [ ! -s "$DECISIONS_FILE" ] || [ ! -f "$NOTE" ]; then
    log "FAIL: synthesis pass did not write the note and decisions ($COUNT thoughts); nothing applied"
    exit 1
fi

if python3 "$PUBLISH" apply "$DECISIONS_FILE" >> "$LOG_FILE" 2>&1; then
    log "OK: $COUNT thoughts synthesized; closed $(grep -o '"Closed"' "$DECISIONS_FILE" | wc -l)"
else
    log "FAIL: could not apply decisions from $DECISIONS_FILE"
    exit 1
fi
exit 0
