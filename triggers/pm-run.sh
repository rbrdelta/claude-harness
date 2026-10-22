#!/bin/bash
# Daily Standard PM runs — headless claude -p on the laptop, scheduled by systemd user timers
# (Persistent=true, so a run missed while the laptop slept fires when it wakes).
#   pm-run.sh bookkeeping   noon and 6pm: record completions, file incoming items. Never reprioritizes.
#   pm-run.sh overnight     midnight: the full /pm with the vault; reprioritizes and writes the PM updates note.
# Plan: ~/projects/active/daily-standard/notes/plan-dynamic-backlog.md
# Failure shows up three ways: this log, `ds status` at session start, and the Backlog tab's overdue line.

KIND="$1"
case "$KIND" in bookkeeping|overnight) ;; *) echo "usage: pm-run.sh bookkeeping|overnight"; exit 2;; esac

LOG_FILE="$HOME/.claude/hooks/pm-$KIND.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/daily-standard"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { log "FAIL: claude CLI not found"; exit 1; }
command -v node &>/dev/null || { log "FAIL: node not found"; exit 1; }

# One PM run at a time: a catch-up overnight run must not overlap a bookkeeping run.
exec 9>"$HOME/.claude/daily-standard/pm-run.lock"
flock -w 600 9 || { log "SKIP: another PM run still holding the lock after 10 min"; exit 0; }

DS="node $HOME/projects/active/daily-standard/scripts/ds.mjs"
PM_NOTE="node $HOME/projects/active/phone-notes/scripts/pm-note.mjs"

COMMON="Commands (run them with Bash):
  DS = $DS
  \$DS pull                      fetch the app's latest completions
  \$DS pending                   completions not yet recorded (key, date, outcome, text, [from: task])
  \$DS backlog --json            every work item: id, text, detail, project, tier, status, order, parent, owner
  \$DS task-set <id> field=value …   fields: text detail project tier(now|next) owner order status(open|done|dropped|incoming) parent
  \$DS task-add \"<text>\" --project <p> [--status done] [--tier now|next] [--parent <id>] [--detail d] [--owner o] [--order n]
  \$DS applied <key> …           mark completions recorded
  \$DS run-mark $KIND \"<one-line summary>\"
The database is the source of truth for work items. Never edit the Master Backlog's ds:backlog block by hand.
Never read anything under /mnt/c/MCP/Confidential/."

if [ "$KIND" = bookkeeping ]; then
MODEL=sonnet
PROMPT="You are the Daily Standard bookkeeping run, scheduled, with no one at the keyboard. Your job is bookkeeping only: keep the list accurate between the overnight PM runs. You never reprioritize.

$COMMON

Steps:
1. Run \$DS pull, then \$DS pending and \$DS backlog --json.
2. For each pending completion with outcome DONE:
   - If it names a task ([from: …] or an exact match), make sure that task is status=done, then mark the key applied.
   - If it was typed in by hand and clearly belongs to one open item, judge which: if it IS that item, task-set <id> status=done. If it is one piece of that item's work (example: 'Complete Anthropic resume' is part of submitting the applications), record it with task-add \"<text>\" --project <that item's project> --status done --parent <id>. Then mark the key applied.
   - If it is personal (family, errands) and matches no work item, mark it applied and record nothing.
   - If you are not confident, leave it pending for the overnight run.
3. Leave SPLIT and MOVED completions pending; the overnight run reads them.
4. For each item with status incoming: if its project is obvious from the backlog, task-set <id> status=open tier=next project=<p> order=<one more than the highest order in the backlog>. If not obvious, leave it incoming.
5. Never change order of existing items, never move items between now and next, never drop anything.
6. \$DS run-mark bookkeeping \"<what you recorded and filed, one line>\".
7. End your reply with one line: what you recorded, what you filed, what you left for the overnight run."
else
MODEL=claude-opus-4-8
PROMPT="You are Daniel's PM, running the overnight /pm pass, scheduled, with no one at the keyboard. Read ~/.claude/skills/pm/SKILL.md first and follow its 'Scheduled mode' section: Daniel has granted you authority to add, reorder, promote, demote and remove work items. Prioritize ruthlessly, impact first.

$COMMON
  PM_NOTE = $PM_NOTE      usage: \$PM_NOTE \"<heading>\" < file    (adds an entry at the top of his PM updates phone note)
  \$DS vault-copy            rewrite the Master Backlog's work-item block from the database

Steps:
1. Run \$DS pull, \$DS pending, \$DS backlog --json.
2. Read /mnt/c/MCP/Meta/NorthStar.md and /mnt/c/MCP/Inbox/Master Backlog.md (the Runway Model and current order sit there).
3. Run python3 $HOME/projects/active/claude-harness/tools/day-digest.py: what Daniel said in the last day's sessions. Any concrete to-do that came up and is not in the backlog gets added (or left incoming if you can't place it). Only work items Daniel would recognize as his or Claude's next actions; not every idea mentioned.
4. Record every pending completion: DONE ones as in bookkeeping (status=done, or a done child via --parent for a piece of an item's work; personal items need no record). For MOVED: a task moved twice or more needs a decision (shrink it, split it, or drop it); make it and say why. For SPLIT: update the item's detail with what's left if useful. Mark each key applied once handled.
5. Place every incoming item: project, tier, order. Or drop it, with a reason.
6. Re-sort: set order and tier across the whole list so 'now' holds what moves Daniel's top priorities most in the next few days. Drop items that no longer earn a place. Keep Daniel's stated priority order (Master Backlog Now / Next note and NorthStar) unless the record shows it changed.
7. Run \$DS vault-copy.
8. Write the PM updates entry to a temp file, then run \$PM_NOTE \"\$(date +%Y-%m-%d) ($(date +%a))\" < that file. Plain language, short lines, no shorthand or codes. Sections, each only if non-empty: Moved, Added, Removed, Recorded done, Needs you. Each item gets a one-line why. If nothing changed, one line saying so.
9. \$DS run-mark overnight \"<one line>\".
10. End your reply with the same one line."
fi

mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/pm-$KIND-$(date +%Y-%m-%d-%H%M).txt"
log "START"
OUTPUT=$(cd "$WORK_DIR" && timeout 1800 claude -p "$PROMPT" \
    --model "$MODEL" \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
    --permission-mode bypassPermissions \
    2>&1)
EXIT_CODE=$?
echo "$OUTPUT" > "$OUTPUT_FILE"
if [ $EXIT_CODE -eq 0 ]; then
    log "OK: $(echo "$OUTPUT" | grep -v '^\s*$' | tail -1)"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi
exit 0
