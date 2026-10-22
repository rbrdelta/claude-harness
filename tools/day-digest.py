#!/usr/bin/env python3
"""What Daniel said in Claude Code sessions over the last N hours, for the overnight PM run.

Backstop for the capture rule: a to-do that came up in a session but never reached Incoming
can still be found here. Prints, per session, the first prompt and Daniel's typed messages
(not tool results, not hook output), newest session last, capped so the run stays cheap.
Scheduled runs (claude -p from the harness triggers) are skipped.

  python3 day-digest.py [--hours 26] [--max-chars 60000]
"""
import argparse, glob, json, os, time

SCHEDULED_PREFIXES = ("You are the Daily Standard", "You are Daniel's PM", "You are running as a scheduled")


def user_text(d):
    if d.get("type") != "user" or d.get("isSidechain") or d.get("isMeta"):
        return None
    c = (d.get("message") or {}).get("content")
    if isinstance(c, str):
        t = c
    elif isinstance(c, list):
        parts = [x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text"]
        if not parts:
            return None  # tool results only
        t = "\n".join(parts)
    else:
        return None
    t = t.strip()
    if not t or t.startswith("<") or t.startswith("[Request interrupted"):
        return None  # command wrappers, system reminders, interrupts
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=26)
    ap.add_argument("--max-chars", type=int, default=60000)
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"))
    a = ap.parse_args()
    cut = time.time() - a.hours * 3600
    files = sorted((f for f in glob.glob(f"{a.root}/*/*.jsonl") if os.path.getmtime(f) >= cut), key=os.path.getmtime)
    out = []
    for f in files:
        msgs, cwd, started = [], "", ""
        with open(f, errors="replace") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                t = user_text(d)
                if t is None:
                    continue
                cwd = cwd or d.get("cwd", "")
                started = started or d.get("timestamp", "")[:16].replace("T", " ")
                msgs.append(t[:1500])
        if not msgs or msgs[0].startswith(SCHEDULED_PREFIXES):
            continue
        out.append(f"## Session {started} UTC in {cwd}\n" + "\n".join(f"- {m}" for m in msgs))
    text = "\n\n".join(out)
    if len(text) > a.max_chars:
        text = "[earlier sessions cut to fit]\n" + text[-a.max_chars:]
    print(text or "No sessions in the window.")


if __name__ == "__main__":
    main()
