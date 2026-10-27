// The styler toolkit: stateless noise, tile geometry, distance fields and the shapes the recipes are built from. Nothing here
// draws the generator's random stream or touches Math beyond + - * / sqrt floor ceil abs min max and Math.imul, so a
// styled map is byte-identical on every engine. Size-free: w and h always come from the caller.
import { TILE_FLOOR, TILE_LOW } from "../map";
import { randInt, shuffle } from "../rng";
import type { Rng } from "../rng";
import type { BaseCtx, NoiseKit, ShapeCtx } from "./types";

export { shuffle };

/** The 8 king directions, orthogonal ones at even indices. */
export const DIR8: ReadonlyArray<readonly [number, number]> = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const DIR4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const chance = (r: Rng, p: number): boolean => r() < p;

// ------------------------------------------------------------------------------------------------ noise
/** Stateless integer hash of a lattice point and a salt, in [0, 1). */
export function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bilinear value noise on a lattice of `cell` tiles with a 3t^2 - 2t^3 fade. */
export function vnoise(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell, fy = y / cell;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, salt), b = hash2(x0 + 1, y0, salt), c = hash2(x0, y0 + 1, salt), d = hash2(x0 + 1, y0 + 1, salt);
  const top = a + (b - a) * sx, bot = c + (d - c) * sx;
  return top + (bot - top) * sy;
}

/** The noise of one pass of one zone: every call is mixed with the pass's stream seed. */
export function makeNoise(streamSeed: number): NoiseKit {
  const mix = (salt: number): number => (salt + streamSeed) | 0;
  return {
    hash: (x, y, salt) => hash2(x, y, mix(salt)),
    value: (x, y, cell, salt) => vnoise(x, y, cell, mix(salt)),
    fbm: (x, y, cell, octaves, salt) => {
      let sum = 0, weight = 0, amp = 1, c = cell;
      for (let o = 0; o < octaves; o++) {
        sum += amp * vnoise(x, y, c, mix(salt + o * 131));
        weight += amp;
        amp *= 0.5;
        c = c * 0.5 < 1 ? 1 : c * 0.5;
      }
      return sum / weight;
    },
  };
}

// ------------------------------------------------------------------------------------------------ tile geometry
/** Tiles of the segment (x0,y0)-(x1,y1) in order, one per step of the longer axis. */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out: Array<[number, number]> = [];
  for (let s = 0; s <= n; s++) out.push([Math.floor(x0 + ((x1 - x0) * s) / (n || 1) + 0.5), Math.floor(y0 + ((y1 - y0) * s) / (n || 1) + 0.5)]);
  return out;
}

/** The perimeter of a rectangle in order, clockwise from the top-left corner. */
export function ringTiles(x0: number, y0: number, w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = x0; x < x0 + w; x++) out.push([x, y0]);
  for (let y = y0 + 1; y < y0 + h; y++) out.push([x0 + w - 1, y]);
  for (let x = x0 + w - 2; x >= x0; x--) out.push([x, y0 + h - 1]);
  for (let y = y0 + h - 2; y > y0; y--) out.push([x0, y]);
  return out;
}

/**
 * Puts a ring tile by tile in ring order, starting just after the first door and skipping the door windows (`doorLen` tiles
 * from each door position). Placed in path order, each new tile has its predecessor solid and its successor floor, so the
 * tile that would close a loop is the one the guard refuses: every ring ends up with at least the doors it was given.
 * Returns how many tiles `put` accepted.
 */
export function placeRing(ring: ReadonlyArray<readonly [number, number]>, doors: readonly number[], doorLen: number, put: (x: number, y: number) => boolean): number {
  const isDoor = new Uint8Array(ring.length);
  for (const d of doors) for (let k = 0; k < doorLen; k++) isDoor[(d + k) % ring.length] = 1;
  const first = doors.length ? (doors[0] + doorLen) % ring.length : 0;
  let n = 0;
  for (let s = 0; s < ring.length; s++) {
    const j = (first + s) % ring.length;
    if (isDoor[j]) continue;
    if (put(ring[j][0], ring[j][1])) n++;
  }
  return n;
}

