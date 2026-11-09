"""SYNTHETIC controls. Every report built here carries `synthetic: true`, the SYNTHETIC label and a SYNTHETIC machine,
so the validator can only ever return ADMITTED-SYNTHETIC-CONTROL for it, never final evidence. The numbers are made up
by a fixed integer generator (no wall clock, no OS randomness): the same call always returns the same bytes. They model
nothing measured and must never be quoted as performance of either stack.

`base_report(cell_id)` builds an admissible pair for a matrix cell; `REFUSAL_CONTROLS` are named single mutations of
the C01 base, each paired with the refusal codes it must produce."""

import copy
import hashlib

from . import FORMAT_REPORT, SYNTHETIC_LABEL
from . import admission, canonical, matrix as matrix_mod, registry, script

PAIRING_RECEIPT = "docs/evidence/full-port-perf-preparation/synthetic/SYNTHETIC-content-pairing.json"
PAIRING_RECEIPT_BODY = {
    "label": SYNTHETIC_LABEL,
    "purpose": "Stands in for the content-correspondence receipt a real pair must cite (legacy revision <-> port content hash).",
    "legacySourceRevision": hashlib.sha1(b"SYNTHETIC legacy revision").hexdigest(),
    "portContentHash": "5e57e71c5e57e71c",
}


def _h(text, n=64):
    return hashlib.sha256(text.encode()).hexdigest()[:n]


class Gen:
    """Deterministic 64-bit LCG (Knuth MMIX constants); values rounded to 3 decimals for compact, stable JSON."""

    def __init__(self, seed):
        self.s = (seed * 2862933555777941757 + 3037000493) % (1 << 64)

    def u(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) % (1 << 64)
        return (self.s >> 11) / float(1 << 53)

    def around(self, mean, spread, lo=None):
        x = mean + (self.u() * 2 - 1) * spread
        if lo is not None:
            x = max(lo, x)
        return round(x, 3)


# Per-stack synthetic levels (arbitrary; chosen only so the two sides differ visibly).
LEVEL = {
    "legacy": {"cpu": 4.0, "tick": 3.0, "srss": 180e6, "brss": 600e6, "bcpu": 0.45, "scpu": 0.12, "down": 11000, "up": 400,
               "gpu": 0.30, "heap": 120e6, "step": 2800.0, "enc": 2_400_000, "dec": 7_800_000, "ready": 900},
    "port": {"cpu": 1.7, "tick": 0.08, "srss": 22e6, "brss": 900e6, "bcpu": 0.30, "scpu": 0.012, "down": 4000, "up": 370,
             "gpu": 0.21, "heap": 25e6, "step": 60.0, "enc": 23_500_000, "dec": 55_800_000, "ready": 2400},
}


def _m(source, unit, samples=None, value=None):
    d = {"status": "measured", "source": source, "unit": unit}
    if samples is not None:
        d["samples"] = samples
    else:
        d["value"] = value
    return d


def _absent(reason, detail):
    return {"status": "absent", "reason": reason, "detail": detail}


def _frames(g, mean, spread, window_ms):
    out, total = [], 0.0
    while total < window_ms - mean / 2:
        x = g.around(mean, spread, lo=0.1)
        out.append(x)
        total += x
    return out


