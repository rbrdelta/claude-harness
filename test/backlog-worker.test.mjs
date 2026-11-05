// tools/backlog-worker.mjs against a real git repo with a bare origin, a fake ds (item list from a file, task-set recorded),
// a stand-in model, a fake verify and a fake capabilities gate. Nothing live is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sandbox, REPO } from './helpers.mjs';

const item = (over = {}) => ({ id: 'i1', text: 'Fix the thing', detail: 'why', project: 'Proj', status: 'open', step: 'upkeep', auto: 'yes', order: 1, ...over });
const COMMIT = 'echo fixed >> f.txt; git add -A; git -c user.name=t -c user.email=t@t commit -qm fix;';

function setup(items, { model = `${COMMIT} echo "RESULT: done fixed it"`, verify = 0, gate = 0, deploy, deployFails = false } = {}) {
  const sb = sandbox();
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', sb.path('origin.git')]);
  execFileSync('git', ['init', '-q', '-b', 'main', sb.path('repo')]);
  const dir = sb.path('repo');
  sb.write('repo/f.txt', 'start\n');
  g(dir, 'add', '-A'); g(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'start');
  g(dir, 'remote', 'add', 'origin', sb.path('origin.git')); g(dir, 'push', '-q', '-u', 'origin', 'main');
  sb.write('items.json', JSON.stringify(items));
  sb.write('ds.mjs', `import fs from 'node:fs'; const a=process.argv.slice(2); fs.appendFileSync(process.env.SHIM_LOG,'ds '+a.join(' ')+'\\n'); if(a[0]==='backlog') console.log(fs.readFileSync(process.env.HOME+'/items.json','utf8'));`);
  sb.write('pm-note.mjs', `import fs from 'node:fs'; fs.appendFileSync(process.env.SHIM_LOG,'note '+process.argv[2]+'\\n'+fs.readFileSync(0,'utf8'));`);
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"`, 0o755);
  sb.write('gate.py', `import sys\nprint('stale file', file=sys.stderr) if ${gate} else None\nsys.exit(${gate})\n`);
  sb.write('verify.sh', `#!/bin/bash\necho verify >> "$SHIM_LOG"; echo "verify output"; exit ${verify}`, 0o755);
  sb.shim('claude', model);
  const repos = { Proj: { dir, verify: sb.path('verify.sh'), ...(deploy ? { deploy: deployFails ? 'echo deploy >> "$SHIM_LOG"; exit 1' : 'echo deploy >> "$SHIM_LOG"' } : {}) } };
  sb.work = () => sb.run(process.execPath, [join(REPO, 'tools/backlog-worker.mjs')], {
    env: { BW_DS: sb.path('ds.mjs'), BW_PM_NOTE: sb.path('pm-note.mjs'), BW_NOTIFY: sb.path('notify.sh'), BW_GATE: sb.path('gate.py'), BW_REPOS: JSON.stringify(repos), BW_DS_WAIT_S: '0' },
  });
  sb.origin = () => g(sb.path('origin.git'), 'rev-parse', 'main').trim();
  sb.local = () => g(dir, 'rev-parse', 'main').trim();
  sb.branches = () => g(dir, 'branch', '--list', 'worker/*').trim();
  sb.status = () => g(dir, 'status', '--porcelain').trim();
  sb.dir = dir; sb.g = g;
  return sb;
}
const lastLog = (sb) => sb.read('.claude/hooks/backlog-worker.log').trim().split('\n').pop();
const has = (sb, re) => sb.calls().some((c) => re.test(c));

test('backlog-worker: nothing marked means no model run, and one OK line so a silent worker shows as stale', () => {
  const sb = setup([item({ auto: undefined }), item({ id: 'i2', step: 'job-search/apply' }), item({ id: 'i3', status: 'done' })]);
  assert.equal(sb.work().code, 0);
  assert.ok(!has(sb, /^claude/));
  assert.match(lastLog(sb), /OK: nothing marked/);
});

