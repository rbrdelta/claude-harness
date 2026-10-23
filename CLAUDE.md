# Claude Harness

Agent harness infrastructure for Daniel's Claude Code setup. Hooks, triggers, scheduled agents, session tracking.

## Location

- **Repo:** `~/projects/active/claude-harness/` (GitHub: rbrdelta/claude-harness)
- **Symlinked from:** `~/.claude/hooks/` (all hooks and triggers symlink here)

## Architecture

Scheduled reasoning jobs run via local cron using `claude -p` — not RemoteTrigger API. Local cron is proven durable. Reserve remote triggers for on-demand/mobile work only.

Pattern: `claude -p "$PROMPT" --model sonnet --allowedTools "Bash,Read,Write,Edit,Glob,Grep" --permission-mode bypassPermissions`

## Cron Jobs

- `vault-sync.sh` every 8h — Claude.ai conversation sync
- `notion-sync.sh` every 3h — Notion vault sync
- `weekly-sprint-review.sh` Sun 18:00 — an Opus judge ranks undecided Notion threads, then the prep doc (threads to close, one build review in weekly rotation, subtraction candidates), then `tools/retro-window.mjs open` puts the retro in Now for Monday-Tuesday; the overnight PM run calls `retro-window.mjs expire`, which marks an unclosed retro skipped with the decisions it left open
- `weekly-northstar-check.sh` Wed 1pm — NorthStar freshness check
- `weekly-digest.sh` Sun 1pm — Weekly status rollup
- `pm-run.sh overnight` 00:00 — Daily Standard PM run (systemd user timer `pm-overnight.timer`, Persistent catch-up). Bookkeeping moved to the cloud 2026-10-22 (scheduled task into a cloud session; instructions in daily-standard `scripts/bookkeeping-prompt.md`); the laptop `pm-bookkeeping` timer is disabled, `pm-run.sh bookkeeping` still works by hand as a fallback. Bookkeeping records completions and files incoming items without reprioritizing (Sonnet); overnight is the full /pm with the vault, re-sorts work items in the Daily Standard database, writes the Master Backlog copy and the "PM updates" Phone Notes entry (Opus). Reads `tools/day-digest.py` for to-dos said in sessions but never captured. Logs `~/.claude/hooks/pm-*.log`; overdue runs flagged by `ds status` and the app's Backlog tab.

## Windows Host Tasks

- `windows/obsidian-restart.ps1` — Task Scheduler "Obsidian nightly restart", daily 04:00. Forces a full Obsidian Sync reconciliation (live upload can silently skip files; Learnings 2026-09-18). Install/update: `windows/install-obsidian-restart.ps1`. Log: `%LOCALAPPDATA%\claude-harness\obsidian-restart.log`, checked by `harness-check.sh`.

## Hooks

- `harness-check.sh` — SessionStart health check (cron, sync logs, weekly agents, bridge)
- `session-stats-hook.sh` + `session-stats.py` — PostStop session stats logging
- `log-tool-use.sh` — Tool usage logging
- `approval-report.js` — Permission approval reporting

## Session Tracking

PostStop hook parses JSONL transcripts, writes to:
- Machine log: `~/.claude/session-log.jsonl`
- Human log: `/mnt/c/MCP/Meta/Session Log.md` (vault, visible on phone)
- Analysis: `python3 ~/.claude/hooks/session-stats.py --summary --days N`

## Key Files

- `~/.claude.json` — trust settings (`hasTrustDialogAccepted` for `/home/rbr01`)
- Bridge: `tmux new -d -s claude-remote 'cd ~ && claude remote-control'`

## Standing Rules

- When adding scheduled agent jobs, use systemd user timers + `claude -p`, not RemoteTrigger API
- All triggers must set `WORK_DIR` to the relevant project directory for proper session isolation
- Never ship detection without remediation — verify the full trigger-detect-act-verify loop
