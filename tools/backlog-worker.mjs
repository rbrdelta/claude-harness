#!/usr/bin/env node
// Backlog worker (Daniel, 2026-11-05: "how do you just do it without us having this conversation").
// Each night, takes the work items the PM run marked auto=yes and finishes them with nobody at the keyboard.
//   backlog-worker.mjs   run by backlog-worker.timer (via triggers/backlog-worker.sh)
// The model only edits and commits; its environment can't push. This script alone runs the capabilities gate and
// the project's verify, and pushes and deploys only on a clean pass. (On 11-04 a deploy went out past a failed test
// because the check was in a command line, so the gate lives here, in code.) Anything else moves to a local
// worker/<id> branch, so nothing is lost and nothing ships; the item is marked auto=stopped, so it never loops.
// First week: upkeep items only, in the repos below. rowbyroh is left out: a push there is a public deploy.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HOME = process.env.HOME;
const P = `${HOME}/projects/active`;
const DS = process.env.BW_DS || `${P}/daily-standard/scripts/ds.mjs`;
const PM_NOTE = process.env.BW_PM_NOTE || `${P}/phone-notes/scripts/pm-note.mjs`;
const NOTIFY = process.env.BW_NOTIFY || `${P}/claude-harness/tools/telegram-notify.sh`;
const GATE = process.env.BW_GATE || `${P}/claude-harness/hooks/capabilities-gate.py`;
const CLAUDE = process.env.BW_CLAUDE || 'claude';
const MODEL = process.env.BW_MODEL || 'opus';
const LOG = `${HOME}/.claude/hooks/backlog-worker.log`;
const OUT = `${HOME}/.claude/logs`;
const MAX_ITEMS = 3; // a night's run stays small enough to read in one note
const DS_WAIT_S = Number(process.env.BW_DS_WAIT_S ?? 15);
const CF = 'set -a; . ~/.config/cloudflare/env; set +a; ';
const REPOS = process.env.BW_REPOS ? JSON.parse(process.env.BW_REPOS) : {
  'Claude Harness': { dir: `${P}/claude-harness`, verify: './verify.sh' },
  Harness: { dir: `${P}/claude-harness`, verify: './verify.sh' },
  'PKM / Obsidian MCP': { dir: `${P}/obsidian-mcp`, verify: 'npm run promote' },
  'Daily Standard': { dir: `${P}/daily-standard`, verify: './verify.sh', deploy: 'npm run deploy' },
  'Phone Notes': { dir: `${P}/phone-notes`, verify: './verify.sh', deploy: `${CF}npm run build && npx wrangler deploy` },
};
const TRANSIENT = /fetch failed|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/;
// The model's git can't reach the remote: any push from inside its run fails.
const NO_PUSH = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.origin.pushurl', GIT_CONFIG_VALUE_0: 'file:///backlog-worker-may-not-push' };

