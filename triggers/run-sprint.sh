#!/bin/bash
# run-sprint.sh — discover and launch autonomous sprint scripts
# Usage:
#   bash ~/.claude/hooks/run-sprint.sh        # list available sprints
#   bash ~/.claude/hooks/run-sprint.sh d1     # fire sprint d1
#   bash ~/.claude/hooks/run-sprint.sh e1e2   # fire sprint e1e2

HOOKS_DIR="$HOME/.claude/hooks"

if [ -z "$1" ]; then
    echo "Available sprints:"
    echo ""
    for f in "$HOOKS_DIR"/sprint-*.sh; do
        [ -f "$f" ] || continue
        name=$(basename "$f" .sh | sed 's/^sprint-//')
        desc=$(head -2 "$f" | tail -1 | sed 's/^# //')
        echo "  $name  —  $desc"
    done
    echo ""
    echo "Usage: bash ~/.claude/hooks/run-sprint.sh <name>"
    exit 0
fi

SCRIPT="$HOOKS_DIR/sprint-$1.sh"

if [ ! -f "$SCRIPT" ]; then
    echo "No sprint script found: $SCRIPT"
    echo "Run without arguments to list available sprints."
    exit 1
fi

echo "Firing sprint: $1"
echo "Script: $SCRIPT"
echo "Log: $(grep 'LOG_FILE=' "$SCRIPT" | head -1 | cut -d'"' -f2)"
echo ""

bash "$SCRIPT"
exit $?
