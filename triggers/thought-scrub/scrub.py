#!/usr/bin/env python3
"""Collect text Daniel wrote since the last run, across every source.

Writes a bundle (JSON list of {source, where, written, text}) of only the new
text. A source counts as new when its content differs from the snapshot taken
on the previous run; for notes that grow by appended entries only the added
lines are kept.

  scrub.py collect <bundle.json>   find new text, write bundle (state untouched)
  scrub.py commit                  accept the pending snapshots as seen
  scrub.py baseline                mark everything as seen without a bundle

State lives in ~/.claude/thought-scrub/. Nothing under /mnt/c/MCP/Confidential
is ever read.
"""
import difflib
import glob
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

VAULT = "/mnt/c/MCP"
STATE_DIR = os.path.expanduser("~/.claude/thought-scrub")
SNAP_DIR = os.path.join(STATE_DIR, "snapshots")
PENDING = os.path.join(STATE_DIR, "pending.json")
CODE_PROJECTS = os.path.expanduser("~/.claude/projects")
# The scrub's own headless runs work here, so their transcripts are skipped.
SCRUB_WORK_DIR = os.path.join(STATE_DIR, "work")

# Notion database rows that are not Daniel's writing: the review list itself
# and the two backlog databases the harness pushes into.
SKIP_NOTION_DATABASES = {
    "3f48b1a8-eec5-81fb-be43-ea85720ec902",  # Thought Review
    "3438b1a8-eec5-813d-842e-c3eb7b1f6ed2",  # Backlog - Active
    "3438b1a8-eec5-8102-81cd-c02d7f927334",  # Backlog - Archive
}
MIN_CHARS = 40  # shorter additions are edits, not thoughts


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z_]+):\s*(.*)$", line)
        if km:
            meta[km.group(1)] = km.group(2).strip().strip("'\"")
    return meta, text[m.end():]


def daniel_turns_claude_ai(body):
    """Keep only Daniel's turns from an exported Claude.ai conversation."""
    out, keep = [], False
    for line in body.splitlines():
        if line.startswith("**You**"):
            keep = True
            continue
        if line.startswith("**Claude**"):
            keep = False
            continue
        if keep and line.strip() != "---":
            out.append(line)
    return "\n".join(out)


def vault_docs():
    """Yield (key, source, where, written, text) for every vault document."""
    def notes(pattern, source):
        for path in glob.glob(os.path.join(VAULT, pattern)):
            if "/Confidential/" in path:
                continue
            try:
                raw = open(path, encoding="utf-8").read()
            except OSError:
                continue
            meta, body = frontmatter(raw)
            if meta.get("notion_database") in SKIP_NOTION_DATABASES:
                continue
            if meta.get("jpmc") == "work-example":
                continue  # job-search material only, never content
            if source == "Claude.ai":
                body = daniel_turns_claude_ai(body)
            written = (meta.get("updated") or meta.get("created") or "")[:10]
            yield path, source, os.path.basename(path)[:-3], written, body

    yield from notes("Sources/Notion/*.md", "Notion")
    yield from notes("Sources/Apple-Notes/*.md", "iPhone")
    yield from notes("Sources/Claude-Conversations/*.md", "Claude.ai")
    # Obsidian: only notes Daniel writes directly (vault root). Inbox is
    # mostly Claude-written and is deliberately excluded.
    yield from notes("*.md", "Obsidian")


def code_turns():
    """Yield (key, source, where, written, text) per human-typed Code turn."""
    skip_dir = SCRUB_WORK_DIR.replace("/", "-").replace(".", "-")
    for path in glob.glob(os.path.join(CODE_PROJECTS, "*", "*.jsonl")):
        if os.path.basename(os.path.dirname(path)) == skip_dir:
            continue
        try:
            fh = open(path, encoding="utf-8")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                # Messages typed while Claude is mid-task are stored as a
                # queued_command attachment, not a user record.
                att = d.get("attachment")
                if d.get("type") == "attachment" and isinstance(att, dict) \
                        and att.get("type") == "queued_command" \
                        and (att.get("origin") or {}).get("kind") == "human":
                    d = {**d, "message": {"content": att.get("prompt", "")},
                         "timestamp": att.get("timestamp") or d.get("timestamp", ""),
                         "sessionId": d.get("session_id", "")}
                elif d.get("type") != "user" or d.get("toolUseResult") or d.get("isMeta"):
                    continue
                elif (d.get("origin") or {}).get("kind") != "human":
                    continue
                content = d.get("message", {}).get("content")
                if isinstance(content, list):
                    content = "\n".join(c.get("text", "") for c in content
                                        if isinstance(c, dict) and c.get("type") == "text")
                if not isinstance(content, str) or content.lstrip().startswith("<"):
                    continue
                key = f"code:{d.get('uuid')}"
                where = f"Claude Code session {d.get('sessionId', '')[:8]} ({os.path.basename(d.get('cwd', ''))})"
                yield key, "Claude Code", where, d.get("timestamp", "")[:10], content


def snap_path(key):
    return os.path.join(SNAP_DIR, hashlib.sha1(key.encode()).hexdigest() + ".txt")


def added_text(old, new):
    """Lines present in new but not old (appended entries, edits)."""
    if old is None:
        return new
    added = [l[2:] for l in difflib.ndiff(old.splitlines(), new.splitlines()) if l.startswith("+ ")]
    return "\n".join(added)


def collect(bundle_path):
    os.makedirs(SNAP_DIR, exist_ok=True)
    bundle, pending = [], {}
    for key, source, where, written, text in list(vault_docs()) + list(code_turns()):
        sp = snap_path(key)
        old = open(sp, encoding="utf-8").read() if os.path.exists(sp) else None
        if old == text:
            continue
        pending[sp] = text
        new = added_text(old, text).strip()
        if len(new) >= MIN_CHARS:
            bundle.append({"source": source, "where": where, "written": written, "text": new})
    json.dump(bundle, open(bundle_path, "w"), ensure_ascii=False, indent=1)
    json.dump(pending, open(PENDING, "w"), ensure_ascii=False)
    print(json.dumps({"changed": len(pending), "new_items": len(bundle),
                      "by_source": {s: sum(1 for b in bundle if b["source"] == s)
                                    for s in sorted({b["source"] for b in bundle})}}))


def commit():
    if not os.path.exists(PENDING):
        return
    for sp, text in json.load(open(PENDING)).items():
        with open(sp, "w", encoding="utf-8") as fh:
            fh.write(text)
    os.remove(PENDING)


def source_freshness():
    """Days since each source last produced anything, for the daily message."""
    now = datetime.now(timezone.utc).timestamp()
    def newest(pattern):
        files = glob.glob(pattern)
        return (now - max(os.path.getmtime(f) for f in files)) / 86400 if files else None
    return {
        "iPhone export": newest("/mnt/c/Users/deero/iCloudDrive/NotesExport/*"),
        "Claude.ai sync": newest(os.path.join(VAULT, "Sources/Claude-Conversations/*.md")),
        "Notion sync": newest(os.path.join(VAULT, "Sources/Notion/*.md")),
    }


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "collect":
        collect(sys.argv[2])
    elif cmd == "commit":
        commit()
    elif cmd == "baseline":
        collect(os.devnull)
        commit()
        print("baseline: everything marked seen")
    elif cmd == "freshness":
        print(json.dumps(source_freshness()))
    else:
        sys.exit(__doc__)