const stamp = () => new Date().toLocaleString('sv-SE').slice(0, 19); // the local "YYYY-MM-DD HH:MM:SS" harness-check reads
const log = (m) => appendFileSync(LOG, `${stamp()} ${m}\n`);
const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' | ').slice(0, 400);
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });
const sh = (cmd, cwd, timeout = 1800000) => run('bash', ['-c', cmd], { cwd, timeout });
const git = (dir, ...a) => { const r = run('git', ['-C', dir, ...a]); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${oneLine(r.stderr)}`); return r.stdout.trim(); };
const notify = (m) => { if (run(NOTIFY, [m]).status !== 0) log('telegram send failed'); };

function ds(...a) {
  for (let attempt = 1; ; attempt++) {
    const r = run(process.execPath, [DS, ...a]);
    if (r.status === 0) return r.stdout;
    if (attempt >= 3 || !TRANSIENT.test(r.stderr)) throw new Error(`ds ${a[0]}: ${oneLine(r.stderr)}`);
    run('sleep', [String(DS_WAIT_S)]);
  }
}

const prompt = (t) => `You are the backlog worker: a scheduled run, no one at the keyboard. Finish this one work item from Daniel's backlog, in this repo.

Item: ${t.text}
Detail: ${t.detail || '(none)'}

Read this repo's CLAUDE.md first. Make the smallest change that finishes the item, with a test where the project has tests. Commit to the current branch. End the commit message with:
Co-Authored-By: Claude <noreply@anthropic.com>

Capabilities: if the code's behavior changes, update the project's capabilities file before committing (CAPABILITIES.md in the repo; for a public repo, /mnt/c/MCP/Sources/Capabilities/<name>.md, with checked_commit set to your last commit, after that commit). If nothing a user or job can do has changed, put a line 'capabilities: no change' in the commit message.

You cannot push or deploy, and must not try: this script runs the project's verify after you and ships only on a pass. Run the verify yourself first if you can.

Stop and ask instead of finishing if: the item has more than one reasonable reading; it needs a decision that shapes the tool long term; it needs money, an account, or a new service; it changes what the public sees; it would touch settings.json, permissions, guardrails, Daniel's written words, or anything about the sound experiment's design. Never read /mnt/c/MCP/Confidential/ or any personal phone note. Never force, skip hooks, or delete anything outside this repo. If one fix attempt fails, stop and say what failed.

Your last line must be exactly one of:
RESULT: done <what changed, in plain words, one sentence>
RESULT: ask <one short plain question, naming what you checked>`;

// Everything the model left, committed or not, goes to a local branch; main goes back to where it started.
function shelve(t, dir, start) {
  const dirty = git(dir, 'status', '--porcelain');
  if (!dirty && git(dir, 'rev-parse', 'HEAD') === start) return null;
  const branch = `worker/${t.id}-${Date.now()}`;
  git(dir, 'checkout', '-q', '-b', branch);
  if (dirty) { git(dir, 'add', '-A'); git(dir, '-c', 'user.name=backlog-worker', '-c', 'user.email=noreply@anthropic.com', 'commit', '-q', '-m', `Backlog worker: unfinished work on ${t.id}`); }
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'reset', '-q', '--hard', start);
  return branch;
}

function stop(t, dir, start, reason) {
  const branch = dir ? shelve(t, dir, start) : null;
  const note = branch ? `${reason} (work kept on local branch ${branch})` : reason;
  ds('task-set', t.id, 'auto=stopped', `autoNote=${note}`);
  return { t, kind: 'stopped', note };
}

function work(t) {
  const repo = REPOS[t.project];
  if (!repo) return stop(t, null, null, `the worker has no repo for ${t.project}`);
  const { dir } = repo;
  // Someone may be working here: leave it alone and try again tomorrow.
  git(dir, 'fetch', '-q', 'origin', 'main');
  const start = git(dir, 'rev-parse', 'HEAD');
  if (git(dir, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'main' || git(dir, 'status', '--porcelain') || start !== git(dir, 'rev-parse', 'origin/main')) {
    return { t, kind: 'skipped', note: 'repo not clean and level with origin; tries again next run' };
  }

  const r = run(CLAUDE, ['-p', prompt(t), '--model', MODEL, '--allowedTools', 'Bash,Read,Write,Edit,Glob,Grep', '--permission-mode', 'bypassPermissions'],
    { cwd: dir, timeout: 3600000, env: { ...process.env, ...NO_PUSH, HARNESS_SCHEDULED: '1' } });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  writeFileSync(`${OUT}/backlog-worker-${t.id}-${Date.now()}.txt`, output);
  const m = [...output.matchAll(/^RESULT: (done|ask) (.+)$/gm)].pop();
  if (r.status !== 0 || !m) return stop(t, dir, start, `the model run ended without a result (exit ${r.status})`);
  if (m[1] === 'ask') return stop(t, dir, start, `question: ${m[2]}`);
  if (git(dir, 'status', '--porcelain')) return stop(t, dir, start, 'the model left uncommitted changes');

  if (git(dir, 'rev-parse', 'HEAD') === start) { // nothing to ship: already fixed, say so and close it
    ds('task-set', t.id, 'status=done', `autoNote=${m[2]}`);
    return { t, kind: 'shipped', note: m[2] };
  }
  const gate = run('python3', [GATE], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: dir, hook_event_name: 'PreToolUse' }) });
  if (gate.status !== 0) return stop(t, dir, start, `capabilities gate refused: ${oneLine(gate.stderr)}`);
  const v = sh(repo.verify, dir);
  if (v.status !== 0) return stop(t, dir, start, `verify failed: ${oneLine(`${v.stdout}${v.stderr}`.slice(-300))}`);

  git(dir, 'push', '-q', 'origin', 'main');
  if (repo.deploy) {
    const d = sh(repo.deploy, dir);
    const after = d.status === 0 ? sh(repo.verify, dir) : d;
    if (after.status !== 0) { // the commit is public and the live state is in doubt: this one can't be undone quietly
      ds('task-set', t.id, 'auto=stopped', `autoNote=pushed, but deploy or the check after it failed: ${oneLine(`${after.stdout}${after.stderr}`.slice(-300))}`);
      return { t, kind: 'stopped', note: 'PUSHED, but deploy or the check after it failed. Look at this first' };
    }
  }
  ds('task-set', t.id, 'status=done', `autoNote=${m[2]}`);
  return { t, kind: 'shipped', note: `${m[2]} (${git(dir, 'rev-parse', '--short', 'HEAD')})` };
}

mkdirSync(OUT, { recursive: true });
try {
  const items = JSON.parse(ds('backlog', '--json'))
    .filter((t) => t.status === 'open' && t.auto === 'yes' && t.step === 'upkeep')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, MAX_ITEMS);
  if (!items.length) { log('OK: nothing marked'); process.exit(0); } // logged every night, so a silent worker shows as stale
  log(`START: ${items.length} item(s)`);
  const results = items.map((t) => {
    try { return work(t); }
    catch (e) { log(`ERROR on ${t.id}: ${oneLine(e.message)}`); return { t, kind: 'stopped', note: `the worker hit an error: ${oneLine(e.message)}` }; }
  });
  const count = (k) => results.filter((x) => x.kind === k).length;
  const entry = results.map((x) => `- ${x.kind === 'shipped' ? 'Shipped' : x.kind === 'skipped' ? 'Skipped' : 'Stopped'}: ${x.t.text}. ${x.note}`).join('\n');
  const pm = run(process.execPath, [PM_NOTE, `Backlog worker ${stamp().slice(0, 10)}`], { input: `${entry}\n` });
  if (pm.status !== 0) log(`note not written: ${oneLine(pm.stderr)}`);
  if (count('stopped')) notify(`Backlog worker: ${count('shipped')} shipped, ${count('stopped')} stopped. See the PM updates note.`);
  log(`OK: ${count('shipped')} shipped, ${count('stopped')} stopped, ${count('skipped')} skipped`);
} catch (e) {
  log(`FAIL: ${oneLine(e.message)}`);
  notify(`Backlog worker failed: ${oneLine(e.message)}`);
  process.exit(1);
}
