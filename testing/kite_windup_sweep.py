"""Which bow and wand windups hold the kiting guarantee? (the controls rework; test_kite.py's check, swept)

NOTE (balance pass): test_kite.py now judges a perfect orb-walker by the noise model (r_kite >= 0.78: it wins at most 65%). This
sweep keeps the controls rework's stricter OLD measure, the weakest melee tolerance over the orb-walk free fire (margin >= 1), as
a stress test of the windup lever: on the compressed sheet the tolerance is 0 in many cells (the favourite's edge is thin by
design), so a "STOLEN" count here is no longer the gate; read the shares at which the margin stops falling as the lever's shape.

    python3 testing/kite_windup_sweep.py        (needs numpy, like realtime.py; about 10 s)

A ranged weapon's windup is min(cap, share x interval) seconds (realtime.windup, shared/weapons.ts BOW_WINDUP /
BOW_WINDUP_SHARE and the wand's pair). For the bow and the wand separately (the other weapon never enters a cell of its own,
so each sweep leaves the other at its current values) this tries every share and cap on the grids below and, per setting,
counts how many of the 10 faction-edge cells are STOLEN (weakest melee tolerance < orb-walk free-fire time) and gives the
worst margin (tolerance / orb-walk time) and its cell. The k = 2 tolerances are the duel model's and do not depend on the
windup, so they are computed once (the slow part, about 4 s). It ends with the smallest share that holds all 10 cells at
margin >= 1.0 and >= 1.05, per cap and overall, on the coarse grid and on a 0.01 grid.

    python3 testing/kite_windup_sweep.py --shooter-as 1.08

sweeps the same windups with every shooter's attack speed x1.08 (a buff; the chaser has none): the tolerances, the
orb-walk times and the Frost threshold all use it (test_kite.py --shooter-as, kite_buff_sweep.py).
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as W  # noqa: E402
import test_kite as K  # noqa: E402

INF = math.inf
SHARES = [0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.88, 0.9, 0.92, 0.95, 1.0]
CAPS = [0.2, 0.4, 0.6, 0.8, INF]
FINE = [round(0.20 + 0.01 * i, 2) for i in range(81)]  # 0.20 .. 1.00
THRESHOLDS = (1.0, 1.05)


def cap_text(cap):
    return "inf" if cap == INF else f"{cap:.1f}"


AS_MULT = 1.0  # every shooter's attack-speed multiplier (--shooter-as)


def evaluate(tols, weapon, cap, share):
    """[(cell, margin)] for the weapon's 10 edges with its windup set to (cap, share). Margin 0 when the chaser never arrives."""
    spec = W.WEAPONS[weapon]
    saved = spec["windup"], spec["wshare"]
    spec["windup"], spec["wshare"] = cap, share
    try:
        out = []
        for a, b in W.BEATS:
            tol = min(tols[(a, b, weapon)].values())
            orb = W.orbwalk_free_fire(b, weapon, a, as_mult=AS_MULT)
            out.append((f"{a}>{b}", 0.0 if orb == INF else tol / orb))
        return out
    finally:
        spec["windup"], spec["wshare"] = saved


def summary(cells):
    worst = min(cells, key=lambda c: c[1])
    return sum(1 for _, m in cells if m < 1.0), worst[1], worst[0]


def smallest_holding(tols, weapon, cap, thr):
    """Smallest share on the 0.01 grid from which every larger share also holds all cells at margin >= thr, else None."""
    ok = [min(m for _, m in evaluate(tols, weapon, cap, s)) >= thr for s in FINE]
    best = None
    for i in range(len(FINE) - 1, -1, -1):
        if not ok[i]:
            break
        best = FINE[i]
    return best


def frost_threshold(weapon):
    """Smallest windup (s, 0.01 grid) from which a Frost shooter that orb-walks can no longer keep a chaser out of reach for
    good with its move chill (0.7 V inside 100 u): the gap sits at the chill radius whenever the windup is too short to cover
    the 40 u from there to melee reach, whatever the share."""
    spec = W.WEAPONS[weapon]
    saved = spec["windup"], spec["wshare"]
    try:
        best = None
        for w in [round(0.60 - 0.01 * i, 2) for i in range(51)]:
            spec["windup"], spec["wshare"] = w, 1.0
            if W.orbwalk_free_fire("Frost", weapon, as_mult=AS_MULT) == INF:
                break
            best = w
        return best
    finally:
        spec["windup"], spec["wshare"] = saved