/** Door positions on a w x h ring: one per listed side (0 top, 1 right, 2 bottom, 3 left), at a random offset away from the corners. */
export function sideDoors(rng: Rng, w: number, h: number, sides: readonly number[], doorLen: number): number[] {
  const starts = [0, w - 1, w - 1 + h - 1, 2 * (w - 1) + h - 1];
  const lens = [w - 1, h - 1, w - 1, h - 1];
  return sides.map((s) => starts[s] + randInt(rng, 2, Math.max(3, lens[s] - doorLen - 1)));
}

// ------------------------------------------------------------------------------------------------ distance fields
/** 3-4 chamfer distance, in thirds of a tile, from every mask tile to the nearest non-mask tile (0 off the mask). */
export function chamfer(mask: Uint8Array, w: number, h: number): Int32Array {
  const n = w * h;
  const d = new Int32Array(n);
  const BIG = 1 << 20;
  for (let i = 0; i < n; i++) d[i] = mask[i] ? BIG : 0;
  // the grid's edge is outside too: a mask tile on it is one step from outside
  for (let x = 0; x < w; x++) { if (d[x]) d[x] = 3; if (d[(h - 1) * w + x]) d[(h - 1) * w + x] = 3; }
  for (let y = 0; y < h; y++) { if (d[y * w]) d[y * w] = 3; if (d[y * w + w - 1]) d[y * w + w - 1] = 3; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) v = Math.min(v, d[i - w] + 3);
      if (x > 0 && y > 0) v = Math.min(v, d[i - w - 1] + 4);
      if (x < w - 1 && y > 0) v = Math.min(v, d[i - w + 1] + 4);
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) v = Math.min(v, d[i + w] + 3);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[i + w + 1] + 4);
      if (x > 0 && y < h - 1) v = Math.min(v, d[i + w - 1] + 4);
      d[i] = v;
    }
  }
  return d;
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * The largest-area axis-aligned rectangle of 1s in `free` with both sides >= minSide (maximal-rectangle histogram scan);
 * ties go to the first found in row-major order. Null when none exists.
 */
export function largestFreeRect(free: Uint8Array, w: number, h: number, minSide: number): Rect | null {
  const hgt = new Int32Array(w);
  let best: Rect | null = null, bestA = 0;
  const st: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hgt[x] = free[y * w + x] ? hgt[x] + 1 : 0;
    st.length = 0;
    for (let x = 0; x <= w; x++) {
      const cur = x < w ? hgt[x] : 0;
      while (st.length && hgt[st[st.length - 1]] >= cur) {
        const hh = hgt[st.pop()!];
        const left = st.length ? st[st.length - 1] + 1 : 0;
        const wd = x - left;
        if (wd >= minSide && hh >= minSide && hh * wd > bestA) { bestA = hh * wd; best = { x: left, y: y - hh + 1, w: wd, h: hh }; }
      }
      st.push(x);
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ flow path
/** A binary min-heap on (cost, node), ties on the node index, so equal costs pop in index order. */
class Heap {
  private cost: number[] = [];
  private node: number[] = [];
  get size(): number { return this.cost.length; }
  push(c: number, n: number): void {
    let i = this.cost.length;
    this.cost.push(c);
    this.node.push(n);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cost[p] < c || (this.cost[p] === c && this.node[p] <= n)) break;
      this.cost[i] = this.cost[p];
      this.node[i] = this.node[p];
      i = p;
    }
    this.cost[i] = c;
    this.node[i] = n;
  }
  /** Pops into out[0] = cost, out[1] = node. */
  pop(out: number[]): void {
    out[0] = this.cost[0];
    out[1] = this.node[0];
    const lc = this.cost.pop()!, ln = this.node.pop()!;
    const n = this.cost.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let m = 2 * i + 1;
        if (m >= n) break;
        if (m + 1 < n && (this.cost[m + 1] < this.cost[m] || (this.cost[m + 1] === this.cost[m] && this.node[m + 1] < this.node[m]))) m++;
        if (lc < this.cost[m] || (lc === this.cost[m] && ln <= this.node[m])) break;
        this.cost[i] = this.cost[m];
        this.node[i] = this.node[m];
        i = m;
      }
      this.cost[i] = lc;
      this.node[i] = ln;
    }
  }
}

