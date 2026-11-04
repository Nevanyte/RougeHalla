#!/usr/bin/env python3
"""A/B proof for performance claims: a baseline revision vs the working tree, on fixed deterministic workloads.

    python3 tools/perfproof/perfproof.py --baseline REV [--out DIR] [--only NAME,...] [--wall N] [--keep]
                                         [--max-ir-ratio R] [--max-alloc-increase A]
                                         [--allow-fingerprint-change NAME,...]

What it measures (all deterministic, so the result does not depend on machine load):
  * instructions (valgrind callgrind "Ir") per unit of work,
  * heap allocations and allocated bytes (valgrind DHAT) per unit of work,
each as the DIFFERENCE between a short and a long run of the same workload divided by the difference in work, so the
fixed costs (process start, fixture and map loading) cancel out. `--wall N` adds N interleaved wall-clock runs per side
(read those only on a quiet machine).

Behaviour fingerprints. Every workload also has a fingerprint, read from one extra native run of the long arguments
(with `--digest` where the binary takes it, so the digest observer never perturbs the measured runs):
  * outcomeDigest: rh_headless::digest, a fold of the public snapshot and the events of every tick (and for paths_300
    of every returned waypoint). It does not depend on Sim::state_hash or any serde layout, so it stays comparable when
    a package restructures state or redefines the hash;
  * the state hash where the binary reports one (stateHashFold, finalStateHash, finalHash), tick/step counts, and for
    the wire workload its byte counts;
  * verify_replay: replays RECORDED BY THE BASELINE binary (600 and 3000 steps), verified by BOTH binaries: `verified`
    true on the candidate proves bit-identical per-step state hashes across the two revisions.
A key present on both sides must be equal. A key on one side only (a key the baseline predates) is listed, not failed.
A workload the baseline cannot run (it predates it) is reported as one side only.

Gate (exit status 1, with the reasons printed): any fingerprint difference, unless the workload, the key or
`workload.key` is named in --allow-fingerprint-change (a package that changes behaviour on purpose declares it);
with --max-ir-ratio R, any workload whose candidate/base Ir per unit exceeds R; with --max-alloc-increase A, any
workload whose candidate allocations per unit exceed the baseline's by more than A.

The baseline is built from a detached git worktree of REV (required: name the revision you compare against, e.g. the
merge commit of the package before yours) into its own target dir; the candidate is the current working tree
(uncommitted changes included) built into another target dir. Both are plain `--release` builds, the profile that
ships. Nothing outside --out (default target/perfproof) is written.
"""

import argparse
import json
import os
import statistics
import subprocess
import sys
import time

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
SEED1 = "parity/maps/seed1.map.json"
HEADLESS_FP = ["ticks", "terminated", "truncated", "stateHashFold", "outcomeDigest"]


def W(name, binary, short, long, unit, fp, digest=True, prepare=None):
    """A workload. `short`/`long` are argument lists (or functions of the out dir and side); `unit` is the work-unit
    key in the program's JSON output; `fp` the fingerprint keys; `digest` whether the fingerprint run adds --digest;
    `prepare(out_dir, sides)` runs once before measuring (e.g. to record the baseline's replays)."""
    return {"name": name, "binary": binary, "short": short, "long": long, "unit": unit, "fp": fp, "digest": digest,
            "prepare": prepare}


def headless(matches, ticks, *extra):
    return ["--matches", str(matches), "--players", "8", "--map", SEED1, "--max-ticks", str(ticks), *extra]


def replay_path(out_dir, ticks):
    return os.path.join(out_dir, f"replay.base.{ticks}.json")


def record_base_replays(out_dir, sides):
    """The verify_replay inputs: replays recorded by the BASELINE binary (two lengths, so long minus short is defined)."""
    src, tgt = sides["base"]
    for ticks in (600, 3000):
        sh([os.path.join(tgt, "release", "rh-headless")] + headless(1, ticks, "--replay-out", replay_path(out_dir, ticks)),
           cwd=src)