def _window_metrics(side, cell, g, lv):
    cls = cell["class"]
    listed = set(cell["required"]) | set(cell["optional"])
    diag = cell.get("diagnostic")
    frame_ms = 1.3 if diag else 1000.0 / 60
    m = {}
    if "frame.callback_interval_ms" in listed:
        frames = _frames(g, frame_ms, 0.35 if not diag else 0.2, 1000.0)
        m["frame.callback_interval_ms"] = _m("raf-timestamps", "ms", frames)
        if "frame.callback_cpu_ms" in listed:
            m["frame.callback_cpu_ms"] = _m("raf-sync-cpu", "ms",
                                            [g.around(min(lv["cpu"], frame_ms * 0.8), 0.5, lo=0.1) for _ in frames])
        if "gpu.elapsed_ms" in listed:
            m["gpu.elapsed_ms"] = _m("webgl-timer-query", "ms", [g.around(lv["gpu"], 0.05, lo=0.05) for _ in frames])
            m["gpu.timer_disjoint"] = _m("webgl-timer-query", "count", value=0)
    if "frame.presented_interval_ms" in listed:
        m["frame.presented_interval_ms"] = _absent("instrument-unavailable",
                                                   "SYNTHETIC: no presentation-side trace in this control")
    if "server.tick_ms" in listed:
        m["server.tick_ms"] = _m("server-step-timer", "ms", [g.around(lv["tick"], lv["tick"] / 3, lo=0.01)
                                                             for _ in range(20 * cell.get("_rooms", 1))])
    if "server.ticks" in listed:
        m["server.ticks"] = _m("server-counters", "ticks", value=20 * cell.get("_rooms", 1))
    if "server.tick_budget_misses" in listed:
        m["server.tick_budget_misses"] = _m("server-counters", "ticks", value=0)
    if "server.rss_bytes" in listed:
        m["server.rss_bytes"] = _m("os-process-sampler", "bytes", [round(lv["srss"] * cell.get("_rooms", 1) + g.around(0, 1e5)) for _ in range(4)])
    if "client.browser_rss_bytes" in listed:
        m["client.browser_rss_bytes"] = _m("os-process-sampler", "bytes", [round(lv["brss"] + g.around(0, 1e6)) for _ in range(4)])
    if "cpu.browser_process_s" in listed:
        m["cpu.browser_process_s"] = _m("os-process-sampler", "cpu_s", value=g.around(lv["bcpu"], 0.03))
    if "cpu.server_process_s" in listed:
        m["cpu.server_process_s"] = _m("os-process-sampler", "cpu_s", value=g.around(lv["scpu"] * cell.get("_rooms", 1), 0.005, lo=0.001))
    if "client.js_heap_bytes" in listed:
        m["client.js_heap_bytes"] = _m("js-heap", "bytes", [round(lv["heap"] + g.around(0, 1e6)) for _ in range(4)])
    if "client.wasm_heap_bytes" in listed:
        m["client.wasm_heap_bytes"] = (_m("wasm-memory", "bytes", [69730304] * 4) if side == "port" else
                                       _absent("unsupported-by-stack", "SYNTHETIC: the legacy client has no Wasm heap"))
    if "client.managed_alloc_bytes" in listed:
        m["client.managed_alloc_bytes"] = _absent("instrument-unavailable",
                                                  "SYNTHETIC: per-frame GC allocation counters need a development build")
    if "client.gc_pause_ms" in listed:
        m["client.gc_pause_ms"] = (_m("cdp-tracing-gc", "ms", [g.around(0.8, 0.5, lo=0.05) for _ in range(3)]) if side == "legacy"
                                   else _absent("instrument-unavailable", "SYNTHETIC: no release-build GC pause channel"))
    for mid, key in (("net.down_bytes", "down"), ("net.up_bytes", "up")):
        if mid in listed:
            m[mid] = _m("ws-frame-tap", "bytes", value=round(g.around(lv[key], lv[key] * 0.1)))
    if "recorder.self_ms" in listed:
        m["recorder.self_ms"] = _m("recorder-self-timer", "ms", value=(g.around(2.0, 0.2, lo=0.0) if cls != registry.THROUGHPUT
                                                                          else g.around(0.002, 0.001, lo=0.0)))
    if "sim.step_wall_us" in listed:
        m["sim.step_wall_us"] = _m("headless-step-timer", "us", [g.around(lv["step"], lv["step"] / 4, lo=1.0) for _ in range(20)])
        m["sim.steps"] = _m("headless-step-timer", "ticks", value=20)
    return m


