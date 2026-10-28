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
