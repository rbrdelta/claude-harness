// Session hooks and the bridge watchdog: hooks/*.sh, run as real bash in a sandboxed HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, stamp, today, REPO } from './helpers.mjs';

const hook = (n) => join(REPO, 'hooks', n);

// pgrep shim: cron / bridge are "up" when FAKE_UP names them.
const PGREP = `for a in "$@"; do case "$a" in
  cron) [[ "$FAKE_UP" == *cron* ]] && exit 0 || exit 1;;
  "claude remote-control") [[ "$FAKE_UP" == *bridge* ]] && { echo 4242; exit 0; } || exit 1;;
esac; done; exit 1`;

test('log-tool-use: appends one JSON line per call to the dated tool-use log and never blocks', () => {
  const sb = sandbox();
  const payload = '{"tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"s1"}';
  const r = sb.run('bash', [hook('log-tool-use.sh')], { input: payload });
  assert.equal(r.code, 0);
  const lines = sb.read(`.claude/logs/tool-use-${today()}.jsonl`).trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.hook.tool_name, 'Bash');
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(sb.run('bash', [hook('log-tool-use.sh')], { input: 'not json' }).code, 0);
});

test('log-permission-request: records the full payload verbatim to the dated permission-events log', () => {
  const sb = sandbox();
  const payload = '{"hook_event_name":"PermissionDenied","tool_name":"Bash","permission_mode":"auto"}';
  assert.equal(sb.run('bash', [hook('log-permission-request.sh')], { input: payload }).code, 0);
  const row = JSON.parse(sb.read(`.claude/logs/permission-events-${today()}.jsonl`).trim());
  assert.equal(row.event.hook_event_name, 'PermissionDenied');
});

test('desktop-reminders: prints each reminder once on a laptop session, then archives it', () => {
  const sb = sandbox();
  sb.write('.claude/reminders/desktop/a.txt', 'renew the key');
  const r = sb.run('bash', [hook('desktop-reminders.sh')], { env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } });
  assert.match(r.out, /REMINDER FOR DANIEL .*renew the key/);
  assert.ok(!sb.exists('.claude/reminders/desktop/a.txt'));
  const done = readdirSync(sb.path('.claude/reminders/desktop/done'));
  assert.equal(done.length, 1);
  assert.match(done[0], /^\d{8}-a\.txt$/);
  const again = sb.run('bash', [hook('desktop-reminders.sh')], { env: { CLAUDE_CODE_ENTRYPOINT: 'cli' } });
  assert.equal(again.out, '');
  assert.match(sb.read('.claude/reminders/desktop-reminders.log'), /kind=none entry=cli/);
});

