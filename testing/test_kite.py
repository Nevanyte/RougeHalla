"""The kiting guarantee at duel pace k = 2 (GAME_DESIGN 9.4, "Tuning (9.1)"): a melee faction winner survives one approach.

    python3 testing/test_kite.py        (needs numpy, like realtime.py; about 5 s)

For each faction edge and each ranged weapon (bow, wand) the loser stands and fires at full output, bonus clock running,
while the winner closes in with a sword, an axe or a shield. The weakest melee weapon must still win at least half of the
duels when it arrives after the free-fire time of a standing shooter, (range - reach) / move speed. Prints one PASS or
FAIL line per cell and exits non-zero on a FAIL. The k = 2 what-if is the faction numbers doubled the way the game does
(pacedFaction): every damage number x2, the mark ramp x4, hp unchanged. packages/server's kiting section of the harness
measures the real sim against the same standing bound.
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

failed = 0


def check(ok, text):
    global failed
    print(("PASS " if ok else "FAIL ") + text, flush=True)
    failed += 0 if ok else 1


with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "k2.json")
    with open(path, "w") as f:
        json.dump(K2, f)
    W.load(path)

# The what-if really is the paced game: Fire hits for 300, Sentenced's mark ramps at 140/s^2 (x4), hp is the sheet's.
check(W.BY["Fire"].hit == 300 and W.BY["Sentenced"].params["mark_ramp"] == 140 and W.BY["Fire"].hp == 500, "k = 2 numbers loaded")

for a, b, cells in W.kite_rows():
    for wb, (tol, tff) in cells.items():
        weakest = min(tol, key=tol.get)
        check(tol[weakest] >= tff, f"{a}>{b} vs {wb}: weakest melee ({weakest}) tolerance {tol[weakest]:.2f} s >= free fire {tff:.2f} s")

print("ALL PASS" if failed == 0 else f"{failed} FAILED")
sys.exit(1 if failed else 0)
