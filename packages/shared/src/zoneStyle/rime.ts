// Rime (frost): The Mere (zone-shapes contract 4.4). Open drift with ice lakes: the camps look at each other across a sheet of ice;
// you run the lake (fast, exposed, slippery for everyone but Frost) or hug the shore behind faceted headlands. One mere per about
// 1700 tiles of zone (two on a 136x136 map), each grown in the largest empty circle of the camps; three angular headlands jut into
// every lake (whole or not at all, kept off the spawn walks), a small spire island stands in the middle, and a frozen watchtower
// (the zone's landmark) stands by each lake. Nothing else is walled: no scatter, no chunks, no ruins, no crevasses.
//
// Everything is integer maths and exact comparisons (thirds of a tile for distances, a quantized fBm for the shore); the only
// floats are plain + - * / and Math.sqrt/round, so a map is the same on every engine. Every wall goes through placeFeature as a
// named feature with its jobs: headland (lee), spire, causeway and mere (crossing) and the watchtower (landmark, lee).
//
// Sizing. A lake grows to LAKE_GROW tiles (a binary search on an integer threshold). Two meres whose ICE-able ground falls short
// of ICE_WANT (the lanes below and the camps' crowding take their share) let the first, which has the room, grow again.
//
// Spawn walks. A pool member's walk to the coliseum is kept whole twice over. (1) The members whose way to a gate passes near a lake
// get their real findPath route (on this zone's tiles, the other zones' ground taken as open so the pass stays zone-isolated); a
// headland or a spire never stands on a lane around one, so no route is lengthened, and the lake stays plain ground in a lane
// three tiles wide around each (a causeway feature owns it, packed snow for the art), so no route crosses ICE. (2) The zone's route
// guard (contract 3.9) looks at the rest: a headland or a spire that touches a member's corridor is tried first on a private copy of
// the tiles under a second guard of the feature kit's own making (a placed feature cannot be taken back), and is turned down above
// ROUTE_HEADLAND_MAX permille (2%).
import { TILE } from "../constants";
import { RING_ROAD, fixedLayout } from "../coliseum";
import { TILE_FLOOR, TILE_WALL, mapFromTiles, tileToWorldCenter } from "../map";
import type { GameMap } from "../map";
import { findPath } from "../pathfind";
import type { Rng } from "../rng";
import { TERRAIN_ICE } from "../terrain";
import { argmaxIn, dirIndex16, fbmQ, floodAbove, makeRouteGuard, tauForArea } from "./features";
import { bestLandmark, placeLandmark, stampFits, stampTemplate } from "./landmarks";
import type { LandmarkTemplate, Stamp } from "./landmarks";
import { PROP } from "./propKinds";
import { LANDMARKS_PER_ZONE } from "./scale";
import type { BaseCtx, LandmarkCtx, PropCtx, RouteGuard, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";

/** A lake of the plan. */
export interface LakePlan {
  /** Index of the lake in the zone (the `mere` feature's p[0]). */
  index: number;
  /** The seed tile: the largest empty circle the lake grew from. */
  seed: number;
  /** Clearance at the seed, thirds of a tile. */
  clr: number;
  /** The lake's FLOOR tiles after the headlands and the spire took theirs and the causeway lanes were cut out, ascending: the mere's. */
  tiles: number[];
  /** Tiles the lake had before the shelves (the grown and smoothed component). */
  grown: number;
  /** ICE tiles the surface pass laid (0 until it ran). */
  ice: number;
}

/** A headland or a spire: the wall tiles that stand, the lake it belongs to and (headlands) the outward DIR16. */
export interface ShelfPlan {
  lake: number;
  /** The centre tile the shelf was stamped on. */
  centre: number;
  /** Outward direction 0..15 (headlands); 0 for a spire. */
  dir: number;
  spire: boolean;
  walls: number[];
}

export interface RimePlan {
  lakes: LakePlan[];
  /** Headlands and spires in placement order. */
  shelves: ShelfPlan[];
  /** Lake tiles in the lanes around member routes: plain ground, owned by the causeway features. */
  causeway: number[];
  /** Members whose real route was computed (telemetry). */
  routed: number;
  /** Candidates tried on the private copy under the second guard, and the ones it turned down (telemetry). */
  probes: number;
  turnedDown: number;
}

// ------------------------------------------------------------------------------------------------ numbers (dials)
/** Tiles of lake the threshold search grows each mere to (the contract's 450, lowered: ICE_WANT makes up what the lanes and the shelves take). */
const LAKE_GROW = 400;
/** ICE-able lake tiles (off the lanes) the two meres should have together, before the shelves take theirs; and how far the first may grow to get them (percent of the usual size). */
const ICE_WANT = 820;
const LAKE_GROW_MAX = 250;
const SALT_ONE = 11;
const SALT_TWO = 41;
/** A mere smaller than this is not built (no headlands, no spire, no tower). */
const LAKE_MIN = 40;
/** The clearance the largest empty circle needs for a lake at all (thirds of a tile, 2 tiles). */
const LAKE_MIN_CLR = 6;
/** The second mere's seed needs this clearance (3 tiles) and this squared distance (18 tiles) from the first seed; the lakes keep a 2-tile gap. */
const LAKE2_CLR = 9;
const LAKE2_SEP2 = 18 * 18;
const LAKE_GAP = 2;
/** A zone with this many painted tiles or more gets two meres (the owner's question 1 defaults to two at 136x136). */
const TWO_LAKES_PAINTED = 2600;
/** Headlands per lake and candidate shore tiles tried for each. */
const HEADLANDS = 3;
const HEAD_TRIES = 4;
/** Shore candidates looked at for one headland (farthest from the camps first). */
const HEAD_LOOK = 48;
/** A headland (or spire) may stretch any member's walk by at most this, permille. */
const ROUTE_HEADLAND_MAX = 1020;
/** Shore tiles for a headland keep this chamfer distance (thirds) from the zone's rim, and this squared distance from camps and earlier headlands. */
const HEAD_EDGE = 18;
const HEAD_SEP2 = 49;
/** The spire needs this clearance (4.5 tiles); its shelf radius (tiles) and the fewest cells it may have. */
const SPIRE_CLR = 14;
const SPIRE_RADII: readonly number[] = [1.6, 1.9, 2.2];
const SPIRE_MIN_CELLS = 8;
/** The band around a real member route (Chebyshev): no shelf stands on it and no ICE lies on it (a lane three tiles wide). */
const ROUTE_BAND = 1;
/** A member's way to a gate counts as near a lake when it passes within this many tiles of the lake. */
const ROUTE_NEAR = 5;
/** The clearance margins, thirds of a tile: 5.6 tiles from a camp, 4 from the zone's rim, 5.5 from the ring road, 3.6 from a spawn, 3 from a landmark. */
const MARGIN_CAMP = 17;
const MARGIN_EDGE = 12;
const MARGIN_RING = 17;
const MARGIN_SPAWN = 11;
const MARGIN_LANDMARK = 9;
/** The second gate counts for a member when the way through it is within 8% of the first. */
const ROUTE_SECOND = 1080;
/** The zone guard's corridors are sources of the clearance with no margin: the lakes lean away from them (a lane of plain ground cuts less of a lake). */
const MARGIN_CORRIDOR = 0;
const BIG = 1 << 20;
/** A lake tile may be slightly under the margins (the smoothing rounds the shore): -1 third. */
const CLR_SLACK = -1;
/** The tower stands this many tiles beyond the lake's clearance radius; origins within this many tiles of the ideal one are tried. */
const TOWER_BEYOND = 3;
const TOWER_SPAN = 7;

// ------------------------------------------------------------------------------------------------ the watchtower (landmark)
/** The frozen watchtower (contract 5.2): 8x7, two 2-wide doors on opposite sides, two crate nooks; jobs landmark and lee. */
export const WATCHTOWER: LandmarkTemplate = {
  key: "watchtower",
  rows: [
    "_##dd##_",
    "##....##",
    "#c.....#",
    "#......#",
    "#.....c#",
    "##....##",
    "_##dd##_",
  ],
  jobs: ["landmark", "lee"],
};
/** The landmark templates of this zone (the generator's crates and the client's art look them up by key). */
export const RIME_TEMPLATES: readonly LandmarkTemplate[] = [WATCHTOWER];

// ------------------------------------------------------------------------------------------------ shelf shapes
const NORMALS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * The cells of one angular shelf, as offsets from its centre: the intersection of 4-8 half-planes (the four axis normals
 * always, each diagonal with p 0.75), at axis distance rad * (0.7 .. 1.3) and diagonal distance rad * (1 .. 1.7), nearest
 * the centre first. An intersection of half-planes is convex.
 */
export function facetShelfCells(rng: Rng, rad: number): Array<[number, number]> {
  const picks: number[] = [];
  for (let k = 0; k < 8; k++) if (rng() < 0.75 || k < 4) picks.push(k);
  const ds = picks.map((k) => (k < 4 ? rad * (0.7 + rng() * 0.6) : rad * (1.0 + rng() * 0.7)));
  const cells: Array<[number, number, number]> = [];
  const R = Math.ceil(rad * 1.6) + 1;
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      let inside = true;
      for (let q = 0; q < picks.length && inside; q++) {
        const [nx, ny] = NORMALS[picks[q]];
        if (nx * ox + ny * oy > ds[q]) inside = false;
      }
      if (inside) cells.push([ox, oy, ox * ox + oy * oy]);
    }
  }
  cells.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  return cells.map(([ox, oy]) => [ox, oy]);
}

