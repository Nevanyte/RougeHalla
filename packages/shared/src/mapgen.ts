// The zone map generator (ROGUELIKE_PLAN R2, docs/R1_GENERATOR_NOTE.md; the zone-shapes contract, section 2): five themed zones of
// equal area grown around the fixed coliseum on a 136x136 map, eight camps per zone (two of them elite) with their territories,
// the zones' landmarks, a spawn pool on one walking-distance contour, the zone stylers' interiors, the safety nets, the camp spots
// and weapon crates, the checks after them, the ground spots and the spawn walk gate.
//
// Client and server both call generateMap(seed, attempt) and must get identical output, so:
//  - every random decision of an attempt goes through one mulberry32 stream (seed for attempt 0, else
//    seed + attempt * 0x9e3779b1) in a fixed order: drawn only at stages 1 (pillar, faction order), 2 (zones, camps), 5 (the pool),
//    8 (camp spots, crates) and 11 (ground spots). Each zone styler draws from streams of its own
//    (mulberry32(hashSeed(seed, attempt, zone, stream)), styler.ts);
//  - nothing here may call Math.sin/cos/atan2/hypot/pow/exp/log/random: engines may differ in their last bit. Only
//    + - * / sqrt floor ceil round abs min max are used (detSin/detCos in detMath.ts are built from + - * /). That includes
//    findPath, which the spawn gate calls (geometry.ts uses sqrt, never hypot);
//  - sorts use total comparators (value, then tile index); distance fields and heap keys are integers.
//
// One attempt runs (contract 2.1): 1 the pillar variant and the faction order; 2 the zones and the camps (zones.ts); 3 the fixed
// walls; 4 the landmarks (ZONE_LANDMARK_HOOK); 5 the spawn pool on a 5-7-11 walk field; 6 the zone stylers (ZONE_STYLE_HOOK);
// 7 the safety nets (connectivity: the walls they add are the zones' `infill` features); 8 the camp spots and the crates; 9 the
// checks (territory repair, floor share, zone shape, territory radius); 10 the terrain nets; 11 the ground spots and the records;
// 12 the spawn walk gate (findPath, drops extreme members); 13 the shape gates (SHAPE_GATES) and validateTerrain. Any failed check
// fails the attempt: there is no relaxed attempt. tryAttempt runs exactly one; generateMap without an attempt runs them in order
// until one certifies.
import { MAP_TILES_H, MAP_TILES_W, PLAYER_RADIUS, TILE } from "./constants";
import { CX, CY, RING_ROAD, fixedLayout } from "./coliseum";
import { NB4 as OPS_NB4, RING_DX as OPS_RING_DX, RING_DY as OPS_RING_DY, enforceConnectivity } from "./gridOps";
import { segmentBlocked as topoSegmentBlocked, walkField16 } from "./gridTopology";
import {
  MASK_SIGHT as SIGHT_MASK, REGION_COLISEUM, REGION_FACTIONS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR as FLOOR_TILE, TILE_LOW as LOW_TILE,
  TILE_WALL as WALL_TILE, mapFromTiles, regionCode, tileToWorldCenter,
} from "./map";
import type { CampDef, ColiseumDef, FactionRegionDef, GameMap, MapFeature, MapProp, MobCampDef, RegionFaction, TilePt, TileRect } from "./map";
import type { Vec2 } from "./messages";
import { findPath, pathLength } from "./pathfind";
import { primeSpawnWalks } from "./planning";
import { mulberry32, randInt as rngInt, shuffle } from "./rng";
import type { Rng } from "./rng";
import { ZONE_LANDMARK_HOOK, ZONE_STYLE_HOOK } from "./styler";
import type { LandmarkHook, StyleCamp, ZoneStyleHook } from "./styler";
import { PROP_KINDS, TERRAINS, TERRAIN_BOG, TERRAIN_EMBER, TERRAIN_ICE, TERRAIN_NONE, validateTerrain } from "./terrain";
import {
  AREA_TOLERANCE, CAMP_HALO, CAMP_R, CAMP_TILES, RING_CONTACT_MIN, SLIVER_MAX, TERRITORY_RADIUS_MAX, ZONES, chamfer, d2i as tileD2, failed, note,
  partitionZones, placeCamps, repairTerritories, ringContact, sliverCounts, territoryReach2, warmZoneLayout,
} from "./zones";
import type { CampLayout, CampSite, ZonePartition } from "./zones";
import type { FeatureDraft } from "./zoneStyle/types";

export {
  CAMPS_PER_ZONE, CAMP_GAP, ELITES_PER_ZONE, ELITE_MIN_SEP, MAPGEN_FAILS, MAPGEN_NOTES, RING_CONTACT_MIN, SLIVER_MAX, TERRITORY_RADIUS_MAX,
} from "./zones";
export { STYLE_STREAM, ZONE_LANDMARK_HOOK, ZONE_STYLE_HOOK, styleRng } from "./styler";
export type { LandmarkHook, LandmarkState, StyleCamp, StyleState, ZoneStyleHook } from "./styler";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const R0 = Math.min(W, H) / 2;
// Hot loops read module-level copies of these imports: under a test runner's module system (vitest) every use of an
// import is a property read on the module object, which cost this code about a third of its time.
const NB4 = OPS_NB4, RING_DX = OPS_RING_DX, RING_DY = OPS_RING_DY;
const TILE_FLOOR = FLOOR_TILE, TILE_LOW = LOW_TILE, TILE_WALL = WALL_TILE, MASK_SIGHT = SIGHT_MASK, randInt = rngInt, d2i = tileD2;
const segmentBlocked = topoSegmentBlocked;

/**
 * The shape gates (contract 2.1 stage 13, 3.1): every zone WALL/LOW tile owned by a feature of its zone, no zone wall piece under 6
 * tiles. On since phase C (the five zone stylers write only through features). `MapgenOptions.shapeGates` overrides it for a custom
 * test hook that writes tiles without features (mapCertify's demo hook).
 */
export const SHAPE_GATES: boolean = true;
/** Most features a map may hold (featureGrid is one byte per tile). */
const FEATURES_MAX = 250;

