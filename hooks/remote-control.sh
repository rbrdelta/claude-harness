#!/bin/bash
# Start Claude Code remote control server in a detached tmux session.
# Idempotent — safe to call multiple times.
#
# Usage:
#   ./remote-control.sh              # start (default dir: ~)
#   ./remote-control.sh /some/path   # start with custom working directory
#   ./remote-control.sh stop         # kill the tmux session
#   ./remote-control.sh status       # check if running

SESSION="claude-remote"
WORK_DIR="${1:-$HOME}"
LOG="$HOME/.claude/remote-control-health.log"

case "${1:-start}" in
    stop)
        if tmux has-session -t "$SESSION" 2>/dev/null; then
            tmux kill-session -t "$SESSION"
            echo "$(date '+%Y-%m-%d %H:%M') Stopped remote control session" | tee -a "$LOG"
        else
            echo "No remote control session running"
        fi
        exit 0
        ;;
    status)
        if tmux has-session -t "$SESSION" 2>/dev/null && pgrep -f "claude remote-control" > /dev/null 2>&1; then
            echo "RUNNING (tmux session: $SESSION, PID: $(pgrep -f 'claude remote-control' | head -1))"
            exit 0
        elif tmux has-session -t "$SESSION" 2>/dev/null; then
            echo "TMUX ALIVE BUT PROCESS DEAD"
            exit 1
        else
            echo "NOT RUNNING"
            exit 1
        fi
        ;;
    start|*)
        # If first arg is a directory, use it
        if [ -d "$1" ]; then
            WORK_DIR="$1"
        else
            WORK_DIR="$HOME"
        fi

        # Already running — nothing to do
        if tmux has-session -t "$SESSION" 2>/dev/null && pgrep -f "claude remote-control" > /dev/null 2>&1; then
            echo "Remote control already running"
            exit 0
        fi

        # tmux exists but process died — kill stale session
        if tmux has-session -t "$SESSION" 2>/dev/null; then
            tmux kill-session -t "$SESSION"
        fi

        # Start fresh
        tmux new-session -d -s "$SESSION" -c "$WORK_DIR" "bash -lc 'claude remote-control 2>&1 | tee -a $HOME/.claude/remote-control.log'"
        echo "$(date '+%Y-%m-%d %H:%M') Started remote control (dir: $WORK_DIR)" | tee -a "$LOG"
        exit 0
        ;;
esac
