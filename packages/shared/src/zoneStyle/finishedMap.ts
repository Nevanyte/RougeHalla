// DEV ADAPTER (retired when the zone generator's own styler hook lands): applies the zone stylers to a FINISHED wedge map, after
// cover. Sound by construction: it only turns FLOOR into WALL or LOW (never opens a wall), a LOW tile leaves every sight lane
// unchanged (LOW is open for sight) and a wall only cuts lanes, so the certified 480 u bound, the spawn screens and the
// single floor component all survive; everything the generator keeps clear is protected.
import { TILE } from "../constants";
import { walkDistances } from "../gridTopology";
import {
  REGION_COLISEUM, REGION_FACTIONS, TILE_FLOOR, TILE_LOW, TILE_WALL, tileToWorldCenter, worldToTile,
} from "../map";
import type { GameMap, RegionFaction, TilePt, TileRect } from "../map";
import {
  TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT,
} from "../terrain";
import { styleZones } from "./styleZones";
import { longestRunOf } from "./kit";
import type { StyleOptions, StyleResult } from "./types";

/** mapgen.ts RING_ROAD: tiles kept clear around the coliseum footprint (Chebyshev), the obstacle pass keeps one more. */
export const RING_ROAD_TILES = 3;

export interface FinishedMapOptions extends StyleOptions {
  /**
   * Protect one shortest walk from every spawn and camp centre to the coliseum centre (with the corner tiles of its diagonal
   * steps), so no spawn's or camp's walk gets longer (the contract's "walk guards"). On unless set to false.
   */
  guardWalks?: boolean;
}

/**
 * The tiles of one shortest walk (8-connected, no corner cutting) from each spawn and camp centre to the coliseum centre, corner
 * tiles of the diagonal steps included: kept open, they keep those walking distances exactly as the generator made them.
 */
export function walkGuardTiles(map: GameMap): Uint8Array {
  const { w, h, tiles } = map;
  const out = new Uint8Array(w * h);
  const centre = worldToTile(map.coliseum.centre.y) * w + worldToTile(map.coliseum.centre.x);
  const dist = walkDistances(tiles, w, h, centre);
  const NB: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  for (const sp of [...map.spawns, ...map.camps]) {
    let i = worldToTile(sp.y) * w + worldToTile(sp.x);
    if (dist[i] < 0) continue;
    out[i] = 1;
    for (let guard = 0; dist[i] > 0 && guard < w * h; guard++) {
      const x = i % w, y = (i - x) / w;
      let next = -1;
      for (let q = 0; q < 8 && next < 0; q++) {
        const nx = x + NB[q][0], ny = y + NB[q][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const diagonal = (q & 1) === 1;
        if (dist[j] < 0 || dist[j] + (diagonal ? 7 : 5) !== dist[i]) continue;
        if (diagonal && (tiles[y * w + nx] !== TILE_FLOOR || tiles[ny * w + x] !== TILE_FLOOR)) continue;
        next = j;
        if (diagonal) { out[y * w + nx] = 1; out[ny * w + x] = 1; }
      }
      if (next < 0) break;
      i = next;
      out[i] = 1;
    }
  }
  return out;
}

export interface FinishedProtect {
  /** Nothing is written here: no blocker, no hazard. */
  protect: Uint8Array;
  /** 1 = the band past the ring road (no blocker; LIGHT may stand there); 2 = a ruin's ring or a ridge pass (no blocker; any floor hazard may). */
  noBlock: Uint8Array;
}

/** Marks the (2r+1)-square of tiles around (cx, cy) in `out`, clipped to the grid. */
function markSquare(out: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) out[y * w + x] = 1;
}

function markRect(out: Uint8Array, w: number, h: number, r: TileRect, grow: number): void {
  for (let y = Math.max(0, r.y - grow); y < Math.min(h, r.y + r.h + grow); y++) for (let x = Math.max(0, r.x - grow); x < Math.min(w, r.x + r.w + grow); x++) out[y * w + x] = 1;
}

/**
 * The tiles of a finished wedge map the stylers may not write. `protect` (nothing at all): the border; the coliseum footprint,
 * its rect and gates; the ring road; every spawn 5x5, chest and ground-loot spot 3x3, camp clearing + 1 halo, camp spot and
 * region anchor; inner spawns; extract patches 5x5; the ruins themselves. `noBlock` (no wall or LOW, hazards by value): the
 * obstacle pass's band past the ring road (1: LIGHT only), the ring of 1 around each ruin and the floor within 2 tiles of a
 * region boundary, the ridge passes (2: any floor hazard). Together that is the protect list of the roguelike hook plus the
 * passes; the split only keeps hazards (which need no clear ground to stay safe) off less of the zone.
 */
