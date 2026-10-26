// Sight-lane checkers for styled maps, copied from mapgen.test.ts (an independent implementation of the generator's lattice and
// exact-strip checks) with ONE deliberate change: a tile is open for sight when it is not a wall, so a LOW tile (a fence, lava,
// a crevasse) counts as open. mapgen.test.ts reads `=== TILE_FLOOR`, which would under-report over a river.
import { TILE_WALL } from "../src/map";
import type { GameMap } from "../src/map";
import { REGION_NONE } from "../src/map";

const snapZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
const LANE_EPS = 1e-9;

/** 1 where a tile is open for SIGHT with a region other than none: not a wall (FLOOR and LOW both). */
export function sightOpenMask(m: GameMap, tiles: Uint8Array = m.tiles): Uint8Array {
  const open = new Uint8Array(m.w * m.h);
  for (let i = 0; i < open.length; i++) open[i] = tiles[i] !== TILE_WALL && m.regionGrid[i] !== REGION_NONE ? 1 : 0;
  return open;
}

/** The longest fat lane over `dirs` directions, in tiles. `k` and `o` (offset of the lower line, tiles) locate it for the message. */
export function fatLane(open: Uint8Array, w: number, h: number, dirs: number, step: number): { len: number; k: number; o: number } {
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
 * The longest strip of width `wt` tiles, at any angle and offset, whose interior meets no blocked tile (a port of the
 * review's exact checker). Angles are `thetas` (radians) and the strip offsets are `ostep` tiles apart. For one angle
 * every blocked tile is clipped against each slab {lo <= n.p <= hi} (n the normal) it meets, which gives the stretch
 * of the slab's axis (d.p) that tile blocks; a free strip is a gap between those stretches. Slabs are shrunk by 1e-7
 * so a wall that only touches the strip's side does not count. Returns tiles; sampling only ever under-reports.
 */
export function longestFreeStrip(blocked: Uint8Array, w: number, h: number, wt: number, thetas: readonly number[], ostep: number): { len: number; deg: number } {
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
