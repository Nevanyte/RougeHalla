// The zone map generator (ROGUELIKE_PLAN R2, docs/R1_GENERATOR_NOTE.md): five themed zones of equal area grown around
// the fixed coliseum, four camps per zone with their territories, optional ruins, the zone stylers' interiors, rock
// chunks, a spawn pool on one walking-distance contour, weapon crates, then the anti-kiting cover, certified as it goes.
//
// Client and server both call generateMap(seed, attempt) and must get identical output, so:
//  - every random decision of an attempt goes through one mulberry32 stream (seed for attempt 0, else
//    seed + attempt * 0x9e3779b1) in a fixed order; each zone styler draws from streams of its own
//    (mulberry32(hashSeed(seed, attempt, zone, stream)), styler.ts);
//  - nothing here may call Math.sin/cos/atan2/hypot/pow/exp/log/random: engines may differ in their last bit. Only
//    + - * / sqrt floor ceil round abs min max are used (detSin/detCos in cover.ts are built from + - * /);
//  - sorts use total comparators (value, then tile index); distance transforms and heap keys are integers.
//
// One attempt runs: the pillar variant and the faction order; the zones (zones.ts); the camps and territories; the
// ruins; the spawn pool (on the open ground, so the stylers cannot thin its candidates); the zone stylers (the pool's
// 3x3 is theirs to leave alone, and hazards are cleared from its 5x5); the rock chunks; the camp spots; the crates; the
// cover (cover.ts: two cheap lattices, the coarse one, then the fine one that certifies the 480 u sight cap and screens
// the spawn pool); the checks after the cover (the walking contour again, territory floor repair, floor share,
// territory radius); the ground spots. Any failed check fails the attempt: there is no relaxed attempt. tryAttempt runs
// exactly one; generateMap without an attempt runs them in order until one certifies.
import { MAP_TILES_H, MAP_TILES_W, TILE } from "./constants";
import { CX, CY, RING_ROAD, fixedLayout } from "./coliseum";
import {
  COARSE_LATTICE, COARSE_TARGET, NB4 as COVER_NB4, RING_DX as COVER_RING_DX, RING_DY as COVER_RING_DY, SIGHT_LATTICE, enforceConnectivity, getLaneTable,
  placeCover, walkDistances,
} from "./cover";
import type { CoverGround } from "./cover";
import {
  REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR as FLOOR_TILE, TILE_LOW as LOW_TILE, TILE_WALL as WALL_TILE, regionCode,
  tileToWorldCenter,
} from "./map";
import type { CampDef, ColiseumDef, FactionRegionDef, GameMap, MapProp, MobCampDef, RegionFaction, TilePt, TileRect } from "./map";
import type { Vec2 } from "./messages";
import { mulberry32, pick, randInt as rngInt, shuffle } from "./rng";
import type { Rng } from "./rng";
import { ZONE_STYLE_HOOK } from "./styler";
import type { StyleCamp, ZoneStyleHook } from "./styler";
import { PROP_KINDS, TERRAINS, TERRAIN_ICE, TERRAIN_NONE, validateTerrain } from "./terrain";
import {
  AREA_TOLERANCE, CAMP_HALO, CAMP_R, CAMP_TILES, RING_CONTACT_MIN, SLIVER_MAX, TERRITORY_RADIUS_MAX, ZONES, chamfer, d2i as tileD2, failed, note,
  partitionZones, placeCamps, repairTerritories, ringContact, sliverCounts, territoryReach2,
} from "./zones";
import type { CampLayout, CampSite, ZonePartition } from "./zones";

export { LATTICE_ORIGIN, SIGHT_LATTICE, longestLane } from "./cover";
export { CAMPS_PER_ZONE, CAMP_GAP, MAPGEN_FAILS, MAPGEN_NOTES, RING_CONTACT_MIN, SLIVER_MAX, TERRITORY_RADIUS_MAX } from "./zones";
export { STYLE_STREAM, ZONE_STYLE_HOOK, styleRng } from "./styler";
export type { StyleCamp, StyleState, ZoneStyleHook } from "./styler";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const R0 = Math.min(W, H) / 2;
// Hot loops read module-level copies of these imports: under a test runner's module system (vitest) every use of an
// import is a property read on the module object, which cost this code about a third of its time.
const NB4 = COVER_NB4, RING_DX = COVER_RING_DX, RING_DY = COVER_RING_DY;
const TILE_FLOOR = FLOOR_TILE, TILE_LOW = LOW_TILE, TILE_WALL = WALL_TILE, randInt = rngInt, d2i = tileD2;


/** Open tiles between the border ring and any ruin, obstacle or camp. */
const EDGE_CLEAR = 3;
/** Open tiles between two ruins. */
const BUILDING_GAP = 2;
/** Ruins per zone: 0 to this many (D19), each 7-9 tiles a side; one that does not fit is skipped. */
const RUINS_MAX = 2;
const RUIN_TRIES = 80;
/** At most this many rocks stand inside one ruin. */
const RUIN_ROCKS = 8;
/** Rock chunks: the 64x64 map's 15-30 per 4096 tiles, scaled by area. */
const CHUNKS_LO = Math.round((15 * N) / 4096);
const CHUNKS_HI = Math.round((31 * N) / 4096);
/** Tiles from the border that stay open at each map corner (a click outside the world snaps to floor near the nearest corner). */
const CORNER_OPEN = 4;
/** Ground loot uses tiles with floor on all eight sides unless fewer than this many are left. */
const GROUND_OPEN_MIN = 60;
const GROUND_SPOTS_MIN = 20;
/** Weapon crates per zone: 3 or 4 against a wall (D18), never touching. */
const CRATES_MIN = 3;
const CHEST_MIN_GAP = 2;

/** Spawn pool: guaranteed spacing (tiles) between members and from camp centres. */
const SPAWN_SEPARATION = 5;
/**
 * Members are picked this far from camp centres (tiles; the guarantee is SPAWN_SEPARATION): the two extra tiles leave
 * ground a rock may take between a spawn's protected 3x3 and a camp's protected halo, so the cover can always cut there.
 */
const SPAWN_CAMP_PICK = 7;
/** Members lie this far from the centre (fractions of R0): 24 to 46 tiles at 96x96. */
const SPAWN_RING: readonly [number, number] = [0.5, 0.95];
const POOL_TARGET = 32;
/** The pool is picked up to this many members and trimmed to POOL_TARGET after the cover (which moves walking distances unevenly). */
const POOL_PICK_TARGET = 40;
const POOL_MIN = 24;
/** Zones the pool must cover (each member then has a member of another zone to be dealt with). */
const POOL_ZONES = 4;
/** The pool is picked within this fraction of one contour value, and certified within WALK_BAND after the cover. */
const POOL_PICK_BAND = 0.045;
const WALK_BAND = 0.08;
const SPAWN_TRIES = 4;
/** Max/min walkable floor across the zones after rocks, ruins and stylers. */
const FLOOR_SHARE_MAX = 1.15;

/** Zone sets drawn per attempt when the camps of one cannot be seated (each draw has its own ZONE_TRIES and CAMP_TRIES). */
const LAYOUT_TRIES = 4;
/** Cheap lattices run before the coarse pass: they certify nothing, but take most of the rocks off the exact passes. */
const PRE_LATTICES: readonly (readonly [number, number])[] = [[8, 2], [16, 1]];

