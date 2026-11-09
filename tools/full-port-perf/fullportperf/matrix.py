"""The final experiment matrix: structural validation, the bound check, the duration estimate and a deterministic
Markdown rendering for evidence. The matrix is data (final-matrix.json); this module never edits it."""

import os

from . import FORMAT_MATRIX
from . import canonical, registry, script

DEFAULT_PATH = os.path.join(canonical.TOOL_ROOT, "final-matrix.json")


def load(path=DEFAULT_PATH):
    return canonical.load(path)


def trial_seconds(cell):
    if cell.get("estimateTrialSeconds") is not None:
        return cell["estimateTrialSeconds"] + cell.get("estimateSetupSeconds", 0)
    warm = cell.get("warmupSeconds") or 0
    win = (cell.get("windowSeconds") or 0) * cell.get("windowsPerTrial", 0)
    return cell.get("estimateSetupSeconds", 0) + warm + win


def estimate(matrix):
    """Wall-time estimate: (trialsPerSide + 1 overhead-control trial) x 2 stacks x trial length, per cell."""
    n = matrix["admission"]["trialsPerSide"]
    rows = []
    for c in matrix["cells"]:
        per = trial_seconds(c)
        total = per * (c.get("trialsPerSide", n) + 1) * 2
        rows.append({"cell": c["id"], "trialSeconds": per, "cellSeconds": total})
    return rows, sum(r["cellSeconds"] for r in rows) / 3600.0


