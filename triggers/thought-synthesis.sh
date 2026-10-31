#!/bin/bash
# Thought synthesis — run by weekly-sprint-review.sh before the prep (or by hand for the backlog).
# Daniel, 2026-10-29: "The point is not to capture each of them independently. It's for you to start
# synthesizing them. So that has to be a separate job."
# 1. context pass (Sonnet): trace each open thought to its source and to what came of it
# 2. synthesis pass (Opus): fold them into the living note, propose closes for thoughts already done
# 3. apply: done thoughts -> Closed, the rest -> Synthesized, each with its reason on the Notion row
# Personal-flagged rows are left out and stay open.
# Triage is the job's, not Daniel's (2026-10-30): "I also expect you to be able to do that on your own so that it
# doesn't require my review all the time." A thought already covered by a rule, the thesis or a build is closed.
# Usage: thought-synthesis.sh [limit]   (default 40, oldest first)
#        thought-synthesis.sh triage    (re-sort every Synthesized row and the note into the shape below)

LOG_FILE="$HOME/.claude/hooks/thought-synthesis.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/claude-harness"
NOTE="/mnt/c/MCP/Inbox/Thought Synthesis.md"
LIMIT="${1:-40}"
MODE=synthesize
[ "$1" = "triage" ] && MODE=triage

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

SHAPE="Keep the note to this shape (Daniel, 2026-10-30: cut the list; only what is new or needs him reaches him):
- Frontmatter: title \"Thought Synthesis\", source: thought-synthesis, tags [synthesis], updated: today.
- '## What changed (<today>)': what moved this run, short. Replace it each run.
- '## Live themes': at most five, the ones that bear on the newest NorthStar PRIORITIES. Each: a '### <name>' heading, one line on why it matters to a priority, his two to four strongest quotes verbatim with date and source (never paraphrase his words), 'Claude's read:' (marked as yours: what is emerging, a tension, a post or thesis line), and 'His call:' the decision or next step that is his, if any. This is the only part the weekly retro shows him. Holding opposites stays a live theme until he closes it (2026-10-30: his thesis that the best creators and leaders hold two opposing thoughts, and that his tenets should evolve into a set of paradoxes rather than hard rules). The record of why also stays a live theme, never closed (Daniel, 2026-10-30: \"the record of why should always be present\").
- '## How he learns and creates': tracked over time, never closed (Daniel, 2026-10-30: \"how I learn and how I evolve is kind of always an ongoing process ... that's something I do want to track over time\"). How he learns, how he works, his creative process: his quotes verbatim with dates, oldest first, and a short 'Claude's read:' on what is changing. New thoughts of this kind are added here, not closed as covered. Craft and making things with his hands are part of his creative process (2026-10-30: \"just part of the creation process ... doing it with your hands and actually experiencing it\"): add one if it says something new about the process, otherwise close it as covered by that line.
- '## Leads for the venture hypothesis': thoughts that are leads for the 2027 business hypothesis, one line each (short verbatim quote, date).
- '## Kept for reference': thoughts that say who he is or what he cares about but bear on no current priority (his standard, his prose, product observations not in a live theme; kept for when he is curious). Short headings, one line each (short verbatim quote, date). Never reviewed weekly; source material for his own personal writing (CLAUDE.md rule 16).
- '## Closed': one line each for every thought closed (done or covered), with where it landed or what covers it. Kept across runs.
Day-job (JPMC) material never goes in.

Triage on your own; do not leave it to him. Close a thought (decision Closed) when the record shows it was done, or when it is covered: the same idea is already a CLAUDE.md rule (~/.claude/CLAUDE.md), already his research thesis or an active experiment's question (NorthStar, the sound experiment), already built, or a near-duplicate of a thought kept in the note (keep his strongest wording, close the rest pointing to it). His example: fifteen thoughts on whether the model can hear and whether that changes what it does are the sound experiment; close them. Never close a thought only because it seems minor: it goes to Kept for reference. Never drop a thought silently: every one is in a section or in Closed.

Decisions JSON: one element for EVERY url you were given: {\"url\", \"decision\": \"Closed\" or \"Synthesized\", \"why\": \"Done: <where>\" or \"Covered: <rule, thesis, build or kept thought>\" or \"Theme: <name>\" or \"Lead\" or \"Reference: <heading>\"}."

if [ "$MODE" = "triage" ]; then
    ROWS_FILE="$OUTPUT_DIR/synthesis-triage-rows-$STAMP.json"
    python3 "$PUBLISH" synthesized > "$ROWS_FILE" 2>>"$LOG_FILE" || { log "FAIL: could not list synthesized thoughts"; exit 1; }
    COUNT=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$ROWS_FILE")
    [ -f "$NOTE" ] && cp "$NOTE" "$OUTPUT_DIR/thought-synthesis-before-triage-$STAMP.md"
    TRIAGE_PROMPT="You keep Daniel's thought synthesis: $NOTE. He leads the thinking; you are a thought partner (CLAUDE.md rule 17), and the triage is yours. Read the note (it holds each thought's context and what came of it), $ROWS_FILE (every thought currently marked Synthesized, with its url, quote and current placement), ~/.claude/CLAUDE.md, and /mnt/c/MCP/Meta/NorthStar.md (the newest PRIORITIES). Rewrite the note in place, re-sorting every thought.

$SHAPE

Write the decisions JSON to $DECISIONS_FILE."
    ( cd "$WORK_DIR" && claude -p "$TRIAGE_PROMPT" --model opus --allowedTools "Read,Write,Edit,Grep,Glob" --permission-mode bypassPermissions >/dev/null 2>&1 )
    if [ ! -s "$DECISIONS_FILE" ] || [ ! -f "$NOTE" ]; then
        log "FAIL: triage pass did not write the note and decisions ($COUNT thoughts); nothing applied"
        exit 1
    fi
    if python3 "$PUBLISH" apply "$DECISIONS_FILE" >> "$LOG_FILE" 2>&1; then
        log "OK: triage of $COUNT thoughts; closed $(grep -o '"Closed"' "$DECISIONS_FILE" | wc -l)"
        exit 0
    fi
    log "FAIL: could not apply triage decisions from $DECISIONS_FILE"
    exit 1
fi

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

Read the note, then $CONTEXT_FILE (new thoughts with their context). Also read /mnt/c/MCP/Meta/NorthStar.md (the newest PRIORITIES section) so you can say how a theme bears on what matters to him, and ~/.claude/CLAUDE.md so you can tell when a thought is already a rule.

Merge the new thoughts in.

$SHAPE

Write the decisions JSON to $DECISIONS_FILE (one element per url in the context file)."
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
