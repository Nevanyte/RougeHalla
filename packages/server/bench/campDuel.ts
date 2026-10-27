// How hard is a whole camp in the REAL sim (roguelike R4a, ROGUELIKE_PLAN R4a, R5 and 6)? A starting player (one faction, one
// weapon, no buffs, no second weapon) meets one mono-type camp of a zone on an open floor: a normal camp (`--size` normals of
// the zone's first type, 4 by default: the generator's camps hold 3 to 5, about 4) or the zone's elite camp (its elite and
// `--size` - 1 normals, so the same number of mobs). It fights through the target
// lock, the game client's way: it clicks the nearest standing mob, and when that one dies, the next. Three pulls:
//   camp    the camp as shipped since R5: the mobs are placed WITH their camp (MobState.camp, and a published CampState), all
//           idle on their spots; the player walks up and its first landed hit wakes every member at once through
//           mobAI.aggro (camp-wide aggro, D24, CAMP_WIDE_AGGRO). The primary measurement ("full camp under D24");
//   single  the camp before R5: a mob wakes only when it is hurt, so the player takes them one at a time unless its swings or
//           a signature reach a neighbour. The mobs here are placed without a camp (MobState.camp 0), so the fan-out never
//           happens between them;
//   group   a stress case, harder than a real pull: every mob is woken by hand at tick 0 (no camp), so the camp walks at the
//           player from the start and gets the first strike, which D24 never allows a ranged player.
// The camp has a territory as on a generated map (ROGUELIKE_PLAN D15, a disc of TERRITORY_TILES around it, about the median
// territory of 330 tiles): the `camp` pull's mobs leash to it within min(radius, 12 tiles) of their spots, not the 9-tile
// circle of a hand-built map (`--no-territory` for that one). `single` and `group` place their mobs without a camp, so they
// keep the circle. The kills pay as in a run (GV, the type's buff stacks), so the buffs a camp gives already help with its
// last mobs.
// It reports time to clear (from the first mob waking to the last death) and hp left; a report, never a gate.
//
//   npx tsx bench/campDuel.ts                 each faction on its signature weapon, every zone, normal and elite, all three pulls
//   npx tsx bench/campDuel.ts --weapons       each faction on each of the five weapons
//   options: --seeds N (3)  --size N (4)  --cap SECONDS (90)  --no-territory  --json FILE  --pulls camp,single,group
//            --k X  --elite-k X (a what-if scale, through setMobScalesForHarness; MOB_K and ELITE_K when left out)
//            --sweep takes --ks a,b,c (0.45,0.40,..)  --eks a,b (the elite scale, 0.65)  --sizes a,b,c (--size)
import { writeFileSync } from "node:fs";
import {
  eliteTypeOf, ELITE_K, FACTION_IDS, MOB_K, mulberry32, normalTypesOf, SIGNATURE_WEAPONS, TICK_MS, TILE, WEAPON_IDS, type CampDef,
  type FactionId, type GameMap, type MobTypeId, type Vec2, type WeaponId,
} from "@raid/shared";
import { CampState } from "@raid/shared/schema";
import { buildArena } from "../src/harness/duel";
import { buffsOf } from "../src/sim/buffs";
import { combatant, setMobScalesForHarness } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { aggro } from "../src/sim/mobAI";
import { placeMob } from "../src/sim/mobLife";
import { addPlayer, step } from "../src/sim/step";
import { variantOf } from "./mobDuel";

export type Pull = "camp" | "single" | "group";
const ALL_PULLS: readonly Pull[] = ["camp", "single", "group"];

export interface CampDuelSpec {
  player: FactionId;
  weapon?: WeaponId;
  zone: FactionId;
  elite: boolean;
  pull: Pull;
  seed: number;
  /** Mobs in a camp, 4 by default (a generated camp holds 3 to 5): normals in a normal camp, the elite and `size - 1` normals in an elite camp. */
  size?: number;
  /** The camp has a territory (true, as on a generated map) or none, so its mobs keep the 9-tile circle (false). */
  territory?: boolean;
  capSeconds?: number;
  /** What-if scales for this duel (normal mob, elite); MOB_K and ELITE_K when left out. Always put back. */
  k?: number;
  eliteK?: number;
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
  /** Mobs awake on the tick the first one woke (the camp pull must show all of them there, the single pull one). */
  awakeAtFirstWake: number;
}

const ARENA_TILES = 40;
/** The territory's radius in tiles: a disc of about 346 tiles, the median generated territory (333) within a few percent. */
const TERRITORY_TILES = 10.5;
/** A camp's mobs, as many as a generated camp's median. */
export const CAMP_SIZE = 4;
const CENTER = (ARENA_TILES * TILE) / 2;
const NEVER = 1_000_000;
const RING = 48;
const PLAYER_ID = "p";