/** Tiles from the border that stay open at each map corner (a click outside the world snaps to floor near the nearest corner). */
const CORNER_OPEN = 4;
/** Ground loot uses tiles with floor on all eight sides unless fewer than this many are left. */
const GROUND_OPEN_MIN = 90;
/** Ground spots: GROUND_SPOTS_MIN to GROUND_SPOTS_MAX (contract 0.1.12: loot scales with the square root of the area). */
const GROUND_SPOTS_MIN = 30;
const GROUND_SPOTS_MAX = 45;
/** Weapon crates per zone: CRATES_MIN to CRATES_MAX against a wall, never touching. */
const CRATES_MIN = 4;
const CRATES_MAX = 6;
const CHEST_MIN_GAP = 2;

/** Spawn pool: the certified floor of the spacing between members (tiles); members a wall does not separate keep SPAWN_SAFE_SEP. */
const SPAWN_SEPARATION = 5;
/** Two members closer than this (tiles) need a wall on the straight line between their centres (owner ruling: spawn safety). */
const SPAWN_SAFE_SEP = 10;
/** Members are picked at least this far from camp centres (tiles). */
const SPAWN_CAMP_PICK = 7;
/** Members lie this far from the centre (fractions of R0): 34 to 64.6 tiles at 136x136. */
const SPAWN_RING: readonly [number, number] = [0.5, 0.95];
const POOL_PICK_TARGET = 32;
const POOL_MIN = 24;
/** Zones the pool must cover (each member then has a member of another zone to be dealt with). */
const POOL_ZONES = 4;
/** The pool is picked within this fraction of one contour value of the 5-7-11 walk field. */
const POOL_PICK_BAND = 0.03;
const SPAWN_TRIES = 4;
/** The spawn gate: the members' findPath walks to the coliseum centre within this max/min (after drops). */
const SPAWN_WALK_RATIO_MAX = 1.2;
/** The spawn gate: a member whose walk crosses more floor-hazard tiles than this (ember, bog, ice) is dropped first. */
const HAZARD_WALK_MAX = 8;
/** Max/min walkable floor across the zones after landmarks and stylers. */
const FLOOR_SHARE_MAX = 1.15;
/** Zone sets drawn per attempt when the camps of one cannot be seated (each draw has its own ZONE_TRIES and CAMP_TRIES). */
const LAYOUT_TRIES = 4;

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

/** Sets grid cells of `r` grown by `margin` (clipped to the map). */
function markRect(grid: Uint8Array, r: TileRect, margin: number): void {
  const x0 = Math.max(0, r.x - margin), x1 = Math.min(W - 1, r.x + r.w - 1 + margin);
  const y0 = Math.max(0, r.y - margin), y1 = Math.min(H - 1, r.y + r.h - 1 + margin);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * W + x] = 1;
}

/** `skip` marks tiles that must stay free of loot (landmarks, the coliseum, camp clearings, crates and their neighbours). */
function pickGroundSpots(rng: Rng, tiles: Uint8Array, skip: Uint8Array, spawns: TilePt[]): TilePt[] {
  // Loot lies in the open: tiles with floor all round come first, so a body can stand on it; a tile beside a wall is only used
  // when there are too few of those.
  const cands: TilePt[] = [], nooks: TilePt[] = [];
  // Nothing within 2 tiles (Chebyshev) of a spawn.
  const nearSpawn = new Uint8Array(N);
  for (const s of spawns) markRect(nearSpawn, { x: s.x, y: s.y, w: 1, h: 1 }, 2);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (tiles[y * W + x] !== TILE_FLOOR || skip[y * W + x] || nearSpawn[y * W + x]) continue;
      let clear = true;
      for (let q = 0; q < 8 && clear; q++) if (tiles[(y + RING_DY[q]) * W + x + RING_DX[q]] !== TILE_FLOOR) clear = false;
      (clear ? cands : nooks).push({ x, y });
    }
  }
  shuffle(rng, cands);
  if (cands.length < GROUND_OPEN_MIN) cands.push(...shuffle(rng, nooks));
  const want = randInt(rng, GROUND_SPOTS_MIN, GROUND_SPOTS_MAX + 1);
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
   * The landmark hook to run instead of ZONE_LANDMARK_HOOK (null: none; the zones then have no landmarks, so their crates have no
   * nooks). Tests only.
   */
  landmarks?: LandmarkHook | null;
  /**
   * false skips the cosmetic layer: no props (the server and the bots build this way). Every layer mapHash covers is the
   * same either way, because props are drawn from a stream of their own and never read by the generator. Default true.
   */
  decor?: boolean;
  /** Overrides SHAPE_GATES. Tests only: a custom hook that writes tiles without features (mapCertify's demo hook) passes false. */
  shapeGates?: boolean;
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
  return buildMap(
    seed, attempt,
    options?.styleZones !== undefined ? options.styleZones : ZONE_STYLE_HOOK,
    options?.landmarks !== undefined ? options.landmarks : ZONE_LANDMARK_HOOK,
    options?.decor !== false,
    options?.shapeGates ?? SHAPE_GATES,
  );
}

/** The first of attempts 0..MAX_ATTEMPTS-1 of `seed` that certifies, or null: a map pool discards such a seed. */
export function certifiedMap(seed: number, options?: MapgenOptions): GameMap | null {
  for (let a = 0; a < MAX_ATTEMPTS; a++) {
    const map = tryAttempt(seed, a, options);
    if (map) return map;
  }
  return null;
}

/** Builds the process-wide tables (the fixed layout and the zone layout) so the first map does not pay for them. */
export function warmMapgen(): void {
  fixedLayout();
  warmZoneLayout();
}

/** Per-stage timing for the bench (`scripts/mapBench.ts`); off by default, and never changes a map. */
export const MAPGEN_PROFILE = { on: false, attempts: 0, ms: {} as Record<string, number> };

