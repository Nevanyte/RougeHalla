"""Summaries computed only from the raw measurements of an ADMITTED report. The summary never replaces the report: it
names the report by hash, the matrix by hash and this tool by hash, and contains no wall-clock time, so the same raw
report always yields byte-identical summary JSON."""

from . import FORMAT_SUMMARY, SYNTHETIC_LABEL
from . import admission, canonical, registry, stats

CLASS_LABELS = {
    registry.REALTIME: "Real-time end-to-end at the authoritative 20 Hz. frame.callback_* is the requestAnimationFrame "
                       "callback rate and its synchronous CPU; it is not displayed frames (frame.presented_* is).",
    registry.DIAGNOSTIC: "DIAGNOSTIC: frame-rate limit and vsync disabled on both stacks. The callback rate here is submission "
                         "headroom, not displayed FPS and not a shipping frame rate.",
    registry.THROUGHPUT: "Unpaced simulation throughput. It is not real-time server performance, not end-to-end latency and "
                         "says nothing about rendered frames.",
    registry.DENSITY: "Server-only density at the real 20 Hz pacer; no browser. Sustained means zero budget misses in "
                      "every window of every trial.",
    registry.LATENCY: "Socket RTT (net.socket_rtt_ms, application ping/pong) and input-to-visible response (latency.*) are "
                      "separate quantities; neither is derived from the other.",
    registry.STARTUP: "Startup for one declared cache state only; cold and warm are separate cells.",
}


class RefusedError(Exception):
    def __init__(self, verdict):
        super().__init__(f"report refused: {verdict['refusalCodes']}")
        self.verdict = verdict


def _holders(trial, scope):
    if scope == "trial":
        return [trial.get("metrics") or {}]
    return [w.get("metrics") or {} for w in trial.get("windows") or []]


def _metric_summary(trials, mid, cell):
    spec = registry.METRICS[mid]
    measured, absent, total = [], [], 0
    per_trial = []
    hist_bounds, hist_counts = None, None
    for ti, t in enumerate(trials):
        tvals = []
        for m in _holders(t, spec["scope"]):
            total += 1
            val = m.get(mid)
            if val["status"] == "absent":
                absent.append(f"{val['reason']}: {val['detail']}")
                continue
            measured.append(val)
            if "histogram" in val:
                b, c = val["histogram"]["bounds"], val["histogram"]["counts"]
                if hist_bounds is None:
                    hist_bounds, hist_counts = list(b), [0] * len(c)
                if b != hist_bounds:
                    raise ValueError(f"{mid}: histogram bounds differ between windows")
                hist_counts = [x + y for x, y in zip(hist_counts, c)]
            elif spec["kind"] == "samples":
                tvals.extend(val["samples"])
            else:
                tvals.append(val["value"])
        if tvals:
            d = stats.describe(tvals)
            per_trial.append({"trial": ti, "count": d["count"], "p50": d["p50"], "p99": d["p99"]})
    if not measured:
        return {"status": "absent", "reasons": sorted(set(absent)), "coverage": 0.0}
    out = {"status": "measured", "source": measured[0]["source"], "unit": spec["unit"], "kind": spec["kind"],
           "coverage": len(measured) / total, "crossStackComparable": spec["crossStackComparable"]}
    if absent:
        out["absentReasons"] = sorted(set(absent))
    if hist_bounds is not None:
        out["pooled"] = stats.histogram_describe(hist_bounds, hist_counts)
        return out
    pooled = [x for t in trials for m in _holders(t, spec["scope"])
              for x in ((m[mid].get("samples") or []) if spec["kind"] == "samples" else [m[mid].get("value")])
              if m[mid]["status"] == "measured"]
    out["pooled"] = stats.describe(pooled)
    if spec["kind"] == "counter":
        out["total"] = sum(pooled)
        out["pooledMeaning"] = "distribution of per-window (or per-trial) counter values"
    out["perTrial"] = per_trial
    p50s = [r["p50"] for r in per_trial]
    out["trialP50Range"] = [min(p50s), max(p50s)]
    return out