/** Attempts a seed gets in a map pool (`certifiedMap`); a seed whose attempts all fail is discarded. */
export const MAX_ATTEMPTS = 16;
/** generateMap without an attempt gives up (throws) after this many: a guard against a broken generator, never reached in practice. */
const ATTEMPT_LIMIT = 4 * MAX_ATTEMPTS;

const toWorld = (p: TilePt): Vec2 => ({ x: tileToWorldCenter(p.x), y: tileToWorldCenter(p.y) });
const tp = (i: number): TilePt => ({ x: i % W, y: (i - (i % W)) / W });
/** The 1x1 rect of tile i (for markRect). */
const cell = (i: number): TileRect => ({ x: i % W, y: (i - (i % W)) / W, w: 1, h: 1 });
const cheb = (a: number, b: number): number => {
  const ax = a % W, bx = b % W;
  return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / W - (b - bx) / W));
};


/** A rect in tile space grown by `margin` on every side overlaps another. */
function overlaps(a: TileRect, b: TileRect, margin: number): boolean {
  return (
    a.x < b.x + b.w + margin && b.x < a.x + a.w + margin &&
    a.y < b.y + b.h + margin && b.y < a.y + a.h + margin
  );
}

function near(p: TilePt, x: number, y: number): boolean {
  return Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1;
}

function nearAny(pts: readonly TilePt[], x: number, y: number): boolean {
  for (const p of pts) if (near(p, x, y)) return true;
  return false;
}

/** Sets grid cells of `r` grown by `margin` (clipped to the map). */
function markRect(grid: Uint8Array, r: TileRect, margin: number): void {
  const x0 = Math.max(0, r.x - margin), x1 = Math.min(W - 1, r.x + r.w - 1 + margin);
  const y0 = Math.max(0, r.y - margin), y1 = Math.min(H - 1, r.y + r.h - 1 + margin);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * W + x] = 1;
}

/**
 * Walls, 1-3 two-wide doors on distinct sides (never touching a corner) and 0-2 partitions.
 * Returns every gap tile (doors and partition gaps) so chests can stay out of the way.
 */
function carveBuilding(tiles: Uint8Array, rng: Rng, r: TileRect): TilePt[] {
  const x0 = r.x, y0 = r.y, x1 = r.x + r.w - 1, y1 = r.y + r.h - 1;
  for (let x = x0; x <= x1; x++) {
    tiles[y0 * W + x] = TILE_WALL;
    tiles[y1 * W + x] = TILE_WALL;
  }
  for (let y = y0; y <= y1; y++) {
    tiles[y * W + x0] = TILE_WALL;
    tiles[y * W + x1] = TILE_WALL;
  }

  // Sides: 0 top, 1 right, 2 bottom, 3 left. Gap start in [2, len-4] keeps a wall tile next to each corner.
  const doors: TilePt[] = [];
  const sides = shuffle(rng, [0, 1, 2, 3]);
  const doorCount = randInt(rng, 1, 4);
  for (let i = 0; i < doorCount; i++) {
    const side = sides[i];
    const alongX = side % 2 === 0;
    const g = randInt(rng, 2, (alongX ? r.w : r.h) - 3);
    for (let k = 0; k < 2; k++) {
      const p = alongX
        ? { x: x0 + g + k, y: side === 0 ? y0 : y1 }
        : { x: side === 1 ? x1 : x0, y: y0 + g + k };
      tiles[p.y * W + p.x] = TILE_FLOOR;
      doors.push(p);
    }
  }

  const gaps = doors.slice();
  const ix0 = x0 + 1, ix1 = x1 - 1, iy0 = y0 + 1, iy1 = y1 - 1;
  const partitions = randInt(rng, 0, 3);

  // Partition geometry in (u, v) space: u is across the wall line, v along it. `vertical` maps (u, v) -> (x, y).
  const at = (vertical: boolean, u: number, v: number): TilePt => (vertical ? { x: u, y: v } : { x: v, y: u });

  let main: { vertical: boolean; u: number; gapFrom: number; u0: number; u1: number; v0: number; v1: number } | null = null;
  if (partitions >= 1) {
    const first = rng() < 0.5;
    for (const vertical of [first, !first]) {
      const u0 = vertical ? ix0 : iy0, u1 = vertical ? ix1 : iy1;
      const v0 = vertical ? iy0 : ix0, v1 = vertical ? iy1 : ix1;
      if (u1 - u0 + 1 < 7) continue;
      const lines: number[] = [];
      for (let u = u0 + 3; u <= u1 - 3; u++) {
        // The two exterior wall tiles this partition abuts must not be next to a door.
        const a = at(vertical, u, v0 - 1);
        const b = at(vertical, u, v1 + 1);
        if (!nearAny(doors, a.x, a.y) && !nearAny(doors, b.x, b.y)) lines.push(u);
      }
      if (lines.length === 0) continue;
      const u = pick(rng, lines);
      const gapFrom = randInt(rng, v0 + 1, v1 - 1);
      for (let v = v0; v <= v1; v++) {
        const p = at(vertical, u, v);
        if (v === gapFrom || v === gapFrom + 1) gaps.push(p);
        else tiles[p.y * W + p.x] = TILE_WALL;
      }
      main = { vertical, u, gapFrom, u0, u1, v0, v1 };
      break;
    }
  }

  // Second partition: a T-branch off the first one, so every room is reachable through single 2-wide gaps.
  if (partitions >= 2 && main && main.v1 - main.v0 + 1 >= 7) {
    const { vertical, u: pu, gapFrom: mg, u0, u1, v0, v1 } = main;
    const sidesAvail: { a: number; b: number; ext: number }[] = [];
    if (pu - u0 >= 4) sidesAvail.push({ a: u0, b: pu - 1, ext: u0 - 1 });
    if (u1 - pu >= 4) sidesAvail.push({ a: pu + 1, b: u1, ext: u1 + 1 });
    shuffle(rng, sidesAvail);
    for (const s of sidesAvail) {
      const rows: number[] = [];
      for (let v = v0 + 3; v <= v1 - 3; v++) {
        if (v >= mg - 1 && v <= mg + 2) continue; // would crowd the first partition's gap
        const e = at(vertical, s.ext, v);
        if (!nearAny(doors, e.x, e.y)) rows.push(v);
      }
      if (rows.length === 0) continue;
      const v = pick(rng, rows);
      const gapFrom = randInt(rng, s.a + 1, s.b - 1);
      for (let u = s.a; u <= s.b; u++) {
        const p = at(vertical, u, v);
        if (u === gapFrom || u === gapFrom + 1) gaps.push(p);
        else tiles[p.y * W + p.x] = TILE_WALL;
      }
      break;
    }
  }
  return gaps;
}

