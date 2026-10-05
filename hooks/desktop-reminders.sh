#!/bin/bash
# SessionStart hook — one-shot reminders for the next desktop (non-bridge) session.
# Drop a .txt into ~/.claude/reminders/desktop/; it prints once, then is archived.
# Bridge sessions (mobile via Remote Control) skip, so the reminder waits for the laptop.
# Log what each session start looks like, so a reminder that never fires is diagnosable.
echo "$(date '+%F %T') kind=${CLAUDE_CODE_ENVIRONMENT_KIND:-none} entry=${CLAUDE_CODE_ENTRYPOINT:-none}" >> "$HOME/.claude/reminders/desktop-reminders.log"
[ "$CLAUDE_CODE_ENVIRONMENT_KIND" = "bridge" ] && exit 0
# Interactive laptop sessions only; cron `claude -p` jobs (sdk-cli) must not eat the reminder.
[ "$CLAUDE_CODE_ENTRYPOINT" != "cli" ] && exit 0
dir="$HOME/.claude/reminders/desktop"
shopt -s nullglob
files=("$dir"/*.txt)
[ ${#files[@]} -eq 0 ] && exit 0
mkdir -p "$dir/done"
for f in "${files[@]}"; do
    echo "REMINDER FOR DANIEL (one-time — tell him at the top of your first reply): $(cat "$f")"
    mv "$f" "$dir/done/$(date +%Y%m%d)-$(basename "$f")"
done
exit 0
