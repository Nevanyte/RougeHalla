"""
RPSLS combat engine: five powers, zero matchup-specific rules.

Design contract (enforced by test_rpsls.py):
  1. A fighter is a PowerSpec: universal stats + ONE signature mechanic.
  2. Mechanics are functions of (own spec, UNIVERSAL combat state). They never see
     the opponent's identity, only numbers every fighter has (hp fraction, attack rate).
  3. Defense is a universal law: every packet is split into physical / magic / true
     shares; armor cuts the physical share, shield cuts the magic share, true ignores both.
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


# ----------------------------------------------------------------------------
# Signature mechanics. Each returns BONUS RAW DAMAGE PER SECOND added on top of
# rate * hit. Keys are the mechanic ids stored on PowerSpec.mechanic.
# ----------------------------------------------------------------------------
def dragonslayer(p: dict, s: State) -> float:
    """Burn DoT plus backlash that grows with the TARGET's attack rate.
    Rewards punishing fast attackers; fizzles against slow ones."""
    return p["burn"] + p["backlash"] * s.foe_rate


def rat_king(p: dict, s: State) -> float:
    """Constant disease DPS, then a ReLU execute once the target is below 50% HP."""
    return p["plague"] + p["execute"] * max(0.0, 0.5 - s.foe_hp_frac)


def marked(p: dict, s: State) -> float:
    """Mark bonus ramps with elapsed TIME (not attack count), then caps."""
    return min(p["mark_cap"], p["mark_ramp"] * s.t)


def none_(p: dict, s: State) -> float:
    return 0.0


BONUS: Dict[str, Callable[[dict, State], float]] = {
    "dragonslayer": dragonslayer, "rat_king": rat_king, "marked": marked, "plain": none_,
}


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

    @property
    def magic(self) -> float:    # remainder is magic damage, reduced by SHIELD
        return max(0.0, 1.0 - self.phys - self.true)


def scaled(spec: PowerSpec, k: float) -> PowerSpec:
    """Power-level knob. Multiplies hp and every point-damage number by k.
    Ratios (rates, shares, armor, shield, slow, lifesteal) are untouched, so the
    matchup graph is invariant under k (see test_scaling)."""
    dmg_keys = ("burn", "backlash", "plague", "execute", "mark_ramp", "mark_cap")
    p = {key: (v * k if key in dmg_keys else v) for key, v in spec.params.items()}
    return replace(spec, hp=spec.hp * k, hit=spec.hit * k, params=p)


def mitigate(raw: float, atk: PowerSpec, dfn: PowerSpec) -> float:
    """Universal damage law. dfn contributes ONLY its own armor and shield."""
    return raw * (atk.phys / (1.0 + dfn.armor / 100.0)
                  + atk.magic / (1.0 + dfn.shield / 100.0)
                  + atk.true)


def duel(a: PowerSpec, b: PowerSpec, dt: float = 0.002, t_max: float = 120.0):
    """Returns (winner_index or None, seconds, hp_a, hp_b). 0 = a wins, 1 = b wins."""
    f = [a, b]
    hp = [a.hp, b.hp]
    t = 0.0
    while t < t_max:
        rate = [f[0].rate, f[1].rate]
        for i in (0, 1):                       # auras multiply the OTHER fighter's rate
            if f[i].aura:
                rate[1 - i] *= AURA[f[i].aura](f[i].params)
        out = [0.0, 0.0]
        heal = [0.0, 0.0]
        for i in (0, 1):
            o = 1 - i
            st = State(t, rate[i], rate[o], max(hp[i], 0) / f[i].hp, max(hp[o], 0) / f[o].hp)
            raw = (rate[i] * f[i].hit + BONUS[f[i].mechanic](f[i].params, st)) * dt
            dealt = mitigate(raw, f[i], f[o])
            out[i] = dealt
            if f[i].sustain:
                heal[i] = dealt * SUSTAIN[f[i].sustain](f[i].params, st.own_hp_frac)
        hp[0] = min(f[0].hp, hp[0] - out[1] + heal[0])
        hp[1] = min(f[1].hp, hp[1] - out[0] + heal[1])
        t += dt
        if hp[0] <= 0 or hp[1] <= 0:
            if hp[0] <= 0 and hp[1] <= 0:
                return None, t, 0.0, 0.0
            return (0 if hp[1] <= 0 else 1), t, max(hp[0], 0.0), max(hp[1], 0.0)
    return None, t, hp[0], hp[1]