function buildMap(seed: number, attempt: number, hook: ZoneStyleHook | null, landmarkHook: LandmarkHook | null, decor: boolean, gates: boolean): GameMap | null {
  const F = fixedLayout();
  const { border, fp, ring } = F;
  let tMark = MAPGEN_PROFILE.on ? performance.now() : 0;
  const lap = (stage: string): void => {
    if (!MAPGEN_PROFILE.on) return;
    const t = performance.now();
    MAPGEN_PROFILE.ms[stage] = (MAPGEN_PROFILE.ms[stage] ?? 0) + (t - tMark);
    tMark = t;
  };
  if (MAPGEN_PROFILE.on) MAPGEN_PROFILE.attempts++;

  // --- 1. The stream, the pillar variant, the faction order ---------------------------------------------------------
  const rng = mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1);
  const tiles = new Uint8Array(N).fill(TILE_FLOOR);
  const pillar = F.pillars[Math.floor(rng() * F.pillars.length)];
  const order = shuffle(rng, [...REGION_FACTIONS]);

  // --- 2. Zones, then camps and their territories ---------------------------------------------------------------------
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

  // --- 3. The fixed walls -----------------------------------------------------------------------------------------------
  for (let i = 0; i < N; i++) if (border[i] || pillar[i] || F.wallRing[i]) tiles[i] = TILE_WALL;
  for (const g of F.gates) for (const t of g.tiles) tiles[t.y * W + t.x] = TILE_FLOOR;
  const clearing: number[] = [];
  for (const c of camps) for (const [ox, oy] of CAMP_TILES) clearing.push(c.site + oy * W + ox);
  const styleCamps: StyleCamp[] = camps.map((c, i) => ({ site: c.site, r: CAMP_R, territory: i + 1, elite: c.elite }));

  // --- 4. Landmarks: each zone's styler places its own through the guard (the feature log starts here) -------------------
  const features: FeatureDraft[] = [];
  const featureOwner = new Uint16Array(N);
  const buildings: TileRect[] = [];
  /** Landmark boxes, and the boxes grown by one tile. */
  const landmarkBox = new Uint8Array(N), landmarkNear1 = new Uint8Array(N);
  if (landmarkHook) {
    const lprot = landmarkProtect(camps);
    const before = tiles.slice();
    landmarkHook({ w: W, h: H, seed, attempt, tiles, zone, zoneFaction: order, protect: lprot, territoryGrid, camps: styleCamps, features, featureOwner });
    // The landmark contract: only zone floor outside the landmark protect turned to wall, every such tile owned by a landmark of its zone.
    for (let i = 0; i < N; i++) {
      if (tiles[i] === before[i]) continue;
      if (before[i] !== TILE_FLOOR || tiles[i] !== TILE_WALL || !zone[i] || lprot[i]) return failed("A:styleBreach");
      const o = featureOwner[i];
      if (o === 0 || features[o - 1].kind !== "landmark" || features[o - 1].zone !== order[zone[i] - 1]) return failed("A:styleBreach");
    }
    for (const f of features) {
      if (f.kind !== "landmark") continue;
      buildings.push({ x: f.bbox.x, y: f.bbox.y, w: f.bbox.w, h: f.bbox.h });
      markRect(landmarkBox, f.bbox, 0);
      markRect(landmarkNear1, f.bbox, 1);
    }
  }
  lap("landmarks");

  // --- 5. Spawn pool: farthest-point packing on one contour of the 5-7-11 walk field, on the ground the landmarks left --------
  // It is picked before the stylers, which get each member's 3x3 as protected ground (hazards are cleared from its 5x5 after
  // them: validateTerrain T8) and its pick-time walk for their route guards. The spawn gate certifies the real walks at the end.
  const centreWalk = walkField16(tiles, W, H, [CY * W + CX]);
  // A clear 3x3 of floor: three floor tiles in a row, in three rows.
  const row3 = new Uint8Array(N), open3 = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (tiles[i - 1] === TILE_FLOOR && tiles[i] === TILE_FLOOR && tiles[i + 1] === TILE_FLOOR) row3[i] = 1;
    }
  }
  for (let i = W; i < N - W; i++) if (row3[i - W] && row3[i] && row3[i + W]) open3[i] = 1;
  const picked = pickSpawnPool(rng, tiles, zone, open3, landmarkNear1, camps, centreWalk);
  if (!picked) return null;
  const pool = picked;
  // The 3x3 of every member, and the 5x5 around it (the stylers' hazards keep off it).
  const poolHalo = new Uint8Array(N), pool5 = new Uint8Array(N);
  for (const t of pool) { markRect(poolHalo, cell(t), 1); markRect(pool5, cell(t), 2); }
  lap("spawns");

  // --- 6. The zone stylers ------------------------------------------------------------------------------------------------
  const terrain = new Uint8Array(N);
  let props: MapProp[] = [];
  const protect = styleProtect(camps, landmarkNear1, featureOwner, poolHalo);
  if (hook) {
    const breach = applyStyleHook(
      seed, attempt, hook, decor, gates, order, zone, territoryGrid, styleCamps, protect, tiles, terrain, props, pool, centreWalk, features, featureOwner,
    );
    lap("styler");
    if (breach !== null) return failed("A:styleBreach");
    // T8: no hazard (a floor kind) in a spawn's 5x5; low ground such as lava or a fence may stand there.
    for (let i = 0; i < N; i++) if (pool5[i] && terrain[i] !== TERRAIN_NONE && TERRAINS[terrain[i]].tile === TILE_FLOOR) terrain[i] = TERRAIN_NONE;
  }
  // A floor kind does not survive under a wall (a walled-up pocket); a LOW kind does, as decor (terrain.ts T3).
  const clearBuried = (): void => {
    if (!hook) return;
    for (let i = 0; i < N; i++) if (terrain[i] !== TERRAIN_NONE && tiles[i] === TILE_WALL && TERRAINS[terrain[i]].tile === TILE_FLOOR) terrain[i] = TERRAIN_NONE;
  };

  // --- 7. Safety nets, then connectivity: floor the centre cannot reach becomes wall; a camp clearing cut off fails ------------
  const beforeNets = tiles.slice();
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
  lap("nets");

  // --- 8. Camp spots: 3-5 in the clearing, never its centre (the chest tile); an elite stands at spot 0, nearest the centre.
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

  // --- Weapon crates: CRATES_MIN-CRATES_MAX per zone against a wall; a landmark's nooks are tried first -------------------------
  const doorNear = new Uint8Array(N);
  const nooksByZone: number[][] = [[], [], [], [], [], []];
  for (const f of features) {
    if (f.kind !== "landmark") continue;
    for (let k = 2; k < f.p.length; k++) markRect(doorNear, cell(f.p[k]), 1);
  }
  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi];
    if (f.kind !== "landmark") continue;
    // The nooks (contract 5.1 'c' cells): owned floor tiles of the landmark with walls of its own on two orthogonal sides (an inner
    // corner) and no door within one tile, in tile order.
    for (let y = f.bbox.y; y < f.bbox.y + f.bbox.h; y++) {
      for (let x = f.bbox.x; x < f.bbox.x + f.bbox.w; x++) {
        const i = y * W + x;
        if (featureOwner[i] !== fi + 1 || tiles[i] !== TILE_FLOOR || doorNear[i]) continue;
        let walls = 0;
        for (let e = 0; e < 4; e++) { const j = i + NB4[e]; if (tiles[j] === TILE_WALL && featureOwner[j] === fi + 1) walls++; }
        if (walls >= 2 && zone[i]) nooksByZone[zone[i]].push(i);
      }
    }
  }
  // No crate within 2 tiles (Chebyshev) of a pool member or a camp centre, or within 1 of a camp spot, a door or another crate.
  const crateNo = new Uint8Array(N);
  for (const t of pool) markRect(crateNo, cell(t), 2);
  for (const c of camps) { markRect(crateNo, cell(c.site), 2); for (const t of c.spots) markRect(crateNo, cell(t), 1); }
  for (let i = 0; i < N; i++) if (doorNear[i]) crateNo[i] = 1;
  const cratesByZone: number[][] = [];
  for (let z = 1; z <= ZONES; z++) {
    const free = (i: number): boolean => zone[i] === z && tiles[i] === TILE_FLOOR && !ring[i] && !crateNo[i] && (!hook || plainAround(terrain, i, 1));
    const againstWall = (i: number): boolean => tiles[i - 1] === TILE_WALL || tiles[i + 1] === TILE_WALL || tiles[i - W] === TILE_WALL || tiles[i + W] === TILE_WALL;
    const nooks = nooksByZone[z].filter((i) => againstWall(i) && free(i));
    const cands: number[] = [];
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (againstWall(i) && free(i) && !nooks.includes(i)) cands.push(i);
      }
    }
    const want = randInt(rng, CRATES_MIN, CRATES_MAX + 1);
    shuffle(rng, cands);
    const chosen: number[] = [];
    const take = (ordered: readonly number[]): void => {
      for (const sep of [4, CHEST_MIN_GAP]) {
        for (const c of ordered) {
          if (chosen.length >= want) break;
          if (!chosen.includes(c) && chosen.every((o) => cheb(o, c) >= sep)) chosen.push(c);
        }
      }
    };
    take(nooks.concat(cands));
    if (chosen.length < CRATES_MIN) {
      // A zone with too few walls for its crates (a plain zone without landmarks has none): crates stand on open floor with a
      // clear 3x3 instead, the other rules unchanged. With landmarks in every zone this does not happen.
      const open: number[] = [];
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          const i = y * W + x;
          if (!againstWall(i) && open3At(tiles, i) && free(i)) open.push(i);
        }
      }
      shuffle(rng, open);
      take(open);
      note("crateOpen");
    }
    if (chosen.length < CRATES_MIN) return failed("A:crates");
    for (const c of chosen) markRect(crateNo, cell(c), CHEST_MIN_GAP - 1);
    cratesByZone.push(chosen);
  }
  const allCrates = cratesByZone.flat();
  lap("crates");

  // --- 9. The checks: territory floor first (one piece per territory holding its camp), then the shares and shapes -------------
  // The repair may wall up a cut-off piece or move it to another zone. A stray piece is walled up unless it holds a crate, a pool
  // member's 3x3, a camp's ground, a landmark or anything else protected.
  const keepOpen = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (protect[i] || landmarkBox[i]) keepOpen[i] = 1;
  for (const c of allCrates) keepOpen[c] = 1;
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
    // A piece that changed zone may not take a crate with it, reach into a landmark's margin or leave the pool short of zones.
    for (let z = 1; z <= ZONES; z++) for (const c of cratesByZone[z - 1]) if (zone[c] !== z) return failed("A:rezoneCrate");
    for (const b of buildings) {
      const z = zone[b.y * W + b.x];
      for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) if (zone[y * W + x] !== z) return failed("A:rezoneLandmark");
    }
    if (new Set(pool.map((i) => zone[i])).size < POOL_ZONES) return failed("A:rezonePool");
    for (let i = 0; i < N; i++) if (zone[i]) regionGrid[i] = zoneCode(zone[i]);
  }
  // The walls the nets added (connectivity, the territory repair) on zone tiles: each zone's one `infill` feature.
  {
    const infill: number[][] = [[], [], [], [], [], []];
    for (let q = 0; q < F.painted.length; q++) {
      const t = F.painted[q];
      if (tiles[t] === TILE_WALL && beforeNets[t] === TILE_FLOOR && featureOwner[t] === 0 && zone[t]) infill[zone[t]].push(t);
    }
    for (let z = 1; z <= ZONES; z++) {
      const list = infill[z];
      if (list.length === 0) continue;
      const id = features.length + 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (const t of list) {
        featureOwner[t] = id;
        const x = t % W, y = (t - x) / W;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      features.push({
        kind: "infill", variant: "", zone: order[z - 1], jobs: ["seal"], ax: list[0] % W, ay: (list[0] - (list[0] % W)) / W, p: [],
        bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, tiles: list.length,
      });
      note("infillTiles", list.length);
    }
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
  // Each zone's floor is one 4-connected piece.
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

  // --- 10. The stylers' layer on the final tiles: no floor kind under a wall, no ICE beside a solid tile, no prop on the wrong class.
  if (hook) {
    clearBuried();
    // ICE keeps one tile of clear ground around it (validateTerrain T11): the stylers' guard keeps blockers off ICE's neighbours, so this
    // net should clear nothing; a nets wall beside ICE would be the one case.
    const cleared = clearIceBesideSolid(tiles, terrain);
    if (cleared > 0) note("iceCleared", cleared);
    props = props.filter((pr) => {
      const tx = Math.floor(pr.x / TILE), ty = Math.floor(pr.y / TILE), spec = PROP_KINDS[pr.kind];
      return spec !== undefined && tx >= 0 && ty >= 0 && tx < W && ty < H && tiles[ty * W + tx] === spec.on;
    });
  }
  lap("terrain");

  // --- 11. Ground spots, then the records ---------------------------------------------------------------------------------
  const noLoot = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (landmarkBox[i] || fp[i] || terrain[i] !== TERRAIN_NONE) noLoot[i] = 1;
  // validateTerrain T8: no floor hazard in a ground spot's 3x3 (a LOW kind may stand there). Nothing to mark on an unstyled map.
  for (let i = 0; i < N; i++) if (terrain[i] !== TERRAIN_NONE && TERRAINS[terrain[i]].tile === TILE_FLOOR) markRect(noLoot, cell(i), 1);
  for (const t of clearing) noLoot[t] = 1;
  for (const t of allCrates) markRect(noLoot, cell(t), 1);
  const groundSpots = pickGroundSpots(rng, tiles, noLoot, pool.map(tp)).map(toWorld);
  if (groundSpots.length < GROUND_SPOTS_MIN) return failed("A:ground");
  if (props.length > 0) {
    // Decor stays off the places a fighter stands or loots, which the hook could not know yet (cosmetic: no draw, no hash).
    const clear = new Uint8Array(N);
    for (const t of pool) markRect(clear, cell(t), 1);
    for (const t of allCrates) markRect(clear, cell(t), 1);
    for (const g of groundSpots) markRect(clear, cell(Math.floor(g.y / TILE) * W + Math.floor(g.x / TILE)), 1);
    props = props.filter((pr) => clear[Math.floor(pr.y / TILE) * W + Math.floor(pr.x / TILE)] === 0);
  }
  lap("records");

  // --- 12. The spawn walk gate: real findPath walks, drop the extreme members, certify max/min <= 1.2 -------------------------
  // On the finished tiles (nothing after this changes one). Dropping a member never invalidates crates, ground spots or props:
  // they kept away from every picked member.
  const gate = spawnGate(tiles, pool, terrain, zone);
  lap("spawnGate");
  if (!gate) return null;
  if (features.length > FEATURES_MAX) return failed("A:features");
  const map = records(
    seed, attempt, tiles, terrain, props, regionGrid, zone, territoryGrid, order, camps, reach2, gate.pool, cratesByZone, landmarkBox, buildings,
    groundSpots, features, featureOwner,
  );
  primeSpawnWalks(map, gate.walks);
  lap("records");

  // --- 13. The shape gates, then the terrain layer -------------------------------------------------------------------------
  if (gates) {
    const why = shapeGateFailure(map, zone);
    if (why !== null) return failed(why);
  }
  if (validateTerrain(map, { styled: hook !== null }).length > 0) return failed("A:terrain");
  lap("gates");
  return map;
}

/**
 * The landmark stage's protect (contract 3.1): the border, the coliseum, the ring road and two tiles beyond, the gate lanes and one
 * tile around them, the camp clearings grown by 3 tiles (halo + 2) and the 4x4 map corners.
 */
function landmarkProtect(camps: readonly CampSite[]): Uint8Array {
  const F = fixedLayout();
  const protect = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (F.border[i] || F.fp[i] || F.distFp[i] <= RING_ROAD + 2) protect[i] = 1;
  for (const t of F.laneOut) markRect(protect, { x: t.x, y: t.y, w: 1, h: 1 }, 1);
  for (const c of camps) for (const [ox, oy] of CAMP_TILES) markRect(protect, cell(c.site + oy * W + ox), 3);
  markCorners(protect);
  return protect;
}

/** The 4x4 corners inside the border ring. */
function markCorners(grid: Uint8Array): void {
  for (let y = 1; y <= CORNER_OPEN; y++) {
    for (let x = 1; x <= CORNER_OPEN; x++) {
      for (const [cx, cy] of [[x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]]) grid[cy * W + cx] = 1;
    }
  }
}

/**
 * The ground the stylers may not touch (styler.ts `protect`): the border, the coliseum, the ring road and one tile beyond, the gate lanes and
 * one tile around them, the camp halos (clearing + 1), the ring round each landmark box (the box grown by 1) without the tiles a landmark
 * owns, the 4x4 map corners and the spawn pool's 3x3s (`poolHalo`). A landmark's own tiles are not protect: its feature owns them (the
 * guard refuses every owned tile), so its props and its shrine's light can stand there; a box cell the template does not use stays protected.
 */
function styleProtect(camps: readonly CampSite[], landmarkNear1: Uint8Array, featureOwner: Uint16Array, poolHalo: Uint8Array): Uint8Array {
  const F = fixedLayout();
  const protect = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (F.border[i] || F.fp[i] || F.distFp[i] <= RING_ROAD + 1 || (landmarkNear1[i] && featureOwner[i] === 0) || poolHalo[i]) protect[i] = 1;
  }
  for (const t of F.laneOut) markRect(protect, { x: t.x, y: t.y, w: 1, h: 1 }, 1);
  for (const c of camps) for (const [ox, oy] of CAMP_HALO) protect[c.site + oy * W + ox] = 1;
  markCorners(protect);
  return protect;
}

