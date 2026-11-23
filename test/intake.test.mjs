// tools/intake.mjs: the deterministic half of the intake pipeline (2026-11-21). The router's judgment is graded by
// Daniel on the gold set; these tests hold the guarantees the code makes: no silent drops, his exact words only,
// secrets never leave intake, every outcome recorded and shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

const TOOL = join(REPO, 'tools/intake.mjs');
const mod = await import(TOOL);

const BUNDLE = [
  { source: 'Phone Notes', where: 'Prose ody (69c208)', written: '2026-11-20', text: 'What if a tool could read the text for you when you don’t have time to read?' },
  { source: 'Claude Code', where: 'session abc', written: '2026-11-19', text: "that's fine, go - and here's the API key AQ.FAKEfakeFAKEfake0000fakeFAKEfake1111zz" },
  { source: 'Claude Code', where: 'session def', written: '2026-11-19', text: 'sk-ant-sid99-FAKEfakeFAKEfakeFAKEfake0000xx' },
  { source: 'Claude Code', where: 'session ghi', written: '2026-11-19', text: 'Where’s the backlog ranking we discussed yesterday' },
];

test('intake: prepare gives every piece an id and removes secrets before the router sees them', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  assert.deepEqual(items.map(i => i.id), ['2026-11-20#1', '2026-11-20#2', '2026-11-20#3', '2026-11-20#4']);
  assert.doesNotMatch(JSON.stringify(items), /AQ\.FAKE|sk-ant-sid99/);
  assert.equal(items[1].secret_removed, true);
  assert.equal(items[2].secret_removed, true);
  assert.equal(items[0].secret_removed, undefined);
  assert.match(mod.redact('password: hunter2hunter2xx').text, /secret removed/);
});

test('intake: a piece the router skipped is never dropped: it is recorded as needing a look', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const { outcomes, problems } = mod.checkRoutes(items, [{ id: '2026-11-20#1', routes: ['A', 'E'], title: 'Narrate papers', quote: 'What if a tool could read the text for you', reason: 'a build wish' }]);
  assert.equal(outcomes.length, 4);
  const missed = outcomes.filter(o => o.flags.includes('missed by router'));
  assert.deepEqual(missed.map(o => o.id), ['2026-11-20#2', '2026-11-20#3', '2026-11-20#4']);
  assert.equal(problems.filter(p => /missed by router/.test(p)).length, 3);
});

test('intake: a quote that is not his exact words is removed and flagged; curly quotes and spacing still match', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const { outcomes } = mod.checkRoutes(items, [
    { id: '2026-11-20#1', routes: ['A'], quote: "What if a tool could read the text for you when you don't have   time to read?" },
    { id: '2026-11-20#4', routes: ['G'], quote: 'Where is the ranking from yesterday' },
  ]);
  assert.equal(outcomes[0].quote.length > 0, true, 'curly vs straight apostrophe and spacing are not a mismatch');
  assert.deepEqual(outcomes[0].flags, []);
  const g = outcomes.find(o => o.id === '2026-11-20#4');
  assert.equal(g.quote, '');
  assert.ok(g.flags.includes('quote not his exact words'));
});

test('intake: personal and secret pieces carry no quote; an invalid route becomes H with a flag; at most two routes', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const { outcomes } = mod.checkRoutes(items, [
    { id: '2026-11-20#1', routes: ['A', 'E', 'F'], quote: 'What if a tool could read the text for you' },
    { id: '2026-11-20#2', routes: ['H'], quote: "that's fine, go", flags: ['personal'] },
    { id: '2026-11-20#3', routes: ['Z'], quote: '' },
    { id: '2026-11-20#4', routes: 'g', quote: '' },
  ]);
  assert.deepEqual(outcomes[0].routes, ['A', 'E']);
  assert.equal(outcomes[1].quote, '');
  assert.ok(outcomes[1].flags.includes('secret'), 'a piece that had a secret is flagged even if the router missed it');
  assert.deepEqual(outcomes[2].routes, ['H']);
  assert.ok(outcomes[2].flags.includes('router gave no valid route'));
  assert.deepEqual(outcomes[3].routes, ['G']);
});

test('intake: secrets in the router\'s own title or reason are removed too', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const { outcomes } = mod.checkRoutes(items, [{ id: '2026-11-20#2', routes: ['H'], title: 'key AQ.FAKEfakeFAKEfake0000fakeFAKEfake11', reason: 'sk-ant-sid99-FAKEfakeFAKEfake00' }]);
  const o = outcomes.find(x => x.id === '2026-11-20#2');
  assert.doesNotMatch(o.title + o.reason, /AQ\.FAKE|sk-ant/);
});