const hardNearCache = new WeakMap<object, Uint8Array>();
/** 1 within 3 tiles of a protected tile of the zone; computed once per context. */
function hardNearOf(c: BaseCtx): Uint8Array {
  let out = hardNearCache.get(c);
  if (out) return out;
  const { w, h, mask, hard } = c;
  const n = w * h;
  out = new Uint8Array(n);
  const { bbox } = c.zone;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const i = y * w + x;
      if (!hard[i] || !mask[i]) continue;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) out[(y + dy) * w + x + dx] = 1;
    }
  }
  hardNearCache.set(c, out);
  return out;
}

/**
 * Cheapest 8-neighbour path from tile a to tile b over this zone's FLOOR; cost = step (10 / 14) + a wobble of 0..29 from
 * noise + 150 within 3 tiles of a protected tile + `penalty(tile)` when given. Ties pop in index order. Empty when b is unreachable.
 */
export function flowPath(c: BaseCtx, a: number, b: number, salt: number, penalty?: (j: number) => number): number[] {
  const { w, h, mask, tiles } = c;
  const n = w * h;
  const dist = new Int32Array(n).fill(1 << 30), from = new Int32Array(n).fill(-1);
  const hardNear = hardNearOf(c);
  const heap = new Heap();
  const top = [0, 0];
  dist[a] = 0;
  heap.push(0, a);
  while (heap.size) {
    heap.pop(top);
    const d = top[0], i = top[1];
    if (d > dist[i]) continue;
    if (i === b) break;
    const x = i % w, y = (i - x) / w;
    for (let q = 0; q < 8; q++) {
      const nx = x + DIR8[q][0], ny = y + DIR8[q][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!mask[j] || tiles[j] !== TILE_FLOOR) continue;
      const step = (q & 1 ? 14 : 10) + Math.floor(c.noise.value(nx, ny, 7, salt) * 30) + (hardNear[j] ? 150 : 0) + (penalty ? penalty(j) : 0);
      const nd = d + step;
      if (nd < dist[j]) { dist[j] = nd; from[j] = i; heap.push(nd, j); }
    }
  }
  const path: number[] = [];
  if (from[b] < 0 && a !== b) return path;
  for (let i = b; i >= 0; i = from[i]) { path.push(i); if (i === a) break; }
  return path.reverse();
}

// ------------------------------------------------------------------------------------------------ guarded writes
/** FLOOR (or LOW) to WALL on tile (x, y) through the guard; false = refused or off the grid. */
export function wall(c: ShapeCtx, x: number, y: number): boolean {
  const i = c.at(x, y);
  return i >= 0 && c.block(i, "wall");
}

/** FLOOR to a LOW feature of `kind` on tile (x, y) through the guard. */
export function low(c: ShapeCtx, x: number, y: number, kind: "lava" | "fence" | "crevasse"): boolean {
  const i = c.at(x, y);
  return i >= 0 && c.block(i, kind);
}

/** Is any protected tile within Chebyshev distance r of (x, y)? */
export function nearHard(c: BaseCtx, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const i = c.at(x + dx, y + dy);
      if (i >= 0 && c.hard[i]) return true;
    }
  }
  return false;
}

/**
 * A random tile of the zone that is not protected and passes `ok`, drawn from the zone's bounding box; null after `tries`.
 */
export function pickTile(c: BaseCtx, tries = 60, ok: (x: number, y: number) => boolean = () => true): [number, number] | null {
  const { bbox } = c.zone;
  for (let t = 0; t < tries; t++) {
    const x = bbox.x + randInt(c.rng, 0, bbox.w), y = bbox.y + randInt(c.rng, 0, bbox.h);
    const i = y * c.w + x;
    if (c.mask[i] && !c.hard[i] && ok(x, y)) return [x, y];
  }
  return null;
}