export function finishedMapProtect(map: GameMap): FinishedProtect {
  const { w, h, regionGrid } = map;
  const n = w * h;
  const protect = new Uint8Array(n), noBlock = new Uint8Array(n);
  for (let x = 0; x < w; x++) { protect[x] = 1; protect[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { protect[y * w] = 1; protect[y * w + w - 1] = 1; }
  // the coliseum: footprint, rect, gates; then the ring road by Chebyshev distance
  const dist = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (regionGrid[i] === REGION_COLISEUM) { dist[i] = 0; queue[tail++] = i; protect[i] = 1; }
  markRect(protect, w, h, map.coliseum.rect, 0);
  for (const g of map.coliseum.gates) for (const t of g.tiles) protect[t.y * w + t.x] = 1;
  while (head < tail) {
    const i = queue[head++];
    if (dist[i] > RING_ROAD_TILES) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dist[j] === 255) { dist[j] = dist[i] + 1; queue[tail++] = j; }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (dist[i] > 0 && dist[i] <= RING_ROAD_TILES) protect[i] = 1;
    else if (dist[i] === RING_ROAD_TILES + 1) noBlock[i] = 1;
  }
  const margin = new Uint8Array(n);
  const tileOf = (p: { x: number; y: number }): TilePt => ({ x: worldToTile(p.x), y: worldToTile(p.y) });
  const square = (p: { x: number; y: number }, r: number): void => { const t = tileOf(p); markSquare(protect, w, h, t.x, t.y, r); };
  for (const p of map.spawns) square(p, 2);
  for (const p of map.spawnPool) square(p, 2);
  for (const reg of map.regions) {
    for (const p of reg.spawns) square(p, 2);
    for (const p of reg.chestSpots) square(p, 1);
    square(reg.anchor, 1);
    square(reg.pole, 1);
  }
  for (const p of map.crateSpots) square(p, 1);
  for (const p of map.groundSpots) square(p, 1);
  for (const p of map.coliseum.innerSpawns) square(p, 1);
  for (const e of map.extracts) square(e, 2);
  // camp clearings (tiles whose centre lies within r of the camp) grown by one tile, with their spots and chests
  const clearing = new Uint8Array(n);
  const camps = [...map.camps, ...map.regions.flatMap((r) => r.mobCamps)];
  for (const camp of camps) {
    const cx = worldToTile(camp.x), cy = worldToTile(camp.y);
    const span = Math.ceil(camp.r / TILE) + 1;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const px = tileToWorldCenter(tx) - camp.x, py = tileToWorldCenter(ty) - camp.y;
        if (px * px + py * py <= camp.r * camp.r) clearing[ty * w + tx] = 1;
      }
    }
    for (const s of camp.spots) square(s, 1);
  }
  for (const c of map.camps) square(c.chest, 1);
  for (let i = 0; i < n; i++) {
    if (!clearing[i]) continue;
    markSquare(protect, w, h, i % w, (i - (i % w)) / w, 1);
  }
  for (const b of map.buildings) { markRect(protect, w, h, b, 0); markRect(margin, w, h, b, 1); }
  // the ridge passes: floor within 2 tiles of a region boundary
  const boundary: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, code = regionGrid[i];
      if ((x + 1 < w && regionGrid[i + 1] !== code) || (y + 1 < h && regionGrid[i + w] !== code)) boundary.push(i);
    }
  }
  for (const i of boundary) {
    const x = i % w, y = (i - x) / w;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && map.tiles[ny * w + nx] === TILE_FLOOR) margin[ny * w + nx] = 1;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (protect[i]) noBlock[i] = 0;
    else if (margin[i] && noBlock[i] === 0) noBlock[i] = 2;
  }
  return { protect, noBlock };
}

export interface FinishedStyling {
  map: GameMap;
  results: StyleResult[];
  /** The masks that were used (walk guards included). */
  protect: Uint8Array;
  noBlock: Uint8Array;
}

/** styleFinishedMap with the per-zone telemetry and the protect mask that was used. */
export function styleFinishedMapDetailed(map: GameMap, opts: FinishedMapOptions = {}): FinishedStyling {
  const { w, h } = map;
  const n = w * h;
  const tiles = map.tiles.slice();
  const terrain = map.terrain.slice();
  const props = map.props.slice();
  const zone = new Uint8Array(n);
  for (let i = 0; i < n; i++) zone[i] = map.regionGrid[i] >= 1 && map.regionGrid[i] <= REGION_FACTIONS.length ? map.regionGrid[i] : 0;
  const { protect, noBlock } = finishedMapProtect(map);
  if (opts.guardWalks !== false) {
    const guard = walkGuardTiles(map);
    for (let i = 0; i < n; i++) if (guard[i] && !protect[i] && noBlock[i] === 0) noBlock[i] = 2; // no wall or LOW; a hazard slows a walk, it does not lengthen it
  }
  const results = styleZones({
    w, h, seed: map.seed, attempt: map.attempt, tiles, terrain, props, zone, zoneFaction: REGION_FACTIONS, protect, noBlock,
    territory: null, camps: map.camps.map((c) => ({ site: worldToTile(c.y) * w + worldToTile(c.x), r: c.r / TILE, territory: 0 })),
    keepLow: new Uint8Array(n),
  }, opts);
  const area = new Array<number>(REGION_FACTIONS.length).fill(0);
  for (let i = 0; i < n; i++) if (tiles[i] === TILE_FLOOR && zone[i]) area[zone[i] - 1]++;
  const styled: GameMap = { ...map, tiles, terrain, props, regions: map.regions.map((r) => ({ ...r, area: area[REGION_FACTIONS.indexOf(r.id)] })) };
  return { map: styled, results, protect, noBlock };
}

