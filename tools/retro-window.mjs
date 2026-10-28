#!/usr/bin/env node
// Weekly retro window (Daniel, 2026-10-23). Prep runs Sunday; the retro then holds one Now slot
// for Monday and Tuesday and closes as done (with Claude, via /retro) or as skipped.
//   retro-window.mjs open     end of the Sunday prep run: add "Retro — week of <Mon>" to Now. If Now is
//                             already full, move the last Now item to Next and tell Daniel (no permission needed).
//   retro-window.mjs expire   start of every overnight PM run: a retro still open once Tuesday has ended is
//                             dropped as skipped, with the decisions it left open, and Daniel is asked why.
//                             Not if Daniel has put it into a block on the Daily Standard (2026-10-28): a slotted
//                             retro is scheduled, and retro-launch.mjs opens its session.
// Both are idempotent. Telegram goes through telegram-notify.sh; a failed send is logged, never fatal.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';

const HOME = process.env.HOME;
const DS = process.env.RETRO_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const NOTIFY = process.env.RETRO_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const INBOX = process.env.RETRO_INBOX || '/mnt/c/MCP/Inbox';
const LOG = process.env.RETRO_LOG || `${HOME}/.claude/hooks/retro-window.log`;
const NOW_CAP = 3;

const ds = (...a) => execFileSync(process.execPath, [DS, ...a], { encoding: 'utf8' });
const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const notify = (m) => { try { execFileSync(NOTIFY, [m]); } catch { log('telegram send failed'); } };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pretty = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const items = () => JSON.parse(ds('backlog', '--json'));

function latestPrep() {
  const f = readdirSync(INBOX).filter((n) => n.startsWith('Retro Prep — ')).sort().pop();
  return f ? `${INBOX}/${f}` : null;
}

// The prep's open questions are the decisions a skipped retro leaves open.
function openQuestions(prep) {
  if (!prep) return [];
  const md = readFileSync(prep, 'utf8');
  const i = md.search(/^## Open questions/m);
  if (i < 0) return [];
  const rest = md.slice(i).split('\n').slice(1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => /^\s*(\d+\.|[-*])\s+/.test(l)).map((l) => l.replace(/^\s*(\d+\.|[-*])\s+/, '').trim());
}

const cmd = process.argv[2];
if (cmd === 'open') {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); // the coming Monday (today if Monday)
  const mon = ymd(d);
  const key = `retro-${mon}`;
  const all = items();
  const existing = all.find((t) => t.id === key);
  // Already in Now (or closed): nothing to do. Sitting in Next (moved there before the window opened,
  // as on 2026-10-23): promote it below instead of leaving it out of Now.
  if (existing && (existing.status !== 'open' || existing.tier !== 'next')) { log(`open: ${key} already exists`); process.exit(0); }
  const nows = all.filter((t) => t.status === 'open' && t.tier !== 'next' && !t.parent).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
  let moved = '';
  if (nows.length >= NOW_CAP) {
    const last = nows[nows.length - 1];
    ds('task-set', last.id, 'tier=next');
    moved = ` To make room, "${last.text}" moved from Now to Next.`;
  }
  const tue = new Date(d); tue.setDate(d.getDate() + 1);
  const prep = latestPrep();
  const detail = `Window: Monday ${pretty(mon)} through Tuesday ${pretty(ymd(tue))}. Run /retro with Claude. Prep: ${prep ? prep.split('/').pop() : 'missing'}. If it is not closed by the end of Tuesday it is marked skipped, with the decisions it left open.`;
  if (existing) ds('task-set', key, 'tier=now', 'order=-1', `detail=${detail}`);
  else ds('task-add', `Retro — week of ${pretty(mon)}`, '--project', 'Harness', '--tier', 'now', '--key', key, '--order', '-1', '--owner', 'Both', '--detail', detail);
  log(`open: ${existing ? 'promoted' : 'added'} ${key}${moved}`);
  notify(`Retro prep is ready. "Retro — week of ${pretty(mon)}" holds a Now slot Monday and Tuesday.${moved}`);
} else if (cmd === 'expire') {
  const open = items().filter((x) => /^retro-\d{4}-\d{2}-\d{2}$/.test(x.id) && x.status === 'open');
  const slotted = open.length ? new Set(JSON.parse(ds('slotted', 'retro-', '--json')).map((s) => s.taskId)) : new Set();
  for (const t of open) {
    if (slotted.has(t.id)) { log(`expire: ${t.id} kept, slotted on the Daily Standard`); continue; }
    const end = new Date(`${t.id.slice(6)}T00:00:00`); end.setDate(end.getDate() + 2); // Wednesday 00:00, i.e. Tuesday has ended
    if (Date.now() < end.getTime()) continue;
    const qs = openQuestions(latestPrep());
    const missed = qs.length ? qs.map((q, i) => `${i + 1}. ${q}`).join(' ') : 'none listed in the prep';
    ds('task-set', t.id, 'status=dropped', `detail=${t.detail} || SKIPPED ${ymd(new Date(end.getTime() - 1))}. Decisions left open: ${missed} || Why skipped: not given yet.`);
    log(`expire: ${t.id} skipped, ${qs.length} decisions left open`);
    notify(`${t.text} was skipped. ${qs.length} decision(s) left open. Why did you skip it? Tell Claude in a session and it will be recorded on the item.`);
  }
} else {
  console.error('usage: retro-window.mjs open|expire');
  process.exit(2);
}