/**
 * Runs the zone style hook once on the ground as it stands after the landmarks and the pool, and checks it kept to the contract
 * (styler.ts): only floor turned to wall or low ground, terrain kinds on their class of tile, both only on painted tiles outside the
 * protected ones (`protect`, the spawn pool's 3x3s among them), and with the shape gates every changed tile owned by a feature of its
 * zone. Returns what the first breach was, or null when the hook kept to it: a breach fails the attempt (and the tests assert none
 * ever happens), it never crashes a room.
 */
function applyStyleHook(
  seed: number, attempt: number, hook: ZoneStyleHook, decor: boolean, gates: boolean, order: readonly RegionFaction[], zone: Uint8Array,
  territoryGrid: Uint8Array, camps: readonly StyleCamp[], protect: Uint8Array, tiles: Uint8Array, terrain: Uint8Array, props: MapProp[],
  spawns: readonly number[], centreWalk: Int32Array, features: FeatureDraft[], featureOwner: Uint16Array,
): string | null {
  const before = tiles.slice();
  hook({ w: W, h: H, seed, attempt, decor, tiles, terrain, props, zone, zoneFaction: order, protect, territoryGrid, camps, spawns, centreWalk, features, featureOwner });
  if (!decor) props.length = 0;
  const breach = (i: number, what: string): string => `zone style hook broke the contract at tile ${i % W},${Math.floor(i / W)}: ${what}`;
  for (let i = 0; i < N; i++) {
    const t = tiles[i], k = terrain[i];
    if (t !== before[i] && (before[i] !== TILE_FLOOR || (t !== TILE_WALL && t !== TILE_LOW) || !zone[i] || protect[i])) return breach(i, `tile ${before[i]} -> ${t}`);
    if ((t !== before[i] || k !== TERRAIN_NONE) && gates) {
      const o = featureOwner[i];
      if (o === 0 || features[o - 1].zone !== order[zone[i] - 1]) return breach(i, "a change no feature of the zone owns");
    }
    if (k === TERRAIN_NONE) continue;
    const spec = TERRAINS[k];
    if (!spec || !zone[i] || protect[i] || !(spec.tile === t || (spec.tile === TILE_LOW && t === TILE_WALL))) return breach(i, `terrain ${k} on tile ${t}`);
  }
  return null;
}

