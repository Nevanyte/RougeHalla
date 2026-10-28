"""Run: python3 test_rpsls.py   (exits non-zero on any failure)"""
import ast, random, sys, inspect, itertools, json
from dataclasses import replace
sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
import engine
from engine import duel, scaled
from classes import POWERS, BEATS

NAMES = [p.name for p in POWERS]
BY = {p.name: p for p in POWERS}
WANT = set(BEATS)


def edges(specs, dt=0.005):
    got, bad = set(), []
    for a, b in itertools.permutations(specs, 2):
        w, *_ = duel(a, b, dt)
        if w == 0:
            got.add((a.name, b.name))
    return got


def check(label, got, want=WANT):
    ok = got == want
    print(("PASS " if ok else "FAIL ") + label + ("" if ok else f"  extra={got-want} missing={want-got}"))
    return ok


results = []

# 1. exact required graph, every timestep
for dt in (0.01, 0.005, 0.002, 0.001):
    results.append(check(f"10/10 graph at dt={dt}", edges(POWERS, dt)))

# 2. each power beats exactly two, loses to exactly two
g = edges(POWERS)
wins = {n: sum(1 for w, _ in g if w == n) for n in NAMES}
ok = all(v == 2 for v in wins.values())
print(("PASS " if ok else "FAIL ") + f"every power beats exactly two: {wins}")
results.append(ok)

# 3. power-level scaling: outcomes invariant under a global stat multiplier
for k in (0.25, 0.5, 2, 5, 20):
    results.append(check(f"scale x{k}", edges([scaled(p, k) for p in POWERS])))

# 4. relabeling / order invariance: shuffle names; winners must follow the stats, not the labels
random.seed(0)
perm = NAMES[:]
random.shuffle(perm)
relabeled = [replace(p, name=perm[i]) for i, p in enumerate(POWERS)]
mapped = {(perm[NAMES.index(a)], perm[NAMES.index(b)]) for a, b in WANT}
results.append(check("relabeled powers keep their edges (engine ignores names)", edges(relabeled), mapped))

# 5. robustness: random jitter on every numeric field. The balance pass compressed the sheet (every edge leaves the
#    favourite 10-35% hp, the loser's time-to-kill ratio r is 1.12-1.7), so an edge now sits inside a +-10% jitter by
#    definition: the graph must survive +-3% every time and +-5% in at least 28 of 30 draws; +-10% is reported only.
def jitter(p, eps, rng):
    j = lambda x: x * (1 + rng.uniform(-eps, eps))
    return replace(p, hp=j(p.hp), rate=j(p.rate), hit=j(p.hit), armor=j(p.armor), shield=j(p.shield),
                   params={k: j(v) for k, v in p.params.items()})

for eps, N, floor in ((0.03, 30, 1.0), (0.05, 30, 28 / 30), (0.10, 30, None)):
    rng = random.Random(11)
    perfect = sum(edges([jitter(p, eps, rng) for p in POWERS], 0.01) == WANT for _ in range(N))
    if floor is None:
        print(f"INFO robustness +-{int(eps*100)}%: {perfect}/{N} perfect (reported only: edges are compressed on purpose)")
        continue
    ok = perfect / N >= floor - 1e-9
    print(("PASS " if ok else "FAIL ") + f"robustness +-{int(eps*100)}%: {perfect}/{N} perfect (need {int(round(floor * N))})")
    results.append(ok)

# 6. purity audit of the engine source
src = inspect.getsource(engine)
tree = ast.parse(src)
bad = []
class V(ast.NodeVisitor):
    def visit_Constant(self, node):
        if isinstance(node.value, str) and node.value in {"Fire", "Sentenced", "Plague", "Frost", "Holy"}:
            bad.append(("power name literal", node.lineno))
    def visit_Compare(self, node):
        txt = ast.unparse(node)
        if ".name" in txt:
            bad.append(("comparison on .name", node.lineno))
        self.generic_visit(node)
V().visit(tree)
ok = not bad
print(("PASS " if ok else "FAIL ") + f"purity audit (no names, no pair logic): {bad or 'clean'}")
results.append(ok)

# mechanics must only receive the universal State (no opponent spec/name)
sig_ok = all(list(inspect.signature(f).parameters) == ["p", "s"] for f in engine.BONUS.values())
print(("PASS " if sig_ok else "FAIL ") + "every mechanic takes only (own params, universal State)")
results.append(sig_ok)

# 7. identity tests (CLASS_SHEET.md section 4; the recorded values are the balance pass's compressed sheet): take a signature away and the owner's matchups must
#    visibly change. Margin of an edge = required winner's remaining HP fraction minus the required
#    loser's, in points (-100..+100); a swing above 100 means the result reversed. A variant's shift
#    on an edge is (baseline margin) - (variant margin), so a positive shift means the required
#    winner did worse. A flip = a required edge whose required winner no longer wins.
ID_DT = 0.005            # same step as edges(); the sheet's numbers agree within 0.5 pt from dt 0.01 to 0.001
ID_TOL = 2.0             # points; the sheet rounds to whole points
MAIN_MIN_SHIFT = 20.0    # a main signature must flip >= 1 edge AND move a margin by >= this
SUB_MIN_SHIFT = 15.0     # a sub-mechanic must flip an edge OR move a margin by >= this


