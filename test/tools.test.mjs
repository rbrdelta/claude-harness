// tools/*: telegram-notify.sh, day-digest.py, session-audit.js, claude-rules-audit.js;
// hooks/approval-report.js; the thought-link click worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, REPO } from './helpers.mjs';

// --- telegram-notify.sh ---
function tgSetup() {
  const sb = sandbox();
  sb.write('.claude/channels/telegram/.env', 'OTHER=1\nTELEGRAM_BOT_TOKEN=tok=with=equals\n');
  sb.write('.claude/channels/telegram/access.json', '{"allowFrom":["555","666"]}');
  return sb;
}
const notify = join(REPO, 'tools/telegram-notify.sh');

test('telegram-notify: sends the text (argument or stdin) to the first allowlisted chat with the bot token', () => {
  const sb = tgSetup();
  assert.equal(sb.run('bash', [notify, 'hello there']).code, 0);
  const c = sb.calls().find((l) => l.startsWith('curl'));
  assert.match(c, /\[https:\/\/api\.telegram\.org\/bottok=with=equals\/sendMessage\]/);
  assert.match(c, /\[chat_id=555\]/);
  assert.match(c, /\[text=hello there\]/);
  sb.run('bash', [notify], { input: 'from stdin' });
  assert.match(sb.calls().filter((l) => l.startsWith('curl'))[1], /\[text=from stdin\]/);
});

test('telegram-notify: exits 1 when the token, chat or text is missing, or Telegram does not answer ok', () => {
  const sb = tgSetup();
  const empty = sb.run('bash', [notify, ''], { input: '' });
  assert.equal(empty.code, 1);
  assert.match(empty.err, /missing token, chat or text/);
  sb.shim('curl', `echo '{"ok":false}'`);
  const r = sb.run('bash', [notify, 'x']);
  assert.equal(r.code, 1);
  assert.match(r.err, /send failed/);
});

// --- day-digest.py ---
const iso = (hAgo) => new Date(Date.now() - hAgo * 3600e3).toISOString();
const line = (o) => JSON.stringify(o);
function digestRoot() {
  const sb = sandbox();
  const t = iso(1);
  sb.write('root/p1/s1.jsonl', [
    line({ type: 'user', message: { content: 'Add a retro step' }, cwd: '/w/proj', timestamp: t }),
    line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done, added it.' }, { type: 'tool_use', name: 'Bash' }] }, timestamp: t }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] }, timestamp: t }),
    line({ type: 'user', message: { content: '<command-name>/pm</command-name>' }, timestamp: t }),
    line({ type: 'user', message: { content: '[Request interrupted by user]' }, timestamp: t }),
    line({ type: 'user', isSidechain: true, message: { content: 'subagent prompt' }, timestamp: t }),
    line({ type: 'user', isMeta: true, message: { content: 'meta' }, timestamp: t }),
    line({ type: 'user', message: { content: [{ type: 'text', text: 'second   ' }, { type: 'text', text: 'part' }] }, timestamp: t }),
    'not json',
  ].join('\n'));
  sb.write('root/p1/sched.jsonl', line({ type: 'user', message: { content: "You are Daniel's PM, running the overnight" }, timestamp: t }));
  sb.write('root/p2/old.jsonl', line({ type: 'user', message: { content: 'old session' }, timestamp: iso(40) }));
  const old = (Date.now() - 40 * 3600e3) / 1000;
  utimesSync(sb.path('root/p2/old.jsonl'), old, old);
  return sb;
}
const digest = (sb, ...a) => sb.run('python3', [join(REPO, 'tools/day-digest.py'), '--root', sb.path('root'), ...a]).out;

