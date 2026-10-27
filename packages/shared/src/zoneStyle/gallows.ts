// Gallows (sentenced): a ruined prison and courthouse. One orthogonal cell block with corridor and cell doors, two fenced
// yards with at least two openings, a gallows plaza and a free fence line in a street. Fences stop bodies (and, by
// MASK_MELEE, melee swings) but not shots or sight: Sentenced's bow shoots across, melee walks round. The generator's own
// ruins are the courthouse and extra cell houses (the client draws them so). Part D 4.2's parameters, scaled to the zone.
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../map";
import { TERRAIN_FENCE } from "../terrain";
import { randInt } from "../rng";
import { breakLowRuns, chance, openTiles, pickFrom, placeRing, ringTiles, roomOf, shuffle, wall, low, sideDoors } from "./kit";
import type { Rect } from "./kit";
import { PROP } from "./propKinds";
import { sizeScale } from "./scale";
import type { PropCtx, ShapeCtx, ZoneStyler } from "./types";

export interface YardPlan {
  rect: Rect;
  /** Indices of the door-window tiles (the openings by construction), all FLOOR when the yard was placed. */
  doorTiles: number[];
  post: number;
}

export interface GallowsPlan {
  blocks: Rect[];
  yards: YardPlan[];
  plazas: Rect[];
  /** Tile indices of the free fence line (empty when none fitted). */
  fenceLine: number[];
  posts: number[];
}

const apart = (a: Rect, b: Rect, m: number): boolean => a.x + a.w + m <= b.x || b.x + b.w + m <= a.x || a.y + a.h + m <= b.y || b.y + b.h + m <= a.y;

/**
 * Rectangles by rejection sampling with `gap` tiles of street between any two: of `tries` random candidates that lie in the
 * zone (>= 85%) with at most half of it protected, each wanted rectangle is the one whose perimeter and interior offer the most
 * open tiles (a finished map leaves little free ground, so the first fit is not the best), and it must offer at least
 * `minOpen` of them. Robust on organic masks; BSP leaves failed the fit tests.
 */
function packRects(c: ShapeCtx, taken: readonly Rect[], want: number, lo: number, hi: number, gap: number, minOpen: number, maxHard = 0.5): Rect[] {
  const bb = c.zone.bbox;
  const { w } = c;
  // summed-area tables of zone, protected and open tiles: a rectangle's counts in O(1)
  const sat = (f: (i: number) => number): Int32Array => {
    const t = new Int32Array((c.w + 1) * (c.h + 1));
    for (let y = 0; y < c.h; y++) for (let x = 0; x < w; x++) t[(y + 1) * (w + 1) + x + 1] = f(y * w + x) + t[y * (w + 1) + x + 1] + t[(y + 1) * (w + 1) + x] - t[y * (w + 1) + x];
    return t;
  };
  const inMaskT = sat((i) => c.mask[i]), hardT = sat((i) => c.hard[i]), openT = sat((i) => (c.open(i) ? 1 : 0));
  const sum = (t: Int32Array, r: Rect): number => t[(r.y + r.h) * (w + 1) + r.x + r.w] - t[r.y * (w + 1) + r.x + r.w] - t[(r.y + r.h) * (w + 1) + r.x] + t[r.y * (w + 1) + r.x];
  const out: Rect[] = [];
  for (let k = 0; k < want; k++) {
    let best: Rect | null = null, bestScore = -1;
    for (let t = 0; t < 300; t++) {
      const rw = randInt(c.rng, lo, hi + 1), rh = randInt(c.rng, lo, hi + 1);
      const rect: Rect = { x: randInt(c.rng, bb.x, Math.max(bb.x + 1, bb.x + bb.w - rw)), y: randInt(c.rng, bb.y, Math.max(bb.y + 1, bb.y + bb.h - rh)), w: rw, h: rh };
      if (rect.x + rw > c.w || rect.y + rh > c.h) continue;
      if (taken.some((o) => !apart(o, rect, gap)) || out.some((o) => !apart(o, rect, gap))) continue;
      const open = sum(openT, rect);
      if (sum(inMaskT, rect) / (rw * rh) < 0.85 || sum(hardT, rect) > maxHard * rw * rh || open < minOpen) continue;
      if (open > bestScore) { bestScore = open; best = rect; }
    }
    if (best) out.push(best);
  }
  return out;
}

