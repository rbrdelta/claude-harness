// tools/asks-launch.mjs against a fake ds (ask-session --check and asks from env, records writes), a fake tmux
// (sessions are files) and a recording notifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const URL1 = 'https://claude.ai/code/session_01AbcDEF';
const ASKS = [{ id: 'a1', kind: 'quick', text: 'Send it?' }, { id: 'a2', kind: 'quick', text: 'Skip Kastle?' }, { id: 'a3', kind: 'input', text: 'Evals and kill switch' }];

// url: 'screen' puts the link on the fake terminal only; 'transcript' writes it only into the session's transcript,
// the way Claude Code records it (the screen loses it once a long prompt starts the session working).
function setup({ today = false, asks = ASKS, url = 'screen', running = [] } = {}) {
  const sb = sandbox();
  sb.write('ds.mjs', `import fs from 'node:fs'; const a = process.argv.slice(2); fs.appendFileSync(process.env.SHIM_LOG, 'ds ' + a.join(' ') + '\\n');
if (a[0] === 'ask-session' && a[1] === '--check') console.log(JSON.stringify({ date: '2026-11-20', today: ${today}, open: ${asks.length} }));
else if (a[0] === 'asks') console.log(${JSON.stringify(JSON.stringify(asks))});
else console.log('ok');`);
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"`, 0o755);
  for (const r of running) sb.write(`tmux/${r}`, 'running');
  sb.shim('tmux', `D="$HOME/tmux"; mkdir -p "$D"
case "$1" in
  has-session) [ -f "$D/\${3#=}" ];;
  list-sessions) ls "$D" | grep -v '\\.pane$';;
  new-session) printf '%s' "\${@: -1}" > "$D/$4"; ${url === 'screen' ? `echo "/remote-control is active · ${URL1}" >> "$D/$4.pane"` : ':'}
    ${url === 'transcript' ? `sid=$(printf '%s' "\${@: -1}" | grep -o -- '--session-id [^ ]*' | cut -d' ' -f2); P="$HOME/.claude/projects/\${HOME//[^a-zA-Z0-9]/-}"; mkdir -p "$P"; printf '%s\\n' '{"type":"user"}' '{"type":"system","subtype":"bridge_status","url":"${URL1}"}' > "$P/$sid.jsonl"` : ':'};;
  capture-pane) t="\${@: -1}"; t="\${t#=}"; cat "$D/\${t%:}.pane" 2>/dev/null;;
  kill-session) rm -f "$D/\${3#=}" "$D/\${3#=}.pane";;
esac`);
  sb.notes = () => sb.calls().filter((c) => c.startsWith('notify ')).map((c) => c.slice(7));
  sb.dsCalls = () => sb.calls().filter((c) => c.startsWith('ds '));
  sb.launch = () => sb.run(process.execPath, [join(REPO, 'tools/asks-launch.mjs')], {
    env: { ASKS_DS: sb.path('ds.mjs'), ASKS_NOTIFY: sb.path('notify.sh'), ASKS_LOG: sb.path('launch.log'), ASKS_LAUNCH_STATE: sb.path('state.json'), ASKS_CLAUDE: '/opt/claude', ASKS_WAIT_S: '10' },
  });
  return sb;
}

test('asks-launch: open asks start one named Remote Control session holding the list; recorded in the database; Telegram gets the link', () => {
  const sb = setup({ running: ['asks-2026-11-19', 'retro-2026-11-16'] });
  assert.equal(sb.launch().code, 0);
  const cmd = sb.read('tmux/asks-2026-11-20');
  assert.match(cmd, /^\/opt\/claude --session-id [0-9a-f-]{36} --remote-control 'Asks: Fri, Nov 20 \(2 quick, 1 need your input\)' 'This session was opened automatically: 3 ask\(s\)/);
  assert.match(cmd, /search what he already said.*ask-drop.*quick ones first.*I need <answer> to unlock <work>.*ask-close <id> "<his answer>" --daily.*ask-stats.*session-time\.mjs \S+\.jsonl --log/);
  assert.ok(sb.dsCalls().includes(`ds ask-session --url ${URL1}`), 'the day is recorded once the session is up');
  assert.ok(!sb.exists('tmux/asks-2026-11-19'), "yesterday's unopened ask session is closed");
  assert.ok(sb.exists('tmux/retro-2026-11-16'), 'other sessions are left alone');
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /^3 things need you today: 2 quick yes-or-no, 1 that need your input\. The session is ready: open "Asks: Fri, Nov 20 .*" in the Claude app, or https:\/\/claude\.ai\/code\/session_01AbcDEF$/);
});

test('asks-launch: the link is read from the session transcript when the screen has lost it (the 11-19 to 11-21 failure)', () => {
  const sb = setup({ url: 'transcript' });
  assert.equal(sb.launch().code, 0);
  assert.match(sb.read('tmux/asks-2026-11-20'), /^\/opt\/claude --session-id [0-9a-f-]{36} --remote-control /);
  assert.ok(sb.exists('tmux/asks-2026-11-20'), 'a session that came up is left running');
  assert.ok(sb.dsCalls().includes(`ds ask-session --url ${URL1}`));
  assert.equal(sb.notes().length, 1);
  assert.match(sb.read('launch.log'), /OK: launched asks-2026-11-20/);
});

test('asks-launch: at most one a day, and none when nothing is open', () => {
  const done = setup({ today: true });
  assert.equal(done.launch().code, 0);
  assert.ok(!done.calls().some((c) => c.includes('new-session')));
  assert.equal(done.notes().length, 0);
  const none = setup({ asks: [] });
  assert.equal(none.launch().code, 0);
  assert.ok(!none.calls().some((c) => c.includes('new-session')));
  assert.match(none.read('launch.log'), /no open asks, no session/);
});

test('asks-launch: no Remote Control link means failure; nothing recorded; three tries then one Telegram message', () => {
  const sb = setup({ url: null });
  for (let i = 0; i < 4; i++) sb.launch();
  assert.equal(sb.calls().filter((c) => c.includes('new-session')).length, 3);
  assert.ok(!sb.dsCalls().some((c) => c.includes('--url')), 'a session that never came up is not recorded');
  assert.ok(!sb.exists('tmux/asks-2026-11-20'));
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /failed to start three times/);
});
