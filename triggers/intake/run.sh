#!/bin/bash
# Intake pipeline — systemd intake-route.timer, daily 07:25, after the 07:00 thought scrub has written today's bundle
# (everything new Daniel wrote, every source). Persistent catch-up. 2026-11-21.
#
# One Opus pass routes each piece (triggers/intake/prompt.md); tools/intake.mjs prepares the input, checks the output
# (no silent drops, quotes must be his exact words, secrets removed) and records an outcome for every piece in
# ~/.claude/intake/outcomes.jsonl and the vault note Inbox/Intake — outcomes.md.
# G pieces are confirmed from the session record by a second pass (triggers/intake/verify-g.md); unconfirmed ones are raised.
# PREVIEW MODE until Daniel signs off on the gold set: nothing is written to the backlog or asks.
#
#   run.sh                    today's bundle
#   run.sh <bundle.json>…     specific bundles (backfill), each its own pass
LOG_FILE="$HOME/.claude/hooks/intake-route.log"
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TOOL="$DIR/../../tools/intake.mjs"
WORK="${INTAKE_WORK:-$HOME/.local/state/claude-intake/runs}"  # outside ~/.claude: Claude Code refuses model writes there
SCRUB_WORK="${SCRUB_WORK:-$HOME/.claude/thought-scrub/work}"
MODE="${INTAKE_MODE:-preview}"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }
fail() { log "FAIL: $1"; exit 1; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || fail "claude CLI not found"
command -v node &>/dev/null || fail "node not found"

BUNDLES=("$@")
[ ${#BUNDLES[@]} -eq 0 ] && BUNDLES=("$SCRUB_WORK/bundle-$(date +%Y-%m-%d).json")

rc=0
for B in "${BUNDLES[@]}"; do
    [ -s "$B" ] || { log "SKIP: no bundle $B (thought scrub not run yet, or nothing new)"; continue; }
    RUN="$WORK/$(basename "$B" .json)-$(date +%H%M%S)"
    mkdir -p "$RUN"
    N=$(node "$TOOL" prepare "$B" "$RUN" 2>&1) || { log "FAIL: prepare $B: $N"; rc=1; continue; }
    if [ "${N%% *}" = "0" ]; then log "OK: $(basename "$B"): nothing new"; continue; fi
    PROMPT="$(cat "$DIR/prompt.md")

Items file: $RUN/items.json
Context file: $RUN/context.json
Output file: $RUN/routes.json"
    OUT=$(cd "$RUN" && claude -p "$PROMPT" --model opus --tools "Read,Write" --allowedTools "Read" \
        --permission-mode acceptEdits --strict-mcp-config --mcp-config '{"mcpServers":{}}' < /dev/null 2>&1)
    [ -s "$RUN/routes.json" ] || { log "FAIL: $(basename "$B"): router wrote no routes.json | $(echo "$OUT" | tail -c 300 | tr '\n' ' ')"; rc=1; continue; }
    # G is a claim only the session record can prove (Daniel 11/22): gather what happened after each G message,
    # and have a Sonnet pass confirm it. No gcheck.json means every G is treated as unconfirmed and raised.
    E=$(node "$TOOL" evidence "$RUN" 2>&1) || { log "FAIL: $(basename "$B"): evidence: $E"; rc=1; continue; }
    if [ "${E%% *}" != "0" ]; then
        GPROMPT="$(cat "$DIR/verify-g.md")

Evidence file: $RUN/evidence.json
Output file: $RUN/gcheck.json"
        (cd "$RUN" && claude -p "$GPROMPT" --model sonnet --tools "Read,Write" --allowedTools "Read" \
            --permission-mode acceptEdits --strict-mcp-config --mcp-config '{"mcpServers":{}}' < /dev/null > /dev/null 2>&1)
        [ -s "$RUN/gcheck.json" ] || log "WARN: $(basename "$B"): G check wrote nothing; every G is raised as unconfirmed"
    fi
    C=$(node "$TOOL" check "$RUN" 2>&1) || { log "FAIL: $(basename "$B"): check: $C"; rc=1; continue; }
    R=$(node "$TOOL" record "$RUN" --mode "$MODE" 2>&1) || { log "FAIL: $(basename "$B"): record: $R"; rc=1; continue; }
    log "OK: $(basename "$B") ($MODE): $R | ${C#*; }"
done
find "$WORK" -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} + 2>/dev/null
exit $rc
