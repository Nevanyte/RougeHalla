"""Paired-workload admission. `admit(report, matrix)` returns a verdict that lists every refusal with a stable code and
the JSON path that caused it. A report is ADMITTED only with zero refusals; there is no partial admission, no
threshold the report can choose for itself, and no repair of a bad sample.

The rules, in order of the checks below:
  * format, SYNTHETIC labelling, privacy (no credentials, personal paths, private URL parameters) and forbidden keys
    (frame-rate targets/caps, overhead subtraction, budget relaxation);
  * the cell exists in the matrix this report names (by hash) and is not instrument-blocked;
  * exact release builds with clean, hashed, unchanged artifacts, one source identity per stack, and the port's client
    and server agreeing on protocol/content;
  * the same machine, display, browser executable/flags, viewport and power state on both sides; the reference machine
    for real (non-synthetic) reports; no frame cap; uncapped flags only in the diagnostic cell;
  * the same workload (map pin, bot seed, seats, humans/bots, tier, factions, features, input script, rooms, 20 Hz,
    C-TICK schedule) and a content pairing that names both stacks' identities;
  * the matrix trial count, interleaved trial order, warm-up and cache state; contiguous windows of the declared
    length, with no index missing; the authoritative tick advancing at 20 Hz in every paced window;
  * load: every window above the workload floors (an idle scene or slice cannot pass) and both sides' median loads
    within the matrix tolerance;
  * initial and outcome checks per trial (active phase, seats, measured human alive, no crash/errors; identical
    per-stack outcome digests where the workload is deterministic);
  * metrics: every cell metric present in every window/trial as measured raw data or an explicit absence; required
    metrics measured on both sides with the same instrument; raw samples only (no summary fields); no zero standing in
    for a missing value; units and sources from the registry, families kept apart;
  * recorder: the same recorder on both sides, no overflow or dropped records, its self-time share under the matrix
    bound in every window, and an A/B overhead control (minimal vs full recorder, raw) within the matrix bound.
"""

import math
import os
import re

from . import FORMAT_REPORT, FORMAT_VERDICT, SYNTHETIC_LABEL
from . import canonical, registry, stats

SIDES = ("legacy", "port")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HOME_PATH = re.compile(r"(/Users/[^/\s]+|/home/[^/\s]+|[A-Za-z]:\\\\?Users\\\\?[^\\\s]+)")
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PRIVATE_QUERY = re.compile(r"[?&](token|auth|key|password|passcode|profile|session|sid|secret)=", re.I)
SUMMARY_FIELDS = {"p50", "p90", "p95", "p99", "mean", "median", "avg", "average", "min", "max", "stddev", "fps"}
MEASURED_KEYS = {"status", "source", "unit", "samples", "value", "histogram", "note"}
LOAD_KEYS = ("seatedPlayers", "aliveHumans", "mobsAlive", "projectiles", "actorsVisible", "commandsAccepted")
MACHINE_KEYS = ("model", "cpu", "logicalCpus", "memoryBytes", "os", "osBuild", "arch", "native")
POWER_KEYS = ("powerSource", "lowPowerMode", "thermalState")
DISPLAY_KEYS = ("refreshHz", "resolution", "scale", "variableRefresh")
BROWSER_KEYS = ("product", "version", "executableSha256", "headless", "flags", "visibility", "focused",
                "frameRateLimitDisabled", "vsyncDisabled")
VIEWPORT_KEYS = ("canvas", "dpr", "window")
WORKLOAD_KEYS = ("id", "mode", "mapPin", "botSeed", "seatedPlayers", "humans", "bots", "botTier", "factions", "features",
                 "inputScriptSha256", "rooms", "tickHz", "tickSchedule")
UNCAPPED_FLAGS = ("--disable-frame-rate-limit", "--disable-gpu-vsync")


class Verdict:
    def __init__(self, cell_id):
        self.cell = cell_id
        self.refusals = []
        self.warnings = []

    def refuse(self, code, path, detail):
        self.refusals.append({"code": code, "path": path, "detail": detail})

    def warn(self, code, path, detail):
        self.warnings.append({"code": code, "path": path, "detail": detail})

    def codes(self):
        return sorted({r["code"] for r in self.refusals})


def _get(d, *keys, default=None):
    for k in keys:
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


# ---------------------------------------------------------------- whole-report scans

def _scan(v, value, path):
    if isinstance(value, dict):
        for k, x in value.items():
            p = f"{path}.{k}"
            lk = k.lower().replace("-", "").replace("_", "")
            if k in registry.FORBIDDEN_KEYS:
                v.refuse("FORBIDDEN_KEY", p, registry.FORBIDDEN_KEYS[k])
            for pk in registry.PRIVATE_KEYS:
                if pk.replace("_", "") in lk and not lk.endswith("sha256"):
                    v.refuse("PRIVACY", p, f"key '{k}' may carry a credential or personal value")
                    break
            _scan(v, x, p)
    elif isinstance(value, list):
        for i, x in enumerate(value):
            _scan(v, x, f"{path}[{i}]")
    elif isinstance(value, str):
        if HOME_PATH.search(value):
            v.refuse("PRIVACY", path, "absolute home-directory path (personal data); record a hash or repo-relative path")
        if EMAIL.search(value):
            v.refuse("PRIVACY", path, "e-mail address")
        if PRIVATE_QUERY.search(value):
            v.refuse("PRIVACY", path, "URL query parameter that can carry a credential or player identity")


