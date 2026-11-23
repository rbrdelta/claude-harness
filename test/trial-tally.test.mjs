// tools/trial-tally.mjs against a fake ds (focus, backlog and each day's priorities), a plan file, a copy of the
// rounds note and a recording notifier. Nothing live is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const NOTE = '---\ntitle: x\n---\n\n# Stack rank — rounds\n\nNewest round first.\n\n---\n\n## Round 4\n\ntext\n';
const PLAN = { start: '2026-11-23', end: '2026-11-29', deciding: { min: 5 }, days: {
  '2026-11-23': { daniel: [{ task: 'case', text: 'Actively case study' }, { task: 'gl', text: 'General Legal note' }, { task: 'deb', text: 'Research debrief' }],
    claude: [{ task: 'scan', text: 'Job scan fixes' }, { task: 'grade', text: 'Grade postings' }] },
  '2026-11-24': { daniel: [{ task: 'beh', text: 'Actively behavioral' }] },
} };
const DATA = {
  focus: { record: [{ day: '2026-11-23', done: true, text: 'Actively case study' }, { day: '2026-11-24', done: false, text: 'Actively behavioral' }, { day: '2026-11-25', done: false, text: 'Actively behavioral' }] },
  backlog: [
    { id: 'case', status: 'done', closedAt: Date.parse('2026-11-23T15:00:00Z'), closedBy: '2026-11-23:p1:done' },
    { id: 'gl', status: 'open' }, { id: 'deb', status: 'open' }, { id: 'beh', status: 'open' },
    { id: 'grade', status: 'done', closedAt: Date.parse('2026-11-23T20:00:00Z') }, { id: 'scan', status: 'open' },
  ],
  day: { '2026-11-23': [{ taskId: 'gl', outcome: 'moved', reason: 'TenE8 call ran long' }], '2026-11-24': [], '2026-11-25': [] },
};
function setup({ now, data = DATA, plan = PLAN, note = NOTE } = {}) {
  const sb = sandbox();
  sb.write('ds.mjs', `const d = ${JSON.stringify(data)}; const c = process.argv[2];
    console.log(JSON.stringify(c === 'day' ? { date: process.argv[3], pri: d.day[process.argv[3]] || [] } : d[c]));`);
  sb.write('plan.json', JSON.stringify(plan));
  sb.write('rounds.md', note);
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"`, 0o755);
  sb.notes = () => sb.read('shim.log').split('notify ').slice(1);
  sb.run1 = (when = now) => sb.run(process.execPath, [join(REPO, 'tools/trial-tally.mjs')], { env: {
    TRIAL_DS: sb.path('ds.mjs'), TRIAL_PLAN: sb.path('plan.json'), TRIAL_NOTE: sb.path('rounds.md'), TRIAL_NOTIFY: sb.path('notify.sh'),
    TRIAL_LOG: sb.path('t.log'), TRIAL_STATE: sb.path('trial', 'state.json'), TRIAL_NOW: when } });
  return sb;
}

test('trial tally: before the trial starts nothing is written', () => {
  const sb = setup({ now: '2026-11-23T15:00:00Z' });
  assert.equal(sb.run1().code, 0);
  assert.equal(sb.read('rounds.md'), NOTE);
  assert.match(sb.read('t.log'), /nothing to tally yet/);
});

test('trial tally: a finished day gets one line: one thing, blocks done, moved with reason, slipped, and my lane', () => {
  const sb = setup({ now: '2026-11-24T14:00:00Z' });
  assert.equal(sb.run1().code, 0, sb.read('t.log'));
  const n = sb.read('rounds.md');
  assert.match(n, /Newest round first\.\n\n## Trial log, 11-23 to 11-29\n/);
  assert.ok(n.indexOf('## Trial log') < n.indexOf('## Round 4'), 'the log sits above the rounds');
  assert.match(n, /\*\*Mon 11-23\*\* · one thing: done \(Actively case study\) · your blocks: 1 of 3 done, 1 moved \(General Legal note: TenE8 call ran long\), 1 slipped \(Research debrief\) · my lane: 1 of 2 done \(not done: Job scan fixes\)/);
  assert.ok(!/Tue 11-24/.test(n), 'today is not tallied before 23:00');
  assert.match(n, /One thing done 1 of 1 day\(s\) so far; the line is 5 of 7\./);
});

test('trial tally: reruns rewrite the section in place, and a late Done counts', () => {
  const sb = setup({ now: '2026-11-24T14:00:00Z' });
  sb.run1();
  const later = { ...DATA, day: { ...DATA.day, '2026-11-23': [{ taskId: 'gl', outcome: 'done' }, { taskId: 'deb', outcome: 'done' }] } };
  sb.write('ds.mjs', `const d = ${JSON.stringify(later)}; const c = process.argv[2];
    console.log(JSON.stringify(c === 'day' ? { date: process.argv[3], pri: d.day[process.argv[3]] || [] } : d[c]));`);
  sb.run1('2026-11-25T04:30:00Z'); // 23:30 New York on 11-24
  const n = sb.read('rounds.md');
  assert.equal(n.split('## Trial log').length, 2, 'one section, not two');
  assert.match(n, /\*\*Mon 11-23\*\* · one thing: done \(Actively case study\) · your blocks: 3 of 3 done ·/);
  assert.match(n, /\*\*Tue 11-24\*\* · one thing: not done \(Actively behavioral\) · your blocks: 0 of 1 done, 1 slipped \(Actively behavioral\)/);
  assert.match(n, /## Round 4\n\ntext\n$/, 'the rest of the note is untouched');
});

test('trial tally: once the line of 5 of 7 can no longer be met, one Telegram message, once', () => {
  const miss = { ...DATA, focus: { record: ['23', '24', '25', '26'].map((d, i) => ({ day: `2026-11-${d}`, done: i === 0, text: 'x' })) } };
  const sb = setup({ data: miss, now: '2026-11-27T14:00:00Z' });
  sb.run1();
  assert.equal(sb.notes().length, 1);
  assert.match(sb.notes()[0], /missed on 3 of 4 days, so 5 of 7 can't be met/);
  assert.match(sb.read('rounds.md'), /can no longer be met/);
  sb.run1('2026-11-27T20:00:00Z');
  assert.equal(sb.notes().length, 1, 'no second message');
});

test('trial tally: a one-thing result from an earlier week survives when focus no longer lists it', () => {
  const sb = setup({ now: '2026-11-24T14:00:00Z' });
  sb.run1();
  const nextWeek = { ...DATA, focus: { record: [] } };
  sb.write('ds.mjs', `const d = ${JSON.stringify(nextWeek)}; const c = process.argv[2];
    console.log(JSON.stringify(c === 'day' ? { date: process.argv[3], pri: d.day[process.argv[3]] || [] } : d[c]));`);
  sb.run1('2026-11-24T15:00:00Z');
  assert.match(sb.read('rounds.md'), /\*\*Mon 11-23\*\* · one thing: done/);
});
