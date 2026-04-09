#!/usr/bin/env npx tsx

/**
 * Task-to-Prompt Compiler
 *
 * Reads a task spec (tasks/{id}.md) + HEADLESS.md template + skill EVAL.md
 * and generates a headless sprint shell script (triggers/sprint-{id}.sh).
 *
 * Usage: npx tsx compile-task.ts <task-id>
 *    or: npm run compile -- <task-id>
 */

import { readFileSync, writeFileSync, existsSync, chmodSync } from "fs";
import { resolve, join } from "path";
import { parse as parseYaml } from "yaml";

// --- Paths ---

const HARNESS_DIR = resolve(import.meta.dirname || __dirname);
const TASKS_DIR = join(HARNESS_DIR, "tasks");
const TRIGGERS_DIR = join(HARNESS_DIR, "triggers");
const SKILLS_DIR = resolve(process.env.HOME!, ".claude", "skills");
const HEADLESS_PATH = join(SKILLS_DIR, "sprint", "HEADLESS.md");

// --- Types ---

interface TaskInput {
  path: string;
  why: string;
}

interface TaskOutput {
  type: string;
  description: string;
}

interface TaskAcceptance {
  criterion: string;
  verify: string;
}

interface TaskIntegration {
  system: string;
  concern: string;
}

interface TaskSpec {
  task: string;
  title: string;
  project: string;
  autonomous: boolean;
  complexity: "known" | "simple" | "medium" | "complex";
  evaluation_skill: string;
  branch: string;
  work_dir: string;
  inputs: TaskInput[];
  outputs: TaskOutput[];
  acceptance: TaskAcceptance[];
  integration_points: TaskIntegration[];
  decision_document?: string;
  depends_on?: string[];
  tags?: string[];
  notes?: string;
}

// --- Parse ---