/**
 * A NEW map: a finished wedge map (after cover) with the zone stylers applied. The zone grid is the region grid (codes 1..5 in
 * REGION_IDS order, which is REGION_FACTIONS order); every other tile is unpainted. `tiles`, `terrain` and `props` are fresh
 * arrays; the input is not mutated. Deterministic in (seed, attempt).
 */
export function styleFinishedMap(map: GameMap, opts: FinishedMapOptions = {}): GameMap {
  return styleFinishedMapDetailed(map, opts).map;
}

// ------------------------------------------------------------------------------------------------ report only
export interface ZoneFootprint {
  faction: RegionFaction;
  painted: number;
  floor: number;
  /** Tiles the styler turned into WALL (not counting pillars in LOW features) and into LOW. */
  walls: number;
  low: number;
  /** Floor kinds painted, by terrain id. */
  hazards: Record<number, number>;
  wallPct: number;
  lowPct: number;
  hazardPct: number;
  /** 0.35 x WALL + 1.0 x LOW as a share of the zone, in percent. */
  effectivePct: number;
  props: number;
}

export interface StyleReport {
  zones: ZoneFootprint[];
  /** Walk to the coliseum centre, styled over unstyled, per spawn. */
  spawnDetour: { max: number; mean: number; perSpawn: number[] };
  /** Longest straight WALL run of the styled map, in tiles. */
  longestWallRun: number;
  /** Longest straight run of LOW. */
  longestLowRun: number;
}

/** What a styling changed on a finished map (report only; nothing here gates anything). */
export function styleReport(before: GameMap, after: GameMap): StyleReport {
  const { w, h } = before;
  const n = w * h;
  const zones: ZoneFootprint[] = REGION_FACTIONS.map((faction, k) => {
    const code = k + 1;
    let painted = 0, floor = 0, walls = 0, low = 0, props = 0;
    const hazards: Record<number, number> = {};
    for (let i = 0; i < n; i++) {
      if (before.regionGrid[i] !== code) continue;
      painted++;
      if (after.tiles[i] === TILE_FLOOR) floor++;
      if (before.tiles[i] === TILE_FLOOR && after.tiles[i] === TILE_WALL) walls++;
      if (after.tiles[i] === TILE_LOW) low++;
      if (after.tiles[i] === TILE_FLOOR && after.terrain[i] !== 0) hazards[after.terrain[i]] = (hazards[after.terrain[i]] ?? 0) + 1;
    }
    for (const p of after.props) if (before.regionGrid[worldToTile(p.y) * w + worldToTile(p.x)] === code) props++;
    const haz = Object.values(hazards).reduce((a, b) => a + b, 0);
    return {
      faction, painted, floor, walls, low, hazards, props,
      wallPct: (100 * walls) / painted, lowPct: (100 * low) / painted, hazardPct: (100 * haz) / painted,
      effectivePct: (100 * (0.35 * walls + low)) / painted,
    };
  });
  const centre = worldToTile(before.coliseum.centre.y) * w + worldToTile(before.coliseum.centre.x);
  const d0 = walkDistances(before.tiles, w, h, centre), d1 = walkDistances(after.tiles, w, h, centre);
  const perSpawn: number[] = [];
  for (const p of before.spawns) {
    const i = worldToTile(p.y) * w + worldToTile(p.x);
    if (d0[i] > 0 && d1[i] > 0) perSpawn.push(d1[i] / d0[i]);
  }
  return {
    zones,
    spawnDetour: { max: Math.max(1, ...perSpawn), mean: perSpawn.reduce((a, b) => a + b, 0) / Math.max(1, perSpawn.length), perSpawn },
    longestWallRun: longestRunOf(after.tiles, w, h, TILE_WALL),
    longestLowRun: longestRunOf(after.tiles, w, h, TILE_LOW),
  };
}

export const TERRAIN_NAMES: Readonly<Record<number, string>> = {
  [TERRAIN_LAVA]: "lava", [TERRAIN_FENCE]: "fence", [TERRAIN_CREVASSE]: "crevasse", [TERRAIN_EMBER]: "ember", [TERRAIN_BOG]: "bog", [TERRAIN_ICE]: "ice", [TERRAIN_LIGHT]: "light",
};
