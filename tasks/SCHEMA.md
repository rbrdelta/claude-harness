# Task Schema Reference

> Task files are structured specs that the compiler (`compile-task.ts`) reads to generate headless sprint scripts.
> Each task file is a markdown file with YAML frontmatter in this directory.

## Required Fields

```yaml
---
task: string              # unique identifier, kebab-case (e.g., "d2-diagram-system")
title: string             # human-readable title
project: string           # project name matching ~/projects/active/{project}/
autonomous: boolean       # true = ready for headless execution, false = needs planning first
complexity: enum          # known | simple | medium | complex (maps to sprint complexity levels)
evaluation_skill: string  # skill name — compiler reads ~/.claude/skills/{name}/EVAL.md
branch: string            # git branch name for this work
work_dir: string          # absolute path to project directory

inputs:                   # files the headless session MUST read before writing code
  - path: string          # absolute path or path relative to work_dir
    why: string           # what this file provides (design tokens, data schema, etc.)

outputs:                  # artifacts the sprint produces
  - type: string          # file type or category (css, html, js, note, config)
    description: string   # what the artifact is

acceptance:               # verifiable criteria — each must have a machine-checkable verify step
  - criterion: string     # what success looks like
    verify: string        # command or check that proves it (grep, file exists, test passes, etc.)

integration_points:       # existing systems this work touches
  - system: string        # name of the system (base.css, content.json, stream.js, etc.)
    concern: string       # what could go wrong or needs attention
---
```

## Optional Fields

```yaml
decision_document: string   # vault path to Decision Document (required if autonomous: true)
depends_on: [string]        # task IDs that must complete first
tags: [string]              # for filtering/grouping
notes: string               # freeform context for the compiler to include in the prompt
```

## Body

The markdown body below the frontmatter contains human-readable context:
- Prior work references (D1 learnings, exploration tags, etc.)
- Constraints not captured in structured fields
- Links to vault notes, handoffs, or Decision Documents

The compiler includes the body as a "Context" section in the generated prompt.

## Compiler Behavior

The compiler (`compile-task.ts`) does:

1. Parse YAML frontmatter
2. Validate required fields (error if missing)
3. Check `autonomous: true` (refuse to compile if false — task needs planning first)
4. Check `evaluation_skill` resolves to an EVAL.md file (error if not found)
5. Read HEADLESS.md template from `~/.claude/skills/sprint/HEADLESS.md`
6. Read EVAL.md from `~/.claude/skills/{evaluation_skill}/EVAL.md`
7. Fill template slots:
   - `inputs` → Setup section (read instructions)
   - `acceptance` → Acceptance Criteria section
   - `integration_points` → Integration Check section
   - `outputs` → Sprint Goal context
   - `evaluation_skill` EVAL.md content → Skill Evaluation Gate section
   - Body → Context section
8. Wrap in shell script boilerplate (claude -p invocation)
9. Write to `triggers/sprint-{task}.sh`

## Naming Convention

Task files: `{task-id}.md` (matches the `task:` field)
Generated scripts: `sprint-{task-id}.sh`

## Lifecycle

1. `/program` or Daniel writes the task file after a planning sprint produces a Decision Document
2. Set `autonomous: false` initially if planning isn't done yet
3. After planning sprint, update to `autonomous: true` and add `decision_document` path
4. Run `compile-task.ts {task-id}` to generate the sprint script
5. Review generated script, then execute via `run-sprint.sh` or manually
6. After execution, the task file stays as a record. The sprint handoff goes to the vault.
