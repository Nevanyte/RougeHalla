"""Adapters over the outputs of the EXISTING collectors. They convert what those collectors already write into this
schema's metric values, or assess an existing receipt for admissibility. They never measure, never launch anything and
never copy private strings (paths, URLs, profile names) out of their input.

    latency_report(report)          tools/latency/e2e.cjs JSON (report.cjs verdict) -> port-side trial metrics
    server_health_series(snaps, s)  successive rh-server GET /control/health bodies -> per-window server counters
    first_playable_receipt(report)  the first-playable browser receipt format -> admissibility assessment
    map_bench_result(result)        tools/map-bench result.json -> paired-slice assessment (raw recomputed)
    perfproof_report(report)        tools/perfproof report.json -> Rust-internal regression-gate assessment
    densitybench_output(out)        rh-server densitybench JSON -> assessment (paused clock: not real-time)
"""

from . import stats


class AdapterRefusal(Exception):
    pass


def _absent(reason, detail):
    return {"status": "absent", "reason": reason, "detail": detail}


def _m(source, unit, samples=None, value=None):
    d = {"status": "measured", "source": source, "unit": unit}
    if samples is not None:
        d["samples"] = samples
    else:
        d["value"] = value
    return d


# ---------------------------------------------------------------- tools/latency

def latency_report(report):
    """The trial-scope metrics an existing tools/latency run contributes to the PORT side of an input-latency cell.
    Only a report whose own verdict (tools/latency/report.cjs) is PASS is used; every trial must be complete."""
    verdict = (report.get("summary") or {}).get("verdict") or {}
    if verdict.get("status") != "PASS" or verdict.get("complete") is not True:
        raise AdapterRefusal(f"tools/latency verdict is {verdict.get('status')!r}, not a complete PASS")
    trials = report.get("trials") or []
    if len(trials) != report.get("expectedTrials"):
        raise AdapterRefusal("trial coverage differs from expectedTrials")
    by_profile = {}
    for t in trials:
        prof = t.get("profile") or {}
        key = (prof.get("rttMs"), prof.get("jitterMs"))
        for k in ("sampleToPresentMs", "sampleToOpponentMs"):
            x = t.get(k)
            if not isinstance(x, (int, float)) or x < 0:
                raise AdapterRefusal(f"trial {t.get('index')}: {k} missing or negative")
        by_profile.setdefault(key, []).append(t)
    out = []
    for (rtt, jitter), ts in sorted(by_profile.items(), key=lambda kv: (kv[0][0] or 0, kv[0][1] or 0)):
        prof = next((p for p in report.get("profiles") or [] if p.get("rttMs") == rtt), {})
        out.append({
            "impairment": {"addedRttMs": rtt, "jitterMs": jitter, "seed": prof.get("seed"),
                           "injected": prof.get("injected", False), "direct": bool(report.get("direct"))},
            "trialMetrics": {
                "latency.input_to_self_visible_ms": _m("input-to-post-present-trace", "ms", [t["sampleToPresentMs"] for t in ts]),
                "latency.input_to_opponent_visible_ms": _m("input-to-post-present-trace", "ms", [t["sampleToOpponentMs"] for t in ts]),
                "net.socket_rtt_ms": _absent("not-collected",
                                             "tools/latency keeps only count/p50/p95/max of the Unity Ping/Pong RTT per client; "
                                             "the final campaign must retain the raw ping samples"),
            },
            "events": len(ts),
        })
    return {
        "stack": "rust-native-unity-web",
        "serverIdentity": report.get("serverIdentity"),
        "profiles": out,
        "pairable": False,
        "pairingNote": ("Unity-only post-Present trace. The legacy client has no equivalent hook, so a paired input-latency cell "
                        "needs a stack-neutral pixel-change-probe on both stacks; these values stay port-side diagnostics."),
    }


# ---------------------------------------------------------------- rh-server /control/health

