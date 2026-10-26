// Property tests for generateMap (Map v2). Everything here is derived from the map.ts contract, the
// Phase 8b spec and the anti-kiting cover spec, never from the generator's internals. The 200 maps are
// generated once and shared.
import { describe, expect, it, vi } from "vitest";
import { EXTRACT_RADIUS, MAP_TILES_H, MAP_TILES_W, MAX_PLAYERS, MAX_SIGHT_CORRIDOR, MOB_LEASH_RADIUS, RANGED_HIT_REACH, SIGHT_CORRIDOR_WIDTH, TILE } from "../src/constants";
import { WEAPONS } from "../src/weapons";
import {
  REGION_COLISEUM,
  REGION_FACTIONS,
  REGION_IDS,
  REGION_NONE,
  REGION_WEAPONS,
  TILE_FLOOR,
  TILE_WALL,
  isWallTile,
  regionAtTile,
  tileToWorldCenter,
  withGates,
  worldToTile,
} from "../src/map";
import type { FactionRegionDef, GameMap, GateSide, MobCampDef, RegionFaction, TilePt, TileRect } from "../src/map";
import { raycast } from "../src/geometry";
import * as mapgenExports from "../src/mapgen";
import { generateMap, longestLane } from "../src/mapgen";
import type { Vec2 } from "../src/messages";
import { findPath } from "../src/pathfind";
import { mulberry32, randInt } from "../src/rng";

/** Open tiles between the border ring and ruins/obstacles (v1 constant; the spec keeps it). */
const EDGE_CLEAR = 3;

const seeds = (n: number, from = 0) => Array.from({ length: n }, (_, i) => from + i);
const SEEDS = seeds(200);
/** Timeout for tests that touch many generated maps: the first one to run pays for generating all 200 (about 6 s alone), and the full suite runs under CPU contention. */
const HEAVY_MS = 60_000;

const cache = new Map<number, GameMap>();
/** Cached generation: tests below must treat these maps as read-only. */
function mapFor(seed: number): GameMap {
  let m = cache.get(seed);
  if (!m) {
    m = generateMap(seed);
    cache.set(seed, m);
  }
  return m;
}
function eachMap(fn: (m: GameMap, seed: number) => void, list: number[] = SEEDS): void {
  for (const s of list) fn(mapFor(s), s);
}

const DIRS4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const tileOf = (p: Vec2): TilePt => ({ x: worldToTile(p.x), y: worldToTile(p.y) });
const isTileCentre = (p: Vec2) => p.x === tileToWorldCenter(worldToTile(p.x)) && p.y === tileToWorldCenter(worldToTile(p.y));
const ptKey = (p: Vec2) => `${p.x},${p.y}`;
const isFloorTile = (m: GameMap, tx: number, ty: number) => !isWallTile(m, tx, ty);
const inRect = (b: TileRect, tx: number, ty: number) => tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
const inAnyBuilding = (m: GameMap, tx: number, ty: number) => m.buildings.some((b) => inRect(b, tx, ty));
const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const regionOfPoint = (m: GameMap, p: Vec2) => regionAtTile(m, worldToTile(p.x), worldToTile(p.y));
const R0 = (m: GameMap) => Math.min(m.w, m.h) / 2;
const isFactionCode = (c: number) => c >= 1 && c <= REGION_FACTIONS.length;
const regionDef = (m: GameMap, id: RegionFaction): FactionRegionDef => m.regions.find((r) => r.id === id)!;

function clear3x3(m: GameMap, tx: number, ty: number): boolean {
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (!isFloorTile(m, tx + i, ty + j)) return false;
  return true;
}

/** Marks every floor tile 4-connected to `start` (through tiles that pass `allow`) in `seen`. */
function flood(m: GameMap, tiles: Uint8Array, start: number, allow: (i: number) => boolean, seen: Uint8Array): void {
  if (tiles[start] !== TILE_FLOOR || !allow(start) || seen[start]) return;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % m.w, y = (c - x) / m.w;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
      const j = ny * m.w + nx;
      if (tiles[j] === TILE_FLOOR && !seen[j] && allow(j)) { seen[j] = 1; stack.push(j); }
    }
  }
}

function reachFrom(m: GameMap, tiles: Uint8Array, start: number, allow: (i: number) => boolean = () => true): Uint8Array {
  const seen = new Uint8Array(m.w * m.h);
  flood(m, tiles, start, allow, seen);
  return seen;
}

function componentCount(m: GameMap, tiles: Uint8Array, allow: (i: number) => boolean = () => true): number {
  const seen = new Uint8Array(m.w * m.h);
  let comps = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE_FLOOR || !allow(i) || seen[i]) continue;
    comps++;
    flood(m, tiles, i, allow, seen);
  }
  return comps;
}

const tileIdx = (m: GameMap, p: TilePt) => p.y * m.w + p.x;
const centreIdx = (m: GameMap) => tileIdx(m, tileOf(m.coliseum.centre));
const gateTileSet = (m: GameMap) => new Set(m.coliseum.gates.flatMap((g) => g.tiles.map((t) => tileIdx(m, t))));

const fpDistCache = new WeakMap<GameMap, Uint8Array>();
/** Chebyshev distance to the nearest coliseum-footprint tile: 0 on the footprint, 255 beyond 6. */
function footprintDist(m: GameMap): Uint8Array {
  let d = fpDistCache.get(m);
  if (d) return d;
  d = new Uint8Array(m.w * m.h).fill(255);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.regionGrid[y * m.w + x] !== REGION_COLISEUM) continue;
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue;
          const j = ny * m.w + nx;
          const c = Math.max(Math.abs(dx), Math.abs(dy));
          if (c < d[j]) d[j] = c;
        }
      }
    }
  }
  fpDistCache.set(m, d);
  return d;
}

const sectorAngleCache = new WeakMap<GameMap, number[]>();
/** Direction (radians) of each faction's floor centroid from the map centre, in REGION_FACTIONS order. */
function sectorAngles(m: GameMap): number[] {
  let a = sectorAngleCache.get(m);
  if (a) return a;
  const sums = REGION_FACTIONS.map(() => [0, 0]);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x;
      const code = m.regionGrid[i];
      if (!isFactionCode(code) || m.tiles[i] !== TILE_FLOOR) continue;
      sums[code - 1][0] += x + 0.5 - m.w / 2;
      sums[code - 1][1] += y + 0.5 - m.h / 2;
    }
  }
  a = sums.map(([sx, sy]) => Math.atan2(sy, sx));
  sectorAngleCache.set(m, a);
  return a;
}

/** Factions in angular order around the map centre. */
function sectorOrder(m: GameMap): RegionFaction[] {
  const ang = sectorAngles(m);
  return REGION_FACTIONS.map((f, i) => ({ f, a: ang[i] })).sort((p, q) => p.a - q.a).map((p) => p.f);
}

const regionCodeOf = (f: RegionFaction) => REGION_IDS.indexOf(f);

/** Floor runs along each side of a building's outer wall ring: side 0 top, 1 right, 2 bottom, 3 left. */
function doorRuns(m: GameMap, b: TileRect): { side: number; start: number; len: number }[] {
  const runs: { side: number; start: number; len: number }[] = [];
  for (let side = 0; side < 4; side++) {
    const len = side % 2 === 0 ? b.w : b.h;
    let runStart = -1;
    for (let i = 0; i <= len; i++) {
      let floor = false;
      if (i < len) {
        const tx = side === 0 || side === 2 ? b.x + i : side === 1 ? b.x + b.w - 1 : b.x;
        const ty = side === 1 || side === 3 ? b.y + i : side === 0 ? b.y : b.y + b.h - 1;
        floor = isFloorTile(m, tx, ty);
      }
      if (floor && runStart < 0) runStart = i;
      if (!floor && runStart >= 0) { runs.push({ side, start: runStart, len: i - runStart }); runStart = -1; }
    }
  }
  return runs;
}

function doorTiles(m: GameMap, b: TileRect): TilePt[] {
  const out: TilePt[] = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const ring = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
      if (ring && isFloorTile(m, x, y)) out.push({ x, y });
    }
  }
  return out;
}

interface Blob { x0: number; y0: number; x1: number; y1: number; size: number; tiles: TilePt[]; code: number; touchesNone: boolean }

/**
 * Outdoor wall blobs: 8-connected wall components inside a faction region that are not in a ruin. They are
 * the obstacle chunks and the anti-kiting rocks, which the output cannot tell apart. `touchesNone` marks
 * blobs against a ridge or the border, and the pockets that the connectivity pass walls off.
 */
function outdoorWallBlobs(m: GameMap): Blob[] {
  const seen = new Uint8Array(m.w * m.h);
  const blobs: Blob[] = [];
  const outdoorWall = (x: number, y: number) =>
    x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1 &&
    m.tiles[y * m.w + x] === TILE_WALL && isFactionCode(m.regionGrid[y * m.w + x]) && !inAnyBuilding(m, x, y);
  for (let y = 1; y < m.h - 1; y++) {
    for (let x = 1; x < m.w - 1; x++) {
      if (!outdoorWall(x, y) || seen[y * m.w + x]) continue;
      const c: Blob = { x0: x, y0: y, x1: x, y1: y, size: 0, tiles: [], code: m.regionGrid[y * m.w + x], touchesNone: false };
      const stack = [[x, y]];
      seen[y * m.w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        c.size++;
        c.tiles.push({ x: cx, y: cy });
        c.x0 = Math.min(c.x0, cx); c.x1 = Math.max(c.x1, cx);
        c.y0 = Math.min(c.y0, cy); c.y1 = Math.max(c.y1, cy);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (m.regionGrid[ny * m.w + nx] === REGION_NONE) c.touchesNone = true;
            if (outdoorWall(nx, ny) && !seen[ny * m.w + nx]) { seen[ny * m.w + nx] = 1; stack.push([nx, ny]); }
          }
        }
      }
      blobs.push(c);
    }
  }
  return blobs;
}

/** Tile coordinates whose centre lies within the camp's clearing radius. */
function clearingTiles(m: GameMap, c: MobCampDef): TilePt[] {
  const out: TilePt[] = [];
  const x0 = worldToTile(c.x - c.r) - 1, x1 = worldToTile(c.x + c.r) + 1;
  const y0 = worldToTile(c.y - c.r) - 1, y1 = worldToTile(c.y + c.r) + 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (Math.hypot(tileToWorldCenter(tx) - c.x, tileToWorldCenter(ty) - c.y) <= c.r + 1e-9) out.push({ x: tx, y: ty });
    }
  }
  return out;
}

const GATE_OUT: Record<GateSide, readonly [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/**
 * The tiles the cover pass must leave alone in front of and behind every gate: 3 deep inside (gate width)
 * and 3 deep outside, one tile wider on each side.
 */
function gateLaneTiles(m: GameMap): TilePt[] {
  const out: TilePt[] = [];
  for (const g of m.coliseum.gates) {
    const [ox, oy] = GATE_OUT[g.side];
    for (const t of g.tiles) for (let k = -3; k <= 3; k++) if (k !== 0) out.push({ x: t.x + ox * k, y: t.y + oy * k });
    const first = g.tiles[0], last = g.tiles[g.tiles.length - 1];
    const ux = Math.sign(last.x - first.x), uy = Math.sign(last.y - first.y);
    for (const [e, dir] of [[first, -1], [last, 1]] as const) {
      for (let k = 1; k <= 3; k++) out.push({ x: e.x + ox * k + ux * dir, y: e.y + oy * k + uy * dir });
    }
  }
  return out;
}

/** A ruin door: the floor tile in its wall ring, with the tiles just outside and just inside it. */
function ruinDoors(m: GameMap, b: TileRect): { door: TilePt; outside: TilePt; inside: TilePt }[] {
  const x1 = b.x + b.w - 1, y1 = b.y + b.h - 1;
  return doorTiles(m, b).map((d) => {
    if (d.y === b.y) return { door: d, outside: { x: d.x, y: d.y - 1 }, inside: { x: d.x, y: d.y + 1 } };
    if (d.y === y1) return { door: d, outside: { x: d.x, y: d.y + 1 }, inside: { x: d.x, y: d.y - 1 } };
    if (d.x === b.x) return { door: d, outside: { x: d.x - 1, y: d.y }, inside: { x: d.x + 1, y: d.y } };
    return { door: d, outside: { x: d.x + 1, y: d.y }, inside: { x: d.x - 1, y: d.y } };
  });
}

/**
 * Partitions of a ruin: a row or column through the middle of the interior (v1 puts them at least 3 tiles
 * from the interior edge, in an interior at least 7 wide) that is wall except for one two-tile gap. Cover
 * can put furniture inside a ruin, so "has an interior wall" no longer means "has a partition"; a straight
 * wall run across the whole interior with exactly one two-tile gap does. Branch partitions are not found.
 * `across` is the unit step perpendicular to the wall, to the tiles on either side of a gap.
 */
function partitionGaps(m: GameMap, b: TileRect): { gap: TilePt[]; across: readonly [number, number] }[] {
  const out: { gap: TilePt[]; across: readonly [number, number] }[] = [];
  const ix0 = b.x + 1, ix1 = b.x + b.w - 2, iy0 = b.y + 1, iy1 = b.y + b.h - 2;
  if (ix1 - ix0 + 1 >= 7) {
    for (let x = ix0 + 3; x <= ix1 - 3; x++) {
      const floor: TilePt[] = [];
      for (let y = iy0; y <= iy1; y++) if (isFloorTile(m, x, y)) floor.push({ x, y });
      if (floor.length === 2 && floor[1].y === floor[0].y + 1) out.push({ gap: floor, across: [1, 0] });
    }
  }
  if (iy1 - iy0 + 1 >= 7) {
    for (let y = iy0 + 3; y <= iy1 - 3; y++) {
      const floor: TilePt[] = [];
      for (let x = ix0; x <= ix1; x++) if (isFloorTile(m, x, y)) floor.push({ x, y });
      if (floor.length === 2 && floor[1].x === floor[0].x + 1) out.push({ gap: floor, across: [0, 1] });
    }
  }
  return out;
}

// ---- Anti-kiting sight-corridor metric (owner decision). Written from the spec text alone, independent of the generator. ----
// One open set bounds every region, the coliseum and the gates at once: a tile is open when it is floor with a
// region other than "none" (on a generated map that is all floor, gates open). For SIGHT_LATTICE.dirs directions
// (angle k*pi/dirs) the lines {p : n.p = j*s} are walked tile by tile with an exact grid traversal
// (Amanatides-Woo), n the normal and s = SIGHT_LATTICE.step tiles, origin at the map corner. A thin lane is a
// maximal run of consecutive open tiles on one line; crossings shorter than 1e-9 (a corner touch, a graze) neither
// break nor extend it. A usable sight corridor, a "lattice lane", is a maximal interval of t = p.d along which BOTH
// of two adjacent lines j and j+1 are in open runs: the overlap of their thin intervals. The generator keeps every
// lattice lane at SIGHT_LATTICE.target tiles or less, which (see the containment test) bounds every strip of
// SIGHT_CORRIDOR_WIDTH at any angle and offset by MAX_SIGHT_CORRIDOR; the exact strip check below tests that directly.
const LANE_EPS = 1e-9;
// Float slack so a corridor of exactly 15 tiles, summed from tile-crossing lengths, never reads as 480.0000001.
const LANE_SLACK_U = 1e-6;
// The canonical lines only catch corridors at least two line spacings wide for certain, so the dense disc check
// is a looser sanity net.
const DISC_SLACK = 1.2;
const DISC_R = SIGHT_CORRIDOR_WIDTH / 2 / TILE;
/** Width of a corridor in tiles. */
const STRIP_W = SIGHT_CORRIDOR_WIDTH / TILE;

interface SightLattice { readonly dirs: number; readonly step: number; readonly target: number }
/**
 * The generator's lattice (directions, line spacing in tiles, lane bound in tiles), read off the module so a missing
 * export fails the tests that need it with a clear message instead of breaking the whole file.
 */
function sightLattice(): SightLattice {
  const l = (mapgenExports as unknown as { SIGHT_LATTICE?: SightLattice }).SIGHT_LATTICE;
  if (!l) throw new Error("mapgen.ts must export SIGHT_LATTICE = { dirs, step, target }");
  return l;
}

const snapZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

function laneMask(m: GameMap, tiles: Uint8Array, keep: (code: number) => boolean): Uint8Array {
  const open = new Uint8Array(m.w * m.h);
  for (let i = 0; i < open.length; i++) open[i] = tiles[i] === TILE_FLOOR && keep(m.regionGrid[i]) ? 1 : 0;
  return open;
}
const factionMask = (m: GameMap) => laneMask(m, m.tiles, isFactionCode);
/** All floor with a region other than none, gates open: faction regions, coliseum and gate tiles. */
const allFloorMask = (m: GameMap) => laneMask(m, m.tiles, (c) => c !== REGION_NONE);
/** Coliseum-region floor; with the gates closed (the sealed fight) the gate tiles are wall. */
const coliseumMask = (m: GameMap, gatesLocked: boolean) =>
  laneMask(m, gatesLocked ? withGates(m).tiles : m.tiles, (c) => c === REGION_COLISEUM);

/** The longest fat lane over `dirs` directions, in tiles. `k` and `o` (offset of the lower line, tiles) locate it for the message. */
function fatLane(open: Uint8Array, w: number, h: number, dirs: number, step: number): { len: number; k: number; o: number } {
  let prev = new Float64Array(1024), cur = new Float64Array(1024); // [start, end] pairs of one line's open runs
  let best = 0, bestK = -1, bestO = 0;
  for (let k = 0; k < dirs; k++) {
    const a = (k * Math.PI) / dirs;
    const dx = snapZero(Math.cos(a)), dy = snapZero(Math.sin(a));
    const nx = -dy, ny = dx;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : 1 / Math.abs(dx), tdy = dy === 0 ? Infinity : 1 / Math.abs(dy);
    const corners = [0, nx * w, ny * h, nx * w + ny * h];
    const jMin = Math.ceil(Math.min(...corners) / step), jMax = Math.floor(Math.max(...corners) / step);

    /** Writes line j's open runs as [start, end] pairs (t = p.d, a distance along the unit direction) into `out`; returns how many. */
    const walk = (j: number, out: Float64Array): number => {
      const bx = j * step * nx, by = j * step * ny;
      let t0 = -Infinity, t1 = Infinity;
      if (dx !== 0) {
        const p = -bx / dx, q = (w - bx) / dx;
        t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q));
      } else if (bx < 0 || bx > w) return 0;
      if (dy !== 0) {
        const p = -by / dy, q = (h - by) / dy;
        t0 = Math.max(t0, Math.min(p, q)); t1 = Math.min(t1, Math.max(p, q));
      } else if (by < 0 || by > h) return 0;
      if (!(t1 - t0 > LANE_EPS)) return 0;
      // The first tile is picked a hair inside the map; the border ring is wall, so it cannot start a lane.
      const e = Math.min(1e-7, (t1 - t0) / 2);
      let cx = Math.min(w - 1, Math.max(0, Math.floor(bx + (t0 + e) * dx)));
      let cy = Math.min(h - 1, Math.max(0, Math.floor(by + (t0 + e) * dy)));
      let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? cx + 1 : cx) - bx) / dx;
      let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? cy + 1 : cy) - by) / dy;
      let t = t0, runStart = NaN, runEnd = 0, n = 0; // t is negative on half the lines, so NaN (not -1) marks "no run"
      for (;;) {
        const tn = Math.min(tMaxX, tMaxY, t1);
        if (tn - t >= LANE_EPS) {
          if (open[cy * w + cx]) {
            if (Number.isNaN(runStart)) runStart = t;
            runEnd = tn;
          } else if (!Number.isNaN(runStart)) {
            if (n < 500) { out[2 * n] = runStart; out[2 * n + 1] = runEnd; n++; }
            runStart = NaN;
          }
        }
        if (tn >= t1) break;
        if (tMaxX < tMaxY) { cx += sx; tMaxX += tdx; } else { cy += sy; tMaxY += tdy; }
        t = tn;
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) break;
      }
      if (!Number.isNaN(runStart) && n < 500) { out[2 * n] = runStart; out[2 * n + 1] = runEnd; n++; }
      return n;
    };

    let prevN = 0; // lines outside the map have no runs, so the first and last pairs need no special case
    for (let j = jMin; j <= jMax; j++) {
      const n = walk(j, cur);
      for (let i = 0, q = 0; i < n && q < prevN;) {
        const lo = Math.max(cur[2 * i], prev[2 * q]), hi = Math.min(cur[2 * i + 1], prev[2 * q + 1]);
        if (hi - lo > best) { best = hi - lo; bestK = k; bestO = (j - 1) * step; }
        if (cur[2 * i + 1] < prev[2 * q + 1]) i++; else q++;
      }
      const tmp = prev; prev = cur; cur = tmp; prevN = n;
    }
  }
  return { len: best, k: bestK, o: bestO };
}

