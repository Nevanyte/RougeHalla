#!/usr/bin/env python3
"""Matched full-port performance preparation (legacy TS/Colyseus/Phaser vs Rust native + Unity Web on the M5 Pro).

Preparation only: this tool measures nothing and launches nothing. It validates paired reports written by the existing
collectors (see fullportperf/adapters.py), computes deterministic summaries from their raw data, and holds the bounded
final experiment matrix. Python 3 standard library only.

    python3 tools/full-port-perf/fpp.py matrix [--markdown OUT]           validate the matrix; print or render it
    python3 tools/full-port-perf/fpp.py validate REPORT [--repo DIR] [--out VERDICT]
    python3 tools/full-port-perf/fpp.py summarize REPORT [--repo DIR] [--out SUMMARY]
    python3 tools/full-port-perf/fpp.py script ID [--duration-ms N]       input-script hash and expanded timeline size
    python3 tools/full-port-perf/fpp.py synthetic CELL --out REPORT       a SYNTHETIC admissible pair for one cell
    python3 tools/full-port-perf/fpp.py controls [--repo DIR] [--receipt OUT]   SYNTHETIC admission/refusal controls
    python3 tools/full-port-perf/fpp.py assess-existing --repo DIR [--out OUT]  existing receipts through the adapters
    python3 tools/full-port-perf/fpp.py adapt {latency,health} FILE [--window-seconds S]

Exit status: 0 admitted / success, 1 refused or a failed control, 2 usage or input error.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fullportperf import adapters, admission, canonical, matrix as matrix_mod, script, summary, synthetic  # noqa: E402


def _write(path, value):
    text = canonical.pretty(value)
    if path:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        sys.stdout.write(text)


def cmd_matrix(a):
    m = matrix_mod.load(a.matrix)
    errs = matrix_mod.validate(m)
    if errs:
        for e in errs:
            print(f"matrix: {e}", file=sys.stderr)
        return 1
    if a.markdown:
        with open(a.markdown, "w", encoding="utf-8") as f:
            f.write(matrix_mod.render_markdown(m))
    rows, hours = matrix_mod.estimate(m)
    print(f"matrix ok: {len(m['cells'])} cells, {hours:.2f} h estimated (bound {m['bounds']['maxTotalHours']} h), "
          f"sha256 {canonical.sha256_json(m)}")
    return 0


def cmd_validate(a):
    m = matrix_mod.load(a.matrix)
    v = admission.admit(canonical.load(a.report), m, a.repo)
    _write(a.out, v)
    if a.out:
        print(f"{v['status']}: {len(v['refusals'])} refusal(s) {v['refusalCodes']}")
    return 1 if v["status"] == "REFUSED" else 0


def cmd_summarize(a):
    m = matrix_mod.load(a.matrix)
    try:
        s = summary.summarize(canonical.load(a.report), m, a.repo)
    except summary.RefusedError as e:
        _write(None, e.verdict)
        return 1
    _write(a.out, s)
    return 0


def cmd_script(a):
    m = matrix_mod.load(a.matrix)
    rel = (m.get("inputScripts") or {}).get(a.id)
    if not rel:
        print(f"unknown script {a.id}", file=sys.stderr)
        return 2
    s = canonical.load(os.path.join(canonical.TOOL_ROOT, rel))
    tl = script.timeline(s, a.duration_ms)
    print(f"{a.id}: sha256 {script.sha256(s)}, cycle {s['cycleMs']} ms, {len(tl)} events in {a.duration_ms} ms "
          f"({a.duration_ms // s['cycleMs']} whole cycles)")
    return 0


def cmd_synthetic(a):
    _write(a.out, synthetic.base_report(a.cell, matrix_mod.load(a.matrix)))
    return 0


def run_controls(m, repo):
    """Every cell's SYNTHETIC base must be admitted as a control; every named mutation must be refused with its codes."""
    rec = {"label": synthetic.SYNTHETIC_LABEL, "matrixSha256": canonical.sha256_json(m),
           "toolSha256": canonical.tool_sha256(), "repoVerified": repo is not None, "bases": [], "refusals": []}
    failures = []
    bases = {}
    for c in m["cells"]:
        r = synthetic.base_report(c["id"], m)
        bases[c["id"]] = r
        v = admission.admit(r, m, repo)
        ok = v["status"] == "ADMITTED-SYNTHETIC-CONTROL" and not v["finalEvidence"]
        if repo is not None:
            ok = ok and not v["warnings"]
        rec["bases"].append({"cell": c["id"], "status": v["status"], "finalEvidence": v["finalEvidence"],
                             "reportSha256": v["reportSha256"], "warnings": [w["code"] for w in v["warnings"]], "pass": ok})
        if not ok:
            failures.append(f"base {c['id']}: {v['status']} {v['refusalCodes']}")
    controls = [(n, "C01", f, need) for n, f, need in synthetic.CONTROLS] + list(synthetic.CLASS_CONTROLS)
    for name, cell, fn, need in controls:
        r = synthetic.mutate(bases[cell], fn)
        v = admission.admit(r, m, repo)
        ok = v["status"] == "REFUSED" and set(need) <= set(v["refusalCodes"])
        rec["refusals"].append({"control": name, "cell": cell, "mustInclude": sorted(need), "refusalCodes": v["refusalCodes"],
                                "refusalCount": len(v["refusals"]), "reportSha256": v["reportSha256"], "pass": ok})
        if not ok:
            failures.append(f"control {name}: {v['status']} {v['refusalCodes']} (needed {sorted(need)})")
    rec["counts"] = {"bases": len(rec["bases"]), "basesPassed": sum(b["pass"] for b in rec["bases"]),
                     "refusalControls": len(rec["refusals"]), "refusalControlsPassed": sum(r["pass"] for r in rec["refusals"])}
    return rec, failures


