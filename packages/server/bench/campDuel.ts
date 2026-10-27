// How hard is a whole camp in the REAL sim (roguelike R4a, ROGUELIKE_PLAN R4a, R5 and 6)? A starting player (one faction, one
// weapon, no cards, no second weapon) meets one mono-type camp of a zone on an open floor: a normal camp (`--size` normals of
// one of the zone's four normal types, 4 by default: the generator's camps hold 3 to 5, about 4) or an elite camp (one of the
// zone's two elites and `--size` - 1 normals, so the same number of mobs). Unless a type is named (`--types` sweeps them), seed s
// takes the zone's normal type (s - 1) mod 4 and its elite (s - 1) mod 2, so any 4 consecutive seeds cover every type and a
// cell pools them. It fights through the target
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
// keep the circle. The kills pay as in a run (GV and the mob's weapon; a kill gives no stat since the balance pass), so nothing a camp gives helps with its
// last mobs.
// It reports time to clear (from the first mob waking to the last death) and hp left; a report, never a gate.
//
//   npx tsx bench/campDuel.ts                 each faction on FISTS (an empty hand, how a run starts), every zone, normal and elite, all three pulls
//   npx tsx bench/campDuel.ts --weapon sig    the old view: each faction on its signature weapon (or --weapon <id> for one weapon for all)
//   npx tsx bench/campDuel.ts --weapons       each faction on fists and on each of the five weapons
//   npx tsx bench/campDuel.ts --types         one row per mob type (30), one column per player faction on fists (--weapon zone: on the type's
//                                             zone weapon, --weapon own: on the type's own weapon), the camp pull, `--seeds` runs each, and the
//                                             gates of balance contract 6.3: every normal type's 4-mob camp cleared in >= 80% of its runs on
//                                             fists, every elite type's camp cleared by at least one starter on its zone's weapon
//   npx tsx bench/campDuel.ts --map           the camp pull on the real thing: seed s builds the zone-styled map of seed s, the camp is one of
//                                             the zone's camps there (the elite camp for the elite rows), with its real territory leash, its
//                                             clearing, its walls and hazards, and the player starts ~10 tiles out on walkable ground
//   options: --seeds N (3)  --size N (4)  --cap SECONDS (90)  --no-territory  --json FILE  --pulls camp,single,group
//            --k X  --elite-k X (a what-if scale, through setMobScalesForHarness; MOB_K and ELITE_K when left out)
//            --sweep takes --ks a,b,c (0.45,0.40,..)  --eks a,b (the elite scale, 0.65)  --sizes a,b,c (--size)
import { writeFileSync } from "node:fs";
import {
  circleClear, elitesOf, ELITE_K, FACTION_IDS, findPath, generateMap, MOB_K, MOB_TYPES, mulberry32, normalTypesOf, PLAYER_RADIUS,
  REGION_WEAPONS, SIGNATURE_WEAPONS, TICK_MS, TILE, ALL_WEAPON_IDS, FISTS, isWeaponId, type CampDef,
  type FactionId, type GameMap, type MobTypeDef, type MobTypeId, type Vec2, type WeaponId,
} from "@raid/shared";
import { CampState } from "@raid/shared/schema";
import { buildArena } from "../src/harness/duel";
import { ensureRosters } from "../src/sim/camps";
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
  /** The camp's normal type (the mates of an elite camp): the zone's normal type (seed - 1) mod 4 when left out. */
  type?: MobTypeId;
  /** An elite camp's elite: the zone's elite (seed - 1) mod 2 when left out. */
  eliteType?: MobTypeId;
  /** Mobs in a camp, 4 by default (a generated camp holds 3 to 5): normals in a normal camp, the elite and `size - 1` normals in an elite camp. */
  size?: number;
  /** The camp has a territory (true, as on a generated map) or none, so its mobs keep the 9-tile circle (false). */
  territory?: boolean;
  /** Play on `generateMap(seed)` (the game's themed map), at one of the zone's real camps, instead of on an open floor with a disc territory. The camp pull only. */
  onMap?: boolean;
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
  const weapon = spec.weapon ?? FISTS;
  const v = variantOf(spec.seed, 320);
  const normals = normalTypesOf(spec.zone);
  const elites = elitesOf(spec.zone);
  const normal: MobTypeId = spec.type ?? normals[(spec.seed - 1 + 4 * normals.length) % normals.length]!.id;
  const eliteType: MobTypeId = spec.eliteType ?? elites[(spec.seed - 1 + 4 * elites.length) % elites.length]!.id;
  const size = Math.max(spec.elite ? 2 : 1, spec.size ?? CAMP_SIZE);
  const roster: Array<{ type: MobTypeId; elite: boolean }> = spec.elite
    ? [{ type: eliteType, elite: true }, ...Array.from({ length: size - 1 }, () => ({ type: normal, elite: false }))]
    : Array.from({ length: size }, () => ({ type: normal, elite: false }));
  let home: Vec2 = { x: CENTER, y: CENTER };
  let start: Vec2 = { x: CENTER + Math.cos(v.angle) * v.distance, y: CENTER + Math.sin(v.angle) * v.distance };
  let map: GameMap;
  let campRef = 0;
  if (spec.onMap) {
    // The real thing: the zone's camp on the game's own map. Normal rows take the zone's non-elite camp number `seed` (mod 3), elite rows its elite camp.
    map = generateMap(spec.seed);
    const camps = map.camps.map((c, i) => ({ c, i })).filter((e) => e.c.zone === spec.zone && (e.c.eliteSpot >= 0) === spec.elite);
    const pickCamp = camps[spec.seed % camps.length]!;
    campRef = pickCamp.i;
    home = { x: pickCamp.c.x, y: pickCamp.c.y };
    // The player walks in from ~10 tiles out, on the nearest walkable ground to that ring that has a path to the camp.
    let found: Vec2 | null = null;
    for (let ring = 0; ring < 6 && !found; ring++) {
      for (let k = 0; k < 16 && !found; k++) {
        const a = v.angle + (k * Math.PI * 2) / 16, d = v.distance + ring * 32;
        const at = { x: home.x + Math.cos(a) * d, y: home.y + Math.sin(a) * d };
        if (circleClear(map, at, PLAYER_RADIUS) && findPath(map, at, home).length > 0) found = at;
      }
    }
    if (!found) throw new Error(`campDuel --map: no way in to ${pickCamp.c.id} of seed ${spec.seed}`);
    start = found;
    map = { ...map, spawns: [start] };
  } else {
    map = withTerritory({ ...buildArena("open", [home, start], spec.seed), spawns: [start] }, spec, home);
  }

  const world = createGameWorld({
    random: mulberry32(spec.seed + 1),
    config: {
      minPlayers: 1, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: NEVER, patienceMinSeconds: NEVER, suddenDeathSeconds: NEVER, mobs: false,
    },
    map,
  }, { signatures: true });
  const p = addPlayer(world, PLAYER_ID, PLAYER_ID, { faction: spec.player });
  p.weapon0 = weapon === FISTS ? "" : weapon; // fists are an empty hand, not an item
  p.weapon1 = "";
  step(world, TICK_MS);
  if (world.state.phase !== "active") throw new Error("campDuel: the run did not start");

  // The camp pull places the mobs WITH their camp and publishes its CampState (index 0), so the first damage to any member
  // engages it and wakes the rest through mobAI.aggro, as in a run (and leashes them to its territory, map camp 0).
  const asCamp = spec.pull === "camp";
  if (asCamp) {
    const published = new CampState();
    published.type = roster[roster.length - 1]!.type;
    published.elite = spec.elite ? eliteType : "";
    published.reward = "";
    published.alive = roster.length;
    published.state = 0;
    if (spec.onMap) {
      // The map's twenty camps are published by their own rosters; this camp's entry says what the duel fights.
      ensureRosters(world);
      const mine = world.state.camps[campRef]!;
      mine.type = published.type;
      mine.elite = published.elite;
      mine.alive = roster.length;
      mine.state = 0;
    } else {
      world.state.camps.push(published);
    }
  }
  const ids = roster.map((m, i) => {
    const a = (i / roster.length) * Math.PI * 2 + v.angle + Math.PI;
    const at = roster.length === 1 ? home : { x: home.x + Math.cos(a) * RING, y: home.y + Math.sin(a) * RING };
    return placeMob(world, {
      region: spec.zone, elite: m.elite, type: m.type, at, facing: Math.atan2(home.y - at.y, home.x - at.x), camp: asCamp ? campRef : undefined,
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
  return {
    spec: { ...spec, weapon },
    outcome,
    killed: ids.filter((id) => !alive(id)).length,
    mobs: ids.length,
    clearSeconds: outcome === "cleared" && wokeAt !== null ? (lastDeath - wokeAt) / 1000 : null,
    hpLeft: outcome === "lost" ? 0 : Math.max(0, p.hp) / p.maxHp,
    minHp,
    awakeAtFirstWake,
  };
}

// ------------------------------------------------------------------------------------------------------------- report

interface Cell { n: number; cleared: number; lost: number; timeouts: number; clear: number; hp: number }

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

/** The weapon a --types row's player holds: fists, the type's zone weapon (`zone`) or the type's own weapon (`own`). */
type TypesWeapon = "fists" | "zone" | "own";
function typesStarter(mode: TypesWeapon, t: MobTypeDef): WeaponId {
  return mode === "fists" ? FISTS : mode === "zone" ? REGION_WEAPONS[t.zone] : t.weapon;
}

/** What `typesReport` found: the clears of every type, and the two gates of balance contract 6.3. */
export interface TypesVerdict {
  /** Per type: camps cleared of the runs made (every player faction x `seeds`). */
  clears: Array<{ id: MobTypeId; elite: boolean; cleared: number; runs: number }>;
  /** Normal types cleared in under GATE_NORMAL of their runs. */
  normalFails: MobTypeId[];
  /** Elite types no faction on the zone's weapon cleared in at least half its runs. */
  eliteFails: MobTypeId[];
  ok: boolean;
}

/** The normal-type gate: a 4-mob camp of any normal type is cleared in at least this share of its runs (20 of 25) by starters on fists. */
export const GATE_NORMAL = 0.8;

/**
 * Per mob type (balance contract 6.3): the camp pull of a 4-mob camp of the type (a normal type: four of it; an elite type: the
 * elite and three normals of the zone, the type cycling with the seed) against each player faction, `seeds` runs each. Prints
 * one row per type with the clears per faction (unless `quiet`), then the two gates: every normal type cleared in >= GATE_NORMAL of
 * its runs on the chosen weapon (fists by default), every elite type cleared by at least one faction on its zone's weapon.
 * The report never fails a process; test/campTypes.test.ts holds the gates.
 */
export function typesReport(o: { seeds: number; size: number; cap: number; territory?: boolean; onMap?: boolean; weapon: TypesWeapon; log?: boolean; quiet?: boolean }): TypesVerdict {
  interface Row { t: MobTypeDef; cells: CampDuelResult[][]; cleared: number; runs: number }
  const play = (t: MobTypeDef, weapon: (t: MobTypeDef) => WeaponId): Row => {
    const cells = FACTION_IDS.map((player) => {
      const rs: CampDuelResult[] = [];
      for (let seed = 1; seed <= o.seeds; seed++) {
        rs.push(runCampDuel({
          player, weapon: weapon(t), zone: t.zone, elite: t.elite, pull: "camp", seed, size: o.size, territory: o.territory, onMap: o.onMap, capSeconds: o.cap,
          ...(t.elite ? { eliteType: t.id } : { type: t.id }),
        }));
      }
      return rs;
    });
    const flat = cells.flat();
    return { t, cells, cleared: flat.filter((r) => r.outcome === "cleared").length, runs: flat.length };
  };
  const rows: Row[] = [];
  for (const t of MOB_TYPES) {
    rows.push(play(t, (x) => typesStarter(o.weapon, x)));
    if (o.log) process.stderr.write(`${t.id} done\n`);
  }
  const say = (line: string): void => { if (!o.quiet) console.log(line); };
  const cellText = (rs: readonly CampDuelResult[]): string => {
    const c = cellOf(rs);
    return `${c.cleared}/${c.n} ${Number.isNaN(c.clear) ? "-" : `${c.clear.toFixed(1)}s`} ${pct(c.hp)}%`;
  };
  say(`\n## per type: camp pull, ${o.size}-mob camp, players on ${o.weapon === "fists" ? "FISTS" : o.weapon === "zone" ? "the type's zone weapon" : "the type's own weapon"}; cell = cleared/${o.seeds} · seconds to clear · mean hp left %`);
  say(`| type (role, weapon) | cleared | ${FACTION_IDS.join(" | ")} |`);
  say(`|---|---|${FACTION_IDS.map(() => "---").join("|")}|`);
  for (const r of rows) say(`| ${r.t.name}${r.t.elite ? " (elite)" : ""} (${r.t.role}, ${r.t.weapon}) | ${r.cleared}/${r.runs} | ${r.cells.map(cellText).join(" | ")} |`);
  const normalFails = rows.filter((r) => !r.t.elite && r.cleared < r.runs * GATE_NORMAL);
  say(`\nnormal-type gate (>= ${Math.round(GATE_NORMAL * 100)}% of runs cleared${o.weapon === "fists" ? " on fists" : ""}): ${normalFails.length === 0 ? "PASS" : `FAIL ${normalFails.map((r) => `${r.t.id} ${r.cleared}/${r.runs}`).join(", ")}`}`);
  // The elite gate always means the zone's weapon, whichever weapon the table was played with (a second pass when it is not).
  const eliteRows = o.weapon === "zone" ? rows.filter((r) => r.t.elite) : MOB_TYPES.filter((t) => t.elite).map((t) => play(t, (x) => REGION_WEAPONS[x.zone]));
  if (o.weapon !== "zone") {
    say(`\n## elite camps on the zone's weapon (${FACTION_IDS.join(", ")} as the player); a faction clears when it wins at least half its runs`);
    say(`| elite type (zone weapon) | ${FACTION_IDS.join(" | ")} |`);
    say(`|---|${FACTION_IDS.map(() => "---").join("|")}|`);
    for (const r of eliteRows) say(`| ${r.t.name} (${REGION_WEAPONS[r.t.zone]}) | ${r.cells.map(cellText).join(" | ")} |`);
  }
  const eliteFails = eliteRows.filter((r) => !r.cells.some((rs) => rs.filter((x) => x.outcome === "cleared").length * 2 >= rs.length));
  say(`\nelite-type gate (cleared by at least one faction on the zone's weapon): ${eliteFails.length === 0 ? "PASS" : `FAIL ${eliteFails.map((r) => r.t.id).join(", ")}`}`);
  return {
    clears: rows.map((r) => ({ id: r.t.id, elite: r.t.elite, cleared: r.cleared, runs: r.runs })),
    normalFails: normalFails.map((r) => r.t.id),
    eliteFails: eliteFails.map((r) => r.t.id),
    ok: normalFails.length === 0 && eliteFails.length === 0,
  };
}

function parseList(v: string | undefined, fallback: number[]): number[] {
  return v === undefined ? fallback : v.split(",").map(Number);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seeds = Number(arg("--seeds") ?? 3);
  const size = Number(arg("--size") ?? CAMP_SIZE);
  const territory = process.argv.includes("--no-territory") ? false : undefined;
  const onMap = process.argv.includes("--map") ? true : undefined;
  const cap = Number(arg("--cap") ?? 90);
  const allWeapons = process.argv.includes("--weapons");
  const pulls = (arg("--pulls")?.split(",") ?? ALL_PULLS) as readonly Pull[];
  const weaponFlag = arg("--weapon");
  const typesMode = process.argv.includes("--types");
  if (weaponFlag !== undefined && weaponFlag !== "sig" && !isWeaponId(weaponFlag) && !(typesMode && (weaponFlag === "zone" || weaponFlag === "own"))) {
    throw new Error(`unknown weapon "${weaponFlag}" (an id, or sig for the signature weapons; zone and own with --types)`);
  }
  const starter = (player: FactionId): WeaponId => (weaponFlag === undefined ? FISTS : weaponFlag === "sig" ? SIGNATURE_WEAPONS[player] : weaponFlag as WeaponId);
  const rows = FACTION_IDS.flatMap((player) =>
    (allWeapons ? ALL_WEAPON_IDS : [starter(player)]).map((weapon) => ({ player, weapon })));
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
              rs.push(runCampDuel({ player: r.player, weapon: r.weapon, zone, elite, pull, seed, size: campSize, territory, onMap, capSeconds: cap, k, eliteK }));
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

  if (process.argv.includes("--types")) {
    const mode = (weaponFlag ?? "fists") as string;
    if (mode !== "fists" && mode !== "zone" && mode !== "own") throw new Error(`--types takes --weapon fists|zone|own (got "${mode}")`);
    typesReport({ seeds: Number(arg("--seeds") ?? 5), size, cap, territory, onMap, weapon: mode, log: true });
  } else if (process.argv.includes("--sweep")) {
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
    console.log(`MOB_K ${k ?? MOB_K}, ELITE_K ${eliteK ?? ELITE_K}, camp size ${size}, ${seeds} seeds${onMap ? ", on the game's maps (seed s builds the map of seed s)" : ""}`);
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
