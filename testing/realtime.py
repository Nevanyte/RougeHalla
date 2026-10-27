"""Real-time check: a 20 Hz discrete duel with weapons (v3 model). Needs numpy; run realtime_report.py.

A weapon is a % boost on the faction's base attack speed:

    attacks/s  = faction.rate x (1 + weapon.speed) x buff          (relative scaling kept on every weapon)
    interval   = max(weapon.floor, 1 / attacks/s)                  (floor only binds under big buffs)
    DPS        = faction.rate x faction.hit x weapon.dps x buff    (weapon.dps = the weapon's damage multiplier)
    per hit    = DPS x interval  (= faction.hit x weapon.dps / (1 + weapon.speed) while the floor doesn't bind)

Everything else is the v2 rule package from the counter review: normalized backlash per enemy swing
(backlash x foe.rate x foe interval), signature bonus x weapon.dps, chill stretches cooldown progress per tick,
bonus/chill clocks from first contact, float HP, cooldown remainders carry. Each signature part is mitigated with its own
damage type (engine.PowerSpec.sig_types: burn and disease magic, backlash physical, the mark true).

Not modelled by `duel`: geometry beyond a fixed approach time, projectile flight, stagger, windups, roots and buffs other
than HP, attack speed and an outgoing damage multiplier (Side.dps scales the weapon hit and the signature bonus alike).
engine.duel is the design source of truth; this checks that its cycle survives discrete swings. Every first-swing phase
pair is swept (numpy arrays of shape (P,)).

The kite check is the exception: it needs geometry. Every attack roots its fighter for a windup (the controls rework: the
old ranged move slows are gone) and a fighter walks at full speed between attacks, so a shooter can orb-walk away from a
melee chaser, who only closes the gap while the shooter is rooted. `orbwalk_free_fire` is a small kinematic model of that,
`kite_tolerance` the duel model's side of it (how late the melee winner may arrive), `kite_rows` both. The balance pass judges
the check differently (test_kite.py): a perfect orb-walking underdog must win at most 65% under the noise model, i.e.
`kite_ratio`'s r_kite = r x (1 - free fire / T) >= 0.78, with `flip_multiplier` (r) and `kill_time` (T) its model figures.

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
CHILL_MOVE_RADIUS = 100.0  # shared/signatures.ts: Frost's move slow reaches only fighters it chills within this distance...
CHILL_MOVE_MULT = 0.7      # ...and multiplies their move speed by this

# speed: boost on the faction's attack rate; dps: damage multiplier; floor: shortest interval (binds only under buffs);
# windup/wshare: the attacker is rooted for min(windup, wshare x interval) seconds from the attack starting (the TS
# BOW_WINDUP / BOW_WINDUP_SHARE etc. in shared/weapons.ts; the axe's extra root is not modelled). Used by the kite model only.
# A windup mod (a windup multiplier below 1, Quickdraw; owner ruling "Melee windups only") never shortens a ranged windup:
# windup() applies it to the melee weapons only (shared/mods.ts scaleWindup), so there are no ranged floors to carry.
WEAPONS = {
    "sword":  dict(speed=1.15, dps=0.75, floor=0.25, rng=60,  melee=True,  windup=0.10, wshare=1.00),
    "axe":    dict(speed=0.40, dps=0.77, floor=0.35, rng=60,  melee=True,  windup=0.25, wshare=0.25),
    "bow":    dict(speed=0.95, dps=0.80, floor=0.25, rng=240, melee=False, windup=0.60, wshare=0.92),
    "wand":   dict(speed=0.65, dps=0.80, floor=0.30, rng=220, melee=False, windup=0.40, wshare=0.80),
    "shield": dict(speed=0.60, dps=0.75, floor=0.30, rng=60,  melee=True,  windup=0.10, wshare=1.00),
    # The empty hand (balance pass D3): the fastest melee, a weak hit. Not one of the five loop weapons (MELEE / RANGED / SIG
    # below leave it out: nobody picks it, a run starts on it), but every pairing is still modelled.
    "fists":  dict(speed=1.50, dps=0.60, floor=0.20, rng=40,  melee=True,  windup=0.10, wshare=1.00),
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


def windup(spec, wname, as_mult=1.0, windup_mult=1.0):
    """Seconds the attacker is rooted from an attack starting until it lands / the projectile leaves: the weapon's windup
    cap or its share of the interval, whichever is shorter (shared/weapons.ts weaponTimings). `windup_mult` is a windup mod
    (Quickdraw) as shared/mods.ts scaleWindup applies it: a mult below 1 shortens MELEE windups only and leaves a ranged
    windup exactly as it was (the anti-kiting lever is never shortened); a mult of 1 or more scales any weapon (never past
    the interval). Continuous time: the sim lands an attack on the first 50 ms tick at or after its windup, which this does not."""
    w = WEAPONS[wname]
    base = min(w["windup"], w["wshare"] * interval(spec, wname, as_mult))
    if windup_mult == 1.0 or (windup_mult < 1.0 and not w["melee"]):
        return base
    return min(interval(spec, wname, as_mult), base * windup_mult)


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
    # Signature parts carry their own damage type (D6: burn and disease magic, backlash physical, the mark true): each part
    # is mitigated on its own, as sim/factions.ts records it with SIGNATURE_SHARES.
    pmit = [{part: mitigate(1.0, s.spec, o.spec, s.spec.sig_types.get(part)) for part in ("burn", "backlash", "disease", "mark")}
            for s, o in ((a, b), (b, a))]
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
            d = swing[i] * hitraw[i] * mit[i]
            if t + EPS >= s.fx_start:
                p = s.spec.params
                mech = s.spec.mechanic
                bm = s.bonus_mult
                if mech == "dragonslayer":
                    per = p["backlash"] * o.spec.rate * interval(o.spec, o.weapon)
                    d = d + bm * (p["burn"] * DT * pmit[i]["burn"] + per * swing[1 - i] * pmit[i]["backlash"])
                elif mech == "rat_king":
                    foe = np.maximum(hp[1 - i], 0) / mx[1 - i]
                    d = d + bm * (p["plague"] + p["execute"] * np.maximum(0.0, 0.5 - foe)) * DT * pmit[i]["disease"]
                elif mech == "marked":
                    d = d + bm * min(p["mark_cap"], p["mark_ramp"] * (t - s.fx_start)) * DT * pmit[i]["mark"]
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
        # Damage first, then the heal, as the sim orders it (applyLedger, then the lifesteal system): a fighter the tick's damage
        # takes to 0 is dead, whatever it healed in the same tick. (Netting the two let a Holy survive a blow its own hit healed.)
        pre0 = hp[0] - dealt[1]
        pre1 = hp[1] - dealt[0]
        n0 = np.where(pre0 <= 0, pre0, np.minimum(mx[0], pre0 + heal[0]))
        n1 = np.where(pre1 <= 0, pre1, np.minimum(mx[1], pre1 + heal[1]))
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


def free_fire_time(loser_name, ranged):
    """Seconds a STANDING shooter fires at a chaser closing at the move speed before it reaches melee reach (the standing
    bound of the kite check). A Frost shooter's chill is counted at range, the old conservative way (it divides by the
    attack-speed chill, 0.4, not the move slow of the TS sim; `orbwalk_free_fire(..., stand=True)` has the kinematic
    figure). A shooter that walks away between shots has `orbwalk_free_fire`."""
    return (WEAPONS[ranged]["rng"] - REACH) / (V * chill_of(Side(BY[loser_name], ranged)))


def orbwalk_free_fire(loser_name, ranged, winner_name=None, stand=False, t_max=60.0, as_mult=1.0, windup_mult=1.0):
    """Seconds until a melee chaser closes from the shooter's range to melee reach on a shooter that orb-walks: a small
    kinematic model at the sim's DT = 0.05 mirroring the TS rules.

    The chaser starts `rng` away and walks straight at the shooter at V. The shooter is ready at t = 0, so it starts a
    windup at once and is rooted until the shot leaves; then it walks straight away at V until its cooldown (the interval,
    counted from the windup's start, which is where the TS sim sets readyAt) ends, and winds up again. Moving speed is the
    same on both sides, so the chaser closes only while the shooter is rooted. A Frost shooter chills the chaser once it has
    engaged it (from the first shot leaving; arrow flight ignored, the conservative way): the chaser then walks at
    CHILL_MOVE_MULT x V while within CHILL_MOVE_RADIUS of the shooter, so the gap regrows to the radius after every shot
    and the chaser must cover the last (radius - REACH) / (CHILL_MOVE_MULT x V) = 0.336 s worth inside ONE windup: a Frost
    shooter whose windup is shorter than that (and under 0.3 x its interval) keeps it out of reach for good (inf). The
    cooldown chill on a chaser does not matter here.

    A Frost CHASER's chill on the shooter is NOT applied (`winner_name` is accepted so a caller can name the pair, and is
    unused on purpose): `kite_tolerance` starts the winner's fx clock at its arrival, so the chill is not yet running during
    the free-fire window. The shooter's cooldown and move speed are unchilled all the way in, the conservative way.

    `stand=True` is the shooter that never walks away (same rooted-or-not clock, but it never moves): the kinematic twin of
    `free_fire_time`, equal to it unless the shooter is Frost. `as_mult` is the shooter's attack-speed multiplier (a buff):
    the interval and the windup's share follow it as in the TS sim (interval floor included; the cap does not move).
    `windup_mult` is the shooter's windup mod (windup(): Quickdraw; it never shortens a ranged windup).
    Returns inf if the chaser has not arrived after t_max."""
    spec = BY[loser_name]
    rng = float(WEAPONS[ranged]["rng"])
    iv = interval(spec, ranged, as_mult)
    wu = min(windup(spec, ranged, as_mult, windup_mult), iv)
    frost = spec.aura == "wall_of_ice"
    gap = rng
    for k in range(int(round(t_max / DT))):
        t = k * DT
        phase = t - math.floor((t + EPS) / iv) * iv
        rooted = phase < wu - EPS
        engaged = t + EPS >= wu
        vc = V * CHILL_MOVE_MULT if frost and engaged and gap <= CHILL_MOVE_RADIUS else V
        vs = 0.0 if rooted or stand else V
        nxt = gap - (vc - vs) * DT
        if nxt <= REACH:
            return t + DT * (gap - REACH) / (gap - nxt)
        gap = nxt
    return float("inf")


def shooter_side(b, wb, as_mult=1.0, dmg=1.0):
    """The ranged loser's Side with a buff: `as_mult` its attack-speed multiplier (interval / as_mult down to the floor, damage
    per hit taking over past it, as shared/weapons.ts attackInterval / damagePerHit), `dmg` an outgoing damage multiplier on
    every hit, weapon and signature alike (a `damage` row: the TS ledger's outgoingMult)."""
    dps = None if dmg == 1.0 else WEAPONS[wb]["dps"] * dmg
    return Side(BY[b], wb, as_mult=as_mult, dps=dps)


def kite_tolerance(a, wa, b, wb, hi=90.0, nmax=50, as_mult=1.0, dmg=1.0):
    """Seconds the melee winner a (holding wa) can arrive late and still beat the ranged loser b (holding wb) at least half
    the time, with b firing at full output, bonus clock running, from the start. 0.0 if it loses even on time, inf if it
    still wins after `hi` seconds. Independent of the windups (the shooter's cadence is its interval either way).
    `as_mult` / `dmg` buff the shooter (shooter_side); the winner is never buffed."""
    def wr(T):
        return edge_stats(duel(Side(BY[a], wa, act_start=T, fx_start=T), shooter_side(b, wb, as_mult, dmg), nmax=nmax))["rate"]

    if wr(0) < 0.5:
        return 0.0
    lo = 0.0
    if wr(hi) >= 0.5:
        return float("inf")
    while hi - lo > 0.025:
        mid = (lo + hi) / 2
        if wr(mid) >= 0.5:
            lo = mid
        else:
            hi = mid
    return lo


def flip_multiplier(a, wa, b, wb, as_mult=1.0, dmg=1.0, lo=0.1, hi=32.0, nmax=50):
    """r, the flip multiplier of the kite check (balance pass, BALANCE_CONTRACT 5.4): the smallest multiplier on the ranged loser
    b's damage (weapon and signature alike, on top of `dmg`) with which it beats the melee winner a (holding wa) at least half the
    time in the standing duel, both firing from the start. With constant rates r is the ratio of the loser's time to kill to the
    winner's, and the favourite's hp left h = 1 - 1/r. `lo` / `hi` bound the search (the answer is clamped to them)."""
    def under_wins(m):
        r = duel(Side(BY[a], wa), shooter_side(b, wb, as_mult, dmg * m), nmax=nmax)
        return edge_stats(r)["rate"] < 0.5

    if under_wins(lo):
        return lo
    if not under_wins(hi):
        return hi
    while hi / lo > 1.002:
        mid = math.sqrt(lo * hi)
        if under_wins(mid):
            hi = mid
        else:
            lo = mid
    return math.sqrt(lo * hi)


def kill_time(b, wb, a, wa, as_mult=1.0, dmg=1.0, nmax=50):
    """T, the time the ranged loser b (holding wb) needs to kill the melee winner a (holding wa) in the same model when a does
    no damage at all (its swings, and so Fire's backlash on them, still happen): the median over the phase grid. a's own damage
    would end the duel first; this is what b's damage alone takes."""
    r = duel(shooter_side(b, wb, as_mult, dmg), Side(BY[a], wa, dps=0.0), nmax=nmax)
    return float(np.median(r["t"]))


def kite_ratio(a, wa, b, wb, as_mult=1.0, dmg=1.0, windup_mult=1.0, nmax=50):
    """The kite check's figures for one cell: r (flip_multiplier), T (kill_time), F (orbwalk_free_fire: the seconds a perfect
    orb-walking shooter fires before the chaser arrives) and r_kite = r x (1 - F / T), the flip multiplier the shooter needs once
    the unanswered fire has been paid: the free fire shortens the shooter's work by F of its T seconds. inf free fire (the
    chaser never arrives) is r_kite = -inf."""
    r = flip_multiplier(a, wa, b, wb, as_mult, dmg, nmax=nmax)
    t = kill_time(b, wb, a, wa, as_mult, dmg, nmax=nmax)
    f = orbwalk_free_fire(b, wb, a, as_mult=as_mult, windup_mult=windup_mult)
    r_kite = -math.inf if f == math.inf else r * (1.0 - f / t)
    return dict(r=r, T=t, F=f, r_kite=r_kite)


def kite_tolerances(as_mult=1.0, dmg=1.0):
    """The expensive half of the kite check: {(winner, loser, ranged weapon): {melee weapon: tolerance}} for every faction
    edge. It does not depend on the windups, so a sweep over them computes it once. `as_mult` / `dmg` buff every shooter."""
    return {(a, b, wb): {wa: kite_tolerance(a, wa, b, wb, as_mult=as_mult, dmg=dmg) for wa in MELEE} for a, b in BEATS for wb in RANGED}


def kite_rows(tols=None, as_mult=1.0, windup_mult=1.0):
    """The kite check, one row per faction edge: [(winner, loser, {ranged weapon: ({melee weapon: tolerance}, Tff standing,
    Tff orb-walk)})]. A cell is STOLEN when the weakest melee weapon's tolerance is below the orb-walk free-fire time (the
    standing time is the lower bound it is printed beside). Pass `tols` (from kite_tolerances) to reuse the tolerances, and
    the same `as_mult` the tolerances were computed with (the shooter's attack speed moves its orb-walk too). `windup_mult` is
    the shooter's windup mod; the tolerances do not depend on it, only the orb-walk time does."""
    tols = tols or kite_tolerances(as_mult)
    rows = []
    for a, b in BEATS:
        cells = {wb: (tols[(a, b, wb)], free_fire_time(b, wb), orbwalk_free_fire(b, wb, a, as_mult=as_mult, windup_mult=windup_mult)) for wb in RANGED}
        rows.append((a, b, cells))
    return rows


def edge_stats(r, winner_idx=0):
    w = r["win"]
    ok = w == winner_idx
    frac = r["frac0"] if winner_idx == 0 else r["frac1"]
    left = np.where(ok, frac, 0.0)
    return dict(rate=ok.mean(), worst=left.min(), mean=left.mean(), draws=(w == -1).mean(),
                t=float(np.median(r["t"])), tmax=float(r["t"].max()), P=r["P"])
