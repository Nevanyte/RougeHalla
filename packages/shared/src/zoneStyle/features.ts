// The feature kit of the zone-shape rework (WP0k, contract sections 3.3-3.7 and 3.9): the integer geometry, noise, graph, field,
// search and route-guard tools the five zone stylers build their shapes from. The landmark template kit is landmarks.ts.
//
// Rules of the kit. Seeded integer maths only: every function uses + - * /, Math.sqrt, floor, ceil, abs, min, max, imul and bit
// operations, never Math.random, sin, cos, atan2, hypot, pow, exp or log (the Math spy of the determinism tests forbids them),
// and never `**`. Every tie is broken by tile or node index, never by sort stability or object key order, so a map is the same
// on every engine. Size-free: `w` and `h` come from the caller (or the context). Nothing here draws the styler's random stream:
// a function that needs randomness takes none; noise is the context's stateless hash noise.
//
// Usage notes for the zone stylers (WP1-5):
//  - Directions are DIR16 indices (22.5 degree steps from +x toward +y, y down): `dirIndex16(dx, dy)` names a vector's
//    direction, `dirSep16(a, b)` how many steps apart two are (0..8), `inBeam(dx, dy, ux, uy, half4)` is a breach's test (half4
//    in QUARTER tiles). Radii are carried as `r4` quarter tiles: `discOffsets(r4)` is the disc (a shared, frozen list: never
//    mutate it), `isqrt` and `dist2` keep the maths exact. `segDist2` returns a squared distance (a double: cross^2 / len2, one
//    division, correctly rounded).
//  - Noise is `noiseQ`/`fbmQ`: 0..1023 integers from the context's noise (its salt is the pass's stream + 100 already), so a
//    threshold is `noiseQ(c, x, y, cell, salt) > 716` (about 30%), never a float compare.
//  - Graphs: `campNodes(c)` -> `primMST` / `gabrielEdges` / `rngEdges`; `addShortcuts(nodes, edges, max, minRatio, maxLen)`
//    APPENDS its new edges to `edges` (in place) and RETURNS ONLY THE EDGES IT ADDED (so call it as a statement, or
//    `const extra = addShortcuts(...)`; never `edges = addShortcuts(...)`); `cyclomatic(nodes.length, edges)` counts the loops.
//    Edges are always [a, b] with a < b, indices into the node list (camps in CampInfo order, the front door last when there is
//    one; the door needs the generator's grid size, so a fixture of another size has none). `campNodes` keeps only the camps whose
//    centre tile is in `c.mask`, so `{ ...c }` with the context's own `camps` (all 40 of the map) is the zone's graph.
//  - Fields: `chamferFrom(sources, w, h)` is in thirds of a tile (3 orthogonal, 4 diagonal; with no source every tile keeps
//    CHAMFER_FAR = 1 << 20). Build a clearance as min(dX - margin, ...), then `argmaxIn` (the largest empty circle),
//    `floodAbove`/`tauForArea` (the lake: the flood of {value >= tau} from a seed, tau found by binary search over the region's own
//    values, at most 16 fills), `majoritySmooth` (3x3, double buffered, a tile outside `allow` is 0 afterwards), `componentsOf`,
//    `pruneSmall` (clears the set IN PLACE and returns the number of tiles cleared). `walkField16`, `descentPath` and
//    `segmentBlocked` are in gridTopology.ts (the 5-7-11 walk field in fifths of a tile, its steepest descent, an exact integer
//    line-of-sight test between tile centres).
//  - Search: `noisyPath(c, a, b, salt, cost?)` is kit.flowPath with typed arrays and an optional Int32Array cost map (costs must be
//    >= 0; a callback must be pure: it is asked once per tile) and returns the same path. `viterbiRows` picks parallel row
//    positions (it returns [] when the best chain does not score above 0, so a zone with no usable row gets none); `viterbiPath`
//    jogs one row over the free ground (an offset -half..half per step; stepCost(s, dt) is read once per state).
//  - The route guard: `c.routeGuard()` (the context builds it with makeRouteGuard) is made on the first call from `c.spawns`,
//    `c.centreWalk` and the tiles AS THEY ARE THEN, so ask for it before the first write when the corridors should be the
//    open-ground ones. `guard.corridor` marks the 3-wide corridors of the members' baseline walks, each walk the steepest descent
//    PULLED STRAIGHT (the straight lines a real findPath walk follows; this zone's tiles only, so it covers about 74% of the
//    tiles the real walks take inside their own zone, against about 50% for the raw descent),
//    `corridorOf(k)` lists member k's own (its tile first, then in path order), `touches(tiles)` is the cheap filter,
//    `worstStretch(extraWallTiles?)` runs one zone-scoped walk field (about 0.25 ms on a real 136x136 zone; budget six calls a zone)
//    and returns the worst member's walk as permille of its baseline (with a list of tile indices it asks the same for a feature
//    that is NOT written yet: those tiles count as walls on a private copy, c.tiles is never touched): 1000 = none, ROUTE_STRETCH_MAX 1030 is the styler threshold (1020 for
//    the Mere's headlands and spires), ROUTE_CUT_OFF 1_000_000 = a member can no longer get out. It reads this zone's tiles and
//    the fixed pick-time walk of the tiles around the zone (which no other zone writes: they keep a rim), so another zone's
//    writes never change it. `worstMember()` is the member index of the last worstStretch() call. A hazard (bog, ice) never goes
//    on a corridor tile.
//  - Landmarks are landmarks.ts: templates (LandmarkTemplate rows), `stampTemplate` in 8 orientations (rot 0-3, mirror), and
//    `bestLandmark(c, template, score)`, which scores every fitting origin (every 2nd tile of the zone's box) and orientation
//    with `score(stamp, rot, mirror)` (higher is better; the stamp is reused between calls) and places the best that the guard
//    accepts, whole or not at all, within 12 tries. `templateProblems(template)` is the validity check for a zone's own tests.
import { RING_ROAD, fixedLayout } from "../coliseum";
import { descentPath, segmentBlocked, walkField16 } from "../gridTopology";
import { MASK_MOVE, TILE_FLOOR, TILE_WALL } from "../map";
import type { TileRect } from "../map";
import type { NoiseKit, RouteGuard } from "./types";

