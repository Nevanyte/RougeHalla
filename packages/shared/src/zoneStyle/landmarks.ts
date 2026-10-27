// The landmark template kit (WP0k, contract sections 3.8 and 5): a landmark is a small hand-drawn building stamped whole into a
// zone, in any of 8 orientations (4 quarter turns, with or without a mirror), through the guard's placeFeature. This module is the
// pure part (parsing, turning, stamping, validity) plus the placement helpers that take a LandmarkCtx. The driver that calls each
// zone's styler.landmark is styleZones.ts (WP0a), so there is no placeLandmarks here, and nothing in this file imports the
// generator or the styler registry.
//
// Usage notes for the zone stylers (WP1-5):
//  - A template is `{ key, rows, jobs }`; rows use '#' WALL, '.' owned floor, 'd' door (owned floor, reserved, 2-3 wide), 'c' crate
//    nook (owned floor, a crate candidate: 4-adjacent to a wall, not 8-adjacent to a door), 'l' owned floor the surface pass may
//    light, '_' not part of the landmark. The `key` is the feature's `variant`.
//  - An orientation is `rot` quarter turns clockwise (about the template's top-left, re-anchored to the top-left of the turned box)
//    after an optional mirror (x flip before the turn). `o = rot + 4 * mirror` numbers the 8; bestLandmark tries them in that order.
//    The origin (x0, y0) is the top-left of the turned BOX, which is also `Stamp.bbox` (the feature's anchor and the landmark box
//    the gap rule, `map.buildings` and the stylers' protect use).
//  - `Stamp` lists are in template order (row-major over the UNTURNED template), so "the c nooks in template order" means the same
//    nook whatever the orientation. A feature records `[rot, mirror, ...doors ascending]` and the origin as its anchor: re-stamping
//    `stampTemplate(template, ax, ay, p[0], p[1] === 1, w, h)` recovers every list (the generator's crates do this).
//  - `bestLandmark(c, t, score)` scores every fitting (origin, orientation) with `score(stamp, rot, mirror)`: HIGHER IS BETTER, and
//    the stamp handed to `score` is a scratch object reused for the next candidate (read it, never keep it). Ties go to the lower
//    origin index, then the lower orientation. A landmark that does not stand (the guard refuses a wall) costs one of `tries`.
//    About 0.1 ms a call on a real 136x136 zone (~1000 fitting candidates, ~0.07 ms of it scoring), most of it the fit scan and
//    the score. Two optional extras, `bestLandmark(c, t, score, tries, { bound, search })`, change the cost and never the answer:
//    `bound(bbox, rot, mirror)` is an upper bound on the score from the box alone (a distance term without its penalties):
//    candidates are scored best bound first and the search stops once the next bound is below the worst of the best `tries`
//    scores, so an expensive score is asked for fewer candidates (it must never be lower than the score: that is the contract);
//    `search` (from `makeLandmarkSearch(c)`, or `makeLandmarkSearch(c).best(t, score, tries, bound)`) keeps the zone's fit tables
//    for the second landmark of a pass, patched after the first one it placed and rebuilt after any other write it can see.
//  - `templateProblems(t)` is the validity check of contract 3.8 in all 8 orientations (an empty list = valid): wall pieces of at
//    least FEATURE_MIN_PIECE, doors 2-3 tiles wide with a way through, all owned floor 4-connected, nooks as above.
import { TILE_FLOOR } from "../map";
import type { FeatureJob, MapFeature, TileRect } from "../map";
import { FEATURE_MIN_PIECE } from "./types";
import type { FeatureSpec, LandmarkCtx, PlacedFeature } from "./types";

/** Empty tiles kept between a landmark's box and another landmark's box (contract 3.1). */
export const LANDMARK_GAP = 3;
/** Candidate landmarks bestLandmark tries before it gives up (contract 3.8). */
export const LANDMARK_TRIES = 12;

/**
 * A landmark template: rows of characters. '#' WALL, '.' owned floor, 'd' door (owned floor, reserved), 'c' crate nook (owned
 * floor, crate candidate first), 'l' owned floor the zone's surface pass may light, '_' not part of the landmark.
 */
