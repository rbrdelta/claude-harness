#!/bin/bash
# SessionStart hook — warn if the phone-notes pull failed or went stale. Silent when healthy.
CHECK="$HOME/projects/active/phone-notes/scripts/pull-check.sh"
[ -f "$CHECK" ] || { echo "WARNING phone-notes: $CHECK missing"; exit 0; }
exec bash "$CHECK"
