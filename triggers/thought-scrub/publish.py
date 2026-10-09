#!/usr/bin/env python3
"""Push candidates to the Notion review list, ping Telegram, track clicks.

  publish.py rows <candidates.json> <batch>   add rows (batch: Daily|Historical)
  publish.py ping <new_count> [warning ...]   send the Telegram ping with a tracked link
  publish.py clicks                           record clicks on earlier pings
  publish.py stats                            print backlog numbers as JSON

Every call prints one JSON line so run.sh can log it.
"""
import json
import os
import secrets
import sys
import urllib.request
from datetime import datetime, timezone

STATE_DIR = os.path.expanduser("~/.claude/thought-scrub")
PINGS = os.path.join(STATE_DIR, "pings.jsonl")
NOTION_DB = "3f48b1a8-eec5-81fb-be43-ea85720ec902"
LINK_BASE = "https://thought-link.daily-standard.workers.dev/r/"
CF_ACCOUNT = "47c2b77ffaacdc3fd03bf41c8248bd20"
CF_D1 = "14275d62-4911-45fa-b9da-32caa56f148a"
TG_CHAT_ID = "8691823610"


def secret(path, key=None):
    text = open(os.path.expanduser(path)).read()
    if key is None:
        return text.strip()
    for line in text.splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{key} missing from {path}")


def http(method, url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b"{}")


def notion(method, path, body=None):
    return http(method, "https://api.notion.com" + path,
                {"Authorization": "Bearer " + secret("~/.notion_token"),
                 "Notion-Version": "2022-06-28"}, body)


def text_prop(s):
    s = s or ""
    # Notion caps each rich-text chunk at 2000 characters.
    return {"rich_text": [{"type": "text", "text": {"content": s[i:i + 2000]}}
                          for i in range(0, min(len(s), 6000), 2000)]}


def add_rows(path, batch):
    rows = json.load(open(path))
    added = 0
    for r in rows:
        props = {
            "Thought": {"title": [{"type": "text", "text": {"content": (r.get("thought") or "")[:200]}}]},
            "Quote": text_prop(r.get("quote")),
            "Source": {"select": {"name": r["source"]}},
            "Where": text_prop(r.get("where")),
            "Strength": {"select": {"name": r.get("strength", "Seed")}},
            "Flags": {"multi_select": [{"name": f} for f in r.get("flags", [])]},
            "Batch": {"select": {"name": batch}},
        }
        written = (r.get("written") or "")[:10]
        if len(written) == 10:
            props["Written"] = {"date": {"start": written}}
        notion("POST", "/v1/pages", {"parent": {"database_id": NOTION_DB}, "properties": props})
        added += 1
    print(json.dumps({"rows_added": added, "batch": batch}))


def stats():
    open_rows, decided, cursor = [], {}, None
    while True:
        body = {"page_size": 100, **({"start_cursor": cursor} if cursor else {})}
        res = notion("POST", f"/v1/databases/{NOTION_DB}/query", body)
        for p in res["results"]:
            d = (p["properties"]["Decision"]["select"] or {}).get("name")
            if d:
                decided[d] = decided.get(d, 0) + 1
            else:
                open_rows.append(p["created_time"])
        if not res.get("has_more"):
            break
        cursor = res["next_cursor"]
    now = datetime.now(timezone.utc)
    oldest = min(open_rows) if open_rows else None
    oldest_days = (now - datetime.fromisoformat(oldest.replace("Z", "+00:00"))).days if oldest else 0
    return {"open": len(open_rows), "decided": decided, "oldest_open_days": oldest_days}


def ping(new_count, warnings):
    s = stats()
    ping_id = datetime.now().strftime("%Y%m%d") + "-" + secrets.token_hex(3)
    lines = [f"{new_count} new thought{'s' if new_count != 1 else ''} to review ({s['open']} waiting).",
             LINK_BASE + ping_id]
    lines += warnings
    token = secret("~/.claude/channels/telegram/.env", "TELEGRAM_BOT_TOKEN")
    http("POST", f"https://api.telegram.org/bot{token}/sendMessage", {},
         {"chat_id": TG_CHAT_ID, "text": "\n".join(lines), "disable_web_page_preview": True})
    with open(PINGS, "a") as fh:
        fh.write(json.dumps({"ping_id": ping_id, "sent_at": datetime.now(timezone.utc).isoformat(),
                             "new": new_count, "open": s["open"]}) + "\n")
    print(json.dumps({"ping_id": ping_id, "new": new_count, **s}))


def clicks():
    """Fill in first-click time for pings that don't have one yet."""
    if not os.path.exists(PINGS):
        print(json.dumps({"pings": 0}))
        return
    pings = [json.loads(l) for l in open(PINGS) if l.strip()]
    token = secret("~/.config/cloudflare/env", "CLOUDFLARE_API_TOKEN")
    res = http("POST", f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/d1/database/{CF_D1}/query",
               {"Authorization": "Bearer " + token},
               {"sql": "SELECT ping_id, MIN(clicked_at) AS first FROM clicks GROUP BY ping_id"})
    first = {r["ping_id"]: r["first"] for r in res["result"][0]["results"]}
    for p in pings:
        if p["ping_id"] in first and not p.get("clicked_at"):
            p["clicked_at"] = first[p["ping_id"]]
            sent = datetime.fromisoformat(p["sent_at"])
            p["hours_to_click"] = round((datetime.fromisoformat(first[p["ping_id"]].replace("Z", "+00:00")) - sent).total_seconds() / 3600, 1)
    with open(PINGS, "w") as fh:
        fh.writelines(json.dumps(p) + "\n" for p in pings)
    clicked = [p for p in pings if p.get("clicked_at")]
    print(json.dumps({"pings": len(pings), "clicked": len(clicked),
                      "unclicked": [p["ping_id"] for p in pings if not p.get("clicked_at")][-5:]}))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "rows":
        add_rows(sys.argv[2], sys.argv[3])
    elif cmd == "ping":
        ping(int(sys.argv[2]), sys.argv[3:])
    elif cmd == "clicks":
        clicks()
    elif cmd == "stats":
        print(json.dumps(stats()))
    else:
        sys.exit(__doc__)
