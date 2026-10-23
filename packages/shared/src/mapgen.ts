// Procedural map v2: five faction wedges around a walled coliseum. Client and server both call
// generateMap(seed) and must get identical output, so:
//  - every random decision goes through one mulberry32 stream in a fixed order;
//  - nothing here may call Math.sin/cos/atan2/hypot/pow/exp/log. Engines are free to differ in the last
//    bit of those, which could flip a tile on one side only. Only + - * / sqrt floor ceil abs min max are used
//    (detSin/detCos below are built from + - * / alone).
//
// rng call order (do not reorder casually, it changes every seed's map):
//   1 theta0, then per boundary k=0..4: jitter, amplitude, phase     2 faction shuffle
//   3 pillars (one draw: layout and transposition)                   4 passes (per boundary)
//   5 extract sites                                                  6 per sector: 1st ruin, camps (count, centres, spots), 2nd-ruin coin + ruin
//   8 carve each ruin
//   9 obstacles                                                      10 spawns per region (first pick)
//  11 chests per region (count, shuffle)
//  12 cover: one noise draw per tile (W*H, row-major), then one growth coin per rock
//  13 ground spots (shuffle of the open tiles, shuffle of the others when too few, count)
// A failed attempt (see MAX_ATTEMPTS) restarts the whole sequence on a derived seed.
import { EXTRACT_RADIUS, MAP_TILES_H, MAP_TILES_W, MAX_PLAYERS, MAX_SIGHT_CORRIDOR, SIGHT_CORRIDOR_WIDTH, TILE } from "./constants";
import {
  REGION_COLISEUM, REGION_FACTIONS, REGION_IDS, REGION_NONE, REGION_WEAPONS, TILE_FLOOR, TILE_WALL, regionCode, tileToWorldCenter, worldToTile,
} from "./map";
import type {
  ColiseumDef, ExtractZoneDef, FactionRegionDef, GameMap, GateDef, GateSide, MobCampDef, RegionFaction, RegionId,
  TilePt, TileRect,
} from "./map";
import type { Vec2 } from "./messages";
import { mulberry32, pick, randInt, randRange, shuffle } from "./rng";
import type { Rng } from "./rng";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const R0 = Math.min(W, H) / 2;
/** The corner shared by tiles CX-1 and CX; also the index of the centre tile. */
const CX = W / 2;
const CY = H / 2;

/** Open tiles between the border ring and any ruin, obstacle or camp. */
const EDGE_CLEAR = 3;
/** Open tiles between two ruins. */
const BUILDING_GAP = 2;
const SECTORS = REGION_FACTIONS.length;

const COL_HALF = 9;
const COL_CHAMFER = 13;
const GATE_W = 4;
const LANE_DEPTH = 3;
const RING_ROAD = 3;
const INNER_SPAWN_R = 5.5;

const RIDGE_START = 5;
const RIDGE_HALF = 1.0;
const PASS_HALF = 1.6;
const PASS_MIN_GAP = 8;
const LONG_RIDGE = 22;

const CAMP_R = 2.5;
const SPAWNS_PER_REGION = 3;
const SPAWN_SEPARATION = 5;
const SPAWN_BAND: readonly [number, number] = [0.62, 0.86];
/** Fairness: the farthest spawn is never more than this many times the nearest one's distance from the centre. */
const FAIR_RATIO = 1.45;
/** Camps avoid the spawn band widened by this many tiles on each side, when they can. */
const RIM_MARGIN = 3.5;
const RIM_LO2 = (SPAWN_BAND[0] * R0 - RIM_MARGIN) * (SPAWN_BAND[0] * R0 - RIM_MARGIN);
const RIM_HI2 = (SPAWN_BAND[1] * R0 + RIM_MARGIN) * (SPAWN_BAND[1] * R0 + RIM_MARGIN);
/** Two chests never touch, even in a short pool. */
const CHEST_MIN_GAP = 2;

/**
 * Anti-kiting cover. Lines of one direction are LANE_STEP apart in LANE_DIRS directions over [0, pi), and a lane is
 * the strip between two neighbouring lines where only open tiles (floor of a faction region) touch it. No lane
 * outside the coliseum may be longer than LANE_MAX tiles. Lines are half a SIGHT_CORRIDOR_WIDTH apart because any
 * straight corridor that wide, in a sampled direction, contains a whole strip; narrower slits do not count.
 */
const LANE_DIRS = 32;
const LANE_STEP = SIGHT_CORRIDOR_WIDTH / 2 / TILE;
const LANE_EPS = 1e-9;
const LANE_MAX = MAX_SIGHT_CORRIDOR / TILE;
/** A work-list entry is `strip * LANE_POS + the middle of a corridor on it, in 1/LANE_QUANT tiles`. */
const LANE_POS = 4096;
const LANE_QUANT = 4;
/** Distances along a line are measured from where it crosses the axis through the origin, so they can be negative. */
const LANE_BIAS = 128;
/** Most corridors on one strip that can be too long at once (a strip is under 91 tiles long and a corridor over LANE_MAX, with a blocked tile between two). */
const LANE_SLOTS = 10;
/** Ground loot uses tiles with floor on all eight sides unless fewer than this many are left. */
const GROUND_OPEN_MIN = 60;
/** At most this many rocks stand inside one ruin. */
const RUIN_ROCKS = 8;
/** Chance that a rock is two tiles long. */
const ROCK_GROW = 0.25;
/** A dead end of floor this small (tiles) is walled up together with the rock that seals it off. */
const POCKET_MAX = 30;
/** Score points a rock gives up per step away from the preferred layout (a tile that sits on one more long lane is worth 1024). */
const LEVEL_COST = 2048;
/** The same for standing on a soft-protected tile: more than any number of lanes a rock could cut, so it is a last resort. */
const SOFT_COST = 1 << 20;
const penalty = (lvl: number): number => (lvl >= 3 ? SOFT_COST : lvl * LEVEL_COST);
const EXTRACT_NAMES = ["North Gate", "East Docks", "South Tunnel", "West Road"] as const;

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** sin from + - * / only (Taylor after range reduction), so every JS engine agrees to the bit. */
function detSin(x: number): number {
  let y = x - Math.floor(x / TWO_PI + 0.5) * TWO_PI;
  if (y > HALF_PI) y = PI - y;
  else if (y < -HALF_PI) y = -PI - y;
  const y2 = y * y;
  return y * (1 + y2 * (-1 / 6 + y2 * (1 / 120 + y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 * (1 / 6227020800)))))));
}

function detCos(x: number): number {
  return detSin(x + HALF_PI);
}

/** Offsets of the tiles whose centre lies within CAMP_R of a camp centre, and that clearing grown by one tile. */
const CAMP_TILES: [number, number][] = [];
const CAMP_HALO: [number, number][] = [];
for (let j = -4; j <= 4; j++) {
  for (let i = -4; i <= 4; i++) {
    if (i * i + j * j <= CAMP_R * CAMP_R) CAMP_TILES.push([i, j]);
  }
}
for (let j = -4; j <= 4; j++) {
  for (let i = -4; i <= 4; i++) {
    if (CAMP_TILES.some(([a, b]) => Math.abs(a - i) <= 1 && Math.abs(b - j) <= 1)) CAMP_HALO.push([i, j]);
  }
}

