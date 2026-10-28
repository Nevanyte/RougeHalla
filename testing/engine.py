"""
RPSLS combat engine: five powers, zero matchup-specific rules.

Design contract (enforced by test_rpsls.py):
  1. A fighter is a PowerSpec: universal stats + ONE signature mechanic.
  2. Mechanics are functions of (own spec, UNIVERSAL combat state). They never see
     the opponent's identity, only numbers every fighter has (hp fraction, attack rate).
  3. Defense is a universal law: every packet is split into physical / magic / true
     shares; armor cuts the physical share, shield cuts the magic share, true ignores both.
     A weapon hit uses the attacker's shares; a signature part may carry its own (burn magic,
     backlash physical, disease magic, the mark true: PowerSpec.sig_types).
  4. Nothing in this file mentions a power by name. Counters emerge from the numbers.

Units: HP in points, rates in attacks/second, damage in points, time in seconds.
"""
from dataclasses import dataclass, field, replace
from typing import Callable, Dict

# ----------------------------------------------------------------------------
# Universal state visible to a mechanic (no opponent identity anywhere in here)
# ----------------------------------------------------------------------------
@dataclass(frozen=True)
class State:
    t: float                 # seconds since the duel began
    own_rate: float          # my effective attack rate this tick
    foe_rate: float          # opponent's effective attack rate this tick
    own_hp_frac: float       # my health fraction (0..1)
    foe_hp_frac: float       # target's health fraction (0..1)
    foe_max_hp: float = 0.0  # target's maximum health (points)
    own_hits: float = 0.0    # attacks I have landed so far (the integral of my attack rate)
    own_stacks: float = 0.0  # the stacks I have earned (denied executes here: one per mark)
    own_base_rate: float = 0.0  # my attack rate before any aura (a slow on the cadence): what a hit's weight is paid back to


# ----------------------------------------------------------------------------
# Signature mechanics. Each returns BONUS RAW DAMAGE PER SECOND added on top of
# rate * hit, as a dict of named parts ({"burn": .., "backlash": ..}) so every
# part can carry its own damage type (PowerSpec.sig_types; balance pass, D6).
# Keys are the mechanic ids stored on PowerSpec.mechanic.
# ----------------------------------------------------------------------------
def dragonslayer(p: dict, s: State) -> dict:
    """Burn DoT plus backlash that grows with the TARGET's attack rate.
    Rewards punishing fast attackers; fizzles against slow ones."""
    return {"burn": p["burn"], "backlash": p["backlash"] * s.foe_rate}


def rat_king(p: dict, s: State) -> dict:
    """Constant disease DPS, then a ReLU execute once the target is below 50% HP. The execute is its own part (the same type as
    the disease) so a tier-4 mark can deny it."""
    return {"disease": p["plague"], "execute": p["execute"] * max(0.0, 0.5 - s.foe_hp_frac)}


# The mark climbs by attacks landed, not by time: tier 1 at the first hit, one more every TIER_HITS hits, tier MARK_TOP at most.
TIER_HITS = 3.0
MARK_TOP = 4


def mark_tier(own_hits: float) -> int:
    """Tier of the mark after `own_hits` hits on the same target: 0 before the first, then 1 + a tier per TIER_HITS hits, at most 4."""
    if own_hits <= 0.0:
        return 0
    return min(MARK_TOP, 1 + int(own_hits / TIER_HITS + 1e-9))


def marked(p: dict, s: State) -> dict:
    """The mark: every hit on the target adds a share of ITS MAX HP as true damage (a per-second rate here: the attack rate the fighter
    would have with no slow on it x the share: a slowed fighter lands fewer hits, each paying out the time it took, so a slow on
    the cadence never cuts the mark), the share growing with the tier (x amp at the top) and with the stacks earned."""
    tier = mark_tier(s.own_hits)
    if tier == 0:
        return {}
    pct = p["mark_pct"] + p["mark_kill"] * s.own_stacks
    amp = p["mark_amp"] if tier >= MARK_TOP else 1.0
    return {"mark": s.own_base_rate * pct * s.foe_max_hp * amp}


def none_(p: dict, s: State) -> dict:
    return {}


BONUS: Dict[str, Callable[[dict, State], dict]] = {
    "dragonslayer": dragonslayer, "rat_king": rat_king, "marked": marked, "plain": none_,
}


# Pressure: what a mechanic does to the OPPONENT beyond damage (a tax on its attack rate, a cut to its output, a denied execute).
# Like a bonus it reads only (own params, universal state): the opponent's attack rate is a number every fighter has.
def no_pressure(p: dict, s: State) -> dict:
    return {"foe_rate": s.foe_rate, "foe_out": 1.0, "deny_execute": False}


def marked_pressure(p: dict, s: State) -> dict:
    """Tier 2: the opponent's attack rate above 1.0 is cut (it keeps tax_keep of the excess, never above tax_cap). Tier 3: it deals
    `suppress` of its damage. Tier 4: its execute cannot take me below 1 hp."""
    tier = mark_tier(s.own_hits)
    rate = s.foe_rate
    if tier >= 2 and rate > 1.0:
        rate = min(p["tax_cap"], 1.0 + (rate - 1.0) * p["tax_keep"])
    return {"foe_rate": rate, "foe_out": p["suppress"] if tier >= 3 else 1.0, "deny_execute": tier >= MARK_TOP}


PRESSURE: Dict[str, Callable[[dict, State], dict]] = {"marked": marked_pressure}


# Auras: a multiplier applied to the OPPONENT's attack rate, whoever they are.
def wall_of_ice_aura(p: dict) -> float:
    return 1.0 - p["slow"]


AURA: Dict[str, Callable[[dict], float]] = {"wall_of_ice": wall_of_ice_aura}