/** `skip` marks tiles that must stay free of loot (ruins, the coliseum, camp clearings, chests and their neighbours). */
function pickGroundSpots(rng: Rng, tiles: Uint8Array, skip: Uint8Array, spawns: TilePt[]): TilePt[] {
  // Loot lies in the open: tiles with floor all round come first, so a body can stand on it; a tile beside a rock
  // is only used when there are too few of those.
  const cands: TilePt[] = [], nooks: TilePt[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (tiles[y * W + x] !== TILE_FLOOR || skip[y * W + x]) continue;
      if (spawns.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 3)) continue;
      let clear = true;
      for (let q = 0; q < 8 && clear; q++) if (tiles[(y + RING_DY[q]) * W + x + RING_DX[q]] !== TILE_FLOOR) clear = false;
      (clear ? cands : nooks).push({ x, y });
    }
  }
  shuffle(rng, cands);
  if (cands.length < GROUND_OPEN_MIN) cands.push(...shuffle(rng, nooks));
  const want = randInt(rng, 20, 31);
  const chosen: TilePt[] = [];
  for (const minSep of [4, 2, 1]) {
    for (const c of cands) {
      if (chosen.length >= want) break;
      if (chosen.includes(c)) continue;
      if (chosen.every((o) => (o.x - c.x) * (o.x - c.x) + (o.y - c.y) * (o.y - c.y) >= minSep * minSep)) chosen.push(c);
    }
  }
  return chosen;
}

export interface MapgenOptions {
  /** The zone style hook to run instead of ZONE_STYLE_HOOK (null: none). Tests only: client and server must agree. */
  styleZones?: ZoneStyleHook | null;
  /**
   * false skips the cosmetic layer: no props (the server and the bots build this way). Every layer mapHash covers is the
   * same either way, because props are drawn from a stream of their own and never read by the generator. Default true.
   */
  decor?: boolean;
}

/**
 * The map of `seed`. With `attempt`, exactly that attempt runs and its map is returned; an attempt that does not
 * certify throws (a client handed a published (seed, attempt) never loops). Without it, attempts run in order from 0
 * until one certifies (past MAX_ATTEMPTS too, for a seed a pool would discard), and the map records which in `attempt`.
 */
export function generateMap(seed: number, attempt?: number, options?: MapgenOptions): GameMap {
  if (attempt !== undefined) {
    const map = tryAttempt(seed, attempt, options);
    if (!map) throw new Error(`generateMap: attempt ${attempt} of seed ${seed} does not certify`);
    return map;
  }
  for (let a = 0; a < ATTEMPT_LIMIT; a++) {
    const map = tryAttempt(seed, a, options);
    if (map) return map;
  }
  throw new Error(`generateMap: no attempt of seed ${seed} certifies in ${ATTEMPT_LIMIT}`);
}

/** Runs exactly one attempt of `seed`: its map, or null when that attempt does not certify. */
export function tryAttempt(seed: number, attempt: number, options?: MapgenOptions): GameMap | null {
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new RangeError(`tryAttempt: attempt must be an integer >= 0, got ${attempt}`);
  return buildMap(seed, attempt, options?.styleZones !== undefined ? options.styleZones : ZONE_STYLE_HOOK, options?.decor !== false);
}

/** The first of attempts 0..MAX_ATTEMPTS-1 of `seed` that certifies, or null: a map pool discards such a seed. */
export function certifiedMap(seed: number, options?: MapgenOptions): GameMap | null {
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    const map = tryAttempt(seed, a, options);
    if (map) return map;
  }
  return null;
}

/** Builds the process-wide tables (fixed layout, every lane table) so the first map does not pay for them. */
export function warmMapgen(): void {
  fixedLayout();
  for (const [dirs, step] of PRE_LATTICES) getLaneTable(dirs, step);
  getLaneTable(COARSE_LATTICE.dirs, COARSE_LATTICE.step);
  getLaneTable(SIGHT_LATTICE.dirs, SIGHT_LATTICE.step);
}

/** Per-stage timing for the bench (`scripts/mapBench.ts`); off by default, and never changes a map. */
export const MAPGEN_PROFILE = { on: false, attempts: 0, ms: {} as Record<string, number> };