// ------------------------------------------------------------------------------------------------ the clearance field
/** This zone's camp centres as tile indices (the context lists every camp of the map). */
function zoneCamps(c: BaseCtx): number[] {
  const out: number[] = [];
  for (const k of c.camps) {
    const i = k.y * c.w + k.x;
    if (c.mask[i] === 1) out.push(i);
  }
  return out;
}

/** The mouths of the coliseum's four gates in tile units (3 tiles out of each gate); null off the generator's grid. */
function gateMouths(c: BaseCtx): Array<[number, number]> | null {
  const fl = fixedLayout();
  if (fl.distFp.length !== c.w * c.h) return null;
  return fl.gates.map((g) => {
    const ox = g.side === "e" ? 3 : g.side === "w" ? -3 : 0, oy = g.side === "s" ? 3 : g.side === "n" ? -3 : 0;
    return [g.x / TILE + ox, g.y / TILE + oy] as [number, number];
  });
}

/**
 * The straight ways of one pool member to the gates that are worth walking: the nearest gate's mouth, and the second nearest when
 * the way through it is within ROUTE_SECOND (permille) of the first. [x, y] of the mouth in tile units, nearest first.
 */
function memberWays(mouths: ReadonlyArray<[number, number]>, mx: number, my: number): Array<[number, number]> {
  const px = mx + 0.5, py = my + 0.5;
  const cx = (mouths[0][0] + mouths[2][0]) / 2, cy = (mouths[1][1] + mouths[3][1]) / 2;
  const ways = mouths.map((m) => {
    const a = Math.sqrt((px - m[0]) * (px - m[0]) + (py - m[1]) * (py - m[1]));
    const b = Math.sqrt((m[0] - cx) * (m[0] - cx) + (m[1] - cy) * (m[1] - cy));
    return { len: a + b, m };
  });
  ways.sort((p, q) => p.len - q.len);
  const out: Array<[number, number]> = [ways[0].m];
  if (ways[1].len * 1000 <= ways[0].len * ROUTE_SECOND) out.push(ways[1].m);
  return out;
}