test('intake: prepare -> check -> record writes the outcome log and the vault note, grouped by the day written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intake-'));
  const env = { ...process.env, INTAKE_STATE: join(dir, 'state'), INTAKE_VAULT: join(dir, 'vault'), INTAKE_DS: join(dir, 'no-ds.mjs') };
  writeFileSync(join(dir, 'bundle-2026-11-20.json'), JSON.stringify(BUNDLE));
  const run = (...a) => spawnSync('node', [TOOL, ...a], { env, encoding: 'utf8' });
  assert.match(run('prepare', join(dir, 'bundle-2026-11-20.json'), join(dir, 'r')).stdout, /^4 items/);
  const ctx = JSON.parse(readFileSync(join(dir, 'r/context.json'), 'utf8'));
  assert.deepEqual(Object.keys(ctx), ['work_items', 'open_asks', 'recent_outcomes'], 'context still built when the Daily Standard CLI is unreachable');
  assert.equal(run('check', join(dir, 'r')).status, 1, 'no routes.json is a failure, not an empty day');
  writeFileSync(join(dir, 'r/routes.json'), JSON.stringify([
    { id: '2026-11-20#1', routes: ['A'], title: 'Narrate papers aloud', quote: 'What if a tool could read the text for you', where_to: 'Sound Lab', owner: 'Daniel', reason: 'He states a wish to build it.' },
    { id: '2026-11-20#4', routes: ['G'], title: 'Asked where the ranking is', quote: 'Where’s the backlog ranking', exists: 'Inbox/Stack rank — rounds.md', reason: 'Answered in the session.' },
  ]));
  assert.match(run('check', join(dir, 'r')).stdout, /4 outcomes; problems: .*missed by router/);
  assert.match(run('record', join(dir, 'r'), '--mode', 'preview').stdout.trim(), /^4 pieces: A 1, B 0, C 0, D 0, E 0, F 0, G 1, H 2; 2 problem\(s\)$/);
  const log = readFileSync(join(dir, 'state/outcomes.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.equal(log.length, 4);
  assert.ok(log.every(o => o.mode === 'preview' && o.recorded_at));
  const note = readFileSync(join(dir, 'vault/Inbox/Intake — outcomes.md'), 'utf8');
  assert.match(note, /## 2026-11-20 \(preview\): 4 pieces, 1 routed, 3 no action/);
  assert.match(note, /\*\*A\*\* Narrate papers aloud \(Phone Notes, Prose ody \(69c208\)\) \[to: Sound Lab\]/);
  assert.match(note, /> What if a tool could read the text for you/);
  assert.doesNotMatch(note, /AQ\.FAKE|sk-ant/);
  assert.ok(note.indexOf('**A**') < note.indexOf('**G**'), 'routed pieces are listed before the no-action ones');
});

test('intake: the gold-set sheet mixes routed and no-action pieces, never G, no duplicates', () => {
  const mk = (i, r) => ({ id: `2026-11-20#${i}`, routes: r, title: `t${i}` });
  const all = [...Array.from({ length: 8 }, (_, i) => mk(i + 1, ['B'])), ...Array.from({ length: 20 }, (_, i) => mk(i + 9, ['H'])), ...Array.from({ length: 20 }, (_, i) => mk(i + 29, ['G']))];
  const sheet = mod.sampleSheet([...all, all[0]], 15);
  assert.equal(sheet.length, 15);
  assert.equal(sheet.filter(o => o.routes[0] === 'G').length, 0, 'G is never his to grade');
  assert.ok(sheet.filter(o => o.routes[0] === 'H').length >= 5, 'enough no-action pieces to catch drops');
  assert.equal(new Set(sheet.map(o => o.id)).size, 15);
});

// ---- round 2 (2026-11-22): G must be proven from the record; "on file" must exist ----
test('intake: an on-file id that is not in the context is flagged', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const ctx = { work_items: [{ id: 'aaaaaaaaaaaa' }], open_asks: [{ id: 'bbbbbbbbbbbb' }] };
  const { outcomes } = mod.checkRoutes(items, [
    { id: '2026-11-20#1', routes: ['H'], exists: 'aaaaaaaaaaaa' },
    { id: '2026-11-20#4', routes: ['H'], exists: 'cccccccccccc (the ranking item)' },
  ], ctx);
  assert.deepEqual(outcomes[0].flags, []);
  assert.ok(outcomes.find(o => o.id === '2026-11-20#4').flags.includes('on-file id not found'));
});

