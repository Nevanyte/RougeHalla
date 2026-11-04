#!/usr/bin/env python3
"""Farming-route proof: is walking past the nearest camp to the camps a build wants worth it? (testing/FARM_ROUTE_PROOF.md)

Numbers only: nothing here runs the game. testing/farm_route_data.json (packages/server/bench/farmRouteData.ts) holds real camp
layouts and walk distances of generated maps plus the sheets (factions, weapons, every mob type as mobTypeFaction builds it, the stat
each normal type pays, the bots' build goals, the constants). This script turns them into

  1. map facts: how far the nearest camp is, and how far the nearest camp of each type is;
  2. a time-to-kill model: a player's damage on each mob type and what a whole camp costs in seconds and hp (DPS from the sheet, the
     damage law, the signatures and their build hooks, focus fire with arc cleave, every mob of the camp hitting back), calibrated
     against bench/campDuel.ts;
  3. two value lenses for a farmed kit, per faction build:
       design  the build's stat weights (bots/brain/buildRoute.ts BUILD_GOALS, STAT_FLOOR for the rest): what the build is FOR;
       combat  duel power: mean log(time the field needs to kill you / time you need to kill the field) over ten reference opponents
               (five factions x their two build weapons) carrying the average kit of the lobbies' players; from the same sheet;
  4. the break-even detour (below), per decision on a fresh map;
  5. 8-player lobbies (the focal player and seven fill bots farming their own builds, sharing camps, respawns, cannons, hp, regen
     and potions) comparing the focal player's
       nearest   always the nearest camp it can farm,
       onbuild   the nearest camp whose stat the build weights 0.6 or more, else the nearest,
       targeted  value per second with a one-camp lookahead, by either lens (walks wherever the value is),
     and counting, in the nearest farmer's own decisions, how often a build camp would have paid more than the off-build camp at hand;
  6. Defense and Soul Defense as counters (one kill of them against a max-health kill, by the opponent's damage type);
  7. the verdict per build (holds()) and, with --sweep, how it moves with mob time-to-kill and reward.

The analytic core: from a camp, a farther camp b beats the nearest camp n iff v_b / (w_b + c_b) > v_n / (w_n + c_n), so with equal
clears the extra walk a build can afford is (value ratio - 1) x (the whole cycle at the nearest camp): longer kills buy longer
detours, and a reward that scales every camp alike cancels.

    python3 testing/farm_route_proof.py [--maps 24] [--rosters 4] [--horizon 600] [--sweep] [--others bots|nearest|solo]
        [--lobby 8] [--no-cannons] [--hp-mult X] [--stacks X] [--dmg-mult X] [--reward stat=x,...] [--const NAME=v,...] [--quick]
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import os
import random
import statistics as st
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
# FARM_ROUTE_DATA points at another export (a what-if copy, e.g. other build weights); the workers read the same file.
DATA = json.load(open(os.environ.get("FARM_ROUTE_DATA") or os.path.join(HERE, "farm_route_data.json")))
C = DATA["constants"]
FACTIONS = DATA["factions"]
WEAPONS = DATA["weapons"]
MOB = {t["id"]: t for t in DATA["mobTypes"]}
REWARD = {r["id"]: r for r in DATA["rewards"]}
NORMALS = {z: [t["id"] for t in DATA["mobTypes"] if t["zone"] == z and not t["elite"]] for z in FACTIONS}
STATS = ("ad", "ap", "armor", "shield", "maxHp", "attackSpeed", "moveSpeed", "lifesteal", "damage")
FACTION_IDS = list(FACTIONS)

# The balance bench's build weapons (packages/server/bench/factionBuilds.ts BUILDS: A and B of each faction).
BUILD_WEAPON = {
    "fire:A": "sword", "fire:B": "shield", "sentenced:A": "sword", "sentenced:B": "bow", "plague:A": "wand",
    "plague:B": "wand", "frost:A": "shield", "frost:B": "bow", "holy:A": "axe", "holy:B": "wand",
}
# Plague's zombie commander is evaluated with its zombie up (one body: its whole premise); every other build has none.
BUILD_BODIES = {"plague:B": 1}
BUILDS = [(f, g) for f in FACTION_IDS for g in DATA["buildGoals"][f]]

# Model assumptions that are not on the sheet (best guesses, each one is reported and the sweep tests the clear-time scale):
#   CLEAVE  the share of a melee arc's (or a wand ball's splash) damage that also lands on each other melee mob of the camp while the
#           player focuses one: mobs crowd round a melee player, a 180-degree axe arc catches about half of them, a 90-degree sword
#           a quarter; a bow arrow stops in its first body; casters stand off, so nothing cleaves onto them.
CLEAVE = {"axe": 0.45, "sword": 0.25, "shield": 0.3, "fists": 0.3, "bow": 0.0, "wand": C["WAND_SPLASH_SHARE"] * 0.6}
#   HIT_CAL the camps' damage on the player x this: the model's clear times match bench/campDuel.ts's real-sim camp pulls on the same
#           sheet (geometric mean real/model 1.06 over the 25 faction x zone cells, signature weapons, 4-mob camps), its hp cost runs
#           low (median real/model 1.26: walking in under fire, casters, windups), so the hp side is scaled up to match.
HIT_CAL = 1.25
SAFETY = 0.15         # a camp is started only with its predicted hp cost plus this share of max hp in hand
MAX_COST = 0.85       # a camp that costs more than this share of max hp from full is not farmable yet
NOISE = 0.45          # the benches' per-fighter noise (bench/lib/balance.ts SIGMA): duel log-ratio sd = NOISE * sqrt(2)


# ---------------------------------------------------------------------------------------------------------------- the sheet ---
DAMAGE_PARAMS = {"burn", "backlash", "plague", "execute", "mark_pct", "mark_kill"}


def paced(spec: dict, k: float = C["DUEL_PACE"]) -> dict:
    """shared/factions.ts pacedFaction: the hit and every damage param x k, hp unchanged."""
    s = dict(spec)
    s["hit"] = spec["hit"] * k
    s["params"] = {key: v * k if key in DAMAGE_PARAMS else v / C["DUEL_PACE"] if key == "tier_hits" else v for key, v in spec["params"].items()}
    return s


def magic_share(f: dict) -> float:
    return max(0.0, 1 - f["phys"] - f["trueShare"])


def mitig(phys: float, magic: float, true: float, armor: float, shield: float) -> float:
    return phys / (1 + max(0.0, armor) / 100) + magic / (1 + shield / 100) + true


def interval(rate: float, w: str, as_mult: float) -> float:
    spec = WEAPONS[w]
    return max(spec["floor"], 1 / (rate * (1 + spec["boost"]) * as_mult))


PACED = {fid: paced(FACTIONS[fid]) for fid in FACTIONS}


# One stack's value per type: the shipped table, times the tuning's per-stat reward multiplier (set_rewards).
REWARD_V = {tid: r["v"] for tid, r in REWARD.items()}


def set_rewards(mults: dict) -> None:
    for tid, r in REWARD.items():
        REWARD_V[tid] = r["v"] * mults.get(r["stat"], 1.0)


def stat_unit(stat: str) -> float:
    """One stack of the stat (every type paying it pays the same)."""
    return next(REWARD_V[t] for t, r in REWARD.items() if r["stat"] == stat)


def stats_of(counts: dict) -> dict:
    """Mob-kill stacks (type -> stacks) as bonus stats (shared/mobStats.ts mobStatRows: per-stack value x count)."""
    s = dict.fromkeys(STATS, 0.0)
    for tid, n in counts.items():
        s[REWARD[tid]["stat"]] += REWARD_V[tid] * n
    return s


@dataclass
class Player:
    """One player's numbers at a kit (shared sheet + mods.ts fold of the farm rows, sim/factions.ts hooks)."""
    faction: str
    weapon: str
    bonus: dict
    clears: int = 0
    bodies: int = 0

    def __post_init__(self) -> None:
        f = PACED[self.faction]
        b = self.bonus
        self.f = f
        self.base_hp = f["hp"]
        self.max_hp = f["hp"] * (1 + b["maxHp"] + C["PLAGUE_CORPSE_HP_SHARE"] * self.bodies)
        self.bonus_hp = self.max_hp - f["hp"]
        self.armor = f["armor"] + b["armor"]
        self.shield = f["shield"] + b["shield"]
        self.as_mult = 1 + b["attackSpeed"]
        self.dmg_mult = 1 + b["damage"]
        self.speed = C["PLAYER_SPEED"] * (1 + b["moveSpeed"])
        self.iv = interval(f["rate"], self.weapon, self.as_mult)
        self.farm_ls = b["lifesteal"] + (C["HOLY_CAMP_LIFESTEAL_PER_CLEAR"] * self.clears if self.faction == "holy" else 0.0)
        bdef = b["armor"] + b["shield"]
        w = WEAPONS[self.weapon]
        sc = w["scaling"]
        ad, ap = b["ad"], b["ap"]
        # weapons.ts damagePerHit x hits a second, and scalingDamage (the sword's dominant pick) x hits a second.
        self.base_dps = f["rate"] * f["hit"] * w["dpsMult"] * self.as_mult
        if w.get("dominant"):
            ap_side = ap * sc.get("ap", 0) > ad * sc.get("ad", 0)
            sp = (0 if ap_side else sc.get("ad", 0) * ad) + sc.get("hp", 0) * self.bonus_hp + sc.get("def", 0) * bdef
            sm = sc.get("ap", 0) * ap if ap_side else 0.0
        else:
            sp = sc.get("ad", 0) * ad + sc.get("hp", 0) * self.bonus_hp + sc.get("def", 0) * bdef
            sm = sc.get("ap", 0) * ap
        self.scale_phys = sp * self.as_mult
        self.scale_magic = sm * self.as_mult
        p = f["params"]
        self.burn = self.backlash = self.disease = self.execute = self.mark = 0.0
        if f["mechanic"] == "dragonslayer":
            self.burn = p["burn"] + C["FIRE_BURN_AD_RATIO"] * ad + C["AP_DOT_RATIO"] * ap
            self.backlash = p["backlash"] * (1 + C["FIRE_BACKLASH_PER_DEFENSE"] * bdef)
        elif f["mechanic"] == "rat_king":
            self.disease = p["plague"] + C["PLAGUE_AP_PER_HIT"] * ap / self.iv
            self.execute = p["execute"]
        elif f["mechanic"] == "marked":
            # shared/mark.ts markPct x markWeight per hit, x hits a second = mark_pct x farm scale x rate x dpsMult x asMult (per pool).
            self.mark = p["mark_pct"] * (1 + C["MARK_BONUS_STAT_PER_POINT"] * (ad + ap + bdef)) * f["rate"] * w["dpsMult"] * self.as_mult
        self.chill = 1.0  # what a Frost does to whoever it fights: everything they deal x this
        if f.get("aura") == "wall_of_ice":
            bonus = min(C["FROST_CHILL_BONUS_CAP"], C["FROST_CHILL_PER_SD"] * b["shield"] + C["FROST_CHILL_PER_ATTACK_SPEED"] * b["attackSpeed"])
            self.chill = 1 - p["slow"] - bonus
        # Plague's zombie (plagueCorpses.ts), one hit a second, physical, only with a body consumed.
        self.zombie = 0.0
        if self.bodies > 0:
            hit = C["PLAGUE_ZOMBIE_HIT_SHARE"] * self.max_hp + C["PLAGUE_ZOMBIE_HIT_PER_BONUS"] * self.bonus_hp + C["PLAGUE_ZOMBIE_AD_SHARE"] * ad
            self.zombie = min(C["PLAGUE_ZOMBIE_HIT_CAP_SHARE"] * self.max_hp, hit)

    def lifesteal(self, frac: float = 0.5) -> float:
        own = 0.0
        if self.f.get("sustain") == "radiant":
            p = self.f["params"]
            own = min(p["ls_cap"], p["ls0"] + p["ls1"] * (1 - frac))
        return min(C["LIFESTEAL_MAX"], own) + self.farm_ls

    def offense(self, armor: float, shield: float, pool: float, share: float, *, pvp: float, chill: float, attacks: bool):
        """(sustained mitigated dps on one target, the execute's coefficient, the weapon part that cleaves)."""
        f = self.f
        m = self.dmg_mult * pvp * chill
        ms = magic_share(f)
        weapon = mitig(self.base_dps * f["phys"], self.base_dps * ms, self.base_dps * f["trueShare"], armor, shield)
        weapon += mitig(self.scale_phys, self.scale_magic, 0, armor, shield)
        sig = mitig(self.backlash if attacks else 0.0, self.burn + self.disease, 0, armor, shield)
        sig += mitig(0.4 * self.mark * pool * share, 0.6 * self.mark * pool * share, 0, armor, shield)
        z = mitig(self.zombie * pvp, 0, 0, armor, shield)
        exe = mitig(0, self.execute, 0, armor, shield) * m
        return (weapon + sig) * m + z, exe, weapon * m


