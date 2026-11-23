#!/usr/bin/env node
// Retro launcher (Daniel, 2026-10-28). When Daniel puts the weekly retro into a block on the Daily Standard
// (a day priority picked from a retro-YYYY-MM-DD work item), start a laptop session for it right away: named for
// the slot, Remote Control on (so it shows in the Claude app and claude.ai/code), /retro already run up to the
// first question. He opens it when the slot comes; nothing to start by hand.
//   retro-launch.mjs    run every 5 minutes by retro-launch.timer (via triggers/retro-launch.sh). Idempotent:
//                       one session per retro item; moving it to another block opens no second one.
// Telegram says when a session is ready (with its link) or when a launch failed. Retro only, by design.
// Sunday night is the default since 2026-11-22 (Daniel: "let's move the retro to trigger on Sunday night so we
// start on Mondays with clear priorities when possible. It can still be pushed to Monday or Tuesday latest if
// needed."): when the Sunday prep opens the retro window, retro-window.mjs leaves a request file and the next run
// here starts the session without waiting for a slot. If he then slots the retro for Monday or Tuesday, the
// session already running is the one for the slot; if it is gone by then, a new one starts.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { transcriptPath, linkFromTranscript, LINK_ON_SCREEN } from './rc-link.mjs';

const HOME = process.env.HOME;
const DS = process.env.RETRO_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const NOTIFY = process.env.RETRO_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const LOG = process.env.RETRO_LOG || `${HOME}/.claude/hooks/retro-launch.log`;
const STATE = process.env.RETRO_LAUNCH_STATE || `${HOME}/.claude/hooks/retro-launch-state.json`;
const TONIGHT = process.env.RETRO_TONIGHT || `${HOME}/.claude/hooks/retro-tonight.json`; // written by retro-window.mjs open
const TONIGHT_MAX_H = 12; // a request older than this is last week's, or a night that has passed
const CLAUDE = process.env.RETRO_CLAUDE || 'claude';
const WAIT_S = Number(process.env.RETRO_WAIT_S ?? 90); // how long Remote Control gets to come up
const MAX_TRIES = 3;
const DS_TRIES = 3;
const DS_WAIT_S = 15;
// ds reaches the database over the network; these are connections that never came up (about 4% of runs).
const TRANSIENT = /fetch failed|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/;

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const notify = (m) => { try { execFileSync(NOTIFY, [m]); } catch { log('telegram send failed'); } };
const tmux = (...a) => execFileSync('tmux', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const alive = (s) => { try { tmux('has-session', '-t', `=${s}`); return true; } catch { return false; } };
const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (s) => execFileSync('sleep', [String(s)]);
const pretty = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { launched: {}, failed: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

// The whole error goes in the log, on one line so the log stays one event per line.
function readSlotted() {
  for (let attempt = 1; ; attempt++) {
    try { return JSON.parse(execFileSync(process.execPath, [DS, 'slotted', '', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (e) {
      const err = (String(e.stderr || '').trim() || e.message).replace(/\s*\n\s*/g, ' | ');
      if (attempt >= DS_TRIES || !TRANSIENT.test(err)) { log(`FAIL: ds slotted (try ${attempt} of ${DS_TRIES}): ${err}`); process.exit(1); }
      log(`RETRY: ds slotted try ${attempt} of ${DS_TRIES} could not connect (${err.match(TRANSIENT)[0]})`);
      sleep(DS_WAIT_S);
    }
  }
}
const slotted = readSlotted();
const RETRO_ID = /^retro-\d{4}-\d{2}-\d{2}$/;

// A retro slotted from a work item that isn't a retro-<date> one (a replaced item, say): nothing can be launched
// for it, so say so once rather than skip it in silence. The link holds no pointer to a replacement to follow.
state.warned ||= {};
for (const s of slotted.filter((x) => !RETRO_ID.test(x.taskId) && /^\s*(weekly\s+)?retro\b/i.test(x.text || ''))) {
  const key = `${s.date}/${s.priId}`;
  if (state.warned[key]) continue;
  state.warned[key] = new Date().toISOString();
  save();
  log(`WARN: "${s.text}" is slotted for ${s.date} but linked to ${s.taskId}, not a retro-<date> item; no session started`);
  notify(`"${s.text}" is on your Daily Standard for ${pretty(s.date)}, but it's linked to a work item that isn't the current retro, so no session was started. Pick the retro from the list again, or start /retro yourself.`);
}

// Start one session for one retro item and record how it went. failKey counts the tries: a slot and the
// prep-ready start count apart, so three failed tries on Sunday night don't use up the tries of a Monday slot.
function start(taskId, { failKey, slot, name, prompt, ready, tonight = false }) {
  const tries = state.failed[failKey] || 0;
  if (tries >= MAX_TRIES) return;
  const sess = `retro-${taskId.slice(6)}`;
  const mark = tonight ? { tonight: true } : {};
  if (alive(sess)) { state.launched[taskId] = { slot, tmux: sess, at: new Date().toISOString(), adopted: true, ...mark }; save(); log(`adopted running ${sess}`); return; }
  let url = null;
  const sid = randomUUID();
  const transcript = transcriptPath(HOME, HOME, sid);
  try {
    tmux('new-session', '-d', '-s', sess, '-c', HOME, `${CLAUDE} --session-id ${sid} --remote-control ${sq(name)} ${sq(prompt)}`);
    for (let t = 0; t < WAIT_S && !url; t += 5) {
      sleep(5);
      if (!alive(sess)) break;
      url = linkFromTranscript(transcript) || (tmux('capture-pane', '-p', '-J', '-S', '-200', '-t', `=${sess}:`).match(LINK_ON_SCREEN) || [])[0] || null;
    }
  } catch (e) { log(`tmux error: ${e.message.split('\n')[0]}`); }
  if (url) {
    state.launched[taskId] = { slot, tmux: sess, url, at: new Date().toISOString(), ...mark };
    delete state.failed[failKey];
    save();
    log(`OK: launched ${sess} for ${slot} ${url}`);
    notify(ready(url));
  } else {
    if (alive(sess)) { try { tmux('kill-session', '-t', `=${sess}`); } catch {} }
    state.failed[failKey] = tries + 1;
    save();
    log(`FAIL: ${sess} did not come up with Remote Control (try ${tries + 1} of ${MAX_TRIES})`);
    if (tries === 0) notify(`The retro session for ${slot} failed to start. It will retry twice more; if it still fails, start /retro yourself. Log: ~/.claude/hooks/retro-launch.log`);
  }
}

for (const s of slotted.filter((x) => RETRO_ID.test(x.taskId))) {
  const was = state.launched[s.taskId];
  // A session started when the prep was ready that is still running is the session for the slot too. One that
  // is gone (the laptop restarted since Sunday night) is replaced, or the slot would open nothing.
  if (was && !(was.tonight && !alive(was.tmux))) continue;
  if (was) { delete state.launched[s.taskId]; save(); log(`${was.tmux}, started ${was.at} when the prep was ready, is gone; starting again for the slot`); }
  const slot = `${pretty(s.date)}, ${s.blocks.join(' + ')}`;
  const name = `Retro: ${slot} (slotted by Daniel)`;
  start(s.taskId, {
    failKey: s.taskId, slot, name,
    prompt: `/retro This session was opened automatically because Daniel put the weekly retro (work item ${s.taskId}) into his Daily Standard for ${slot}. Get ready now: find and read the latest prep doc, then open with the first part of the walk-through and stop there. Daniel joins when the slot comes; wait for him.`,
    ready: (url) => `Your retro session is ready for ${slot}. Open "${name}" in the Claude app, or ${url}`,
  });
}

// The prep is ready (normally Sunday about 18:20): start the session now, unless he already gave the retro a slot.
function tonightRequest() {
  if (!existsSync(TONIGHT)) return null;
  try {
    const r = JSON.parse(readFileSync(TONIGHT, 'utf8'));
    const age = Date.now() - Date.parse(r.at);
    return RETRO_ID.test(r.key || '') && age >= 0 && age < TONIGHT_MAX_H * 3600e3 ? r : null;
  } catch (e) {
    log(`WARN: ${TONIGHT} could not be read (${e.message.split('\n')[0]}); removed, no session started from it`);
    rmSync(TONIGHT, { force: true });
    return null;
  }
}
const req = tonightRequest();
if (req && !state.launched[req.key] && !slotted.some((s) => s.taskId === req.key)) {
  const d = new Date();
  const today = process.env.RETRO_TODAY || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const slot = `${pretty(today)}, prep ready`;
  const name = `Retro: ${slot}`;
  start(req.key, {
    failKey: `${req.key}/prep-ready`, slot, name, tonight: true,
    prompt: `/retro This session was opened automatically because the weekly retro prep is ready (work item ${req.key}). Daniel wants the retro on Sunday night when possible, so Monday starts with the week's outcomes set; it can move to Monday, or Tuesday at the latest. Get ready now: find and read the latest prep doc, then open with the first part of the walk-through and stop there. Daniel joins when he can; wait for him.`,
    ready: (url) => `Your retro session is ready. Open "${name}" in the Claude app, or ${url} . Tonight if you can; it waits for you through Tuesday.`,
  });
}
