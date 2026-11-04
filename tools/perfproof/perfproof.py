#!/usr/bin/env python3
"""A/B proof for performance claims: a baseline revision vs the working tree, on fixed deterministic workloads.

    python3 tools/perfproof/perfproof.py [--baseline REV] [--out DIR] [--only NAME,...] [--wall N] [--keep]

What it measures (all deterministic, so the result does not depend on machine load):
  * instructions (valgrind callgrind "Ir") per unit of work,
  * heap allocations and allocated bytes (valgrind DHAT) per unit of work,
each as the DIFFERENCE between a short and a long run of the same workload divided by the difference in work, so the
fixed costs (process start, fixture and map loading) cancel out. `--wall N` adds N interleaved wall-clock runs per side
(read those only on a quiet machine).

It also prints each workload's behaviour fingerprint (ticks, terminations, bytes, visible actors) for both sides: when
gameplay is unchanged these must be identical, and the comparison is only meaningful if they are (the script says so).

The baseline is built from a detached git worktree of REV (default: the Stage 1 head, 7d94332) into its own target dir;
the candidate is the current working tree (uncommitted changes included) built into another target dir. Both are plain
`--release` builds, the profile that ships. Nothing outside --out (default target/perfproof) is written.
"""

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import time

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()

# name -> (binary, args for the short run, args for the long run, work-unit key in the JSON output, fingerprint keys)
# The work unit is read from the program's own JSON output, so a workload that ends early is still divided correctly.
WORKLOADS = [
    ("sim_crowded_8", "parity-bench", ["crowded_8", "1"], ["crowded_8", "11"], "steps", []),
    ("sim_duel_chase", "parity-bench", ["duel_chase", "1"], ["duel_chase", "11"], "steps", []),
    ("sim_fists_duel", "parity-bench", ["fists_duel", "1"], ["fists_duel", "11"], "steps", []),
    ("wire_seed1_8bots", "wirebench", ["--ticks", "400"], ["--ticks", "2400"], "steps",
     ["steps", "bytesPerPlayerPerSec", "meanSnapshotBytes", "meanVisibleActors", "welcomeBytes"]),
    ("headless_seed1_8bots", "rh-headless",
     ["--matches", "1", "--players", "8", "--map", "parity/maps/seed1.map.json", "--max-ticks", "3000"],
     ["--matches", "4", "--players", "8", "--map", "parity/maps/seed1.map.json", "--max-ticks", "3000"],
     "ticks", ["ticks", "terminated", "truncated"]),
    ("headless_arena_8bots", "rh-headless",
     ["--matches", "2", "--players", "8", "--max-ticks", "6000"],
     ["--matches", "10", "--players", "8", "--max-ticks", "6000"],
     "ticks", ["ticks", "terminated", "truncated"]),
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


def callgrind(binary, args, src, out_dir, tag):
    f = os.path.join(out_dir, f"cg.{tag}.out")
    r = subprocess.run(["valgrind", "--tool=callgrind", f"--callgrind-out-file={f}", binary] + args, cwd=src,
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        sys.exit(1)
    ir = None
    for line in r.stderr.splitlines():
        if "Collected :" in line:
            ir = int(line.split(":")[-1].strip())
    os.remove(f)
    return ir, last_json(r.stdout)


def dhat(binary, args, src, out_dir, tag):
    f = os.path.join(out_dir, f"dhat.{tag}.json")
    r = subprocess.run(["valgrind", "--tool=dhat", f"--dhat-out-file={f}", binary] + args, cwd=src,
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-3000:])
        sys.exit(1)
    d = json.load(open(f))
    os.remove(f)
    return sum(p["tbk"] for p in d["pps"]), sum(p["tb"] for p in d["pps"])


def measure(side, src, target, out_dir, wl):
    name, binary, a_short, a_long, unit, _fp = wl
    exe = os.path.join(target, "release", binary)
    ir_s, o_s = callgrind(exe, a_short, src, out_dir, f"{side}.{name}.s")
    ir_l, o_l = callgrind(exe, a_long, src, out_dir, f"{side}.{name}.l")
    bk_s, by_s = dhat(exe, a_short, src, out_dir, f"{side}.{name}.s")
    bk_l, by_l = dhat(exe, a_long, src, out_dir, f"{side}.{name}.l")
    du = unit_of(o_l, unit) - unit_of(o_s, unit)
    return {
        "unit": unit, "work": du,
        "ir_per_unit": (ir_l - ir_s) / du, "allocs_per_unit": (bk_l - bk_s) / du, "bytes_per_unit": (by_l - by_s) / du,
        "fingerprint": {k: o_l.get(k) for k in wl[5]},
    }


def wall(side, src, target, binary, args):
    out = sh([os.path.join(target, "release", binary)] + args, cwd=src)
    o = last_json(out)
    return o


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", default="7d94332")
    ap.add_argument("--out", default=os.path.join(ROOT, "target", "perfproof"))
    ap.add_argument("--only", default="")
    ap.add_argument("--wall", type=int, default=0)
    ap.add_argument("--keep", action="store_true", help="keep the baseline worktree for the next run")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    wls = [w for w in WORKLOADS if not a.only or w[0] in a.only.split(",")]
    bins = sorted({w[1] for w in wls})

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
    for wl in wls:
        row = {"name": wl[0]}
        for s, (src, tgt) in sides.items():
            row[s] = measure(s, src, tgt, a.out, wl) if wl[1] in have[s] else None
        report["workloads"].append(row)
        sys.stderr.write(f"[perfproof] {wl[0]} done\n")

    if a.wall:
        for wl in wls:
            if not all(wl[1] in have[s] for s in sides):
                continue
            t = {s: [] for s in sides}
            for _ in range(a.wall):
                for s, (src, tgt) in sides.items():  # interleaved, so drift hits both sides alike
                    t0 = time.perf_counter()
                    wall(s, src, tgt, wl[1], wl[3])
                    t[s].append(time.perf_counter() - t0)
            row = next(r for r in report["workloads"] if r["name"] == wl[0])
            row["wall_median_s"] = {s: statistics.median(v) for s, v in t.items()}

    json.dump(report, open(os.path.join(a.out, "report.json"), "w"), indent=1)
    print(f"baseline {report['baseline']} vs candidate {report['candidate']} (per unit of work; deterministic counts)\n")
    print("| workload | unit | Ir base | Ir cand | ratio | allocs base | allocs cand | bytes base | bytes cand | same behaviour |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for r in report["workloads"]:
        b, c = r["base"], r["cand"]
        if not b or not c:
            x = b or c
            print(f"| {r['name']} | {x['unit']} | {'-' if not b else round(b['ir_per_unit'])} | "
                  f"{'-' if not c else round(c['ir_per_unit'])} | n/a | | | | | one side only |")
            continue
        same = "yes" if b["fingerprint"] == c["fingerprint"] else f"NO: {b['fingerprint']} vs {c['fingerprint']}"
        print(f"| {r['name']} | {b['unit']} | {b['ir_per_unit']:.0f} | {c['ir_per_unit']:.0f} | "
              f"{c['ir_per_unit'] / b['ir_per_unit']:.3f} | {b['allocs_per_unit']:.2f} | {c['allocs_per_unit']:.2f} | "
              f"{b['bytes_per_unit']:.0f} | {c['bytes_per_unit']:.0f} | {same} |")
        if "wall_median_s" in r:
            w = r["wall_median_s"]
            print(f"|   wall-clock median of {a.wall} interleaved runs | s | {w['base']:.3f} | {w['cand']:.3f} | "
                  f"{w['cand'] / w['base']:.3f} | | | | | |")
    if not a.keep:
        sh(["git", "worktree", "remove", "--force", base_src], cwd=ROOT)
        sh(["git", "worktree", "prune"], cwd=ROOT)


if __name__ == "__main__":
    main()