/** Every tile a blocker could land on right now (ShapeCtx.open), in index order. Writes make it stale. */
export function openTiles(c: ShapeCtx): number[] {
  const { bbox } = c.zone;
  const out: number[] = [];
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) for (let x = bbox.x; x < bbox.x + bbox.w; x++) if (c.open(y * c.w + x)) out.push(y * c.w + x);
  return out;
}

/** A random tile of `list` (see openTiles) as [x, y]; null when empty. One rng draw. */
export function pickFrom(c: ShapeCtx, list: readonly number[]): [number, number] | null {
  if (list.length === 0) return null;
  const i = list[randInt(c.rng, 0, list.length)];
  return [i % c.w, (i - (i % c.w)) / c.w];
}

/** A random tile a blocker could land on (ShapeCtx.open) that passes `ok`, drawn from the zone's bounding box; null when there is none. One rng draw. */
export function pickOpen(c: ShapeCtx, ok: (x: number, y: number) => boolean = () => true): [number, number] | null {
  const { bbox } = c.zone;
  const cand: number[] = [];
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) {
    for (let x = bbox.x; x < bbox.x + bbox.w; x++) {
      const i = y * c.w + x;
      if (c.open(i) && ok(x, y)) cand.push(i);
    }
  }
  if (cand.length === 0) return null;
  const i = cand[randInt(c.rng, 0, cand.length)];
  return [i % c.w, (i - (i % c.w)) / c.w];
}

/**
 * How much of the zone a blocker could land on: open tiles over painted tiles. About 0.7 on open ground (the recipes' habitat,
 * a zone before cover) and about 0.13 on the ground the generator hands the stylers (the protect list, then the spawn pool's 3x3s). The recipes size their footprints
 * as a share of the ZONE, so they ask for the same amount of wall wherever and take what the ground allows.
 */
export function roomOf(c: ShapeCtx): number {
  const { bbox, painted } = c.zone;
  let open = 0;
  for (let y = bbox.y; y < bbox.y + bbox.h; y++) for (let x = bbox.x; x < bbox.x + bbox.w; x++) if (c.open(y * c.w + x)) open++;
  return painted === 0 ? 0 : open / painted;
}

/**
 * The heading closest to h (then h+1, h-1, h+2, h-2) whose next tile from (x, y) is open, or -1. The side tried first is the
 * sign of `bias`. Lets a ridge or a crevasse follow the strips of ground a finished map leaves free.
 */
export function steer(c: ShapeCtx, x: number, y: number, h: number, bias: boolean): number {
  const order = bias ? [0, 1, -1, 2, -2] : [0, -1, 1, -2, 2];
  for (const d of order) {
    const hh = (h + d + 8) & 7;
    const i = c.at(x + DIR8[hh][0], y + DIR8[hh][1]);
    if (i >= 0 && c.open(i)) return hh;
  }
  return -1;
}

/**
 * Breaks every straight (axis-aligned) run of LOW tiles longer than `max` by turning one tile every `max` into a WALL (the
 * LOW kind stays: a pillar in the river, a post in the fence). A straight LOW run is a sight lane the cover pass could not
 * be sure to cut, and it is a long walk-around. Returns the walls placed.
 */
export function breakLowRuns(c: ShapeCtx, max = 12): number {
  const { w, h, tiles } = c;
  let n = 0;
  for (const vertical of [false, true]) {
    const A = vertical ? w : h, B = vertical ? h : w;
    for (let a = 0; a < A; a++) {
      let start = -1;
      for (let b = 0; b <= B; b++) {
        const i = b < B ? (vertical ? b * w + a : a * w + b) : -1;
        if (i >= 0 && tiles[i] === TILE_LOW) {
          if (start < 0) start = b;
          continue;
        }
        if (start >= 0 && b - start > max) {
          // a wall every `max` tiles along the run, pushed one tile to either side where the guard refuses the spot
          for (let p = start + max - 1; p < b; p += max) {
            for (const q of [p, p - 1, p + 1]) {
              if (q < start || q >= b) continue;
              const k = vertical ? q * w + a : a * w + q;
              if (tiles[k] === TILE_LOW && c.block(k, "wall")) { n++; break; }
            }
          }
        }
        start = -1;
      }
    }
  }
  return n;
}