# ---------------------------------------------------------------- builds

def _check_builds(v, cell, rep, matrix):
    need = ["server"] + (["client"] if cell.get("browser") else [])
    pairing = rep.get("contentPairing") or {}
    for side in SIDES:
        builds = _get(rep, "sides", side, "builds") or {}
        spec = _get(matrix, "stacks", side, "components") or {}
        revs = set()
        for comp in need:
            b = builds.get(comp)
            p = f"$.sides.{side}.builds.{comp}"
            if not isinstance(b, dict):
                v.refuse("BUILD_PROVENANCE", p, "missing build record")
                continue
            want_kind = _get(spec, comp, "kind")
            if b.get("kind") != want_kind:
                v.refuse("BUILD_PROVENANCE", p + ".kind", f"expected {want_kind}, got {b.get('kind')}")
            if b.get("release") is not True or b.get("development") is not False:
                v.refuse("BUILD_NOT_RELEASE", p, "only release (non-development) builds are admissible")
            for flag in _get(spec, comp, "forbiddenTrue") or ():
                if b.get(flag) is not False:
                    v.refuse("BUILD_NOT_RELEASE", f"{p}.{flag}", f"{flag} must be recorded false")
            if b.get("dirty") is not False:
                v.refuse("BUILD_DIRTY", p + ".dirty", "the measured source tree must be clean (dirty: false)")
            if not isinstance(b.get("sourceRevision"), str) or not HEX40.match(b["sourceRevision"]):
                v.refuse("BUILD_PROVENANCE", p + ".sourceRevision", "a full 40-hex git revision is required")
            else:
                revs.add(b["sourceRevision"])
            a0, a1 = b.get("artifactSha256"), b.get("artifactSha256After")
            if not (isinstance(a0, str) and HEX64.match(a0)):
                v.refuse("BUILD_PROVENANCE", p + ".artifactSha256", "artifact manifest SHA-256 required")
            elif a0 != a1:
                v.refuse("BUILD_CHANGED", p + ".artifactSha256After", "artifact changed (or was not re-hashed) after the run")
        if len(revs) > 1:
            v.refuse("BUILD_PROVENANCE", f"$.sides.{side}.builds", "server and client come from different revisions")
        if side == "legacy" and revs and pairing.get("legacySourceRevision") not in revs:
            v.refuse("CONTENT_PAIRING", "$.contentPairing.legacySourceRevision", "does not name the measured legacy revision")
        if side == "port":
            srv, cli = builds.get("server") or {}, builds.get("client") or {}
            sid = srv.get("identity") or {}
            if sid.get("contentHash") != pairing.get("portContentHash"):
                v.refuse("CONTENT_PAIRING", "$.contentPairing.portContentHash", "does not match the port server identity")
            if cell.get("browser"):
                cid = cli.get("identity") or {}
                for k in ("protocol", "contentHash"):
                    if cid.get(k) is None or cid.get(k) != sid.get(k):
                        v.refuse("PORT_IDENTITY_SPLIT", f"$.sides.port.builds.client.identity.{k}",
                                 "Unity client and Rust server identities differ or are unrecorded")


# ---------------------------------------------------------------- environment

def _same(v, code, rep, keys, *path):
    a = _get(rep, "sides", "legacy", *path)
    b = _get(rep, "sides", "port", *path)
    jp = "$.sides.*." + ".".join(path)
    if not isinstance(a, dict) or not isinstance(b, dict):
        v.refuse(code, jp, "missing on one or both sides")
        return None
    for k in keys:
        if k not in a or k not in b:
            v.refuse(code, f"{jp}.{k}", "not recorded on both sides")
        elif canonical.dumps(a[k]) != canonical.dumps(b[k]):
            v.refuse(code, f"{jp}.{k}", f"legacy {a[k]!r} != port {b[k]!r}")
    return a


