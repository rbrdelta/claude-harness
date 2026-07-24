#!/bin/bash
# advice-expiry-check.sh — flag standing advice whose review-by date has passed.
#
# Reads the Standing Advice Register (vault) and emits any row that is still
# `active` but past its review-by date. Advice past review-by must be
# re-checked against its named condition — renewed, amended, or retired —
# never followed blind. Exists because expired standing advice ("distribution
# is secondary") silently blocked EP03 distribution for three weeks.
#
# Usage:
#   advice-expiry-check.sh                # print overdue advice to stdout
#   advice-expiry-check.sh <note-path>    # append overdue advice to a note
#                                         # (weekly-digest.sh passes the digest note,
#                                         #  same pattern as july-pace-gauge.sh)
#
# Always exits 0 — this is observability, not a gate.

REGISTER="/mnt/c/MCP/Meta/Standing Advice Register.md"
TODAY=$(date +%Y-%m-%d)

[ -f "$REGISTER" ] || exit 0

# Table columns: | Advice | Given | Re-check condition | Review-by | Status |
# awk -F'|' fields:  $2      $3          $4                $5          $6
# Header/separator/retired rows fail the date regex or status match and drop out.
EXPIRED=$(awk -F'|' -v today="$TODAY" '
  NF >= 7 {
    advice = $2; review = $5; status = $6
    gsub(/^[ \t]+|[ \t]+$/, "", advice)
    gsub(/^[ \t]+|[ \t]+$/, "", review)
    gsub(/^[ \t]+|[ \t]+$/, "", status)
    if (status == "active" && review ~ /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/ && review < today)
      printf "- **OVERDUE since %s:** %s\n", review, advice
  }' "$REGISTER")

[ -z "$EXPIRED" ] && exit 0

BLOCK="## Standing advice — overdue for re-examination

> From [[Standing Advice Register]]. Re-check each condition, then renew, amend, or retire the row. Do not follow overdue advice blind.

$EXPIRED"

if [ -n "$1" ] && [ -f "$1" ]; then
    printf '\n%s\n' "$BLOCK" >> "$1"
else
    printf '%s\n' "$BLOCK"
fi

exit 0