/**
 * Earliest t >= 0 at which a disc of radius r centred at (px, py) + t*(dx, dy) overlaps the closed tile square
 * [qx, qx+1] x [qy, qy+1] (touching does not count); Infinity if it never does. The blocked region is the tile
 * grown by r: two boxes plus four corner discs.
 */
function discHitsTile(px: number, py: number, dx: number, dy: number, qx: number, qy: number, r: number): number {
  let best = Infinity;
  for (let pass = 0; pass < 2; pass++) {
    const x0 = pass === 0 ? qx - r : qx, x1 = pass === 0 ? qx + 1 + r : qx + 1;
    const y0 = pass === 0 ? qy : qy - r, y1 = pass === 0 ? qy + 1 : qy + 1 + r;
    let lo = -Infinity, hi = Infinity, miss = false;
    if (dx === 0) { if (px <= x0 || px >= x1) miss = true; }
    else { const p = (x0 - px) / dx, q = (x1 - px) / dx; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
    if (!miss) {
      if (dy === 0) { if (py <= y0 || py >= y1) miss = true; }
      else { const p = (y0 - py) / dy, q = (y1 - py) / dy; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
    }
    if (!miss && lo < hi && hi > 0) best = Math.min(best, Math.max(lo, 0));
  }
  for (let c = 0; c < 4; c++) {
    const fx = px - (qx + (c & 1)), fy = py - (qy + (c >> 1));
    const b = fx * dx + fy * dy, disc = b * b - (fx * fx + fy * fy - r * r);
    if (disc > 0) {
      const sq = Math.sqrt(disc);
      if (-b + sq > 0) best = Math.min(best, Math.max(-b - sq, 0));
    }
  }
  return best;
}

/**
 * How far a disc of radius r, starting at the centre of open tile (cx, cy), can travel along (dx, dy) before any
 * point of it is in a non-open tile, in tiles. Walks the tiles the centre crosses; a blocking tile is always in
 * the 3x3 around one of them, and `near` marks the tiles that have a non-open tile in that 3x3.
 */
function discReach(open: Uint8Array, near: Uint8Array, w: number, h: number, cx: number, cy: number, dx: number, dy: number, r: number): number {
  const px = cx + 0.5, py = cy + 0.5;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx === 0 ? Infinity : 1 / Math.abs(dx), tdy = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let tMaxX = 0.5 * tdx, tMaxY = 0.5 * tdy; // half a tile to the first edge
  let t = 0, tBlock = Infinity;
  for (;;) {
    if (t >= tBlock) return tBlock;
    const tn = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (near[cy * w + cx]) {
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const x = cx + i, y = cy + j;
          if (x < 0 || y < 0 || x >= w || y >= h || !open[y * w + x]) tBlock = Math.min(tBlock, discHitsTile(px, py, dx, dy, x, y, r));
        }
      }
    }
    if (tn - t >= LANE_EPS && !open[cy * w + cx]) return Math.min(tBlock, t);
    if (tMaxX < tMaxY) { cx += sx; tMaxX += tdx; } else { cy += sy; tMaxY += tdy; }
    t = tn;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return Math.min(tBlock, t);
  }
}

/**
 * The longest straight segment, through any open tile centre in `dirs` directions over [0, pi), along which a disc
 * of radius r stays on open tiles, in tiles. A sanity net next to the canonical fat lanes.
 */
function denseDisc(open: Uint8Array, w: number, h: number, r: number, dirs = 64): { len: number; x: number; y: number; k: number } {
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let j = -1; j <= 1 && !near[y * w + x]; j++) {
        for (let i = -1; i <= 1; i++) {
          const nx = x + i, ny = y + j;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open[ny * w + nx]) { near[y * w + x] = 1; break; }
        }
      }
    }
  }
  let best = 0, bx = -1, by = -1, bk = -1;
  for (let k = 0; k < dirs; k++) {
    const a = (k * Math.PI) / dirs;
    const dx = snapZero(Math.cos(a)), dy = snapZero(Math.sin(a));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!open[y * w + x]) continue;
        const len = discReach(open, near, w, h, x, y, dx, dy, r) + discReach(open, near, w, h, x, y, -dx, -dy, r);
        if (len > best) { best = len; bx = x; by = y; bk = k; }
      }
    }
  }
  return { len: best, x: bx, y: by, k: bk };
}

type Corridor = { len: number; k: number; o: number };
const openLaneCache = new Map<number, Corridor>();
const sealedLaneCache = new Map<number, Corridor>();
/** Longest lattice lane over all floor (gates open) of the (cached) map for `seed`; shared by the tests below. */
function openLane(seed: number): Corridor {
  let r = openLaneCache.get(seed);
  if (!r) {
    const m = mapFor(seed);
    const { dirs, step } = sightLattice();
    r = fatLane(allFloorMask(m), m.w, m.h, dirs, step);
    openLaneCache.set(seed, r);
  }
  return r;
}
/** Longest lattice lane inside the coliseum with its gates closed (implied by the open set, but cheap to pin on its own). */
function sealedLane(seed: number): Corridor {
  let r = sealedLaneCache.get(seed);
  if (!r) {
    const m = mapFor(seed);
    const { dirs, step } = sightLattice();
    r = fatLane(coliseumMask(m, true), m.w, m.h, dirs, step);
    sealedLaneCache.set(seed, r);
  }
  return r;
}

/**
 * The longest strip of width `wt` tiles, at any angle and offset, whose interior meets no blocked tile (a port of the
 * review's exact checker). Angles are `thetas` (radians) and the strip offsets are `ostep` tiles apart. For one angle
 * every blocked tile is clipped against each slab {lo <= n.p <= hi} (n the normal) it meets, which gives the stretch
 * of the slab's axis (d.p) that tile blocks; a free strip is a gap between those stretches. Slabs are shrunk by 1e-7
 * so a wall that only touches the strip's side does not count. Returns tiles; sampling only ever under-reports.
 */
function longestFreeStrip(blocked: Uint8Array, w: number, h: number, wt: number, thetas: readonly number[], ostep: number): { len: number; deg: number } {
  const bx: number[] = [], by: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (blocked[y * w + x]) { bx.push(x); by.push(y); }
  const nb = bx.length;
  const SHRINK = 1e-7;
  const range = new Float64Array(2);
  const i0s = new Int32Array(nb), i1s = new Int32Array(nb);
  let best = 0, bestDeg = 0;
  for (const th of thetas) {
    const dx = Math.cos(th), dy = Math.sin(th), nx = -dy, ny = dx;
    const oMin = Math.min(0, nx * w, ny * h, nx * w + ny * h) - wt, oMax = Math.max(0, nx * w, ny * h, nx * w + ny * h);
    const nO = Math.ceil((oMax - oMin) / ostep) + 1;
    // Two passes build, per slab, the list of stretches its tiles block (counting first, then filling).
    const start = new Int32Array(nO + 1);
    for (let t = 0; t < nb; t++) {
      const p0 = nx * bx[t] + ny * by[t];
      const pmin = Math.min(p0, p0 + nx, p0 + ny, p0 + nx + ny), pmax = Math.max(p0, p0 + nx, p0 + ny, p0 + nx + ny);
      const i0 = Math.max(0, Math.floor((pmin - wt - oMin) / ostep)), i1 = Math.min(nO - 1, Math.ceil((pmax - oMin) / ostep));
      i0s[t] = i0; i1s[t] = i1;
      for (let i = i0; i <= i1; i++) start[i + 1]++;
    }
    for (let i = 0; i < nO; i++) start[i + 1] += start[i];
    const from = new Float64Array(start[nO]), to = new Float64Array(start[nO]);
    const fill = start.slice(0, nO);
    for (let t = 0; t < nb; t++) {
      for (let i = i0s[t]; i <= i1s[t]; i++) {
        const lo = oMin + i * ostep + SHRINK, hi = oMin + i * ostep + wt - SHRINK;
        if (clipSquare(bx[t], by[t], nx, ny, dx, dy, lo, hi, range)) { const f = fill[i]++; from[f] = range[0]; to[f] = range[1]; }
      }
    }
    for (let i = 0; i < nO; i++) {
      const a = start[i], b = fill[i];
      if (b - a < 2) continue;
      for (let p = a + 1; p < b; p++) { // insertion sort by start: the lists are short
        const f = from[p], e = to[p];
        let q = p - 1;
        while (q >= a && from[q] > f) { from[q + 1] = from[q]; to[q + 1] = to[q]; q--; }
        from[q + 1] = f; to[q + 1] = e;
      }
      let reach = to[a];
      for (let p = a + 1; p < b; p++) {
        if (from[p] - reach > best) { best = from[p] - reach; bestDeg = (th * 180) / Math.PI; }
        if (to[p] > reach) reach = to[p];
      }
    }
  }
  return { len: best, deg: bestDeg };
}

const sqX = new Float64Array(4), sqY = new Float64Array(4), sqV = new Float64Array(4); // scratch: no allocation per call
/** Range of d.p over the unit square at (x, y) clipped to {lo <= n.p <= hi}; false if the open slab misses its interior. */
function clipSquare(x: number, y: number, nx: number, ny: number, dx: number, dy: number, lo: number, hi: number, out: Float64Array): boolean {
  // Corners (x,y) (x+1,y) (x+1,y+1) (x,y+1).
  sqX[0] = x; sqX[1] = x + 1; sqX[2] = x + 1; sqX[3] = x;
  sqY[0] = y; sqY[1] = y; sqY[2] = y + 1; sqY[3] = y + 1;
  let vmin = Infinity, vmax = -Infinity;
  for (let c = 0; c < 4; c++) {
    const v = nx * sqX[c] + ny * sqY[c];
    sqV[c] = v;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!(vmin < hi && vmax > lo)) return false;
  let mn = Infinity, mx = -Infinity;
  // The clipped polygon's vertices: corners inside the slab, and where the slab's two edges cut the square's sides.
  for (let c = 0; c < 4; c++) {
    if (sqV[c] >= lo && sqV[c] <= hi) {
      const u = dx * sqX[c] + dy * sqY[c];
      if (u < mn) mn = u;
      if (u > mx) mx = u;
    }
    const d = (c + 1) & 3;
    for (let side = 0; side < 2; side++) {
      const bound = side === 0 ? lo : hi;
      const fa = sqV[c] - bound, fb = sqV[d] - bound;
      if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
        const t = fa / (fa - fb);
        const u = dx * (sqX[c] + t * (sqX[d] - sqX[c])) + dy * (sqY[c] + t * (sqY[d] - sqY[c]));
        if (u < mn) mn = u;
        if (u > mx) mx = u;
      }
    }
  }
  out[0] = mn;
  out[1] = mx;
  return mn <= mx;
}

/** Length in world units of the findPath route between two points (0 when there is none). */
function walkLength(m: GameMap, from: Vec2, to: Vec2): number {
  let len = 0, px = from.x, py = from.y;
  for (const q of findPath(m, from, to)) { len += Math.hypot(q.x - px, q.y - py); px = q.x; py = q.y; }
  return len;
}

