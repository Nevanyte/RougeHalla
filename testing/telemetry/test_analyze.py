#!/usr/bin/env python3
"""Tests for analyze.py and make_fixture.py (docs/TELEMETRY.md section 11 C).

    python3 testing/telemetry/test_analyze.py        (or: python3 -m unittest testing/telemetry/test_analyze.py)

The stdlib report runs on the committed fixture; the logistic model (numpy) is checked on a synthetic set with a
known faction edge and is skipped without numpy.
"""
from __future__ import annotations

import io
import json
import math
import os
import random
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analyze  # noqa: E402
import make_fixture  # noqa: E402

FIXTURE = os.path.join(HERE, "fixtures", "runs-v1.ndjson")

try:
    import numpy  # noqa: F401
    HAVE_NUMPY = True
except ImportError:
    HAVE_NUMPY = False


class Wilson(unittest.TestCase):
    def test_known_values(self):
        # Reference values of the Wilson score interval at z = 1.96 (also shared/telemetry.ts wilson95).
        c = analyze.wilson95(5, 10)
        self.assertAlmostEqual(c["lo"], 0.2366, places=4)
        self.assertAlmostEqual(c["hi"], 0.7634, places=4)
        c = analyze.wilson95(81, 263)
        self.assertAlmostEqual(c["rate"], 81 / 263)
        self.assertAlmostEqual(c["lo"], 0.2553, places=3)
        self.assertAlmostEqual(c["hi"], 0.3662, places=3)

    def test_edges(self):
        self.assertEqual(analyze.wilson95(0, 0), {"n": 0, "k": 0, "rate": 0, "lo": 0, "hi": 1})
        z = analyze.wilson95(0, 10)
        self.assertEqual(z["lo"], 0)
        self.assertAlmostEqual(z["hi"], 0.2775, places=4)
        a = analyze.wilson95(10, 10)
        self.assertEqual(a["hi"], 1)
        self.assertAlmostEqual(a["lo"], 0.7225, places=4)


class Fixture(unittest.TestCase):
    def test_deterministic_and_matches_committed_file(self):
        a = make_fixture.make_runs(40, 7)
        b = make_fixture.make_runs(40, 7)
        self.assertEqual(json.dumps(a), json.dumps(b))
        with open(FIXTURE, encoding="utf-8") as f:
            committed = [json.loads(l) for l in f if l.strip()]
        self.assertEqual(json.dumps(committed, separators=(",", ":")), json.dumps(a, separators=(",", ":")))

    def test_shape(self):
        runs = analyze.load_paths([FIXTURE])
        self.assertEqual(len(runs), 40)
        outcomes = {d["outcome"] for r in runs for d in r["duels"]}
        self.assertTrue({"kill", "disengage", "thirdParty", "hazard", "trade"} <= outcomes)
        kinds = {o["kind"] for r in runs for o in r["offers"]}
        self.assertEqual(kinds, {"augment", "stat", "trophy"})
        self.assertTrue(any(p["bot"] for r in runs for p in r["players"]))
        self.assertTrue(any(not p["bot"] for r in runs for p in r["players"]))
        for r in runs:
            self.assertRegex(r["runId"], r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
            for d in r["duels"]:
                self.assertLess(d["sides"][0]["slot"], d["sides"][1]["slot"])


class Report(unittest.TestCase):
    def setUp(self):
        runs = analyze.filter_runs(analyze.load_paths([FIXTURE]), None, None, None, "any")
        self.tables = analyze.flatten(runs)

    def stats(self, pool):
        return analyze.Stats(self.tables, {"pool": pool, "source": "any"}, 0)

    def test_pools_never_mix(self):
        h, b, a = self.stats("humans"), self.stats("bots"), self.stats("all")
        self.assertEqual(len(h.players) + len(b.players), len(a.players))
        self.assertTrue(all(not p["bot"] for p in h.players))
        self.assertTrue(all(d["bots"] == 0 for d in h.duels))
        self.assertTrue(all(d["bots"] == 2 for d in b.duels))
        self.assertGreaterEqual(len(a.duels), len(h.duels) + len(b.duels))

    def test_faction_win_counts(self):
        s = self.stats("all")
        rows = s.factions()["rows"]
        self.assertEqual(sum(r["win"]["n"] for r in rows), len(s.players))
        self.assertEqual(sum(r["win"]["k"] for r in rows), sum(1 for p in s.players if p["outcome"] == "won"))

    def test_matrix_orientations(self):
        s = self.stats("all")
        cells = {(c["row"], c["col"]): c["win"] for c in s.duel_factions()["rows"]}
        for (r, c), w in cells.items():
            if r == c:
                self.assertEqual(w["k"] * 2, w["n"])  # a mirror is 1 of 2 per duel
            else:
                o = cells[(c, r)]
                self.assertEqual(w["n"], o["n"])
                self.assertEqual(w["k"] + o["k"], w["n"])
        clean_kills = sum(1 for d in s.duels if d["outcome"] == "kill" and d["clean"])
        self.assertEqual(sum(w["n"] for w in cells.values()), 2 * clean_kills)

    def test_offers_split(self):
        s = self.stats("all")
        for kind in ("augment", "stat", "trophy"):
            rows = s.offers(kind)["rows"]
            self.assertTrue(rows, kind)
            for r in rows:
                self.assertEqual(r["pick"]["n"], r["offered"])
                self.assertEqual(r["winPicked"]["n"] + r["winNotPicked"]["n"], r["offered"])
                self.assertEqual(r["winPicked"]["n"], r["pick"]["k"])
        self.assertTrue(all(r["option"].count(":") == 1 for r in s.offers("trophy")["rows"]))

    def test_report_prints_every_section(self):
        out = io.StringIO()
        with redirect_stdout(out):
            code = analyze.main([FIXTURE, "--pool", "all"])
        self.assertEqual(code, 0)
        text = out.getvalue()
        for title in ("Overview", "Faction run win rate", "Weapon run win rate", "faction x faction", "weapon x weapon",
                      "Duel summary", "Augments", "Stat boosts", "Trophies", "Farming", "Camp clears", "Deaths by cause",
                      "First blood", "Client and network", "heatmap"):
            self.assertIn(title, text)

    def test_json_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "out.json")
            with redirect_stdout(io.StringIO()):
                analyze.main([FIXTURE, "--pool", "bots", "--json", path])
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        self.assertIn("/api/stats/duels/factions", data["results"])
        self.assertEqual(data["results"]["/api/stats/overview"]["query"]["pool"], "bots")


