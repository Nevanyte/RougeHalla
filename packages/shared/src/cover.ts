// Anti-kiting cover: the lane metric (lattices of parallel lines and the strips between them), the rock placement that
// cuts every lane down to the target, and the spawn sight screen. Client and server must agree to the bit, so only
// + - * / sqrt floor ceil abs min max are used here (detSin/detCos are built from those).
//
// Two masks (map.ts): sight-open is `(tile & MASK_SIGHT) === 0` (low ground lets sight through, so lanes run over it and a
// rock may stand on it), walkable is `(tile & MASK_MOVE) === 0` (every connectivity test: the simple-point table, sealed pockets, the
// ring road, the territory guard, walking distances).
import { MAP_TILES_H, MAP_TILES_W, MAX_SIGHT_CORRIDOR, RANGED_HIT_REACH, SIGHT_CORRIDOR_WIDTH, TILE } from "./constants";
import { MASK_MOVE as MOVE_MASK, MASK_SIGHT as SIGHT_MASK, REGION_FACTIONS, REGION_NONE as NONE_CODE, TILE_WALL as WALL_TILE } from "./map";
import type { GameMap, TilePt } from "./map";
import type { Rng } from "./rng";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const SECTORS = REGION_FACTIONS.length;
const d2 = (a: TilePt, b: TilePt): number => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
// Hot loops read module-level copies of these imports: under a test runner's module system (vitest) every use of an
// import is a property read on the module object, which cost this code about a third of its time.
const MASK_MOVE = MOVE_MASK, MASK_SIGHT = SIGHT_MASK, TILE_WALL = WALL_TILE, REGION_NONE = NONE_CODE;


/**
 * Anti-kiting cover. Lines of one direction are `step` apart in `dirs` directions over [0, pi), and a lane is the
 * strip between two neighbouring lines where only sight-open tiles touch it. No lane may be longer than the
 * pass's `target` tiles. SIGHT_LATTICE is the fine lattice that certifies the bound: with 48 directions and lines a
 * quarter of SIGHT_CORRIDOR_WIDTH apart, a free strip of that width at any angle and offset contains a lattice lane
 * of nearly its length, so lanes of at most `target` tiles (a hair under MAX_SIGHT_CORRIDOR) bound every such strip by
 * MAX_SIGHT_CORRIDOR. A coarse lattice (32 directions, lines half a width apart) does the bulk of the cover first.
 */
export const SIGHT_LATTICE = {
  dirs: 48,
  step: SIGHT_CORRIDOR_WIDTH / 4 / TILE,
  target: MAX_SIGHT_CORRIDOR / TILE - 0.02,
};
export const COARSE_LATTICE = { dirs: 32, step: SIGHT_CORRIDOR_WIDTH / 2 / TILE };
export const LANE_EPS = 1e-9;
export const COARSE_TARGET = SIGHT_LATTICE.target;
/**
 * Every lattice line runs through LATTICE_ORIGIN + j * step * normal: the coliseum centre less (32, 32), so the fixed
 * coliseum sits on the lattice exactly as it did on the 64x64 map, where its pillar layouts were certified (anchored at
 * the map corner, some layouts leave a 15.5-tile lane inside the footprint that no rock may cut). The tests' lane
 * checkers and longestLane use the same anchor.
 */
export const LATTICE_ORIGIN: readonly [number, number] = [W / 2 - 32, H / 2 - 32];
/** A work-list entry is `strip * LANE_POS + the middle of a corridor on it, in 1/LANE_QUANT tiles`. */
const LANE_POS = 4096;
const LANE_QUANT = 4;
/** Distances along a line are measured from where it crosses the axis through LATTICE_ORIGIN, so they can be negative (|s| < 113 at 96x96). */
const LANE_BIAS = 128;
/** Most corridors on one strip that can be too long at once (a strip is at most 136 tiles long at 96x96 and a corridor over the lane target, with a blocked tile between two: 8). */
const LANE_SLOTS = 10;
/** Chance that a rock is two tiles long. */
const ROCK_GROW = 0.25;
/** A dead end of floor this small (tiles) is walled up together with the rock that seals it off. */
const POCKET_MAX = 30;
/** Score points a rock gives up per step away from the preferred layout (a tile that sits on one more long lane is worth 1024). */
const LEVEL_COST = 2048;
/** The same for standing on a soft-protected tile: more than any number of lanes a rock could cut, so it is a last resort. */
const SOFT_COST = 1 << 24;
const penalty = (lvl: number): number => (lvl >= 3 ? SOFT_COST : lvl * LEVEL_COST);

