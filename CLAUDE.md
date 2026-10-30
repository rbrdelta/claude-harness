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
- `weekly-sprint-review.sh` Sun 18:00 — an Opus pass pulls the week's build moments (both sides, at most 8) into a file for the build review; `thought-synthesis.sh` runs (below); then the Opus prep doc (2026-10-29: did we move the needle on the NorthStar priorities, every project touched this week reviewed for right/wrong/learned, subtraction candidates, what is emerging from the synthesis; Claude's read allowed, marked), then `tools/retro-window.mjs open` puts the retro in Now for Monday-Tuesday; the overnight PM run calls `retro-window.mjs expire`, which marks an unclosed retro skipped with the decisions it left open — unless Daniel has put it into a block on the Daily Standard
- `thought-synthesis.sh [limit|triage]` (called by the prep; by hand for the backlog) — up to 40 open Notion Thought Review rows, oldest first, Personal-flagged left out: a Sonnet pass traces each to its source and what came of it, an Opus pass folds them into the vault note `Inbox/Thought Synthesis.md` (clusters, his quotes, Claude's read, done list), then `publish.py apply` marks each row Closed (done or covered by a rule, the thesis or a build, with where) or Synthesized (with its place). The note keeps at most five live themes, the only part the prep shows; the rest is venture leads, reference and the closed list. `triage` re-sorts every Synthesized row (2026-10-30). Log `~/.claude/hooks/thought-synthesis.log`
- `retro-launch.sh` every 5 min (systemd `retro-launch.timer`, 2026-10-28) — once Daniel puts a retro item into a block on the Daily Standard (`ds slotted retro-`), starts one laptop session in tmux (`retro-<date>`) with Remote Control on, named for the slot, `/retro` already run to the first question; Telegram sends the link. Retro only. Log `~/.claude/hooks/retro-launch.log`, state `retro-launch-state.json`
- `weekly-northstar-check.sh` Wed 1pm — NorthStar freshness check
- `weekly-digest.sh` Sun 1pm — Weekly status rollup
- `pm-run.sh overnight` every 6 hours (00, 06, 12, 18; was midnight only until 2026-10-26) — Daily Standard full PM run (systemd user timer `pm-overnight.timer`, Persistent catch-up; a no-change run writes no PM updates entry). Reads sessions (`tools/day-digest.py`) and the vault sources that synced in (`tools/vault-digest.py`: claude.ai, phone notes, Notion) and scores items on the Runway criteria, never by NorthStar bucket order (2026-10-26). Bookkeeping is a once-a-day cloud failsafe at 14:35 since 2026-10-26 (scheduled task "Daily Standard bookkeeping failsafe" into a cloud session; instructions in daily-standard `scripts/bookkeeping-prompt.md`); the laptop `pm-bookkeeping` timer is disabled, `pm-run.sh bookkeeping` still works by hand as a fallback. Bookkeeping records completions and files incoming items without reprioritizing (Sonnet); overnight is the full /pm with the vault, re-sorts work items in the Daily Standard database, writes the Master Backlog copy and the "PM updates" Phone Notes entry (Opus). Reads `tools/day-digest.py` for to-dos said in sessions but never captured. Logs `~/.claude/hooks/pm-*.log`; overdue runs flagged by `ds status` and the app's Backlog tab.
- `job-scan.sh` Mon 07:00 — job search postings scan, no model (systemd `job-scan.timer`, Persistent). Runs `job_scan.py` in the vault job-search folder; writes the vault note `job search/2026 ai pm/Job scan — weekly.md`; never writes Excel. Session start names new/closed postings for 3 days.
- `job-news.sh` first Monday 08:00 — company and thesis news, Opus + web search (systemd `job-news.timer`). Writes `job search/2026 ai pm/Company and thesis news — YYYY-MM.md`.

## Windows Host Tasks

- `windows/obsidian-restart.ps1` — Task Scheduler "Obsidian nightly restart", daily 04:00. Forces a full Obsidian Sync reconciliation (live upload can silently skip files; Learnings 2026-09-18). Install/update: `windows/install-obsidian-restart.ps1`. Log: `%LOCALAPPDATA%\claude-harness\obsidian-restart.log`, checked by `harness-check.sh`.

## Hooks

- `harness-check.sh` — SessionStart health check (cron, sync logs, weekly agents, bridge)
- `session-stats-hook.sh` + `session-stats.py` — PostStop session stats logging
- `log-tool-use.sh` — Tool usage logging
- `approval-report.js` — Permission approval reporting
- `capabilities-gate.py` — keeps every project's capabilities file current (2026-10-23). PreToolUse (Bash): refuses a `git push` that changes code without updating the capabilities file (`CAPABILITIES.md` in the repo, or for public repos the vault file `Sources/Capabilities/<name>.md` with `checked_commit` set to a pushed commit); a commit line `capabilities: no change` passes on purpose; README/CLAUDE.md/NEXT-SESSION.md/notes-only pushes pass; an unregistered repo under `~/projects/active/` can't push. PostToolUse: copies repo files into the vault after the push lands. SessionStart `--audit`: names projects whose code moved past their file. Registry: `capabilities-projects.json`. A bug in the gate lets the push through with an error, never wedges it. Tests: `test/test_capabilities_gate.py`

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
