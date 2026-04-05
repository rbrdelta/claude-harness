#!/bin/bash
# Sprint D1: First Assembly Manual Diagram
# SVG diagram replacing ASCII art on obsidian-mcp.html.
# Run manually: bash ~/.claude/hooks/sprint-d1.sh
# Chain after E1+E2: bash ~/.claude/hooks/sprint-e1e2.sh && bash ~/.claude/hooks/sprint-d1.sh

LOG_FILE="$HOME/.claude/hooks/sprint-d1.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/web/rowbyroh-website"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running D1 sprint (First Assembly Manual Diagram)..."

PROMPT='You are executing an autonomous design sprint for rowbyroh.com. This is Phase D Sprint D1: build the first assembly-manual-style SVG diagram.

## Setup

1. cd ~/projects/active/web/rowbyroh-website
2. git checkout -b feature/diagram-artifacts
3. Read the full execution spec: /mnt/c/MCP/knowledge_projects/rowbyroh — Homepage Redesign Plan (Aperture + Logbook).md
4. Read the '\''Phase D'\'' section carefully — it has an SVG Style Guide with exact values
5. Read the repo CLAUDE.md for design system rules
6. Read assets/css/base.css for CSS variables
7. Read obsidian-mcp.html — find the 3 existing .flow-diagram elements (approx lines 195, 248, 270)

## Step 1: Baseline

Score each of the 3 existing ASCII diagrams in obsidian-mcp.html against the 7 rubric dimensions from CLAUDE.md:
Hierarchy, Progression, Anchors, Density, Mobile Parity, Identity, Break Convention

Use a 1-5 scale. Document the scores.

## Step 2: Build first SVG

Replace the FIRST diagram (the 4-source import pipeline, approx line 195) with an SVG in assembly manual style.

The SVG must show:
- 4 source nodes on left: Claude.ai, Notion API, Notion export, Apple Notes (in component boxes)
- Processing steps in center with numbered badges: 01 parse, 02 frontmatter, 03 deduplicate
- Vault destination node on right
- Dashed flow lines with arrows between stages
- Part callout labels: '\''idempotent'\'', '\''source_id dedup'\'', '\''dry-run first'\''

Use the SVG Style Guide from the spec EXACTLY:
- Labels: font-family IBM Plex Mono, 12px/500 for primary, 10px/400 for secondary
- Numbered badges: circle r=12, fill #b84233, number 11px/700 fill #faf9f6
- Flow lines: stroke #1a1a1a, stroke-width 1, stroke-dasharray 4 3
- Arrow markers: stroke/fill #1a1a1a, 6px wide
- Component boxes: stroke #d4d2cd, stroke-width 1, fill #fefefe, rx 2
- Active boxes: stroke #b84233, stroke-width 1.5
- ViewBox: target ~680px wide

Wrap in the existing .flow-diagram container. Add a .diagram-label span: '\''fig. 01 — import pipeline'\''

Keep the other two ASCII diagrams unchanged for now.

## Step 3: Evaluate

Score the new SVG diagram against the same 7 rubric dimensions. It must score higher than the baseline on Identity and Break Convention.

## Step 4: Commit

git add obsidian-mcp.html
git commit -m '\''Replace first ASCII diagram with assembly-manual SVG

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'\''

## Step 5: Push and PR

git push -u origin feature/diagram-artifacts
gh pr create --title '\''First assembly-manual diagram: MCP import pipeline'\'' --body '\''Replaces ASCII import pipeline diagram on obsidian-mcp.html with SVG in assembly instruction style. Baseline and new rubric scores in commit message.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'\''

Do NOT merge. Daniel reviews.'

OUTPUT_FILE="$OUTPUT_DIR/sprint-d1-$(date +%Y-%m-%d).txt"
mkdir -p "$OUTPUT_DIR"

OUTPUT=$(cd "$WORK_DIR" && claude -p "$PROMPT" \
    --model claude-opus-4-6 \
    --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
    --permission-mode bypassPermissions \
    2>&1)
EXIT_CODE=$?

echo "$OUTPUT" > "$OUTPUT_FILE"

if [ $EXIT_CODE -eq 0 ]; then
    SUMMARY=$(echo "$OUTPUT" | tail -5 | head -1)
    log "OK: $SUMMARY"
else
    log "FAIL (exit $EXIT_CODE): $(echo "$OUTPUT" | tail -3 | tr '\n' ' ')"
fi

exit $EXIT_CODE