function buildMap(seed: number, attempt: number, hook: ZoneStyleHook | null, decor: boolean): GameMap | null {
  const F = fixedLayout();
  const { border, fp, distFp, ring } = F;
  let tMark = MAPGEN_PROFILE.on ? performance.now() : 0;
  const lap = (stage: string): void => {
    if (!MAPGEN_PROFILE.on) return;
    const t = performance.now();
    MAPGEN_PROFILE.ms[stage] = (MAPGEN_PROFILE.ms[stage] ?? 0) + (t - tMark);
    tMark = t;
  };
  if (MAPGEN_PROFILE.on) MAPGEN_PROFILE.attempts++;

  const rng = mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1);
  const tiles = new Uint8Array(N).fill(TILE_FLOOR);
  const pillar = F.pillars[Math.floor(rng() * F.pillars.length)];
  const order = shuffle(rng, [...REGION_FACTIONS]);

  // --- Zones, then camps and their territories ---------------------------------------------------------------------
  // A zone set whose camps cannot all reach their whole territory (a long arm too thin for a camp) is drawn again.
  let part: ZonePartition | null = null, layout: CampLayout | null = null;
  for (let tryNo = 0; tryNo < LAYOUT_TRIES && !layout; tryNo++) {
    part = partitionZones(rng);
    if (!part) return null;
    layout = placeCamps(rng, part);
  }
  lap("zones");
  if (!part || !layout) return failed("A:camps");
  const { zone } = part;
  const { camps, territoryGrid } = layout;

  // --- Terrain: the fixed walls, ruins, the stylers, rock chunks ---------------------------------------------------
  for (let i = 0; i < N; i++) if (border[i] || pillar[i] || F.wallRing[i]) tiles[i] = TILE_WALL;
  for (const g of F.gates) for (const t of g.tiles) tiles[t.y * W + t.x] = TILE_FLOOR;
  const campNear2 = new Uint8Array(N), clearing: number[] = [];
  for (const c of camps) {
    for (const [ox, oy] of CAMP_TILES) {
      const t = c.site + oy * W + ox;
      clearing.push(t);
      markRect(campNear2, cell(t), 2);
    }
  }
  const buildings: TileRect[] = [];
  // A ruin keeps 2 tiles of margin inside one zone, off the ring road, off camp clearings + 2 and BUILDING_GAP from other ruins.
  const ruinFits = (r: TileRect, z: number, margin: number): boolean => {
    if (r.x < EDGE_CLEAR + 1 || r.y < EDGE_CLEAR + 1 || r.x + r.w > W - EDGE_CLEAR - 1 || r.y + r.h > H - EDGE_CLEAR - 1) return false;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (campNear2[y * W + x]) return false;
    for (const b of buildings) if (overlaps(r, b, BUILDING_GAP)) return false;
    for (let y = r.y - margin; y < r.y + r.h + margin; y++) {
      for (let x = r.x - margin; x < r.x + r.w + margin; x++) {
        const i = y * W + x;
        if (zone[i] !== z || ring[i]) return false;
      }
    }
    return true;
  };
  for (let z = 1; z <= ZONES; z++) {
    const want = randInt(rng, 0, RUINS_MAX + 1);
    for (let n = 0; n < want; n++) {
      for (let a = 0; a < RUIN_TRIES; a++) {
        const w = randInt(rng, 7, 10), h = randInt(rng, 7, 10);
        const r = { x: randInt(rng, EDGE_CLEAR + 1, W - EDGE_CLEAR - w), y: randInt(rng, EDGE_CLEAR + 1, H - EDGE_CLEAR - h), w, h };
        if (ruinFits(r, z, 2)) { buildings.push(r); break; }
      }
    }
  }
  const gapsPerBuilding = buildings.map((b) => carveBuilding(tiles, rng, b));
  const ruinGrid = new Uint8Array(N), ruinNear1 = new Uint8Array(N);
  for (const b of buildings) { markRect(ruinGrid, b, 0); markRect(ruinNear1, b, 1); }

  lap("terrain");
  // --- Spawn pool: farthest-point packing on one walking-distance contour, on the open ground --------------------------------
  // It is picked before the stylers: their walls, low ground and hazards leave about half of the candidates, and a pool that thin
  // does not survive the cover's shifts in walking distance. The stylers get the pool's 3x3 as protected ground, and hazards are
  // cleared from its 5x5 after them (validateTerrain T8). The walking contour is certified again after the cover.
  const open3 = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (tiles[(y + j) * W + x + i] !== TILE_FLOOR) { ok = false; break; }
      if (ok) open3[y * W + x] = 1;
    }
  }
  let pool = pickSpawnPool(rng, tiles, zone, open3, ruinGrid, camps);
  if (!pool) return null;
  // The 3x3 of every member, and the 5x5 around it (chunks and the styler's hazards keep off it).
  const poolHalo = new Uint8Array(N), pool5 = new Uint8Array(N);
  for (const t of pool) { markRect(poolHalo, cell(t), 1); markRect(pool5, cell(t), 2); }
  lap("spawns");

  const keepLow = new Uint8Array(N), terrain = new Uint8Array(N);
  let props: MapProp[] = [];
  let laidIce = false;
  const protect = hook ? styleProtect(camps, ruinNear1, poolHalo) : null;
  if (hook && protect) {
    const breach = applyStyleHook(seed, attempt, hook, decor, order, zone, territoryGrid, camps, protect, tiles, terrain, props, keepLow);
    lap("styler");
    if (breach !== null) return failed("A:styleBreach");
    // T8: no hazard (a floor kind) in a spawn's 5x5; low ground such as lava or a fence may stand there.
    for (let i = 0; i < N; i++) if (pool5[i] && terrain[i] !== TERRAIN_NONE && TERRAINS[terrain[i]].tile === TILE_FLOOR) terrain[i] = TERRAIN_NONE;
    laidIce = terrain.includes(TERRAIN_ICE);
  }
  // A floor kind does not survive under a wall (a rock, a walled-up pocket); a LOW kind does, as decor (terrain.ts T3).
  const clearBuried = (): void => {
    if (!hook) return;
    for (let i = 0; i < N; i++) if (terrain[i] !== TERRAIN_NONE && tiles[i] === TILE_WALL && TERRAINS[terrain[i]].tile === TILE_FLOOR) terrain[i] = TERRAIN_NONE;
  };

  {
    // Rock chunks (1-2 by 1-3 tiles), with a tile of air around each, off the ring road + 1, ruins + 1, camp halos and
    // anything that is not floor.
    const bad = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (distFp[i] <= RING_ROAD + 1 || ruinNear1[i] || pool5[i] || tiles[i] !== TILE_FLOOR) bad[i] = 1;
    for (const c of camps) for (const [ox, oy] of CAMP_HALO) bad[c.site + oy * W + ox] = 1;
    const target = randInt(rng, CHUNKS_LO, CHUNKS_HI);
    let placed = 0;
    for (let a = 0; a < 6000 && placed < target; a++) {
      const aa = randInt(rng, 1, 3), bb = randInt(rng, 1, 4);
      const flip = rng() < 0.5;
      const w = flip ? bb : aa, h = flip ? aa : bb;
      const r = { x: randInt(rng, EDGE_CLEAR + 1, W - EDGE_CLEAR - w), y: randInt(rng, EDGE_CLEAR + 1, H - EDGE_CLEAR - h), w, h };
      let free = true;
      for (let y = r.y; y < r.y + h && free; y++) for (let x = r.x; x < r.x + w; x++) if (bad[y * W + x]) { free = false; break; }
      if (!free) continue;
      placed++;
      markRect(bad, r, 1);
      for (let y = r.y; y < r.y + h; y++) for (let x = r.x; x < r.x + w; x++) tiles[y * W + x] = TILE_WALL;
    }
  }
  // Safety nets, then connectivity: floor the centre cannot reach becomes wall; a camp clearing cut off fails.
  for (const t of F.laneOut) tiles[t.y * W + t.x] = TILE_FLOOR;
  for (let i = 0; i < N; i++) if (F.laneIn[i]) tiles[i] = TILE_FLOOR;
  for (const t of clearing) tiles[t] = TILE_FLOOR;
  enforceConnectivity(tiles, { x: CX, y: CY });
  clearBuried();
  for (const t of clearing) if (tiles[t] !== TILE_FLOOR) return failed("A:campCut");
  const zoneCode = (z: number): number => regionCode(order[z - 1]);
  const regionGrid = new Uint8Array(N);
  for (let i = 0; i < N; i++) regionGrid[i] = fp[i] ? REGION_COLISEUM : border[i] ? REGION_NONE : zoneCode(zone[i]);
  // The safety nets walled nothing the pool needs: its 3x3 is still plain floor.
  for (const t of pool) {
    for (let q = 0; q < 8; q++) if (tiles[t + RING_DY[q] * W + RING_DX[q]] !== TILE_FLOOR) return failed("A:poolCut");
    if (tiles[t] !== TILE_FLOOR) return failed("A:poolCut");
  }
  lap("terrain");

  // --- Camp spots: 3-5 in the clearing, never its centre (the chest tile); the elite stands at spot 0, nearest the centre.
  for (const c of camps) {
    const around: number[] = [];
    for (const [ox, oy] of CAMP_TILES) if (ox !== 0 || oy !== 0) around.push(c.site + oy * W + ox);
    shuffle(rng, around);
    const want = randInt(rng, 3, 6);
    const spots: number[] = [];
    for (const t of around) { if (spots.length >= want) break; if (spots.every((o) => cheb(o, t) >= 2)) spots.push(t); }
    for (const t of around) { if (spots.length >= want) break; if (!spots.includes(t)) spots.push(t); }
    if (c.elite) spots.sort((a, b) => d2i(a, c.site) - d2i(b, c.site) || a - b);
    c.spots = spots;
  }

  // --- Weapon crates: 3-4 per zone against a wall -----------------------------------------------------------------
  const gapTiles = gapsPerBuilding.flat();
  const campSpotTiles = camps.flatMap((c) => c.spots);
  const cratesByZone: number[][] = [];
  for (let z = 1; z <= ZONES; z++) {
    const placed = cratesByZone.flat();
    const cands: number[] = [];
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (zone[i] !== z || tiles[i] !== TILE_FLOOR || ring[i]) continue;
        if (tiles[i - 1] !== TILE_WALL && tiles[i + 1] !== TILE_WALL && tiles[i - W] !== TILE_WALL && tiles[i + W] !== TILE_WALL) continue;
        if (hook && !plainAround(terrain, i, 1)) continue;
        if (pool.some((s) => cheb(s, i) < 3) || campSpotTiles.some((s) => cheb(s, i) < 2) || camps.some((c) => cheb(c.site, i) < 3)) continue;
        if (nearAny(gapTiles, x, y) || placed.some((o) => cheb(o, i) < CHEST_MIN_GAP)) continue;
        cands.push(i);
      }
    }
    const want = randInt(rng, CRATES_MIN, 5);
    shuffle(rng, cands);
    const chosen: number[] = [];
    for (const sep of [4, CHEST_MIN_GAP]) {
      for (const c of cands) {
        if (chosen.length >= want) break;
        if (!chosen.includes(c) && chosen.every((o) => cheb(o, c) >= sep)) chosen.push(c);
      }
    }
    if (chosen.length < CRATES_MIN) return failed("A:crates");
    cratesByZone.push(chosen);
  }
  const allCrates = cratesByZone.flat();
  lap("crates");

  // --- Cover: rocks until every lane is short; the fine lattice certifies the cap and screens the spawn pool ---------
  const prot = new Uint8Array(N), soft = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (border[i] || fp[i]) prot[i] = 1;
  for (let y = 1; y <= CORNER_OPEN; y++) {
    for (let x = 1; x <= CORNER_OPEN; x++) {
      for (const [cx, cy] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) prot[cy * W + cx] = 1;
    }
  }
  for (const t of F.laneOut) prot[t.y * W + t.x] = 1;
  for (const c of camps) for (const [ox, oy] of CAMP_HALO) prot[c.site + oy * W + ox] = 1;
  for (const s of pool) {
    const p = tp(s);
    markRect(soft, { x: p.x - 1, y: p.y - 1, w: 3, h: 3 }, 1);
    markRect(prot, { x: p.x - 1, y: p.y - 1, w: 3, h: 3 }, 0);
  }
  for (const c of allCrates) { markRect(soft, cell(c), 1); prot[c] = 1; }
  for (const g of gapTiles) { prot[g.y * W + g.x] = 1; for (const d of NB4) prot[g.y * W + g.x + d] = 1; }
  for (let i = 0; i < N; i++) if (keepLow[i] && tiles[i] === TILE_LOW) prot[i] = 1;
  // A ruin takes a few rocks inside as furniture, never so many that less than 62% of the interior is open (index 0 is
  // "not in a ruin" and absorbs the bookkeeping for every other tile).
  const ruinOf = new Uint8Array(N), ruinQuota: number[] = [0], ruinBox: number[] = [0, 0, 0, 0];
  buildings.forEach((b, n) => {
    let interior = 0, free = 0;
    for (let y = b.y + 1; y < b.y + b.h - 1; y++) {
      for (let x = b.x + 1; x < b.x + b.w - 1; x++) {
        interior++;
        if (tiles[y * W + x] === TILE_FLOOR) { free++; ruinOf[y * W + x] = n + 1; }
      }
    }
    ruinQuota.push(Math.max(0, Math.min(RUIN_ROCKS, Math.floor(free - 0.62 * interior))));
    ruinBox.push(b.x + 1, b.y + 1, b.x + b.w - 2, b.y + b.h - 2);
  });
  const noise = new Uint16Array(N);
  for (let i = 0; i < N; i++) noise[i] = Math.floor(rng() * 1024);
  const ground: CoverGround = { tiles, regionGrid, noise, prot, soft, ruinOf, ruinQuota, ruinBox, ring, guard: territoryGrid };
  lap("prot");
  for (const [dirs, step] of PRE_LATTICES) if (placeCover(getLaneTable(dirs, step), COARSE_TARGET, rng, ground, null) < 0) return failed("A:coverPre");
  lap("coverPre");
  if (placeCover(getLaneTable(COARSE_LATTICE.dirs, COARSE_LATTICE.step), COARSE_TARGET, rng, ground, null) < 0) return failed("A:coverCoarse");
  lap("coverCoarse");
  const poolTiles = pool.map(tp);
  if (placeCover(getLaneTable(SIGHT_LATTICE.dirs, SIGHT_LATTICE.step), SIGHT_LATTICE.target, rng, ground, poolTiles) < 0) return failed("A:coverFine");
  lap("coverFine");

  // --- After the cover ------------------------------------------------------------------------------------------------
  // Territory floor first: one piece per territory holding its camp. The repair may wall up a cut-off piece or move it to another
  // zone, so it comes before the walking contour is judged: nothing after it changes a walkable tile.
  // A stray piece is walled up unless it holds a crate, a pool member's 3x3, a camp's ground or a ruin.
  const keepOpen = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (prot[i] || ruinGrid[i]) keepOpen[i] = 1;
  const zoneBefore = rezonedCopy(hook !== null, zone);
  const rezoned = repairTerritories(tiles, zone, camps, territoryGrid, keepOpen);
  if (rezoned === null) return null;
  if (rezoned > 0) { note("rezoned"); note("rezonedTiles", rezoned); }
  if (rezoned > 0 && zoneBefore !== null) {
    // A piece that changed zone takes its ground with it: a hazard of the old zone's kind goes back to plain ground (T6 wants a kind
    // inside its home zone); low ground (lava, a fence) cannot be taken back, so a piece that holds any fails the attempt.
    for (let i = 0; i < N; i++) {
      if (zone[i] === zoneBefore[i] || terrain[i] === TERRAIN_NONE) continue;
      if (TERRAINS[terrain[i]].tile !== TILE_FLOOR) return failed("A:rezoneLow");
      terrain[i] = TERRAIN_NONE;
    }
  }
  if (rezoned > 0) {
    // A piece that changed zone may not take a crate with it, reach into a ruin's margin or leave the pool short of zones.
    for (let z = 1; z <= ZONES; z++) for (const c of cratesByZone[z - 1]) if (zone[c] !== z) return failed("A:rezoneCrate");
    for (const b of buildings) {
      const z = zone[b.y * W + b.x];
      for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (zone[y * W + x] !== z) return failed("A:rezoneRuin");
    }
    if (new Set(pool.map((i) => zone[i])).size < POOL_ZONES) return failed("A:rezonePool");
    for (let i = 0; i < N; i++) if (zone[i]) regionGrid[i] = zoneCode(zone[i]);
  }
  // The walking contour again, on the final ground (the repair's walls included): keep the longest run of the pool, sorted by walk,
  // that fits within WALK_BAND of one value (max <= min * (1 + b) / (1 - b)).
  {
    const walk = walkDistances(tiles, CY * W + CX);
    if (pool.some((i) => walk[i] < 0)) return failed("A:spawnWalkPost");
    const sorted = pool.slice().sort((a, b) => walk[a] - walk[b] || a - b);
    const lim = (1 + WALK_BAND) / (1 - WALK_BAND);
    let bi = 0, bj = 0;
    for (let i = 0, j = 0; i < sorted.length; i++) {
      while (j < sorted.length && walk[sorted[j]] <= walk[sorted[i]] * lim) j++;
      if (j - i > bj - bi) { bi = i; bj = j; }
    }
    let run = sorted.slice(bi, bj);
    if (run.length > POOL_TARGET) {
      // Thin to POOL_TARGET from the extremes: the members farthest in walking distance from the run's median go first.
      const med = walk[run[run.length >> 1]];
      run = run.slice().sort((a, b) => Math.abs(walk[a] - med) - Math.abs(walk[b] - med) || a - b).slice(0, POOL_TARGET);
    }
    const keep = new Set(run);
    pool = pool.filter((i) => keep.has(i));
    if (pool.length < POOL_MIN || new Set(pool.map((i) => zone[i])).size < POOL_ZONES) return failed("A:spawnWalkPost");
  }
  const floorOf = new Int32Array(ZONES + 1), paintedOf = new Int32Array(ZONES + 1);
  for (let q = 0; q < F.painted.length; q++) {
    const t = F.painted[q];
    paintedOf[zone[t]]++;
    if (tiles[t] === TILE_FLOOR) floorOf[zone[t]]++;
  }
  {
    let lo = 1 << 30, hi = 0, plo = 1 << 30, phi = 0;
    for (let z = 1; z <= ZONES; z++) {
      lo = Math.min(lo, floorOf[z]); hi = Math.max(hi, floorOf[z]);
      plo = Math.min(plo, paintedOf[z]); phi = Math.max(phi, paintedOf[z]);
    }
    if (hi > lo * FLOOR_SHARE_MAX) return failed("A:floorShare");
    if (phi - plo > AREA_TOLERANCE) return failed("A:areaPost");
  }
  if (rezoned > 0) {
    // The repair moved zone tiles: ring contact and slivers again, on the final partition.
    const contact = ringContact(zone), slivers = sliverCounts(zone, new Int32Array(N));
    for (let z = 1; z <= ZONES; z++) {
      if (contact[z] < RING_CONTACT_MIN) return failed("A:ringPost");
      if (slivers[z] > SLIVER_MAX) return failed("A:sliverPost");
    }
  }
  // Each zone's floor is one 4-connected piece (the cover's guard prefers it; this is the guarantee).
  {
    const seen = new Uint8Array(N), queue = new Int32Array(N);
    const started = new Uint8Array(ZONES + 1);
    for (let q = 0; q < F.painted.length; q++) {
      const t0 = F.painted[q], z = zone[t0];
      if (tiles[t0] !== TILE_FLOOR || seen[t0]) continue;
      if (started[z]) return failed("A:zoneFloorSplit");
      started[z] = 1;
      let head = 0, tail = 0;
      queue[tail++] = t0;
      seen[t0] = 1;
      while (head < tail) {
        const i = queue[head++];
        for (let e = 0; e < 4; e++) { const j = i + NB4[e]; if (!seen[j] && zone[j] === z && tiles[j] === TILE_FLOOR) { seen[j] = 1; queue[tail++] = j; } }
      }
    }
  }
  const reach2 = territoryReach2(camps, territoryGrid, tiles);
  for (let T = 1; T <= camps.length; T++) if (reach2[T] > TERRITORY_RADIUS_MAX * TERRITORY_RADIUS_MAX) return failed("A:radiusPost");
  lap("post");

  // The stylers' layer on the final tiles: no floor kind under a rock, no prop on the wrong class of tile, and the whole
  // terrain layer checked (terrain.ts) before the map is handed out.
  if (hook) {
    clearBuried();
    // ICE keeps one tile of clear ground around it (validateTerrain T11), and the cover wants its rocks wherever its lanes need them,
    // lakes included (keeping rocks off the ICE, even as a last resort, made the Rime's territories split and one attempt in three
    // fail): the ICE beside a wall, a rock or a walled-up pocket goes back to plain ground here. Rocks clear the ICE on their 8 neighbours.
    const cleared = clearIceBesideSolid(tiles, terrain);
    if (cleared > 0) note("iceCleared", cleared);
    // The Rime (when the stylers laid ice at all) freezes over on the ground the cover left. Spawns (5x5), crates (3x3) and everything the stylers may not touch stay clear (T8).
    const forbid = protect!.slice();
    for (let i = 0; i < N; i++) if (pool5[i]) forbid[i] = 1;
    for (const c of allCrates) markRect(forbid, cell(c), 1);
    const frozen = laidIce ? freezeClearGround(tiles, terrain, zone, order.indexOf("frost") + 1, forbid) : 0;
    if (frozen > 0) note("iceFrozen", frozen);
    props = props.filter((pr) => {
      const tx = Math.floor(pr.x / TILE), ty = Math.floor(pr.y / TILE), spec = PROP_KINDS[pr.kind];
      return spec !== undefined && tx >= 0 && ty >= 0 && tx < W && ty < H && tiles[ty * W + tx] === spec.on;
    });
  }

  // --- Records ----------------------------------------------------------------------------------------------------
  const noLoot = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (ruinGrid[i] || fp[i] || terrain[i] !== TERRAIN_NONE) noLoot[i] = 1;
  // validateTerrain T8: no floor hazard in a ground spot's 3x3 (a LOW kind may stand there). Nothing to mark on an unstyled map.
  for (let i = 0; i < N; i++) if (terrain[i] !== TERRAIN_NONE && TERRAINS[terrain[i]].tile === TILE_FLOOR) markRect(noLoot, cell(i), 1);
  for (const t of clearing) noLoot[t] = 1;
  for (const t of allCrates) markRect(noLoot, cell(t), 1);
  const groundSpots = pickGroundSpots(rng, tiles, noLoot, poolTiles).map(toWorld);
  if (groundSpots.length < GROUND_SPOTS_MIN) return failed("A:ground");
  if (props.length > 0) {
    // Decor stays off the places a fighter stands or loots, which the hook could not know yet (cosmetic: no draw, no hash).
    const clear = new Uint8Array(N);
    for (const t of pool) markRect(clear, cell(t), 1);
    for (const t of allCrates) markRect(clear, cell(t), 1);
    for (const g of groundSpots) markRect(clear, cell(Math.floor(g.y / TILE) * W + Math.floor(g.x / TILE)), 1);
    props = props.filter((pr) => clear[Math.floor(pr.y / TILE) * W + Math.floor(pr.x / TILE)] === 0);
  }
  const map = records(seed, attempt, tiles, terrain, props, regionGrid, zone, territoryGrid, order, camps, reach2, pool, cratesByZone, ruinGrid, buildings, groundSpots);
  if (hook && validateTerrain(map, { styled: true }).length > 0) return failed("A:terrain");
  lap("records");
  return map;
}