WORKLOADS = [
    W("sim_crowded_8", "parity-bench", ["crowded_8", "1"], ["crowded_8", "11"], "steps",
      ["ticks", "finalStateHash", "outcomeDigest"]),
    W("sim_duel_chase", "parity-bench", ["duel_chase", "1"], ["duel_chase", "11"], "steps",
      ["ticks", "finalStateHash", "outcomeDigest"]),
    W("sim_fists_duel", "parity-bench", ["fists_duel", "1"], ["fists_duel", "11"], "steps",
      ["ticks", "finalStateHash", "outcomeDigest"]),
    W("paths_300", "parity-bench", ["paths", "1"], ["paths", "3"], "queries",
      ["queries", "mismatches", "outcomeDigest"]),
    W("wire_seed1_8bots", "wirebench", ["--ticks", "400"], ["--ticks", "2400"], "steps",
      ["steps", "bytesPerPlayerPerSec", "meanSnapshotBytes", "meanVisibleActors", "welcomeBytes", "outcomeDigest"]),
    W("headless_seed1_8bots", "rh-headless", headless(1, 3000), headless(4, 3000), "ticks", HEADLESS_FP),
    # Recording cost is measured: the recorded match is longer in the long run (only match 0 is recorded).
    W("headless_seed1_recorded", "rh-headless",
      lambda out, side: headless(1, 600, "--replay-out", os.path.join(out, f"rec.{side}.s.json")),
      lambda out, side: headless(1, 3000, "--replay-out", os.path.join(out, f"rec.{side}.l.json")),
      "ticks", HEADLESS_FP),
    W("headless_arena_8bots", "rh-headless",
      ["--matches", "2", "--players", "8", "--max-ticks", "6000"],
      ["--matches", "10", "--players", "8", "--max-ticks", "6000"],
      "ticks", HEADLESS_FP),
    # --ignore-content-hash (dev only) skips the content gate only; every step hash is still compared.
    W("verify_replay", "rh-headless",
      lambda out, side: ["--verify-replay", replay_path(out, 600), "--ignore-content-hash"],
      lambda out, side: ["--verify-replay", replay_path(out, 3000), "--ignore-content-hash"],
      "steps", ["verified", "steps", "finalHash", "contentHash"], digest=False, prepare=record_base_replays),
]
PACKAGES = {"parity-bench": "rh-parity", "wirebench": "rh-server", "rh-headless": "rh-headless",
            "loadbench": "rh-server"}


def sh(cmd, cwd=None, env=None, capture=True):
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=capture, text=True)
    if r.returncode != 0:
        sys.stderr.write(f"command failed ({r.returncode}): {' '.join(cmd)}\n{r.stdout}\n{r.stderr}\n")
        sys.exit(1)
    return r.stdout


def build(src, target, bins):
    env = dict(os.environ, CARGO_TARGET_DIR=target)
    have = []
    for b in bins:
        r = subprocess.run(["cargo", "build", "--release", "-q", "-p", PACKAGES[b], "--bin", b], cwd=src, env=env,
                           capture_output=True, text=True)
        if r.returncode == 0:
            have.append(b)
        else:
            sys.stderr.write(f"[perfproof] {b}: not buildable in {src} (absent at that revision?)\n")
    return have


