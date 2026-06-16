#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const LOGS_DIR = path.join(CLAUDE_DIR, 'logs');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// --- Pattern matching (lifted from approval-report.js) ---
function globToRegex(pattern) {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      regex += '[\\s\\S]*'; i++;
      if (pattern[i + 1] === '/') i++;
    } else if (pattern[i] === '*') regex += '[\\s\\S]*';
    else if ('.+^${}()|[]\\?'.includes(pattern[i])) regex += '\\' + pattern[i];
    else regex += pattern[i];
  }
  return new RegExp('^' + regex + '$');
}
function parseRule(rule) {
  const m = rule.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\((.+)\))?$/);
  if (!m) return null;
  return { tool: m[1], pattern: m[2] || null };
}
function getTargetString(toolName, toolInput) {
  if (!toolInput) return null;
  switch (toolName) {
    case 'Bash': return toolInput.command;
    case 'Read': case 'Write': case 'Edit': return toolInput.file_path;
    case 'Glob': return toolInput.path || toolInput.pattern;
    case 'Grep': return toolInput.path || '.';
    case 'WebFetch': return toolInput.url;
    case 'Skill': return toolInput.skill;
    default: return null;
  }
}
function matchesRule(rule, toolName, toolInput) {
  const parsed = parseRule(rule);
  if (!parsed) return false;
  if (parsed.tool !== toolName) return false;
  if (!parsed.pattern) return true;
  if (parsed.pattern.startsWith('domain:')) {
    return (toolInput?.url || '').includes(parsed.pattern.slice(7));
  }
  const target = getTargetString(toolName, toolInput);
  if (!target) return false;
  const norm = parsed.pattern.startsWith('//') ? parsed.pattern.slice(1) : parsed.pattern;
  try { return globToRegex(norm).test(target); } catch { return false; }
}

// --- Load settings ---
const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
const allow = settings.permissions?.allow || [];
const deny = settings.permissions?.deny || [];
// Also try local
let allowLocal = [];
try {
  const local = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.local.json'), 'utf8'));
  allowLocal = local.permissions?.allow || [];
} catch {}
const allAllow = [...allow, ...allowLocal];

// --- Iterate logs ---
const logFiles = fs.readdirSync(LOGS_DIR)
  .filter(f => f.startsWith('tool-use-') && f.endsWith('.jsonl'))
  .sort();

// session_id -> {date, calls, prompts, firstTs, lastTs}
const sessions = {};

for (const file of logFiles) {
  const date = file.replace('tool-use-', '').replace('.jsonl', '');
  const lines = fs.readFileSync(path.join(LOGS_DIR, file), 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    let raw; try { raw = JSON.parse(line); } catch { continue; }
    const h = raw.hook || raw;
    const sid = h.session_id;
    if (!sid) continue;
    if (!sessions[sid]) {
      sessions[sid] = { date, calls: 0, prompts: 0, firstTs: raw.ts, lastTs: raw.ts, mode: h.permission_mode };
    }
    sessions[sid].calls++;
    sessions[sid].lastTs = raw.ts;
    const toolName = h.tool_name;
    const toolInput = h.tool_input;
    // bypass mode = no prompts
    const mode = h.permission_mode || 'default';
    if (mode === 'bypassPermissions') {
      // no prompt
    } else if (mode === 'acceptEdits' && ['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
      // auto-approved by mode
    } else {
      const allowed = allAllow.some(r => matchesRule(r, toolName, toolInput));
      const denied = deny.some(r => matchesRule(r, toolName, toolInput));
      if (!allowed && !denied) sessions[sid].prompts++;
    }
  }
}

// --- Get turn counts from transcripts ---
const projDirs = fs.readdirSync(PROJECTS_DIR).filter(d => fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory());
const transcriptIndex = {};
for (const dir of projDirs) {
  const p = path.join(PROJECTS_DIR, dir);
  for (const f of fs.readdirSync(p)) {
    if (f.endsWith('.jsonl')) {
      const sid = f.replace('.jsonl', '');
      transcriptIndex[sid] = path.join(p, f);
    }
  }
}

function countUserTurns(sid) {
  const file = transcriptIndex[sid];
  if (!file) return null;
  let userTurns = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      if (o.type === 'user' && o.message?.role === 'user') {
        // exclude tool_result-only turns
        const c = o.message.content;
        if (typeof c === 'string') userTurns++;
        else if (Array.isArray(c) && c.some(b => b.type === 'text' || typeof b === 'string')) userTurns++;
      }
    } catch {}
  }
  return userTurns;
}

// --- Compose rows ---
const rows = Object.entries(sessions).map(([sid, s]) => {
  const t1 = new Date(s.firstTs);
  const t2 = new Date(s.lastTs);
  const minutes = Math.round((t2 - t1) / 60000);
  return {
    date: s.date,
    sid: sid.slice(0, 8),
    turns: countUserTurns(sid),
    calls: s.calls,
    prompts: s.prompts,
    minutes,
    mode: s.mode || '?',
  };
}).sort((a, b) => a.date.localeCompare(b.date) || (b.calls - a.calls));

// --- Output ---
console.log('Date        Session   Turns  Calls  Prompts  ActiveMin  Mode');
console.log('----------  --------  -----  -----  -------  ---------  --------------');
let totT = 0, totC = 0, totP = 0, totM = 0;
for (const r of rows) {
  console.log(
    `${r.date}  ${r.sid}  ${String(r.turns ?? '?').padStart(5)}  ${String(r.calls).padStart(5)}  ${String(r.prompts).padStart(7)}  ${String(r.minutes).padStart(9)}  ${r.mode}`
  );
  totT += r.turns || 0; totC += r.calls; totP += r.prompts; totM += r.minutes;
}
console.log('----------  --------  -----  -----  -------  ---------');
console.log(`TOTAL                ${String(totT).padStart(5)}  ${String(totC).padStart(5)}  ${String(totP).padStart(7)}  ${String(totM).padStart(9)}`);
console.log(`\nSessions: ${rows.length}`);
console.log(`Avg prompts/session: ${(totP/rows.length).toFixed(1)}`);
console.log(`Prompt rate: ${(100*totP/totC).toFixed(1)}% of all tool calls`);
console.log(`Avg turns/session: ${(totT/rows.length).toFixed(1)}`);
