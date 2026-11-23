// tools/retro-launch.mjs against a fake ds (slotted list from env), a fake tmux (sessions are files) and a recording notifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const URL1 = 'https://claude.ai/code/session_01AbcDEF';
const slot = (taskId, date = '2026-10-28', blocks = ['evening']) => ({ date, blocks, taskId, priId: 'p1', text: 'Retro' });

function setup(slotted, { url = true, dsFails = false, dsStderr = '', dsFailTimes = 0 } = {}) {
  const sb = sandbox();
  sb.write('ds.mjs', `import fs from 'node:fs'; fs.appendFileSync(process.env.SHIM_LOG, 'ds ' + process.argv.slice(2).join(' ') + '\\n'); ${dsFails ? `console.error(${JSON.stringify(dsStderr)}); process.exit(1);` : ''} const n = fs.readFileSync(process.env.SHIM_LOG, 'utf8').split('\\n').filter((l) => l.startsWith('ds ')).length; if (n <= ${dsFailTimes}) { console.error(${JSON.stringify(dsStderr)}); process.exit(1); } console.log(process.env.FAKE_SLOTTED);`);
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"`, 0o755);
  // Fake tmux: a session is a file under tmux/; its pane shows the Remote Control link unless url is off.
  sb.shim('tmux', `D="$HOME/tmux"; mkdir -p "$D"
case "$1" in
  has-session) [ -f "$D/\${3#=}" ];;
  new-session) printf '%s' "\${@: -1}" > "$D/$4"; ${url ? `echo "/remote-control is active · ${URL1}" >> "$D/$4.pane"` : ':'};;
  capture-pane) t="\${@: -1}"; case "$t" in =*:) t="\${t#=}"; cat "$D/\${t%:}.pane" 2>/dev/null;; *) echo "can't find pane: $t" >&2; exit 1;; esac;; # real tmux: a bare =name is not a pane target
  kill-session) rm -f "$D/\${3#=}" "$D/\${3#=}.pane";;
esac`);
  sb.notes = () => sb.calls().filter((c) => c.startsWith('notify ')).map((c) => c.slice(7));
  sb.launch = () => sb.run(process.execPath, [join(REPO, 'tools/retro-launch.mjs')], {
    env: { RETRO_DS: sb.path('ds.mjs'), RETRO_NOTIFY: sb.path('notify.sh'), RETRO_LOG: sb.path('launch.log'), RETRO_LAUNCH_STATE: sb.path('state.json'), RETRO_CLAUDE: '/opt/claude', FAKE_SLOTTED: JSON.stringify(slotted), RETRO_TONIGHT: sb.path('tonight.json'), RETRO_TODAY: '2026-11-29' },
  });
  sb.state = () => JSON.parse(sb.read('state.json'));
  return sb;
}

test('retro-launch: a slotted retro starts one named Remote Control session that has already run /retro, and Telegram gets the link', () => {
  const sb = setup([slot('retro-2026-10-26')]);
  assert.equal(sb.launch().code, 0);
  const cmd = sb.read('tmux/retro-2026-10-26');
  assert.match(cmd, /^\/opt\/claude --session-id [0-9a-f-]{36} --remote-control 'Retro: Wed, Oct 28, evening \(slotted by Daniel\)' '\/retro This session was opened automatically/);
  assert.match(cmd, /work item retro-2026-10-26.*stop there\. Daniel joins when the slot comes; wait for him\.'$/);
  assert.ok(sb.calls().some((c) => c.startsWith('tmux [new-session] [-d] [-s] [retro-2026-10-26] [-c]')));
  assert.equal(sb.state().launched['retro-2026-10-26'].url, URL1);
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /^Your retro session is ready for Wed, Oct 28, evening\. Open "Retro: .*" in the Claude app, or https:\/\/claude\.ai\/code\/session_01AbcDEF$/);
  assert.match(sb.read('launch.log'), /OK: launched retro-2026-10-26/);
});

test('retro-launch: idempotent — a second run, or the retro moved to another block, opens no second session', () => {
  const sb = setup([slot('retro-2026-10-26')]);
  sb.launch();
  const again = setup([slot('retro-2026-10-26', '2026-10-29', ['morning'])]);
  again.write('state.json', sb.read('state.json'));
  again.launch();
  assert.ok(!again.exists('tmux/retro-2026-10-26'));
  assert.equal(again.notes().length, 0);
});

test('retro-launch: only retro-YYYY-MM-DD items start a session; other slotted work and an empty list start nothing and send nothing', () => {
  const sb = setup([{ ...slot('abc123'), text: 'Fix the car' }, { ...slot('retro-notes-x'), text: 'Notes on last week' }]);
  assert.equal(sb.launch().code, 0);
  assert.ok(sb.calls().some((c) => c === "ds slotted  --json"), 'reads every linked slot, so a retro on a replaced item is seen');
  assert.ok(!sb.calls().some((c) => c.includes('new-session')));
  assert.equal(sb.notes().length, 0);
  const none = setup([]);
  assert.equal(none.launch().code, 0);
  assert.equal(none.notes().length, 0);
});

test('retro-launch: a retro slotted from a replaced work item warns once, in the log and on Telegram, and starts nothing', () => {
  const sb = setup([{ ...slot('47dca45aff92'), text: 'Retro — week of Oct 26' }]);
  sb.launch();
  sb.launch();
  assert.ok(!sb.calls().some((c) => c.includes('new-session')));
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /^"Retro — week of Oct 26" is on your Daily Standard for Wed, Oct 28, but it's linked to a work item that isn't the current retro, so no session was started\./);
  assert.equal(sb.read('launch.log').match(/WARN: /g).length, 1);
  assert.match(sb.read('launch.log'), /WARN: "Retro — week of Oct 26" is slotted for 2026-10-28 but linked to 47dca45aff92/);
});