/**
 * The ground the stylers may not touch (styler.ts `protect`): the border, the coliseum, the ring road and one tile beyond, the gate lanes and
 * one tile around them, the camp halos (clearing + 1), the ruins + 1, the 4x4 map corners and the spawn pool's 3x3s (`poolHalo`).
 */
function styleProtect(camps: readonly CampSite[], ruinNear1: Uint8Array, poolHalo: Uint8Array): Uint8Array {
  const F = fixedLayout();
  const protect = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (F.border[i] || F.fp[i] || F.distFp[i] <= RING_ROAD + 1 || ruinNear1[i] || poolHalo[i]) protect[i] = 1;
  for (const t of F.laneOut) markRect(protect, { x: t.x, y: t.y, w: 1, h: 1 }, 1);
  for (const c of camps) for (const [ox, oy] of CAMP_HALO) protect[c.site + oy * W + ox] = 1;
  for (let y = 1; y <= CORNER_OPEN; y++) {
    for (let x = 1; x <= CORNER_OPEN; x++) {
      for (const [cx, cy] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) protect[cy * W + cx] = 1;
    }
  }
  return protect;
}

/**
 * Runs the zone style hook once on the ground as it stands after the ruins, and checks it kept to the contract
 * (styler.ts): only floor turned to wall or low ground, terrain kinds on their class of tile, both only on painted tiles
 * outside the protected ones (`protect`, the spawn pool's 3x3s among them). Returns what the first breach was, or null
 * when the hook kept to it: a breach fails the attempt (and the tests assert none ever happens), it never crashes a room.
 */
