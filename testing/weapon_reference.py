"""Prints the realtime.py weapon numbers the TypeScript port is tested against (packages/shared/test/weapons.test.ts).

    python3 testing/weapon_reference.py      (needs numpy, like realtime.py)

Tables, in the order the test declares them:
  REFERENCE      [faction, weapon, interval s, per-hit raw at duel pace k = 1] (the five loop weapons and fists)
  BACKLASH       Fire's backlash per swing of an enemy holding each weapon (the same for every enemy faction)
  MODEL_WEAPONS  the model's damage multiplier per weapon, and the range of the two ranged ones (the kite check's free fire)
then the attack-speed-buffed Plague sword (where the floor binds).
Paste the output over the tables in packages/shared/test/weapons.test.ts (and REFERENCE and BACKLASH over the same two in
packages/server/src/harness/parity.ts) when the design numbers change.
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
backlash = {}
for w in rt.WNAMES:
    for p in rt.POWERS:
        v = fire.params["backlash"] * p.rate * rt.interval(p, w)
        assert abs(v - backlash.setdefault(w, v)) < 1e-9, "backlash per swing should not depend on the enemy faction"
print("const BACKLASH: Record<WeaponId, number> = {")
print("  " + ", ".join(f"{w}: {backlash[w]:.12f}" for w in ["sword", "axe", "bow", "wand", "shield", "fists"]) + ",")
print("};")
print("const MODEL_WEAPONS: Record<WeaponId, { dps: number; range: number | null }> = {")
for w in ["sword", "bow", "wand", "shield", "axe", "fists"]:
    spec = rt.WEAPONS[w]
    print(f"  {w}: {{ dps: {spec['dps']}, range: {spec['rng'] if not spec['melee'] else 'null'} }},")
print("};")
pl = rt.BY["Plague"]
print(f"// buffed Plague sword x1.3: interval {rt.interval(pl, 'sword', 1.3):.12f}, per hit {rt.per_hit(pl, 'sword', 1.3):.12f}")