def ttk(h0: float, hmax: float, d: float, e: float) -> float:
    """Seconds to take hp h0 to 0 at net rate d, plus an execute e x (0.5 - hp/hmax) below half (closed form of its ODE)."""
    t, h = 0.0, h0
    if h > 0.5 * hmax:
        if d <= 0:
            return math.inf
        t += (h - 0.5 * hmax) / d
        h = 0.5 * hmax
    if e <= 0:
        return t + h / d if d > 0 else math.inf
    g0 = d + e * (0.5 - h / hmax)
    if g0 <= 0:
        return math.inf
    return t + hmax / e * math.log((d + 0.5 * e) / g0)


# ------------------------------------------------------------------------------------------------------------------ mobs ---
@dataclass(frozen=True)
class Tuning:
    hp_mult: float = 1.0      # on top of the shipped MOB_HP_MULT: time-to-kill
    stacks: float = 1.0       # on top of the shipped MOB_KILL_STACKS: reward per kill
    dmg_mult: float = 1.0     # on top of the shipped MOB_DMG_MULT: what a camp costs in hp
    reward: tuple = ()        # (stat, multiplier) pairs on one stack's value (shared/mobStats.ts REWARDS)
    const: tuple = ()         # (constant, value) pairs: a what-if for a faction hook (e.g. PLAGUE_ZOMBIE_HIT_PER_BONUS)

    def rewards(self) -> dict:
        return dict(self.reward)

    def label(self) -> str:
        r = ", ".join(f"{k} x{v:g}" for k, v in self.reward) or "-"
        c = "".join(f", {k} {v:g}" for k, v in self.const)
        return f"hp x{self.hp_mult:g}, stacks x{self.stacks:g}, mob damage x{self.dmg_mult:g}, rewards: {r}{c}"


_SHIPPED = dict(C)


def apply_tuning(tune: "Tuning") -> None:
    """The tuning's reward multipliers and constant what-ifs, on top of the shipped numbers (every worker calls it per job)."""
    C.clear()
    C.update(_SHIPPED)
    C.update(dict(tune.const))
    set_rewards(tune.rewards())


def mob_spec(tid: str, tune: Tuning) -> dict:
    s = paced(MOB[tid], C["DUEL_PACE"] * tune.dmg_mult)
    s["hit"] = MOB[tid]["hit"] * C["DUEL_PACE"] * tune.dmg_mult
    s["hp"] = MOB[tid]["hp"] * tune.hp_mult
    return s


def mob_dps_on(m: dict, tid: str, p: Player, focus: bool) -> float:
    """What one mob of a camp deals to the player a second (its weapon, its signature on the player, the player's chill on it)."""
    w = WEAPONS[MOB[tid]["weapon"]]
    base = m["rate"] * m["hit"] * w["dpsMult"]
    pm = m["params"]
    d = mitig(base * m["phys"], base * magic_share(m), base * m["trueShare"], p.armor, p.shield)
    if m["mechanic"] == "dragonslayer":
        d += mitig(pm["backlash"] if focus else 0.0, pm["burn"], 0, p.armor, p.shield)
    elif m["mechanic"] == "rat_king":
        d += mitig(0, pm["plague"], 0, p.armor, p.shield)  # the execute reads the player's hp under half: the safety margin avoids it
    elif m["mechanic"] == "marked":
        mark = pm["mark_pct"] * p.max_hp * m["rate"] * w["dpsMult"]
        d += mitig(0.4 * mark, 0.6 * mark, 0, p.armor, p.shield)
    return d * p.chill


@dataclass
class Fight:
    seconds: float
    cost: float          # net hp lost (damage taken - lifesteal - in-fight regen), can be negative
    deaths: list         # seconds into the fight at which each mob dies