test('day-digest: Daniel\'s typed messages per session, in the window; tool results, wrappers, interrupts, subagents and scheduled runs skipped', () => {
  const out = digest(digestRoot());
  assert.match(out, /^## Session \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC in \/w\/proj\n- Add a retro step\n- second   \npart\n?$/);
  assert.doesNotMatch(out, /Done, added it|command-name|interrupted|subagent|meta|overnight|old session/);
});

test('day-digest: --both adds Claude\'s replies, labeled; --hours widens the window', () => {
  const sb = digestRoot();
  const both = digest(sb, '--both');
  assert.match(both, /- Daniel: Add a retro step\n- Claude: Done, added it\.\n- Daniel: second/);
  assert.match(digest(sb, '--hours', '48'), /old session/);
});

test('day-digest: output over --max-chars keeps the newest end and says earlier sessions were cut; empty window says so', () => {
  const sb = digestRoot();
  const out = digest(sb, '--max-chars', '20');
  assert.match(out, /^\[earlier sessions cut to fit\]\n/);
  assert.equal(out.trim().split('\n').slice(1).join('\n').length <= 20, true);
  const empty = sandbox(); empty.write('root/.keep', '');
  assert.equal(digest(empty).trim(), 'No sessions in the window.');
});

// --- vault-digest.py ---
const fm = (lines, body = 'body text') => `---\n${lines.join('\n')}\n---\n${body}\n`;
function vaultRoot() {
  const sb = sandbox();
  const S = 'vault/Sources';
  sb.write(`${S}/Claude-Conversations/chat.md`, fm([`title: "Cohort plan"`, `updated: "${iso(2)}"`], 'decided a later cohort'));
  sb.write(`${S}/Notion/page.md`, fm([`title: 'Admin isn''t a priority'`, `updated: '${iso(5)}'`], 'notion body'));
  sb.write(`${S}/Phone-Notes/idea (ab12).md`, fm(['source: phone-notes', `phone_updated: '${iso(1)}'`], 'phone idea'));
  sb.write(`${S}/Phone-Notes/PM updates (pm-upd).md`, fm([`phone_updated: '${iso(1)}'`], 'own output'));
  sb.write(`${S}/Phone-Notes/diary (cd34).md`, fm([`phone_updated: '${iso(1)}'`, 'phone_folders:', '  - Personal'], 'personal text'));
  sb.write(`${S}/Phone-Notes/secret (ef56).md`, fm([`phone_updated: '${iso(1)}'`, 'phone_tags:', '  - private'], 'private text'));
  sb.write(`${S}/Claude-Conversations/work.md`, fm([`updated: "${iso(1)}"`, 'jpmc: work-example'], 'jpmc text'));
  sb.write(`${S}/Notion/old.md`, fm([`updated: '${iso(40)}'`], 'old page'));
  sb.write(`${S}/Notion/touched.md`, fm(['tags:', '  - notion'], 'no edit time'));
  sb.write(`${S}/Apple-Notes/retired.md`, fm([`updated: '${iso(1)}'`], 'apple'));
  return sb;
}
const vdigest = (sb, ...a) => sb.run('python3', [join(REPO, 'tools/vault-digest.py'), '--vault', sb.path('vault'), ...a]).out;

test('vault-digest: claude.ai, phone and Notion notes edited in the window, oldest first, by their own edit time', () => {
  const out = vdigest(vaultRoot());
  assert.match(out, /^3 notes edited in the last 26 hours/);
  assert.match(out, /=== Notion page: Admin isn''t a priority .*\n[\s\S]*=== claude\.ai conversation: Cohort plan .*\ndecided a later cohort[\s\S]*=== phone note: idea \(ab12\) .*\nphone idea/);
  assert.match(vdigest(vaultRoot(), '--hours', '48'), /old page/);
});

test('vault-digest: skips the PM updates note, personal or private notes, JPMC work examples, retired Apple Notes and notes with no edit time', () => {
  const out = vdigest(vaultRoot(), '--hours', '48');
  assert.doesNotMatch(out, /own output|personal text|private text|jpmc text|apple|no edit time/);
});

test('vault-digest: long notes keep the opening and the end; over --max-chars the oldest notes are cut', () => {
  const sb = vaultRoot();
  sb.write('vault/Sources/Notion/long.md', fm([`updated: '${iso(1)}'`], 'START' + 'x'.repeat(9000) + 'END'));
  const out = vdigest(sb);
  assert.match(out, /STARTx+\n\[\.\.\. middle cut \.\.\.\]\nx+END/);
  const cut = vdigest(sb, '--max-chars', '200');
  assert.match(cut, /^\[older notes cut to fit\]\n=== /);
  assert.doesNotMatch(cut, /Cohort plan/);
});

// --- approval-report.js ---
test('approval-report: coverage mirrors the permission engine (Read covers Glob/Grep, Edit covers Write), counts denies, suggests rules seen twice', () => {
  const sb = sandbox();
  sb.write('.claude/settings.json', JSON.stringify({ permissions: {
    allow: ['Read(//home/**)', 'Edit', 'Bash(git status)', 'WebFetch(domain:example.com)'], deny: ['Bash(rm -rf *)'] } }));
  const e = (tool_name, tool_input, extra = {}) => line({ ts: 't', hook: { tool_name, tool_input, session_id: 's1', ...extra } });
  sb.write('.claude/logs/tool-use-2026-10-01.jsonl', [
    e('Glob', { path: '/home/x', pattern: '*.md' }),
    e('Grep', { path: '/home/y' }),
    e('Write', { file_path: '/anywhere/f' }),
    e('Bash', { command: 'git status' }),
    e('WebFetch', { url: 'https://example.com/a' }),
    e('Bash', { command: 'rm -rf /tmp/x' }),
    e('Bash', { command: 'npm test' }),
    e('Bash', { command: 'npm run build' }),
    e('Bash', { command: 'FOO=1 node x.js' }),
    e('Read', { file_path: '/etc/ssl/certs/a.pem' }),
    line({ ts: 't', data: { tool_name: 'Bash', tool_input: { command: 'npm ci' }, session_id: 's2' } }),
    'garbage',
  ].join('\n'));
  const r = sb.run(process.execPath, [join(REPO, 'hooks/approval-report.js'), '2026-10-01']);
  assert.equal(r.code, 0);
  assert.match(r.out, /Sessions: {2}2/);
  assert.match(r.out, /Total tool calls: {5}11/);
  assert.match(r.out, /Auto-approved: {8}5 \(45\.5%\)/);
  assert.match(r.out, /Would need approval: {2}5 /);
  assert.match(r.out, /Denied by rule: {7}1/);
  assert.match(r.out, /Bash\(npm \*\) {2}\(3x\)/);
  assert.match(r.out, /Bash\(FOO=\* node \*\) {2}\(1x\)/);
  assert.match(r.out, /Read\(\/\/etc\/ssl\/certs\/\*\*\) {2}\(1x\)/);
  assert.match(r.out, /Rules to add:\n {2}"Bash\(npm \*\)", {2}\/\/ 3 occurrences\n/);
  assert.match(r.out, /Projected coverage: 45\.5% -> 72\.7%/);
});

test('approval-report: a date with no log lists the logs that exist and exits 1', () => {
  const sb = sandbox();
  sb.write('.claude/settings.json', '{}');
  sb.write('.claude/logs/tool-use-2026-10-02.jsonl', '');
  const r = sb.run(process.execPath, [join(REPO, 'hooks/approval-report.js'), '2026-10-01']);
  assert.equal(r.code, 1);
  assert.match(r.err, /No log files found for 2026-10-01\.\nAvailable logs:\n {2}tool-use-2026-10-02\.jsonl/);
});

// --- session-audit.js ---
test('session-audit: per session, counts calls that would have prompted (bypass and acceptEdits edits never prompt) and typed turns', () => {
  const sb = sandbox();
  sb.write('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls *)'] } }));
  sb.write('.claude/settings.local.json', JSON.stringify({ permissions: { allow: ['Bash(pwd)'] } }));
  const e = (sid, mode, tool_name, tool_input, ts) => line({ ts, hook: { session_id: sid, permission_mode: mode, tool_name, tool_input } });
  sb.write('.claude/logs/tool-use-2026-10-01.jsonl', [
    e('aaaaaaaa-1', 'default', 'Bash', { command: 'ls -la' }, '2026-10-01T10:00:00Z'),
    e('aaaaaaaa-1', 'default', 'Bash', { command: 'pwd' }, '2026-10-01T10:01:00Z'),
    e('aaaaaaaa-1', 'default', 'Bash', { command: 'make' }, '2026-10-01T10:30:00Z'),
    e('bbbbbbbb-2', 'bypassPermissions', 'Bash', { command: 'make' }, '2026-10-01T11:00:00Z'),
    e('cccccccc-3', 'acceptEdits', 'Edit', { file_path: '/x' }, '2026-10-01T12:00:00Z'),
  ].join('\n'));
  sb.write('.claude/projects/p/aaaaaaaa-1.jsonl', [
    line({ type: 'user', message: { role: 'user', content: 'hi' } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result' }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'more' }] } }),
  ].join('\n'));
  const r = sb.run(process.execPath, [join(REPO, 'tools/session-audit.js')]);
  assert.equal(r.code, 0);
  assert.match(r.out, /2026-10-01\s+aaaaaaaa\s+2\s+3\s+1\s+30\s+default/);
  assert.match(r.out, /2026-10-01\s+bbbbbbbb\s+\?\s+1\s+0\s+0\s+bypassPermissions/);
  assert.match(r.out, /cccccccc\s+\?\s+1\s+0\s+0\s+acceptEdits/);
  assert.match(r.out, /Sessions: 3/);
  assert.match(r.out, /Prompt rate: 20\.0% of all tool calls/);
});