def _trial_metrics(side, cell, g, lv):
    listed = set(cell["required"]) | set(cell["optional"])
    m = {}
    if "net.socket_rtt_ms" in listed:
        base = 1.0 + (cell.get("impairment") or {}).get("addedRttMs", 0)
        m["net.socket_rtt_ms"] = _m("app-ping-pong", "ms", [g.around(base, 0.4 + base * 0.05, lo=0.2) for _ in range(30)])
    if "net.loss_fraction" in listed:
        m["net.loss_fraction"] = _absent("unsupported-by-stack",
                                         "SYNTHETIC: WebSocket over TCP is reliable; the proxy injects delay, not loss")
    for mid, extra in (("latency.input_to_self_visible_ms", 0), ("latency.input_to_opponent_visible_ms", 50)):
        if mid in listed:
            base = 60 + extra + (cell.get("impairment") or {}).get("addedRttMs", 0)
            m[mid] = _m("pixel-change-probe", "ms", [g.around(base, 12, lo=1.0) for _ in range(30)])
    for mid, val in (("startup.encoded_bytes", lv["enc"]), ("startup.decoded_bytes", lv["dec"])):
        if mid in listed:
            m[mid] = _m("resource-timing", "bytes", value=val)
    if "startup.payload_complete_ms" in listed:
        slow = 1.0 if not cell.get("networkThrottle") else lv["enc"] / 2.5e6
        warm = 0.2 if cell.get("cacheState") == "warm" else 1.0
        m["startup.payload_complete_ms"] = _m("resource-timing", "ms", value=g.around(400 * slow * warm + 100, 20))
        m["startup.engine_ready_ms"] = _m("lifecycle-marks", "ms", value=g.around(lv["ready"] * warm + 600 * slow, 50))
        m["startup.first_snapshot_ms"] = _m("lifecycle-marks", "ms", value=g.around(lv["ready"] * warm + 900 * slow, 50))
        m["startup.join_to_active_ms"] = _m("lifecycle-marks", "ms", value=g.around(3200, 200))
    return m


