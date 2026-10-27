"""The kiting guarantee at duel pace k = 2 (GAME_DESIGN 9.4, "Tuning (9.1)", the controls rework and the balance pass): a perfect
orb-walking shooter must not turn a designed edge into a coin flip it wins.

    python3 testing/test_kite.py        (needs numpy, like realtime.py; about 10 s)

There are no ranged move slows: every attack roots its fighter for a windup and a fighter walks at full speed between attacks,
so a shooter can orb-walk away from its chaser, who only closes the gap while the shooter is rooted. For each faction edge and
each ranged weapon (bow, wand) the loser fires at full output, bonus clock running, while the winner closes in with a sword, an
axe or a shield; the WEAKEST melee weapon is judged.

The balance pass compressed the sheet so that a favourite wins a fair fight with 10-35% hp left, 60-70% of the time once play
noise is in. The old guarantee ("the melee winner's tolerance, how late it may arrive, is at least the orb-walk free fire")
cannot survive margins that thin: with the loser's damage ratio r near 1.3, an approach of 1.1-1.5 s is a fifth of the whole
fight, so the tolerance is 0 in 9 of the 20 cells. The new assertion keeps the lever (the windup caps) and asks the question
the noise model answers:

    a perfect orb-walking underdog wins at most 65% of its duels under the noise model (sigma 0.45, the model of the matchup
    benches: each fighter's damage times exp(0.45 Z)), i.e.   r_kite = r x (1 - freeFire / T) >= 0.78

where r is the flip multiplier (the smallest multiplier on the shooter's damage with which it wins at least half the standing
duels), freeFire the seconds a perfect orb-walker fires before the chaser arrives (realtime.orbwalk_free_fire: a kinematic model
of the shooter's windups and walking, Frost's move chill included) and T the shooter's time to kill the chaser alone in the same
model: the free fire is paid out of the shooter's own T seconds of work. The underdog's win share is 1 - Phi(ln r_kite / 0.636),
which is 35% at r_kite 1 / 0.78 for 65%. Prints one PASS or FAIL line per cell with r, T, the free fire, r_kite and the share,
plus the old tolerance / free-fire margin for information, and exits non-zero on a FAIL. Late fights (the m5 kit's f(P) 2.2, a
5 s fight) make the free fire count for more, so ranged weapons gain late; the windup caps (BOW_WINDUP, WAND_WINDUP in
shared/weapons.ts, the `windup` / `wshare` columns of realtime.py) are the lever, and kite_windup_sweep.py finds the values that
hold the OLD tolerance guarantee (kept as a stricter stress measure). The k = 2 what-if is the faction numbers doubled the way the
game does (realtime_paced.paced): every damage number x2, the mark ramp x4, hp unchanged. packages/server's kiting section of the
harness measures the real sim against the standing bound.

One cell is a NAMED EXCEPTION (KNOWN_EXCEPTIONS below): Holy > Fire against Fire's WAND, whose weakest chaser is Holy's shield, measures
r_kite 0.64 (the wand kiter would win 76% of its duels) against the 0.78 the other 19 cells hold. The orchestrator decided to keep
WAND_WINDUP (0.4 s) and not tune the Holy > Fire edge for a short fight (about 5 s) where a shield chaser meets a perfect
orb-walking wand: it is a best guess for the owner to overrule, listed here and printed on every run (as "EXCEPT") so it cannot be
forgotten, and it only excuses a cell no worse than its recorded floor, so a regression of that cell (or a new failing cell) still fails.

    python3 testing/test_kite.py --shooter-as 1.08 [--shooter-dmg 1.1]

judges the same 20 cells with every shooter buffed (the chaser never is): --shooter-as is an attack-speed multiplier (the
interval / asMult down to the weapon's floor, damage per hit taking over past it; the windup's share follows the interval,
its cap does not), --shooter-dmg an outgoing damage multiplier on weapon and signature damage alike (a `damage` buff row).
The guarantee was designed without buffs; kite_buff_sweep.py sweeps the buff values.

    python3 testing/test_kite.py --shooter-windup 0.88 [--shooter-as 1.5]

gives every shooter a windup mod the way shared/mods.ts scaleWindup applies it (Quickdraw, owner ruling "Melee windups only"): a
mult below 1 shortens melee windups only, so a ranged windup is left exactly as it is and the output equals the default's. The
flag stays as the check that nothing shortens the lever. The model's figures read no melee windup (the chaser's duel is in
continuous time and starts when it arrives), so a chaser carrying Quickdraw cannot move a cell here: the real sim's KITE EDGES
(`npm run harness -w @raid/server -- --kiting-only --chaser-cards quickdraw`) is the measure of that side.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as W  # noqa: E402
from realtime_paced import paced  # noqa: E402

#: sigma of the play-noise model (matches packages/server/bench/lib/balance.ts SIGMA)
SIGMA = 0.45
#: the underdog may win at most this share of its duels under the noise model...
MAX_UNDERDOG_SHARE = 0.65
#: ...which is r_kite >= exp(sigma sqrt(2) Phi^-1(0.35)) = 0.78
MIN_R_KITE = 0.78

#: Named exceptions to MIN_R_KITE, judged only for the default (unbuffed) run: (winner, loser, shooter's weapon) -> what was measured
#: and why it is accepted. A listed cell passes ("EXCEPT") while its r_kite stays at or above `floor`; below it, it fails like any other.
#: A listed cell that reaches MIN_R_KITE prints that the exception is no longer needed. Owner question (best guess, balance pass):
#: keep WAND_WINDUP at 0.4 s rather than lengthen it, because a longer wand windup costs the wand its other edges (CLAUDE.md, Weapons
#: and factions: 0.6 s / 0.8 and 1.0 s / 0.95 broke Axe > Wand and the Frost wand).
KNOWN_EXCEPTIONS = {
    ("Holy", "Fire", "wand"): {
        "measured": "r 1.06 (weakest chaser: Holy's shield), T 5.62 s, free fire 2.19 s -> r_kite 0.64, the wand kiter wins 76%",
        "floor": 0.62,
        "why": "the weakest chaser is Holy's shield (flip r 1.06, among the thinnest of the 20 edges) in a short fight (T 5.62 s), so the 2.2 s "
               "of free fire a perfect orb-walking wand gets (0.4 s windup, then a walk) is 39% of the whole fight; the bow on the "
               "same edge holds (r_kite 0.80)",
    },
}


def phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def underdog_share(r_kite):
    """The shooter's win share under the noise model: 1 - Phi(ln r_kite / (sigma sqrt 2)); 1 when it cannot lose (r_kite <= 0)."""
    if not (r_kite > 0):
        return 1.0
    return 1.0 - phi(math.log(r_kite) / (SIGMA * math.sqrt(2.0)))