def camp_fight(p: Player, tid: str, n: int, tune: Tuning) -> Fight:
    """A mono-type camp of n normals, all awake at the first hit (camp-wide aggro), killed one at a time while the arc cleaves."""
    m = mob_spec(tid, tune)
    zone = MOB[tid]["zone"]
    pool = FACTIONS[zone]["hp"]                         # sim/factions.ts markPool: a regional mob's mark reads its zone sheet's hp
    share = min(1.0, 1 / math.sqrt(n))                  # markMemberShare: a camp shares one mark
    chill = 1 - m["params"]["slow"] if m.get("aura") == "wall_of_ice" else 1.0
    d, e, weapon = p.offense(m["armor"], m["shield"], pool, share, pvp=1.0, chill=chill, attacks=True)
    ranged_mob = MOB[tid]["role"] == "caster" or MOB[tid]["weapon"] in ("bow", "wand")
    spill = 0.0 if ranged_mob else weapon * CLEAVE[p.weapon]
    hit_focus = mob_dps_on(m, tid, p, True) * HIT_CAL
    hit_other = mob_dps_on(m, tid, p, False) * HIT_CAL
    mob_heal = 0.0
    if m.get("sustain") == "radiant":                    # a Holy mob heals from what it deals (its own share at half hp)
        mob_heal = min(m["params"]["ls_cap"], m["params"]["ls0"] + 0.5 * m["params"]["ls1"]) * hit_focus
    hmax = m["hp"]
    hp = [hmax] * n
    t = taken = 0.0
    deaths = []
    for j in range(n):
        tj = ttk(hp[j], hmax, d - mob_heal, e)
        if not math.isfinite(tj):
            return Fight(math.inf, math.inf, [])
        for k in range(j + 1, n):
            hp[k] = max(0.05 * hmax, hp[k] - spill * tj)
        alive = n - j
        taken += tj * (hit_focus + (alive - 1) * hit_other)
        t += tj
        deaths.append(t)
    # Holy's own lifesteal reads its hp: a camp is fought from near full, so it is read at the mean hp of the fight without it.
    frac = max(0.3, 1 - 0.5 * taken / p.max_hp)
    healed = p.lifesteal(frac) * hmax * n + C["PLAYER_REGEN_SHARE_IN"] * p.max_hp * t
    return Fight(t, taken - healed, deaths)


# ------------------------------------------------------------------------------------------------------------------ duels ---
LOGSD = NOISE * math.sqrt(2)


# Only a true stall (lifesteal and regen out-heal the damage) is capped. A shorter cap flattens the score: a fresh player that cannot
# kill a fed field inside the cap would read every offensive stat as worth 0 and farm defence alone.
DUEL_CAP = 600.0


def time_to_kill(a: Player, b: Player) -> float:
    """Seconds a needs to kill b in a straight duel: a's damage (PvP factor, b's chill on it, the execute under half) against b's
    lifesteal on what b deals to a (Holy's share grows as its hp falls, so it is integrated over b's hp) and b's in-fight regen."""
    pvp = C["PVP_F0"]
    d, e, _ = a.offense(b.armor, b.shield, b.max_hp, 1.0, pvp=pvp, chill=b.chill, attacks=True)
    bd, _, _ = b.offense(a.armor, a.shield, a.max_hp, 1.0, pvp=pvp, chill=a.chill, attacks=True)
    regen = C["PLAYER_REGEN_SHARE_IN"] * b.max_hp
    steps = 32
    dh = b.max_hp / steps
    t = 0.0
    for i in range(steps):
        frac = 1 - (i + 0.5) / steps
        rate = d + e * max(0.0, 0.5 - frac) - b.lifesteal(frac) * bd - regen
        if rate <= 0:
            return DUEL_CAP
        t += dh / rate
        if t >= DUEL_CAP:
            return DUEL_CAP
    return t


def duel_power(a: Player, b: Player) -> float:
    """log(time b needs to kill a / time a needs to kill b): > 0 wins; win % under the noise model = Phi(power / LOGSD)."""
    return math.log(time_to_kill(b, a) / time_to_kill(a, b))


def win_pct(power: float) -> float:
    return 50 * (1 + math.erf(power / LOGSD / math.sqrt(2)))


class Field:
    """The ten reference opponents (five factions x their two build weapons) with one shared bonus kit."""

    def __init__(self, kit: dict):
        self.opps = [Player(f, BUILD_WEAPON[g["id"]], kit, bodies=BUILD_BODIES.get(g["id"], 0)) for f, g in BUILDS]

    def power(self, p: Player) -> float:
        return sum(duel_power(p, o) for o in self.opps) / len(self.opps)


# ----------------------------------------------------------------------------------------------------------- value lenses ---
def design_weight(goal: dict, tid: str) -> float:
    """bots/brain/buildRoute.ts typeWeight: the build's weight for the type's stat, never under STAT_FLOOR."""
    return max(C["STAT_FLOOR"], goal["weights"].get(REWARD[tid]["stat"], 0.0))


class Lens:
    name = ""

    def kit_value(self, counts: dict, clears: int) -> float: ...

    def kill_values(self, run: "Run") -> dict: ...


class DesignLens(Lens):
    """Weighted stacks: a stack of a stat the build weights 1 is worth 1, an unwanted one STAT_FLOOR (0.25)."""
    name = "design"

    def __init__(self, goal: dict):
        self.w = {tid: design_weight(goal, tid) for tid in REWARD}

    def kit_value(self, counts, clears):
        return sum(self.w[t] * n for t, n in counts.items())

    def kill_values(self, run):
        return {t: self.w[t] * run.stack_per_kill for t in REWARD}


class CombatLens(Lens):
    """Duel power against the field, in log units; a kill's value is the gradient of it (refreshed every decision) times its stacks."""
    name = "combat"

    def __init__(self, faction: str, weapon: str, bodies: int, field_: Field):
        self.faction, self.weapon, self.bodies, self.field = faction, weapon, bodies, field_
        self.zero = field_.power(Player(faction, weapon, dict.fromkeys(STATS, 0.0), bodies=bodies))

    def player(self, counts: dict, clears: int = 0) -> Player:
        return Player(self.faction, self.weapon, stats_of(counts), clears, self.bodies)

    def kit_value(self, counts, clears):
        return self.field.power(self.player(counts, clears)) - self.zero

    def kill_values(self, run):
        base = self.player(run.counts, run.clears)
        p0 = self.field.power(base)
        grad = {}
        for s in STATS:
            # one kill's worth of the stat, as a finite difference on the current kit (diminishing returns included)
            step = dict(base.bonus)
            unit = stat_unit(s) * run.stack_per_kill
            step[s] += unit
            grad[s] = self.field.power(Player(self.faction, self.weapon, step, run.clears, self.bodies)) - p0
        out = {t: grad[REWARD[t]["stat"]] for t in REWARD}
        if self.faction == "holy":  # a Holy camp clear adds lifesteal whatever the type: spread over a camp's kills
            step = dict(base.bonus)
            grad_clear = self.field.power(Player(self.faction, self.weapon, step, run.clears + 1, self.bodies)) - p0
            out = {t: v + grad_clear / 4 for t, v in out.items()}
        return out


# -------------------------------------------------------------------------------------------------------------- the maps ---
def roll_roster(m: dict, rng: random.Random) -> list:
    """shared/rosters.ts rollZoneTypes: per zone BAG_COPIES shuffled rounds of its four normal types, dealt to its camps in order."""
    out = [None] * len(m["camps"])
    by_zone: dict = {}
    for i, c in enumerate(m["camps"]):
        by_zone.setdefault(c["zone"], []).append(i)
    for zone, idx in by_zone.items():
        bag = []
        for _ in range(C["BAG_COPIES"]):
            r = list(NORMALS[zone])
            rng.shuffle(r)
            bag += r
        for k, i in enumerate(idx):
            out[i] = bag[k % len(bag)]
    return out