export interface LandmarkTemplate { readonly key: string; readonly rows: readonly string[]; readonly jobs: readonly FeatureJob[] }
export interface Stamp { walls: number[]; floor: number[]; doors: number[]; nooks: number[]; lights: number[]; bbox: TileRect }

// cell codes of a parsed template
const C_WALL = 0, C_FLOOR = 1, C_DOOR = 2, C_NOOK = 3, C_LIGHT = 4;
const CODE_OF: Readonly<Record<string, number>> = { "#": C_WALL, ".": C_FLOOR, d: C_DOOR, c: C_NOOK, l: C_LIGHT };

/** A template turned and mirrored: the cell offsets from the top-left of the turned box, in template order. */
interface Oriented {
  readonly bw: number;
  readonly bh: number;
  readonly dx: Int16Array;
  readonly dy: Int16Array;
  readonly code: Uint8Array;
  /** Cells of each kind: walls, floor, doors, nooks, lights. */
  readonly count: readonly [number, number, number, number, number];
  /** No '_' cell: the box is the landmark. */
  readonly full: boolean;
  /** Maximal rectangles of one requirement, five numbers each: x, y, w, h, 1 = wall (needs open ground) / 0 = floor; walls first. Floor ones only when the box is not `full`. */
  readonly rects: Int16Array;
  /** The offsets (dy * width + dx) of each kind's cells in template order, for the grid width `offW`. */
  offW: number;
  offs: [Int32Array, Int32Array, Int32Array, Int32Array, Int32Array];
}

const ORIENTED = new WeakMap<LandmarkTemplate, Oriented[]>();

/** Greedy maximal rectangles over a grid of requirements (-1 = no cell, 0 = floor, 1 = wall), walls first, each in row-major order of its first cell. */
function rectsOf(req: Int8Array, bw: number, bh: number): Int16Array {
  const taken = new Uint8Array(bw * bh);
  const out: number[][] = [[], []];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const r = req[y * bw + x];
      if (r < 0 || taken[y * bw + x]) continue;
      let w = 1;
      while (x + w < bw && req[y * bw + x + w] === r && !taken[y * bw + x + w]) w++;
      let h = 1;
      for (; y + h < bh; h++) {
        let row = true;
        for (let k = 0; k < w && row; k++) row = req[(y + h) * bw + x + k] === r && !taken[(y + h) * bw + x + k] ? true : false;
        if (!row) break;
      }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) taken[(y + yy) * bw + x + xx] = 1;
      out[r === 1 ? 0 : 1].push(x, y, w, h, r === 1 ? 1 : 0);
    }
  }
  return Int16Array.from([...out[0], ...out[1]]);
}

function orientationsOf(t: LandmarkTemplate): Oriented[] {
  let all = ORIENTED.get(t);
  if (all) return all;
  const th = t.rows.length, tw = th > 0 ? t.rows[0].length : 0;
  const xs: number[] = [], ys: number[] = [], cs: number[] = [];
  for (let y = 0; y < th; y++) {
    if (t.rows[y].length !== tw) throw new RangeError(`landmark ${t.key}: row ${y} is ${t.rows[y].length} wide, not ${tw}`);
    for (let x = 0; x < tw; x++) {
      const ch = t.rows[y][x];
      if (ch === "_") continue;
      const code = CODE_OF[ch];
      if (code === undefined) throw new RangeError(`landmark ${t.key}: unknown cell '${ch}' at ${x},${y}`);
      xs.push(x); ys.push(y); cs.push(code);
    }
  }
  all = [];
  for (let o = 0; o < 8; o++) {
    const rot = o & 3, mirror = o >= 4;
    const turned = (rot & 1) === 1;
    const dx = new Int16Array(xs.length), dy = new Int16Array(xs.length);
    for (let k = 0; k < xs.length; k++) {
      const x = mirror ? tw - 1 - xs[k] : xs[k], y = ys[k];
      if (rot === 0) { dx[k] = x; dy[k] = y; }
      else if (rot === 1) { dx[k] = th - 1 - y; dy[k] = x; }
      else if (rot === 2) { dx[k] = tw - 1 - x; dy[k] = th - 1 - y; }
      else { dx[k] = y; dy[k] = tw - 1 - x; }
    }
    const count: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const code of cs) count[code]++;
    const bw = turned ? th : tw, bh = turned ? tw : th;
    const req = new Int8Array(bw * bh).fill(-1);
    for (let k = 0; k < xs.length; k++) req[dy[k] * bw + dx[k]] = cs[k] === C_WALL ? 1 : 0;
    const full = xs.length === bw * bh;
    // a box with no '_' cell is tested as a whole for free ground (once per size, in search), so only its walls need rectangles
    const rects = rectsOf(req, bw, bh);
    const kept: number[] = [];
    for (let q = 0; q < rects.length; q += 5) if (!full || rects[q + 4] === 1) kept.push(rects[q], rects[q + 1], rects[q + 2], rects[q + 3], rects[q + 4]);
    all.push({
      bw, bh, dx, dy, code: Uint8Array.from(cs), count, full, rects: Int16Array.from(kept), offW: -1,
      offs: [new Int32Array(0), new Int32Array(0), new Int32Array(0), new Int32Array(0), new Int32Array(0)],
    });
  }
  ORIENTED.set(t, all);
  return all;
}

