"""Real-time balance and feel report (needs numpy).  python3 realtime_report.py [what-if.json] [sections]

Without a what-if file it reports classes.py and the weapon table in realtime.py. Takes about a minute.
sections (default all): cad,engine,rpsls,mirror,sig,kite,buff,gap
"""
import os
import shutil
import subprocess
import sys
import tempfile

import realtime as W
from realtime import BEATS, MELEE, RANGED, REACH, V, Side, chill_of, duel, edge_stats

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
cand = W.load(args.pop(0)) if args and args[0].endswith(".json") else {}
want = set((args[0] if args else "cad,engine,rpsls,mirror,sig,kite,buff,gap").split(","))
BY, WEAPONS, WNAMES, SIG = W.BY, W.WEAPONS, W.WNAMES, W.SIG
print(f"=== {W.NAME}")
print("factions:", {n: (p.rate, p.hit, round(p.rate * p.hit, 2)) for n, p in BY.items()}, "backlash", BY["Fire"].params["backlash"])
print("weapons:", {w: (f"+{v['speed']*100:.0f}%", v["dps"], v["floor"]) for w, v in WEAPONS.items()})


def S(f, w, **kw):
    return Side(BY[f], w, **kw)


if "cad" in want:
    print("\n[cad] seconds between attacks / per-hit raw at DUEL_PACE k=2 (x2 of k=1); * = floor binds")
    print(f"{'':10s}" + "".join(f"{w:>15s}" for w in WNAMES))
    for n, p in BY.items():
        row = ""
        for w in WNAMES:
            raw = 1.0 / (p.rate * (1 + WEAPONS[w]["speed"]))
            iv = W.interval(p, w)
            row += f"{iv:6.2f}s{'*' if iv > raw + 1e-9 else ' '}/{2 * W.per_hit(p, w):6.0f}"
        print(f"{n:10s}{row}")

if "engine" in want:
    from engine import duel as cduel
    print("\n[engine] continuous duel dt=0.002 (winner, time, winner HP left)")
    for a, b in BEATS:
        w, t, ha, hb = cduel(BY[a], BY[b], dt=0.002)
        print(f"  {a+'>'+b:17s} {'OK ' if w == 0 else 'FLIP'} {t:5.1f}s {ha / BY[a].hp * 100:5.1f}%")

if "rpsls" in want:
    d = tempfile.mkdtemp(prefix="rpsls_")
    src = HERE
    for f in ("engine.py", "test_rpsls.py"):
        shutil.copy(os.path.join(src, f), d)
    with open(os.path.join(src, "classes.py")) as f:
        text = f.read()
    for n, o in cand.get("factions", {}).items():
        up = n.upper()
        start = text.index(f"{up} = PowerSpec(")
        end = text.index("\n)\n", start) + 3
        p = BY[n]
        block = (f"{up} = PowerSpec(\n    name=\"{p.name}\", hp={p.hp:g}, rate={p.rate:g}, hit={p.hit:g},\n"
                 f"    phys={p.phys:g}, true={p.true:g}, armor={p.armor:g}, shield={p.shield:g},\n")
        if p.mechanic != "plain":
            block += f"    mechanic=\"{p.mechanic}\", "
        else:
            block += "    "
        if p.aura:
            block += f"aura=\"{p.aura}\", "
        if p.sustain:
            block += f"sustain=\"{p.sustain}\", "
        block += "params=dict(" + ", ".join(f"{k}={v:g}" for k, v in p.params.items()) + "),\n)\n"
        text = text[:start] + block + text[end:]
    with open(os.path.join(d, "classes.py"), "w") as f:
        f.write(text)
    r = subprocess.run([sys.executable, os.path.join(d, "test_rpsls.py")], capture_output=True, text=True, cwd=d)
    tail = (r.stdout + r.stderr).strip().splitlines()
    print("\n[rpsls] test_rpsls.py on this candidate: exit", r.returncode)
    print("  " + "\n  ".join(l for l in tail if ("FAIL" in l or "PASS" in l or "pass" in l.lower() or "Error" in l))[:3000])

if "mirror" in want:
    print("\n[mirror] same weapon both sides, every phase pair x2: win% / worst winner HP%")
    print(f"{'':17s}" + "".join(f"{w:>14s}" for w in WNAMES))
    for a, b in BEATS:
        row = ""
        for w in WNAMES:
            st = edge_stats(duel(S(a, w), S(b, w), sub=2))
            row += f"{st['rate']*100:5.0f}% w{st['worst']*100:5.1f}".rjust(14)
        print(f"  {a+'>'+b:15s}{row}", flush=True)