test('intake: a G the record does not confirm is raised, never kept as handled', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const routes = [
    { id: '2026-11-20#1', routes: ['G'], title: 'a' }, { id: '2026-11-20#2', routes: ['G'], title: 'b' },
    { id: '2026-11-20#3', routes: ['G'], title: 'c' }, { id: '2026-11-20#4', routes: ['G'], title: 'Where is the ranking' },
  ];
  const g = [
    { id: '2026-11-20#1', confirmed: 'yes', note: 'answered' },
    { id: '2026-11-20#2', confirmed: 'partly', note: 'only half sent', route_if_not: 'B' },
    { id: '2026-11-20#3', confirmed: 'no', note: 'a rule he stated', route_if_not: 'C' },
  ];
  const { outcomes } = mod.checkRoutes(items, routes, null, g);
  const by = Object.fromEntries(outcomes.map(o => [o.id, o]));
  assert.deepEqual(by['2026-11-20#1'].routes, ['G']);
  assert.deepEqual(by['2026-11-20#2'].routes, ['B']);
  assert.equal(by['2026-11-20#2'].owner, 'Claude', 'an unfinished request is Claude\'s to finish, not his to grade');
  assert.match(by['2026-11-20#2'].title, /^Check it was done/);
  assert.deepEqual(by['2026-11-20#3'].routes, ['C']);
  assert.deepEqual(by['2026-11-20#4'].routes, ['B'], 'no check at all for a G means it is raised');
  assert.ok(by['2026-11-20#4'].flags.some(f => /no session record/.test(f)));
  assert.deepEqual(mod.checkRoutes(items, routes, null, null).outcomes[0].routes, ['G'], 'without the G step (tests, old runs) G stands');
});

test('intake: evidence finds what the session did after his message, and the reply under his turn in a note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'intake-ev-'));
  const rows = [
    { type: 'user', origin: { kind: 'human' }, message: { content: 'Where’s the backlog ranking we discussed yesterday' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/vault/Stack rank.md' } }, { type: 'text', text: 'It is in Stack rank — rounds.md.' }] } },
    { type: 'user', toolUseResult: {}, message: { content: [{ type: 'tool_result', content: 'x' }] } },
    { type: 'user', origin: { kind: 'human' }, message: { content: 'next question' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'not part of the first answer' }] } },
  ];
  writeFileSync(join(dir, 'abcd1234-0000.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
  const after = mod.afterInSession(join(dir, 'abcd1234-0000.jsonl'), 'Where’s the backlog ranking we discussed yesterday');
  assert.match(after, /\[Read: \/vault\/Stack rank\.md\]/);
  assert.match(after, /It is in Stack rank/);
  assert.doesNotMatch(after, /not part of the first answer/);
  assert.equal(mod.afterInSession(join(dir, 'abcd1234-0000.jsonl'), 'never said this'), null);
  writeFileSync(join(dir, 'note.md'), '# t\n\n## Conversation\n\n**You** _(t1)_\n\nOk how do they check it?\n\n---\n\n**Claude** _(t2)_\n\nHere is how.\n\n---\n\n**You** _(t3)_\n\nlater');
  assert.match(mod.afterInNote(join(dir, 'note.md'), 'Ok how do they check it?'), /Here is how/);
});

test('intake: a G with no record found is Claude\'s to chase, never raised to Daniel', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const routes = [{ id: '2026-11-20#4', routes: ['G'], title: 'Where is the ranking' }];
  const g = [{ id: '2026-11-20#4', confirmed: 'no', note: 'record is empty', route_if_not: 'D' }];
  const ev = [{ id: '2026-11-20#4', what_happened_after: null }];
  const o = mod.checkRoutes(items, routes, null, g, ev).outcomes.find(x => x.id === '2026-11-20#4');
  assert.deepEqual(o.routes, ['B']);
  assert.equal(o.owner, 'Claude');
  assert.ok(o.flags.includes('no session record found'));
});

// ---- live placing (2026-11-22) ----
const O = (id, routes, extra = {}) => ({ id, routes, title: `t ${id}`, quote: 'q', source: 'Phone Notes', where: 'n', written: id.slice(0, 10), flags: [], owner: '', exists: '', reason: 'r', where_to: '', ...extra });

