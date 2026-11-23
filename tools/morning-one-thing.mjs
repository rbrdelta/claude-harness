#!/usr/bin/env node
// Morning message: the day's one thing, and nothing else (Daniel, 2026-11-22: "if you have a lot of asks, it can
// really derail the morning which is the most important block of the day to take on the top priority". The asks
// moved to 3pm, tools/asks-launch.mjs). Run by morning-one-thing.timer at 07:30. One Telegram message a day:
// the one thing, its next step, and a question for him only when an open ask is tied to that work item.
// Sends nothing when the one thing is already done or none is set (logged).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const HOME = process.env.HOME;
const DS = process.env.MORNING_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const NOTIFY = process.env.MORNING_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const LOG = process.env.MORNING_LOG || `${HOME}/.claude/hooks/morning-one-thing.log`;
const STATE = process.env.MORNING_STATE || `${HOME}/.claude/hooks/morning-one-thing-state.json`;

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const ds = (...a) => JSON.parse(execFileSync(process.execPath, [DS, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));

let focus, backlog, asks;
try { focus = ds('focus', '--json'); backlog = ds('backlog', '--json'); asks = ds('asks', '--json'); }
catch (e) { log(`FAIL: ds: ${(String(e.stderr || '').trim() || e.message).split('\n')[0]}`); process.exit(1); }

const t = focus.today;
const day = t?.day;
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
if (day && state.sent === day) process.exit(0);
if (!t || !t.taskId) { log(`${day || 'today'}: no one thing set, nothing sent`); process.exit(0); }
if (t.done) { log(`${day}: one thing already done, nothing sent`); process.exit(0); }

const items = Array.isArray(backlog) ? backlog : backlog.tasks || backlog.items || [];
const item = items.find((i) => i.id === t.taskId) || {};
const blocking = asks.filter((a) => a.task === t.taskId && !(a.on && a.on > day));
const lines = [`Today's one thing: ${t.text}${t.carried && t.since ? ` (carried since ${t.since.slice(5).replace('-', '/')})` : ''}.`];
if (item.next) lines.push(`Next step: ${item.next}`);
if (blocking.length) lines.push(`One question stands in its way: ${blocking[0].text}`);
try { execFileSync(NOTIFY, [lines.join('\n')]); }
catch { log(`${day}: FAIL: telegram send failed`); process.exit(1); }
writeFileSync(STATE, JSON.stringify({ sent: day }));
log(`${day}: OK: sent "${t.text}"${blocking.length ? ' with its blocking question' : ''}`);