function parseTaskFile(taskId: string): { spec: TaskSpec; body: string } {
  const filePath = join(TASKS_DIR, `${taskId}.md`);

  if (!existsSync(filePath)) {
    console.error(`Task file not found: ${filePath}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf-8");
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!fmMatch) {
    console.error(`Invalid frontmatter in ${filePath}`);
    process.exit(1);
  }

  const spec = parseYaml(fmMatch[1]) as TaskSpec;
  const body = fmMatch[2].trim();

  return { spec, body };
}

// --- Validate ---

function validate(spec: TaskSpec): void {
  const required: (keyof TaskSpec)[] = [
    "task",
    "title",
    "project",
    "autonomous",
    "complexity",
    "evaluation_skill",
    "branch",
    "work_dir",
    "inputs",
    "outputs",
    "acceptance",
    "integration_points",
  ];

  const missing = required.filter((k) => spec[k] === undefined || spec[k] === null);
  if (missing.length > 0) {
    console.error(`Missing required fields: ${missing.join(", ")}`);
    process.exit(1);
  }

  if (!spec.autonomous) {
    console.error(
      `Task "${spec.task}" has autonomous: false — needs a planning sprint before compilation.`
    );
    process.exit(1);
  }

  const evalPath = join(SKILLS_DIR, spec.evaluation_skill, "EVAL.md");
  if (!existsSync(evalPath)) {
    console.error(
      `No EVAL.md found for skill "${spec.evaluation_skill}" at ${evalPath}`
    );
    process.exit(1);
  }

  if (spec.acceptance.length === 0) {
    console.error("Task has no acceptance criteria.");
    process.exit(1);
  }
}

// --- Build prompt ---

function buildPrompt(spec: TaskSpec, body: string): string {
  const evalContent = readFileSync(
    join(SKILLS_DIR, spec.evaluation_skill, "EVAL.md"),
    "utf-8"
  );

  // Expand ~ in work_dir
  const workDir = spec.work_dir.replace(/^~/, process.env.HOME!);

  // --- Setup section ---
  const setupLines: string[] = [
    `1. cd ${workDir}`,
    `2. git checkout ${spec.branch} || git checkout -b ${spec.branch}`,
  ];

  if (spec.decision_document) {
    setupLines.push(
      `3. Read: ${spec.decision_document} — why: Decision Document governing this work`
    );
  }

  spec.inputs.forEach((input, i) => {
    const num = setupLines.length + 1;
    const path = input.path.replace(/^~/, process.env.HOME!);
    setupLines.push(`${num}. Read: ${path} — why: ${input.why}`);
  });

  // --- Acceptance criteria ---
  const acceptanceLines = spec.acceptance.map(
    (a) => `- [ ] ${a.criterion} — verify: ${a.verify}`
  );

  // --- Integration check ---
  const integrationLines = spec.integration_points.map(
    (ip) => `- [ ] ${ip.system}: ${ip.concern}`
  );

  // --- Outputs description ---
  const outputLines = spec.outputs.map((o) => `- ${o.type}: ${o.description}`);

  // --- Context from body ---
  // If body already starts with a heading, include it directly.
  // Otherwise wrap it in a Context section.
  const contextSection = body
    ? body.startsWith("#")
      ? body
      : `## Context\n\n${body}`
    : "";

  // --- Assemble the prompt ---
  const prompt = `You are executing an autonomous sprint. You have no human in the loop — if you get stuck, write a blocker handoff and stop cleanly. Do not guess or improvise past blockers.

## Rules (non-negotiable)

### Before writing any code:
1. Read EVERY file listed in Setup. Do not skip any.
2. Identify the existing patterns: CSS tokens, spacing model, responsive breakpoints, naming conventions, data schemas, JS patterns.
3. State what you found in a brief "System Understanding" block. If anything in the spec conflicts with existing patterns, STOP and write a blocker handoff instead of proceeding.

### During execution:
4. Use ONLY existing design tokens, CSS variables, spacing values, and patterns unless the spec explicitly provides new ones.
5. If the spec says "build X" but doesn't say how X integrates with existing systems, check the existing systems first and follow their patterns. Do not invent new patterns.
6. After each major step, verify the acceptance criteria for that step before moving to the next.
7. If you hit a decision not covered by the spec, choose the option that changes the least existing code. Document the decision in your commit message.

### If blocked:
8. Do NOT work around blockers with hacks or guesses.
9. Write a structured blocker handoff (see format below) and exit cleanly.
10. A clean stop with a good handoff is a successful outcome. A completed sprint with integration problems is a failure.

### After execution:
11. Run all verification checks listed in acceptance criteria.
12. If any check fails, attempt ONE fix. If the fix doesn't resolve it, write a handoff with what failed and why.
13. Commit only code that passes all listed checks.

## Setup

${setupLines.join("\n")}

## System Understanding Gate

After reading all setup files, write a brief block:

**Existing patterns I must follow:**
- CSS: [tokens, spacing, breakpoints found]
- JS: [patterns, data flow found]
- HTML: [structure, component model found]
- Data: [schemas, formats found]

**Spec requirements that touch existing systems:**
- [requirement] -> integrates with [existing system] via [approach]

**Potential conflicts:**
- [any spec requirement that doesn't fit existing patterns — if critical, STOP here]

Only proceed past this gate if there are no unresolved conflicts.

## Sprint Goal

${spec.title}

**Produces:**
${outputLines.join("\n")}

${contextSection}

## Acceptance Criteria

${acceptanceLines.join("\n")}

## Execution Steps

Follow the Decision Document for the implementation plan. Execute each step in order, verifying acceptance criteria as you go.

## Integration Check

After all steps complete, verify integration:
${integrationLines.join("\n")}
- [ ] No new CSS values introduced that aren't in base.css or the spec
- [ ] No new patterns that diverge from existing codebase conventions
- [ ] All modified files pass existing build/lint checks
- [ ] Changes work at mobile breakpoints (if applicable)
- [ ] No unintended side effects on pages/components not in scope

## Coherence Check

Reverse-engineer a spec from what you just built. Describe:
- What it does
- How it integrates with existing systems
- What inputs it expects
- What it produces
- Edge cases it handles

Compare your reverse-engineered spec to the original task acceptance criteria and Decision Document.

- If the specs align: proceed to evaluation gate.
- If there's a gap you can name: fix it, then re-run this check.
- If you can't articulate why something works: that's a blocker. Write a handoff.

## Skill Evaluation Gate

Run the following evaluation rubric. All dimensions must pass.
If any dimension is FAIL: revise, re-evaluate. If still FAIL after one revision: write a blocker handoff.

${evalContent}

## Commit and Deliver

git add -A
git commit -m '${spec.title}

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'
git push -u origin ${spec.branch}

## Blocker Handoff Format

If you must stop, write this to /mnt/c/MCP/Inbox/Blocker Handoff — ${spec.task}.md using the create_note MCP tool:

BLOCKER HANDOFF — ${spec.task} — [date]
Status: BLOCKED
Completed: [what got done]
Blocked on: [specific issue]
What I tried: [1-2 sentences]
Files in progress: [list with state — clean/modified/broken]
Recommendation: [what Daniel should do]
Branch state: [clean commit or uncommitted changes]`;

  return prompt;
}

// --- Generate shell script ---

function generateScript(taskId: string, spec: TaskSpec, prompt: string): string {
  const workDir = spec.work_dir.replace(/^~/, process.env.HOME!);

  // Escape single quotes in prompt for shell embedding
  const escapedPrompt = prompt.replace(/'/g, "'\\''");

  return `#!/bin/bash
# Sprint: ${spec.title}
# Task: ${taskId}
# Generated by compile-task.ts — do not edit manually
# Regenerate: npm run compile -- ${taskId}

LOG_FILE="$HOME/projects/active/claude-harness/logs/sprint-${taskId}.log"
OUTPUT_DIR="$HOME/projects/active/claude-harness/logs"
WORK_DIR="${workDir}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Sprint ${taskId} — ${spec.title}"

PROMPT='${escapedPrompt}'

OUTPUT_FILE="$OUTPUT_DIR/sprint-${taskId}-$(date +%Y-%m-%d).txt"
mkdir -p "$OUTPUT_DIR"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \\
    --model claude-opus-4-6 \\
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep,mcp__obsidian__create_note" \\
    --permission-mode bypassPermissions \\
    2>&1)
EXIT_CODE=$?

echo "$OUTPUT" > "$OUTPUT_FILE"

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -5 | head -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\\n' ' ')"
fi

exit $EXIT_CODE
`;
}

// --- Main ---

const taskId = process.argv[2];

if (!taskId) {
  console.error("Usage: npx tsx compile-task.ts <task-id>");
  console.error("  e.g.: npx tsx compile-task.ts d2-diagram-system");
  process.exit(1);
}

const { spec, body } = parseTaskFile(taskId);
validate(spec);

const prompt = buildPrompt(spec, body);
const script = generateScript(taskId, spec, prompt);

const outputPath = join(TRIGGERS_DIR, `sprint-${taskId}.sh`);
writeFileSync(outputPath, script);
chmodSync(outputPath, 0o755);

console.log(`Compiled: tasks/${taskId}.md -> triggers/sprint-${taskId}.sh`);
console.log(`  Branch: ${spec.branch}`);
console.log(`  Complexity: ${spec.complexity}`);
console.log(`  Evaluation: ${spec.evaluation_skill}/EVAL.md`);
console.log(`  Acceptance criteria: ${spec.acceptance.length}`);
console.log(`  Integration points: ${spec.integration_points.length}`);
