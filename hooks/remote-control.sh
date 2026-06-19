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

        # Load nvm so `claude`/`node` are on PATH even when invoked from a
        # non-interactive shell (cron, tmux exec). .bashrc returns early for
        # non-interactive shells before its nvm block runs, so we cannot rely
        # on it — source nvm directly here.
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" >/dev/null 2>&1

        CLAUDE_BIN="$(command -v claude)"
        if [ -z "$CLAUDE_BIN" ]; then
            echo "$(date '+%Y-%m-%d %H:%M') START ABORTED: claude not found on PATH (nvm load failed)" | tee -a "$LOG"
            exit 1
        fi
        NODE_BIN_DIR="$(dirname "$CLAUDE_BIN")"

        # Cap the activity log so it can't grow unbounded (it was 150MB+).
        # Keep the last 1000 lines if it exceeds ~10MB.
        ACTIVITY_LOG="$HOME/.claude/remote-control.log"
        if [ -f "$ACTIVITY_LOG" ] && [ "$(stat -c%s "$ACTIVITY_LOG" 2>/dev/null || echo 0)" -gt 10485760 ]; then
            tail -n 1000 "$ACTIVITY_LOG" > "$ACTIVITY_LOG.tmp" && mv "$ACTIVITY_LOG.tmp" "$ACTIVITY_LOG"
        fi

        # Start fresh. Prepend the nvm node bin dir to PATH inside the tmux
        # exec so both `claude` and the `node` it shells out to resolve.
        tmux new-session -d -s "$SESSION" -c "$WORK_DIR" \
            "PATH=\"$NODE_BIN_DIR:\$PATH\" claude remote-control 2>&1 | tee -a \"$ACTIVITY_LOG\""
        echo "$(date '+%Y-%m-%d %H:%M') Started remote control (dir: $WORK_DIR, claude: $CLAUDE_BIN)" | tee -a "$LOG"
        exit 0
        ;;
esac
