#!/usr/bin/env node
// Cloud sessions -> vault (2026-11-21).
//
// Messages Daniel types into a cloud session (a run of a scheduled cloud task, such as the daily research brief)
// reached no sync: they are not claude.ai chats and have no transcript on the laptop. Daniel 2026-11-21: "the
// integration now needs to call the API to read and bring in cloud sessions yes close that gap."
//
// The only API that reads those runs from the laptop is Claude Code's built-in RemoteTrigger tool (list, list_runs,
// get_run_log), so a headless `claude -p` session makes the calls and this script does all the logic. It is a
// small state machine: `next` reads that session's own transcript, works out the next call still missing and prints
// it (CALL {...}); when nothing is missing it writes the notes and prints DONE. The model never parses anything.
//
//   node cloud-sessions.mjs next --sid <session uuid>      (or --transcript <file.jsonl> in tests)
//   node cloud-sessions.mjs status                         one line: last run, last ok, notes written
//
// Writes vault Sources/Cloud-Sessions/<date> <title> (<id>).md: Daniel's messages (**You**) with Claude's reply to
// each (**Claude**, as the run log shows it, possibly cut short), the same layout as Claude.ai notes so the thought
// scrub keeps only his turns. Runs on the laptop's own environment are skipped: their transcripts are already local.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const HOME = os.homedir();
const STATE_DIR = process.env.CS_STATE_DIR || `${HOME}/.claude/cloud-sessions`;
const VAULT = process.env.CS_VAULT || '/mnt/c/MCP';
const OUT_DIR = path.join(VAULT, 'Sources/Cloud-Sessions');
const PROJECTS = process.env.CS_PROJECTS || `${HOME}/.claude/projects`;
// Environments whose sessions run on this laptop (Remote Control): transcripts already in ~/.claude/projects.
const LOCAL_ENVS = new Set((process.env.CS_LOCAL_ENVS || 'env_01PitKygYTdQ5AwupGnNEKrF').split(',').filter(Boolean));
const MAX_PAGES = 8;          // run-log pages per run per pull (200 events each)
const MAX_AGE_DAYS = 45;      // runs older than this are not re-read
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const STATUS_FILE = path.join(STATE_DIR, 'status.json');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ---- transcript: RemoteTrigger calls made so far and their results ----
export function findTranscript(sid) {
  for (const d of fs.existsSync(PROJECTS) ? fs.readdirSync(PROJECTS) : []) {
    const f = path.join(PROJECTS, d, `${sid}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function resultText(content) {
  let t = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
  const saved = t.match(/<persisted-output>[\s\S]*?saved to: (\S+\.txt)/);
  if (saved && fs.existsSync(saved[1])) t = fs.readFileSync(saved[1], 'utf8');
  return t;
}

export function readCalls(transcriptFile) {
  const uses = new Map(), calls = [];
  for (const line of fs.readFileSync(transcriptFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    const content = e?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === 'tool_use' && b.name === 'RemoteTrigger') uses.set(b.id, b.input || {});
      if (b?.type === 'tool_result' && uses.has(b.tool_use_id)) calls.push({ input: uses.get(b.tool_use_id), text: resultText(b.content), error: !!b.is_error });
    }
  }
  return calls;
}

// First JSON object in a RemoteTrigger result ("HTTP 200\n{...}\n\n→ ..."); whatever follows it is ignored.
export function firstJSON(text) {
  const i = text.indexOf('{');
  if (i < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(text.slice(i, k + 1)); } catch { return null; } }
  }
  return null;
}

const sameCall = (a, b) => ['action', 'trigger_id', 'session_id', 'cursor'].every(k => (a[k] || '') === (b[k] || ''));
const okResult = (c) => !c.error && /^HTTP 2\d\d/.test(c.text.trim());

// ---- run log parsing ----
// Lines look like "[2026-11-19T00:55:49.958843Z] user: text". Subagent prompts and hand-backs also show as
// "user:", so they are told apart from Daniel's messages here.
export function parseRunLog(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(\d{4}-\d\d-\d\dT[^\]]+)\] ([^:]+?): (.*)$/);
    if (m) events.push({ ts: m[1], kind: m[2].replace(/ ERROR$/, ''), text: m[3] });
  }
  const header = firstJSON(text) || {};
  const more = /did not fit in this result/.test(text) || Boolean(header.next_cursor && header.events_fetched >= 200);
  return { events, nextCursor: header.next_cursor || null, more };
}

function agentPromptPrefixes(events) {
  const out = [];
  for (const e of events) {
    if (!/^tool_use (Agent|Task)$/.test(e.kind)) continue;
    const m = e.text.match(/"prompt":"((?:[^"\\]|\\.)*)/);
    if (m) { let p; try { p = JSON.parse(`"${m[1]}"`); } catch { p = m[1]; } out.push(norm(p).slice(0, 60)); }
  }
  return out.filter(p => p.length >= 20);
}

// Text the harness puts into a session as a "user" line; never Daniel's (first two seen in the 2026-11-21 dev run).
const INJECTED = ['Base directory for this skill', 'Being added to this conversation', '[Request interrupted',
  'This session is being continued', 'Caveat:', 'Continue from where you left off'];

// Daniel's messages in a run, each with the last Claude text that answered it.
export function extractExchanges(events, triggerPrompt = '') {
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const agentPrefixes = agentPromptPrefixes(sorted);
  const trig = norm(triggerPrompt).slice(0, 60);
  const isHuman = (e) => {
    if (e.kind !== 'user') return false;
    const t = norm(e.text);
    if (!t || t.startsWith('<') || INJECTED.some(p => t.startsWith(p))) return false;
    if (trig && t.startsWith(trig.slice(0, 40))) return false;
    if (agentPrefixes.some(p => t.startsWith(p.slice(0, 40)))) return false;
    return true;
  };
  const out = [];
  let cur = null;
  for (const e of sorted) {
    if (isHuman(e)) { cur = { ts: e.ts, text: e.text.trim(), reply: '', replyTs: '' }; out.push(cur); continue; }
    if (cur && e.kind === 'assistant' && norm(e.text) && norm(e.text) !== '[thinking]') { cur.reply = e.text.trim(); cur.replyTs = e.ts; }
  }
  return out;
}

// ---- notes ----
const sanitize = (s) => String(s).replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
export const noteName = (run) => `${(run.created_at || '').slice(0, 10)} ${sanitize(run.title || 'Cloud session')} (${run.id.slice(-6)}).md`;

export function renderNote(run, triggerName, exchanges, existing = '') {
  const updated = exchanges.reduce((m, x) => (x.replyTs > m ? x.replyTs : x.ts > m ? x.ts : m), '');
  const ours = {
    title: JSON.stringify(`${run.title || 'Cloud session'} (${(run.created_at || '').slice(0, 10)})`),
    created: JSON.stringify(run.created_at || ''),
    updated: JSON.stringify(updated),
    source: '"cloud-session"',
    source_id: JSON.stringify(run.id),
    trigger: JSON.stringify(triggerName || ''),
    url: JSON.stringify(run.url || ''),
  };
  // Keep frontmatter other jobs added (tags, reclassified, ...); ours wins for our own keys.
  const kept = [];
  const fm = existing.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    let skip = false;
    for (const l of fm[1].split('\n')) {
      const k = (l.match(/^([A-Za-z_][\w-]*):/) || [])[1];
      if (k) skip = k in ours;
      if (!skip) kept.push(l);
    }
  }
  if (!kept.some(l => /^tags:/.test(l))) kept.push('tags:', '  - "cloud-session"');
  const lines = ['---', ...Object.entries(ours).map(([k, v]) => `${k}: ${v}`), ...kept, '---', '',
    `# ${run.title || 'Cloud session'} (${(run.created_at || '').slice(0, 10)})`, '',
    `Messages Daniel typed into a run of the scheduled cloud task "${triggerName}", with Claude's reply to each as the run log shows it (replies can be cut short). Full session: ${run.url || run.id}`, '',
    '## Conversation', ''];
  const turns = [];
  for (const x of exchanges) {
    turns.push(`**You** _(${x.ts})_\n\n${x.text}`);
    if (x.reply) turns.push(`**Claude** _(${x.replyTs})_\n\n${x.reply}`);
  }
  return lines.join('\n') + turns.join('\n\n---\n\n') + '\n';
}

// ---- state machine ----
export function plan(calls, state, now = Date.now()) {
  const find = (want) => calls.findLast(c => sameCall(c.input, want) && okResult(c)); // the latest answer wins
  const failed = calls.filter(c => !okResult(c)).length;

  const list = find({ action: 'list' });
  if (!list) return { call: { action: 'list' } };
  const triggers = (firstJSON(list.text)?.data || []).filter(t => t.enabled !== false
    && !LOCAL_ENVS.has(t?.session_request?.environment_id || t?.job_config?.ccr?.environment_id || ''));

  const work = [];
  for (const t of triggers) {
    const lr = find({ action: 'list_runs', trigger_id: t.id });
    if (!lr) return { call: { action: 'list_runs', trigger_id: t.id } };
    for (const run of firstJSON(lr.text)?.data || []) {
      if (now - Date.parse(run.created_at) > MAX_AGE_DAYS * 864e5) continue;
      const seen = state.runs?.[run.id]?.last_event_at || '';
      if (run.last_event_at && run.last_event_at <= seen) continue;
      work.push({ trigger: t, run, seen });
    }
  }

  const ready = [];
  for (const w of work) {
    const pages = [];
    let want = { action: 'get_run_log', session_id: w.run.id };
    for (let p = 0; p < MAX_PAGES; p++) {
      const got = find(want);
      if (!got) return { call: want };
      const page = parseRunLog(got.text);
      pages.push(page);
      const oldest = page.events.reduce((m, e) => (!m || e.ts < m ? e.ts : m), '');
      if (!page.more || !page.nextCursor || (w.seen && oldest && oldest <= w.seen)) break;
      want = { action: 'get_run_log', session_id: w.run.id, cursor: page.nextCursor };
    }
    ready.push({ ...w, events: pages.flatMap(p => p.events) });
  }
  return { done: true, ready, triggers: triggers.length, failed };
}

export function apply(ready, state) {
  let notes = 0, messages = 0;
  state.runs = state.runs || {};
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const w of ready) {
    const prompt = w.trigger?.derived_state?.prompt || w.trigger?.job_config?.ccr?.events?.[0]?.data?.message?.content || '';
    const fresh = extractExchanges(w.events, prompt);
    const prev = state.runs[w.run.id] || {};
    const byKey = new Map((prev.exchanges || []).map(x => [x.ts + crypto.createHash('sha1').update(x.text).digest('hex').slice(0, 8), x]));
    for (const x of fresh) {
      const k = x.ts + crypto.createHash('sha1').update(x.text).digest('hex').slice(0, 8);
      const old = byKey.get(k);
      if (!old) messages++;
      byKey.set(k, { ...old, ...x, reply: x.reply || old?.reply || '', replyTs: x.replyTs || old?.replyTs || '' });
    }
    const exchanges = [...byKey.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    state.runs[w.run.id] = { trigger: w.trigger.id, title: w.run.title, last_event_at: w.run.last_event_at, exchanges };
    if (!exchanges.length) continue;
    const file = path.join(OUT_DIR, prev.file || noteName(w.run));
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const next = renderNote(w.run, w.trigger.name, exchanges, existing);
    if (next !== existing) { fs.writeFileSync(file, next); notes++; }
    state.runs[w.run.id].file = path.basename(file);
  }
  return { notes, messages };
}

function main() {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const s = readJSON(STATUS_FILE, null);
    console.log(s ? `cloud sessions: last run ${s.last_run}, last ok ${s.last_ok || 'never'}${s.last_error ? `, error: ${s.last_error}` : ''}; last pull ${s.notes} note(s), ${s.messages} new message(s)` : 'cloud sessions: never run');
    return;
  }
  if (cmd === 'fail') {
    writeJSON(STATUS_FILE, { ...readJSON(STATUS_FILE, {}), last_run: new Date().toISOString(), last_error: process.argv.slice(3).join(' ').slice(0, 300) });
    return;
  }
  if (cmd !== 'next') { console.error('usage: cloud-sessions.mjs next --sid <uuid> | --transcript <file>; cloud-sessions.mjs status'); process.exit(2); }
  const transcript = arg('--transcript') || (arg('--sid') && findTranscript(arg('--sid')));
  if (!transcript) { console.error('transcript not found'); process.exit(2); }
  const state = readJSON(STATE_FILE, { runs: {} });
  const p = plan(readCalls(transcript), state);
  if (p.call) { console.log('CALL ' + JSON.stringify(p.call)); return; }
  const r = apply(p.ready, state);
  writeJSON(STATE_FILE, state);
  const nowIso = new Date().toISOString();
  const status = { ...readJSON(STATUS_FILE, {}), last_run: nowIso, last_ok: nowIso, last_error: null, triggers: p.triggers, runs_read: p.ready.length, notes: r.notes, messages: r.messages };
  writeJSON(STATUS_FILE, status);
  console.log(`DONE ${p.triggers} cloud task(s), ${p.ready.length} run(s) read, ${r.messages} new message(s), ${r.notes} note(s) written`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
