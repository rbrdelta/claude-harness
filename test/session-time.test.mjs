// session-time.mjs: Daniel's time in a session, estimated from words read and written (2026-11-21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { count, RATE } from '../tools/session-time.mjs';

const w = (n) => Array(n).fill('word').join(' ');
const rows = [
  { type: 'user', message: { content: 'This session was opened automatically: 3 ask(s) ' + w(200) } }, // launcher, not his
  { type: 'assistant', message: { content: [{ type: 'text', text: w(400) }, { type: 'tool_use', name: 'Bash' }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', content: w(999) }] } }, // tool output, not his
  { type: 'user', message: { content: [{ type: 'text', text: w(30) + ' <system-reminder>' + w(500) + '</system-reminder>' }] }, timestamp: '2026-11-21T10:00:00Z' },
  { type: 'user', isCompactSummary: true, message: { content: w(800) } }, // summary, not his
  { type: 'user', isMeta: true, message: { content: w(50) } },
  { type: 'assistant', message: { content: [{ type: 'text', text: w(90) }] } },
  { type: 'user', message: { content: w(40) }, timestamp: '2026-11-21T11:00:00Z' },
];
const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\nnot json\n';

test('counts only Claude replies he read and messages he wrote', () => {
  const r = count(jsonl);
  assert.equal(r.read, 490);
  assert.equal(r.wrote, 70);
  assert.equal(r.messages, 2);
  assert.equal(r.minutes, Math.round(560 / RATE));
  assert.equal(r.first, '2026-11-21T10:00:00Z');
  assert.equal(r.last, '2026-11-21T11:00:00Z');
  assert.equal(r.clock, 60, 'the clock starts at his first message (2026-11-22)');
});

test('prints one line and keeps one log row per session, replaced on rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'));
  const file = join(dir, 'abc-123.jsonl');
  const log = join(dir, 'log.jsonl');
  writeFileSync(file, jsonl);
  const tool = new URL('../tools/session-time.mjs', import.meta.url).pathname;
  const out = execFileSync('node', [tool, file, '--log', log], { encoding: 'utf8' });
  assert.match(out, /^Your time this session: about 1h 00m from your first message to the last\. Word estimate, which also counts the list you read before replying: about \d+ minutes \(490 words read, 70 written/);
  execFileSync('node', [tool, file, '--log', log]);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).session, 'abc-123');
});
