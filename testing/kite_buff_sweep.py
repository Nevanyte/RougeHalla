"""How much can a buff on the SHOOTER add before the kiting guarantee breaks? (roguelike R4a; test_kite.py's check, swept)

NOTE (balance pass): test_kite.py now judges a perfect orb-walker by the noise model (r_kite >= 0.78), and the sweep below still
uses the controls rework's OLD measure (the weakest melee tolerance over the orb-walk free fire, margin >= 1), which the compressed
sheet's thin edges no longer meet in many cells at no buff at all: use it for the shape of the curve, not as a gate.

    python3 testing/kite_buff_sweep.py [--jobs N]        (needs numpy, like realtime.py; about 30 s on 8 cores)

test_kite.py's 20 cells (faction edge x bow / wand: the weakest melee weapon's tolerance over the orb-walk free-fire time,
margin >= 1 holds) with every shooter buffed and the chaser not (the guarantee was designed without buffs). An attack-speed
multiplier works as in the TS sim: interval / asMult down to the weapon's floor (damage per hit takes over past it, so the
dps keeps rising), the windup's share follows the interval, its cap does not. A damage multiplier scales weapon and
signature damage alike (a `damage` buff row).

  1. The largest shooter attack-speed multiplier for which all 20 cells hold (0.0025 grid), and the margins of the four
     thinnest cells along the way.
  2. Plague Rat's attack-speed row: v (the value at 3 stacks) from 0.04 to 0.08, judged at 3 stacks (1x), after one camp
     (3 and 4 kills of the type: the stacks the reward curve gives, about 1.1x and 1.6x) and at the plateau
     (BUFF_PLATEAU, about 2.1x): asMult = 1 + v x level.
  3. The same check for damage rows on the shooter (Ember Imp's +10% at 3 stacks), for comparison.
"""
import argparse
import math
import os
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as W  # noqa: E402
import test_kite as K  # noqa: E402

# shared/constants.ts: the S-curve and the grants.
BUFF_S0, BUFF_W, BUFF_REF_STACKS = 3.0, 1.0, 3.0
MOB_BUFF_STACKS = 1.1
REWARD_FLOOR, REWARD_MID, REWARD_WIDTH = 0.3, 5.0, 1.5
FEED_MOB_KILL_WEIGHT = 0.25


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def buff_curve(n):
    return 0.0 if n <= 0 else sigmoid((n - BUFF_S0) / BUFF_W) - sigmoid(-BUFF_S0 / BUFF_W)


def buff_scale(n):
    return buff_curve(n) / buff_curve(BUFF_REF_STACKS)


PLATEAU = (1.0 - sigmoid(-BUFF_S0 / BUFF_W)) / buff_curve(BUFF_REF_STACKS)


def stacks_after(kills):
    """Stacks of one normal mob type after `kills` kills of it and nothing else (feed 0.25 per mob kill, no catch-up)."""
    s = 0.0
    for i in range(kills):
        feed = FEED_MOB_KILL_WEIGHT * i
        s += MOB_BUFF_STACKS * (REWARD_FLOOR + (1 - REWARD_FLOOR) * (1 - sigmoid((feed - REWARD_MID) / REWARD_WIDTH)))
    return s


def _init():
    K.load_k2()


def _tol(job):
    a, wa, b, wb, am, dm = job
    return job, W.kite_tolerance(a, wa, b, wb, as_mult=am, dmg=dm)


