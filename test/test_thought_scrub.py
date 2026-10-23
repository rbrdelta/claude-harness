"""triggers/thought-scrub/scrub.py and publish.py, with the vault, transcripts and state in temp dirs
and every Notion / Telegram / Cloudflare call replaced by a recorder."""
import contextlib
import io
import json
import os
import tempfile
import unittest

from pyload import load

scrub = load("triggers/thought-scrub/scrub.py", "scrub")
pub = load("triggers/thought-scrub/publish.py", "publish")


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def quiet(fn, *a):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*a)
    return buf.getvalue()


class Pieces(unittest.TestCase):
    def test_frontmatter(self):
        meta, body = scrub.frontmatter('---\ntitle: "A"\njpmc: work-example\n---\nbody')
        self.assertEqual(meta, {"title": "A", "jpmc": "work-example"})
        self.assertEqual(body, "body")
        self.assertEqual(scrub.frontmatter("no fm"), ({}, "no fm"))

    def test_claude_ai_keeps_only_daniels_turns(self):
        body = "**You**\nmy idea\n---\n**Claude**\nits reply\n**You**\nsecond"
        self.assertEqual(scrub.daniel_turns_claude_ai(body), "my idea\nsecond")

    def test_added_text_is_only_the_new_lines(self):
        self.assertEqual(scrub.added_text(None, "a\nb"), "a\nb")
        self.assertEqual(scrub.added_text("a\nb", "a\nb\nc"), "c")


