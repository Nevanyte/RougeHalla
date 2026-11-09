"""Tests for the matched full-port performance preparation tool. Standard library only:

    python3 -m unittest discover -s tools/full-port-perf/tests -v

Every report built here is SYNTHETIC (or, in one clearly named test, an in-memory relabelling that is never written)."""

import copy
import io
import json
import math
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

TOOL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(TOOL))
sys.path.insert(0, TOOL)

import fpp  # noqa: E402
from fullportperf import (SYNTHETIC_LABEL, adapters, admission, canonical, matrix as matrix_mod, registry,  # noqa: E402
                          script, stats, summary, synthetic)

EVIDENCE = os.path.join(REPO, "docs", "evidence", "full-port-perf-preparation")
MATRIX = matrix_mod.load()
_BASES = {}


def base(cell):
    if cell not in _BASES:
        _BASES[cell] = synthetic.base_report(cell, MATRIX)
    return copy.deepcopy(_BASES[cell])


def codes(report, repo=None):
    return admission.admit(report, MATRIX, repo)


class Stats(unittest.TestCase):
    def test_nearest_rank(self):
        v = sorted([15, 20, 35, 40, 50])
        self.assertEqual(stats.nearest_rank(v, 30), 20)
        self.assertEqual(stats.nearest_rank(v, 40), 20)
        self.assertEqual(stats.nearest_rank(v, 50), 35)
        self.assertEqual(stats.nearest_rank(v, 100), 50)
        with self.assertRaises(ValueError):
            stats.nearest_rank([], 50)
        with self.assertRaises(ValueError):
            stats.nearest_rank(v, 0)

    def test_describe_is_order_independent(self):
        a = [3.0, 1.0, 2.0, 10.0]
        self.assertEqual(stats.describe(a), stats.describe(list(reversed(a))))
        self.assertEqual(stats.describe(a)["p50"], 2.0)
        self.assertEqual(stats.describe(a)["mean"], 4.0)

    def test_histogram_upper_bounds(self):
        d = stats.histogram_describe([1, 2, 3, None], [5, 3, 1, 1])
        self.assertEqual(d["count"], 10)
        self.assertEqual(d["p50"], 1)
        self.assertEqual(d["p90"], 3)
        self.assertIsNone(d["p99"])
        self.assertEqual(d["overflowCount"], 1)
        self.assertEqual(d["resolution"], "bucket-upper-bound")

    def test_jitter(self):
        self.assertIsNone(stats.consecutive_jitter([1.0]))
        self.assertEqual(stats.consecutive_jitter([1.0, 3.0, 2.0]), 1.5)