def last_json(text):
    for line in reversed(text.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    raise ValueError(f"no JSON line in output:\n{text}")


def unit_of(out, key):
    if key in out:
        return float(out[key])
    if key == "steps" and "ticks" in out and "runs" in out:
        # parity-bench: "ticks" counts the timed steps (runs x scenario length); it also runs 3 untimed warm-up passes.
        runs = int(out["runs"])
        return float(out["ticks"]) / runs * (runs + 3)
    raise KeyError(f"work unit {key} missing from {out}")


def run_valgrind(tool, binary, args, src, out_file):
    """Runs the binary under a valgrind tool. A non-zero exit is accepted when the program printed its JSON (a failed
    replay verification is a result: it shows up in the fingerprint)."""
    r = subprocess.run(["valgrind", f"--tool={tool}", f"--{'callgrind' if tool == 'callgrind' else 'dhat'}-out-file={out_file}",
                        binary] + args, cwd=src, capture_output=True, text=True)
    try:
        out = last_json(r.stdout)
    except ValueError:
        sys.stderr.write(r.stderr[-3000:])
        sys.exit(1)
    return r, out


def callgrind(binary, args, src, out_dir, tag):
    f = os.path.join(out_dir, f"cg.{tag}.out")
    r, out = run_valgrind("callgrind", binary, args, src, f)
    ir = None
    for line in r.stderr.splitlines():
        if "Collected :" in line:
            ir = int(line.split(":")[-1].strip())
    if os.path.exists(f):
        os.remove(f)
    return ir, out


def dhat(binary, args, src, out_dir, tag):
    f = os.path.join(out_dir, f"dhat.{tag}.json")
    run_valgrind("dhat", binary, args, src, f)
    d = json.load(open(f))
    os.remove(f)
    return sum(p["tbk"] for p in d["pps"]), sum(p["tb"] for p in d["pps"])


def args_of(spec, out_dir, side):
    return spec(out_dir, side) if callable(spec) else list(spec)


def fingerprint(side, src, target, out_dir, wl):
    """One native run of the long arguments (plus --digest): the behaviour fingerprint, or None when this side's
    binary cannot run the workload (it predates it)."""
    exe = os.path.join(target, "release", wl["binary"])
    args = args_of(wl["long"], out_dir, f"{side}.fp") + (["--digest"] if wl["digest"] else [])
    r = subprocess.run([exe] + args, cwd=src, capture_output=True, text=True)
    try:
        out = last_json(r.stdout)
    except ValueError:
        sys.stderr.write(f"[perfproof] {wl['name']}: the {side} binary cannot run it (exit {r.returncode}); "
                         f"one side only\n{r.stderr[-600:]}\n")
        return None
    return out


def measure(side, src, target, out_dir, wl, fp_out):
    name, unit = wl["name"], wl["unit"]
    exe = os.path.join(target, "release", wl["binary"])
    a_short, a_long = args_of(wl["short"], out_dir, side), args_of(wl["long"], out_dir, side)
    ir_s, o_s = callgrind(exe, a_short, src, out_dir, f"{side}.{name}.s")
    ir_l, o_l = callgrind(exe, a_long, src, out_dir, f"{side}.{name}.l")
    bk_s, by_s = dhat(exe, a_short, src, out_dir, f"{side}.{name}.s")
    bk_l, by_l = dhat(exe, a_long, src, out_dir, f"{side}.{name}.l")
    du = unit_of(o_l, unit) - unit_of(o_s, unit)
    if unit_of(fp_out, unit) != unit_of(o_l, unit):
        sys.stderr.write(f"[perfproof] {name} {side}: the fingerprint run did {unit_of(fp_out, unit)} {unit}, the "
                         f"measured run {unit_of(o_l, unit)}: not the same work\n")
        sys.exit(1)
    return {
        "unit": unit, "work": du,
        "ir_per_unit": (ir_l - ir_s) / du, "allocs_per_unit": (bk_l - bk_s) / du, "bytes_per_unit": (by_l - by_s) / du,
        "fingerprint": {k: fp_out[k] for k in wl["fp"] if k in fp_out},
    }


def wall(src, target, binary, args):
    return last_json(sh([os.path.join(target, "release", binary)] + args, cwd=src))


def compare_fingerprints(b, c):
    """(differences, keys on one side only)."""
    diff = {k: (b[k], c[k]) for k in b if k in c and b[k] != c[k]}
    only = sorted(set(b) ^ set(c))
    return diff, only


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", required=True, help="the revision to compare against")
    ap.add_argument("--out", default=os.path.join(ROOT, "target", "perfproof"))
    ap.add_argument("--only", default="")
    ap.add_argument("--wall", type=int, default=0)
    ap.add_argument("--keep", action="store_true", help="keep the baseline worktree for the next run")
    ap.add_argument("--max-ir-ratio", type=float, default=None,
                    help="fail when a workload's candidate/base Ir per unit exceeds this (default: off)")
    ap.add_argument("--max-alloc-increase", type=float, default=None,
                    help="fail when a workload's candidate allocations per unit exceed the base's by more than this")
    ap.add_argument("--allow-fingerprint-change", default="",
                    help="workloads, fingerprint keys or workload.key whose fingerprint may differ (declared changes)")
    a = ap.parse_args()
    allowed = {x for x in a.allow_fingerprint_change.split(",") if x}
    os.makedirs(a.out, exist_ok=True)
    known = {w["name"] for w in WORKLOADS}
    only = [x for x in a.only.split(",") if x]
    if any(x not in known for x in only):
        sys.exit(f"unknown workload(s) {[x for x in only if x not in known]}; known: {sorted(known)}")
    wls = [w for w in WORKLOADS if not only or w["name"] in only]
    bins = sorted({w["binary"] for w in wls})

    base_src = os.path.join(a.out, "base-src")
    rev = sh(["git", "rev-parse", a.baseline], cwd=ROOT).strip()
    if os.path.isdir(base_src):
        cur = subprocess.run(["git", "rev-parse", "HEAD"], cwd=base_src, capture_output=True, text=True).stdout.strip()
        if cur != rev:
            sh(["git", "worktree", "remove", "--force", base_src], cwd=ROOT)
    if not os.path.isdir(base_src):
        sh(["git", "worktree", "add", "--detach", base_src, rev], cwd=ROOT)
    sides = {"base": (base_src, os.path.join(a.out, "base-target")), "cand": (ROOT, os.path.join(a.out, "cand-target"))}
    have = {s: set(build(src, tgt, bins)) for s, (src, tgt) in sides.items()}

    head = sh(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT).strip()
    dirty = bool(sh(["git", "status", "--porcelain", "--untracked-files=no"], cwd=ROOT).strip())
    report = {"baseline": rev[:7], "candidate": head + ("+dirty" if dirty else ""), "workloads": []}
    prepared = set()
    for wl in wls:
        if wl["prepare"] and wl["prepare"] not in prepared and wl["binary"] in have["base"]:
            wl["prepare"](a.out, sides)
            prepared.add(wl["prepare"])
        row = {"name": wl["name"]}
        for s, (src, tgt) in sides.items():
            fp = fingerprint(s, src, tgt, a.out, wl) if wl["binary"] in have[s] else None
            row[s] = measure(s, src, tgt, a.out, wl, fp) if fp is not None else None
        report["workloads"].append(row)
        sys.stderr.write(f"[perfproof] {wl['name']} done\n")

    if a.wall:
        for wl in wls:
            row = next(r for r in report["workloads"] if r["name"] == wl["name"])
            if not (row["base"] and row["cand"]):
                continue
            t = {s: [] for s in sides}
            for _ in range(a.wall):
                for s, (src, tgt) in sides.items():  # interleaved, so drift hits both sides alike
                    t0 = time.perf_counter()
                    wall(src, tgt, wl["binary"], args_of(wl["long"], a.out, f"{s}.wall"))
                    t[s].append(time.perf_counter() - t0)
            row["wall_median_s"] = {s: statistics.median(v) for s, v in t.items()}

    violations = []
    print(f"baseline {report['baseline']} vs candidate {report['candidate']} (per unit of work; deterministic counts)\n")
    print("| workload | unit | Ir base | Ir cand | ratio | allocs base | allocs cand | bytes base | bytes cand | same behaviour |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in report["workloads"]:
        b, c = r["base"], r["cand"]
        if not b or not c:
            x = b or c
            if not x:
                print(f"| {r['name']} | | - | - | n/a | | | | | neither side ran it |")
                violations.append(f"{r['name']}: neither side could run it")
                continue
            print(f"| {r['name']} | {x['unit']} | {'-' if not b else round(b['ir_per_unit'])} | "
                  f"{'-' if not c else round(c['ir_per_unit'])} | n/a | | {'' if not c else round(c['allocs_per_unit'], 2)} "
                  f"| | | one side only ({'candidate' if c else 'base'}) |")
            if not c:
                violations.append(f"{r['name']}: the candidate cannot run it")
            continue
        diff, one_side = compare_fingerprints(b["fingerprint"], c["fingerprint"])
        ok_diff = {k: v for k, v in diff.items() if not ({r["name"], k, f"{r['name']}.{k}"} & allowed)}
        if not diff:
            same = "yes"
        else:
            same = ("NO (declared): " if not ok_diff else "NO: ") + "; ".join(f"{k} {v[0]} -> {v[1]}" for k, v in diff.items())
        if one_side:
            same += f" (one side only: {', '.join(one_side)})"
        for k, v in ok_diff.items():
            violations.append(f"{r['name']}: fingerprint {k} changed {v[0]} -> {v[1]} (declare with --allow-fingerprint-change)")
        ratio = c["ir_per_unit"] / b["ir_per_unit"]
        if a.max_ir_ratio is not None and ratio > a.max_ir_ratio:
            violations.append(f"{r['name']}: Ir ratio {ratio:.4f} > --max-ir-ratio {a.max_ir_ratio}")
        inc = c["allocs_per_unit"] - b["allocs_per_unit"]
        if a.max_alloc_increase is not None and inc > a.max_alloc_increase:
            violations.append(f"{r['name']}: allocations per {b['unit']} +{inc:.3f} > --max-alloc-increase "
                              f"{a.max_alloc_increase}")
        print(f"| {r['name']} | {b['unit']} | {b['ir_per_unit']:.0f} | {c['ir_per_unit']:.0f} | "
              f"{ratio:.4f} | {b['allocs_per_unit']:.2f} | {c['allocs_per_unit']:.2f} | "
              f"{b['bytes_per_unit']:.0f} | {c['bytes_per_unit']:.0f} | {same} |")
        if "wall_median_s" in r:
            w = r["wall_median_s"]
            print(f"|   wall-clock median of {a.wall} interleaved runs | s | {w['base']:.3f} | {w['cand']:.3f} | "
                  f"{w['cand'] / w['base']:.3f} | | | | | |")
    print("\nfingerprints (candidate):")
    for r in report["workloads"]:
        x = r["cand"] or r["base"]
        if x:
            print(f"  {r['name']}: {json.dumps(x['fingerprint'], sort_keys=True)}")
    report["violations"] = violations
    json.dump(report, open(os.path.join(a.out, "report.json"), "w"), indent=1)
    if not a.keep:
        sh(["git", "worktree", "remove", "--force", base_src], cwd=ROOT)
        sh(["git", "worktree", "prune"], cwd=ROOT)
    if violations:
        print("\nGATE FAILED:")
        for v in violations:
            print(f"  - {v}")
        sys.exit(1)
    print("\ngate: pass")


if __name__ == "__main__":
    main()