test('retro-launch: a state file from before warnings existed still works; a real retro alongside a stale one launches', () => {
  const sb = setup([{ ...slot('47dca45aff92'), priId: 'p2', text: 'Retro' }, slot('retro-2026-10-26')]);
  sb.write('state.json', JSON.stringify({ launched: {}, failed: {} }));
  assert.equal(sb.launch().code, 0);
  assert.equal(sb.state().launched['retro-2026-10-26'].url, URL1);
  assert.equal(sb.notes().length, 2);
});

test('retro-launch: a session already running under the name is adopted, not started twice', () => {
  const sb = setup([slot('retro-2026-10-26')]);
  sb.write('tmux/retro-2026-10-26', 'running');
  sb.launch();
  assert.ok(!sb.calls().some((c) => c.includes('new-session')));
  assert.equal(sb.state().launched['retro-2026-10-26'].adopted, true);
});

test('retro-launch: no Remote Control link means failure — session killed, Daniel told once, three tries then it stops', () => {
  const sb = setup([slot('retro-2026-10-26')], { url: false });
  for (let i = 0; i < 4; i++) sb.launch();
  assert.equal(sb.calls().filter((c) => c.includes('new-session')).length, 3);
  assert.ok(!sb.exists('tmux/retro-2026-10-26'), 'failed session is killed');
  assert.equal(sb.state().failed['retro-2026-10-26'], 3);
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /failed to start\. It will retry twice more; if it still fails, start \/retro yourself/);
  assert.match(sb.read('launch.log'), /FAIL: retro-2026-10-26 did not come up with Remote Control \(try 3 of 3\)/);
});

test('retro-launch: ds failing is logged and exits non-zero; nothing started', () => {
  const sb = setup([], { dsFails: true });
  assert.equal(sb.launch().code, 1);
  assert.match(sb.read('launch.log'), /FAIL: ds slotted/);
  assert.ok(!sb.calls().some((c) => c.includes('new-session')));
});

const CONNECT_ERROR = "TypeError: fetch failed\n  [cause]: AggregateError [ETIMEDOUT]:\n    Error: connect ETIMEDOUT 192.0.2.1:443\nNode.js v24";
const dsCalls = (sb) => sb.calls().filter((c) => c.startsWith('ds ')).length;

test('retro-launch: ds failing on a connection retries and, if it never connects, logs the whole error on one line', () => {
  const sb = setup([], { dsFails: true, dsStderr: CONNECT_ERROR });
  assert.equal(sb.launch().code, 1);
  assert.equal(dsCalls(sb), 3);
  const lines = sb.read('launch.log').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /RETRY: ds slotted try 1 of 3 could not connect \((fetch failed|ETIMEDOUT)\)/);
  assert.match(lines[2], /FAIL: ds slotted \(try 3 of 3\): TypeError: fetch failed \| \[cause\]: AggregateError \[ETIMEDOUT\]: \| Error: connect ETIMEDOUT 192\.0\.2\.1:443 \| Node\.js v24$/);
});

test('retro-launch: a connection failure that clears on the retry carries on and launches', () => {
  const sb = setup([slot('retro-2026-10-26')], { dsFailTimes: 1, dsStderr: CONNECT_ERROR });
  assert.equal(sb.launch().code, 0);
  assert.equal(dsCalls(sb), 2);
  assert.match(sb.read('launch.log'), /RETRY: ds slotted try 1 of 3[\s\S]*OK: launched retro-2026-10-26/);
});

test('retro-launch: any other ds failure is not retried, and its full error is logged', () => {
  const sb = setup([], { dsFails: true, dsStderr: 'Error: D1 query failed: [{"code":7500}]\n    at query (d1.mjs:27:1)' });
  assert.equal(sb.launch().code, 1);
  assert.equal(dsCalls(sb), 1);
  assert.match(sb.read('launch.log'), /FAIL: ds slotted \(try 1 of 3\): Error: D1 query failed: \[\{"code":7500\}\] \| at query \(d1\.mjs:27:1\)/);
});

