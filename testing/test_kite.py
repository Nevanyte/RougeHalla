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
"""
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


def main():
    failed = 0

    def check(ok, text):
        nonlocal failed
        print(("PASS " if ok else "FAIL ") + text, flush=True)
        failed += 0 if ok else 1

    load_k2()
    # The what-if really is the paced game: Fire hits for 300, Sentenced's mark ramps at 140/s^2 (x4), hp is the sheet's.
    check(W.BY["Fire"].hit == 300 and W.BY["Sentenced"].params["mark_ramp"] == 140 and W.BY["Fire"].hp == 500, "k = 2 numbers loaded")

    worst = (float("inf"), "")
    for a, b, cells in W.kite_rows():
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
