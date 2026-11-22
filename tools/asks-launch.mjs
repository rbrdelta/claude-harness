#!/usr/bin/env node
// Ask session launcher (Daniel, 2026-11-19). Questions and hand-offs Claude needs from Daniel are not work
// items; they live as asks in the Daily Standard database (ds ask-add). Daniel: "If I'm not in a session with
// you about a given topic, you can start one session max per day with a list that we need to burn down. These
// are quick decisions ... and decisions that require me to actually sit down and provide input."
//   asks-launch.mjs   run by asks-launch.timer (via triggers/asks-launch.sh) a few times each morning. Idempotent:
//                     at most one session a day, recorded in the database (ds ask-session), and none when no ask
//                     is open. Starts a laptop session with Remote Control, already holding the list, and sends
//                     Daniel the link on Telegram. Yesterday's unopened ask session is closed first, so one waits.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { transcriptPath, linkFromTranscript, LINK_ON_SCREEN } from './rc-link.mjs';

const HOME = process.env.HOME;
const DS = process.env.ASKS_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const NOTIFY = process.env.ASKS_NOTIFY || `${HOME}/projects/active/claude-harness/tools/telegram-notify.sh`;
const LOG = process.env.ASKS_LOG || `${HOME}/.claude/hooks/asks-launch.log`;
const STATE = process.env.ASKS_LAUNCH_STATE || `${HOME}/.claude/hooks/asks-launch-state.json`;
const CLAUDE = process.env.ASKS_CLAUDE || 'claude';
const WAIT_S = Number(process.env.ASKS_WAIT_S ?? 90);
const MAX_TRIES = 3;
const TRANSIENT = /fetch failed|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT/;

const log = (m) => appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const notify = (m) => { try { execFileSync(NOTIFY, [m]); } catch { log('telegram send failed'); } };
const tmux = (...a) => execFileSync('tmux', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const alive = (s) => { try { tmux('has-session', '-t', `=${s}`); return true; } catch { return false; } };
const sessions = () => { try { return tmux('list-sessions', '-F', '#{session_name}').split('\n').filter(Boolean); } catch { return []; } };
const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (s) => execFileSync('sleep', [String(s)]);
const pretty = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function ds(...args) {
  for (let attempt = 1; ; attempt++) {
    try { return execFileSync(process.execPath, [DS, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) {
      const err = (String(e.stderr || '').trim() || e.message).replace(/\s*\n\s*/g, ' | ');
      if (attempt >= 3 || !TRANSIENT.test(err)) { log(`FAIL: ds ${args[0]} (try ${attempt} of 3): ${err}`); process.exit(1); }
      log(`RETRY: ds ${args[0]} try ${attempt} of 3 could not connect (${err.match(TRANSIENT)[0]})`);
      sleep(Number(process.env.ASKS_DS_WAIT_S ?? 15));
    }
  }
}

const check = JSON.parse(ds('ask-session', '--check'));
const day = check.date;
if (check.today) process.exit(0);
if (!check.open) { log(`${day}: no open asks, no session`); process.exit(0); }

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { failed: {} };
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const tries = state.failed[day] || 0;
if (tries >= MAX_TRIES) process.exit(0);

const asks = JSON.parse(ds('asks', '--json'));
const quick = asks.filter((a) => a.kind === 'quick').length;
const input = asks.length - quick;
const sess = `asks-${day}`;
// One ask session waits at a time: an earlier day's that is still running is closed (its asks carry to today's list).
for (const s of sessions()) if (/^asks-\d{4}-\d{2}-\d{2}$/.test(s) && s !== sess) { try { tmux('kill-session', '-t', `=${s}`); log(`closed earlier ${s}`); } catch {} }

const name = `Asks: ${pretty(day)} (${quick} quick, ${input} need your input)`;
const prompt = [
  `This session was opened automatically: ${asks.length} ask(s) are waiting on Daniel, things Claude needs from him to unlock work.`,
  `Daniel, 2026-11-19: "you can start one session max per day with a list that we need to burn down. These are quick decisions ... and decisions that require me to actually sit down and provide input."`,
  `Get ready now, then stop and wait for him. 1) Run node ${DS} asks. 2) For each ask, first search what he already said (his CLAUDE.md rule 19: the project's files, the vault, earlier sessions); if the answer is on file, run ds ask-drop <id> "on file: <where>" and do not ask it.`,
  `3) Open with the list, quick ones first: one line each, "I need <answer> to unlock <work>", with your recommendation so a quick one takes a yes or no. Then the ones that need his input: what you need from him and about how long it takes. Plain words, no ids in what he reads.`,
  `When he answers, record it in his words: node ${DS} ask-close <id> "<his answer>" --daily, and set the unlocked work item's next step. Anything he defers stays open for tomorrow's list.`,
  `His time is the measure (2026-11-21: one ask session took about 5 to 6 hours of his time, about 2.5 of them on nine rounds of one email; a 15-20 minute gap between messages is him reading, thinking and writing, not idle). Aim for 15 minutes of his time. Keep every reply short: answer what he asked, nothing else. When the list is done, or at about 15 minutes, say so and close.`,
  `Do the unlocked work after he is done, not with him in the session. Work that goes out under his name or needs his review (an email, an application answer, a page) comes back to him once, finished: first read /mnt/c/MCP/Meta/Voice — writing samples.md including "From his edits", pick the strongest example from the record yourself (never ask him for one), check every fact, and reread every sentence in his style. He gets one review round. If it misses, record his correction in "From his edits", redo it on your own, and put it on tomorrow's list instead of another round today.`,
  `Before he leaves, run node ${DS} ask-stats and tell him the two numbers in one line each.`,
].join(' ');

let url = null;
const sid = randomUUID();
const transcript = transcriptPath(HOME, HOME, sid);
try {
  if (!alive(sess)) tmux('new-session', '-d', '-s', sess, '-c', HOME, `${CLAUDE} --session-id ${sid} --remote-control ${sq(name)} ${sq(prompt)}`);
  for (let t = 0; t < WAIT_S && !url; t += 5) {
    sleep(5);
    if (!alive(sess)) break;
    url = linkFromTranscript(transcript) || (tmux('capture-pane', '-p', '-J', '-S', '-200', '-t', `=${sess}:`).match(LINK_ON_SCREEN) || [])[0] || null;
  }
} catch (e) { log(`tmux error: ${e.message.split('\n')[0]}`); }

if (url) {
  ds('ask-session', '--url', url);
  delete state.failed[day];
  save();
  log(`OK: launched ${sess} with ${asks.length} ask(s) ${url}`);
  notify(`${asks.length} things need you today: ${quick} quick yes-or-no, ${input} that need your input. The session is ready: open "${name}" in the Claude app, or ${url}`);
} else {
  if (alive(sess)) { try { tmux('kill-session', '-t', `=${sess}`); } catch {} }
  state.failed[day] = tries + 1;
  save();
  log(`FAIL: ${sess} did not come up with Remote Control (try ${tries + 1} of ${MAX_TRIES})`);
  if (tries + 1 === MAX_TRIES) notify(`Today's ask session (${asks.length} things that need you) failed to start three times. Log: ~/.claude/hooks/asks-launch.log`);
}