def server_health_series(snapshots, window_seconds, tolerance=0.02):
    """Per-window counters from successive `/control/health` bodies sampled at window boundaries.

    `snapshots` is a list of {"atMs": <monotonic ms>, "health": <the JSON body>}; window i spans snapshots i..i+1.
    Counters are process-wide (every room of the process). Step-time quantiles in that body are cumulative log-histogram
    bucket bounds, so no per-window raw step time can be derived: server.tick_ms is reported absent, never estimated."""
    if len(snapshots) < 2:
        raise AdapterRefusal("at least two snapshots are needed for one window")
    windows = []
    for i, (a, b) in enumerate(zip(snapshots, snapshots[1:])):
        dt = b["atMs"] - a["atMs"]
        if abs(dt - window_seconds * 1000.0) > tolerance * window_seconds * 1000.0:
            raise AdapterRefusal(f"window {i}: snapshots {dt:.1f} ms apart, expected {window_seconds * 1000:.0f}")
        ma = (a["health"].get("metrics") if "metrics" in a["health"] else a["health"]) or {}
        mb = (b["health"].get("metrics") if "metrics" in b["health"] else b["health"]) or {}
        d = {}
        for k in ("steps", "lateSteps", "droppedSteps", "bytesOut"):
            if k not in ma or k not in mb:
                raise AdapterRefusal(f"window {i}: counter {k} missing")
            d[k] = mb[k] - ma[k]
            if d[k] < 0:
                raise AdapterRefusal(f"window {i}: counter {k} went backwards (process restart?)")
        rss = mb.get("rssBytes")
        windows.append({
            "index": i, "startMs": a["atMs"], "endMs": b["atMs"],
            "metrics": {
                "server.ticks": _m("server-counters", "ticks", value=d["steps"]),
                "server.tick_budget_misses": _m("server-counters", "ticks", value=d["lateSteps"] + d["droppedSteps"]),
                "server.rss_bytes": (_m("server-counters", "bytes", [rss]) if isinstance(rss, int) and rss > 0 else
                                     _absent("instrument-unavailable",
                                             "rh-server reads rssBytes from /proc/self/status (Linux only); "
                                             "use the OS process sampler on macOS")),
                "server.tick_ms": _absent("instrument-unavailable",
                                          "rh-server exports cumulative stepUs count/p50/p99/max only; per-window raw step "
                                          "times need a reviewed bucket-count or per-step export"),
            },
            "bytesOutDelta": d["bytesOut"],
        })
    return {"windows": windows, "scope": "process-wide counters (all rooms of the process)"}


# ---------------------------------------------------------------- existing receipts (assessment only)

def _summary_only_paths(value, path=""):
    """Key paths (never values) of objects that hold quantiles without the raw values they summarise."""
    out = []
    if isinstance(value, dict):
        has_q = any(k in value for k in ("p50", "p95", "p99", "median"))
        has_raw = any(isinstance(x, list) and x and all(isinstance(y, (int, float)) for y in x) for x in value.values())
        if has_q and not has_raw:
            out.append(path or "$")
        for k, x in value.items():
            out += _summary_only_paths(x, f"{path}.{k}" if path else k)
    elif isinstance(value, list):
        for x in value[:1]:
            out += _summary_only_paths(x, path + "[]")
    return out


def first_playable_receipt(report):
    """Why a first-playable browser receipt cannot enter a paired comparison. Copies no strings from the input."""
    findings = []
    summary_only = _summary_only_paths(report)
    if summary_only:
        findings.append({"code": "SUMMARY_WITHOUT_RAW", "detail": f"{len(summary_only)} channel(s) hold quantiles without "
                         f"their raw values: {', '.join(summary_only)}"})
    findings.append({"code": "CELL_UNKNOWN", "detail": "single-stack MVP scene: no legacy side, no matrix cell, no pinned "
                     "map, no server-side load counts"})
    private = _count_private(report)
    if private:
        findings.append({"code": "PRIVACY", "detail": f"{private} value(s) hold a home-directory path, a "
                         "player name or a player-identifying URL parameter; a final report must hash or drop them"})
    browser = report.get("browser") or {}
    if browser.get("experimentalUncapped"):
        findings.append({"code": "DIAGNOSTIC_MIX", "detail": "uncapped diagnostic receipt; never a shipping frame rate"})
    return {"admissible": False, "findings": findings,
            "reusable": ["the collector's window definition (eligible frames after warm-up, active/alive gating)",
                         "its GPU timer-query and synchronous-callback channels, once they keep raw values",
                         "its environment block (browser version, GPU renderer, viewport, DPR, visibility)"]}