export const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** sin from + - * / only (Taylor after range reduction), so every JS engine agrees to the bit. */
export function detSin(x: number): number {
  let y = x - Math.floor(x / TWO_PI + 0.5) * TWO_PI;
  if (y > HALF_PI) y = PI - y;
  else if (y < -HALF_PI) y = -PI - y;
  const y2 = y * y;
  return y * (1 + y2 * (-1 / 6 + y2 * (1 / 120 + y2 * (-1 / 5040 + y2 * (1 / 362880 + y2 * (-1 / 39916800 + y2 * (1 / 6227020800)))))));
}

export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}

/** Anything not 4-connected to the seed tile becomes wall. */
export function enforceConnectivity(tiles: Uint8Array, seedTile: TilePt): void {
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
    if (seen[j] || (tiles[j] & MASK_MOVE) !== 0) return;
    seen[j] = 1;
    queue[tail++] = j;
  }
  for (let i = 0; i < tiles.length; i++) if ((tiles[i] & MASK_MOVE) === 0 && !seen[i]) tiles[i] = TILE_WALL;
}

/**
 * Every line of the lane metric, as the tiles it crosses in order. The table depends only on the map size and the
 * lattice, so each is built once, on first use, and shared by every generateMap call (it is never written afterwards).
 * Lines of one direction are stored in order of offset, so line l + 1 is the neighbour of line l when pairOK[l]:
 * the two bound one strip of the map, `step` wide.
 */
