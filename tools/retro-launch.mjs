#!/usr/bin/env node
// Retro launcher (Daniel, 2026-10-28). When Daniel puts the weekly retro into a block on the Daily Standard
// (a day priority picked from a retro-YYYY-MM-DD work item), start a laptop session for it right away: named for
// the slot, Remote Control on (so it shows in the Claude app and claude.ai/code), /retro already run up to the
// first question. He opens it when the slot comes; nothing to start by hand.
//   retro-launch.mjs    run every 5 minutes by retro-launch.timer (via triggers/retro-launch.sh). Idempotent:
//                       one session per retro item; moving it to another block opens no second one.
// Telegram says when a session is ready (with its link) or when a launch failed. Retro only, by design.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const HOME = process.env.HOME;
const DS = process.env.RETRO_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const NOTIFY = process.env.RETRO_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const LOG = process.env.RETRO_LOG || `${HOME}/.claude/hooks/retro-launch.log`;
const STATE = process.env.RETRO_LAUNCH_STATE || `${HOME}/.claude/hooks/retro-launch-state.json`;
const CLAUDE = process.env.RETRO_CLAUDE || 'claude';
const WAIT_S = Number(process.env.RETRO_WAIT_S ?? 90); // how long Remote Control gets to come up
const MAX_TRIES = 3;

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const notify = (m) => { try { execFileSync(NOTIFY, [m]); } catch { log('telegram send failed'); } };
const tmux = (...a) => execFileSync('tmux', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const alive = (s) => { try { tmux('has-session', '-t', `=${s}`); return true; } catch { return false; } };
const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (s) => execFileSync('sleep', [String(s)]);
const pretty = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { launched: {}, failed: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

let slotted;
try { slotted = JSON.parse(execFileSync(process.execPath, [DS, 'slotted', 'retro-', '--json'], { encoding: 'utf8' })); }
catch (e) { log(`FAIL: ds slotted: ${e.message.split('\n')[0]}`); process.exit(1); }

for (const s of slotted.filter((x) => /^retro-\d{4}-\d{2}-\d{2}$/.test(x.taskId))) {
  if (state.launched[s.taskId]) continue;
  const tries = state.failed[s.taskId] || 0;
  if (tries >= MAX_TRIES) continue;
  const slot = `${pretty(s.date)}, ${s.blocks.join(' + ')}`;
  const name = `Retro: ${slot} (slotted by Daniel)`;
  const sess = `retro-${s.taskId.slice(6)}`;
  if (alive(sess)) { state.launched[s.taskId] = { slot, tmux: sess, at: new Date().toISOString(), adopted: true }; save(); log(`adopted running ${sess}`); continue; }
  const prompt = `/retro This session was opened automatically because Daniel put the weekly retro (work item ${s.taskId}) into his Daily Standard for ${slot}. Get ready now: find and read the latest prep doc, then open with the first part of the walk-through and stop there. Daniel joins when the slot comes; wait for him.`;
  let url = null;
  try {
    tmux('new-session', '-d', '-s', sess, '-c', HOME, `${CLAUDE} --remote-control ${sq(name)} ${sq(prompt)}`);
    for (let t = 0; t < WAIT_S && !url; t += 5) {
      sleep(5);
      if (!alive(sess)) break;
      url = (tmux('capture-pane', '-p', '-J', '-S', '-200', '-t', `=${sess}`).match(/https:\/\/claude\.ai\/code\/session_\w+/) || [])[0] || null;
    }
  } catch (e) { log(`tmux error: ${e.message.split('\n')[0]}`); }
  if (url) {
    state.launched[s.taskId] = { slot, tmux: sess, url, at: new Date().toISOString() };
    delete state.failed[s.taskId];
    save();
    log(`OK: launched ${sess} for ${slot} ${url}`);
    notify(`Your retro session is ready for ${slot}. Open "${name}" in the Claude app, or ${url}`);
  } else {
    if (alive(sess)) { try { tmux('kill-session', '-t', `=${sess}`); } catch {} }
    state.failed[s.taskId] = tries + 1;
    save();
    log(`FAIL: ${sess} did not come up with Remote Control (try ${tries + 1} of ${MAX_TRIES})`);
    if (tries === 0) notify(`The retro session for ${slot} failed to start. It will retry twice more; if it still fails, start /retro yourself. Log: ~/.claude/hooks/retro-launch.log`);
  }
}
