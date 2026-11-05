#!/bin/bash
# PostToolUse hook — injects a verify reminder after Edit/Write to project files.
# Fires after Edit/Write; maps file path to the project's verify command and emits
# a reminder Claude must act on before claiming the task is done.
#
# Exit code behavior:
#   0 = success (stderr output becomes a system reminder in Claude's context)
#   non-zero = silently ignored
#
# Philosophy: this hook doesn't run verify itself (verify can be slow/expensive).
# It reminds Claude *what* to run. Claude must either verify or explicitly
# state why verify is being skipped.

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_name',''))" 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)

case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

[ -z "$FILE_PATH" ] && exit 0

# Skip non-project files (memory, CLAUDE.md edits, hooks themselves, vault content)
case "$FILE_PATH" in
  */.claude/memory/*|*/MEMORY.md) exit 0 ;;
  */CLAUDE.md) exit 0 ;;
  */.claude/hooks/*|*/.claude/skills/*|*/.claude/settings*.json) exit 0 ;;
  */mnt/c/MCP/*|*/mnt/c/MCP-dev/*) exit 0 ;;
esac

PROJECT=""
VERIFY_CMD=""
VERIFY_DIR=""

case "$FILE_PATH" in
  */rowbyroh-website/*)
    PROJECT="rowbyroh-website"
    VERIFY_CMD="./scripts/verify.sh"
    VERIFY_DIR="$HOME/projects/active/web/rowbyroh-website"
    ;;
  */obsidian-mcp/*)
    PROJECT="obsidian-mcp"
    VERIFY_CMD="npm run promote"
    VERIFY_DIR="$HOME/projects/active/obsidian-mcp"
    ;;
  */claude-harness/*)
    PROJECT="claude-harness"
    VERIFY_CMD="(no verify script yet — consider: shellcheck + manual test)"
    VERIFY_DIR="$HOME/projects/active/claude-harness"
    ;;
  */notebook-app/*)
    PROJECT="notebook-app"
    VERIFY_CMD="(no verify script yet — see CLAUDE.md: NEEDS VERIFY)"
    VERIFY_DIR="$HOME/projects/active/notebook-app"
    ;;
  */portfolio/*)
    PROJECT="portfolio"
    VERIFY_CMD="(no verify script yet — see CLAUDE.md: NEEDS VERIFY)"
    VERIFY_DIR="$HOME/projects/active/portfolio"
    ;;
  *)
    # Not a known project — only nudge on common code file types
    case "$FILE_PATH" in
      *.css|*.html|*.ts|*.tsx|*.js|*.jsx|*.py)
        PROJECT="(unknown project)"
        VERIFY_CMD="(define a verify step for this file's project before claiming done)"
        ;;
      *)
        exit 0 ;;
    esac
    ;;
esac

# Emit reminder to stderr — Claude Code surfaces this as context
cat >&2 <<EOF
[verify-reminder] Edited: $FILE_PATH
Project: $PROJECT
Before claiming this task is done, run: $VERIFY_CMD${VERIFY_DIR:+ (in $VERIFY_DIR)}
If skipping verification, state the reason explicitly.
EOF

exit 0