def _load(cell, wl, g, i):
    rooms = wl["rooms"]
    load = {"seatedPlayers": wl["seatedPlayers"], "aliveHumans": wl["humans"],
            "mobsAlive": (190 - i // 6) * rooms if wl["mode"] != "full-arena-coliseum" else 12,
            "projectiles": int(g.around(5 * rooms, 3, lo=0)), "commandsAccepted": int(g.around(55 * max(1, wl["humans"]) * rooms, 8, lo=1))}
    if cell.get("browser"):
        load["actorsVisible"] = int(g.around(6 if wl["humans"] < 2 else 2, 1.5, lo=4 if "COLISEUM" in wl["id"] else 2))
    return load


def _side(side, cell, mtx, seed):
    g = Gen(seed)
    lv = LEVEL[side]
    wl = dict(mtx["workloads"][cell["workload"]])
    cell = dict(cell, _rooms=wl["rooms"])
    spec = mtx["stacks"][side]["components"]
    rev = PAIRING_RECEIPT_BODY["legacySourceRevision"] if side == "legacy" else hashlib.sha1(b"SYNTHETIC port revision").hexdigest()
    builds = {}
    for comp in ("server", "client") if cell.get("browser") else ("server",):
        art = _h(f"SYNTHETIC {side} {comp} artifact")
        b = {"kind": spec[comp]["kind"], "release": True, "development": False, "dirty": False, "sourceRevision": rev,
             "artifactSha256": art, "artifactSha256After": art}
        for f in spec[comp].get("forbiddenTrue", []):
            b[f] = False
        if side == "port":
            b["identity"] = {"protocol": 14, "contentHash": PAIRING_RECEIPT_BODY["portContentHash"]}
        builds[comp] = b
    script_id = wl.pop("inputScript", None)
    loadfloors = wl.pop("loadFloors")
    for k in ("description",):
        wl.pop(k, None)
    if script_id:
        wl["inputScriptSha256"] = script.sha256(canonical.load(
            matrix_mod.os.path.join(canonical.TOOL_ROOT, mtx["inputScripts"][script_id])))
    wl["contentIdentity"] = ({"legacySourceRevision": PAIRING_RECEIPT_BODY["legacySourceRevision"]} if side == "legacy"
                             else {"portContentHash": PAIRING_RECEIPT_BODY["portContentHash"]})
    env = {"machine": {"model": "SYNTHETIC-MODEL", "cpu": "SYNTHETIC-CPU", "logicalCpus": 18,
                       "memoryBytes": 68719476736, "os": "SYNTHETIC-OS", "osBuild": "0", "arch": "arm64", "native": True},
           "power": {"powerSource": "ac", "lowPowerMode": False, "thermalState": "nominal"},
           "network": {"throttle": cell.get("networkThrottle")}}
    if cell.get("browser"):
        flags = ["--use-angle=metal"] + (["--disable-frame-rate-limit", "--disable-gpu-vsync"] if cell.get("diagnostic") else [])
        env["display"] = {"refreshHz": 60, "resolution": [3024, 1964], "scale": 2, "variableRefresh": False}
        env["browser"] = {"product": "SYNTHETIC-Browser", "version": "0.0.0", "executableSha256": _h("SYNTHETIC browser"),
                          "headless": False, "flags": flags, "visibility": "visible", "focused": True,
                          "frameRateLimitDisabled": bool(cell.get("diagnostic")), "vsyncDisabled": bool(cell.get("diagnostic"))}
        vp = cell["viewport"]
        env["viewport"] = {"canvas": vp["canvas"], "dpr": vp["dpr"], "window": [1280, 900]}
    env["frameRateLimit"] = dict(mtx["fixed"]["frameRateLimit"][side], capped=False)
    order = mtx["admission"]["trialOrder"]
    positions = [i for i, s in enumerate(order) if s == side]
    trials = []
    for ti in range(mtx["admission"]["trialsPerSide"]):
        t = {"index": ti, "orderPosition": positions[ti], "cacheState": cell["cacheState"]}
        if cell.get("warmupSeconds"):
            t["warmup"] = {"seconds": cell["warmupSeconds"]}
        elif cell.get("warmupTicks"):
            t["warmup"] = {"ticks": cell["warmupTicks"]}
        else:
            t["warmup"] = {}
        ic = {"ok": True, "phase": cell["initialPhase"]}
        oc = {"crashed": False, "errors": [], "phaseAtEnd": cell["endPhases"][0], "measuredHumanAlive": True}
        if cell["initialPhase"] == "navigation":
            ic["cacheState"] = cell["cacheState"]
            oc.update(seatedPlayers=wl["seatedPlayers"], humans=wl["humans"], mapPin=wl["mapPin"])
        else:
            ic.update(seatedPlayers=wl["seatedPlayers"], humans=wl["humans"], mapPin=wl["mapPin"])
        if cell.get("deterministicPerStack"):
            oc["outcomeDigest"] = _h(f"SYNTHETIC {side} outcome", 16)
        windows = []
        tick = 600 + 37 * ti
        start = 30000.0 + 1000.0 * ti
        for wi in range(cell.get("windowsPerTrial", 0)):
            adv = cell.get("windowTicks") or 20 * cell["windowSeconds"]
            w = {"index": wi, "ticks": {"first": tick, "last": tick + adv}, "load": _load(cell, wl, g, wi),
                 "metrics": _window_metrics(side, cell, g, lv)}
            if cell.get("windowSeconds"):
                w["startMs"], w["endMs"] = round(start, 3), round(start + 1000.0 * cell["windowSeconds"], 3)
                start += 1000.0 * cell["windowSeconds"]
            tick += adv
            windows.append(w)
        t.update(initialCheck=ic, windows=windows, metrics=_trial_metrics(side, cell, g, lv), outcome=oc)
        trials.append(t)
    om = cell["overheadMetric"]
    n = cell.get("overheadMinSamples", mtx["admission"]["minOverheadControlSamples"])
    mean = {"frame.callback_interval_ms": 1.3 if cell.get("diagnostic") else 1000.0 / 60, "sim.step_wall_us": lv["step"],
            "server.tick_ms": lv["tick"], "startup.payload_complete_ms": 500.0}[om]
    ctl = {"metric": om, "minimal": [g.around(mean, mean * 0.005, lo=0.01) for _ in range(n)],
           "full": [g.around(mean, mean * 0.005, lo=0.01) for _ in range(n)]}
    recorder = {"id": "SYNTHETIC-recorder", "sha256": _h("SYNTHETIC recorder"), "bufferOverflow": False, "droppedRecords": 0,
                "overheadControl": ctl}
    return {"stack": mtx["stacks"][side]["stack"], "builds": builds, "environment": env, "workload": wl,
            "impairment": (dict(cell["impairment"], proxySha256=_h("SYNTHETIC proxy")) if cell.get("impairment") else None),
            "recorder": recorder, "loadSource": "SYNTHETIC server-side load counters", "trials": trials,
            "_floors": loadfloors}


def base_report(cell_id, mtx=None):
    mtx = mtx or matrix_mod.load()
    cell = admission.find_cell(mtx, cell_id)
    if cell is None:
        raise KeyError(cell_id)
    sides = {}
    for i, side in enumerate(admission.SIDES):
        s = _side(side, cell, mtx, seed=1000 + 17 * i + sum(map(ord, cell_id)))
        s.pop("_floors")
        sides[side] = s
    return {"format": FORMAT_REPORT, "synthetic": True, "label": SYNTHETIC_LABEL, "matrixSha256": canonical.sha256_json(mtx),
            "cell": cell_id, "contentPairing": {
                "legacySourceRevision": PAIRING_RECEIPT_BODY["legacySourceRevision"],
                "portContentHash": PAIRING_RECEIPT_BODY["portContentHash"],
                "evidence": {"path": PAIRING_RECEIPT, "sha256": pairing_receipt_sha256()}},
            "trialOrder": list(mtx["admission"]["trialOrder"]), "sides": sides}


def pairing_receipt_text():
    return canonical.pretty(PAIRING_RECEIPT_BODY)


def pairing_receipt_sha256():
    return hashlib.sha256(pairing_receipt_text().encode()).hexdigest()


# ---------------------------------------------------------------- refusal controls (mutations of a C01 base)

def _each_window(r, side, fn, trials=None):
    for ti, t in enumerate(r["sides"][side]["trials"]):
        if trials is None or ti in trials:
            for w in t["windows"]:
                fn(w)


def _uncapped(r):
    for s in admission.SIDES:
        b = r["sides"][s]["environment"]["browser"]
        b["flags"] = b["flags"] + ["--disable-frame-rate-limit"]


def _overhead_shift(r):
    ctl = r["sides"]["port"]["recorder"]["overheadControl"]
    ctl["full"] = [round(x * 1.05, 3) for x in ctl["full"]]


def _drop_window(r):
    del r["sides"]["legacy"]["trials"][2]["windows"][17]


def _gap(r):
    w = r["sides"]["port"]["trials"][1]["windows"]
    for x in w[30:]:
        x["startMs"] += 250.0
        x["endMs"] += 250.0


def _idle(r):
    _each_window(r, "port", lambda w: w["load"].update(mobsAlive=0, actorsVisible=0, projectiles=0), trials=[0])


def _load_scale(r):
    _each_window(r, "port", lambda w: w["load"].update(mobsAlive=int(w["load"]["mobsAlive"] * 0.8)))


def _accelerated(r):
    def f(w):
        w["ticks"]["last"] = w["ticks"]["first"] + 40
        w["metrics"]["server.ticks"]["value"] = 40
    for t in r["sides"]["port"]["trials"]:
        prev = None
        for w in t["windows"]:
            if prev is not None:
                w["ticks"]["first"] = prev
            f(w)
            prev = w["ticks"]["last"]


def _zero_gpu(r):
    _each_window(r, "port", lambda w: w["metrics"]["gpu.elapsed_ms"].update(samples=[0.0] * len(w["metrics"]["gpu.elapsed_ms"]["samples"])), trials=[0])


def _implicit(r):
    del r["sides"]["legacy"]["trials"][0]["windows"][5]["metrics"]["server.tick_ms"]


def _req_absent(r):
    _each_window(r, "port", lambda w: w["metrics"].__setitem__("server.tick_ms", _absent(
        "instrument-unavailable", "per-window raw step times are not exported")))


def _summary_only(r):
    w = r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]
    w["frame.callback_interval_ms"] = {"status": "measured", "source": "raf-timestamps", "unit": "ms", "p50": 16.7, "p99": 18.6}