def _check_environment(v, cell, rep, matrix):
    machine = _same(v, "MACHINE_MISMATCH", rep, MACHINE_KEYS, "environment", "machine")
    _same(v, "MACHINE_MISMATCH", rep, POWER_KEYS, "environment", "power")
    if machine:
        ref = _get(matrix, "reference", "cpu")
        if rep.get("synthetic"):
            if not str(machine.get("cpu", "")).startswith("SYNTHETIC"):
                v.refuse("SYNTHETIC_LABEL", "$.sides.*.environment.machine.cpu", "a synthetic report must use a SYNTHETIC machine")
        elif machine.get("cpu") != ref or machine.get("native") is not True:
            v.refuse("MACHINE_NOT_REFERENCE", "$.sides.*.environment.machine",
                     f"final measurements run natively on the matrix reference ({ref})")
    power = _get(rep, "sides", "legacy", "environment", "power") or {}
    if power.get("powerSource") != "ac" or power.get("lowPowerMode") is not False:
        v.refuse("MACHINE_MISMATCH", "$.sides.*.environment.power", "AC power with low-power mode off is required")
    net = _same(v, "NETWORK_MISMATCH", rep, ("throttle",), "environment", "network")
    if net is not None and canonical.dumps(net.get("throttle")) != canonical.dumps(cell.get("networkThrottle")):
        v.refuse("NETWORK_MISMATCH", "$.sides.*.environment.network.throttle", "differs from the cell's throttle")
    if not cell.get("browser"):
        return
    display = _same(v, "DISPLAY_MISMATCH", rep, DISPLAY_KEYS, "environment", "display")
    if display is not None and not (_num(display.get("refreshHz")) and display["refreshHz"] > 0):
        v.refuse("DISPLAY_MISMATCH", "$.sides.*.environment.display.refreshHz", "the actual display refresh must be recorded")
    browser = _same(v, "BROWSER_MISMATCH", rep, BROWSER_KEYS, "environment", "browser")
    vp = _same(v, "VIEWPORT_MISMATCH", rep, VIEWPORT_KEYS, "environment", "viewport")
    if vp is not None:
        want = cell.get("viewport") or {}
        if vp.get("canvas") != want.get("canvas") or vp.get("dpr") != want.get("dpr"):
            v.refuse("VIEWPORT_MISMATCH", "$.sides.*.environment.viewport", f"cell requires {want}")
    if browser is not None:
        pol = _get(matrix, "fixed", "browser") or {}
        if browser.get("headless") is not False or browser.get("visibility") != "visible" or browser.get("focused") is not True:
            v.refuse("BROWSER_POLICY", "$.sides.*.environment.browser", "headed, visible and focused only")
        if not (isinstance(browser.get("executableSha256"), str) and HEX64.match(browser["executableSha256"])):
            v.refuse("BROWSER_POLICY", "$.sides.*.environment.browser.executableSha256", "browser executable hash required")
        flags = browser.get("flags") or []
        for f in pol.get("forbiddenFlags", []):
            if f in flags:
                v.refuse("BROWSER_POLICY", "$.sides.*.environment.browser.flags", f"flag {f} is not allowed")
        uncapped = (browser.get("frameRateLimitDisabled") is True or browser.get("vsyncDisabled") is True
                    or any(f in flags for f in UNCAPPED_FLAGS))
        if uncapped and not cell.get("diagnostic"):
            v.refuse("DIAGNOSTIC_MIX", "$.sides.*.environment.browser",
                     "uncapped/vsync-off flags are only admissible in the diagnostic cell")
        if cell.get("diagnostic") and not (browser.get("frameRateLimitDisabled") is True and browser.get("vsyncDisabled") is True
                                           and all(f in flags for f in UNCAPPED_FLAGS)):
            v.refuse("DIAGNOSTIC_MIX", "$.sides.*.environment.browser", "the diagnostic cell requires both uncapped flags")
    for side in SIDES:
        fc = _get(rep, "sides", side, "environment", "frameRateLimit")
        p = f"$.sides.{side}.environment.frameRateLimit"
        want = _get(matrix, "fixed", "frameRateLimit", side) or {}
        if not isinstance(fc, dict) or fc.get("capped") is not False:
            v.refuse("FRAME_CAP", p, "record capped: false (no frame-rate goal or cap is admissible)")
            continue
        for k, val in want.items():
            if fc.get(k) != val:
                v.refuse("FRAME_CAP", f"{p}.{k}", f"must be {val!r} (uncapped); got {fc.get(k)!r}")


# ---------------------------------------------------------------- workload and pairing

def _check_workload(v, cell, rep, matrix, repo_root):
    wl = _same(v, "WORKLOAD_MISMATCH", rep, WORKLOAD_KEYS, "workload")
    spec = _get(matrix, "workloads", cell.get("workload")) or {}
    if wl is not None:
        for k in WORKLOAD_KEYS:
            if k in spec and canonical.dumps(spec[k]) != canonical.dumps(wl.get(k)):
                v.refuse("WORKLOAD_NOT_CELL", f"$.sides.*.workload.{k}", f"cell workload requires {spec[k]!r}, got {wl.get(k)!r}")
        if wl.get("tickHz") != 20:
            v.refuse("TICK_RATE", "$.sides.*.workload.tickHz", "the authoritative rate is fixed at 20 Hz")
        if wl.get("tickSchedule") != _get(matrix, "fixed", "tickSchedule"):
            v.refuse("TICK_ORDER", "$.sides.*.workload.tickSchedule", "must name the C-TICK legacy order")
        script = spec.get("inputScript")
        if script:
            want = _script_sha(matrix, script)
            if want is None:
                v.refuse("SCRIPT_MISMATCH", "$.sides.*.workload.inputScriptSha256", f"input script {script} cannot be read")
            elif wl.get("inputScriptSha256") != want:
                v.refuse("SCRIPT_MISMATCH", "$.sides.*.workload.inputScriptSha256", f"must equal {script} ({want[:12]}...)")
    for side in SIDES:
        ci = _get(rep, "sides", side, "workload", "contentIdentity") or {}
        key = "legacySourceRevision" if side == "legacy" else "portContentHash"
        if not ci.get(key) or ci.get(key) != _get(rep, "contentPairing", key):
            v.refuse("CONTENT_PAIRING", f"$.sides.{side}.workload.contentIdentity.{key}", "missing or not the paired identity")
    ev = _get(rep, "contentPairing", "evidence") or {}
    if not ev.get("path") or not (isinstance(ev.get("sha256"), str) and HEX64.match(ev["sha256"])):
        v.refuse("CONTENT_PAIRING", "$.contentPairing.evidence", "a content-correspondence receipt (path + sha256) is required")
    elif os.path.isabs(ev["path"]) or ".." in ev["path"].replace("\\", "/").split("/"):
        v.refuse("CONTENT_PAIRING", "$.contentPairing.evidence.path", "must be a repository-relative path")
    elif repo_root is not None:
        full = os.path.join(repo_root, ev["path"])
        if not os.path.isfile(full):
            v.refuse("CONTENT_PAIRING", "$.contentPairing.evidence.path", "receipt not found in the repository")
        elif canonical.sha256_file(full) != ev["sha256"]:
            v.refuse("CONTENT_PAIRING", "$.contentPairing.evidence.sha256", "receipt hash does not match")
    else:
        v.warn("CONTENT_PAIRING_UNVERIFIED", "$.contentPairing.evidence", "no --repo given; receipt hash not verified")
    imp_cell = cell.get("impairment")
    for side in SIDES:
        imp = _get(rep, "sides", side, "impairment")
        if canonical.dumps(_strip(imp, "proxySha256")) != canonical.dumps(imp_cell):
            v.refuse("IMPAIRMENT_MISMATCH", f"$.sides.{side}.impairment", f"cell requires {imp_cell!r}")
    if imp_cell is not None:
        a = _get(rep, "sides", "legacy", "impairment", "proxySha256")
        b = _get(rep, "sides", "port", "impairment", "proxySha256")
        if not a or a != b:
            v.refuse("IMPAIRMENT_MISMATCH", "$.sides.*.impairment.proxySha256", "both sides must use the same proxy build")