// The sim's hitscan (server/src/sim/combat.ts) hits a target whose centre projects onto the aim ray at s with
// 0 <= s <= the wall distance along that ray and sits within RANGED_HIT_REACH of the ray. So a shot needs only the
// target's centre inside a cone around the line to it, not an unobstructed zero-width line between the two centres.
const FAN_RAYS = 801;

/**
 * Sampled check: casts FAN_RAYS aims evenly across the cone from `a` that can hit a target at `b`, with the sim's
 * conditions and the sight cap MAX_SIGHT_CORRIDOR (480 u: the bow's range before the 9.1 tuning, twice it now), and
 * returns the first aim that would hit (its offset from the
 * line to the target, degrees) or null. Uses the same `raycast` the sim uses, so it cannot drift from the real wall test.
 */
function hittableAim(m: GameMap, a: Vec2, b: Vec2, reach: number): number | null {
  const L = dist(a, b);
  const ang0 = Math.atan2(b.y - a.y, b.x - a.x);
  const maxOff = Math.asin(Math.min(1, reach / L));
  const half = (FAN_RAYS - 1) / 2;
  for (let k = 0; k < FAN_RAYS; k++) {
    const off = ((k - half) / half) * maxOff;
    const dx = Math.cos(ang0 + off), dy = Math.sin(ang0 + off);
    const s = (b.x - a.x) * dx + (b.y - a.y) * dy;
    const perp = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx);
    if (s < 0 || perp > reach + 1e-9) continue;
    const wall = raycast(m, a.x, a.y, a.x + dx * MAX_SIGHT_CORRIDOR, a.y + dy * MAX_SIGHT_CORRIDOR);
    if (s <= (wall.hit ? wall.dist : MAX_SIGHT_CORRIDOR)) return (off * 180) / Math.PI;
  }
  return null;
}

/**
 * Exact check (for a pair closer than the sight cap MAX_SIGHT_CORRIDOR): the aims that hit are the slopes
 * |cross(d0, v) / dot(d0, v)| <= reach / sqrt(L^2 - reach^2) around d0 = (b - a) / L, and every one of them has its
 * projection s >= sqrt(L^2 - reach^2). A wall tile whose far corner is nearer than that stops every aim that touches
 * it, and the aims that touch a tile in front of `a` are exactly the slopes between its extreme corners. So the cone is
 * safe if such tiles cover the whole slope interval. Returns the first uncovered slope's offset in degrees, or null
 * when covered. It can only over-report (a tile partly beyond the bound is ignored), never miss a shot.
 */
function firstOpenSlope(m: GameMap, a: Vec2, b: Vec2, reach: number): number | null {
  const L = dist(a, b);
  const sMin = Math.sqrt(L * L - reach * reach);
  const edge = reach / sMin;
  const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
  const tx0 = worldToTile(Math.min(a.x, b.x)) - 1, tx1 = worldToTile(Math.max(a.x, b.x)) + 1;
  const ty0 = worldToTile(Math.min(a.y, b.y)) - 1, ty1 = worldToTile(Math.max(a.y, b.y)) + 1;
  const spans: [number, number][] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isWallTile(m, tx, ty)) continue;
      let lo = Infinity, hi = -Infinity, far = 0, front = true;
      for (let c = 0; c < 4; c++) {
        const rx = (tx + (c & 1)) * TILE - a.x, ry = (ty + (c >> 1)) * TILE - a.y;
        const along = rx * dx + ry * dy;
        if (along <= 0) { front = false; break; }
        const slope = (dx * ry - dy * rx) / along;
        lo = Math.min(lo, slope); hi = Math.max(hi, slope);
        far = Math.max(far, Math.hypot(rx, ry));
      }
      if (front && far < sMin && hi >= -edge && lo <= edge) spans.push([lo, hi]);
    }
  }
  spans.sort((p, q) => p[0] - q[0]);
  let covered = -edge;
  for (const [lo, hi] of spans) {
    if (lo > covered + 1e-9) break;
    if (hi > covered) covered = hi;
  }
  return covered >= edge - 1e-9 ? null : (Math.atan(covered) * 180) / Math.PI;
}

const mean = (v: readonly number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const median = (v: readonly number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)];
/** Nearest-rank percentile, q in (0, 1]. */
const percentile = (v: readonly number[], q: number) => [...v].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * v.length) - 1)];

describe("determinism", () => {
  it("same seed gives byte-identical grids and deep-equal everything else (50 seeds)", () => {
    for (const s of seeds(50)) {
      const a = mapFor(s);
      generateMap(s + 1000); // no hidden state may leak between calls
      const b = generateMap(s);
      expect(Buffer.from(a.tiles).equals(Buffer.from(b.tiles)), `seed ${s} tiles`).toBe(true);
      expect(Buffer.from(a.regionGrid).equals(Buffer.from(b.regionGrid)), `seed ${s} regionGrid`).toBe(true);
      expect(a, `seed ${s}`).toEqual(b);
      expect(a.tiles).not.toBe(b.tiles);
      expect(a.regionGrid).not.toBe(b.regionGrid);
      expect(a.seed).toBe(s);
      // The R0 contract fields (the wedge adapter) are as deterministic as the rest.
      expect(a.attempt, `seed ${s} attempt`).toBe(b.attempt);
      expect(Buffer.from(a.territoryGrid).equals(Buffer.from(b.territoryGrid)), `seed ${s} territoryGrid`).toBe(true);
      expect(a.camps, `seed ${s} camps`).toEqual(b.camps);
      expect(a.spawnPool, `seed ${s} spawnPool`).toEqual(b.spawnPool);
      expect(a.regions.map((r) => [r.pole, r.area]), `seed ${s} poles and areas`).toEqual(b.regions.map((r) => [r.pole, r.area]));
      expect(a.territoryGrid).not.toBe(b.territoryGrid);
      expect(a.camps).not.toBe(b.camps);
    }
  }, HEAVY_MS);

  it("returns independent objects: mutating one result never changes the next", () => {
    const s = 7;
    const snapshot = structuredClone(generateMap(s));
    const a = generateMap(s);
    a.tiles.fill(TILE_WALL);
    a.regionGrid.fill(3);
    a.spawns.length = 0;
    a.buildings.length = 0;
    a.extracts.length = 0;
    a.crateSpots.length = 0;
    a.groundSpots.length = 0;
    a.coliseum.innerSpawns.length = 0;
    for (const g of a.coliseum.gates) g.tiles.length = 0;
    for (const r of a.regions) { r.spawns.length = 0; r.chestSpots.length = 0; r.mobCamps.length = 0; r.pole.x = -1; r.area = -1; }
    a.attempt = 99;
    a.territoryGrid.fill(3);
    for (const c of a.camps) { c.spots.length = 0; c.chest.x = -1; c.eliteSpot = 9; }
    a.camps.length = 0;
    for (const p of a.spawnPool) p.x = -1;
    a.spawnPool.length = 0;
    a.regions.length = 0;
    expect(generateMap(s)).toEqual(snapshot);
  });

  it("different seeds give different tiles and sector layouts (50 seeds)", () => {
    const tiles = new Set<string>();
    const sectors = new Set<string>();
    for (const s of seeds(50)) {
      const m = mapFor(s);
      tiles.add(Buffer.from(m.tiles).toString("base64"));
      sectors.add(Buffer.from(m.regionGrid).toString("base64"));
    }
    expect(tiles.size).toBe(50);
    expect(sectors.size).toBe(50);
    const a = mapFor(1), b = mapFor(2);
    expect(a.spawns).not.toEqual(b.spawns);
    expect(a.crateSpots).not.toEqual(b.crateSpots);
  }, HEAVY_MS);

  it("varies the faction layout rather than rotating one template (200 seeds)", () => {
    const orders = new Set<string>();
    const fireOctants = new Set<number>();
    eachMap((m) => {
      const order = sectorOrder(m);
      const i = order.indexOf("fire");
      orders.add([...order.slice(i), ...order.slice(0, i)].join(">"));
      const a = sectorAngles(m)[REGION_FACTIONS.indexOf("fire")];
      fireOctants.add(Math.min(7, Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8)));
    });
    // 24 distinct cyclic orders exist for 5 factions.
    expect(orders.size).toBeGreaterThanOrEqual(10);
    expect(fireOctants.size).toBeGreaterThanOrEqual(7);
  }, HEAVY_MS);

  it("varies structure across seeds (ruin counts)", () => {
    const counts = new Set(seeds(60).map((s) => mapFor(s).buildings.length));
    expect(counts.size).toBeGreaterThanOrEqual(3);
  }, HEAVY_MS);

  it("never calls Math.random or an engine-approximated Math function, module setup and lane tables included (client and server may run different engines)", async () => {
    // ECMAScript lets these differ in the last bit between engines; Math.sqrt is exact and allowed.
    const names = ["random", "sin", "cos", "tan", "atan", "atan2", "hypot", "pow", "exp", "log", "cbrt"] as const;
    const spies = names.map((n) => vi.spyOn(Math, n));
    const calls: Record<string, number> = {};
    try {
      // A fresh copy of the module, so its module-level tables and its lazily built lane tables are built under the
      // spies instead of being reused from an earlier test's run.
      vi.resetModules();
      const fresh = await import("../src/mapgen");
      for (const s of seeds(10, 70_000)) fresh.generateMap(s);
      fresh.longestLane(fresh.generateMap(70_010));
      names.forEach((n, i) => { calls[`Math.${n}`] = spies[i].mock.calls.length; });
    } finally {
      for (const sp of spies) sp.mockRestore();
    }
    expect(calls).toEqual(Object.fromEntries(names.map((n) => [`Math.${n}`, 0])));
  }, 30_000);

  it("accepts unusual seeds deterministically", () => {
    for (const s of [0, -1, 2 ** 31, 2 ** 32 + 5, 123456789]) {
      const a = generateMap(s);
      expect(a, `seed ${s}`).toEqual(generateMap(s));
      expect(a.seed).toBe(s);
      expect(a.regions.length, `seed ${s}`).toBe(REGION_FACTIONS.length);
      expect(componentCount(a, a.tiles), `seed ${s}`).toBe(1);
    }
  });
});

describe("grid", () => {
  it("is 64x64 (MAP_TILES_W/H)", () => {
    const m = mapFor(0);
    expect(m.w).toBe(64);
    expect(m.h).toBe(64);
    expect(m.w).toBe(MAP_TILES_W);
    expect(m.h).toBe(MAP_TILES_H);
  });

  it("has row-major 0/1 tiles, a wall border and a well-formed regionGrid (200 seeds)", () => {
    eachMap((m, s) => {
      expect(m.tiles, `seed ${s}`).toBeInstanceOf(Uint8Array);
      expect(m.tiles.length, `seed ${s}`).toBe(m.w * m.h);
      expect(m.regionGrid, `seed ${s}`).toBeInstanceOf(Uint8Array);
      expect(m.regionGrid.length, `seed ${s}`).toBe(m.w * m.h);
      let badTile = -1, badCode = -1, badBorder = -1;
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.tiles[i] !== TILE_FLOOR && m.tiles[i] !== TILE_WALL) badTile = i;
        if (m.regionGrid[i] >= REGION_IDS.length) badCode = i;
        const x = i % m.w, y = (i - x) / m.w;
        const border = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1;
        if (border && m.tiles[i] !== TILE_WALL) badBorder = i;
      }
      expect(badTile, `seed ${s}: tile value`).toBe(-1);
      expect(badCode, `seed ${s}: region code`).toBe(-1);
      expect(badBorder, `seed ${s}: border tile not wall`).toBe(-1);
    });
  }, HEAVY_MS);

  it("has a sane amount of open floor (200 seeds)", () => {
    eachMap((m, s) => {
      let floor = 0;
      for (const v of m.tiles) if (v === TILE_FLOOR) floor++;
      expect(floor / m.tiles.length, `seed ${s}`).toBeGreaterThan(0.5);
      expect(floor / m.tiles.length, `seed ${s}`).toBeLessThan(0.95);
    });
  }, HEAVY_MS);
});

