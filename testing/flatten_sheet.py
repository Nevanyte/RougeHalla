"""Fit a faction sheet with no counter matchups (the faction rework, testing/TUNING_BALANCE.md section 13).

    python3 testing/flatten_sheet.py [--start sheet.json] [--iters 8] [--out fitted.json] [--report-only]
                                                                                   (needs numpy; about 3-6 minutes)

A bounded, regularized Levenberg-Marquardt fit (finite differences, numpy only). The residuals are the signed hp left of every
one of the ten unordered pairs: in the weapon-less engine (engine.duel at the game's pace k = 2) and in the 20 Hz model
(realtime.duel, both fighters on the same weapon: fists, the weapon a run starts on, then the bow and the sword), plus
  - the log of the median fight length on fists (pairs and mirrors) over TARGET_FIGHT_S, so the TTK curve and the PvP factor
    fit to it stay valid;
  - a pull toward the starting sheet (the identities), with hard bounds (KNOBS) that keep each faction inside its role.
Attack rates, damage-type shares and the defenses' split are not knobs: every faction has armor = shield (`def` in the JSON),
so no damage type counters a defense profile, and only the identity numbers below move.
The starting sheet is START (or --start, the same JSON shape); the result prints as a table and a JSON to paste into classes.py.
"""
import argparse
import itertools
import json
import math
import os
import sys
import time
from dataclasses import replace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np  # noqa: E402
import engine  # noqa: E402
import realtime as W  # noqa: E402
from classes import POWERS  # noqa: E402
from realtime_paced import paced  # noqa: E402

NAMES = [p.name for p in POWERS]
PAIRS = list(itertools.combinations(NAMES, 2))
K = 2.0
TARGET_FIGHT_S = 19.0
FIT_WEAPONS = ("fists", "bow", "sword")

# The hand-built start: each faction's identity in its numbers (Fire the lowest hp and the biggest hit; Sentenced a share of
# the target's max hp a hit; Plague many small hits and the execute; Frost the most defense and the slow; Holy the most hp and
# a lifesteal that grows as it falls, trimmed from 0.11 + 0.85 x missing, cap 0.75).
START = {
    "Fire": {"hp": 820, "hit": 100, "def": 30, "params": {"burn": 18, "backlash": 120}},
    "Sentenced": {"hp": 950, "hit": 35, "def": 100, "params": {"mark_pct": 0.025}},
    "Plague": {"hp": 1150, "hit": 20, "def": 80, "params": {"plague": 43, "execute": 350}},
    "Frost": {"hp": 1050, "hit": 160, "def": 170, "params": {"slow": 0.35}},
    "Holy": {"hp": 1250, "hit": 96, "def": 80, "params": {"ls0": 0.08, "ls1": 0.65, "ls_cap": 0.6}},
}

# (faction, knob, low, high): every knob is fitted on a log scale inside its bounds. The hp bounds are deliberately narrow: a
# mark that is a share of the target's max hp kills every target in the same time, so it can only be even against everyone
# if every raw hp pool is about the same size (the toughness that tells the factions apart is defense, lifesteal and the
# slow, which the mark ignores or meets like any damage). Fire stays the frailest (the least defense), Holy the biggest pool.
KNOBS = [
    ("Fire", "hp", 750, 950), ("Fire", "hit", 85, 130), ("Fire", "def", 10, 50), ("Fire", "p:burn", 10, 40), ("Fire", "p:backlash", 60, 200),
    ("Sentenced", "hp", 950, 1150), ("Sentenced", "hit", 25, 90), ("Sentenced", "def", 60, 140), ("Sentenced", "p:mark_pct", 0.015, 0.045),
    ("Plague", "hp", 950, 1150), ("Plague", "hit", 14, 30), ("Plague", "def", 40, 120), ("Plague", "p:plague", 25, 70), ("Plague", "p:execute", 200, 500),
    ("Frost", "hp", 950, 1150), ("Frost", "hit", 120, 220), ("Frost", "def", 110, 220), ("Frost", "p:slow", 0.25, 0.4),
    ("Holy", "hp", 1000, 1200), ("Holy", "hit", 70, 120), ("Holy", "def", 40, 120),
]


def sheet_from(d):
    out = {}
    for p in POWERS:
        o = dict(d.get(p.name, {}))
        params = {**p.params, **o.pop("params", {})}
        if "def" in o:
            v = o.pop("def")
            o["armor"] = v
            o["shield"] = v
        out[p.name] = replace(p, params=params, **o)
    return out


def get(p, k):
    return p.params[k[2:]] if k.startswith("p:") else (p.armor if k == "def" else getattr(p, k))


def setv(p, k, v):
    if k.startswith("p:"):
        return replace(p, params={**p.params, k[2:]: v})
    if k == "def":
        return replace(p, armor=v, shield=v)
    return replace(p, **{k: v})


def to_x(sheet):
    return np.array([math.log(get(sheet[n], k)) for (n, k, lo, hi) in KNOBS])