class Judge:
    """Margins of the 20 cells per (asMult, damage), the tolerances computed in parallel and cached."""

    def __init__(self, jobs):
        K.load_k2()
        self.pool = ProcessPoolExecutor(max_workers=jobs, initializer=_init)
        self.cache = {}

    def prime(self, buffs):
        todo = [(a, wa, b, wb, am, dm) for am, dm in buffs if (am, dm) not in self.cache
                for a, b in W.BEATS for wb in W.RANGED for wa in W.MELEE]
        tols = {}
        for job, tol in self.pool.map(_tol, todo, chunksize=4):
            tols[job] = tol
        for am, dm in {(j[4], j[5]) for j in todo}:
            cells = []
            for a, b in W.BEATS:
                for wb in W.RANGED:
                    tol = min(tols[(a, wa, b, wb, am, dm)] for wa in W.MELEE)
                    orb = W.orbwalk_free_fire(b, wb, a, as_mult=am)
                    cells.append((f"{a}>{b} {wb}", 0.0 if orb == math.inf else tol / orb))
            self.cache[(am, dm)] = cells

    def cells(self, am, dm=1.0):
        if (am, dm) not in self.cache:
            self.prime([(am, dm)])
        return self.cache[(am, dm)]


def fails(cells):
    return sum(1 for _, m in cells if m < 1.0)


def worst(cells):
    return min(cells, key=lambda c: c[1])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--jobs", type=int, default=min(8, os.cpu_count() or 1))
    args = ap.parse_args()
    J = Judge(args.jobs)

    base = J.cells(1.0)
    thin = [n for n, _ in sorted(base, key=lambda c: c[1])[:4]]
    print("Shooter buffs against the kiting guarantee (k = 2; margin = weakest melee tolerance / orb-walk free fire; >= 1 holds)")
    print(f"no buff: worst {worst(base)[0]} x{worst(base)[1]:.3f}; the four thinnest cells: " + ", ".join(thin))

    print("\n1. shooter attack speed: cells failing of 20, worst cell, and the four thinnest cells' margins")
    grid = [round(1.0 + 0.0025 * i, 4) for i in range(49)]  # 1.00 .. 1.12
    J.prime([(am, 1.0) for am in grid])
    print(f"   {'asMult':>7s} {'fail':>5s}  {'worst':24s}" + "".join(f"{n:>22s}" for n in thin))
    largest = None
    for am in grid:
        if fails(J.cells(am)) > 0:
            break
        largest = am
    for am in grid:
        cells = J.cells(am)
        by = dict(cells)
        w = worst(cells)
        if round(am * 10000) % 50 == 0 or am == largest:
            print(f"   {am:7.4f} {fails(cells):5d}  {w[0] + f' x{w[1]:.3f}':24s}" + "".join(f"{by[n]:22.3f}" for n in thin))
    print(f"   -> the largest shooter asMult (every smaller one holding too) for which all 20 cells hold: x{largest:.4f} (0.0025 grid)")

    levels = [("3 stacks", 1.0)]
    for kills in (3, 4):
        n = stacks_after(kills)
        levels.append((f"{kills} kills ({n:.2f} st)", buff_scale(n)))
    levels.append(("plateau", PLATEAU))
    print("\n2. Plague Rat attack speed v (at 3 stacks): asMult = 1 + v x level; fail = cells failing of 20, then the worst margin")
    print("   levels: " + ", ".join(f"{name} x{k:.3f}" for name, k in levels))
    vs = [0.04, 0.045, 0.05, 0.0533, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]
    J.prime([(round(1 + v * k, 6), 1.0) for v in vs for _, k in levels])
    print(f"   {'v':>6s}" + "".join(f"{name:>30s}" for name, _ in levels))
    for v in vs:
        row = f"   {v:6.4f}"
        for _, k in levels:
            am = round(1 + v * k, 6)
            cells = J.cells(am)
            w = worst(cells)
            row += f"{f'x{am:.3f} {fails(cells)} fail {w[1]:.3f}':>30s}"
        print(row)

    print("\n3. for comparison, a damage row on the shooter (weapon and signature damage): fail of 20, worst cell")
    dmgs = [1.02, 1.04, 1.06, 1.08, 1.1, 1.151, 1.21]
    J.prime([(1.0, d) for d in dmgs])
    for d in dmgs:
        cells = J.cells(1.0, d)
        w = worst(cells)
        print(f"   damage x{d:.3f}: {fails(cells):2d} fail, worst {w[0]} x{w[1]:.3f}")
    J.pool.shutdown()


if __name__ == "__main__":
    main()
