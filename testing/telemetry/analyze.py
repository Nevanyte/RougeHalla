#!/usr/bin/env python3
"""Offline balance report over telemetry RunRecords (docs/TELEMETRY.md section 9).

Reads NDJSON (the local sink's runs-*.ndjson, tournament output, fixtures, or /api/stats/export), flattens it
into the tables of section 7.2, and prints every dashboard metric with its n and a Wilson 95% interval, using the
same definitions as the /api/stats/* endpoints. --json writes the endpoint-shaped results; --model (numpy) fits the
skill-adjusted logistic model of clean kill duels.

    python3 testing/telemetry/analyze.py ./.telemetry --pool bots
    python3 testing/telemetry/analyze.py testing/telemetry/fixtures/runs-v1.ndjson --pool all --model
    python3 testing/telemetry/analyze.py --url https://play.roguehalla.com --token-env DASHBOARD_TOKEN --model

The report always runs on the stdlib path. With DuckDB installed, --sql "SELECT ..." runs ad-hoc SQL over the
same flattened tables (runs, players, player_weapons, player_cards, offer_options, camp_clears, duels, duel_cards,
power_snaps) and --duckdb FILE saves them.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import json
import math
import os
import statistics
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

SCHEMA_VERSION = 1
FACTIONS = ["fire", "sentenced", "plague", "frost", "holy"]
WEAPONS = ["sword", "bow", "wand", "shield", "axe", "fists"]
SNAPSHOT_MINUTES = [1, 3, 5, 10]
HEAT_CELL_TILES = 4
MAP_TILES = 136
TILE_ABSENT = 255
SMALL_N = 5
MODEL_MIN_DUELS = 200
# The store's FINISHED: the win-rate views count only runs with a winner or a draw (a void or abandoned run has no winner).
FINISHED_ENDS = ("winner", "draw")
STAT_OFFER_NOTE = "A crate's stat chest is offered to the players in range at the drop; anyone who picked from it counts as offered too."
Z95 = 1.959963984540054


# ---------------------------------------------------------------------------------------------------------------
# Statistics.

def wilson95(k: float, n: float) -> dict:
    """The same interval as shared/telemetry.ts wilson95 (rate, lo, hi with its n and k)."""
    if not n > 0:
        return {"n": 0, "k": 0, "rate": 0, "lo": 0, "hi": 1}
    p = k / n
    z2 = Z95 * Z95
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    lo = 0 if k <= 0 else max(0.0, centre - half)
    hi = 1 if k >= n else min(1.0, centre + half)
    return {"n": n, "k": k, "rate": p, "lo": lo, "hi": hi}


def median(xs: list[float]) -> float | None:
    return statistics.median(xs) if xs else None


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def r2(x: float | None) -> float | None:
    return None if x is None else round(x, 2)


def day_of(epoch_ms: int) -> str:
    return datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def option_group(kind: str, option: str) -> str:
    """Trophy options carry their gain (kill:ad:6.0); they are compared by stat (kill:ad)."""
    if kind == "trophy" and option.startswith("kill:"):
        parts = option.split(":")
        return ":".join(parts[:2])
    return option


# ---------------------------------------------------------------------------------------------------------------
# Loading.

def iter_lines(path: str):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield line


def load_paths(paths: list[str]) -> list[dict]:
    files: list[str] = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                files += [os.path.join(root, n) for n in sorted(names) if n.endswith((".ndjson", ".ndjson.gz", ".json.gz", ".jsonl"))]
        else:
            files.append(p)
    out = []
    for f in sorted(files):
        if f.endswith(".json.gz") and not f.endswith(".ndjson.gz"):
            with gzip.open(f, "rt", encoding="utf-8") as g:
                out.append(json.load(g))
            continue
        for line in iter_lines(f):
            out.append(json.loads(line))
    return out


def load_url(base: str, token: str, params: dict) -> list[dict]:
    """Pages /api/stats/export (NDJSON, X-Next-Cursor)."""
    out: list[dict] = []
    cursor = None
    while True:
        q = {k: v for k, v in params.items() if v}
        q["limit"] = "500"
        if cursor:
            q["cursor"] = cursor
        req = urllib.request.Request(base.rstrip("/") + "/api/stats/export?" + urllib.parse.urlencode(q),
                                     headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read().decode("utf-8")
            cursor = res.headers.get("X-Next-Cursor")
        out += [json.loads(l) for l in body.splitlines() if l.strip()]
        if not cursor:
            return out


def usable(r: dict) -> bool:
    return isinstance(r, dict) and r.get("v") == SCHEMA_VERSION and r.get("kind") == "run" and isinstance(r.get("players"), list)


def filter_runs(runs: list[dict], build: str | None, d_from: str | None, d_to: str | None, source: str) -> list[dict]:
    out = []
    for r in runs:
        if not usable(r):
            continue
        if build and r["build"]["server"] != build:
            continue
        d = day_of(r["endedAtEpoch"])
        if d_from and d < d_from:
            continue
        if d_to and d > d_to:
            continue
        if source != "any" and r.get("source") != source:
            continue
        out.append(r)
    return out


# ---------------------------------------------------------------------------------------------------------------
# Flattening (the tables of docs/TELEMETRY.md 7.2, as lists of dicts).

def flatten(runs: list[dict]) -> dict[str, list[dict]]:
    t: dict[str, list[dict]] = defaultdict(list)
    for r in runs:
        rid = r["runId"]
        bysl = {p["slot"]: p for p in r["players"]}
        win_fac = bysl[r["winnerSlot"]]["faction"] if r["winnerSlot"] in bysl else None
        fb = r.get("firstBlood")
        t["runs"].append({
            "run_id": rid, "source": r.get("source"), "build": r["build"]["server"], "commit_sha": r["build"].get("commit"),
            "day": day_of(r["endedAtEpoch"]), "started_at": r["startedAtEpoch"], "ended_at": r["endedAtEpoch"],
            "duration_ms": r["durationMs"], "end_reason": r["end"], "seed": r["seed"], "attempt": r["attempt"],
            "humans": r["humans"], "bots": r["bots"], "winner_slot": r["winnerSlot"], "winner_faction": win_fac,
            "win_bonus_paid": bool(r.get("winBonusPaid")),
            "teleports": len(r["coliseum"]["teleports"]),
            "first_teleport_ms": (r["coliseum"]["teleports"] or [None])[0],
            "first_blood_ms": fb["at"] if fb else None,
            "first_blood_victim_bot": bysl[fb["victim"]]["bot"] if fb and fb["victim"] in bysl else None,
            "first_blood_victim_faction": bysl[fb["victim"]]["faction"] if fb and fb["victim"] in bysl else None,
            "duels": len(r["duels"]), "truncated": bool(r.get("truncated")),
        })
        for p in r["players"]:
            d = p.get("death") or {}
            dk = d.get("kind")
            detail = ""
            if dk == "mob":
                detail = d.get("mobType") or ""
            elif dk in ("player", "zombie") and d.get("bySlot") in bysl:
                detail = bysl[d["bySlot"]]["faction"]
            fin = p["final"]
            client = p.get("client") or {}
            t["players"].append({
                "run_id": rid, "slot": p["slot"], "pid": p.get("pid"), "bot": p["bot"], "tier": p.get("tier"),
                "persona": p.get("persona"), "faction": p["faction"], "spawn_zone": p["spawn"]["zone"],
                "spawn_picked": p["spawn"]["picked"], "place": p["place"], "outcome": p["outcome"],
                "won": p["outcome"] == "won", "finished": r["end"] in FINISHED_ENDS, "alive_ms": p["aliveMs"], "death_kind": dk, "death_detail": detail,
                "death_ms": d.get("at"), "death_zone": d.get("zone"), "death_coliseum": d.get("coliseum"),
                "death_camp": d.get("camp"), "kills": p["kills"], "bot_kills": p["botKills"],
                "mob_kills": sum(p["mobKills"].values()), "elite_kills": p["eliteKills"],
                "camps_cleared": p["campsCleared"], "farm_ms": p["farmMs"], "main_weapon": p["mainWeapon"],
                "card_power": fin["cardPower"], "mob_stats_total": fin["mobStatsTotal"],
                "boosts_total": fin["boostsTotal"], "max_hp": fin["maxHp"],
                "dmg_players": sum(p["dealt"]["players"].values()), "dmg_mobs": sum(p["dealt"]["mobs"].values()),
                "dmg_taken": sum(p["taken"].values()), "healed": sum(p["healed"].values()),
                "wish_casts": p["wish"]["casts"], "wish_landed": p["wish"]["landed"],
                "potions": p["potions"]["small"] + p["potions"]["large"],
                "quests_accepted": len(p["quests"]["accepted"]), "quests_completed": len(p["quests"]["completed"]),
                "gv_total": sum(p["gv"].values()), "drops": p["net"]["drops"], "reconnects": p["net"]["reconnects"],
                "fps_p50": client.get("fpsP50"), "frame_p95": client.get("frameMsP95"),
                "rtt_p50": client.get("rttP50"), "rtt_p95": client.get("rttP95"),
                "afk": p["afk"], "afk_ms": p["afkMs"], "quit": p["quit"], "tiles": p.get("tiles"),
                "p5": next((s["cardPower"] for s in p["snapshots"] if s["minute"] == 5), None),
            })
            for w, ms in p["weaponMs"].items():
                t["player_weapons"].append({"run_id": rid, "slot": p["slot"], "weapon": w, "ms": ms, "bot": p["bot"]})
            for c, n in fin["cards"].items():
                t["player_cards"].append({"run_id": rid, "slot": p["slot"], "card": c, "count": n})
            for s in p["snapshots"]:
                t["power_snaps"].append({"run_id": rid, "slot": p["slot"], "bot": p["bot"], "faction": p["faction"],
                                         "minute": s["minute"], "card_power": s["cardPower"],
                                         "mob_stats_total": s["mobStatsTotal"], "boosts_total": s["boostsTotal"]})
        for o in r["offers"]:
            chose: dict[int, int] = {}
            for pk in o["picks"]:
                chose.setdefault(pk["slot"], pk["option"])
            # Anyone in range may pick (a crate's list is who stood in range at the drop): a picker was offered it too.
            for slot in dict.fromkeys([*o["eligible"], *chose]):
                if slot not in bysl:
                    continue
                choice = chose.get(slot, -2)
                for pos, opt in enumerate(o["options"]):
                    t["offer_options"].append({
                        "run_id": rid, "i": o["i"], "slot": slot, "pos": pos, "kind": o["kind"],
                        "option": option_group(o["kind"], opt), "picked": choice == pos, "choice": choice,
                        "bot": bysl[slot]["bot"], "won": bysl[slot]["outcome"] == "won", "elite": o["elite"],
                        "finished": r["end"] in FINISHED_ENDS,
                    })
        for c in r["camps"]:
            k = bysl.get(c["killerSlot"])
            t["camp_clears"].append({
                "run_id": rid, "camp": c["camp"], "cycle": c["cycle"], "zone": c["zone"], "mob_type": c["type"],
                "elite_type": c["elite"], "engaged_ms": c["engagedAt"], "cleared_ms": c["clearedAt"],
                "clear_ms": c["clearedAt"] - c["engagedAt"], "killer_slot": c["killerSlot"],
                "killer_faction": k["faction"] if k else None, "killer_weapon": k["mainWeapon"] if k else None,
                "killer_bot": k["bot"] if k else None, "contributors": len(c["contributors"]), "player_deaths": c["playerDeaths"],
            })
        for d in r["duels"]:
            a, b = d["sides"]
            t["duels"].append({
                "run_id": rid, "i": d["i"], "start_ms": d["start"], "dur_ms": d["end"] - d["start"],
                "a_slot": a["slot"], "b_slot": b["slot"], "bots": int(a["bot"]) + int(b["bot"]),
                "a_faction": a["faction"], "b_faction": b["faction"], "a_weapon": a["weapon"], "b_weapon": b["weapon"],
                "a_power": a["cardPower"], "b_power": b["cardPower"],
                "a_stacks": a["mobStatsTotal"] + a["boostsTotal"], "b_stacks": b["mobStatsTotal"] + b["boostsTotal"],
                "a_hp": a["hp"], "b_hp": b["hp"], "a_hp_end": a["hpEnd"], "b_hp_end": b["hpEnd"],
                "a_dmg": sum(a["dmg"].values()), "b_dmg": sum(b["dmg"].values()),
                "a_wishes": a["wishes"], "b_wishes": b["wishes"], "first": d["first"], "outcome": d["outcome"],
                "winner": d["winner"], "third": d["third"], "clean": d["clean"], "zone": d["zone"],
                "coliseum": d["coliseum"], "comeback": d["comeback"],
                "a_pid": bysl[a["slot"]].get("pid"), "b_pid": bysl[b["slot"]].get("pid"),
                "a_tier": bysl[a["slot"]].get("tier"), "b_tier": bysl[b["slot"]].get("tier"),
            })
            for side, s in enumerate((a, b)):
                for card in s["augments"]:
                    t["duel_cards"].append({"run_id": rid, "i": d["i"], "side": side, "card": card})
    return t


# ---------------------------------------------------------------------------------------------------------------
# Pools and the endpoint aggregations (one function per /api/stats/* path, the same definitions).

def in_pool_player(bot: bool | None, pool: str) -> bool:
    if pool == "all":
        return True
    if bot is None:
        return False
    return (not bot) if pool == "humans" else bot


def in_pool_run(humans: int, pool: str) -> bool:
    """The run-level pool (the store's runWhere with runPool): humans = a run with any human, bots = none."""
    return pool == "all" or (pool == "humans" and humans > 0) or (pool == "bots" and humans == 0)


def in_pool_duel(bots: int, pool: str) -> bool:
    return pool == "all" or (pool == "humans" and bots == 0) or (pool == "bots" and bots == 2)


class Stats:
    def __init__(self, tables: dict[str, list[dict]], query: dict, now: int = 0):
        self.t = tables
        self.q = query
        self.now = now
        self.pool = query["pool"]
        self.players = [p for p in tables["players"] if in_pool_player(p["bot"], self.pool)
                        and (not query.get("faction") or p["faction"] == query["faction"])
                        and (not query.get("weapon") or p["main_weapon"] == query["weapon"])]
        self.duels = [d for d in tables["duels"] if in_pool_duel(d["bots"], self.pool)]
        self.pool_runs = [r for r in tables["runs"] if in_pool_run(r["humans"], self.pool)]
        # Win rates (factions, weapons, offers) count only runs that had a winner or a draw, as the store's FINISHED.
        self.finished = [p for p in self.players if p["finished"]]

    def env(self, rows: list, notes: list[str] | None = None) -> dict:
        e = {"query": self.q, "generatedAt": self.now, "rows": rows}
        if notes:
            e["notes"] = notes
        return e

    def meta(self) -> dict:
        runs = self.t["runs"]
        builds: dict[str, dict] = {}
        for r in runs:
            b = builds.setdefault(r["build"], {"build": r["build"], "commit": r["commit_sha"], "firstDay": r["day"], "lastDay": r["day"], "runs": 0})
            b["runs"] += 1
            b["firstDay"] = min(b["firstDay"], r["day"])
            b["lastDay"] = max(b["lastDay"], r["day"])
        seeds: dict[tuple, int] = defaultdict(int)
        for r in runs:
            seeds[(r["seed"], r["attempt"])] += 1
        days = [r["day"] for r in runs]
        return {
            "schemaVersion": SCHEMA_VERSION,
            "builds": sorted(builds.values(), key=lambda b: b["lastDay"], reverse=True),
            "firstDay": min(days) if days else None, "lastDay": max(days) if days else None, "runs": len(runs),
            "seeds": [{"seed": s, "attempt": a, "runs": n} for (s, a), n in sorted(seeds.items(), key=lambda x: -x[1])[:50]],
        }

    def overview(self) -> dict:
        runs = self.pool_runs
        fb = [r["first_blood_ms"] / 1000 for r in runs if r["first_blood_ms"] is not None]
        allp = self.t["players"]
        return self.env([{
            "runs": len(runs), "players": len(self.players),
            "humans": sum(1 for p in allp if not p["bot"]), "bots": sum(1 for p in allp if p["bot"]),
            "duels": len(self.duels),
            "medianDurationS": r2(median([r["duration_ms"] / 1000 for r in runs])) or 0,
            "medianFirstBloodS": r2(median(fb)),
            "voided": sum(1 for r in runs if r["end_reason"] in ("void", "abandoned")),
        }])

    def factions(self) -> dict:
        rows = []
        for f in FACTIONS:
            ps = [p for p in self.finished if p["faction"] == f]
            if not ps:
                continue
            rows.append({"faction": f, "win": wilson95(sum(p["won"] for p in ps), len(ps)),
                         "avgPlace": round(mean([p["place"] for p in ps]), 2), "avgKills": round(mean([p["kills"] + p["bot_kills"] for p in ps]), 2),
                         "avgMobKills": round(mean([p["mob_kills"] for p in ps]), 2),
                         "avgAliveS": round(mean([p["alive_ms"] / 1000 for p in ps]), 1)})
        return self.env(rows)

    def weapons(self) -> dict:
        keys = {(p["run_id"], p["slot"]) for p in self.players}
        held = defaultdict(float)
        for w in self.t["player_weapons"]:
            if (w["run_id"], w["slot"]) in keys:
                held[w["weapon"]] += w["ms"]
        total = sum(held.values()) or 1
        rows = []
        for w in WEAPONS:
            ps = [p for p in self.finished if p["main_weapon"] == w]
            if not ps and not held.get(w):
                continue
            rows.append({"weapon": w, "win": wilson95(sum(p["won"] for p in ps), len(ps)), "heldShare": round(held[w] / total, 4)})
        return self.env(rows)

    def _matrix(self, col_a: str, col_b: str, clean: bool, outcomes: list[str], order: list[str]) -> dict:
        cells: dict[tuple, list] = defaultdict(lambda: [0, 0, []])
        for d in self.duels:
            if d["outcome"] not in outcomes or d["winner"] < 0 or (clean and not d["clean"]):
                continue
            for side, (row, col) in enumerate(((d[col_a], d[col_b]), (d[col_b], d[col_a]))):
                c = cells[(row, col)]
                c[0] += 1
                c[1] += 1 if d["winner"] == side else 0
                c[2].append(d["dur_ms"] / 1000)
        rows = []
        for r in order:
            for c in order:
                if (r, c) in cells:
                    n, k, durs = cells[(r, c)]
                    # A mirror cell sees each duel from both sides: n counts 2 per duel and k 1.
                    rows.append({"row": r, "col": c, "win": wilson95(k, n), "medianDurationS": r2(median(durs)) or 0})
        return self.env(rows)

    def duel_factions(self, clean: bool = True, outcomes: list[str] | None = None) -> dict:
        return self._matrix("a_faction", "b_faction", clean, outcomes or ["kill"], FACTIONS)

    def duel_weapons(self, clean: bool = True, outcomes: list[str] | None = None) -> dict:
        return self._matrix("a_weapon", "b_weapon", clean, outcomes or ["kill"], WEAPONS)

    def duel_summary(self) -> dict:
        ds = self.duels
        n = len(ds)
        outcomes: dict[str, int] = defaultdict(int)
        for d in ds:
            outcomes[d["outcome"]] += 1
        cb = [d for d in ds if d["comeback"] is not None]
        fs = [d for d in ds if d["winner"] >= 0 and d["first"] != 2]
        return self.env([{
            "n": n, "outcomes": dict(outcomes),
            "clean": wilson95(sum(d["clean"] for d in ds), n),
            "disengage": wilson95(outcomes.get("disengage", 0), n),
            "thirdParty": wilson95(outcomes.get("thirdParty", 0), n),
            "comeback": wilson95(sum(1 for d in cb if d["comeback"]), len(cb)),
            "firstStrikerWins": wilson95(sum(1 for d in fs if d["first"] == d["winner"]), len(fs)),
            "medianDurationS": r2(median([d["dur_ms"] / 1000 for d in ds])) or 0,
        }])

    def offers(self, kind: str = "augment") -> dict:
        # offered, picked, picked&won, notPicked, notPicked&won (finished runs), picked (finished runs)
        per: dict[str, list] = defaultdict(lambda: [0, 0, 0, 0, 0, 0])
        for o in self.t["offer_options"]:
            if o["kind"] != kind or not in_pool_player(o["bot"], self.pool):
                continue
            c = per[o["option"]]
            c[0] += 1
            if o["picked"]:
                c[1] += 1
            if not o["finished"]:
                continue  # offered and picked count every run; the win rates only runs with a winner or a draw
            if o["picked"]:
                c[5] += 1
                c[2] += o["won"]
            else:
                c[3] += 1
                c[4] += o["won"]
        duel_win: dict[str, list] = defaultdict(lambda: [0, 0])
        if kind == "augment":
            held = defaultdict(set)
            for c in self.t["duel_cards"]:
                held[(c["run_id"], c["i"], c["side"])].add(c["card"])
            for d in self.duels:
                if d["outcome"] != "kill" or not d["clean"] or d["winner"] < 0:
                    continue
                for side in (0, 1):
                    for card in held.get((d["run_id"], d["i"], side), ()):
                        duel_win[card][0] += 1
                        duel_win[card][1] += 1 if d["winner"] == side else 0
        rows = []
        for opt, (offered, picked, pw, npk, npw, pf) in sorted(per.items(), key=lambda x: -x[1][0]):
            row = {"kind": kind, "option": opt, "offered": offered, "pick": wilson95(picked, offered),
                   "winPicked": wilson95(pw, pf), "winNotPicked": wilson95(npw, npk)}
            if kind == "augment":
                n, k = duel_win.get(opt, (0, 0))
                row["duelWin"] = wilson95(k, n)
            rows.append(row)
        notes = [STAT_OFFER_NOTE] if kind == "stat" else None
        return self.env(rows, notes)

    def farming(self) -> dict:
        keys = {(p["run_id"], p["slot"]) for p in self.players}
        snaps = defaultdict(list)
        for s in self.t["power_snaps"]:
            if (s["run_id"], s["slot"]) in keys:
                snaps[(s["faction"], s["minute"])].append(s)
        rows = []
        for f in FACTIONS:
            ps = [p for p in self.players if p["faction"] == f]
            if not ps:
                continue
            rows.append({
                "faction": f, "players": len(ps), "avgMobKills": round(mean([p["mob_kills"] for p in ps]), 2),
                "avgEliteKills": round(mean([p["elite_kills"] for p in ps]), 2),
                "avgFarmS": round(mean([p["farm_ms"] / 1000 for p in ps]), 1),
                "powerAt": [r2(mean([s["card_power"] for s in snaps[(f, m)]])) if snaps[(f, m)] else None for m in SNAPSHOT_MINUTES],
                "mobStatsAt": [r2(mean([s["mob_stats_total"] for s in snaps[(f, m)]])) if snaps[(f, m)] else None for m in SNAPSHOT_MINUTES],
            })
        return self.env(rows)

    def camps(self, by: str = "faction") -> dict:
        col = "killer_faction" if by == "faction" else "killer_weapon"
        groups: dict[tuple, list] = defaultdict(list)
        for c in self.t["camp_clears"]:
            if not in_pool_player(c["killer_bot"], self.pool):
                continue
            groups[(c["mob_type"], c["elite_type"], c[col])].append(c)
        # deaths to a camp type: player rows (in the pool) whose mob death names the camp's type
        rows = []
        for (typ, elite, key), cs in sorted(groups.items(), key=lambda x: (-len(x[1]), x[0][0])):
            rows.append({"type": typ, "elite": elite, "faction": key if by == "faction" else None,
                         "weapon": key if by == "weapon" else None, "clears": len(cs),
                         "medianClearS": r2(median([c["clear_ms"] / 1000 for c in cs])) or 0,
                         "playerDeaths": sum(c["player_deaths"] for c in cs)})
        return self.env(rows)

    def deaths(self) -> dict:
        ps = [p for p in self.players if p["death_kind"]]
        by_faction: dict[str, int] = defaultdict(int)
        groups: dict[tuple, int] = defaultdict(int)
        for p in ps:
            groups[(p["death_kind"], p["faction"], p["death_detail"])] += 1
            by_faction[p["faction"]] += 1
        # `share` is the row's share of its victim faction's deaths (each faction's bar sums to 1), as the store's.
        rows = [{"kind": k, "faction": f, "detail": d, "n": n, "share": round(n / by_faction[f], 4)}
                for (k, f, d), n in sorted(groups.items(), key=lambda x: -x[1])]
        return self.env(rows)

    def firstblood(self) -> dict:
        bins = [0] * 21
        for r in self.pool_runs:
            if r["first_blood_ms"] is None:
                continue
            bins[min(20, int(r["first_blood_ms"] // 15000))] += 1
        rows = [{"fromS": i * 15, "toS": (i + 1) * 15 if i < 20 else 3600, "n": n} for i, n in enumerate(bins)]
        return self.env(rows)

    def heatmap(self) -> dict:
        w = MAP_TILES // HEAT_CELL_TILES
        cells: dict[tuple, int] = defaultdict(int)
        for p in self.players:
            if not p["tiles"]:
                continue
            raw = base64.b64decode(p["tiles"])
            for i in range(0, len(raw) - 1, 2):
                if raw[i] == TILE_ABSENT:
                    continue
                cells[(raw[i] // HEAT_CELL_TILES, raw[i + 1] // HEAT_CELL_TILES)] += 1
        return {"query": self.q, "w": w, "h": w, "cells": [[x, y, s] for (x, y), s in sorted(cells.items())],
                "runs": len(self.pool_runs), "generatedAt": self.now}

    def perf(self) -> dict:
        ps = self.players
        hum = [p for p in ps if not p["bot"]]

        def med(k: str) -> float | None:
            return r2(median([p[k] for p in hum if p[k] is not None]))

        runs = {p["run_id"] for p in ps}
        return self.env([{
            "samples": sum(1 for p in hum if p["fps_p50"] is not None), "fpsP50": med("fps_p50"),
            "frameMsP95": med("frame_p95"), "rttP50": med("rtt_p50"), "rttP95": med("rtt_p95"),
            "reconnectsPerRun": round(sum(p["reconnects"] for p in ps) / len(runs), 3) if runs else 0,
            "afk": wilson95(sum(p["afk"] for p in hum), len(hum)), "quit": wilson95(sum(p["quit"] for p in ps), len(ps)),
        }])

    def runs(self, limit: int = 20) -> dict:
        rs = sorted(self.t["runs"], key=lambda r: -r["ended_at"])[:limit]
        return self.env([{"runId": r["run_id"], "build": r["build"], "endedAtEpoch": r["ended_at"],
                          "durationS": round(r["duration_ms"] / 1000, 1), "humans": r["humans"], "bots": r["bots"],
                          "end": r["end_reason"], "winnerFaction": r["winner_faction"], "source": r["source"]} for r in rs])


# ---------------------------------------------------------------------------------------------------------------
# The skill-adjusted logistic model (numpy).

def fit_logistic(X, y, penalty, iters: int = 50):
    """Newton / IRLS with an L2 penalty per column (0 = unpenalised). Returns (beta, covariance)."""
    import numpy as np
    beta = np.zeros(X.shape[1])
    # a tiny ridge on every column keeps H invertible when a column is all zero (a level or term never seen)
    P = np.diag(np.asarray(penalty, dtype=float) + 1e-6)
    for _ in range(iters):
        z = X @ beta
        p = 1 / (1 + np.exp(-z))
        g = X.T @ (y - p) - P @ beta
        W = p * (1 - p)
        H = (X.T * W) @ X + P
        step = np.linalg.solve(H, g)
        beta += step
        if np.max(np.abs(step)) < 1e-9:
            break
    z = X @ beta
    p = 1 / (1 + np.exp(-z))
    H = (X.T * (p * (1 - p))) @ X + P
    return beta, np.linalg.inv(H)


def sum_zero_basis(levels: list[str]):
    """Effects that sum to 0: level i < last gets column i; the last level is minus the sum."""
    import numpy as np
    k = len(levels)
    B = np.zeros((k, k - 1))
    for i in range(k - 1):
        B[i, i] = 1
    B[k - 1, :] = -1
    return B


def log_loss(y, p) -> float:
    import numpy as np
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def skill_key(pid: str | None, tier: str | None) -> str | None:
    if pid:
        return "pid:" + pid
    if tier:
        return "bot:" + tier
    return None


def duel_model(duels: list[dict], ridge: float = 1.0) -> dict:
    import numpy as np
    ds = [d for d in duels if d["outcome"] == "kill" and d["clean"] and d["winner"] >= 0]
    if not ds:
        return {"n": 0}
    fb = sum_zero_basis(FACTIONS)
    wb = sum_zero_basis(WEAPONS)
    skills = sorted({k for d in ds for k in (skill_key(d["a_pid"], d["a_tier"]), skill_key(d["b_pid"], d["b_tier"])) if k})
    si = {k: i for i, k in enumerate(skills)}
    nf, nw, ns = len(FACTIONS) - 1, len(WEAPONS) - 1, len(skills)
    cols = nf + nw + 4 + ns
    X = np.zeros((len(ds), cols))
    y = np.zeros(len(ds))
    for r, d in enumerate(ds):
        X[r, :nf] = fb[FACTIONS.index(d["a_faction"])] - fb[FACTIONS.index(d["b_faction"])]
        X[r, nf:nf + nw] = wb[WEAPONS.index(d["a_weapon"])] - wb[WEAPONS.index(d["b_weapon"])]
        o = nf + nw
        X[r, o] = math.log1p(d["a_power"]) - math.log1p(d["b_power"])
        X[r, o + 1] = (d["a_stacks"] - d["b_stacks"]) / 10
        X[r, o + 2] = d["a_hp"] - d["b_hp"]
        X[r, o + 3] = 1 if d["first"] == 0 else -1 if d["first"] == 1 else 0
        ka, kb = skill_key(d["a_pid"], d["a_tier"]), skill_key(d["b_pid"], d["b_tier"])
        if ka:
            X[r, o + 4 + si[ka]] += 1
        if kb:
            X[r, o + 4 + si[kb]] -= 1
        y[r] = 1.0 if d["winner"] == 0 else 0.0
    pen = np.zeros(cols)
    pen[nf + nw + 4:] = ridge
    beta, cov = fit_logistic(X, y, pen)
    # faction-only baseline
    beta0, _ = fit_logistic(X[:, :nf], y, np.zeros(nf))

    def effects(basis, lo, hi, levels):
        b = beta[lo:hi]
        c = cov[lo:hi, lo:hi]
        eff = basis @ b
        var = np.einsum("ij,jk,ik->i", basis, c, basis)
        return {lv: {"coef": float(eff[i]), "lo": float(eff[i] - Z95 * math.sqrt(var[i])), "hi": float(eff[i] + Z95 * math.sqrt(var[i]))}
                for i, lv in enumerate(levels)}

    F = effects(fb, 0, nf, FACTIONS)
    W = effects(wb, nf, nf + nw, WEAPONS)
    o = nf + nw
    names = ["g_log1p_power", "h_stacks_per_10", "d_hp", "k_first"]
    terms = {nm: {"coef": float(beta[o + i]), "lo": float(beta[o + i] - Z95 * math.sqrt(cov[o + i, o + i])),
                  "hi": float(beta[o + i] + Z95 * math.sqrt(cov[o + i, o + i]))} for i, nm in enumerate(names)}
    implied = {fa: {fb_: 1 / (1 + math.exp(-(F[fa]["coef"] - F[fb_]["coef"]))) for fb_ in FACTIONS} for fa in FACTIONS}
    return {
        "n": len(ds), "factions": F, "weapons": W, "terms": terms,
        "skills": {k: float(beta[o + 4 + i]) for k, i in si.items()},
        "impliedEvenPower": implied,
        "logLoss": log_loss(y, 1 / (1 + np.exp(-(X @ beta)))),
        "logLossFactionOnly": log_loss(y, 1 / (1 + np.exp(-(X[:, :nf] @ beta0)))),
        "tooFew": len(ds) < MODEL_MIN_DUELS,
    }


def run_model(players: list[dict], ridge: float = 1.0) -> dict:
    """won ~ faction + main weapon + log1p(card power at minute 5) + s[pid]."""
    import numpy as np
    # Only players who stood at minute 5: a missing snapshot means "down before minute 5" (a certain loss), and coding it as
    # power 0 would make the power term measure survival.
    ps = [p for p in players if p["outcome"] != "alive" and p["p5"] is not None]
    if not ps:
        return {"n": 0}
    fb = sum_zero_basis(FACTIONS)
    wb = sum_zero_basis(WEAPONS)
    skills = sorted({skill_key(p["pid"], p["tier"]) for p in ps if skill_key(p["pid"], p["tier"])})
    si = {k: i for i, k in enumerate(skills)}
    nf, nw = len(FACTIONS) - 1, len(WEAPONS) - 1
    cols = 1 + nf + nw + 1 + len(skills)
    X = np.zeros((len(ps), cols))
    y = np.zeros(len(ps))
    for r, p in enumerate(ps):
        X[r, 0] = 1
        X[r, 1:1 + nf] = fb[FACTIONS.index(p["faction"])]
        X[r, 1 + nf:1 + nf + nw] = wb[WEAPONS.index(p["main_weapon"])]
        X[r, 1 + nf + nw] = math.log1p(p["p5"])
        k = skill_key(p["pid"], p["tier"])
        if k:
            X[r, 2 + nf + nw + si[k]] = 1
        y[r] = 1.0 if p["won"] else 0.0
    pen = np.zeros(cols)
    pen[2 + nf + nw:] = ridge
    beta, cov = fit_logistic(X, y, pen)
    eff = fb @ beta[1:1 + nf]
    var = np.einsum("ij,jk,ik->i", fb, cov[1:1 + nf, 1:1 + nf], fb)
    return {"n": len(ps), "factions": {f: {"coef": float(eff[i]), "lo": float(eff[i] - Z95 * math.sqrt(var[i])),
                                             "hi": float(eff[i] + Z95 * math.sqrt(var[i]))} for i, f in enumerate(FACTIONS)},
            "power5": float(beta[1 + nf + nw])}


# ---------------------------------------------------------------------------------------------------------------
# The report.

def pct(c: dict) -> str:
    flag = " *" if c["n"] < SMALL_N else ""
    return f"{100 * c['rate']:5.1f}% [{100 * c['lo']:4.1f}-{100 * c['hi']:5.1f}] n={c['n']:g}{flag}"


def table(title: str, header: list[str], rows: list[list]) -> str:
    out = [f"\n== {title} =="]
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) if rows else len(str(h)) for i, h in enumerate(header)]
    out.append("  ".join(str(h).ljust(w) for h, w in zip(header, widths)))
    for r in rows:
        out.append("  ".join(str(c).ljust(w) for c, w in zip(r, widths)))
    if not rows:
        out.append("(no data)")
    return "\n".join(out)


def compute_all(s: Stats) -> dict:
    out = {
        "/api/stats/meta": s.meta(),
        "/api/stats/overview": s.overview(),
        "/api/stats/factions": s.factions(),
        "/api/stats/weapons": s.weapons(),
        "/api/stats/duels/factions": s.duel_factions(),
        "/api/stats/duels/factions?clean=0": s.duel_factions(clean=False),
        "/api/stats/duels/factions?outcomes=kill,thirdParty": s.duel_factions(outcomes=["kill", "thirdParty"]),
        "/api/stats/duels/weapons": s.duel_weapons(),
        "/api/stats/duels/weapons?clean=0": s.duel_weapons(clean=False),
        "/api/stats/duels/summary": s.duel_summary(),
        "/api/stats/offers": s.offers("augment"),
        "/api/stats/offers?kind=stat": s.offers("stat"),
        "/api/stats/offers?kind=trophy": s.offers("trophy"),
        "/api/stats/farming": s.farming(),
        "/api/stats/camps": s.camps("faction"),
        "/api/stats/camps?by=weapon": s.camps("weapon"),
        "/api/stats/deaths": s.deaths(),
        "/api/stats/firstblood": s.firstblood(),
        "/api/stats/heatmap": s.heatmap(),
        "/api/stats/perf": s.perf(),
        "/api/stats/runs": s.runs(),
    }
    return out


def report(res: dict, model: dict | None, run_mod: dict | None) -> str:
    parts = []
    ov = res["/api/stats/overview"]["rows"][0]
    q = res["/api/stats/overview"]["query"]
    parts.append(f"pool={q['pool']} build={q.get('build') or 'all'} source={q.get('source')} from={q.get('from') or '-'} to={q.get('to') or '-'}")
    parts.append(table("Overview", ["runs", "players", "humans", "bots", "duels", "median run s", "median first blood s", "voided"],
                       [[ov["runs"], ov["players"], ov["humans"], ov["bots"], ov["duels"], ov["medianDurationS"], ov["medianFirstBloodS"], ov["voided"]]]))
    parts.append(table("Faction run win rate", ["faction", "win", "avg place", "kills", "mob kills", "alive s"],
                       [[r["faction"], pct(r["win"]), r["avgPlace"], r["avgKills"], r["avgMobKills"], r["avgAliveS"]] for r in res["/api/stats/factions"]["rows"]]))
    parts.append(table("Weapon run win rate (main weapon)", ["weapon", "win", "held share"],
                       [[r["weapon"], pct(r["win"]), f"{100 * r['heldShare']:.1f}%"] for r in res["/api/stats/weapons"]["rows"]]))
    for key, title in (("/api/stats/duels/factions", "Duel win rate faction x faction (clean kills, row's view)"),
                       ("/api/stats/duels/weapons", "Duel win rate weapon x weapon (clean kills, row's view)")):
        parts.append(table(title, ["row", "col", "win", "median s"],
                           [[c["row"], c["col"], pct(c["win"]), c["medianDurationS"]] for c in res[key]["rows"]]))
    ds = res["/api/stats/duels/summary"]["rows"][0]
    parts.append(table("Duel summary", ["n", "clean", "disengage", "third party", "comeback", "first striker wins", "median s"],
                       [[ds["n"], pct(ds["clean"]), pct(ds["disengage"]), pct(ds["thirdParty"]), pct(ds["comeback"]),
                         pct(ds["firstStrikerWins"]), ds["medianDurationS"]]]))
    parts.append("outcomes: " + ", ".join(f"{k} {v}" for k, v in sorted(ds["outcomes"].items(), key=lambda x: -x[1])))
    for key, title in (("/api/stats/offers", "Augments: offered vs picked"), ("/api/stats/offers?kind=stat", "Stat boosts"),
                       ("/api/stats/offers?kind=trophy", "Trophies")):
        rows = res[key]["rows"]
        hdr = ["option", "offered", "pick rate", "win if picked", "win if offered, not picked"] + (["clean duel win"] if key.endswith("offers") else [])
        parts.append(table(title, hdr, [[r["option"], r["offered"], pct(r["pick"]), pct(r["winPicked"]), pct(r["winNotPicked"])]
                                        + ([pct(r["duelWin"])] if "duelWin" in r else []) for r in rows]))
    parts.append(table("Farming and time to power", ["faction", "players", "mob kills", "elites", "farm s"] + [f"P@{m}m" for m in SNAPSHOT_MINUTES],
                       [[r["faction"], r["players"], r["avgMobKills"], r["avgEliteKills"], r["avgFarmS"]] + ["-" if v is None else v for v in r["powerAt"]]
                        for r in res["/api/stats/farming"]["rows"]]))
    parts.append(table("Camp clears by type x killer faction", ["type", "elite", "faction", "clears", "median clear s", "player deaths"],
                       [[r["type"], r["elite"] or "-", r["faction"], r["clears"], r["medianClearS"], r["playerDeaths"]] for r in res["/api/stats/camps"]["rows"]]))
    parts.append(table("Deaths by cause", ["kind", "victim faction", "detail", "n", "share of faction"],
                       [[r["kind"], r["faction"], r["detail"] or "-", r["n"], f"{100 * r['share']:.1f}%"] for r in res["/api/stats/deaths"]["rows"]]))
    fbins = [b for b in res["/api/stats/firstblood"]["rows"] if b["n"]]
    parts.append(table("First blood", ["from s", "to s", "runs"], [[b["fromS"], b["toS"], b["n"]] for b in fbins]))
    pf = res["/api/stats/perf"]["rows"][0]
    parts.append(table("Client and network", ["samples", "fps p50", "frame p95 ms", "rtt p50", "rtt p95", "reconnects/run", "afk", "quit"],
                       [[pf["samples"], pf["fpsP50"], pf["frameMsP95"], pf["rttP50"], pf["rttP95"], pf["reconnectsPerRun"], pct(pf["afk"]), pct(pf["quit"])]]))
    hm = res["/api/stats/heatmap"]
    parts.append(f"\nheatmap: {len(hm['cells'])} non-empty {HEAT_CELL_TILES}-tile cells from {hm['runs']} runs (only the coliseum lines up across seeds)")
    parts.append("\n* = n under 5: read as anecdote")
    if model is not None:
        if model.get("n", 0) == 0:
            parts.append("\n== Model ==\nno clean kill duels")
        else:
            parts.append(f"\n== Skill-adjusted duel model (clean kills, n={model['n']}) ==")
            if model["tooFew"]:
                parts.append(f"NOTE: under {MODEL_MIN_DUELS} clean kill duels: the intervals are too wide to act on.")
            parts.append(table("Faction effect (logit, sums to 0)", ["faction", "coef", "95% lo", "95% hi"],
                               [[f, f"{v['coef']:+.3f}", f"{v['lo']:+.3f}", f"{v['hi']:+.3f}"] for f, v in model["factions"].items()]))
            parts.append(table("Weapon effect (logit, sums to 0)", ["weapon", "coef", "95% lo", "95% hi"],
                               [[w, f"{v['coef']:+.3f}", f"{v['lo']:+.3f}", f"{v['hi']:+.3f}"] for w, v in model["weapons"].items()]))
            parts.append(table("Other terms", ["term", "coef", "95% lo", "95% hi"],
                               [[k, f"{v['coef']:+.3f}", f"{v['lo']:+.3f}", f"{v['hi']:+.3f}"] for k, v in model["terms"].items()]))
            imp = model["impliedEvenPower"]
            parts.append(table("Implied even-power win rate (row beats col)", ["row"] + FACTIONS,
                               [[a] + [f"{100 * imp[a][b]:.0f}%" for b in FACTIONS] for a in FACTIONS]))
            parts.append(f"log loss {model['logLoss']:.4f} vs faction-only {model['logLossFactionOnly']:.4f}; {len(model['skills'])} skill terms (ridge 1)")
        if run_mod and run_mod.get("n"):
            parts.append(table(f"Run-level model: won ~ faction + weapon + log1p(P@5m) + skill (n={run_mod['n']})", ["faction", "coef", "95% lo", "95% hi"],
                               [[f, f"{v['coef']:+.3f}", f"{v['lo']:+.3f}", f"{v['hi']:+.3f}"] for f, v in run_mod["factions"].items()]))
            parts.append(f"log1p(P@5m) coefficient {run_mod['power5']:+.3f}")
    return "\n".join(parts)


def write_dashboard_fixture(res: dict, run_record: dict, path: str) -> None:
    """deployment/cloudflare/src/dashboard/fixture.ts: each value typed as its endpoint's response via satisfies."""
    types = {
        "/api/stats/meta": "StatsMeta", "/api/stats/overview": "StatsEnvelope<OverviewRow>",
        "/api/stats/factions": "StatsEnvelope<FactionRow>", "/api/stats/weapons": "StatsEnvelope<WeaponRow>",
        "/api/stats/duels/factions": "StatsEnvelope<MatrixCell>", "/api/stats/duels/weapons": "StatsEnvelope<MatrixCell>",
        "/api/stats/duels/summary": "StatsEnvelope<DuelSummaryRow>", "/api/stats/offers": "StatsEnvelope<OfferRow>",
        "/api/stats/farming": "StatsEnvelope<FarmingRow>", "/api/stats/camps": "StatsEnvelope<CampRow>",
        "/api/stats/deaths": "StatsEnvelope<DeathRow>", "/api/stats/firstblood": "StatsEnvelope<FirstBloodBin>",
        "/api/stats/heatmap": "HeatmapResponse", "/api/stats/perf": "StatsEnvelope<PerfRow>",
        "/api/stats/runs": "StatsEnvelope<RunListRow>", "/api/stats/run/:runId": "RunRecord",
    }
    data = dict(res)
    data["/api/stats/run/:runId"] = run_record
    lines = [
        "// Generated by testing/telemetry/analyze.py --dashboard-fixture from testing/telemetry/fixtures/runs-v1.ndjson",
        "// (pool all, source any). Each value is typed as its endpoint's response, so a contract change breaks this build.",
        "// Keys are endpoint paths; a key with a query is the variant the dev server answers for those params.",
        "import type {",
        "  CampRow, DeathRow, DuelSummaryRow, FactionRow, FarmingRow, FirstBloodBin, HeatmapResponse, MatrixCell, OfferRow,",
        "  OverviewRow, PerfRow, RunListRow, RunRecord, StatsEnvelope, StatsMeta, WeaponRow,",
        '} from "@raid/shared/telemetry";',
        "",
        "const FIXTURE = {",
    ]
    for key, val in data.items():
        t = types[key.split("?")[0]]
        body = json.dumps(val, separators=(",", ":"))
        lines.append(f"  {json.dumps(key)}: {body} satisfies {t},")
    lines += ["};", "", "export const DASHBOARD_FIXTURE: Record<string, unknown> = FIXTURE;", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def run_sql(tables: dict[str, list[dict]], sql: str | None, save: str | None) -> None:
    try:
        import duckdb  # type: ignore
    except ImportError:
        print("DuckDB is not installed (pip install duckdb); --sql and --duckdb need it.", file=sys.stderr)
        return
    import tempfile
    con = duckdb.connect(save or ":memory:")
    with tempfile.TemporaryDirectory() as tmp:
        for name, rows in tables.items():
            if not rows:
                continue
            path = os.path.join(tmp, name + ".ndjson")
            with open(path, "w", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps({k: v for k, v in r.items() if k != "tiles"}) + "\n")
            # table names are this module's own constants, never input
            con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM read_json_auto(?)", [path])
    if sql:
        cur = con.execute(sql)
        print("\t".join(d[0] for d in cur.description))
        for row in cur.fetchall():
            print("\t".join("" if v is None else str(v) for v in row))
    con.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Telemetry balance report (docs/TELEMETRY.md section 9).")
    ap.add_argument("paths", nargs="*", help="NDJSON files or directories (runs-*.ndjson, *.json.gz)")
    ap.add_argument("--url", help="download from <url>/api/stats/export instead")
    ap.add_argument("--token-env", default="DASHBOARD_TOKEN", help="env var holding the dashboard token (with --url)")
    ap.add_argument("--build")
    ap.add_argument("--from", dest="d_from")
    ap.add_argument("--to", dest="d_to")
    ap.add_argument("--pool", choices=["humans", "bots", "all"], default="humans")
    ap.add_argument("--source", default="any", help="live, dev, tournament, bench, test or any (default any)")
    ap.add_argument("--faction")
    ap.add_argument("--weapon")
    ap.add_argument("--json", help="write every endpoint-shaped result here")
    ap.add_argument("--model", action="store_true", help="fit the skill-adjusted logistic model (numpy)")
    ap.add_argument("--dashboard-fixture", help="write the dashboard's fixture.ts here")
    ap.add_argument("--sql", help="run this SQL over the flattened tables (DuckDB)")
    ap.add_argument("--duckdb", help="save the flattened tables to this DuckDB file")
    a = ap.parse_args(argv)
    if a.url:
        token = os.environ.get(a.token_env, "")
        if not token:
            print(f"{a.token_env} is not set", file=sys.stderr)
            return 2
        runs = load_url(a.url, token, {"build": a.build, "from": a.d_from, "to": a.d_to, "pool": "all", "source": a.source})
    elif a.paths:
        runs = load_paths(a.paths)
    else:
        ap.print_usage(sys.stderr)
        return 2
    runs = filter_runs(runs, a.build, a.d_from, a.d_to, a.source)
    tables = flatten(runs)
    query = {"pool": a.pool, "source": a.source}
    # generatedAt is the newest record's end, so the same input always gives the same output.
    now = max((r["endedAtEpoch"] for r in runs), default=0)
    for k, v in (("build", a.build), ("from", a.d_from), ("to", a.d_to), ("faction", a.faction), ("weapon", a.weapon)):
        if v:
            query[k] = v
    s = Stats(tables, query, now)
    res = compute_all(s)
    model = run_mod = None
    if a.model:
        try:
            model = duel_model(s.duels)
            run_mod = run_model(s.players)
        except ImportError:
            print("--model needs numpy", file=sys.stderr)
    print(report(res, model, run_mod))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"results": res, "model": model, "runModel": run_mod}, f, indent=1)
    if a.dashboard_fixture:
        latest = max(runs, key=lambda r: r["endedAtEpoch"]) if runs else None
        if latest is None:
            print("no runs: no fixture written", file=sys.stderr)
        else:
            # StatsQuery has no "any" source: drop it from the echoed query.
            res_clean = json.loads(json.dumps(res))
            for v in res_clean.values():
                if isinstance(v, dict) and "query" in v and v["query"].get("source") == "any":
                    del v["query"]["source"]
            write_dashboard_fixture(res_clean, latest, a.dashboard_fixture)
    if a.sql or a.duckdb:
        run_sql(tables, a.sql, a.duckdb)
    return 0


if __name__ == "__main__":
    sys.exit(main())
