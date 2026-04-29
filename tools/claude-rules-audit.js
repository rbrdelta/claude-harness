#!/usr/bin/env node
/**
 * claude-rules-audit — read-only audit of Claude Code's resolved instruction sources.
 * v1: resolved rule list with provenance, keyword-overlap conflict scan (curated keywords),
 *     within-source topic accumulation scan, freshness summary, vault sync-drift check.
 *
 * Sources scanned:
 *   - ~/.claude/CLAUDE.md (global)
 *   - cwd -> root CLAUDE.md chain (project hierarchy)
 *   - ~/.claude/projects/-home-rbr01/memory/MEMORY.md indexed files
 *   - ~/.claude/skills/* /SKILL.md (frontmatter description = trigger string)
 *
 * Out of scope: per-session injected reminders, settings.json, plugin internals,
 *               semantic conflict resolution, auto-fix.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const NOW = new Date();
const STALE_DAYS = 30;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

const GLOBAL_CLAUDE = path.join(HOME, '.claude', 'CLAUDE.md');
const VAULT_CLAUDE = '/mnt/c/MCP/Meta/CLAUDE.md';
const MEMORY_DIR = path.join(HOME, '.claude', 'projects', '-home-rbr01', 'memory');
const MEMORY_INDEX = path.join(MEMORY_DIR, 'MEMORY.md');
const SKILLS_DIR = path.join(HOME, '.claude', 'skills');
const AGENTS_DIR = path.join(HOME, '.claude', 'agents');

const IMPERATIVE_RE = /\b(Never|Always|Don't|Must|Should|NEVER|ALWAYS|DON'?T|MUST|SHOULD)\b/;

const KEYWORDS = [
  'commit', 'push', 'emoji', 'model', 'vault', 'draft', 'sprint',
  'debrief', 'memory', 'verify', 'complete', 'hook', 'settings',
  'mcp', 'skill', 'branch', 'confidential', 'test', 'approve',
  'sign-off', 'time', 'plan', 'never',
];

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { frontmatter: {}, hasFm: false };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { frontmatter: fm, hasFm: true };
}

/**
 * Extract rule-shaped lines from a markdown file.
 * Captures: bullets (- *), numbered items (1.), and standalone prose lines containing
 *           imperative markers (Never/Always/Don't/Must/Should).
 * Skips: code fences, frontmatter, headings, table separators, blank lines.
 */