def from_x(x, base):
    sheet = dict(base)
    for xi, (n, k, lo, hi) in zip(x, KNOBS):
        sheet[n] = setv(sheet[n], k, min(hi, max(lo, math.exp(xi))))
    return sheet


def clip_x(x):
    return np.array([min(math.log(hi), max(math.log(lo), xi)) for xi, (n, k, lo, hi) in zip(x, KNOBS)])


def rt_margin(r):
    return float(np.where(r["win"] == 0, r["frac0"], np.where(r["win"] == 1, -r["frac1"], 0.0)).mean())


def measure(sheet, weapons=FIT_WEAPONS, nmax=3, dt=0.005):
    by = {n: paced(p, K) for n, p in sheet.items()}
    eng, rt, ts = [], {w: [] for w in weapons}, []
    for a, b in PAIRS:
        w, t, ha, hb = engine.duel(by[a], by[b], dt)
        eng.append(ha / by[a].hp if w == 0 else (-hb / by[b].hp if w == 1 else 0.0))
        for wn in weapons:
            r = W.duel(W.Side(by[a], wn), W.Side(by[b], wn), nmax=nmax)
            rt[wn].append(rt_margin(r))
            if wn == "fists":
                ts.append(float(np.median(r["t"])))
    mirrors = {}
    for n in NAMES:
        r = W.duel(W.Side(by[n], "fists"), W.Side(by[n], "fists"), nmax=nmax)
        mirrors[n] = float(np.median(r["t"]))
    return eng, rt, ts + list(mirrors.values()), mirrors


def residuals(x, base, x0, lam):
    eng, rt, ts, _ = measure(from_x(x, base))
    r = [0.5 * v for v in eng]
    for wn, vals in rt.items():
        r += [v * (1.0 if wn == "fists" else 0.7) for v in vals]
    r.append(0.3 * math.log(float(np.median(ts)) / TARGET_FIGHT_S))
    r += list(lam * (x - x0))
    return np.array(r)


def lm(base, x, iters, lam, h=0.01):
    x0 = x.copy()
    x = clip_x(x)
    f = residuals(x, base, x0, lam)
    cost = float(f @ f)
    mu = 1e-2
    t0 = time.time()
    for it in range(iters):
        J = np.empty((len(f), len(x)))
        for j in range(len(x)):
            xp = x.copy()
            xp[j] += h
            J[:, j] = (residuals(clip_x(xp), base, x0, lam) - f) / h
        g = J.T @ f
        A = J.T @ J
        improved = False
        for _ in range(8):
            step = np.linalg.solve(A + mu * np.diag(np.diag(A) + 1e-9), -g)
            xn = clip_x(x + step)
            fn = residuals(xn, base, x0, lam)
            cn = float(fn @ fn)
            if cn < cost:
                x, f, cost = xn, fn, cn
                mu = max(mu / 3, 1e-6)
                improved = True
                break
            mu *= 4
        print(f"iter {it}: cost {cost:.5f}, {time.time() - t0:.0f} s", flush=True)
        if not improved:
            break
    return x


def report(sheet):
    weapons = ("fists", "sword", "axe", "bow", "wand", "shield")
    eng, rt, ts, mirrors = measure(sheet, weapons, nmax=5, dt=0.002)
    cols = ["engine", *weapons]
    print(f"{'pair':20s} " + " ".join(f"{c:>7s}" for c in cols) + "   fight s (fists)")
    allm = []
    for i, (a, b) in enumerate(PAIRS):
        vals = [eng[i]] + [rt[w][i] for w in weapons]
        allm += vals
        print(f"{a + '-' + b:20s} " + " ".join(f"{v * 100:+7.1f}" for v in vals) + f"   {ts[i]:5.1f}")
    print(f"worst |h| {max(abs(v) for v in allm) * 100:.1f}%, mean |h| {np.mean(np.abs(allm)) * 100:.1f}%, "
          f"median fists fight {np.median(ts):.1f} s")
    print("fists mirrors (s):", {n: round(v, 1) for n, v in mirrors.items()})


def dump(sheet):
    return {n: dict(hp=round(p.hp, 1), hit=round(p.hit, 3), **{"def": round(p.armor, 1)},
                    params={k: round(v, 5) for k, v in p.params.items()}) for n, p in sheet.items()}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=8)
    ap.add_argument("--lam", type=float, default=0.03, help="pull toward the starting sheet")
    ap.add_argument("--out", default="")
    ap.add_argument("--start", default="", help="a JSON sheet to start from (START's shape)")
    ap.add_argument("--report-only", action="store_true")
    args = ap.parse_args(argv)
    start = json.load(open(args.start)) if args.start else START
    base = sheet_from(start)
    if args.report_only:
        report(base)
        return 0
    x = lm(base, to_x(base), args.iters, args.lam)
    sheet = from_x(x, base)
    report(sheet)
    out = dump(sheet)
    print(json.dumps(out, indent=1))
    if args.out:
        with open(args.out, "w") as f:
            json.dump(out, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
