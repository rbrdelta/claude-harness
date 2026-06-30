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

# Count window-log rows dated within the current week (rows like: | 2026-07-03 | 1 | ...)
LOGGED=$(grep -oE '^\| 2026-[0-9]{2}-[0-9]{2} ' "$CHARTER" 2>/dev/null \
    | tr -d '| ' \
    | awk -v w="$WEEK_START" '$1 >= w' \
    | wc -l | tr -d ' ')

cat <<EOF
[JULY FOCUS — Research-PM, all-in | week-to-date: ${LOGGED}/4 core windows]
HARD RULE this session (Charter: "July 2026 Charter — Research PM, All-In"). Before engaging whatever the user opens with, your FIRST message must propose the next core window from the spine — Shadow Ledger strain arc (primary) or Anticipation Prototype (secondary), framed as a Build / Learn / Write-share window (default mix 2 build / 1 learn / 1 write-share, flexible). If the user's opening request is NOT on-spine, name that plainly, state the on-spine alternative, and ask Daniel for a good reason to deviate. Do not silently comply with off-spine work — proceed only after he gives the reason. This is Daniel's standing instruction for all of July; it self-expires Aug 1.
EOF
exit 0