/**
 * The clearance, thirds of a tile: min(dCamp - 17, dEdge - 12, dRing - 17, dSpawn - 11, dLandmark - 9) with every distance a 3-4
 * chamfer. It is ONE chamfer pass pair whose sources start at minus their margin (a minimum of margin-shifted distances is a
 * chamfer from sources that start at the shifts). Tiles outside the zone are sources at -12, so they read negative.
 */
function clearanceField(c: BaseCtx, withSpawns: boolean, corridor: Uint8Array | null = null): Int32Array {
  const { w, h, mask } = c;
  const n = w * h;
  const d = new Int32Array(n);
  for (let i = 0; i < n; i++) d[i] = mask[i] === 1 ? BIG : -MARGIN_EDGE;
  const fl = fixedLayout();
  if (fl.ring.length === n) for (let i = 0; i < n; i++) if (fl.ring[i] === 1 && d[i] > -MARGIN_RING) d[i] = -MARGIN_RING;
  for (const i of zoneCamps(c)) if (d[i] > -MARGIN_CAMP) d[i] = -MARGIN_CAMP;
  if (withSpawns) for (const i of c.spawns) if (d[i] > -MARGIN_SPAWN) d[i] = -MARGIN_SPAWN;
  const b = c.zone.bbox;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * w + x;
      if (mask[i] === 1 && d[i] > -MARGIN_LANDMARK && c.isOwned(i)) d[i] = -MARGIN_LANDMARK;
      if (corridor !== null && corridor[i] === 1 && d[i] > -MARGIN_CORRIDOR) d[i] = -MARGIN_CORRIDOR;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > 0 && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x < w - 1 && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y < h - 1) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x < w - 1 && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
      }
      d[i] = v;
    }
  }
  return d;
}

/** Tiles a lake may take: the zone's unprotected, unowned FLOOR with a clearance of at least CLR_SLACK. */
function allowField(c: BaseCtx, clr: Int32Array): Uint8Array {
  const { w, mask, hard, tiles } = c;
  const allow = new Uint8Array(c.w * c.h);
  const b = c.zone.bbox;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * w + x;
      if (mask[i] === 1 && tiles[i] === TILE_FLOOR && hard[i] === 0 && clr[i] >= CLR_SLACK && !c.isOwned(i)) allow[i] = 1;
    }
  }
  return allow;
}

/** The second mere's seed: the largest empty circle at least 18 tiles from the first seed with a clearance of 3 tiles, off `allow`'s excluded tiles. */
function secondSeed(c: BaseCtx, clr: Int32Array, allow: Uint8Array, first: number): number {
  const { w } = c;
  const fx = first % w, fy = (first - fx) / w;
  const cand = new Uint8Array(c.w * c.h);
  const b = c.zone.bbox;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * w + x;
      if (allow[i] === 0 || clr[i] < LAKE2_CLR) continue;
      const dx = x - fx, dy = y - fy;
      if (dx * dx + dy * dy >= LAKE2_SEP2) cand[i] = 1;
    }
  }
  return argmaxIn(clr, cand);
}

function lakeCount(c: BaseCtx): number {
  return c.zone.painted >= TWO_LAKES_PAINTED ? 2 : 1;
}

// ------------------------------------------------------------------------------------------------ growing a lake
/**
 * A grown lake: its set (1 per tile), area, box (inclusive tile bounds), the sums of its tile coordinates (the centroid times the
 * area) and the value field it grew in (a regrow reuses it).
 */
interface Lake { seed: number; set: Uint8Array; area: number; x0: number; y0: number; x1: number; y1: number; sumX: number; sumY: number; val: Int32Array }

/** value = 1024 * clearance + 15 * (fBm - 512): 5 tiles x (fBm - 0.5) on a wavelength of 9 tiles, three octaves of gain 0.5, over the tiles of `allow`. */
function valueField(c: BaseCtx, clr: Int32Array, allow: Uint8Array, salt: number): Int32Array {
  const { w } = c;
  const val = new Int32Array(c.w * c.h);
  const b = c.zone.bbox;
  for (let y = b.y; y < b.y + b.h; y++) {
    for (let x = b.x; x < b.x + b.w; x++) {
      const i = y * w + x;
      if (allow[i] === 1) val[i] = 1024 * clr[i] + 15 * (fbmQ(c, x, y, 9, 3, salt) - 512);
    }
  }
  return val;
}

