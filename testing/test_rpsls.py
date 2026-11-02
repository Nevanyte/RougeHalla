"""Run: python3 test_rpsls.py   (exits non-zero on any failure)

The faction design oracle after the faction rework (testing/TUNING_BALANCE.md section 13): the counter cycle is gone, and every
one of the ten faction pairs must end near an even fight in the weapon-less engine at the game's pace (k = 2), at every timestep
and at every power scale. The engine's purity contract stands (no names, no pair logic), and every identity mechanic must still
be load-bearing: taking it away moves its owner's margins by a clear amount.
"""
import ast, inspect, itertools, random, sys
from dataclasses import replace
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import engine
from engine import duel, scaled
from classes import POWERS, PAIRS
from matchup_band import paced

NAMES = [p.name for p in POWERS]
K = 2.0
MAX_MARGIN = 0.10      # the largest |signed hp left| any pair may end with (engine, k = 2)
MEAN_MARGIN = 0.06     # the mean over the ten pairs
ID_MIN_SHIFT = 15.0    # points (of hp left, -100..+100) a main identity mechanic must move at least one of its owner's pairs


def margins(specs, dt=0.005):
    by = {p.name: paced(p, K) for p in specs}
    out = {}
    for a, b in PAIRS:
        w, _, ha, hb = duel(by[a], by[b], dt)
        out[(a, b)] = ha / by[a].hp if w == 0 else (-hb / by[b].hp if w == 1 else 0.0)
    return out


results = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f"  {detail}" if detail else ""))
    results.append(ok)


# 1. every pair near even, at every timestep
for dt in (0.01, 0.005, 0.002):
    m = margins(POWERS, dt)
    worst = max(abs(v) for v in m.values())
    mean = sum(abs(v) for v in m.values()) / len(m)
    check(f"dt={dt}: largest |margin| {worst * 100:.1f}% <= {MAX_MARGIN * 100:.0f}%, mean {mean * 100:.1f}% <= {MEAN_MARGIN * 100:.0f}%",
          worst <= MAX_MARGIN and mean <= MEAN_MARGIN,
          " ".join(f"{a}-{b} {v * 100:+.1f}" for (a, b), v in m.items()))

# 2. nobody is favoured overall: the sum of a faction's four margins stays small
m = margins(POWERS)
for n in NAMES:
    tot = sum(v if a == n else -v for (a, b), v in m.items() if n in (a, b))
    check(f"{n}: sum of its four margins {tot * 100:+.1f} within +-20 points", abs(tot) <= 0.20)

# 3. power-level scaling: margins are invariant under a global stat multiplier
base = margins(POWERS)
for k in (0.25, 0.5, 2, 5):
    sk = margins([scaled(p, k) for p in POWERS])
    drift = max(abs(sk[e] - base[e]) for e in base)
    check(f"scale x{k}: margins move at most 2 points ({drift * 100:.2f})", drift <= 0.02)

# 4. relabeling: margins follow the stats, not the labels
random.seed(0)
perm = NAMES[:]
random.shuffle(perm)
relabeled = [replace(p, name=perm[i]) for i, p in enumerate(POWERS)]
by = {p.name: paced(p, K) for p in relabeled}
ok = True
for (a, b), v in base.items():
    ra, rb = perm[NAMES.index(a)], perm[NAMES.index(b)]
    w, _, ha, hb = duel(by[ra], by[rb], 0.005)
    rv = ha / by[ra].hp if w == 0 else (-hb / by[rb].hp if w == 1 else 0.0)
    ok = ok and abs(rv - v) < 1e-9
check("relabeled powers keep their margins (engine ignores names)", ok)

# 5. every mirror ends
for p in POWERS:
    q = paced(p, K)
    w, t, ha, hb = duel(q, q, 0.005, t_max=600.0)
    check(f"mirror {p.name} ends ({t:.1f} s)", w is not None or (ha <= 0 and hb <= 0))

# 6. purity audit of the engine source
src = inspect.getsource(engine)
tree = ast.parse(src)
bad = []


class V(ast.NodeVisitor):
    def visit_Constant(self, node):
        if isinstance(node.value, str) and node.value in {"Fire", "Sentenced", "Plague", "Frost", "Holy"}:
            bad.append(("power name literal", node.lineno))

    def visit_Compare(self, node):
        if ".name" in ast.unparse(node):
            bad.append(("comparison on .name", node.lineno))
        self.generic_visit(node)


V().visit(tree)
check(f"purity audit (no names, no pair logic): {bad or 'clean'}", not bad)
check("every mechanic takes only (own params, universal State)",
      all(list(inspect.signature(f).parameters) == ["p", "s"] for f in engine.BONUS.values()))


# 7. identities stay load-bearing: removing one moves its owner's margins by at least ID_MIN_SHIFT points somewhere
def with_params(p, **kw):
    return replace(p, params={**p.params, **kw})


IDENTITY = [
    ("Fire", "burn and backlash", lambda p: with_params(p, burn=0, backlash=0)),
    ("Sentenced", "the mark (a share of the target's max hp)", lambda p: with_params(p, mark_pct=0, mark_kill=0)),
    ("Plague", "disease and execute", lambda p: with_params(p, plague=0, execute=0)),
    ("Frost", "the slow", lambda p: with_params(p, slow=0)),
    ("Holy", "lifesteal", lambda p: with_params(p, ls0=0, ls1=0)),
]
for owner, what, make in IDENTITY:
    specs = [make(p) if p.name == owner else p for p in POWERS]
    var = margins(specs)
    shift = max(abs(var[e] - base[e]) for e in base if owner in e) * 100
    check(f"identity {owner}: removing {what} moves a margin {shift:.1f} pts (>= {ID_MIN_SHIFT:g})", shift >= ID_MIN_SHIFT)

print("\nALL PASS" if all(results) else "\nSOME FAILED")
sys.exit(0 if all(results) else 1)
