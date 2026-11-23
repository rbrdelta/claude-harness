#!/usr/bin/env node
// Intake pipeline (2026-11-21): everything Daniel captured goes through one router and every piece gets a recorded
// outcome. Design, his decisions and the gold sets: vault Inbox/Intake pipeline — design and gold set.md.
//
// The router (an Opus pass, triggers/intake/prompt.md) only proposes routes. This script does everything
// deterministic around it:
//   prepare <bundle.json> <dir>       items.json (ids, secrets redacted) + context.json (work items, asks, recent outcomes)
//   check <dir>                       validate routes.json against items.json -> checked.json; nothing is ever dropped:
//                                     an item the router skipped or a quote that is not his exact words is flagged
//   record <dir> [--mode preview]     append to ~/.claude/intake/outcomes.jsonl and rewrite the vault note
//                                     Inbox/Intake — outcomes.md (what happened to each piece, last 14 days)
//   sheet [--days 7] [--n 30]         a gold-set sheet to grade: every routed item, then a sample of the "no action" ones
//
// Preview mode (until Daniel signs off): outcomes are recorded and shown, nothing is written to the backlog or asks.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const HOME = os.homedir();
const STATE = process.env.INTAKE_STATE || `${HOME}/.claude/intake`;
const VAULT = process.env.INTAKE_VAULT || '/mnt/c/MCP';
const DS = process.env.INTAKE_DS || `${HOME}/projects/active/daily-standard/scripts/ds.mjs`;
const OUTCOMES = path.join(STATE, 'outcomes.jsonl');
const NOTE = path.join(VAULT, 'Inbox', 'Intake — outcomes.md');
const ROUTES = { A: 'Build idea', B: 'To-do', C: 'Decision or rule', D: 'Open question', E: 'Idea or view', F: 'Project notes', G: 'Handled in the moment', H: 'Nothing to act on' };
const DAY = 864e5;

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
const norm = (s) => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

// ---- secrets never leave intake ----
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g, /\bAQ\.[A-Za-z0-9_-]{20,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g, /\b(?:api[_ -]?key|token|secret|password)\s*(?:is|:|=)\s*\S{12,}/gi,
];
export function redact(text) {
  let out = String(text || ''), hit = false;
  for (const re of SECRET_PATTERNS) out = out.replace(re, () => { hit = true; return '[secret removed]'; });
  return { text: out, hit };
}

// ---- prepare ----
export function prepareItems(bundle, date) {
  return bundle.map((x, i) => {
    const r = redact(x.text);
    return { id: `${date}#${i + 1}`, source: x.source, where: x.where, written: x.written, text: r.text, ...(r.hit ? { secret_removed: true } : {}) };
  });
}

function ds(args) {
  try { return JSON.parse(execFileSync('node', [DS, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 })); } catch { return null; }
}