/** 3x3 majority (>= 5 of 9, self included) `passes` times over the window [x0, x1] x [y0, y1], limited to `allow`; `set` is 0 outside the window. */
function smoothWindow(set: Uint8Array, allow: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, passes: number): Uint8Array {
  let cur = set;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(w * h);
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
        const i = y * w + x;
        if (allow[i] === 0) continue;
        let k = cur[i];
        if (x > 0) { k += cur[i - 1]; if (y > 0) k += cur[i - w - 1]; if (y < h - 1) k += cur[i + w - 1]; }
        if (x < w - 1) { k += cur[i + 1]; if (y > 0) k += cur[i - w + 1]; if (y < h - 1) k += cur[i + w + 1]; }
        if (y > 0) k += cur[i - w];
        if (y < h - 1) k += cur[i + w];
        if (k >= 5) next[i] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * One lake: the 4-connected component of {value >= tau} around the seed, tau the integer that makes it `target` tiles (a binary
 * search over the region's own values), two 3x3 majority passes to round the shore, the seed's component of that. Null when it is
 * smaller than LAKE_MIN.
 */
function growLake(c: BaseCtx, val: Int32Array, allow: Uint8Array, seed: number, target: number): Lake | null {
  const { w, h } = c;
  const n = w * h;
  const tau = tauForArea(val, seed, allow, w, h, target);
  let flood = floodAbove(val, tau, seed, allow, w, h);
  if (flood.size === 0) return null;
  // The flood jumps in plateaus (a saddle joins a whole second basin): when the plateau just below the threshold is nearer to the target, take it.
  if (flood.size > target) {
    const lower = floodAbove(val, tau + 1, seed, allow, w, h);
    if (lower.size > 0 && target - lower.size < flood.size - target) flood = lower;
  }
  let fx0 = w, fy0 = h, fx1 = -1, fy1 = -1;
  const zb = c.zone.bbox;
  for (let y = zb.y; y < zb.y + zb.h; y++) {
    for (let x = zb.x; x < zb.x + zb.w; x++) {
      if (flood.set[y * w + x] === 0) continue;
      if (x < fx0) fx0 = x;
      if (x > fx1) fx1 = x;
      if (y < fy0) fy0 = y;
      if (y > fy1) fy1 = y;
    }
  }
  const smooth = smoothWindow(flood.set, allow, w, h, fx0 - 2, fy0 - 2, fx1 + 2, fy1 + 2, 2);
  if (smooth[seed] !== 1) return null;
  // the seed's 4-connected component
  const set = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  queue[tail++] = seed;
  set[seed] = 1;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, sumX = 0, sumY = 0;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w, y = (i - x) / w;
    sumX += x; sumY += y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (x > 0 && smooth[i - 1] === 1 && set[i - 1] === 0) { set[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < w - 1 && smooth[i + 1] === 1 && set[i + 1] === 0) { set[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && smooth[i - w] === 1 && set[i - w] === 0) { set[i - w] = 1; queue[tail++] = i - w; }
    if (i < n - w && smooth[i + w] === 1 && set[i + w] === 0) { set[i + w] = 1; queue[tail++] = i + w; }
  }
  return tail >= LAKE_MIN ? { seed, set, area: tail, x0, y0, x1, y1, sumX, sumY, val } : null;
}

/** `allow` without the lake and the LAKE_GAP tiles around it. */
function offLimits(c: BaseCtx, allow: Uint8Array, lake: Lake): Uint8Array {
  const { w, h } = c;
  const open = new Uint8Array(allow);
  for (let y = Math.max(0, lake.y0 - LAKE_GAP); y <= Math.min(h - 1, lake.y1 + LAKE_GAP); y++) {
    for (let x = Math.max(0, lake.x0 - LAKE_GAP); x <= Math.min(w - 1, lake.x1 + LAKE_GAP); x++) {
      if (lake.set[y * w + x] !== 1) continue;
      for (let dy = -LAKE_GAP; dy <= LAKE_GAP; dy++) for (let dx = -LAKE_GAP; dx <= LAKE_GAP; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) open[ny * w + nx] = 0;
      }
    }
  }
  return open;
}

/** The zone's lakes: the largest empty circle first, then (a second zone-sized void) the next one apart from it. */
function growLakes(c: BaseCtx, clr: Int32Array, allow: Uint8Array): Lake[] {
  const out: Lake[] = [];
  const first = argmaxIn(clr, allow);
  if (first < 0 || clr[first] < LAKE_MIN_CLR) return out;
  const one = growLake(c, valueField(c, clr, allow, SALT_ONE), allow, first, LAKE_GROW);
  if (!one) return out;
  out.push(one);
  if (lakeCount(c) > 1) {
    // the second lake may not touch the first: the first, grown by the gap, is off limits
    const open = offLimits(c, allow, one);
    const second = secondSeed(c, clr, open, first);
    if (second >= 0) {
      const two = growLake(c, valueField(c, clr, open, SALT_TWO), open, second, LAKE_GROW);
      if (two) out.push(two);
    }
  }
  return out;
}

/**
 * Two meres whose ICE-able ground (off the member lanes) falls short of ICE_WANT: the first lake, which has the room (the second is
 * hemmed in by the first and the camps), is grown again to take the slack, up to LAKE_GROW_MAX times the usual size. The second lake
 * and its gap stay off limits, so the lakes never touch.
 */
function fillLakes(c: BaseCtx, allow: Uint8Array, lakes: Lake[], book: RouteBook): void {
  if (lakes.length < 2) return;
  const have = book.iceable(lakes[0]) + book.iceable(lakes[1]);
  if (have >= ICE_WANT) return;
  const area = lakes[0].area + lakes[1].area;
  const share = Math.max(300, Math.floor((have * 1000) / area));
  const target = Math.min(Math.floor((LAKE_GROW * LAKE_GROW_MAX) / 100), lakes[0].area + Math.floor(((ICE_WANT - have) * 1000) / share));
  const bigger = growLake(c, lakes[0].val, offLimits(c, allow, lakes[1]), lakes[0].seed, target);
  if (bigger && bigger.area > lakes[0].area) {
    lakes[0] = bigger;
    book.ensure(lakes);
  }
}

// ------------------------------------------------------------------------------------------------ landmark: the frozen watchtower
/**
 * Places one tower with its box centre as near (tx, ty) as it fits, doors on the axis toward the lake when it can: every stamp of
 * the 8 orientations within TOWER_SPAN tiles of the ideal origin, nearest first, the first that stands. A summed-area table of the
 * tiles a tower cannot stand on turns most stamps down by a lookup (a box may lack its four '_' corners); the kit's whole-zone scan
 * is the fallback.
 */
function placeTower(c: LandmarkCtx, tx: number, ty: number, vertical: boolean): void {
  const { w, h, mask, tiles, hard } = c;
  const R = TOWER_SPAN + 6;
  const wx0 = Math.max(0, tx - R), wy0 = Math.max(0, ty - R), wx1 = Math.min(w - 1, tx + R), wy1 = Math.min(h - 1, ty + R);
  const ww = wx1 - wx0 + 1, wh = wy1 - wy0 + 1;
  const sat = new Int32Array((ww + 1) * (wh + 1));
  for (let y = 0; y < wh; y++) {
    for (let x = 0; x < ww; x++) {
      const i = (wy0 + y) * w + wx0 + x;
      const free = mask[i] === 1 && tiles[i] === TILE_FLOOR && hard[i] === 0 && !c.isOwned(i);
      sat[(y + 1) * (ww + 1) + x + 1] = sat[y * (ww + 1) + x + 1] + sat[(y + 1) * (ww + 1) + x] - sat[y * (ww + 1) + x] + (free ? 0 : 1);
    }
  }
  const cand: Array<{ s: number; x0: number; y0: number; o: number }> = [];
  for (let o = 0; o < 8; o++) {
    const rot = o & 3;
    const bw = (rot & 1) === 0 ? 8 : 7, bh = (rot & 1) === 0 ? 7 : 8;
    const ox = tx - (bw >> 1), oy = ty - (bh >> 1);
    const penalty = ((rot & 1) === 0) === vertical ? 0 : 100;
    for (let y0 = oy - TOWER_SPAN; y0 <= oy + TOWER_SPAN; y0++) {
      for (let x0 = ox - TOWER_SPAN; x0 <= ox + TOWER_SPAN; x0++) {
        const rx = x0 - wx0, ry = y0 - wy0;
        if (rx < 0 || ry < 0 || rx + bw > ww || ry + bh > wh) continue;
        const bad = sat[(ry + bh) * (ww + 1) + rx + bw] - sat[ry * (ww + 1) + rx + bw] - sat[(ry + bh) * (ww + 1) + rx] + sat[ry * (ww + 1) + rx];
        if (bad > 4) continue;
        const dx2 = 2 * x0 + bw - (2 * tx + 1), dy2 = 2 * y0 + bh - (2 * ty + 1);
        cand.push({ s: dx2 * dx2 + dy2 * dy2 + penalty, x0, y0, o });
      }
    }
  }
  cand.sort((a, b) => a.s - b.s || a.y0 - b.y0 || a.x0 - b.x0 || a.o - b.o);
  let tried = 0;
  for (const k of cand) {
    const rot = (k.o & 3) as 0 | 1 | 2 | 3, mirror = k.o >= 4;
    const st = stampTemplate(WATCHTOWER, k.x0, k.y0, rot, mirror, w, h);
    if (!st || !stampFits(c, st)) continue;
    if (placeLandmark(c, WATCHTOWER, st, rot, mirror)) return;
    if (++tried >= 6) return;
  }
  bestLandmark(c, WATCHTOWER, (st: Stamp, rot: number) => {
    const dx2 = 2 * st.bbox.x + st.bbox.w - (2 * tx + 1), dy2 = 2 * st.bbox.y + st.bbox.h - (2 * ty + 1);
    return -(dx2 * dx2 + dy2 * dy2) - (((rot & 1) === 0) === vertical ? 0 : 100);
  }, 6);
}

function landmark(c: LandmarkCtx): void {
  const { w, h } = c;
  const clr = clearanceField(c, false);
  const allow = allowField(c, clr);
  const first = argmaxIn(clr, allow);
  if (first < 0 || clr[first] < LAKE_MIN_CLR) return;
  const seeds = [first];
  if (lakeCount(c) > 1) {
    const second = secondSeed(c, clr, allow, first);
    if (second >= 0) seeds.push(second);
  }
  const cx = w >> 1, cy = h >> 1;
  for (let k = 0; k < seeds.length && k < LANDMARKS_PER_ZONE; k++) {
    const s = seeds[k];
    const sx = s % w, sy = (s - sx) / w;
    // the tower stands clr0 / 3 + 3 tiles from the lake's seed toward the coliseum, its doors toward the seed
    const vx = cx - sx, vy = cy - sy;
    const len = Math.sqrt(vx * vx + vy * vy);
    const dist = clr[s] / 3 + TOWER_BEYOND;
    const tx = len > 0 ? sx + Math.round((vx / len) * dist) : sx, ty = len > 0 ? sy + Math.round((vy / len) * dist) : sy;
    placeTower(c, tx, ty, Math.abs(sy - ty) >= Math.abs(sx - tx));
  }
}

// ------------------------------------------------------------------------------------------------ spawn walks
/** 1 on every tile within r (Chebyshev) of the lake: two separable passes over the lake's box grown by r. */
function nearLake(w: number, h: number, lake: Lake, r: number): Uint8Array {
  const out = new Uint8Array(w * h), row = new Uint8Array(w * h);
  const y0 = Math.max(0, lake.y0 - r), y1 = Math.min(h - 1, lake.y1 + r), x0 = Math.max(0, lake.x0 - r), x1 = Math.min(w - 1, lake.x1 + r);
  for (let y = lake.y0; y <= lake.y1; y++) {
    for (let x = lake.x0; x <= lake.x1; x++) {
      if (lake.set[y * w + x] !== 1) continue;
      for (let nx = Math.max(0, x - r); nx <= Math.min(w - 1, x + r); nx++) row[y * w + nx] = 1;
    }
  }
  for (let y = lake.y0; y <= lake.y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (row[y * w + x] !== 1) continue;
      for (let ny = Math.max(y0, y - r); ny <= Math.min(y1, y + r); ny++) out[ny * w + x] = 1;
    }
  }
  return out;
}

/** Does the straight way (ax, ay)-(bx, by), sampled at one tile, touch the marked tiles? */
function wayTouches(w: number, h: number, ax: number, ay: number, bx: number, by: number, near: Uint8Array): boolean {
  const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  const steps = len < 1 ? 1 : Math.ceil(len);
  for (let s = 0; s <= steps; s++) {
    const x = Math.floor(ax + ((bx - ax) * s) / steps), y = Math.floor(ay + ((by - ay) * s) / steps);
    if (x >= 0 && y >= 0 && x < w && y < h && near[y * w + x] === 1) return true;
  }
  return false;
}

/** Marks the tiles within r (Chebyshev) of tile (x, y) of `out`. */
function mark(out: Uint8Array, w: number, h: number, x: number, y: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let dx = -r; dx <= r; dx++) { const nx = x + dx; if (nx >= 0 && nx < w) out[ny * w + nx] = 1; }
  }
}