def _presented_raf(r):
    for s in admission.SIDES:
        _each_window(r, s, lambda w: w["metrics"].__setitem__("frame.presented_interval_ms", _m(
            "raf-timestamps", "ms", list(w["metrics"]["frame.callback_interval_ms"]["samples"]))))


def _rtt_from_trace(r):
    r["sides"]["port"]["trials"][0]["metrics"]["net.socket_rtt_ms"]["source"] = "input-to-post-present-trace"


def _throughput_metric(r):
    r["sides"]["port"]["trials"][0]["windows"][0]["metrics"]["sim.step_wall_us"] = _m("headless-step-timer", "us", [50.0])


def _cap60(r):
    r["sides"]["port"]["environment"]["frameRateLimit"]["unityTargetFrameRate"] = 60


def _target_fps(r):
    r["sides"]["legacy"]["environment"]["targetFps"] = 60


def _self_share(r):
    r["sides"]["legacy"]["trials"][3]["windows"][9]["metrics"]["recorder.self_ms"]["value"] = 30.0


def _instrument(r):
    _each_window(r, "port", lambda w: w["metrics"]["server.rss_bytes"].update(source="server-counters"))


def _privacy_path(r):
    for s in admission.SIDES:
        r["sides"][s]["environment"]["browser"]["executablePath"] = "/Users/someone/Library/Caches/browser/Browser"


