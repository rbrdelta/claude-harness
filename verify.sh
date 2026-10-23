#!/bin/bash
# verify.sh — does the harness work right now?
#   1. every script parses (bash, node, python, PowerShell when Windows is reachable)
#   2. the tests in test/ (node:test for shell and JS, unittest for Python), all sandboxed:
#      temp HOME, shimmed claude/curl/npm, no vault, Notion, Telegram or Daily Standard writes
#   3. live wiring, read-only: hooks in ~/.claude/settings.json resolve, ~/.claude/hooks symlinks
#      resolve, systemd units installed and enabled as the repo says, live crontab = crontab.txt,
#      the thought-link click worker answers (bot user agent, so no click is recorded)
#   4. live status, informational only (never fails the run): timers, bridge, last log line per job
# Usage: ./verify.sh          (exit 0 = parts 1-3 all pass)
cd "$(dirname "$(readlink -f "$0")")" || exit 1
REPO="$PWD"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PYTHONDONTWRITEBYTECODE=1
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
FAILS=0
ok()   { echo "  ok    $1"; }
bad()  { echo "  FAIL  $1"; FAILS=$((FAILS + 1)); }
info() { echo "  info  $1"; }

SCRIPTS=$(git ls-files '*.sh' '*.js' '*.mjs' '*.py' '*.ps1' | grep -v '^test/')

echo "== 1. Every script parses"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
n=0
for f in $SCRIPTS; do
  case "$f" in
    *.sh)  bash -n "$f" 2>"$TMP/err" || bad "bash -n $f: $(head -1 "$TMP/err")";;
    */worker/src/*.js) cp "$f" "$TMP/worker.mjs"; node --check "$TMP/worker.mjs" 2>"$TMP/err" || bad "node --check $f (as ES module): $(grep -m1 Error "$TMP/err")";;
    *.js|*.mjs) node --check "$f" 2>"$TMP/err" || bad "node --check $f: $(grep -m1 Error "$TMP/err")";;
    *.py)  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$f" 2>"$TMP/err" || bad "python parse $f: $(tail -1 "$TMP/err")";;
    *.ps1) PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
           if [ -x "$PS" ]; then
             w=$(wslpath -w "$f")
             r=$(timeout 60 "$PS" -NoProfile -Command "\$e=\$null; [void][System.Management.Automation.Language.Parser]::ParseFile('$w',[ref]\$null,[ref]\$e); if (\$e.Count) { \$e | % { \$_.Message }; exit 1 }" 2>&1) || bad "PowerShell parse $f: $r"
           else info "PowerShell not reachable, $f not parsed"; fi;;
  esac
  n=$((n + 1))
done
ok "$n scripts checked"

echo "== 2. Tests"
if node --test 'test/*.test.mjs' >"$TMP/node.out" 2>&1; then
  ok "node: $(grep -E '^ℹ (tests|pass)' "$TMP/node.out" | tr '\n' ' ' | sed 's/ℹ //g')"
else
  cat "$TMP/node.out"; bad "node tests: $(grep -E '^ℹ (pass|fail)' "$TMP/node.out" | tr '\n' ' ')"
fi
if python3 -m unittest discover -s test -p 'test_*.py' >"$TMP/py.out" 2>&1; then
  ok "python: $(grep -E '^Ran ' "$TMP/py.out")"
else
  cat "$TMP/py.out"; bad "python tests: $(grep -E '^(Ran|FAILED)' "$TMP/py.out" | tr '\n' ' ')"
fi

echo "== 3. Live wiring (read-only)"
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  hooks=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])).get("hooks",{}); print("\n".join(sorted({h["command"].split()[0] for g in d.values() for m in g for h in m.get("hooks",[]) if h.get("type")=="command"})))' "$SETTINGS")
  for h in $hooks; do
    if [ -x "$(readlink -f "$h")" ]; then ok "settings.json hook resolves: $h"; else bad "settings.json hook missing or not executable: $h"; fi
  done
else
  bad "no $SETTINGS"
fi
for l in "$HOME"/.claude/hooks/*; do
  [ -L "$l" ] || continue
  t=$(readlink -f "$l")
  case "$t" in "$REPO"/*) [ -e "$t" ] && ok "symlink $(basename "$l") -> ${t#$REPO/}" || bad "dangling symlink $l";; esac
done
UNITS="$HOME/.config/systemd/user"
for u in systemd/*.service systemd/*.timer; do
  name=$(basename "$u")
  if [ "${u##*.}" = service ]; then
    exe=$(sed -n 's/^ExecStart=\([^ ]*\).*/\1/p' "$u")
    [ -x "$(readlink -f "$exe")" ] || bad "$name ExecStart not executable: $exe"
  else
    svc=$(sed -n 's/^Unit=//p' "$u")
    [ -f "systemd/$svc" ] || bad "$name points at missing $svc"
  fi
  if [ ! -e "$UNITS/$name" ]; then
    [ "$name" = pm-bookkeeping.timer ] && ok "pm-bookkeeping.timer not installed (bookkeeping runs in the cloud)" || bad "$name not installed in $UNITS"
  elif ! cmp -s "$u" "$UNITS/$name"; then
    bad "$name installed copy differs from the repo"
  fi