export function recentOutcomes(now = Date.now(), days = 14) {
  if (!fs.existsSync(OUTCOMES)) return [];
  return fs.readFileSync(OUTCOMES, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(o => o && now - Date.parse(o.recorded_at) < days * DAY);
}

function buildContext(now = Date.now()) {
  const backlog = ds(['backlog', '--json']);
  const items = (Array.isArray(backlog) ? backlog : backlog?.tasks || backlog?.items || [])
    .filter(t => t.status !== 'dropped')
    .map(t => ({ id: t.id, status: t.status, project: t.project, owner: t.owner, title: t.text, next: t.next || '' }));
  const asks = (ds(['asks', '--json']) || []).map(a => ({ id: a.id, text: a.text, status: a.status }));
  const outcomes = recentOutcomes(now).filter(o => !o.routes.every(r => r === 'G'))
    .map(o => ({ date: o.recorded_at.slice(0, 10), where: o.where, routes: o.routes, title: o.title, exists: o.exists || '' }));
  return { work_items: items, open_asks: asks, recent_outcomes: outcomes };
}

// ---- check ----
export function checkRoutes(items, routes, context = null, gcheck = null, evidence = null) {
  const known = context ? new Set([...(context.work_items || []).map(t => t.id), ...(context.open_asks || []).map(x => x.id)]) : null;
  const gby = new Map((Array.isArray(gcheck) ? gcheck : []).map(g => [g.id, g]));
  const noRecord = new Set((Array.isArray(evidence) ? evidence : []).filter(e => !e.what_happened_after).map(e => e.id));
  const byId = new Map(items.map(i => [i.id, i]));
  const out = [], problems = [];
  for (let r of Array.isArray(routes) ? routes : []) {
    const item = byId.get(r.id);
    if (!item) { problems.push(`unknown id ${r.id}`); continue; }
    let rs = (Array.isArray(r.routes) ? r.routes : [r.routes]).map(x => String(x || '').trim().toUpperCase()).filter(x => ROUTES[x]);
    const flags = [...new Set(r.flags || [])];
    if (!rs.length) { rs = ['H']; flags.push('router gave no valid route'); problems.push(`${r.id}: no valid route`); }
    let quote = redact(r.quote || '').text;
    if (flags.includes('personal') || flags.includes('secret')) quote = '';
    if (quote && !norm(item.text).includes(norm(quote).replace(/\s*(\.\.\.|…)\s*$/, ''))) {
      flags.push('quote not his exact words'); problems.push(`${r.id}: quote not verbatim`);
      quote = '';
    }
    if (item.secret_removed && !flags.includes('secret')) flags.push('secret');
    // "On file" must point at something that exists (round 2, rule 11).
    const cited = String(r.exists || '').match(/\b[0-9a-f]{12}\b/g) || [];
    if (known && cited.some(id => !known.has(id))) { flags.push('on-file id not found'); problems.push(`${r.id}: cites ${cited.filter(id => !known.has(id)).join(', ')} not in context`); }
    // G is a claim only the session record can prove (round 2, rule 10): unproven is raised, never dropped.
    // A question answered or decided in the moment is not open: nothing to place (11/22).
    if (gcheck && rs.length === 1 && rs[0] === 'D' && gby.get(r.id)?.confirmed === 'yes') {
      rs = ['G']; flags.push(`answered or decided in the moment: ${redact(gby.get(r.id).note || '').text.slice(0, 160)}`);
    } else if (gcheck && rs.length === 1 && rs[0] === 'G') {
      const g = gby.get(r.id);
      if (!g || g.confirmed !== 'yes') {
        // No record found is not proof it was missed: Claude chases it, it never goes to Daniel (11/22: repeat noise).
        const to = noRecord.has(r.id) ? 'B' : (g && /^[A-F]$/.test(String(g.route_if_not || ''))) ? g.route_if_not : 'B';
        if (noRecord.has(r.id)) flags.push('no session record found');
        rs = [to];
        flags.push(g ? `not confirmed done (${g.confirmed}): ${redact(g.note || '').text.slice(0, 160)}` : 'not confirmed done: no session record found');
        if (to === 'B') r = { ...r, owner: 'Claude', title: `Check it was done: ${String(r.title || '').replace(/^Check it was done: /, '')}` };
      }
    }
    out.push({ id: r.id, source: item.source, where: item.where, written: item.written, routes: rs.slice(0, 2),
      ...(r.kind ? { kind: r.kind } : {}), ...(r.bundle ? { bundle: r.bundle } : {}),
      title: redact(r.title || '').text.slice(0, 120), quote: quote.slice(0, 400), where_to: r.where_to || '', owner: r.owner || '',
      exists: r.exists || '', reason: redact(r.reason || '').text, flags });
  }
  const seen = new Set(out.map(o => o.id));
  for (const it of items) {
    if (seen.has(it.id)) continue;
    // Never a silent drop: an item the router skipped is recorded as needing a look.
    out.push({ id: it.id, source: it.source, where: it.where, written: it.written, routes: ['H'], title: `(no outcome from the router) ${it.where}`,
      quote: '', where_to: '', owner: '', exists: '', reason: 'The router returned nothing for this item; it needs a look.', flags: ['missed by router'] });
    problems.push(`${it.id}: missed by router`);
  }
  return { outcomes: out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), problems };
}

