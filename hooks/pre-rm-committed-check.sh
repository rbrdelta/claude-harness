#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — block destructive deletes without a git backup.
#
# Daniel's rule: rm is allowed if the file is tracked in git AND has no uncommitted
# changes (i.e. a clean HEAD copy exists as a backup). Outside any git repo, allow.
#
# Scope: rm, rmdir, shred at the start of any ; && || -separated segment.
# Globs and `find -delete` / `find -exec rm` are not parsed — those get blocked
# with a message asking for explicit paths.

set -uo pipefail

payload=$(cat)

# Extract tool_name and tool_input.command via python3 (jq isn't always installed).
read -r tool_name command < <(python3 -c '
import json, sys
try:
    p = json.loads(sys.stdin.read())
except Exception:
    print("", "")
    sys.exit(0)
name = p.get("tool_name", "") or ""
cmd = (p.get("tool_input") or {}).get("command", "") or ""
# Encode command as one shell-safe token by base64 to survive newlines/quotes.
import base64
print(name, base64.b64encode(cmd.encode()).decode())
' <<<"$payload")

[[ "$tool_name" == "Bash" ]] || exit 0
command=$(echo "$command" | base64 -d 2>/dev/null || echo "")
[[ -n "$command" ]] || exit 0

# Fast-path: not a delete-style command at all.
echo "$command" | grep -qE '(^|[;&|[:space:]])(rm|rmdir|shred)([[:space:]]|$)' || exit 0

block() {
  echo "BLOCKED by pre-rm-committed-check: $1" >&2
  echo "Daniel's rule: deletes require a git-committed backup of the target." >&2
  echo "Fix: stage and commit the file first (git add + git commit), then retry." >&2
  exit 2
}

# Split on ; && || and \n so we can examine each command segment.
segments=$(echo "$command" | sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/;/\n/g')

while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"  # ltrim
  [[ -z "$seg" ]] && continue
  [[ "$seg" =~ ^(rm|rmdir|shred)([[:space:]]|$) ]] || continue

  # Tokenize. (Doesn't handle quoted whitespace perfectly, but rm targets rarely have it.)
  read -r -a tokens <<< "$seg"
  paths=()
  for t in "${tokens[@]:1}"; do
    [[ "$t" == -* ]] && continue
    # Strip wrapping quotes
    t="${t%\"}"; t="${t#\"}"
    t="${t%\'}"; t="${t#\'}"
    paths+=("$t")
  done

  for p in "${paths[@]}"; do
    # Glob detection — refuse to guess at expansion.
    if [[ "$p" == *"*"* || "$p" == *"?"* || "$p" == *"["* ]]; then
      block "glob '$p' — rerun with explicit paths so each can be checked"
    fi

    # Non-existent → rm will no-op or error; nothing to back up.
    [[ -e "$p" ]] || continue

    abspath=$(realpath "$p" 2>/dev/null || echo "$p")
    # Look for repo from the path itself if it's a dir, else from its parent.
    if [[ -d "$abspath" ]]; then
      lookup_dir="$abspath"
    else
      lookup_dir=$(dirname "$abspath")
    fi

    repo_root=$(git -C "$lookup_dir" rev-parse --show-toplevel 2>/dev/null || true)
    # Outside any git repo: allow. Daniel's rule scopes to repo-backed files.
    [[ -z "$repo_root" ]] && continue

    rel=$(realpath --relative-to="$repo_root" "$abspath" 2>/dev/null || echo "$abspath")

    # Tracked?
    if ! git -C "$repo_root" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
      # For directories, untracked is OK only if every file inside is tracked+clean.
      if [[ -d "$abspath" ]]; then
        # Anything in the dir not tracked? `ls-files --others` lists untracked.
        untracked=$(git -C "$repo_root" ls-files --others --exclude-standard -- "$rel" 2>/dev/null | head -1)
        [[ -n "$untracked" ]] && block "untracked content under '$abspath' (e.g. $untracked)"
      else
        block "untracked file '$abspath' has no git backup"
      fi
    fi

    # Any uncommitted modifications under the path?
    status=$(git -C "$repo_root" status --porcelain -- "$rel" 2>/dev/null || true)
    [[ -n "$status" ]] && block "'$abspath' has uncommitted changes:\n$status"
  done
done <<< "$segments"

exit 0
