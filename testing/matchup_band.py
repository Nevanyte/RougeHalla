"""How close are the ten designed edges? (the balance pass, BALANCE_CONTRACT 1.2 A6 and 5.2)

    python3 testing/matchup_band.py [--k 2] [--dt 0.002] [--reference]        (standard library only, about 3 s)

The deterministic engine (engine.duel: every faction on its weapon-less law, no geometry, no play noise) for the ten BEATS edges
and the five mirrors, from the sheet in classes.py. For each edge it prints the favourite's hp left h, the fight's length, and the
loser's time-to-kill ratio r = 1 / (1 - h) (constant rates: the multiplier on the loser's damage that would flip the duel), then
whether h sits in the owner's band: 10-35% hp left is a fight the favourite wins 60-70% of the time once play noise is in
(sigma 0.45: P(favourite) = Phi(ln r / 0.636)). h is invariant under the pace k (a global scale of every damage number); the
fight length is 1/k of the k = 1 sheet. Mirrors print the fight length only: they must end, and not in more than a few times the
edges' median.

--reference prints the REFERENCE rows of packages/shared/test/factions.test.ts (dt 0.002 results of all 20 ordered pairs), the
table to paste there when the sheet changes. A report: it prints "edge of band" within 2 points of 10-35% (the real sim runs a point
or two lower than the engine: Frost > Fire is 35.7% here, 34% there) and "OUTSIDE" beyond, and exits non-zero only when a designed
edge flips or a mirror does not finish.
"""
import argparse
import math
import os
import sys
from dataclasses import replace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import duel, scaled  # noqa: E402
from classes import POWERS, BEATS  # noqa: E402

BY = {p.name: p for p in POWERS}
IDS = {"Fire": "fire", "Sentenced": "sentenced", "Plague": "plague", "Frost": "frost", "Holy": "holy"}
BAND = (0.10, 0.35)
SIGMA = 0.45


def phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def paced(p, k):
    """The faction as the game fights it at duel pace k: damage numbers x k, the mark ramp x k^2, hp unchanged."""
    damage = ("burn", "backlash", "plague", "execute", "mark_pct", "mark_kill")
    params = {key: (v * k if key in damage else v / k if key == "tier_hits" else v) for key, v in p.params.items()}
    return replace(p, hit=p.hit * k, params=params)


def main(argv=None):
    ap = argparse.ArgumentParser(description="The ten edges' hp left in the engine.")
    ap.add_argument("--k", type=float, default=2.0, help="duel pace (default 2, the game's)")
    ap.add_argument("--dt", type=float, default=0.002)
    ap.add_argument("--reference", action="store_true", help="print the factions.test.ts REFERENCE rows instead")
    args = ap.parse_args(argv)
    if args.reference:
        print("const REFERENCE: Array<[FactionId, FactionId, 0 | 1 | null, number, number, number]> = [")
        for a in POWERS:
            for b in POWERS:
                if a is not b:
                    w, t, ha, hb = duel(a, b, 0.002)
                    print(f'  ["{IDS[a.name]}", "{IDS[b.name]}", {"null" if w is None else w}, {round(t, 3)}, {round(ha, 3)}, {round(hb, 3)}],')
        print("];")
        return 0

    by = {p.name: paced(p, args.k) for p in POWERS}
    print(f"engine duels, pace k = {args.k:g}, dt {args.dt}: favourite hp left, loser's TTK ratio r, P(favourite) under sigma {SIGMA}")
    print(f"{'edge':22s} {'h':>6s} {'r':>6s} {'P(fav)':>7s} {'fight s':>8s}  band 10-35%")
    bad = 0
    hs = []
    for w, l in BEATS:
        win, t, ha, hb = duel(by[w], by[l], args.dt)
        h = ha / by[w].hp if win == 0 else 0.0
        r = 1.0 / (1.0 - h) if h < 1.0 else math.inf
        p_fav = phi(math.log(r) / (SIGMA * math.sqrt(2.0))) if win == 0 else 0.0
        inside = BAND[0] <= h <= BAND[1]
        near = BAND[0] - 0.02 <= h <= BAND[1] + 0.02
        bad += 0 if win == 0 else 1
        hs.append(h)
        verdict = "flipped" if win != 0 else "ok" if inside else "edge of band" if near else "OUTSIDE"
        print(f"{w + ' > ' + l:22s} {h * 100:5.1f}% {r:6.2f} {p_fav * 100:6.0f}% {t:8.1f}  {verdict}")
    hs.sort()
    print(f"median h {hs[len(hs) // 2] * 100:.1f}%  (min {hs[0] * 100:.1f}%, max {hs[-1] * 100:.1f}%)")
    print("mirrors (fight seconds; the engine's identical fighters die together):")
    for p in POWERS:
        win, t, ha, hb = duel(by[p.name], by[p.name], args.dt, t_max=600.0)
        done = win is not None or (ha <= 0 and hb <= 0)
        bad += 0 if done else 1
        print(f"  {p.name:10s} {t:7.1f} s  {'ends' if done else 'DOES NOT END'}")
    print("EVERY EDGE HOLDS, EVERY MIRROR ENDS" if bad == 0 else f"{bad} PROBLEMS")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