/** A copy of the zone grid to compare after the territory repair (only a styled map has terrain to fix up). */
function rezonedCopy(styled: boolean, zone: Uint8Array): Uint8Array | null {
  return styled ? zone.slice() : null;
}

/**
 * validateTerrain T11's net: an ICE tile with a wall, a LOW tile or the map edge among its 8 neighbours goes back to plain ground
 * (clearing ICE never makes another tile break the rule). Returns how many tiles it cleared (expected 0: the guard keeps blockers off
 * ICE's neighbours; only a nets wall can land there).
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

/** Tile i and its 8 neighbours are floor. */
function open3At(tiles: Uint8Array, i: number): boolean {
  for (let q = 0; q < 8; q++) if (tiles[i + RING_DY[q] * W + RING_DX[q]] !== TILE_FLOOR) return false;
  return tiles[i] === TILE_FLOOR;
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
 * The spawn pool (contract 2.2) on the ground the landmarks left, before the stylers: candidates are zone tiles with a clear 3x3,
 * outside every landmark box grown by one, SPAWN_RING from the centre, SPAWN_CAMP_PICK from camp centres and reachable on the 5-7-11
 * walk field `walk`. For contour levels at the 20th to 80th percentile of their walks, farthest-point packing within POOL_PICK_BAND
 * of the level, each next member admissible against every chosen one (SPAWN_SAFE_SEP apart, or at least SPAWN_SEPARATION with the
 * straight line between their centres wall-blocked), up to POOL_PICK_TARGET. The level that packs the most members wins (ties: more
 * zones, then the earlier). Null when no level gives POOL_MIN members in POOL_ZONES zones within SPAWN_TRIES rounds.
 */
function pickSpawnPool(
  rng: Rng, tiles: Uint8Array, zone: Uint8Array, open3: Uint8Array, landmarkNear1: Uint8Array, camps: readonly CampSite[], walk: Int32Array,
): number[] | null {
  const lo2 = (SPAWN_RING[0] * R0) * (SPAWN_RING[0] * R0), hi2 = (SPAWN_RING[1] * R0) * (SPAWN_RING[1] * R0);
  // Tiles closer than SPAWN_CAMP_PICK to a camp centre (squared distance under its square).
  const nearCamp = new Uint8Array(N);
  for (const c of camps) {
    const cx = c.site % W, cy = (c.site - cx) / W;
    for (let dy = -SPAWN_CAMP_PICK + 1; dy < SPAWN_CAMP_PICK; dy++) {
      for (let dx = -SPAWN_CAMP_PICK + 1; dx < SPAWN_CAMP_PICK; dx++) {
        const x = cx + dx, y = cy + dy;
        if (dx * dx + dy * dy < SPAWN_CAMP_PICK * SPAWN_CAMP_PICK && x >= 0 && y >= 0 && x < W && y < H) nearCamp[y * W + x] = 1;
      }
    }
  }
  const cands: number[] = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const i = y * W + x;
      if (!zone[i] || !open3[i] || landmarkNear1[i] || walk[i] < 0 || nearCamp[i]) continue;
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY, r2 = dx * dx + dy * dy;
      if (r2 < lo2 || r2 > hi2) continue;
      cands.push(i);
    }
  }
  if (cands.length === 0) return failed("A:spawnNone");
  const walks = cands.map((i) => walk[i]).sort((a, b) => a - b);
  const safe2 = SPAWN_SAFE_SEP * SPAWN_SAFE_SEP, sep2 = SPAWN_SEPARATION * SPAWN_SEPARATION;
  const admissible = (a: number, b: number): boolean => {
    const d = d2i(a, b);
    if (d >= safe2) return true;
    if (d < sep2) return false;
    const ax = a % W, bx = b % W;
    return segmentBlocked(tiles, W, H, ax, (a - ax) / W, bx, (b - bx) / W, MASK_SIGHT);
  };
  const minD = new Int32Array(cands.length), ok = new Uint8Array(cands.length);
  let pool: number[] = [], bestScore = -1;
  const zonesOf = (list: readonly number[]): number => new Set(list.map((i) => zone[i])).size;
  // The band of each contour level (the same in every round: only the first member's draw differs).
  const bands: number[][] = [];
  for (let qi = 2; qi <= 8; qi++) {
    const level = walks[Math.floor(((walks.length - 1) * qi) / 10)];
    const lo = level * (1 - POOL_PICK_BAND), hi = level * (1 + POOL_PICK_BAND);
    bands.push(cands.filter((i) => walk[i] >= lo && walk[i] <= hi));
  }
  for (let tryNo = 0; tryNo < SPAWN_TRIES; tryNo++) {
    for (const band of bands) {
      if (band.length === 0) continue;
      const chosen = [band[randInt(rng, 0, band.length)]];
      for (let q = 0; q < band.length; q++) { minD[q] = d2i(band[q], chosen[0]); ok[q] = admissible(band[q], chosen[0]) ? 1 : 0; }
      while (chosen.length < POOL_PICK_TARGET) {
        let b = -1, bd = -1;
        for (let q = 0; q < band.length; q++) if (ok[q] && minD[q] > bd) { bd = minD[q]; b = q; }
        if (b < 0) break;
        const m = band[b];
        chosen.push(m);
        for (let q = 0; q < band.length; q++) {
          const d = d2i(band[q], m);
          if (d < minD[q]) minD[q] = d;
          if (ok[q] && d < safe2 && !admissible(band[q], m)) ok[q] = 0;
        }
      }
      const score = chosen.length * 8 + zonesOf(chosen);
      if (score > bestScore) { bestScore = score; pool = chosen; }
    }
    if (pool.length >= POOL_MIN + 2 && zonesOf(pool) >= POOL_ZONES) break;
  }
  if (pool.length < POOL_MIN || zonesOf(pool) < POOL_ZONES) return failed("A:spawnPool");
  return pool;
}