def _strip(d, key):
    if not isinstance(d, dict):
        return d
    return {k: x for k, x in d.items() if k != key}


def _script_sha(matrix, script_id):
    rel = _get(matrix, "inputScripts", script_id)
    if not rel:
        return None
    p = os.path.join(canonical.TOOL_ROOT, rel)
    if not os.path.isfile(p):
        return None
    return canonical.sha256_json(canonical.load(p))


# ---------------------------------------------------------------- trials, windows and ticks

def _check_trials(v, cell, rep, matrix):
    adm = matrix.get("admission") or {}
    n = cell.get("trialsPerSide", adm.get("trialsPerSide"))
    order = rep.get("trialOrder")
    want_order = adm.get("trialOrder")
    if order != want_order:
        v.refuse("TRIAL_ORDER", "$.trialOrder", f"must be the matrix interleaving {want_order}")
    for side in SIDES:
        trials = _get(rep, "sides", side, "trials")
        p = f"$.sides.{side}.trials"
        if not isinstance(trials, list) or len(trials) != n:
            v.refuse("TRIAL_COUNT", p, f"exactly {n} trials required, got {len(trials) if isinstance(trials, list) else 'none'}")
            continue
        positions = [i for i, s in enumerate(want_order or []) if s == side]
        for i, t in enumerate(trials):
            tp = f"{p}[{i}]"
            if t.get("index") != i:
                v.refuse("TRIAL_COUNT", tp + ".index", "trials must be indexed 0..n-1 in order")
            if i < len(positions) and t.get("orderPosition") != positions[i]:
                v.refuse("TRIAL_ORDER", tp + ".orderPosition", f"expected run position {positions[i]}")
            if t.get("cacheState") != cell.get("cacheState"):
                v.refuse("STARTUP_CACHE_STATE", tp + ".cacheState", f"cell requires {cell.get('cacheState')}; warm and cold never mix")
            _check_warmup(v, cell, t, tp)
            _check_initial(v, cell, rep, side, t, tp)
            _check_outcome(v, cell, t, tp)
            _check_windows(v, cell, t, tp)
        _check_determinism(v, cell, rep, side, trials, p)


def _check_warmup(v, cell, t, tp):
    w = t.get("warmup") or {}
    if cell.get("warmupSeconds") is not None and not (_num(w.get("seconds")) and w["seconds"] >= cell["warmupSeconds"]):
        v.refuse("WARMUP", tp + ".warmup.seconds", f"at least {cell['warmupSeconds']} s of warm state required")
    if cell.get("warmupTicks") is not None and not (isinstance(w.get("ticks"), int) and w["ticks"] >= cell["warmupTicks"]):
        v.refuse("WARMUP", tp + ".warmup.ticks", f"at least {cell['warmupTicks']} warm-up ticks required")


def _check_initial(v, cell, rep, side, t, tp):
    ic = t.get("initialCheck") or {}
    wl = _get(rep, "sides", side, "workload") or {}
    if ic.get("ok") is not True:
        v.refuse("INITIAL_CHECK", tp + ".initialCheck.ok", "initial-state check missing or failed")
    want_phase = cell.get("initialPhase")
    if want_phase and ic.get("phase") != want_phase:
        v.refuse("INITIAL_CHECK", tp + ".initialCheck.phase", f"must start in {want_phase}")
    if want_phase == "navigation":
        # Startup: nothing is seated yet; the cache state is verified before navigation, the match at the outcome.
        if ic.get("cacheState") != cell.get("cacheState"):
            v.refuse("STARTUP_CACHE_STATE", tp + ".initialCheck.cacheState", "the cache state was not verified before navigation")
        keys, where, holder = ("seatedPlayers", "humans", "mapPin"), ".outcome", t.get("outcome") or {}
    else:
        keys, where, holder = ("seatedPlayers", "humans", "mapPin"), ".initialCheck", ic
    for k in keys:
        if k in wl and holder.get(k) != wl.get(k):
            v.refuse("INITIAL_CHECK", f"{tp}{where}.{k}", f"observed {holder.get(k)!r}, workload {wl.get(k)!r}")


