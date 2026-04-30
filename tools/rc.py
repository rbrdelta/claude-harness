#!/usr/bin/env python3
"""
rc — list and fork-resume Claude Code sessions.

Usage:
  rc                   # list live sessions
  rc ls                # alias for above
  rc ls --all          # include non-live (closed) sessions from disk
  rc info <id>         # full detail for one session
  rc resume            # interactive `claude --resume --fork-session`
  rc resume <id>       # fork-resume by sessionId or prefix (live first, then disk)

Fork-resume always uses --fork-session, so the resumed copy gets a new sessionId
and the original JSONL is left untouched. This is the safe path when picking up
a mobile session on the laptop: archive on mobile to block writes, fork locally
to avoid bridge-state drift.
"""
import json
import os
import sys
import time
from pathlib import Path

HOME = Path.home()
SESSIONS_DIR = HOME / ".claude" / "sessions"
PROJECTS_DIR = HOME / ".claude" / "projects"


def is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def load_registry():
    sessions = []
    for f in SESSIONS_DIR.glob("*.json"):
        try:
            data = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        pid = data.get("pid")
        data["_alive"] = bool(pid and is_alive(pid))
        sessions.append(data)
    return sessions


def find_jsonl(session_id: str):
    if not session_id:
        return None
    for f in PROJECTS_DIR.rglob(f"{session_id}.jsonl"):
        return f
    return None


def _extract_user_text(rec):
    msg = rec.get("message") or {}
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                return c.get("text")
    return None


def _is_real_user_msg(rec):
    """Skip system-injected user records (tool results, hook output, reminders)."""
    if rec.get("type") != "user":
        return False
    if rec.get("isMeta"):
        return False
    msg = rec.get("message") or {}
    content = msg.get("content")
    # A list-content user message is usually a tool_result, not human input
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "tool_result":
                return False
    text = _extract_user_text(rec)
    if not text:
        return False
    stripped = text.strip()
    if stripped.startswith("<system-reminder>") or stripped.startswith("<command-name>"):
        return False
    if stripped.startswith("<local-command-stdout>"):
        return False
    return True


def scan_jsonl(jsonl_path: Path):
    """Return (first_user_text, first_ts, last_user_text, last_ts, bridge_url, msg_count)."""
    if not jsonl_path or not jsonl_path.exists():
        return None, None, None, None, None, 0
    first_text = first_ts = last_text = last_ts = bridge_url = None
    msg_count = 0
    try:
        with jsonl_path.open() as fp:
            for line in fp:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if rec.get("type") == "system" and rec.get("subtype") == "bridge_status":
                    if not bridge_url:
                        bridge_url = rec.get("url")
                if _is_real_user_msg(rec):
                    text = _extract_user_text(rec)
                    ts = rec.get("timestamp")
                    if first_text is None:
                        first_text = text
                        first_ts = ts
                    last_text = text
                    last_ts = ts
                    msg_count += 1
    except OSError:
        return None, None, None, None, None, 0
    return first_text, first_ts, last_text, last_ts, bridge_url, msg_count


def fmt_age_ms(ms):
    if not ms:
        return "?"
    delta = time.time() - (ms / 1000)
    if delta < 60:
        return f"{int(delta)}s"
    if delta < 3600:
        return f"{int(delta / 60)}m"
    if delta < 86400:
        return f"{int(delta / 3600)}h"
    return f"{int(delta / 86400)}d"


def fmt_age_iso(ts):
    if not ts:
        return "?"
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        delta = time.time() - dt.timestamp()
    except (ValueError, AttributeError):
        return "?"
    if delta < 60:
        return f"{int(delta)}s"
    if delta < 3600:
        return f"{int(delta / 60)}m"
    if delta < 86400:
        return f"{int(delta / 3600)}h"
    return f"{int(delta / 86400)}d"


