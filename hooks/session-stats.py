#!/usr/bin/env python3
"""
Session stats parser for Claude Code.
Parses JSONL transcripts to extract usage metrics per session.

Usage:
  # Parse a single session (used by PostStop hook)
  python3 session-stats.py --session <session-id> --project-dir <dir>

  # Backfill all sessions
  python3 session-stats.py --backfill

  # Print summary of recent sessions
  python3 session-stats.py --summary [--days N]
"""

import json
import os
import sys
import glob
import argparse
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from pathlib import Path

# --- Config ---
CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
JSONL_LOG = CLAUDE_DIR / "session-log.jsonl"
VAULT_LOG = Path("/mnt/c/MCP/Meta/Session Log.md")
IDLE_THRESHOLD_SEC = 600  # 10 minutes — gaps longer than this are "idle"

# API pricing per million tokens (for cost estimation)
# Opus 4.6: $5/MTok input, $25/MTok output (verified from Anthropic pricing Feb 2026)
# Cache read: 10% of input. Cache write (1hr ephemeral): 2x input.
# Premium tier (>200K input): $10/MTok input, but we use standard for estimation.
PRICING = {
    "opus": {"input": 5.0, "output": 25.0, "cache_read": 0.50, "cache_create": 10.0},
    "sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_create": 6.0},
    "haiku": {"input": 0.80, "output": 4.0, "cache_read": 0.08, "cache_create": 1.60},
}


def model_family(model_name):
    if "opus" in model_name:
        return "opus"
    elif "sonnet" in model_name:
        return "sonnet"
    elif "haiku" in model_name:
        return "haiku"
    return "opus"  # default


def parse_timestamp(ts):
    """Parse timestamp from JSONL entry (ISO string or epoch ms)."""
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    elif isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
    return None


def compute_active_time(all_msg_timestamps):
    """
    Compute active time by summing inter-message gaps < IDLE_THRESHOLD.
    Uses ALL message timestamps (user + assistant + tool results) so autonomous
    work stretches (Claude working without user input) count as active.
    Returns active seconds.
    """
    if len(all_msg_timestamps) < 2:
        return 0

    sorted_ts = sorted(all_msg_timestamps)
    active_sec = 0
    for i in range(1, len(sorted_ts)):
        gap = (sorted_ts[i] - sorted_ts[i - 1]).total_seconds()
        if gap < IDLE_THRESHOLD_SEC:
            active_sec += gap
    return active_sec


def classify_tool(tool_name):
    """Classify a tool call into a category."""
    if tool_name in ("Read",):
        return "read"
    elif tool_name in ("Edit",):
        return "edit"
    elif tool_name in ("Write",):
        return "write"
    elif tool_name in ("Bash",):
        return "bash"
    elif tool_name in ("Glob", "Grep"):
        return "search"
    elif tool_name in ("Agent",):
        return "agent"
    elif tool_name in ("WebSearch", "WebFetch"):
        return "web"
    elif tool_name.startswith("mcp__obsidian__"):
        return "vault"
    elif tool_name.startswith("mcp__"):
        return "mcp_other"
    elif tool_name in ("TaskCreate", "TaskUpdate", "TaskGet", "TaskList"):
        return "task"
    elif tool_name in ("Skill",):
        return "skill"
    else:
        return "other"