export type { RouteGuard } from "./types";

// ------------------------------------------------------------------------------------------------ 3.3 integer geometry
/** 16 directions as integer vectors of length ~1024, angle k * 22.5 deg from +x toward +y (screen y down). */
export const DIR16: ReadonlyArray<readonly [number, number]> = [
  [1024, 0], [946, 392], [724, 724], [392, 946], [0, 1024], [-392, 946], [-724, 724], [-946, 392],
  [-1024, 0], [-946, -392], [-724, -724], [-392, -946], [0, -1024], [392, -946], [724, -724], [946, -392]];

/** argmax_k dot((dx, dy), DIR16[k]); ties lowest k; (0,0) -> 0. */
export function dirIndex16(dx: number, dy: number): number {
  let best = 0, bd = dx * DIR16[0][0] + dy * DIR16[0][1];
  for (let k = 1; k < 16; k++) {
    const d = dx * DIR16[k][0] + dy * DIR16[k][1];
    if (d > bd) { bd = d; best = k; }
  }
  return best;
}

/** Circular distance between two DIR16 indices (0..8). */
export function dirSep16(a: number, b: number): number {
  const d = (((a - b) % 16) + 16) % 16;
  return d > 8 ? 16 - d : d;
}

/** floor(sqrt(n)) for an integer n >= 0, exact (Math.sqrt then a +-1 correction). */
export function isqrt(n: number): number {
  if (!(n > 0)) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}

/** Squared distance from point p to segment ab, all in the same units (exact rational arithmetic in doubles: one division). */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist2(px, py, ax, ay);
  const dot = (px - ax) * abx + (py - ay) * aby;
  if (dot <= 0) return dist2(px, py, ax, ay);
  if (dot >= len2) return dist2(px, py, bx, by);
  const cross = (px - ax) * aby - (py - ay) * abx;
  return (cross * cross) / len2;
}

const DISC_CACHE = new Map<number, ReadonlyArray<readonly [number, number]>>();
/**
 * Offsets (dx, dy) of tiles whose centre is within r4/4 tiles of a tile centre (dx^2 + dy^2 <= r4^2 / 16), cached by r4, in
 * (dy, dx) order. The cached list is shared: never mutate it.
 */
export function discOffsets(r4: number): ReadonlyArray<readonly [number, number]> {
  let out = DISC_CACHE.get(r4);
  if (out) return out;
  const list: Array<readonly [number, number]> = [];
  if (r4 >= 0) {
    const reach = Math.floor(r4 / 4) + 1, lim = r4 * r4;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (16 * (dx * dx + dy * dy) <= lim) list.push([dx, dy]);
  }
  out = Object.freeze(list);
  DISC_CACHE.set(r4, out);
  return out;
}

/**
 * Is (dx, dy) within `half4/4` tiles of the ray from the origin along (ux, uy) and ahead of it: dot > 0 and
 * 16 * cross^2 <= half4^2 * |u|^2. Integers in, boolean out.
 */
export function inBeam(dx: number, dy: number, ux: number, uy: number, half4: number): boolean {
  if (dx * ux + dy * uy <= 0) return false;
  const cross = dx * uy - dy * ux;
  return 16 * cross * cross <= half4 * half4 * (ux * ux + uy * uy);
}

/**
 * A copy of zones.ts pseudoAngle (monotone in the angle, in [0, 4), rational operations), so the kit does not import the
 * generator; the kit's test asserts both agree on 10,000 vectors.
 */