// ---- G evidence: what actually happened right after his message ----
const PROJECTS = process.env.INTAKE_PROJECTS || `${HOME}/.claude/projects`;
const clip = (t, n) => (t.length > n ? t.slice(0, n) + ' …' : t);

function sessionFile(id8) {
  if (!id8 || !fs.existsSync(PROJECTS)) return null;
  for (const d of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, d);
    let names; try { names = fs.readdirSync(dir); } catch { continue; }
    const f = names.find(n => n.startsWith(id8) && n.endsWith('.jsonl'));
    if (f) return path.join(dir, f);
  }
  return null;
}

const humanText = (d) => {
  if (d.type !== 'user' || d.toolUseResult || d.isMeta) return null;
  const c = d.message?.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
  return t && !t.trimStart().startsWith('<') ? t : null;
};

function recentSessionFiles(written) {
  const day = Date.parse(written || '') || Date.now();
  const out = [];
  if (!fs.existsSync(PROJECTS)) return out;
  for (const d of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, d);
    let names; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const f = path.join(dir, n);
      try { const m = fs.statSync(f).mtimeMs; if (m >= day - DAY && m <= day + 4 * DAY) out.push(f); } catch {}
    }
  }
  return out;
}

// The assistant's text and actions after his message, until his next message.
export function afterInSession(file, text, cap = 6000) {
  const want = norm(text).slice(0, 80);
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const start = rows.findIndex(d => { const t = humanText(d); return t && norm(t).startsWith(want.slice(0, 60)); });
  if (start < 0) return null;
  const out = [];
  for (const d of rows.slice(start + 1)) {
    if (humanText(d) && (d.origin?.kind === 'human' || !d.origin)) break;
    for (const b of (d.type === 'assistant' && Array.isArray(d.message?.content)) ? d.message.content : []) {
      if (b.type === 'text' && b.text.trim()) out.push(b.text.trim());
      if (b.type === 'tool_use') out.push(`[${b.name}: ${clip(norm(b.input?.description || b.input?.command || b.input?.file_path || b.input?.action || ''), 120)}]`);
    }
  }
  return clip(out.join('\n'), cap);
}

// The reply after his turn in a Claude.ai or cloud-session note (same **You** / **Claude** layout).
export function afterInNote(file, text, cap = 6000) {
  if (!fs.existsSync(file)) return null;
  const turns = fs.readFileSync(file, 'utf8').split(/\n---\n/);
  const want = norm(text).slice(0, 60);
  const i = turns.findIndex(t => /\*\*You\*\*/.test(t) && norm(t).includes(want));
  if (i < 0) return null;
  const reply = turns.slice(i + 1).find(t => /\*\*Claude\*\*/.test(t));
  return reply ? clip(reply.trim(), cap) : null;
}

export function gatherEvidence(items, outcomes) {
  const byId = new Map(items.map(i => [i.id, i]));
  // G claims and D questions: was it done, answered or decided in the moment? (11/22: a decided question came back)
  return outcomes.filter(o => o.routes.length === 1 && (o.routes[0] === 'G' || o.routes[0] === 'D')).map(o => {
    const it = byId.get(o.id) || {};
    let after = null;
    if (it.source === 'Claude Code') {
      const f = sessionFile((String(it.where).match(/session ([0-9a-f]{8})/) || [])[1]);
      if (f) after = afterInSession(f, it.text);
      // A session continued after a context reset keeps its turns in another file: look there too.
      if (!after) for (const g of recentSessionFiles(it.written)) { if (g === f) continue; after = afterInSession(g, it.text); if (after) break; }
    } else if (it.source === 'Claude.ai') {
      after = afterInNote(path.join(VAULT, 'Sources/Claude-Conversations', `${it.where}.md`), it.text);
    } else if (it.source === 'Cloud session') {
      after = afterInNote(path.join(VAULT, 'Sources/Cloud-Sessions', `${it.where}.md`), it.text);
    } else if (it.source === 'Phone Notes') {
      const done = String(it.text).split('\n').filter(l => /── Claude, (done|question)/.test(l));
      after = done.length ? done.join('\n') : null;
    }
    return { id: o.id, claim: o.routes[0] === 'G' ? 'handled in the moment' : 'open question', source: it.source, his_words: clip(it.text || '', 1500), router_said: o.reason, what_happened_after: after };
  });
}