def parse_session(jsonl_path):
    """Parse a single session JSONL file and return metrics dict."""
    metrics = {
        "session_id": Path(jsonl_path).stem,
        "jsonl_path": str(jsonl_path),
        "model": None,
        "project": None,
        "cwd": None,
        "first_user_message": "",
        # Timestamps
        "first_ts": None,
        "last_ts": None,
        "wall_clock_sec": 0,
        "active_sec": 0,
        # Token counts
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_create_tokens": 0,
        # Message counts
        "user_messages": 0,
        "assistant_messages": 0,
        # Tool usage
        "tool_calls": 0,
        "tool_breakdown": defaultdict(int),
        # Output artifacts
        "files_edited": set(),
        "files_created": set(),
        "git_commits": 0,
        "vault_notes_created": 0,
        "subagents_spawned": 0,
        # Qualitative
        "skills_used": [],
        "commands_used": [],
    }

    user_timestamps = []
    all_timestamps = []

    try:
        with open(jsonl_path) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                except (json.JSONDecodeError, ValueError):
                    continue

                entry_type = obj.get("type")
                ts = parse_timestamp(obj.get("timestamp"))
                if ts:
                    all_timestamps.append(ts)

                # Extract project/cwd from any entry that has it
                if not metrics["project"] and obj.get("sessionId"):
                    parent = str(Path(jsonl_path).parent.name)
                    metrics["project"] = parent
                if not metrics["cwd"] and obj.get("cwd"):
                    metrics["cwd"] = obj["cwd"]

                # --- User messages ---
                if entry_type == "user":
                    metrics["user_messages"] += 1
                    if ts:
                        user_timestamps.append(ts)
                    msg = obj.get("message", {})
                    if isinstance(msg, dict):
                        content = msg.get("content", "")
                        if isinstance(content, str) and metrics["user_messages"] <= 2 and not metrics["first_user_message"]:
                            # Skip skill/command expansions, get the actual user prompt
                            if not content.startswith("Base directory for this skill"):
                                import re
                                clean = re.sub(r"<[^>]+>", "", content).strip()
                                metrics["first_user_message"] = clean[:120].replace("\n", " ")

                # --- Assistant messages ---
                elif entry_type == "assistant":
                    metrics["assistant_messages"] += 1
                    msg = obj.get("message", {})
                    if isinstance(msg, dict):
                        # Token usage
                        usage = msg.get("usage", {})
                        if usage:
                            metrics["input_tokens"] += usage.get("input_tokens", 0)
                            metrics["output_tokens"] += usage.get("output_tokens", 0)
                            metrics["cache_read_tokens"] += usage.get("cache_read_input_tokens", 0)
                            metrics["cache_create_tokens"] += usage.get("cache_creation_input_tokens", 0)

                        # Model
                        if not metrics["model"] and msg.get("model"):
                            metrics["model"] = msg["model"]

                        # Tool calls in content
                        content = msg.get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if not isinstance(block, dict):
                                    continue
                                if block.get("type") == "tool_use":
                                    tool_name = block.get("name", "unknown")
                                    metrics["tool_calls"] += 1
                                    metrics["tool_breakdown"][classify_tool(tool_name)] += 1

                                    tool_input = block.get("input", {})

                                    # Track file edits
                                    if tool_name == "Edit" and tool_input.get("file_path"):
                                        metrics["files_edited"].add(tool_input["file_path"])

                                    # Track file creates
                                    elif tool_name == "Write" and tool_input.get("file_path"):
                                        metrics["files_created"].add(tool_input["file_path"])

                                    # Track git commits
                                    elif tool_name == "Bash":
                                        cmd = tool_input.get("command", "")
                                        if "git commit" in cmd and "--amend" not in cmd:
                                            metrics["git_commits"] += 1

                                    # Track vault notes
                                    elif tool_name == "mcp__obsidian__create_note":
                                        metrics["vault_notes_created"] += 1

                                    # Track agents
                                    elif tool_name == "Agent":
                                        metrics["subagents_spawned"] += 1

                                    # Track skills
                                    elif tool_name == "Skill":
                                        skill = tool_input.get("skill", "")
                                        if skill and skill not in metrics["skills_used"]:
                                            metrics["skills_used"].append(skill)

    except (IOError, OSError) as e:
        print(f"Error reading {jsonl_path}: {e}", file=sys.stderr)
        return None

    # Compute timestamps
    if all_timestamps:
        metrics["first_ts"] = min(all_timestamps)
        metrics["last_ts"] = max(all_timestamps)
        metrics["wall_clock_sec"] = (metrics["last_ts"] - metrics["first_ts"]).total_seconds()

    # Compute active time — uses all message timestamps so autonomous work counts
    metrics["active_sec"] = compute_active_time(all_timestamps)

    # Convert sets to counts for serialization
    metrics["files_edited_count"] = len(metrics["files_edited"])
    metrics["files_created_count"] = len(metrics["files_created"])
    metrics["files_edited_list"] = sorted(metrics["files_edited"])
    metrics["files_created_list"] = sorted(metrics["files_created"])

    # API cost estimate
    family = model_family(metrics["model"] or "opus")
    prices = PRICING[family]
    metrics["api_cost_estimate"] = round(
        metrics["input_tokens"] / 1_000_000 * prices["input"]
        + metrics["output_tokens"] / 1_000_000 * prices["output"]
        + metrics["cache_read_tokens"] / 1_000_000 * prices["cache_read"]
        + metrics["cache_create_tokens"] / 1_000_000 * prices["cache_create"],
        2,
    )

    return metrics


