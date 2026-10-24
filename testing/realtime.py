"""Real-time check: a 20 Hz discrete duel with weapons (v3 model). Needs numpy; run realtime_report.py.

A weapon is a % boost on the faction's base attack speed:

    attacks/s  = faction.rate x (1 + weapon.speed) x buff          (relative scaling kept on every weapon)
    interval   = max(weapon.floor, 1 / attacks/s)                  (floor only binds under big buffs)
    DPS        = faction.rate x faction.hit x weapon.dps x buff    (weapon.dps = the weapon's damage multiplier)
    per hit    = DPS x interval  (= faction.hit x weapon.dps / (1 + weapon.speed) while the floor doesn't bind)

Everything else is the v2 rule package from the counter review: normalized backlash per enemy swing
(backlash x foe.rate x foe interval), signature bonus x weapon.dps, chill stretches cooldown progress per tick,
bonus/chill clocks from first contact, float HP, cooldown remainders carry.

Not modelled: geometry beyond a fixed approach time, projectile flight, stagger, roots, bow draw and buffs other
than HP and attack speed. engine.duel is the design source of truth; this checks that its cycle survives discrete
swings. Every first-swing phase pair is swept (numpy arrays of shape (P,)).

What-if file (JSON, optional): {"name": str, "factions": {Name: {rate, hit, params: {...}}}, "weapons": {w: {...}}}.
Call load(path) before using BY/WEAPONS.
"""
import json
import math
import os
import sys
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import mitigate  # noqa: E402
from classes import POWERS as V2_POWERS, BEATS  # noqa: E402

DT = 0.05
EPS = 1e-9
V = 170.0      # move speed (u/s)
REACH = 60.0   # melee reach

# speed: boost on the faction's attack rate; dps: damage multiplier; floor: shortest interval (binds only under buffs)
WEAPONS = {
    "sword":  dict(speed=1.15, dps=0.75, floor=0.25, rng=60,  melee=True),
    "axe":    dict(speed=0.40, dps=0.80, floor=0.35, rng=60,  melee=True),
    "bow":    dict(speed=0.95, dps=0.80, floor=0.25, rng=260, melee=False),
    "wand":   dict(speed=0.65, dps=0.75, floor=0.30, rng=240, melee=False),
    "shield": dict(speed=0.60, dps=0.75, floor=0.30, rng=60,  melee=True),
}
WNAMES = list(WEAPONS)
MELEE = ["sword", "axe", "shield"]
RANGED = ["bow", "wand"]
SIG = {"Fire": "axe", "Sentenced": "bow", "Plague": "bow", "Frost": "shield", "Holy": "wand"}
POWERS = list(V2_POWERS)
BY = {p.name: p for p in POWERS}
NAME = "classes.py"


def load(path):
    global POWERS, BY, NAME
    with open(path) as f:
        cand = json.load(f)
    NAME = cand.get("name", path)
    out = []
    for p in V2_POWERS:
        o = dict(cand.get("factions", {}).get(p.name, {}))
        params = {**p.params, **o.pop("params", {})}
        out.append(replace(p, params=params, **o))
    POWERS[:] = out
    BY.clear()
    BY.update({p.name: p for p in out})
    for w, o in cand.get("weapons", {}).items():
        WEAPONS[w].update(o)
    return cand


def interval(spec, wname, as_mult=1.0, floor=True):
    w = WEAPONS[wname]
    raw = 1.0 / (spec.rate * (1.0 + w["speed"]) * as_mult)
    return max(w["floor"], raw) if floor else raw


def per_hit(spec, wname, as_mult=1.0, dps=None):
    w = WEAPONS[wname]
    d = w["dps"] if dps is None else dps
    return spec.rate * spec.hit * d * as_mult * interval(spec, wname, as_mult)


@dataclass
class Side:
    spec: object
    weapon: str
    hp_mult: float = 1.0
    as_mult: float = 1.0
    dps: Optional[float] = None
    act_start: float = 0.0
    fx_start: float = 0.0
    lifesteal: bool = True

    @property
    def cd(self):
        return interval(self.spec, self.weapon, self.as_mult)

    @property
    def hit_raw(self):
        return per_hit(self.spec, self.weapon, self.as_mult, self.dps)

    @property
    def bonus_mult(self):
        return WEAPONS[self.weapon]["dps"] if self.dps is None else self.dps

    @property
    def maxhp(self):
        return self.spec.hp * self.hp_mult


def chill_of(opp: Side) -> float:
    return (1.0 - opp.spec.params["slow"]) if opp.spec.aura == "wall_of_ice" else 1.0