def _check_outcome(v, cell, t, tp):
    oc = t.get("outcome") or {}
    if oc.get("crashed") is not False:
        v.refuse("OUTCOME_CHECK", tp + ".outcome.crashed", "crashed must be recorded false")
    if oc.get("errors") != []:
        v.refuse("OUTCOME_CHECK", tp + ".outcome.errors", "page/server/decoder errors (or an unrecorded list)")
    allowed = cell.get("endPhases")
    if allowed and oc.get("phaseAtEnd") not in allowed:
        v.refuse("OUTCOME_CHECK", tp + ".outcome.phaseAtEnd", f"must end in {allowed}")
    if cell.get("measuredHumanMustSurvive") and oc.get("measuredHumanAlive") is not True:
        v.refuse("OUTCOME_CHECK", tp + ".outcome.measuredHumanAlive", "the measured human died or was not checked: the scene changed")


def _check_determinism(v, cell, rep, side, trials, p):
    if not cell.get("deterministicPerStack"):
        return
    digests = {t.get("outcome", {}).get("outcomeDigest") for t in trials}
    if None in digests or len(digests) != 1:
        v.refuse("DETERMINISM", p, "every repetition of a deterministic workload must report the same outcome digest")


def _check_windows(v, cell, t, tp):
    windows = t.get("windows")
    want = cell.get("windowsPerTrial", 0)
    if not isinstance(windows, list):
        v.refuse("WINDOW_MISSING", tp + ".windows", "no window list")
        return
    if len(windows) != want:
        v.refuse("WINDOW_COUNT", tp + ".windows", f"{len(windows)} windows, the cell requires {want}")
    paced = cell["class"] in registry.PACED
    ws = cell.get("windowSeconds")
    wt = cell.get("windowTicks")
    tol = cell.get("windowDurationTolerance", 0.02)
    tick_tol = cell.get("tickCountTolerance", 1)
    prev = None
    for i, w in enumerate(windows):
        wp = f"{tp}.windows[{i}]"
        if w.get("index") != i:
            v.refuse("WINDOW_MISSING", wp + ".index", f"window index {w.get('index')} where {i} was expected (a window is missing)")
        ticks = w.get("ticks") or {}
        t0, t1 = ticks.get("first"), ticks.get("last")
        if not (isinstance(t0, int) and isinstance(t1, int) and t1 >= t0):
            v.refuse("TICK_COUNT", wp + ".ticks", "authoritative first/last tick required")
            t0 = t1 = None
        if ws is not None:
            s, e = w.get("startMs"), w.get("endMs")
            if not (_num(s) and _num(e)) or abs((e - s) - ws * 1000.0) > tol * ws * 1000.0:
                v.refuse("WINDOW_DURATION", wp, f"window must last {ws} s within {tol:.0%}")
            if prev is not None and _num(s) and _num(prev.get("endMs")) and abs(s - prev["endMs"]) > 1.0:
                v.refuse("WINDOW_MISSING", wp + ".startMs", "gap between consecutive windows (missing sample window)")
        if t0 is not None:
            adv = t1 - t0
            if paced and ws is not None and abs(adv - 20 * ws) > tick_tol:
                v.refuse("TICK_COUNT", wp + ".ticks", f"authoritative ticks advanced {adv}, 20 Hz requires {20 * ws}±{tick_tol}")
            if wt is not None and adv != wt:
                v.refuse("TICK_COUNT", wp + ".ticks", f"tick window must cover exactly {wt} ticks")
            if prev is not None and isinstance(_get(prev, "ticks", "last"), int) and t0 != prev["ticks"]["last"]:
                v.refuse("WINDOW_MISSING", wp + ".ticks.first", "tick windows are not contiguous")
            sc = _get(w, "metrics", "server.ticks")
            rooms = cell.get("_rooms", 1)
            if isinstance(sc, dict) and sc.get("status") == "measured" and sc.get("value") != adv * rooms:
                v.refuse("TICK_COUNT", wp + ".metrics.server.ticks",
                         f"server step counter {sc.get('value')} disagrees with {adv} window ticks x {rooms} room(s)")
            sc = _get(w, "metrics", "sim.steps")
            if isinstance(sc, dict) and sc.get("status") == "measured" and sc.get("value") != adv:
                v.refuse("TICK_COUNT", wp + ".metrics.sim.steps", "step counter disagrees with the window ticks")
        prev = w


# ---------------------------------------------------------------- load