/**
 * The real findPath routes (to the coliseum centre, as the generator's spawn gate walks them) of the pool members whose way to a gate
 * passes near a lake, as one mask: `band` is 1 within ROUTE_BAND tiles (Chebyshev) of a routed walk and of the zone guard's corridors.
 * No shelf stands on it and no ICE lies on it. The pathfinder sees this zone's tiles; the painted ground of other zones is open
 * floor to it, so what other zones' stylers wrote cannot change this zone's output. Routes are found on demand (`ensure`) and kept.
 */
class RouteBook {
  readonly band: Uint8Array;
  routed = 0;
  private readonly mouths: ReadonlyArray<[number, number]> | null;
  private readonly done = new Set<number>();
  private readonly nearOf = new Map<Lake, Uint8Array>();
  private view: GameMap | null = null;
  private readonly centre: { x: number; y: number };

  constructor(private readonly c: ShapeCtx, guard: RouteGuard | null) {
    const { w, h } = c;
    this.band = new Uint8Array(w * h);
    this.mouths = gateMouths(c);
    this.centre = { x: tileToWorldCenter(w >> 1), y: tileToWorldCenter(h >> 1) };
    // the guard's own corridors are lanes too (the context keeps ICE off them whatever we do)
    if (guard !== null) {
      const b = c.zone.bbox;
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (guard.corridor[y * w + x] === 1) this.band[y * w + x] = 1;
    }
  }

