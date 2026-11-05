#!/usr/bin/env bash
# Check all active projects for uncommitted changes at session end.
# Surfaces warnings so work doesn't survive a session without being committed.

PROJECTS_DIR="$HOME/projects/active"
DIRTY=()

for dir in "$PROJECTS_DIR"/*/; do
    [[ -d "$dir/.git" ]] || continue
    name=$(basename "$dir")

    # Check for uncommitted changes (staged, unstaged, untracked)
    changes=$(cd "$dir" && git status --porcelain 2>/dev/null)
    if [[ -n "$changes" ]]; then
        count=$(echo "$changes" | wc -l)
        DIRTY+=("$name ($count files)")
    fi
done

# Also check nested project dirs (e.g., web/rowbyroh-website)
for dir in "$PROJECTS_DIR"/*/*/; do
    [[ -d "$dir/.git" ]] || continue
    name=$(basename "$(dirname "$dir")")/$(basename "$dir")

    changes=$(cd "$dir" && git status --porcelain 2>/dev/null)
    if [[ -n "$changes" ]]; then
        count=$(echo "$changes" | wc -l)
        DIRTY+=("$name ($count files)")
    fi
done

if [[ ${#DIRTY[@]} -gt 0 ]]; then
    echo "UNCOMMITTED WORK in ${#DIRTY[@]} project(s):"
    for item in "${DIRTY[@]}"; do
        echo "  - $item"
    done
    echo "Commit or discard before ending session."
fi
