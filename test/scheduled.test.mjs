// Scheduled claude -p jobs: triggers/pm-run.sh, weekly-*.sh, thought-scrub/run.sh.
// `claude` is a shim: it saves each prompt to $HOME/prompts/<n>.txt, logs its flags, and runs
// $HOME/claude-behavior.sh (if present) to create the files a real run would write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, today } from './helpers.mjs';

const CLAUDE = `mkdir -p "$HOME/prompts"; n=$(ls "$HOME/prompts" | wc -l); printf '%s' "$2" > "$HOME/prompts/$n.txt"
echo "env HARNESS_SCHEDULED=$HARNESS_SCHEDULED pwd=$PWD" >> "$SHIM_LOG"
[ -f "$HOME/claude-behavior.sh" ] && . "$HOME/claude-behavior.sh"
printf '%s\\n' "\${FAKE_CLAUDE_OUT:-line one
line two
final summary}"; exit \${FAKE_CLAUDE_EXIT:-0}`;

function base() {
  const sb = sandbox();
  sb.shim('claude', CLAUDE);
  for (const d of ['daily-standard', 'claude-harness']) sb.write(`projects/active/${d}/.keep`, '');
  sb.prompts = () => { try { return readdirSync(sb.path('prompts')).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => readFileSync(sb.path('prompts', f), 'utf8')); } catch { return []; } };
  sb.claudeCalls = () => sb.calls().filter((c) => c.startsWith('claude'));
  return sb;
}
const log = (sb, n) => sb.read(`.claude/hooks/${n}.log`);

// --- Daily Standard PM runs ---------------------------------------------------------------------
function pm(sb, { lockWait } = {}) {
  sb.write('.claude/daily-standard/.keep', '');
  sb.write('projects/active/claude-harness/tools/retro-window.mjs',
    `import fs from 'node:fs'; fs.appendFileSync(process.env.SHIM_LOG, 'retro ' + process.argv.slice(2).join(' ') + '\\n'); if (process.env.FAKE_RETRO_FAIL) process.exit(1);`);
  return sb.copyScript('triggers/pm-run.sh', 'bin/pm-run.sh', lockWait ? { 'flock -w 600': `flock -w ${lockWait}` } : {});
}

test('pm-run: refuses anything but bookkeeping or overnight', () => {
  const sb = base();
  const r = sb.run('bash', [pm(sb), 'weekly']);
  assert.equal(r.code, 2);
  assert.match(r.out, /usage: pm-run\.sh bookkeeping\|overnight/);
});