if "sig" in want:
    print("\n[sig] signature opening (worst HP, median length) + cross-weapon pairs under 60%")
    for a, b in BEATS:
        st = edge_stats(duel(S(a, SIG[a]), S(b, SIG[b]), sub=2))
        bad = []
        for wa in WNAMES:
            for wb in WNAMES:
                s2 = edge_stats(duel(S(a, wa), S(b, wb), nmax=40))
                if s2["rate"] < 0.6:
                    bad.append(f"{wa}/{wb}:{s2['rate']*100:.0f}%")
        print(f"  {a+'>'+b:17s} {SIG[a]}/{SIG[b]} {st['rate']*100:3.0f}% worst {st['worst']*100:5.1f}% t~{st['t']:4.1f}s | cross fails: {' '.join(bad) or 'none'}", flush=True)

if "kite" in want:
    print("\n[kite] seconds the melee winner can arrive late and still win (>=50%), vs free-fire time on approach (Tff)")

    def wr(a, wa, b, wb, T):
        return edge_stats(duel(S(a, wa, act_start=T, fx_start=T), S(b, wb), nmax=50))["rate"]

    def tol(a, wa, b, wb):
        if wr(a, wa, b, wb, 0) < 0.5:
            return 0.0
        lo, hi = 0.0, 90.0
        if wr(a, wa, b, wb, hi) >= 0.5:
            return float("inf")
        while hi - lo > 0.025:
            mid = (lo + hi) / 2
            if wr(a, wa, b, wb, mid) >= 0.5:
                lo = mid
            else:
                hi = mid
        return lo

    for a, b in BEATS:
        row = ""
        for wb in RANGED:
            t = {wa: tol(a, wa, b, wb) for wa in MELEE}
            tff = (WEAPONS[wb]["rng"] - REACH) / (V * chill_of(Side(BY[b], wb)))
            row += f"  {wb}: " + " ".join(f"{k[:2]}{v:6.2f}" for k, v in t.items()) + f" (Tff {tff:4.2f}{' STOLEN' if min(t.values()) < tff else ''})"
        print(f"  {a+'>'+b:17s}{row}", flush=True)

if "buff" in want:
    print("\n[buff] smallest multiplier on the LOSER that flips the edge (<50%), min over 5 mirrors + signature")

    def rate(a, wa, b, wb, hp=1.0, aspd=1.0):
        return edge_stats(duel(S(a, wa), S(b, wb, hp_mult=hp, as_mult=aspd), nmax=40))["rate"]

    def flip(a, wa, b, wb, stat, hi=8.0):
        f = (lambda m: rate(a, wa, b, wb, hp=m)) if stat == "hp" else (lambda m: rate(a, wa, b, wb, aspd=m))
        if f(1.0) < 0.5:
            return 1.0
        if f(hi) >= 0.5:
            return float("inf")
        lo = 1.0
        for _ in range(11):
            mid = (lo + hi) / 2
            if f(mid) >= 0.5:
                lo = mid
            else:
                hi = mid
        return hi

    settings = [(w, w) for w in WNAMES] + [("sig", "sig")]
    for stat in ("hp", "as"):
        mins = []
        for a, b in BEATS:
            vals = []
            for wa, wb in settings:
                x, y = (SIG[a], SIG[b]) if wa == "sig" else (wa, wb)
                vals.append((flip(a, x, b, y, stat), wa))
            m = min(vals)
            mins.append(m[0])
            print(f"  {stat} {a+'>'+b:17s} min x{m[0]:.2f} ({m[1]})", flush=True)
        print(f"  {stat} OVERALL min x{min(mins):.2f}")

if "gap" in want:
    print("\n[gap] longest stretch with no swing by either fighter (feel), per edge over 25 weapon pairs")
    worst = (0, "")
    for a, b in BEATS:
        m, arg = 0, ""
        for wa in WNAMES:
            for wb in WNAMES:
                r = duel(S(a, wa), S(b, wb), nmax=30, track_gap=True)
                g = float(max(r["gap"][0].max(), r["gap"][1].max()))
                if g > m:
                    m, arg = g, f"{wa}/{wb}"
        if m > worst[0]:
            worst = (m, f"{a}>{b} {arg}")
        print(f"  {a+'>'+b:17s} {m:5.2f}s ({arg})", flush=True)
    print(f"  OVERALL {worst[0]:.2f}s at {worst[1]}")