describe("regions", () => {
  it("gives every floor tile a faction or coliseum region and every border tile none (200 seeds)", () => {
    eachMap((m, s) => {
      let floorNone = -1, borderNotNone = -1;
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.tiles[i] === TILE_FLOOR && m.regionGrid[i] === REGION_NONE) floorNone = i;
        const x = i % m.w, y = (i - x) / m.w;
        if ((x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1) && m.regionGrid[i] !== REGION_NONE) borderNotNone = i;
      }
      expect(floorNone, `seed ${s}: floor tile with region none`).toBe(-1);
      expect(borderNotNone, `seed ${s}: border tile with a region`).toBe(-1);
    });
  }, HEAVY_MS);

  it("gives each of the five factions at least 8% of all floor tiles (200 seeds)", () => {
    eachMap((m, s) => {
      const counts = new Array(REGION_IDS.length).fill(0);
      let floor = 0;
      for (let i = 0; i < m.tiles.length; i++) {
        if (m.tiles[i] !== TILE_FLOOR) continue;
        floor++;
        counts[m.regionGrid[i]]++;
      }
      for (const f of REGION_FACTIONS) {
        expect(counts[regionCodeOf(f)] / floor, `seed ${s} ${f}`).toBeGreaterThanOrEqual(0.08);
      }
    });
  }, HEAVY_MS);

  it("keeps the coliseum footprint inside coliseum.rect, which is its exact bounding box (200 seeds)", () => {
    eachMap((m, s) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
      for (let i = 0; i < m.regionGrid.length; i++) {
        if (m.regionGrid[i] !== REGION_COLISEUM) continue;
        const x = i % m.w, y = (i - x) / m.w;
        count++;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        expect(inRect(m.coliseum.rect, x, y), `seed ${s} tile ${x},${y} outside rect`).toBe(true);
      }
      expect(count, `seed ${s}`).toBeGreaterThan(0);
      expect(m.coliseum.rect, `seed ${s}`).toEqual({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      // Centred on the map.
      expect(2 * m.coliseum.rect.x + m.coliseum.rect.w, `seed ${s}`).toBe(m.w);
      expect(2 * m.coliseum.rect.y + m.coliseum.rect.h, `seed ${s}`).toBe(m.h);
    });
  }, HEAVY_MS);

  it("makes the footprint symmetric, with a closed wall ring except at the gates (200 seeds)", () => {
    eachMap((m, s) => {
      const gates = gateTileSet(m);
      const isColi = (x: number, y: number) =>
        x >= 0 && y >= 0 && x < m.w && y < m.h && m.regionGrid[y * m.w + x] === REGION_COLISEUM;
      let asymmetric = 0, leaks = 0;
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const c = isColi(x, y);
          if (c !== isColi(m.w - 1 - x, y) || c !== isColi(x, m.h - 1 - y)) asymmetric++;
          if (m.w === m.h && c !== isColi(y, x)) asymmetric++;
          if (!c) continue;
          let edge = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isColi(x + dx, y + dy)) edge = true;
          if (edge && m.tiles[y * m.w + x] === TILE_FLOOR && !gates.has(y * m.w + x)) leaks++;
        }
      }
      expect(asymmetric, `seed ${s}: asymmetric footprint tiles`).toBe(0);
      expect(leaks, `seed ${s}: open ring tiles that are not gates`).toBe(0);
    });
  }, HEAVY_MS);

  it("only lets neighbouring sectors touch, never opposite ones (200 seeds)", () => {
    eachMap((m, s) => {
      const order = sectorOrder(m);
      const pos = new Map(order.map((f, i) => [regionCodeOf(f), i]));
      let bad = "";
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const a = m.regionGrid[y * m.w + x];
          if (!isFactionCode(a)) continue;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            if (x + dx >= m.w || y + dy >= m.h) continue;
            const b = m.regionGrid[(y + dy) * m.w + x + dx];
            if (!isFactionCode(b) || a === b) continue;
            const gap = (pos.get(a)! - pos.get(b)! + REGION_FACTIONS.length) % REGION_FACTIONS.length;
            if (gap !== 1 && gap !== REGION_FACTIONS.length - 1) bad = `${REGION_IDS[a]} touches ${REGION_IDS[b]} at ${x},${y}`;
          }
        }
      }
      expect(bad, `seed ${s}`).toBe("");
    });
  }, HEAVY_MS);

  it("keeps the floor of the ring road one connected component touching all five regions, with the gate lanes open (200 seeds)", () => {
    eachMap((m, s) => {
      const d = footprintDist(m);
      const ring = (i: number) => d[i] >= 1 && d[i] <= 3;
      // Cover may stand on the ring road, so it need not be all floor; what is left must still link everything.
      let first = -1, floor = 0;
      for (let i = 0; i < d.length; i++) {
        if (!ring(i) || m.tiles[i] !== TILE_FLOOR) continue;
        floor++;
        if (first < 0) first = i;
      }
      expect(first, `seed ${s}: no ring road floor`).toBeGreaterThanOrEqual(0);
      // The ring alone (no footprint, so no gates) links everything around, also while the gates are closed.
      const reached = reachFrom(m, m.tiles, first, ring);
      const regions = new Set<number>();
      let unreached = 0;
      for (let i = 0; i < d.length; i++) {
        if (!ring(i) || m.tiles[i] !== TILE_FLOOR) continue;
        if (reached[i]) regions.add(m.regionGrid[i]); else unreached++;
      }
      expect(unreached, `seed ${s}: ring road floor tiles not linked into one component (of ${floor})`).toBe(0);
      for (const f of REGION_FACTIONS) expect(regions.has(regionCodeOf(f)), `seed ${s} ${f} on the ring road`).toBe(true);
      // Nothing covers the lanes in front of the gates.
      for (const t of gateLaneTiles(m)) expect(isFloorTile(m, t.x, t.y), `seed ${s}: gate lane tile ${t.x},${t.y}`).toBe(true);
    });
  }, HEAVY_MS);

  it("starts the ridges beyond the ring road and leaves region 'none' only on walls (200 seeds)", () => {
    eachMap((m, s) => {
      const d = footprintDist(m);
      let interior = 0, nearRidge = 0, floorNone = 0;
      for (let y = 1; y < m.h - 1; y++) {
        for (let x = 1; x < m.w - 1; x++) {
          const i = y * m.w + x;
          if (m.regionGrid[i] !== REGION_NONE) continue;
          interior++;
          if (m.tiles[i] !== TILE_WALL) floorNone++;
          if (d[i] < 5) nearRidge++;
        }
      }
      expect(floorNone, `seed ${s}`).toBe(0);
      expect(nearRidge, `seed ${s}: ridge tiles closer than 5 to the footprint`).toBe(0);
      expect(interior, `seed ${s}: no ridges at all`).toBeGreaterThanOrEqual(60);
    });
  }, HEAVY_MS);

  it("opens a pass through every ridge, beyond the ring road (200 seeds)", () => {
    let boundaries = 0, clearOfExtracts = 0;
    eachMap((m, s) => {
      const order = sectorOrder(m);
      const d = footprintDist(m);
      const ex = m.extracts.map(tileOf);
      // A crossing needs a floor pair across two regions, both tiles past the ring road. The 5x5 extract
      // patch can clear ridge tiles too, so a crossing with no tile within 2 of an extract is a real pass.
      const nearExtract = (x: number, y: number) => ex.some((e) => cheb(e.x, e.y, x, y) <= 2);
      for (let k = 0; k < order.length; k++) {
        const a = regionCodeOf(order[k]), b = regionCodeOf(order[(k + 1) % order.length]);
        let found = false, clear = false;
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            const i = y * m.w + x;
            if (m.tiles[i] !== TILE_FLOOR || d[i] < 5) continue;
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx >= m.w || ny >= m.h) continue;
              const j = ny * m.w + nx;
              if (m.tiles[j] !== TILE_FLOOR || d[j] < 5) continue;
              const ca = m.regionGrid[i], cb = m.regionGrid[j];
              if (!((ca === a && cb === b) || (ca === b && cb === a))) continue;
              found = true;
              if (!nearExtract(x, y) && !nearExtract(nx, ny)) clear = true;
            }
          }
        }
        expect(found, `seed ${s}: no pass between ${order[k]} and ${order[(k + 1) % order.length]}`).toBe(true);
        boundaries++;
        if (clear) clearOfExtracts++;
      }
    });
    // A pass can land under an extract patch; that has to stay a rare coincidence.
    expect(clearOfExtracts / boundaries).toBeGreaterThan(0.98);
  }, HEAVY_MS);
});

describe("connectivity", () => {
  it("has all floor in a single 4-connected component with the gates open (200 seeds)", () => {
    eachMap((m, s) => expect(componentCount(m, m.tiles), `seed ${s}`).toBe(1));
  }, HEAVY_MS);

  it("withGates differs from the open map exactly at the gate tiles (200 seeds)", () => {
    eachMap((m, s) => {
      const locked = withGates(m);
      const gates = gateTileSet(m);
      expect(gates.size, `seed ${s}`).toBe(4 * m.coliseum.gates.length);
      for (let i = 0; i < m.tiles.length; i++) {
        if (gates.has(i)) {
          expect(m.tiles[i], `seed ${s} open gate tile ${i}`).toBe(TILE_FLOOR);
          expect(locked.tiles[i], `seed ${s} locked gate tile ${i}`).toBe(TILE_WALL);
        } else if (locked.tiles[i] !== m.tiles[i]) {
          expect.fail(`seed ${s}: tile ${i} differs outside the gates`);
        }
      }
    });
  }, HEAVY_MS);

  it("seals the arena with the gates closed: one coliseum component holding the centre, none escapes (200 seeds)", () => {
    eachMap((m, s) => {
      const locked = withGates(m);
      const isColi = (i: number) => m.regionGrid[i] === REGION_COLISEUM;
      const ci = centreIdx(m);
      expect(locked.tiles[ci], `seed ${s}: centre is not floor`).toBe(TILE_FLOOR);
      expect(isColi(ci), `seed ${s}: centre not in the coliseum`).toBe(true);
      const fromCentre = reachFrom(locked, locked.tiles, ci);
      let escaped = -1, stranded = 0;
      for (let i = 0; i < locked.tiles.length; i++) {
        if (fromCentre[i] && !isColi(i)) escaped = i;
        if (locked.tiles[i] === TILE_FLOOR && isColi(i) && !fromCentre[i]) stranded++;
      }
      expect(escaped, `seed ${s}: BFS from the centre left the coliseum at tile ${escaped}`).toBe(-1);
      expect(stranded, `seed ${s}: coliseum floor not connected to the centre`).toBe(0);
    });
  }, HEAVY_MS);

  it("keeps the rest of the map in one component with the gates closed (200 seeds)", () => {
    eachMap((m, s) => {
      const locked = withGates(m);
      expect(componentCount(locked, locked.tiles, (i) => m.regionGrid[i] !== REGION_COLISEUM), `seed ${s}`).toBe(1);
      expect(componentCount(locked, locked.tiles), `seed ${s}: arena + outside`).toBe(2);
    });
  }, HEAVY_MS);

  // A pillar is a wall tile of the arena whose whole 3x3 is coliseum region, so not on the wall ring.
  const pillarTiles = (m: GameMap): TilePt[] => {
    const out: TilePt[] = [];
    for (let y = 1; y < m.h - 1; y++) {
      for (let x = 1; x < m.w - 1; x++) {
        if (m.tiles[y * m.w + x] !== TILE_WALL) continue;
        let inner = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (regionAtTile(m, x + dx, y + dy) !== "coliseum") inner = false;
        if (inner) out.push({ x, y });
      }
    }
    return out;
  };

  it("always puts pillars in the arena (200 seeds)", () => {
    eachMap((m, s) => {
      expect(pillarTiles(m).length, `seed ${s}: no pillar tiles in the arena`).toBeGreaterThan(0);
    });
  }, HEAVY_MS);

  it("keeps pillars off the centre tile, the inner spawns' 3x3 and the lanes inside the gates, and leaves the sealed arena connected (200 seeds)", () => {
    // The shape is free (it need not be four 2x2 blocks any more); only what must stay clear is checked.
    eachMap((m, s) => {
      const keepClear = new Map<string, string>();
      const c = tileOf(m.coliseum.centre);
      keepClear.set(`${c.x},${c.y}`, "the centre tile");
      for (const p of m.coliseum.innerSpawns) {
        const t = tileOf(p);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) keepClear.set(`${t.x + dx},${t.y + dy}`, `the 3x3 of inner spawn ${ptKey(p)}`);
      }
      for (const g of m.coliseum.gates) {
        const [ox, oy] = GATE_OUT[g.side];
        for (const t of g.tiles) for (let k = 1; k <= 3; k++) keepClear.set(`${t.x - ox * k},${t.y - oy * k}`, `the lane inside gate ${g.side}`);
      }
      for (const p of pillarTiles(m)) {
        expect(keepClear.get(`${p.x},${p.y}`), `seed ${s}: pillar tile ${p.x},${p.y} on`).toBeUndefined();
      }
      // With the gates closed every arena floor tile still reaches the centre.
      const locked = withGates(m);
      const fromCentre = reachFrom(locked, locked.tiles, centreIdx(m));
      let stranded = 0;
      for (let i = 0; i < locked.tiles.length; i++) if (m.regionGrid[i] === REGION_COLISEUM && locked.tiles[i] === TILE_FLOOR && !fromCentre[i]) stranded++;
      expect(stranded, `seed ${s}: arena floor cut off from the centre by pillars`).toBe(0);
    });
  }, HEAVY_MS);
});

describe("gates", () => {
  const SIDES: GateSide[] = ["n", "e", "s", "w"];
  const OUT = GATE_OUT;

  it("has four 4-wide straight gates in n, e, s, w order, each on its own side, open when the gates are open (200 seeds)", () => {
    eachMap((m, s) => {
      expect(m.coliseum.gates.map((g) => g.side), `seed ${s}`).toEqual(SIDES);
      for (const g of m.coliseum.gates) {
        const tag = `seed ${s} gate ${g.side}`;
        expect(g.tiles.length, tag).toBe(4);
        const horizontal = g.side === "n" || g.side === "s";
        const along = g.tiles.map((t) => (horizontal ? t.x : t.y));
        const across = new Set(g.tiles.map((t) => (horizontal ? t.y : t.x)));
        expect(across.size, `${tag}: not one straight row/column`).toBe(1);
        const step = along[1] - along[0];
        expect(Math.abs(step), tag).toBe(1);
        along.forEach((v, i) => expect(v, `${tag}: tiles not consecutive`).toBe(along[0] + i * step));
        const fixed = (horizontal ? g.tiles[0].y : g.tiles[0].x) + 0.5;
        const mid = horizontal ? m.h / 2 : m.w / 2;
        expect(g.side === "n" || g.side === "w" ? fixed < mid : fixed > mid, `${tag}: wrong side of the centre`).toBe(true);
        // Centred on its side.
        const meanAlong = along.reduce((a, b) => a + b + 0.5, 0) / 4;
        expect(meanAlong, `${tag}: off-centre`).toBeCloseTo(horizontal ? m.w / 2 : m.h / 2, 9);
        for (const t of g.tiles) {
          expect(regionAtTile(m, t.x, t.y), tag).toBe("coliseum");
          expect(m.tiles[tileIdx(m, t)], `${tag}: closed in the open map`).toBe(TILE_FLOOR);
        }
        // World position is the mean of the tile centres.
        expect(g.x, tag).toBeCloseTo(g.tiles.reduce((a, t) => a + tileToWorldCenter(t.x), 0) / 4, 6);
        expect(g.y, tag).toBeCloseTo(g.tiles.reduce((a, t) => a + tileToWorldCenter(t.y), 0) / 4, 6);
      }
    });
  }, HEAVY_MS);

  it("makes the gates the only links between the coliseum floor and the rest (200 seeds)", () => {
    eachMap((m, s) => {
      const gates = gateTileSet(m);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const i = y * m.w + x;
          if (m.tiles[i] !== TILE_FLOOR || m.regionGrid[i] !== REGION_COLISEUM) continue;
          for (const [dx, dy] of DIRS4) {
            const nx = x + dx, ny = y + dy;
            if (isWallTile(m, nx, ny)) continue;
            if (m.regionGrid[ny * m.w + nx] === REGION_COLISEUM) continue;
            expect(gates.has(i), `seed ${s}: coliseum tile ${x},${y} touches outside floor ${nx},${ny} but is not a gate`).toBe(true);
          }
        }
      }
    });
  }, HEAVY_MS);

  it("gives every gate tile a coliseum-floor neighbour and an outside-floor neighbour (200 seeds)", () => {
    eachMap((m, s) => {
      const gates = gateTileSet(m);
      for (const g of m.coliseum.gates) {
        for (const t of g.tiles) {
          let inside = false, outside = false;
          for (const [dx, dy] of DIRS4) {
            const nx = t.x + dx, ny = t.y + dy;
            if (isWallTile(m, nx, ny)) continue;
            const isColi = m.regionGrid[ny * m.w + nx] === REGION_COLISEUM;
            if (isColi && !gates.has(ny * m.w + nx)) inside = true;
            if (!isColi) outside = true;
          }
          expect(inside, `seed ${s} gate ${g.side} tile ${t.x},${t.y}: no arena neighbour`).toBe(true);
          expect(outside, `seed ${s} gate ${g.side} tile ${t.x},${t.y}: no outside neighbour`).toBe(true);
        }
      }
    });
  }, HEAVY_MS);

  it("keeps a clear floor lane in front of and behind every gate (200 seeds)", () => {
    eachMap((m, s) => {
      for (const g of m.coliseum.gates) {
        const [ox, oy] = OUT[g.side];
        for (const t of g.tiles) {
          for (let k = -3; k <= 3; k++) {
            if (k === 0) continue;
            const x = t.x + ox * k, y = t.y + oy * k;
            expect(isFloorTile(m, x, y), `seed ${s} gate ${g.side}: lane tile ${x},${y}`).toBe(true);
          }
        }
        // The outside lane is one tile wider on each side than the gate.
        const first = g.tiles[0], last = g.tiles[g.tiles.length - 1];
        const ux = Math.sign(last.x - first.x), uy = Math.sign(last.y - first.y);
        for (const [e, dir] of [[first, -1], [last, 1]] as const) {
          for (let k = 1; k <= 3; k++) {
            const x = e.x + ox * k + ux * dir, y = e.y + oy * k + uy * dir;
            expect(isFloorTile(m, x, y), `seed ${s} gate ${g.side}: outer lane tile ${x},${y}`).toBe(true);
          }
        }
      }
    });
  }, HEAVY_MS);
});

describe("coliseum interior", () => {
  it("has a clear floor centre tile at the middle of the map (200 seeds)", () => {
    eachMap((m, s) => {
      const c = m.coliseum.centre;
      expect(isTileCentre(c), `seed ${s}`).toBe(true);
      const t = tileOf(c);
      expect([m.w / 2 - 1, m.w / 2], `seed ${s}`).toContain(t.x);
      expect([m.h / 2 - 1, m.h / 2], `seed ${s}`).toContain(t.y);
      expect(regionAtTile(m, t.x, t.y), `seed ${s}`).toBe("coliseum");
      expect(isFloorTile(withGates(m), t.x, t.y), `seed ${s}`).toBe(true);
    });
  }, HEAVY_MS);

  it("has at least MAX_PLAYERS distinct, well-spread inner spawns that work with the gates closed (200 seeds)", () => {
    eachMap((m, s) => {
      const locked = withGates(m);
      const spawns = m.coliseum.innerSpawns;
      expect(spawns.length, `seed ${s}`).toBeGreaterThanOrEqual(MAX_PLAYERS);
      expect(new Set(spawns.map(ptKey)).size, `seed ${s}: duplicates`).toBe(spawns.length);
      const fromCentre = reachFrom(locked, locked.tiles, centreIdx(m));
      for (const p of spawns) {
        const t = tileOf(p);
        expect(isTileCentre(p), `seed ${s} ${ptKey(p)}`).toBe(true);
        expect(regionAtTile(m, t.x, t.y), `seed ${s} ${ptKey(p)}`).toBe("coliseum");
        expect(clear3x3(locked, t.x, t.y), `seed ${s} ${ptKey(p)}: 3x3 not clear`).toBe(true);
        expect(fromCentre[tileIdx(m, t)], `seed ${s} ${ptKey(p)}: unreachable from the centre`).toBe(1);
      }
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          const a = tileOf(spawns[i]), b = tileOf(spawns[j]);
          expect(cheb(a.x, a.y, b.x, b.y), `seed ${s} inner spawns ${i},${j}`).toBeGreaterThanOrEqual(3);
        }
      }
    });
  }, HEAVY_MS);
});