def _check_load(v, cell, rep, matrix):
    floors = _get(matrix, "workloads", cell.get("workload"), "loadFloors") or {}
    tol = cell.get("loadTolerance", _get(matrix, "admission", "loadTolerance"))
    medians = {}
    for side in SIDES:
        if not _get(rep, "sides", side, "loadSource"):
            v.refuse("LOAD_MISSING", f"$.sides.{side}.loadSource", "name the (server-side, privileged) load source")
        optional_keys = () if cell.get("browser") else ("actorsVisible",)
        vals = {k: [] for k in LOAD_KEYS}
        for ti, t in enumerate(_get(rep, "sides", side, "trials") or []):
            for wi, w in enumerate(t.get("windows") or []):
                load = w.get("load")
                wp = f"$.sides.{side}.trials[{ti}].windows[{wi}].load"
                if not isinstance(load, dict):
                    v.refuse("LOAD_MISSING", wp, "per-window load record required")
                    continue
                for k in LOAD_KEYS:
                    x = load.get(k)
                    if x is None and k in optional_keys and k not in load:
                        continue
                    if not (_num(x) and x >= 0):
                        v.refuse("LOAD_MISSING", f"{wp}.{k}", "load count missing")
                        continue
                    vals[k].append(x)
                    if k in floors and x < floors[k]:
                        v.refuse("LOAD_FLOOR", f"{wp}.{k}", f"{x} below the workload floor {floors[k]} (idle or partial scene)")
        medians[side] = {k: stats.median(x) for k, x in vals.items() if x}
    if tol is None:
        return
    slack = _get(matrix, "admission", "loadAbsoluteSlack") or {}
    for k in LOAD_KEYS:
        a, b = medians.get("legacy", {}).get(k), medians.get("port", {}).get(k)
        if a is None or b is None:
            continue
        allowed = max(tol * max(a, b), slack.get(k, 0))
        if abs(a - b) > allowed:
            v.refuse("LOAD_MISMATCH", f"$.sides.*.load.{k}",
                     f"median legacy {a} vs port {b}: difference {abs(a - b)} exceeds {allowed:g} ({tol:.0%} or slack {slack.get(k, 0)})")


# ---------------------------------------------------------------- metrics

def _check_metric_value(v, mid, val, path, cell_class):
    spec = registry.METRICS.get(mid)
    if spec is None:
        v.refuse("METRIC_UNKNOWN", path, f"{mid} is not a registered metric")
        return None
    if cell_class not in spec["classes"]:
        v.refuse("METRIC_SEPARATION", path, f"{mid} ({spec['family']}) does not belong in a {cell_class} cell")
        return None
    if not isinstance(val, dict) or "status" not in val:
        v.refuse("METRIC_IMPLICIT_ABSENCE", path, "missing or null; absence must be explicit with a reason")
        return None
    if val["status"] == "absent":
        if val.get("reason") not in registry.ABSENT_REASONS or not val.get("detail"):
            v.refuse("METRIC_IMPLICIT_ABSENCE", path, f"absent requires a reason in {registry.ABSENT_REASONS} and a detail")
        extra = set(val) - {"status", "reason", "detail"}
        if extra:
            v.refuse("METRIC_ZERO_AS_ABSENT", path, f"an absent metric carries values {sorted(extra)}")
        return "absent"
    if val["status"] != "measured":
        v.refuse("METRIC_IMPLICIT_ABSENCE", path, f"unknown status {val['status']!r}")
        return None
    extra = set(val) - MEASURED_KEYS
    if extra & SUMMARY_FIELDS:
        v.refuse("SUMMARY_WITHOUT_RAW", path, f"summary fields {sorted(extra & SUMMARY_FIELDS)} in place of raw data")
    elif extra:
        v.refuse("METRIC_UNKNOWN", path, f"unexpected fields {sorted(extra)}")
    if val.get("unit") != spec["unit"]:
        v.refuse("METRIC_UNIT", path + ".unit", f"{mid} is recorded in {spec['unit']}")
    src = val.get("source")
    if src in spec["forbiddenSources"]:
        v.refuse("METRIC_SEPARATION", path + ".source", f"{src} cannot measure {mid} ({spec['family']})")
    elif spec["sources"] and src not in spec["sources"]:
        v.refuse("METRIC_SOURCE", path + ".source", f"{mid} must come from one of {list(spec['sources'])}")
    kind = spec["kind"]
    data = None
    if kind == "samples":
        if "histogram" in val:
            h = val["histogram"]
            if not (isinstance(h, dict) and isinstance(h.get("bounds"), list) and isinstance(h.get("counts"), list)
                    and len(h["bounds"]) == len(h["counts"]) and h["counts"] and sum(h["counts"]) > 0):
                v.refuse("METRIC_EMPTY", path + ".histogram", "histogram needs equal-length bounds/counts and observations")
            return "measured"
        data = val.get("samples")
        if not isinstance(data, list) or not data:
            v.refuse("METRIC_EMPTY", path + ".samples", "measured requires a non-empty raw sample list")
            return None
    else:
        if "samples" in val:
            v.refuse("METRIC_UNIT", path, f"{mid} is a per-window counter (value), not samples")
        data = [val.get("value")]
    for i, x in enumerate(data):
        if not _num(x):
            v.refuse("METRIC_EMPTY", f"{path}[{i}]", "non-numeric or missing sample")
            break
        if x < 0:
            v.refuse("METRIC_UNIT", f"{path}[{i}]", "negative value")
            break
        if x == 0 and not spec["zeroOk"]:
            v.refuse("METRIC_ZERO_AS_ABSENT", f"{path}[{i}]",
                     f"0 is not a possible {mid}; record an explicit absence instead")
            break
    return "measured"


