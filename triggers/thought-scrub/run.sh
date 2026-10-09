#!/bin/bash
# Daily thought scrub — 7am via systemd (thought-scrub.timer).
# Finds text Daniel wrote since yesterday across Notion, iPhone notes,
# Claude.ai, Obsidian and Claude Code sessions; a Sonnet pass picks out
# original thoughts; if (and only if) any exist they are added to the Notion
# "Thought Review" list and Telegram gets one ping with a click-tracked link.
#
# Manual: run.sh            normal run
#         run.sh --dry-run  collect + extract, no Notion rows, no ping, no commit

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
STATE_DIR="$HOME/.claude/thought-scrub"
WORK_DIR="$STATE_DIR/work"
LOG_FILE="$HOME/.claude/hooks/thought-scrub.log"
DRY=0; [ "$1" = "--dry-run" ] && DRY=1
mkdir -p "$WORK_DIR"
TODAY=$(date +%F)
BUNDLE="$WORK_DIR/bundle-$TODAY.json"
CANDIDATES="$WORK_DIR/candidates-$TODAY.json"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }
fail() { log "FAIL: $1"; exit 1; }

# nvm sits below .bashrc's interactive guard, so load it here.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
CLAUDE_BIN=$(command -v claude) || fail "claude binary not found"

log "START$([ $DRY = 1 ] && echo " (dry run)")"

CLICKS=$(python3 "$DIR/publish.py" clicks 2>&1) || log "WARN clicks: $CLICKS"
log "clicks: $CLICKS"

COLLECT=$(python3 "$DIR/scrub.py" collect "$BUNDLE" 2>&1) || fail "collect: $COLLECT"
log "collect: $COLLECT"
NEW_ITEMS=$(echo "$COLLECT" | python3 -c "import json,sys; print(json.load(sys.stdin)['new_items'])")

CAND_COUNT=0
if [ "$NEW_ITEMS" -gt 0 ]; then
    rm -f "$CANDIDATES"
    PROMPT="$(cat "$DIR/prompt.md")

Input file: $BUNDLE
Output file: $CANDIDATES"
    OUT=$(cd "$WORK_DIR" && "$CLAUDE_BIN" -p "$PROMPT" \
        --model sonnet \
        --allowedTools "Read,Write" \
        --permission-mode bypassPermissions \
        --max-budget-usd 3 < /dev/null 2>&1) || fail "extract: $(echo "$OUT" | tail -3 | tr '\n' ' ')"
    CAND_COUNT=$(python3 -c "import json; print(len(json.load(open('$CANDIDATES'))))" 2>/dev/null) \
        || fail "extract wrote no valid JSON: $(echo "$OUT" | tail -3 | tr '\n' ' ')"
fi
log "candidates: $CAND_COUNT from $NEW_ITEMS new items"

# Source health: a broken sync looks exactly like "nothing new".
WARNINGS=()
APPLE_AGE=$(python3 "$DIR/scrub.py" freshness | python3 -c "import json,sys; v=json.load(sys.stdin)['iPhone export']; print(int(v) if v is not None else 999)")
[ "$APPLE_AGE" -ge 14 ] && WARNINGS+=("iPhone notes: last export ${APPLE_AGE} days ago, run the Shortcut.")
tail -1 "$HOME/.claude/hooks/vault-sync.log" 2>/dev/null | grep -qE "FAIL|AUTH_EXPIRED|SKIP.*empty" \
    && WARNINGS+=("Claude.ai sync is not running (session key). Web conversations are not being read.")

if [ $DRY = 1 ]; then
    log "DRY: would add $CAND_COUNT rows, warnings: ${WARNINGS[*]:-none}"
    echo "dry run: $CAND_COUNT candidates in $CANDIDATES; warnings: ${WARNINGS[*]:-none}"
    exit 0
fi

if [ "$CAND_COUNT" -gt 0 ]; then
    ROWS=$(python3 "$DIR/publish.py" rows "$CANDIDATES" Daily 2>&1) || fail "rows: $ROWS"
    log "rows: $ROWS"
    PING=$(python3 "$DIR/publish.py" ping "$CAND_COUNT" "${WARNINGS[@]}" 2>&1) || fail "ping: $PING"
    log "ping: $PING"
elif [ ${#WARNINGS[@]} -gt 0 ]; then
    # No new thoughts but a source is broken: say so at most once a week.
    LAST_PING=$(tail -1 "$STATE_DIR/pings.jsonl" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['sent_at'][:10])" 2>/dev/null)
    if [ -z "$LAST_PING" ] || [ $(( ($(date +%s) - $(date -d "$LAST_PING" +%s)) / 86400 )) -ge 7 ]; then
        PING=$(python3 "$DIR/publish.py" ping 0 "${WARNINGS[@]}" 2>&1) || fail "ping: $PING"
        log "ping (warnings only): $PING"
    fi
fi

python3 "$DIR/scrub.py" commit || fail "commit snapshots"
STATS=$(python3 "$DIR/publish.py" stats 2>&1)
log "OK: {\"new_items\":$NEW_ITEMS,\"candidates\":$CAND_COUNT,\"backlog\":$STATS}"
find "$WORK_DIR" -name '*.json' -mtime +30 -delete
