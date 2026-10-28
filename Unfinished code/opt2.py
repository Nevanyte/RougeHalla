import sys, random, time
sys.path.insert(0, "/private/tmp/claude-501/-Users-nevinmckinnon-Documents-Projects-RougeHalla/2fecac89-094f-4d8a-a460-aef8d4be96c5/scratchpad")
from optlib import hs, build, BY, EDG
from multiprocessing import Pool
LO = (0.012, 18, 0.7, 850, 110, 190, 0.8)
HI = (0.030, 40, 1.0, 1050, 150, 250, 0.8)
def obj(x):
    h = hs(build(x))
    if min(h) < 0.0: return -1 + min(h)
    return min(h) - 0.5*sum(max(0, v - 0.30) for v in h) - 0.05*sum(abs(v-0.22) for v in h)
def work(seed):
    rnd = random.Random(seed)
    best = None
    for i in range(500):
        x = tuple(rnd.uniform(l, h) for l, h in zip(LO, HI))
        o = obj(x)
        if best is None or o > best[0]: best = (o, x)
    o, x = best
    step = [(h-l)*0.06 for l, h in zip(LO, HI)]
    for it in range(250):
        y = tuple(min(h, max(l, xi + rnd.gauss(0, s))) for xi, s, l, h in zip(x, step, LO, HI))
        oy = obj(y)
        if oy > o: o, x = oy, y
    return o, x
if __name__ == "__main__":
    with Pool(8) as p:
        res = p.map(work, range(16))
    res.sort(key=lambda r: -r[0])
    for o, x in res[:8]:
        print(round(o,3), tuple(round(v,4) for v in x), [round(v,2) for v in hs(build(x))])
