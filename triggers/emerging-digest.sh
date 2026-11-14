#!/bin/bash
# "What's emerging" digest (2026-11-14) — systemd user timer emerging-digest.timer, Mon/Wed/Fri 08:00
# (after the 07:00 thought scrub), Persistent catch-up.
# Daniel, 2026-11-14: "every 2 or 3 days you're saying, based on the past 48 or 72 hours, here are the
# things you've talked about most. Here are the themes that are emerging ... give me like statistics and
# tables ... much more informal and sort of very lightweight."
#   1. window: everything he wrote in the last 3 days, from the thought scrub's daily bundles (all sources)
#   2. tagging pass (Opus): each piece of text gets topics; the topic names from earlier runs are reused
#   3. counts (tools/emerging-stats.py): threads per topic, change since last run, mentions per concept
#   4. read pass (Opus): a short entry from the counts, with Claude's read and "exploring or park?"
#   5. the entry goes to the top of the "What's emerging" note in Phone Notes (scripts/emerging-note.mjs)
# Family, health, money, relationships and day-job text is tagged hidden and never counted or shown.
# Never writes anything else: no work items, no other note. Log ~/.claude/hooks/emerging-digest.log

LOG_FILE="$HOME/.claude/hooks/emerging-digest.log"
OUTPUT_DIR="$HOME/.claude/logs"
STATE_DIR="${EMERGING_STATE:-$HOME/.claude/emerging}"
BUNDLES="${SCRUB_WORK:-$HOME/.claude/thought-scrub/work}"
HARNESS="${HARNESS_DIR:-$HOME/projects/active/claude-harness}"
NOTE_WRITER="${EMERGING_NOTE:-$HOME/projects/active/phone-notes/scripts/emerging-note.mjs}"
DS="${DS_CLI:-$HOME/projects/active/daily-standard/scripts/ds.mjs}"
DAYS="${EMERGING_DAYS:-3}"
TODAY=$(date +%Y-%m-%d)

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }
fail() { log "FAIL: $1"; exit 1; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || fail "claude CLI not found"
command -v node &>/dev/null || fail "node not found"

log "START"
mkdir -p "$STATE_DIR" "$OUTPUT_DIR"
RUN="$STATE_DIR/run-$TODAY"
mkdir -p "$RUN"
ITEMS="$RUN/items.json"; TAGS="$RUN/tags.json"; STATS="$RUN/stats.json"; ENTRY="$RUN/entry.md"
HISTORY="$STATE_DIR/history.json"
STATS_PY="$HARNESS/tools/emerging-stats.py"
rm -f "$TAGS" "$STATS" "$ENTRY"

W=$(python3 "$STATS_PY" window "$BUNDLES" "$DAYS" "$TODAY" "$ITEMS" 2>&1) || fail "window: $W"
log "window: $W"
COUNT=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))))" "$ITEMS")
if [ "$COUNT" = "0" ]; then
    log "OK: nothing written in the last $DAYS days, no entry"
    exit 0
fi

