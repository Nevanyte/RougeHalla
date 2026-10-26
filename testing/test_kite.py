"""The kiting guarantee at duel pace k = 2 (GAME_DESIGN 9.4, "Tuning (9.1)", and the controls rework): a melee faction winner
survives one approach.

    python3 testing/test_kite.py        (needs numpy, like realtime.py; about 5 s)

There are no ranged move slows any more: every attack roots its fighter for a windup and a fighter walks at full speed
between attacks, so a shooter can orb-walk away from its chaser, who only closes the gap while the shooter is rooted.
For each faction edge and each ranged weapon (bow, wand) the loser fires at full output, bonus clock running, while the
winner closes in with a sword, an axe or a shield. The weakest melee weapon must still win at least half of the duels when
it arrives after the ORB-WALK free-fire time (realtime.orbwalk_free_fire: a kinematic model of the shooter's windups and
walking, Frost's move chill included), which is the standing shooter's (range - reach) / move speed times about
interval / windup. Prints one PASS or FAIL line per cell, with the standing time (the lower bound; for a Frost shooter it
is the old conservative figure, which the orb-walk time can undercut) and the margin tolerance / orb-walk time, and exits
non-zero on a FAIL. A tolerance does not depend on the windups: change the bow's and wand's `windup` / `wshare` columns in
realtime.py (and BOW_WINDUP etc. in shared/weapons.ts) and the cells move; kite_windup_sweep.py finds the values that
hold. The k = 2 what-if is the faction numbers doubled the way the game does (pacedFaction): every damage number x2, the
mark ramp x4, hp unchanged. packages/server's kiting section of the harness measures the real sim against the standing
bound.

    python3 testing/test_kite.py --shooter-as 1.08 [--shooter-dmg 1.1]

judges the same 20 cells with every shooter buffed (the chaser never is): --shooter-as is an attack-speed multiplier (the
interval / asMult down to the weapon's floor, damage per hit taking over past it; the windup's share follows the interval,
its cap does not), --shooter-dmg an outgoing damage multiplier on weapon and signature damage alike (a `damage` buff row).
The guarantee was designed without buffs; kite_buff_sweep.py sweeps the buff values.
"""
import argparse
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as W  # noqa: E402

K2 = {
    "name": "k=2",
    "factions": {
        "Fire": {"hit": 300, "params": {"burn": 20, "backlash": 400}},
        "Sentenced": {"hit": 10, "params": {"mark_ramp": 140, "mark_cap": 550}},
        "Plague": {"hit": 40, "params": {"plague": 80, "execute": 4100}},
        "Frost": {"hit": 180},
        "Holy": {"hit": 130},
    },
}


def load_k2():
    """Load the k = 2 what-if into realtime.py (BY, POWERS)."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "k2.json")
        with open(path, "w") as f:
            json.dump(K2, f)
        W.load(path)


def main(argv=None):
    ap = argparse.ArgumentParser(description="The kiting guarantee at duel pace k = 2.")
    ap.add_argument("--shooter-as", type=float, default=1.0, help="every shooter's attack-speed multiplier (default 1: no buff)")
    ap.add_argument("--shooter-dmg", type=float, default=1.0, help="every shooter's outgoing damage multiplier (default 1)")
    args = ap.parse_args(argv)
    failed = 0

    def check(ok, text):
        nonlocal failed
        print(("PASS " if ok else "FAIL ") + text, flush=True)
        failed += 0 if ok else 1

    load_k2()
    # The what-if really is the paced game: Fire hits for 300, Sentenced's mark ramps at 140/s^2 (x4), hp is the sheet's.
    check(W.BY["Fire"].hit == 300 and W.BY["Sentenced"].params["mark_ramp"] == 140 and W.BY["Fire"].hp == 500, "k = 2 numbers loaded")

    buffed = args.shooter_as != 1.0 or args.shooter_dmg != 1.0
    if buffed:
        print(f"shooter buffed: attack speed x{args.shooter_as:g}, damage x{args.shooter_dmg:g} (the chaser is not)")
    worst = (float("inf"), "")
    tols = W.kite_tolerances(args.shooter_as, args.shooter_dmg) if buffed else None
    for a, b, cells in W.kite_rows(tols, args.shooter_as):
        for wb, (tol, tff, tff_orb) in cells.items():
            weakest = min(tol, key=tol.get)
            margin = tol[weakest] / tff_orb
            if margin < worst[0]:
                worst = (margin, f"{a}>{b} vs {wb}")
            check(tol[weakest] >= tff_orb,
                  f"{a}>{b} vs {wb}: weakest melee ({weakest}) tolerance {tol[weakest]:.2f} s >= orb-walk free fire {tff_orb:.2f} s "
                  f"(standing {tff:.2f} s, margin x{margin:.3f})")

    print(f"tightest cell: {worst[1]}, margin x{worst[0]:.3f}")
    print("ALL PASS" if failed == 0 else f"{failed} FAILED")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
