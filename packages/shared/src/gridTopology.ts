// Grid topology shared by the generator and the zone stylers. Everything here is size-free: no module-level W/H/N, the map
// size always comes from the caller. Integer and + - * / only, so client and server agree to the bit.
import { MASK_SIGHT, TILE_FLOOR } from "./map";

/**
 * The 3x3 neighbourhood of a tile as a cycle of 8 cells (N, NE, E, SE, S, SW, W, NW): bit q of a mask is set when ring
 * cell q is floor. SIMPLE[mask] says whether turning the centre into solid keeps its 4-connected floor neighbours linked
 * through the ring, i.e. whether no corridor is cut and no pocket is sealed. (mapgen.ts keeps an identical private copy.)
 */
export const SIMPLE: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let m = 0; m < 256; m++) {
    let comp = 0;
    for (let q = 0; q < 8; q += 2) {
      if ((m >> q) & 1) { comp = 1 << q; break; }
    }
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
    table[m] = ok ? 1 : 0;
  }
  return table;
})();

/** Ring cell q is at (RING_DX[q], RING_DY[q]) from the centre: N, NE, E, SE, S, SW, W, NW. */
export const RING_DX: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
export const RING_DY: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Index offsets of the 8 ring cells in a row-major grid `w` wide (for tiles with all 8 neighbours inside the grid). */
export function ringOffsets(w: number): number[] {
  return RING_DX.map((dx, q) => RING_DY[q] * w + dx);
}

/** Index offsets of the 4 orthogonal neighbours (N, E, S, W) in a grid `w` wide. */
export function nb4Offsets(w: number): number[] {
  return [-w, 1, w, -1];
}

/**
 * Walking distance from tile `from` to every floor tile over the 8-connected grid, without cutting corners, in fifths of a
 * tile (a diagonal step costs 7, about 5 * sqrt(2)); -1 where unreachable. Only TILE_FLOOR is walkable.
 */