describe("regions array", () => {
  it("has five entries in REGION_FACTIONS order with a floor anchor inside the region (200 seeds)", () => {
    eachMap((m, s) => {
      expect(m.regions.map((r) => r.id), `seed ${s}`).toEqual([...REGION_FACTIONS]);
      for (const r of m.regions) {
        const t = tileOf(r.anchor);
        expect(isTileCentre(r.anchor), `seed ${s} ${r.id}`).toBe(true);
        expect(isFloorTile(m, t.x, t.y), `seed ${s} ${r.id} anchor`).toBe(true);
        expect(regionAtTile(m, t.x, t.y), `seed ${s} ${r.id} anchor`).toBe(r.id);
        expect(inAnyBuilding(m, t.x, t.y), `seed ${s} ${r.id} anchor in a ruin`).toBe(false);
      }
    });
  }, HEAVY_MS);

  it("puts each anchor on the outdoor floor tile nearest its region's floor centroid (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        const code = regionCodeOf(r.id);
        let sx = 0, sy = 0, n = 0;
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            const i = y * m.w + x;
            if (m.regionGrid[i] === code && m.tiles[i] === TILE_FLOOR) { sx += x + 0.5; sy += y + 0.5; n++; }
          }
        }
        const cx = sx / n, cy = sy / n;
        let best = Infinity;
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            const i = y * m.w + x;
            if (m.regionGrid[i] !== code || m.tiles[i] !== TILE_FLOOR || inAnyBuilding(m, x, y)) continue;
            best = Math.min(best, Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
          }
        }
        const t = tileOf(r.anchor);
        expect(Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy), `seed ${s} ${r.id}`).toBeLessThanOrEqual(best + 1e-6);
      }
    });
  }, HEAVY_MS);
});

describe("spawns", () => {
  it("has 3 per region: tile centres in the region with a clear 3x3, outside ruins and camp clearings (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        expect(r.spawns.length, `seed ${s} ${r.id}`).toBe(3);
        for (const p of r.spawns) {
          const t = tileOf(p);
          const tag = `seed ${s} ${r.id} spawn ${ptKey(p)}`;
          expect(isTileCentre(p), tag).toBe(true);
          expect(regionAtTile(m, t.x, t.y), tag).toBe(r.id);
          expect(clear3x3(m, t.x, t.y), `${tag}: 3x3 not clear`).toBe(true);
          expect(inAnyBuilding(m, t.x, t.y), `${tag}: inside a ruin`).toBe(false);
          for (const c of m.regions.flatMap((q) => q.mobCamps)) {
            expect(dist(p, c), `${tag}: inside camp ${c.id}`).toBeGreaterThan(c.r);
          }
        }
      }
    });
  }, HEAVY_MS);

  it("keeps all 15 distinct and within [0.5, 0.95] of the arena radius from the coliseum (200 seeds)", () => {
    eachMap((m, s) => {
      const all = m.regions.flatMap((r) => r.spawns);
      expect(all.length, `seed ${s}`).toBe(3 * REGION_FACTIONS.length);
      expect(new Set(all.map(ptKey)).size, `seed ${s}: duplicates`).toBe(all.length);
      for (const p of all) {
        const d = dist(p, m.coliseum.centre);
        expect(d, `seed ${s} ${ptKey(p)} too close`).toBeGreaterThanOrEqual(0.5 * R0(m) * TILE);
        expect(d, `seed ${s} ${ptKey(p)} too far`).toBeLessThanOrEqual(0.95 * R0(m) * TILE);
      }
    });
  }, HEAVY_MS);

  it("is fair: no spawn is more than 1.5x farther from the coliseum than any other (200 seeds)", () => {
    eachMap((m, s) => {
      const ds = m.spawns.map((p) => dist(p, m.coliseum.centre));
      expect(Math.max(...ds) / Math.min(...ds), `seed ${s}`).toBeLessThanOrEqual(1.5);
    });
  }, HEAVY_MS);

  it("flattens by interleaving the regions, so the first five are in five different regions (200 seeds)", () => {
    eachMap((m, s) => {
      const expected: Vec2[] = [];
      for (let k = 0; k < 3; k++) for (const r of m.regions) expected.push(r.spawns[k]);
      expect(m.spawns, `seed ${s}`).toEqual(expected);
      const firstFive = m.spawns.slice(0, 5).map((p) => regionOfPoint(m, p));
      expect(new Set(firstFive).size, `seed ${s}`).toBe(5);
    });
  }, HEAVY_MS);

  it("stays out of every extract zone (200 seeds)", () => {
    eachMap((m, s) => {
      for (const sp of m.spawns) for (const e of m.extracts) expect(dist(sp, e), `seed ${s}`).toBeGreaterThan(EXTRACT_RADIUS * 2);
    });
  }, HEAVY_MS);

  it("keeps every pair of spawns on the map at least 5 tiles apart, across regions too (200 seeds + known regressions)", () => {
    // 269, 614, 838 and 1563 once put two spawns of neighbouring regions less than 5 tiles apart.
    eachMap((m, s) => {
      for (let i = 0; i < m.spawns.length; i++) {
        for (let j = i + 1; j < m.spawns.length; j++) {
          const a = m.spawns[i], b = m.spawns[j];
          expect(dist(a, b), `seed ${s} spawns ${ptKey(a)} (${regionOfPoint(m, a)}) and ${ptKey(b)} (${regionOfPoint(m, b)})`).toBeGreaterThanOrEqual(5 * TILE);
        }
      }
    }, [...SEEDS, 269, 614, 838, 1563]);
  }, HEAVY_MS);

  it("lets no spawn shoot another within the sight corridor limit: no aim hits across the hitscan's reach, both ways, gates open (200 seeds)", () => {
    // Nobody should open a raid with a bow shot at someone else's spawn. The sim hits any target whose centre is within
    // RANGED_HIT_REACH of the aim ray, so the zero-width centre line is not enough: every aim in that cone must be walled off.
    // Checked two ways: a fan of real raycasts (the oracle, since it is the sim's own wall test) and the exact
    // slope-interval cover (continuous, so it also catches a gap narrower than the fan's spacing).
    const t0 = performance.now();
    let pairs = 0, near = 0;
    const offenders: string[] = [];
    eachMap((m, s) => {
      for (let i = 0; i < m.spawns.length; i++) {
        for (let j = i + 1; j < m.spawns.length; j++) {
          pairs++;
          const a = m.spawns[i], b = m.spawns[j];
          const d = dist(a, b);
          if (d > MAX_SIGHT_CORRIDOR) continue;
          near++;
          for (const [from, to] of [[a, b], [b, a]] as const) {
            const fan = hittableAim(m, from, to, RANGED_HIT_REACH);
            const exact = firstOpenSlope(m, from, to, RANGED_HIT_REACH);
            const tag = `seed ${s}: ${ptKey(from)} (${regionOfPoint(m, from)}) to ${ptKey(to)} (${regionOfPoint(m, to)}), ${d.toFixed(1)} u`;
            if (fan !== null) offenders.push(`${tag}: an aim ${fan.toFixed(3)} deg off the centre line hits`);
            else if (exact !== null) offenders.push(`${tag}: the cone is open at ${exact.toFixed(3)} deg (exact check; the fan found no hit)`);
          }
        }
      }
    });
    console.info(
      `[spawn sight] ${near} of ${pairs} spawn pairs are within ${MAX_SIGHT_CORRIDOR} u; ${2 * near} directions checked ` +
      `(reach ${RANGED_HIT_REACH} u, ${FAN_RAYS} raycasts each, plus the exact cover); ${offenders.length} can hit; ${(performance.now() - t0).toFixed(0)} ms`,
    );
    expect(near, "no spawn pair close enough to test: the check would be vacuous").toBeGreaterThan(0);
    expect(offenders.slice(0, 5), `${offenders.length} spawn shots possible within ${MAX_SIGHT_CORRIDOR} u`).toEqual([]);
  }, HEAVY_MS);

  it("agrees with itself: the exact cover never calls a cone shut when a raycast aim gets through (validates the spawn shot check; 12 seeds)", () => {
    // The spawn check above passes when nothing can hit, which says nothing about whether the checkers can see a hit.
    // So run them on arbitrary pairs of clear floor points 5-9 tiles apart, where plenty of cones are open.
    const rng = mulberry32(8_001);
    const t0 = performance.now();
    let pairs = 0, open = 0, shut = 0, alarms = 0;
    const contradictions: string[] = [];
    for (const s of seeds(12)) {
      const m = mapFor(s);
      const spots: TilePt[] = [];
      for (let ty = 2; ty < m.h - 2; ty++) for (let tx = 2; tx < m.w - 2; tx++) if (clear3x3(m, tx, ty)) spots.push({ x: tx, y: ty });
      const isSpot = new Set(spots.map((p) => tileIdx(m, p)));
      for (let n = 0; n < 600; n++) {
        const t = spots[randInt(rng, 0, spots.length)];
        const ang = rng() * 2 * Math.PI, len = 5 + rng() * 4;
        const u = { x: Math.round(t.x + Math.cos(ang) * len), y: Math.round(t.y + Math.sin(ang) * len) };
        if (!isSpot.has(tileIdx(m, u))) continue;
        const a = { x: tileToWorldCenter(t.x), y: tileToWorldCenter(t.y) }, b = { x: tileToWorldCenter(u.x), y: tileToWorldCenter(u.y) };
        if (dist(a, b) < 5 * TILE) continue;
        pairs++;
        const fan = hittableAim(m, a, b, RANGED_HIT_REACH);
        const exact = firstOpenSlope(m, a, b, RANGED_HIT_REACH);
        if (fan !== null) open++; else shut++;
        if (fan !== null && exact === null) contradictions.push(`seed ${s}: ${ptKey(a)} to ${ptKey(b)}: a raycast aim at ${fan.toFixed(3)} deg hits but the exact cover says shut`);
        if (fan === null && exact !== null) alarms++;
      }
    }
    console.info(`[spawn sight] validation: ${pairs} pairs, ${open} with a hitting aim, ${shut} without, ${alarms} where only the exact cover reports an opening; ${(performance.now() - t0).toFixed(0)} ms`);
    expect(contradictions.slice(0, 5)).toEqual([]);
    // The cover is conservative (it ignores a tile that reaches past the bound), but it should rarely cry wolf.
    expect(alarms, `${alarms} of ${pairs} pairs`).toBeLessThanOrEqual(pairs * 0.02);
    expect(open, "no open cone to find: the validation would be vacuous").toBeGreaterThanOrEqual(50);
    expect(shut, "no shut cone to find: the validation would be vacuous").toBeGreaterThanOrEqual(50);
  }, HEAVY_MS);

  it("reports how far apart the spawns' walks to the coliseum centre are (gates open; info only, 30 seeds)", () => {
    // Not asserted yet: the lead sets the bound once the generator's numbers are in. The ratio is the longest spawn
    // route over the shortest one on the same map, by findPath length; the owner's target is 1.2.
    const sample = seeds(30);
    const ratios: number[] = [];
    let shortest = Infinity, longest = 0;
    for (const s of sample) {
      const m = mapFor(s);
      const lens = m.spawns.map((sp) => walkLength(m, sp, m.coliseum.centre));
      expect(Math.min(...lens), `seed ${s}: a spawn with no route to the centre`).toBeGreaterThan(0);
      ratios.push(Math.max(...lens) / Math.min(...lens));
      shortest = Math.min(shortest, ...lens);
      longest = Math.max(longest, ...lens);
    }
    console.info(
      `[spawn walk] max/min walking distance to the coliseum centre over ${sample.length} seeds: ` +
      `mean ${mean(ratios).toFixed(3)}, p90 ${percentile(ratios, 0.9).toFixed(3)}, max ${Math.max(...ratios).toFixed(3)} (seed ${sample[ratios.indexOf(Math.max(...ratios))]}); ` +
      `shortest route ${shortest.toFixed(0)} u, longest ${longest.toFixed(0)} u`,
    );
    expect(ratios).toHaveLength(sample.length);
  }, HEAVY_MS);

  it("spaces a region's spawns at least 5 tiles apart and keeps them 5 tiles from camp centres (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        for (let i = 0; i < r.spawns.length; i++) {
          for (let j = i + 1; j < r.spawns.length; j++) {
            expect(dist(r.spawns[i], r.spawns[j]), `seed ${s} ${r.id} spawns ${i},${j}`).toBeGreaterThanOrEqual(5 * TILE);
          }
        }
      }
      for (const p of m.spawns) {
        for (const c of m.regions.flatMap((q) => q.mobCamps)) {
          expect(dist(p, c), `seed ${s} spawn ${ptKey(p)} vs camp ${c.id}`).toBeGreaterThanOrEqual(5 * TILE);
        }
      }
    });
  }, HEAVY_MS);
});