# Sustain: fraction of post-mitigation damage healed, from OWN missing health only.
def radiant_lifesteal(p: dict, own_hp_frac: float) -> float:
    return min(p["ls_cap"], p["ls0"] + p["ls1"] * (1.0 - own_hp_frac))


SUSTAIN: Dict[str, Callable[[dict, float], float]] = {"radiant": radiant_lifesteal}


# ----------------------------------------------------------------------------
@dataclass(frozen=True)
class PowerSpec:
    name: str
    hp: float
    rate: float                  # attacks per second
    hit: float                   # raw damage per attack
    phys: float                  # share of damage reduced by ARMOR (attack-damage style)
    true: float                  # share that ignores all defense ("raw")
    armor: float
    shield: float
    mechanic: str = "plain"      # key into BONUS
    aura: str = ""               # key into AURA ("" = none)
    sustain: str = ""            # key into SUSTAIN ("" = none)
    params: dict = field(default_factory=dict)   # mechanic / aura / sustain numbers
    # The signature bonus's own damage type (balance pass, D6): a part with no entry uses the attacker's shares.
    # {"burn": (phys, true), "backlash": (...), ...} per bonus part; magic = the rest of the packet.
    sig_types: dict = field(default_factory=dict)

    @property
    def magic(self) -> float:    # remainder is magic damage, reduced by SHIELD
        return max(0.0, 1.0 - self.phys - self.true)


def scaled(spec: PowerSpec, k: float) -> PowerSpec:
    """Power-level knob. Multiplies hp and every point-damage number by k.
    Ratios (rates, shares, armor, shield, slow, lifesteal) are untouched, so the
    matchup graph is invariant under k (see test_scaling)."""
    dmg_keys = ("burn", "backlash", "plague", "execute")
    p = {key: (v * k if key in dmg_keys else v) for key, v in spec.params.items()}
    return replace(spec, hp=spec.hp * k, hit=spec.hit * k, params=p)


def mitigate(raw: float, atk: PowerSpec, dfn: PowerSpec, shares=None) -> float:
    """Universal damage law. dfn contributes ONLY its own armor and shield. `shares` = (phys, true) of this packet
    (a typed signature), else the attacker's own."""
    phys, tru = shares if shares is not None else (atk.phys, atk.true)
    magic = max(0.0, 1.0 - phys - tru)
    return raw * (phys / (1.0 + dfn.armor / 100.0) + magic / (1.0 + dfn.shield / 100.0) + tru)


def duel(a: PowerSpec, b: PowerSpec, dt: float = 0.002, t_max: float = 120.0):
    """Returns (winner_index or None, seconds, hp_a, hp_b). 0 = a wins, 1 = b wins."""
    f = [a, b]
    hp = [a.hp, b.hp]
    hits = [0.0, 0.0]
    stacks = [0.0, 0.0]
    t = 0.0
    while t < t_max:
        rate = [f[0].rate, f[1].rate]
        for i in (0, 1):                       # auras multiply the OTHER fighter's rate
            if f[i].aura:
                rate[1 - i] *= AURA[f[i].aura](f[i].params)
        sts = [State(t, rate[i], rate[1 - i], max(hp[i], 0) / f[i].hp, max(hp[1 - i], 0) / f[1 - i].hp,
                     f[1 - i].hp, hits[i], stacks[i], f[i].rate) for i in (0, 1)]
        press = [PRESSURE.get(f[i].mechanic, no_pressure)(f[i].params, sts[i]) for i in (0, 1)]
        for i in (0, 1):                       # pressure changes the opponent's rate (a tax)
            rate[1 - i] = press[i]["foe_rate"]
        out = [0.0, 0.0]
        heal = [0.0, 0.0]
        denied = [False, False]
        for i in (0, 1):
            o = 1 - i
            st = State(t, rate[i], rate[o], max(hp[i], 0) / f[i].hp, max(hp[o], 0) / f[o].hp, f[o].hp, hits[i], stacks[i], f[i].rate)
            cut = press[o]["foe_out"]
            plain = mitigate(rate[i] * f[i].hit * dt, f[i], f[o]) * cut
            exe = 0.0
            for part, v in BONUS[f[i].mechanic](f[i].params, st).items():
                d = mitigate(v * dt, f[i], f[o], f[i].sig_types.get(part)) * cut
                if part == "execute":
                    exe += d
                else:
                    plain += d
            if exe > 0.0 and press[o]["deny_execute"]:
                allowed = max(0.0, min(exe, hp[o] - 1.0 - plain))
                denied[o] = exe - allowed > 1e-12
                exe = allowed
            dealt = plain + exe
            out[i] = dealt
            if f[i].sustain:
                # The sentence cuts what a fighter deals, never what it heals from it (docs/SENTENCED_REDESIGN.md R6).
                heal[i] = (dealt / cut) * SUSTAIN[f[i].sustain](f[i].params, st.own_hp_frac)
        hp[0] = min(f[0].hp, hp[0] - out[1] + heal[0])
        hp[1] = min(f[1].hp, hp[1] - out[0] + heal[1])
        for i in (0, 1):
            hits[i] += f[i].rate * dt              # the tiers climb at the unslowed pace: a slow on the cadence never delays them
            if denied[i] and stacks[i] < 1.0:      # a denied execute is worth one stack, once per mark
                stacks[i] = 1.0
        t += dt
        if hp[0] <= 0 or hp[1] <= 0:
            if hp[0] <= 0 and hp[1] <= 0:
                return None, t, 0.0, 0.0
            return (0 if hp[1] <= 0 else 1), t, max(hp[0], 0.0), max(hp[1], 0.0)
    return None, t, hp[0], hp[1]