test('intake: placing makes items only for real work; Claude\'s own follow-ups become one item a day', () => {
  const p = mod.planApply([
    O('2026-11-21#1', ['A']), O('2026-11-21#2', ['B'], { owner: 'Daniel' }), O('2026-11-21#3', ['B'], { owner: 'Claude' }),
    O('2026-11-21#4', ['D'], { kind: 'research', bundle: 'paper' }), O('2026-11-21#5', ['D'], { kind: 'research', bundle: 'paper' }),
    O('2026-11-21#6', ['D'], { kind: 'introspection' }), O('2026-11-21#7', ['C']), O('2026-11-21#8', ['F']),
    O('2026-11-21#9', ['B'], { owner: 'Claude', title: 'Check it was done: x' }), O('2026-11-21#10', ['E']),
    O('2026-11-21#11', ['G']), O('2026-11-21#12', ['H']), O('2026-11-21#13', ['B'], { exists: 'aaaaaaaaaaaa' }),
    O('2026-11-21#14', ['H'], { flags: ['missed by router'] }),
  ]);
  const texts = p.items.map(i => i.text);
  assert.ok(texts.includes('Build idea: t 2026-11-21#1'));
  assert.equal(p.items.find(i => i.text.startsWith('Build idea')).ask.kind, 'quick', 'a build idea comes with its plan-now-or-later ask');
  assert.equal(p.items.find(i => i.text === 't 2026-11-21#2').owner, 'Daniel');
  assert.equal(p.items.find(i => i.text === 't 2026-11-21#3').owner, 'Claude');
  assert.equal(p.items.filter(i => i.text.startsWith('Answer:')).length, 1, 'bundled questions become one answer item');
  assert.deepEqual(p.asks.map(a => a.kind), ['input'], 'a question his to think through is an ask, not an item');
  const daily = p.items.filter(i => i.text.startsWith('Intake follow-ups'));
  assert.equal(daily.length, 1);
  assert.equal(daily[0].owner, 'Claude');
  assert.match(daily[0].detail, /Record the rule/); assert.match(daily[0].detail, /File in project notes/);
  assert.match(daily[0].detail, /Check it was done/); assert.match(daily[0].detail, /Route by hand/);
  assert.ok(!texts.some(t => /#1[0-3]$/.test(t)), 'ideas (via the thought scrub), G, H and pieces on file make nothing');
  assert.equal(p.items.length, 5);
});

test('intake: his grades override the router; older backfill is rechecked by Claude; baseline is never placed', () => {
  const outcomes = [O('2026-11-20#1', ['B'], { owner: 'Claude' }), O('2026-11-18#1', ['A']), O('2026-11-15#1', ['A'], { mode: 'baseline (first full read)' })];
  const p = mod.planApply(outcomes, { '2026-11-20#1': 'H' }, '2026-11-20');
  assert.ok(!p.items.some(i => i.text === 't 2026-11-20#1'), 'graded H: nothing placed');
  assert.ok(!p.items.some(i => i.text.startsWith('Build idea')), 'an old build idea is rechecked first, not placed');
  assert.match(p.items[0].detail, /Check still needed \(build idea\)/);
  assert.ok(!JSON.stringify(p).includes('2026-11-15#1'));
});

test('intake: an open question the record shows answered or decided in the moment places nothing', () => {
  const items = mod.prepareItems(BUNDLE, '2026-11-20');
  const routes = [{ id: '2026-11-20#1', routes: ['D'], kind: 'research' }, { id: '2026-11-20#4', routes: ['D'], kind: 'research' }];
  const g = [{ id: '2026-11-20#1', confirmed: 'yes', note: 'he decided: stay out of daily standard' }, { id: '2026-11-20#4', confirmed: 'no', note: 'no answer' }];
  const { outcomes } = mod.checkRoutes(items, routes, null, g, []);
  const by = Object.fromEntries(outcomes.map(o => [o.id, o]));
  assert.deepEqual(by['2026-11-20#1'].routes, ['G']);
  assert.ok(by['2026-11-20#1'].flags.some(f => /answered or decided in the moment/.test(f)));
  assert.deepEqual(by['2026-11-20#4'].routes, ['D'], 'an unanswered question stays open');
  assert.equal(mod.gatherEvidence(items, [{ id: '2026-11-20#1', routes: ['D'], reason: '' }])[0].claim, 'open question');
});

test('intake: corrections are counted by week and kind (his kill signal)', () => {
  const rows = [{ at: '2026-11-22T10:00:00Z', kind: 'repeat' }, { at: '2026-11-22T11:00:00Z', kind: 'drop' }, { at: '2026-11-23T09:00:00Z', kind: 'repeat' }];
  assert.deepEqual(mod.correctionsSummary(rows), ['week of 2026-11-16: 1 repeat, 1 drop, 0 label (total 2)', 'week of 2026-11-23: 1 repeat, 0 drop, 0 label (total 1)']);
});