done
for t in systemd/*.timer; do
  name=$(basename "$t")
  if [ "$name" = pm-bookkeeping.timer ]; then
    [ -e "$UNITS/timers.target.wants/$name" ] && bad "pm-bookkeeping.timer is enabled; bookkeeping would run twice (cloud + laptop)"
  else
    [ -e "$UNITS/timers.target.wants/$name" ] || bad "$name is not enabled"
  fi
done
ok "systemd units checked against $UNITS"
if crontab -l >"$TMP/cron" 2>/dev/null; then
  if diff -q <(grep -v '^\s*#' "$TMP/cron" | sed '/^\s*$/d') <(grep -v '^\s*#' crontab.txt | sed '/^\s*$/d') >/dev/null; then ok "live crontab matches crontab.txt"; else bad "live crontab differs from crontab.txt"; fi
  for c in $(grep -v '^\s*#' crontab.txt | awk 'NF>5{print $6}'); do [ -x "$(readlink -f "$c")" ] || bad "cron command not executable: $c"; done
else
  bad "could not read the live crontab"
fi

# The click-tracking link in the daily thought ping. A bot user agent is used so no click is recorded.
W=https://thought-link.daily-standard.workers.dev
[ "$(curl -s --max-time 10 "$W/health")" = ok ] && ok "thought-link worker answers /health" || bad "thought-link worker /health did not answer ok"
loc=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 -A 'TelegramBot (verify)' "$W/r/verify-probe")
case "$loc" in "302 https://app.notion.com/"*) ok "thought-link /r/<id> redirects to the Notion review list";; *) bad "thought-link /r/<id> gave: $loc";; esac

echo "== 4. Live status (informational)"
if command -v systemctl >/dev/null && systemctl --user list-timers --no-pager >/dev/null 2>&1; then
  for t in systemd/*.timer; do
    t=$(basename "$t")
    info "timer $t: $(systemctl --user is-enabled "$t" 2>/dev/null | head -1), last fired $(systemctl --user show "$t" -p LastTriggerUSec --value 2>/dev/null | sed 's/^$/never/')"
  done
else
  info "systemctl --user not reachable from this shell"
fi
for f in vault-sync notion-sync phone-notes-pull pm-overnight thought-scrub weekly-sprint-review weekly-digest weekly-northstar-check vault-reclassify retro-window; do
  lf="$HOME/.claude/hooks/$f.log"
  [ -f "$lf" ] && info "$f: $(grep -v '^\s*$' "$lf" | tail -1 | cut -c1-140)"
done
if tmux has-session -t claude-remote 2>/dev/null && pgrep -f "claude remote-control" >/dev/null; then info "remote-control bridge running"; else info "remote-control bridge DOWN (the 5-minute cron watchdog restarts it)"; fi
# harness-check.sh itself is not run here: when the Claude.ai sync is stale it starts a real sync.

echo
if [ "$FAILS" -eq 0 ]; then echo "verify: PASS"; else echo "verify: FAIL ($FAILS)"; exit 1; fi