  /** Finds the route of every member not routed yet whose way to a gate passes near one of the lakes. */
  ensure(lakes: readonly Lake[]): void {
    const { c, mouths } = this;
    if (mouths === null) return;
    const { w, h } = c;
    for (const m of c.spawns) {
      if (this.done.has(m)) continue;
      const mx = m % w, my = (m - mx) / w;
      let near = false;
      for (const [tx, ty] of memberWays(mouths, mx, my)) {
        for (const lake of lakes) {
          let around = this.nearOf.get(lake);
          if (around === undefined) { around = nearLake(w, h, lake, ROUTE_NEAR); this.nearOf.set(lake, around); }
          if (wayTouches(w, h, mx + 0.5, my + 0.5, tx, ty, around)) { near = true; break; }
        }
        if (near) break;
      }
      if (!near) continue;
      this.done.add(m);
      if (this.view === null) {
        const fl = fixedLayout();
        const t = new Uint8Array(c.tiles);
        for (let i = 0; i < w * h; i++) if (c.mask[i] === 0 && fl.paintedMask[i] === 1) t[i] = TILE_FLOOR;
        this.view = mapFromTiles(w, h, t);
      }
      const path = findPath(this.view, { x: tileToWorldCenter(mx), y: tileToWorldCenter(my) }, this.centre);
      if (path.length === 0) continue;
      this.routed++;
      let ax = mx + 0.5, ay = my + 0.5;
      mark(this.band, w, h, mx, my, ROUTE_BAND);
      for (const q of path) {
        const bx = q.x / TILE, by = q.y / TILE;
        const len = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
        const steps = len < 0.25 ? 1 : Math.ceil(len * 2);
        for (let s = 0; s <= steps; s++) {
          const x = Math.floor(ax + ((bx - ax) * s) / steps), y = Math.floor(ay + ((by - ay) * s) / steps);
          if (x < 0 || y < 0 || x >= w || y >= h || c.mask[y * w + x] === 0) continue;
          mark(this.band, w, h, x, y, ROUTE_BAND);
        }
        ax = bx; ay = by;
      }
    }
  }

  /** Lake tiles off the band: the ones that can be ICE. */
  iceable(lake: Lake): number {
    const { w } = this.c;
    let k = 0;
    for (let y = lake.y0; y <= lake.y1; y++) for (let x = lake.x0; x <= lake.x1; x++) { const i = y * w + x; if (lake.set[i] === 1 && this.band[i] === 0) k++; }
    return k;
  }
}

interface Probe { tiles: Uint8Array; guard: RouteGuard }

/** A second guard over a private copy of the tiles (null with no pool member in the zone). */
function makeProbe(c: ShapeCtx): Probe | null {
  if (!c.centreWalk || c.spawns.length === 0) return null;
  const tiles = new Uint8Array(c.tiles);
  return { tiles, guard: makeRouteGuard({ w: c.w, h: c.h, mask: c.mask, tiles, spawns: c.spawns, centreWalk: c.centreWalk }) };
}

