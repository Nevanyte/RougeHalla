import sys, random, time
sys.path.insert(0, "/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RougeHalla/2fecac89-094f-4d8a-a460-aef8d4be96c5/scratchpad")
from cand import *
BY = {p.name: p for p in POWERS}
EDG = [("Fire","Sentenced"),("Sentenced","Plague"),("Sentenced","Frost"),("Holy","Sentenced")]
def hs(S, dt=0.01):
    out = []
    for fav, und in EDG:
        a = S if fav == "Sentenced" else BY[fav]
        b = S if und == "Sentenced" else BY[und]
        w, t, ha, hb = duel(a, b, dt)
        out.append(ha/a.hp if w == 0 else -hb/b.hp)
    return out
def build(x):
    pct, hit, phys, hp, arm, sh, sup = x
    p = dict(SENTENCED.params); p.update(mark_pct=pct, mark_kill=pct/4, suppress=sup)
    return replace(SENTENCED, hp=hp, hit=hit, phys=phys, armor=arm, shield=sh, params=p)
LO = (0.015, 20, 0.5, 800, 100, 150, 0.7)
HI = (0.045, 50, 1.0, 1100, 180, 300, 0.9)
def obj(x):
    h = hs(build(x))
    if min(h) < 0.0: return -1 + min(h)
    return min(min(h), 0.30 - 0.0) - 0.5*sum(max(0, v - 0.30) for v in h) - 0.1*sum(abs(v-0.22) for v in h)
random.seed(5)
best = None
t0 = time.time()
for i in range(6000):
    x = tuple(random.uniform(l, h) for l, h in zip(LO, HI))
    o = obj(x)
    if best is None or o > best[0]: best = (o, x)
print("random best", best, [round(v,2) for v in hs(build(best[1]))], time.time()-t0)
# local refinement
o, x = best
step = [ (h-l)*0.08 for l, h in zip(LO, HI)]
for it in range(3000):
    y = tuple(min(h, max(l, xi + random.gauss(0, s))) for xi, s, l, h in zip(x, step, LO, HI))
    oy = obj(y)
    if oy > o: o, x = oy, y
print("refined", round(o,3), tuple(round(v,4) for v in x), [round(v,2) for v in hs(build(x))])
