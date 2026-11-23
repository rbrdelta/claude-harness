#!/usr/bin/env node
// Trial tally (Daniel, 2026-11-22: "Ok so how do we keep checking this before we deploy for real" / "Build it").
// The planning format from the stack rank rounds (vault Inbox/Stack rank — rounds.md) runs as a one-week trial
// before anything goes into the PM run or the Daily Standard page. The plan (each day's blocks for Daniel, each
// tied to a work item, and Claude's own commitments) lives in a plan file; this script compares it with what
// actually happened and keeps one line per day in a "Trial log" section of the rounds note. Read-only on Daily
// Standard, no model. Run nightly by trial-tally.timer (23:50, Persistent); every run rewrites every finished day
// of the trial, so a Done marked late still counts. Why it compares a plan at all: on 11-16 to 11-21 every block
// Daniel put on the page got done (12 of 12) while the Actively case study slipped and never reached the page,
// so the page alone can't show a slip.
// Deciding line (Daniel, 2026-11-22 ask session, "1 is yes"): the day's one thing done on at least 5 of 7 days.
// When enough days are missed that the line can't be met, one Telegram message says so (the midweek check).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const HOME = process.env.HOME;
const DS = process.env.TRIAL_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const PLAN = process.env.TRIAL_PLAN || `${HOME}/.claude/trial/plan.json`;
const NOTE = process.env.TRIAL_NOTE || '/mnt/c/MCP/Inbox/Stack rank — rounds.md';
const NOTIFY = process.env.TRIAL_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const LOG = process.env.TRIAL_LOG || `${HOME}/.claude/hooks/trial-tally.log`;
const STATE = process.env.TRIAL_STATE || `${HOME}/.claude/trial/state.json`;
const NOW = process.env.TRIAL_NOW ? Date.parse(process.env.TRIAL_NOW) : Date.now();
const TZ = 'America/New_York';

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const ds = (...a) => JSON.parse(execFileSync(process.execPath, [DS, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const ny = (ts) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const addDays = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const label = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: '2-digit', day: '2-digit' }).replace(',', '').replace('/', '-');

if (!existsSync(PLAN)) { log('no plan file, nothing to tally'); process.exit(0); }
const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const { start, end } = plan;
const need = plan.deciding?.min ?? 5;
const total = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 864e5) + 1;
const now = ny(NOW);
// A day is finished once it is over, or from 23:00 on the day itself.
const days = [];
for (let d = start; d <= end; d = addDays(d, 1)) if (d < now.day || (d === now.day && now.hour >= 23)) days.push(d);
if (!days.length) { log(`${now.day}: trial starts ${start}, nothing to tally yet`); process.exit(0); }

let focus, backlog;
try { focus = ds('focus', '--json'); backlog = ds('backlog', '--json'); }
catch (e) { log(`FAIL: ds: ${(String(e.stderr || '').trim() || e.message).split('\n')[0]}`); process.exit(1); }
const items = Array.isArray(backlog) ? backlog : backlog.tasks || backlog.items || [];
const byId = Object.fromEntries(items.map((t) => [t.id, t]));
const closedDay = (id) => {
  const t = byId[id];
  if (!t || t.status !== 'done' || !t.closedAt) return null;
  const m = /^(\d{4}-\d{2}-\d{2}):/.exec(t.closedBy || '');
  return m ? m[1] : ny(t.closedAt).day;
};

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
state.one = state.one || {};
for (const r of focus.record || []) if (r.day >= start && r.day <= end) state.one[r.day] = { done: !!r.done, text: r.text };