export interface LaneTable {
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

const laneTables = new Map<string, LaneTable>();

/** The table of `dirs` directions with lines `step` apart, built on first use. */
export function getLaneTable(dirs: number, step: number): LaneTable {
  const key = `${dirs}:${step}`;
  const cached = laneTables.get(key);
  if (cached) return cached;
  const capacity = Math.ceil((dirs * (W * H * 1.5 + 4 * W)) / step);
  const tileBuf = new Uint16Array(capacity);
  const edgeBuf = new Float64Array(capacity + 65536);
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

  for (let k = 0; k < dirs; k++) {
    // Walk every line towards +x, so k > dirs / 2 uses the opposite direction; the set of lines is the same.
    let dx = 1, dy = 0;
    if (2 * k === dirs) { dx = 0; dy = 1; } else if (k !== 0) {
      const a = (k * PI) / dirs;
      dx = detCos(a); dy = detSin(a);
      if (2 * k > dirs) { dx = -dx; dy = -dy; }
    }
    const nx = -dy, ny = dx;
    const ox = LATTICE_ORIGIN[0], oy = LATTICE_ORIGIN[1];
    const c1 = nx * (1 - ox) + ny * (1 - oy), c2 = nx * (W - 1 - ox) + ny * (1 - oy);
    const c3 = nx * (1 - ox) + ny * (H - 1 - oy), c4 = nx * (W - 1 - ox) + ny * (H - 1 - oy);
    const oMin = Math.min(Math.min(c1, c2), Math.min(c3, c4)), oMax = Math.max(Math.max(c1, c2), Math.max(c3, c4));
    const jHi = Math.floor(oMax / step);
    for (let j = Math.ceil(oMin / step); j <= jHi; j++) addLine(ox + nx * j * step, oy + ny * j * step, dx, dy, k, j);
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
  const table = { lineStart, tile, edge, tileStart, tileLine, tilePos, pairOK };
  laneTables.set(key, table);
  return table;
}

/** 1 where a tile is sight-open (not wall) and belongs to a region (gates open on a generated map): the tiles the lane metric walks. */
export function openMask(tiles: Uint8Array, regionGrid: Uint8Array, out: Uint8Array): Uint8Array {
  for (let i = 0; i < N; i++) out[i] = (tiles[i] & MASK_SIGHT) === 0 && regionGrid[i] !== REGION_NONE ? 1 : 0;
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
export function longestFatLane(open: Uint8Array, lt: LaneTable): number {
  const lines = lt.lineStart.length - 1;
  let pa = new Float64Array(128), pb = new Float64Array(128), ca = new Float64Array(128), cb = new Float64Array(128);
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
    const ta = pa; pa = ca; ca = ta;
    const tb = pb; pb = cb; cb = tb;
    prevCount = count;
  }
  return best;
}

/**
 * Longest lane of the fine lattice (SIGHT_LATTICE, anchored at LATTICE_ORIGIN) over all sight-open ground, in world
 * units. The generator keeps it at SIGHT_LATTICE.target tiles or less, which bounds every free strip
 * SIGHT_CORRIDOR_WIDTH wide by MAX_SIGHT_CORRIDOR.
 */
export function longestLane(map: GameMap): number {
  if (map.w !== W || map.h !== H) throw new RangeError(`longestLane: expected a ${W}x${H} map`);
  const lt = getLaneTable(SIGHT_LATTICE.dirs, SIGHT_LATTICE.step);
  return longestFatLane(openMask(map.tiles, map.regionGrid, new Uint8Array(N)), lt) * TILE;
}

/**
 * The 3x3 neighbourhood of a tile as a cycle of 8 cells (N, NE, E, SE, S, SW, W, NW). SIMPLE[mask] says whether
 * turning the centre of a floor patch into wall keeps its 4-connected floor neighbours linked through the ring,
 * i.e. whether no corridor is cut and no pocket is sealed. Bit q of the mask is set when ring cell q is floor.
 */
export const SIMPLE = new Uint8Array(256);
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
export const RING_DX = [0, 1, 1, 1, 0, -1, -1, -1];
export const RING_DY = [-1, -1, 0, 1, 1, 1, 0, -1];
export const RING_OFF = RING_DX.map((dx, q) => RING_DY[q] * W + dx);
export const NB4 = [-W, 1, W, -1];

/**
 * Walking distance from tile `from` to every floor tile over the 8-connected grid, without cutting corners, in fifths of
 * a tile (a diagonal step costs 7, about 5 * sqrt(2)); -1 where unreachable.
 */
export function walkDistances(tiles: Uint8Array, from: number): Int32Array {
  const dist = new Int32Array(N).fill(-1);
  const best = new Int32Array(N).fill(1 << 30);
  const buckets: number[][] = [[], [], [], [], [], [], [], []];
  best[from] = 0;
  buckets[0].push(from);
  const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
  for (let d = 0, left = 1; left > 0; d++) {
    const bucket = buckets[d & 7];
    while (bucket.length > 0) {
      const i = bucket.pop()!;
      left--;
      if (dist[i] >= 0 || best[i] !== d) continue;
      dist[i] = d;
      const x = i % W, y = (i - x) / W;
      for (let q = 0; q < 8; q++) {
        const nx = x + DX[q], ny = y + DY[q];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || (tiles[ny * W + nx] & MASK_MOVE) !== 0) continue;
        const diagonal = (q & 1) === 1;
        if (diagonal && ((tiles[y * W + nx] & MASK_MOVE) !== 0 || (tiles[ny * W + x] & MASK_MOVE) !== 0)) continue;
        const nd = d + (diagonal ? 7 : 5), j = ny * W + nx;
        if (nd < best[j]) { best[j] = nd; buckets[nd & 7].push(j); left++; }
      }
    }
  }
  return dist;
}

/** The sim hits a ranged target whose centre is within RANGED_HIT_REACH of the aim ray; a hair more here so rounding there can't open a gap. */
const HIT_REACH = RANGED_HIT_REACH / TILE + LANE_EPS;

/**
 * The hit cone of a shooter on tile-unit point (ax, ay) at a target on (bx, by): every aim ray that passes within
 * HIT_REACH of the target's centre and so could hit it unless a wall cuts the ray first. A direction is described by
 * its slope `cross / dot` against the unit vector d0 from shooter to target, which is monotone in angle (it is the
 * tangent of the angle off d0), so the cone is the slopes [-t, t]. Every cone ray passes the target's centre at
 * `dot >= ahead` (the value on its edge, sqrt(distance² - HIT_REACH²)), so a wall tile whose farthest corner is nearer than that cuts every ray
 * that crosses it before the target.
 */
interface Cone { ax: number; ay: number; dx: number; dy: number; far2: number; t: number; gaps: number[] }

function makeCone(ax: number, ay: number, bx: number, by: number): Cone {
  const ex = bx - ax, ey = by - ay, len = Math.sqrt(ex * ex + ey * ey);
  const ahead = Math.sqrt(len * len - HIT_REACH * HIT_REACH);
  return { ax, ay, dx: ex / len, dy: ey / len, far2: (ahead - LANE_EPS) * (ahead - LANE_EPS), t: HIT_REACH / ahead, gaps: [] };
}

const tileSlope = [0, 0];

/** The slopes [lo, hi] of the rays that cross tile (tx, ty) seen from the shooter, into tileSlope; false when the tile cannot be counted on to cut a cone ray before the target. */
function tileSlopes(c: Cone, tx: number, ty: number): boolean {
  let lo = Infinity, hi = -Infinity;
  for (let q = 0; q < 4; q++) {
    const vx = tx + (q & 1) - c.ax, vy = ty + (q >> 1) - c.ay;
    const dot = c.dx * vx + c.dy * vy;
    if (dot <= 0 || vx * vx + vy * vy >= c.far2) return false;
    const slope = (c.dx * vy - c.dy * vx) / dot;
    if (slope < lo) lo = slope;
    if (slope > hi) hi = slope;
  }
  tileSlope[0] = lo;
  tileSlope[1] = hi;
  return true;
}

/** The tiles that can matter to a cone: those the segment between the two points comes within HIT_REACH of. */
function coneBox(c: Cone, bx: number, by: number): [number, number, number, number] {
  return [
    Math.max(0, Math.floor(Math.min(c.ax, bx) - HIT_REACH)), Math.max(0, Math.floor(Math.min(c.ay, by) - HIT_REACH)),
    Math.min(W - 1, Math.floor(Math.max(c.ax, bx) + HIT_REACH)), Math.min(H - 1, Math.floor(Math.max(c.ay, by) + HIT_REACH)),
  ];
}

/** Fills c.gaps with the [from, to] slope ranges of the cone that no wall tile is sure to cut before the target; empty when the target is safe from this shooter. */
function coneGaps(tiles: Uint8Array, c: Cone, box: readonly number[]): void {
  const spans: [number, number][] = [];
  for (let ty = box[1]; ty <= box[3]; ty++) {
    for (let tx = box[0]; tx <= box[2]; tx++) {
      if ((tiles[ty * W + tx] & MASK_SIGHT) !== 0 && tileSlopes(c, tx, ty) && tileSlope[1] >= -c.t && tileSlope[0] <= c.t) spans.push([tileSlope[0], tileSlope[1]]);
    }
  }
  spans.sort((p, q) => p[0] - q[0]);
  const gaps = c.gaps;
  gaps.length = 0;
  let covered = -c.t;
  for (const [lo, hi] of spans) {
    if (covered >= c.t) break;
    // Two tiles lined up with the shooter share a slope that rounding can split by an ulp; real corners differ by far more.
    if (lo > covered + LANE_EPS) gaps.push(covered, lo);
    if (hi > covered) covered = hi;
  }
  if (covered < c.t) gaps.push(covered, c.t);
}

/** The ground one map's cover passes work on; every pass of the map shares it (and writes `tiles` and `ruinQuota`). */
export interface CoverGround {
  /** Written: rocks become TILE_WALL. */
  tiles: Uint8Array;
  regionGrid: Uint8Array;
  /** One draw per tile, the tie-break between equally useful rock tiles. */
  noise: Uint16Array;
  /** No rock, ever. */
  prot: Uint8Array;
  /** A rock only as a last resort. */
  soft: Uint8Array;
  /** 1 + the ruin a floor tile is inside of, else 0; `ruinQuota[r]` rocks are still allowed in ruin r, `ruinBox` holds its interior as 4 numbers. */
  ruinOf: Uint8Array;
  ruinQuota: number[];
  ruinBox: number[];
  /** The ring road: its floor must stay one piece that touches all five regions. */
  ring: Uint8Array;
  /** Territory ids (or null): a rock prefers to keep its own territory's floor locally connected. */
  guard: Uint8Array | null;
}

/** placeCover's failures (negative results). */
export const COVER_DEAD = -1;
export const COVER_UNCUT = -2;
export const COVER_SPAWN = -3;

/**
 * Anti-kiting cover: drops rocks until no lane of lattice `lt` is longer than `target`. A corridor is the strip between
 * two neighbouring lines of one direction with only sight-open tiles in it; the strips that are too long are kept as
 * intervals along their line pair. Every long corridor is cut at the tile beside it that lies on the most long
 * corridors (noise breaks ties); the corridors the tile blocks are split in place, so a rock costs a few thousand
 * operations rather than a rescan of the map. A rock may go on a floor tile only if the floor around it stays
 * 4-connected (simple-point test) or the part it seals off is a small dead end with nothing to keep in it; such a
 * dead end is walled up with it. A rock on low ground changes no connectivity. Preferences, tried in this order and
 * relaxed only when nothing better is left: rocks stay apart, a territory's floor stays locally connected (`guard`),
 * soft-protected tiles stay open. Returns the number of rocks, or a negative number when some corridor cannot be cut:
 * COVER_DEAD, mostly known before the first rock (a stretch of protected ground longer than the target has no tile to
 * cut it on), or COVER_UNCUT (the caller then tries another map). With `spawns`, a last step screens every pair of
 * spawns within MAX_SIGHT_CORRIDOR of each other against the sim's ranged hit cone, with rocks between them, until no
 * aim ray that could hit the other spawn gets past a wall (COVER_SPAWN when no rock can close a gap).
 */
export function placeCover(lt: LaneTable, target: number, rng: Rng, ground: CoverGround, spawns: readonly TilePt[] | null): number {
  const { tiles, regionGrid, noise, prot, soft, ruinOf, ruinQuota, ruinBox, ring, guard } = ground;
  const { lineStart, tile, edge, tileStart, tileLine, tilePos, pairOK } = lt;
  const lines = lineStart.length - 1;
  const open = openMask(tiles, regionGrid, new Uint8Array(N));
  const limit = target + LANE_EPS;
  // The territory guard: a rock on floor keeps that tile's territory floor locally connected (a simple point of the
  // territory's own floor), so it never splits a territory whose pieces would stay linked only through another one. The
  // zone's floor gets the same: a rock never cuts a zone into two floors that only another zone's ground joins.
  const guardOK = (t: number): boolean => {
    if (!guard || !guard[t]) return true;
    const g = guard[t], z = regionGrid[t];
    let m = 0, mz = 0;
    for (let q = 0; q < 8; q++) {
      const j = t + RING_OFF[q];
      if ((tiles[j] & MASK_MOVE) !== 0) continue;
      if (guard[j] === g) m |= 1 << q;
      if (regionGrid[j] === z) mz |= 1 << q;
    }
    return SIMPLE[m] === 1 && SIMPLE[mz] === 1;
  };
  // A lane through k tiles is at most k * sqrt(2) long, so a shorter run of open tiles is never a long lane.
  const minRun = Math.floor(limit / 1.4142135623730951) + 1;

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
        if ((tiles[j] & MASK_MOVE) !== 0) continue;
        if (mark[j] === markB) return true;
        if (mark[j] !== markA) { mark[j] = markA; queue[tailA++] = j; }
      }
      const i2 = queueB[headB++];
      for (let e = 0; e < 4; e++) {
        const j = i2 + NB4[e];
        if ((tiles[j] & MASK_MOVE) !== 0) continue;
        if (mark[j] === markA) return true;
        if (mark[j] !== markB) { mark[j] = markB; queueB[tailB++] = j; }
      }
    }
    return false;
  };
  // A probe walls the tile for a moment and puts back the byte it held (only floor is ever probed, but a LOW tile turned
  // into floor by a careless restore would open a fence).
  const sealed = (t: number): boolean => {
    pocket.length = 0;
    const saved = tiles[t];
    tiles[t] = TILE_WALL;
    const bigStart: number[] = [];
    let ok = true;
    markNow++;
    mark[t] = markNow;
    for (let d = 0; d < 4 && ok; d++) {
      const s = t + NB4[d];
      if ((tiles[s] & MASK_MOVE) !== 0 || mark[s] === markNow) continue;
      let head = 0, tail = 0, small = true, joined = false;
      queue[tail++] = s;
      mark[s] = markNow;
      while (head < tail && !joined) {
        if (tail > POCKET_MAX) { small = false; break; }
        const i = queue[head++];
        for (let e = 0; e < 4; e++) {
          const j = i + NB4[e];
          if ((tiles[j] & MASK_MOVE) !== 0) continue;
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
      // A ruin's interior takes rocks only one by one within its quota, so no pocket inside it is walled up wholesale.
      for (let k = 0; k < tail && ok; k++) if (!open[queue[k]] || prot[queue[k]] || soft[queue[k]] || ring[queue[k]] === 1 || ruinOf[queue[k]] !== 0) ok = false;
      if (ok) for (let k = 0; k < tail; k++) pocket.push(queue[k]);
    }
    // Hitting the cap on two sides does not say they are one piece: walk out from both until they meet or one
    // runs dry (the smaller piece bounds the work).
    for (let k = 1; ok && k < bigStart.length; k++) ok = joins(bigStart[0], bigStart[k]);
    tiles[t] = saved;
    return ok && bigStart.length > 0;
  };

  // Tiles that can never take a rock: protected ones, and those whose rock would split the floor in the map as it
  // stands (a corridor between two walls). A corridor made only of them cannot be cut, whatever else is built.
  const dead = new Uint8Array(N);
  for (let t = 0; t < N; t++) {
    if (!open[t]) continue;
    if (prot[t] || (ruinOf[t] !== 0 && ruinQuota[ruinOf[t]] <= 0)) { dead[t] = 1; continue; }
    let mask = 0;
    for (let q = 0; q < 8; q++) if ((tiles[t + RING_OFF[q]] & MASK_MOVE) === 0) mask |= 1 << q;
    if ((tiles[t] & MASK_MOVE) === 0 && !SIMPLE[mask] && !sealed(t)) dead[t] = 1;
  }

  const hits = new Int32Array(N);
  const work: number[] = [];
  let longLanes = 0;
  const seen = new Int32Array(N);
  let seenNow = 0;
  // Long corridors, per strip s (between lines s and s + 1), as [from, to] distances along the lines.
  const slotCount = new Uint8Array(lines), slotA = new Float64Array(lines * LANE_SLOTS), slotZ = new Float64Array(lines * LANE_SLOTS);

  // First position on line l whose tile ends after distance a.
  // Tiles are spread evenly enough along a line that a guess by interpolation lands within a step or two of the answer.
  const firstAfter = (l: number, a: number): number => {
    const base = lineStart[l], n = lineStart[l + 1] - base, eb = base + l;
    const e0 = edge[eb], en = edge[eb + n];
    let p = a <= e0 ? 0 : a >= en ? n : Math.floor(((a - e0) * n) / (en - e0));
    while (p > 0 && edge[eb + p] > a) p--;
    while (p < n && edge[eb + p + 1] <= a) p++;
    return p;
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
  let rA = new Float64Array(128), rB = new Float64Array(128), cA = new Float64Array(128), cB = new Float64Array(128);

  // Open stretches of line after line; a strip's corridors are where the stretches of its two lines overlap.
  // Corridors with the fewest tiles a rock may stand on are cut first, while the map is still open.
  const firstSlack: number[] = [];
  {
    // One byte per tile for the scan, which reads millions of lattice entries: 0 closed, 1 open, 2 open and dead.
    const state = new Uint8Array(N);
    for (let t = 0; t < N; t++) state[t] = open[t] === 0 ? 0 : dead[t] === 1 ? 2 : 1;
    let dA = new Float64Array(16), dB = new Float64Array(16), eA = new Float64Array(16), eB = new Float64Array(16);
    let prevRuns = 0, prevDead = 0;
    for (let l = 0; l < lines; l++) {
      const base = lineStart[l], n = lineStart[l + 1] - base, eb = base + l;
      // open stretches, and stretches of dead tiles longer than a corridor may be
      let count = 0, deadCount = 0;
      if (n >= minRun) {
        // `a` is where the open stretch under way began (one past the last closed tile). Most stretches stay shorter
        // than minRun tiles, so the loop only moves `a`; one that reaches minRun is walked to its end, kept, and searched
        // for stretches of dead tiles (which only lie inside open ones) of minRun tiles or more.
        let a = 0;
        for (let p = 0; p < n; p++) {
          a = state[tile[base + p]] === 0 ? p + 1 : a;
          if (p + 1 - a < minRun) continue;
          let e = p + 1;
          while (e < n && state[tile[base + e]] !== 0) e++;
          cA[count] = edge[eb + a]; cB[count++] = edge[eb + e];
          let d = a;
          for (let q = a; q <= e; q++) {
            if (q < e && state[tile[base + q]] === 2) continue;
            if (q - d >= minRun && edge[eb + q] - edge[eb + d] > limit) {
              if (deadCount >= 16) return COVER_DEAD;
              eA[deadCount] = edge[eb + d]; eB[deadCount++] = edge[eb + q];
            }
            d = q + 1;
          }
          p = e;
          a = e + 1;
        }
      }
      if (l > 0 && pairOK[l - 1] === 1) {
        // a stretch of dead tiles in both lines that overlaps for more than a corridor may be: no rock will ever cut it
        for (let i = 0, j = 0; i < prevDead && j < deadCount;) {
          if (Math.min(dB[i], eB[j]) - Math.max(dA[i], eA[j]) > limit) return COVER_DEAD;
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
      // this line's runs become the previous line's: swap the buffers rather than copy them
      let tmp = rA; rA = cA; cA = tmp;
      tmp = rB; rB = cB; cB = tmp;
      tmp = dA; dA = eA; eA = tmp;
      tmp = dB; dB = eB; eB = tmp;
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
      const l = tileLine[q];
      // Nearly every strip has no long corridor left: skip the lane geometry (a cache miss into the big tables) then.
      if (slotCount[l] === 0 && (l === 0 || slotCount[l - 1] === 0)) continue;
      const p = tilePos[q];
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
  for (let i = 0; i < N; i++) if (ring[i]) { ringList.push(i); if ((tiles[i] & MASK_MOVE) === 0) ringFloor++; }
  // The ring road is the one corridor every region shares: it must stay a single piece touching all five.
  const ringKeeps = (t: number): boolean => {
    const saved = tiles[t];
    tiles[t] = TILE_WALL;
    let seed = -1;
    for (let q = 0; q < ringList.length; q++) if ((tiles[ringList[q]] & MASK_MOVE) === 0) { seed = ringList[q]; break; }
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
          if (ring[j] === 1 && (tiles[j] & MASK_MOVE) === 0 && ringMark[j] !== ringNow) { ringMark[j] = ringNow; queue[tail++] = j; }
        }
      }
    }
    tiles[t] = saved;
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
      for (let yy = ruinBox[rb + 1]; yy <= ruinBox[rb + 3]; yy++) if ((tiles[yy * W + x] & MASK_MOVE) === 0) col++;
      for (let xx = ruinBox[rb]; xx <= ruinBox[rb + 2]; xx++) if ((tiles[y * W + xx] & MASK_MOVE) === 0) row++;
      if (col <= 3 || row <= 3) return NEVER;
    }
    let lvl = soft[t] ? 3 : 0, mask = 0;
    for (let q = 0; q < 8; q++) {
      const j = t + RING_OFF[q];
      const r = rockOf[j];
      if (r !== 0 && r !== rock && lvl < 1) lvl = 1;
      if ((tiles[j] & MASK_MOVE) === 0) mask |= 1 << q;
    }
    if (lvl < 2 && (tiles[t] & MASK_MOVE) === 0 && !guardOK(t)) lvl = 2;
    if ((tiles[t] & MASK_MOVE) === 0 && !SIMPLE[mask]) {
      if (lvl < 2) lvl = 2;
      if (lvl > worst || score - penalty(lvl) <= beat || !sealed(t)) return NEVER;
    }
    if (lvl > worst) return NEVER;
    if (ring[t] === 1 && (tiles[t] & MASK_MOVE) === 0 && !ringKeeps(t)) { ringBlocked[t] = 1; return NEVER; }
    return lvl;
  };
  const priority = (t: number): number => hits[t] * 1024 + noise[t];

  let rocks = 0;
  const setRock = (t: number): void => {
    if (ring[t] === 1 && (tiles[t] & MASK_MOVE) === 0) ringFloor--;
    tiles[t] = TILE_WALL;
    rockOf[t] = rocks;
    ruinQuota[ruinOf[t]]--;
    wall(t);
  };
  const place = (t: number, lvl: number): void => {
    rocks++;
    let fill: number[] = [];
    if (lvl >= 2 && (tiles[t] & MASK_MOVE) === 0) {
      let mask = 0;
      for (let q = 0; q < 8; q++) if ((tiles[t + RING_OFF[q]] & MASK_MOVE) === 0) mask |= 1 << q;
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

  while (work.length > 0) if (!cut(work.pop()!)) return COVER_UNCUT;
  if (longLanes !== 0) return COVER_UNCUT;

  // No shot from one spawn can hit another within MAX_SIGHT_CORRIDOR: every aim ray in the hit cone of each (see Cone)
  // must meet a wall first. Where it does not, a rock goes on the tile that closes most of the gaps, near the middle.
  if (spawns !== null) {
    const reach2 = (MAX_SIGHT_CORRIDOR / TILE) * (MAX_SIGHT_CORRIDOR / TILE) + LANE_EPS;
    for (let i = 0; i < spawns.length; i++) {
      for (let j = i + 1; j < spawns.length; j++) {
        if (d2(spawns[i], spawns[j]) > reach2) continue;
        const ax = spawns[i].x + 0.5, ay = spawns[i].y + 0.5, bx = spawns[j].x + 0.5, by = spawns[j].y + 0.5;
        const cones = [makeCone(ax, ay, bx, by), makeCone(bx, by, ax, ay)];
        const box = coneBox(cones[0], bx, by);
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
        // Rocks only add cover, so a pair that is safe stays safe and one pass over the pairs is enough.
        for (;;) {
          let before = 0;
          for (const c of cones) {
            coneGaps(tiles, c, box);
            for (let g = 0; g < c.gaps.length; g += 2) before += (c.gaps[g + 1] - c.gaps[g]) / (2 * c.t);
          }
          if (before === 0) break;
          let best = -1, bestKey = Infinity, bestMid = Infinity, bestLvl = NEVER;
          for (let ty = box[1]; ty <= box[3]; ty++) {
            for (let tx = box[0]; tx <= box[2]; tx++) {
              const t = ty * W + tx;
              if ((tiles[t] & MASK_SIGHT) !== 0) continue;
              // the share of the cones' slopes still open if this tile were a rock
              let left = 0;
              for (const c of cones) {
                const cut = tileSlopes(c, tx, ty);
                for (let g = 0; g < c.gaps.length; g += 2) {
                  const from = c.gaps[g], to = c.gaps[g + 1];
                  left += (to - from - (cut ? Math.max(0, Math.min(to, tileSlope[1]) - Math.max(from, tileSlope[0])) : 0)) / (2 * c.t);
                }
              }
              if (left >= before - LANE_EPS) continue;
              const lvl = levelOf(t, rocks + 1, 3);
              if (lvl === NEVER) continue;
              // a rock that closes every gap beats one that closes part (the most first); then the preferred layout; then the middle
              const key = (left <= LANE_EPS ? 0 : 1 + Math.ceil(left * 20)) * 16 + lvl;
              const ox = tx + 0.5 - mx, oy = ty + 0.5 - my, mid = ox * ox + oy * oy;
              if (key < bestKey || (key === bestKey && mid < bestMid)) { best = t; bestKey = key; bestMid = mid; bestLvl = lvl; }
            }
          }
          if (best < 0) return COVER_SPAWN;
          place(best, bestLvl);
        }
      }
    }
  }
  return rocks;
}
