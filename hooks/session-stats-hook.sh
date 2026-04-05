#!/bin/bash
# PostStop hook: log session stats after each session ends.
# Reads session_id from the hook JSON payload via stdin.

# Parse session_id from the hook event JSON
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
    exit 0
fi

# Run the stats parser for this session
python3 /home/rbr01/.claude/hooks/session-stats.py --session "$SESSION_ID" 2>/dev/null

exit 0
