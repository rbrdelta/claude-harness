#!/bin/bash
# July 2026 window-pace gauge (deterministic — no LLM). Self-expires after 2026-07-31.
# Reads the Charter window-log table and reports:
#   - this week's windows vs 4/week, broken down by mode (target mix 2 build / 1 learn / 1 write)
#   - which mode is short
#   - month-to-date vs the >=12/16 accountability gate
# Usage: july-pace-gauge.sh [append_target_file]
#   - with a target file that exists: appends the read-out as a markdown section
#   - otherwise: prints to stdout
# Deterministic on purpose: the count is ground truth, not an LLM's summary.

TODAY=$(date +%Y-%m-%d)
[[ "$TODAY" > "2026-07-31" ]] && exit 0
CHARTER="/mnt/c/MCP/Inbox/July 2026 Charter — Research PM, All-In.md"
[ -f "$CHARTER" ] || exit 0

WEEK_START=$(date -d "-$(($(date +%u)-1)) days" +%Y-%m-%d)

rows=$(grep -oE '^\| 2026-[0-9]{2}-[0-9]{2} \| [0-9]+ \| [^|]+' "$CHARTER" 2>/dev/null)

wk_b=0; wk_l=0; wk_w=0; wk_t=0; mo_t=0
while IFS= read -r line; do
    [ -z "$line" ] && continue
    d=$(echo "$line" | grep -oE '2026-[0-9]{2}-[0-9]{2}' | head -1)
    type=$(echo "$line" | awk -F'|' '{print $4}' | tr 'A-Z' 'a-z')
    case "$d" in 2026-07-*) mo_t=$((mo_t+1)) ;; esac
    if [[ "$d" > "$WEEK_START" || "$d" == "$WEEK_START" ]]; then
        wk_t=$((wk_t+1))
        case "$type" in
            *build*|*run*) wk_b=$((wk_b+1)) ;;
            *learn*)       wk_l=$((wk_l+1)) ;;
            *write*|*share*) wk_w=$((wk_w+1)) ;;
        esac
    fi
done <<< "$rows"

short=""
[ "$wk_b" -lt 2 ] && short="${short} Build(${wk_b}/2)"
[ "$wk_l" -lt 1 ] && short="${short} Learn(${wk_l}/1)"
[ "$wk_w" -lt 1 ] && short="${short} Write(${wk_w}/1)"
[ -z "$short" ] && short=" none — weekly mix met"

OUT="## July window pace (week of ${WEEK_START})

- **This week: ${wk_t}/4 core windows** — Build ${wk_b}/2, Learn ${wk_l}/1, Write ${wk_w}/1
- **Short:**${short}
- **Month-to-date: ${mo_t}/16 logged** (gate: ≥12 = month meets its contract)"

if [ "$1" = "--line" ]; then
    if [ "$short" = " none — weekly mix met" ]; then s="mix met"; else s="short:${short}"; fi
    printf '%s/4 (B%s/2 L%s/1 W%s/1) %s\n' "$wk_t" "$wk_b" "$wk_l" "$wk_w" "$s"
elif [ -n "$1" ] && [ -f "$1" ]; then
    printf '\n%s\n' "$OUT" >> "$1"
else
    printf '%s\n' "$OUT"
fi
exit 0
