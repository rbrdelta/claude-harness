#!/bin/bash
# July 2026 hard-focus gate (SessionStart hook). Self-expires after 2026-07-31.
# Injects the Research-PM charter + this-week pace, and instructs Claude to open
# EVERY session by proposing the next core window and pushing back on off-spine work.
# Mechanism: SessionStart stdout is surfaced to the model as context. This is a
# strong standing instruction, not a hard block — enforcement is Claude following it.

TODAY=$(date +%Y-%m-%d)
START="2026-06-29"
END="2026-07-31"
# Lexicographic compare is valid for YYYY-MM-DD. No-op outside the focus window.
[[ "$TODAY" < "$START" || "$TODAY" > "$END" ]] && exit 0

CHARTER="/mnt/c/MCP/Inbox/July 2026 Charter — Research PM, All-In.md"
[ -f "$CHARTER" ] || exit 0

# Monday of the current week (ISO day-of-week; handles Sunday correctly)
dow=$(date +%u)
WEEK_START=$(date -d "-$((dow-1)) days" +%Y-%m-%d)

# Deterministic pace read-out with mode breakdown, via the shared gauge (guaranteed
# surface — SessionStart always fires, unlike the weekly cron). Falls back gracefully.
DIR="$(dirname "$(readlink -f "$0")")"
PACE=$("$DIR/july-pace-gauge.sh" --line 2>/dev/null)
[ -z "$PACE" ] && PACE="(pace gauge unavailable)"

echo "[JULY FOCUS — Research-PM, all-in | windows this week: ${PACE}]"

# Open-window carry-over: a declared-but-unshipped window lives as one line in the
# Charter above the log table. Surface it so the session resumes it instead of
# declaring a new one. Declarations survive compaction/session death this way.
OPEN_WINDOW=$(grep -m1 '^\*\*Open window:\*\*' "$CHARTER" 2>/dev/null | sed 's/^\*\*Open window:\*\* *//')
[ -n "$OPEN_WINDOW" ] && echo "OPEN WINDOW IN FLIGHT (resume it — do not declare a new one): ${OPEN_WINDOW}"

cat <<EOF
HARD RULE this session (Charter: "July 2026 Charter — Research PM, All-In"). Before engaging whatever the user opens with, your FIRST message must propose the next core window from the spine — Shadow Ledger strain arc (primary) or Anticipation Prototype (secondary), framed as a Build / Learn / Write-share window (default mix 2 build / 1 learn / 1 write-share, flexible). If an OPEN WINDOW line appears above, your proposal is to resume that window. If the user's opening request is NOT on-spine, name that plainly, state the on-spine alternative, and ask Daniel for a good reason to deviate. Do not silently comply with off-spine work — proceed only after he gives the reason. This is Daniel's standing instruction for all of July; it self-expires Aug 1.
WINDOW PROTOCOL (declare -> ship -> sign-off -> log). The burden of tracking is yours, not Daniel's — he only answers two prompts.
1. DECLARE at open: name the window (type + number) and its ONE deliverable — that declaration is the pre-registered definition of done. On Daniel's ok, write one line directly above the Window log table in the Charter: "**Open window:** <Type> #<n> — <deliverable> (declared YYYY-MM-DD)". Changing the deliverable mid-window is an explicit amendment Daniel approves, never a silent redefinition of done.
2. SHIP: the moment the declared deliverable ships (publish merge, finding committed+pushed), prompt Daniel: "<deliverable> shipped — log the row?" Never self-certify completion; no row is appended without his ok.
3. LOG on his ok: append the row to the Window log table, delete the Open-window line, then run july-pace-gauge.sh --line and confirm the count incremented — a malformed row silently doesn't count, so the gauge check is mandatory. The log is completion-only: a window without a logged row is not shipped, and a half-done session simply leaves its Open-window line standing for the next session.
EOF
exit 0