@dataclass
class Run:
    """One player's farming run on one map: the state every strategy reads and the log it writes."""
    m: dict
    roster: list
    faction: str
    weapon: str
    bodies: int
    tune: Tuning
    cannons: bool
    start: int
    shared: tuple | None = None  # (camp ready times, cannon ready times) shared by a lobby's players
    t: float = 0.0
    at: int = -1                 # camp index, -1 = still on its spawn
    hp: float = 0.0
    potions: int = 0
    clears: int = 0
    counts: dict = field(default_factory=dict)
    ready: list = field(default_factory=list)
    cannon_ready: list = field(default_factory=list)
    log: list = field(default_factory=list)        # (time, type) of every kill
    clear_log: list = field(default_factory=list)  # time of every camp clear
    walked: float = 0.0
    rested: float = 0.0
    fought: float = 0.0
    camps: int = 0
    skipped_nearest: int = 0
    detour: float = 0.0          # seconds the chosen camps took to reach beyond the nearest farmable camp, summed
    off_near: int = 0            # decisions whose nearest farmable camp was off the build (a stat it weights under ON_BUILD)
    build_better: int = 0        # ... of which a build camp, walked to, paid more of the build's value per second than the nearest

    def __post_init__(self) -> None:
        if self.shared is None:
            self.shared = ([0.0] * len(self.m["camps"]), [0.0] * len(self.m["cannons"]))
        self.ready, self.cannon_ready = self.shared
        self.stack_per_kill = C["MOB_KILL_STACKS"] * self.tune.stacks
        self.hp = self.player().max_hp

    def kit_key(self) -> tuple:
        return (self.faction, self.weapon, self.bodies, tuple(sorted(self.counts.items())), self.clears if self.faction == "holy" else 0)

    def player(self) -> Player:
        key = self.kit_key()
        p = _PLAYERS.get(key)
        if p is None:
            p = _PLAYERS[key] = Player(self.faction, self.weapon, stats_of(self.counts), self.clears, self.bodies)
        return p

    def walk(self, frm: int, to: int) -> float:
        if frm < 0:
            return self.m["spawnWalk"][self.start][to]
        return self.m["campWalk"][frm][to]

    def travel(self, to: int, speed: float) -> tuple:
        """Seconds to reach camp `to` now, and the cannon used (-1 none): a cannon is walk to it, a blast, walk from its landing."""
        best = self.walk(self.at, to) / speed
        used = -1
        if self.cannons and self.at >= 0:
            cw = self.m["cannonWalk"]
            for i, can in enumerate(self.m["cannons"]):
                to_site = cw[i][self.at] / speed
                if self.cannon_ready[i] > self.t + to_site:
                    continue
                t = to_site + cw[can["to"]][to] / speed
                if t < best:
                    best, used = t, i
        return best, used

    def fight(self, camp: int) -> Fight:
        tid, n = self.roster[camp], self.m["camps"][camp]["spots"]
        key = (self.kit_key(), self.tune, tid, n)
        cached = _FIGHTS.get(key)
        if cached is None:
            cached = _FIGHTS[key] = camp_fight(self.player(), tid, n, self.tune)
        return cached

    def recover(self, hp: float, potions: int, seconds: float, mh: float) -> tuple:
        """Walking or resting: a camp potion whenever 40% is missing, then regen once out of combat for PLAYER_REGEN_QUIET_MS."""
        while potions > 0 and mh - hp >= C["POTION_LARGE_SHARE"] * mh:
            hp += C["POTION_LARGE_SHARE"] * mh
            potions -= 1
        quiet = max(0.0, seconds - C["PLAYER_REGEN_QUIET_MS"] / 1000)
        return min(mh, hp + C["PLAYER_REGEN_SHARE_OUT"] * mh * quiet), potions

    def plan(self, camp: int, p: Player):
        """(seconds until the camp is done, its fight, travel, wait, rest, cannon) or None when it cannot be farmed now."""
        if self.m["camps"][camp]["elite"]:
            return None
        f = self.fight(camp)
        mh = p.max_hp
        if not math.isfinite(f.seconds) or f.cost > MAX_COST * mh:
            return None
        trav, can = self.travel(camp, p.speed)
        wait = max(0.0, self.ready[camp] - (self.t + trav))
        hp, pots = self.recover(self.hp, self.potions, trav + wait, mh)
        need = max(0.0, f.cost) + SAFETY * mh
        rest = 0.0
        if hp < need:
            rest = (need - hp) / (C["PLAYER_REGEN_SHARE_OUT"] * mh) + C["PLAYER_REGEN_QUIET_MS"] / 1000
        return trav + wait + rest + f.seconds, f, trav, wait, rest, can

    def commit(self, camp: int, plan) -> None:
        total, f, trav, wait, rest, can = plan
        p = self.player()
        mh = p.max_hp
        if can >= 0:
            self.cannon_ready[can] = self.t + C["CANNON_COOLDOWN_MS"] / 1000
        self.hp, self.potions = self.recover(self.hp, self.potions, trav + wait + rest, mh)
        start = self.t + trav + wait + rest
        tid = self.roster[camp]
        for dt in f.deaths:
            self.log.append((start + dt, tid))
            self.counts[tid] = self.counts.get(tid, 0) + self.stack_per_kill
        self.hp = min(self.player().max_hp, self.hp - f.cost)
        self.potions = min(5, self.potions + 1)
        self.clears += 1
        self.clear_log.append(start + f.seconds)
        self.ready[camp] = start + f.seconds + C["CAMP_RESPAWN_MS"] / 1000
        self.walked += trav
        self.rested += wait + rest
        self.fought += f.seconds
        self.camps += 1
        self.t = start + f.seconds
        self.at = camp

    def counts_at(self, horizon: float) -> dict:
        out: dict = {}
        for t, tid in self.log:
            if t <= horizon:
                out[tid] = out.get(tid, 0) + self.stack_per_kill
        return out

    def kills_at(self, horizon: float) -> int:
        return sum(1 for t, _ in self.log if t <= horizon)

    def clears_at(self, horizon: float) -> int:
        return sum(1 for t in self.clear_log if t <= horizon)


_PLAYERS: dict = {}
_FIGHTS: dict = {}


# ----------------------------------------------------------------------------------------------------------- strategies ---
def candidates(run: Run):
    p = run.player()
    out = []
    for c in range(len(run.m["camps"])):
        pl = run.plan(c, p)
        if pl is not None:
            out.append((c, pl))
    return out


def nearest_choice(run: Run, cands):
    """The camp it reaches (and can start) soonest: walk plus any wait for the respawn, never its value."""
    return min(cands, key=lambda cp: (cp[1][2] + cp[1][3], cp[0]))


def camp_value(run: Run, values: dict, camp: int, f: Fight) -> float:
    return values[run.roster[camp]] * len(f.deaths)


def targeted_choice(run: Run, cands, lens: Lens, k: int = 8):
    """Value per second with a one-camp lookahead: the first camp of the best pair (v1 + v2) / (t1 + t2)."""
    values = lens.kill_values(run)
    scored = sorted(((camp_value(run, values, c, pl[1]) / pl[0], c, pl) for c, pl in cands), key=lambda x: (-x[0], x[1]))
    best, best_score = scored[0], -math.inf
    for s1, c1, pl1 in scored[:k]:
        nxt = clone(run)
        nxt.commit(c1, pl1)
        v1 = camp_value(run, values, c1, pl1[1])
        two = -math.inf
        p2 = nxt.player()
        for s2, c2, pl2 in scored[: 2 * k]:
            if c2 == c1:
                continue
            q = nxt.plan(c2, p2)
            if q is None:
                continue
            two = max(two, (v1 + camp_value(run, values, c2, q[1])) / (pl1[0] + q[0]))
        score = two if math.isfinite(two) else s1
        if score > best_score:
            best, best_score = (s1, c1, pl1), score
    return best[1], best[2]


def onbuild_choice(run: Run, cands, goal: dict):
    """A player's rule of thumb: the nearest camp whose stat the build weights 0.6 or more, else simply the nearest."""
    good = [cp for cp in cands if design_weight(goal, run.roster[cp[0]]) >= 0.6]
    return nearest_choice(run, good or cands)


def clone(run: Run) -> Run:
    r = Run.__new__(Run)
    r.__dict__.update(run.__dict__)
    r.counts = dict(run.counts)
    r.ready = list(run.ready)
    r.cannon_ready = list(run.cannon_ready)
    r.log = list(run.log)
    r.clear_log = list(run.clear_log)
    return r


def greedy_choice(run: Run, cands, lens: Lens):
    """The fill bots' rule (bots/brain/buildRoute.ts plan, its first step): the camp of the most value per second, no lookahead."""
    values = lens.kill_values(run)
    return max(cands, key=lambda cp: (camp_value(run, values, cp[0], cp[1][1]) / cp[1][0], -cp[0]))


def decide(run: Run, strategy: str, lens: Lens | None, goal: dict) -> None:
    """One decision: pick a camp by the strategy and play it out (or idle five seconds when nothing can be farmed)."""
    cands = candidates(run)
    if not cands:
        run.hp, run.potions = run.recover(run.hp, run.potions, 5.0, run.player().max_hp)
        run.t += 5.0
        run.rested += 5.0
        return
    near = nearest_choice(run, cands)
    if goal is not None and design_weight(goal, run.roster[near[0]]) < ON_BUILD:
        # In-game, one decision: walk on to the best build camp, or take the off-build camp at hand? By the build's value a second,
        # with this moment's walks, respawn waits, rests and the player's own kit.
        w = DesignLens(goal).w
        rate = lambda cp: w[run.roster[cp[0]]] * len(cp[1][1].deaths) / cp[1][0]
        build = [cp for cp in cands if w[run.roster[cp[0]]] >= ON_BUILD]
        run.off_near += 1
        if build and max(rate(cp) for cp in build) > rate(near):
            run.build_better += 1
    if strategy == "nearest":
        c, pl = near
    elif strategy == "onbuild":
        c, pl = onbuild_choice(run, cands, goal)
    elif strategy == "greedy":
        c, pl = greedy_choice(run, cands, lens)
    else:
        c, pl = targeted_choice(run, cands, lens)
    if c != near[0]:
        run.skipped_nearest += 1
        run.detour += (pl[2] + pl[3]) - (near[1][2] + near[1][3])
    run.commit(c, pl)