/** The per-kind offsets of an orientation for a grid `w` wide (cached on the orientation: one width at a time). */
function offsetsFor(o: Oriented, w: number): Oriented["offs"] {
  if (o.offW === w) return o.offs;
  const lists: number[][] = [[], [], [], [], []];
  for (let k = 0; k < o.code.length; k++) lists[o.code[k]].push(o.dy[k] * w + o.dx[k]);
  o.offs = [Int32Array.from(lists[0]), Int32Array.from(lists[1]), Int32Array.from(lists[2]), Int32Array.from(lists[3]), Int32Array.from(lists[4])];
  o.offW = w;
  return o.offs;
}

function fillStamp(o: Oriented, x0: number, y0: number, w: number, out: Stamp): void {
  const [nw, nf, nd, nn, nl] = o.count;
  if (out.walls.length !== nw) out.walls.length = nw;
  if (out.floor.length !== nf) out.floor.length = nf;
  if (out.doors.length !== nd) out.doors.length = nd;
  if (out.nooks.length !== nn) out.nooks.length = nn;
  if (out.lights.length !== nl) out.lights.length = nl;
  const offs = offsetsFor(o, w), base = y0 * w + x0;
  const ow = offs[0], of = offs[1], od = offs[2], on = offs[3], ol = offs[4];
  for (let k = 0; k < nw; k++) out.walls[k] = base + ow[k];
  for (let k = 0; k < nf; k++) out.floor[k] = base + of[k];
  for (let k = 0; k < nd; k++) out.doors[k] = base + od[k];
  for (let k = 0; k < nn; k++) out.nooks[k] = base + on[k];
  for (let k = 0; k < nl; k++) out.lights[k] = base + ol[k];
  out.bbox.x = x0; out.bbox.y = y0; out.bbox.w = o.bw; out.bbox.h = o.bh;
}

function inGrid(o: Oriented, x0: number, y0: number, w: number, h: number): boolean {
  for (let k = 0; k < o.code.length; k++) {
    const x = x0 + o.dx[k], y = y0 + o.dy[k];
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
  }
  return true;
}

/**
 * The template at origin (x0, y0) after `rot` quarter turns (clockwise, about the template's top-left, re-anchored to the top-left
 * of the rotated box) and an optional mirror (x flip before the turn). Null when any non-'_' cell leaves the grid. The lists are
 * in template order; `bbox` is the turned box at the origin.
 */
export function stampTemplate(t: LandmarkTemplate, x0: number, y0: number, rot: 0 | 1 | 2 | 3, mirror: boolean, w: number, h: number): Stamp | null {
  const o = orientationsOf(t)[(rot & 3) + (mirror ? 4 : 0)];
  if (!inGrid(o, x0, y0, w, h)) return null;
  const out: Stamp = { walls: [], floor: [], doors: [], nooks: [], lights: [], bbox: { x: x0, y: y0, w: o.bw, h: o.bh } };
  fillStamp(o, x0, y0, w, out);
  return out;
}