def _privacy_token(r):
    r["sides"]["port"]["environment"]["browser"]["url"] = "http://127.0.0.1:8087/?server=ws%3A%2F%2Fx&token=abc"


def _unsynthetic(r):
    r["synthetic"] = False
    r.pop("label")


CONTROLS = [
    # name, mutation, codes that MUST be among the refusals
    ("mismatched-map", lambda r: r["sides"]["port"]["workload"].update(mapPin="8:0:dbb3602f"), {"WORKLOAD_MISMATCH"}),
    ("mismatched-bot-seed", lambda r: r["sides"]["legacy"]["workload"].update(botSeed=7002), {"WORKLOAD_MISMATCH"}),
    ("mismatched-population", lambda r: r["sides"]["port"]["workload"].update(bots=5, seatedPlayers=6), {"WORKLOAD_MISMATCH"}),
    ("different-machine", lambda r: r["sides"]["port"]["environment"]["machine"].update(memoryBytes=34359738368), {"MACHINE_MISMATCH"}),
    ("battery-power", lambda r: [r["sides"][s]["environment"]["power"].update(powerSource="battery") for s in admission.SIDES], {"MACHINE_MISMATCH"}),
    ("development-build", lambda r: r["sides"]["port"]["builds"]["client"].update(development=True, developmentBuild=True), {"BUILD_NOT_RELEASE"}),
    ("dirty-source", lambda r: r["sides"]["legacy"]["builds"]["server"].update(dirty=True), {"BUILD_DIRTY"}),
    ("artifact-changed-during-run", lambda r: r["sides"]["port"]["builds"]["server"].update(artifactSha256After=_h("other")), {"BUILD_CHANGED"}),
    ("short-revision", lambda r: [r["sides"]["legacy"]["builds"][c].update(sourceRevision="abc1234") for c in ("server", "client")], {"BUILD_PROVENANCE"}),
    ("port-client-server-split", lambda r: r["sides"]["port"]["builds"]["client"]["identity"].update(contentHash="0000000000000000"), {"PORT_IDENTITY_SPLIT"}),
    ("missing-content-pairing", lambda r: r.pop("contentPairing"), {"CONTENT_PAIRING"}),
    ("browser-version-mismatch", lambda r: r["sides"]["port"]["environment"]["browser"].update(version="0.0.1"), {"BROWSER_MISMATCH"}),
    ("headless-browser", lambda r: [r["sides"][s]["environment"]["browser"].update(headless=True) for s in admission.SIDES], {"BROWSER_POLICY"}),
    ("viewport-mismatch", lambda r: r["sides"]["port"]["environment"]["viewport"].update(dpr=2), {"VIEWPORT_MISMATCH"}),
    ("display-refresh-unrecorded", lambda r: [r["sides"][s]["environment"]["display"].pop("refreshHz") for s in admission.SIDES], {"DISPLAY_MISMATCH"}),
    ("uncapped-flag-in-normal-cell", _uncapped, {"DIAGNOSTIC_MIX"}),
    ("unity-frame-cap-60", _cap60, {"FRAME_CAP"}),
    ("fps-target-key", _target_fps, {"FORBIDDEN_KEY"}),
    ("overhead-subtraction-key", lambda r: r["sides"]["legacy"]["recorder"].update(overheadSubtracted=True), {"FORBIDDEN_KEY"}),
    ("script-mismatch", lambda r: [r["sides"][s]["workload"].update(inputScriptSha256=_h("other script")) for s in admission.SIDES], {"SCRIPT_MISMATCH"}),
    ("tick-rate-30hz", lambda r: [r["sides"][s]["workload"].update(tickHz=30) for s in admission.SIDES], {"TICK_RATE"}),
    ("accelerated-clock", _accelerated, {"TICK_COUNT"}),
    ("trial-order-blocked", lambda r: r.update(trialOrder=["legacy"] * 5 + ["port"] * 5), {"TRIAL_ORDER"}),
    ("too-few-trials", lambda r: r["sides"]["port"]["trials"].pop(), {"TRIAL_COUNT"}),
    ("short-warmup", lambda r: r["sides"]["legacy"]["trials"][1]["warmup"].update(seconds=5), {"WARMUP"}),
    ("cold-trial-in-warm-cell", lambda r: r["sides"]["port"]["trials"][4].update(cacheState="cold"), {"STARTUP_CACHE_STATE"}),
    ("missing-sample-window", _drop_window, {"WINDOW_COUNT", "WINDOW_MISSING"}),
    ("gap-between-windows", _gap, {"WINDOW_MISSING"}),
    ("idle-scene", _idle, {"LOAD_FLOOR"}),
    ("load-mismatch", _load_scale, {"LOAD_MISMATCH"}),
    ("initial-check-failed", lambda r: r["sides"]["port"]["trials"][0]["initialCheck"].update(ok=False), {"INITIAL_CHECK"}),
    ("measured-human-died", lambda r: r["sides"]["legacy"]["trials"][2]["outcome"].update(measuredHumanAlive=False), {"OUTCOME_CHECK"}),
    ("server-crashed", lambda r: r["sides"]["port"]["trials"][3]["outcome"].update(crashed=True), {"OUTCOME_CHECK"}),
    ("page-errors", lambda r: r["sides"]["port"]["trials"][3]["outcome"].update(errors=["decoder: bad frame"]), {"OUTCOME_CHECK"}),
    ("zero-as-absent-gpu", _zero_gpu, {"METRIC_ZERO_AS_ABSENT"}),
    ("implicit-absence", _implicit, {"METRIC_IMPLICIT_ABSENCE"}),
    ("required-metric-absent", _req_absent, {"METRIC_REQUIRED_ABSENT"}),
    ("summary-instead-of-raw", _summary_only, {"SUMMARY_WITHOUT_RAW"}),
    ("presented-frames-from-raf", _presented_raf, {"METRIC_SEPARATION"}),
    ("rtt-from-presentation-trace", _rtt_from_trace, {"METRIC_SEPARATION"}),
    ("throughput-metric-in-realtime-cell", _throughput_metric, {"METRIC_SEPARATION"}),
    ("different-instruments", _instrument, {"METRIC_INSTRUMENT_MISMATCH"}),
    ("unknown-fps-metric", lambda r: r["sides"]["port"]["trials"][0]["windows"][0]["metrics"].update(fps={"status": "measured"}), {"METRIC_UNKNOWN"}),
    ("recorder-overhead-ab", _overhead_shift, {"RECORDER_OVERHEAD"}),
    ("recorder-self-share", _self_share, {"RECORDER_OVERHEAD"}),
    ("recorder-mismatch", lambda r: r["sides"]["port"]["recorder"].update(sha256=_h("other recorder")), {"RECORDER_MISMATCH"}),
    ("recorder-overflow", lambda r: r["sides"]["legacy"]["recorder"].update(bufferOverflow=True), {"RECORDER_OVERFLOW"}),
    ("no-overhead-control", lambda r: r["sides"]["port"]["recorder"].pop("overheadControl"), {"OVERHEAD_CONTROL_MISSING"}),
    ("privacy-home-path", _privacy_path, {"PRIVACY"}),
    ("privacy-url-token", _privacy_token, {"PRIVACY"}),
    ("unlabelled-synthetic", lambda r: r.pop("label"), {"SYNTHETIC_LABEL"}),
    ("synthetic-posing-as-real", _unsynthetic, {"SYNTHETIC_LABEL", "MACHINE_NOT_REFERENCE"}),
    ("wrong-matrix", lambda r: r.update(matrixSha256=_h("another matrix")), {"MATRIX_HASH"}),
    ("slice-not-in-matrix", lambda r: r.update(cell="map-generation-slice"), {"CELL_UNKNOWN"}),
]