describe("chests", () => {
  it("has 3-4 per region: floor tile centres inside the region, off the border ring and the extract circles, distinct map-wide (200 seeds)", () => {
    eachMap((m, s) => {
      const all = new Set<string>();
      for (const r of m.regions) {
        expect(r.chestSpots.length, `seed ${s} ${r.id}`).toBeGreaterThanOrEqual(3);
        expect(r.chestSpots.length, `seed ${s} ${r.id}`).toBeLessThanOrEqual(4);
        for (const p of r.chestSpots) {
          const t = tileOf(p);
          const tag = `seed ${s} ${r.id} chest ${ptKey(p)}`;
          expect(isTileCentre(p), tag).toBe(true);
          expect(isFloorTile(m, t.x, t.y), tag).toBe(true);
          expect(regionAtTile(m, t.x, t.y), tag).toBe(r.id);
          expect(footprintDist(m)[tileIdx(m, t)], `${tag}: on the ring road`).toBeGreaterThanOrEqual(4);
          // "Against a wall" must not mean the border wall: keep off the tile ring next to it.
          expect(t.x > 1 && t.y > 1 && t.x < m.w - 2 && t.y < m.h - 2, `${tag}: on the tile ring next to the border`).toBe(true);
          for (const e of m.extracts) expect(dist(p, e), `${tag}: inside extract ${e.id}`).toBeGreaterThan(e.r);
          expect(all.has(ptKey(p)), `${tag}: duplicate`).toBe(false);
          all.add(ptKey(p));
        }
      }
    });
  }, HEAVY_MS);

  it("keeps chests at least 3 tiles (Chebyshev) from every spawn and 2 from every camp spot (200 seeds)", () => {
    eachMap((m, s) => {
      const camps = m.regions.flatMap((r) => r.mobCamps);
      for (const r of m.regions) {
        for (const p of r.chestSpots) {
          const t = tileOf(p);
          for (const sp of m.spawns) {
            const u = tileOf(sp);
            expect(cheb(t.x, t.y, u.x, u.y), `seed ${s} ${r.id} chest ${ptKey(p)} vs spawn ${ptKey(sp)}`).toBeGreaterThanOrEqual(3);
          }
          for (const c of camps) {
            for (const q of c.spots) {
              const u = tileOf(q);
              expect(cheb(t.x, t.y, u.x, u.y), `seed ${s} chest ${ptKey(p)} vs ${c.id} spot`).toBeGreaterThanOrEqual(2);
            }
          }
        }
      }
    });
  }, HEAVY_MS);

  it("spaces a region's chests at least 2 tiles apart (Chebyshev, always), and usually 4 or more (200 seeds)", () => {
    let spaced = 0;
    eachMap((m, s) => {
      let ok = true;
      for (const r of m.regions) {
        for (let i = 0; i < r.chestSpots.length; i++) {
          for (let j = i + 1; j < r.chestSpots.length; j++) {
            const a = tileOf(r.chestSpots[i]), b = tileOf(r.chestSpots[j]);
            const c = cheb(a.x, a.y, b.x, b.y);
            expect(c, `seed ${s} ${r.id} chests ${i},${j}`).toBeGreaterThanOrEqual(2);
            if (c < 4) ok = false;
          }
        }
      }
      if (ok) spaced++;
    });
    // The spec relaxes 4 -> 2 only "if short", so the relaxation must be the exception.
    expect(spaced / SEEDS.length).toBeGreaterThan(0.8);
  }, HEAVY_MS);

  it("keeps chests off ruin doors, and puts at least one per region inside a ruin, against a wall (200 seeds)", () => {
    eachMap((m, s) => {
      const doors = m.buildings.flatMap((b) => doorTiles(m, b));
      for (const r of m.regions) {
        let inside = 0;
        for (const p of r.chestSpots) {
          const t = tileOf(p);
          for (const d of doors) expect(cheb(t.x, t.y, d.x, d.y), `seed ${s} ${r.id} chest ${ptKey(p)} near a door`).toBeGreaterThanOrEqual(2);
          const b = m.buildings.find((q) => inRect(q, t.x, t.y));
          if (!b) continue;
          inside++;
          expect(t.x, `seed ${s} ${r.id} ruin chest ${ptKey(p)} on the wall ring`).toBeGreaterThan(b.x);
          expect(t.x, `seed ${s} ${r.id} ruin chest ${ptKey(p)} on the wall ring`).toBeLessThan(b.x + b.w - 1);
          expect(t.y, `seed ${s} ${r.id} ruin chest ${ptKey(p)} on the wall ring`).toBeGreaterThan(b.y);
          expect(t.y, `seed ${s} ${r.id} ruin chest ${ptKey(p)} on the wall ring`).toBeLessThan(b.y + b.h - 1);
        }
        expect(inside, `seed ${s} ${r.id}: no chest inside a ruin`).toBeGreaterThanOrEqual(1);
        // At least one of the ruin chests is against a wall, like v1 crates.
        const against = r.chestSpots.some((p) => {
          const t = tileOf(p);
          return inAnyBuilding(m, t.x, t.y) &&
            (isWallTile(m, t.x - 1, t.y) || isWallTile(m, t.x + 1, t.y) || isWallTile(m, t.x, t.y - 1) || isWallTile(m, t.x, t.y + 1));
        });
        expect(against, `seed ${s} ${r.id}: no ruin chest against a wall`).toBe(true);
      }
    });
  }, HEAVY_MS);

  it("makes crateSpots every region's chests flattened in REGION_FACTIONS order (200 seeds)", () => {
    eachMap((m, s) => {
      expect(m.crateSpots, `seed ${s}`).toEqual(REGION_FACTIONS.flatMap((f) => regionDef(m, f).chestSpots));
    });
  }, HEAVY_MS);
});

describe("mob camps", () => {
  it("has 2-3 per region with unique ids, exactly one elite, and the right region (200 seeds)", () => {
    eachMap((m, s) => {
      const ids = new Set<string>();
      for (const r of m.regions) {
        expect(r.mobCamps.length, `seed ${s} ${r.id}`).toBeGreaterThanOrEqual(2);
        expect(r.mobCamps.length, `seed ${s} ${r.id}`).toBeLessThanOrEqual(3);
        expect(r.mobCamps.filter((c) => c.elite).length, `seed ${s} ${r.id}: elites`).toBe(1);
        const ns: number[] = [];
        for (const c of r.mobCamps) {
          expect(c.region, `seed ${s} ${c.id}`).toBe(r.id);
          expect(ids.has(c.id), `seed ${s}: duplicate id ${c.id}`).toBe(false);
          ids.add(c.id);
          const match = new RegExp(`^${r.id}-(\\d+)$`).exec(c.id);
          expect(match, `seed ${s}: id ${c.id}`).not.toBeNull();
          ns.push(Number(match![1]));
        }
        expect(ns.sort((a, b) => a - b), `seed ${s} ${r.id}: ids count up from 1`).toEqual(r.mobCamps.map((_, i) => i + 1));
      }
    });
  }, HEAVY_MS);

  it("arms every camp with its region's signature weapon (REGION_WEAPONS) (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        for (const c of r.mobCamps) {
          expect(c.weapon, `seed ${s} ${c.id}`).toBe(REGION_WEAPONS[c.region]);
          expect(c.weapon, `seed ${s} ${c.id} (region ${r.id})`).toBe(REGION_WEAPONS[r.id]);
        }
      }
    });
  }, HEAVY_MS);

  it("clears every tile within the radius to floor in the camp's region, away from the coliseum (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        for (const c of r.mobCamps) {
          const tag = `seed ${s} ${c.id}`;
          expect(c.r, tag).toBeGreaterThanOrEqual(1.5 * TILE);
          expect(c.r, tag).toBeLessThanOrEqual(4 * TILE);
          expect(isTileCentre(c), tag).toBe(true);
          const tiles = clearingTiles(m, c);
          expect(tiles.length, tag).toBeGreaterThan(1);
          for (const t of tiles) {
            expect(isFloorTile(m, t.x, t.y), `${tag}: wall at ${t.x},${t.y}`).toBe(true);
            expect(regionAtTile(m, t.x, t.y), `${tag}: tile ${t.x},${t.y}`).toBe(r.id);
            // Not on the footprint (0) or the ring road (1..3).
            expect(footprintDist(m)[tileIdx(m, t)], `${tag}: tile ${t.x},${t.y} on the coliseum or ring road`).toBeGreaterThanOrEqual(4);
          }
        }
      }
    });
  }, HEAVY_MS);

  it("gives each camp 3-4 distinct floor tile-centre spots inside the clearing (200 seeds)", () => {
    eachMap((m, s) => {
      for (const c of m.regions.flatMap((r) => r.mobCamps)) {
        const tag = `seed ${s} ${c.id}`;
        expect(c.spots.length, tag).toBeGreaterThanOrEqual(3);
        expect(c.spots.length, tag).toBeLessThanOrEqual(4);
        expect(new Set(c.spots.map(ptKey)).size, `${tag}: duplicate spots`).toBe(c.spots.length);
        for (const p of c.spots) {
          const t = tileOf(p);
          expect(isTileCentre(p), tag).toBe(true);
          expect(isFloorTile(m, t.x, t.y), tag).toBe(true);
          expect(dist(p, c), `${tag}: spot ${ptKey(p)} outside the clearing`).toBeLessThanOrEqual(c.r + 1e-9);
        }
      }
    });
  }, HEAVY_MS);

  it("makes the camp farthest from coliseum.centre the elite (200 seeds)", () => {
    eachMap((m, s) => {
      const centre = m.coliseum.centre;
      for (const r of m.regions) {
        const elite = r.mobCamps.find((c) => c.elite)!;
        for (const c of r.mobCamps) {
          // Exact: the generator measures from the centre of tile (32, 32), which is coliseum.centre. 1e-9 only absorbs float noise.
          expect(dist(elite, centre), `seed ${s} ${r.id}: elite ${elite.id} vs ${c.id}`).toBeGreaterThanOrEqual(dist(c, centre) - 1e-9);
        }
      }
    });
  }, HEAVY_MS);

  it("keeps a region's camp centres at least 7 tiles apart (9 relaxed to 7) (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        for (let i = 0; i < r.mobCamps.length; i++) {
          for (let j = i + 1; j < r.mobCamps.length; j++) {
            expect(dist(r.mobCamps[i], r.mobCamps[j]), `seed ${s} ${r.id} camps ${i},${j}`).toBeGreaterThanOrEqual(7 * TILE);
          }
        }
      }
    });
  }, HEAVY_MS);

  it("keeps the clearing, grown by one tile, inside its sector and clear of ruins, extracts and the border (200 seeds)", () => {
    eachMap((m, s) => {
      const ex = m.extracts.map(tileOf);
      for (const r of m.regions) {
        for (const c of r.mobCamps) {
          for (const t of clearingTiles(m, c)) {
            const tag = `seed ${s} ${c.id} tile ${t.x},${t.y}`;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const x = t.x + dx, y = t.y + dy;
                expect(regionAtTile(m, x, y), `${tag}: grown tile ${x},${y} outside the sector or on a ridge`).toBe(r.id);
                expect(x >= EDGE_CLEAR && y >= EDGE_CLEAR && x <= m.w - 1 - EDGE_CLEAR && y <= m.h - 1 - EDGE_CLEAR, `${tag}: too close to the border`).toBe(true);
                // Obstacles keep one tile of air from clearings.
                expect(isFloorTile(m, x, y), `${tag}: grown tile ${x},${y} is a wall`).toBe(true);
              }
            }
            for (const b of m.buildings) {
              const gx = Math.max(b.x - t.x, t.x - (b.x + b.w - 1), 0);
              const gy = Math.max(b.y - t.y, t.y - (b.y + b.h - 1), 0);
              expect(Math.max(gx, gy), `${tag}: too close to a ruin`).toBeGreaterThanOrEqual(3);
            }
            for (const e of ex) expect(cheb(e.x, e.y, t.x, t.y), `${tag}: too close to an extract`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });
  }, HEAVY_MS);
});

describe("reachability", () => {
  it("puts every spawn, chest, camp spot, anchor, inner spawn and extract on floor in the one open component (200 seeds)", () => {
    eachMap((m, s) => {
      const open = reachFrom(m, m.tiles, centreIdx(m));
      const check = (p: Vec2, what: string) => {
        const t = tileOf(p);
        expect(open[tileIdx(m, t)], `seed ${s}: ${what} ${ptKey(p)} unreachable`).toBe(1);
      };
      for (const p of m.coliseum.innerSpawns) check(p, "inner spawn");
      for (const e of m.extracts) check(e, `extract ${e.id}`);
      for (const r of m.regions) {
        check(r.anchor, `${r.id} anchor`);
        for (const p of r.spawns) check(p, `${r.id} spawn`);
        for (const p of r.chestSpots) check(p, `${r.id} chest`);
        for (const c of r.mobCamps) for (const p of [c, ...c.spots]) check(p, `${c.id} camp`);
      }
      for (const p of m.groundSpots) check(p, "ground spot");
    });
  }, HEAVY_MS);

  it("lets findPath walk from every spawn to the coliseum centre with the gates open (20 seeds)", () => {
    eachMap((m, s) => {
      for (const p of m.spawns) {
        expect(findPath(m, p, m.coliseum.centre).length, `seed ${s} spawn ${ptKey(p)}`).toBeGreaterThan(0);
      }
    }, seeds(20));
  }, HEAVY_MS);
});

describe("ruins", () => {
  const regionOfRect = (m: GameMap, b: TileRect) => m.regionGrid[b.y * m.w + b.x];

  it("has 1-2 per region, each entirely inside one faction region and clear of the coliseum (200 seeds)", () => {
    eachMap((m, s) => {
      const perRegion = new Map<number, number>();
      for (const b of m.buildings) {
        const code = regionOfRect(m, b);
        expect(isFactionCode(code), `seed ${s} ruin ${b.x},${b.y}: region ${REGION_IDS[code]}`).toBe(true);
        perRegion.set(code, (perRegion.get(code) ?? 0) + 1);
        for (let y = b.y; y < b.y + b.h; y++) {
          for (let x = b.x; x < b.x + b.w; x++) {
            expect(m.regionGrid[y * m.w + x], `seed ${s} ruin ${b.x},${b.y} tile ${x},${y} in another region`).toBe(code);
          }
        }
        const rc = m.coliseum.rect;
        const overlap = b.x < rc.x + rc.w && rc.x < b.x + b.w && b.y < rc.y + rc.h && rc.y < b.y + b.h;
        expect(overlap, `seed ${s} ruin ${b.x},${b.y} overlaps the coliseum rect`).toBe(false);
      }
      for (const f of REGION_FACTIONS) {
        const n = perRegion.get(regionCodeOf(f)) ?? 0;
        expect(n, `seed ${s} ${f} ruins`).toBeGreaterThanOrEqual(1);
        expect(n, `seed ${s} ${f} ruins`).toBeLessThanOrEqual(2);
      }
    });
  }, HEAVY_MS);

  it("varies between 5 and 10 ruins and is not always one per region", () => {
    const totals = new Set<number>();
    eachMap((m, s) => {
      expect(m.buildings.length, `seed ${s}`).toBeGreaterThanOrEqual(5);
      expect(m.buildings.length, `seed ${s}`).toBeLessThanOrEqual(10);
      totals.add(m.buildings.length);
    });
    expect(totals.size).toBeGreaterThanOrEqual(3);
  }, HEAVY_MS);

  it("is 7-9 tiles on a side, off the border, off the ring road and away from extracts and each other (200 seeds)", () => {
    eachMap((m, s) => {
      const d = footprintDist(m);
      const ex = m.extracts.map(tileOf);
      for (const b of m.buildings) {
        const tag = `seed ${s} ruin ${b.x},${b.y}`;
        expect(b.w, tag).toBeGreaterThanOrEqual(7);
        expect(b.w, tag).toBeLessThanOrEqual(9);
        expect(b.h, tag).toBeGreaterThanOrEqual(7);
        expect(b.h, tag).toBeLessThanOrEqual(9);
        expect(b.x, tag).toBeGreaterThanOrEqual(EDGE_CLEAR + 1);
        expect(b.y, tag).toBeGreaterThanOrEqual(EDGE_CLEAR + 1);
        expect(b.x + b.w, tag).toBeLessThanOrEqual(m.w - EDGE_CLEAR - 1);
        expect(b.y + b.h, tag).toBeLessThanOrEqual(m.h - EDGE_CLEAR - 1);
        // Grown by one tile it still avoids the ring road (distance 1..3) and the footprint.
        let nearest = 255;
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) nearest = Math.min(nearest, d[y * m.w + x]);
        expect(nearest, `${tag}: distance to the footprint`).toBeGreaterThanOrEqual(5);
        // The 9x9 extract keep-out.
        for (const e of ex) {
          const overlap = b.x <= e.x + 4 && e.x - 4 < b.x + b.w && b.y <= e.y + 4 && e.y - 4 < b.y + b.h;
          expect(overlap, `${tag} overlaps the keep-out of an extract`).toBe(false);
        }
        // Grown by one tile it stays in the ruin's own sector, so it never touches a ridge.
        const code = regionOfRect(m, b);
        for (let y = b.y - 1; y <= b.y + b.h; y++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
          expect(regionAtTile(m, x, y), `${tag}: margin tile ${x},${y}`).toBe(REGION_IDS[code]);
        }
      }
      for (let i = 0; i < m.buildings.length; i++) {
        for (let j = i + 1; j < m.buildings.length; j++) {
          const a = m.buildings[i], b = m.buildings[j];
          const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
          const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
          expect(Math.max(gapX, gapY), `seed ${s} ruins ${i},${j}`).toBeGreaterThanOrEqual(2);
        }
      }
    });
  }, HEAVY_MS);

  it("has solid 1-thick wall rings with 1-3 two-wide doors on distinct sides, never on corners (200 seeds)", () => {
    eachMap((m, s) => {
      for (const b of m.buildings) {
        const runs = doorRuns(m, b);
        const sides = new Set(runs.map((r) => r.side));
        expect(sides.size, `seed ${s}: one door per side`).toBe(runs.length);
        expect(runs.length, `seed ${s}`).toBeGreaterThanOrEqual(1);
        expect(runs.length, `seed ${s}`).toBeLessThanOrEqual(3);
        for (const r of runs) {
          expect(r.len, `seed ${s}`).toBe(2);
          const sideLen = r.side % 2 === 0 ? b.w : b.h;
          expect(r.start, `seed ${s}`).toBeGreaterThanOrEqual(1);
          expect(r.start + r.len, `seed ${s}`).toBeLessThanOrEqual(sideLen - 1);
        }
        for (const [cx, cy] of [[b.x, b.y], [b.x + b.w - 1, b.y], [b.x, b.y + b.h - 1], [b.x + b.w - 1, b.y + b.h - 1]]) {
          expect(isWallTile(m, cx, cy), `seed ${s}`).toBe(true);
        }
        const interior = (b.w - 2) * (b.h - 2);
        let open = 0;
        for (let y = b.y + 1; y < b.y + b.h - 1; y++) for (let x = b.x + 1; x < b.x + b.w - 1; x++) if (isFloorTile(m, x, y)) open++;
        expect(open / interior, `seed ${s}`).toBeGreaterThan(0.6);
      }
    });
  }, HEAVY_MS);

  it("sometimes carves interior partitions: a straight wall run across the interior with one two-tile gap", () => {
    let withPartition = 0;
    eachMap((m) => {
      for (const b of m.buildings) if (partitionGaps(m, b).length > 0) withPartition++;
    });
    // Only ruins 9 tiles on a side have room for a partition (v1 needs a 7-wide interior). Cover can
    // stand inside a ruin too, so this finds partitions by their shape, not by "some interior wall".
    expect(withPartition).toBeGreaterThanOrEqual(10);
  }, HEAVY_MS);

  it("keeps every ruin door and partition gap open, with floor on both sides of it (200 seeds)", () => {
    eachMap((m, s) => {
      for (const b of m.buildings) {
        const tag = `seed ${s} ruin ${b.x},${b.y}`;
        for (const d of ruinDoors(m, b)) {
          expect(isFloorTile(m, d.outside.x, d.outside.y), `${tag}: door ${d.door.x},${d.door.y} blocked outside at ${d.outside.x},${d.outside.y}`).toBe(true);
          expect(isFloorTile(m, d.inside.x, d.inside.y), `${tag}: door ${d.door.x},${d.door.y} blocked inside at ${d.inside.x},${d.inside.y}`).toBe(true);
        }
        for (const p of partitionGaps(m, b)) {
          for (const g of p.gap) {
            for (const sign of [-1, 1]) {
              const x = g.x + sign * p.across[0], y = g.y + sign * p.across[1];
              expect(isFloorTile(m, x, y), `${tag}: partition gap ${g.x},${g.y} blocked at ${x},${y}`).toBe(true);
            }
          }
        }
      }
    });
  }, HEAVY_MS);
});

