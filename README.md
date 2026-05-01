# claude-harness

Daniel's personal Claude Code harness — hooks, triggers, scheduled jobs, session tracking. Ground truth for the workarounds described in the Field Notes at [rowbyroh.com/archive](https://rowbyroh.com/archive).

This is personal AI-skills practice, not a template. Paths are absolute (`/home/rbr01/`). Cron jobs reach into a vault at `/mnt/c/MCP` that isn't in this repo. Forks need rewriting, not configuration.

## What's here

```
hooks/        SessionStart, PostStop, PostToolUse — health, session stats, tool-use logging
triggers/     scheduled jobs (vault sync, weekly reviews, NorthStar check, digest)
systemd/      service + timer units for the same jobs (alt. to cron)
tasks/        task system — SCHEMA.md, compile-task.ts (compiles to headless sprint scripts)
crontab.txt   active local cron schedule (8h vault sync, 3h Notion sync, 5min remote-control health)
```

The hooks symlink in from `~/.claude/hooks/` so the running agent and the repo are the same files.

## Architecture in one line

Scheduled reasoning runs via local cron using `claude -p` (not RemoteTrigger API). Local cron is proven durable; remote triggers reserved for on-demand/mobile work only.

```
claude -p "$PROMPT" --model claude-sonnet-4-6 \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep" \
  --permission-mode bypassPermissions
```

## Field Notes that reference this repo

- [Field Note 02 — Headless Parity](https://rowbyroh.com/field-notes/headless-parity) — `~/.claude/skills/sprint/HEADLESS.md`, the System Understanding Gate built into headless prompts.
- [Field Note 05 — Batch Approval](https://rowbyroh.com/field-notes/batch-approval) — `hooks/log-tool-use.sh` + `hooks/approval-report.js`, mining permission logs for wildcard suggestions.
- [Field Note 07 — Memory and the Live Channel](https://rowbyroh.com/field-notes/memory-and-the-live-channel) — `claude-rules-audit`, a read-only audit of every layer Claude reads from.

[Field Note 01 — Conversation Sync](https://rowbyroh.com/field-notes/conversation-sync) lives in a separate repo (`rbrdelta/obsidian-mcp`).

## Standing rules

- Use local cron + `claude -p` for scheduled agent jobs; don't reach for RemoteTrigger.
- Triggers set `WORK_DIR` to the relevant project for session isolation.
- Never ship detection without remediation — verify the full trigger → detect → act → verify loop.

## Notes for outside readers

The CLAUDE.md in this repo is the operating doc the agent itself reads. The README is the orientation for humans who land here from the Field Notes.