function applyStyleHook(
  seed: number, attempt: number, hook: ZoneStyleHook, decor: boolean, order: readonly RegionFaction[], zone: Uint8Array, territoryGrid: Uint8Array,
  camps: readonly CampSite[], protect: Uint8Array, tiles: Uint8Array, terrain: Uint8Array, props: MapProp[], keepLow: Uint8Array,
): string | null {
  const before = tiles.slice();
  const styleCamps: StyleCamp[] = camps.map((c, i) => ({ site: c.site, r: CAMP_R, territory: i + 1 }));
  hook({ w: W, h: H, seed, attempt, decor, tiles, terrain, props, zone, zoneFaction: order, protect, territoryGrid, camps: styleCamps, keepLow });
  if (!decor) props.length = 0;
  const breach = (i: number, what: string): string => `zone style hook broke the contract at tile ${i % W},${Math.floor(i / W)}: ${what}`;
  for (let i = 0; i < N; i++) {
    const t = tiles[i], k = terrain[i];
    if (t !== before[i] && (before[i] !== TILE_FLOOR || (t !== TILE_WALL && t !== TILE_LOW) || !zone[i] || protect[i])) return breach(i, `tile ${before[i]} -> ${t}`);
    if (k === TERRAIN_NONE) continue;
    const spec = TERRAINS[k];
    if (!spec || !zone[i] || protect[i] || !(spec.tile === t || (spec.tile === TILE_LOW && t === TILE_WALL))) return breach(i, `terrain ${k} on tile ${t}`);
  }
  return null;
}