// --- claude-rules-audit.js ---
test('claude-rules-audit: lists rule-shaped lines per source with provenance, flags shared keywords and clusters, marks stale files', () => {
  const sb = sandbox();
  sb.write('.claude/CLAUDE.md', '# Title\n- Always commit at checkpoints\n- Commit before handoff\n- Never commit secrets\n```\n- in a fence\n```\n> - quoted\nplain prose\nAlways verify first.\n');
  sb.write('.claude/projects/-home-rbr01/memory/MEMORY.md', '- [a](feedback_a.md) — x\n- [a again](feedback_a.md)\n');
  sb.write('.claude/projects/-home-rbr01/memory/feedback_a.md', '---\nname: push rule\ndescription: Push after commit\ntype: feedback\n---\n1. Push always\n');
  sb.write('.claude/skills/zed/SKILL.md', '---\nname: zed\ndescription: Run the sprint\n---\n- body rules are not read\n');
  sb.write('proj/CLAUDE.md', '- Test before commit\n');
  const old = (Date.now() - 40 * 86400e3) / 1000;
  utimesSync(sb.path('proj/CLAUDE.md'), old, old);
  const r = sb.run(process.execPath, [join(REPO, 'tools/claude-rules-audit.js')], { cwd: sb.path('proj') });
  assert.equal(r.code, 0);
  assert.match(r.out, /\[1\] RESOLVED RULES {3}\(8 rules across 4 files\)/);
  assert.match(r.out, /L {3}2 \[bul\] - Always commit at checkpoints/);
  assert.match(r.out, /L {2}10 \[imp\] Always verify first\./);
  assert.doesNotMatch(r.out, /in a fence|quoted|plain prose|body rules/);
  assert.match(r.out, / fm {2}\[fm\] \[feedback\] push rule: Push after commit/);
  assert.match(r.out, / fm {2}\[fm\] zed: Run the sprint/);
  assert.match(r.out, /─── ~\/proj\/CLAUDE\.md {3}\(mod \d{4}-\d{2}-\d{2} {3}STALE\)/);
  assert.match(r.out, /- keyword "commit": {2}5 hits across 3 sources/);
  assert.match(r.out, /─── ~\/\.claude\/CLAUDE\.md\n {4}"commit": 3 rules {2}\(L2, L3, L4\)/);
  assert.match(r.out, /~\/\.claude\/agents\/ .*\(directory missing\)/);
  assert.match(r.out, /\[5\] VAULT SYNC DRIFT/);
});