test('pm-run bookkeeping: Sonnet, bookkeeping-only prompt, no retro step, logs the last output line as OK', () => {
  const sb = base();
  sb.run('bash', [pm(sb), 'bookkeeping']);
  const [p] = sb.prompts();
  assert.match(p, /You never reprioritize/);
  assert.match(p, /Never change order of existing items, never move items between now and next, never drop anything/);
  assert.match(p, /Never read anything under \/mnt\/c\/MCP\/Confidential\//);
  assert.match(p, /run-mark bookkeeping/);
  assert.ok(sb.claudeCalls()[0].includes('[--model] [sonnet]'));
  assert.ok(sb.claudeCalls()[0].includes('[--allowedTools] [Bash,Read,Write,Edit,Glob,Grep] [--permission-mode] [bypassPermissions]'));
  assert.ok(!sb.calls().some((c) => c.startsWith('retro')));
  assert.ok(sb.calls().some((c) => c.includes('HARNESS_SCHEDULED=1') && c.includes('daily-standard')));
  assert.match(log(sb, 'pm-bookkeeping'), /START\n.*OK: final summary\n$/);
  assert.equal(readdirSync(sb.path('.claude/logs')).filter((f) => f.startsWith('pm-bookkeeping-')).length, 1);
});

test('pm-run overnight: Opus, full /pm prompt with the Now cap of 3 and retro items protected; retro expire runs first', () => {
  const sb = base();
  sb.run('bash', [pm(sb), 'overnight']);
  const [p] = sb.prompts();
  assert.match(p, /NOW CAP: at most 3 open items in now/);
  assert.match(p, /Items whose id starts with retro- belong to the weekly retro window/);
  assert.match(p, /day-digest\.py/);
  assert.match(p, /telegram-notify\.sh/);
  assert.match(p, /pm-note\.mjs/);
  assert.match(p, /vault-copy/);
  assert.ok(sb.claudeCalls()[0].includes('[--model] [opus]'));
  const order = sb.calls().filter((c) => c.startsWith('retro') || c.startsWith('claude'));
  assert.deepEqual(order.map((c) => c.split(' ')[0]), ['retro', 'claude']);
  assert.equal(order[0], 'retro expire');
});

test('pm-run: a failed model run logs FAIL with the exit code; a failed retro expire is logged and the run continues', () => {
  const sb = base();
  sb.run('bash', [pm(sb), 'overnight'], { env: { FAKE_CLAUDE_EXIT: '3', FAKE_RETRO_FAIL: '1' } });
  const l = log(sb, 'pm-overnight');
  assert.match(l, /FAIL: retro-window expire/);
  assert.match(l, /FAIL \(exit 3\): /);
  assert.equal(sb.claudeCalls().length, 1);
});

test('pm-run: one PM run at a time — a second run waiting on the lock gives up with SKIP', async () => {
  const sb = base();
  const s = pm(sb, { lockWait: 1 });
  const { spawn } = await import('node:child_process');
  const holder = spawn('flock', [sb.path('.claude/daily-standard/pm-run.lock'), 'sleep', '5']);
  await new Promise((r) => setTimeout(r, 300));
  sb.run('bash', [s, 'bookkeeping']);
  holder.kill();
  assert.match(log(sb, 'pm-bookkeeping'), /SKIP: another PM run still holding the lock/);
  assert.equal(sb.claudeCalls().length, 0);
});

// --- Weekly digest and NorthStar check ---------------------------------------------------------
function digest(sb) {
  const vault = sb.path('vault');
  sb.copyScript('hooks/advice-expiry-check.sh', 'projects/active/claude-harness/hooks/advice-expiry-check.sh', { '/mnt/c/MCP': vault });
  return sb.copyScript('triggers/weekly-digest.sh', 'bin/weekly-digest.sh', { '/mnt/c/MCP': vault });
}

test('weekly-digest: success means a digest note dated today exists, not just exit 0', () => {
  const sb = base();
  const s = digest(sb);
  sb.run('bash', [s]);
  assert.match(log(sb, 'weekly-digest'), /FAIL \(exit 0\): no digest note dated today/);
  sb.write('claude-behavior.sh', `mkdir -p "$HOME/vault/Inbox"; echo "# d" > "$HOME/vault/Inbox/Weekly Digest — $(date +%Y-%m-%d).md"`);
  sb.run('bash', [s]);
  assert.match(log(sb, 'weekly-digest'), /advice-expiry check ran\n.*OK: line one\n$/);
  const [p] = sb.prompts();
  assert.match(p, /Verify inherited rows against the territory/);
  assert.match(p, /body of work/);
});

test('weekly-digest: overdue standing advice is appended to the digest note', () => {
  const sb = base();
  const s = digest(sb);
  sb.write('vault/Meta/Standing Advice Register.md', '| Advice | Given | Cond | Review-by | Status |\n| Old advice | x | y | 2020-01-01 | active |\n');
  sb.write('claude-behavior.sh', `mkdir -p "$HOME/vault/Inbox"; echo "# d" > "$HOME/vault/Inbox/Weekly Digest — $(date +%Y-%m-%d).md"`);
  sb.run('bash', [s]);
  assert.match(sb.read(`vault/Inbox/Weekly Digest — ${today()}.md`), /OVERDUE since 2020-01-01:\*\* Old advice/);
});

test('weekly-northstar-check: logs OK on a clean run and FAIL with the exit code otherwise', () => {
  const sb = base();
  const s = sb.copyScript('triggers/weekly-northstar-check.sh', 'bin/ns.sh');
  sb.run('bash', [s]);
  assert.match(log(sb, 'weekly-northstar-check'), /OK: line one/);
  assert.match(sb.prompts()[0], /updated within the last 7 days/);
  sb.run('bash', [s], { env: { FAKE_CLAUDE_EXIT: '1' } });
  assert.match(log(sb, 'weekly-northstar-check'), /FAIL \(exit 1\)/);
});

// --- Weekly retro prep --------------------------------------------------------------------------
function retroPrep(sb, { moments = '[{"thought":"x"}]', judge = true, prep = true } = {}) {
  const h = 'projects/active/claude-harness';
  sb.write(`${h}/tools/day-digest.py`, 'import sys; open(__import__("os").environ["SHIM_LOG"],"a").write("digest "+" ".join(sys.argv[1:])+"\\n"); print("## Session")');
  sb.write(`${h}/triggers/thought-scrub/publish.py`, 'import sys,os; open(os.environ["SHIM_LOG"],"a").write("publish "+" ".join(sys.argv[1:])+"\\n"); print("[]" if sys.argv[1]=="open" else "{}")');
  sb.write(`${h}/tools/retro-window.mjs`, `import fs from 'node:fs'; fs.appendFileSync(process.env.SHIM_LOG, 'retro ' + process.argv[2] + '\\n');`);
  sb.write('claude-behavior.sh', `d=$(date +%Y-%m-%d); L="$HOME/.claude/logs"
case "$2" in
  *"Find build moments"*) ${moments === null ? ':' : `printf '%s' '${moments}' > "$L/retro-moments-$d.json"`};;
  *"You are the judge"*) ${judge ? `echo "judge ranking" > "$L/retro-judge-$d.md"` : ':'};;
  *) ${prep ? `mkdir -p "$HOME/vault/Inbox"; echo prep > "$HOME/vault/Inbox/Retro Prep — $d.md"` : ':'};;
esac`);
  return sb.copyScript('triggers/weekly-sprint-review.sh', 'bin/sprint-review.sh', { '/mnt/c/MCP': sb.path('vault') });
}

test('weekly-sprint-review: build moments pass, judge, then prep; moments go to Notion as "Build moment"; window opens on success', () => {
  const sb = base();
  sb.run('bash', [retroPrep(sb)]);
  const calls = sb.calls();
  assert.ok(calls.some((c) => /^digest --hours 168 --both --max-chars 600000$/.test(c)));
  assert.ok(calls.some((c) => c.startsWith('publish rows ') && c.endsWith(' Build moment')));
  assert.ok(calls.some((c) => c === 'publish open'));
  const ps = sb.prompts();
  assert.equal(ps.length, 3);
  assert.match(ps[0], /Find build moments/);
  assert.match(ps[0], /Keep at most 8/);
  assert.match(ps[1], /You are the judge/);
  assert.match(ps[1], /at most 5 non-Build-moment rows/);
  const cl = sb.claudeCalls();
  assert.ok(cl[0].includes('[--model] [opus]') && cl[0].includes('[--allowedTools] [Read,Write]'));
  assert.ok(cl[1].includes('[--model] [opus]'));
  assert.ok(cl[2].includes('[--model] [sonnet]'));
  assert.doesNotMatch(ps[2], /__JUDGE_FILE__|__BUILD_NAME__|__BUILD_DIR__/);
  assert.match(ps[2], new RegExp(`retro-judge-${today()}\\.md`));
  assert.match(log(sb, 'weekly-sprint-review'), /OK: prep doc written to .*Retro Prep — \d{4}-\d{2}-\d{2}\.md/);
  assert.ok(calls.includes('retro open'));
});

test('weekly-sprint-review: the build under review rotates weekly through 8 builds from the week of 2026-10-25', () => {
  const sb = base();
  sb.run('bash', [retroPrep(sb)]);
  const builds = ['Daily Standard', 'Phone Notes', 'Claude Harness', 'Prototipo', 'Sound Lab', 'Partswatch', 'rowbyroh-website', 'Obsidian MCP'];
  const week = Math.trunc((Math.floor(Date.now() / 1000) - new Date(2026, 9, 25).getTime() / 1000) / 604800);
  const expected = builds[((week % 8) + 8) % 8];
  assert.match(sb.prompts()[2], new RegExp(`## 2\\. Build review: ${expected} \\(`));
});

test('weekly-sprint-review: an empty moments pass and a silent judge are logged as warnings, not fatal', () => {
  const sb = base();
  sb.run('bash', [retroPrep(sb, { moments: null, judge: false })]);
  const l = log(sb, 'weekly-sprint-review');
  assert.match(l, /WARN: build-moments pass produced nothing/);
  assert.match(l, /WARN: judge produced nothing/);
  assert.ok(!sb.calls().some((c) => c.startsWith('publish rows')));
  assert.match(sb.read(`.claude/logs/retro-judge-${today()}.md`), /Judge did not run this week/);
  assert.match(l, /OK: prep doc written/);
});

test('weekly-sprint-review: no prep doc dated today is a FAIL and the retro window stays closed', () => {
  const sb = base();
  sb.run('bash', [retroPrep(sb, { prep: false })]);
  assert.match(log(sb, 'weekly-sprint-review'), /FAIL \(exit 0\): no prep doc dated today/);
  assert.ok(!sb.calls().includes('retro open'));
});

// --- Daily thought scrub ------------------------------------------------------------------------
function scrub(sb, { newItems = 0 } = {}) {
  sb.write('ts/scrub.py', `import sys,os,json
open(os.environ["SHIM_LOG"],"a").write("scrub "+" ".join(sys.argv[1:])+"\\n")
c=sys.argv[1]
if c=="collect": open(sys.argv[2],"w").write("[]"); print(json.dumps({"changed":${newItems},"new_items":${newItems}}))
elif c=="freshness": print(json.dumps({"Notion sync": 1}))`);
  sb.write('ts/publish.py', `import sys,os,json
open(os.environ["SHIM_LOG"],"a").write("publish "+" ".join(sys.argv[1:])+"\\n")
print(json.dumps({"open": 4} if sys.argv[1]=="stats" else {"ok": 1}))`);
  sb.write('ts/prompt.md', 'SCREEN PROMPT');
  return sb.copyScript('triggers/thought-scrub/run.sh', 'ts/run.sh');
}
const CANDS = (json) => `out=$(printf '%s' "$2" | sed -n 's/^Output file: //p'); printf '%s' '${json}' > "$out"`;
const pubs = (sb) => sb.calls().filter((c) => c.startsWith('publish') && !c.startsWith('publish clicks') && !c.startsWith('publish stats'));

test('thought-scrub: nothing new means no model call, no Notion rows, no ping; snapshots committed and OK logged', () => {
  const sb = base();
  const s = scrub(sb);
  sb.write('.claude/thought-scrub/work/old.json', '{}');
  const old = (Date.now() - 40 * 86400e3) / 1000;
  utimesSync(sb.path('.claude/thought-scrub/work/old.json'), old, old);
  assert.equal(sb.run('bash', [s]).code, 0);
  assert.equal(sb.claudeCalls().length, 0);
  assert.deepEqual(pubs(sb), []);
  assert.ok(sb.calls().includes('scrub commit'));
  assert.match(log(sb, 'thought-scrub'), /OK: \{"new_items":0,"candidates":0,"backlog":\{"open": 4\}\}/);
  assert.ok(!sb.exists('.claude/thought-scrub/work/old.json'), 'work files older than 30 days are deleted');
});

test('thought-scrub: new text goes through one Sonnet screen (Read/Write only, $3 cap); candidates become Daily rows and one ping', () => {
  const sb = base();
  const s = scrub(sb, { newItems: 5 });
  sb.write('claude-behavior.sh', CANDS('[{"thought":"a"},{"thought":"b"}]'));
  sb.run('bash', [s]);
  const cl = sb.claudeCalls();
  assert.equal(cl.length, 1);
  assert.ok(cl[0].includes('[--model] [sonnet]') && cl[0].includes('[--allowedTools] [Read,Write]') && cl[0].includes('[--max-budget-usd] [3]'));
  assert.match(sb.prompts()[0], /^SCREEN PROMPT\n\nInput file: .*bundle-\d{4}-\d{2}-\d{2}\.json\nOutput file: .*candidates-/);
  const p = pubs(sb);
  assert.match(p[0], /^publish rows .*candidates-\d{4}-\d{2}-\d{2}\.json Daily$/);
  assert.equal(p[1], 'publish ping 2');
  assert.match(log(sb, 'thought-scrub'), /candidates: 2 from 5 new items/);
});

test('thought-scrub: --dry-run collects and screens but adds no rows, sends no ping and commits nothing', () => {
  const sb = base();
  const s = scrub(sb, { newItems: 1 });
  sb.write('claude-behavior.sh', CANDS('[{"thought":"a"}]'));
  const r = sb.run('bash', [s, '--dry-run']);
  assert.match(r.out, /^dry run: 1 candidates in /);
  assert.deepEqual(pubs(sb), []);
  assert.ok(!sb.calls().includes('scrub commit'));
});

test('thought-scrub: a screen that writes no valid JSON fails the run before snapshots are committed', () => {
  const sb = base();
  const s = scrub(sb, { newItems: 1 });
  sb.write('claude-behavior.sh', CANDS('not json'));
  const r = sb.run('bash', [s]);
  assert.equal(r.code, 1);
  assert.match(log(sb, 'thought-scrub'), /FAIL: extract wrote no valid JSON/);
  assert.ok(!sb.calls().includes('scrub commit'));
  const sb2 = base();
  const s2 = scrub(sb2, { newItems: 1 });
  sb2.run('bash', [s2], { env: { FAKE_CLAUDE_EXIT: '1' } });
  assert.match(log(sb2, 'thought-scrub'), /FAIL: extract: /);
});

test('thought-scrub: a broken source with no new thoughts pings at most once a week', () => {
  const sb = base();
  const s = scrub(sb);
  sb.write('.claude/hooks/vault-sync.log', '2026-10-01 00:00:00 AUTH_EXPIRED: x\n');
  sb.run('bash', [s]);
  const p = sb.calls().filter((c) => c.startsWith('publish ping'));
  assert.equal(p.length, 1);
  assert.match(p[0], /^publish ping 0 Claude\.ai sync is not running/);
  sb.write('.claude/thought-scrub/pings.jsonl', JSON.stringify({ sent_at: new Date().toISOString() }) + '\n');
  sb.run('bash', [s]);
  assert.equal(sb.calls().filter((c) => c.startsWith('publish ping')).length, 1, 'pinged under 7 days ago: quiet');
  sb.write('.claude/thought-scrub/pings.jsonl', JSON.stringify({ sent_at: '2026-01-01T00:00:00+00:00' }) + '\n');
  sb.run('bash', [s]);
  assert.equal(sb.calls().filter((c) => c.startsWith('publish ping')).length, 2);
});

test('thought-scrub: healthy sources and nothing new stay silent', () => {
  const sb = base();
  sb.write('.claude/hooks/vault-sync.log', '2026-10-01 00:00:00 OK: {}\n');
  sb.run('bash', [scrub(sb)]);
  assert.equal(sb.calls().filter((c) => c.startsWith('publish ping')).length, 0);
});
