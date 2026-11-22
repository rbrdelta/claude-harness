#!/usr/bin/env node
// Estimate of Daniel's own time in a session, from the words that passed between us (2026-11-21).
// Daniel: "I would just say estimate based on the proportion of input and response." The gaps between messages
// can't tell working from away; the words can. His time = (words of Claude's replies he read + words he wrote)
// / RATE. RATE was set from the 2026-11-21 ask session: about 6,600 words in and out against the 4.5 to 5 hours
// he put in (his own figure of 1h05m for the first round, 1,719 words, gives 26 a minute; the whole day gives 23).
//   session-time.mjs <transcript.jsonl> [--log <file>]
// Prints one line for Daniel. With --log, keeps one JSON line per session in that file (replaced on rerun),
// so sessions can be compared over time.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

export const RATE = 23; // words a minute, reading and writing together

const words = (s) => (s.match(/\S+/g) || []).length;
const strip = (s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
// The launcher's own opening prompt arrives as the first user message; it is not his writing.
const LAUNCHER = /^This session was opened automatically/;

export function count(jsonl) {
  let read = 0, wrote = 0, mine = 0, first = null, last = null;
  for (const line of jsonl.split('\n')) {
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (d.isMeta || d.isCompactSummary || d.isSidechain) continue;
    let c = d.message?.content;
    if (Array.isArray(c)) {
      if (d.type === 'user' && c.some((x) => x?.type === 'tool_result')) continue;
      c = c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ');
    }
    if (typeof c !== 'string' || !c.trim()) continue;
    const text = strip(c).trim();
    if (d.type === 'assistant') { read += words(text); continue; }
    if (LAUNCHER.test(text) || text.startsWith('<command-')) continue;
    wrote += words(text); mine += 1;
    first ??= d.timestamp; last = d.timestamp;
  }
  return { read, wrote, messages: mine, first, last, minutes: Math.round((read + wrote) / RATE) };
}

const fmt = (m) => (m < 60 ? `${m} minutes` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);
export const line = (r) =>
  `Your time this session, estimated: about ${fmt(r.minutes)} (you read ${r.read.toLocaleString('en-US')} words of mine and wrote ${r.wrote.toLocaleString('en-US')}, at ${RATE} words a minute, set from 2026-11-21's session).`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, flag, logFile] = process.argv.slice(2);
  if (!file || !existsSync(file)) { console.error('usage: session-time.mjs <transcript.jsonl> [--log <file>]'); process.exit(2); }
  const r = count(readFileSync(file, 'utf8'));
  console.log(line(r));
  if (flag === '--log' && logFile) {
    const session = basename(file, '.jsonl');
    const kept = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter((l) => l && !l.includes(`"session":"${session}"`)) : [];
    kept.push(JSON.stringify({ session, ...r, rate: RATE }));
    writeFileSync(logFile, kept.join('\n') + '\n');
  }
}
