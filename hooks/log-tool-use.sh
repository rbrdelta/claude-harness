#!/bin/bash
# PreToolUse hook — logs every tool invocation to daily JSONL file
# Fast path: no jq dependency, pure bash

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/tool-use-$(date +%Y-%m-%d).jsonl"

# Read hook input from stdin (JSON with tool_name, tool_input, session_id)
INPUT=$(cat)

# Prepend timestamp and write
printf '{"ts":"%s","hook":%s}\n' "$(date -Iseconds)" "$INPUT" >> "$LOG_FILE"

# Exit 0 — never interfere with tool execution
exit 0