export function pseudoAngle(dx: number, dy: number): number {
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

// ------------------------------------------------------------------------------------------------ 3.4 noise
/** What the noise functions read of a context (a BaseCtx has it). */
export interface NoiseSource { readonly noise: NoiseKit }

/** Value noise quantized to 0..1023: floor(ctx.noise.value(x, y, cell, salt) * 1024). */
export function noiseQ(c: NoiseSource, x: number, y: number, cell: number, salt: number): number {
  return Math.min(1023, Math.floor(c.noise.value(x, y, cell, salt) * 1024));
}

/** fBm quantized to 0..1023 (ctx.noise.fbm: each octave half the cell and half the weight). */
export function fbmQ(c: NoiseSource, x: number, y: number, cell: number, octaves: number, salt: number): number {
  return Math.min(1023, Math.floor(c.noise.fbm(x, y, cell, octaves, salt) * 1024));
}

// ------------------------------------------------------------------------------------------------ 3.5 graphs over nodes
export interface Node {
  readonly x: number;
  readonly y: number;
  readonly kind: "camp" | "door";
  /** CampInfo.index of a camp, -1 for the door. */
  readonly camp: number;
  readonly elite: boolean;
}
/** a < b, indices into the node list. */
export type Edge = readonly [number, number];

/** What campNodes reads of a context (a BaseCtx has it; `elite` and `index` are CampInfo's new fields). */
export interface CampSource {
  readonly w: number;
  readonly h: number;
  readonly mask: Uint8Array;
  readonly tiles: Readonly<Uint8Array>;
  readonly zone: { readonly bbox: TileRect; readonly centroid: { readonly x: number; readonly y: number } };
  readonly camps: ReadonlyArray<{ readonly x: number; readonly y: number; readonly elite?: boolean; readonly index?: number }>;
}

/**
 * The zone's camps (elite flags from CampInfo) and its front door: the zone FLOOR tile with RING_ROAD + 1 < distFp <= RING_ROAD + 4
 * (the coliseum footprint's Chebyshev distance, fixedLayout) nearest the zone centroid (ties lowest index); no door when none, and
 * none on a grid that is not the generator's size (a fixture). Camps in CampInfo order, door last. `c.camps` may list every camp of
 * the map: a camp whose centre tile is not in `c.mask` is left out (a list already filtered gives the same nodes as before).
 */
export function campNodes(c: CampSource): Node[] {
  const { w, h } = c;
  const out: Node[] = [];
  c.camps.forEach((k, j) => {
    if (k.x < 0 || k.y < 0 || k.x >= w || k.y >= h || c.mask[k.y * w + k.x] !== 1) return;
    out.push({ x: k.x, y: k.y, kind: "camp", camp: k.index ?? j, elite: k.elite === true });
  });
  const fl = fixedLayout();
  if (fl.distFp.length !== w * h) return out;
  const { bbox, centroid } = c.zone;
  let best = -1, bd = Infinity;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const i = y * w + x;
      if (!c.mask[i] || c.tiles[i] !== TILE_FLOOR) continue;
      const d = fl.distFp[i];
      if (d <= RING_ROAD + 1 || d > RING_ROAD + 4) continue;
      const ex = x + 0.5 - centroid.x, ey = y + 0.5 - centroid.y;
      const e = ex * ex + ey * ey;
      if (e < bd) { bd = e; best = i; }
    }
  }
  if (best >= 0) out.push({ x: best % w, y: (best - (best % w)) / w, kind: "door", camp: -1, elite: false });
  return out;
}

/** Prim's MST from node `root` on squared distance; ties (d2, lower a, lower b). Edges in insertion order. */
export function primMST(nodes: readonly Node[], root: number): Edge[] {
  const n = nodes.length;
  const edges: Edge[] = [];
  if (n === 0 || root < 0 || root >= n) return edges;
  const inTree = new Uint8Array(n);
  inTree[root] = 1;
  for (let step = 1; step < n; step++) {
    let ba = -1, bb = -1, bv = -1, bd = Infinity;
    for (let u = 0; u < n; u++) {
      if (!inTree[u]) continue;
      for (let v = 0; v < n; v++) {
        if (inTree[v]) continue;
        const d = dist2(nodes[u].x, nodes[u].y, nodes[v].x, nodes[v].y);
        const a = u < v ? u : v, b = u < v ? v : u;
        if (d < bd || (d === bd && (a < ba || (a === ba && b < bb)))) { bd = d; ba = a; bb = b; bv = v; }
      }
    }
    if (bv < 0) break;
    edges.push([ba, bb]);
    inTree[bv] = 1;
  }
  return edges;
}

/** Gabriel graph: (a, b) kept when no third node k has (2xk - xa - xb)^2 + (2yk - ya - yb)^2 < (xa - xb)^2 + (ya - yb)^2. Edges in (a, b) order. */
export function gabrielEdges(nodes: readonly Node[]): Edge[] {
  const n = nodes.length, edges: Edge[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const len2 = dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y);
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k === a || k === b) continue;
        const ex = 2 * nodes[k].x - nodes[a].x - nodes[b].x, ey = 2 * nodes[k].y - nodes[a].y - nodes[b].y;
        if (ex * ex + ey * ey < len2) ok = false;
      }
      if (ok) edges.push([a, b]);
    }
  }
  return edges;
}