def simulate(run: Run, strategy: str, horizon: float, lens: Lens | None, goal: dict) -> Run:
    while run.t < horizon:
        decide(run, strategy, lens, goal)
    return run


def simulate_lobby(players: list, horizon: float) -> None:
    """Players (run, strategy, lens, goal) sharing one map's camps: whoever is due decides next, so a camp one of them commits to
    is cleared (and respawning) for everyone who decides after, as two players heading for one camp would find it."""
    heap = [(r.t, i) for i, (r, *_rest) in enumerate(players)]
    heapq.heapify(heap)
    while heap:
        _, i = heapq.heappop(heap)
        r, strategy, lens, goal = players[i]
        if r.t >= horizon:
            continue
        decide(r, strategy, lens, goal)
        heapq.heappush(heap, (r.t, i))


def beam(run0: Run, horizon: float, lens: Lens, width: int = 24, branch: int = 6) -> Run:
    """Beam search over whole routes by the lens's kit value at the horizon (the best route found: an upper reference)."""
    beams = [run0]
    done: list = []
    while beams:
        nxt = []
        for run in beams:
            if run.t >= horizon:
                done.append(run)
                continue
            cands = candidates(run)
            if not cands:
                r = clone(run)
                r.hp, r.potions = r.recover(r.hp, r.potions, 5.0, r.player().max_hp)
                r.t += 5.0
                nxt.append(r)
                continue
            values = lens.kill_values(run)
            near = nearest_choice(run, cands)
            ranked = sorted(cands, key=lambda cp: -camp_value(run, values, cp[0], cp[1][1]) / cp[1][0])[:branch]
            if near not in ranked:
                ranked.append(near)
            for c, pl in ranked:
                r = clone(run)
                if c != near[0]:
                    r.skipped_nearest += 1
                    r.detour += (pl[2] + pl[3]) - (near[1][2] + near[1][3])
                r.commit(c, pl)
                nxt.append(r)
        # rank partial routes by value banked so far plus the value rate they are on, so a route is not judged by its clock alone
        def key(r: Run) -> float:
            return lens.kit_value(r.counts_at(horizon), r.clears_at(horizon)) / max(1.0, min(r.t, horizon))
        nxt.sort(key=key, reverse=True)
        beams = nxt[:width]
    return max(done, key=lambda r: lens.kit_value(r.counts_at(horizon), r.clears_at(horizon)))


# -------------------------------------------------------------------------------------------------------------- the work ---
LOBBY = 8  # every game is an 8-player game (BOTS_FILL_TO 8): the focal player and seven fill bots


def one_job(args):
    """Every strategy of one focal build in one lobby (map, roster, starts and the seven others fixed by the map and roster index),
    or alone on the map (`solo`). The others are fill bots farming their own drawn build by value per second (others = "bots"),
    or players who farm the nearest camp (others = "nearest")."""
    fac, goal, mi, ri, tune, horizon, cannons, field_kit, do_beam, others_mode, lobby = args
    apply_tuning(tune)
    _PLAYERS.clear()
    _FIGHTS.clear()
    m = DATA["maps"][mi]
    rng = random.Random(1000003 * mi + 7919 * ri + 13)
    roster = roll_roster(m, rng)
    size = 1 if others_mode == "solo" else lobby
    starts = rng.sample(range(len(m["spawns"])), LOBBY)[:size]
    others = [BUILDS[rng.randrange(len(BUILDS))] for _ in range(LOBBY - 1)][: size - 1]
    weapon = BUILD_WEAPON[goal["id"]]
    bodies = BUILD_BODIES.get(goal["id"], 0)
    design = DesignLens(goal)
    combat = CombatLens(fac, weapon, bodies, Field(field_kit)) if field_kit is not None else None
    out = {}
    plans = [("nearest", None)]
    if combat is not None:
        plans += [("onbuild", None), ("targeted:design", design), ("targeted:combat", combat)]
    for name, lens in plans:
        shared = ([0.0] * len(m["camps"]), [0.0] * len(m["cannons"]))
        focal = Run(m, roster, fac, weapon, bodies, tune, cannons, starts[0], shared)
        players = [(focal, name.split(":")[0], lens, goal)]
        for k, (of, og) in enumerate(others):
            r = Run(m, roster, of, BUILD_WEAPON[og["id"]], BUILD_BODIES.get(og["id"], 0), tune, cannons, starts[k + 1], shared)
            players.append((r, "greedy" if others_mode == "bots" else "nearest", DesignLens(og), og))
        simulate_lobby(players, horizon)
        out[name] = summarize(focal, horizon, design, combat)
        if name == "nearest":
            out["lobby_kits"] = [stats_of(r.counts_at(horizon)) for r, *_rest in players]
            out["lobby_kills"] = [r.kills_at(horizon) for r, *_rest in players]
    if do_beam and others_mode == "solo":
        base = Run(m, roster, fac, weapon, bodies, tune, cannons, starts[0])
        out["best:design"] = summarize(beam(base, horizon, design), horizon, design, combat)
    return (fac, goal["id"], mi, ri, out)


def clone_fresh(run: Run) -> Run:
    return Run(run.m, run.roster, run.faction, run.weapon, run.bodies, run.tune, run.cannons, run.start)


def summarize(r: Run, horizon: float, design: DesignLens, combat: CombatLens | None) -> dict:
    res = {"walked": r.walked, "rested": r.rested, "fought": r.fought, "camps": r.camps, "skipped": r.skipped_nearest,
           "kills": len(r.log), "detour": r.detour, "off_near": r.off_near, "build_better": r.build_better}
    for h in (horizon / 2, horizon):
        counts = r.counts_at(h)
        res[f"kills@{h:g}"] = r.kills_at(h)
        res[f"clears@{h:g}"] = r.clears_at(h)
        res[f"design@{h:g}"] = design.kit_value(counts, r.clears_at(h))
        res[f"counts@{h:g}"] = counts
        if combat is not None:
            res[f"combat@{h:g}"] = combat.kit_value(counts, r.clears_at(h))
    return res


def run_all(builds, maps, rosters, tune, horizon, cannons, field_kit, beam_maps, jobs, others_mode, lobby=LOBBY):
    work = [(f, g, mi, ri, tune, horizon, cannons, field_kit, mi < beam_maps and ri == 0, others_mode, lobby)
            for f, g in builds for mi in range(maps) for ri in range(rosters)]
    if jobs > 1:
        with ProcessPoolExecutor(jobs) as ex:
            return list(ex.map(one_job, work, chunksize=2))
    return [one_job(w) for w in work]


def field_kit_from(results, horizon: float) -> dict:
    """The field: the average bonus stats of every player of every lobby (the focal player farming the nearest camp) at the horizon."""
    tot = dict.fromkeys(STATS, 0.0)
    n = 0
    for _, _, _, _, out in results:
        for s in out["lobby_kits"]:
            for k in STATS:
                tot[k] += s[k]
            n += 1
    return {k: v / n for k, v in tot.items()}


# ------------------------------------------------------------------------------------------------------------- reports ---
def mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs) if xs else float("nan")


