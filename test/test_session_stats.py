"""hooks/session-stats.py: transcript parsing and the two logs, with every path pointed at a temp dir."""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pyload import load

ss = load("hooks/session-stats.py", "session_stats")


def ts(minutes):
    return (datetime(2026, 10, 20, 10, 0, tzinfo=timezone.utc) + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def tool(name, **inp):
    return {"type": "tool_use", "name": name, "input": inp}


TRANSCRIPT = [
    {"type": "user", "sessionId": "s", "cwd": "/w/p", "timestamp": ts(0), "message": {"content": "<command-message>x</command-message>Fix the sync"}},
    {"type": "assistant", "timestamp": ts(1), "message": {"model": "claude-sonnet-4-6", "usage": {"input_tokens": 1000, "output_tokens": 2000, "cache_read_input_tokens": 1_000_000, "cache_creation_input_tokens": 100_000},
     "content": [tool("Edit", file_path="/a"), tool("Edit", file_path="/a"), tool("Write", file_path="/b"), tool("Bash", command="git commit -m x"),
                 tool("Bash", command="git commit --amend"), tool("Grep", pattern="x"), tool("mcp__obsidian__create_note"), tool("mcp__other__x"),
                 tool("Agent"), tool("Skill", skill="pm"), tool("Skill", skill="pm"), tool("TaskCreate"), tool("Weird")]}},
    {"type": "user", "timestamp": ts(2), "message": {"content": [{"type": "text", "text": "Base directory for this skill: /h/.claude/skills/debrief"}]}},
    {"type": "user", "timestamp": ts(3), "sourceToolUseID": "t1", "message": {"content": [{"type": "text", "text": "Base directory for this skill: /h/.claude/skills/pm"}]}},
    {"type": "user", "timestamp": ts(30), "message": {"content": "back after a long gap"}},
]


class Parse(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.f = Path(self.d, "proj", "s-1.jsonl")
        self.f.parent.mkdir()
        self.f.write_text("\n".join(json.dumps(x) for x in TRANSCRIPT) + "\nnot json\n")

    def test_counts_tools_artifacts_and_tokens(self):
        m = ss.parse_session(self.f)
        self.assertEqual(m["session_id"], "s-1")
        self.assertEqual(m["project"], "proj")
        self.assertEqual(m["cwd"], "/w/p")
        self.assertEqual(m["model"], "claude-sonnet-4-6")
        self.assertEqual((m["user_messages"], m["assistant_messages"], m["tool_calls"]), (4, 1, 13))
        self.assertEqual(dict(m["tool_breakdown"]), {"edit": 2, "write": 1, "bash": 2, "search": 1, "vault": 1, "mcp_other": 1, "agent": 1, "skill": 2, "task": 1, "other": 1})
        self.assertEqual((m["files_edited_count"], m["files_created_count"]), (1, 1))
        self.assertEqual(m["git_commits"], 1, "amend is not a new commit")
        self.assertEqual((m["vault_notes_created"], m["subagents_spawned"]), (1, 1))
        self.assertEqual(m["skills_used"], ["pm"])
        self.assertEqual(m["commands_used"], ["debrief"], "slash command counted; a Skill-tool expansion is not")
        self.assertEqual(m["first_user_message"], "xFix the sync")

    def test_active_time_skips_gaps_of_10_minutes_or_more(self):
        m = ss.parse_session(self.f)
        self.assertEqual(m["wall_clock_sec"], 30 * 60)
        self.assertEqual(m["active_sec"], 3 * 60)

    def test_cost_uses_the_model_family_price(self):
        m = ss.parse_session(self.f)
        # sonnet: 1000*3 + 2000*15 + 1M*0.30 + 100k*6, per million
        self.assertEqual(m["api_cost_estimate"], round(0.003 + 0.03 + 0.30 + 0.60, 2))
        self.assertEqual(ss.model_family("claude-opus-5-5"), "opus")
        self.assertEqual(ss.model_family("mystery"), "opus")

    def test_format_duration(self):
        self.assertEqual([ss.format_duration(s) for s in (59, 61, 3600 + 120)], ["59s", "1m", "1h 2m"])


class Logs(unittest.TestCase):
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.saved = (ss.PROJECTS_DIR, ss.JSONL_LOG, ss.VAULT_LOG)
        ss.PROJECTS_DIR, ss.JSONL_LOG, ss.VAULT_LOG = d / "projects", d / "session-log.jsonl", d / "vault" / "Session Log.md"
        (d / "projects" / "p").mkdir(parents=True)
        recent = datetime.now(timezone.utc) - timedelta(days=1)
        rows = [dict(TRANSCRIPT[0], timestamp=recent.isoformat()), dict(TRANSCRIPT[1], timestamp=(recent + timedelta(minutes=2)).isoformat())]
        (d / "projects" / "p" / "abc.jsonl").write_text("\n".join(json.dumps(x) for x in rows))
        (d / "projects" / "p" / "empty.jsonl").write_text(json.dumps({"type": "assistant", "message": {}}))

    def tearDown(self):
        ss.PROJECTS_DIR, ss.JSONL_LOG, ss.VAULT_LOG = self.saved

    def test_one_session_is_logged_once_and_replaced_on_rerun(self):
        ss.log_single_session("abc", None)
        ss.log_single_session("abc", None)
        rows = [json.loads(l) for l in ss.JSONL_LOG.read_text().splitlines()]
        self.assertEqual([r["session_id"] for r in rows], ["abc"])
        self.assertEqual(rows[0]["tool_breakdown"]["edit"], 2)
        md = ss.VAULT_LOG.read_text()
        self.assertIn("title: Session Log", md)
        self.assertIn("## Lifetime Totals", md)
        self.assertIn("## Usage Trends", md)
        self.assertIn("xFix the sync", md)
        self.assertIn("**Produced:** 1 files edited, 1 files created, 1 commits, 1 vault notes, 1 subagents", md)

    def test_unknown_session_exits_without_writing(self):
        with self.assertRaises(SystemExit):
            ss.log_single_session("nope", None)
        self.assertFalse(ss.JSONL_LOG.exists())
        self.assertFalse(ss.VAULT_LOG.exists())

    def test_backfill_skips_sessions_without_user_turns_and_already_logged_ones(self):
        ss.backfill()
        ss.backfill()
        ids = [json.loads(l)["session_id"] for l in ss.JSONL_LOG.read_text().splitlines()]
        self.assertEqual(ids, ["abc"])


if __name__ == "__main__":
    unittest.main()