def margin_pts(specs, winner, loser, dt=ID_DT):
    a, b = specs[winner], specs[loser]
    w, _, ha, hb = duel(a, b, dt)
    return 100.0 * (ha / a.hp - hb / b.hp), w == 0


def with_params(p, **kw):
    return replace(p, params={**p.params, **kw})


def edge_names(es):
    return ", ".join(f"{w}>{l}" for w, l in sorted(es)) or "none"


# (owner, what is removed, is_sub, variant of the owner, flipped edges per the sheet, largest shift per the sheet).
# The Sentenced redesign (docs/SENTENCED_REDESIGN.md) re-recorded the Sentenced rows and moved the others: the mark is a share of
# the target's max hp per hit, climbing four tiers, so removing it flips Sentenced>Plague and Sentenced>Frost, never climbing a tier
# loses the tax, the suppression, the amplifier and the denial together (the same two flips), and the suppression alone is as
# load-bearing. Removing Holy's lifesteal flips Holy>Fire and now Holy>Sentenced as well.
IDENTITY = [
    ("Fire", "remove burn and backlash", False, lambda p: with_params(p, burn=0, backlash=0),
     {("Fire", "Sentenced"), ("Fire", "Plague")}, 101.4),
    ("Fire", "remove backlash only", True, lambda p: with_params(p, backlash=0),
     {("Fire", "Sentenced"), ("Fire", "Plague")}, 91.3),
    ("Sentenced", "remove the mark", False, lambda p: with_params(p, mark_pct=0, mark_kill=0),
     {("Sentenced", "Plague"), ("Sentenced", "Frost")}, 102.6),
    ("Sentenced", "the mark never climbs a tier (no tax, suppression, amplifier or denial)", True, lambda p: with_params(p, tier_hits=1e9),
     {("Sentenced", "Plague"), ("Sentenced", "Frost")}, 56.6),
    ("Sentenced", "remove the output suppression only", True, lambda p: with_params(p, suppress=1.0),
     {("Sentenced", "Plague"), ("Sentenced", "Frost")}, 30.0),
    ("Sentenced", "remove the attack-speed tax only", True, lambda p: with_params(p, tax_keep=1.0, tax_cap=1e9),
     set(), 19.0),
    ("Plague", "remove the execute", False, lambda p: with_params(p, execute=0),
     {("Plague", "Frost"), ("Plague", "Holy")}, 31),
    ("Plague", "remove the flat disease", True, lambda p: with_params(p, plague=0),
     {("Plague", "Frost"), ("Plague", "Holy")}, 78),
    ("Frost", "remove the slow", False, lambda p: with_params(p, slow=0),
     {("Frost", "Holy")}, 68),
    ("Holy", "remove lifesteal", False, lambda p: with_params(p, ls0=0, ls1=0),
     {("Holy", "Fire"), ("Holy", "Sentenced")}, 34.0),
    ("Holy", "flat lifesteal, no missing-health scaling", True, lambda p: with_params(p, ls1=0),
     {("Holy", "Sentenced")}, 28.0),
]

base_margin = {e: margin_pts(BY, *e)[0] for e in BEATS}
for owner, what, is_sub, make, sheet_flips, sheet_shift in IDENTITY:
    specs = dict(BY)
    specs[owner] = make(BY[owner])
    flipped, shift = set(), 0.0
    for e in (e for e in BEATS if owner in e):          # only edges involving the owner can move
        m, won = margin_pts(specs, *e)
        if not won:
            flipped.add(e)
        shift = max(shift, abs(base_margin[e] - m))
    why = []
    if flipped != sheet_flips:
        why.append(f"flips differ from sheet ({edge_names(sheet_flips)})")
    if abs(shift - sheet_shift) > ID_TOL:
        why.append(f"shift {shift:.1f} not within {ID_TOL:g} of sheet's {sheet_shift}")
    if is_sub:
        if not (flipped or shift >= SUB_MIN_SHIFT):
            why.append(f"sub-mechanic needs a flip or a >= {SUB_MIN_SHIFT:g} pt shift")
    elif not (flipped and shift >= MAIN_MIN_SHIFT):
        why.append(f"main signature needs a flip and a >= {MAIN_MIN_SHIFT:g} pt shift")
    ok = not why
    print(("PASS " if ok else "FAIL ")
          + f"identity {owner}: {what} ({'sub' if is_sub else 'main'}): flips {edge_names(flipped)}; "
          + f"largest shift {shift:.1f} pts (sheet {sheet_shift})" + ("" if ok else "  " + "; ".join(why)))
    results.append(ok)

print("\nALL PASS" if all(results) else "\nSOME FAILED")
sys.exit(0 if all(results) else 1)
