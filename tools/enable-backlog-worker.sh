#!/bin/bash
# Turns on the backlog worker (triggers/backlog-worker.sh). Run by Daniel; a session's auto mode
# refuses to install an unattended job itself (2026-11-03). Safe to run twice.
set -e
REPO="$HOME/projects/active/claude-harness"
ln -sf "$REPO/triggers/backlog-worker.sh" "$HOME/.claude/hooks/backlog-worker.sh"
cp "$REPO/systemd/backlog-worker.service" "$REPO/systemd/backlog-worker.timer" "$HOME/.config/systemd/user/"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable --now backlog-worker.timer
systemctl --user list-timers --no-pager | grep backlog-worker