def _count_private(value):
    from .admission import HOME_PATH, PRIVATE_QUERY
    from .registry import PRIVATE_KEYS
    n = 0
    if isinstance(value, dict):
        n += sum(1 for k, v in value.items() if isinstance(v, str) and v and
                 any(pk.replace("_", "") in k.lower().replace("_", "") for pk in PRIVATE_KEYS))
        return n + sum(_count_private(v) for v in value.values())
    if isinstance(value, list):
        return sum(_count_private(v) for v in value)
    if isinstance(value, str) and (HOME_PATH.search(value) or PRIVATE_QUERY.search(value)):
        n += 1
    return n


def map_bench_result(result):
    """tools/map-bench is the one existing genuinely paired raw benchmark (same seeds, alternating order, every map
    hash-checked against the original pins). Recompute its summaries from its raw samples and state its scope."""
    out = {"scope": "slice:map-generation", "fullGameAdmissible": False, "modes": {}, "findings": []}
    cfg = result.get("configuration") or {}
    seeds = cfg.get("measured_seeds")
    for mode in ("plain", "styled"):
        r, t = (result.get("rust") or {}).get(mode) or {}, (result.get("typescript") or {}).get(mode) or {}
        rs, ts = r.get("samples") or [], t.get("samples") or []
        paired = ([s["seed"] for s in rs] == [s["seed"] for s in ts] == seeds and
                  [s["hash"] for s in rs] == [s["hash"] for s in ts])
        row = {"samples": [len(rs), len(ts)], "sameSeedsAndHashes": paired}
        for side, rows, summ in (("rust", rs, r.get("summary") or {}), ("typescript", ts, t.get("summary") or {})):
            vals = sorted(s["elapsed_ns"] for s in rows)
            if not vals:
                continue
            nr = stats.nearest_rank(vals, 50)
            mid = (vals[(len(vals) - 1) // 2] + vals[len(vals) // 2]) / 2
            stored = summ.get("median_ns")
            row[side] = {"recomputedNearestRankP50Ns": nr, "recomputedMidpointMedianNs": mid, "storedMedianNs": stored,
                         "storedMatches": ("midpoint-median" if stored == mid else
                                           "midpoint-median truncated to integer ns" if stored == int(mid) else
                                           "nearest-rank" if stored == nr else "neither"),
                         "recomputedNearestRankP95Ns": stats.nearest_rank(vals, 95), "storedP95Ns": summ.get("p95_ns")}
        out["modes"][mode] = row
    if not cfg.get("alternating_first_mode_by_seed_parity"):
        out["findings"].append({"code": "TRIAL_ORDER", "detail": "modes were not interleaved"})
    if result.get("dirty") is not False:
        out["findings"].append({"code": "BUILD_DIRTY", "detail": "measured from a dirty working tree (revision alone is not the source identity)"})
    out["findings"].append({"code": "CELL_UNKNOWN", "detail": "map generation is a slice; a slice timing cannot establish full-game speedup (R-OPT-4)"})
    return out


def perfproof_report(report):
    """tools/perfproof compares two Rust revisions by deterministic instruction/allocation counts. It is the regression
    guard for the optimise-then-repeat step of R-OPT-4 on the port side; it has no legacy counterpart (V8 JIT code has
    no comparable Ir), so it never enters a cross-stack cell."""
    rows = report.get("workloads") or []
    return {"role": "port-internal A/B regression gate (baseline vs candidate Rust revision)",
            "crossStackPairable": False,
            "baseline": report.get("baseline"), "candidate": report.get("candidate"),
            "workloads": sorted(r.get("name") for r in rows),
            "gatePassed": not report.get("violations"),
            "violations": len(report.get("violations") or [])}


def densitybench_output(out):
    """densitybench runs the production room path on a PAUSED tokio clock: its counts are deterministic and its wall
    figures are an estimate. It cannot fill a server-density-realtime cell (no real pacer, no sockets)."""
    return {"admissibleForRealtimeDensity": False,
            "reason": "paused clock; capacity block is an ESTIMATE (its own label)",
            "deterministicCounts": {k: out.get(k) for k in ("rooms", "humansPerRoom", "fillTo", "matchSeconds", "steps",
                                                            "droppedSteps", "frames", "bytes") if k in out},
            "use": "port-side planning input for which room counts C06-C09 should bracket"}
