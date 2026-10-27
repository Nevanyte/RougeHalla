// How hard is a whole camp in the REAL sim (roguelike R4a, ROGUELIKE_PLAN R4a and 6)? A starting player (one faction, one
// weapon, no buffs) meets one mono-type camp of a zone on an open floor: a normal camp (`--size` normals of the zone's
// first type, 3 by default) or the zone's elite camp (its elite and two normals). It fights through the target lock, the
// game client's way: it clicks the nearest standing mob, and when that one dies, the next. Two pulls:
//   single  the camp as shipped: a mob wakes only when it is hurt (mobAI.aggro), so the player takes them one at a time
//           unless its swings or a signature reach a neighbour;
//   group   every mob of the camp is woken at the start (the plan's camp-wide aggro, D24, as a preview).
// The kills pay as in a run (GV, the type's buff stacks), so the buffs a camp gives already help with its last mobs.
// It reports time to clear (from the first mob waking to the last death) and hp left; a report, never a gate.
//
//   npx tsx bench/campDuel.ts                 each faction on its signature weapon, every zone, normal and elite, both pulls
//   npx tsx bench/campDuel.ts --weapons       each faction on each of the five weapons
//   options: --seeds N (3)  --size N (3)  --cap SECONDS (90)  --json FILE
import { writeFileSync } from "node:fs";
import {
  eliteTypeOf, FACTION_IDS, mulberry32, normalTypesOf, SIGNATURE_WEAPONS, TICK_MS, TILE, WEAPON_IDS, type FactionId,
  type MobTypeId, type Vec2, type WeaponId,
} from "@raid/shared";
import { buildArena } from "../src/harness/duel";
import { buffsOf } from "../src/sim/buffs";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { aggro } from "../src/sim/mobAI";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import { variantOf } from "./mobDuel";

export type Pull = "single" | "group";

export interface CampDuelSpec {
  player: FactionId;
  weapon?: WeaponId;
  zone: FactionId;
  elite: boolean;
  pull: Pull;
  seed: number;
  /** Normals in a normal camp (an elite camp is its elite and two normals). */
  size?: number;
  capSeconds?: number;
}

export interface CampDuelResult {
  spec: CampDuelSpec;
  outcome: "cleared" | "lost" | "timeout";
  /** Mobs killed, of the camp's. */
  killed: number;
  mobs: number;
  /** From the first mob waking to the last death (cleared only). */
  clearSeconds: number | null;
  /** The player's hp share at the end (0 when it fell), and the lowest it reached. */
  hpLeft: number;
  minHp: number;
  /** Buff stacks the camp paid, summed over the buffs. */
  stacks: number;
}

const ARENA_TILES = 40;
const CENTER = (ARENA_TILES * TILE) / 2;
const NEVER = 1_000_000;
const RING = 48;
const PLAYER_ID = "p";

export function runCampDuel(spec: CampDuelSpec): CampDuelResult {
  const cap = spec.capSeconds ?? 90;
  const weapon = spec.weapon ?? SIGNATURE_WEAPONS[spec.player];
  const v = variantOf(spec.seed, 320);
  const normal: MobTypeId = normalTypesOf(spec.zone)[0]!.id;
  const roster: Array<{ type: MobTypeId; elite: boolean }> = spec.elite
    ? [{ type: eliteTypeOf(spec.zone).id, elite: true }, { type: normal, elite: false }, { type: normal, elite: false }]
    : Array.from({ length: spec.size ?? 3 }, () => ({ type: normal, elite: false }));
  const home: Vec2 = { x: CENTER, y: CENTER };
  const start: Vec2 = { x: CENTER + Math.cos(v.angle) * v.distance, y: CENTER + Math.sin(v.angle) * v.distance };

  const world = createGameWorld({
    seed: spec.seed,
    random: mulberry32(spec.seed + 1),
    config: {
      minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER, patienceMinSeconds: NEVER, suddenDeathSeconds: NEVER, mobs: false,
    },
    map: { ...buildArena("open", [home, start], spec.seed), spawns: [start] },
  }, { signatures: true });
  const p = addPlayer(world, PLAYER_ID, PLAYER_ID, { faction: spec.player });
  p.weapon0 = weapon;
  p.weapon1 = "";
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("campDuel: the run did not start");

  const ids = roster.map((m, i) => {
    const a = (i / roster.length) * Math.PI * 2 + v.angle + Math.PI;
    const at = roster.length === 1 ? home : { x: home.x + Math.cos(a) * RING, y: home.y + Math.sin(a) * RING };
    return placeMob(world, { region: spec.zone, elite: m.elite, type: m.type, at, facing: Math.atan2(home.y - at.y, home.x - at.x) });
  });
  p.x = start.x;
  p.y = start.y;
  world.players.get(PLAYER_ID)!.history = [{ t: world.state.serverTime, x: p.x, y: p.y }];
  if (spec.pull === "group") {
    for (const id of ids) {
      const m = combatant(world, id);
      if (m?.kind === "mob") aggro(world, m, PLAYER_ID, 1);
    }
  }

  const prt = world.players.get(PLAYER_ID)!;
  const t0 = world.state.serverTime;
  let wokeAt: number | null = spec.pull === "group" ? t0 : null;
  let lastDeath = t0;
  let minHp = 1;
  let outcome: CampDuelResult["outcome"] = "timeout";
  const maxTicks = Math.round((cap * 1000) / TICK_MS);
  const alive = (id: string): boolean => world.state.mobs.get(id)?.status === "alive";
  for (let tick = 0; tick < maxTicks; tick++) {
    if (tick >= v.delayTicks && prt.weapon.lock === null) {
      // The nearest standing mob, the way a player clicks the next one.
      let best: { id: string; d: number } | null = null;
      for (const id of ids) {
        const m = world.state.mobs.get(id);
        if (!m || m.status !== "alive") continue;
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        if (!best || d < best.d) best = { id, d };
      }
      if (best) enqueueClientMessage(prt.inputs, "target", { id: best.id });
    }
    const before = ids.filter(alive).length;
    step(world, TICK_MS);
    if (wokeAt === null && ids.some((id) => world.mobs.get(id)?.brain?.mode !== "idle")) wokeAt = world.state.serverTime;
    if (ids.filter(alive).length < before) lastDeath = world.state.serverTime;
    minHp = Math.min(minHp, Math.max(0, p.hp) / p.maxHp);
    if (p.status !== "alive" || world.state.phase !== "active") { outcome = "lost"; break; }
    if (ids.every((id) => !alive(id))) { outcome = "cleared"; break; }
  }
  // Pay what the last kill queued (payLater runs inside the step, so nothing is left), then read the build.
  let stacks = 0;
  for (const n of buffsOf(p).values()) stacks += n;
  return {
    spec: { ...spec, weapon },
    outcome,
    killed: ids.filter((id) => !alive(id)).length,
    mobs: ids.length,
    clearSeconds: outcome === "cleared" && wokeAt !== null ? (lastDeath - wokeAt) / 1000 : null,
    hpLeft: outcome === "lost" ? 0 : Math.max(0, p.hp) / p.maxHp,
    minHp,
    stacks,
  };
}