/** Does the box grown by LANDMARK_GAP touch another landmark of this zone? */
function gapOk(features: readonly MapFeature[], bx: number, by: number, bw: number, bh: number): boolean {
  for (const f of features) {
    if (f.kind !== "landmark") continue;
    const r = f.bbox;
    if (bx - LANDMARK_GAP < r.x + r.w && bx + bw + LANDMARK_GAP > r.x && by - LANDMARK_GAP < r.y + r.h && by + bh + LANDMARK_GAP > r.y) return false;
  }
  return true;
}

/**
 * Static fit: every '#' passes ctx.open, every other non-'_' cell is FLOOR in the zone, not hard and not owned, and the box grown
 * by LANDMARK_GAP misses every other landmark box of the zone.
 */
export function stampFits(c: LandmarkCtx, s: Stamp): boolean {
  for (const i of s.walls) if (!c.open(i)) return false;
  const { mask, tiles, hard } = c;
  for (const list of [s.floor, s.doors, s.nooks, s.lights]) {
    for (const i of list) if (!mask[i] || tiles[i] !== TILE_FLOOR || hard[i] || c.isOwned(i)) return false;
  }
  return gapOk(c.zoneFeatures(), s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h);
}

/**
 * Places a stamp with placeFeature(kind "landmark", mode "whole", floor = floor + doors + nooks + lights); the door tiles are
 * reserved once it stands. Params `[rot, mirror, ...doors ascending]`, anchor the stamp's origin, variant the template key.
 */
export function placeLandmark(c: LandmarkCtx, t: LandmarkTemplate, s: Stamp, rot: number, mirror: boolean): PlacedFeature | null {
  const doors = s.doors.slice().sort((a, b) => a - b);
  const spec: FeatureSpec = {
    kind: "landmark",
    variant: t.key,
    jobs: t.jobs,
    anchor: [s.bbox.x, s.bbox.y],
    params: [rot, mirror ? 1 : 0, ...doors],
    blocks: s.walls.map((i) => [i, "wall"] as const),
    floor: [...s.floor, ...s.doors, ...s.nooks, ...s.lights],
    mode: "whole",
  };
  const placed = c.placeFeature(spec);
  if (placed) for (const d of s.doors) c.reserve(d);
  return placed;
}

/**
 * The fit tables of one zone: per tile of the zone's box, whether a wall may stand there (ctx.open) and whether floor may (zone
 * FLOOR, not hard, not owned), and their summed-area tables, so a candidate is tested by a handful of rectangle sums.
 */
interface Tables {
  readonly bw: number;
  readonly bh: number;
  readonly okWall: Uint8Array;
  readonly okFloor: Uint8Array;
  readonly satWall: Int32Array;
  readonly satFloor: Int32Array;
  /** What the zone looked like when they were made: its feature count and a checksum of its box. */
  features: number;
  sum: number;
}

function satsOf(tab: Tables, fromRow = 0): void {
  const { bw, bh, okWall, okFloor, satWall, satFloor } = tab;
  const W1 = bw + 1;
  for (let y = fromRow; y < bh; y++) {
    let rowWall = 0, rowFloor = 0;
    const o = (y + 1) * W1 + 1, up = y * W1 + 1, k0 = y * bw;
    for (let x = 0; x < bw; x++) {
      rowWall += okWall[k0 + x];
      rowFloor += okFloor[k0 + x];
      satWall[o + x] = satWall[up + x] + rowWall;
      satFloor[o + x] = satFloor[up + x] + rowFloor;
    }
  }
}

/** A checksum of the zone's box of tiles: a write to it moves the sum (a wall is 1, a LOW tile 2; the writes of a pass only add). */
function boxSum(c: LandmarkCtx): number {
  const zb = c.zone.bbox, { w, tiles } = c;
  let sum = 0;
  for (let y = zb.y; y < zb.y + zb.h; y++) {
    const o = y * w + zb.x;
    for (let x = 0; x < zb.w; x++) sum += tiles[o + x];
  }
  return sum;
}