def cmd_controls(a):
    m = matrix_mod.load(a.matrix)
    rec, failures = run_controls(m, a.repo)
    _write(a.receipt, rec)
    c = rec["counts"]
    print(f"SYNTHETIC controls: {c['basesPassed']}/{c['bases']} admissible bases admitted as controls, "
          f"{c['refusalControlsPassed']}/{c['refusalControls']} refusal controls refused as required")
    for f in failures:
        print(f"FAIL {f}", file=sys.stderr)
    return 1 if failures else 0


EXISTING = {
    "first-playable-browser-normal": ("docs/evidence/first-playable-performance/browser-normal.json", "first_playable_receipt"),
    "first-playable-browser-uncapped": ("docs/evidence/first-playable-performance/browser-uncapped-diagnostic.json", "first_playable_receipt"),
    "domain-browser-normal": ("docs/evidence/first-playable-domain-performance/browser-normal.json", "first_playable_receipt"),
    "stage2-map-bench": ("docs/evidence/stage2-styled-map/performance.json", "map_bench_result"),
    "input-latency-linux-rtt-sweep": ("docs/evidence/input-latency/linux-rtt-sweep-final.json", "latency_report"),
}


def cmd_assess(a):
    out = {"note": "Assessment of existing receipts through the adapters. No new measurement; inputs are read, never edited, "
                   "and no private string is copied.", "receipts": {}}
    for name, (rel, fn) in sorted(EXISTING.items()):
        p = os.path.join(a.repo, rel)
        entry = {"path": rel}
        if not os.path.isfile(p):
            entry["error"] = "missing"
        else:
            entry["sha256"] = canonical.sha256_file(p)
            try:
                res = getattr(adapters, fn)(canonical.load(p))
                if fn == "latency_report":
                    res = {"pairable": res["pairable"], "pairingNote": res["pairingNote"],
                           "profiles": [{"impairment": x["impairment"], "events": x["events"],
                                         "selfVisibleP50Ms": _p50(x["trialMetrics"]["latency.input_to_self_visible_ms"]),
                                         "socketRtt": x["trialMetrics"]["net.socket_rtt_ms"]["status"]} for x in res["profiles"]]}
                entry["assessment"] = res
            except adapters.AdapterRefusal as e:
                entry["refused"] = str(e)
        out["receipts"][name] = entry
    _write(a.out, out)
    return 0


def _p50(metric):
    from fullportperf import stats
    return stats.nearest_rank(sorted(metric["samples"]), 50)


def cmd_adapt(a):
    d = canonical.load(a.file)
    try:
        if a.kind == "latency":
            res = adapters.latency_report(d)
        else:
            res = adapters.server_health_series(d, a.window_seconds)
    except adapters.AdapterRefusal as e:
        print(f"refused: {e}", file=sys.stderr)
        return 1
    _write(a.out, res)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--matrix", default=matrix_mod.DEFAULT_PATH)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("matrix")
    p.add_argument("--markdown")
    p.set_defaults(fn=cmd_matrix)
    for name, fn in (("validate", cmd_validate), ("summarize", cmd_summarize)):
        p = sub.add_parser(name)
        p.add_argument("report")
        p.add_argument("--repo")
        p.add_argument("--out")
        p.set_defaults(fn=fn)
    p = sub.add_parser("script")
    p.add_argument("id")
    p.add_argument("--duration-ms", type=int, default=60000)
    p.set_defaults(fn=cmd_script)
    p = sub.add_parser("synthetic")
    p.add_argument("cell")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_synthetic)
    p = sub.add_parser("controls")
    p.add_argument("--repo")
    p.add_argument("--receipt")
    p.set_defaults(fn=cmd_controls)
    p = sub.add_parser("assess-existing")
    p.add_argument("--repo", required=True)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_assess)
    p = sub.add_parser("adapt")
    p.add_argument("kind", choices=("latency", "health"))
    p.add_argument("file")
    p.add_argument("--window-seconds", type=float, default=1.0)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_adapt)
    a = ap.parse_args(argv)
    try:
        return a.fn(a)
    except (OSError, ValueError, KeyError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