describe("obstacles and cover", () => {
  it("keeps outdoor walls to small blobs: obstacle chunks and rocks, never a long wall (200 seeds)", () => {
    // Obstacle chunks are at most 3 long and rocks 2, but the cover pass only prefers to keep rocks apart and relaxes
    // that when nothing better is left, so rocks and chunks do chain: the longest straight run is 12 over the first
    // 200 seeds (seed 99). A run of MAX_SIGHT_CORRIDOR / TILE = 15 tiles would be a wall as long as the longest open
    // corridor the rocks exist to cut: a maze-like barrier that blocks paths as well as sight, not cover. The bound is
    // one under that, 14: it keeps 2 tiles of margin over the observed 12 and still fails a wall of 15.
    const MAX_WALL_RUN = MAX_SIGHT_CORRIDOR / TILE - 1;
    let longest = { run: 0, seed: -1 };
    eachMap((m, s) => {
      // Floor sealed off by a ridge or the border is walled by the connectivity pass and keeps its sector
      // code. Those pockets always touch a region-none tile, so they are not obstacles or rocks.
      const blobs = outdoorWallBlobs(m).filter((q) => !q.touchesNone);
      const wall = new Set<number>();
      for (const c of blobs) for (const t of c.tiles) wall.add(t.y * m.w + t.x);
      for (const c of blobs) {
        const tag = `seed ${s} blob ${c.x0},${c.y0}`;
        expect(isFactionCode(c.code), tag).toBe(true);
        // An obstacle chunk is at most 3 long and a rock at most 2, and they only chain by touching, so
        // no straight run of wall tiles may get long. (Blob width would also catch chains, but a chain
        // of touching rocks is allowed to wind.)
        for (const t of c.tiles) {
          for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
            if (wall.has((t.y - dy) * m.w + t.x - dx)) continue; // not the start of a run
            let run = 0;
            while (wall.has((t.y + dy * run) * m.w + t.x + dx * run)) run++;
            if (run > longest.run) longest = { run, seed: s };
            expect(run, `${tag}: straight wall run of ${run} tiles from ${t.x},${t.y}`).toBeLessThanOrEqual(MAX_WALL_RUN);
          }
        }
      }
    });
    console.info(`[cover] longest straight outdoor wall run: ${longest.run} tiles (seed ${longest.seed}); bound ${MAX_WALL_RUN}`);
  }, HEAVY_MS);

  it("never walls the tiles that must stay floor: spawn 3x3, chest, camp clearing, gate lanes, extract 5x5 (200 seeds)", () => {
    eachMap((m, s) => {
      for (const r of m.regions) {
        for (const p of r.spawns) {
          const t = tileOf(p);
          expect(clear3x3(m, t.x, t.y), `seed ${s} ${r.id} spawn ${ptKey(p)}: 3x3 not clear`).toBe(true);
        }
        for (const p of r.chestSpots) {
          const t = tileOf(p);
          expect(isFloorTile(m, t.x, t.y), `seed ${s} ${r.id} chest ${ptKey(p)} is a wall`).toBe(true);
        }
        for (const c of r.mobCamps) {
          for (const t of clearingTiles(m, c)) expect(isFloorTile(m, t.x, t.y), `seed ${s} ${c.id} clearing tile ${t.x},${t.y}`).toBe(true);
        }
      }
      for (const t of gateLaneTiles(m)) expect(isFloorTile(m, t.x, t.y), `seed ${s}: gate lane tile ${t.x},${t.y}`).toBe(true);
      for (const e of m.extracts) {
        const tx = worldToTile(e.x), ty = worldToTile(e.y);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) expect(isFloorTile(m, tx + i, ty + j), `seed ${s} ${e.id} patch tile ${tx + i},${ty + j}`).toBe(true);
      }
    });
  }, HEAVY_MS);

  it("keeps a pass of at least two tile pairs open through every ridge (200 seeds)", () => {
    // The pass and one tile around it are protected, so cover can never narrow it.
    eachMap((m, s) => {
      const order = sectorOrder(m);
      const d = footprintDist(m);
      for (let k = 0; k < order.length; k++) {
        const a = regionCodeOf(order[k]), b = regionCodeOf(order[(k + 1) % order.length]);
        let pairs = 0;
        for (let y = 0; y < m.h; y++) {
          for (let x = 0; x < m.w; x++) {
            const i = y * m.w + x;
            if (m.tiles[i] !== TILE_FLOOR || d[i] < 5) continue;
            for (const [dx, dy] of [[1, 0], [0, 1]]) {
              if (x + dx >= m.w || y + dy >= m.h) continue;
              const j = (y + dy) * m.w + x + dx;
              if (m.tiles[j] !== TILE_FLOOR || d[j] < 5) continue;
              const ca = m.regionGrid[i], cb = m.regionGrid[j];
              if ((ca === a && cb === b) || (ca === b && cb === a)) pairs++;
            }
          }
        }
        expect(pairs, `seed ${s}: floor pairs through the ridge ${order[k]} | ${order[(k + 1) % order.length]}`).toBeGreaterThanOrEqual(2);
      }
    });
  }, HEAVY_MS);
});

describe("legacy extraction loop", () => {
  const edgeOf = (m: GameMap, e: { x: number; y: number }) => {
    const tx = worldToTile(e.x), ty = worldToTile(e.y);
    const d = [ty, m.w - 1 - tx, m.h - 1 - ty, tx];
    const min = Math.min(...d);
    return { edge: d.indexOf(min), tilesIn: min };
  };

  it("keeps 3 extract zones on 3 different edges, 3-5 tiles in, with a clear 5x5 floor patch (200 seeds)", () => {
    const names = ["North Gate", "East Docks", "South Tunnel", "West Road"];
    eachMap((m, s) => {
      expect(m.extracts.map((e) => e.id), `seed ${s}`).toEqual(["x1", "x2", "x3"]);
      const edges = new Set<number>();
      for (const e of m.extracts) {
        expect(e.r, `seed ${s}`).toBe(EXTRACT_RADIUS);
        const { edge, tilesIn } = edgeOf(m, e);
        edges.add(edge);
        expect(tilesIn, `seed ${s} ${e.id}`).toBeGreaterThanOrEqual(3);
        expect(tilesIn, `seed ${s} ${e.id}`).toBeLessThanOrEqual(5);
        expect(e.name, `seed ${s} ${e.id}`).toBe(names[edge]);
        expect(isTileCentre(e), `seed ${s} ${e.id}`).toBe(true);
        const tx = worldToTile(e.x), ty = worldToTile(e.y);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) expect(isFloorTile(m, tx + i, ty + j), `seed ${s} ${e.id}`).toBe(true);
      }
      expect(edges.size, `seed ${s}`).toBe(3);
    });
  }, HEAVY_MS);

  it("scatters 20-30 ground spots outside ruins and the coliseum, 3+ tiles from every spawn (200 seeds)", () => {
    eachMap((m, s) => {
      expect(m.groundSpots.length, `seed ${s}`).toBeGreaterThanOrEqual(20);
      expect(m.groundSpots.length, `seed ${s}`).toBeLessThanOrEqual(30);
      expect(new Set(m.groundSpots.map(ptKey)).size, `seed ${s}: duplicates`).toBe(m.groundSpots.length);
      for (const p of m.groundSpots) {
        const t = tileOf(p);
        expect(isTileCentre(p), `seed ${s}`).toBe(true);
        expect(isFloorTile(m, t.x, t.y), `seed ${s}`).toBe(true);
        expect(inAnyBuilding(m, t.x, t.y), `seed ${s} ground spot in a ruin`).toBe(false);
        expect(regionAtTile(m, t.x, t.y), `seed ${s} ground spot in the coliseum`).not.toBe("coliseum");
        for (const sp of m.spawns) expect(dist(p, sp), `seed ${s}`).toBeGreaterThanOrEqual(3 * TILE);
      }
    });
  }, HEAVY_MS);

  it("keeps ground spots off chests (not within Chebyshev 1) and out of every camp clearing (200 seeds)", () => {
    eachMap((m, s) => {
      const chests = m.regions.flatMap((r) => r.chestSpots.map((c) => ({ id: r.id, p: c, t: tileOf(c) })));
      const camps = m.regions.flatMap((r) => r.mobCamps);
      for (const g of m.groundSpots) {
        const gt = tileOf(g);
        for (const c of chests) {
          expect(cheb(gt.x, gt.y, c.t.x, c.t.y), `seed ${s}: ground spot ${ptKey(g)} next to ${c.id} chest ${ptKey(c.p)}`).toBeGreaterThanOrEqual(2);
        }
        for (const c of camps) expect(dist(g, c), `seed ${s}: ground spot ${ptKey(g)} inside the clearing of ${c.id}`).toBeGreaterThan(c.r);
      }
    });
  }, HEAVY_MS);
});