function buildTables(c: LandmarkCtx): Tables {
  const { w, mask, tiles, hard } = c;
  const zb = c.zone.bbox, bw = zb.w, bh = zb.h;
  const okWall = new Uint8Array(bw * bh), okFloor = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (zb.y + y) * w + zb.x + x;
      // open(i) implies the floor rule (zone FLOOR, unprotected, unowned), so it is asked only where that holds
      if (mask[i] === 1 && tiles[i] === TILE_FLOOR && hard[i] === 0 && !c.isOwned(i)) {
        okFloor[y * bw + x] = 1;
        if (c.open(i)) okWall[y * bw + x] = 1;
      }
    }
  }
  const tab: Tables = {
    bw, bh, okWall, okFloor, satWall: new Int32Array((bw + 1) * (bh + 1)), satFloor: new Int32Array((bw + 1) * (bh + 1)),
    features: c.zoneFeatures().length, sum: boxSum(c),
  };
  satsOf(tab);
  return tab;
}

/** What a LandmarkSearch keeps for its context. */
interface SearchState { readonly c: LandmarkCtx; tab: Tables | null }

/** An upper bound on `score` for a candidate with this box and orientation (see LandmarkOptions.bound). */
export type LandmarkBound = (bbox: TileRect, rot: number, mirror: boolean) => number;

/** The optional extras of bestLandmark. */
export interface LandmarkOptions {
  /** From makeLandmarkSearch(c) of the same context: shares the fit tables with the other calls of the landmark pass. */
  search?: LandmarkSearch;
  /**
   * A cheap upper bound on `score` that depends on the box and the orientation only (never lower than the score the stamp would
   * get). With it the search scores candidates best-bound first and stops once the next bound is below the worst of the best
   * `tries` scores, so an expensive score is asked for a handful of candidates instead of all; the answer is the same as without.
   */
  bound?: LandmarkBound;
}

/**
 * The fit tables of one zone, kept between the calls of one landmark pass so the second `best` does not rebuild them. Made by
 * makeLandmarkSearch(c) for one context; `best` is bestLandmark with the same results, bit for bit. After a landmark it placed
 * itself it patches the tables (the stamp's tiles are taken); if the zone's feature count or tiles changed by any other write it
 * rebuilds them, and `reset()` forgets them (after a reserve() or a change of `hard` / `open`, which it cannot see).
 */
export interface LandmarkSearch {
  /** The context it was made for. */
  readonly context: LandmarkCtx;
  best(t: LandmarkTemplate, score: (s: Stamp, rot: number, mirror: boolean) => number, tries?: number, bound?: LandmarkBound): PlacedFeature | null;
  reset(): void;
}

export function makeLandmarkSearch(c: LandmarkCtx): LandmarkSearch {
  const st: SearchState = { c, tab: null };
  return { context: c, best: (t, score, tries = LANDMARK_TRIES, bound) => search(c, t, score, tries, st, bound), reset: () => { st.tab = null; } };
}

/**
 * Candidate origins of the zone (every 2nd tile of the zone's box from its top-left, all 8 orientations) that pass stampFits,
 * scored by `score` (higher first; ties lower origin index, then orientation), tried until one stands or `tries` (12) run out.
 * `score` gets a scratch stamp (reused: do not keep it), the quarter turns and the mirror. Null when nothing fits or stands.
 * `opts.search` shares the fit tables between the calls of one landmark pass; `opts.bound` lets an expensive score be skipped.
 */
export function bestLandmark(c: LandmarkCtx, t: LandmarkTemplate, score: (s: Stamp, rot: number, mirror: boolean) => number, tries: number = LANDMARK_TRIES, opts?: LandmarkOptions): PlacedFeature | null {
  const sr = opts?.search;
  return sr !== undefined && sr.context === c ? sr.best(t, score, tries, opts?.bound) : search(c, t, score, tries, null, opts?.bound);
}

/** Max-heap sift on candidate indices: a larger bound first, the lower index among equal bounds. */
function siftDown(heap: Int32Array, size: number, i: number, bounds: Float64Array): void {
  const top = heap[i];
  for (;;) {
    let c = 2 * i + 1;
    if (c >= size) break;
    if (c + 1 < size && (bounds[heap[c + 1]] > bounds[heap[c]] || (bounds[heap[c + 1]] === bounds[heap[c]] && heap[c + 1] < heap[c]))) c++;
    const ch = heap[c];
    if (bounds[top] > bounds[ch] || (bounds[top] === bounds[ch] && top < ch)) break;
    heap[i] = ch;
    i = c;
  }
  heap[i] = top;
}