const lines = [];
for (const d of days) {
  let pri = [];
  try { pri = ds('day', d, '--json').pri || []; }
  catch (e) { log(`FAIL: ds day ${d}: ${(String(e.stderr || '').trim() || e.message).split('\n')[0]}`); process.exit(1); }
  const p = plan.days?.[d] || {};
  const yours = (p.daniel || []).map((b) => {
    const page = pri.find((x) => x.taskId === b.task);
    const c = closedDay(b.task);
    if (page?.outcome === 'done' || c === d) return { ...b, s: 'done' };
    if (c && c < d) return { ...b, s: 'done' };
    if (page?.outcome === 'moved') return { ...b, s: 'moved', why: page.reason };
    if (page?.outcome === 'split') return { ...b, s: 'moved', why: page.rest ? `split, left: ${page.rest}` : 'split' };
    return { ...b, s: 'slipped' };
  });
  const mine = (p.claude || []).map((b) => { const c = closedDay(b.task); return { ...b, s: c && c <= d ? 'done' : 'not done' }; });
  const one = state.one[d];
  const n = (s) => yours.filter((b) => b.s === s);
  const parts = [`**${label(d)}**`];
  parts.push(one ? `one thing: ${one.done ? 'done' : 'not done'} (${one.text})` : 'one thing: none set');
  if (yours.length) {
    let t = `your blocks: ${n('done').length} of ${yours.length} done`;
    if (n('moved').length) t += `, ${n('moved').length} moved (${n('moved').map((b) => `${b.text}: ${b.why || 'no reason given'}`).join('; ')})`;
    if (n('slipped').length) t += `, ${n('slipped').length} slipped (${n('slipped').map((b) => b.text).join('; ')})`;
    parts.push(t);
  } else parts.push('your blocks: none planned');
  if (mine.length) {
    const missed = mine.filter((b) => b.s !== 'done');
    parts.push(`my lane: ${mine.length - missed.length} of ${mine.length} done${missed.length ? ` (not done: ${missed.map((b) => b.text).join('; ')})` : ''}`);
  }
  lines.push(`- ${parts.join(' · ')}`);
}

const counted = Object.entries(state.one).filter(([d]) => days.includes(d));
const doneCount = counted.filter(([, o]) => o.done).length;
const missed = counted.length - doneCount;
const canStillMeet = total - missed >= need;
const summary = `One thing done ${doneCount} of ${counted.length} day(s) so far; the line is ${need} of ${total}${canStillMeet ? '' : ' and **can no longer be met**'}.`;

const head = `## Trial log, ${start.slice(5)} to ${end.slice(5)}`;
const section = [head, '',
  `*Written nightly by the harness (tools/trial-tally.mjs) from the plan in ${PLAN.replace(HOME, '~')}, Daily Standard and the work items. Your blocks: done = marked Done on the page or its work item closed; moved = Moved or Split on the page, with the reason; slipped = neither. Edits here are overwritten; comment above the section instead.*`,
  '', summary, '', ...lines, ''].join('\n');

if (!existsSync(NOTE)) { log(`FAIL: note not found: ${NOTE}`); process.exit(1); }
let note = readFileSync(NOTE, 'utf8');
const at = note.indexOf(`${head}\n`);
if (at >= 0) {
  const next = note.indexOf('\n## ', at + head.length);
  note = note.slice(0, at) + section + (next >= 0 ? note.slice(next + 1) : '');
} else {
  const anchor = 'Newest round first.\n';
  const i = note.indexOf(anchor);
  note = i >= 0 ? `${note.slice(0, i + anchor.length)}\n${section}\n${note.slice(i + anchor.length)}` : `${note.trimEnd()}\n\n${section}`;
}
writeFileSync(NOTE, note);

if (!canStillMeet && !state.alerted) {
  try { execFileSync(NOTIFY, [`Trial check: the one thing has been missed on ${missed} of ${counted.length} days, so ${need} of ${total} can't be met this week. Worth changing the plan now rather than at the retro. Log: Stack rank — rounds note, Trial log.`]); state.alerted = now.day; }
  catch { log('telegram send failed'); }
}
mkdirSync(dirname(STATE), { recursive: true });
writeFileSync(STATE, JSON.stringify(state, null, 1));
log(`OK: tallied ${days.length} day(s), ${start} to ${days[days.length - 1]}; one thing ${doneCount} of ${counted.length}`);