// Sunday night is the default (Daniel, 2026-11-22): the prep run leaves a request and the session starts with no slot.
const request = (sb, key = 'retro-2026-11-30', hoursAgo = 0) => sb.write('tonight.json', JSON.stringify({ key, at: new Date(Date.now() - hoursAgo * 3600e3).toISOString() }));

test('retro-launch: when the prep is ready, a session starts with no slot, named for the day, and Telegram gets the link once', () => {
  const sb = setup([]);
  request(sb);
  assert.equal(sb.launch().code, 0);
  const cmd = sb.read('tmux/retro-2026-11-30');
  assert.match(cmd, /^\/opt\/claude --session-id [0-9a-f-]{36} --remote-control 'Retro: Sun, Nov 29, prep ready' '\/retro This session was opened automatically because the weekly retro prep is ready \(work item retro-2026-11-30\)/);
  assert.match(cmd, /Sunday night when possible.*Monday, or Tuesday at the latest.*Daniel joins when he can; wait for him\.'$/);
  assert.equal(sb.state().launched['retro-2026-11-30'].tonight, true);
  assert.equal(sb.state().launched['retro-2026-11-30'].url, URL1);
  assert.deepEqual(sb.notes(), [`Your retro session is ready. Open "Retro: Sun, Nov 29, prep ready" in the Claude app, or ${URL1} . Tonight if you can; it waits for you through Tuesday.`]);
  sb.launch();
  assert.equal(sb.calls().filter((c) => c.includes('new-session')).length, 1, 'a second run opens nothing');
  assert.equal(sb.notes().length, 1);
});

test('retro-launch: a prep-ready request older than 12 hours, for something that is not a retro, or unreadable starts nothing', () => {
  const old = setup([]);
  request(old, 'retro-2026-11-30', 13);
  old.launch();
  const other = setup([]);
  request(other, 'abc123');
  other.launch();
  const broken = setup([]);
  broken.write('tonight.json', '{not json');
  assert.equal(broken.launch().code, 0);
  for (const sb of [old, other, broken]) { assert.ok(!sb.calls().some((c) => c.includes('new-session'))); assert.equal(sb.notes().length, 0); }
  assert.ok(!broken.exists('tonight.json'), 'an unreadable request is removed, so it is logged once');
  assert.match(broken.read('launch.log'), /WARN: .*tonight\.json could not be read/);
});

test('retro-launch: a retro he already gave a slot gets the slot session only, not a second one when the prep is ready', () => {
  const sb = setup([slot('retro-2026-11-30', '2026-11-30', ['morning'])]);
  request(sb);
  sb.launch();
  sb.launch();
  assert.equal(sb.calls().filter((c) => c.includes('new-session')).length, 1);
  assert.match(sb.read('tmux/retro-2026-11-30'), /--remote-control 'Retro: Mon, Nov 30, morning \(slotted by Daniel\)'/);
  assert.equal(sb.state().launched['retro-2026-11-30'].tonight, undefined);
});

test('retro-launch: pushed to Monday — the Sunday session still running serves the slot; one that is gone is started again', () => {
  const sunday = setup([]);
  request(sunday);
  sunday.launch();
  // Still running when he slots it for Monday: nothing new, no second message.
  const running = setup([slot('retro-2026-11-30', '2026-11-30', ['morning'])]);
  running.write('state.json', sunday.read('state.json'));
  running.write('tmux/retro-2026-11-30', 'running');
  running.launch();
  assert.ok(!running.calls().some((c) => c.includes('new-session')));
  assert.equal(running.notes().length, 0);
  // Gone (the laptop restarted): the slot starts a new one, and from then on it is an ordinary slot session.
  const gone = setup([slot('retro-2026-11-30', '2026-11-30', ['morning'])]);
  gone.write('state.json', sunday.read('state.json'));
  gone.launch();
  assert.match(gone.read('tmux/retro-2026-11-30'), /--remote-control 'Retro: Mon, Nov 30, morning \(slotted by Daniel\)'/);
  assert.match(gone.notes()[0], /^Your retro session is ready for Mon, Nov 30, morning\./);
  assert.match(gone.read('launch.log'), /is gone; starting again for the slot/);
  gone.launch();
  assert.equal(gone.calls().filter((c) => c.includes('new-session')).length, 1);
});

test('retro-launch: three failed tries on Sunday night do not use up a Monday slot', () => {
  const sunday = setup([], { url: false });
  request(sunday);
  for (let i = 0; i < 4; i++) sunday.launch();
  assert.equal(sunday.calls().filter((c) => c.includes('new-session')).length, 3);
  assert.equal(sunday.notes().length, 1);
  assert.match(sunday.notes()[0], /^The retro session for Sun, Nov 29, prep ready failed to start\./);
  const monday = setup([slot('retro-2026-11-30', '2026-11-30', ['morning'])]);
  monday.write('state.json', sunday.read('state.json'));
  monday.launch();
  assert.equal(monday.state().launched['retro-2026-11-30'].url, URL1);
});