// ------------------------------------------------------------------------------------------------------------- report

interface Cell { n: number; cleared: number; lost: number; timeouts: number; clear: number; hp: number; stacks: number }

function cellOf(rs: readonly CampDuelResult[]): Cell {
  const cleared = rs.filter((r) => r.outcome === "cleared");
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    n: rs.length,
    cleared: cleared.length,
    lost: rs.filter((r) => r.outcome === "lost").length,
    timeouts: rs.filter((r) => r.outcome === "timeout").length,
    clear: mean(cleared.map((r) => r.clearSeconds ?? 0)),
    hp: mean(rs.map((r) => r.hpLeft)),
    stacks: mean(rs.map((r) => r.stacks)),
  };
}

const pct = (x: number): string => (Number.isNaN(x) ? "-" : String(Math.round(x * 100)));

/** One table: rows player (weapon), columns zone; a cell is "cleared/n · seconds to clear · mean hp left %". */
function table(rows: Array<{ player: FactionId; weapon: WeaponId }>, cells: Map<string, Cell>, key: (r: { player: FactionId; weapon: WeaponId }, zone: FactionId) => string): string {
  const head = `| player (weapon) \\ zone | ${FACTION_IDS.join(" | ")} |`;
  const sep = `|---|${FACTION_IDS.map(() => "---").join("|")}|`;
  const body = rows.map((r) => {
    const cs = FACTION_IDS.map((z) => {
      const c = cells.get(key(r, z))!;
      const t = Number.isNaN(c.clear) ? "-" : `${c.clear.toFixed(1)}s`;
      return `${c.cleared}/${c.n} · ${t} · ${pct(c.hp)}%`;
    });
    return `| ${r.player} (${r.weapon}) | ${cs.join(" | ")} |`;
  });
  return [head, sep, ...body].join("\n");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("--seeds") ?? 3);
  const size = Number(arg("--size") ?? 3);
  const cap = Number(arg("--cap") ?? 90);
  const allWeapons = process.argv.includes("--weapons");
  const rows = FACTION_IDS.flatMap((player) =>
    (allWeapons ? WEAPON_IDS : [SIGNATURE_WEAPONS[player]]).map((weapon) => ({ player, weapon })));
  const all: CampDuelResult[] = [];
  const cells = new Map<string, Cell>();
  const key = (r: { player: FactionId; weapon: WeaponId }, zone: FactionId, elite: boolean, pull: Pull): string =>
    `${r.player}|${r.weapon}|${zone}|${elite}|${pull}`;
  for (const r of rows) {
    for (const zone of FACTION_IDS) {
      for (const elite of [false, true]) {
        for (const pull of ["single", "group"] as const) {
          const rs: CampDuelResult[] = [];
          for (let seed = 1; seed <= seeds; seed++) {
            rs.push(runCampDuel({ player: r.player, weapon: r.weapon, zone, elite, pull, seed, size, capSeconds: cap }));
          }
          all.push(...rs);
          cells.set(key(r, zone, elite, pull), cellOf(rs));
        }
      }
    }
    process.stderr.write(`${r.player} (${r.weapon}) done\n`);
  }
  for (const elite of [false, true]) {
    for (const pull of ["single", "group"] as const) {
      const what = elite ? "elite camp (elite + 2 normals)" : `normal camp (${size} normals)`;
      console.log(`\n## ${what}, ${pull} pull: cleared/${seeds} · seconds to clear · mean hp left`);
      console.log(table(rows, cells, (r, z) => key(r, z, elite, pull)));
    }
  }
  const json = arg("--json");
  if (json) writeFileSync(json, JSON.stringify(all, null, 1));
}
