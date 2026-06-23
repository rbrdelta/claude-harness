#!/usr/bin/env bash
# Auto-backup ~/.claude/skills to its private remote.
# Hooked on Stop (end of each response). No-op when there's nothing to back up.
# Never blocks or fails the session — always exits 0.
#
# Robustness: pushes when the working tree is dirty OR when local is ahead of
# upstream, so a push that failed/timed out on a prior Stop gets retried later
# (a committed-but-unpushed change must not be silently stranded).
set -uo pipefail

SKILLS_DIR="$HOME/.claude/skills"
LOG="$HOME/.claude/hooks/backup-skills.log"

cd "$SKILLS_DIR" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

dirty="$(git status --porcelain 2>/dev/null)"
ahead="$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)"

# Nothing changed and nothing unpushed -> done.
if [ -z "$dirty" ] && [ "$ahead" = "0" ]; then
  exit 0
fi

ts="$(date '+%Y-%m-%d %H:%M:%S')"

if [ -n "$dirty" ]; then
  git add -A >>"$LOG" 2>&1
  git commit -q -m "Auto-backup skills ($ts)" >>"$LOG" 2>&1
fi

if git push -q origin HEAD >>"$LOG" 2>&1; then
  echo "[$ts] backed up + pushed" >>"$LOG"
else
  echo "[$ts] commit ok; push failed (will retry next stop)" >>"$LOG"
fi

exit 0