export function walkDistances(tiles: Uint8Array, w: number, h: number, from: number): Int32Array {
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  if (tiles[from] !== TILE_FLOOR) return dist;
  const best = new Int32Array(n).fill(1 << 30);
  const buckets: number[][] = [[], [], [], [], [], [], [], []];
  best[from] = 0;
  buckets[0].push(from);
  for (let d = 0, left = 1; left > 0; d++) {
    const bucket = buckets[d & 7];
    while (bucket.length > 0) {
      const i = bucket.pop()!;
      left--;
      if (dist[i] >= 0 || best[i] !== d) continue;
      dist[i] = d;
      const x = i % w, y = (i - x) / w;
      for (let q = 0; q < 8; q++) {
        const nx = x + RING_DX[q], ny = y + RING_DY[q];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || tiles[ny * w + nx] !== TILE_FLOOR) continue;
        const diagonal = (q & 1) === 1;
        if (diagonal && (tiles[y * w + nx] !== TILE_FLOOR || tiles[ny * w + x] !== TILE_FLOOR)) continue;
        const nd = d + (diagonal ? 7 : 5), j = ny * w + nx;
        if (nd < best[j]) { best[j] = nd; buckets[nd & 7].push(j); left++; }
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------------------------------------------------
// The 16-neighbourhood walk field (WP0k): orthogonal 5, diagonal 7, knight 11 (fifths of a tile; the 5-7-11 chamfer is within
// about 2% of the euclidean walk, against 7.7% for 5-7). Used by the generator's pool pick and by the zone stylers' route guards.

/** Moves 0..3 orthogonal, 4..7 diagonal, 8..15 knight: (dx, dy) and the step cost. */
const MV_DX = new Int8Array([1, -1, 0, 0, 1, 1, -1, -1, 2, 2, -2, -2, 1, 1, -1, -1]);
const MV_DY = new Int8Array([0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2]);
const MV_COST = new Uint8Array([5, 5, 5, 5, 7, 7, 7, 7, 11, 11, 11, 11, 11, 11, 11, 11]);
/**
 * The two cells a move brushes besides its target, as offsets from the origin: a diagonal needs (dx, 0) and (0, dy) free (no
 * corner cutting); a knight (2sx, sy) the cells (sx, 0) and (sx, sy), a knight (sx, 2sy) the cells (0, sy) and (sx, sy), which
 * is exactly where the straight segment between the two tile centres goes (poolratio.ts of the contract, section 10).
 */
const MV_C1X = new Int8Array(16), MV_C1Y = new Int8Array(16), MV_C2X = new Int8Array(16), MV_C2Y = new Int8Array(16);
for (let q = 4; q < 16; q++) {
  const dx = MV_DX[q], dy = MV_DY[q];
  if (q < 8) { MV_C1X[q] = dx; MV_C1Y[q] = 0; MV_C2X[q] = 0; MV_C2Y[q] = dy; }
  else if (dx === 2 || dx === -2) { const sx = dx > 0 ? 1 : -1; MV_C1X[q] = sx; MV_C1Y[q] = 0; MV_C2X[q] = sx; MV_C2Y[q] = dy; }
  else { const sy = dy > 0 ? 1 : -1; MV_C1X[q] = 0; MV_C1Y[q] = sy; MV_C2X[q] = dx; MV_C2Y[q] = sy; }
}

const INF = 1 << 30;
let QCAP = 4096;
let QBUF: Int32Array = new Int32Array(16 * QCAP);
const QTOP = new Int32Array(16);
/** Doubles the capacity of every bucket stack of the scratch buffer (their contents are kept) and returns the new buffer. */
function growQueue(cap: number): Int32Array {
  const next = new Int32Array(16 * cap * 2);
  for (let b = 0; b < 16; b++) next.set(QBUF.subarray(b * cap, b * cap + QTOP[b]), b * cap * 2);
  QCAP = cap * 2;
  QBUF = next;
  return next;
}
let ALL_ONES = new Uint8Array(0);
/** A shared all-ones scope of at least n entries (never written). */
function onesOf(n: number): Uint8Array {
  if (ALL_ONES.length < n) ALL_ONES = new Uint8Array(n).fill(1);
  return ALL_ONES;
}

/**
 * Dijkstra on the 16-neighbourhood (orthogonal 5, diagonal 7, knight (2,1) 11), FLOOR only (TILE_FLOOR; LOW and WALL block), no
 * corner cutting: a diagonal needs both orthogonal cells free; a knight move needs the two cells of its 2x3 box that its segment
 * brushes free. Bucket queue mod 16. Seeds start at `seedValues[k]` (default 0; a seed that is not FLOOR is ignored, and the
 * field is the minimum over all seeds of seed value + walk). `scope` (optional) limits relaxation to tiles with scope[i] === 1
 * (seeds may lie outside it; the corner cells are read from `tiles` whatever the scope). Fifths of a tile; -1 unreachable.
 * The field is the exact shortest-walk metric, so it does not depend on any tie order (the bucket queue pops LIFO within a value).
 */
export function walkField16(tiles: Uint8Array, w: number, h: number, seeds: ArrayLike<number>, seedValues?: ArrayLike<number>, scope?: Uint8Array): Int32Array {
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  const ns = seeds.length;
  if (ns === 0) return dist;
  const best = new Int32Array(n).fill(INF);
  const ok = scope ?? onesOf(n);
  // seeds in ascending value order (ties: given order), injected into the bucket queue as the cursor reaches their value
  const order = new Int32Array(ns);
  let c = 0;
  if (seedValues === undefined) {
    for (let k = 0; k < ns; k++) order[k] = k;
  } else {
    let sorted = true, lo = seedValues[0];
    for (let k = 0; k < ns; k++) {
      order[k] = k;
      if (seedValues[k] < lo) lo = seedValues[k];
      if (k > 0 && seedValues[k] < seedValues[k - 1]) sorted = false;
    }
    if (!sorted) {
      const keys = new Float64Array(ns);
      for (let k = 0; k < ns; k++) keys[k] = (seedValues[k] - lo) * 2097152 + k;
      keys.sort();
      for (let k = 0; k < ns; k++) order[k] = keys[k] % 2097152;
    }
    c = seedValues[order[0]];
  }
  // Sixteen LIFO stacks of tile indices in one scratch buffer (re-used between calls: walkField16 never re-enters).
  let cap = QCAP;
  let qbuf: Int32Array = QBUF;
  const top = QTOP;
  top.fill(0);
  const off = new Int32Array(16), o1 = new Int32Array(16), o2 = new Int32Array(16);
  for (let q = 0; q < 16; q++) {
    off[q] = MV_DY[q] * w + MV_DX[q];
    o1[q] = MV_C1Y[q] * w + MV_C1X[q];
    o2[q] = MV_C2Y[q] * w + MV_C2X[q];
  }
  let sp = 0, left = 0;
  while (left > 0 || sp < ns) {
    if (left === 0) {
      const v = seedValues === undefined ? 0 : seedValues[order[sp]];
      if (v > c) c = v;
    }
    while (sp < ns) {
      const k = order[sp], v = seedValues === undefined ? 0 : seedValues[k];
      if (v > c) break;
      sp++;
      const s = seeds[k];
      if (s < 0 || s >= n || tiles[s] !== TILE_FLOOR) continue;
      // a seed another seed already reaches more cheaply is not a source of its own value
      if (c < best[s]) {
        best[s] = c;
        const b = c & 15;
        if (top[b] === cap) { qbuf = growQueue(cap); cap *= 2; }
        qbuf[b * cap + top[b]++] = s;
        left++;
      }
    }
    const cb = c & 15;
    while (top[cb] > 0) {
      const i = qbuf[cb * cap + --top[cb]];
      left--;
      if (dist[i] >= 0 || best[i] !== c) continue;
      dist[i] = c;
      const x = i % w, y = (i - x) / w;
      const inner = x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
      for (let q = 0; q < 16; q++) {
        if (!inner) {
          const nx = x + MV_DX[q], ny = y + MV_DY[q];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        }
        const j = i + off[q];
        if (tiles[j] !== TILE_FLOOR || ok[j] !== 1) continue;
        if (q >= 4 && (tiles[i + o1[q]] !== TILE_FLOOR || tiles[i + o2[q]] !== TILE_FLOOR)) continue;
        const nd = c + MV_COST[q];
        if (nd < best[j]) {
          best[j] = nd;
          const b = nd & 15;
          if (top[b] === cap) { qbuf = growQueue(cap); cap *= 2; }
          qbuf[b * cap + top[b]++] = j;
          left++;
        }
      }
    }
    c++;
  }
  return dist;
}

/**
 * Steepest descent on a walkField16 field from tile `from`: the legal 16-neighbour (the field's own move rules on `tiles`) with
 * the smallest value below the current one (ties: lowest tile index), until a tile with no lower neighbour (a seed). Tile
 * indices from `from` on; just [from] when `from` is unreachable.
 */
export function descentPath(field: Int32Array, tiles: Uint8Array, w: number, h: number, from: number): number[] {
  const out = [from];
  if (from < 0 || from >= w * h || field[from] < 0) return out;
  let i = from;
  for (let guard = w * h; guard > 0; guard--) {
    const x = i % w, y = (i - x) / w;
    let bestV = field[i], bj = -1;
    for (let q = 0; q < 16; q++) {
      const nx = x + MV_DX[q], ny = y + MV_DY[q];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (tiles[j] !== TILE_FLOOR) continue;
      if (q >= 4 && (tiles[(y + MV_C1Y[q]) * w + x + MV_C1X[q]] !== TILE_FLOOR || tiles[(y + MV_C2Y[q]) * w + x + MV_C2X[q]] !== TILE_FLOOR)) continue;
      const v = field[j];
      if (v < 0) continue;
      if (v < bestV) { bestV = v; bj = j; } else if (v === bestV && bj >= 0 && j < bj) bj = j;
    }
    if (bj < 0) break;
    out.push(bj);
    i = bj;
  }
  return out;
}

/**
 * Is the segment between the centres of tiles a and b blocked under `mask` (default MASK_SIGHT: walls)? The same rule as
 * geometry.raycast (an Amanatides-Woo walk, a vertex counts as entering both neighbours, a blocked start or end tile and the
 * grid's outside block), run on integers: crossing k of an axis happens at t = (2k + 1) / (2 |d|), so two crossings are
 * ordered by cross-multiplying and a tie is a vertex. No division, no float.
 */
export function segmentBlocked(tiles: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, mask: number = MASK_SIGHT): boolean {
  const blockedAt = (tx: number, ty: number): boolean => tx < 0 || ty < 0 || tx >= w || ty >= h || (tiles[ty * w + tx] & mask) !== 0;
  if (blockedAt(ax, ay)) return true;
  const dx = bx - ax, dy = by - ay;
  const adx = dx < 0 ? -dx : dx, ady = dy < 0 ? -dy : dy;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let tx = ax, ty = ay, nx = 0, ny = 0;
  while (nx < adx || ny < ady) {
    let crossX: boolean, crossY: boolean;
    if (nx >= adx) { crossX = false; crossY = true; }
    else if (ny >= ady) { crossX = true; crossY = false; }
    else {
      const lhs = (2 * nx + 1) * ady, rhs = (2 * ny + 1) * adx;
      crossX = lhs <= rhs;
      crossY = lhs >= rhs;
    }
    if (crossX && crossY && (blockedAt(tx + sx, ty) || blockedAt(tx, ty + sy))) return true;
    if (crossX) { tx += sx; nx++; }
    if (crossY) { ty += sy; ny++; }
    if (blockedAt(tx, ty)) return true;
  }
  return false;
}