def serialize_metrics(m):
    """Convert metrics dict to JSON-serializable form."""
    out = dict(m)
    out.pop("files_edited", None)
    out.pop("files_created", None)
    out["tool_breakdown"] = dict(out["tool_breakdown"])
    if out["first_ts"]:
        out["first_ts"] = out["first_ts"].isoformat()
    if out["last_ts"]:
        out["last_ts"] = out["last_ts"].isoformat()
    return out


def format_duration(seconds):
    """Format seconds into human-readable duration."""
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        return f"{int(seconds / 60)}m"
    else:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        return f"{h}h {m}m"


def format_vault_entry(m):
    """Format a single session as a markdown block for the vault log."""
    date_str = m["first_ts"].strftime("%Y-%m-%d %H:%M") if m["first_ts"] else "unknown"
    wall = format_duration(m["wall_clock_sec"])
    active = format_duration(m["active_sec"])
    model_short = model_family(m["model"] or "unknown")
    label = m["first_user_message"][:80] if m["first_user_message"] else "(no label)"

    # Tool breakdown summary
    tb = m["tool_breakdown"]
    tool_summary_parts = []
    for cat in ["edit", "write", "read", "bash", "search", "agent", "vault", "web", "skill"]:
        if tb.get(cat, 0) > 0:
            tool_summary_parts.append(f"{tb[cat]} {cat}")
    tool_summary = ", ".join(tool_summary_parts) if tool_summary_parts else "none"

    # Artifacts
    artifacts = []
    if m["files_edited_count"] > 0:
        artifacts.append(f"{m['files_edited_count']} files edited")
    if m["files_created_count"] > 0:
        artifacts.append(f"{m['files_created_count']} files created")
    if m["git_commits"] > 0:
        artifacts.append(f"{m['git_commits']} commits")
    if m["vault_notes_created"] > 0:
        artifacts.append(f"{m['vault_notes_created']} vault notes")
    if m["subagents_spawned"] > 0:
        artifacts.append(f"{m['subagents_spawned']} subagents")
    artifact_str = ", ".join(artifacts) if artifacts else "no artifacts"

    skills_str = ", ".join(m["skills_used"]) if m["skills_used"] else ""
    skills_line = f"\n- **Skills:** {skills_str}" if skills_str else ""

    return f"""### {date_str} — {label}
- **Duration:** {wall} wall / {active} active | **Model:** {model_short} | **API est:** ${m['api_cost_estimate']:.2f}
- **Turns:** {m['user_messages']} user / {m['assistant_messages']} assistant | **Tools:** {m['tool_calls']} ({tool_summary})
- **Tokens:** {m['output_tokens']:,} output, {m['input_tokens']:,} input, {m['cache_read_tokens']:,} cache read
- **Produced:** {artifact_str}{skills_line}
"""


def find_all_sessions():
    """Find all main session JSONL files (not subagents)."""
    sessions = []
    for pdir in PROJECTS_DIR.glob("*/"):
        for f in pdir.glob("*.jsonl"):
            if "/subagents/" not in str(f):
                sessions.append(f)
    return sorted(sessions, key=lambda f: f.stat().st_mtime)