/**
 * The Rime freezes over on the ground the cover left: every floor tile of the zone that can take ICE (plain floor on all eight sides, outside
 * `forbid`, no other kind) becomes ICE. The stylers lay lakes and glaze before the cover, but the cover stands its rocks in the open and each
 * takes the ice around it; only about 3% of the Rime's floor is left with a clear 3x3 (the 480 u sight cap puts a rock in nearly every 3x3), so
 * the ice that is left is all of that ground. No random draw. Returns the tiles added.
 */
function freezeClearGround(tiles: Uint8Array, terrain: Uint8Array, zone: Uint8Array, z: number, forbid: Uint8Array): number {
  if (z <= 0) return 0;
  let added = 0;
  for (let i = 0; i < N; i++) {
    if (zone[i] !== z || tiles[i] !== TILE_FLOOR || forbid[i] || terrain[i] !== TERRAIN_NONE) continue;
    let ok = true;
    for (let q = 0; q < 8 && ok; q++) ok = tiles[i + RING_DY[q] * W + RING_DX[q]] === TILE_FLOOR;
    if (ok) { terrain[i] = TERRAIN_ICE; added++; }
  }
  return added;
}

/** A copy of the zone grid to compare after the territory repair (only a styled map has terrain to fix up). */
function rezonedCopy(styled: boolean, zone: Uint8Array): Uint8Array | null {
  return styled ? zone.slice() : null;
}

/**
 * validateTerrain T11's net: an ICE tile with a wall, a LOW tile or the map edge among its 8 neighbours goes back to plain ground
 * (clearing ICE never makes another tile break the rule). Returns how many tiles it cleared.
 */
function clearIceBesideSolid(tiles: Uint8Array, terrain: Uint8Array): number {
  let cleared = 0;
  for (let i = 0; i < N; i++) {
    if (terrain[i] !== TERRAIN_ICE) continue;
    const x = i % W, y = (i - x) / W;
    let bad = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    for (let q = 0; q < 8 && !bad; q++) bad = tiles[i + RING_DY[q] * W + RING_DX[q]] !== TILE_FLOOR;
    if (bad) { terrain[i] = TERRAIN_NONE; cleared++; }
  }
  return cleared;
}

/** No terrain kind within Chebyshev distance `r` of tile i. */
function plainAround(terrain: Uint8Array, i: number, r: number): boolean {
  const x = i % W, y = (i - x) / W;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && terrain[ny * W + nx] !== TERRAIN_NONE) return false;
    }
  }
  return true;
}

/**
 * The spawn pool on the open ground before the stylers and the cover: candidates with a clear 3x3, outside ruins, SPAWN_RING from the
 * centre and SPAWN_CAMP_PICK from camps; for contour levels at the 20th to 80th percentile of their walking distance to
 * the centre, farthest-point packing within POOL_PICK_BAND of the level, SPAWN_SEPARATION apart, up to POOL_PICK_TARGET
 * members (the cover trims them to POOL_TARGET). The level that packs the most members wins (ties: more zones). Null when no level gives POOL_MIN members in
 * POOL_ZONES zones within SPAWN_TRIES rounds.
 */
function pickSpawnPool(
  rng: Rng, tiles: Uint8Array, zone: Uint8Array, open3: Uint8Array, ruinGrid: Uint8Array, camps: readonly CampSite[],
): number[] | null {
  const walk = walkDistances(tiles, CY * W + CX);
  const lo2 = (SPAWN_RING[0] * R0) * (SPAWN_RING[0] * R0), hi2 = (SPAWN_RING[1] * R0) * (SPAWN_RING[1] * R0);
  const campGap2 = SPAWN_CAMP_PICK * SPAWN_CAMP_PICK;
  const cands: number[] = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (!zone[i] || !open3[i] || ruinGrid[i] || walk[i] < 0) continue;
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY, r2 = dx * dx + dy * dy;
      if (r2 < lo2 || r2 > hi2) continue;
      if (camps.every((c) => d2i(c.site, i) >= campGap2)) cands.push(i);
    }
  }
  if (cands.length === 0) return failed("A:spawnNone");
  const walks = cands.map((i) => walk[i]).sort((a, b) => a - b);
  const sep2 = SPAWN_SEPARATION * SPAWN_SEPARATION;
  const minD = new Int32Array(cands.length);
  let pool: number[] = [], bestScore = -1;
  const zonesOf = (list: readonly number[]): number => new Set(list.map((i) => zone[i])).size;
  for (let tryNo = 0; tryNo < SPAWN_TRIES; tryNo++) {
    for (let qi = 2; qi <= 8; qi++) {
      const level = walks[Math.floor(((walks.length - 1) * qi) / 10)];
      const lo = level * (1 - POOL_PICK_BAND), hi = level * (1 + POOL_PICK_BAND);
      const band = cands.filter((i) => walk[i] >= lo && walk[i] <= hi);
      if (band.length === 0) continue;
      const chosen = [band[randInt(rng, 0, band.length)]];
      for (let q = 0; q < band.length; q++) minD[q] = d2i(band[q], chosen[0]);
      while (chosen.length < POOL_PICK_TARGET) {
        let b = -1, bd = -1;
        for (let q = 0; q < band.length; q++) if (minD[q] >= sep2 && minD[q] > bd) { bd = minD[q]; b = q; }
        if (b < 0) break;
        chosen.push(band[b]);
        for (let q = 0; q < band.length; q++) { const d = d2i(band[q], band[b]); if (d < minD[q]) minD[q] = d; }
      }
      const score = chosen.length * 8 + zonesOf(chosen);
      if (score > bestScore) { bestScore = score; pool = chosen; }
    }
    if (pool.length >= POOL_MIN + 2 && zonesOf(pool) >= POOL_ZONES) break;
  }
  if (pool.length < POOL_MIN || zonesOf(pool) < POOL_ZONES) return failed("A:spawnPool");
  return pool;
}