/** The worst member stretch with `cells` walled on the copy (the copy is left as it was). */
function stretchWith(p: Probe, cells: readonly number[]): number {
  for (const i of cells) p.tiles[i] = TILE_WALL;
  const s = p.guard.worstStretch();
  for (const i of cells) p.tiles[i] = TILE_FLOOR;
  return s;
}

function realGuard(c: ShapeCtx): RouteGuard | null {
  try { return c.routeGuard(); } catch { return null; }
}

/** Is the 3x3 around `centre` open ground off the band? Every shelf contains it, so a candidate that fails needs no shelf drawn. */
function coreFree(c: ShapeCtx, band: Uint8Array, centre: number): boolean {
  const { w, h } = c;
  const x = centre % w, y = (centre - x) / w;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = centre + dy * w + dx; if (!c.open(j) || band[j] === 1) return false; }
  return true;
}

/** The tiles of a shelf stamped on `centre`, in cell order (nearest the centre first), off-grid cells dropped. */
function shelfTiles(c: BaseCtx, rng: Rng, centre: number, rad: number): number[] {
  const { w, h } = c;
  const cx = centre % w, cy = (centre - cx) / w;
  const out: number[] = [];
  for (const [ox, oy] of facetShelfCells(rng, rad)) {
    const x = cx + ox, y = cy + oy;
    if (x >= 0 && y >= 0 && x < w && y < h) out.push(y * w + x);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ shape
function shape(c: ShapeCtx): RimePlan {
  const { w, h } = c;
  const n = w * h;
  const plan: RimePlan = { lakes: [], shelves: [], causeway: [], routed: 0, probes: 0, turnedDown: 0 };
  const real = realGuard(c);
  const clr = clearanceField(c, true, real ? real.corridor : null);
  const allow = allowField(c, clr);
  const lakes = growLakes(c, clr, allow);
  if (lakes.length === 0) return plan;
  const book = new RouteBook(c, real);
  book.ensure(lakes);
  fillLakes(c, allow, lakes, book);
  plan.routed = book.routed;
  let probe: Probe | null | undefined;
  const chosen: number[] = zoneCamps(c);
  const rim = c.edgeDist;
  for (let k = 0; k < lakes.length; k++) {
    const lake = lakes[k];
    const { set, seed } = lake;
    // 1. headlands: farthest-point picks on the shore, away from the camps and the earlier headlands
    const shore: number[] = [];
    for (let y = lake.y0; y <= lake.y1; y++) {
      for (let x = lake.x0; x <= lake.x1; x++) {
        const i = y * w + x;
        if (set[i] !== 1 || rim[i] < HEAD_EDGE) continue;
        const free = (j: number): boolean => set[j] === 0 && c.mask[j] === 1 && c.tiles[j] === TILE_FLOOR;
        if ((x > 0 && free(i - 1)) || (x < w - 1 && free(i + 1)) || (y > 0 && free(i - w)) || (y < h - 1 && free(i + w))) shore.push(i);
      }
    }
    const lcx = lake.sumX / lake.area, lcy = lake.sumY / lake.area;
    for (let hd = 0; hd < HEADLANDS; hd++) {
      const cands: Array<[number, number]> = [];
      for (const i of shore) {
        if (c.tiles[i] !== TILE_FLOOR) continue;
        const x = i % w, y = (i - x) / w;
        let d2 = Infinity;
        for (const j of chosen) { const dx = x - (j % w), dy = y - (j - (j % w)) / w; const e = dx * dx + dy * dy; if (e < d2) d2 = e; }
        if (d2 >= HEAD_SEP2) cands.push([d2, i]);
      }
      cands.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      // The first candidates that fit (the ones the ground refuses cost nothing); HEAD_TRIES that fit and are turned down or refused end the search.
      for (let t = 0, failed = 0; t < cands.length && t < HEAD_LOOK && failed < HEAD_TRIES; t++) {
        const i = cands[t][1];
        const x = i % w, y = (i - x) / w;
        const ox = x - lcx, oy = y - lcy;
        const len = Math.sqrt(ox * ox + oy * oy) || 1;
        const centre = (y + Math.round((oy / len) * 0.5)) * w + x + Math.round((ox / len) * 0.5);
        if (!coreFree(c, book.band, centre)) continue;
        const cells = shelfTiles(c, c.rng, centre, hd === 0 ? 3.2 : 2.6);
        if (cells.length === 0 || !cells.every((j) => c.open(j) && book.band[j] === 0)) continue;
        if (real !== null && real.touches(cells)) {
          if (probe === undefined) probe = makeProbe(c);
          if (probe) {
            plan.probes++;
            if (stretchWith(probe, cells) > ROUTE_HEADLAND_MAX) { plan.turnedDown++; failed++; continue; }
          }
        }
        const dir = dirIndex16(x * lake.area - lake.sumX, y * lake.area - lake.sumY);
        const placed = c.placeFeature({
          kind: "headland", jobs: ["lee"], anchor: [centre % w, (centre - (centre % w)) / w], params: [dir],
          blocks: cells.map((j) => [j, "wall"] as const), mode: "whole",
        });
        if (!placed) { failed++; continue; }
        if (probe) for (const j of placed.written) probe.tiles[j] = TILE_WALL;
        plan.shelves.push({ lake: k, centre, dir, spire: false, walls: placed.written.slice() });
        chosen.push(i);
        break;
      }
    }
    // 2. the spire island: the lake tile of the highest clearance (at least 4.5 tiles) off every route
    let spireAt = -1;
    for (let y = lake.y0; y <= lake.y1; y++) {
      for (let x = lake.x0; x <= lake.x1; x++) {
        const i = y * w + x;
        if (set[i] !== 1 || c.tiles[i] !== TILE_FLOOR || clr[i] < SPIRE_CLR || book.band[i] === 1) continue;
        if (spireAt < 0 || clr[i] > clr[spireAt]) spireAt = i;
      }
    }
    if (spireAt >= 0) {
      // a spire is 8 to 11 tiles (never under 6, the least a wall piece may be): a thin draw is drawn again a little wider
      let cells: number[] = [];
      for (const rad of SPIRE_RADII) {
        cells = shelfTiles(c, c.rng, spireAt, rad);
        if (cells.length >= SPIRE_MIN_CELLS) break;
      }
      let ok = cells.length >= SPIRE_MIN_CELLS && cells.every((j) => c.open(j) && book.band[j] === 0);
      if (ok && real !== null && real.touches(cells)) {
        if (probe === undefined) probe = makeProbe(c);
        if (probe) {
          plan.probes++;
          if (stretchWith(probe, cells) > ROUTE_HEADLAND_MAX) { plan.turnedDown++; ok = false; }
        }
      }
      if (ok) {
        const placed = c.placeFeature({
          kind: "spire", jobs: ["landmark"], anchor: [spireAt % w, (spireAt - (spireAt % w)) / w], params: [],
          blocks: cells.map((j) => [j, "wall"] as const), mode: "whole",
        });
        if (placed) {
          if (probe) for (const j of placed.written) probe.tiles[j] = TILE_WALL;
          plan.shelves.push({ lake: k, centre: spireAt, dir: 0, spire: true, walls: placed.written.slice() });
        }
      }
    }
    // 3. the lake: the tiles in a lane around a member's walk stay plain ground (a causeway owns them when there are enough), the rest is the mere
    const ice: number[] = [];
    const plain: number[] = [];
    for (let y = lake.y0; y <= lake.y1; y++) {
      for (let x = lake.x0; x <= lake.x1; x++) {
        const i = y * w + x;
        if (set[i] !== 1 || c.tiles[i] !== TILE_FLOOR) continue;
        if (book.band[i] === 1) plain.push(i); else ice.push(i);
      }
    }
    const anchor: [number, number] = [seed % w, (seed - (seed % w)) / w];
    let all = ice;
    if (plain.length >= 3) {
      if (c.placeFeature({ kind: "causeway", jobs: ["crossing"], anchor, params: [], blocks: [], floor: plain, mode: "whole" })) for (const i of plain) plan.causeway.push(i);
    } else if (plain.length > 0) {
      all = ice.concat(plain).sort((a, b) => a - b);
    }
    c.placeFeature({ kind: "mere", jobs: ["crossing"], anchor, params: [k, 0], blocks: [], floor: all, mode: "whole" });
    plan.lakes.push({ index: k, seed, clr: clr[seed], tiles: ice, grown: lake.area, ice: 0 });
  }
  return plan;
}

// ------------------------------------------------------------------------------------------------ surface: ICE on the lakes
function surface(c: SurfaceCtx, plan: RimePlan): void {
  const fl = fixedLayout();
  const ring = fl.distFp.length === c.w * c.h ? fl.distFp : null;
  for (const lake of plan.lakes) {
    let ice = 0;
    for (const i of lake.tiles) {
      if (ring !== null && ring[i] <= RING_CLEAR) continue;
      if (c.surface(i, "ice")) ice++;
    }
    lake.ice = ice;
  }
}
/** No ICE within this Chebyshev distance of the coliseum (the ring road and the tile past it). */
const RING_CLEAR = RING_ROAD + 2;

// ------------------------------------------------------------------------------------------------ props
function props(c: PropCtx, plan: RimePlan): void {
  const { w } = c;
  const v3 = (x: number, y: number): number => Math.floor(c.noise.hash(x, y, 90) * 3);
  for (const sh of plan.shelves) {
    for (const i of sh.walls) {
      const x = i % w, y = (i - x) / w;
      const u = c.noise.hash(x, y, 3);
      if (sh.spire) { if (i === sh.centre || u < 0.4) c.prop(PROP.ice_spire, x, y, v3(x, y)); }
      else if (u < 0.34) c.prop(PROP.icicle, x, y, v3(x, y));
    }
    if (!sh.spire) {
      // snow drifts on the ground just off the headland
      const cx = sh.centre % w, cy = (sh.centre - cx) / w;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        if (c.noise.hash(cx + dx, cy + dy, 4) < 0.07) c.prop(PROP.snow_drift, cx + dx, cy + dy, v3(cx + dx, cy + dy));
      }
    }
  }
  for (const lake of plan.lakes) {
    for (const i of lake.tiles) {
      if (c.terrain[i] !== TERRAIN_ICE) continue;
      const x = i % w, y = (i - x) / w;
      const u = c.noise.hash(x, y, 1) * 12;
      if (u < 1) c.prop(PROP.frost_sparkle, x, y, v3(x, y));
      else if (u < 2) c.prop(PROP.ice_crack, x, y, v3(x, y));
    }
  }
  // tower_frost on the watchtower walls: the landmark's box
  for (const f of c.zoneFeatures()) {
    if (f.kind !== "landmark" || f.variant !== WATCHTOWER.key) continue;
    for (let y = f.bbox.y; y < f.bbox.y + f.bbox.h; y++) {
      for (let x = f.bbox.x; x < f.bbox.x + f.bbox.w; x++) {
        const i = y * w + x;
        if (c.tiles[i] === TILE_WALL && c.noise.hash(x, y, 5) < 0.3) c.prop(PROP.tower_frost, x, y, v3(x, y));
      }
    }
  }
}

export const rime: ZoneStyler<RimePlan> = { id: "rime", faction: "frost", version: 400, landmark, shape, surface, props };