/** Longest straight (axis-aligned) run of tiles equal to `code` in the grid. */
export function longestRunOf(tiles: Uint8Array, w: number, h: number, code: number): number {
  let best = 0;
  for (let y = 0; y < h; y++) {
    let len = 0;
    for (let x = 0; x < w; x++) { if (tiles[y * w + x] === code) { len++; if (len > best) best = len; } else len = 0; }
  }
  for (let x = 0; x < w; x++) {
    let len = 0;
    for (let y = 0; y < h; y++) { if (tiles[y * w + x] === code) { len++; if (len > best) best = len; } else len = 0; }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ safety net
/** 4-connected FLOOR components: ids 0.. by first tile in row-major order, -1 off floor; also the sizes. */
export function floorComponents(tiles: Uint8Array, w: number, h: number): { comp: Int32Array; sizes: number[] } {
  const n = w * h;
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const q = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (tiles[s] !== TILE_FLOOR || comp[s] >= 0) continue;
    let head = 0, tail = 0;
    q[tail++] = s;
    comp[s] = sizes.length;
    while (head < tail) {
      const i = q[head++];
      const x = i % w;
      if (x > 0 && tiles[i - 1] === TILE_FLOOR && comp[i - 1] < 0) { comp[i - 1] = sizes.length; q[tail++] = i - 1; }
      if (x < w - 1 && tiles[i + 1] === TILE_FLOOR && comp[i + 1] < 0) { comp[i + 1] = sizes.length; q[tail++] = i + 1; }
      if (i >= w && tiles[i - w] === TILE_FLOOR && comp[i - w] < 0) { comp[i - w] = sizes.length; q[tail++] = i - w; }
      if (i < n - w && tiles[i + w] === TILE_FLOOR && comp[i + w] < 0) { comp[i + w] = sizes.length; q[tail++] = i + w; }
    }
    sizes.push(tail);
  }
  return { comp, sizes };
}

/**
 * Safety net for a styler that wrote around the guard: joins every FLOOR component that is not the biggest to it by giving
 * back the cheapest chain of tiles THIS pass wrote (`wrote[i] = 1`; they go back to FLOOR with no terrain). Never opens a
 * tile it did not write. Returns the tiles given back; components it cannot reach through its own writes stay as they are.
 */
export function repairConnectivity(tiles: Uint8Array, terrain: Uint8Array, wrote: Uint8Array, w: number, h: number): number {
  const n = w * h;
  const { comp, sizes } = floorComponents(tiles, w, h);
  if (sizes.length <= 1) return 0;
  let main = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
  const q = new Int32Array(n);
  let carved = 0;
  for (let k = 0; k < sizes.length; k++) {
    if (k === main) continue;
    const prev = new Int32Array(n).fill(-2);
    let head = 0, tail = 0, hit = -1;
    for (let i = 0; i < n; i++) if (comp[i] === k) { q[tail++] = i; prev[i] = -1; }
    while (head < tail && hit < 0) {
      const i = q[head++];
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (prev[j] !== -2) continue;
        if (tiles[j] === TILE_FLOOR) {
          if (comp[j] === k) continue;
          prev[j] = i;
          hit = j;
          break;
        }
        if (!wrote[j]) continue;
        prev[j] = i;
        q[tail++] = j;
      }
    }
    if (hit < 0) continue;
    for (let i = prev[hit]; i >= 0 && comp[i] !== k; i = prev[i]) {
      if (tiles[i] !== TILE_FLOOR) { tiles[i] = TILE_FLOOR; terrain[i] = 0; wrote[i] = 0; carved++; }
      comp[i] = main;
    }
    for (let i = 0; i < n; i++) if (comp[i] === k) comp[i] = main;
  }
  return carved;
}