class Canonical(unittest.TestCase):
    def test_nan_refused(self):
        with self.assertRaises(ValueError):
            canonical.dumps({"a": math.nan})
        with self.assertRaises(ValueError):
            canonical.dumps({"a": [math.inf]})

    def test_hash_ignores_key_order(self):
        self.assertEqual(canonical.sha256_json({"a": 1, "b": [1, 2]}), canonical.sha256_json({"b": [1, 2], "a": 1}))

    def test_load_refuses_nan_literal(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            f.write('{"x": NaN}')
        try:
            with self.assertRaises(ValueError):
                canonical.load(f.name)
        finally:
            os.unlink(f.name)


class Matrix(unittest.TestCase):
    def test_final_matrix_valid_and_bounded(self):
        self.assertEqual(matrix_mod.validate(MATRIX), [])
        rows, hours = matrix_mod.estimate(MATRIX)
        self.assertEqual(len(rows), 15)
        self.assertLessEqual(hours, MATRIX["bounds"]["maxTotalHours"])
        self.assertEqual(len({c["id"] for c in MATRIX["cells"]}), len(MATRIX["cells"]))

    def test_every_cell_class_and_separation(self):
        classes = {c["class"] for c in MATRIX["cells"]}
        self.assertEqual(classes, set(registry.CELL_CLASSES))
        for c in MATRIX["cells"]:
            for mid in c["required"] + c["optional"]:
                fam = registry.METRICS[mid]["family"]
                if c["class"] != registry.THROUGHPUT:
                    self.assertNotEqual(fam, "sim-throughput", (c["id"], mid))
                if c["class"] == registry.THROUGHPUT:
                    self.assertNotIn(fam, ("frame-callback", "frame-presented", "input-to-visible"), (c["id"], mid))

    def test_no_frame_rate_goal(self):
        text = canonical.dumps(MATRIX)
        for k in ("targetFps", "fpsTarget", "fpsCap", "maxFps"):
            self.assertNotIn(k, text)
        self.assertEqual(MATRIX["fixed"]["frameRateLimit"]["port"]["unityTargetFrameRate"], -1)
        self.assertEqual(MATRIX["fixed"]["frameRateLimit"]["legacy"]["phaserFpsLimit"], 0)

    def test_matrix_rule_violations(self):
        m = copy.deepcopy(MATRIX)
        m["admission"]["trialOrder"] = ["legacy"] * 5 + ["port"] * 5
        self.assertTrue(any("interleave" in e for e in matrix_mod.validate(m)))
        m = copy.deepcopy(MATRIX)
        m["cells"][0]["required"].append("sim.step_wall_us")
        self.assertTrue(any("sim.step_wall_us" in e for e in matrix_mod.validate(m)))
        m = copy.deepcopy(MATRIX)
        m["cells"][0]["windowsPerTrial"] = 6000
        self.assertTrue(any("exceeds bounds.maxTotalHours" in e for e in matrix_mod.validate(m)))
        m = copy.deepcopy(MATRIX)
        m["cells"].append(dict(m["cells"][0], id="C16"))
        self.assertTrue(any("maxCells" in e for e in matrix_mod.validate(m)))
        m = copy.deepcopy(MATRIX)
        m["fixed"]["targetFps"] = 60
        self.assertTrue(any("targetFps" in e for e in matrix_mod.validate(m)))
        m = copy.deepcopy(MATRIX)
        m["inputScripts"]["arena-human-v1"] = "scripts/missing.json"
        self.assertTrue(any("missing" in e for e in matrix_mod.validate(m)))

    def test_render_deterministic_and_matches_evidence(self):
        a, b = matrix_mod.render_markdown(MATRIX), matrix_mod.render_markdown(copy.deepcopy(MATRIX))
        self.assertEqual(a, b)
        self.assertIn(canonical.sha256_json(MATRIX), a)
        path = os.path.join(EVIDENCE, "EXPERIMENT_MATRIX.md")
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as f:
                self.assertEqual(f.read(), a, "EXPERIMENT_MATRIX.md is stale: re-render it with fpp.py matrix --markdown")


class Scripts(unittest.TestCase):
    def test_scripts_valid_and_deterministic(self):
        for sid, rel in MATRIX["inputScripts"].items():
            s = canonical.load(os.path.join(TOOL, rel))
            self.assertEqual(script.validate(s), [], sid)
            t1, t2 = script.timeline(s, 60000), script.timeline(s, 60000)
            self.assertEqual(t1, t2)
            self.assertEqual(len(t1), (60000 // s["cycleMs"]) * len(s["events"]))
            self.assertTrue(all(e["atMs"] < 60000 for e in t1))

    def test_script_rules(self):
        s = canonical.load(os.path.join(TOOL, MATRIX["inputScripts"]["duel-latency-v1"]))
        bad = copy.deepcopy(s)
        bad["events"][0]["code"] = "KeyQ"
        self.assertTrue(script.validate(bad))
        bad = copy.deepcopy(s)
        del bad["events"][1]
        self.assertTrue(any("released" in e for e in script.validate(bad)))
        bad = copy.deepcopy(s)
        bad["events"].reverse()
        self.assertTrue(script.validate(bad))
        with self.assertRaises(ValueError):
            script.timeline(bad, 1000)


class Admission(unittest.TestCase):
    def test_all_synthetic_bases_admitted_only_as_controls(self):
        for c in MATRIX["cells"]:
            v = codes(base(c["id"]))
            self.assertEqual(v["status"], "ADMITTED-SYNTHETIC-CONTROL", (c["id"], v["refusals"][:3]))
            self.assertFalse(v["finalEvidence"])

    def test_repo_verified_pairing_receipt(self):
        path = os.path.join(REPO, synthetic.PAIRING_RECEIPT)
        if not os.path.isfile(path):
            self.skipTest("synthetic pairing receipt not written yet")
        v = codes(base("C01"), REPO)
        self.assertEqual(v["status"], "ADMITTED-SYNTHETIC-CONTROL")
        self.assertEqual(v["warnings"], [])
        r = base("C01")
        r["contentPairing"]["evidence"]["sha256"] = "0" * 64
        self.assertIn("CONTENT_PAIRING", codes(r, REPO)["refusalCodes"])

    def test_refusal_controls(self):
        b = base("C01")
        for name, fn, need in synthetic.CONTROLS:
            with self.subTest(control=name):
                v = codes(synthetic.mutate(b, fn))
                self.assertEqual(v["status"], "REFUSED")
                self.assertTrue(set(need) <= set(v["refusalCodes"]), (need, v["refusalCodes"]))

    def test_class_refusal_controls(self):
        for name, cell, fn, need in synthetic.CLASS_CONTROLS:
            with self.subTest(control=name):
                v = codes(synthetic.mutate(base(cell), fn))
                self.assertEqual(v["status"], "REFUSED")
                self.assertTrue(set(need) <= set(v["refusalCodes"]), (need, v["refusalCodes"]))

    def test_explicit_absence_of_optional_metric_is_admitted(self):
        r = base("C01")
        for t in r["sides"]["legacy"]["trials"]:
            for w in t["windows"]:
                w["metrics"]["gpu.elapsed_ms"] = {"status": "absent", "reason": "unsupported-by-browser",
                                                  "detail": "SYNTHETIC: timer query extension unavailable"}
        self.assertEqual(codes(r)["status"], "ADMITTED-SYNTHETIC-CONTROL")

    def test_absent_with_value_refused(self):
        r = base("C01")
        r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]["gpu.elapsed_ms"] = {
            "status": "absent", "reason": "not-collected", "detail": "x", "samples": [0]}
        self.assertIn("METRIC_ZERO_AS_ABSENT", codes(r)["refusalCodes"])

    def test_absent_without_reason_refused(self):
        r = base("C01")
        r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]["gpu.elapsed_ms"] = {"status": "absent"}
        self.assertIn("METRIC_IMPLICIT_ABSENCE", codes(r)["refusalCodes"])

    def test_null_metric_refused(self):
        r = base("C01")
        r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]["server.tick_ms"] = None
        self.assertIn("METRIC_IMPLICIT_ABSENCE", codes(r)["refusalCodes"])

    def test_density_counts_every_room(self):
        r = base("C08")
        w = r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]
        self.assertEqual(w["server.ticks"]["value"], 20 * 8)
        self.assertEqual(len(w["server.tick_ms"]["samples"]), 20 * 8)
        w["server.ticks"]["value"] = 20
        w["server.tick_ms"]["samples"] = w["server.tick_ms"]["samples"][:20]
        self.assertIn("TICK_COUNT", codes(r)["refusalCodes"])

    def test_zero_allowed_where_meaningful(self):
        r = base("C01")
        r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]["server.tick_budget_misses"]["value"] = 0
        self.assertEqual(codes(r)["status"], "ADMITTED-SYNTHETIC-CONTROL")

    def test_privacy_email_and_key(self):
        r = base("C01")
        r["sides"]["port"]["environment"]["note"] = "contact someone@example.com"
        self.assertIn("PRIVACY", codes(r)["refusalCodes"])
        r = base("C01")
        r["sides"]["port"]["environment"]["authToken"] = "x"
        self.assertIn("PRIVACY", codes(r)["refusalCodes"])

    def test_pairing_receipt_path_must_stay_in_repo(self):
        for bad in ("../outside.json", "/etc/hosts"):
            r = base("C13")
            r["contentPairing"]["evidence"]["path"] = bad
            self.assertIn("CONTENT_PAIRING", codes(r, REPO)["refusalCodes"])

    def test_wrong_format(self):
        self.assertEqual(codes({"format": "x"})["refusalCodes"], ["FORMAT"])

    def test_report_verdict_is_deterministic(self):
        self.assertEqual(canonical.dumps(codes(base("C05"))), canonical.dumps(codes(base("C05"))))

    def test_relabelled_in_memory_report_reaches_final_admission(self):
        """The validator must also be able to ADMIT a real report. This relabels a synthetic base IN MEMORY ONLY (it is
        never written) to check that no rule refuses every non-synthetic report."""
        r = base("C13")

        def relabel(x):
            if isinstance(x, dict):
                return {k: relabel(v) for k, v in x.items()}
            if isinstance(x, list):
                return [relabel(v) for v in x]
            if isinstance(x, str):
                return x.replace("SYNTHETIC", "inmemory")
            return x
        r = relabel(r)
        r["synthetic"] = False
        r.pop("label")
        for s in admission.SIDES:
            r["sides"][s]["environment"]["machine"]["cpu"] = MATRIX["reference"]["cpu"]
        v = codes(r)
        self.assertEqual(v["status"], "ADMITTED", v["refusals"][:3])
        self.assertTrue(v["finalEvidence"])
        r["sides"]["port"]["environment"]["machine"]["cpu"] = "Apple M5 Pro (rosetta)"
        self.assertIn("MACHINE_MISMATCH", codes(r)["refusalCodes"])