PREV_TOPICS=$(python3 -c "
import json,os,sys
h=json.load(open(sys.argv[1])) if os.path.exists(sys.argv[1]) else []
names=sorted({n for r in h[-6:] for n in r.get('topics',{})})
print(', '.join(names) if names else '(none yet: this is the first run)')" "$HISTORY")

TAG_PROMPT="You tag Daniel's own writing so a script can count what he has been talking about. Read $ITEMS: a JSON array of {i, source, where, written, text}, everything he wrote in the last $DAYS days (Claude Code sessions, Claude.ai, Notion, Phone Notes, his vault notes).

Topics: name what he is actually talking about, at the level he would recognize in a list (examples of the grain: 'Job search', 'Model interaction and emotion', 'Car-related businesses', 'Harness and automation', 'Sound experiment'). Reuse these names from earlier runs whenever they fit, spelled exactly the same, so counts compare across runs: $PREV_TOPICS. Add a new name only for something none of them covers. Give each item one to three topics. An item about family, health, money or relationships gets exactly [\"Personal (not shown)\"]; an item about his day job (JPMC, his manager, his team, internal projects) gets exactly [\"Day job (not shown)\"]. Short operational instructions to Claude (\"commit that\", \"yes\", \"run it\") get the topic of the work they are about.

Concepts: 8 to 15 specific ideas, products, people or phrases that recur across items (not the topic names themselves), each with the exact words or short phrases that signal it in his text (the script counts them case-insensitively on word boundaries, so pick terms that are specific: 'provenance' not 'data').

Write $TAGS as JSON exactly: {\"items\": [{\"i\": 0, \"topics\": [\"...\"]}, ...one per item, every i], \"concepts\": [{\"name\": \"...\", \"terms\": [\"...\"]}]}. Write nothing else."

OUT=$(cd "$RUN" && claude -p "$TAG_PROMPT" --model opus --allowedTools "Read,Write" --permission-mode bypassPermissions < /dev/null 2>&1)
EXIT=$?
echo "$OUT" > "$OUTPUT_DIR/emerging-tags-$TODAY.txt"
[ "$EXIT" -ne 0 ] && fail "tagging pass exit $EXIT: $(echo "$OUT" | tail -1)"
[ -s "$TAGS" ] || fail "tagging pass wrote no $TAGS"

S=$(python3 "$STATS_PY" stats "$ITEMS" "$TAGS" "$HISTORY" "$STATS" 2>&1) || fail "stats: $S"
log "stats: $S"

FOCUS=$(node "$DS" focus 2>/dev/null | head -5)
BACKLOG=$(node "$DS" backlog 2>/dev/null | grep -v -E '^\S+\s+(done|dropped)\s' | head -150)

READ_PROMPT="You write the 'What's emerging' entry for Daniel: a quick, informal read on what he has been talking about in the last $DAYS days. He reads it on his phone. He asked for it (2026-11-14): 'here are the things you've talked about most. Here are the themes that are emerging. Here's X concept that was mentioned 25 times ... Daniel is talking about a lot of car-related businesses in the recent days ... that could be an exploratory phase, or that is something maybe we put in the parking lot ... informal and sort of very lightweight.'

Read: $STATS (every number you may use; never compute or invent another), $TAGS and $ITEMS (to see what each topic actually is; quote him only verbatim and briefly). His three outcomes this week:
$FOCUS
Work items already on file (not done):
$BACKLOG

Write $ENTRY in this shape, plain markdown, only headings in bold text, bullets and short lines (the phone app shows no tables):
**Last $DAYS days:** N threads (by source in one line). Previous run: <date or 'first run'>.
**Talked about most** — one bullet per topic, most threads first: 'Topic: N threads (+k since last run / new)'. All topics, no cut.
**Said most** — the concepts: 'concept: N mentions in M threads'.
**What's emerging** (Claude's read) — two to four bullets: what is rising or new, what faded, a link between topics he may not have made. Mark it as your read; his conclusions stay his.
**Exploring or park?** — for each topic or concept that is getting real attention but serves none of the three outcomes and is not already a work item: one line naming it with its count and the question 'exploring for now, or park it?'. If nothing qualifies, write 'Nothing off-list this time.'
Keep it under 30 lines. No preamble, no sign-off, no emojis, no shorthand or codes (plain names), nothing from the hidden topics, never his day job. Write nothing else."

OUT=$(cd "$RUN" && claude -p "$READ_PROMPT" --model opus --allowedTools "Read,Write" --permission-mode bypassPermissions < /dev/null 2>&1)
EXIT=$?
echo "$OUT" > "$OUTPUT_DIR/emerging-read-$TODAY.txt"
[ "$EXIT" -ne 0 ] && fail "read pass exit $EXIT: $(echo "$OUT" | tail -1)"
[ -s "$ENTRY" ] || fail "read pass wrote no $ENTRY"

HEADING="$(date +'%a %-m/%-d') — last $DAYS days"
N=$(node "$NOTE_WRITER" "$HEADING" < "$ENTRY" 2>&1) || fail "note write: $(echo "$N" | tail -1)"
python3 "$STATS_PY" record "$STATS" "$HISTORY" >/dev/null || fail "could not record history"
find "$STATE_DIR" -maxdepth 1 -name 'run-*' -mtime +30 -exec rm -rf {} +
log "OK: $S"