def load_existing_log():
    """Load session IDs already in the JSONL log."""
    existing = set()
    if JSONL_LOG.exists():
        with open(JSONL_LOG) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    existing.add(obj.get("session_id", ""))
                except (json.JSONDecodeError, ValueError):
                    continue
    return existing


def append_jsonl(metrics):
    """Append a session's metrics to the JSONL log."""
    with open(JSONL_LOG, "a") as f:
        f.write(json.dumps(serialize_metrics(metrics)) + "\n")


def write_vault_log(all_metrics):
    """Write the full vault log from all metrics (sorted by date desc)."""
    # Sort by first_ts descending
    sorted_metrics = sorted(
        [m for m in all_metrics if m["first_ts"]],
        key=lambda m: m["first_ts"],
        reverse=True,
    )

    # Compute totals
    total_wall = sum(m["wall_clock_sec"] for m in sorted_metrics)
    total_active = sum(m["active_sec"] for m in sorted_metrics)
    total_output = sum(m["output_tokens"] for m in sorted_metrics)
    total_input = sum(m["input_tokens"] for m in sorted_metrics)
    total_cache_read = sum(m["cache_read_tokens"] for m in sorted_metrics)
    total_cache_create = sum(m["cache_create_tokens"] for m in sorted_metrics)
    total_tools = sum(m["tool_calls"] for m in sorted_metrics)
    total_commits = sum(m["git_commits"] for m in sorted_metrics)
    total_files_edited = sum(m["files_edited_count"] for m in sorted_metrics)
    total_files_created = sum(m["files_created_count"] for m in sorted_metrics)
    total_api_cost = sum(m["api_cost_estimate"] for m in sorted_metrics)
    total_user_msgs = sum(m["user_messages"] for m in sorted_metrics)
    total_asst_msgs = sum(m["assistant_messages"] for m in sorted_metrics)
    total_vault_notes = sum(m["vault_notes_created"] for m in sorted_metrics)
    total_subagents = sum(m["subagents_spawned"] for m in sorted_metrics)

    # Group by week
    weeks = defaultdict(list)
    for m in sorted_metrics:
        week_key = m["first_ts"].strftime("%Y-W%W")
        weeks[week_key].append(m)

    header = f"""---
title: Session Log
type: meta
updated: {datetime.now().strftime('%Y-%m-%d')}
---

# Session Log

Auto-generated by `session-stats.py`. Updated after each session via PostStop hook.

## Lifetime Totals

### Time
| Metric | Value |
|--------|-------|
| Sessions | {len(sorted_metrics)} |
| Wall-clock time | {format_duration(total_wall)} |
| Active time (10m threshold) | {format_duration(total_active)} |

### Tokens
| Type | Count | API Cost |
|------|-------|----------|
| Input (new context) | {total_input:,} | incl. below |
| Output (work product) | {total_output:,} | ${total_output / 1_000_000 * 25:.2f} |
| Cache read (context reuse) | {total_cache_read:,} | ${total_cache_read / 1_000_000 * 0.50:.2f} |
| Cache creation (first load) | {total_cache_create:,} | ${total_cache_create / 1_000_000 * 10:.2f} |
| **Total API equivalent** | | **${total_api_cost:,.2f}** |

### Activity
| Metric | Value |
|--------|-------|
| User messages | {total_user_msgs:,} |
| Assistant messages | {total_asst_msgs:,} |
| Tool calls | {total_tools:,} |
| Subagents spawned | {total_subagents:,} |

### Output
| Metric | Value |
|--------|-------|
| Files edited | {total_files_edited:,} |
| Files created | {total_files_created:,} |
| Git commits | {total_commits:,} |
| Vault notes created | {total_vault_notes:,} |

---

## Sessions by Week

"""

    body = ""
    for week_key in sorted(weeks.keys(), reverse=True):
        week_sessions = weeks[week_key]
        w_wall = sum(m["wall_clock_sec"] for m in week_sessions)
        w_active = sum(m["active_sec"] for m in week_sessions)
        w_output = sum(m["output_tokens"] for m in week_sessions)
        w_tools = sum(m["tool_calls"] for m in week_sessions)
        w_cost = sum(m["api_cost_estimate"] for m in week_sessions)
        w_commits = sum(m["git_commits"] for m in week_sessions)

        body += f"""## Week {week_key} — {len(week_sessions)} sessions, {format_duration(w_active)} active, {w_output:,} output tokens, ${w_cost:.2f} API est.

"""
        for m in sorted(week_sessions, key=lambda x: x["first_ts"], reverse=True):
            body += format_vault_entry(m) + "\n"

    content = header + body
    VAULT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(VAULT_LOG, "w") as f:
        f.write(content)


