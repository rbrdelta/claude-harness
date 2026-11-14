#!/usr/bin/env python3
"""Counts for the "What's emerging" digest (triggers/emerging-digest.sh, 2026-11-14).

The model only tags; every number in the note is computed here, so a count can be checked.

  emerging-stats.py window <bundle_dir> <days> <today YYYY-MM-DD> <items.json>
      Daniel's text from the thought scrub's daily bundles for the last <days> days, numbered.
      Text written before the window starts is dropped (a source read for the first time
      brings its whole history; that is not "the last 3 days").
  emerging-stats.py stats <items.json> <tags.json> <history.json> <stats.json>
      tags.json from the tagging pass: {"items": [{"i", "topics": [...]}],
                                        "concepts": [{"name", "terms": [...]}]}
      Threads = distinct places (a session, a note, a conversation). Topics in HIDDEN are
      never counted or shown. Change is against the last recorded run.
  emerging-stats.py record <stats.json> <history.json>
      Append this run's topic and concept counts (the next run compares against them and
      reuses the topic names, so the counts stay comparable).
"""
import json
import os
import re
import sys
from datetime import date, timedelta

HIDDEN = {"Personal (not shown)", "Day job (not shown)"}


def load(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)


def window(bundle_dir, days, today, out):
    end = date.fromisoformat(today)
    start = end - timedelta(days=int(days) - 1)
    items = []
    for n in range(int(days)):
        d = (start + timedelta(days=n)).isoformat()
        for x in load(os.path.join(bundle_dir, f"bundle-{d}.json"), []):
            written = (x.get("written") or "")[:10]
            if written and written < (start - timedelta(days=1)).isoformat():
                continue
            items.append({"i": len(items), "source": x["source"], "where": x["where"],
                          "written": written, "text": x["text"]})
    save(out, items)
    print(json.dumps({"items": len(items), "start": start.isoformat(), "end": today}))


def stats(items_path, tags_path, history_path, out):
    items = load(items_path, [])
    tags = load(tags_path, {})
    history = load(history_path, [])
    prev = history[-1] if history else None
    by_i = {t["i"]: [n for n in t.get("topics", [])] for t in tags.get("items", [])}
    shown = [x for x in items if not set(by_i.get(x["i"], [])) & HIDDEN]

    topics = {}
    for x in shown:
        for name in by_i.get(x["i"], []):
            t = topics.setdefault(name, {"threads": set(), "items": 0})
            t["threads"].add(x["where"])
            t["items"] += 1
    rows = []
    for name, t in topics.items():
        before = (prev or {}).get("topics", {}).get(name)
        rows.append({"name": name, "threads": len(t["threads"]), "items": t["items"], "prev": before,
                     "change": None if before is None else len(t["threads"]) - before})
    rows.sort(key=lambda r: (-r["threads"], -r["items"], r["name"]))

    concepts = []
    for c in tags.get("concepts", []):
        terms = [t for t in c.get("terms", []) if t.strip()]
        if not terms:
            continue
        rx = re.compile("|".join(r"\b" + re.escape(t) + r"\b" for t in terms), re.I)
        mentions, threads = 0, set()
        for x in shown:
            k = len(rx.findall(x["text"]))
            if k:
                mentions += k
                threads.add(x["where"])
        if mentions:
            concepts.append({"name": c["name"], "terms": terms, "mentions": mentions, "threads": len(threads)})
    concepts.sort(key=lambda c: -c["mentions"])

    sources = {}
    for x in shown:
        sources[x["source"]] = sources.get(x["source"], 0) + 1
    names = {r["name"] for r in rows}
    result = {
        "threads": len({x["where"] for x in shown}),
        "items": len(shown),
        "by_source": sources,
        "topics": rows,
        "concepts": concepts,
        "new_topics": [r["name"] for r in rows if prev is not None and r["prev"] is None],
        "faded": sorted(n for n in (prev or {}).get("topics", {}) if n not in names),
        "untagged": len([x for x in items if x["i"] not in by_i]),
        "previous_run": (prev or {}).get("date"),
    }
    save(out, result)
    print(json.dumps({"threads": result["threads"], "topics": len(rows), "concepts": len(concepts),
                      "untagged": result["untagged"]}))


def record(stats_path, history_path):
    s = load(stats_path, {})
    history = load(history_path, [])
    history.append({"date": date.today().isoformat(), "threads": s.get("threads", 0),
                    "topics": {r["name"]: r["threads"] for r in s.get("topics", [])},
                    "concepts": {c["name"]: c["mentions"] for c in s.get("concepts", [])}})
    save(history_path, history[-60:])
    print(json.dumps({"recorded": len(history)}))


if __name__ == "__main__":
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "window" and len(args) == 4:
        window(*args)
    elif cmd == "stats" and len(args) == 4:
        stats(*args)
    elif cmd == "record" and len(args) == 2:
        record(*args)
    else:
        sys.exit(__doc__)