def _derived(trials, cell, metrics, side_env):
    d = {}
    ws = cell.get("windowSeconds")
    if ws and metrics.get("frame.callback_interval_ms", {}).get("status") == "measured":
        rates = [len(w["metrics"]["frame.callback_interval_ms"]["samples"]) / ws
                 for t in trials for w in t["windows"] if w["metrics"]["frame.callback_interval_ms"]["status"] == "measured"]
        d["callbackRateHz"] = stats.describe(rates)
        if cell["class"] == registry.DIAGNOSTIC:
            d["callbackRateHz"]["label"] = "diagnostic callback rate; not displayed or shipping FPS"
        refresh = (side_env.get("display") or {}).get("refreshHz")
        if refresh:
            p50 = metrics["frame.callback_interval_ms"]["pooled"]["p50"]
            limited = abs(p50 - 1000.0 / refresh) <= 0.03 * (1000.0 / refresh)
            d["display"] = {"refreshHz": refresh, "callbackP50AtRefresh": limited,
                            "note": ("callback rate sits at the recorded display refresh: the display, not the stack, bounds it; "
                                     "the headroom above it is only visible in the diagnostic cell") if limited else
                                    "callback rate differs from the display refresh"}
    if ws:
        for mid, key in (("net.down_bytes", "downBytesPerSecond"), ("net.up_bytes", "upBytesPerSecond")):
            if metrics.get(mid, {}).get("status") == "measured":
                d[key] = stats.describe([w["metrics"][mid]["value"] / ws for t in trials for w in t["windows"]
                                         if w["metrics"][mid]["status"] == "measured"])
        if metrics.get("server.tick_budget_misses", {}).get("status") == "measured":
            d["sustained"] = metrics["server.tick_budget_misses"]["total"] == 0
    if metrics.get("sim.step_wall_us", {}).get("status") == "measured":
        steps = sum(len(w["metrics"]["sim.step_wall_us"]["samples"]) for t in trials for w in t["windows"])
        wall_us = sum(sum(w["metrics"]["sim.step_wall_us"]["samples"]) for t in trials for w in t["windows"])
        d["stepsPerComputeSecond"] = {"value": steps / (wall_us / 1e6),
                                      "label": "steps per second of measured step time (unpaced; excludes work between steps)"}
    if metrics.get("net.socket_rtt_ms", {}).get("status") == "measured":
        jit = [stats.consecutive_jitter(t["metrics"]["net.socket_rtt_ms"]["samples"]) for t in trials
               if t["metrics"]["net.socket_rtt_ms"]["status"] == "measured"]
        jit = [j for j in jit if j is not None]
        if jit:
            d["socketRttJitterMs"] = dict(stats.describe(jit), method="mean |consecutive RTT difference| per trial")
    return d


def _load(trials):
    out = {}
    for k in admission.LOAD_KEYS:
        vals = [w["load"][k] for t in trials for w in t.get("windows") or [] if isinstance(w.get("load"), dict) and k in w["load"]]
        if vals:
            out[k] = {"median": stats.median(vals), "min": min(vals), "max": max(vals)}
    return out


def summarize(report, matrix, repo_root=None):
    verdict = admission.admit(report, matrix, repo_root)
    if verdict["status"] == "REFUSED":
        raise RefusedError(verdict)
    cell = admission.find_cell(matrix, report["cell"])
    listed = sorted(set(cell["required"]) | set(cell["optional"]))
    labels = ([SYNTHETIC_LABEL] if report.get("synthetic") else []) + [CLASS_LABELS.get(cell["class"], "")]
    out = {"format": FORMAT_SUMMARY, "synthetic": report.get("synthetic") is True, "cell": cell["id"],
           "cellClass": cell["class"], "verdict": verdict["status"], "reportSha256": canonical.sha256_json(report),
           "matrixSha256": canonical.sha256_json(matrix), "toolSha256": canonical.tool_sha256(), "labels": labels,
           "sides": {}, "comparisons": {}}
    for side in admission.SIDES:
        s = report["sides"][side]
        trials = s["trials"]
        metrics = {mid: _metric_summary(trials, mid, cell) for mid in listed}
        out["sides"][side] = {"stack": s["stack"], "metrics": metrics,
                              "derived": _derived(trials, cell, metrics, s.get("environment") or {}),
                              "load": _load(trials)}
    for mid in listed:
        a, b = out["sides"]["legacy"]["metrics"][mid], out["sides"]["port"]["metrics"][mid]
        if a["status"] != "measured" or b["status"] != "measured":
            out["comparisons"][mid] = {"notCompared": "absent on " + " and ".join(
                n for n, x in (("legacy", a), ("port", b)) if x["status"] != "measured")}
        elif not registry.METRICS[mid]["crossStackComparable"]:
            out["comparisons"][mid] = {"notCompared": "stack-specific channel (different memory/GC models)"}
        elif a["source"] != b["source"]:
            out["comparisons"][mid] = {"notCompared": f"different instruments ({a['source']} vs {b['source']})"}
        elif "resolution" in a["pooled"] or "resolution" in b["pooled"]:
            out["comparisons"][mid] = {"notCompared": "histogram bucket bounds; compare the distributions, not ratios"}
        else:
            r = {}
            for q in ("p50", "p95", "p99", "mean"):
                x, y = a["pooled"][q], b["pooled"][q]
                r[q] = (y / x) if x else None
            out["comparisons"][mid] = {"portOverLegacy": r,
                                       "note": "ratio of pooled order statistics; direction of 'better' depends on the metric"}
    return out