/** The arena with the camp's territory (a disc around `home`, camp 1 in territoryGrid) unless the spec turns it off. */
function withTerritory(map: GameMap, spec: CampDuelSpec, home: Vec2): GameMap {
  if (spec.territory === false) return map;
  let area = 0;
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      if (Math.hypot((tx + 0.5) * TILE - home.x, (ty + 0.5) * TILE - home.y) > TERRITORY_TILES * TILE) continue;
      map.territoryGrid[ty * map.w + tx] = 1;
      area++;
    }
  }
  const camp: CampDef = {
    id: `${spec.zone}-1`, zone: spec.zone, x: home.x, y: home.y, r: 2.5 * TILE, spots: [home], eliteSpot: spec.elite ? 0 : -1, chest: home,
    area, radius: TERRITORY_TILES * TILE,
  };
  return { ...map, camps: [camp] };
}

export function runCampDuel(spec: CampDuelSpec): CampDuelResult {
  // The what-if scales reach the sim through setMobScalesForHarness, set before placeMob builds the hp; always put back.
  if (spec.k === undefined && spec.eliteK === undefined) return duelAt(spec);
  setMobScalesForHarness(spec.k, spec.eliteK);
  try {
    return duelAt(spec);
  } finally {
    setMobScalesForHarness();
  }
}

