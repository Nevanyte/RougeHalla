"""Prints the realtime.py weapon numbers the TypeScript port is tested against (packages/shared/test/weapons.test.ts).

    python3 testing/weapon_reference.py      (needs numpy, like realtime.py)

Rows: [faction, weapon, interval s, per-hit raw at duel pace k = 1], then Fire's backlash per swing for each enemy
faction and weapon, then the attack-speed-buffed Plague sword (where the floor binds).
Paste the output over REFERENCE and BACKLASH in the test when the design numbers change.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import realtime as rt  # noqa: E402

IDS = {"Fire": "fire", "Sentenced": "sentenced", "Plague": "plague", "Frost": "frost", "Holy": "holy"}

print("const REFERENCE: Array<[FactionId, WeaponId, number, number]> = [")
for p in rt.POWERS:
    for w in rt.WNAMES:
        print(f'  ["{IDS[p.name]}", "{w}", {rt.interval(p, w):.12f}, {rt.per_hit(p, w):.12f}],')
print("];")
fire = rt.BY["Fire"]
print("const BACKLASH: Array<[FactionId, WeaponId, number]> = [")
for p in rt.POWERS:
    for w in rt.WNAMES:
        print(f'  ["{IDS[p.name]}", "{w}", {fire.params["backlash"] * p.rate * rt.interval(p, w):.12f}],')
print("];")
pl = rt.BY["Plague"]
print(f"// buffed Plague sword x1.3: interval {rt.interval(pl, 'sword', 1.3):.12f}, per hit {rt.per_hit(pl, 'sword', 1.3):.12f}")