def _check_metrics(v, cell, rep):
    cls = cell["class"]
    required = list(cell.get("required", []))
    optional = list(cell.get("optional", []))
    listed = set(required) | set(optional)
    for mid in sorted(listed):
        if not registry.required_metric_ok(mid, cls):
            v.refuse("METRIC_SEPARATION", f"matrix.cells[{cell['id']}]", f"{mid} cannot be listed in a {cls} cell")
    sources = {s: {} for s in SIDES}
    measured_any = {s: set() for s in SIDES}
    for side in SIDES:
        for ti, t in enumerate(_get(rep, "sides", side, "trials") or []):
            holders = [(f"$.sides.{side}.trials[{ti}].metrics", t.get("metrics") or {}, "trial")]
            for wi, w in enumerate(t.get("windows") or []):
                holders.append((f"$.sides.{side}.trials[{ti}].windows[{wi}].metrics", w.get("metrics") or {}, "window"))
            for hp, metrics, scope in holders:
                for mid in metrics:
                    if mid not in listed:
                        spec = registry.METRICS.get(mid)
                        code = "METRIC_UNKNOWN" if spec is None else "METRIC_SEPARATION"
                        v.refuse(code, f"{hp}.{mid}", f"{mid} is not a metric of cell {cell['id']} ({cls})")
                for mid in sorted(listed):
                    spec = registry.METRICS.get(mid)
                    if spec is None or spec["scope"] != scope:
                        continue
                    val = metrics.get(mid)
                    st = _check_metric_value(v, mid, val, f"{hp}.{mid}", cls)
                    if st == "absent" and mid in required:
                        v.refuse("METRIC_REQUIRED_ABSENT", f"{hp}.{mid}", f"{mid} is required in cell {cell['id']}")
                    if st == "measured":
                        measured_any[side].add(mid)
                        src = val.get("source")
                        prev = sources[side].setdefault(mid, src)
                        if prev != src:
                            v.refuse("METRIC_INSTRUMENT_MISMATCH", f"{hp}.{mid}.source", "instrument changed within one side")
                    if scope == "window" and mid in ("server.tick_ms",) and st == "measured" and cls in registry.PACED:
                        n = len(val.get("samples") or [])
                        rooms = cell.get("_rooms", 1)
                        if cell.get("windowSeconds") and n and abs(n - 20 * cell["windowSeconds"] * rooms) > cell.get("tickCountTolerance", 1) * rooms:
                            v.refuse("TICK_COUNT", f"{hp}.{mid}",
                                     f"{n} step times for a {cell['windowSeconds']} s window at 20 Hz in {rooms} room(s)")
    for mid in sorted(listed):
        spec = registry.METRICS.get(mid) or {}
        a, b = sources["legacy"].get(mid), sources["port"].get(mid)
        if a is not None and b is not None and a != b and spec.get("crossStackComparable"):
            code = "METRIC_INSTRUMENT_MISMATCH"
            if mid in required:
                v.refuse(code, f"$.sides.*.{mid}", f"legacy uses {a}, port uses {b}: not the same instrument")
            else:
                v.warn(code, f"$.sides.*.{mid}", f"optional metric measured with different instruments ({a} vs {b}); not compared")
    min_events = cell.get("minEventsPerTrial")
    if min_events:
        for side in SIDES:
            for ti, t in enumerate(_get(rep, "sides", side, "trials") or []):
                for mid in required:
                    if (registry.METRICS.get(mid) or {}).get("scope") != "trial":
                        continue
                    s = _get(t, "metrics", mid, "samples")
                    if isinstance(s, list) and len(s) < min_events:
                        v.refuse("METRIC_EMPTY", f"$.sides.{side}.trials[{ti}].metrics.{mid}",
                                 f"{len(s)} events, the cell requires at least {min_events} per trial")


# ---------------------------------------------------------------- recorder overhead