class Collect(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.saved = {k: getattr(scrub, k) for k in ("VAULT", "STATE_DIR", "SNAP_DIR", "PENDING", "CODE_PROJECTS", "SCRUB_WORK_DIR")}
        scrub.VAULT = os.path.join(self.d, "vault")
        scrub.STATE_DIR = os.path.join(self.d, "state")
        scrub.SNAP_DIR = os.path.join(scrub.STATE_DIR, "snapshots")
        scrub.PENDING = os.path.join(scrub.STATE_DIR, "pending.json")
        scrub.CODE_PROJECTS = os.path.join(self.d, "projects")
        scrub.SCRUB_WORK_DIR = os.path.join(scrub.STATE_DIR, "work")
        os.makedirs(scrub.STATE_DIR)
        v = scrub.VAULT
        long = "This is a thought long enough to count as one, honestly."
        write(f"{v}/Sources/Notion/idea.md", f"---\nupdated: 2026-10-20T01:00\n---\n{long}")
        write(f"{v}/Sources/Notion/review.md", f"---\nnotion_database: 3f48b1a8-eec5-81fb-be43-ea85720ec902\n---\n{long}")
        write(f"{v}/Sources/Claude-Conversations/work.md", f"---\njpmc: work-example\n---\n**You**\n{long}")
        write(f"{v}/Sources/Claude-Conversations/chat.md", f"**You**\n{long}\n**Claude**\nClaude said a long thing that must never be collected here.")
        write(f"{v}/Sources/Apple-Notes/short.md", "tiny")
        write(f"{v}/root note.md", long)
        write(f"{v}/Inbox/claude-written.md", long)
        p = scrub.CODE_PROJECTS
        human = {"type": "user", "uuid": "u1", "sessionId": "abcdefgh123", "cwd": "/w/proj", "timestamp": "2026-10-21T00:00:00Z",
                 "origin": {"kind": "human"}, "message": {"content": [{"type": "text", "text": long}]}}
        rows = [human,
                dict(human, uuid="u2", origin={"kind": "hook"}),
                dict(human, uuid="u3", message={"content": "<system-reminder>" + long}),
                dict(human, uuid="u4", toolUseResult={"x": 1}),
                {"type": "attachment", "uuid": "u5", "session_id": "q", "attachment": {"type": "queued_command", "origin": {"kind": "human"}, "prompt": "Queued while busy: " + long}}]
        write(f"{p}/-w-proj/s.jsonl", "\n".join(json.dumps(r) for r in rows) + "\nbad\n")
        skip = scrub.SCRUB_WORK_DIR.replace("/", "-").replace(".", "-")
        write(f"{p}/{skip}/own.jsonl", json.dumps(dict(human, uuid="u9")))

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(scrub, k, v)

    def bundle(self):
        out = os.path.join(self.d, "bundle.json")
        summary = json.loads(quiet(scrub.collect, out))
        with open(out) as fh:
            return summary, json.load(fh)

    def test_collects_only_daniels_new_writing_from_each_source(self):
        summary, b = self.bundle()
        where = sorted((x["source"], x["where"]) for x in b)
        self.assertEqual(where, [
            ("Claude Code", "Claude Code session abcdefgh (proj)"),
            ("Claude Code", "Claude Code session q ()"),
            ("Claude.ai", "chat"), ("Notion", "idea"), ("Obsidian", "root note")])
        self.assertEqual(summary["new_items"], 5)
        chat = next(x for x in b if x["where"] == "chat")
        self.assertNotIn("Claude said", chat["text"])
        self.assertEqual(next(x for x in b if x["where"] == "idea")["written"], "2026-10-20")
        queued = [x for x in b if x["text"].startswith("Queued while busy")]
        self.assertEqual(len(queued), 1, "a message typed while Claude works counts as Daniel's")

    def test_nothing_is_seen_until_commit_then_only_additions_return(self):
        self.bundle()
        _, again = self.bundle()
        self.assertEqual(len(again), 5, "collect alone never marks anything seen")
        scrub.commit()
        self.assertFalse(os.path.exists(scrub.PENDING))
        summary, b = self.bundle()
        self.assertEqual((summary["changed"], b), (0, []))
        with open(f"{scrub.VAULT}/Sources/Notion/idea.md", "a") as fh:
            fh.write("\nA second thought appended later, also long enough to count.")
        _, b = self.bundle()
        self.assertEqual([x["text"] for x in b], ["A second thought appended later, also long enough to count."])

    def test_a_vault_under_a_confidential_folder_is_never_read(self):
        conf = os.path.join(self.d, "x", "Confidential", "vault")
        write(f"{conf}/Sources/Notion/secret.md", "A secret thought that is long enough to be collected, normally.")
        scrub.VAULT = conf
        self.assertEqual(list(scrub.vault_docs()), [])


class Publish(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.saved = (pub.notion, pub.http, pub.secret, pub.PINGS)
        pub.notion = lambda m, p, b=None: self.calls.append((m, p, b)) or self.reply(m, p, b)
        pub.http = lambda m, u, h, b=None: self.calls.append((m, u, b)) or self.reply(m, u, b)
        pub.secret = lambda path, key=None: "SECRET"
        self.d = tempfile.mkdtemp()
        pub.PINGS = os.path.join(self.d, "pings.jsonl")
        self.reply = lambda m, p, b: {}

    def tearDown(self):
        pub.notion, pub.http, pub.secret, pub.PINGS = self.saved

    def test_text_is_split_into_2000_char_chunks_capped_at_6000(self):
        self.assertEqual([len(c["text"]["content"]) for c in pub.text_prop("x" * 7000)["rich_text"]], [2000, 2000, 2000])
        self.assertEqual(pub.text_prop(None), {"rich_text": []})

    def test_rows_go_to_the_thought_review_database_with_batch_and_flags(self):
        f = os.path.join(self.d, "c.json")
        write(f, json.dumps([{"thought": "t" * 300, "quote": "q", "source": "Notion", "where": "w", "written": "2026-10-20", "flags": ["Personal"]},
                             {"thought": "u", "source": "Claude Code", "written": ""}]))
        out = json.loads(quiet(pub.add_rows, f, "Build moment"))
        self.assertEqual(out, {"rows_added": 2, "batch": "Build moment"})
        (m, path, body), (_, _, body2) = self.calls
        self.assertEqual((m, path, body["parent"]["database_id"]), ("POST", "/v1/pages", pub.NOTION_DB))
        pr = body["properties"]
        self.assertEqual(len(pr["Thought"]["title"][0]["text"]["content"]), 200)
        self.assertEqual(pr["Batch"], {"select": {"name": "Build moment"}})
        self.assertEqual(pr["Flags"], {"multi_select": [{"name": "Personal"}]})
        self.assertEqual(pr["Written"], {"date": {"start": "2026-10-20"}})
        self.assertNotIn("Written", body2["properties"], "no date unless a full YYYY-MM-DD")
        self.assertEqual(body2["properties"]["Strength"], {"select": {"name": "Seed"}})

    def test_decide_takes_a_page_id_or_url_and_writes_the_reason(self):
        quiet(pub.decide, "https://www.notion.so/Some-title-3f48b1a8eec581fb?v=1", "Close", "noise")
        m, path, body = self.calls[0]
        self.assertEqual((m, path), ("PATCH", "/v1/pages/3f48b1a8eec581fb"))
        self.assertEqual(body["properties"]["Decision"], {"select": {"name": "Close"}})

    def page(self, created, decision=None, batch="Daily"):
        sel = lambda n: {"select": {"name": n} if n else None}
        return {"created_time": created, "url": "u" + created, "properties": {
            "Decision": sel(decision), "Thought": {"title": [{"plain_text": "th"}]}, "Strength": sel("Seed"), "Source": sel("Notion"), "Batch": sel(batch)}}

    def test_open_and_stats_page_through_the_list(self):
        pages = [{"results": [self.page("2026-10-10T00:00:00.000Z"), self.page("2026-10-01T00:00:00.000Z", "Close")], "has_more": True, "next_cursor": "c2"},
                 {"results": [self.page("2026-10-05T00:00:00.000Z", batch="Build moment")], "has_more": False}]
        it = iter(pages * 2)
        self.reply = lambda m, p, b: next(it)
        s = pub.stats()
        self.assertEqual((s["open"], s["decided"]), (2, {"Close": 1}))
        self.assertEqual(self.calls[1][2]["start_cursor"], "c2")
        rows = pub.open_rows()
        self.assertEqual([r["created"] for r in rows], ["2026-10-01", "2026-10-05", "2026-10-10"], "oldest first")
        self.assertEqual(rows[1]["batch"], "Build moment")

    def test_ping_sends_a_tracked_link_and_records_it(self):
        self.reply = lambda m, p, b: {"results": [], "has_more": False}
        out = json.loads(quiet(pub.ping, 1, ["iPhone notes: stale"]))
        tg = [c for c in self.calls if "telegram" in str(c[1])][0]
        self.assertEqual(tg[2]["chat_id"], pub.TG_CHAT_ID)
        self.assertTrue(tg[2]["disable_web_page_preview"])
        lines = tg[2]["text"].split("\n")
        self.assertEqual(lines[0], "1 new thought to review (0 waiting).")
        self.assertEqual(lines[1], pub.LINK_BASE + out["ping_id"])
        self.assertEqual(lines[2], "iPhone notes: stale")
        with open(pub.PINGS) as fh:
            self.assertEqual(json.loads(fh.read())["ping_id"], out["ping_id"])

    def test_clicks_fill_in_the_first_click_and_hours_to_click(self):
        write(pub.PINGS, json.dumps({"ping_id": "p1", "sent_at": "2026-10-20T07:00:00+00:00"}) + "\n" + json.dumps({"ping_id": "p2", "sent_at": "2026-10-21T07:00:00+00:00"}) + "\n")
        self.reply = lambda m, u, b: {"result": [{"results": [{"ping_id": "p1", "first": "2026-10-20T09:30:00Z"}]}]}
        out = json.loads(quiet(pub.clicks))
        self.assertEqual(out, {"pings": 2, "clicked": 1, "unclicked": ["p2"]})
        with open(pub.PINGS) as fh:
            p1 = json.loads(fh.readline())
        self.assertEqual(p1["hours_to_click"], 2.5)


if __name__ == "__main__":
    unittest.main()