def map_facts(maps: int) -> None:
    print("## 1. Map facts (walk field over the move mask, at base speed %d u/s)" % C["PLAYER_SPEED"])
    near, pair, per_type, spawn_near = [], [], [], []
    rng = random.Random(5)
    for mi in range(maps):
        m = DATA["maps"][mi]
        W = m["campWalk"]
        normal = [i for i, c in enumerate(m["camps"]) if not c["elite"]]
        for i in normal:
            near.append(min(W[i][j] for j in normal if j != i))
            pair += [W[i][j] for j in normal if j != i]
        roster = roll_roster(m, rng)
        for i in normal:
            for tid in REWARD:
                d = [W[i][j] for j in normal if j != i and roster[j] == tid]
                if d:
                    per_type.append(min(d))
        for s in range(len(m["spawns"])):
            spawn_near.append(min(m["spawnWalk"][s][j] for j in normal))
    sp = C["PLAYER_SPEED"]
    print(f"- normal camps a map: {sum(1 for c in DATA['maps'][0]['camps'] if not c['elite'])} (plus 10 elite camps, left out: they pay augments, not stats)")
    print(f"- spawn to nearest normal camp: {mean(spawn_near):.0f} u = {mean(spawn_near) / sp:.1f} s")
    print(f"- camp to nearest other normal camp: {mean(near):.0f} u = {mean(near) / sp:.1f} s (median {st.median(near) / sp:.1f} s)")
    print(f"- camp to nearest camp of one given type (20 types, 2-3 camps each a map): {mean(per_type):.0f} u = {mean(per_type) / sp:.1f} s")
    print(f"- camp to a random normal camp: {mean(pair):.0f} u = {mean(pair) / sp:.1f} s")
    print()


def ttk_table(tune: Tuning) -> None:
    print("## 2. Time to kill (model): a fresh player on its build weapon against a 4-mob camp of each type, seconds · hp cost")
    print("Real sim for scale (bench/campDuel.ts --pulls camp --weapon sig, fresh starters on the signature weapon, 4-mob camps, same")
    print("numbers): 5-45 s a camp and 15-85% of max hp; the model below is the same order on the same sheet.")
    print()
    hdr = "| build (weapon) | " + " | ".join(f"{z}" for z in FACTION_IDS) + " | mean s | mean hp |"
    print(hdr)
    print("|" + "---|" * (len(FACTION_IDS) + 3))
    for f, g in BUILDS:
        p = Player(f, BUILD_WEAPON[g["id"]], dict.fromkeys(STATS, 0.0), bodies=BUILD_BODIES.get(g["id"], 0))
        cells, ss, hs = [], [], []
        for z in FACTION_IDS:
            fs = [camp_fight(p, tid, 4, tune) for tid in NORMALS[z]]
            s = mean(x.seconds for x in fs)
            h = mean(x.cost for x in fs) / p.max_hp
            ss.append(s)
            hs.append(h)
            cells.append(f"{s:.0f}s · {100 * h:.0f}%")
        print(f"| {g['id']} ({BUILD_WEAPON[g['id']]}) | " + " | ".join(cells) + f" | {mean(ss):.0f} | {100 * mean(hs):.0f}% |")
    print()


def per_kill_combat(f: str, g: dict, kit: dict, own: dict | None = None) -> dict:
    """Duel power one kill of each stat adds to a build holding `own` (default `kit`), against the field holding `kit`."""
    field_ = Field(kit)
    own = kit if own is None else own
    w, b = BUILD_WEAPON[g["id"]], BUILD_BODIES.get(g["id"], 0)
    p0 = field_.power(Player(f, w, dict(own), bodies=b))
    out = {}
    for st_ in STATS:
        k = dict(own)
        k[st_] += stat_unit(st_) * C["MOB_KILL_STACKS"]
        out[st_] = field_.power(Player(f, w, k, bodies=b)) - p0
    return out


ON_BUILD = 0.6  # a stat the build weights this much or more is one of its stats (the onbuild rule)


def breakeven(maps: int, tune: Tuning, kit: dict | None = None, report: bool = True, own: dict | None = None) -> dict:
    """Per decision, from every normal camp whose nearest neighbour is OFF the build (a stat it weights under ON_BUILD): is the
    nearest camp of one of the build's stats worth the walk past it? By the build's weights (design) and by what the kills add to
    duel power (combat: the build holding its own farmed kit `own[build]`, the field holding `kit`)."""
    if report:
        print("## 3. Break-even detour (analytic, one decision at a time)")
        print("The decision: the camp next to you is not for your build; is walking on to the nearest camp that is worth it? From a camp,")
        print("the build camp b beats the nearest camp n iff v_b/(w_b + c_b) > v_n/(w_n + c_n). With equal clears that is:")
        print("extra walk < (r - 1) x (w_n + c), r = v_b / v_n. Rewards that scale both v's alike cancel; time-to-kill c moves the line.")
        print("v counts the camp's mobs; a fresh player, every camp up. 'design' values kills by the build's weights, 'combat' by what")
        print("they add to duel power for the build holding the kit its routed player ends with, against the field.")
        print()
        print("| build | r (design) | nearest cycle w_n + c (s) | affordable extra walk (s) | actual extra walk to its nearest build camp (s) | pays (design) | pays (combat) |")
        print("|---|---|---|---|---|---|---|")
    rng = random.Random(11)
    out = {}
    for f, g in BUILDS:
        p = Player(f, BUILD_WEAPON[g["id"]], dict.fromkeys(STATS, 0.0), bodies=BUILD_BODIES.get(g["id"], 0))
        cv = per_kill_combat(f, g, kit, (own or {}).get(g["id"])) if kit is not None else None
        rs, cyc, extra, ok, okc = [], [], [], [], []
        for mi in range(maps):
            m = DATA["maps"][mi]
            roster = roll_roster(m, rng)
            W = m["campWalk"]
            normal = [i for i, c in enumerate(m["camps"]) if not c["elite"]]
            fights = {i: camp_fight(p, roster[i], m["camps"][i]["spots"], tune) for i in normal}
            for i in normal:
                others = [j for j in normal if j != i and math.isfinite(fights[j].seconds)]
                n = min(others, key=lambda j: W[i][j])
                if design_weight(g, roster[n]) >= ON_BUILD:
                    continue  # the nearest camp is already one of the build's: there is no walk to decide
                want = [j for j in others if design_weight(g, roster[j]) >= ON_BUILD]
                if not want:
                    continue
                b = min(want, key=lambda j: W[i][j])
                vn = design_weight(g, roster[n]) * m["camps"][n]["spots"]
                vb = design_weight(g, roster[b]) * m["camps"][b]["spots"]
                wn, wb = W[i][n] / p.speed, W[i][b] / p.speed
                cn, cb = fights[n].seconds, fights[b].seconds
                rs.append(vb / vn)
                cyc.append(wn + cn)
                extra.append(wb - wn)
                ok.append(vb / (wb + cb) >= vn / (wn + cn))
                if cv is not None:
                    cvn = cv[REWARD[roster[n]]["stat"]] * m["camps"][n]["spots"]
                    cvb = cv[REWARD[roster[b]]["stat"]] * m["camps"][b]["spots"]
                    okc.append(cvb / (wb + cb) >= cvn / (wn + cn))
        afford = (mean(rs) - 1) * mean(cyc)
        out[g["id"]] = (mean(ok), mean(okc) if okc else float("nan"))
        if report:
            print(f"| {g['id']} | {mean(rs):.2f} | {mean(cyc):.1f} | {afford:.1f} | {mean(extra):.1f} | {100 * mean(ok):.0f}% | "
                  f"{100 * out[g['id']][1]:.0f}% |")
    if report:
        print()
    return out


def damage_mix(a: Player, b: Player) -> float:
    """The physical share of what a deals to b, raw (the execute counted at its mean over a kill)."""
    phys = a.base_dps * a.f["phys"] + a.scale_phys + a.backlash + 0.4 * a.mark * b.max_hp + a.zombie
    mag = a.base_dps * magic_share(a.f) + a.scale_magic + a.burn + a.disease + 0.6 * a.mark * b.max_hp + 0.125 * a.execute
    return phys / max(1e-9, phys + mag)