/** The finished map's records, in contract order: camps by REGION_FACTIONS then index, territoryGrid renumbered to match. */
function records(
  seed: number, attempt: number, tiles: Uint8Array, terrain: Uint8Array, props: MapProp[], regionGrid: Uint8Array, zone: Uint8Array, territoryGrid: Uint8Array,
  order: readonly RegionFaction[], camps: readonly CampSite[], reach2: Int32Array, pool: readonly number[], cratesByZone: readonly number[][],
  ruinGrid: Uint8Array, buildings: TileRect[], groundSpots: Vec2[],
): GameMap {
  const F = fixedLayout();
  const zoneOf = (c: CampSite): RegionFaction => order[c.zone - 1];
  const contractOrder: number[] = [];
  for (const f of REGION_FACTIONS) camps.forEach((c, i) => { if (zoneOf(c) === f) contractOrder.push(i); });
  const renumber = new Int32Array(camps.length + 1);
  contractOrder.forEach((ci, n) => { renumber[ci + 1] = n + 1; });
  const area = new Int32Array(camps.length + 1);
  for (let i = 0; i < N; i++) {
    if (!territoryGrid[i]) continue;
    if (tiles[i] === TILE_FLOOR) area[territoryGrid[i]]++;
    territoryGrid[i] = renumber[territoryGrid[i]];
  }
  const perZone: Record<string, number> = {};
  const campDefs: CampDef[] = contractOrder.map((ci) => {
    const c = camps[ci], f = zoneOf(c);
    perZone[f] = (perZone[f] ?? 0) + 1;
    const site = tp(c.site);
    return {
      id: `${f}-${perZone[f]}`, zone: f, ...toWorld(site), r: CAMP_R * TILE, spots: c.spots.map((s) => toWorld(tp(s))),
      eliteSpot: c.elite ? 0 : -1, chest: toWorld(site), area: area[ci + 1], radius: Math.sqrt(reach2[ci + 1]) * TILE,
    };
  });
  const spawnPool = pool.map((i) => ({ ...toWorld(tp(i)), zone: order[zone[i] - 1] }));

  // A zone's pole: its walkable tile outside ruins farthest (5/7 chamfer) from every other zone, the border and the
  // coliseum; ties go to the lowest tile index.
  const mask = new Uint8Array(N), dt = new Int32Array(N);
  const regions: FactionRegionDef[] = REGION_FACTIONS.map((f) => {
    const z = order.indexOf(f) + 1;
    let painted = 0;
    for (let q = 0; q < F.painted.length; q++) { const t = F.painted[q]; mask[t] = zone[t] === z ? 1 : 0; if (mask[t]) painted++; }
    chamfer(mask, dt);
    let pole = -1, best = -1;
    for (let q = 0; q < F.painted.length; q++) {
      const t = F.painted[q];
      if (mask[t] && tiles[t] === TILE_FLOOR && !ruinGrid[t] && dt[t] > best) { best = dt[t]; pole = t; }
    }
    const mobCamps: MobCampDef[] = campDefs.filter((c) => c.zone === f).map((c) => ({
      id: c.id, region: f, x: c.x, y: c.y, r: c.r, spots: c.spots.map((s) => ({ x: s.x, y: s.y })), elite: c.eliteSpot >= 0, weapon: REGION_WEAPONS[f],
    }));
    return {
      id: f,
      pole: toWorld(tp(pole)),
      area: painted,
      spawns: spawnPool.filter((s) => s.zone === f).map((s) => ({ x: s.x, y: s.y })),
      chestSpots: cratesByZone[z - 1].map((c) => toWorld(tp(c))),
      mobCamps,
    };
  });
  const spawns: Vec2[] = [];
  for (let n = 0; spawns.length < spawnPool.length; n++) for (const r of regions) if (r.spawns[n]) spawns.push({ ...r.spawns[n] });
  const coliseum: ColiseumDef = {
    rect: { ...F.coRect },
    centre: toWorld({ x: CX, y: CY }),
    gates: F.gates.map((g) => ({ side: g.side, tiles: g.tiles.map((t) => ({ x: t.x, y: t.y })), x: g.x, y: g.y })),
    innerSpawns: F.innerTiles.map(toWorld),
  };
  return {
    seed, w: W, h: H, tiles, terrain, props, regionGrid, attempt, territoryGrid, coliseum, regions, camps: campDefs, spawnPool, buildings,
    spawns, crateSpots: regions.flatMap((r) => r.chestSpots.map((p) => ({ x: p.x, y: p.y }))), groundSpots,
  };
}

/**
 * A 32-bit FNV-1a hash of every gameplay layer of a map (tiles, terrain, regionGrid, territoryGrid, camps, spawn pool,
 * regions, ruins, loot spots, the seed and attempt), as 8 hex digits: two sides that agree on it built the same map.
 * Props are left out: they are cosmetic, and the server builds with `decor: false`.
 */
export function mapHash(map: GameMap): string {
  let h = 0x811c9dc5;
  const byte = (b: number): void => { h = Math.imul(h ^ (b & 0xff), 0x01000193) >>> 0; };
  const bytes = (a: Uint8Array): void => { for (let i = 0; i < a.length; i++) byte(a[i]); };
  const str = (s: string): void => { for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); byte(c); byte(c >>> 8); } byte(0x1f); };
  const num = (n: number): void => str(String(n));
  const vec = (p: Vec2): void => { num(p.x); num(p.y); };
  const vecs = (a: readonly Vec2[]): void => { num(a.length); for (const p of a) vec(p); };
  num(map.seed); num(map.attempt); num(map.w); num(map.h);
  bytes(map.tiles); bytes(map.terrain); bytes(map.regionGrid); bytes(map.territoryGrid);
  num(map.camps.length);
  for (const c of map.camps) {
    str(c.id); str(c.zone); vec(c); num(c.r); vecs(c.spots); num(c.eliteSpot); vec(c.chest); num(c.area); num(c.radius);
  }
  num(map.spawnPool.length);
  for (const s of map.spawnPool) { vec(s); str(s.zone); }
  num(map.regions.length);
  for (const r of map.regions) { str(r.id); vec(r.pole); num(r.area); vecs(r.spawns); vecs(r.chestSpots); }
  num(map.buildings.length);
  for (const b of map.buildings) { num(b.x); num(b.y); num(b.w); num(b.h); }
  vecs(map.spawns); vecs(map.crateSpots); vecs(map.groundSpots);
  return h.toString(16).padStart(8, "0");
}
