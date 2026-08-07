#!/usr/bin/env node

/**
 * Permission Coverage Report
 * Analyzes tool-use logs against settings.json rules to measure auto-approval coverage.
 *
 * Usage:
 *   node ~/.claude/hooks/approval-report.js              # today
 *   node ~/.claude/hooks/approval-report.js 2026-03-27   # specific date
 *   node ~/.claude/hooks/approval-report.js --all        # all logs
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const LOGS_DIR = path.join(CLAUDE_DIR, 'logs');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

// --- Pattern matching ---

function globToRegex(pattern) {
  let regex = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      regex += '[\\s\\S]*';
      i++; // skip second *
      if (pattern[i + 1] === '/') i++; // skip trailing /
    } else if (pattern[i] === '*') {
      regex += '[\\s\\S]*';
    } else if ('.+^${}()|[]\\?'.includes(pattern[i])) {
      regex += '\\' + pattern[i];
    } else {
      regex += pattern[i];
    }
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

// Engine semantics: a Read rule covers ALL file-reading tools; an Edit rule
// covers ALL file-editing tools. Write/Glob/Grep rules are NOT matched by the
// permission engine (it emits a startup warning telling you to use Read/Edit).
// The report must mirror this or it reports phantom gaps for Write calls.
const RULE_FAMILY = {
  Read: ['Read', 'Glob', 'Grep'],
  Edit: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
};

function matchesRule(rule, toolName, toolInput) {
  const parsed = parseRule(rule);
  if (!parsed) return false;

  // Tool name must match — exactly, or via the engine's read/edit family coverage
  const covers = parsed.tool === toolName ||
    (RULE_FAMILY[parsed.tool] && RULE_FAMILY[parsed.tool].includes(toolName));
  if (!covers) return false;

  // No pattern means match any invocation of this tool
  if (!parsed.pattern) return true;

  // Special case: WebFetch domain matching
  if (parsed.pattern.startsWith('domain:')) {
    const domain = parsed.pattern.slice(7);
    const url = toolInput?.url || '';
    return url.includes(domain);
  }

  const target = getTargetString(toolName, toolInput);
  if (!target) return false;

  // Normalize // prefix (Claude Code absolute path syntax) to / for matching
  const normalizedPattern = parsed.pattern.startsWith('//') ? parsed.pattern.slice(1) : parsed.pattern;

  try {
    return globToRegex(normalizedPattern).test(target);
  } catch {
    return false;
  }
}

function wouldDeny(denyRules, toolName, toolInput) {
  return denyRules.some(rule => matchesRule(rule, toolName, toolInput));
}

function wouldAllow(allowRules, toolName, toolInput) {
  return allowRules.some(rule => matchesRule(rule, toolName, toolInput));
}

// --- Suggestion engine ---

function suggestRule(toolName, toolInput) {
  const target = getTargetString(toolName, toolInput);
  if (!target) return `${toolName}`;

  if (toolName === 'Bash') {
    // Suggest based on first word(s) of command
    const parts = target.split(/\s+/);

    // Env-prefixed: KEY=value cmd ...
    if (parts[0] && parts[0].includes('=') && parts.length > 1) {
      const envVar = parts[0].split('=')[0];
      const cmd = parts[1];
      return `Bash(${envVar}=* ${cmd} *)`;
    }

    // Regular command
    if (parts.length === 1) return `Bash(${parts[0]})`;
    return `Bash(${parts[0]} *)`;
  }

  if (['Read', 'Write', 'Edit', 'Glob', 'Grep'].includes(toolName)) {
    // Suggest a directory-level rule with // prefix for absolute paths
    const segments = target.split('/');
    // Find a reasonable prefix (3-4 segments deep)
    const depth = Math.min(segments.length - 1, 4);
    const prefix = segments.slice(0, depth).join('/');
    // Use // prefix for absolute paths (Claude Code convention)
    const rulePrefix = prefix.startsWith('/') ? '/' + prefix : prefix;
    // Emit the rule the ENGINE honors: Read covers read-family, Edit covers
    // edit-family. Suggesting Write(...)/Glob(...) would be a dead no-op.
    const ruleTool = RULE_FAMILY.Read.includes(toolName) ? 'Read'
      : RULE_FAMILY.Edit.includes(toolName) ? 'Edit'
      : toolName;
    return `${ruleTool}(${rulePrefix}/**)`;
  }

  return `${toolName}`;
}

// --- Load data ---

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    const perms = data.permissions || {};
    return {
      allow: perms.allow || [],
      deny: perms.deny || [],
    };
  } catch (e) {
    console.error('Could not read settings.json:', e.message);
    process.exit(1);
  }
}

function loadLogs(dateFilter) {
  const entries = [];
  if (!fs.existsSync(LOGS_DIR)) {
    console.error('No logs directory found. Run a session first.');
    process.exit(1);
  }

  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('tool-use-') && f.endsWith('.jsonl'))
    .filter(f => {
      if (dateFilter === '--all') return true;
      return f === `tool-use-${dateFilter}.jsonl`;
    })
    .sort();

  if (files.length === 0) {
    console.error(`No log files found${dateFilter !== '--all' ? ` for ${dateFilter}` : ''}.\nAvailable logs:`);
    fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('tool-use-'))
      .forEach(f => console.error(`  ${f}`));
    process.exit(1);
  }

  for (const file of files) {
    const lines = fs.readFileSync(path.join(LOGS_DIR, file), 'utf8')
      .split('\n')
      .filter(l => l.trim());

    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        // Handle both formats: {ts, hook: {tool_name, tool_input}} and {ts, data: {tool_name, tool_input}}
        const data = raw.hook || raw.data || raw;
        entries.push({
          ts: raw.ts || data.ts,
          tool: data.tool_name || data.tool,
          input: data.tool_input || data.input || {},
          session: data.session_id || 'unknown',
        });
      } catch {
        // skip malformed lines
      }
    }
  }

  return { entries, files };
}

// --- Report ---

function generateReport(dateFilter) {
  const settings = loadSettings();
  const { entries, files } = loadLogs(dateFilter);

  if (entries.length === 0) {
    console.log('No tool calls logged.');
    return;
  }

  const sessions = new Set(entries.map(e => e.session));
  let autoApproved = 0;
  let denied = 0;
  let needsApproval = 0;
  const manualApprovals = {}; // key: suggested rule, value: { count, examples }
  const toolStats = {}; // key: tool name, value: { total, auto }

  for (const entry of entries) {
    const { tool, input } = entry;

    // Init tool stats
    if (!toolStats[tool]) toolStats[tool] = { total: 0, auto: 0 };
    toolStats[tool].total++;

    // Check deny first
    if (wouldDeny(settings.deny, tool, input)) {
      denied++;
      continue;
    }

    // Check allow
    if (wouldAllow(settings.allow, tool, input)) {
      autoApproved++;
      toolStats[tool].auto++;
    } else {
      needsApproval++;
      const suggestion = suggestRule(tool, input);
      if (!manualApprovals[suggestion]) {
        manualApprovals[suggestion] = { count: 0, examples: [] };
      }
      manualApprovals[suggestion].count++;
      const target = getTargetString(tool, input);
      if (target && manualApprovals[suggestion].examples.length < 2) {
        const truncated = target.length > 80 ? target.slice(0, 77) + '...' : target;
        manualApprovals[suggestion].examples.push(truncated);
      }
    }
  }

  const total = entries.length;
  const pctAuto = total > 0 ? ((autoApproved / total) * 100).toFixed(1) : 0;
  const pctManual = total > 0 ? ((needsApproval / total) * 100).toFixed(1) : 0;

  // Output
  console.log('');
  console.log('=== Permission Coverage Report ===');
  console.log(`Log files: ${files.join(', ')}`);
  console.log(`Sessions:  ${sessions.size}`);
  console.log('');
  console.log(`Total tool calls:     ${total}`);
  console.log(`Auto-approved:        ${autoApproved} (${pctAuto}%)`);
  console.log(`Would need approval:  ${needsApproval} (${pctManual}%)`);
  if (denied > 0) console.log(`Denied by rule:       ${denied}`);
  console.log('');

  // Per-tool breakdown
  console.log('--- Coverage by tool ---');
  const sortedTools = Object.entries(toolStats).sort((a, b) => b[1].total - a[1].total);
  for (const [tool, stats] of sortedTools) {
    const pct = ((stats.auto / stats.total) * 100).toFixed(0);
    const bar = stats.auto === stats.total ? ' [FULL]' : '';
    console.log(`  ${tool.padEnd(20)} ${String(stats.auto).padStart(3)}/${String(stats.total).padStart(3)} auto (${pct}%)${bar}`);
  }
  console.log('');

  // Manual approvals that could be rules
  const sortedManual = Object.entries(manualApprovals).sort((a, b) => b[1].count - a[1].count);
  if (sortedManual.length > 0) {
    console.log('--- Approvals that could be rules ---');
    for (const [suggestion, data] of sortedManual) {
      console.log(`  ${suggestion}  (${data.count}x)`);
      for (const ex of data.examples) {
        console.log(`    e.g. ${ex}`);
      }
    }
    console.log('');

    // Codifiable count
    const codifiable = sortedManual.filter(([, d]) => d.count >= 2);
    const codifiableCount = codifiable.reduce((sum, [, d]) => sum + d.count, 0);
    if (codifiable.length > 0) {
      console.log('--- Suggested additions to settings.json ---');
      console.log(`Adding ${codifiable.length} rules would auto-approve ${codifiableCount} more calls.`);
      const newPct = total > 0 ? (((autoApproved + codifiableCount) / total) * 100).toFixed(1) : 0;
      console.log(`Projected coverage: ${pctAuto}% -> ${newPct}%`);
      console.log('');
      console.log('Rules to add:');
      for (const [suggestion, data] of codifiable) {
        console.log(`  "${suggestion}",  // ${data.count} occurrences`);
      }
    }
  } else {
    console.log('All tool calls matched existing rules. Full coverage.');
  }

  console.log('');
}

// --- Main ---
const arg = process.argv[2] || new Date().toISOString().slice(0, 10);
generateReport(arg);