def defense_counter_table(results, horizon: float) -> None:
    """Defense and Soul Defense as counters: one kill of each against a max-health kill and against the best other kill, for a player
    holding its nearest-farmer kit, facing builds that deal >= 70% physical (Offense builds) or <= 40% (Soul Offence builds) with the
    kits their routes end with, and facing all of them at once (the field). A counter beats max health against its damage type and
    does not beat the generic kills against the field (else it is farmed at random)."""
    def kit_of(gid: str, strat: str) -> tuple:
        rows = [out[strat] for _, g, _, _, out in results if g == gid]
        stats = [stats_of(r[f"counts@{horizon:g}"]) for r in rows]
        return {k: mean(x[k] for x in stats) for k in STATS}, round(mean(r[f"clears@{horizon:g}"] for r in rows))
    opps = []
    for fo, go in BUILDS:
        k, cl = kit_of(go["id"], "targeted:design")
        opps.append(Player(fo, BUILD_WEAPON[go["id"]], k, cl, BUILD_BODIES.get(go["id"], 0)))
    print("## 3c. Defense and Soul Defense as counters (one kill of it, against one kill of max health / of the best other stat)")
    print()
    print("| you (nearest-farmer kit) | Defense vs Offense builds | Soul Def. vs Soul Offence builds | Defense vs the field | Soul Def. vs the field |")
    print("|---|---|---|---|---|")
    for f, g in BUILDS:
        k, cl = kit_of(g["id"], "nearest")
        w, b = BUILD_WEAPON[g["id"]], BUILD_BODIES.get(g["id"], 0)
        me = Player(f, w, k, cl, b)
        gains = []
        for o in opps:
            p0 = duel_power(me, o)
            d = {}
            for st_ in STATS:
                k2 = dict(k)
                k2[st_] += stat_unit(st_) * C["MOB_KILL_STACKS"]
                d[st_] = duel_power(Player(f, w, k2, cl, b), o) - p0
            gains.append((damage_mix(o, me), d))

        def ratio(sel, stat: str) -> str:
            ds = [d for ph, d in gains if sel(ph)]
            if not ds:
                return "-"
            m = {s_: mean(d[s_] for d in ds) for s_ in STATS}
            best = max(m[s_] for s_ in STATS if s_ not in ("armor", "shield"))
            return f"{m[stat] / m['maxHp']:.2f} / {m[stat] / best:.2f}" if m["maxHp"] > 0 and best > 0 else "-"
        print(f"| {g['id']} | {ratio(lambda ph: ph >= 0.7, 'armor')} | {ratio(lambda ph: ph <= 0.4, 'shield')} | "
              f"{ratio(lambda ph: True, 'armor')} | {ratio(lambda ph: True, 'shield')} |")
    print()


def kill_value_table(kit: dict) -> None:
    """What one kill of each stat is worth to each build (combat lens, at the field's kit), and the mob types it should farm."""
    field_ = Field(kit)
    print("## 3b. What one kill is worth to each build (combat lens, a player holding the field's kit; 100 = the build's best stat)")
    print()
    print("| build | " + " | ".join(STATS) + " | best mob types (stat) |")
    print("|---|" + "---|" * (len(STATS) + 1))
    for f, g in BUILDS:
        w, b = BUILD_WEAPON[g["id"]], BUILD_BODIES.get(g["id"], 0)
        p0 = field_.power(Player(f, w, dict(kit), bodies=b))
        row = {}
        for st_ in STATS:
            k = dict(kit)
            k[st_] += stat_unit(st_) * C["MOB_KILL_STACKS"]
            row[st_] = field_.power(Player(f, w, k, bodies=b)) - p0
        top = max(row.values())
        ranked = sorted(REWARD, key=lambda t: -row[REWARD[t]["stat"]])
        best = ", ".join(f"{MOB[t]['name']}" for t in ranked[:5])
        print(f"| {g['id']} ({w}) | " + " | ".join(f"{100 * row[x] / top:.0f}" for x in STATS) + f" | {best} |")
    print()


def verdict_table(results, horizon: float, has_combat: bool, has_beam: bool) -> dict:
    by = {}
    for fac, gid, mi, ri, out in results:
        by.setdefault(gid, []).append(out)
    h2, h = f"{horizon / 2:g}", f"{horizon:g}"
    print(f"## 4. Route simulation: value banked at {h2} s and {h} s (mean over maps x rosters x random starts)")
    print("design = weighted stacks (1 per wanted stack, 0.25 per unwanted); combat = duel power vs the field in log units")
    print("(+0.10 is about +4.5 win points against it). 'walk/kill' is seconds walked per kill; 'skip' how often the plan passed the")
    print("nearest camp. h2h = targeted (combat lens) against nearest, same faction and weapon, win % under the noise model.")
    print()
    cols = ["nearest", "onbuild", "targeted:design"] + (["targeted:combat"] if has_combat else []) + (["best:design"] if has_beam else [])
    print("| build | strategy | kills@%s | kills@%s | design@%s | design@%s | combat@%s | combat@%s | walk/kill | rest+wait s | skip | detour s/skip |" % (h2, h, h2, h, h2, h, ))
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    verdict = {}
    for f, g in BUILDS:
        rows = by.get(g["id"], [])
        if not rows:
            continue
        for col in cols:
            rs = [o[col] for o in rows if col in o]
            if not rs:
                continue
            kills = mean(r[f"kills@{h}"] for r in rs)
            walk_k = mean(r["walked"] for r in rs) / max(1e-9, mean(r["kills"] for r in rs))
            cm2 = mean(r.get(f"combat@{h2}", float("nan")) for r in rs)
            cm = mean(r.get(f"combat@{h}", float("nan")) for r in rs)
            print(f"| {g['id']} | {col} | {mean(r[f'kills@{h2}'] for r in rs):.0f} | {kills:.0f} | {mean(r[f'design@{h2}'] for r in rs):.0f} | "
                  f"{mean(r[f'design@{h}'] for r in rs):.0f} | {cm2:+.3f} | {cm:+.3f} | {walk_k:.1f} | {mean(r['rested'] for r in rs):.0f} | "
                  f"{mean(r['skipped'] for r in rs) / max(1e-9, mean(r['camps'] for r in rs)) * 100:.0f}% | "
                  f"{mean(r['detour'] for r in rs) / max(1e-9, mean(r['skipped'] for r in rs)):.1f} |")
        near = [o["nearest"] for o in rows]
        td = [o["targeted:design"] for o in rows]
        v = {
            "design_gain_half": mean(r[f"design@{h2}"] for r in td) / mean(r[f"design@{h2}"] for r in near) - 1,
            "design_gain": mean(r[f"design@{h}"] for r in td) / mean(r[f"design@{h}"] for r in near) - 1,
            "design_win_share": mean(a[f"design@{h}"] > b[f"design@{h}"] for a, b in zip(td, near)),
            # in-game decisions of the nearest farmer whose nearest camp was off-build: a build camp would have paid more per second
            "ingame_worth": sum(r["build_better"] for r in near) / max(1, sum(r["off_near"] for r in near)),
            "onbuild_win_share": mean(a[f"design@{h}"] > b[f"design@{h}"] for a, b in zip((o["onbuild"] for o in rows), near)),
            "best_design_win_share": mean(max(a[f"design@{h}"], c[f"design@{h}"]) > b[f"design@{h}"]
                                          for a, b, c in zip(td, near, (o["onbuild"] for o in rows))),
            "walk_ratio": (mean(r["walked"] for r in td) / max(1, mean(r["kills"] for r in td)))
            / max(1e-9, mean(r["walked"] for r in near) / max(1, mean(r["kills"] for r in near))),
        }
        if has_combat:
            tc = [o["targeted:combat"] for o in rows]
            v["combat_gain_half"] = mean(r[f"combat@{h2}"] for r in tc) - mean(r[f"combat@{h2}"] for r in near)
            v["combat_gain"] = mean(r[f"combat@{h}"] for r in tc) - mean(r[f"combat@{h}"] for r in near)
            v["combat_win_share"] = mean(a[f"combat@{h}"] > b[f"combat@{h}"] for a, b in zip(tc, near))
            weapon, bodies = BUILD_WEAPON[g["id"]], BUILD_BODIES.get(g["id"], 0)

            def kit(r: dict) -> Player:
                return Player(f, weapon, stats_of(r[f"counts@{h}"]), r[f"clears@{h}"], bodies)
            v["h2h"] = win_pct(mean(duel_power(kit(a), kit(b)) for a, b in zip(tc, near)))
            v["h2h_design"] = win_pct(mean(duel_power(kit(a), kit(b)) for a, b in zip(td, near)))
            # The build as it is defined: the player routing by the build's weights against the nearest farmer, in duel power.
            v["design_combat_gain"] = mean(r[f"combat@{h}"] for r in td) - mean(r[f"combat@{h}"] for r in near)
            v["design_combat_won"] = mean(a[f"combat@{h}"] > b[f"combat@{h}"] for a, b in zip(td, near))
        verdict[g["id"]] = v
    print()
    return verdict


# Owner's bar (2026-11-03): walking to a build's camps is "worth it" in 67-95% of in-game decisions ("seems reasonable"); a build
# with its own scaling must not do better farming at random. So a build holds when, against the nearest-camp farmer of its faction:
DECISION_FLOOR = 0.65   # the in-game decisions where a build camp pays more of the build's value than the off-build camp at hand
GAME_FLOOR = 0.80       # the games in which routing by the build's value banks more of it than farming the nearest camp
FIGHT_FLOOR = 0.90      # the games in which routing by what the kills add in a duel ends stronger than the nearest farmer
MIRROR_FLOOR = 60.0     # and that kit wins the mirror duel against the nearest farmer's this often (noise model)
DESIGN_MARGIN = 0.10    # the sweep's design-value margin
# "Some builds like Sentenced and Holy don't have specific scaling" (owner, 2026-11-03): their weights name shared stats, so their
# routed farmer is held to the fights (FIGHT_FLOOR, MIRROR_FLOOR) and the decisions, not to out-banking a nearest farmer on those weights.
GENERALIST = ("sentenced", "holy")