/**
 * Visits every tile the segment between the centres of tiles (ax, ay) and (bx, by) passes through, in order (integers only):
 * geometry.raycast's rule, so a segment through a tile vertex visits both tiles beside it. Stops early when `visit` returns true.
 */
function walkSegment(ax: number, ay: number, bx: number, by: number, visit: (x: number, y: number) => boolean): boolean {
  const nx = Math.abs(bx - ax), ny = Math.abs(by - ay);
  const sx = bx > ax ? 1 : -1, sy = by > ay ? 1 : -1;
  let x = ax, y = ay;
  if (visit(x, y)) return true;
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    // Compare (0.5 + ix) / nx with (0.5 + iy) / ny: which grid line the segment crosses next.
    const d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (d === 0) {
      // Through a vertex: both tiles beside it count, then the diagonal one.
      if (visit(x + sx, y) || visit(x, y + sy)) return true;
      x += sx; y += sy; ix++; iy++;
    } else if (d < 0) { x += sx; ix++; } else { y += sy; iy++; }
    if (visit(x, y)) return true;
  }
  return false;
}

/**
 * The spawn walk gate (contract 2.3): each member's findPath walk to the coliseum centre; members whose walk crosses more than
 * HAZARD_WALK_MAX floor-hazard tiles go first, then the extreme member whose removal leaves the smaller max/min (ties: the longer
 * walk, then the higher tile index) while the ratio is over SPAWN_WALK_RATIO_MAX and more than POOL_MIN are left. The kept members
 * (in pick order) and their walks, or null when the gate fails the attempt.
 */