// ---- record ----
export function renderOutcomesNote(all, now = Date.now()) {
  const recent = all.filter(o => now - Date.parse(o.recorded_at) < 14 * DAY);
  const byDate = new Map();
  for (const o of recent) { const d = String(o.id).split('#')[0] || o.recorded_at.slice(0, 10); /* the bundle's day, not the run's */ if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(o); }
  const lines = ['---', `updated: "${new Date(now).toISOString()}"`, 'tags: [harness, intake-pipeline]', '---', '',
    '# Intake — outcomes', '',
    'What happened to each piece Daniel captured: one line per piece, last 14 days, newest first. Written by the intake pipeline (claude-harness `triggers/intake/run.sh`). While the mode says preview, nothing was written anywhere: these are proposals.', '',
    'Routes: ' + Object.entries(ROUTES).map(([k, v]) => `${k} ${v}`).join(' · '), ''];
  for (const d of [...byDate.keys()].sort().reverse()) {
    const os_ = byDate.get(d);
    const raised = os_.filter(o => !o.routes.every(r => r === 'G' || r === 'H'));
    lines.push(`## ${d} (${os_[0].mode}): ${os_.length} pieces, ${raised.length} routed, ${os_.length - raised.length} no action`, '');
    for (const o of [...raised, ...os_.filter(o => !raised.includes(o))]) {
      const tag = o.routes.join('+');
      const extra = [o.kind, o.bundle && `bundle: ${o.bundle}`, o.where_to && `to: ${o.where_to}`, o.owner === 'Claude' && 'Claude does it', o.exists && `on file: ${o.exists}`, o.flags?.length && `flags: ${o.flags.join(', ')}`].filter(Boolean).join('; ');
      lines.push(`- **${tag}** ${o.title} (${o.source}, ${o.where})${extra ? ` [${extra}]` : ''}`);
      if (o.quote) lines.push(`  > ${o.quote.replace(/\n+/g, ' ')}`);
      lines.push(`  why: ${o.reason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function record(dir, mode) {
  const checked = readJSON(path.join(dir, 'checked.json'), null);
  if (!checked) throw new Error('no checked.json');
  const at = new Date().toISOString();
  fs.mkdirSync(STATE, { recursive: true });
  fs.appendFileSync(OUTCOMES, checked.outcomes.map(o => JSON.stringify({ ...o, mode, recorded_at: at })).join('\n') + '\n');
  const all = fs.readFileSync(OUTCOMES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  fs.mkdirSync(path.dirname(NOTE), { recursive: true });
  fs.writeFileSync(NOTE, renderOutcomesNote(all));
  // Corrections the router spotted in his words feed the kill-signal count (deduped by piece id).
  const logged = new Set(fs.existsSync(CORRECTIONS) ? fs.readFileSync(CORRECTIONS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id).filter(Boolean) : []);
  for (const o of checked.outcomes) {
    const c = (o.flags || []).find(f => /^correction:(repeat|drop|label)$/.test(f));
    if (c && !logged.has(o.id)) fs.appendFileSync(CORRECTIONS, JSON.stringify({ at, kind: c.split(':')[1], what: o.title, words: o.quote || '', id: o.id }) + '\n');
  }
  const n = (k) => checked.outcomes.filter(o => o.routes.includes(k)).length;
  return `${checked.outcomes.length} pieces: ` + Object.keys(ROUTES).map(k => `${k} ${n(k)}`).join(', ') + `; ${checked.problems.length} problem(s)`;
}

// ---- apply: put each routed piece where it belongs (live mode) ----
// Daniel 11/22: "all of the things in review are not showing up in my daily standard so it feels like important
// priorities are left out." Individual items only for what is real work: build ideas (unranked, with a quick
// "plan now or later?" ask), to-dos, questions Claude answers. Claude's own follow-ups (rules to record, notes to
// file, "check it was done") go into ONE Claude item per day so his list stays clean. Ideas (E) already reach the
// retro review through the thought scrub. G and H are recorded only. Idempotent: applied.json remembers what was made.
const APPLIED = path.join(STATE, 'applied.json');
function dsRun(args) {
  return execFileSync('node', [DS, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
}
const madeId = (out) => (out.match(/\b(?:incoming|asked|added|ask)\s+([0-9a-z-]{6,})/) || out.match(/\b([0-9a-f]{12})\b/) || [])[1] || '';

// Daniel's gold-set grades override the router for the pieces he graded (~/.claude/intake/overrides.json, {id: route}).
// recheckBefore (YYYY-MM-DD, backfill only): pieces from earlier days may have been done since, so their items and asks
// become "check still needed" follow-ups for Claude instead of landing on his list.
export function planApply(outcomes, overrides = {}, recheckBefore = '') {
  const items = [], asks = [], daily = new Map();
  const live = outcomes.filter(o => !String(o.mode || '').startsWith('baseline'));
  const bundles = new Map();
  for (const o0 of live) {
    const o = overrides[o0.id] ? { ...o0, routes: [overrides[o0.id]] } : o0;
    const r = o.routes[0], day = String(o.id).split('#')[0];
    const his = o.quote ? ` His words: "${o.quote}".` : '';
    const src = `${o.source}, ${o.where}, ${o.written}`;
    const followUp = (what) => { if (!daily.has(day)) daily.set(day, []); daily.get(day).push(`${what}: ${o.title}${o.where_to ? ` (to: ${o.where_to})` : ''}.${his} [${o.id}]`); };
    if (o.flags.includes('missed by router')) { followUp('Route by hand (the router gave no outcome)'); continue; }
    if (/^Check it was done/.test(o.title)) { followUp('Check it was done'); continue; }
    if (o.exists && ['A', 'B', 'D'].includes(r)) continue; // on file: nothing new
    if (recheckBefore && day < recheckBefore && ['A', 'B', 'D'].includes(r)) { followUp(`Check still needed (${({ A: 'build idea', B: 'to-do', D: 'question' })[r]}), then place it`); continue; }
    if (r === 'A') {
      items.push({ key: `${o.id}:A`, text: `Build idea: ${o.title}`, owner: 'Daniel', project: o.where_to || '',
        detail: `Build idea, unranked until Daniel says plan it now or later (the quick ask that comes with it).${his} From ${src}. ${o.reason}`,
        ask: { text: `Plan this build idea now or later? ${o.title}`, kind: 'quick', unlocks: `Build idea: ${o.title}` } });
    } else if (r === 'B') {
      items.push({ key: `${o.id}:B`, text: o.title, owner: o.owner === 'Claude' ? 'Claude' : 'Daniel', project: o.where_to || '', detail: `${o.reason}${his} From ${src}.` });
    } else if (r === 'D' && o.kind === 'introspection') {
      asks.push({ key: `${o.id}:D`, text: `Yours to think through: ${o.title}`, kind: 'input', unlocks: o.where_to || 'your own read', his });
    } else if (r === 'D') {
      const b = o.bundle || o.id;
      if (!bundles.has(b)) bundles.set(b, []);
      bundles.get(b).push(o);
    } else if (r === 'C') followUp('Record the rule');
    else if (r === 'F') followUp('File in project notes');
  }
  for (const [b, os] of bundles) {
    items.push({ key: `D:${b}:${os.map(o => o.id).join(',')}`, text: `Answer: ${os.length > 1 ? b : os[0].title}`, owner: 'Claude', project: os[0].where_to || '',
      detail: `Find the answer and bring it to the daily session (Daniel 11/21: "just bring the answer to me"). Questions: ${os.map(o => `${o.title}${o.quote ? ` ("${o.quote}")` : ''} [${o.id}]`).join('; ')}` });
  }
  if (process.env.INTAKE_ONE_FOLLOWUP && daily.size > 1) { // backfill: one follow-up item for the whole span
    const days = [...daily.keys()].sort(), all = days.flatMap(d => daily.get(d).map(l => `${d}: ${l}`));
    daily.clear(); daily.set(`${days[0]} to ${days[days.length - 1]}`, all);
  }
  for (const [day, lines] of daily) {
    items.push({ key: `daily:${day}:${lines.length}`, text: `Intake follow-ups from ${day} (${lines.length})`, owner: 'Claude', project: 'Claude Harness',
      detail: `Claude's own follow-ups the intake pipeline found in what Daniel wrote on ${day}. Never his to do.\n- ${lines.join('\n- ')}` });
  }
  return { items, asks };
}

function apply(dir) {
  const checked = readJSON(path.join(dir, 'checked.json'), null);
  if (!checked) throw new Error('no checked.json');
  const done = readJSON(APPLIED, {});
  const { items, asks } = planApply(checked.outcomes, readJSON(path.join(STATE, 'overrides.json'), {}), process.env.INTAKE_RECHECK_BEFORE || '');
  let made = 0, askd = 0;
  for (const it of items) {
    if (done[it.key]) continue;
    const out = dsRun(['incoming-add', it.text.slice(0, 120), '--detail', it.detail.slice(0, 3500), '--from', `intake ${it.key}`, ...(it.project ? ['--project', it.project.slice(0, 60)] : [])]);
    const id = madeId(out);
    if (!id) throw new Error(`incoming-add gave no id: ${out}`);
    if (it.owner === 'Claude') dsRun(['task-set', id, 'owner=Claude']);
    done[it.key] = { id, at: new Date().toISOString() }; made++;
    if (it.ask) {
      const a = dsRun(['ask-add', it.ask.text.slice(0, 200), '--unlocks', it.ask.unlocks.slice(0, 120), '--kind', it.ask.kind, '--task', id, '--from', 'intake']);
      done[it.key].ask = madeId(a); askd++;
    }
    writeJSON(APPLIED, done);
  }
  for (const a of asks) {
    if (done[a.key]) continue;
    const out = dsRun(['ask-add', a.text.slice(0, 200), '--unlocks', a.unlocks.slice(0, 120), '--kind', a.kind, '--from', 'intake']);
    done[a.key] = { ask: madeId(out), at: new Date().toISOString() }; askd++;
    writeJSON(APPLIED, done);
  }
  return `${made} item(s), ${askd} ask(s) placed`;
}

// ---- corrections: Daniel's kill signal, counted (11/22: "How do we track these? This is a red flag.") ----
// kind: repeat (a decided or closed thing raised again), drop (a real thing missed), label (put in the wrong place).
const CORRECTIONS = path.join(STATE, 'corrections.jsonl');
export function correctionsSummary(rows, now = Date.now()) {
  const weeks = new Map();
  for (const r of rows) {
    const d = new Date(r.at); const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = monday.toISOString().slice(0, 10);
    if (!weeks.has(k)) weeks.set(k, { repeat: 0, drop: 0, label: 0 });
    weeks.get(k)[r.kind] = (weeks.get(k)[r.kind] || 0) + 1;
  }
  return [...weeks.entries()].sort().map(([w, c]) => `week of ${w}: ${c.repeat} repeat, ${c.drop} drop, ${c.label} label (total ${c.repeat + c.drop + c.label})`);
}

// ---- gold-set sheet ----
export function sampleSheet(all, n = 30, seed = 1) {
  let s = seed; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const seen = new Set();
  const uniq = all.filter(o => { const k = o.id + o.title; if (seen.has(k)) return false; seen.add(k); return true; });
  const routed = uniq.filter(o => !o.routes.every(r => r === 'G' || r === 'H'));
  const quiet = uniq.filter(o => o.routes.every(r => r === 'G' || r === 'H'));
  const pick = (arr, k) => { const a = [...arr]; const out = []; while (a.length && out.length < k) out.push(a.splice(Math.floor(rand() * a.length), 1)[0]); return out; };
  const nQuiet = Math.min(quiet.length, Math.max(10, n - routed.length));
  const chosen = [...pick(routed, n - nQuiet), ...pick(quiet, nQuiet)];
  return chosen.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
  if (cmd === 'prepare') {
    const [bundleFile, dir] = rest;
    const date = (path.basename(bundleFile).match(/\d{4}-\d\d-\d\d/) || [new Date().toISOString().slice(0, 10)])[0];
    const items = prepareItems(readJSON(bundleFile, []), date);
    writeJSON(path.join(dir, 'items.json'), items);
    writeJSON(path.join(dir, 'context.json'), buildContext());
    console.log(`${items.length} items`);
  } else if (cmd === 'evidence') {
    const [dir] = rest;
    const items = readJSON(path.join(dir, 'items.json'), []);
    const routes = readJSON(path.join(dir, 'routes.json'), null);
    if (!Array.isArray(routes)) { console.error('routes.json missing or not a JSON array'); process.exit(1); }
    const ev = gatherEvidence(items, checkRoutes(items, routes).outcomes);
    writeJSON(path.join(dir, 'evidence.json'), ev);
    console.log(`${ev.length} G pieces, ${ev.filter(e => e.what_happened_after).length} with a record of what happened`);
  } else if (cmd === 'check') {
    const [dir] = rest;
    const items = readJSON(path.join(dir, 'items.json'), []);
    const routes = readJSON(path.join(dir, 'routes.json'), null);
    if (!Array.isArray(routes)) { console.error('routes.json missing or not a JSON array'); process.exit(1); }
    const c = checkRoutes(items, routes, readJSON(path.join(dir, 'context.json'), null), readJSON(path.join(dir, 'gcheck.json'), fs.existsSync(path.join(dir, 'evidence.json')) ? [] : null), readJSON(path.join(dir, 'evidence.json'), null));
    writeJSON(path.join(dir, 'checked.json'), c);
    console.log(`${c.outcomes.length} outcomes; problems: ${c.problems.length ? c.problems.join('; ') : 'none'}`);
  } else if (cmd === 'record') {
    console.log(record(rest[0], flag('--mode', 'preview')));
  } else if (cmd === 'correction') {
    const [kind, what, words] = rest;
    if (!['repeat', 'drop', 'label'].includes(kind) || !what) { console.error('usage: intake.mjs correction repeat|drop|label "<what happened>" "<his words>"'); process.exit(2); }
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(CORRECTIONS, JSON.stringify({ at: new Date().toISOString(), kind, what, words: words || '' }) + '\n');
    console.log(`recorded ${kind}`);
  } else if (cmd === 'corrections') {
    const rows = fs.existsSync(CORRECTIONS) ? fs.readFileSync(CORRECTIONS, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    console.log(rows.length ? correctionsSummary(rows).join('\n') : 'no corrections recorded');
  } else if (cmd === 'apply') {
    console.log(apply(rest[0]));
  } else if (cmd === 'sheet') {
    const days = Number(flag('--days', 7)), n = Number(flag('--n', 30));
    const all = recentOutcomes(Date.now(), days);
    console.log(JSON.stringify(sampleSheet(all, n), null, 1));
  } else {
    console.error('usage: intake.mjs prepare <bundle> <dir> | evidence <dir> | check <dir> | record <dir> [--mode preview] | apply <dir> | sheet [--days 7] [--n 30]');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