def validate(matrix):
    """Problems with the matrix itself (empty list when it is well formed and bounded)."""
    errs = []
    if matrix.get("format") != FORMAT_MATRIX:
        errs.append(f"format must be {FORMAT_MATRIX}")
    adm = matrix.get("admission") or {}
    n = adm.get("trialsPerSide")
    order = adm.get("trialOrder") or []
    if not isinstance(n, int) or n < 2:
        errs.append("admission.trialsPerSide must be an integer >= 2")
    if order.count("legacy") != n or order.count("port") != n or len(order) != 2 * n:
        errs.append("admission.trialOrder must hold each stack exactly trialsPerSide times")
    if any(order[i:i + 3] in (["legacy"] * 3, ["port"] * 3) for i in range(len(order))):
        errs.append("admission.trialOrder must interleave the stacks (no three runs of one stack in a row)")
    for k in ("loadTolerance", "maxRecorderShare", "maxRecorderOverheadDelta"):
        x = adm.get(k)
        if not isinstance(x, (int, float)) or not 0 < x < 1:
            errs.append(f"admission.{k} must be a fraction in (0, 1)")
    for side in ("legacy", "port"):
        if not (matrix.get("stacks", {}).get(side, {}).get("stack")):
            errs.append(f"stacks.{side}.stack missing")
    if matrix.get("fixed", {}).get("tickHz") != 20:
        errs.append("fixed.tickHz must be 20")
    for k in registry.FORBIDDEN_KEYS:
        if k in canonical.dumps(matrix):
            errs.append(f"matrix mentions forbidden key {k}")
    for sid, rel in (matrix.get("inputScripts") or {}).items():
        p = os.path.join(canonical.TOOL_ROOT, rel)
        if not os.path.isfile(p):
            errs.append(f"input script {sid} missing at {rel}")
            continue
        s = canonical.load(p)
        errs += [f"input script {sid}: {e}" for e in script.validate(s)]
        if s.get("id") != sid:
            errs.append(f"input script {sid}: id field is {s.get('id')!r}")
    ids = set()
    workloads = matrix.get("workloads") or {}
    for wid, w in workloads.items():
        if w.get("id") != wid:
            errs.append(f"workload {wid}: id field mismatch")
        if w.get("tickHz") != 20 or w.get("tickSchedule") != matrix.get("fixed", {}).get("tickSchedule"):
            errs.append(f"workload {wid}: must be 20 Hz with the fixed C-TICK schedule")
        if w.get("inputScript") and w["inputScript"] not in (matrix.get("inputScripts") or {}):
            errs.append(f"workload {wid}: unknown input script {w['inputScript']}")
    for c in matrix.get("cells") or []:
        cid = c.get("id")
        if cid in ids:
            errs.append(f"cell {cid}: duplicate id")
        ids.add(cid)
        if c.get("class") not in registry.CELL_CLASSES:
            errs.append(f"cell {cid}: unknown class {c.get('class')}")
            continue
        if c.get("workload") not in workloads:
            errs.append(f"cell {cid}: unknown workload {c.get('workload')}")
        both = set(c.get("required", [])) & set(c.get("optional", []))
        if both:
            errs.append(f"cell {cid}: metrics both required and optional {sorted(both)}")
        for mid in c.get("required", []) + c.get("optional", []):
            if not registry.required_metric_ok(mid, c["class"]):
                errs.append(f"cell {cid}: {mid} is not a {c['class']} metric")
        if c.get("overheadMetric") not in registry.METRICS:
            errs.append(f"cell {cid}: overheadMetric must be a registered metric")
        paced = c["class"] in registry.PACED
        if paced and not c.get("windowSeconds"):
            errs.append(f"cell {cid}: paced cells need wall windows")
        if c["class"] == registry.THROUGHPUT and not c.get("windowTicks"):
            errs.append(f"cell {cid}: throughput cells use tick windows")
        if c["class"] == registry.STARTUP and c.get("windowsPerTrial"):
            errs.append(f"cell {cid}: startup cells have no windows")
        if c["class"] != registry.STARTUP and not c.get("windowsPerTrial"):
            errs.append(f"cell {cid}: needs windowsPerTrial > 0")
        if c.get("diagnostic") != (c["class"] == registry.DIAGNOSTIC):
            errs.append(f"cell {cid}: diagnostic flag must match the diagnostic class")
        if c["class"] == registry.STARTUP and c.get("cacheState") not in ("cold", "warm"):
            errs.append(f"cell {cid}: startup cells declare cold or warm")
        if c.get("browser") and not c.get("viewport"):
            errs.append(f"cell {cid}: browser cells fix the viewport")
    b = matrix.get("bounds") or {}
    cells = matrix.get("cells") or []
    if not cells:
        errs.append("no cells")
    if len(cells) > b.get("maxCells", 0):
        errs.append(f"{len(cells)} cells exceed bounds.maxCells {b.get('maxCells')}")
    if isinstance(n, int) and n > b.get("maxTrialsPerSide", 0):
        errs.append("trialsPerSide exceeds bounds.maxTrialsPerSide")
    if not errs:
        _, hours = estimate(matrix)
        if hours > b.get("maxTotalHours", 0):
            errs.append(f"estimated {hours:.2f} h exceeds bounds.maxTotalHours {b.get('maxTotalHours')}")
    return errs