function spawnGate(tiles: Uint8Array, pool: readonly number[], terrain: Uint8Array, zone: Uint8Array): { pool: number[]; walks: number[] } | null {
  const view = mapFromTiles(W, H, tiles);
  const centre = toWorld({ x: CX, y: CY });
  const walks: number[] = [], hazards: number[] = [];
  const seen = new Uint8Array(N);
  for (const t of pool) {
    const from = toWorld(tp(t));
    const path = findPath(view, from, centre, PLAYER_RADIUS);
    if (path.length === 0) return failed("A:spawnWalk");
    walks.push(pathLength(from, path));
    // Floor-hazard tiles (ember, bog, ice; light is no hazard) under the walk's polyline, each counted once.
    let hz = 0;
    const marked: number[] = [];
    let ax = t % W, ay = (t - (t % W)) / W;
    for (const p of path) {
      const bx = Math.floor(p.x / TILE), by = Math.floor(p.y / TILE);
      walkSegment(ax, ay, bx, by, (x, y) => {
        const i = y * W + x;
        if (seen[i]) return false;
        seen[i] = 1;
        marked.push(i);
        const k = terrain[i];
        if (k === TERRAIN_EMBER || k === TERRAIN_BOG || k === TERRAIN_ICE) hz++;
        return false;
      });
      ax = bx; ay = by;
    }
    for (const i of marked) seen[i] = 0;
    hazards.push(hz);
  }
  let keep: number[] = [];
  for (let k = 0; k < pool.length; k++) if (hazards[k] <= HAZARD_WALK_MAX) keep.push(k);
  if (keep.length < pool.length) note("spawnHazardDrop", pool.length - keep.length);
  const byWalk = (a: number, b: number): number => walks[a] - walks[b] || pool[a] - pool[b];
  for (;;) {
    if (keep.length === 0) return failed("A:spawnRatio");
    const s = keep.slice().sort(byWalk);
    const min = walks[s[0]], max = walks[s[s.length - 1]];
    if (max <= SPAWN_WALK_RATIO_MAX * min) break;
    if (keep.length <= POOL_MIN) { note("gate:ratioShort"); return failed("A:spawnRatio"); }
    // The longest walk (the highest tile among equal walks) or the shortest (likewise): whichever leaves the smaller ratio.
    const longest = s[s.length - 1];
    let shortest = s[0];
    for (let k = 1; k < s.length && walks[s[k]] === min; k++) shortest = s[k];
    const withoutLongest = walks[s[s.length - 2]] / min;
    const secondShortest = walks[s[0] === shortest ? s[1] : s[0]];
    const withoutShortest = max / secondShortest;
    const drop = withoutLongest <= withoutShortest ? longest : shortest;
    keep = keep.filter((k) => k !== drop);
    note("spawnRatioDrop");
  }
  if (keep.length < POOL_MIN || new Set(keep.map((k) => zone[pool[k]])).size < POOL_ZONES) { note("gate:hazardShort"); return failed("A:spawnRatio"); }
  return { pool: keep.map((k) => pool[k]), walks: keep.map((k) => walks[k]) };
}

