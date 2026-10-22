// Procedural map. Client and server both call generateMap(seed) and must get identical output, so
// every random decision goes through mulberry32 in a fixed order. Do not reorder rng calls casually:
// it changes every seed's map.
import { EXTRACT_RADIUS, MAP_TILES_H, MAP_TILES_W } from "./constants";
import { TILE_FLOOR, TILE_WALL, tileToWorldCenter } from "./map";
import type { ExtractZoneDef, GameMap, TileRect } from "./map";
import type { Vec2 } from "./messages";
import { mulberry32, pick, randInt, shuffle } from "./rng";
import type { Rng } from "./rng";

const W = MAP_TILES_W;
const H = MAP_TILES_H;

/** Open tiles between the border ring and any building or obstacle. */
const EDGE_CLEAR = 3;
/** Open tiles between two buildings. */
const BUILDING_GAP = 2;
const SPAWN_COUNT = 12;
const EXTRACT_NAMES = ["North Gate", "East Docks", "South Tunnel", "West Road"] as const;

interface TilePt { x: number; y: number }

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

/**
 * Extract sites go down first so buildings and obstacles can keep clear of them. Centres sit on the
 * 4th or 5th tile in from the edge (3.5 / 4.5 tiles), so the 5x5 clear patch stays inside the open
 * strip between border and buildings.
 */
function placeExtractSites(rng: Rng): { tile: TilePt; edge: number }[] {
  const edges = shuffle(rng, [0, 1, 2, 3]).slice(0, 3);
  return edges.map((edge) => {
    const depth = randInt(rng, 3, 5);
    const along = randInt(rng, 12, W - 12);
    const tile =
      edge === 0 ? { x: along, y: depth } :
      edge === 1 ? { x: W - 1 - depth, y: along } :
      edge === 2 ? { x: along, y: H - 1 - depth } :
      { x: depth, y: along };
    return { tile, edge };
  });
}

function placeBuildings(rng: Rng, keepOut: TileRect[]): TileRect[] {
  const rects: TileRect[] = [];
  const target = randInt(rng, 8, 13);
  const fits = (r: TileRect) => {
    for (const k of keepOut) if (overlaps(r, k, 0)) return false;
    for (const b of rects) if (overlaps(r, b, BUILDING_GAP)) return false;
    return true;
  };
  // Late attempts shrink the size range so we always reach the minimum count.
  for (let attempt = 0; attempt < 6000 && rects.length < target; attempt++) {
    const maxExcl = attempt < 2500 ? 14 : 10;
    const w = randInt(rng, 7, maxExcl);
    const h = randInt(rng, 7, maxExcl);
    const r = {
      x: randInt(rng, EDGE_CLEAR + 1, W - EDGE_CLEAR - w),
      y: randInt(rng, EDGE_CLEAR + 1, H - EDGE_CLEAR - h),
      w,
      h,
    };
    if (fits(r)) rects.push(r);
  }
  // Deterministic scan as a last resort (never hit in practice, kept so the 8-building floor is a guarantee).
  for (let y = EDGE_CLEAR + 1; y + 7 <= H - EDGE_CLEAR - 1 && rects.length < 8; y++) {
    for (let x = EDGE_CLEAR + 1; x + 7 <= W - EDGE_CLEAR - 1 && rects.length < 8; x++) {
      const r = { x, y, w: 7, h: 7 };
      if (fits(r)) rects.push(r);
    }
  }
  return rects;
}

/**
 * Walls, 1-3 two-wide doors on distinct sides (never touching a corner) and 0-2 partitions.
 * Returns every gap tile (doors and partition gaps) so crates can stay out of the way.
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

function placeObstacles(tiles: Uint8Array, rng: Rng, buildings: TileRect[], keepOut: TileRect[]): void {
  const placed: TileRect[] = [];
  const target = randInt(rng, 15, 31);
  for (let attempt = 0; attempt < 6000 && placed.length < target; attempt++) {
    const a = randInt(rng, 1, 3);
    const b = randInt(rng, 1, 4);
    const flip = rng() < 0.5;
    const w = flip ? b : a;
    const h = flip ? a : b;
    const r = {
      x: randInt(rng, EDGE_CLEAR + 1, W - EDGE_CLEAR - w),
      y: randInt(rng, EDGE_CLEAR + 1, H - EDGE_CLEAR - h),
      w,
      h,
    };
    // One tile of air around every chunk keeps it from touching buildings or other chunks.
    if (buildings.some((o) => overlaps(r, o, 1))) continue;
    if (placed.some((o) => overlaps(r, o, 1))) continue;
    if (keepOut.some((o) => overlaps(r, o, 0))) continue;
    placed.push(r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) tiles[y * W + x] = TILE_WALL;
  }
}

/** Anything not 4-connected to the seed tile becomes wall. */
function enforceConnectivity(tiles: Uint8Array, seedTile: TilePt): void {
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  const start = seedTile.y * W + seedTile.x;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0) visit(i - W);
    if (y < H - 1) visit(i + W);
  }
  function visit(j: number): void {
    if (seen[j] || tiles[j] !== TILE_FLOOR) return;
    seen[j] = 1;
    queue[tail++] = j;
  }
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === TILE_FLOOR && !seen[i]) tiles[i] = TILE_WALL;
}

