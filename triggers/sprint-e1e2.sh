#!/bin/bash
# Sprint E1+E2: Aperture + Logbook + Archive
# Homepage redesign — two-phase sequential build.
# Run manually: bash ~/.claude/hooks/sprint-e1e2.sh
# Chain with D1: bash ~/.claude/hooks/sprint-e1e2.sh && bash ~/.claude/hooks/sprint-d1.sh

LOG_FILE="$HOME/.claude/hooks/sprint-e1e2.log"
OUTPUT_DIR="$HOME/.claude/logs"
WORK_DIR="$HOME/projects/active/web/rowbyroh-website"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"; }

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v claude &>/dev/null; then
    log "FAIL: claude CLI not found"
    exit 1
fi

log "START: Running E1+E2 sprint (Aperture + Logbook + Archive)..."

PROMPT='You are executing an autonomous design sprint for rowbyroh.com. This is a two-phase job: E1 (Aperture + Logbook) then E2 (Archive + Polish). Execute both sequentially. Do not stop between phases.

## Setup

1. cd ~/projects/active/web/rowbyroh-website
2. git checkout -b feature/aperture-logbook
3. Read the full execution spec: /mnt/c/MCP/knowledge_projects/rowbyroh — Homepage Redesign Plan (Aperture + Logbook).md
4. Read the repo CLAUDE.md for design system rules
5. Read assets/css/base.css for CSS variables
6. Read the current files: assets/data/content.json, assets/js/stream.js, assets/css/style.css, index.html

## Phase E1 — Execute exactly as specified in the vault note

Follow Steps 1-5 from the '\''Phase E1'\'' section:
- Step 1: Update content.json (add featured_for + events, remove pinned/pin_expires)
- Step 2: Rewrite stream.js (aperture + logbook rendering + tag reshape)
- Step 3: Update index.html (replace stream section with aperture/logbook/closing gesture)
- Step 4: Update style.css (remove .stream-* rules, add aperture/logbook/closing/all-work CSS from the spec)
- Step 5: Verify all 10 acceptance criteria

The vault note has EXACT CSS values, HTML structures, JS behavior specs, and data model changes. Use them exactly as written. Do not improvise or add anything not in the spec.

After E1 passes all criteria, commit:
git add assets/data/content.json assets/js/stream.js assets/css/style.css index.html
git commit -m '\''Rebuild homepage: aperture + logbook replacing unified stream

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'\''

## Phase E2 — Execute exactly as specified in the vault note

Follow Steps 1-6 from the '\''Phase E2'\'' section:
- Step 1: Create archive.html (exact HTML in spec)
- Step 2: Create assets/js/archive.js (behavior spec in note)
- Step 3: Create assets/css/archive.css (exact CSS in spec)
- Step 4: Harden edge cases in stream.js (empty logbook, single entry, no featured_for match)
- Step 5: Check writing.html references
- Step 6: Run rubric evaluation against all 7 dimensions

After E2 passes all criteria, commit:
git add archive.html assets/js/archive.js assets/css/archive.css assets/js/stream.js
git commit -m '\''Add archive page and polish edge cases

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'\''

## Finish

Push the branch and create a PR:
git push -u origin feature/aperture-logbook
gh pr create --title '\''Homepage redesign: Aperture + Logbook'\'' --body '\''Replaces flat unified stream with Aperture (one featured item) + Logbook (activity feed) + Archive page. See vault note for full design spec.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'\''

Do NOT merge the PR. Daniel will review and merge when ready.'

OUTPUT_FILE="$OUTPUT_DIR/sprint-e1e2-$(date +%Y-%m-%d).txt"
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
