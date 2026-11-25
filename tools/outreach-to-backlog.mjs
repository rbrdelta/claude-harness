#!/usr/bin/env node
// Due follow-ups go on the day's outreach work item, not the Tactical checklist (Daniel, 2026-11-17 retro, on
// the checklist duplicating the backlog: "Yes change it"; his 2026-11-13 rule: job-search inputs "should all be
// in the backlog... I'm just seeing too many surfaces to get things done").
//   stdin: one follow-up per line, "key<TAB>text", as outreach_view.py --due prints them (key = "<Name>|<kind>").
//   A key "<Company>|round|<date>" instead becomes its own item "New outreach round: <Company>" in Next (none made
//   when one is already open).
//   Finds today's open item "M/D job search outreach" (Job search, step job-search/follow-up) and adds, under its
//   detail, each follow-up whose person the detail does not already name. No such item: creates it in Next.
//   stdout: the keys now on the item, one per line; outreach-due.sh records them so each is pushed once.
// No model. Today follows New York time; OUTREACH_TODAY=YYYY-MM-DD overrides it in tests.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DS = process.env.OUTREACH_DS || `${process.env.HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const STEP = 'job-search/follow-up';
const ds = (...a) => execFileSync(process.execPath, [DS, ...a], { encoding: 'utf8' });

const all = readFileSync(0, 'utf8').split('\n').map((l) => l.split('\t')).filter(([k, t]) => k && t).map(([key, text]) => ({ key, text, name: key.split('|')[0] }));
if (!all.length) process.exit(0);
// "<Company>|round|<last send>": a top target whose outreach has run its course. Each is its own work item,
// a new round, not a line on the day's follow-ups (Daniel, 2026-11-25: "don't we want to actually initiate a
// new set of outreach for the most important targets? So that should be an actual new work item").
const rounds = all.filter((f) => f.key.split('|')[1] === 'round');
const due = all.filter((f) => f.key.split('|')[1] !== 'round');

const day = process.env.OUTREACH_TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const [, m, d] = day.split('-').map(Number);
const md = `${m}/${d}`;
const title = `${md} job search outreach`;

const open = JSON.parse(ds('backlog', '--json')).filter((t) => t.status === 'open' && t.step === STEP);
for (const r of rounds) {
  const rt = `New outreach round: ${r.name}`;
  if (!open.some((t) => (t.text || '') === rt)) {
    const detail = `Done when the new round's first messages are sent, or the company is dropped with the reason written here.\nPart of: the outreach follow-up cadence (added by the morning follow-up job).\n${r.text}`;
    const out = ds('task-add', rt, '--project', 'Job search', '--step', STEP, '--tier', 'next', '--source', 'Outreach cadence', '--next', 'Pick the people and what is new to show', '--detail', detail);
    if (!/^added /.test(out)) throw new Error(`could not add "${rt}": ${out.trim()}`);
  }
  console.log(r.key);
}
if (!due.length) process.exit(0);
const item = open.find((t) => (t.text || '').toLowerCase().startsWith(title)) || open.find((t) => (t.text || '').startsWith(`${md} `));
const lines = (list) => list.map((f) => `- ${f.text}`).join('\n');

if (item) {
  const fresh = due.filter((f) => !(item.detail || '').includes(f.name));
  if (fresh.length) ds('task-set', item.id, `detail=${(item.detail || '').trimEnd()}\nFollow-ups due ${md}, added by the morning follow-up job:\n${lines(fresh)}`);
} else {
  const detail = `Done when each follow-up below is sent, or skipped with the reason written here.\nPart of: the outreach follow-up cadence. The cards (address, channel, message) are in the send list of the week note.\nFollow-ups due ${md}, added by the morning follow-up job:\n${lines(due)}`;
  const out = ds('task-add', title, '--project', 'Job search', '--step', STEP, '--tier', 'next', '--source', 'Outreach cadence', '--next', 'Send the follow-ups due today', '--detail', detail);
  if (!/^added /.test(out)) throw new Error(`could not add "${title}": ${out.trim()}`);
}
for (const f of due) console.log(f.key);
