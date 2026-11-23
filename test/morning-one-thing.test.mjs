// tools/morning-one-thing.mjs against a fake ds (focus, backlog and asks from env) and a recording notifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sandbox, REPO } from './helpers.mjs';

const TODAY = { day: '2026-11-23', taskId: 't1', text: '11/20 Actively case study prep', carried: true, since: '2026-11-20', done: false };
function setup({ today = TODAY, asks = [] } = {}) {
  const sb = sandbox();
  const data = { focus: { today }, backlog: [{ id: 't1', next: 'Two mock case studies out loud' }, { id: 't2', next: 'Other' }], asks };
  sb.write('ds.mjs', `const d = ${JSON.stringify(data)}; console.log(JSON.stringify(d[process.argv[2]]));`);
  sb.write('notify.sh', `#!/bin/bash\nprintf 'notify %s\\n' "$1" >> "$SHIM_LOG"`, 0o755);
  sb.notes = () => sb.read('shim.log').split('notify ').slice(1);
  sb.run1 = () => sb.run(process.execPath, [join(REPO, 'tools/morning-one-thing.mjs')], {
    env: { MORNING_DS: sb.path('ds.mjs'), MORNING_NOTIFY: sb.path('notify.sh'), MORNING_LOG: sb.path('m.log'), MORNING_STATE: sb.path('state.json') },
  });
  return sb;
}

test('morning: the one thing and its next step, nothing else; asks for other work stay out', () => {
  const sb = setup({ asks: [{ id: 'a', task: 't2', text: 'Unrelated question' }, { id: 'b', text: 'No task' }] });
  assert.equal(sb.run1().code, 0);
  assert.deepEqual(sb.notes(), ["Today's one thing: 11/20 Actively case study prep (carried since 11/20).\nNext step: Two mock case studies out loud\n"]);
});

test('morning: a question tied to the one thing comes with it; one held for a later day does not', () => {
  const sb = setup({ asks: [{ id: 'h', task: 't1', text: 'Held one', on: '2026-11-25' }, { id: 'a', task: 't1', text: 'Which case first?' }] });
  sb.run1();
  assert.match(sb.notes()[0], /One question stands in its way: Which case first\?\n$/);
});

test('morning: one message a day; nothing when the one thing is done or none is set', () => {
  const sb = setup();
  sb.run1(); sb.run1();
  assert.equal(sb.notes().length, 1, 'a second fire the same day sends nothing');
  const done = setup({ today: { ...TODAY, done: true } });
  done.run1();
  assert.equal(done.notes().length, 0);
  assert.match(done.read('m.log'), /already done, nothing sent/);
  const none = setup({ today: null });
  none.run1();
  assert.equal(none.notes().length, 0);
  assert.match(none.read('m.log'), /no one thing set/);
});