def main(argv=None):
    global AS_MULT
    ap = argparse.ArgumentParser(description="Which bow and wand windups hold the kiting guarantee?")
    ap.add_argument("--shooter-as", type=float, default=1.0, help="every shooter's attack-speed multiplier (default 1: no buff)")
    AS_MULT = ap.parse_args(argv).shooter_as
    K.load_k2()
    tols = W.kite_tolerances(AS_MULT)
    if AS_MULT != 1.0:
        print(f"shooter buffed: attack speed x{AS_MULT:g} (the chaser is not)")
    print("k = 2 tolerance of the weakest melee weapon per cell (s), and the standing / current orb-walk free-fire times")
    for weapon in W.RANGED:
        spec = W.WEAPONS[weapon]
        print(f"  {weapon} (windup now cap {spec['windup']} s, share {spec['wshare']}):")
        for a, b in W.BEATS:
            tol = tols[(a, b, weapon)]
            weakest = min(tol, key=tol.get)
            print(f"    {a+'>'+b:17s} tolerance {tol[weakest]:6.2f} ({weakest:6s}) standing {W.free_fire_time(b, weapon):5.2f}"
                  f"  orb now {W.orbwalk_free_fire(b, weapon, a, as_mult=AS_MULT):6.2f}  windup {W.windup(W.BY[b], weapon, AS_MULT):.3f} of interval {W.interval(W.BY[b], weapon, AS_MULT):.3f}")

    holds = {}
    for weapon in W.RANGED:
        print(f"\n=== {weapon}: STOLEN cells of 10 and the worst margin (tolerance / orb-walk free fire), per cap and share")
        print(f"{'cap':>5s} {'share':>6s} {'stolen':>7s} {'worst':>7s}  cell")
        grid = {}
        for cap in CAPS:
            for share in SHARES:
                stolen, worst, cell = summary(evaluate(tols, weapon, cap, share))
                grid[(cap, share)] = (stolen, worst)
                print(f"{cap_text(cap):>5s} {share:6.2f} {stolen:5d}/10 {worst:7.3f}  {cell}")
        print(f"\n  {weapon}, stolen / worst margin (rows share, columns cap)")
        print("  " + f"{'share':>6s}" + "".join(f"{cap_text(c):>12s}" for c in CAPS))
        for share in SHARES:
            print("  " + f"{share:6.2f}" + "".join(f"{grid[(c, share)][0]:>5d} /{grid[(c, share)][1]:6.3f}" for c in CAPS))

        print(f"\n  {weapon}: smallest share that holds all 10 cells (every larger share holds too)")
        for thr in THRESHOLDS:
            coarse = {}
            for cap in CAPS:
                ok = [grid[(cap, s)][1] >= thr for s in SHARES]
                coarse[cap] = next((SHARES[i] for i in range(len(SHARES)) if all(ok[i:])), None)
            fine = {cap: smallest_holding(tols, weapon, cap, thr) for cap in CAPS}
            holds[(weapon, thr)] = fine
            print(f"    margin >= {thr:.2f}:  " + "  ".join(
                f"cap {cap_text(c)}: {'none' if coarse[c] is None else f'{coarse[c]:.2f}'} ({'none' if fine[c] is None else f'{fine[c]:.2f}'})"
                for c in CAPS) + "   [coarse grid (0.01 grid)]")
            have = {c: v for c, v in fine.items() if v is not None}
            if have:
                best = min(have.values())
                caps = [c for c in CAPS if have.get(c) == best]
                print(f"      -> smallest share {best:.2f}, held by caps {', '.join(cap_text(c) for c in caps)}")
            else:
                print("      -> no cap/share on the grid holds")

    need = (W.CHILL_MOVE_RADIUS - W.REACH) / (W.CHILL_MOVE_MULT * W.V)
    print(f"\n=== Frost shooter's move chill: a chaser at the chill radius ({W.CHILL_MOVE_RADIUS:.0f} u) needs a windup of "
          f"(radius - reach) / (chill mult x V) = {need:.3f} s (7 ticks = 0.35 s on the 20 Hz grid) to reach melee reach in one windup;")
    print("    shorter and the Frost shooter walks the chaser out of reach for good (orb-walk time inf, the Sentenced>Frost and Plague>Frost cells)")
    for weapon in W.RANGED:
        print(f"  {weapon}: smallest windup that lets the chaser arrive, from which every longer one does too: {frost_threshold(weapon):.2f} s "
              f"(Frost's {weapon} interval {W.interval(W.BY['Frost'], weapon, AS_MULT):.2f} s)")

    print("\n=== margins at the smallest holding settings (0.01 grid): the worst cell and the runner-up")
    for weapon in W.RANGED:
        for thr in THRESHOLDS:
            fine = holds[(weapon, thr)]
            have = {c: v for c, v in fine.items() if v is not None}
            if not have:
                continue
            best = min(have.values())
            cap = min(c for c in have if have[c] == best)
            cells = sorted(evaluate(tols, weapon, cap, best), key=lambda c: c[1])
            print(f"  {weapon} margin >= {thr:.2f}: cap {cap_text(cap)} share {best:.2f}: " + ", ".join(f"{n} x{m:.3f}" for n, m in cells[:4]))


if __name__ == "__main__":
    main()