def phases(side: Side, opp: Side, sub=1, nmax=None):
    m = chill_of(opp) if opp.fx_start <= side.act_start + EPS else 1.0
    span = side.cd / m
    n = max(1, int(math.ceil(span / DT - EPS))) * sub
    offs = np.arange(n) * (span / n)
    if nmax and n > nmax:
        offs = offs[np.linspace(0, n - 1, nmax).round().astype(int)]
    return offs, m


def duel(a: Side, b: Side, sub=1, nmax=None, t_max=400.0, track_gap=None):
    sides = [a, b]
    (oa, ma), (ob, mb) = phases(a, b, sub, nmax), phases(b, a, sub, nmax)
    A, B = np.meshgrid(oa, ob, indexing="ij")
    off = [A.ravel(), B.ravel()]
    m0 = [ma, mb]
    P = off[0].size
    cd = [s.cd for s in sides]
    prog = [cd[i] - off[i] * m0[i] for i in (0, 1)]
    hp = [np.full(P, s.maxhp) for s in sides]
    mx = [s.maxhp for s in sides]
    mit = [mitigate(1.0, a.spec, b.spec), mitigate(1.0, b.spec, a.spec)]
    hitraw = [s.hit_raw for s in sides]
    alive = np.ones(P, bool)
    win = np.full(P, -1, int)
    tend = np.full(P, t_max)
    if track_gap:
        last = [np.full(P, np.nan), np.full(P, np.nan)]
        gap = [np.zeros(P), np.zeros(P)]
    for k in range(int(round(t_max / DT))):
        t = k * DT
        swing = []
        for i in (0, 1):
            s, o = sides[i], sides[1 - i]
            if t + EPS < s.act_start:
                swing.append(np.zeros(P, bool))
                continue
            sw = (prog[i] >= cd[i] - EPS) & alive
            prog[i] = np.where(sw, prog[i] - cd[i], prog[i])
            mult = chill_of(o) if t + EPS >= o.fx_start else 1.0
            prog[i] = prog[i] + DT * mult
            swing.append(sw)
        dealt, heal = [], []
        for i in (0, 1):
            s, o = sides[i], sides[1 - i]
            raw = swing[i] * hitraw[i]
            if t + EPS >= s.fx_start:
                p = s.spec.params
                mech = s.spec.mechanic
                bm = s.bonus_mult
                if mech == "dragonslayer":
                    per = p["backlash"] * o.spec.rate * interval(o.spec, o.weapon)
                    raw = raw + bm * (p["burn"] * DT + per * swing[1 - i])
                elif mech == "rat_king":
                    foe = np.maximum(hp[1 - i], 0) / mx[1 - i]
                    raw = raw + bm * (p["plague"] + p["execute"] * np.maximum(0.0, 0.5 - foe)) * DT
                elif mech == "marked":
                    raw = raw + bm * min(p["mark_cap"], p["mark_ramp"] * (t - s.fx_start)) * DT
            d = raw * mit[i]
            dealt.append(d)
            if s.spec.sustain == "radiant" and s.lifesteal:
                p = s.spec.params
                own = np.maximum(hp[i], 0) / mx[i]
                heal.append(d * np.minimum(p["ls_cap"], p["ls0"] + p["ls1"] * (1.0 - own)))
            else:
                heal.append(0.0)
        if track_gap:
            for i in (0, 1):
                ev = (swing[i] | swing[1 - i]) & alive
                g = np.where(np.isnan(last[i]), 0.0, t - last[i])
                gap[i] = np.where(ev, np.maximum(gap[i], g), gap[i])
                last[i] = np.where(ev, t, last[i])
        n0 = np.minimum(mx[0], hp[0] - dealt[1] + heal[0])
        n1 = np.minimum(mx[1], hp[1] - dealt[0] + heal[1])
        hp[0] = np.where(alive, n0, hp[0])
        hp[1] = np.where(alive, n1, hp[1])
        d0, d1 = hp[0] <= 0, hp[1] <= 0
        fin = alive & (d0 | d1)
        if fin.any():
            win = np.where(fin & d1 & ~d0, 0, win)
            win = np.where(fin & d0 & ~d1, 1, win)
            tend = np.where(fin, t + DT, tend)
            alive = alive & ~fin
            if not alive.any():
                break
    out = dict(win=win, frac0=np.maximum(hp[0], 0) / mx[0], frac1=np.maximum(hp[1], 0) / mx[1], t=tend, P=P)
    if track_gap:
        out["gap"] = gap
    return out


def edge_stats(r, winner_idx=0):
    w = r["win"]
    ok = w == winner_idx
    frac = r["frac0"] if winner_idx == 0 else r["frac1"]
    left = np.where(ok, frac, 0.0)
    return dict(rate=ok.mean(), worst=left.min(), mean=left.mean(), draws=(w == -1).mean(),
                t=float(np.median(r["t"])), tmax=float(r["t"].max()), P=r["P"])
