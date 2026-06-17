#!/bin/bash
# PermissionRequest + PermissionDenied hook — logs every actual approval prompt
# and every auto-mode classifier block to a daily JSONL file.
#
# This captures the ONE signal transcripts can't: interruptions that were
# approved leave no transcript trace, so we record them here as they happen.
# Registered for both PermissionRequest and PermissionDenied; the payload's
# hook_event_name distinguishes the two.
#
# Fast path: no jq dependency, pure bash. Never interferes with the prompt.

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/permission-events-$(date +%Y-%m-%d).jsonl"

# Read hook input from stdin (JSON: hook_event_name, tool_name, tool_input,
# permission_mode, session_id, cwd, ...)
INPUT=$(cat)

# Prepend our own timestamp and write the full payload verbatim
printf '{"ts":"%s","event":%s}\n' "$(date -Iseconds)" "$INPUT" >> "$LOG_FILE"

# Exit 0 — observe only, never block or alter the permission flow
exit 0