def _check_recorder(v, cell, rep, matrix):
    adm = matrix.get("admission") or {}
    share = adm.get("maxRecorderShare")
    delta = adm.get("maxRecorderOverheadDelta")
    min_n = cell.get("overheadMinSamples", adm.get("minOverheadControlSamples", 1))
    metric = cell.get("overheadMetric")
    a = _get(rep, "sides", "legacy", "recorder") or {}
    b = _get(rep, "sides", "port", "recorder") or {}
    if not a.get("id") or not (isinstance(a.get("sha256"), str) and HEX64.match(a["sha256"])):
        v.refuse("RECORDER_MISMATCH", "$.sides.legacy.recorder", "recorder id and source sha256 required")
    if cell.get("sameRecorder", True) and (a.get("id"), a.get("sha256")) != (b.get("id"), b.get("sha256")):
        v.refuse("RECORDER_MISMATCH", "$.sides.*.recorder", "both stacks must be measured by the same recorder build")
    for side, r in (("legacy", a), ("port", b)):
        p = f"$.sides.{side}.recorder"
        if r.get("bufferOverflow") is not False or r.get("droppedRecords") != 0:
            v.refuse("RECORDER_OVERFLOW", p, "recorder overflow/dropped records (or not recorded)")
        ctl = r.get("overheadControl")
        if not isinstance(ctl, dict) or ctl.get("metric") != metric:
            v.refuse("OVERHEAD_CONTROL_MISSING", p + ".overheadControl", f"an A/B control on {metric} is required")
        else:
            lo, hi = ctl.get("minimal"), ctl.get("full")
            if not (isinstance(lo, list) and isinstance(hi, list) and len(lo) >= min_n and len(hi) >= min_n
                    and all(_num(x) and x > 0 for x in lo + hi)):
                v.refuse("OVERHEAD_CONTROL_MISSING", p + ".overheadControl",
                         f"raw minimal/full samples (at least {min_n} positive each) required")
            elif delta is not None:
                for q in (50, 95):
                    m0 = stats.nearest_rank(sorted(lo), q)
                    m1 = stats.nearest_rank(sorted(hi), q)
                    d = abs(m1 - m0) / m0
                    if d > delta:
                        v.refuse("RECORDER_OVERHEAD", p + ".overheadControl",
                                 f"p{q} {metric} moved {d:.2%} with the full recorder (bound {delta:.0%}); no subtraction is allowed")
        if share is None:
            continue
        for ti, t in enumerate(_get(rep, "sides", side, "trials") or []):
            for wi, w in enumerate(t.get("windows") or []):
                sm = _get(w, "metrics", "recorder.self_ms")
                if not (isinstance(sm, dict) and sm.get("status") == "measured"):
                    continue
                dur = None
                if _num(w.get("startMs")) and _num(w.get("endMs")):
                    dur = w["endMs"] - w["startMs"]
                elif cell.get("windowTicks"):
                    # Unpaced: the recorder competes with the measured step time itself.
                    st = _get(w, "metrics", "sim.step_wall_us", "samples")
                    dur = sum(st) / 1000.0 if isinstance(st, list) and all(_num(x) for x in st) else None
                if dur and _num(sm.get("value")) and sm["value"] / dur > share:
                    v.refuse("RECORDER_OVERHEAD", f"$.sides.{side}.trials[{ti}].windows[{wi}].metrics.recorder.self_ms",
                             f"recorder used {sm['value'] / dur:.2%} of the window (bound {share:.0%})")


# ---------------------------------------------------------------- entry point

def find_cell(matrix, cell_id):
    for c in matrix.get("cells", []):
        if c.get("id") == cell_id:
            return c
    return None


def admit(report, matrix, repo_root=None):
    cell_id = report.get("cell") if isinstance(report, dict) else None
    v = Verdict(cell_id)
    if not isinstance(report, dict) or report.get("format") != FORMAT_REPORT:
        v.refuse("FORMAT", "$.format", f"expected {FORMAT_REPORT}")
        return finish(v, report, matrix)
    synthetic = report.get("synthetic")
    if synthetic is True and report.get("label") != SYNTHETIC_LABEL:
        v.refuse("SYNTHETIC_LABEL", "$.label", "a synthetic report must carry the SYNTHETIC label verbatim")
    if synthetic is not True and (synthetic is not False or "SYNTHETIC" in canonical.dumps(report)):
        v.refuse("SYNTHETIC_LABEL", "$.synthetic", "synthetic must be true or false, and real reports never say SYNTHETIC")
    _scan(v, report, "$")
    if report.get("matrixSha256") != canonical.sha256_json(matrix):
        v.refuse("MATRIX_HASH", "$.matrixSha256", "the report was not planned against this exact matrix")
    cell = find_cell(matrix, cell_id)
    if cell is None:
        v.refuse("CELL_UNKNOWN", "$.cell", f"{cell_id!r} is not a matrix cell (slices and ad-hoc scenes are not admissible)")
        return finish(v, report, matrix)
    # Window ticks are the reference room's; per-process counters and step-time samples cover every room.
    cell = dict(cell, _rooms=_get(matrix, "workloads", cell.get("workload"), "rooms") or 1)
    if cell.get("instrumentStatus", "ready") != "ready":
        v.refuse("CELL_BLOCKED", "$.cell", f"cell {cell_id} is blocked: {cell['instrumentStatus']}")
    for side in SIDES:
        if _get(report, "sides", side, "stack") != _get(matrix, "stacks", side, "stack"):
            v.refuse("FORMAT", f"$.sides.{side}.stack", f"must be {_get(matrix, 'stacks', side, 'stack')}")
    _check_builds(v, cell, report, matrix)
    _check_environment(v, cell, report, matrix)
    _check_workload(v, cell, report, matrix, repo_root)
    _check_trials(v, cell, report, matrix)
    if cell.get("windowsPerTrial", 0) > 0:
        _check_load(v, cell, report, matrix)
    _check_metrics(v, cell, report)
    _check_recorder(v, cell, report, matrix)
    return finish(v, report, matrix)


def finish(v, report, matrix):
    synthetic = isinstance(report, dict) and report.get("synthetic") is True
    status = "REFUSED" if v.refusals else ("ADMITTED-SYNTHETIC-CONTROL" if synthetic else "ADMITTED")
    return {
        "format": FORMAT_VERDICT,
        "status": status,
        "finalEvidence": status == "ADMITTED",
        "cell": v.cell,
        "synthetic": synthetic,
        "refusalCodes": v.codes(),
        "refusals": v.refusals,
        "warnings": v.warnings,
        "reportSha256": canonical.sha256_json(report) if isinstance(report, dict) else None,
        "matrixSha256": canonical.sha256_json(matrix),
    }
