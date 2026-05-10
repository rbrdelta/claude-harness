#!/bin/bash
# Health check for Claude Code remote control server.
# Runs from cron every 5 minutes.
#
# Retries are unlimited — cron's 5-min cadence is the rate limit.
# Notifications ramp: first detection, +30m, +2h, then every +6h.
# One ping on recovery.

LOG="$HOME/.claude/remote-control-health.log"
STATE="$HOME/.claude/remote-control-state"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() {
    echo "$(date '+%Y-%m-%d %H:%M') $1" >> "$LOG"
}

notify_telegram() {
    local message="$1"
    local env_file="$HOME/.claude/channels/telegram/.env"
    local access_file="$HOME/.claude/channels/telegram/access.json"

    [ -f "$env_file" ] && [ -f "$access_file" ] || return
    local token=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$env_file" | head -1 | cut -d= -f2- | tr -d '[:space:]')
    # First entry in allowFrom is the owner DM chat_id
    local chat_id=$(grep -oE '"[0-9]+"' "$access_file" | head -1 | tr -d '"')
    [ -n "$token" ] && [ -n "$chat_id" ] || return

    curl -s -X POST "https://api.telegram.org/bot${token}/sendMessage" \
        -d chat_id="$chat_id" \
        -d text="$message" \
        -d parse_mode="Markdown" > /dev/null 2>&1
}

# Notification ramp: given the age (sec) at which we last alerted,
# return the next age threshold at which to alert again.
# -1 → 0 (first alert) → 1800 (+30m) → 7200 (+2h) → +21600 (every +6h)
next_milestone_after() {
    local last=$1
    if [ "$last" -lt 0 ]; then echo 0
    elif [ "$last" -lt 1800 ]; then echo 1800
    elif [ "$last" -lt 7200 ]; then echo 7200
    else echo $(( last + 21600 ))
    fi
}

write_state() {
    cat > "$STATE" <<EOF
last_state="$1"
first_failure_ts=$2
last_alerted_at_age=$3
EOF
}

last_state="ok"
first_failure_ts=0
last_alerted_at_age=-1
[ -f "$STATE" ] && source "$STATE"

now=$(date +%s)

tmux_alive=false
process_alive=false
tmux has-session -t claude-remote 2>/dev/null && tmux_alive=true
pgrep -f "claude remote-control" > /dev/null 2>&1 && process_alive=true

# Healthy path
if $tmux_alive && $process_alive; then
    if [ "$last_state" = "down" ]; then
        mins=$(( (now - first_failure_ts) / 60 ))
        log "RECOVERED after ${mins}m"
        notify_telegram "Remote control recovered after ${mins}m"
    fi
    write_state "ok" 0 -1
    exit 0
fi

# Unhealthy path — diagnose
if ! $tmux_alive && ! $process_alive; then
    reason="tmux session and process both dead"
elif $tmux_alive && ! $process_alive; then
    reason="tmux alive but remote-control process died"
elif ! $tmux_alive && $process_alive; then
    reason="orphaned process without tmux session"
    pkill -f "claude remote-control"
    sleep 1
fi

# Mark start of a new outage
if [ "$last_state" != "down" ]; then
    first_failure_ts=$now
    last_alerted_at_age=-1
fi

log "RESTART: $reason"
bash "$SCRIPT_DIR/remote-control.sh" start
sleep 3

if pgrep -f "claude remote-control" > /dev/null 2>&1; then
    log "RESTART OK"
    if [ "$last_state" = "down" ]; then
        mins=$(( (now - first_failure_ts) / 60 ))
        notify_telegram "Remote control recovered after ${mins}m"
    fi
    write_state "ok" 0 -1
    exit 0
fi

log "RESTART FAILED"

# Notification ramp
outage_age=$(( now - first_failure_ts ))
next_ms=$(next_milestone_after "$last_alerted_at_age")
if [ "$outage_age" -ge "$next_ms" ]; then
    mins=$(( outage_age / 60 ))
    if [ "$next_ms" -eq 0 ]; then
        notify_telegram "Remote control DOWN: $reason"
    else
        notify_telegram "Remote control still down (${mins}m): $reason"
    fi
    last_alerted_at_age=$next_ms
fi

write_state "down" "$first_failure_ts" "$last_alerted_at_age"
