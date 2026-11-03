#!/bin/bash
# @Claude requests from Daniel's phone notes, picked up with nobody at the keyboard (2026-11-03).
# systemd phone-requests.timer, 10 minutes after each phone-notes pull (:10 and :40). Daniel: "The point is to not
# chase you down and automate this." His 11/01 answers set the rules (phone-notes/NEXT-SESSION.md): start at the next
# pull; simple end to end = build, verify, ship live, done line in the note; unsure = stop and ask; Phone Notes and
# Daily Standard only.
# No new request = no model run (a cheap list first). Failure shows up in this log and at session start (harness-check).

LOG_FILE="$HOME/.claude/hooks/phone-requests.log"
OUTPUT_DIR="$HOME/.claude/logs"
PN="$HOME/projects/active/phone-notes"
WORK_DIR="$PN"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export HARNESS_SCHEDULED=1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.local/bin:$PATH"
command -v claude &>/dev/null || { log "FAIL: claude CLI not found"; exit 1; }
command -v node &>/dev/null || { log "FAIL: node not found"; exit 1; }

# One run at a time; a run still working when the next timer fires is left alone.
mkdir -p "$HOME/.claude/phone-notes" "$OUTPUT_DIR"
exec 9>"$HOME/.claude/phone-notes/requests-run.lock"
flock -n 9 || exit 0

REQ="node $PN/scripts/requests.mjs"
LIST=$($REQ list --json 2>&1) || { log "FAIL: requests list: $(echo "$LIST" | tail -1)"; exit 1; }
COUNT=$(echo "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).pending.length)}catch{console.log("x")}})')
[ "$COUNT" = x ] && { log "FAIL: requests list gave no JSON"; exit 1; }
[ "$COUNT" = 0 ] && exit 0

NOTIFY="$HOME/projects/active/claude-harness/tools/telegram-notify.sh"
MODEL="${PHONE_REQUESTS_MODEL:-opus}"
PROMPT="You are working Daniel's @Claude requests from his phone notes. This run is scheduled; no one is at the keyboard. Daniel wrote each request on his phone and expects it handled without chasing you (2026-11-03: \"The point is to not chase you down and automate this\").

Tools:
  REQ = node $PN/scripts/requests.mjs
  \$REQ list                       the requests to work (an 'answered' one shows the question you asked; his answer is in its text)
  \$REQ start <id>                 take it, before any work
  \$REQ done <id> --summary \"...\"  finished: logs it and writes the done line under the request in his note
  \$REQ waiting <id> --question \"...\"  stop and ask: logs it and writes the question under the request in his note; his answer written under it brings the request back
  NOTIFY = $NOTIFY \"<text>\"      Telegram to Daniel (best effort; may fail)

For each request from \$REQ list, \$REQ start <id> first, then:

1. Scope: Phone Notes (~/projects/active/phone-notes) and Daily Standard (~/projects/active/daily-standard) only. Anything else: waiting, asking whether he wants it done in a session.
2. If you can tell exactly what he wants and why, and it is a small change that does not reshape how the tool is used, do it end to end: read the project's CLAUDE.md, CAPABILITIES.md and the code; make the change with a test; update CAPABILITIES.md; run ./verify.sh until every line passes; commit (message says it came from his phone note) and push; deploy live (Daily Standard: npm run deploy. Phone Notes: set -a; . ~/.config/cloudflare/env; set +a; npm run build && npx wrangler deploy); run ./verify.sh again; then \$REQ done <id> --summary with what changed in plain words, ending 'Live.'
3. Stop and ask (\$REQ waiting <id> --question) when any of these holds: more than one reasonable reading; you cannot reproduce a bug from the code (ask for the steps); a choice that shapes the tool long term; a big change to how the tool is used (those go on the test copy for a few days first, so ask); a question addressed to you. For a question or a judgment call, give your recommendation and its reason in the question, then ask for his call. One short, plain question; name what you checked.
4. If verify fails and one fix attempt does not make it pass: undo your change (git checkout the files; never leave a broken tree), then waiting, saying what failed.
5. Hard limits: never read, quote or write a personal note or anything in /mnt/c/MCP/Confidential/; never edit or delete Daniel's lines (the two scripts above are the only writes into his notes); never force-push or skip hooks (--no-verify); no new services, accounts or spending.

When all are handled: if you asked anything, \$NOTIFY once: 'Phone notes: <n> question(s) for you under your @Claude requests in <note title>'. Your last line: '<n> done, <m> asked'."

OUTPUT_FILE="$OUTPUT_DIR/phone-requests-$(date +%Y-%m-%d-%H%M).txt"
log "START: $COUNT request(s)"
OUTPUT=$(cd "$WORK_DIR" && timeout 3600 claude -p "$PROMPT" \
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