function duelAt(spec: CampDuelSpec): CampDuelResult {
  const cap = spec.capSeconds ?? 90;
  const weapon = spec.weapon ?? SIGNATURE_WEAPONS[spec.player];
  const v = variantOf(spec.seed, 320);
  const normal: MobTypeId = normalTypesOf(spec.zone)[0]!.id;
  const size = Math.max(spec.elite ? 2 : 1, spec.size ?? CAMP_SIZE);
  const roster: Array<{ type: MobTypeId; elite: boolean }> = spec.elite
    ? [{ type: eliteTypeOf(spec.zone).id, elite: true }, ...Array.from({ length: size - 1 }, () => ({ type: normal, elite: false }))]
    : Array.from({ length: size }, () => ({ type: normal, elite: false }));
  const home: Vec2 = { x: CENTER, y: CENTER };
  const start: Vec2 = { x: CENTER + Math.cos(v.angle) * v.distance, y: CENTER + Math.sin(v.angle) * v.distance };

  const world = createGameWorld({
    random: mulberry32(spec.seed + 1),
    config: {
      minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER, patienceMinSeconds: NEVER, suddenDeathSeconds: NEVER, mobs: false,
    },
    map: withTerritory({ ...buildArena("open", [home, start], spec.seed), spawns: [start] }, spec, home),
  }, { signatures: true });
  const p = addPlayer(world, PLAYER_ID, PLAYER_ID, { faction: spec.player });
  p.weapon0 = weapon;
  p.weapon1 = "";
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("campDuel: the run did not start");

  // The camp pull places the mobs WITH their camp and publishes its CampState (index 0), so the first damage to any member
  // engages it and wakes the rest through mobAI.aggro, as in a run (and leashes them to its territory, map camp 0).
  const asCamp = spec.pull === "camp";
  if (asCamp) {
    const published = new CampState();
    published.type = roster[roster.length - 1]!.type;
    published.reward = "";
    published.alive = roster.length;
    published.state = 0;
    world.state.camps.push(published);
  }
  const ids = roster.map((m, i) => {
    const a = (i / roster.length) * Math.PI * 2 + v.angle + Math.PI;
    const at = roster.length === 1 ? home : { x: home.x + Math.cos(a) * RING, y: home.y + Math.sin(a) * RING };
    return placeMob(world, {
      region: spec.zone, elite: m.elite, type: m.type, at, facing: Math.atan2(home.y - at.y, home.x - at.x), camp: asCamp ? 0 : undefined,
    });
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
  let awakeAtFirstWake = spec.pull === "group" ? ids.length : 0;
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
    if (wokeAt === null && ids.some((id) => world.mobs.get(id)?.brain?.mode !== "idle")) {
      wokeAt = world.state.serverTime;
      awakeAtFirstWake = ids.filter((id) => world.mobs.get(id)?.brain?.mode !== "idle").length;
    }
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
    awakeAtFirstWake,
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

/** Pairings (a cell = player x zone) a camp of this kind is cleared in: in every seed, and in at least half of them. */
function clearCounts(rows: ReadonlyArray<{ player: FactionId; weapon: WeaponId }>, cells: Map<string, Cell>, key: (r: { player: FactionId; weapon: WeaponId }, zone: FactionId) => string): { all: number; half: number; total: number } {
  let all = 0;
  let half = 0;
  let total = 0;
  for (const r of rows) {
    for (const z of FACTION_IDS) {
      const c = cells.get(key(r, z))!;
      total++;
      if (c.cleared === c.n) all++;
      if (c.cleared * 2 >= c.n) half++;
    }
  }
  return { all, half, total };
}

function parseList(v: string | undefined, fallback: number[]): number[] {
  return v === undefined ? fallback : v.split(",").map(Number);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("--seeds") ?? 3);
  const size = Number(arg("--size") ?? CAMP_SIZE);
  const territory = process.argv.includes("--no-territory") ? false : undefined;
  const cap = Number(arg("--cap") ?? 90);
  const allWeapons = process.argv.includes("--weapons");
  const pulls = (arg("--pulls")?.split(",") ?? ALL_PULLS) as readonly Pull[];
  const rows = FACTION_IDS.flatMap((player) =>
    (allWeapons ? WEAPON_IDS : [SIGNATURE_WEAPONS[player]]).map((weapon) => ({ player, weapon })));
  const key = (r: { player: FactionId; weapon: WeaponId }, zone: FactionId, elite: boolean, pull: Pull): string =>
    `${r.player}|${r.weapon}|${zone}|${elite}|${pull}`;

  /** One pass over every row, zone, camp kind and pull at these scales and camp size. */
  const runAll = (k: number | undefined, eliteK: number | undefined, kinds: readonly boolean[], which: readonly Pull[], campSize: number, log: boolean) => {
    const all: CampDuelResult[] = [];
    const cells = new Map<string, Cell>();
    for (const r of rows) {
      for (const zone of FACTION_IDS) {
        for (const elite of kinds) {
          for (const pull of which) {
            const rs: CampDuelResult[] = [];
            for (let seed = 1; seed <= seeds; seed++) {
              rs.push(runCampDuel({ player: r.player, weapon: r.weapon, zone, elite, pull, seed, size: campSize, territory, capSeconds: cap, k, eliteK }));
            }
            all.push(...rs);
            cells.set(key(r, zone, elite, pull), cellOf(rs));
          }
        }
      }
      if (log) process.stderr.write(`${r.player} (${r.weapon}) done\n`);
    }
    return { all, cells };
  };

  if (process.argv.includes("--sweep")) {
    const ks = parseList(arg("--ks"), [0.45, 0.4, 0.35, 0.3, 0.25, 0.2]);
    const eks = parseList(arg("--eks"), [ELITE_K]);
    const sizes = parseList(arg("--sizes"), [size]);
    const cols = [false, true].flatMap((elite) => pulls.map((pull) => ({ elite, pull })));
    console.log(`\n## k sweep: pairings cleared (of ${rows.length * FACTION_IDS.length}), in every seed / in at least half of ${seeds} seeds; a camp is \`size\` mobs (elite camp: the elite and size - 1 normals)`);
    console.log(`| size | MOB_K | ELITE_K | ${cols.map((c) => `${c.elite ? "elite" : "normal"} camp: ${c.pull}`).join(" | ")} |`);
    console.log(`|---|---|---|${cols.map(() => "---").join("|")}|`);
    for (const campSize of sizes) {
      for (const ek of eks) {
        for (const k of ks) {
          const { cells } = runAll(k, ek, [false, true], pulls, campSize, false);
          const out = cols.map((c) => {
            const n = clearCounts(rows, cells, (r, z) => key(r, z, c.elite, c.pull));
            return `${n.all} / ${n.half}`;
          });
          console.log(`| ${campSize} | ${k} | ${ek} | ${out.join(" | ")} |`);
        }
      }
    }
  } else {
    const k = arg("--k") === undefined ? undefined : Number(arg("--k"));
    const eliteK = arg("--elite-k") === undefined ? undefined : Number(arg("--elite-k"));
    const { all, cells } = runAll(k, eliteK, [false, true], pulls, size, true);
    console.log(`MOB_K ${k ?? MOB_K}, ELITE_K ${eliteK ?? ELITE_K}, camp size ${size}, ${seeds} seeds`);
    for (const elite of [false, true]) {
      for (const pull of pulls) {
        const what = elite ? `elite camp (elite + ${size - 1} normals)` : `normal camp (${size} normals)`;
        const c = clearCounts(rows, cells, (r, z) => key(r, z, elite, pull));
        console.log(`\n## ${what}, ${pull} pull: cleared/${seeds} · seconds to clear · mean hp left`);
        console.log(`pairings cleared: ${c.all} of ${c.total} in every seed, ${c.half} in at least half`);
        console.log(table(rows, cells, (r, z) => key(r, z, elite, pull)));
      }
    }
    const json = arg("--json");
    if (json) writeFileSync(json, JSON.stringify(all, null, 1));
  }
}