function pickSpawns(
  rng: Rng, tiles: Uint8Array, indoor: Uint8Array, extractTiles: TilePt[],
): TilePt[] {
  const collect = (minExtractDist: number): TilePt[] => {
    const out: TilePt[] = [];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (indoor[y * W + x]) continue;
        let open = true;
        for (let j = -1; j <= 1 && open; j++) {
          for (let i = -1; i <= 1; i++) {
            if (tiles[(y + j) * W + x + i] !== TILE_FLOOR) { open = false; break; }
          }
        }
        if (!open) continue;
        if (extractTiles.some((e) => (e.x - x) ** 2 + (e.y - y) ** 2 < minExtractDist ** 2)) continue;
        out.push({ x, y });
      }
    }
    return out;
  };
  // Keep spawns out of extract zones so nobody starts next to an exit.
  let cands = collect(8);
  if (cands.length < SPAWN_COUNT) cands = collect(0);

  // Farthest-point sampling: first point random, then always the candidate farthest from the chosen set.
  const chosen: TilePt[] = [cands[randInt(rng, 0, cands.length)]];
  const minD2 = new Float64Array(cands.length).fill(Infinity);
  while (chosen.length < SPAWN_COUNT) {
    const last = chosen[chosen.length - 1];
    let best = -1, bestD = -1;
    for (let i = 0; i < cands.length; i++) {
      const d = (cands[i].x - last.x) ** 2 + (cands[i].y - last.y) ** 2;
      if (d < minD2[i]) minD2[i] = d;
      if (minD2[i] > bestD) { bestD = minD2[i]; best = i; }
    }
    chosen.push(cands[best]);
  }
  return chosen;
}

function pickCrateSpots(rng: Rng, tiles: Uint8Array, r: TileRect, gaps: readonly TilePt[]): TilePt[] {
  const cands: TilePt[] = [];
  for (let y = r.y + 1; y <= r.y + r.h - 2; y++) {
    for (let x = r.x + 1; x <= r.x + r.w - 2; x++) {
      if (tiles[y * W + x] !== TILE_FLOOR) continue;
      const againstWall =
        tiles[y * W + x - 1] === TILE_WALL || tiles[y * W + x + 1] === TILE_WALL ||
        tiles[(y - 1) * W + x] === TILE_WALL || tiles[(y + 1) * W + x] === TILE_WALL;
      if (againstWall && !nearAny(gaps, x, y)) cands.push({ x, y });
    }
  }
  shuffle(rng, cands);
  const want = randInt(rng, 2, 5);
  const chosen: TilePt[] = [];
  // Prefer spots that are not adjacent to each other; top up from the rest if the room is tight.
  for (const c of cands) {
    if (chosen.length >= want) break;
    if (chosen.every((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.y - c.y)) >= 2)) chosen.push(c);
  }
  for (const c of cands) {
    if (chosen.length >= want) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return chosen;
}

function pickGroundSpots(
  rng: Rng, tiles: Uint8Array, indoor: Uint8Array, spawns: TilePt[],
): TilePt[] {
  const cands: TilePt[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (tiles[y * W + x] !== TILE_FLOOR || indoor[y * W + x]) continue;
      if (spawns.some((s) => Math.max(Math.abs(s.x - x), Math.abs(s.y - y)) < 3)) continue;
      cands.push({ x, y });
    }
  }
  shuffle(rng, cands);
  const want = randInt(rng, 20, 31);
  const chosen: TilePt[] = [];
  for (const minSep of [4, 2, 1]) {
    for (const c of cands) {
      if (chosen.length >= want) break;
      if (chosen.includes(c)) continue;
      if (chosen.every((o) => (o.x - c.x) ** 2 + (o.y - c.y) ** 2 >= minSep * minSep)) chosen.push(c);
    }
  }
  return chosen;
}

const toWorld = (p: TilePt): Vec2 => ({ x: tileToWorldCenter(p.x), y: tileToWorldCenter(p.y) });

export function generateMap(seed: number): GameMap {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(W * H).fill(TILE_FLOOR);
  for (let x = 0; x < W; x++) {
    tiles[x] = TILE_WALL;
    tiles[(H - 1) * W + x] = TILE_WALL;
  }
  for (let y = 0; y < H; y++) {
    tiles[y * W] = TILE_WALL;
    tiles[y * W + W - 1] = TILE_WALL;
  }

  const sites = placeExtractSites(rng);
  const buildingKeepOut = sites.map((s) => ({ x: s.tile.x - 4, y: s.tile.y - 4, w: 9, h: 9 }));
  const obstacleKeepOut = sites.map((s) => ({ x: s.tile.x - 3, y: s.tile.y - 3, w: 7, h: 7 }));

  const buildings = placeBuildings(rng, buildingKeepOut);
  const gapsPerBuilding = buildings.map((b) => carveBuilding(tiles, rng, b));
  placeObstacles(tiles, rng, buildings, obstacleKeepOut);

  // Safety net: the extract patch must be open even if the keep-out logic is ever changed.
  for (const s of sites) {
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) tiles[(s.tile.y + j) * W + s.tile.x + i] = TILE_FLOOR;
  }
  enforceConnectivity(tiles, sites[0].tile);

  const indoor = new Uint8Array(W * H);
  for (const b of buildings) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) indoor[y * W + x] = 1;
  }

  const spawnTiles = pickSpawns(rng, tiles, indoor, sites.map((s) => s.tile));
  const crateSpots: Vec2[] = [];
  buildings.forEach((b, i) => {
    for (const p of pickCrateSpots(rng, tiles, b, gapsPerBuilding[i])) crateSpots.push(toWorld(p));
  });
  const groundSpots = pickGroundSpots(rng, tiles, indoor, spawnTiles).map(toWorld);

  const extracts: ExtractZoneDef[] = sites.map((s, i) => ({
    id: `x${i + 1}`,
    name: EXTRACT_NAMES[s.edge],
    ...toWorld(s.tile),
    r: EXTRACT_RADIUS,
  }));

  return {
    seed,
    w: W,
    h: H,
    tiles,
    buildings,
    spawns: spawnTiles.map(toWorld),
    extracts,
    crateSpots,
    groundSpots,
  };
}
