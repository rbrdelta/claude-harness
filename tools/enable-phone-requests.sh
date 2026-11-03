#!/bin/bash
# Turns on the @Claude phone-request pickup (triggers/phone-requests.sh). Run by Daniel; a session's auto mode
# refuses to install an unattended job itself (2026-11-03). Safe to run twice.
set -e
REPO="$HOME/projects/active/claude-harness"
ln -sf "$REPO/triggers/phone-requests.sh" "$HOME/.claude/hooks/phone-requests.sh"
cp "$REPO/systemd/phone-requests.service" "$REPO/systemd/phone-requests.timer" "$HOME/.config/systemd/user/"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user daemon-reload
systemctl --user enable --now phone-requests.timer
systemctl --user list-timers --no-pager | grep phone-requests
