#!/bin/bash
# Weekly community and events list refresh (2026-11-08) — systemd user timer events-list.timer
# (Sunday 08:00, Persistent catch-up). claude -p (Opus alias) with web search refreshes the vault
# note Inbox/Community and Events List.md: drops past events, confirms dates once posted, adds new
# in-person events from the note's own source list, and works the note's "Threads to keep checking".
# The note is the only file the model may edit. The script backs it up first and restores the
# backup if the run fails, the note shrinks below 60% of its size, the threads section is gone,
# or the frontmatter `updated:` is not today. Daniel's measure for the list: did I go and meet
# people whose thinking I respect. The job never registers, posts, logs in or contacts anyone.

LOG_FILE="$HOME/.claude/hooks/events-list.log"
OUTPUT_DIR="$HOME/.claude/logs"
NOTE="${EVENTS_NOTE:-/mnt/c/MCP/Inbox/Community and Events List.md}"
TODAY=$(date +%Y-%m-%d)
BACKUP="$OUTPUT_DIR/events-list-backup-$TODAY.md"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { log "FAIL: claude CLI not found"; exit 1; }
[ -f "$NOTE" ] || { log "FAIL: $NOTE missing"; exit 1; }

log "START"
mkdir -p "$OUTPUT_DIR"
cp "$NOTE" "$BACKUP"
BEFORE=$(wc -c < "$NOTE")

restore() { cp "$BACKUP" "$NOTE"; log "FAIL: $1 (note restored from $BACKUP)"; exit 1; }

PROMPT="You are Daniel's weekly community and events job. Today is $TODAY. Daniel lives in New York City.

Purpose: Daniel wants to meet, in person, people in his areas whose views and ways of thinking he respects, and learn from them, instead of cold-emailing. His only measure is whether he went and met such people. The list serves that: real rooms where those people actually are.

Rules:
- Edit only this file: \"$NOTE\". Read it in full first. Write no other file.
- Never register, sign up, RSVP, post, comment, log in, or contact anyone. Read public pages only.
- Never read anything under /mnt/c/MCP/Confidential/.
- Keep everything Daniel wrote: any line starting \"Daniel:\", every item in \"Threads to keep checking\" and \"Sources to check each run\" (add findings under them, never delete his), and any note he added to an entry.
- Only certain facts. List a specific date only if you saw it on the organizer's own page or an official listing for that edition. Otherwise write \"not posted\" with last year's date and pattern. Keep the High / Medium / Low confidence marks as the note defines them. Never invent a date, price or rule.
- People: public professional information only (name, role, project, public posts or code). No personal contact details, nothing private.
- Plain language, no shorthand or codes. Keep the note's existing structure and sections.

Steps:
1. Remove events whose date has passed. Name the ones removed in one line under What changed.
2. Rebuild \"Next 30 days, all areas\" from the dated events across every section.
3. Check every \"not posted\" or Low item against its organizer page; update it when the date or rule is now posted.
4. Check every source in \"Sources to check each run\" for new in-person events in roughly the next seven months. Search the forums and communities too (Rennlist, Reddit, Luma, Meetup, LessWrong, Discord pages that are public). Add an event only if its room plausibly holds the people Daniel wants; put weak fits under Rooms to skip with the reason.
5. Work each item in \"Threads to keep checking\": search, then write what you found under it as an indented line starting with today's date, with links. Mark a thread resolved when it is; leave it for Daniel to remove.
6. Replace the body of \"What changed this week\" with at most 8 lines, newest first, each dated $TODAY: added, confirmed, removed, thread findings. Put the most promising new room first. If nothing changed, say so in one line.
7. Set the frontmatter field updated: to $TODAY.
8. End your reply with one line exactly like: added=N confirmed=N removed=N threads=N"

OUTPUT_FILE="$OUTPUT_DIR/events-list-$TODAY.txt"
OUTPUT=$(cd "$(dirname "$NOTE")" && claude -p "$PROMPT" \
    --model opus \
    --allowedTools "Read,Edit,Write,Glob,Grep,WebSearch,WebFetch" \
    --permission-mode bypassPermissions 2>&1)
EXIT_CODE=$?
echo "$OUTPUT" > "$OUTPUT_FILE"

[ "$EXIT_CODE" -ne 0 ] && restore "claude exit $EXIT_CODE: $(echo "$OUTPUT" | tail -1)"
[ -f "$NOTE" ] || restore "note was deleted"
AFTER=$(wc -c < "$NOTE")
[ "$AFTER" -lt $(( BEFORE * 6 / 10 )) ] && restore "note shrank from $BEFORE to $AFTER bytes"
grep -q '^## Threads to keep checking' "$NOTE" || restore "Threads to keep checking section is gone"
grep -q "^updated: $TODAY" "$NOTE" || restore "frontmatter updated: is not $TODAY"
log "OK: $(echo "$OUTPUT" | tail -1)"