describe("anti-kiting cover", () => {
  // Owner decision: every usable sight corridor (a strip SIGHT_CORRIDOR_WIDTH wide, at any angle and offset) is at most
  // MAX_SIGHT_CORRIDOR long (480 u, the bow's range before the 9.1 tuning cut it to 240), anywhere on the map: the faction regions, the coliseum with its gates
  // closed, and the lines that run through the open gates. All of those are subsets of "all floor, gates open".
  const u = (tiles: number) => tiles * TILE;

  /** Logs max / median / min over `lens` (world units) and returns the index of the max. */
  const summarise = (label: string, lens: number[], seedOf: (i: number) => number, limit: number): number => {
    const worst = lens.indexOf(Math.max(...lens));
    const sorted = [...lens].sort((a, b) => a - b);
    console.info(
      `[anti-kiting] ${label}: max ${sorted[sorted.length - 1].toFixed(1)} u (${(sorted[sorted.length - 1] / TILE).toFixed(2)} tiles) at seed ${seedOf(worst)}, ` +
      `median ${sorted[sorted.length >> 1].toFixed(1)} u, min ${sorted[0].toFixed(1)} u; ` +
      `${lens.filter((v) => v > limit + LANE_SLACK_U).length} of ${lens.length} over ${limit.toFixed(1)} u`,
    );
    return worst;
  };

  it("pins the corridor constants: MAX_SIGHT_CORRIDOR covers the bow's range, SIGHT_CORRIDOR_WIDTH one tile", () => {
    // 480 was the bow's range until the 9.1 tuning cut it to 240 (docs/GAME_DESIGN.md 9.4, "Tuning (9.1)"). The cap stays at 480: mapgen's
    // covers and spawn screens are certified for it, and a longer cap than the bow needs only makes the screens safer.
    // It must never fall below a projectile's range.
    expect(MAX_SIGHT_CORRIDOR).toBe(480);
    for (const w of [WEAPONS.bow, WEAPONS.wand]) {
      if (w.shape.kind !== "projectile") throw new Error("projectile");
      expect(w.shape.range).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR);
    }
    // One tile wide: the width the generator's line lattice certifies (see the containment test below).
    expect(SIGHT_CORRIDOR_WIDTH).toBe(32);
  });

  it("covers every angle: the lattice's direction gap and lane bound keep any strip of the corridor width under 480 u", () => {
    // A strip of width W and length l at angle theta lies within delta = pi / (2 * dirs) of a sampled direction. Inside
    // it sits a strip in that direction of width 2 * step (so it holds a whole lattice lane) and length
    // min((W - 2 * step * cos(delta)) / sin(delta), (l - 2 * step * sin(delta)) / cos(delta)). If every lattice lane is
    // at most `target`, the first term must not be the smaller one, and then l <= cos(delta) * target + 2 * step * sin(delta).
    const { dirs, step, target } = sightLattice();
    const W = SIGHT_CORRIDOR_WIDTH / TILE;
    const L = MAX_SIGHT_CORRIDOR / TILE;
    const delta = Math.PI / (2 * dirs);
    expect(Number.isInteger(dirs) && dirs > 0 && step > 0, "dirs a positive integer and step positive").toBe(true);
    expect(Math.sin(delta), "the width term would cap the contained strip below the lane bound").toBeLessThanOrEqual((W - 2 * step) / target);
    const bound = Math.cos(delta) * target + 2 * step * Math.sin(delta);
    expect(bound, `any strip is at most ${bound.toFixed(4)} tiles long, which must stay under ${L}`).toBeLessThan(L);
    expect(target).toBeLessThanOrEqual(L);
  });

  it("keeps every lattice lane over all floor, gates open, at the generator's target or less on every seed (200 seeds)", () => {
    const { dirs, step, target } = sightLattice();
    const bound = u(target);
    const lens = SEEDS.map((s) => u(openLane(s).len));
    summarise(`longest lattice lane (${dirs} directions, ${step} tile lines), all floor`, lens, (i) => SEEDS[i], bound);
    // The generator's own checker should agree with this independent one; reported rather than asserted.
    try {
      const own = SEEDS.map((s) => longestLane(mapFor(s)));
      const apart = own.filter((v, i) => Math.abs(v - lens[i]) > 1e-3).length;
      console.info(`[anti-kiting] generator longestLane: max ${Math.max(...own).toFixed(1)} u; ${apart} of ${SEEDS.length} seeds differ from this checker by more than 0.001 u`);
    } catch (err) {
      console.info(`[anti-kiting] generator longestLane unavailable: ${String(err)}`);
    }
    for (const s of SEEDS) {
      const r = openLane(s);
      expect(u(r.len), `seed ${s}: lattice lane ${u(r.len).toFixed(1)} u (direction ${r.k}/${dirs}, lower line offset ${r.o} tiles), limit ${bound.toFixed(1)} u`).toBeLessThanOrEqual(bound + LANE_SLACK_U);
    }
  }, HEAVY_MS);

  it("keeps every lattice lane inside the coliseum with the gates closed at the generator's target or less (200 seeds)", () => {
    // Implied by the open-set test above (it is a subset), pinned on its own because the sealed fight is where kiting hurts most.
    const { dirs, target } = sightLattice();
    const bound = u(target);
    summarise("longest lattice lane, sealed coliseum", SEEDS.map((s) => u(sealedLane(s).len)), (i) => SEEDS[i], bound);
    for (const s of SEEDS) {
      const r = sealedLane(s);
      expect(u(r.len), `seed ${s}: sealed coliseum lattice lane ${u(r.len).toFixed(1)} u (direction ${r.k}/${dirs}, lower line offset ${r.o} tiles), limit ${bound.toFixed(1)} u`).toBeLessThanOrEqual(bound + LANE_SLACK_U);
    }
  }, HEAVY_MS);

  it("finds no strip one corridor-width wide longer than 480 u at the angles farthest from any lattice direction, gates open (exact check, 40 seeds)", () => {
    // The lattice tests above only look along the lattice's own directions. This clips every blocked tile against slabs
    // at the midpoints between neighbouring directions of the 32- and 48-direction lattices, where a strip that fits
    // between two lattice lanes is hardest to see, minus any midpoint that lands on the other lattice. So no angle here
    // is a multiple of pi/32 or pi/48. The 40 seeds are what it takes: with the pre-fix lattice (32 directions, lines
    // half a width apart) seeds 10, 19, 30 (564 u) and 36 fail, and none of the first 5 did. Open = floor with a region other
    // than none; offsets every 1/16 tile. Sampling can only under-report, never invent a corridor.
    const t0 = performance.now();
    const sample = seeds(40);
    const lattices = [...new Set([32, 48, sightLattice().dirs])];
    const onLattice = (th: number) => lattices.some((n) => Math.abs((th * n) / Math.PI - Math.round((th * n) / Math.PI)) < 1e-9);
    const thetas = lattices
      .flatMap((n) => Array.from({ length: n }, (_, k) => ((k + 0.5) * Math.PI) / n))
      .filter((th) => !onLattice(th));
    const blockedOf = (m: GameMap) => allFloorMask(m).map((v) => 1 - v) as Uint8Array;
    const full = sample.map((s) => {
      const m = mapFor(s);
      return longestFreeStrip(blockedOf(m), m.w, m.h, STRIP_W, thetas, 1 / 16);
    });
    // Narrower strips are reported, not asserted: how much slack the 32 u rule leaves for 24 u and 16 u wide corridors.
    const tFull = performance.now();
    const coarse = Array.from({ length: 90 }, (_, k) => (k * Math.PI) / 90);
    const narrow = [0.75, 0.5].map((wt) => sample.slice(0, 3).map((s) => {
      const m = mapFor(s);
      return longestFreeStrip(blockedOf(m), m.w, m.h, wt, coarse, 1 / 8).len * TILE;
    }));
    const worst = full.reduce((best, r, i) => (r.len > full[best].len ? i : best), 0);
    console.info(
      `[anti-kiting] exact strips over seeds 0-${sample.length - 1} at ${thetas.length} off-lattice angles: ${SIGHT_CORRIDOR_WIDTH} u wide max ` +
      `${(full[worst].len * TILE).toFixed(1)} u (seed ${sample[worst]}, ${full[worst].deg.toFixed(2)} deg); ` +
      `24 u wide max ${Math.max(...narrow[0]).toFixed(1)} u, 16 u wide max ${Math.max(...narrow[1]).toFixed(1)} u (seeds 0-2, 2 degrees, 1/8 tile; not asserted); ` +
      `${(tFull - t0).toFixed(0)} + ${(performance.now() - tFull).toFixed(0)} ms`,
    );
    full.forEach((r, i) => {
      expect(r.len * TILE, `seed ${sample[i]}: a free strip ${SIGHT_CORRIDOR_WIDTH} u wide and ${(r.len * TILE).toFixed(1)} u long at ${r.deg.toFixed(2)} deg`).toBeLessThanOrEqual(MAX_SIGHT_CORRIDOR + LANE_SLACK_U);
    });
  }, 30_000);

  it("finds no corridor over 576 u with a disc of radius 16 u through any open tile centre (64 directions, 20 seeds, faction regions and sealed coliseum)", () => {
    // Sanity net for the canonical lines: slack of 1.2x because they only catch corridors >= 2 line spacings wide for certain.
    const dense = seeds(20).map((s) => {
      const m = mapFor(s);
      return {
        s,
        faction: denseDisc(factionMask(m), m.w, m.h, DISC_R),
        coliseum: denseDisc(coliseumMask(m, true), m.w, m.h, DISC_R),
      };
    });
    const bound = DISC_SLACK * MAX_SIGHT_CORRIDOR + LANE_SLACK_U;
    summarise("dense disc segment, faction regions", dense.map((d) => u(d.faction.len)), (i) => dense[i].s, bound);
    summarise("dense disc segment, sealed coliseum", dense.map((d) => u(d.coliseum.len)), (i) => dense[i].s, bound);
    for (const d of dense) {
      expect(u(d.faction.len), `seed ${d.s}: faction-region disc segment through tile ${d.faction.x},${d.faction.y} (direction ${d.faction.k}/64) is ${u(d.faction.len).toFixed(1)} u, limit ${DISC_SLACK * MAX_SIGHT_CORRIDOR} u`).toBeLessThanOrEqual(bound);
      expect(u(d.coliseum.len), `seed ${d.s}: coliseum disc segment through tile ${d.coliseum.x},${d.coliseum.y} (direction ${d.coliseum.k}/64) is ${u(d.coliseum.len).toFixed(1)} u, limit ${DISC_SLACK * MAX_SIGHT_CORRIDOR} u`).toBeLessThanOrEqual(bound);
    }
  }, HEAVY_MS);

  it("puts some cover in every region: at least one separate rock or chunk per region (200 seeds)", () => {
    eachMap((m, s) => {
      const perRegion = new Array(REGION_IDS.length).fill(0);
      for (const b of outdoorWallBlobs(m)) if (!b.touchesNone) perRegion[b.code]++;
      for (const f of REGION_FACTIONS) expect(perRegion[regionCodeOf(f)], `seed ${s} ${f}: outdoor wall blobs`).toBeGreaterThanOrEqual(1);
    });
  }, HEAVY_MS);
});

describe("R0 wedge adapter: the roguelike camp contract filled from the wedge data (200 seeds)", () => {
  const zoneOfCode = (code: number) => REGION_FACTIONS[code - 1];

  it("makes one CampDef per wedge camp, in REGION_FACTIONS order then camp index, with the same ids", () => {
    eachMap((m, s) => {
      const wedge = m.regions.flatMap((r) => r.mobCamps);
      expect(m.camps.length, `seed ${s}`).toBe(wedge.length);
      expect(m.camps.map((c) => c.id), `seed ${s}`).toEqual(wedge.map((c) => c.id));
      expect(m.regions.map((r) => r.id), `seed ${s}`).toEqual([...REGION_FACTIONS]);
      const perZone = new Map<string, number>();
      m.camps.forEach((c, i) => {
        const n = (perZone.get(c.zone) ?? 0) + 1;
        perZone.set(c.zone, n);
        expect(c.id, `seed ${s} camp ${i}`).toBe(`${c.zone}-${n}`);
        if (i > 0) expect(REGION_FACTIONS.indexOf(c.zone), `seed ${s} camp ${i}: zone order`).toBeGreaterThanOrEqual(REGION_FACTIONS.indexOf(m.camps[i - 1].zone));
      });
      expect(new Set(m.camps.map((c) => c.id)).size, `seed ${s}: ids unique`).toBe(m.camps.length);
    });
  }, HEAVY_MS);

  it("copies each wedge camp's zone, centre, radius and spots, with 3-5 spots, a leash of the old 9 tiles and no territory", () => {
    eachMap((m, s) => {
      const wedge = m.regions.flatMap((r) => r.mobCamps);
      m.camps.forEach((c, i) => {
        const w = wedge[i];
        expect(c.zone, `seed ${s} ${c.id}`).toBe(w.region);
        expect([c.x, c.y, c.r], `seed ${s} ${c.id}`).toEqual([w.x, w.y, w.r]);
        expect(c.spots, `seed ${s} ${c.id}`).toEqual(w.spots);
        expect(c.spots, `seed ${s} ${c.id}: its own array`).not.toBe(w.spots);
        expect(c.spots.length, `seed ${s} ${c.id}`).toBeGreaterThanOrEqual(3);
        expect(c.spots.length, `seed ${s} ${c.id}`).toBeLessThanOrEqual(5);
        expect(c.area, `seed ${s} ${c.id}`).toBe(0);
        expect(c.radius, `seed ${s} ${c.id}`).toBe(MOB_LEASH_RADIUS);
        expect(c.radius, `seed ${s} ${c.id}`).toBe(9 * TILE);
      });
    });
  }, HEAVY_MS);

  it("puts every chest on a floor tile of the clearing, in the camp's zone, never on a spot of any camp, and gives no two camps one chest", () => {
    const chests = new Set<string>();
    const allSpots = new Set<string>();
    eachMap((m, s) => {
      chests.clear();
      allSpots.clear();
      for (const c of m.camps) for (const p of c.spots) allSpots.add(ptKey(p));
      for (const c of m.camps) {
        const label = `seed ${s} ${c.id}`;
        expect(isTileCentre(c.chest), `${label}: a tile centre`).toBe(true);
        const t = tileOf(c.chest);
        expect(isFloorTile(m, t.x, t.y), `${label}: floor in the final tiles`).toBe(true);
        expect(Math.hypot(c.chest.x - c.x, c.chest.y - c.y), `${label}: inside the clearing`).toBeLessThanOrEqual(c.r + 1e-9);
        expect(regionOfPoint(m, c.chest), `${label}: in the camp's zone`).toBe(c.zone);
        expect(allSpots.has(ptKey(c.chest)), `${label}: not a spot`).toBe(false);
        expect(chests.has(ptKey(c.chest)), `${label}: chest shared with another camp`).toBe(false);
        chests.add(ptKey(c.chest));
      }
    });
  }, HEAVY_MS);

  it("picks the nearest qualifying clearing tile as the chest (ties: lowest row, then lowest column)", () => {
    eachMap((m, s) => {
      for (const c of m.camps) {
        const wedge = m.regions.find((r) => r.id === c.zone)!.mobCamps.find((q) => q.id === c.id)!;
        const spots = new Set(c.spots.map(ptKey));
        const cands = clearingTiles(m, wedge)
          .filter((t) => isFloorTile(m, t.x, t.y) && !spots.has(ptKey({ x: tileToWorldCenter(t.x), y: tileToWorldCenter(t.y) })))
          .map((t) => ({ t, d: (t.x - worldToTile(c.x)) ** 2 + (t.y - worldToTile(c.y)) ** 2 }))
          .sort((a, b) => a.d - b.d || a.t.y - b.t.y || a.t.x - b.t.x);
        expect(cands.length, `seed ${s} ${c.id}: a qualifying tile exists`).toBeGreaterThan(0);
        expect(tileOf(c.chest), `seed ${s} ${c.id}`).toEqual(cands[0].t);
      }
    });
  }, HEAVY_MS);

  it("marks spot 0 as the elite spot of each zone's one elite camp and -1 on every other camp", () => {
    eachMap((m, s) => {
      for (const f of REGION_FACTIONS) {
        const zoneCamps = m.camps.filter((c) => c.zone === f);
        const wedge = m.regions.find((r) => r.id === f)!.mobCamps;
        expect(zoneCamps.length, `seed ${s} ${f}`).toBe(wedge.length);
        expect(zoneCamps.filter((c) => c.eliteSpot !== -1).length, `seed ${s} ${f}: exactly one elite camp`).toBe(1);
        zoneCamps.forEach((c, i) => {
          expect(c.eliteSpot, `seed ${s} ${c.id}`).toBe(wedge[i].elite ? 0 : -1);
          if (c.eliteSpot !== -1) expect(c.eliteSpot).toBeLessThan(c.spots.length);
        });
      }
    });
  }, HEAVY_MS);

  it("tags spawnPool with each spawn's zone from regionGrid, in map.spawns order", () => {
    eachMap((m, s) => {
      expect(m.spawnPool, `seed ${s}`).toEqual(
        m.spawns.map((p) => ({ x: p.x, y: p.y, zone: zoneOfCode(m.regionGrid[worldToTile(p.y) * m.w + worldToTile(p.x)]) })),
      );
      expect(m.spawnPool.length, `seed ${s}`).toBeGreaterThanOrEqual(MAX_PLAYERS);
      for (const p of m.spawnPool) expect(REGION_FACTIONS as readonly string[], `seed ${s}`).toContain(p.zone);
      expect(new Set(m.spawnPool.map((p) => p.zone)).size, `seed ${s}: every zone has spawns`).toBe(REGION_FACTIONS.length);
    });
  }, HEAVY_MS);

  it("leaves territoryGrid all zero at w*h, and gives every region its anchor as pole and its floor tile count as area", () => {
    eachMap((m, s) => {
      expect(m.territoryGrid, `seed ${s}`).toBeInstanceOf(Uint8Array);
      expect(m.territoryGrid.length, `seed ${s}`).toBe(m.w * m.h);
      expect(m.territoryGrid.every((v) => v === 0), `seed ${s}: no territory on wedge maps`).toBe(true);
      expect(m.territoryGrid, `seed ${s}: its own buffer`).not.toBe(m.regionGrid);
      for (const r of m.regions) {
        expect(r.pole, `seed ${s} ${r.id}`).toEqual(r.anchor);
        const code = REGION_IDS.indexOf(r.id);
        let floor = 0;
        for (let i = 0; i < m.tiles.length; i++) if (m.regionGrid[i] === code && m.tiles[i] === TILE_FLOOR) floor++;
        expect(r.area, `seed ${s} ${r.id}`).toBe(floor);
        expect(r.area, `seed ${s} ${r.id}`).toBeGreaterThan(0);
      }
    });
  }, HEAVY_MS);

  it("records the attempt the map was built from as an integer >= 0", () => {
    const attempts: number[] = [];
    eachMap((m, s) => {
      expect(Number.isInteger(m.attempt), `seed ${s}`).toBe(true);
      expect(m.attempt, `seed ${s}`).toBeGreaterThanOrEqual(0);
      attempts.push(m.attempt);
    });
    // Most seeds certify on the first attempt and some need a retry: the field carries the index, not a constant.
    expect(attempts.some((a) => a === 0)).toBe(true);
    expect(attempts.some((a) => a > 0)).toBe(true);
  }, HEAVY_MS);

  it("is generated the same way twice, new fields included, and returns fresh buffers each call", () => {
    for (const s of seeds(10, 5000)) {
      const a = generateMap(s), b = generateMap(s);
      expect(a.camps, `seed ${s}`).toEqual(b.camps);
      expect(a.spawnPool, `seed ${s}`).toEqual(b.spawnPool);
      expect(a.attempt, `seed ${s}`).toBe(b.attempt);
      expect(a.camps[0], `seed ${s}`).not.toBe(b.camps[0]);
      expect(a.camps[0].spots[0], `seed ${s}`).not.toBe(b.camps[0].spots[0]);
    }
  });
});

describe("performance", () => {
  it("generates a map in well under the budget on average (median of 7 batches)", () => {
    // The generator is held to 25 ms a map on average, measured separately and in isolation. This test runs inside
    // the full parallel suite, where CPU contention easily doubles a timing, so it takes the median of several batches
    // (one noisy batch cannot fail it) and allows 2x: 50 ms. It still catches a real regression, such as a runaway
    // retry loop or a quadratic pass, which costs several times that.
    for (let i = 0; i < 10; i++) generateMap(80_000 + i); // warm up the JIT and the lazy tables
    const batches: number[] = [];
    for (let b = 0; b < 7; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 8; i++) generateMap(10_000 + b * 8 + i);
      batches.push((performance.now() - t0) / 8);
    }
    const med = median(batches);
    console.info(`[perf] generateMap median of 7 batches: ${med.toFixed(1)} ms (batches ${batches.map((v) => v.toFixed(1)).join(", ")})`);
    expect(med).toBeLessThan(50);
  }, 60_000);
});