/** Relative neighbourhood graph (integer squared distances): (a, b) kept when no k is strictly nearer to both. Edges in (a, b) order. */
export function rngEdges(nodes: readonly Node[]): Edge[] {
  const n = nodes.length, edges: Edge[] = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const len2 = dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y);
      let ok = true;
      for (let k = 0; k < n && ok; k++) {
        if (k === a || k === b) continue;
        const da = dist2(nodes[k].x, nodes[k].y, nodes[a].x, nodes[a].y), db = dist2(nodes[k].x, nodes[k].y, nodes[b].x, nodes[b].y);
        if ((da > db ? da : db) < len2) ok = false;
      }
      if (ok) edges.push([a, b]);
    }
  }
  return edges;
}

/**
 * Brogue's shortcut test: up to `max` extra edges, each the non-edge (a, b) with straight length <= maxLen tiles and the largest
 * ratio graphLen(a, b) / straight >= minRatio (graph shortest path over the current edges, sqrt lengths; a pair the graph does not
 * join has an infinite ratio); recomputed after each. Ties: lower a, then lower b. APPENDS the new edges to `edges` (as [a, b],
 * a < b) and RETURNS ONLY THE ONES IT ADDED.
 */
export function addShortcuts(nodes: readonly Node[], edges: Edge[], max: number, minRatio: number, maxLen: number): Edge[] {
  const n = nodes.length, added: Edge[] = [];
  const maxLen2 = maxLen * maxLen;
  const D = new Float64Array(n * n);
  for (let round = 0; round < max; round++) {
    D.fill(Infinity);
    for (let i = 0; i < n; i++) D[i * n + i] = 0;
    for (const [a, b] of edges) {
      const len = Math.sqrt(dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y));
      if (len < D[a * n + b]) { D[a * n + b] = len; D[b * n + a] = len; }
    }
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const ik = D[i * n + k];
        if (ik === Infinity) continue;
        for (let j = 0; j < n; j++) {
          const v = ik + D[k * n + j];
          if (v < D[i * n + j]) D[i * n + j] = v;
        }
      }
    }
    const linked = new Uint8Array(n * n);
    for (const [a, b] of edges) { linked[a * n + b] = 1; linked[b * n + a] = 1; }
    let ba = -1, bb = -1, br = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (linked[a * n + b]) continue;
        const d2 = dist2(nodes[a].x, nodes[a].y, nodes[b].x, nodes[b].y);
        if (d2 === 0 || d2 > maxLen2) continue;
        const ratio = D[a * n + b] / Math.sqrt(d2);
        if (ratio >= minRatio && ratio > br) { br = ratio; ba = a; bb = b; }
      }
    }
    if (ba < 0) break;
    const e: Edge = [ba, bb];
    edges.push(e);
    added.push(e);
  }
  return added;
}

/** Cyclomatic number E - V + C of a graph (C = connected components): the independent loops. */
export function cyclomatic(nodeCount: number, edges: readonly Edge[]): number {
  const parent = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  let comps = nodeCount;
  for (const [a, b] of edges) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) { parent[ra < rb ? rb : ra] = ra < rb ? ra : rb; comps--; }
  }
  return edges.length - nodeCount + comps;
}

// ------------------------------------------------------------------------------------------------ 3.6 fields, smoothing, components
/** The value chamferFrom leaves on a grid with no source. */
export const CHAMFER_FAR = 1 << 20;

/** Multi-source 3-4 chamfer (thirds of a tile) to the nearest source tile, over the whole grid (two passes). */
export function chamferFrom(sources: ArrayLike<number>, w: number, h: number): Int32Array {
  const n = w * h;
  const d = new Int32Array(n).fill(CHAMFER_FAR);
  for (let k = 0; k < sources.length; k++) { const s = sources[k]; if (s >= 0 && s < n) d[s] = 0; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (v === 0) continue;
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
      if (v === 0) continue;
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

/** The tile of `mask` (nonzero) in [from, to) with the largest `field` value (ties lowest index), or -1: the largest empty circle of a clearance field. */
export function argmaxIn(field: Int32Array, mask: Uint8Array, from = 0, to = field.length): number {
  let best = -1, bv = 0;
  const end = to < field.length ? to : field.length;
  for (let i = from < 0 ? 0 : from; i < end; i++) {
    if (mask[i] === 0) continue;
    if (best < 0 || field[i] > bv) { best = i; bv = field[i]; }
  }
  return best;
}

/**
 * 3x3 majority (self included, >= threshold of 9, default 5) over `set`, `passes` times, limited to `allow` (a tile outside it is
 * 0); the outside of the grid counts as 0. Returns a new set; `set` is not touched.
 */
export function majoritySmooth(set: Uint8Array, allow: Uint8Array, w: number, h: number, passes: number, threshold = 5): Uint8Array {
  const n = w * h;
  let cur = new Uint8Array(n);
  for (let i = 0; i < n; i++) cur[i] = set[i] === 0 ? 0 : 1;
  let next = new Uint8Array(n);
  const row = new Uint8Array(n);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) row[o + x] = cur[o + x] + (x > 0 ? cur[o + x - 1] : 0) + (x < w - 1 ? cur[o + x + 1] : 0);
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const i = o + x;
        const sum = row[i] + (y > 0 ? row[i - w] : 0) + (y < h - 1 ? row[i + w] : 0);
        next[i] = allow[i] !== 0 && sum >= threshold ? 1 : 0;
      }
    }
    const t = cur; cur = next; next = t;
  }
  return cur;
}

