"""tools/emerging-stats.py: every number in the What's emerging note comes from here."""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("emerging_stats", os.path.join(HERE, "..", "tools", "emerging-stats.py"))
es = importlib.util.module_from_spec(spec)
spec.loader.exec_module(es)


def quiet(fn, *a):
    buf = io.StringIO()
    with redirect_stdout(buf):
        fn(*a)
    return buf.getvalue()


class EmergingStats(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.p = lambda n: os.path.join(self.d, n)

    def write(self, name, data):
        with open(self.p(name), "w") as fh:
            json.dump(data, fh)

    def read(self, name):
        with open(self.p(name)) as fh:
            return json.load(fh)

    def test_window_takes_the_last_n_bundles_and_drops_text_written_before_it(self):
        item = lambda where, written: {"source": "Phone Notes", "where": where, "written": written, "text": "t"}
        self.write("bundle-2026-11-10.json", [item("too old bundle", "2026-11-10")])
        self.write("bundle-2026-11-12.json", [item("a", "2026-11-12"), item("old note read first time", "2026-10-02")])
        self.write("bundle-2026-11-14.json", [item("b", "2026-11-13"), item("c", "")])
        out = json.loads(quiet(es.window, self.d, "3", "2026-11-14", self.p("items.json")))
        self.assertEqual(out, {"items": 3, "start": "2026-11-12", "end": "2026-11-14"})
        self.assertEqual([(x["i"], x["where"]) for x in self.read("items.json")], [(0, "a"), (1, "b"), (2, "c")])

    def test_counts_threads_change_concepts_and_never_counts_hidden_topics(self):
        items = [
            {"i": 0, "source": "Claude Code", "where": "s1", "text": "the Golf provenance trail, provenance again"},
            {"i": 1, "source": "Claude Code", "where": "s1", "text": "more on the job search"},
            {"i": 2, "source": "Phone Notes", "where": "n1", "text": "car parts provenance and a 944"},
            {"i": 3, "source": "Phone Notes", "where": "n2", "text": "provenance of my health records"},
            {"i": 4, "source": "Notion", "where": "x", "text": "untagged"},
        ]
        self.write("items.json", items)
        self.write("tags.json", {"items": [
            {"i": 0, "topics": ["Car-related businesses"]}, {"i": 1, "topics": ["Job search"]},
            {"i": 2, "topics": ["Car-related businesses", "Job search"]}, {"i": 3, "topics": ["Personal (not shown)"]}],
            "concepts": [{"name": "Provenance", "terms": ["provenance"]}, {"name": "Never said", "terms": ["zebra"]},
                         {"name": "Empty", "terms": [" "]}]})
        self.write("history.json", [{"date": "2026-11-11", "topics": {"Job search": 5, "Sound experiment": 3}}])
        quiet(es.stats, self.p("items.json"), self.p("tags.json"), self.p("history.json"), self.p("stats.json"))
        s = self.read("stats.json")
        self.assertEqual((s["threads"], s["items"], s["untagged"], s["previous_run"]), (3, 4, 1, "2026-11-11"))
        self.assertEqual(s["by_source"], {"Claude Code": 2, "Phone Notes": 1, "Notion": 1})
        self.assertEqual([(t["name"], t["threads"], t["prev"], t["change"]) for t in s["topics"]],
                         [("Car-related businesses", 2, None, None), ("Job search", 2, 5, -3)])
        self.assertEqual(s["new_topics"], ["Car-related businesses"])
        self.assertEqual(s["faded"], ["Sound experiment"])
        self.assertEqual([(c["name"], c["mentions"], c["threads"]) for c in s["concepts"]], [("Provenance", 3, 2)],
                         "the personal item's 'provenance' is not counted; zero-mention and empty concepts are dropped")
        self.assertNotIn("Personal (not shown)", json.dumps(s))

    def test_first_run_has_no_change_and_record_keeps_names_for_the_next(self):
        self.write("items.json", [{"i": 0, "source": "Notion", "where": "w", "text": "t"}])
        self.write("tags.json", {"items": [{"i": 0, "topics": ["Job search"]}], "concepts": []})
        quiet(es.stats, self.p("items.json"), self.p("tags.json"), self.p("none.json"), self.p("stats.json"))
        s = self.read("stats.json")
        self.assertEqual((s["previous_run"], s["new_topics"], s["topics"][0]["change"]), (None, [], None))
        quiet(es.record, self.p("stats.json"), self.p("history.json"))
        self.assertEqual(self.read("history.json")[0]["topics"], {"Job search": 1})


if __name__ == "__main__":
    unittest.main()