// --- thought-link worker ---
async function worker() {
  const sb = sandbox();
  copyFileSync(join(REPO, 'triggers/thought-scrub/worker/src/worker.js'), sb.path('worker.mjs'));
  const mod = await import(pathToFileURL(sb.path('worker.mjs')).href);
  const rows = [];
  const env = { TARGET: 'https://notion.example/list', DB: { prepare: (sql) => ({ bind: (...v) => ({ run: async () => rows.push({ sql, v }) }) }) } };
  const get = (path, ua = 'Mozilla/5.0 (iPhone)') => mod.default.fetch(new Request(`https://w.dev${path}`, { headers: { 'user-agent': ua } }), env);
  return { get, rows };
}

test('thought-link worker: /r/<ping id> logs one click and redirects to the review list', async () => {
  const { get, rows } = await worker();
  const res = await get('/r/20261023-2aa3ae');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://notion.example/list');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].v[0], '20261023-2aa3ae');
  assert.match(rows[0].v[1], /^\d{4}-\d{2}-\d{2}T/);
});

test('thought-link worker: link previews (bots) redirect without counting; bad paths 404; /health answers ok', async () => {
  const { get, rows } = await worker();
  assert.equal((await get('/r/abc', 'TelegramBot (like TwitterBot)')).status, 302);
  assert.equal(rows.length, 0);
  assert.equal((await get('/r/bad id!')).status, 404);
  assert.equal((await get('/r/' + 'x'.repeat(65))).status, 404);
  assert.equal(await (await get('/health')).text(), 'ok');
});
