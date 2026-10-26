#!/usr/bin/env python3
"""What reached the vault from Daniel's other sources in the last N hours, for the scheduled PM run.

The day digest covers Claude Code sessions; this covers everything else that syncs in:
claude.ai conversations, Phone Notes and Notion pages. A note counts when its own edit time
(frontmatter `updated`, or `phone_updated` for phone notes) falls in the window; file times
are not used, because the weekly reclassify rewrites hundreds of files without changing them.
Skipped: the PM's own "PM updates" note, anything tagged personal/private/confidential,
and JPMC work examples (job-search material only, never planning input).

  python3 vault-digest.py [--hours 26] [--max-chars 60000] [--vault /mnt/c/MCP]
"""
import argparse, glob, os, re, time
from datetime import datetime

SOURCES = [("Claude-Conversations", "claude.ai conversation"), ("Phone-Notes", "phone note"), ("Notion", "Notion page")]
SKIP_TAGS = {"personal", "private", "confidential"}
PER_NOTE = 4000


def split(text):
    m = re.match(r"^---\n(.*?)\n---\n?(.*)$", text, re.S)
    return (m.group(1), m.group(2)) if m else ("", text)


def field(fm, key):
    m = re.search(rf"^{key}:[ \t]*(.*)$", fm, re.M)
    return m.group(1).strip().strip("'\"").strip() if m else ""


def edited(fm):
    v = field(fm, "phone_updated") or field(fm, "updated")
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def skipped(fm, name):
    if name.startswith("PM updates"):
        return True
    if re.search(r"^jpmc:\s*['\"]?work-example", fm, re.M):
        return True
    tags = set(re.findall(r"^\s*-\s*['\"]?#?([\w/-]+)", fm, re.M))
    return bool({t.split("/")[-1].lower() for t in tags} & SKIP_TAGS)


def clip(body):
    body = body.strip()
    if len(body) <= PER_NOTE:
        return body
    # Conversations end where decisions land: keep the opening and, mostly, the end.
    return body[:1200] + "\n[... middle cut ...]\n" + body[-(PER_NOTE - 1200):]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=26)
    ap.add_argument("--max-chars", type=int, default=60000)
    ap.add_argument("--vault", default="/mnt/c/MCP")
    a = ap.parse_args()
    cut = time.time() - a.hours * 3600
    found = []
    for folder, kind in SOURCES:
        for f in glob.glob(os.path.join(a.vault, "Sources", folder, "**", "*.md"), recursive=True):
            if "/Confidential/" in f:
                continue
            with open(f, errors="replace") as fh:
                fm, body = split(fh.read())
            t = edited(fm)
            name = os.path.basename(f)[:-3]
            if t is None or t < cut or skipped(fm, name):
                continue
            found.append((t, kind, field(fm, "title") or name, body))
    found.sort()
    out = [f"{len(found)} notes edited in the last {a.hours:g} hours (claude.ai conversations, phone notes, Notion)."]
    for t, kind, title, body in found:
        out.append(f"\n=== {kind}: {title} (edited {datetime.fromtimestamp(t).strftime('%Y-%m-%d %H:%M')}) ===\n{clip(body)}")
    text = "\n".join(out)
    if len(text) > a.max_chars:
        text = text[-a.max_chars:]  # newest last, so the cut drops the oldest
        text = "[older notes cut to fit]\n" + text[text.find("\n=== ") + 1:]
    print(text)


if __name__ == "__main__":
    main()
