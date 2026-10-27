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
}

const ORIENTED = new WeakMap<LandmarkTemplate, Oriented[]>();

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
    all.push({ bw: turned ? th : tw, bh: turned ? tw : th, dx, dy, code: Uint8Array.from(cs), count });
  }
  ORIENTED.set(t, all);
  return all;
}

function fillStamp(o: Oriented, x0: number, y0: number, w: number, out: Stamp): void {
  const [nw, nf, nd, nn, nl] = o.count;
  if (out.walls.length !== nw) out.walls.length = nw;
  if (out.floor.length !== nf) out.floor.length = nf;
  if (out.doors.length !== nd) out.doors.length = nd;
  if (out.nooks.length !== nn) out.nooks.length = nn;
  if (out.lights.length !== nl) out.lights.length = nl;
  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (let k = 0; k < o.code.length; k++) {
    const i = (y0 + o.dy[k]) * w + x0 + o.dx[k];
    const code = o.code[k];
    if (code === C_WALL) out.walls[a++] = i;
    else if (code === C_FLOOR) out.floor[b++] = i;
    else if (code === C_DOOR) out.doors[c++] = i;
    else if (code === C_NOOK) out.nooks[d++] = i;
    else out.lights[e++] = i;
  }
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
 * Candidate origins of the zone (every 2nd tile of the zone's box from its top-left, all 8 orientations) that pass stampFits,
 * scored by `score` (higher first; ties lower origin index, then orientation), tried until one stands or `tries` (12) run out.
 * `score` gets a scratch stamp (reused: do not keep it), the quarter turns and the mirror. Null when nothing fits or stands.
 */
export function bestLandmark(c: LandmarkCtx, t: LandmarkTemplate, score: (s: Stamp, rot: number, mirror: boolean) => number, tries: number = LANDMARK_TRIES): PlacedFeature | null {
  const orient = orientationsOf(t);
  const { w, h, mask, tiles, hard } = c;
  const zb = c.zone.bbox;
  const features = c.zoneFeatures();
  // The static rules once per zone tile (nothing is written while candidates are scored): walls need open ground, the rest zone floor.
  const bw = zb.w, bh = zb.h;
  const okWall = new Uint8Array(bw * bh), okFloor = new Uint8Array(bw * bh);
  const bad = new Int32Array((bw + 1) * (bh + 1)); // summed-area table of the tiles that are neither
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const i = (zb.y + y) * w + zb.x + x;
      const k = y * bw + x;
      // open(i) implies the floor rule (zone FLOOR, unprotected, unowned), so it is asked only where that holds
      const free = mask[i] === 1 && tiles[i] === TILE_FLOOR && hard[i] === 0 && !c.isOwned(i);
      okFloor[k] = free ? 1 : 0;
      okWall[k] = free && c.open(i) ? 1 : 0;
      bad[(y + 1) * (bw + 1) + x + 1] = bad[y * (bw + 1) + x + 1] + bad[(y + 1) * (bw + 1) + x] - bad[y * (bw + 1) + x] + (free ? 0 : 1);
    }
  }
  const scratch: Stamp = { walls: [], floor: [], doors: [], nooks: [], lights: [], bbox: { x: 0, y: 0, w: 0, h: 0 } };
  const cand: Array<{ score: number; origin: number; o: number }> = [];
  for (let y0 = zb.y; y0 < zb.y + zb.h; y0 += 2) {
    for (let x0 = zb.x; x0 < zb.x + zb.w; x0 += 2) {
      for (let o = 0; o < 8; o++) {
        const ori = orient[o];
        // a template with no '_' cell needs its whole box inside the zone's box and free of tiles that fit nothing: one table lookup
        if (ori.code.length === ori.bw * ori.bh) {
          const rx = x0 - zb.x, ry = y0 - zb.y;
          if (rx + ori.bw > bw || ry + ori.bh > bh) continue;
          const A = (ry + ori.bh) * (bw + 1) + rx + ori.bw, B = ry * (bw + 1) + rx + ori.bw, C = (ry + ori.bh) * (bw + 1) + rx, D = ry * (bw + 1) + rx;
          if (bad[A] - bad[B] - bad[C] + bad[D] !== 0) continue;
        }
        let fits = true;
        for (let k = 0; k < ori.code.length && fits; k++) {
          const rx = x0 + ori.dx[k] - zb.x, ry = y0 + ori.dy[k] - zb.y;
          if (rx < 0 || ry < 0 || rx >= bw || ry >= bh) { fits = false; break; }
          fits = (ori.code[k] === C_WALL ? okWall[ry * bw + rx] : okFloor[ry * bw + rx]) === 1;
        }
        if (!fits || !gapOk(features, x0, y0, ori.bw, ori.bh)) continue;
        fillStamp(ori, x0, y0, w, scratch);
        const sc = score(scratch, o & 3, o >= 4);
        cand.push({ score: sc === sc ? sc : -Infinity, origin: y0 * w + x0, o });
      }
    }
  }
  cand.sort((a, b) => (a.score > b.score ? -1 : a.score < b.score ? 1 : a.origin !== b.origin ? a.origin - b.origin : a.o - b.o));
  for (let k = 0; k < cand.length && k < tries; k++) {
    const { origin, o } = cand[k];
    const x0 = origin % w, y0 = (origin - x0) / w;
    const s = stampTemplate(t, x0, y0, (o & 3) as 0 | 1 | 2 | 3, o >= 4, w, h);
    if (!s) continue;
    const placed = placeLandmark(c, t, s, o & 3, o >= 4);
    if (placed) return placed;
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
