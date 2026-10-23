// tools/retro-window.mjs against a fake ds.mjs (a JSON file of work items) and a recording notifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const FAKE_DS = `import fs from 'node:fs';
const db = process.env.FAKE_DS_DB; const items = JSON.parse(fs.readFileSync(db, 'utf8'));
const [cmd, ...a] = process.argv.slice(2);
fs.appendFileSync(process.env.SHIM_LOG, 'ds ' + JSON.stringify([cmd, ...a]) + '\\n');
const save = () => fs.writeFileSync(db, JSON.stringify(items));
if (cmd === 'backlog') console.log(JSON.stringify(items));
else if (cmd === 'task-set') { const t = items.find((x) => x.id === a[0]); for (const kv of a.slice(1)) { const i = kv.indexOf('='); t[kv.slice(0, i)] = kv.slice(i + 1); } save(); }
else if (cmd === 'task-add') { const t = { text: a[0], status: 'open' }; for (let i = 1; i < a.length; i += 2) t[a[i].slice(2)] = a[i + 1];
  t.id = t.key; delete t.key; t.order = Number(t.order); items.push(t); save(); }
`;

function setup(items, { notifyFails = false } = {}) {
  const sb = sandbox();
  sb.write('ds.mjs', FAKE_DS);
  sb.write('db.json', JSON.stringify(items));
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"; ${notifyFails ? 'exit 1' : 'exit 0'}`, 0o755);
  sb.write('inbox/.keep', '');
  sb.items = () => JSON.parse(sb.read('db.json'));
  sb.notes = () => sb.calls().filter((c) => c.startsWith('notify ')).map((c) => c.slice(7));
  sb.retro = (cmd) => sb.run(process.execPath, [join(REPO, 'tools/retro-window.mjs'), ...(cmd ? [cmd] : [])], {
    env: { RETRO_DS: sb.path('ds.mjs'), RETRO_NOTIFY: sb.path('notify.sh'), RETRO_INBOX: sb.path('inbox'), RETRO_LOG: sb.path('retro.log'), FAKE_DS_DB: sb.path('db.json') },
  });
  return sb;
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function comingMonday() { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); return ymd(d); }
const now = (id, order) => ({ id, text: `item ${id}`, status: 'open', tier: 'now', order });

test('retro-window open: adds "Retro — week of <Mon>" to Now at the top, owned by Both, keyed retro-<Monday>', () => {
  const sb = setup([now('a', 1)]);
  sb.write('inbox/Retro Prep — 2026-10-11.md', 'old');
  sb.write('inbox/Retro Prep — 2026-10-18.md', 'new');
  assert.equal(sb.retro('open').code, 0);
  const key = `retro-${comingMonday()}`;
  const r = sb.items().find((t) => t.id === key);
  assert.ok(r, `expected ${key}`);
  assert.match(r.text, /^Retro — week of [A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(r.tier, 'now'); assert.equal(r.order, -1); assert.equal(r.owner, 'Both'); assert.equal(r.project, 'Harness');
  assert.match(r.detail, /^Window: Monday .* through Tuesday .*Prep: Retro Prep — 2026-10-18\.md\. If it is not closed by the end of Tuesday it is marked skipped/);
  assert.equal(sb.items().find((t) => t.id === 'a').tier, 'now', 'room left: nothing demoted');
  assert.match(sb.notes()[0], /^Retro prep is ready\. "Retro — week of .*" holds a Now slot Monday and Tuesday\.$/);
});

test('retro-window open: with Now full (3), the last Now item moves to Next and the message says so', () => {
  const sb = setup([now('a', 1), now('c', 3), now('b', 2), { ...now('child', 9), parent: 'a' }, { ...now('n', 4), tier: 'next' }]);
  sb.retro('open');
  const it = sb.items();
  assert.equal(it.find((t) => t.id === 'c').tier, 'next');
  assert.equal(it.find((t) => t.id === 'a').tier, 'now');
  assert.equal(it.find((t) => t.id === 'b').tier, 'now');
  assert.match(sb.notes()[0], /To make room, "item c" moved from Now to Next\./);
  assert.match(sb.read('retro.log'), /open: added retro-.* To make room/);
});

test('retro-window open: is idempotent — a second run adds nothing and sends nothing', () => {
  const sb = setup([now('a', 1), now('b', 2), now('c', 3)]);
  sb.retro('open');
  const after = sb.items();
  sb.retro('open');
  assert.deepEqual(sb.items(), after);
  assert.equal(sb.notes().length, 1);
  assert.match(sb.read('retro.log'), /already exists/);
});

test('retro-window open: a missing prep doc is named in the detail as missing', () => {
  const sb = setup([]);
  sb.retro('open');
  assert.match(sb.items()[0].detail, /Prep: missing\./);
});

const PREP = `# Retro Prep\n## 1. Threads\n- not a question\n## Open questions for Daniel\n1. Keep Partswatch parked?\n2. Trim the harness check?\n- Close the sound thread?\nprose line\n## After\n- ignored\n`;

test('retro-window expire: a retro still open after Tuesday is dropped as skipped with the prep\'s open questions', () => {
  const sb = setup([{ id: 'retro-2026-10-12', text: 'Retro — week of Oct 12', status: 'open', tier: 'now', detail: 'Window: x' }]);
  sb.write('inbox/Retro Prep — 2026-10-11.md', PREP);
  assert.equal(sb.retro('expire').code, 0);
  const t = sb.items()[0];
  assert.equal(t.status, 'dropped');
  assert.equal(t.detail, 'Window: x || SKIPPED 2026-10-13. Decisions left open: 1. Keep Partswatch parked? 2. Trim the harness check? 3. Close the sound thread? || Why skipped: not given yet.');
  assert.match(sb.notes()[0], /^Retro — week of Oct 12 was skipped\. 3 decision\(s\) left open\. Why did you skip it\?/);
});

test('retro-window expire: leaves retros whose window has not ended, closed retros and non-retro items alone', () => {
  const future = new Date(); future.setDate(future.getDate() + 1);
  const items = [
    { id: `retro-${ymd(future)}`, text: 'r', status: 'open', detail: 'd' },
    { id: 'retro-2026-10-05', text: 'r', status: 'done', detail: 'd' },
    { id: 'retro-notes', text: 'r', status: 'open', detail: 'd' },
  ];
  const sb = setup(items);
  sb.retro('expire');
  assert.deepEqual(sb.items(), items);
  assert.equal(sb.notes().length, 0);
});

test('retro-window expire: with no prep, the detail says no decisions were listed', () => {
  const sb = setup([{ id: 'retro-2026-10-12', text: 'R', status: 'open', detail: 'd' }]);
  sb.retro('expire');
  assert.match(sb.items()[0].detail, /Decisions left open: none listed in the prep/);
});

test('retro-window: a failed Telegram send is logged, never fatal', () => {
  const sb = setup([], { notifyFails: true });
  assert.equal(sb.retro('open').code, 0);
  assert.match(sb.read('retro.log'), /telegram send failed/);
  assert.equal(sb.items().length, 1);
});

test('retro-window: any other command prints usage and exits 2', () => {
  const sb = setup([]);
  const r = sb.retro('close');
  assert.equal(r.code, 2);
  assert.match(r.err, /usage: retro-window\.mjs open\|expire/);
});