# Refusal controls on other cell classes: (name, cell, mutation, required codes).
CLASS_CONTROLS = [
    ("throughput-nondeterministic", "C05", lambda r: r["sides"]["legacy"]["trials"][3]["outcome"].update(outcomeDigest=_h("x", 16)), {"DETERMINISM"}),
    ("throughput-browser-metric", "C05", lambda r: r["sides"]["port"]["trials"][0]["windows"][0]["metrics"].update(
        {"frame.callback_interval_ms": _m("raf-timestamps", "ms", [16.7])}), {"METRIC_SEPARATION"}),
    ("latency-from-ping", "C10", lambda r: r["sides"]["port"]["trials"][0]["metrics"]["latency.input_to_self_visible_ms"].update(source="app-ping-pong"), {"METRIC_SEPARATION"}),
    ("latency-unpaired-instrument", "C10", lambda r: [t["metrics"]["latency.input_to_self_visible_ms"].update(source="input-to-post-present-trace")
                                                        for t in r["sides"]["port"]["trials"]], {"METRIC_INSTRUMENT_MISMATCH"}),
    ("latency-impairment-mismatch", "C10", lambda r: r["sides"]["legacy"]["impairment"].update(addedRttMs=50), {"IMPAIRMENT_MISMATCH"}),
    ("startup-warm-trial-in-cold-cell", "C13", lambda r: [t.update(cacheState="warm") for t in r["sides"]["port"]["trials"][:1]], {"STARTUP_CACHE_STATE"}),
    ("startup-throttle-mismatch", "C14", lambda r: r["sides"]["port"]["environment"]["network"].update(throttle=None), {"NETWORK_MISMATCH"}),
    ("diagnostic-missing-flags", "C04", lambda r: [r["sides"][s]["environment"]["browser"].update(
        flags=["--use-angle=metal"], frameRateLimitDisabled=False, vsyncDisabled=False) for s in admission.SIDES], {"DIAGNOSTIC_MIX"}),
    ("density-budget-missing", "C06", lambda r: [w["metrics"].pop("server.tick_budget_misses") for w in r["sides"]["legacy"]["trials"][0]["windows"]], {"METRIC_IMPLICIT_ABSENCE"}),
]


def mutate(base, fn):
    """Applies one in-place mutation to a deep copy of `base` and returns the copy."""
    r = copy.deepcopy(base)
    fn(r)
    return r