def backfill():
    """Parse all existing sessions and write both logs."""
    sessions = find_all_sessions()
    existing = load_existing_log()
    all_metrics = []
    new_count = 0

    # First load existing metrics from JSONL
    if JSONL_LOG.exists():
        with open(JSONL_LOG) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    # Reconstruct datetime objects for vault formatting
                    if obj.get("first_ts"):
                        obj["first_ts"] = datetime.fromisoformat(obj["first_ts"])
                    if obj.get("last_ts"):
                        obj["last_ts"] = datetime.fromisoformat(obj["last_ts"])
                    obj.setdefault("tool_breakdown", {})
                    obj.setdefault("files_edited", set())
                    obj.setdefault("files_created", set())
                    all_metrics.append(obj)
                except (json.JSONDecodeError, ValueError):
                    continue

    for sf in sessions:
        sid = sf.stem
        if sid in existing:
            continue

        metrics = parse_session(sf)
        if metrics and metrics["user_messages"] > 0:
            append_jsonl(metrics)
            all_metrics.append(metrics)
            new_count += 1
            print(f"  Parsed: {sid[:8]} — {metrics['first_ts'].strftime('%Y-%m-%d %H:%M') if metrics['first_ts'] else '?'} — {metrics['user_messages']} turns, {metrics['output_tokens']:,} output tokens")

    # Rewrite vault log with all data
    write_vault_log(all_metrics)
    print(f"\nBackfill complete: {new_count} new sessions parsed, {len(all_metrics)} total in log.")
    print(f"  JSONL: {JSONL_LOG}")
    print(f"  Vault: {VAULT_LOG}")


def log_single_session(session_id, project_dir):
    """Parse and log a single session (for PostStop hook)."""
    # Find the JSONL file
    jsonl_path = None
    for pdir in PROJECTS_DIR.glob("*/"):
        candidate = pdir / f"{session_id}.jsonl"
        if candidate.exists():
            jsonl_path = candidate
            break

    if not jsonl_path:
        print(f"Session file not found: {session_id}", file=sys.stderr)
        sys.exit(1)

    existing = load_existing_log()
    if session_id in existing:
        # Already logged — update by removing old entry and re-adding
        if JSONL_LOG.exists():
            lines = []
            with open(JSONL_LOG) as f:
                for line in f:
                    try:
                        obj = json.loads(line.strip())
                        if obj.get("session_id") != session_id:
                            lines.append(line)
                    except (json.JSONDecodeError, ValueError):
                        lines.append(line)
            with open(JSONL_LOG, "w") as f:
                f.writelines(lines)

    metrics = parse_session(jsonl_path)
    if metrics and metrics["user_messages"] > 0:
        append_jsonl(metrics)

        # Rebuild vault log from full JSONL
        all_metrics = []
        with open(JSONL_LOG) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    if obj.get("first_ts"):
                        obj["first_ts"] = datetime.fromisoformat(obj["first_ts"])
                    if obj.get("last_ts"):
                        obj["last_ts"] = datetime.fromisoformat(obj["last_ts"])
                    obj.setdefault("tool_breakdown", {})
                    obj.setdefault("files_edited", set())
                    obj.setdefault("files_created", set())
                    all_metrics.append(obj)
                except (json.JSONDecodeError, ValueError):
                    continue

        write_vault_log(all_metrics)
        print(f"Logged session {session_id[:8]}: {metrics['user_messages']} turns, {metrics['output_tokens']:,} output tokens")


