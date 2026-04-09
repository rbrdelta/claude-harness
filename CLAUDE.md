# Claude Harness

Agent harness infrastructure for Daniel's Claude Code setup. Hooks, triggers, scheduled agents, session tracking.

## Location

- **Repo:** `~/projects/active/claude-harness/` (GitHub: rbrdelta/claude-harness)
- **Symlinked from:** `~/.claude/hooks/` (all hooks and triggers symlink here)

## Architecture

Scheduled reasoning jobs run via local cron using `claude -p` — not RemoteTrigger API. Local cron is proven durable. Reserve remote triggers for on-demand/mobile work only.

Pattern: `claude -p "$PROMPT" --model claude-sonnet-4-6 --allowedTools "Bash,Read,Write,Edit,Glob,Grep" --permission-mode bypassPermissions`

## Cron Jobs

- `vault-sync.sh` every 8h — Claude.ai conversation sync
- `notion-sync.sh` every 3h — Notion vault sync
- `apple-sync.sh` — Apple Notes sync (manual trigger after iPhone Shortcut)
- `weekly-sprint-review.sh` Fri 10pm — /architect sprint assessment
- `weekly-northstar-check.sh` Wed 1pm — NorthStar freshness check
- `weekly-digest.sh` Sun 1pm — Weekly status rollup

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

## Task System

- Schema: `tasks/SCHEMA.md`
- Compiler: `compile-task.ts`

## Key Files

- `~/.claude.json` — trust settings (`hasTrustDialogAccepted` for `/home/rbr01`)
- Bridge: `tmux new -d -s claude-remote 'cd ~ && claude remote-control'`

## Standing Rules

- When adding scheduled agent jobs, use local cron + `claude -p`, not RemoteTrigger API
- All triggers must set `WORK_DIR` to the relevant project directory for proper session isolation
- Never ship detection without remediation — verify the full trigger-detect-act-verify loop