/** 4- or 8-connected components of set[i] === 1: label per tile (-1 off), sizes, labelled in row-major order of each component's first tile. */
export function componentsOf(set: Uint8Array, w: number, h: number, eight: boolean): { label: Int32Array; sizes: number[] } {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (set[s] !== 1 || label[s] >= 0) continue;
    const id = sizes.length;
    let head = 0, tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (set[j] === 1 && label[j] < 0) { label[j] = id; queue[tail++] = j; }
        }
      }
    }
    sizes.push(tail);
  }
  return { label, sizes };
}

/** Clears (in place) every component of `set` smaller than `min`; returns the tiles cleared. */
export function pruneSmall(set: Uint8Array, w: number, h: number, min: number, eight: boolean): number {
  const { label, sizes } = componentsOf(set, w, h, eight);
  let cleared = 0;
  for (let i = 0; i < label.length; i++) {
    if (label[i] >= 0 && sizes[label[i]] < min) { set[i] = 0; cleared++; }
  }
  return cleared;
}

/** Flood fill of {value >= tau} from `seed` within `allow` (nonzero), 4-connected; returns the set and its size (empty when the seed itself fails). */
export function floodAbove(value: Int32Array, tau: number, seed: number, allow: Uint8Array, w: number, h: number): { set: Uint8Array; size: number } {
  const n = w * h;
  const set = new Uint8Array(n);
  if (seed < 0 || seed >= n || allow[seed] === 0 || value[seed] < tau) return { set, size: 0 };
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  queue[tail++] = seed;
  set[seed] = 1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    if (x > 0 && !set[i - 1] && allow[i - 1] !== 0 && value[i - 1] >= tau) { set[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < w - 1 && !set[i + 1] && allow[i + 1] !== 0 && value[i + 1] >= tau) { set[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= w && !set[i - w] && allow[i - w] !== 0 && value[i - w] >= tau) { set[i - w] = 1; queue[tail++] = i - w; }
    if (i < n - w && !set[i + w] && allow[i + w] !== 0 && value[i + w] >= tau) { set[i + w] = 1; queue[tail++] = i + w; }
  }
  return { set, size: tail };
}

/**
 * The integer tau whose flood from `seed` (floodAbove) has the smallest size >= target, or the largest size if none reaches it
 * (then the lowest value of the seed's region: the whole region). The flood only changes where tau crosses a value of the
 * region, so the search is a binary search over the region's own sorted distinct values: one fill to learn the region, then at
 * most log2(distinct values) <= 15 more. A seed outside `allow` returns value[seed] (an empty flood).
 */
export function tauForArea(value: Int32Array, seed: number, allow: Uint8Array, w: number, h: number, target: number): number {
  const n = w * h;
  if (seed < 0 || seed >= n || allow[seed] === 0) return seed >= 0 && seed < n ? value[seed] : 0;
  const queue = new Int32Array(n);
  const mark = new Int32Array(n);
  let stamp = 0;
  // the whole region the seed reaches inside `allow`
  const fill = (tau: number): number => {
    stamp++;
    let head = 0, tail = 0;
    queue[tail++] = seed;
    mark[seed] = stamp;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0 && mark[i - 1] !== stamp && allow[i - 1] !== 0 && value[i - 1] >= tau) { mark[i - 1] = stamp; queue[tail++] = i - 1; }
      if (x < w - 1 && mark[i + 1] !== stamp && allow[i + 1] !== 0 && value[i + 1] >= tau) { mark[i + 1] = stamp; queue[tail++] = i + 1; }
      if (i >= w && mark[i - w] !== stamp && allow[i - w] !== 0 && value[i - w] >= tau) { mark[i - w] = stamp; queue[tail++] = i - w; }
      if (i < n - w && mark[i + w] !== stamp && allow[i + w] !== 0 && value[i + w] >= tau) { mark[i + w] = stamp; queue[tail++] = i + w; }
    }
    return tail;
  };
  const region = fill(-2147483648);
  const vals = new Int32Array(region);
  for (let k = 0; k < region; k++) vals[k] = value[queue[k]];
  vals.sort();
  let m = 0;
  for (let k = 0; k < region; k++) if (k === 0 || vals[k] !== vals[k - 1]) vals[m++] = vals[k];
  if (region < target) return vals[0];
  // the seed's own value bounds tau from above (any higher tau leaves nothing)
  let lo = 0, hi = m - 1;
  while (hi > 0 && vals[hi] > value[seed]) hi--;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fill(vals[mid]) >= target) lo = mid; else hi = mid - 1;
  }
  return vals[lo];
}