test('backlog-worker: a clean pass pushes, closes the item and writes one line to the PM note', () => {
  const sb = setup([item()]);
  const before = sb.origin();
  assert.equal(sb.work().code, 0);
  assert.notEqual(sb.origin(), before);
  assert.equal(sb.origin(), sb.local());
  assert.ok(has(sb, /^ds task-set i1 status=done autoNote=fixed it/));
  assert.ok(has(sb, /^- Shipped: Fix the thing\. fixed it \(/));
  assert.ok(!has(sb, /^notify/), 'a clean night sends no Telegram');
  assert.match(lastLog(sb), /OK: 1 shipped, 0 stopped, 0 skipped/);
});

test('backlog-worker: a failed verify ships nothing, keeps the work on a branch and never loops', () => {
  const sb = setup([item()], { verify: 1 });
  const before = sb.origin();
  sb.work();
  assert.equal(sb.origin(), before, 'nothing pushed');
  assert.equal(sb.local(), before, 'main back where it started');
  assert.match(sb.branches(), /worker\/i1-/);
  assert.ok(has(sb, /^ds task-set i1 auto=stopped autoNote=verify failed/));
  assert.ok(has(sb, /^notify Backlog worker: 0 shipped, 1 stopped/));
});

test('backlog-worker: the model cannot push from inside its run', () => {
  const sb = setup([item()], { model: `${COMMIT} git push origin main 2>/dev/null && echo PUSHED >> "$SHIM_LOG"; echo "RESULT: done fixed it"`, verify: 1 });
  const before = sb.origin();
  sb.work();
  assert.ok(!has(sb, /^PUSHED/));
  assert.equal(sb.origin(), before);
});

test('backlog-worker: the capabilities gate can refuse', () => {
  const sb = setup([item()], { gate: 2 });
  const before = sb.origin();
  sb.work();
  assert.equal(sb.origin(), before);
  assert.ok(has(sb, /^ds task-set i1 auto=stopped autoNote=capabilities gate refused: stale file/));
  assert.ok(!has(sb, /^verify/));
});

test('backlog-worker: a question stops the item, keeps any work and asks in the note', () => {
  const sb = setup([item()], { model: `echo half >> f.txt; echo "RESULT: ask which log should it read?"` });
  const before = sb.origin();
  sb.work();
  assert.equal(sb.origin(), before);
  assert.equal(sb.status(), '', 'tree left clean');
  assert.match(sb.branches(), /worker\/i1-/);
  assert.ok(has(sb, /^- Stopped: Fix the thing\. question: which log should it read\?/));
});

test('backlog-worker: no result line, or a crashed model, ships nothing', () => {
  for (const model of [`${COMMIT} echo all good`, `${COMMIT} echo "RESULT: done x"; exit 3`]) {
    const sb = setup([item()], { model });
    const before = sb.origin();
    sb.work();
    assert.equal(sb.origin(), before);
    assert.ok(has(sb, /auto=stopped autoNote=the model run ended without a result/));
  }
});

test('backlog-worker: uncommitted changes after a done are not shipped', () => {
  const sb = setup([item()], { model: `${COMMIT} echo more >> f.txt; echo "RESULT: done fixed it"` });
  const before = sb.origin();
  sb.work();
  assert.equal(sb.origin(), before);
  assert.ok(has(sb, /autoNote=the model left uncommitted changes/));
});

test('backlog-worker: a repo someone is working in is left alone and retried next run', () => {
  const sb = setup([item()]);
  sb.write('repo/wip.txt', 'mine');
  sb.work();
  assert.ok(!has(sb, /^claude/));
  assert.equal(sb.read('repo/wip.txt'), 'mine');
  assert.ok(!has(sb, /^ds task-set/), 'still marked for next time');
  assert.match(lastLog(sb), /OK: 0 shipped, 0 stopped, 1 skipped/);
});

test('backlog-worker: a project with no repo stops without a model run; a night takes at most three items', () => {
  const sb = setup([item({ project: 'Elsewhere' })]);
  sb.work();
  assert.ok(!has(sb, /^claude/));
  assert.ok(has(sb, /auto=stopped autoNote=the worker has no repo for Elsewhere/));
  const many = setup([1, 2, 3, 4].map((n) => item({ id: `i${n}`, order: n })));
  many.work();
  assert.match(lastLog(many), /OK: 3 shipped/);
  assert.ok(!has(many, /task-set i4/));
});

test('backlog-worker: a deploy runs after the push; a failed deploy says so plainly', () => {
  const ok = setup([item()], { deploy: true });
  ok.work();
  assert.ok(has(ok, /^deploy/));
  assert.equal(ok.calls().filter((c) => c === 'verify').length, 2, 'verify before the push and after the deploy');
  const bad = setup([item()], { deploy: true, deployFails: true });
  bad.work();
  assert.ok(has(bad, /^- Stopped: Fix the thing\. PUSHED, but deploy or the check after it failed/));
  assert.ok(has(bad, /^notify/));
});

test('backlog-worker: a database that can not be read logs FAIL and sends a message', () => {
  const sb = setup([item()]);
  sb.write('ds.mjs', `console.error('boom'); process.exit(1)`);
  assert.equal(sb.work().code, 1);
  assert.match(lastLog(sb), /FAIL: ds backlog: boom/);
  assert.ok(has(sb, /^notify Backlog worker failed/));
});