def render_markdown(matrix):
    """Deterministic Markdown view of the matrix (same matrix bytes -> same text)."""
    rows, hours = estimate(matrix)
    est = {r["cell"]: r for r in rows}
    adm = matrix["admission"]
    out = [
        "# Final matched full-port performance matrix",
        "",
        "Generated by `python3 tools/full-port-perf/fpp.py matrix --markdown` from "
        "`tools/full-port-perf/final-matrix.json`; do not edit by hand.",
        "",
        f"- Matrix SHA-256 (canonical JSON): `{canonical.sha256_json(matrix)}`",
        f"- Status: {matrix['status']}",
        f"- Reference: {matrix['reference']['machine']}",
        f"- Stacks: legacy `{matrix['stacks']['legacy']['stack']}` versus port `{matrix['stacks']['port']['stack']}`",
        f"- Authoritative rate: {matrix['fixed']['tickHz']} Hz; {matrix['fixed']['tickSchedule']}",
        f"- Frame rate: {matrix['fixed']['noFrameRateGoal']}",
        f"- Trials: {adm['trialsPerSide']} per stack, run order `{' '.join('L' if s == 'legacy' else 'P' for s in adm['trialOrder'])}` "
        f"(L legacy, P port), plus one minimal-recorder overhead-control trial per stack and cell",
        f"- Load tolerance {adm['loadTolerance']:.0%} (median per load count); recorder share <= {adm['maxRecorderShare']:.0%} "
        f"per window; recorder A/B p50/p95 shift <= {adm['maxRecorderOverheadDelta']:.0%}",
        f"- Bound: {len(matrix['cells'])} cells (max {matrix['bounds']['maxCells']}), estimated {hours:.2f} h of wall time "
        f"(max {matrix['bounds']['maxTotalHours']} h)",
        "",
        "## Workloads",
        "",
        "| Workload | Mode | Map pin | Seats (humans + bots) | Rooms | Input script | Load floors per window |",
        "|---|---|---|---|---|---|---|",
    ]
    for wid in sorted(matrix["workloads"]):
        w = matrix["workloads"][wid]
        floors = ", ".join(f"{k} >= {v}" for k, v in sorted(w.get("loadFloors", {}).items())) or "none (startup)"
        out.append(f"| {wid} | {w['mode']} | `{w['mapPin']}` | {w['seatedPlayers']} ({w['humans']} + {w['bots']}) | "
                   f"{w['rooms']} | {w.get('inputScript', '-')} | {floors} |")
    out += ["", "Every workload: bot seed `7001`, bot tier `normal`, human faction 4, features "
            f"{', '.join(matrix['workloads']['WL-ARENA8']['features'])}.", "",
            "## Cells", "",
            "| Cell | Class | Workload | Viewport | Cache / network | Warm-up | Windows | Est. trial | Est. cell |",
            "|---|---|---|---|---|---|---|---|---|"]
    for c in matrix["cells"]:
        vp = "-" if not c.get("viewport") else f"{c['viewport']['canvas'][0]}x{c['viewport']['canvas'][1]} DPR{c['viewport']['dpr']}"
        net = c["cacheState"]
        if c.get("networkThrottle"):
            net += f", {c['networkThrottle']['downKbps'] / 1000:g} Mbit/s"
        if c.get("impairment"):
            net += f", +{c['impairment']['addedRttMs']} ms RTT"
        warm = f"{c['warmupSeconds']} s" if c.get("warmupSeconds") else (f"{c['warmupTicks']} ticks" if c.get("warmupTicks") else "-")
        if c.get("windowTicks"):
            win = f"{c['windowsPerTrial']} x {c['windowTicks']} ticks"
        elif c.get("windowsPerTrial"):
            win = f"{c['windowsPerTrial']} x {c['windowSeconds']} s"
        else:
            win = "per trial"
        e = est[c["id"]]
        out.append(f"| {c['id']} | {c['class']} | {c['workload']} | {vp} | {net} | {warm} | {win} | "
                   f"{e['trialSeconds']} s | {e['cellSeconds'] / 60:.0f} min |")
    out += ["", "## Per-cell metrics and prerequisites", ""]
    for c in matrix["cells"]:
        out += [f"### {c['id']} ({c['class']})", "", c.get("purpose", ""), "",
                "- Required on both stacks with the same instrument: " + ", ".join(f"`{m}`" for m in c["required"]),
                "- Optional (explicitly absent when unsupported): " + (", ".join(f"`{m}`" for m in c["optional"]) or "none"),
                f"- Overhead control metric: `{c['overheadMetric']}`",
                f"- Start phase `{c['initialPhase']}`; end phases {', '.join(c['endPhases'])}"
                + ("; the measured human must stay alive" if c.get("measuredHumanMustSurvive") else "")
                + ("; outcome digest identical across each stack's repetitions" if c.get("deterministicPerStack") else ""),
                "- Prerequisites before the first run:"]
        out += [f"  - {p}" for p in c.get("prerequisites", [])]
        out.append("")
    return "\n".join(out).rstrip() + "\n"