def print_summary(days=7):
    """Print a summary of recent sessions."""
    if not JSONL_LOG.exists():
        print("No session log found. Run --backfill first.")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    sessions = []

    with open(JSONL_LOG) as f:
        for line in f:
            try:
                obj = json.loads(line.strip())
                if obj.get("first_ts"):
                    ts = datetime.fromisoformat(obj["first_ts"])
                    if ts >= cutoff:
                        obj["first_ts_dt"] = ts
                        sessions.append(obj)
            except (json.JSONDecodeError, ValueError):
                continue

    sessions.sort(key=lambda x: x["first_ts_dt"], reverse=True)

    print(f"\n=== Last {days} days: {len(sessions)} sessions ===\n")
    print(f"{'Date':<18} {'Active':<8} {'Turns':<7} {'Input':<10} {'Output':<10} {'Cache Rd':<12} {'Cache Wr':<12} {'Tools':<6} {'Edits':<6} {'Cost':<8} {'Label'}")
    print("-" * 130)

    for s in sessions:
        date = s["first_ts_dt"].strftime("%Y-%m-%d %H:%M")
        active = format_duration(s.get("active_sec", 0))
        turns = f"{s.get('user_messages', 0)}/{s.get('assistant_messages', 0)}"
        in_tok = f"{s.get('input_tokens', 0):,}"
        out_tok = f"{s.get('output_tokens', 0):,}"
        cache_r = f"{s.get('cache_read_tokens', 0):,}"
        cache_w = f"{s.get('cache_create_tokens', 0):,}"
        tools = str(s.get("tool_calls", 0))
        edits = str(s.get("files_edited_count", 0))
        cost = f"${s.get('api_cost_estimate', 0):.2f}"
        label = s.get("first_user_message", "")[:35]
        print(f"{date:<18} {active:<8} {turns:<7} {in_tok:<10} {out_tok:<10} {cache_r:<12} {cache_w:<12} {tools:<6} {edits:<6} {cost:<8} {label}")

    total_active = sum(s.get("active_sec", 0) for s in sessions)
    total_input = sum(s.get("input_tokens", 0) for s in sessions)
    total_output = sum(s.get("output_tokens", 0) for s in sessions)
    total_cache_r = sum(s.get("cache_read_tokens", 0) for s in sessions)
    total_cache_w = sum(s.get("cache_create_tokens", 0) for s in sessions)
    total_cost = sum(s.get("api_cost_estimate", 0) for s in sessions)
    total_tools = sum(s.get("tool_calls", 0) for s in sessions)
    total_edits = sum(s.get("files_edited_count", 0) for s in sessions)
    total_user = sum(s.get("user_messages", 0) for s in sessions)

    print(f"\n--- Period Totals ---")
    print(f"Active time:    {format_duration(total_active)}")
    print(f"User messages:  {total_user:,}")
    print(f"Input tokens:   {total_input:,}")
    print(f"Output tokens:  {total_output:,}")
    print(f"Cache read:     {total_cache_r:,}")
    print(f"Cache creation: {total_cache_w:,}")
    print(f"Tool calls:     {total_tools:,}")
    print(f"Files edited:   {total_edits:,}")
    print(f"API cost est:   ${total_cost:.2f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Claude Code session stats")
    parser.add_argument("--backfill", action="store_true", help="Parse all existing sessions")
    parser.add_argument("--session", help="Parse a single session ID")
    parser.add_argument("--project-dir", help="Project directory (for PostStop hook)")
    parser.add_argument("--summary", action="store_true", help="Print recent session summary")
    parser.add_argument("--days", type=int, default=7, help="Days to include in summary")

    args = parser.parse_args()

    if args.backfill:
        backfill()
    elif args.session:
        log_single_session(args.session, args.project_dir)
    elif args.summary:
        print_summary(args.days)
    else:
        parser.print_help()