/**
 * The shape gates on the finished map (contract 2.1 stage 13): every zone WALL or LOW tile owned (`A:unowned`), no 8-connected piece of
 * a zone's WALL tiles under 6 tiles (`A:wallPiece`). The reason a map fails, or null.
 */
function shapeGateFailure(map: GameMap, zone: Uint8Array): string | null {
  const { tiles, featureGrid } = map;
  for (let i = 0; i < N; i++) if (zone[i] && tiles[i] !== TILE_FLOOR && featureGrid[i] === 0) return "A:unowned";
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s] || !zone[s] || tiles[s] !== TILE_WALL) continue;
    const z = zone[s];
    let head = 0, tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W, y = (i - x) / W;
      for (let q = 0; q < 8; q++) {
        const nx = x + RING_DX[q], ny = y + RING_DY[q];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && zone[j] === z && tiles[j] === TILE_WALL) { seen[j] = 1; queue[tail++] = j; }
      }
    }
    if (tail < 6) return "A:wallPiece";
  }
  return null;
}

/** The finished map's records, in contract order: camps by REGION_FACTIONS then index, territoryGrid and features renumbered to match. */
function records(
  seed: number, attempt: number, tiles: Uint8Array, terrain: Uint8Array, props: MapProp[], regionGrid: Uint8Array, zone: Uint8Array, territoryGrid: Uint8Array,
  order: readonly RegionFaction[], camps: readonly CampSite[], reach2: Int32Array, pool: readonly number[], cratesByZone: readonly number[][],
  landmarkBox: Uint8Array, buildings: TileRect[], groundSpots: Vec2[], drafts: readonly FeatureDraft[], featureOwner: Uint16Array,
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

  // A zone's pole: its walkable tile outside landmark boxes farthest (5/7 chamfer) from every other zone, the border and the
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
      if (mask[t] && tiles[t] === TILE_FLOOR && !landmarkBox[t] && dt[t] > best) { best = dt[t]; pole = t; }
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

  // Features (contract 2.5): by zone in REGION_FACTIONS order; within a zone in log order (landmarks, then the shape pass), its infill
  // last. Each one's tiles and box are counted from the final ownership; a crater names its camp by contract index, a mere its ICE.
  const rank = (d: FeatureDraft): number => REGION_FACTIONS.indexOf(d.zone) * 2 + (d.kind === "infill" ? 1 : 0);
  const sorted = drafts.map((_, k) => k).sort((a, b) => rank(drafts[a]) - rank(drafts[b]) || a - b);
  const newId = new Int32Array(drafts.length + 1);
  sorted.forEach((k, n) => { newId[k + 1] = n + 1; });
  const featureGrid = new Uint8Array(N);
  const count = new Int32Array(drafts.length + 1), ice = new Int32Array(drafts.length + 1);
  const bx0 = new Int32Array(drafts.length + 1).fill(W), by0 = new Int32Array(drafts.length + 1).fill(H);
  const bx1 = new Int32Array(drafts.length + 1).fill(-1), by1 = new Int32Array(drafts.length + 1).fill(-1);
  for (let i = 0; i < N; i++) {
    const o = featureOwner[i];
    if (o === 0) continue;
    const id = newId[o];
    featureGrid[i] = id;
    count[id]++;
    if (terrain[i] === TERRAIN_ICE) ice[id]++;
    const x = i % W, y = (i - x) / W;
    if (x < bx0[id]) bx0[id] = x;
    if (x > bx1[id]) bx1[id] = x;
    if (y < by0[id]) by0[id] = y;
    if (y > by1[id]) by1[id] = y;
  }
  const features: MapFeature[] = sorted.map((k, n) => {
    const d = drafts[k], id = n + 1;
    const p = d.p.slice();
    if (d.kind === "crater" && p.length > 0 && p[0] >= 0 && p[0] < camps.length) p[0] = renumber[p[0] + 1] - 1;
    if (d.kind === "mere" && p.length > 1) p[1] = ice[id];
    const bbox = count[id] > 0 ? { x: bx0[id], y: by0[id], w: bx1[id] - bx0[id] + 1, h: by1[id] - by0[id] + 1 } : { x: d.ax, y: d.ay, w: 0, h: 0 };
    return { kind: d.kind, variant: d.variant, zone: d.zone, jobs: d.jobs.slice(), ax: d.ax, ay: d.ay, p, bbox, tiles: count[id] };
  });
  return {
    seed, w: W, h: H, tiles, terrain, props, regionGrid, attempt, territoryGrid, coliseum, regions, camps: campDefs, spawnPool, buildings,
    spawns, crateSpots: regions.flatMap((r) => r.chestSpots.map((p) => ({ x: p.x, y: p.y }))), groundSpots, features, featureGrid,
  };
}

/**
 * A 32-bit FNV-1a hash of every gameplay layer of a map (tiles, terrain, regionGrid, territoryGrid, camps, spawn pool,
 * regions, landmark boxes, loot spots, features and featureGrid, the seed and attempt), as 8 hex digits: two sides that agree on it
 * built the same map. Props are left out: they are cosmetic, and the server builds with `decor: false`.
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
  bytes(map.featureGrid);
  num(map.features.length);
  for (const f of map.features) {
    str(f.kind); str(f.variant); str(f.zone);
    num(f.jobs.length); for (const j of f.jobs) str(j);
    num(f.ax); num(f.ay);
    num(f.p.length); for (const v of f.p) num(v);
    num(f.bbox.x); num(f.bbox.y); num(f.bbox.w); num(f.bbox.h);
    num(f.tiles);
  }
  vecs(map.spawns); vecs(map.crateSpots); vecs(map.groundSpots);
  return h.toString(16).padStart(8, "0");
}