def truncate(s: str, n: int) -> str:
    s = s.replace("\n", " ").replace("\r", " ").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def cmd_ls(include_closed: bool = False):
    rows = []
    seen_ids = set()
    for s in load_registry():
        sid = s.get("sessionId", "")
        if not sid:
            continue
        if not include_closed and not s["_alive"]:
            continue
        seen_ids.add(sid)
        jsonl = find_jsonl(sid)
        first_text, _, last_text, last_ts, bridge_url, _ = scan_jsonl(jsonl)
        bridge = bool(s.get("bridgeSessionId")) or bool(bridge_url)
        rows.append({
            "id": sid,
            "alive": s["_alive"],
            "bridge": bridge,
            "started": s.get("startedAt", 0),
            "last_ts": last_ts,
            "topic": first_text or "",
            "last": last_text or "",
        })

    if include_closed:
        for jsonl in PROJECTS_DIR.rglob("*.jsonl"):
            sid = jsonl.stem
            if sid in seen_ids or len(sid) != 36:
                continue
            first_text, _, last_text, last_ts, bridge_url, _ = scan_jsonl(jsonl)
            try:
                mtime_ms = int(jsonl.stat().st_mtime * 1000)
            except OSError:
                mtime_ms = 0
            rows.append({
                "id": sid,
                "alive": False,
                "bridge": bool(bridge_url),
                "started": mtime_ms,
                "last_ts": last_ts,
                "topic": first_text or "",
                "last": last_text or "",
            })

    rows.sort(key=lambda r: r["last_ts"] or "0", reverse=True)

    if not rows:
        print("No sessions found.")
        return

    header = f"{'AGE':<5} {'ST':<4} {'BR':<3} {'ID':<10} {'TOPIC':<48} LAST"
    print(header)
    print("-" * 120)
    for r in rows:
        state = "live" if r["alive"] else "shut"
        bridge = "yes" if r["bridge"] else "-"
        age = fmt_age_iso(r["last_ts"]) if r["last_ts"] else fmt_age_ms(r["started"])
        print(f"{age:<5} {state:<4} {bridge:<3} {r['id'][:8]:<10} {truncate(r['topic'], 48):<48} {truncate(r['last'], 40)}")


def resolve_session_id(arg: str):
    rows = load_registry()
    live_matches = [s for s in rows if s["_alive"] and s.get("sessionId", "").startswith(arg)]
    if live_matches:
        return live_matches[0]["sessionId"]
    all_matches = [s for s in rows if s.get("sessionId", "").startswith(arg)]
    if all_matches:
        return all_matches[0]["sessionId"]
    matches = list(PROJECTS_DIR.rglob(f"{arg}*.jsonl"))
    if matches:
        return matches[0].stem
    return None


def cmd_info(arg):
    sid = resolve_session_id(arg)
    if not sid:
        print(f"No session matching '{arg}'", file=sys.stderr)
        sys.exit(1)
    reg = next((s for s in load_registry() if s.get("sessionId") == sid), None)
    jsonl = find_jsonl(sid)
    first_text, first_ts, last_text, last_ts, bridge_url, msg_count = scan_jsonl(jsonl)

    print(f"sessionId:    {sid}")
    if reg:
        print(f"state:        {'live (pid ' + str(reg.get('pid')) + ')' if reg['_alive'] else 'closed'}")
        print(f"cwd:          {reg.get('cwd', '?')}")
        print(f"entrypoint:   {reg.get('entrypoint', '?')}")
        print(f"started:      {fmt_age_ms(reg.get('startedAt'))} ago")
        if reg.get("bridgeSessionId"):
            print(f"bridge id:    {reg['bridgeSessionId']} (registry)")
    else:
        print("state:        closed (no live registry entry)")
    if jsonl:
        print(f"jsonl:        {jsonl}")
        try:
            print(f"jsonl size:   {jsonl.stat().st_size:,} bytes")
        except OSError:
            pass
    print(f"messages:     {msg_count}")
    if bridge_url:
        print(f"bridge url:   {bridge_url}")
    print()
    if first_text:
        print(f"=== FIRST USER MESSAGE ({fmt_age_iso(first_ts)} ago) ===")
        print(first_text[:1500])
        if len(first_text) > 1500:
            print(f"... (+{len(first_text) - 1500} chars)")
    print()
    if last_text and last_text != first_text:
        print(f"=== LAST USER MESSAGE ({fmt_age_iso(last_ts)} ago) ===")
        print(last_text[:1500])
        if len(last_text) > 1500:
            print(f"... (+{len(last_text) - 1500} chars)")


def cmd_resume(arg=None):
    if arg is None:
        os.execvp("claude", ["claude", "--resume", "--fork-session"])
    sid = resolve_session_id(arg)
    if not sid:
        print(f"No session matching '{arg}'", file=sys.stderr)
        sys.exit(1)
    topic, _, _, _, _, _ = scan_jsonl(find_jsonl(sid))
    label = f" ({truncate(topic, 60)})" if topic else ""
    print(f"Fork-resuming from {sid[:8]}{label}", file=sys.stderr)
    print("→ Archive this session in the mobile app to lock writes.", file=sys.stderr)
    os.execvp("claude", ["claude", "--resume", sid, "--fork-session"])


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "ls"
    if cmd == "ls":
        cmd_ls(include_closed="--all" in args[1:])
    elif cmd == "info":
        if len(args) < 2:
            print("Usage: rc info <id-or-prefix>", file=sys.stderr)
            sys.exit(2)
        cmd_info(args[1])
    elif cmd == "resume":
        cmd_resume(args[1] if len(args) > 1 else None)
    elif cmd in ("-h", "--help", "help"):
        print(__doc__.strip())
    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
