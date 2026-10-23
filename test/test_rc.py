"""tools/rc.py: session listing and fork-resume, against a temp sessions registry and projects dir."""
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from pyload import load

rc = load("tools/rc.py", "rc")

A = "aaaaaaaa-0000-0000-0000-000000000001"
B = "bbbbbbbb-0000-0000-0000-000000000002"
C = "cccccccc-0000-0000-0000-000000000003"


def jl(*rows):
    return "\n".join(json.dumps(r) for r in rows) + "\n"


class Replaced(Exception):
    pass


class RC(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.saved = (rc.SESSIONS_DIR, rc.PROJECTS_DIR, rc.os.execvp)
        rc.SESSIONS_DIR, rc.PROJECTS_DIR = d / "sessions", d / "projects"
        rc.SESSIONS_DIR.mkdir()
        (rc.PROJECTS_DIR / "p").mkdir(parents=True)
        (rc.SESSIONS_DIR / "1.json").write_text(json.dumps({"sessionId": A, "pid": os.getpid(), "cwd": "/w", "startedAt": 1}))
        (rc.SESSIONS_DIR / "2.json").write_text(json.dumps({"sessionId": B, "pid": 999999999, "bridgeSessionId": "br1"}))
        (rc.SESSIONS_DIR / "bad.json").write_text("{")
        (rc.PROJECTS_DIR / "p" / f"{A}.jsonl").write_text(jl(
            {"type": "user", "message": {"content": "<system-reminder>x</system-reminder>"}},
            {"type": "user", "message": {"content": "First real ask"}, "timestamp": "2026-10-20T10:00:00Z"},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "r"}]}},
            {"type": "user", "isMeta": True, "message": {"content": "meta"}},
            {"type": "system", "subtype": "bridge_status", "url": "https://claude.ai/code/s1"},
            {"type": "user", "message": {"content": [{"type": "text", "text": "Last ask"}]}, "timestamp": "2026-10-20T11:00:00Z"},
        ))
        (rc.PROJECTS_DIR / "p" / f"{C}.jsonl").write_text(jl({"type": "user", "message": {"content": "closed one"}, "timestamp": "2026-10-19T00:00:00Z"}))
        self.exec = []

        def fake_exec(f, a):  # the real execvp never returns
            self.exec.append(a)
            raise Replaced()
        rc.os.execvp = fake_exec

    def tearDown(self):
        rc.SESSIONS_DIR, rc.PROJECTS_DIR, rc.os.execvp = self.saved

    def out(self, fn, *a):
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            fn(*a)
        return buf.getvalue(), err.getvalue()

    def test_scan_counts_only_real_typed_messages_and_finds_the_bridge_url(self):
        first, first_ts, last, _, url, n = rc.scan_jsonl(rc.find_jsonl(A))
        self.assertEqual((first, last, url, n), ("First real ask", "Last ask", "https://claude.ai/code/s1", 2))
        self.assertEqual(first_ts, "2026-10-20T10:00:00Z")

    def test_ls_shows_live_sessions_only_unless_all(self):
        live, _ = self.out(rc.cmd_ls, False)
        self.assertIn("aaaaaaaa", live)
        self.assertNotIn("bbbbbbbb", live)
        self.assertRegex(live, r"live yes aaaaaaaa +First real ask")
        everything, _ = self.out(rc.cmd_ls, True)
        self.assertIn("bbbbbbbb", everything)
        self.assertRegex(everything, r"shut - +cccccccc +closed one")

    def test_resume_always_forks_and_resolves_prefixes_live_first(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(Replaced):
            rc.cmd_resume("aaaa")
        self.assertEqual(self.exec[-1], ["claude", "--resume", A, "--fork-session"])
        self.assertIn("Archive this session in the mobile app", err.getvalue())
        with contextlib.redirect_stderr(err), self.assertRaises(Replaced):
            rc.cmd_resume("cccc")
        self.assertEqual(self.exec[-1], ["claude", "--resume", C, "--fork-session"])
        with self.assertRaises(Replaced):
            rc.cmd_resume(None)
        self.assertEqual(self.exec[-1], ["claude", "--resume", "--fork-session"])
        with self.assertRaises(SystemExit):
            self.out(rc.cmd_resume, "zzzz")

    def test_info_reports_state_and_messages(self):
        out, _ = self.out(rc.cmd_info, "bbbb")
        self.assertIn("state:        closed", out)
        self.assertIn("bridge id:    br1 (registry)", out)
        out, _ = self.out(rc.cmd_info, "aaaa")
        self.assertIn(f"state:        live (pid {os.getpid()})", out)
        self.assertIn("messages:     2", out)
        self.assertIn("=== LAST USER MESSAGE", out)


if __name__ == "__main__":
    unittest.main()