def load_k2():
    """Load the k = 2 what-if (the faction numbers as the game fights them) into realtime.py (BY, POWERS)."""
    W.POWERS[:] = [paced(p, 2.0) for p in W.POWERS]
    W.BY.clear()
    W.BY.update({p.name: p for p in W.POWERS})


def main(argv=None):
    ap = argparse.ArgumentParser(description="The kiting guarantee at duel pace k = 2.")
    ap.add_argument("--shooter-as", type=float, default=1.0, help="every shooter's attack-speed multiplier (default 1: no buff)")
    ap.add_argument("--shooter-dmg", type=float, default=1.0, help="every shooter's outgoing damage multiplier (default 1)")
    ap.add_argument("--shooter-windup", type=float, default=1.0, help="every shooter's windup multiplier; below 1 it leaves ranged windups alone (default 1: none)")
    args = ap.parse_args(argv)
    failed = 0

    def check(ok, text):
        nonlocal failed
        print(("PASS " if ok else "FAIL ") + text, flush=True)
        failed += 0 if ok else 1

    load_k2()
    # The what-if really is the paced game: the sheet's Fire hits for 100 x 2, Sentenced's mark ramps at 17.5 x 4, hp is the sheet's.
    check(W.BY["Fire"].hit == 200 and W.BY["Sentenced"].params["mark_ramp"] == 70 and W.BY["Fire"].hp == 835, "k = 2 numbers loaded")
    check(abs(underdog_share(MIN_R_KITE) - MAX_UNDERDOG_SHARE) < 0.005, f"r_kite {MIN_R_KITE} is a {MAX_UNDERDOG_SHARE:.0%} underdog under sigma {SIGMA}")

    buffed = args.shooter_as != 1.0 or args.shooter_dmg != 1.0
    if buffed or args.shooter_windup != 1.0:
        print(f"shooter buffed: attack speed x{args.shooter_as:g}, damage x{args.shooter_dmg:g}"
              + (f", windup x{args.shooter_windup:g} (ranged windups: {'never shortened' if args.shooter_windup < 1.0 else 'scaled'})"
                 if args.shooter_windup != 1.0 else "") + " (the chaser is not)")
    worst = (float("inf"), "")
    worst_strict = (float("inf"), "")  # the tightest cell that is not a named exception
    excepted = []
    tols = W.kite_tolerances(args.shooter_as, args.shooter_dmg) if buffed else None
    old_rows = {(a, b): cells for a, b, cells in W.kite_rows(tols, args.shooter_as, args.shooter_windup)}
    for a, b in W.BEATS:
        for wb in W.RANGED:
            figures = {wa: W.kite_ratio(a, wa, b, wb, args.shooter_as, args.shooter_dmg, args.shooter_windup) for wa in W.MELEE}
            weakest = min(figures, key=lambda wa: figures[wa]["r_kite"])
            f = figures[weakest]
            share = underdog_share(f["r_kite"])
            if f["r_kite"] < worst[0]:
                worst = (f["r_kite"], f"{a}>{b} vs {wb}")
            tol, tff, tff_orb = old_rows[(a, b)][wb]
            old = f"old margin x{tol[weakest] / tff_orb:.2f}" if tff_orb not in (0.0, math.inf) else "old margin inf" if tff_orb == math.inf else "old margin n/a"
            line = (f"{a}>{b} vs {wb}: weakest melee ({weakest}) r {f['r']:.2f}, T {f['T']:.2f} s, free fire {f['F']:.2f} s "
                    f"-> r_kite {f['r_kite']:.2f} (the shooter wins {share:.0%}; needs <= {MAX_UNDERDOG_SHARE:.0%}); {old}")
            known = None if buffed else KNOWN_EXCEPTIONS.get((a, b, wb))
            if known is not None and f["r_kite"] < MIN_R_KITE:
                ok = f["r_kite"] >= known["floor"]
                check(ok, f"{'EXCEPT ' if ok else ''}{line}\n       named exception, measured {known['measured']}; floor {known['floor']}: {known['why']}")
                excepted.append(f"{a}>{b} vs {wb} (r_kite {f['r_kite']:.2f})")
                continue
            check(f["r_kite"] >= MIN_R_KITE, line + ("  (the named exception is no longer needed)" if known is not None else ""))
            if f["r_kite"] < worst_strict[0]:
                worst_strict = (f["r_kite"], f"{a}>{b} vs {wb}")

    print(f"tightest cell: {worst[1]}, r_kite {worst[0]:.2f} (needs >= {MIN_R_KITE})")
    if excepted:
        print(f"tightest cell outside the named exceptions: {worst_strict[1]}, r_kite {worst_strict[0]:.2f}; "
              f"named exceptions ({len(excepted)}): " + "; ".join(excepted))
    print("ALL PASS" if failed == 0 else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