// ------------------------------------------------------------------------------------------------ 3.7 search
/** What noisyPath reads of a context (a BaseCtx has it). */
export interface PathSource extends NoiseSource {
  readonly w: number;
  readonly h: number;
  readonly mask: Uint8Array;
  readonly hard: Uint8Array;
  readonly tiles: Readonly<Uint8Array>;
}

const PATH_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const PATH_DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** A min-heap of doubles (key = cost * n + node: pops in (cost, node) order, the order kit.flowPath pops in). */
class KeyHeap {
  private a = new Float64Array(1024);
  size = 0;
  push(k: number): void {
    if (this.size === this.a.length) { const b = new Float64Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= k) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = k;
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a[--this.size];
    const n = this.size;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && a[m + 1] < a[m]) m++;
        if (last <= a[m]) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

const hardNearMemo = new WeakMap<object, Uint8Array>();
/** 1 within 3 tiles (Chebyshev) of a protected tile of the zone; computed once per context (the same set kit.flowPath avoids). */
function hardNearOf(c: PathSource): Uint8Array {
  let out = hardNearMemo.get(c);
  if (out) return out;
  const { w, h, mask, hard } = c;
  out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!hard[i] || !mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    for (let dy = -3; dy <= 3; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -3; dx <= 3; dx++) { const nx = x + dx; if (nx >= 0 && nx < w) out[ny * w + nx] = 1; }
    }
  }
  hardNearMemo.set(c, out);
  return out;
}

/**
 * Noisy cheapest path (kit.flowPath's Dijkstra, 8 neighbours, step 10/14 + floor(noise * 30) + 150 within 3 tiles of a protected
 * tile + cost) over this zone's FLOOR, with an optional precomputed integer cost map instead of the callback. Ties pop in tile
 * index order. Empty when unreachable; [a] when a === b. The callback must be pure (it is asked at most once per tile).
 */
export function noisyPath(c: PathSource, a: number, b: number, salt: number, cost?: Int32Array | ((j: number) => number)): number[] {
  const { w, h, mask, tiles } = c;
  const n = w * h;
  const dist = new Int32Array(n).fill(1 << 30), from = new Int32Array(n).fill(-1);
  const noise = new Int8Array(n).fill(-1);
  const extra = typeof cost === "function" ? new Int32Array(n).fill(-2147483648) : null;
  const hardNear = hardNearOf(c);
  const heap = new KeyHeap();
  dist[a] = 0;
  heap.push(a);
  while (heap.size > 0) {
    const key = heap.pop();
    const i = key % n, d = (key - i) / n;
    if (d > dist[i]) continue;
    if (i === b) break;
    const x = i % w, y = (i - x) / w;
    for (let q = 0; q < 8; q++) {
      const nx = x + PATH_DX[q], ny = y + PATH_DY[q];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] || tiles[j] !== TILE_FLOOR) continue;
      if (noise[j] < 0) noise[j] = Math.floor(c.noise.value(nx, ny, 7, salt) * 30);
      let add = 0;
      if (cost !== undefined) {
        if (extra !== null) {
          if (extra[j] === -2147483648) extra[j] = (cost as (j: number) => number)(j);
          add = extra[j];
        } else add = (cost as Int32Array)[j];
      }
      const nd = d + ((q & 1) === 1 ? 14 : 10) + noise[j] + (hardNear[j] ? 150 : 0) + add;
      if (nd < dist[j]) { dist[j] = nd; from[j] = i; heap.push(nd * n + j); }
    }
  }
  const path: number[] = [];
  if (from[b] < 0 && a !== b) return path;
  for (let i = b; i >= 0; i = from[i]) { path.push(i); if (i === a) break; }
  return path.reverse();
}

/**
 * 1-D Viterbi for parallel rows: positions t in [lo, lo + value.length) with integer scores value[t - lo]; consecutive rows
 * gapMin..gapMax apart; total = sum value + sum (-gapPenalty * |gap - gapTarget|). A chain may start and end anywhere; the number
 * of rows is free. Returns the chosen ascending positions: [] if there is no tile or the best chain does not score above 0.
 * Ties: the lowest end position, and the lowest earlier position.
 */
export function viterbiRows(value: Int32Array, lo: number, gapMin: number, gapMax: number, gapTarget: number, gapPenalty: number): number[] {
  const n = value.length;
  if (n === 0) return [];
  const gmin = gapMin < 1 ? 1 : gapMin;
  const dp = new Float64Array(n);
  const par = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0, bq = -1;
    for (let q = t - gapMax < 0 ? 0 : t - gapMax; q <= t - gmin; q++) {
      const cand = dp[q] - gapPenalty * Math.abs(t - q - gapTarget);
      if (cand > best) { best = cand; bq = q; }
    }
    dp[t] = value[t] + best;
    par[t] = bq;
  }
  let bt = -1, bv = -Infinity;
  for (let t = 0; t < n; t++) if (dp[t] > bv) { bv = dp[t]; bt = t; }
  if (bt < 0 || bv <= 0) return [];
  const out: number[] = [];
  for (let t = bt; t >= 0; t = par[t]) out.push(lo + t);
  return out.reverse();
}