function extractRules(text, sourcePath) {
  const lines = text.split('\n');
  const rules = [];
  let inFence = false;
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (i === 0 && trimmed === '---') { inFrontmatter = true; continue; }
    if (inFrontmatter) {
      if (trimmed === '---') inFrontmatter = false;
      continue;
    }

    if (trimmed.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;

    if (trimmed === '') continue;
    if (/^#+\s/.test(trimmed)) continue;
    if (/^\|[-:|\s]+\|?$/.test(trimmed)) continue;
    if (/^>\s/.test(trimmed)) continue;

    const isBullet = /^[-*]\s/.test(trimmed);
    const isNumbered = /^\d+\.\s/.test(trimmed);
    const isImperative = IMPERATIVE_RE.test(trimmed);

    if (isBullet || isNumbered || isImperative) {
      const text = trimmed.length > 220 ? trimmed.slice(0, 217) + '...' : trimmed;
      const kind = isBullet ? 'bul' : isNumbered ? 'num' : 'imp';
      rules.push({ line: i + 1, kind, text, source: sourcePath });
    }
  }
  return rules;
}

function scanFile(absPath, label) {
  const text = readSafe(absPath);
  if (text === null) return null;
  const stat = statSafe(absPath);
  return {
    path: absPath,
    label,
    mtime: stat.mtime,
    rules: extractRules(text, absPath),
  };
}

function scanProjectChain() {
  const sources = [];
  let dir = process.cwd();
  while (dir && dir !== '/' && dir !== HOME) {
    const candidate = path.join(dir, 'CLAUDE.md');
    if (fs.existsSync(candidate) && candidate !== GLOBAL_CLAUDE) {
      const src = scanFile(candidate, candidate.replace(HOME, '~'));
      if (src) sources.push(src);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return sources;
}

function scanMemory() {
  const indexText = readSafe(MEMORY_INDEX);
  if (!indexText) return [];

  const sources = [];
  const linkRe = /\(([^)]+\.md)\)/g;
  const seen = new Set();
  let m;
  while ((m = linkRe.exec(indexText))) {
    const filename = m[1];
    if (seen.has(filename)) continue;
    seen.add(filename);

    const filePath = path.join(MEMORY_DIR, filename);
    const text = readSafe(filePath);
    if (text === null) continue;
    const stat = statSafe(filePath);
    const { frontmatter } = parseFrontmatter(text);

    const rules = [];
    if (frontmatter.description) {
      rules.push({
        line: 0,
        kind: 'fm',
        text: `[${frontmatter.type || '?'}] ${frontmatter.name || filename}: ${frontmatter.description}`,
        source: filePath,
      });
    }
    rules.push(...extractRules(text, filePath));

    sources.push({
      path: filePath,
      label: `memory/${filename}`,
      mtime: stat.mtime,
      rules,
    });
  }
  return sources;
}

function scanSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const sources = [];
  for (const entry of fs.readdirSync(SKILLS_DIR).sort()) {
    const skillFile = path.join(SKILLS_DIR, entry, 'SKILL.md');
    const text = readSafe(skillFile);
    if (text === null) continue;
    const stat = statSafe(skillFile);
    const { frontmatter } = parseFrontmatter(text);
    const rules = [];
    if (frontmatter.description) {
      rules.push({
        line: 0,
        kind: 'fm',
        text: `${frontmatter.name || entry}: ${frontmatter.description}`,
        source: skillFile,
      });
    }
    sources.push({
      path: skillFile,
      label: `skills/${entry}/SKILL.md`,
      mtime: stat.mtime,
      rules,
    });
  }
  return sources;
}

function vaultDriftCheck() {
  const a = readSafe(GLOBAL_CLAUDE);
  const b = readSafe(VAULT_CLAUDE);
  if (a === null || b === null) {
    return { available: false, reason: a === null ? 'global unreadable' : 'vault unreadable' };
  }
  if (a === b) return { available: true, identical: true };
  const al = a.split('\n');
  const bl = b.split('\n');
  let diffs = 0;
  const maxLen = Math.max(al.length, bl.length);
  for (let i = 0; i < maxLen; i++) {
    if (al[i] !== bl[i]) diffs++;
  }
  return {
    available: true,
    identical: false,
    globalLines: al.length,
    vaultLines: bl.length,
    diffLines: diffs,
  };
}

function crossSourceConflictScan(allSources) {
  const allRules = [];
  for (const source of allSources) {
    for (const rule of source.rules) {
      allRules.push({ ...rule, label: source.label });
    }
  }

  const matches = {};
  for (const kw of KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/-/g, '\\-')}\\b`, 'i');
    const hits = allRules.filter(r => re.test(r.text));
    if (hits.length < 2) continue;
    const sources = new Set(hits.map(h => h.label));
    if (sources.size < 2) continue;
    matches[kw] = hits;
  }
  return matches;
}

/**
 * Within-source topic accumulation: per source, count rules per curated keyword.
 * Only surfaces clusters with 3+ rules in a single file (lower threshold = noise).
 * Useful for spotting accumulation in any one file (e.g. an over-grown CLAUDE.md).
 */
function withinSourceScan(allSources) {
  const result = {};
  for (const source of allSources) {
    if (source.rules.length < 3) continue;
    const clusters = {};
    for (const kw of KEYWORDS) {
      const re = new RegExp(`\\b${kw.replace(/-/g, '\\-')}\\b`, 'i');
      const hits = source.rules.filter(r => re.test(r.text));
      if (hits.length >= 3) {
        clusters[kw] = { count: hits.length, lines: hits.map(h => h.line) };
      }
    }
    if (Object.keys(clusters).length > 0) {
      result[source.label] = clusters;
    }
  }
  return result;
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function isStale(mtime) { return (NOW - mtime) > STALE_MS; }

// === MAIN ===

const t0 = Date.now();

const globalSrc = scanFile(GLOBAL_CLAUDE, '~/.claude/CLAUDE.md');
const projectSources = scanProjectChain();
const memorySources = scanMemory();
const skillSources = scanSkills();
const drift = vaultDriftCheck();
const agentsExist = fs.existsSync(AGENTS_DIR);

const allSources = [
  ...(globalSrc ? [globalSrc] : []),
  ...projectSources,
  ...memorySources,
  ...skillSources,
];

const totalRules = allSources.reduce((n, s) => n + s.rules.length, 0);

console.log('=== claude-rules-audit ===');
console.log(`run at ${NOW.toISOString()}    cwd: ${process.cwd()}`);
console.log('');

console.log(`[1] RESOLVED RULES   (${totalRules} rules across ${allSources.length} files)`);
console.log('');

for (const src of allSources) {
  const staleTag = isStale(src.mtime) ? '   STALE' : '';
  console.log(`─── ${src.label}   (mod ${fmtDate(src.mtime)}${staleTag})`);
  if (src.rules.length === 0) {
    console.log('     (no rules extracted)');
  } else {
    for (const r of src.rules) {
      const tag = r.line > 0 ? `L${String(r.line).padStart(4)}` : ' fm ';
      console.log(`  ${tag} [${r.kind}] ${r.text}`);
    }
  }
  console.log('');
}

console.log(`[2] CROSS-SOURCE CONFLICT SCAN   (keyword-overlap heuristic, ${KEYWORDS.length} curated keywords)`);
console.log('');

const conflicts = crossSourceConflictScan(allSources);
const conflictKeys = Object.keys(conflicts);
if (conflictKeys.length === 0) {
  console.log('  (no keyword overlaps across multiple sources)');
} else {
  for (const kw of conflictKeys) {
    const hits = conflicts[kw];
    const sourceCount = new Set(hits.map(h => h.label)).size;
    console.log(`- keyword "${kw}":  ${hits.length} hits across ${sourceCount} sources`);
    for (const h of hits) {
      const lineTag = h.line > 0 ? `:L${h.line}` : '';
      const snippet = h.text.length > 110 ? h.text.slice(0, 107) + '...' : h.text;
      console.log(`    ${h.label}${lineTag}`);
      console.log(`      ${snippet}`);
    }
    console.log('');
  }
}

console.log(`[3] WITHIN-SOURCE TOPIC ACCUMULATION   (single file with 3+ rules sharing a keyword)`);
console.log('');

const withinScan = withinSourceScan(allSources);
const withinSources = Object.keys(withinScan).sort();
if (withinSources.length === 0) {
  console.log('  (no within-source clusters found)');
} else {
  for (const sourceLabel of withinSources) {
    const clusters = withinScan[sourceLabel];
    const sortedKeywords = Object.keys(clusters).sort((a, b) => clusters[b].count - clusters[a].count);
    console.log(`─── ${sourceLabel}`);
    for (const kw of sortedKeywords) {
      const c = clusters[kw];
      const linesStr = c.lines.filter(l => l > 0).map(l => `L${l}`).join(', ') || 'fm';
      console.log(`    "${kw}": ${c.count} rules  (${linesStr})`);
    }
    console.log('');
  }
}

console.log('[4] COVERAGE SUMMARY');
console.log('');
console.log('  Source                                              Rules   Last modified   Stale?');
for (const src of allSources) {
  const staleStr = isStale(src.mtime) ? 'STALE' : 'no';
  console.log(`  ${src.label.padEnd(50)} ${String(src.rules.length).padStart(5)}   ${fmtDate(src.mtime)}      ${staleStr}`);
}
if (!agentsExist) {
  console.log(`  ~/.claude/agents/                                       —   (directory missing)`);
}
console.log('');

console.log('[5] VAULT SYNC DRIFT  (~/.claude/CLAUDE.md vs /mnt/c/MCP/Meta/CLAUDE.md)');
console.log('');
if (!drift.available) {
  console.log(`  (${drift.reason})`);
} else if (drift.identical) {
  console.log('  Files are identical.');
} else {
  console.log(`  Files differ:  global=${drift.globalLines} lines, vault=${drift.vaultLines} lines, ${drift.diffLines} differing lines.`);
  console.log('  Run: diff ~/.claude/CLAUDE.md /mnt/c/MCP/Meta/CLAUDE.md');
}
console.log('');

const elapsed = Date.now() - t0;
console.log(`--- ran in ${elapsed}ms ---`);