def holds(v: dict, gid: str = "") -> bool:
    games = v["design_win_share"] >= GAME_FLOOR or gid.split(":")[0] in GENERALIST
    return v["ingame_worth"] >= DECISION_FLOOR and games and v["combat_win_share"] >= FIGHT_FLOOR and v["h2h"] >= MIRROR_FLOOR


def judge(verdict: dict, has_combat: bool) -> bool:
    """Prints the verdict table and whether every build holds (holds())."""
    print("## 5. Verdict per build: is walking to the build's camps worth it, against farming the nearest camp?")
    print()
    print("- decisions: in the games, the nearest farmable camp was off-build; a build camp paid more of the build's value a second")
    print("- games (build value): routing by the build's weights banked more of them than farming the nearest camp")
    print("- games (fights): routing by what the kills add in a duel ended with more duel power against the field")
    print("- mirror: that kit against the nearest farmer's, same faction and weapon, win % under the noise model; the last column is")
    print("  the same for the kit routed by the bots' build weights (the build as the bots define it)")
    print()
    print("| build | decisions worth it | games (build value) | design gain | games (fights) | combat gain | mirror | mirror, bots' weights | walk per kill x | holds |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    ok_all = True
    for gid, v in verdict.items():
        ok = holds(v, gid)
        print(f"| {gid} | {100 * v['ingame_worth']:.0f}% | {100 * v['design_win_share']:.0f}% | {100 * v['design_gain']:+.0f}% | "
              f"{100 * v['combat_win_share']:.0f}% | {v['combat_gain']:+.2f} | {v['h2h']:.0f}% | {v['h2h_design']:.0f}% | {v['walk_ratio']:.2f} | "
              f"{'YES' if ok else 'NO'} |")
        ok_all = ok_all and ok
    print()
    print("ALL BUILDS HOLD" if ok_all else "SOME BUILDS FAIL")
    print()
    return ok_all


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--maps", type=int, default=24)
    ap.add_argument("--rosters", type=int, default=4)
    ap.add_argument("--horizon", type=float, default=600.0, help="seconds of farming (the coliseum opens at 10:00)")
    ap.add_argument("--beam-maps", type=int, default=0, help="maps on which the beam search (best route found) also runs")
    ap.add_argument("--hp-mult", type=float, default=1.0, help="mob hp on top of the shipped MOB_HP_MULT (time-to-kill)")
    ap.add_argument("--stacks", type=float, default=1.0, help="stacks per kill on top of the shipped MOB_KILL_STACKS (reward)")
    ap.add_argument("--dmg-mult", type=float, default=1.0, help="mob damage on top of the shipped MOB_DMG_MULT")
    ap.add_argument("--reward", default="", help="per-stack reward multipliers, e.g. damage=0.5,ap=2 (shared/mobStats.ts REWARDS)")
    ap.add_argument("--const", default="", help="constant what-ifs, e.g. PLAGUE_ZOMBIE_HIT_PER_BONUS=0.05")
    ap.add_argument("--no-cannons", action="store_true")
    ap.add_argument("--others", choices=("bots", "nearest", "solo"), default="bots",
                    help="the other players: fill bots farming their builds (default), nearest-camp farmers, or nobody (solo)")
    ap.add_argument("--lobby", type=int, default=LOBBY, help="players on the map (8: every game fills to 8; fewer: what is left after deaths)")
    ap.add_argument("--sweep", action="store_true", help="find the smallest time-to-kill (and reward) scale at which every build holds")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 1)
    ap.add_argument("--quick", action="store_true", help="a smoke test: 6 maps, 1 roster (6 games a build: too few for the verdict's shares)")
    a = ap.parse_args()
    if a.quick:
        a.maps, a.rosters, a.beam_maps = 6, 1, 0
    a.maps = min(a.maps, len(DATA["maps"]))
    reward = tuple((k, float(v)) for k, v in (kv.split("=") for kv in a.reward.split(",") if kv))
    const = tuple((k, float(v)) for k, v in (kv.split("=") for kv in a.const.split(",") if kv))
    tune = Tuning(a.hp_mult, a.stacks, a.dmg_mult, reward, const)
    apply_tuning(tune)
    cannons = not a.no_cannons
    print(f"# Farming-route proof (numbers only). Data: MOB_HP_MULT {C['MOB_HP_MULT']}, MOB_DMG_MULT {C['MOB_DMG_MULT']}, "
          f"MOB_KILL_STACKS {C['MOB_KILL_STACKS']}; on top: {tune.label()}. {a.maps} maps x {a.rosters} rosters, horizon {a.horizon:g} s, "
          f"cannons {'on' if cannons else 'off'}, others: {a.others}, players on the map: {1 if a.others == 'solo' else a.lobby}")
    print()
    map_facts(a.maps)
    ttk_table(tune)
    ok, _ = evaluate(tune, a, cannons, report=True)
    if a.sweep:
        sweep(a, cannons, ok)


def evaluate(tune: Tuning, a, cannons: bool, report: bool) -> bool:
    apply_tuning(tune)
    # Pass 1: nearest farmers of every build give the field (the lobby the targeted build has to beat).
    first = run_all(BUILDS, a.maps, a.rosters, tune, a.horizon, cannons, None, 0, a.jobs, a.others, a.lobby)
    kit = field_kit_from(first, a.horizon)
    if report:
        kills = [k for *_x, out in first for k in out["lobby_kills"]]
        print(f"The field: the mean bonus kit of every player at {a.horizon:g} s (mean {mean(kills):.0f} kills, "
              f"min {min(kills)}, max {max(kills)}): " + ", ".join(f"{k} {v:.3g}" for k, v in kit.items()))
        print()
        kill_value_table(kit)
    results = run_all(BUILDS, a.maps, a.rosters, tune, a.horizon, cannons, kit, a.beam_maps, a.jobs, a.others, a.lobby)
    own = {}
    for f, g in BUILDS:
        kits = [stats_of(out["targeted:design"][f"counts@{a.horizon:g}"]) for ff, gid, _, _, out in results if gid == g["id"]]
        own[g["id"]] = {k: mean(x[k] for x in kits) for k in STATS}
    detour = breakeven(a.maps, tune, kit, report, own)
    if report:
        defense_counter_table(results, a.horizon)
    verdict = verdict_table(results, a.horizon, True, a.beam_maps > 0) if report else collect_verdict(results, a.horizon)
    for gid, (dp, cp) in detour.items():
        verdict[gid]["detour_design"], verdict[gid]["detour_combat"] = dp, cp
    return (judge(verdict, True) if report else all_hold(verdict)), verdict


def all_hold(verdict: dict) -> bool:
    return all(holds(v, gid) for gid, v in verdict.items())


def collect_verdict(results, horizon: float) -> dict:
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        return verdict_table(results, horizon, True, False)


def sweep(a, cannons: bool, ok_now: bool) -> None:
    print("## 6. Sweep: mob time-to-kill (mob hp x s) with the reward per kill scaled alike (stacks x s, so a minute of farming pays")
    print("the same), and time-to-kill alone (stacks x 1). Where does targeting stop paying?")
    print()
    print("| mob hp x | stacks x | builds holding | worst design gain | worst combat gain | worst mirror h2h | mean design gain | mean combat gain |")
    print("|---|---|---|---|---|---|---|---|")
    a2 = argparse.Namespace(**vars(a))
    a2.beam_maps = 0
    for hpm, stk in ((0.25, 0.25), (0.5, 0.5), (0.75, 0.75), (1.0, 1.0), (1.5, 1.5), (2.0, 2.0), (0.5, 1.0), (1.5, 1.0), (2.0, 1.0)):
        ok, v = evaluate(Tuning(hpm, stk), a2, cannons, report=False)
        vs = list(v.values())
        print(f"| {hpm} | {stk} | {sum(holds(x, g) for g, x in v.items())}/{len(vs)} | {100 * min(x['design_gain'] for x in vs):+.0f}% | "
              f"{min(x['combat_gain'] for x in vs):+.3f} | {min(x['h2h'] for x in vs):.0f}% | {100 * mean(x['design_gain'] for x in vs):+.0f}% | "
              f"{mean(x['combat_gain'] for x in vs):+.3f} |")
    print()


if __name__ == "__main__":
    main()
