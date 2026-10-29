// tools/retro-launch.mjs against a fake ds (slotted list from env), a fake tmux (sessions are files) and a recording notifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const URL1 = 'https://claude.ai/code/session_01AbcDEF';
const slot = (taskId, date = '2026-10-28', blocks = ['evening']) => ({ date, blocks, taskId, priId: 'p1', text: 'Retro' });

function setup(slotted, { url = true, dsFails = false } = {}) {
  const sb = sandbox();
  sb.write('ds.mjs', `import fs from 'node:fs'; fs.appendFileSync(process.env.SHIM_LOG, 'ds ' + process.argv.slice(2).join(' ') + '\\n'); ${dsFails ? 'process.exit(1);' : ''} console.log(process.env.FAKE_SLOTTED);`);
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
    env: { RETRO_DS: sb.path('ds.mjs'), RETRO_NOTIFY: sb.path('notify.sh'), RETRO_LOG: sb.path('launch.log'), RETRO_LAUNCH_STATE: sb.path('state.json'), RETRO_CLAUDE: '/opt/claude', FAKE_SLOTTED: JSON.stringify(slotted) },
  });
  sb.state = () => JSON.parse(sb.read('state.json'));
  return sb;
}

test('retro-launch: a slotted retro starts one named Remote Control session that has already run /retro, and Telegram gets the link', () => {
  const sb = setup([slot('retro-2026-10-26')]);
  assert.equal(sb.launch().code, 0);
  const cmd = sb.read('tmux/retro-2026-10-26');
  assert.match(cmd, /^\/opt\/claude --remote-control 'Retro: Wed, Oct 28, evening \(slotted by Daniel\)' '\/retro This session was opened automatically/);
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

test('retro-launch: only retro-YYYY-MM-DD items; nothing slotted means nothing started or sent', () => {
  const sb = setup([slot('retro-notes-x'), slot('abc123')]);
  assert.equal(sb.launch().code, 0);
  assert.ok(!sb.calls().some((c) => c.includes('new-session')));
  assert.equal(sb.notes().length, 0);
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