function cellBlock(c: ShapeCtx, r: Rect): void {
  const { x, y, w, h } = r;
  const wl = (cx: number, cy: number): boolean => wall(c, cx, cy);
  const sides = chance(c.rng, 0.5) ? [0, 2] : [1, 3];
  placeRing(ringTiles(x, y, w, h), sideDoors(c.rng, w, h, sides, 2), 2, wl);
  // two corridor "front" walls with a 1-tile cell door every 4 tiles, and partitions from the perimeter to the fronts
  const fy0 = y + 4, fy1 = y + h - 5;
  for (const fy of fy0 === fy1 ? [fy0] : [fy0, fy1]) for (let cx = x + 1; cx < x + w - 1; cx++) if ((cx - x) % 4 !== 2) wl(cx, fy);
  for (let cx = x + 4; cx < x + w - 3; cx += 4) {
    for (let cy = y + 1; cy < fy0; cy++) wl(cx, cy);
    for (let cy = y + h - 2; cy > fy1; cy--) wl(cx, cy);
  }
}

/** Is tile (x, y) a floor tile of the zone the yard's doors may use? */
function doorOk(c: ShapeCtx, x: number, y: number): boolean {
  const i = c.at(x, y);
  return i >= 0 && c.mask[i] === 1 && c.tiles[i] === TILE_FLOOR;
}

/** Outward unit step of each side of a ring: 0 top, 1 right, 2 bottom, 3 left. */
const OUT: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * A fenced yard: the ring of FENCE with 2 or 3 two-tile openings on distinct sides. The openings are chosen first, on tiles
 * that are floor now with floor on both sides of them (a door that opens onto a rock is no door), and reserved with those
 * neighbours, so nothing later closes them; the guard keeps at least one opening whatever else lands. Returns null (nothing
 * written) when fewer than two sides can take a door.
 */