class Summary(unittest.TestCase):
    def test_summary_deterministic_and_raw_derived(self):
        r = base("C01")
        s1 = summary.summarize(r, MATRIX)
        s2 = summary.summarize(copy.deepcopy(r), MATRIX)
        self.assertEqual(canonical.dumps(s1), canonical.dumps(s2))
        self.assertEqual(s1["labels"][0], SYNTHETIC_LABEL)
        raw = [x for t in r["sides"]["port"]["trials"] for w in t["windows"]
               for x in w["metrics"]["frame.callback_interval_ms"]["samples"]]
        self.assertEqual(s1["sides"]["port"]["metrics"]["frame.callback_interval_ms"]["pooled"]["p50"],
                         stats.nearest_rank(sorted(raw), 50))
        self.assertEqual(s1["reportSha256"], canonical.sha256_json(r))
        self.assertIsNone(re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:", canonical.dumps(s1)), "no wall-clock time in a summary")

    def test_absent_stays_absent_and_incomparables_not_ratioed(self):
        s = summary.summarize(base("C01"), MATRIX)
        pres = s["sides"]["legacy"]["metrics"]["frame.presented_interval_ms"]
        self.assertEqual(pres["status"], "absent")
        self.assertNotIn("pooled", pres)
        self.assertIn("notCompared", s["comparisons"]["frame.presented_interval_ms"])
        self.assertIn("notCompared", s["comparisons"]["client.wasm_heap_bytes"])
        self.assertIn("notCompared", s["comparisons"]["client.js_heap_bytes"])
        self.assertIn("portOverLegacy", s["comparisons"]["server.tick_ms"])
        self.assertTrue(s["sides"]["port"]["derived"]["display"]["callbackP50AtRefresh"])
        self.assertTrue(s["sides"]["port"]["derived"]["sustained"])

    def test_class_labels_keep_families_apart(self):
        s = summary.summarize(base("C04"), MATRIX)
        self.assertIn("not displayed FPS", " ".join(s["labels"]))
        self.assertIn("not displayed or shipping FPS", s["sides"]["legacy"]["derived"]["callbackRateHz"]["label"])
        s = summary.summarize(base("C05"), MATRIX)
        self.assertIn("Unpaced", " ".join(s["labels"]))
        self.assertIn("stepsPerComputeSecond", s["sides"]["port"]["derived"])
        s = summary.summarize(base("C10"), MATRIX)
        self.assertIn("separate quantities", " ".join(s["labels"]))
        self.assertIn("socketRttJitterMs", s["sides"]["port"]["derived"])

    def test_refused_report_has_no_summary(self):
        r = synthetic.mutate(base("C01"), synthetic.CONTROLS[0][1])
        with self.assertRaises(summary.RefusedError):
            summary.summarize(r, MATRIX)


class Adapters(unittest.TestCase):
    def _latency(self, status="PASS"):
        trials = [{"index": i, "profile": {"rttMs": 50, "jitterMs": 10}, "sampleToPresentMs": 60.0 + i,
                   "sampleToOpponentMs": 110.0 + i} for i in range(3)]
        return {"trials": trials, "expectedTrials": 3, "profiles": [{"rttMs": 50, "jitterMs": 10, "seed": 9, "injected": True}],
                "summary": {"verdict": {"status": status, "complete": status == "PASS"}}}

    def test_latency_adapter(self):
        out = adapters.latency_report(self._latency())
        self.assertFalse(out["pairable"])
        p = out["profiles"][0]
        self.assertEqual(p["trialMetrics"]["latency.input_to_self_visible_ms"]["samples"], [60.0, 61.0, 62.0])
        self.assertEqual(p["trialMetrics"]["net.socket_rtt_ms"]["status"], "absent")
        with self.assertRaises(adapters.AdapterRefusal):
            adapters.latency_report(self._latency("INCOMPLETE"))

    def _snap(self, at, steps, late=0, dropped=0, rss=None):
        return {"atMs": at, "health": {"metrics": {"steps": steps, "lateSteps": late, "droppedSteps": dropped,
                                                   "bytesOut": steps * 10, "rssBytes": rss}}}

    def test_health_series(self):
        out = adapters.server_health_series([self._snap(0, 0), self._snap(1000, 20, rss=5_000_000),
                                             self._snap(2000, 40, late=2)], 1)
        w0, w1 = out["windows"]
        self.assertEqual(w0["metrics"]["server.ticks"]["value"], 20)
        self.assertEqual(w1["metrics"]["server.tick_budget_misses"]["value"], 2)
        self.assertEqual(w0["metrics"]["server.rss_bytes"]["samples"], [5_000_000])
        self.assertEqual(w1["metrics"]["server.rss_bytes"]["status"], "absent")
        self.assertEqual(w0["metrics"]["server.tick_ms"]["status"], "absent")
        with self.assertRaises(adapters.AdapterRefusal):
            adapters.server_health_series([self._snap(0, 50), self._snap(1000, 10)], 1)
        with self.assertRaises(adapters.AdapterRefusal):
            adapters.server_health_series([self._snap(0, 0), self._snap(1500, 30)], 1)

    def test_receipt_assessment_copies_no_private_string(self):
        rec = {"renderedRafIntervalMs": {"samples": 480, "p50": 16.7, "p99": 18.6},
               "browser": {"executable": "/Users/someone/x/Browser", "experimentalUncapped": True},
               "url": "http://127.0.0.1/?profile=abc", "nickname": "abc"}
        out = adapters.first_playable_receipt(rec)
        text = canonical.dumps(out)
        self.assertFalse(out["admissible"])
        self.assertNotIn("someone", text)
        self.assertNotIn("abc", text)
        found = {f["code"] for f in out["findings"]}
        self.assertTrue({"SUMMARY_WITHOUT_RAW", "PRIVACY", "DIAGNOSTIC_MIX", "CELL_UNKNOWN"} <= found)

    def test_map_bench_assessment(self):
        rows = [{"seed": s, "hash": f"h{s}", "attempt": 0, "elapsed_ns": 100 + s} for s in range(4)]
        res = {"configuration": {"measured_seeds": [0, 1, 2, 3], "alternating_first_mode_by_seed_parity": True},
               "dirty": False,
               "rust": {m: {"samples": rows, "summary": {"median_ns": 101}} for m in ("plain", "styled")},
               "typescript": {m: {"samples": rows, "summary": {"median_ns": 101.5}} for m in ("plain", "styled")}}
        out = adapters.map_bench_result(res)
        self.assertFalse(out["fullGameAdmissible"])
        self.assertTrue(out["modes"]["plain"]["sameSeedsAndHashes"])
        self.assertEqual(out["modes"]["plain"]["rust"]["storedMatches"], "midpoint-median truncated to integer ns")
        self.assertEqual(out["modes"]["plain"]["typescript"]["storedMatches"], "midpoint-median")
        self.assertEqual({f["code"] for f in out["findings"]}, {"CELL_UNKNOWN"})

    def test_perfproof_and_densitybench_not_cross_stack(self):
        self.assertFalse(adapters.perfproof_report({"workloads": [{"name": "w"}], "violations": []})["crossStackPairable"])
        self.assertFalse(adapters.densitybench_output({"rooms": 4})["admissibleForRealtimeDensity"])


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = fpp.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_validate_and_summarize_cli(self):
        with tempfile.TemporaryDirectory() as d:
            rp = os.path.join(d, "r.json")
            self.assertEqual(self.run_cli("synthetic", "C13", "--out", rp)[0], 0)
            code, out, _ = self.run_cli("validate", rp)
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out)["status"], "ADMITTED-SYNTHETIC-CONTROL")
            code, out, _ = self.run_cli("summarize", rp)
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(out)["cell"], "C13")
            r = canonical.load(rp)
            r["sides"]["port"]["trials"].pop()
            with open(rp, "w") as f:
                f.write(canonical.pretty(r))
            self.assertEqual(self.run_cli("validate", rp)[0], 1)
            self.assertEqual(self.run_cli("summarize", rp)[0], 1)

    def test_matrix_and_script_cli(self):
        self.assertEqual(self.run_cli("matrix")[0], 0)
        code, out, _ = self.run_cli("script", "arena-human-v1", "--duration-ms", "11200")
        self.assertEqual(code, 0)
        self.assertIn("2 whole cycles", out)

    def test_evidence_receipt_matches_a_fresh_run(self):
        path = os.path.join(EVIDENCE, "synthetic", "SYNTHETIC-controls-receipt.json")
        if not os.path.isfile(path):
            self.skipTest("controls receipt not written yet")
        rec, failures = fpp.run_controls(MATRIX, REPO)
        self.assertEqual(failures, [])
        saved = canonical.load(path)
        self.assertEqual(saved["counts"], rec["counts"])
        self.assertEqual([b["reportSha256"] for b in saved["bases"]], [b["reportSha256"] for b in rec["bases"]])
        self.assertEqual([(c["control"], c["refusalCodes"]) for c in saved["refusals"]],
                         [(c["control"], c["refusalCodes"]) for c in rec["refusals"]])


if __name__ == "__main__":
    unittest.main()