/**
 * Viterbi along one row: for s in [0, n), lateral states -half..half (the offset from the row's base), step cost stepCost(s, dt)
 * (integer, read once per state), jogCost per change of state, at most one state per step. Returns the state offset per s.
 * Ties: smaller |offset|, then lower offset (for the end state and for each step's predecessor).
 */
export function viterbiPath(n: number, half: number, stepCost: (s: number, dt: number) => number, jogCost: number): Int8Array {
  const out = new Int8Array(n > 0 ? n : 0);
  if (n <= 0) return out;
  const W = 2 * half + 1;
  const cost = new Float64Array(n * W);
  const from = new Int8Array(n * W);
  for (let w = 0; w < W; w++) cost[w] = stepCost(0, w - half);
  for (let s = 1; s < n; s++) {
    for (let w = 0; w < W; w++) {
      let best = Infinity, bd = 0, bo = 0;
      for (let dw = -1; dw <= 1; dw++) {
        const pw = w + dw;
        if (pw < 0 || pw >= W) continue;
        const v = cost[(s - 1) * W + pw] + (dw !== 0 ? jogCost : 0);
        const po = pw - half, pa = po < 0 ? -po : po, ba = bo < 0 ? -bo : bo;
        if (v < best || (v === best && (pa < ba || (pa === ba && po < bo)))) { best = v; bd = dw; bo = po; }
      }
      cost[s * W + w] = best + stepCost(s, w - half);
      from[s * W + w] = bd;
    }
  }
  let w = 0, bc = Infinity;
  for (let k = 0; k < W; k++) {
    const v = cost[(n - 1) * W + k];
    const o = k - half, oa = o < 0 ? -o : o, bo = w - half, ba = bo < 0 ? -bo : bo;
    if (v < bc || (v === bc && (oa < ba || (oa === ba && o < bo)))) { bc = v; w = k; }
  }
  for (let s = n - 1; s >= 0; s--) {
    out[s] = w - half;
    if (s > 0) w += from[s * W + w];
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ 3.9 the route guard
/** The styler threshold, permille of a member's baseline walk (the Mere's headlands and spires use 1020). */
export const ROUTE_STRETCH_MAX = 1030;
/** What worstStretch() returns when a member can no longer reach the coliseum. */
export const ROUTE_CUT_OFF = 1_000_000;

/**
 * A RouteGuard whose worstStretch can also be asked about walls that are not written. (types.ts's RouteGuard carries the same
 * optional parameter once the integrator adds it; until then this is the type makeRouteGuard hands out.)
 */
export interface RouteGuardX extends RouteGuard {
  /** worstStretch() as if these tile indices were walls too; c.tiles is not touched. No list, or an empty one: the plain call. */
  worstStretch(extraWallTiles?: ArrayLike<number>): number;
}

/** What makeRouteGuard reads of a context (a BaseCtx has it: `spawns` and `centreWalk` are the generator's new fields). */
export interface RouteGuardSource {
  readonly w: number;
  readonly h: number;
  /** 1 = this zone's tile. */
  readonly mask: Uint8Array;
  /** The live tiles: read on every worstStretch() call. */
  readonly tiles: Readonly<Uint8Array>;
  readonly spawns: readonly number[];
  /** walkField16 to the coliseum centre at pool-pick time (fifths of a tile, -1 unreachable), or null (no members, no guard). */
  readonly centreWalk: Int32Array | null;
}

/**
 * The zone's route guard (contract 3.9). The zone field is walkField16 relaxed over this zone's tiles only, seeded by every FLOOR
 * tile outside the zone within Chebyshev 2 of a zone tile (centreWalk >= 0) with its pick-time centreWalk value, so it reads this
 * zone's tiles and tiles no other zone may write (they keep a rim); another zone's writes never change a result. The corridors
 * are drawn on this zone's tiles plus, outside it, the pick-time ground (floor where centreWalk >= 0), so they do not read other
 * zones either: each member's baseline steepest descent over that ground, string-pulled with segmentBlocked(MASK_MOVE) (from each
 * anchor the farthest later tile a straight segment between tile centres reaches), sampled twice per tile, dilated by Chebyshev 1
 * and kept to the zone.
 */
export function makeRouteGuard(c: RouteGuardSource): RouteGuardX {
  const { w, h, mask, tiles } = c;
  const n = w * h;
  const walk = c.centreWalk;
  const members: number[] = [];
  if (walk) for (const m of c.spawns) if (m >= 0 && m < n && mask[m] === 1 && walk[m] >= 0) members.push(m);
  const base = new Int32Array(members.length);
  for (let k = 0; k < members.length; k++) base[k] = walk![members[k]];
  const corridor = new Uint8Array(n);
  const perMember: number[][] = [];
  // The ground the corridors are drawn on: this zone's tiles as they are now, and outside it what the pick saw (a tile is floor
  // there when the pick-time walk reached it), so no other zone's writes can reach a corridor.
  const ground = new Uint8Array(members.length > 0 ? n : 0);
  if (members.length > 0) for (let i = 0; i < n; i++) ground[i] = mask[i] === 1 ? tiles[i] : walk![i] >= 0 ? TILE_FLOOR : TILE_WALL;
  for (let k = 0; k < members.length; k++) {
    // The baseline descent pulled straight: from each anchor the farthest later tile that a segment between tile centres reaches
    // over open ground. A real walk is a string-pulled path, and the raw steepest descent on the 5-7-11 field takes knight moves
    // first and bows off it, so the band of the raw path missed over half of the real walks.
    const raw = descentPath(walk!, ground, w, h, members[k]);
    const pts = [raw[0]];
    for (let a = 0; a < raw.length - 1;) {
      const ax = raw[a] % w, ay = (raw[a] - ax) / w;
      let j = raw.length - 1;
      for (; j > a + 1; j--) {
        const bx = raw[j] % w;
        if (!segmentBlocked(ground, w, h, ax, ay, bx, (raw[j] - bx) / w, MASK_MOVE)) break;
      }
      pts.push(raw[j]);
      a = j;
    }
    // the band: every tile within Chebyshev 1 of a sample, two samples per tile of the longer axis, rounded half up
    const mine: number[] = [];
    const seen = new Set<number>();
    const take = (i: number): void => { if (mask[i] === 1 && !seen.has(i)) { seen.add(i); mine.push(i); corridor[i] = 1; } };
    take(pts[0]);
    for (let s = 0; s < pts.length; s++) {
      const ax = pts[s] % w, ay = (pts[s] - ax) / w;
      const bx = pts[s < pts.length - 1 ? s + 1 : s] % w, by = (pts[s < pts.length - 1 ? s + 1 : s] - bx) / w;
      const steps = 2 * Math.max(Math.abs(bx - ax), Math.abs(by - ay)) || 1;
      for (let q = 0; q <= steps; q++) {
        const x = ax + Math.floor((2 * (bx - ax) * q + steps) / (2 * steps)), y = ay + Math.floor((2 * (by - ay) * q + steps) / (2 * steps));
        take(y * w + x);
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) { const nx = x + dx; if (nx >= 0 && nx < w) take(ny * w + nx); }
        }
      }
    }
    perMember.push(mine);
  }
  // the seeds of the zone field: outside FLOOR tiles within Chebyshev 2 of a reachable zone tile, sorted by (value, tile)
  let seedTiles = new Int32Array(0), seedValues = new Int32Array(0);
  if (members.length > 0) {
    const picked = new Uint8Array(n);
    const list: number[] = [];
    for (let i = 0; i < n; i++) {
      if (mask[i] !== 1 || walk![i] < 0) continue;
      const x = i % w, y = (i - x) / w;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (mask[j] === 1 || picked[j] || tiles[j] !== TILE_FLOOR || walk![j] < 0) continue;
          picked[j] = 1;
          list.push(j);
        }
      }
    }
    const keys = new Float64Array(list.length);
    for (let k = 0; k < list.length; k++) keys[k] = walk![list[k]] * 2097152 + list[k];
    keys.sort();
    seedTiles = new Int32Array(list.length);
    seedValues = new Int32Array(list.length);
    for (let k = 0; k < list.length; k++) { const t = keys[k] % 2097152; seedTiles[k] = t; seedValues[k] = walk![t]; }
  }
  let worstK = -1;
  let probe: Uint8Array | null = null;
  return {
    members,
    base,
    corridor,
    corridorOf: (k) => perMember[k] ?? [],
    worstStretch(extraWallTiles?: ArrayLike<number>): number {
      worstK = -1;
      if (members.length === 0) return 1000;
      let ground = tiles as Uint8Array;
      if (extraWallTiles !== undefined && extraWallTiles.length > 0) {
        // the candidate's walls on a private copy of the tiles: c.tiles is never written
        if (probe === null) probe = new Uint8Array(n);
        probe.set(tiles);
        for (let k = 0; k < extraWallTiles.length; k++) { const i = extraWallTiles[k]; if (i >= 0 && i < n) probe[i] = TILE_WALL; }
        ground = probe;
      }
      const field = walkField16(ground, w, h, seedTiles, seedValues, mask);
      let worst = -1;
      for (let k = 0; k < members.length; k++) {
        const v = field[members[k]];
        if (v < 0) { worstK = k; return ROUTE_CUT_OFF; }
        const s = base[k] > 0 ? Math.floor((v * 1000) / base[k]) : 1000;
        if (s > worst) { worst = s; worstK = k; }
      }
      return worst < 1000 ? 1000 : worst;
    },
    worstMember: () => worstK,
    touches(list: ArrayLike<number>): boolean {
      for (let k = 0; k < list.length; k++) if (corridor[list[k]] === 1) return true;
      return false;
    },
  };
}