function search(c: LandmarkCtx, t: LandmarkTemplate, score: (s: Stamp, rot: number, mirror: boolean) => number, tries: number, st: SearchState | null, bound?: LandmarkBound): PlacedFeature | null {
  const orient = orientationsOf(t);
  const { w, h } = c;
  const zb = c.zone.bbox;
  const features = c.zoneFeatures();
  let tab = st !== null ? st.tab : null;
  if (tab !== null && (tab.features !== features.length || tab.sum !== boxSum(c))) tab = null;
  if (tab === null) { tab = buildTables(c); if (st !== null) st.tab = tab; }
  const { bw, bh, satWall, satFloor } = tab;
  const W1 = bw + 1;
  // 1. the fitting (origin, orientation) pairs, in (origin, orientation) order
  let cap = ((bw + 1) >> 1) * ((bh + 1) >> 1) * 8 + 8;
  let candOrigin = new Int32Array(cap), candO = new Int8Array(cap);
  let n = 0;
  const freeBox = new Int8Array(2);
  const ref = orient[0], tw = ref.bw, th = ref.bh;
  for (let y0 = zb.y; y0 < zb.y + zb.h; y0 += 2) {
    const ry = y0 - zb.y;
    for (let x0 = zb.x; x0 < zb.x + zb.w; x0 += 2) {
      const rx = x0 - zb.x;
      freeBox[0] = freeBox[1] = -1;
      for (let o = 0; o < 8; o++) {
        const ori = orient[o];
        if (ori.full) {
          // a box with a tile that fits nothing fails every orientation of its size: asked once per size
          let g = freeBox[o & 1];
          if (g < 0) {
            const bw0 = (o & 1) === 0 ? tw : th, bh0 = (o & 1) === 0 ? th : tw;
            g = rx + bw0 <= bw && ry + bh0 <= bh && satFloor[(ry + bh0) * W1 + rx + bw0] - satFloor[ry * W1 + rx + bw0] - satFloor[(ry + bh0) * W1 + rx] + satFloor[ry * W1 + rx] === bw0 * bh0 ? 1 : 0;
            freeBox[o & 1] = g;
          }
          if (g === 0) continue;
        }
        const rects = ori.rects;
        let fits = true;
        for (let q = 0; q < rects.length; q += 5) {
          const qx = rx + rects[q], qy = ry + rects[q + 1], qw = rects[q + 2], qh = rects[q + 3];
          if (qx + qw > bw || qy + qh > bh) { fits = false; break; }
          const sat = rects[q + 4] === 1 ? satWall : satFloor;
          if (sat[(qy + qh) * W1 + qx + qw] - sat[qy * W1 + qx + qw] - sat[(qy + qh) * W1 + qx] + sat[qy * W1 + qx] !== qw * qh) { fits = false; break; }
        }
        if (!fits || !gapOk(features, x0, y0, ori.bw, ori.bh)) continue;
        if (n === cap) {
          const no = new Int32Array(cap * 2), nO = new Int8Array(cap * 2);
          no.set(candOrigin); nO.set(candO);
          candOrigin = no; candO = nO; cap *= 2;
        }
        candOrigin[n] = y0 * w + x0; candO[n] = o; n++;
      }
    }
  }
  // 2. the best `tries` of them by score (ties: the lower origin, then the lower orientation)
  const keep = tries > 0 ? tries : 0;
  const topScore = new Float64Array(keep), topOrigin = new Int32Array(keep), topO = new Int8Array(keep);
  let m = 0;
  const scratch: Stamp = { walls: [], floor: [], doors: [], nooks: [], lights: [], bbox: { x: 0, y: 0, w: 0, h: 0 } };
  // With a bound the candidates come out of a max-heap on (bound, then the earlier candidate), so only the few best are ever scored.
  let bounds: Float64Array | null = null;
  let heap: Int32Array | null = null, heapSize = 0;
  if (bound !== undefined && keep > 0 && n > keep) {
    bounds = new Float64Array(n);
    const box: TileRect = { x: 0, y: 0, w: 0, h: 0 };
    for (let k = 0; k < n; k++) {
      const o = candO[k], ori = orient[o];
      box.x = candOrigin[k] % w; box.y = (candOrigin[k] - box.x) / w; box.w = ori.bw; box.h = ori.bh;
      const b = bound(box, o & 3, o >= 4);
      bounds[k] = b === b ? b : Infinity;
    }
    heap = new Int32Array(n);
    for (let k = 0; k < n; k++) heap[k] = k;
    heapSize = n;
    for (let i = (n >> 1) - 1; i >= 0; i--) siftDown(heap, heapSize, i, bounds);
  }
  for (let r = 0; r < n; r++) {
    let k = r;
    if (heap !== null && bounds !== null) {
      if (heapSize === 0) break;
      k = heap[0];
      // best bound first: once it is below the worst kept score nothing after it can get in (an equal bound still can tie)
      if (m === keep && bounds[k] < topScore[m - 1]) break;
      heap[0] = heap[--heapSize];
      siftDown(heap, heapSize, 0, bounds);
    }
    const o = candO[k], origin = candOrigin[k];
    const ori = orient[o];
    const x0 = origin % w, y0 = (origin - x0) / w;
    fillStamp(ori, x0, y0, w, scratch);
    let sc = score(scratch, o & 3, o >= 4);
    if (sc !== sc) sc = -Infinity;
    if (keep === 0) continue;
    if (m === keep) {
      const last = m - 1;
      if (!(sc > topScore[last] || (sc === topScore[last] && (origin < topOrigin[last] || (origin === topOrigin[last] && o < topO[last]))))) continue;
    }
    let p = m < keep ? m : keep - 1;
    while (p > 0 && (topScore[p - 1] < sc || (topScore[p - 1] === sc && (topOrigin[p - 1] > origin || (topOrigin[p - 1] === origin && topO[p - 1] > o))))) {
      topScore[p] = topScore[p - 1]; topOrigin[p] = topOrigin[p - 1]; topO[p] = topO[p - 1]; p--;
    }
    topScore[p] = sc; topOrigin[p] = origin; topO[p] = o;
    if (m < keep) m++;
  }
  // 3. place the best that the guard accepts
  for (let k = 0; k < m; k++) {
    const origin = topOrigin[k], o = topO[k];
    const x0 = origin % w, y0 = (origin - x0) / w;
    const s = stampTemplate(t, x0, y0, (o & 3) as 0 | 1 | 2 | 3, o >= 4, w, h);
    if (!s) continue;
    const placed = placeLandmark(c, t, s, o & 3, o >= 4);
    if (placed) {
      // the stamp's tiles are taken now: patch the tables instead of rebuilding them
      if (st !== null && st.tab === tab) {
        for (const list of [s.walls, s.floor, s.doors, s.nooks, s.lights]) {
          for (const i of list) {
            const x = (i % w) - zb.x, y = Math.floor(i / w) - zb.y;
            tab.okWall[y * tab.bw + x] = 0;
            tab.okFloor[y * tab.bw + x] = 0;
          }
        }
        satsOf(tab, s.bbox.y - zb.y);
        tab.features = c.zoneFeatures().length;
        tab.sum = boxSum(c);
      }
      return placed;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ validity
const K_NONE = 0, K_WALL = 1, K_FLOOR = 2, K_DOOR = 3, K_NOOK = 4;

/**
 * The validity rules of contract 3.8 for a template, checked on the stamped result in all 8 orientations (so a broken turn or
 * mirror shows too). Empty = valid. Rules: every 8-connected WALL piece has at least `minPiece` (FEATURE_MIN_PIECE) tiles; every
 * door is a straight run of 2 or 3 tiles with owned floor on one side and nothing owned on the other; all owned floor (doors and
 * nooks included) is one 4-connected piece; at least `minNooks` (1) 'c', each 4-adjacent to a wall and not 8-adjacent to a door.
 */
export function templateProblems(t: LandmarkTemplate, opts: { minNooks?: number; minPiece?: number } = {}): string[] {
  const out: string[] = [];
  const minNooks = opts.minNooks ?? 1, minPiece = opts.minPiece ?? FEATURE_MIN_PIECE;
  const th = t.rows.length, tw = th > 0 ? t.rows[0].length : 0;
  const side = Math.max(tw, th) + 4;
  for (let o = 0; o < 8; o++) {
    const rot = (o & 3) as 0 | 1 | 2 | 3, mirror = o >= 4;
    const tag = `${t.key} rot ${rot}${mirror ? " mirrored" : ""}`;
    const s = stampTemplate(t, 2, 2, rot, mirror, side, side);
    if (!s) { out.push(`${tag}: does not stamp`); continue; }
    const g = new Uint8Array(side * side);
    for (const i of s.walls) g[i] = K_WALL;
    for (const i of s.floor) g[i] = K_FLOOR;
    for (const i of s.lights) g[i] = K_FLOOR;
    for (const i of s.doors) g[i] = K_DOOR;
    for (const i of s.nooks) g[i] = K_NOOK;
    const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= side || y >= side ? K_NONE : g[y * side + x]);
    const owned = (k: number): boolean => k >= K_FLOOR;
    // wall pieces (8-connected)
    const seen = new Uint8Array(side * side);
    for (let s0 = 0; s0 < side * side; s0++) {
      if (g[s0] !== K_WALL || seen[s0]) continue;
      const stack = [s0];
      seen[s0] = 1;
      let size = 0;
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const x = i % side, y = (i - x) / side;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const j = ny * side + nx;
          if (g[j] === K_WALL && !seen[j]) { seen[j] = 1; stack.push(j); }
        }
      }
      if (size < minPiece) out.push(`${tag}: a wall piece of ${size} tiles (< ${minPiece}) at ${s0 % side},${(s0 - (s0 % side)) / side}`);
    }
    // doors: straight runs of 2-3 with a way through
    const doorSeen = new Uint8Array(side * side);
    for (let s0 = 0; s0 < side * side; s0++) {
      if (g[s0] !== K_DOOR || doorSeen[s0]) continue;
      const run = [s0];
      doorSeen[s0] = 1;
      for (let head = 0; head < run.length; head++) {
        const i = run[head];
        const x = i % side, y = (i - x) / side;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const j = ny * side + nx;
          if (g[j] === K_DOOR && !doorSeen[j]) { doorSeen[j] = 1; run.push(j); }
        }
      }
      const xs = new Set(run.map((i) => i % side)), ys = new Set(run.map((i) => (i - (i % side)) / side));
      const horizontal = ys.size === 1, vertical = xs.size === 1;
      if (run.length < 2 || run.length > 3 || (!horizontal && !vertical)) { out.push(`${tag}: a door of ${run.length} tiles (needs a straight run of 2-3)`); continue; }
      for (const i of run) {
        const x = i % side, y = (i - x) / side;
        const [ax, ay, bx, by] = horizontal ? [x, y - 1, x, y + 1] : [x - 1, y, x + 1, y];
        const ka = at(ax, ay), kb = at(bx, by);
        const through = (owned(ka) && ka !== K_DOOR && kb === K_NONE) || (owned(kb) && kb !== K_DOOR && ka === K_NONE);
        if (!through) { out.push(`${tag}: door tile ${x},${y} has no way through (inside on one side, outside on the other)`); break; }
      }
    }
    // owned floor connected
    let first = -1, total = 0;
    for (let i = 0; i < side * side; i++) if (owned(g[i])) { total++; if (first < 0) first = i; }
    if (first >= 0) {
      const reached = new Uint8Array(side * side);
      const stack = [first];
      reached[first] = 1;
      let n = 0;
      while (stack.length) {
        const i = stack.pop()!;
        n++;
        const x = i % side, y = (i - x) / side;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
          const j = ny * side + nx;
          if (owned(g[j]) && !reached[j]) { reached[j] = 1; stack.push(j); }
        }
      }
      if (n !== total) out.push(`${tag}: owned floor is in several pieces (${n} of ${total} tiles reached)`);
    }
    // nooks
    if (s.nooks.length < minNooks) out.push(`${tag}: ${s.nooks.length} crate nooks (needs ${minNooks})`);
    for (const i of s.nooks) {
      const x = i % side, y = (i - x) / side;
      const wallNear = at(x + 1, y) === K_WALL || at(x - 1, y) === K_WALL || at(x, y + 1) === K_WALL || at(x, y - 1) === K_WALL;
      let doorNear = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === K_DOOR) doorNear = true;
      if (!wallNear) out.push(`${tag}: nook ${x},${y} is not next to a wall`);
      if (doorNear) out.push(`${tag}: nook ${x},${y} is next to a door`);
    }
  }
  return out;
}