test('desktop-reminders: bridge (phone) sessions and scheduled claude -p runs leave the reminder waiting', () => {
  const sb = sandbox();
  sb.write('.claude/reminders/desktop/a.txt', 'x');
  assert.equal(sb.run('bash', [hook('desktop-reminders.sh')], { env: { CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_ENVIRONMENT_KIND: 'bridge' } }).out, '');
  assert.equal(sb.run('bash', [hook('desktop-reminders.sh')], { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' } }).out, '');
  assert.ok(sb.exists('.claude/reminders/desktop/a.txt'));
});

function harness(sb, env = {}) {
  sb.shim('pgrep', PGREP);
  sb.write('.claude/reminders/.keep', '');
  return sb.run('bash', [hook('harness-check.sh')], { env: { FAKE_UP: 'cron bridge', CLAUDE_CODE_ENTRYPOINT: 'sdk-cli', ...env } });
}

test('harness-check: sync logs — no log, stale, failing, auth expired and empty key are each named', () => {
  const sb = sandbox();
  sb.write('.claude/hooks/vault-sync.log', `${stamp(30)} OK: {}\n`);
  sb.write('.claude/hooks/notion-sync.log', `${stamp(2)} OK: {}\n${stamp(1)} AUTH_EXPIRED: Notion token\n`);
  const r = harness(sb);
  assert.equal(r.code, 0);
  assert.match(r.out, /^HARNESS: .*Run \/harness for details\./);
  assert.match(r.out, /CLAUDE\.AI SYNC: STALE \(30h\)/);
  assert.match(r.out, /NOTION SYNC: AUTH EXPIRED \(2h\)/);
  assert.doesNotMatch(r.out, /APPLE NOTES/, 'Apple Notes is retired: no warning');

  const sb2 = sandbox();
  sb2.write('.claude/hooks/vault-sync.log', `${stamp(3)} OK: {}\n${stamp(1)} FAIL (exit 1): boom\n`);
  sb2.write('.claude/hooks/notion-sync.log', `${stamp(3)} OK: {}\n${stamp(1)} SKIP: Token file is empty\n`);
  const r2 = harness(sb2);
  assert.match(r2.out, /CLAUDE\.AI SYNC: FAILING \(3h\)/);
  assert.match(r2.out, /NOTION SYNC: KEY EMPTY \(3h\)/);
});

test('harness-check: a healthy sync source says nothing', () => {
  const sb = sandbox();
  sb.write('.claude/hooks/vault-sync.log', `${stamp(1)} OK: {}\n`);
  sb.write('.claude/hooks/notion-sync.log', `${stamp(1)} OK: {}\n`);
  const r = harness(sb);
  assert.doesNotMatch(r.out, /CLAUDE\.AI SYNC|NOTION SYNC|CRON DOWN|BRIDGE DOWN/);
});

test('harness-check: weekly jobs — never ran is silent, last run failed and stale are named', () => {
  const sb = sandbox();
  sb.write('.claude/hooks/weekly-sprint-review.log', `${stamp(48)} OK: x\n${stamp(1)} FAIL (exit 1): no prep doc\n`);
  sb.write('.claude/hooks/thought-scrub.log', `${stamp(72)} OK: {}\n`);
  sb.write('.claude/hooks/weekly-digest.log', `${stamp(1)} START\n`);
  const r = harness(sb);
  assert.match(r.out, /SPRINT REVIEW: LAST RUN FAILED/);
  assert.match(r.out, /THOUGHT SCRUB: STALE \(3d\)/);
  assert.match(r.out, /DIGEST: NEVER COMPLETED/);
  assert.doesNotMatch(r.out, /NORTHSTAR/);
});

test('harness-check: cron down and bridge down are flagged', () => {
  const r = harness(sandbox(), { FAKE_UP: '' });
  assert.match(r.out, /CRON DOWN/);
  assert.match(r.out, /BRIDGE DOWN/);
});

test('harness-check: active projects — more than 10 uncommitted files, or no git, are flagged; a parent of nested repos is not', () => {
  const sb = sandbox();
  const g = (dir) => sb.run('git', ['init', '-q', dir]);
  g(sb.path('projects/active/busy'));
  for (let i = 0; i < 11; i++) sb.write(`projects/active/busy/f${i}`, 'x');
  g(sb.path('projects/active/calm'));
  for (let i = 0; i < 10; i++) sb.write(`projects/active/calm/f${i}`, 'x');
  sb.write('projects/active/loose/notes.md', 'x');
  g(sb.path('projects/active/web/site'));
  for (let i = 0; i < 12; i++) sb.write(`projects/active/web/site/f${i}`, 'x');
  const r = harness(sb);
  assert.match(r.out, /DIRTY\(11\): busy\./);
  assert.doesNotMatch(r.out, /calm/);
  assert.match(r.out, /NO GIT: loose\./);
  assert.doesNotMatch(r.out, /NO GIT: web/);
  assert.match(r.out, /DIRTY\(12\): web\/site\./);
});

test('harness-check: remote-control health log over 1 MB is flagged', () => {
  const sb = sandbox();
  sb.write('.claude/remote-control-health.log', 'x'.repeat(2.2 * 1048576));
  assert.match(harness(sb).out, /REMOTE-CTL LOG 2MB/);
});

test('harness-check: with a session key on disk, a Claude.ai sync 8h+ old fires a catch-up sync; a fresh one does not', async () => {
  const sb = sandbox();
  sb.write('.claude_session_key', 'sk-abc\n');
  sb.write('.claude/hooks/vault-sync.sh', `#!/bin/bash\ntouch "$HOME/catchup-fired"\n`, 0o755);
  sb.write('.claude/hooks/vault-sync.log', `${stamp(9)} OK: {}\n`);
  harness(sb);
  for (let i = 0; i < 50 && !sb.exists('catchup-fired'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(sb.exists('catchup-fired'), 'catch-up sync should have started');

  const sb2 = sandbox();
  sb2.write('.claude_session_key', 'sk-abc\n');
  sb2.write('.claude/hooks/vault-sync.sh', `#!/bin/bash\ntouch "$HOME/catchup-fired"\n`, 0o755);
  sb2.write('.claude/hooks/vault-sync.log', `${stamp(2)} OK: {}\n`);
  harness(sb2);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!sb2.exists('catchup-fired'));

  const sb3 = sandbox(); // empty key: no catch-up
  sb3.write('.claude_session_key', '  \n');
  sb3.write('.claude/hooks/vault-sync.sh', `#!/bin/bash\ntouch "$HOME/catchup-fired"\n`, 0o755);
  harness(sb3);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!sb3.exists('catchup-fired'));
});

test('harness-check: runs the desktop reminders as part of session start', () => {
  const sb = sandbox();
  sb.write('.claude/reminders/desktop/r.txt', 'hello laptop');
  const r = harness(sb, { CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.match(r.out, /REMINDER FOR DANIEL .*hello laptop/);
});

test('session-stats-hook: no session id, or a session with no transcript, exits 0 quietly', () => {
  const sb = sandbox();
  const a = sb.run('bash', [hook('session-stats-hook.sh')], { input: '{}' });
  assert.equal(a.code, 0); assert.equal(a.out, '');
  const b = sb.run('bash', [hook('session-stats-hook.sh')], { input: '{"session_id":"no-such-session"}' });
  assert.equal(b.code, 0); assert.equal(b.out, '');
});

test('phone-notes-check: runs the phone-notes pull check; warns if that check is missing', () => {
  const sb = sandbox();
  const miss = sb.run('bash', [hook('phone-notes-check.sh')]);
  assert.match(miss.out, /^WARNING phone-notes: .*pull-check\.sh missing/);
  sb.write('projects/active/phone-notes/scripts/pull-check.sh', 'echo "PHONE NOTES: stale"');
  assert.equal(sb.run('bash', [hook('phone-notes-check.sh')]).out.trim(), 'PHONE NOTES: stale');
});

test('phone-notes-pull: runs the phone-notes pull script under node with a 120 s timeout', () => {
  const sb = sandbox();
  sb.write('projects/active/phone-notes/scripts/pull.mjs', 'console.log("pulled", process.argv.length)');
  const r = sb.run('bash', [hook('phone-notes-pull.sh')]);
  assert.equal(r.code, 0);
  assert.match(r.out, /pulled/);
  assert.match(readFileSync(hook('phone-notes-pull.sh'), 'utf8'), /exec timeout 120 /);
});

test('daily-standard-pull: pulls and backs up quietly, prints only ds status; silent if ds is absent', () => {
  const sb = sandbox();
  assert.equal(sb.run('bash', [hook('daily-standard-pull.sh')]).out, '');
  sb.write('projects/active/daily-standard/scripts/ds.mjs',
    `import fs from 'node:fs'; const c=process.argv[2]; fs.appendFileSync(process.env.HOME+'/ds-calls', c+'\\n');
     if (c==='pull') { console.log('noise'); process.exit(3); } if (c==='status') console.log('DAILY STANDARD: 2 pending');`);
  const r = sb.run('bash', [hook('daily-standard-pull.sh')]);
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'DAILY STANDARD: 2 pending');
  assert.deepEqual(sb.read('ds-calls').trim().split('\n'), ['pull', 'backup', 'status']);
});

function adviceCopy(sb) {
  return sb.copyScript('hooks/advice-expiry-check.sh', 'bin/advice-expiry-check.sh',
    { '/mnt/c/MCP/Meta/Standing Advice Register.md': sb.path('register.md') });
}
const REGISTER = `| Advice | Given | Re-check condition | Review-by | Status |
|---|---|---|---|---|
| Distribution is secondary | 2026-06-01 | after EP03 | 2020-01-01 | active |
| Ship weekly | 2026-06-01 | if burnout | 2099-01-01 | active |
| Old rule | 2026-01-01 | never | 2020-01-01 | retired |
`;

test('advice-expiry-check: lists active advice past its review-by date, never retired or future rows', () => {
  const sb = sandbox();
  const s = adviceCopy(sb);
  assert.equal(sb.run('bash', [s]).out, '', 'no register: silent');
  sb.write('register.md', REGISTER);
  const r = sb.run('bash', [s]);
  assert.equal(r.code, 0);
  assert.match(r.out, /## Standing advice — overdue for re-examination/);
  assert.match(r.out, /- \*\*OVERDUE since 2020-01-01:\*\* Distribution is secondary/);
  assert.doesNotMatch(r.out, /Ship weekly|Old rule/);
});

test('advice-expiry-check: given a note path, appends the overdue block to that note', () => {
  const sb = sandbox();
  const s = adviceCopy(sb);
  sb.write('register.md', REGISTER);
  const note = sb.write('digest.md', '# Digest\n');
  assert.equal(sb.run('bash', [s, note]).out, '');
  assert.match(sb.read('digest.md'), /^# Digest\n\n## Standing advice — overdue/);
  sb.write('register.md', REGISTER.replace('2020-01-01 | active', '2099-01-01 | active'));
  const before = sb.read('digest.md');
  sb.run('bash', [s, note]);
  assert.equal(sb.read('digest.md'), before, 'nothing overdue: note untouched');
});

function skillsRepo(sb) {
  sb.write('.gitconfig', '[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = main\n');
  sb.run('git', ['init', '-q', '--bare', sb.path('remote.git')]);
  const d = sb.path('.claude/skills');
  sb.run('git', ['init', '-q', d]);
  sb.write('.claude/skills/a/SKILL.md', 'a');
  sb.run('git', ['-C', d, 'add', '-A']);
  sb.run('git', ['-C', d, 'commit', '-qm', 'init']);
  sb.run('git', ['-C', d, 'remote', 'add', 'origin', sb.path('remote.git')]);
  sb.run('git', ['-C', d, 'push', '-qu', 'origin', 'main']);
  return d;
}
const remoteHead = (sb) => sb.run('git', ['--git-dir', sb.path('remote.git'), 'log', '-1', '--format=%s']).out.trim();

test('backup-skills: nothing changed and nothing unpushed does nothing', () => {
  const sb = sandbox();
  skillsRepo(sb);
  assert.equal(sb.run('bash', [hook('backup-skills.sh')]).code, 0);
  assert.ok(!sb.exists('.claude/hooks/backup-skills.log'));
  assert.equal(remoteHead(sb), 'init');
});

test('backup-skills: a dirty skills tree is committed and pushed', () => {
  const sb = sandbox();
  skillsRepo(sb);
  sb.write('.claude/skills/b/SKILL.md', 'b');
  sb.run('bash', [hook('backup-skills.sh')]);
  assert.match(remoteHead(sb), /^Auto-backup skills \(\d{4}-\d{2}-\d{2} /);
  assert.match(sb.read('.claude/hooks/backup-skills.log'), /backed up \+ pushed/);
});

test('backup-skills: a failed push is logged and retried on the next stop even with a clean tree', () => {
  const sb = sandbox();
  const d = skillsRepo(sb);
  sb.run('git', ['-C', d, 'remote', 'set-url', 'origin', sb.path('nowhere.git')]);
  sb.write('.claude/skills/c/SKILL.md', 'c');
  assert.equal(sb.run('bash', [hook('backup-skills.sh')]).code, 0);
  assert.match(sb.read('.claude/hooks/backup-skills.log'), /commit ok; push failed \(will retry next stop\)/);
  sb.run('git', ['-C', d, 'remote', 'set-url', 'origin', sb.path('remote.git')]);
  sb.run('bash', [hook('backup-skills.sh')]);
  assert.match(remoteHead(sb), /^Auto-backup skills/);
});

test('backup-skills: no skills repo is a no-op', () => {
  const sb = sandbox();
  assert.equal(sb.run('bash', [hook('backup-skills.sh')]).code, 0);
});

// --- Bridge (remote control) watchdog -----------------------------------------------------------

// tmux/pgrep read flag files: $HOME/tmux-up and $HOME/proc-up. The fake remote-control.sh "starts"
// the bridge by creating both flags unless $HOME/start-fails exists.
function bridge(sb, { tmux, proc }) {
  if (tmux) sb.write('tmux-up', ''); if (proc) sb.write('proc-up', '');
  sb.shim('tmux', `[ "$1" = has-session ] && { [ -f "$HOME/tmux-up" ]; exit $?; }; exit 0`);
  sb.shim('pgrep', `[ -f "$HOME/proc-up" ] && { echo 4242; exit 0; }; exit 1`);
  sb.shim('pkill', `rm -f "$HOME/proc-up"`);
  sb.write('.claude/channels/telegram/.env', 'TELEGRAM_BOT_TOKEN=tok123\n');
  sb.write('.claude/channels/telegram/access.json', '{"allowFrom":["555"]}');
  sb.write('rc/remote-control.sh', `echo "rc $*" >> "$SHIM_LOG"; [ -f "$HOME/start-fails" ] || touch "$HOME/tmux-up" "$HOME/proc-up"`, 0o755);
  return sb.copyScript('hooks/remote-control-health.sh', 'rc/remote-control-health.sh');
}
const pings = (sb) => sb.calls().filter((c) => c.startsWith('curl')).map((c) => (c.match(/\[text=([^\]]*)\]/) || [])[1]);
const state = (sb) => Object.fromEntries(sb.read('.claude/remote-control-state').trim().split('\n').map((l) => l.split('=')).map(([k, v]) => [k, v.replace(/"/g, '')]));

test('remote-control-health: healthy bridge writes ok state and sends nothing', () => {
  const sb = sandbox();
  const s = bridge(sb, { tmux: true, proc: true });
  sb.run('bash', [s]);
  assert.deepEqual(pings(sb), []);
  assert.equal(state(sb).last_state, 'ok');
});

test('remote-control-health: a dead bridge is restarted; restart OK sends no alert on a first failure', () => {
  const sb = sandbox();
  const s = bridge(sb, { tmux: false, proc: false });
  sb.run('bash', [s]);
  assert.ok(sb.calls().some((c) => c.startsWith('rc start')));
  assert.match(sb.read('.claude/remote-control-health.log'), /RESTART: tmux session and process both dead\n.*RESTART OK/);
  assert.deepEqual(pings(sb), []);
  assert.equal(state(sb).last_state, 'ok');
});

test('remote-control-health: an orphaned bridge process (no tmux) is killed before restart', () => {
  const sb = sandbox();
  const s = bridge(sb, { tmux: false, proc: true });
  sb.run('bash', [s]);
  assert.ok(sb.calls().some((c) => c.startsWith('pkill')));
  assert.match(sb.read('.claude/remote-control-health.log'), /orphaned process without tmux session/);
});

test('remote-control-health: failed restarts alert on a ramp — at once, +30 min, +2 h, then every +6 h', () => {
  const sb = sandbox();
  const s = bridge(sb, { tmux: false, proc: false });
  sb.write('start-fails', '');
  sb.run('bash', [s]);
  assert.deepEqual(pings(sb), ['Remote control DOWN: tmux session and process both dead']);
  assert.equal(state(sb).last_state, 'down');
  assert.equal(state(sb).last_alerted_at_age, '0');
  sb.run('bash', [s]); // a minute later: no new alert
  assert.equal(pings(sb).length, 1);
  const now = Math.floor(Date.now() / 1000);
  const at = (age, last) => sb.write('.claude/remote-control-state', `last_state="down"\nfirst_failure_ts=${now - age}\nlast_alerted_at_age=${last}\n`);
  at(1900, 0); sb.run('bash', [s]);
  assert.match(pings(sb)[1], /^Remote control still down \(31m\)/);
  assert.equal(state(sb).last_alerted_at_age, '1800');
  at(7000, 1800); sb.run('bash', [s]);
  assert.equal(pings(sb).length, 2, 'under 2 h: no alert');
  at(7300, 1800); sb.run('bash', [s]);
  assert.equal(pings(sb).length, 3);
  assert.equal(state(sb).last_alerted_at_age, '7200');
  at(7200 + 21600 - 60, 7200); sb.run('bash', [s]);
  assert.equal(pings(sb).length, 3, 'under +6 h: no alert');
  at(7200 + 21600 + 60, 7200); sb.run('bash', [s]);
  assert.equal(pings(sb).length, 4);
  assert.equal(state(sb).last_alerted_at_age, String(7200 + 21600));
});

test('remote-control-health: recovery after an outage logs the duration and sends one recovered ping', () => {
  const sb = sandbox();
  const s = bridge(sb, { tmux: true, proc: true });
  sb.write('.claude/remote-control-state', `last_state="down"\nfirst_failure_ts=${Math.floor(Date.now() / 1000) - 600}\nlast_alerted_at_age=0\n`);
  sb.run('bash', [s]);
  assert.deepEqual(pings(sb), ['Remote control recovered after 10m']);
  assert.match(sb.read('.claude/remote-control-health.log'), /RECOVERED after 10m/);
  assert.equal(state(sb).last_state, 'ok');
});

test('remote-control.sh: status reports running, tmux-only, or not running with matching exit codes', () => {
  const sb = sandbox();
  bridge(sb, { tmux: true, proc: true });
  const rc = join(REPO, 'hooks', 'remote-control.sh');
  let r = sb.run('bash', [rc, 'status']);
  assert.equal(r.code, 0); assert.match(r.out, /^RUNNING \(tmux session: claude-remote, PID: 4242\)/);
  sb.run('rm', [sb.path('proc-up')]);
  r = sb.run('bash', [rc, 'status']);
  assert.equal(r.code, 1); assert.match(r.out, /TMUX ALIVE BUT PROCESS DEAD/);
  sb.run('rm', [sb.path('tmux-up')]);
  r = sb.run('bash', [rc, 'status']);
  assert.equal(r.code, 1); assert.match(r.out, /NOT RUNNING/);
});

test('remote-control.sh: start is idempotent, starts claude remote-control in tmux, and aborts if claude is missing', () => {
  const sb = sandbox();
  bridge(sb, { tmux: true, proc: true });
  const rc = join(REPO, 'hooks', 'remote-control.sh');
  assert.match(sb.run('bash', [rc]).out, /Remote control already running/);
  sb.run('rm', [sb.path('proc-up')]);
  sb.write('.claude/remote-control.log', 'line\n'.repeat(2.2e6));
  const r = sb.run('bash', [rc]);
  assert.match(r.out, /Started remote control \(dir: .*, claude: .*shim-bin\/claude\)/);
  const tmuxCalls = sb.calls().filter((c) => c.startsWith('tmux'));
  assert.ok(tmuxCalls.some((c) => c.includes('[kill-session]')), 'stale tmux session killed first');
  assert.ok(tmuxCalls.some((c) => c.includes('[new-session]') && c.includes('claude remote-control')));
  assert.equal(sb.read('.claude/remote-control.log').split('\n').filter(Boolean).length, 1000, 'activity log over 10 MB capped to 1000 lines');
  sb.run('rm', [sb.path('tmux-up')]);
  // A PATH with the tmux/pgrep shims but no claude anywhere (never the real tmux: it would touch the live bridge).
  const noClaude = sb.path('no-claude-bin');
  for (const n of ['tmux', 'pgrep', 'pkill', 'sleep']) sb.write(`no-claude-bin/${n}`, readFileSync(join(sb.bin, n), 'utf8'), 0o755);
  for (const n of ['bash', 'date', 'tee', 'dirname', 'stat', 'tail', 'mv', 'printf']) sb.run('ln', ['-s', `/usr/bin/${n}`, join(noClaude, n)]);
  const abort = sb.run('/usr/bin/bash', [rc], { env: { PATH: noClaude } });
  assert.equal(abort.code, 1);
  assert.match(abort.out, /START ABORTED: claude not found on PATH/);
});

test('harness-check: job scan — names new/closed postings for 3 days, silent when nothing changed or the scan is old; stale and failed are named', () => {
  let sb = sandbox();
  sb.write('.claude/hooks/job-scan.log', `${stamp(5)} OK: new=2 closed=1 unreadable=0 manual=1 current=9\n`);
  assert.match(harness(sb).out, /JOB SCAN: 2 new opening\(s\), 1 Pipeline posting\(s\) closed — vault: job search\/2026 ai pm\/Job scan — weekly\.md/);
  sb = sandbox();
  sb.write('.claude/hooks/job-scan.log', `${stamp(5)} OK: new=0 closed=0 unreadable=0 manual=1 current=9\n`);
  assert.doesNotMatch(harness(sb).out, /JOB SCAN/);
  sb = sandbox();
  sb.write('.claude/hooks/job-scan.log', `${stamp(24 * 10)} OK: new=4 closed=0 unreadable=0 manual=1 current=9\n`);
  const r = harness(sb).out;
  assert.match(r, /JOB SCAN: STALE \(10d\)/);
  assert.doesNotMatch(r, /new opening/);
  sb = sandbox();
  sb.write('.claude/hooks/job-news.log', `${stamp(24 * 3)} OK: 12\n${stamp(1)} FAIL: run finished but note was not written\n`);
  assert.match(harness(sb).out, /JOB NEWS: LAST RUN FAILED/);
});