const NB8: readonly [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const cheb = (a: TilePt, b: TilePt): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const d2 = (a: TilePt, b: TilePt): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const tileInRect = (b: TileRect, p: Vec2): boolean => {
  const x = worldToTile(p.x), y = worldToTile(p.y);
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
};
const toWorld = (p: TilePt): Vec2 => ({ x: tileToWorldCenter(p.x), y: tileToWorldCenter(p.y) });

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
 * Extract sites go down first so ruins and obstacles can keep clear of them. Centres sit on the
 * 4th or 5th tile in from the edge (3.5 / 4.5 tiles), so the 5x5 clear patch stays inside the open
 * strip between border and ruins.
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

/** Anything not 4-connected to the seed tile becomes wall. */
function enforceConnectivity(tiles: Uint8Array, seedTile: TilePt): void {
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
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

/**
 * Every line of the lane metric, as the tiles it crosses in order. The table depends only on the map size,
 * so it is built once, on first use, and shared by every generateMap call (it is never written afterwards).
 * Lines of one direction are stored in order of offset, so line l + 1 is the neighbour of line l when pairOK[l]:
 * the two bound one strip of the map, LANE_STEP wide.
 */
interface LaneTable {
  /** Line l crosses tile[lineStart[l] .. lineStart[l + 1]). */
  lineStart: Int32Array;
  tile: Uint16Array;
  /** Distance along line l at which it enters its p-th tile: edge[lineStart[l] + l + p]; entry n is the exit of the last tile. */
  edge: Float64Array;
  /** The same data indexed by tile: tile t is on line tileLine[q] at position tilePos[q] for q in [tileStart[t], tileStart[t + 1]). */
  tileStart: Int32Array;
  tileLine: Uint16Array;
  tilePos: Uint16Array;
  /** 1 when lines l and l + 1 are neighbours of one direction (the strip between them exists). */
  pairOK: Uint8Array;
}

let laneTable: LaneTable | null = null;

function getLaneTable(): LaneTable {
  if (laneTable) return laneTable;
  const capacity = LANE_DIRS * (4 * W * H + 1024);
  const tileBuf = new Uint16Array(capacity);
  const edgeBuf = new Float64Array(capacity + 16384);
  const starts: number[] = [], lineDir: number[] = [], lineOff: number[] = [];
  let c = 0;

  // One line: the points (px, py) + s * (dx, dy), dx >= 0, (dx, dy) a unit vector. The line is cut to the open
  // interior [1, W-1] x [1, H-1] (the border ring is never open) and walked tile by tile.
  const addLine = (px: number, py: number, dx: number, dy: number, k: number, j: number): void => {
    let sa = -Infinity, sb = Infinity;
    if (dx !== 0) {
      const s1 = (1 - px) / dx, s2 = (W - 1 - px) / dx;
      sa = Math.max(sa, Math.min(s1, s2)); sb = Math.min(sb, Math.max(s1, s2));
    } else if (px < 1 || px > W - 1) return;
    if (dy !== 0) {
      const s1 = (1 - py) / dy, s2 = (H - 1 - py) / dy;
      sa = Math.max(sa, Math.min(s1, s2)); sb = Math.min(sb, Math.max(s1, s2));
    } else if (py < 1 || py > H - 1) return;
    if (!(sb - sa > LANE_EPS)) return;

    // Walk the tile boundaries in order; between two of them the line stays inside one tile.
    let ix = 0, nextX = Infinity, iy = 0, nextY = Infinity;
    const ystep = dy > 0 ? 1 : -1;
    if (dx !== 0) { ix = Math.floor(px + sa * dx) + 1; nextX = (ix - px) / dx; }
    if (dy > 0) { iy = Math.floor(py + sa * dy) + 1; nextY = (iy - py) / dy; }
    else if (dy < 0) { iy = Math.ceil(py + sa * dy) - 1; nextY = (iy - py) / dy; }
    const line = starts.length;
    const first = c;
    let cur = sa, exit = sa;
    for (;;) {
      const nxt = Math.min(Math.min(nextX, nextY), sb);
      // A line that only grazes a tile (a corner, or an edge it runs along) does not cross it.
      if (nxt - cur >= LANE_EPS) {
        const mid = (cur + nxt) * 0.5;
        const tx = Math.floor(px + mid * dx), ty = Math.floor(py + mid * dy);
        if (tx >= 1 && ty >= 1 && tx < W - 1 && ty < H - 1) {
          tileBuf[c] = ty * W + tx;
          edgeBuf[c + line] = cur;
          c++;
          exit = nxt;
        }
      }
      if (nxt >= sb) break;
      cur = nxt;
      if (nextX <= cur) { ix++; nextX = (ix - px) / dx; }
      if (nextY <= cur) { iy += ystep; nextY = (iy - py) / dy; }
    }
    if (c === first) return;
    edgeBuf[c + line] = exit;
    starts.push(first);
    lineDir.push(k);
    lineOff.push(j);
  };

  for (let k = 0; k < LANE_DIRS; k++) {
    // Walk every line towards +x, so k > 16 uses the opposite direction; the set of lines is the same.
    let dx = 1, dy = 0;
    if (2 * k === LANE_DIRS) { dx = 0; dy = 1; } else if (k !== 0) {
      const a = (k * PI) / LANE_DIRS;
      dx = detCos(a); dy = detSin(a);
      if (2 * k > LANE_DIRS) { dx = -dx; dy = -dy; }
    }
    const nx = -dy, ny = dx;
    const c1 = nx + ny, c2 = nx * (W - 1) + ny, c3 = nx + ny * (H - 1), c4 = nx * (W - 1) + ny * (H - 1);
    const oMin = Math.min(Math.min(c1, c2), Math.min(c3, c4)), oMax = Math.max(Math.max(c1, c2), Math.max(c3, c4));
    const jHi = Math.floor(oMax / LANE_STEP);
    for (let j = Math.ceil(oMin / LANE_STEP); j <= jHi; j++) addLine(nx * j * LANE_STEP, ny * j * LANE_STEP, dx, dy, k, j);
  }
  const lines = starts.length;
  if (c > capacity || lines > 65535) throw new RangeError("lane table overflow");
  starts.push(c);

  const lineStart = Int32Array.from(starts);
  const tile = tileBuf.slice(0, c);
  const edge = edgeBuf.slice(0, c + lines);
  const tileStart = new Int32Array(N + 1);
  for (let q = 0; q < c; q++) tileStart[tile[q] + 1]++;
  for (let i = 0; i < N; i++) tileStart[i + 1] += tileStart[i];
  const fill = tileStart.slice(0, N);
  const tileLine = new Uint16Array(c), tilePos = new Uint16Array(c);
  for (let l = 0; l < lines; l++) {
    for (let q = lineStart[l]; q < lineStart[l + 1]; q++) {
      const at = fill[tile[q]]++;
      tileLine[at] = l;
      tilePos[at] = q - lineStart[l];
    }
  }
  const pairOK = new Uint8Array(lines);
  for (let l = 0; l + 1 < lines; l++) pairOK[l] = lineDir[l] === lineDir[l + 1] && lineOff[l + 1] === lineOff[l] + 1 ? 1 : 0;
  laneTable = { lineStart, tile, edge, tileStart, tileLine, tilePos, pairOK };
  return laneTable;
}

/** 1 where a tile is floor of a faction region: the tiles the lane metric walks. */
function openMask(tiles: Uint8Array, regionGrid: Uint8Array, out: Uint8Array, region = 0): Uint8Array {
  for (let i = 0; i < N; i++) {
    const r = regionGrid[i];
    out[i] = tiles[i] === TILE_FLOOR && (region === 0 ? r >= 1 && r <= SECTORS : r === region) ? 1 : 0;
  }
  return out;
}

/** The stretches of line l that run only through open tiles, as [from, to] distances along it. Returns how many. */
function openRuns(lt: LaneTable, open: Uint8Array, l: number, from: Float64Array, to: Float64Array): number {
  const { lineStart, tile, edge } = lt;
  const base = lineStart[l], n = lineStart[l + 1] - base, eb = base + l;
  let count = 0, a = -1;
  for (let p = 0; p <= n; p++) {
    if (p < n && open[tile[base + p]]) { if (a < 0) a = p; continue; }
    if (a >= 0) { from[count] = edge[eb + a]; to[count++] = edge[eb + p]; a = -1; }
  }
  return count;
}

/** The longest lane: a strip between two neighbouring lines with only open tiles in it, in tiles. */
function longestFatLane(open: Uint8Array): number {
  const lt = getLaneTable();
  const lines = lt.lineStart.length - 1;
  const pa = new Float64Array(128), pb = new Float64Array(128), ca = new Float64Array(128), cb = new Float64Array(128);
  let prevCount = openRuns(lt, open, 0, pa, pb), best = 0;
  for (let l = 1; l < lines; l++) {
    const count = openRuns(lt, open, l, ca, cb);
    if (lt.pairOK[l - 1]) {
      for (let i = 0, j = 0; i < prevCount && j < count;) {
        const a = Math.max(pa[i], ca[j]), b = Math.min(pb[i], cb[j]);
        if (b - a > best) best = b - a;
        if (pb[i] < cb[j]) i++; else j++;
      }
    }
    pa.set(ca.subarray(0, count)); pb.set(cb.subarray(0, count));
    prevCount = count;
  }
  return best;
}

/** Longest sight corridor in the faction regions, in world units. The generator keeps it at MAX_SIGHT_CORRIDOR or less. */
export function longestLane(map: GameMap, region: RegionId = "none"): number {
  if (map.w !== W || map.h !== H) throw new RangeError(`longestLane: expected a ${W}x${H} map`);
  return longestFatLane(openMask(map.tiles, map.regionGrid, new Uint8Array(N), region === "none" ? 0 : regionCode(region))) * TILE;
}

/**
 * The 3x3 neighbourhood of a tile as a cycle of 8 cells (N, NE, E, SE, S, SW, W, NW). SIMPLE[mask] says whether
 * turning the centre of a floor patch into wall keeps its 4-connected floor neighbours linked through the ring,
 * i.e. whether no corridor is cut and no pocket is sealed. Bit q of the mask is set when ring cell q is floor.
 */
const SIMPLE = new Uint8Array(256);
for (let m = 0; m < 256; m++) {
  let comp = 0;
  for (let q = 0; q < 8; q += 2) if ((m >> q) & 1) { comp = 1 << q; break; }
  for (let again = true; again;) {
    again = false;
    for (let q = 0; q < 8; q++) {
      if (!((comp >> q) & 1)) continue;
      for (const nb of [(q + 1) & 7, (q + 7) & 7]) {
        if (((m >> nb) & 1) && !((comp >> nb) & 1)) { comp |= 1 << nb; again = true; }
      }
    }
  }
  let ok = true;
  for (let q = 0; q < 8; q += 2) if (((m >> q) & 1) && !((comp >> q) & 1)) ok = false;
  SIMPLE[m] = ok ? 1 : 0;
}
const RING_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const RING_DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const RING_OFF = RING_DX.map((dx, q) => RING_DY[q] * W + dx);
const NB4 = [-W, 1, W, -1];

/**
 * Anti-kiting cover: drops rocks until no sight corridor is longer than LANE_MAX. A corridor is the strip between
 * two neighbouring lines of one direction with only open tiles in it; the strips that are too long are kept as
 * intervals along their line pair. Every long corridor is cut at the tile beside it that lies on the most long
 * corridors (noise breaks ties); the corridors the tile blocks are split in place, so a rock costs a few thousand
 * operations rather than a rescan of the map. A rock may go on a tile only if the floor around it stays
 * 4-connected (simple-point test) or the part it seals off is a small dead end with nothing to keep in it; such a
 * dead end is walled up with it. Preferences, tried in this order and relaxed only when nothing better is left:
 * rocks stay apart, soft-protected tiles stay open. `prot` marks the tiles no rock may take, `ring` the ring road,
 * whose floor must stay one piece that touches all five regions. Returns the number of rocks, or a negative number
 * when some corridor cannot be cut, which is mostly known before the first rock: a stretch of protected ground
 * longer than LANE_MAX has no tile to cut it on (the caller then tries another map).
 */
function placeCover(
  rng: Rng, tiles: Uint8Array, regionGrid: Uint8Array, prot: Uint8Array, soft: Uint8Array,
  ruinOf: Uint8Array, ruinQuota: number[], ruinBox: number[], ring: Uint8Array,
): number {
  const lt = getLaneTable();
  const { lineStart, tile, edge, tileStart, tileLine, tilePos, pairOK } = lt;
  const lines = lineStart.length - 1;
  const open = openMask(tiles, regionGrid, new Uint8Array(N));
  const noise = new Uint16Array(N);
  for (let i = 0; i < N; i++) noise[i] = Math.floor(rng() * 1024);
  const limit = LANE_MAX + LANE_EPS;

  // The floor a rock on t would cut off from the rest, when that is only small dead ends holding nothing to
  // keep (their tiles are left in `pocket`); false when it splits big pieces apart or a pocket holds something
  // protected.
  const mark = new Int32Array(N), bigMark = new Int32Array(N);
  let markNow = 0;
  const queue = new Int32Array(N);
  const pocket: number[] = [];
  const queueB = new Int32Array(N);
  // Whether floor tiles s and u are 4-connected (walls as they stand), by alternating breadth-first steps from each.
  const joins = (s: number, u: number): boolean => {
    const markA = ++markNow, markB = ++markNow;
    let headA = 0, tailA = 0, headB = 0, tailB = 0;
    queue[tailA++] = s; mark[s] = markA;
    queueB[tailB++] = u; mark[u] = markB;
    while (headA < tailA && headB < tailB) {
      const i = queue[headA++];
      for (let e = 0; e < 4; e++) {
        const j = i + NB4[e];
        if (tiles[j] !== TILE_FLOOR) continue;
        if (mark[j] === markB) return true;
        if (mark[j] !== markA) { mark[j] = markA; queue[tailA++] = j; }
      }
      const i2 = queueB[headB++];
      for (let e = 0; e < 4; e++) {
        const j = i2 + NB4[e];
        if (tiles[j] !== TILE_FLOOR) continue;
        if (mark[j] === markA) return true;
        if (mark[j] !== markB) { mark[j] = markB; queueB[tailB++] = j; }
      }
    }
    return false;
  };
  const sealed = (t: number): boolean => {
    pocket.length = 0;
    tiles[t] = TILE_WALL;
    const bigStart: number[] = [];
    let ok = true;
    markNow++;
    mark[t] = markNow;
    for (let d = 0; d < 4 && ok; d++) {
      const s = t + NB4[d];
      if (tiles[s] !== TILE_FLOOR || mark[s] === markNow) continue;
      let head = 0, tail = 0, small = true, joined = false;
      queue[tail++] = s;
      mark[s] = markNow;
      while (head < tail && !joined) {
        if (tail > POCKET_MAX) { small = false; break; }
        const i = queue[head++];
        for (let e = 0; e < 4; e++) {
          const j = i + NB4[e];
          if (tiles[j] !== TILE_FLOOR) continue;
          // A tile an earlier, capped walk already reached: this is the same big piece, not a new one.
          if (bigMark[j] === markNow) { joined = true; break; }
          if (mark[j] !== markNow) { mark[j] = markNow; queue[tail++] = j; }
        }
      }
      if (joined || !small) {
        for (let k = 0; k < tail; k++) bigMark[queue[k]] = markNow;
        if (!joined) bigStart.push(s);
        continue;
      }
      for (let k = 0; k < tail && ok; k++) if (!open[queue[k]] || prot[queue[k]] || soft[queue[k]] || ring[queue[k]] === 1) ok = false;
      if (ok) for (let k = 0; k < tail; k++) pocket.push(queue[k]);
    }
    // Hitting the cap on two sides does not say they are one piece: walk out from both until they meet or one
    // runs dry (the smaller piece bounds the work).
    for (let k = 1; ok && k < bigStart.length; k++) ok = joins(bigStart[0], bigStart[k]);
    tiles[t] = TILE_FLOOR;
    return ok && bigStart.length > 0;
  };

  // Tiles that can never take a rock: protected ones, and those whose rock would split the floor in the map as it
  // stands (a corridor between two walls). A corridor made only of them cannot be cut, whatever else is built.
  const dead = new Uint8Array(N);
  for (let t = 0; t < N; t++) {
    if (!open[t]) continue;
    if (prot[t] || (ruinOf[t] !== 0 && ruinQuota[ruinOf[t]] <= 0)) { dead[t] = 1; continue; }
    let mask = 0;
    for (let q = 0; q < 8; q++) if (tiles[t + RING_OFF[q]] === TILE_FLOOR) mask |= 1 << q;
    if (!SIMPLE[mask] && !sealed(t)) dead[t] = 1;
  }

  const hits = new Int32Array(N);
  const work: number[] = [];
  let longLanes = 0;
  const seen = new Int32Array(N);
  let seenNow = 0;
  // Long corridors, per strip s (between lines s and s + 1), as [from, to] distances along the lines.
  const slotCount = new Uint8Array(lines), slotA = new Float64Array(lines * LANE_SLOTS), slotZ = new Float64Array(lines * LANE_SLOTS);

  // First position on line l whose tile ends after distance a.
  const firstAfter = (l: number, a: number): number => {
    const base = lineStart[l], eb = base + l;
    let lo = 0, hi = lineStart[l + 1] - base;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (edge[eb + m + 1] > a) hi = m; else lo = m + 1;
    }
    return lo;
  };
  // Adds d to the hits of every tile that touches the corridor (a, b) of strip s, each once.
  const addHits = (s: number, a: number, b: number, d: number): void => {
    seenNow++;
    for (let l = s; l <= s + 1; l++) {
      const base = lineStart[l], n = lineStart[l + 1] - base, eb = base + l;
      for (let p = firstAfter(l, a); p < n && edge[eb + p] < b; p++) {
        const t = tile[base + p];
        if (seen[t] !== seenNow) { seen[t] = seenNow; hits[t] += d; }
      }
    }
  };
  const addLong = (s: number, a: number, b: number): void => {
    const c = slotCount[s];
    if (c >= LANE_SLOTS) throw new RangeError("too many long corridors on one strip");
    slotA[s * LANE_SLOTS + c] = a;
    slotZ[s * LANE_SLOTS + c] = b;
    slotCount[s] = c + 1;
    addHits(s, a, b, 1);
    longLanes++;
    work.push(s * LANE_POS + Math.floor(((a + b) * 0.5 + LANE_BIAS) * LANE_QUANT));
  };

  // Scratch runs for neighbouring lines.
  const rA = new Float64Array(128), rB = new Float64Array(128), cA = new Float64Array(128), cB = new Float64Array(128);

  // Open stretches of line after line; a strip's corridors are where the stretches of its two lines overlap.
  // Corridors with the fewest tiles a rock may stand on are cut first, while the map is still open.
  const firstSlack: number[] = [];
  {
    const dA = new Float64Array(16), dB = new Float64Array(16), eA = new Float64Array(16), eB = new Float64Array(16);
    let prevRuns = 0, prevDead = 0;
    for (let l = 0; l < lines; l++) {
      const base = lineStart[l], n = lineStart[l + 1] - base, eb = base + l;
      // open stretches, and stretches of dead tiles longer than a corridor may be
      let count = 0, a = -1, deadCount = 0, d0 = -1;
      for (let p = 0; p <= n; p++) {
        const t = p < n ? tile[base + p] : 0;
        const isOpen = p < n && open[t] === 1;
        if (isOpen) { if (a < 0) a = p; } else if (a >= 0) { cA[count] = edge[eb + a]; cB[count++] = edge[eb + p]; a = -1; }
        if (isOpen && dead[t] === 1) { if (d0 < 0) d0 = p; } else if (d0 >= 0) {
          if (edge[eb + p] - edge[eb + d0] > limit) {
            if (deadCount >= 16) return -1;
            eA[deadCount] = edge[eb + d0]; eB[deadCount++] = edge[eb + p];
          }
          d0 = -1;
        }
      }
      if (l > 0 && pairOK[l - 1] === 1) {
        // a stretch of dead tiles in both lines that overlaps for more than a corridor may be: no rock will ever cut it
        for (let i = 0, j = 0; i < prevDead && j < deadCount;) {
          if (Math.min(dB[i], eB[j]) - Math.max(dA[i], eA[j]) > limit) return -1;
          if (dB[i] < eB[j]) i++; else j++;
        }
        for (let i = 0, j = 0; i < prevRuns && j < count;) {
          const from = Math.max(rA[i], cA[j]), to = Math.min(rB[i], cB[j]);
          if (to - from > limit) {
            let slack = 0;
            for (let ll = l - 1; ll <= l; ll++) {
              const bs = lineStart[ll], ns = lineStart[ll + 1] - bs, es = bs + ll;
              for (let p = firstAfter(ll, from); p < ns && edge[es + p] < to; p++) if (open[tile[bs + p]] === 1 && dead[tile[bs + p]] === 0) slack++;
            }
            firstSlack.push(slack);
            addLong(l - 1, from, to);
          }
          if (rB[i] < cB[j]) i++; else j++;
        }
      }
      rA.set(cA.subarray(0, count)); rB.set(cB.subarray(0, count));
      dA.set(eA.subarray(0, deadCount)); dB.set(eB.subarray(0, deadCount));
      prevRuns = count;
      prevDead = deadCount;
    }
  }
  {
    // work is a stack: the corridors with the most slack go in first
    const top = W + H;
    const count = new Int32Array(top + 2), start = new Int32Array(top + 3);
    for (const k of firstSlack) count[Math.min(k, top + 1)]++;
    for (let k = top + 1; k >= 0; k--) start[k] = k === top + 1 ? 0 : start[k + 1] + count[k + 1];
    const order = work.slice();
    for (let i = 0; i < order.length; i++) work[start[Math.min(firstSlack[i], top + 1)]++] = order[i];
  }

  // Turns an open tile into wall: every long corridor its chord touches is split in two. The tile loses all its
  // hits, the pieces that are still too long keep theirs and go on the work list, and tiles that only touched a
  // piece that became short lose that hit.
  const wall = (x: number): void => {
    for (let q = tileStart[x]; q < tileStart[x + 1]; q++) {
      const l = tileLine[q], p = tilePos[q];
      const eb = lineStart[l] + l, e0 = edge[eb + p], e1 = edge[eb + p + 1];
      for (let side = 0; side < 2; side++) {
        const s = side === 0 ? l : l - 1;
        if (s < 0 || pairOK[s] === 0) continue;
        const sb = s * LANE_SLOTS;
        for (let k = 0; k < slotCount[s];) {
          const a = slotA[sb + k], b = slotZ[sb + k];
          if (a < e1 && b > e0) {
            const last = slotCount[s] - 1;
            slotA[sb + k] = slotA[sb + last];
            slotZ[sb + k] = slotZ[sb + last];
            slotCount[s] = last;
            longLanes--;
            addHits(s, a, b, -1);
            if (e0 - a > limit) addLong(s, a, e0);
            if (b - e1 > limit) addLong(s, e1, b);
          } else k++;
        }
      }
    }
    open[x] = 0;
  };

  const ringList: number[] = [];
  let ringFloor = 0;
  const ringMark = new Int32Array(N);
  let ringNow = 0;
  for (let i = 0; i < N; i++) if (ring[i]) { ringList.push(i); if (tiles[i] === TILE_FLOOR) ringFloor++; }
  // The ring road is the one corridor every region shares: it must stay a single piece touching all five.
  const ringKeeps = (t: number): boolean => {
    tiles[t] = TILE_WALL;
    let seed = -1;
    for (let q = 0; q < ringList.length; q++) if (tiles[ringList[q]] === TILE_FLOOR) { seed = ringList[q]; break; }
    let count = 0, seenRegions = 0;
    if (seed >= 0) {
      ringNow++;
      let head = 0, tail = 0;
      queue[tail++] = seed;
      ringMark[seed] = ringNow;
      while (head < tail) {
        const i = queue[head++];
        count++;
        seenRegions |= 1 << regionGrid[i];
        for (let d = 0; d < 4; d++) {
          const j = i + NB4[d];
          if (ring[j] === 1 && tiles[j] === TILE_FLOOR && ringMark[j] !== ringNow) { ringMark[j] = ringNow; queue[tail++] = j; }
        }
      }
    }
    tiles[t] = TILE_FLOOR;
    return count === ringFloor - 1 && seenRegions === ((1 << (SECTORS + 1)) - 2);
  };
  const ringBlocked = new Uint8Array(N);

  const rockOf = new Uint16Array(N);
  // How far a rock on t departs from the preferred layout: 0 = fine, 1 = touches another rock, 2 = also seals a
  // dead end, 3 = also stands on a soft-protected tile; NEVER = not allowed at all.
  const NEVER = 9;
  // `score` and `beat` let a tile that could not beat the best so far skip the expensive test of a dead end.
  const levelOf = (t: number, rock: number, worst: number, score = 0, beat = -Infinity): number => {
    if (!open[t] || prot[t] || ringBlocked[t] === 1) return NEVER;
    if (ruinOf[t] !== 0) {
      // Furniture only: no row or column of a ruin's interior is left with fewer than three floor tiles, which would
      // read as a partition.
      const rb = ruinOf[t] * 4, x = t % W, y = (t - x) / W;
      if (ruinQuota[ruinOf[t]] <= 0) return NEVER;
      let col = 0, row = 0;
      for (let yy = ruinBox[rb + 1]; yy <= ruinBox[rb + 3]; yy++) if (tiles[yy * W + x] === TILE_FLOOR) col++;
      for (let xx = ruinBox[rb]; xx <= ruinBox[rb + 2]; xx++) if (tiles[y * W + xx] === TILE_FLOOR) row++;
      if (col <= 3 || row <= 3) return NEVER;
    }
    let lvl = soft[t] ? 3 : 0, mask = 0;
    for (let q = 0; q < 8; q++) {
      const j = t + RING_OFF[q];
      const r = rockOf[j];
      if (r !== 0 && r !== rock && lvl < 1) lvl = 1;
      if (tiles[j] === TILE_FLOOR) mask |= 1 << q;
    }
    if (!SIMPLE[mask]) {
      if (lvl < 2) lvl = 2;
      if (lvl > worst || score - penalty(lvl) <= beat || !sealed(t)) return NEVER;
    }
    if (lvl > worst) return NEVER;
    if (ring[t] === 1 && !ringKeeps(t)) { ringBlocked[t] = 1; return NEVER; }
    return lvl;
  };
  const priority = (t: number): number => hits[t] * 1024 + noise[t];

  let rocks = 0;
  const setRock = (t: number): void => {
    tiles[t] = TILE_WALL;
    rockOf[t] = rocks;
    ruinQuota[ruinOf[t]]--;
    if (ring[t] === 1) ringFloor--;
    wall(t);
  };
  const place = (t: number, lvl: number): void => {
    rocks++;
    let fill: number[] = [];
    if (lvl >= 2) {
      let mask = 0;
      for (let q = 0; q < 8; q++) if (tiles[t + RING_OFF[q]] === TILE_FLOOR) mask |= 1 << q;
      if (!SIMPLE[mask] && sealed(t)) fill = pocket.slice();
    }
    setRock(t);
    for (const f of fill) setRock(f);
    // Sometimes the rock is two tiles long: the best neighbour that still keeps to the preferred layout.
    if (rng() < ROCK_GROW) {
      let next = -1, nextScore = 0;
      for (let d = 0; d < 4; d++) {
        const u = t + NB4[d];
        if (hits[u] <= 0) continue;
        const s = priority(u);
        if (s > nextScore && levelOf(u, rocks, 0) === 0) { next = u; nextScore = s; }
      }
      if (next >= 0) setRock(next);
    }
  };

  // The tiles that touch corridor (a, b) of strip s and may take a rock, best first by hits, into lane/score.
  const lane = new Int32Array(4 * (W + H)), score = new Int32Array(4 * (W + H));
  const gather = (s: number, a: number, b: number): number => {
    let n = 0;
    seenNow++;
    for (let l = s; l <= s + 1; l++) {
      const base = lineStart[l], len = lineStart[l + 1] - base, eb = base + l;
      for (let p = firstAfter(l, a); p < len && edge[eb + p] < b; p++) {
        const t = tile[base + p];
        if (seen[t] === seenNow) continue;
        seen[t] = seenNow;
        if (!prot[t] && open[t] === 1) { lane[n] = t; score[n] = priority(t); n++; }
      }
    }
    return n;
  };
  const findLong = (entry: number): number => {
    const s = (entry / LANE_POS) | 0, mid = (entry - s * LANE_POS + 0.5) / LANE_QUANT - LANE_BIAS;
    for (let k = 0; k < slotCount[s]; k++) if (slotA[s * LANE_SLOTS + k] <= mid + 0.25 && slotZ[s * LANE_SLOTS + k] >= mid - 0.25) return k;
    return -1;
  };
  const cut = (entry: number): boolean => {
    const s = (entry / LANE_POS) | 0, k = findLong(entry);
    if (k < 0) return true;
    const a = slotA[s * LANE_SLOTS + k], b = slotZ[s * LANE_SLOTS + k];
    const n = gather(s, a, b);
    // The best tile, looking at candidates from the most useful downwards until none can beat it.
    let best = -1, bestScore = -1e9, bestLvl = 0;
    for (;;) {
      let m = -1;
      for (let q = 0; q < n; q++) if (score[q] > -1e9 && (m < 0 || score[q] > score[m])) m = q;
      if (m < 0 || score[m] <= bestScore) break;
      const t = lane[m], sc = score[m];
      score[m] = -2e9;
      const lvl = levelOf(t, rocks + 1, 3, sc, bestScore);
      if (lvl === NEVER) continue;
      if (sc - penalty(lvl) > bestScore) { best = t; bestScore = sc - penalty(lvl); bestLvl = lvl; }
    }
    if (best >= 0) { place(best, bestLvl); return true; }
    return false;
  };

  while (work.length > 0) if (!cut(work.pop()!)) return -1;
  return longLanes === 0 ? rocks : -1;
}

interface Boundary { sin: number; cos: number; amp: number; phase: number }

/**
 * Wedges are random, so a rare layout cannot host everything the map promises (two camps and a ruin in a
 * squeezed wedge, three well-spaced spawns). Such a layout is thrown away and the generator runs again on a
 * derived stream; the result is still a pure function of `seed`. Nearly every seed is built first time.
 */
/**
 * The generator tiles of the coliseum's pillar layouts (see the pillar step of buildMap). Found offline by trying every
 * set of orbits (a tile and its three 90-degree turns about the centre) that keeps the arena clear where it must stay
 * clear: no one or two orbits cut every sight corridor in the sealed arena down to LANE_MAX, 28 sets of three do. The
 * sets come in pairs that are each other's transpose, so these 14 cover all of them once and the pillar step picks
 * one of the two orientations. The longest corridor left is 454 to 478 u.
 */
const PILLAR_LAYOUTS: readonly (readonly [number, number][])[] = [
  [[31, 28], [33, 29], [31, 30]],
  [[30, 28], [33, 29], [31, 30]],
  [[28, 28], [30, 29], [32, 30]],
  [[30, 28], [30, 29], [32, 30]],
  [[30, 28], [31, 29], [32, 30]],
  [[30, 28], [32, 29], [30, 30]],
  [[30, 28], [32, 29], [31, 30]],
  [[30, 28], [32, 29], [32, 30]],
  [[30, 28], [33, 29], [32, 30]],
  [[31, 28], [30, 29], [32, 29]],
  [[31, 28], [30, 29], [32, 30]],
  [[31, 28], [31, 29], [32, 30]],
  [[31, 28], [32, 29], [30, 30]],
  [[31, 28], [32, 29], [31, 30]],
];

/**
 * Camp centres of one region are at least CAMP_GAP tiles apart (CAMP_GAP_MIN on the last attempt of a map), and each
 * camp takes the widest spacing the wedge has room for up to CAMP_GAP_FAR. A camp and its halo are ground no rock may
 * take, so two camps closer than this form one stretch of protected ground longer than any lane may be, which the
 * cover pass cannot cut.
 */
const CAMP_GAP = 9;
const CAMP_GAP_MIN = 7;
const CAMP_GAP_FAR = 13;
const MAX_ATTEMPTS = 16;

export function generateMap(seed: number): GameMap {
  for (let attempt = 0; ; attempt++) {
    const map = buildMap(seed, attempt);
    if (map) return map;
  }
}

function buildMap(seed: number, attempt: number): GameMap | null {
  const last = attempt >= MAX_ATTEMPTS - 1;
  const rng = mulberry32(attempt === 0 ? seed : seed + attempt * 0x9e3779b1);
  const tiles = new Uint8Array(N).fill(TILE_FLOOR);
  const border = new Uint8Array(N);
  for (let x = 0; x < W; x++) { border[x] = 1; border[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { border[y * W] = 1; border[y * W + W - 1] = 1; }

  // --- Coliseum footprint, ring road ---------------------------------------------------------------
  const fp = new Uint8Array(N);
  let fx0 = W, fy0 = H, fx1 = -1, fy1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ax = Math.abs(x + 0.5 - CX), ay = Math.abs(y + 0.5 - CY);
      if (ax <= COL_HALF - 0.5 && ay <= COL_HALF - 0.5 && ax + ay <= COL_CHAMFER) {
        fp[y * W + x] = 1;
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y;
        if (y > fy1) fy1 = y;
      }
    }
  }
  const coRect: TileRect = { x: fx0, y: fy0, w: fx1 - fx0 + 1, h: fy1 - fy0 + 1 };

  // Chebyshev distance to the footprint, capped at 6 (breadth-first over 8-neighbours).
  const distFp = new Uint8Array(N).fill(255);
  const queue = new Int32Array(N);
  {
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) if (fp[i]) { distFp[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const dist = distFp[i];
      if (dist >= 6) continue;
      const x = i % W, y = (i - x) / W;
      for (const [ox, oy] of NB8) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (distFp[j] === 255) { distFp[j] = dist + 1; queue[tail++] = j; }
      }
    }
  }
  const ring = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!fp[i] && distFp[i] <= RING_ROAD) ring[i] = 1;

  // --- Sectors: boundaries are wobbling rays, kept as unit vectors so no atan2 is needed ------------
  const theta0 = rng() * TWO_PI;
  const bounds: Boundary[] = [];
  for (let k = 0; k < SECTORS; k++) {
    const theta = theta0 + (k * TWO_PI) / SECTORS + randRange(rng, -0.12, 0.12);
    const amp = randRange(rng, 0.04, 0.1);
    const phase = rng() * TWO_PI;
    bounds.push({ sin: detSin(theta), cos: detCos(theta), amp, phase });
  }
  const order = shuffle(rng, [...REGION_FACTIONS]);
  const sectorCode = order.map((f) => regionCode(f));

  const sector = new Uint8Array(N);
  const band = new Uint8Array(N);
  const bandK = new Uint8Array(N);
  const rad = new Float64Array(N);
  const bx = new Float64Array(SECTORS), by = new Float64Array(SECTORS);
  const rMin = new Float64Array(SECTORS).fill(Infinity), rMax = new Float64Array(SECTORS).fill(-Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY;
      const r = Math.sqrt(dx * dx + dy * dy);
      rad[i] = r;
      for (let k = 0; k < SECTORS; k++) {
        const b = bounds[k];
        // Rotate the base direction by the small wobble angle with short Taylor series (|delta| <= 0.1).
        const delta = b.amp * detSin(0.35 * r + b.phase);
        const e = delta * delta;
        const sd = delta * (1 - e * (1 / 6 - e / 120));
        const cd = 1 - e * (0.5 - e / 24);
        bx[k] = b.cos * cd - b.sin * sd;
        by[k] = b.sin * cd + b.cos * sd;
      }
      let s = SECTORS - 1;
      for (let k = 0; k < SECTORS; k++) {
        const k2 = k + 1 === SECTORS ? 0 : k + 1;
        if (bx[k] * dy - by[k] * dx >= 0 && dx * by[k2] - dy * bx[k2] > 0) { s = k; break; }
      }
      sector[i] = s;
      if (fp[i] || border[i] || distFp[i] < RIDGE_START) continue;
      let bestLat = RIDGE_HALF, bestK = -1;
      for (let k = 0; k < SECTORS; k++) {
        if (bx[k] * dx + by[k] * dy <= 0) continue;
        const lat = Math.abs(bx[k] * dy - by[k] * dx);
        if (lat < bestLat) { bestLat = lat; bestK = k; }
      }
      if (bestK >= 0) {
        band[i] = 1;
        bandK[i] = bestK;
        if (r < rMin[bestK]) rMin[bestK] = r;
        if (r > rMax[bestK]) rMax[bestK] = r;
      }
    }
  }

  // --- Coliseum: pillars, then walls, gates, inner spawns -------------------------------------------
  const isWallRing = (x: number, y: number): boolean => {
    if (!fp[y * W + x]) return false;
    for (const [ox, oy] of NB8) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !fp[ny * W + nx]) return true;
    }
    return false;
  };
  const coFloor = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fp[y * W + x] && !isWallRing(x, y)) coFloor[y * W + x] = 1;

  const gateTilesOf = (side: GateSide): TilePt[] => {
    const g0x = CX - GATE_W / 2, g0y = CY - GATE_W / 2;
    const out: TilePt[] = [];
    for (let j = 0; j < GATE_W; j++) {
      out.push(
        side === "n" ? { x: g0x + j, y: coRect.y } :
        side === "s" ? { x: g0x + j, y: coRect.y + coRect.h - 1 } :
        side === "w" ? { x: coRect.x, y: g0y + j } :
        { x: coRect.x + coRect.w - 1, y: g0y + j },
      );
    }
    return out;
  };
  const SIDES: readonly GateSide[] = ["n", "e", "s", "w"];
  const OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const gates: GateDef[] = SIDES.map((side) => {
    const gt = gateTilesOf(side);
    let sx = 0, sy = 0;
    for (const t of gt) { sx += tileToWorldCenter(t.x); sy += tileToWorldCenter(t.y); }
    return { side, tiles: gt, x: sx / gt.length, y: sy / gt.length };
  });

  // Lanes: the strip straight in front of each gate. Inside they stay free of pillars; outside they are
  // forced to floor as a safety net.
  const laneIn = new Uint8Array(N);
  const laneOut: TilePt[] = [];
  for (const g of gates) {
    const [ox, oy] = OUT[g.side];
    const alongX = g.side === "n" || g.side === "s";
    const t0 = g.tiles[0];
    for (let d = 1; d <= LANE_DEPTH; d++) {
      for (let j = -1; j <= GATE_W; j++) {
        const ax = alongX ? j : 0, ay = alongX ? 0 : j;
        laneOut.push({ x: t0.x + ax + ox * d, y: t0.y + ay + oy * d });
        if (j >= 0 && j < GATE_W) laneIn[(t0.y + ay - oy * d) * W + t0.x + ax - ox * d] = 1;
      }
    }
  }

  // Inner spawns on a ring, each snapped to the tile it falls in.
  const innerTiles: TilePt[] = [];
  for (let j = 0; j < MAX_PLAYERS; j++) {
    const a = ((j + 0.5) * TWO_PI) / MAX_PLAYERS;
    innerTiles.push({ x: Math.floor(CX + INNER_SPAWN_R * detCos(a)), y: Math.floor(CY + INNER_SPAWN_R * detSin(a)) });
  }

  // Pillars: always, twelve single tiles, a generator tile and its three 90-degree turns about the centre for each of
  // three generators. The arena is fixed in size, so the layouts are fixed too: with the gates closed no layout leaves
  // a sight corridor longer than 477 u in it (the empty arena has 548 u), and the floor stays one piece. They keep to
  // the centre tile, the inner spawns' 3x3 and the lanes inside the gates. A layout may be used transposed (x and y
  // swapped), which the lane metric does not tell apart from the original.
  const rot = (p: TilePt): TilePt => ({ x: CX + CY - 1 - p.y, y: p.x - CX + CY });
  const pillar = new Uint8Array(N);
  {
    const pickLayout = Math.floor(rng() * PILLAR_LAYOUTS.length * 2);
    const transposed = (pickLayout & 1) === 1;
    for (const [gx, gy] of PILLAR_LAYOUTS[pickLayout >> 1]) {
      let p: TilePt = transposed ? { x: gy, y: gx } : { x: gx, y: gy };
      for (let q = 0; q < 4; q++) {
        if (coFloor[p.y * W + p.x]) pillar[p.y * W + p.x] = 1;
        p = rot(p);
      }
    }
  }

  // --- Ridges and passes ------------------------------------------------------------------------------
  const ridge = new Uint8Array(N);
  {
    const passes: number[][] = [];
    for (let k = 0; k < SECTORS; k++) {
      const len = rMax[k] - rMin[k];
      const lo = rMin[k] + 0.25 * len, hi = rMax[k] - 0.25 * len;
      if (len > LONG_RIDGE) {
        const mid = (lo + hi) / 2;
        passes.push([randRange(rng, lo, mid - PASS_MIN_GAP / 2), randRange(rng, mid + PASS_MIN_GAP / 2, hi)]);
      } else {
        passes.push([randRange(rng, lo, hi)]);
      }
    }
    for (let i = 0; i < N; i++) {
      if (!band[i]) continue;
      ridge[i] = 1;
      for (const p of passes[bandK[i]]) if (Math.abs(rad[i] - p) < PASS_HALF) { ridge[i] = 0; break; }
    }
  }

  // Terrain so far: border, ridges, the coliseum ring (gates open), pillars.
  for (let i = 0; i < N; i++) {
    if (border[i] || ridge[i] || pillar[i]) tiles[i] = TILE_WALL;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isWallRing(x, y)) tiles[y * W + x] = TILE_WALL;
  for (const g of gates) for (const t of g.tiles) tiles[t.y * W + t.x] = TILE_FLOOR;

  // --- Extract sites (legacy) -------------------------------------------------------------------------
  const sites = placeExtractSites(rng);
  const keep9: TileRect[] = sites.map((s) => ({ x: s.tile.x - 4, y: s.tile.y - 4, w: 9, h: 9 }));
  const keep7: TileRect[] = sites.map((s) => ({ x: s.tile.x - 3, y: s.tile.y - 3, w: 7, h: 7 }));
  const keep9g = new Uint8Array(N), keep7g = new Uint8Array(N);
  for (const k of keep9) markRect(keep9g, k, 0);
  for (const k of keep7) markRect(keep7g, k, 0);
  // Safety net, applied after the rocks: the 5x5 patch is open floor. A ridge tile it clears belongs to
  // its sector from then on.
  const cutPatches = (): void => {
    for (const s of sites) {
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const idx = (s.tile.y + j) * W + s.tile.x + i;
          tiles[idx] = TILE_FLOOR;
          ridge[idx] = 0;
        }
      }
    }
  };

  const campCentres: TilePt[] = [];
  const originC: TilePt = { x: CX, y: CY };
  const regionGrid = new Uint8Array(N);
  const open3 = new Uint8Array(N);
  // Region ids and "3x3 of floor" flags for the ground as it stands now; called once the terrain is final.
  const refreshGround = (): void => {
    for (let i = 0; i < N; i++) {
      regionGrid[i] =
        fp[i] ? REGION_COLISEUM :
        border[i] || (ridge[i] && tiles[i] === TILE_WALL) ? REGION_NONE :
        sectorCode[sector[i]];
    }
    open3.fill(0);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let ok = true;
        for (let j = -1; j <= 1 && ok; j++) for (let i = -1; i <= 1; i++) if (tiles[(y + j) * W + x + i] !== TILE_FLOOR) { ok = false; break; }
        if (ok) open3[y * W + x] = 1;
      }
    }
  };

  // --- Ruins and mob camps, one sector at a time ----------------------------------------------------------------
  // Per sector: the first ruin (placed so two camps still fit beside it), the camps, then the optional
  // second ruin, which keeps clear of the camps.
  const buildings: TileRect[] = [];
  const ruinSector: number[] = [];
  const campsByFaction = new Map<RegionFaction, MobCampDef[]>();
  const campSpotTiles: TilePt[] = [];
  const clearingForce: TilePt[] = [];
  const campNear2 = new Uint8Array(N); // clearing grown by two tiles: ruins stay out of it

  // A camp site needs its clearing grown by one tile in one sector, off ridges, the coliseum and its ring
  // road, extract patches and the border. There are no looser levels.
  const passNear1 = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (band[i] && !ridge[i]) markRect(passNear1, { x: i % W, y: Math.floor(i / W), w: 1, h: 1 }, 1);
  const baseCands: TilePt[][] = [];
  for (let k = 0; k < SECTORS; k++) baseCands.push([]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let fits = true;
      for (const [ox, oy] of CAMP_HALO) {
        const nx = x + ox, ny = y + oy;
        if (nx < EDGE_CLEAR || ny < EDGE_CLEAR || nx > W - 1 - EDGE_CLEAR || ny > H - 1 - EDGE_CLEAR) { fits = false; break; }
        const j = ny * W + nx;
        if (sector[j] !== sector[i] || fp[j] || distFp[j] <= RING_ROAD + 1 || band[j] || passNear1[j] || keep9g[j]) { fits = false; break; }
      }
      if (fits) baseCands[sector[i]].push({ x, y });
    }
  }
  // The clearing grown by one tile must stay out of a ruin grown by one tile.
  const haloHits = (c: TilePt, r: TileRect): boolean => {
    for (const [ox, oy] of CAMP_HALO) {
      const x = c.x + ox, y = c.y + oy;
      if (x >= r.x - 1 && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h) return true;
    }
    return false;
  };
  const campGap = last ? CAMP_GAP_MIN : CAMP_GAP;
  const campSites = (k: number): TilePt[] => baseCands[k].filter((c) => !buildings.some((b, n) => ruinSector[n] === k && haloHits(c, b)));
  const campsFit = (k: number, ruin: TileRect): boolean => {
    const pool = campSites(k).filter((c) => !haloHits(c, ruin));
    for (const a of pool) for (const b of pool) if (d2(a, b) >= campGap * campGap) return true;
    return false;
  };

  // The ruin itself sits in [EDGE_CLEAR + 1, W - EDGE_CLEAR - 1); the rect grown by `margin` must lie wholly
  // in sector k, off ridges, the coliseum and its ring road.
  const ruinFits = (r: TileRect, k: number, margin: number): boolean => {
    if (
      r.x < EDGE_CLEAR + 1 || r.y < EDGE_CLEAR + 1 ||
      r.x + r.w > W - EDGE_CLEAR - 1 || r.y + r.h > H - EDGE_CLEAR - 1
    ) return false;
    for (const o of keep9) if (overlaps(r, o, 0)) return false;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (campNear2[y * W + x]) return false;
    for (const b of buildings) if (overlaps(r, b, BUILDING_GAP)) return false;
    for (let y = r.y - margin; y < r.y + r.h + margin; y++) {
      for (let x = r.x - margin; x < r.x + r.w + margin; x++) {
        const i = y * W + x;
        if (sector[i] !== k || band[i] || fp[i] || ring[i]) return false;
      }
    }
    return true;
  };
  const addRuin = (r: TileRect, k: number): true => { buildings.push(r); ruinSector.push(k); return true; };
  const randomRect = (): TileRect => {
    const w = randInt(rng, 7, 10), h = randInt(rng, 7, 10);
    return { x: randInt(rng, EDGE_CLEAR + 1, W - EDGE_CLEAR - w), y: randInt(rng, EDGE_CLEAR + 1, H - EDGE_CLEAR - h), w, h };
  };
  const tryRuin = (k: number, attempts: number, needCamps: boolean): boolean => {
    for (let a = 0; a < attempts; a++) {
      const r = randomRect();
      if (ruinFits(r, k, 2) && (!needCamps || campsFit(k, r))) return addRuin(r, k);
    }
    return false;
  };
  // Deterministic scan of 7x7 ruins, so every region has one: full margin first, then one tile less.
  const scanRuin = (k: number, needCamps: boolean): boolean => {
    for (const margin of [2, 1]) {
      for (let y = EDGE_CLEAR + 1; y < H; y++) {
        for (let x = EDGE_CLEAR + 1; x < W; x++) {
          const r = { x, y, w: 7, h: 7 };
          if (ruinFits(r, k, margin) && (!needCamps || campsFit(k, r))) return addRuin(r, k);
        }
      }
    }
    return false;
  };

  for (let k = 0; k < SECTORS; k++) {
    const faction = order[k];
    if (!tryRuin(k, 400, true) && !scanRuin(k, true)) scanRuin(k, false);

    const count = randInt(rng, 2, 4);
    const sites = campSites(k);
    // The first centre must leave room for a second one campGap tiles away: the two camps are guaranteed.
    const cands = sites;
    const withPartner = sites.filter((c) => sites.some((o) => d2(o, c) >= campGap * campGap));
    const centres: TilePt[] = [];
    for (let n = 0; n < count; n++) {
      let chosen: TilePt | null = null;
      for (let gap = CAMP_GAP_FAR; gap >= campGap; gap--) {
        const pool = (n === 0 ? withPartner : cands).filter((c) => centres.every((o) => d2(o, c) >= gap * gap));
        // Prefer sites off the spawn rim, so the spawns that follow keep their distance from camps.
        const offRim = pool.filter((c) => {
          const dc = d2(c, originC);
          return dc < RIM_LO2 || dc > RIM_HI2;
        });
        if (pool.length > 0) { chosen = pick(rng, offRim.length > 0 ? offRim : pool); break; }
      }
      if (!chosen) break;
      centres.push(chosen);
    }
    if (centres.length < 2 && !last) return null;
    const camps: MobCampDef[] = [];
    let elite = -1, eliteD = -1;
    centres.forEach((c, n) => {
      const clearing: TilePt[] = CAMP_TILES.map(([ox, oy]) => ({ x: c.x + ox, y: c.y + oy }));
      clearingForce.push(...clearing);
      for (const t of clearing) markRect(campNear2, { x: t.x, y: t.y, w: 1, h: 1 }, 2);
      shuffle(rng, clearing);
      const want = randInt(rng, 3, 5);
      const spots: TilePt[] = [];
      for (const t of clearing) {
        if (spots.length >= want) break;
        if (spots.every((o) => cheb(o, t) >= 2)) spots.push(t);
      }
      for (const t of clearing) {
        if (spots.length >= want) break;
        if (!spots.includes(t)) spots.push(t);
      }
      campCentres.push(c);
      campSpotTiles.push(...spots);
      const dist = d2(c, originC);
      if (dist > eliteD) { eliteD = dist; elite = n; }
      camps.push({ id: `${faction}-${n + 1}`, region: faction, ...toWorld(c), r: CAMP_R * TILE, spots: spots.map(toWorld), elite: false, weapon: REGION_WEAPONS[faction] });
    });
    if (elite >= 0) camps[elite].elite = true;
    campsByFaction.set(faction, camps);

    if (rng() < 0.5 && !tryRuin(k, 200, false)) scanRuin(k, false);
  }
  const gapsPerBuilding = buildings.map((b) => carveBuilding(tiles, rng, b));
  const ruinGrid = new Uint8Array(N), ruinNear1 = new Uint8Array(N);
  for (const b of buildings) { markRect(ruinGrid, b, 0); markRect(ruinNear1, b, 1); }

  // --- Obstacles: rock chunks, never near the coliseum, ridges, ruins, camps or extract patches ---------
  {
    const bad = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (distFp[i] <= RING_ROAD + 1 || keep7g[i] || ruinNear1[i]) bad[i] = 1;
      if (band[i]) {
        const x = i % W, y = (i - x) / W;
        markRect(bad, { x, y, w: 1, h: 1 }, 1);
      }
    }
    for (const c of campCentres) {
      for (const [ox, oy] of CAMP_HALO) {
        const nx = c.x + ox, ny = c.y + oy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H) bad[ny * W + nx] = 1;
      }
    }
    const target = randInt(rng, 15, 31);
    let placed = 0;
    for (let attempt = 0; attempt < 6000 && placed < target; attempt++) {
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
      let free = true;
      for (let y = r.y; y < r.y + h && free; y++) for (let x = r.x; x < r.x + w; x++) if (bad[y * W + x]) { free = false; break; }
      if (!free) continue;
      placed++;
      markRect(bad, r, 1); // one tile of air around every chunk
      for (let y = r.y; y < r.y + h; y++) for (let x = r.x; x < r.x + w; x++) tiles[y * W + x] = TILE_WALL;
    }
  }

  // --- Safety nets, then connectivity ------------------------------------------------------------------
  for (const t of laneOut) tiles[t.y * W + t.x] = TILE_FLOOR;
  for (let i = 0; i < N; i++) if (laneIn[i]) tiles[i] = TILE_FLOOR;
  for (const t of clearingForce) tiles[t.y * W + t.x] = TILE_FLOOR;
  cutPatches();
  enforceConnectivity(tiles, { x: CX, y: CY });

  // --- Player spawns: three per region on the same rim band --------------------------------------------------
  refreshGround();
  const extractTiles = sites.map((s) => s.tile);
  // Constraints relax stage by stage; the first stages are what nearly every map uses. Spacing never relaxes:
  // two spawns, in one region or two, are always at least SPAWN_SEPARATION tiles apart.
  // A spawn beside a ridge pass and an extract patch would leave one unbroken lane of ground the cover pass may not
  // touch, so the first stages keep spawns 3 tiles clear of passes.
  const passNear = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (band[i] && !ridge[i]) markRect(passNear, { x: i % W, y: Math.floor(i / W), w: 1, h: 1 }, 3);
  const SPAWN_STAGES = [
    { camp: 7, ext: 7, lo: SPAWN_BAND[0], hi: SPAWN_BAND[1], fair: true, pass: true },
    { camp: 6, ext: 7, lo: SPAWN_BAND[0], hi: SPAWN_BAND[1], fair: true, pass: true },
    { camp: 6, ext: 6, lo: SPAWN_BAND[0], hi: SPAWN_BAND[1], fair: true, pass: true },
    { camp: 6, ext: 5, lo: 0.5, hi: 0.95, fair: true, pass: false },
    { camp: 6, ext: 5, lo: 0.5, hi: 0.95, fair: false, pass: false },
  ];
  // Three spawns for one region, each at least SPAWN_SEPARATION from `taken` (the other regions' spawns).
  const sep2 = SPAWN_SEPARATION * SPAWN_SEPARATION;
  const pickSpawns = (code: number, taken: readonly TilePt[]): TilePt[] => {
    const chosen: TilePt[] = [];
    for (const st of SPAWN_STAGES) {
      if (chosen.length >= SPAWNS_PER_REGION) break;
      const lo2 = (st.lo * R0) * (st.lo * R0), hi2 = (st.hi * R0) * (st.hi * R0);
      const cands: TilePt[] = [];
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (regionGrid[i] !== code || !open3[i] || ruinGrid[i] || (st.pass && passNear[i])) continue;
          const p = { x, y };
          const dc = d2(p, originC);
          if (dc < lo2 || dc > hi2) continue;
          if (campCentres.some((c) => d2(c, p) < st.camp * st.camp)) continue;
          if (extractTiles.some((e) => cheb(e, p) < st.ext)) continue;
          cands.push(p);
        }
      }
      // Farthest-point sampling: first point random, then the candidate farthest from those already chosen.
      while (chosen.length < SPAWNS_PER_REGION) {
        let lo = Infinity, hi = 0;
        for (const o of taken.concat(chosen)) { const d = Math.sqrt(d2(o, originC)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
        const pool = cands.filter((c) => {
          if (taken.some((o) => d2(o, c) < sep2)) return false;
          if (chosen.some((o) => d2(o, c) < sep2)) return false;
          // Keep every spawn on the map within FAIR_RATIO of every other in distance from the centre.
          const d = Math.sqrt(d2(c, originC));
          return !st.fair || Math.max(hi, d) <= FAIR_RATIO * Math.min(lo, d);
        });
        if (pool.length === 0) break;
        if (chosen.length === 0) { chosen.push(pool[randInt(rng, 0, pool.length)]); continue; }
        let best = pool[0], bestD = -1;
        for (const c of pool) {
          let m = Infinity;
          for (const o of chosen) m = Math.min(m, d2(o, c));
          if (m > bestD) { bestD = m; best = c; }
        }
        chosen.push(best);
      }
    }
    return chosen;
  };
  const spawnsByRegion: TilePt[][] = [];
  for (const faction of REGION_FACTIONS) spawnsByRegion.push(pickSpawns(regionCode(faction), spawnsByRegion.flat()));
  const allSpawnTiles = spawnsByRegion.flat();

  // --- Chests --------------------------------------------------------------------------------------------------
  // Chests stay off the ring next to the border (so "against a wall" never means the border) and out of the
  // extract circles. They go down before the cover pass, which then leaves them and their neighbours alone.
  const gapTiles = gapsPerBuilding.flat();
  const extractReach2 = (EXTRACT_RADIUS / TILE) * (EXTRACT_RADIUS / TILE);
  const chestsByRegion: TilePt[][] = [];
  REGION_FACTIONS.forEach((faction) => {
    const code = regionCode(faction);
    const placed = chestsByRegion.flat();
    const pool: TilePt[] = [];
    for (let y = 2; y < H - 2; y++) {
      for (let x = 2; x < W - 2; x++) {
        const i = y * W + x;
        if (regionGrid[i] !== code || tiles[i] !== TILE_FLOOR || ring[i]) continue;
        if (tiles[i - 1] !== TILE_WALL && tiles[i + 1] !== TILE_WALL && tiles[i - W] !== TILE_WALL && tiles[i + W] !== TILE_WALL) continue;
        const p = { x, y };
        if (allSpawnTiles.some((s) => cheb(s, p) < 3)) continue;
        if (campSpotTiles.some((s) => cheb(s, p) < 2)) continue;
        if (nearAny(gapTiles, x, y)) continue;
        if (extractTiles.some((e) => d2(e, p) <= extractReach2)) continue;
        if (placed.some((o) => cheb(o, p) < CHEST_MIN_GAP)) continue;
        pool.push(p);
      }
    }
    const want = randInt(rng, 3, 5);
    shuffle(rng, pool);
    const chosen: TilePt[] = [];
    // One chest indoors: inside one of this region's ruins (against a wall by construction).
    const k = order.indexOf(faction);
    const inRuin = pool.find((p) =>
      buildings.some((b, n) => ruinSector[n] === k && p.x > b.x && p.x < b.x + b.w - 1 && p.y > b.y && p.y < b.y + b.h - 1));
    if (inRuin) chosen.push(inRuin);
    for (const sep of [4, CHEST_MIN_GAP]) {
      for (const c of pool) {
        if (chosen.length >= want) break;
        if (!chosen.includes(c) && chosen.every((o) => cheb(o, c) >= sep)) chosen.push(c);
      }
    }
    chestsByRegion.push(chosen);
  });
  const allChestTiles = chestsByRegion.flat();

  const spacedOut = (pts: readonly TilePt[], ok: (a: TilePt, b: TilePt) => boolean): boolean =>
    pts.every((a, i) => pts.every((b, j) => i >= j || ok(a, b)));
  // Cheap soundness first, so a doomed layout is dropped before the cover pass spends time on it.
  if (!last) {
    let lo = Infinity, hi = 0;
    for (const t of allSpawnTiles) { const d = Math.sqrt(d2(t, originC)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    const sound =
      buildings.length >= SECTORS &&
      REGION_FACTIONS.every((f, ri) =>
        ruinSector.includes(order.indexOf(f)) &&
        campsByFaction.get(f)!.length >= 2 &&
        spawnsByRegion[ri].length === SPAWNS_PER_REGION &&
        spawnsByRegion[ri].every((a) => campCentres.every((c) => d2(a, c) >= 25)) &&
        chestsByRegion[ri].length >= 3 &&
        chestsByRegion[ri].some((c) => buildings.some((b) => tileInRect(b, toWorld(c)))),
      ) &&
      spacedOut(allSpawnTiles, (a, b) => d2(a, b) >= sep2) &&
      spacedOut(allChestTiles, (a, b) => cheb(a, b) >= CHEST_MIN_GAP) &&
      hi <= 1.5 * lo &&
      sites.every((st) => {
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (tiles[(st.tile.y + j) * W + st.tile.x + i] !== TILE_FLOOR) return false;
        return true;
      });
    if (!sound) return null;
  }

  // --- Cover: rocks that cut every open lane down to LANE_MAX --------------------------------------------------
  // `prot` is what no rock may take, `soft` what a rock takes only as a last resort.
  const prot = new Uint8Array(N), soft = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (border[i]) prot[i] = 1;
  for (const t of laneOut) prot[t.y * W + t.x] = 1;
  for (const c of campCentres) for (const [ox, oy] of CAMP_HALO) prot[(c.y + oy) * W + c.x + ox] = 1;
  for (const t of allSpawnTiles) { markRect(soft, { x: t.x - 1, y: t.y - 1, w: 3, h: 3 }, 1); markRect(prot, { x: t.x - 1, y: t.y - 1, w: 3, h: 3 }, 0); }
  for (const t of allChestTiles) { markRect(soft, { x: t.x, y: t.y, w: 1, h: 1 }, 1); prot[t.y * W + t.x] = 1; }
  for (const st of sites) markRect(prot, { x: st.tile.x - 2, y: st.tile.y - 2, w: 5, h: 5 }, 0);
  for (const g of gapTiles) {
    prot[g.y * W + g.x] = 1;
    for (const d of NB4) prot[g.y * W + g.x + d] = 1;
  }
  for (let i = 0; i < N; i++) {
    if (band[i] && !ridge[i]) { markRect(soft, { x: i % W, y: Math.floor(i / W), w: 1, h: 1 }, 1); prot[i] = 1; }
  }
  // A ruin takes a few rocks inside as furniture, never so many that less than 62% of the interior is open
  // (index 0 is "not in a ruin" and absorbs the bookkeeping for every other tile).
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
  const covered = placeCover(rng, tiles, regionGrid, prot, soft, ruinOf, ruinQuota, ruinBox, ring);
  if (covered < 0 && !last) return null;

  // --- Region records ---------------------------------------------------------------------------------------
  const regions: FactionRegionDef[] = REGION_FACTIONS.map((faction, ri) => {
    const code = regionCode(faction);
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (regionGrid[y * W + x] === code && tiles[y * W + x] === TILE_FLOOR) { sx += x + 0.5; sy += y + 0.5; n++; }
      }
    }
    const mx = sx / n, my = sy / n;
    let anchor: TilePt = { x: CX, y: CY }, bestD = Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (regionGrid[i] !== code || tiles[i] !== TILE_FLOOR || ruinGrid[i]) continue;
        const dd = (x + 0.5 - mx) * (x + 0.5 - mx) + (y + 0.5 - my) * (y + 0.5 - my);
        if (dd < bestD) { bestD = dd; anchor = { x, y }; }
      }
    }
    return {
      id: faction,
      anchor: toWorld(anchor),
      spawns: spawnsByRegion[ri].map(toWorld),
      chestSpots: chestsByRegion[ri].map(toWorld),
      mobCamps: campsByFaction.get(faction) ?? [],
    };
  });

  const spawns: Vec2[] = [];
  for (let n = 0; n < SPAWNS_PER_REGION; n++) for (const r of regions) if (r.spawns[n]) spawns.push(r.spawns[n]);

  // --- Legacy: ground loot and extraction -----------------------------------------------------------------
  // Loot never lies on a chest or beside one, in a camp clearing, in a ruin or in the coliseum.
  const noLoot = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (ruinGrid[i] || fp[i]) noLoot[i] = 1;
  for (const t of clearingForce) noLoot[t.y * W + t.x] = 1;
  for (const t of allChestTiles) markRect(noLoot, { x: t.x, y: t.y, w: 1, h: 1 }, 1);
  const groundSpots = pickGroundSpots(rng, tiles, noLoot, allSpawnTiles).map(toWorld);
  const extracts: ExtractZoneDef[] = sites.map((s, i) => ({
    id: `x${i + 1}`,
    name: EXTRACT_NAMES[s.edge],
    ...toWorld(s.tile),
    r: EXTRACT_RADIUS,
  }));

  if (!last) {
    let floorTotal = 0;
    const floorOf = new Array<number>(REGION_IDS.length).fill(0);
    for (let i = 0; i < N; i++) if (tiles[i] === TILE_FLOOR) { floorTotal++; floorOf[regionGrid[i]]++; }
    const sound =
      REGION_FACTIONS.every((f) => floorOf[regionCode(f)] >= 0.08 * floorTotal) &&
      groundSpots.length >= 20;
    if (!sound) return null;
  }

  const coliseum: ColiseumDef = {
    rect: coRect,
    centre: toWorld({ x: CX, y: CY }),
    gates,
    innerSpawns: innerTiles.map(toWorld),
  };

  return {
    seed,
    w: W,
    h: H,
    tiles,
    regionGrid,
    coliseum,
    regions,
    buildings,
    spawns,
    extracts,
    crateSpots: regions.flatMap((r) => r.chestSpots),
    groundSpots,
  };
}
