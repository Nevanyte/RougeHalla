#!/usr/bin/env python3
"""Deterministic telemetry fixture: N plausible RunRecords as NDJSON (docs/TELEMETRY.md section 10).

Standard library only. The same --runs and --seed always write the same bytes. Each run is a tiny event
simulation: players farm power over time, random pairs meet in duels whose winner follows a known logistic
(faction edges, weapon edges, power, hp, first strike, a hidden per-player skill), and a duel that ends in a kill
removes the loser. So the duel matrix, the run win rates and analyze.py's model all have a real signal to find.

    python3 testing/telemetry/make_fixture.py --runs 40 --seed 7 --out testing/telemetry/fixtures/runs-v1.ndjson
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import random
import sys

FACTIONS = ["fire", "sentenced", "plague", "frost", "holy"]
LOOP_WEAPONS = ["sword", "bow", "wand", "shield", "axe"]
ZONES = FACTIONS  # each zone is a faction's region; "coliseum" is the centre

# The edges the fixture plants (logit units, centred). analyze.py --model should recover these.
TRUE_F = {"fire": 0.30, "sentenced": -0.25, "plague": -0.10, "frost": 0.15, "holy": -0.10}
TRUE_W = {"sword": 0.10, "bow": -0.05, "wand": 0.05, "shield": -0.15, "axe": 0.20, "fists": -0.15}
TRUE_G, TRUE_H, TRUE_D, TRUE_K = 0.6, 0.3, 1.5, 0.2
AUGMENT_EDGE = {"hereComesTheBoom": 0.35, "glassCannon": 0.2, "quickdraw": 0.1, "ironWill": -0.1}
TIER_SKILL = {"easy": -0.5, "normal": 0.0, "hard": 0.4}

MOBS = {
    "fire": (["emberImp", "cinderHound", "magmaBrute", "flameCaller"], ["wyrmling", "ashDrake"]),
    "sentenced": (["bailiff", "chainWarden", "inquisitor", "pardoner"], ["executioner", "gaoler"]),
    "plague": (["plagueRat", "bloatfly", "rotMonk", "miasmaWitch"], ["ratOgre", "poxBehemoth"]),
    "frost": (["frostWisp", "iceGolem", "rimeStalker", "frostbowSentry"], ["glacialWarden", "avalancheTroll"]),
    "holy": (["acolyte", "seraphShard", "penitent", "zealot"], ["bloodSaint", "archon"]),
}
AUGMENTS = [
    ("hereComesTheBoom", 3), ("machineGun", 2), ("glassCannon", 2), ("thickSkull", 2), ("vampiricPact", 2),
    ("overkill", 2), ("tankEngine", 2), ("pocketSand", 1), ("gambler", 1), ("coupDeGrace", 2), ("adrenaline", 2),
    ("raceToZero", 3), ("hemorrhage", 1), ("ironWill", 1), ("spikedShell", 2), ("quickdraw", 1), ("secondWind", 2),
    ("tunnelVision", 2), ("firstImpressions", 1), ("wishfulThinking", 2),
]
AUG_TIER = dict(AUGMENTS)
BASE_STATS = ["ad", "ap", "haste", "vitality", "armor", "mr", "leech", "fleet"]
BOOST_STATS = ["ad", "ap", "armor", "shield", "maxHp", "attackSpeed", "moveSpeed", "lifesteal"]
KILL_KEYS = ["ad", "ap", "damage", "health", "attackSpeed", "armor", "mr", "speed", "leech"]
MOB_STAT_KEYS = ["ad", "ap", "maxHp", "armor", "shield", "attackSpeed"]
WISH = {"fire": "blaze", "sentenced": "trial", "plague": "swarm", "frost": "freeze", "holy": "lastStand"}
PERSONAS = ["farmer", "hunter", "opportunist", "cautious"]
SIG_OF = {"fire": "burn", "sentenced": "mark", "plague": "disease", "frost": None, "holy": None}
MAP = 136
CENTRE = 68
BUILDS = [("b2026a01", "6c41ed9"), ("b2026b02", "79a96f8")]
BASE_EPOCH = 1792800000000  # 2026-10-23T00:00:00Z, fixed so the fixture never depends on today
DAY_MS = 86_400_000


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def r1(x: float) -> float:
    return round(x * 10) / 10


def uuid4(rng: random.Random) -> str:
    b = bytearray(rng.getrandbits(8) for _ in range(16))
    b[6] = (b[6] & 0x0F) | 0x40
    b[8] = (b[8] & 0x3F) | 0x80
    h = b.hex()
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


def zone_centre(zone: str) -> tuple[float, float]:
    if zone == "coliseum":
        return (CENTRE, CENTRE)
    i = ZONES.index(zone)
    a = -math.pi / 2 + i * 2 * math.pi / 5
    return (CENTRE + 42 * math.cos(a), CENTRE + 42 * math.sin(a))


class Humans:
    """A fixed pool of human callsigns with a hidden skill each (pid = a fake 16-hex HMAC)."""

    def __init__(self, rng: random.Random, n: int = 28):
        self.pool = []
        for i in range(n):
            pid = hashlib.sha256(f"fixture-callsign-{i}".encode()).hexdigest()[:16]
            self.pool.append((pid, rng.gauss(0, 0.6)))


def mob_zone_type(rng: random.Random, zone: str, elite: bool) -> str:
    normal, elites = MOBS[zone]
    return rng.choice(elites if elite else normal)


def make_run(rng: random.Random, idx: int, humans: Humans) -> dict:
    build, commit = BUILDS[0] if idx < 15 else BUILDS[1]
    n = rng.choice([6, 6, 7])
    kind_roll = rng.random()
    if kind_roll < 0.2:
        h = 0
    elif kind_roll < 0.35:
        h = n
    else:
        h = rng.randint(1, min(4, n))
    source = "tournament" if h == 0 else "live"
    started = BASE_EPOCH + (idx * DAY_MS * 10) // 40 + rng.randint(0, 6 * 3600_000)
    cap_ms = rng.randint(260, 400) * 1000
    picked = rng.sample(humans.pool, h)

    players = []
    for slot in range(n):
        bot = slot >= h
        fac = rng.choice(FACTIONS)
        weapon = rng.choice(LOOP_WEAPONS) if rng.random() < 0.9 else "fists"
        if bot:
            tier = rng.choice(["easy", "normal", "normal", "hard"])
            skill = TIER_SKILL[tier] + rng.gauss(0, 0.15)
            pid = None
        else:
            tier = None
            pid, skill = picked[slot]
        zone = rng.choice(ZONES)
        cx, cy = zone_centre(zone)
        players.append({
            "slot": slot, "bot": bot, "tier": tier, "persona": rng.choice(PERSONAS) if bot else None, "pid": pid,
            "skill": skill, "faction": fac, "weapon": weapon, "armedAt": rng.randint(15, 60) * 1000 if weapon != "fists" else 0,
            "spawn": {"zone": zone, "tx": int(cx + rng.uniform(-8, 8)), "ty": int(cy + rng.uniform(-8, 8)), "picked": rng.random() < 0.85},
            "pRate": max(0.3, 1.1 + 0.5 * skill + rng.gauss(0, 0.25)),
            "sRate": max(0.5, 2.0 + 0.6 * skill + rng.gauss(0, 0.4)),
            "alive": True, "deathAt": None, "death": None, "kills": 0, "botKills": 0, "quit": False,
            "augments": [], "boosts": {}, "trophies": {}, "mobKills": {}, "eliteKills": 0, "camps": 0,
            "dealtP": {}, "dealtM": {}, "taken": {}, "healed": {}, "overkill": 0.0, "wish": [0, 0, 0, 0, 0, 0, 0.0],
        })

    def power(p: dict, t: int) -> float:
        return math.floor(p["pRate"] * t / 60000)

    def stacks(p: dict, t: int) -> float:
        return round(p["sRate"] * t / 60000, 1)

    def weapon_at(p: dict, t: int) -> str:
        return p["weapon"] if t >= p["armedAt"] else "fists"

    def add(d: dict, k: str, v: float) -> None:
        d[k] = d.get(k, 0.0) + v

    teleport = 180_000
    sudden = 300_000 if cap_ms > 300_000 else None
    duels, offers, camps = [], [], []
    first_blood = None
    t = rng.randint(25, 45) * 1000
    end_t = cap_ms
    mia_done = False

    def offer(kind: str, at: int, camp: int, elite: bool, eligible: list[int], options: list[str]) -> None:
        picks = []
        for s in eligible:
            roll = rng.random()
            if roll < 0.06:
                continue  # never chose
            if roll < 0.15:
                picks.append({"slot": s, "option": -1, "at": at + rng.randint(1000, 6000)})
                continue
            if kind == "augment":
                weights = [2.0 + AUGMENT_EDGE.get(o, 0) * 6 if o in AUG_TIER else 1.0 for o in options]
            else:
                weights = [1.0 + (0.6 if ("ad" in o or "health" in o or "maxHp" in o) else 0) for o in options]
            choice = rng.choices(range(len(options)), weights=weights)[0]
            picks.append({"slot": s, "option": choice, "at": at + rng.randint(1000, 6000)})
            o = options[choice]
            p = players[s]
            if kind == "augment" and o in AUG_TIER and o not in p["augments"]:
                p["augments"].append(o)
            elif kind == "stat":
                stat = o.split(":", 1)[1]
                p["boosts"][stat] = p["boosts"].get(stat, 0) + 1
            elif kind == "trophy":
                key = o.split(":")[1]
                p["trophies"][key] = round(p["trophies"].get(key, 0) + float(o.split(":")[2]), 4)
        offers.append({"i": len(offers), "kind": kind, "at": at, "camp": camp, "elite": elite, "options": options,
                       "eligible": eligible, "picks": picks})

    def kill_options() -> list[str]:
        keys = rng.sample(KILL_KEYS, 3)
        return [f"kill:{k}:{rng.uniform(2, 12):.1f}" if k in ("ad", "ap", "armor", "mr") else f"kill:{k}:{rng.uniform(0.01, 0.06):.4f}" for k in keys]

    def down(p: dict, at: int, death: dict) -> None:
        nonlocal first_blood
        p["alive"] = False
        p["deathAt"] = at
        p["death"] = death
        if first_blood is None and death["kind"] not in ("quit",):
            first_blood = {"at": at, "victim": p["slot"], "killer": death.get("bySlot", -1) if death["kind"] in ("player", "zombie") else -1}

    camp_cycle: dict[int, int] = {}
    while t < end_t:
        alive = [p for p in players if p["alive"]]
        if len(alive) <= 1:
            break
        zoneish = "coliseum" if t >= teleport else None
        roll = rng.random()
        if roll < 0.45:
            # a camp clear by one or two alive players
            k = rng.choice(alive)
            z = zoneish or k["spawn"]["zone"]
            z = z if z != "coliseum" else k["spawn"]["zone"]
            ci = ZONES.index(z) * 8 + rng.randint(0, 7)
            elite = (ci % 8) >= 6
            typ = mob_zone_type(rng, z, False)
            etyp = mob_zone_type(rng, z, True) if elite else ""
            contrib = [k["slot"]] + ([rng.choice(alive)["slot"]] if rng.random() < 0.4 else [])
            contrib = sorted(set(contrib))
            edge = TRUE_F[k["faction"]] + TRUE_W[weapon_at(k, t)] + k["skill"]
            clear_s = max(6.0, rng.gauss(22 - 6 * edge + (14 if elite else 0), 4))
            deaths = 0
            if rng.random() < (0.10 + (0.12 if elite else 0) - 0.05 * edge) and t < teleport:
                victim = players[contrib[-1]]
                if victim["alive"] and sum(1 for p in players if p["alive"]) > 1:
                    mt = etyp if elite and rng.random() < 0.5 else typ
                    down(victim, t, {"kind": "mob", "at": t, "mobType": mt, "elite": mt == etyp and elite, "camp": ci,
                                     "zone": z, "coliseum": False})
                    add(victim["taken"], "mob", r1(rng.uniform(400, 900)))
                    deaths = 1
            killer = next((players[s] for s in contrib if players[s]["alive"]), None)
            if killer is not None:
                cyc = camp_cycle.get(ci, 0)
                camp_cycle[ci] = cyc + 1
                camps.append({"camp": ci, "cycle": cyc, "zone": z, "type": typ, "elite": etyp,
                              "engagedAt": int(t - clear_s * 1000), "clearedAt": t, "killerSlot": killer["slot"],
                              "contributors": contrib, "playerDeaths": deaths})
                for s in contrib:
                    p = players[s]
                    if not p["alive"]:
                        continue
                    p["camps"] += 1
                    cnt = rng.randint(3, 5)
                    p["mobKills"][typ] = p["mobKills"].get(typ, 0) + cnt - (1 if elite else 0)
                    if elite:
                        p["mobKills"][etyp] = p["mobKills"].get(etyp, 0) + 1
                        p["eliteKills"] += 1
                    add(p["dealtM"], "weapon", r1(rng.uniform(1500, 3500)))
                    add(p["taken"], "mob", r1(rng.uniform(100, 500)))
                    add(p["healed"], "lifesteal", r1(rng.uniform(20, 120)))
                    add(p["healed"], "potion", r1(rng.uniform(0, 300)))
                eligible = [s for s in contrib if players[s]["alive"]]
                if eligible and len(offers) < 250:
                    if elite or rng.random() < 0.45:
                        opts = [a for a, _ in rng.sample(AUGMENTS, 3)]
                        offer("augment", t + 50, ci, elite, eligible, opts)
                    else:
                        offer("stat", t + 50, ci, False, eligible, ["boost:" + s for s in rng.sample(BOOST_STATS, 3)])
        elif roll < 0.38 and not mia_done and t < 120_000 and rng.random() < 0.3:
            q = rng.choice(alive)
            if not q["bot"]:
                q["quit"] = True
                mia_done = True
                down(q, t, {"kind": "quit", "at": t, "zone": q["spawn"]["zone"], "coliseum": False})
        elif roll < 0.41 and t >= 60_000:
            q = rng.choice(alive)
            if t >= teleport and sudden is not None and t >= sudden:
                down(q, t, {"kind": "suddenDeath", "at": t, "zone": "coliseum", "coliseum": True})
                add(q["taken"], "suddenDeath", r1(rng.uniform(200, 600)))
            elif t < teleport:
                down(q, t, {"kind": "terrain", "at": t, "zone": q["spawn"]["zone"], "coliseum": False})
                add(q["taken"], "terrain", r1(rng.uniform(100, 300)))
        else:
            a, b = sorted(rng.sample(alive, 2), key=lambda p: p["slot"])
            start = t
            ha, hb = rng.uniform(0.45, 1.0), rng.uniform(0.45, 1.0)
            first = rng.choices([0, 1, 2], weights=[47, 47, 6])[0]
            fa = 1 if first == 0 else -1 if first == 1 else 0
            wa, wb = weapon_at(a, t), weapon_at(b, t)
            pa, pb = power(a, t), power(b, t)
            sa, sb = stacks(a, t), stacks(b, t)
            aug_a = sum(AUGMENT_EDGE.get(x, 0) for x in a["augments"])
            aug_b = sum(AUGMENT_EDGE.get(x, 0) for x in b["augments"])
            logit = (TRUE_F[a["faction"]] - TRUE_F[b["faction"]] + TRUE_W[wa] - TRUE_W[wb]
                     + TRUE_G * (math.log1p(pa) - math.log1p(pb)) + TRUE_H * (sa - sb) / 10 + TRUE_D * (ha - hb)
                     + TRUE_K * fa + a["skill"] - b["skill"] + aug_a - aug_b)
            a_wins = rng.random() < sigmoid(logit)
            dur = int(rng.uniform(3, 16) * 1000)
            o = rng.random()
            coliseum = t >= teleport
            if o < 0.6:
                outcome = "kill"
            elif o < 0.8:
                outcome = "disengage"
            elif o < 0.88:
                outcome = "thirdParty"
            elif o < 0.9:
                outcome = "trade"
            elif o < 0.93:
                outcome = "hazard"
            else:
                outcome = "teleport" if (not coliseum and t + dur > teleport - 15_000) else "disengage"
            third = 0
            if outcome == "thirdParty":
                third = rng.choice([1, 2, 3])
            elif rng.random() < 0.2:
                third = rng.choice([1, 2, 4])
            winner = -1
            w = l = None
            if outcome in ("kill", "thirdParty", "hazard"):
                winner = 0 if a_wins else 1
                w, l = (a, b) if a_wins else (b, a)
            elif outcome == "trade" and len(alive) <= 2:
                outcome = "kill"
                winner = 0 if a_wins else 1
                w, l = (a, b) if a_wins else (b, a)
            clean = (third & 3) == 0
            if outcome == "thirdParty" and clean:
                third |= 1
                clean = False
            end = start + dur

            def side(p: dict, hp: float, won: bool, wpn: str, pw: float, st: float) -> dict:
                dmg = {"weapon": r1(rng.uniform(150, 700))}
                sig = SIG_OF[p["faction"]]
                if sig:
                    dmg["signature"] = r1(rng.uniform(30, 200))
                wishes = 1 if rng.random() < 0.15 else 0
                if wishes:
                    dmg["wish"] = r1(rng.uniform(20, 120))
                augs = sorted(p["augments"])[:16]
                return {"slot": p["slot"], "bot": p["bot"], "faction": p["faction"], "weapon": wpn, "weaponsUsed": [wpn],
                        "augments": augs, "cardPower": pw, "mobStatsTotal": st, "boostsTotal": sum(p["boosts"].values()),
                        "hp": round(hp, 2), "hpEnd": 0 if (not won and outcome in ("kill", "thirdParty", "hazard", "trade")) else round(max(0.05, hp - rng.uniform(0.1, 0.5)), 2),
                        "dmg": dmg, "wishes": wishes, "terrain": rng.choice(["", "", "", "ember", "bog", "ice", "light"])}

            sides = [side(a, ha, winner == 0, wa, pa, sa), side(b, hb, winner == 1, wb, pb, sb)]
            if outcome == "trade":
                sides[0]["hpEnd"] = sides[1]["hpEnd"] = 0
            comeback = None
            if winner >= 0:
                wi, li = sides[winner], sides[1 - winner]
                wp, ws = wi["cardPower"], wi["mobStatsTotal"] + wi["boostsTotal"]
                lp, ls = li["cardPower"], li["mobStatsTotal"] + li["boostsTotal"]
                comeback = (wp < lp) if wp != lp else ((ws < ls) if ws != ls else None)
            midz = "coliseum" if coliseum else rng.choice([a["spawn"]["zone"], b["spawn"]["zone"]])
            if len(duels) < 256:
                duels.append({"i": len(duels), "start": start, "end": end, "sides": sides, "first": first,
                              "outcome": outcome, "winner": winner, "third": third, "clean": clean,
                              "zone": midz, "coliseum": coliseum, "comeback": comeback})
            for s_, p_ in ((sides[0], a), (sides[1], b)):
                other = b if p_ is a else a
                for src, v in s_["dmg"].items():
                    add(p_["dealtP"], src, v)
                    add(other["taken"], src, v)
                if s_["wishes"]:
                    p_["wish"][0] += 1
                    p_["wish"][1] += 1
                    p_["wish"][5] += 1
                    p_["wish"][6] += s_["dmg"].get("wish", 0)
            t = end
            if outcome in ("kill", "thirdParty", "hazard") and w is not None and l is not None:
                if outcome == "kill":
                    down(l, t, {"kind": "player", "at": t, "bySlot": w["slot"], "weapon": weapon_at(w, t),
                                **({"sig": SIG_OF[w["faction"]]} if SIG_OF[w["faction"]] and rng.random() < 0.3 else {}),
                                "zone": midz, "coliseum": coliseum})
                    w["kills"] += 1
                    if l["bot"]:
                        w["botKills"] += 1
                    w["overkill"] += r1(rng.uniform(0, 80))
                    if len(offers) < 250:
                        offer("trophy", t + 50, -1, False, [w["slot"]], kill_options())
                elif outcome == "thirdParty":
                    others = [p for p in players if p["alive"] and p is not w and p is not l]
                    if third & 1 and others:
                        k3 = rng.choice(others)
                        down(l, t, {"kind": "player", "at": t, "bySlot": k3["slot"], "weapon": weapon_at(k3, t),
                                    "zone": midz, "coliseum": coliseum})
                        k3["kills"] += 1
                        if l["bot"]:
                            k3["botKills"] += 1
                    else:
                        z = midz if midz != "coliseum" else l["spawn"]["zone"]
                        mt = mob_zone_type(rng, z, False)
                        down(l, t, {"kind": "mob", "at": t, "mobType": mt, "elite": False,
                                    "camp": ZONES.index(z) * 8 + rng.randint(0, 5), "zone": midz, "coliseum": coliseum})
                else:
                    kind = "suddenDeath" if (sudden is not None and t >= sudden) else "terrain"
                    down(l, t, {"kind": kind, "at": t, "zone": midz, "coliseum": coliseum})
            elif outcome == "trade":
                for p_, q_ in ((a, b), (b, a)):
                    down(p_, t, {"kind": "player", "at": t, "bySlot": q_["slot"], "weapon": weapon_at(q_, t),
                                 "zone": midz, "coliseum": coliseum})
                    q_["kills"] += 1
                    if p_["bot"]:
                        q_["botKills"] += 1
        t += int(rng.expovariate(1 / 9000)) + 1000

    alive = [p for p in players if p["alive"]]
    end_reason = "winner"
    if idx == 17:
        end_reason = "void"
    elif len(alive) == 0:
        end_reason = "draw"
    elif len(alive) > 1:
        # the cap ran out: sudden death settles the rest, strongest last
        alive.sort(key=lambda p: p["skill"] + TRUE_F[p["faction"]] + rng.gauss(0, 0.5))
        for p in alive[:-1]:
            t = min(t + rng.randint(1000, 6000), cap_ms + 60_000)
            down(p, t, {"kind": "suddenDeath", "at": t, "zone": "coliseum", "coliseum": True})
            add(p["taken"], "suddenDeath", r1(rng.uniform(300, 800)))
    duration = max([p["deathAt"] or 0 for p in players] + [t if t < cap_ms + 60_000 else cap_ms])
    duration = min(max(duration, 120_000), cap_ms + 70_000)
    if sudden is not None and duration < sudden:
        sudden = None

    # placement: alive last, then by death time (a later death places better); draws share place 1
    order = sorted(players, key=lambda p: (-(p["deathAt"] if p["deathAt"] is not None else duration + 1)))
    winner_slot = -1
    recs = []
    place_of = {}
    for i, p in enumerate(order):
        place_of[p["slot"]] = i + 1
    survivors = [p for p in players if p["alive"]]
    if end_reason == "winner" and survivors:
        winner_slot = survivors[0]["slot"]
    for p in players:
        alive_ms = (p["deathAt"] if p["deathAt"] is not None else duration)
        if end_reason == "void":
            outcome = "alive" if p["alive"] else ("mia" if p["quit"] else "died")
        elif p["quit"]:
            outcome = "mia"
        elif p["slot"] == winner_slot:
            outcome = "won"
        elif end_reason == "draw" and p["deathAt"] == duration:
            outcome = "draw"
        else:
            outcome = "died"
        place = place_of[p["slot"]]
        final_p = 0
        cards: dict[str, int] = {}
        for aug in p["augments"]:
            cards[aug] = 1
            final_p += AUG_TIER[aug]
        target = max(final_p, int(power(p, alive_ms)))
        while final_p < target:
            stat = rng.choice(BASE_STATS)
            tier = rng.choice([1, 2, 3, 3])
            if final_p + tier > target:
                tier = target - final_p
            cid = f"{stat}{tier}"
            cards[cid] = cards.get(cid, 0) + 1
            final_p += tier
        mob_total = stacks(p, alive_ms)
        mob_stats: dict[str, float] = {}
        left = mob_total
        for k in MOB_STAT_KEYS:
            v = round(min(left, rng.uniform(0, mob_total / 2)), 1)
            if v > 0:
                mob_stats[k] = v
                left = round(left - v, 1)
        if left > 0:
            mob_stats["ad"] = round(mob_stats.get("ad", 0) + left, 1)
        mirrors = {"maxHp": round(1000 + 25 * cards.get("vitality1", 0) + 18 * mob_stats.get("maxHp", 0), 1),
                   "ad": round(10 * mob_stats.get("ad", 0) + 12 * sum(v for k, v in cards.items() if k.startswith("ad")), 1),
                   "ap": round(10 * mob_stats.get("ap", 0) + 12 * sum(v for k, v in cards.items() if k.startswith("ap")), 1),
                   "armor": round(8 * mob_stats.get("armor", 0), 1), "shield": round(8 * mob_stats.get("shield", 0), 1),
                   "asMult": round(1 + 0.03 * mob_stats.get("attackSpeed", 0), 3), "speedMult": 1.0}
        snaps = []
        for m in (1, 3, 5, 10):
            if alive_ms >= m * 60000:
                frac = m * 60000 / max(alive_ms, 1)
                snaps.append({"minute": m, **{k: (round(v * frac, 1) if k not in ("asMult", "speedMult", "maxHp") else v) for k, v in mirrors.items()},
                              "cardPower": int(power(p, m * 60000)), "mobStatsTotal": stacks(p, m * 60000),
                              "boostsTotal": round(sum(p["boosts"].values()) * frac)})
        weapon_ms: dict[str, int] = {}
        armed = min(p["armedAt"], alive_ms)
        if p["weapon"] == "fists":
            weapon_ms["fists"] = alive_ms // 1000 * 1000
        else:
            if armed > 0:
                weapon_ms["fists"] = armed // 1000 * 1000
            if alive_ms > armed:
                weapon_ms[p["weapon"]] = (alive_ms - armed) // 1000 * 1000
        main = max(weapon_ms, key=lambda k: weapon_ms[k]) if weapon_ms else "fists"
        # 1 Hz tiles: a walk around the spawn zone, then the coliseum after the teleport; absent once down
        nsec = min(1800, duration // 1000)
        tiles = bytearray()
        x, y = float(p["spawn"]["tx"]), float(p["spawn"]["ty"])
        zone_ms: dict[str, int] = {}
        for s in range(nsec):
            tm = s * 1000
            if tm >= alive_ms:
                tiles += bytes([255, 255])
                continue
            target_zone = "coliseum" if tm >= teleport else p["spawn"]["zone"]
            cx, cy = zone_centre(target_zone)
            if target_zone == "coliseum" and math.hypot(x - cx, y - cy) > 14:
                x, y = cx + rng.uniform(-6, 6), cy + rng.uniform(-6, 6)
            x += rng.gauss(0, 1.6) + (cx - x) * 0.04
            y += rng.gauss(0, 1.6) + (cy - y) * 0.04
            x = min(MAP - 3, max(2, x))
            y = min(MAP - 3, max(2, y))
            tiles += bytes([int(x), int(y)])
            zone_ms[target_zone] = zone_ms.get(target_zone, 0) + 1000
        farm_ms = min(alive_ms, p["camps"] * rng.randint(18, 30) * 1000)
        gv = {"mobs": round(min(30, sum(p["mobKills"].values()) * 0.6), 1)}
        if p["kills"] - p["botKills"] > 0:
            gv["kills"] = 5 * (p["kills"] - p["botKills"])
        if outcome == "won" and h >= 3:
            gv["win"] = 25
        healed = {k: r1(v) for k, v in p["healed"].items() if v > 0}
        if p["faction"] == "holy":
            healed["lifesteal"] = r1(healed.get("lifesteal", 0) + rng.uniform(100, 400))
        rec = {
            "slot": p["slot"], "pid": p["pid"], "bot": p["bot"], "faction": p["faction"], "spawn": p["spawn"],
            "place": place if end_reason != "void" else 0, "outcome": outcome, "aliveMs": alive_ms, "death": p["death"],
            "kills": p["kills"], "botKills": p["botKills"], "weaponMs": weapon_ms, "mainWeapon": main, "zoneMs": zone_ms,
            "final": {**mirrors, "cards": cards, "cardPower": final_p, "boosts": p["boosts"],
                      "boostsTotal": sum(p["boosts"].values()), "trophies": p["trophies"], "mobStats": mob_stats,
                      "mobStatsTotal": round(sum(mob_stats.values()), 1)},
            "snapshots": snaps, "mobKills": p["mobKills"], "eliteKills": p["eliteKills"], "campsCleared": p["camps"],
            "farmMs": farm_ms,
            "dealt": {"players": {k: r1(v) for k, v in p["dealtP"].items()}, "mobs": {k: r1(v) for k, v in p["dealtM"].items()}},
            "taken": {k: r1(v) for k, v in p["taken"].items()}, "overkill": r1(p["overkill"]), "healed": healed,
            "wish": {"casts": p["wish"][0] + (1 if rng.random() < 0.5 else 0), "landed": p["wish"][1], "fizzled": 0,
                     "interrupted": 0, "cancelled": 0, "hits": p["wish"][5], "damage": r1(p["wish"][6])},
            "potions": {"small": rng.randint(0, 2), "large": min(p["camps"], rng.randint(0, 3)), "granted": p["camps"]},
            "quests": {"accepted": [], "completed": []}, "gv": gv,
            "net": {"drops": 0, "reconnects": 0}, "afkMs": 0, "afk": False, "quit": p["quit"],
        }
        if p["slot"] % 2 == 0:
            # Odd slots carry no tiles (the field is optional) so the committed fixture stays small.
            rec["tiles"] = base64.b64encode(bytes(tiles)).decode()
        rec["wish"]["casts"] = max(rec["wish"]["casts"], rec["wish"]["landed"])
        rec["wish"]["fizzled"] = rec["wish"]["casts"] - rec["wish"]["landed"]
        if p["bot"]:
            rec["tier"] = p["tier"]
            rec["persona"] = p["persona"]
        else:
            if rng.random() < 0.5:
                q = rng.choice(["ashcaps", "longHaul", "emberBanner", "grandTour", "tithe"])
                rec["quests"]["accepted"].append(q)
                if rng.random() < 0.5:
                    rec["quests"]["completed"].append(q)
                    gv["quest"] = rng.choice([4, 6, 8])
            rec["net"] = {"drops": 1 if rng.random() < 0.1 else 0, "reconnects": 0}
            rec["net"]["reconnects"] = rec["net"]["drops"]
            if rng.random() < 0.08:
                rec["afkMs"] = rng.randint(30, 90) * 1000
                rec["afk"] = rec["afkMs"] >= max(60_000, 0.25 * alive_ms)
            if rng.random() < 0.85:
                rec["client"] = {"v": 1, "fpsP50": round(rng.choice([59.8, 99.6, 143.2, 119.8]) - rng.uniform(0, 4), 1),
                                 "frameMsP95": round(rng.uniform(7, 22), 1), "rttP50": round(rng.uniform(25, 80), 1),
                                 "rttP95": round(rng.uniform(60, 140), 1), "ua": rng.choice(["chrome", "chrome", "safari", "firefox"])}
        recs.append(rec)

    humans_n = sum(1 for p in players if not p["bot"])
    win_paid = winner_slot >= 0 and h >= 3 and not players[winner_slot]["bot"]
    if winner_slot >= 0 and not players[winner_slot]["bot"] and not win_paid:
        recs[winner_slot]["winBonusWithheld"] = True
        recs[winner_slot]["winBonusWhy"] = "starters"
    return {
        "v": 1, "kind": "run", "runId": uuid4(rng), "source": source, "build": {"server": build, "commit": commit},
        "startedAtEpoch": started, "endedAtEpoch": started + duration, "durationMs": duration, "end": end_reason,
        "seed": rng.randint(1, 2**31 - 1), "attempt": rng.choice([0, 0, 0, 1]), "mapHash": rng.randint(0, 2**32 - 1),
        "config": {"planSeconds": 12, "quests": True, "mobs": True, "coliseumSchedule": True, "botsFillTo": 6},
        "humans": humans_n, "bots": n - humans_n, "players": recs, "winnerSlot": winner_slot if end_reason == "winner" else -1,
        "winBonusPaid": bool(win_paid and end_reason == "winner"),
        "coliseum": {"teleports": [teleport] if duration > teleport else [], "suddenDeath": [sudden] if sudden is not None else []},
        "firstBlood": first_blood, "duels": duels, "offers": offers, "camps": camps,
    }


def make_runs(n: int, seed: int) -> list[dict]:
    rng = random.Random(seed)
    humans = Humans(rng)
    return [make_run(rng, i, humans) for i in range(n)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", type=int, default=40)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="-")
    a = ap.parse_args(argv)
    lines = [json.dumps(r, separators=(",", ":"), sort_keys=False) for r in make_runs(a.runs, a.seed)]
    text = "\n".join(lines) + "\n"
    if a.out == "-":
        sys.stdout.write(text)
    else:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {len(lines)} runs, {len(text.encode())} bytes to {a.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