function yard(c: ShapeCtx, r: Rect): YardPlan | null {
  const { x, y, w, h } = r;
  const ring = ringTiles(x, y, w, h);
  const want = 2 + (chance(c.rng, 0.4) ? 1 : 0);
  const doors: number[] = [];
  const doorTiles: number[] = [];
  const keep: number[] = [];
  for (const side of shuffle(c.rng, [0, 1, 2, 3])) {
    if (doors.length >= want) break;
    const [ox, oy] = OUT[side];
    for (let attempt = 0; attempt < 12; attempt++) {
      const pos = sideDoors(c.rng, w, h, [side], 2)[0];
      const a = ring[pos % ring.length], b = ring[(pos + 1) % ring.length];
      const around: Array<[number, number]> = [[a[0], a[1]], [b[0], b[1]], [a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [a[0] - ox, a[1] - oy], [b[0] - ox, b[1] - oy]];
      if (!around.every(([tx, ty]) => doorOk(c, tx, ty))) continue;
      doors.push(pos);
      doorTiles.push(c.at(a[0], a[1]), c.at(b[0], b[1]));
      for (const [tx, ty] of around) keep.push(c.at(tx, ty));
      break;
    }
  }
  if (doors.length < 2) return null;
  for (const t of keep) c.reserve(t);
  const fenced = placeRing(ring, doors, 2, (cx, cy) => low(c, cx, cy, "fence"));
  // a ring the guard mostly refused is no yard (what it did place stays: fence segments)
  if (fenced < 0.3 * (ring.length - 2 * doors.length)) return null;
  let post = -1;
  if (chance(c.rng, 0.55)) { const gx = x + (w >> 1), gy = y + (h >> 1); if (wall(c, gx, gy)) post = c.at(gx, gy); }
  return { rect: r, doorTiles, post };
}

function shape(c: ShapeCtx): GallowsPlan {
  const r = c.rng;
  const sc = sizeScale(c.zone.painted);
  const blo = Math.max(9, Math.floor(12 * sc)), bhi = Math.max(blo + 1, Math.floor(14 * sc));
  const ylo = Math.max(7, Math.floor(8 * sc)), yhi = Math.max(ylo + 1, Math.floor(10 * sc));
  const plo = Math.max(5, Math.floor(6 * sc)), phi = Math.max(plo + 1, Math.floor(8 * sc));
  const plan: GallowsPlan = { blocks: [], yards: [], plazas: [], fenceLine: [], posts: [] };
  const blocks = packRects(c, [], 1, blo, bhi, 3, 12);
  const yards = packRects(c, blocks, roomOf(c) > 0.4 ? 2 : 3, ylo, yhi, roomOf(c) > 0.4 ? 3 : 2, 6);
  const plazas = packRects(c, [...blocks, ...yards], 1, plo, phi, 3, 3);
  for (const b of blocks) { cellBlock(c, b); plan.blocks.push(b); }
  for (const yd of yards) { const p = yard(c, yd); if (p) plan.yards.push(p); }
  for (const p of plazas) {
    const gx = p.x + (p.w >> 1), gy = p.y + (p.h >> 1);
    plan.plazas.push(p);
    if (wall(c, gx, gy)) plan.posts.push(c.at(gx, gy));
  }
  // a free fence line in a street, with two 2-tile gaps: the straight line (of 40 sampled) that crosses the most open ground
  {
    const len = randInt(r, Math.max(7, Math.floor(9 * sc)), Math.max(9, Math.floor(12 * sc)));
    const gaps = [Math.floor(len * (0.3 + r() * 0.15)), Math.floor(len * (0.7 + r() * 0.1))];
    let best: { x: number; y: number; horizontal: boolean } | null = null, bestScore = 0;
    const openList = openTiles(c);
    for (let t = 0; t < 40; t++) {
      const s = pickFrom(c, openList);
      if (!s) break;
      const horizontal = chance(r, 0.5);
      let score = 0;
      for (let k = 0; k < len; k++) {
        if (gaps.some((g) => k >= g && k < g + 2)) continue;
        if (c.open(horizontal ? c.at(s[0] + k, s[1]) : c.at(s[0], s[1] + k))) score++;
      }
      if (score > bestScore) { bestScore = score; best = { x: s[0], y: s[1], horizontal }; }
    }
    if (best) {
      for (let k = 0; k < len; k++) {
        if (gaps.some((g) => k >= g && k < g + 2)) { const gi = best.horizontal ? c.at(best.x + k, best.y) : c.at(best.x, best.y + k); if (gi >= 0) c.reserve(gi); }
      }
      for (let k = 0; k < len; k++) {
        if (gaps.some((g) => k >= g && k < g + 2)) continue;
        const fx = best.horizontal ? best.x + k : best.x, fy = best.horizontal ? best.y : best.y + k;
        if (low(c, fx, fy, "fence")) plan.fenceLine.push(c.at(fx, fy));
      }
    }
  }
  breakLowRuns(c, 12);
  relaxFences(c);
  return plan;
}

/**
 * Later fences can close the way round an earlier one, so each fence tile was only checked when it went down. Looks at the
 * finished fences once more and gives back every tile that now forces a pair of floor tiles across it (up to 6 apart, along
 * its row or column) more than the cap of extra steps; three rounds, in index order. Tiles of the plan that go lose nothing
 * else: a yard keeps its doors (reserved) and the ring stays a ring with longer openings.
 */
function relaxFences(c: ShapeCtx): void {
  for (let round = 0; round < 3; round++) {
    let released = 0;
    for (let i = 0; i < c.w * c.h; i++) {
      if (c.tiles[i] === TILE_LOW && c.terrain[i] === TERRAIN_FENCE && !c.fenceDetourOk(i) && c.release(i)) released++;
    }
    if (released === 0) break;
  }
}

function props(c: PropCtx, plan: GallowsPlan): void {
  const n = c.w * c.h;
  const inBlock = new Uint8Array(n);
  for (const b of plan.blocks) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) inBlock[y * c.w + x] = 1;
  const doorSet = new Uint8Array(n);
  for (const yd of plan.yards) for (const t of yd.doorTiles) doorSet[t] = 1;
  const postSet = new Set<number>([...plan.posts, ...plan.yards.map((yd) => yd.post)]);
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 3);
    const t = c.tiles[i];
    if (t === TILE_WALL) {
      if (postSet.has(i)) c.prop(PROP.gallows, x, y, v);
      else if (inBlock[i] && c.noise.hash(x, y, 1) < 0.1) c.prop(PROP.cell_bars, x, y, v);
      else if (c.tiles[i + c.w] === TILE_FLOOR && c.noise.hash(x, y, 2) < 0.1) c.prop(PROP.banner, x, y, v);
    } else if (t === TILE_LOW) {
      if (c.noise.hash(x, y, 3) < 0.08) c.prop(PROP.chain, x, y, v);
    } else if (t === TILE_FLOOR && doorSet[i] && c.noise.hash(x, y, 4) < 0.5) {
      c.prop(PROP.lantern, x, y, v);
    }
  }
}

export const gallows: ZoneStyler<GallowsPlan> = { id: "gallows", faction: "sentenced", version: 1, shape, props };