def synthetic_duels(n: int, seed: int, edge: dict) -> list[dict]:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        fa, fb = rng.choice(analyze.FACTIONS), rng.choice(analyze.FACTIONS)
        wa, wb = rng.choice(analyze.WEAPONS), rng.choice(analyze.WEAPONS)
        pa, pb = rng.randint(0, 12), rng.randint(0, 12)
        ha, hb = rng.uniform(0.4, 1), rng.uniform(0.4, 1)
        first = rng.choice([0, 1])
        logit = edge[fa] - edge[fb] + 0.6 * (math.log1p(pa) - math.log1p(pb)) + 1.5 * (ha - hb) + (0.2 if first == 0 else -0.2)
        win = 0 if rng.random() < 1 / (1 + math.exp(-logit)) else 1
        out.append({"outcome": "kill", "clean": True, "winner": win, "a_faction": fa, "b_faction": fb, "a_weapon": wa,
                    "b_weapon": wb, "a_power": pa, "b_power": pb, "a_stacks": 0, "b_stacks": 0, "a_hp": ha, "b_hp": hb,
                    "first": first, "a_pid": None, "b_pid": None, "a_tier": None, "b_tier": None})
    return out


@unittest.skipUnless(HAVE_NUMPY, "numpy not installed")
class Model(unittest.TestCase):
    def test_recovers_a_known_faction_edge(self):
        edge = {"fire": 0.5, "sentenced": -0.4, "plague": 0.0, "frost": 0.1, "holy": -0.2}
        m = analyze.duel_model(synthetic_duels(6000, 3, edge))
        self.assertFalse(m["tooFew"])
        for f, v in edge.items():
            e = m["factions"][f]
            self.assertLessEqual(e["lo"], v, f)
            self.assertGreaterEqual(e["hi"], v, f)
        self.assertGreater(m["factions"]["fire"]["lo"], 0)
        self.assertLess(m["factions"]["sentenced"]["hi"], 0)
        self.assertAlmostEqual(sum(e["coef"] for e in m["factions"].values()), 0, places=9)
        g = m["terms"]["g_log1p_power"]
        self.assertTrue(g["lo"] <= 0.6 <= g["hi"])
        self.assertLess(m["logLoss"], m["logLossFactionOnly"])

    def test_fixture_model_runs_and_warns(self):
        out = io.StringIO()
        with redirect_stdout(out):
            analyze.main([FIXTURE, "--pool", "all", "--model"])
        text = out.getvalue()
        self.assertIn("Skill-adjusted duel model", text)
        self.assertIn("too wide to act on", text)
        self.assertIn("Run-level model", text)


if __name__ == "__main__":
    unittest.main()
