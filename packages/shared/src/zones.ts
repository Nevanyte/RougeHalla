// The zone partition and the camp territories (ROGUELIKE_PLAN D1, D4, D15; docs/R1_GENERATOR_NOTE.md 1.2-1.3).
//
// Zones are grown "paint bucket" style: integer value noise sets a cost per tile, each zone pre-claims an arc of the
// ring road (so every zone meets the coliseum) joined by its cheapest path (its spine) to a seed out in the annulus,
// then all five grow from those claims along the cheapest paths, smallest zone first, each stopping at an equal quota.
// Boundary tiles are then smoothed and traded down chains of neighbours until the areas are equal within one tile.
// Camps: per zone, sites are drawn by best-candidate sampling, the zone is cut into territories by a path-cost
// Voronoi partition from the camps' halos, each camp moves to its territory's pole (one Lloyd step), and the final
// camp stands at the pole of its final territory.
//
// Deterministic: integer noise, integer (5/7 chamfer) distance transforms, integer heap keys, total comparators; only
// + - * / sqrt floor min max. The callers own the rng stream; the order of draws is part of every map.
import { MAP_TILES_H, MAP_TILES_W } from "./constants";
import { CX, CY, RING_ROAD, fixedLayout } from "./coliseum";
import { NB4 as OPS_NB4, RING_OFF as OPS_RING_OFF, SIMPLE as OPS_SIMPLE } from "./gridOps";
import { MASK_MOVE as MOVE_MASK, TILE_WALL as WALL_TILE } from "./map";
import { randInt as rngInt } from "./rng";
import type { Rng } from "./rng";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const R0 = Math.min(W, H) / 2;
export const ZONES = 5;
// Hot loops read module-level copies of these imports: under a test runner's module system (vitest) every use of an
// import is a property read on the module object, which cost this code about a third of its time.
const NB4 = OPS_NB4, RING_OFF = OPS_RING_OFF, SIMPLE = OPS_SIMPLE, MASK_MOVE = MOVE_MASK, TILE_WALL = WALL_TILE, randInt = rngInt;


/** Ring-road tiles each zone must own (F): a frontage of at least 8 tiles along the 3-deep road. The road has 252 (it is fixed), a fair share is 50. */
export const RING_CONTACT_MIN = 24;
/** Sliver tiles allowed per zone (S): tiles more than 2.5 from every point a 2.5-radius disc fits in the zone. */
export const SLIVER_MAX = 100;
/** Painted areas of the five zones: max - min. */
export const AREA_TOLERANCE = 8;
/** Camps per zone (zone-shapes contract 0.1.2); ELITES_PER_ZONE of them are elite camps. */
export const CAMPS_PER_ZONE = 8;
/** Elite camps per zone: the zone's camp farthest from the coliseum centre, and the next farthest at least ELITE_MIN_SEP from it. */
export const ELITES_PER_ZONE = 2;
/** Tiles the second elite camp keeps from the first when any camp of the zone can (else the zone's second farthest is elite). */
export const ELITE_MIN_SEP = 16;
/** Camp centres keep this far apart map-wide (tiles). Measured at 136x136 with 8 camps per zone: same-zone neighbours 11.7-44 tiles apart (p50 19.2). */
export const CAMP_GAP = 9;
/**
 * Farthest territory floor tile from its camp (tiles): a territory is the camp's leash area, and a long thin arm of a
 * zone would otherwise leave one camp a territory reaching 50-60 tiles away. Measured on the R1 generator (1000 maps,
 * 20 territories each): the median territory reaches 17.5 tiles and the 90th percentile 25; 30 sits past that tail,
 * so it only rejects the long-arm shapes (see docs/R2_GENERATOR_AS_BUILT.md for the measured rate).
 */
export const TERRITORY_RADIUS_MAX = 30;
/** A cut-off floor piece of a territory this small (tiles) may change zone during the repair; a bigger one fails the attempt. */
export const STRAY_MAX = 40;
/** The most tiles of cut-off floor the repair walls up (it holds nothing and joins nothing: see repairTerritories). */
export const WALL_UP_MAX = 120;

/** Edge cost of the growth: COST_BASE + noise * COST_AMP / 256 (noise 0..255), so 12..47. */
const COST_BASE = 12;
const COST_AMP = 36;
/** Ring arcs: the least tiles an arc gets, and the tiles trimmed off each end of it before the zone pre-claims it. */
const ARC_MIN = 36;
const ARC_TRIM = 6;
/** Zone seeds lie in this annulus (fractions of R0): 37 to 61 tiles from the centre at 136x136. */
const ANNULUS_LO = 0.55;
const ANNULUS_HI = 0.9;
/** Best-candidate sampling: candidates drawn per zone seed and per camp site. */
const SEED_CANDIDATES = 10;
const CAMP_CANDIDATES = 12;
const SMOOTH_PASSES = 2;
/** Territory partitions per zone: the first from the drawn sites, then one per Lloyd step. */
const LLOYD_STEPS = 4;
/** Retries of a stage inside one attempt (each draws on, from the same stream). */
export const ZONE_TRIES = 8;
export const CAMP_TRIES = 2;
/** Open tiles between the border ring and any camp halo. */
const EDGE_CLEAR = 3;
/** Clearing radius of a camp, in tiles. */
export const CAMP_R = 2.5;

/** Offsets of the tiles whose centre lies within CAMP_R of a camp centre (the clearing), and the clearing grown by one tile (the halo). */
export const CAMP_TILES: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) if (i * i + j * j <= CAMP_R * CAMP_R) out.push([i, j]);
  return out;
})();
export const CAMP_HALO: readonly (readonly [number, number])[] = (() => {
  const out: [number, number][] = [];
  for (let j = -4; j <= 4; j++) {
    for (let i = -4; i <= 4; i++) if (CAMP_TILES.some(([a, b]) => Math.abs(a - i) <= 1 && Math.abs(b - j) <= 1)) out.push([i, j]);
  }
  return out;
})();
const HALO_OFF = Int32Array.from(CAMP_HALO.map(([ox, oy]) => oy * W + ox));
const CLEAR_OFF = Int32Array.from(CAMP_TILES.map(([ox, oy]) => oy * W + ox));
/** Chamfer distance (fifths of a tile) from which a tile counts as a "core" tile for the sliver measure: a 2.5 disc fits. */
const CORE_DT = 15;
/**
 * The halo is exactly the set of offsets within 5/7 chamfer distance 19 (|dx|, |dy| <= 3 but the four (3, 3) corners),
 * so a halo lies inside a region exactly when the region's unconstrained chamfer distance at its centre is 20 or more.
 */
const HALO_DT = 20;

/** Tile coordinates by index (d2i's tables: a division per call cost the camp stage a third of its time at 136x136). */
const TX = new Int32Array(N), TY = new Int32Array(N);
for (let i = 0; i < N; i++) { TX[i] = i % W; TY[i] = (i - (i % W)) / W; }
/** Squared distance between two tiles, by index. */
export const d2i = (a: number, b: number): number => {
  const dx = TX[a] - TX[b], dy = TY[a] - TY[b];
  return dx * dx + dy * dy;
};

/** Failed stages and attempts by reason ("A:" marks a failed attempt, the rest are stage retries), for the bench; never read by the generator. */
export const MAPGEN_FAILS: Record<string, number> = {};
/** Counts a failure under `why` and returns null, the failed result. */
export const failed = (why: string): null => { MAPGEN_FAILS[why] = (MAPGEN_FAILS[why] ?? 0) + 1; return null; };
/** Things an attempt did on the way that are not failures (bench and tests read them; nothing in a map depends on them). */
export const MAPGEN_NOTES: Record<string, number> = {};
export const note = (what: string, n = 1): void => { MAPGEN_NOTES[what] = (MAPGEN_NOTES[what] ?? 0) + n; };

// ---------------------------------------------------------------------------------------------------------------------
// The zone-specific parts of the fixed layout, built once.

interface ZoneLayout {
  /** Tiles a camp may stand on: its whole halo is off the ring road (+1 tile) and EDGE_CLEAR from the border. */
  haloOK: Uint8Array;
  /** Painted tiles in the seed annulus. */
  annulus: Int32Array;
  /** The ring road in angular order (pseudo-angle, then index), with each tile's pseudo-angle. */
  ringSorted: Int32Array;
  ringAng: Float64Array;
}
let ZL: ZoneLayout | null = null;

function zoneLayout(): ZoneLayout {
  if (ZL) return ZL;
  const F = fixedLayout();
  const campOK = new Uint8Array(N);
  for (let y = EDGE_CLEAR; y <= H - 1 - EDGE_CLEAR; y++) {
    for (let x = EDGE_CLEAR; x <= W - 1 - EDGE_CLEAR; x++) {
      const i = y * W + x;
      if (F.paintedMask[i] && F.distFp[i] > RING_ROAD + 1) campOK[i] = 1;
    }
  }
  const haloOK = new Uint8Array(N);
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      let ok = true;
      for (let h = 0; h < HALO_OFF.length && ok; h++) if (!campOK[y * W + x + HALO_OFF[h]]) ok = false;
      if (ok) haloOK[y * W + x] = 1;
    }
  }
  const lo2 = (ANNULUS_LO * R0) * (ANNULUS_LO * R0), hi2 = (ANNULUS_HI * R0) * (ANNULUS_HI * R0);
  const annulus: number[] = [];
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const dx = x + 0.5 - CX, dy = y + 0.5 - CY, r2 = dx * dx + dy * dy;
      if (F.paintedMask[y * W + x] && r2 >= lo2 && r2 <= hi2) annulus.push(y * W + x);
    }
  }
  const angOf = (i: number): number => pseudoAngle((i % W) + 0.5 - CX, Math.floor(i / W) + 0.5 - CY);
  const ringSorted = Array.from(F.ringTiles).sort((a, b) => angOf(a) - angOf(b) || a - b);
  ZL = { haloOK, annulus: Int32Array.from(annulus), ringSorted: Int32Array.from(ringSorted), ringAng: Float64Array.from(ringSorted.map(angOf)) };
  return ZL;
}

/** Builds the zone layout tables once (the generator's warm-up). */
export function warmZoneLayout(): void {
  zoneLayout();
}

// ---------------------------------------------------------------------------------------------------------------------
// Integer tools.

/** A pseudo-angle in [0, 4), monotone in the true angle of (dx, dy): rational operations only, no atan2. */
export function pseudoAngle(dx: number, dy: number): number {
  if (dy >= 0) return dx >= 0 ? dy / (dx + dy) : 1 - dx / (-dx + dy);
  return dx < 0 ? 2 - dy / (-dx - dy) : 3 + dx / (dx - dy);
}

/** Value noise 0..255: two octaves (cells of 34 and 13 tiles at 136x136, weights 2:1) of bilinear lattice noise, integer arithmetic only. */
function valueNoise(rng: Rng, out: Int32Array): void {
  const octave = (cell: number, weight: number): void => {
    const gw = Math.floor(W / cell) + 2;
    const lat = new Int32Array(gw * gw);
    for (let i = 0; i < lat.length; i++) lat[i] = Math.floor(rng() * 256);
    const c2 = cell * cell;
    for (let y = 0; y < H; y++) {
      const gy = Math.floor(y / cell), fy = y - gy * cell;
      for (let x = 0; x < W; x++) {
        const gx = Math.floor(x / cell), fx = x - gx * cell;
        const a = lat[gy * gw + gx], b = lat[gy * gw + gx + 1], c = lat[(gy + 1) * gw + gx], d = lat[(gy + 1) * gw + gx + 1];
        out[y * W + x] += Math.floor((a * (cell - fx) * (cell - fy) + b * fx * (cell - fy) + c * (cell - fx) * fy + d * fx * fy) / c2) * weight;
      }
    }
  };
  out.fill(0);
  octave(Math.round((16 * W) / 64), 2);
  octave(Math.round((6 * W) / 64), 1);
  for (let i = 0; i < N; i++) out[i] = Math.floor(out[i] / 3);
}

/** Chamfer 5/7 distance (fifths of a tile) to the nearest tile outside `mask`; off the map counts as outside. */
export function chamfer(mask: Uint8Array, out: Int32Array): void {
  for (let i = 0; i < N; i++) out[i] = mask[i] ? 1 << 28 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (out[i] === 0) continue;
      let v = out[i];
      v = Math.min(v, x > 0 ? out[i - 1] + 5 : 5);
      v = Math.min(v, y > 0 ? out[i - W] + 5 : 5);
      v = Math.min(v, x > 0 && y > 0 ? out[i - W - 1] + 7 : 7);
      v = Math.min(v, x < W - 1 && y > 0 ? out[i - W + 1] + 7 : 7);
      out[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (out[i] === 0) continue;
      let v = out[i];
      v = Math.min(v, x < W - 1 ? out[i + 1] + 5 : 5);
      v = Math.min(v, y < H - 1 ? out[i + W] + 5 : 5);
      v = Math.min(v, x < W - 1 && y < H - 1 ? out[i + W + 1] + 7 : 7);
      v = Math.min(v, x > 0 && y < H - 1 ? out[i + W - 1] + 7 : 7);
      out[i] = v;
    }
  }
}

/** Chamfer 5/7 distance to the nearest tile with a different label (label 0 = outside), for every labelled tile at once. */
export function chamferLabels(label: Uint8Array, out: Int32Array): void {
  for (let i = 0; i < N; i++) out[i] = label[i] ? 1 << 28 : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, L = label[i];
      if (!L) continue;
      let v = out[i];
      v = Math.min(v, x > 0 && label[i - 1] === L ? out[i - 1] + 5 : 5);
      v = Math.min(v, y > 0 && label[i - W] === L ? out[i - W] + 5 : 5);
      v = Math.min(v, x > 0 && y > 0 && label[i - W - 1] === L ? out[i - W - 1] + 7 : 7);
      v = Math.min(v, x < W - 1 && y > 0 && label[i - W + 1] === L ? out[i - W + 1] + 7 : 7);
      out[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x, L = label[i];
      if (!L) continue;
      let v = out[i];
      v = Math.min(v, x < W - 1 && label[i + 1] === L ? out[i + 1] + 5 : 5);
      v = Math.min(v, y < H - 1 && label[i + W] === L ? out[i + W] + 5 : 5);
      v = Math.min(v, x < W - 1 && y < H - 1 && label[i + W + 1] === L ? out[i + W + 1] + 7 : 7);
      v = Math.min(v, x > 0 && y < H - 1 && label[i + W - 1] === L ? out[i + W - 1] + 7 : 7);
      out[i] = v;
    }
  }
}

/** Binary min-heap of non-negative integer keys `cost * KEY + tile`: equal costs pop in tile order, so ties are total. */
class Heap {
  a: Int32Array;
  n = 0;
  constructor(cap: number) { this.a = new Int32Array(cap); }
  clear(): void { this.n = 0; }
  push(k: number): void {
    if (this.n >= this.a.length) { const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    const a = this.a;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p] <= k) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = k;
  }
  top(): number { return this.a[0]; }
  pop(): number {
    const a = this.a, r = a[0], k = a[--this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && a[c + 1] < a[c]) c++;
      if (a[c] >= k) break;
      a[i] = a[c];
      i = c;
    }
    a[i] = k;
    return r;
  }
}
/** Heap keys are cost * KEY + tile (tile < 18496 at 136x136; path costs stay far below 2^31 / KEY = 65536). */
const KEY = 32768;
const growHeaps: Heap[] = [];
for (let z = 0; z <= ZONES; z++) growHeaps.push(new Heap(4096));

/**
 * Equal-quota growth: every zone grows from its pre-claimed tiles along the cheapest path cost (`cost` per tile
 * entered), always the zone furthest under its quota first, and stops at its quota. Leftovers go to whichever zone can
 * reach them, then `balance` evens the sizes. Zones are 4-connected by construction. `owner` holds 0 for unclaimed
 * `mask` tiles and is filled with 1..k.
 */
function growQuota(mask: Uint8Array, tiles: Int32Array, owner: Uint8Array, k: number, cost: Int32Array, quota: Int32Array, protect: Uint8Array): boolean {
  const size = new Int32Array(k + 1);
  let free = 0;
  for (let z = 1; z <= k; z++) growHeaps[z].clear();
  for (let q = 0; q < tiles.length; q++) {
    const t = tiles[q], z = owner[t];
    if (z === 0) { free++; continue; }
    size[z]++;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (mask[j] && owner[j] === 0) growHeaps[z].push(cost[j] * KEY + j);
    }
  }
  const claim = (z: number, key: number): void => {
    const t = key % KEY, c = (key - t) / KEY;
    owner[t] = z;
    size[z]++;
    free--;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (mask[j] && owner[j] === 0) growHeaps[z].push((c + cost[j]) * KEY + j);
    }
  };
  // phase 0: quotas; phase 1: whoever can reach the leftovers takes them
  for (let phase = 0; phase < 2 && free > 0; phase++) {
    for (;;) {
      let z = 0;
      for (let q = 1; q <= k; q++) {
        if (phase === 0 && size[q] >= quota[q]) continue;
        const h = growHeaps[q];
        while (h.n > 0 && owner[h.top() % KEY] !== 0) h.pop();
        if (h.n > 0 && (z === 0 || size[q] - quota[q] < size[z] - quota[z])) z = q;
      }
      if (z === 0) break;
      claim(z, growHeaps[z].pop());
      if (free === 0) break;
    }
  }
  if (free > 0) return false;
  return balance(mask, tiles, owner, k, quota, protect);
}

/**
 * Zone sizes back to their quotas (within 1) by boundary trades: the zone furthest over quota hands tiles down the
 * shortest chain of neighbouring zones to the one furthest under. Each link peels simple boundary points off the
 * donor (see `peel`), so the donor stays 4-connected. `protect` tiles never move. False when a trade gets stuck; after
 * 40 rounds it stops and returns true, and the caller's area check judges the result.
 */
function balance(mask: Uint8Array, tiles: Int32Array, owner: Uint8Array, k: number, quota: Int32Array, protect: Uint8Array): boolean {
  const size = new Int32Array(k + 1);
  for (let q = 0; q < tiles.length; q++) size[owner[tiles[q]]]++;
  const adj = new Uint8Array((k + 1) * (k + 1));
  for (let round = 0; round < 40; round++) {
    let lo = 1, hi = 1;
    for (let z = 2; z <= k; z++) {
      if (size[z] - quota[z] < size[lo] - quota[lo]) lo = z;
      if (size[z] - quota[z] > size[hi] - quota[hi]) hi = z;
    }
    if ((size[hi] - quota[hi]) - (size[lo] - quota[lo]) <= 1) return true;
    const m = Math.max(1, Math.min(size[hi] - quota[hi], quota[lo] - size[lo]));
    adj.fill(0);
    for (let q = 0; q < tiles.length; q++) {
      const t = tiles[q], a = owner[t], r = t + 1, d = t + W;
      if (mask[r] && owner[r] !== a) { adj[a * (k + 1) + owner[r]] = 1; adj[owner[r] * (k + 1) + a] = 1; }
      if (mask[d] && owner[d] !== a) { adj[a * (k + 1) + owner[d]] = 1; adj[owner[d] * (k + 1) + a] = 1; }
    }
    const prev = new Int32Array(k + 1).fill(-1);
    prev[hi] = hi;
    const queue = [hi];
    for (let h = 0; h < queue.length; h++) {
      const u = queue[h];
      for (let v = 1; v <= k; v++) if (adj[u * (k + 1) + v] && prev[v] < 0) { prev[v] = u; queue.push(v); }
    }
    if (prev[lo] < 0) return false;
    const chain: number[] = [];
    for (let v = lo; v !== hi; v = prev[v]) chain.push(v);
    chain.push(hi);
    // A link that can only hand over part of m still hands that over: the next round takes up from there (stuck only when no tile moves).
    let progressed = false;
    for (let c = chain.length - 1; c > 0; c--) {
      const from = chain[c], to = chain[c - 1];
      const got = peel(mask, tiles, owner, from, to, m, protect);
      size[to] += got;
      size[from] -= got;
      if (got > 0) progressed = true;
      if (got < m) break;
    }
    if (!progressed) return false;
  }
  return true;
}

const peelHeap = new Heap(4096);
/**
 * Moves up to m tiles of zone `from` that border zone `to` over to `to`, best first (most neighbours on the taker's
 * side, fewest on the donor's), simple points only so `from` stays 4-connected. Returns how many moved.
 */
function peel(mask: Uint8Array, tiles: Int32Array, owner: Uint8Array, from: number, to: number, m: number, protect: Uint8Array): number {
  const h = peelHeap;
  h.clear();
  const score = (t: number): number => {
    let nTo = 0, nFrom = 0;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (!mask[j]) continue;
      if (owner[j] === to) nTo++; else if (owner[j] === from) nFrom++;
    }
    if (nTo === 0 || nFrom === 0) return -1;
    return 2 * nTo - nFrom + 4; // 1..11
  };
  for (let q = 0; q < tiles.length; q++) {
    const t = tiles[q];
    if (owner[t] !== from || protect[t]) continue;
    const s = score(t);
    if (s > 0) h.push((12 - s) * KEY + t);
  }
  let moved = 0;
  while (moved < m && h.n > 0) {
    const key = h.pop(), t = key % KEY, keyScore = 12 - (key - t) / KEY;
    if (owner[t] !== from) continue;
    const s = score(t);
    if (s <= 0) continue;
    // a stale entry: its score fell since it was pushed, so it goes back in at its real place
    if (s < keyScore) { h.push((12 - s) * KEY + t); continue; }
    let r = 0;
    for (let q = 0; q < 8; q++) if (mask[t + RING_OFF[q]] && owner[t + RING_OFF[q]] === from) r |= 1 << q;
    if (!SIMPLE[r]) continue;
    owner[t] = to;
    moved++;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (mask[j] && owner[j] === from && !protect[j]) { const sj = score(j); if (sj > 0) h.push((12 - sj) * KEY + j); }
    }
  }
  return moved;
}

const spineHeap = new Heap(8192);
const spineCost = new Int32Array(N), spinePrev = new Int32Array(N), spineDone = new Uint8Array(N);
/** Claims for zone z the cheapest path from its tiles to `target` through unclaimed tiles; false when there is none. */
function spine(zone: Uint8Array, mask: Uint8Array, cost: Int32Array, z: number, target: number): boolean {
  if (zone[target] === z) return true;
  const h = spineHeap;
  h.clear();
  spineCost.fill(-1);
  spineDone.fill(0);
  for (let i = 0; i < N; i++) if (zone[i] === z) { spineCost[i] = 0; spinePrev[i] = -1; h.push(i); }
  while (h.n > 0) {
    const key = h.pop(), t = key % KEY, c = (key - t) / KEY;
    if (spineDone[t]) continue;
    spineDone[t] = 1;
    if (t === target) break;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (!mask[j] || zone[j] !== 0 || spineDone[j]) continue;
      const nc = c + cost[j];
      if (spineCost[j] < 0 || nc < spineCost[j]) { spineCost[j] = nc; spinePrev[j] = t; h.push(nc * KEY + j); }
    }
  }
  if (!spineDone[target]) return false;
  for (let t = target; t >= 0 && zone[t] !== z; t = spinePrev[t]) zone[t] = z;
  return true;
}

const voroHeap = new Heap(8192);
const voroBest = new Int32Array(N), voroLab = new Uint8Array(N);
/**
 * Multi-source shortest-path partition of `mask`: claimed tiles (owner > 0) are the sources, and every other tile takes
 * the label of the parent on its cheapest path, so each part is a 4-connected tree holding its sources. Ties: lower
 * cost, then lower tile index.
 */
function voronoi(mask: Uint8Array, tiles: Int32Array, owner: Uint8Array, cost: Int32Array): void {
  const h = voroHeap;
  h.clear();
  for (let q = 0; q < tiles.length; q++) {
    const t = tiles[q];
    voroBest[t] = 1 << 30;
    if (owner[t] > 0) { voroBest[t] = 0; voroLab[t] = owner[t]; h.push(t); }
  }
  while (h.n > 0) {
    const key = h.pop(), t = key % KEY, c = (key - t) / KEY;
    if (c > voroBest[t]) continue;
    owner[t] = voroLab[t];
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e];
      if (!mask[j]) continue;
      const nc = c + cost[j];
      if (nc < voroBest[j]) { voroBest[j] = nc; voroLab[j] = voroLab[t]; h.push(nc * KEY + j); }
    }
  }
}

/** Majority smoothing: a tile with 3+ of its 4 neighbours in one other zone joins it, if its own zone stays connected. */
function smooth(mask: Uint8Array, tiles: Int32Array, owner: Uint8Array, protect: Uint8Array): void {
  for (let q = 0; q < tiles.length; q++) {
    const t = tiles[q], a = owner[t];
    if (protect[t]) continue;
    let b = 0, nb = 0;
    for (let e = 0; e < 4; e++) {
      const j = t + NB4[e], u = owner[j];
      if (!mask[j] || u === a) continue;
      let c = 0;
      for (let f = 0; f < 4; f++) if (mask[t + NB4[f]] && owner[t + NB4[f]] === u) c++;
      if (c > nb) { nb = c; b = u; }
    }
    if (nb < 3) continue;
    let r = 0;
    for (let s = 0; s < 8; s++) if (mask[t + RING_OFF[s]] && owner[t + RING_OFF[s]] === a) r |= 1 << s;
    if (!SIMPLE[r]) continue;
    owner[t] = b;
  }
}

/**
 * Mitchell's best candidate: each point is the farthest (from the points so far and `avoid`) of `m` random candidates
 * at least sqrt(minD2) from all of them. When every draw misses, a deterministic scan takes the farthest candidate that
 * keeps the spacing; returns fewer than k points only when none is left.
 */
function bestCandidates(rng: Rng, cands: ArrayLike<number>, k: number, m: number, avoid: readonly number[], minD2: number): number[] {
  const out: number[] = [];
  if (cands.length === 0) return out;
  const nearest = (c: number): number => {
    let md = 1 << 30;
    for (const o of out) md = Math.min(md, d2i(o, c));
    for (const o of avoid) md = Math.min(md, d2i(o, c));
    return md;
  };
  for (let n = 0; n < k; n++) {
    let best = -1, bestD = -1;
    for (let s = 0; s < m; s++) {
      const c = cands[randInt(rng, 0, cands.length)];
      const md = nearest(c);
      if (md < minD2) continue;
      if (md > bestD || (md === bestD && c < best)) { bestD = md; best = c; }
    }
    if (best < 0) {
      for (let q = 0; q < cands.length; q++) {
        const c = cands[q], md = nearest(c);
        if (md >= minD2 && md > bestD) { bestD = md; best = c; }
      }
      if (best < 0) return out;
    }
    out.push(best);
  }
  return out;
}

/** The quota of each zone: the painted tiles split as evenly as integers allow (the first zones take the remainder). */
function quotas(total: number): Int32Array {
  const q = new Int32Array(ZONES + 1);
  for (let z = 1; z <= ZONES; z++) q[z] = Math.floor(total / ZONES) + (z <= total % ZONES ? 1 : 0);
  return q;
}

/** Ring-road tiles per zone (index 1..ZONES). */
export function ringContact(zone: Uint8Array): Int32Array {
  const F = fixedLayout();
  const contact = new Int32Array(ZONES + 1);
  for (let q = 0; q < F.ringTiles.length; q++) contact[zone[F.ringTiles[q]]]++;
  return contact;
}

/**
 * Sliver tiles per zone (index 1..ZONES): painted tiles not covered by any clearing-sized disc (CAMP_R) centred on a
 * "core" tile, one whose 5/7 chamfer distance to every other zone, the border and the coliseum is at least 3 tiles.
 * `dt` is scratch.
 */
export function sliverCounts(zone: Uint8Array, dt: Int32Array): Int32Array {
  const F = fixedLayout();
  chamferLabels(zone, dt);
  const cov = new Uint8Array(N);
  for (let q = 0; q < F.painted.length; q++) {
    const t = F.painted[q];
    if (dt[t] < CORE_DT) continue;
    const z = zone[t];
    for (let h = 0; h < CLEAR_OFF.length; h++) if (zone[t + CLEAR_OFF[h]] === z) cov[t + CLEAR_OFF[h]] = 1;
  }
  const out = new Int32Array(ZONES + 1);
  for (let q = 0; q < F.painted.length; q++) if (!cov[F.painted[q]]) out[zone[F.painted[q]]]++;
  return out;
}

export interface ZonePartition {
  /** 0 off the painted set, else 1..ZONES: the attempt's own zone index (its faction is `order[zone - 1]`). */
  zone: Uint8Array;
  /** The growth's tile cost, reused by the territories. */
  cost: Int32Array;
}

/**
 * The five zones: up to ZONE_TRIES layouts, each certified for equal area, ring-road contact and slivers. Null when
 * none passes (the attempt fails).
 */
export function partitionZones(rng: Rng): ZonePartition | null {
  const F = fixedLayout(), Z = zoneLayout();
  const zone = new Uint8Array(N);
  const noise = new Int32Array(N), cost = new Int32Array(N), dt = new Int32Array(N);
  const quota = quotas(F.painted.length);
  for (let tryNo = 0; tryNo < ZONE_TRIES; tryNo++) {
    valueNoise(rng, noise);
    for (let i = 0; i < N; i++) cost[i] = COST_BASE + ((noise[i] * COST_AMP) >> 8);
    zone.fill(0);

    // Ring arcs: the ring road in angular order cut into five arcs of at least ARC_MIN tiles, the rest shared at random.
    // Each arc's core (its ends trimmed) is pre-claimed, so every zone meets the coliseum by construction.
    const R = Z.ringSorted.length;
    const len = new Int32Array(ZONES);
    {
      const extra = R - ZONES * ARC_MIN;
      const u: number[] = [];
      let su = 0;
      for (let k = 0; k < ZONES; k++) { u.push(0.25 + rng()); su += u[k]; }
      let given = 0;
      for (let k = 0; k < ZONES; k++) { len[k] = ARC_MIN + Math.floor((extra * u[k]) / su); given += len[k]; }
      len[0] += R - given;
    }
    const protect = new Uint8Array(N);
    const arcMid: number[] = [];
    {
      let at = randInt(rng, 0, R);
      for (let k = 0; k < ZONES; k++) {
        for (let j = ARC_TRIM; j < len[k] - ARC_TRIM; j++) { const t = Z.ringSorted[(at + j) % R]; zone[t] = k + 1; protect[t] = 1; }
        arcMid.push(Z.ringAng[(at + (len[k] >> 1)) % R]);
        at += len[k];
      }
    }
    // Outer seeds by best-candidate sampling in the annulus, paired with the arcs in angular order (the cyclic shift
    // with the least total turn), then joined to their arc by the cheapest path: the zone's spine.
    const seeds = bestCandidates(rng, Z.annulus, ZONES, SEED_CANDIDATES, [], 0);
    const seedAng = seeds.map((s) => pseudoAngle((s % W) + 0.5 - CX, Math.floor(s / W) + 0.5 - CY));
    const byAngle = [0, 1, 2, 3, 4].sort((p, q) => seedAng[p] - seedAng[q] || p - q);
    let shift = 0, bestTurn = Infinity;
    for (let sh = 0; sh < ZONES; sh++) {
      let turn = 0;
      for (let k = 0; k < ZONES; k++) {
        const d = Math.abs(seedAng[byAngle[(k + sh) % ZONES]] - arcMid[k]);
        turn += Math.min(d, 4 - d);
      }
      if (turn < bestTurn) { bestTurn = turn; shift = sh; }
    }
    let spinesOK = true;
    for (let k = 0; k < ZONES && spinesOK; k++) {
      const target = seeds[byAngle[(k + shift) % ZONES]];
      if (zone[target] !== 0 && zone[target] !== k + 1) { spinesOK = false; break; }
      spinesOK = spine(zone, F.paintedMask, cost, k + 1, target);
      protect[target] = 1;
    }
    if (!spinesOK) { failed("zoneSpine"); continue; }
    if (!growQuota(F.paintedMask, F.painted, zone, ZONES, cost, quota, protect)) { failed("zoneGrow"); continue; }
    for (let p = 0; p < SMOOTH_PASSES; p++) smooth(F.paintedMask, F.painted, zone, protect);
    if (!balance(F.paintedMask, F.painted, zone, ZONES, quota, protect)) { failed("zoneGrow"); continue; }

    const size = new Int32Array(ZONES + 1);
    for (let q = 0; q < F.painted.length; q++) size[zone[F.painted[q]]]++;
    let smin = 1 << 30, smax = 0;
    for (let z = 1; z <= ZONES; z++) { smin = Math.min(smin, size[z]); smax = Math.max(smax, size[z]); }
    if (smax - smin > AREA_TOLERANCE) { failed("zoneArea"); continue; }
    const contact = ringContact(zone);
    let ok = true;
    for (let z = 1; z <= ZONES; z++) if (contact[z] < RING_CONTACT_MIN) ok = false;
    if (!ok) { failed("zoneRing"); continue; }
    const slivers = sliverCounts(zone, dt);
    for (let z = 1; z <= ZONES; z++) if (slivers[z] > SLIVER_MAX) ok = false;
    if (!ok) { failed("zoneSliver"); continue; }
    return { zone, cost };
  }
  return failed("A:zones");
}

/** A camp while the map is built: tile indices, its zone (1..ZONES) and its 1-based territory id. */
export interface CampSite {
  zone: number;
  site: number;
  elite: boolean;
  spots: number[];
}

export interface CampLayout {
  /** In the order they were placed: zone 1's camps, then zone 2's, ... */
  camps: CampSite[];
  /** 0 off the painted set, else 1 + index into `camps`. */
  territoryGrid: Uint8Array;
}

/**
 * The convex hull (counter-clockwise, integer tile coordinates) of the tiles `list[0..n)`, which must come in
 * increasing index order (so by row, then column). The farthest tile of a set from any point is a hull vertex.
 */
function hull(list: ArrayLike<number>, n: number, out: Int32Array): number {
  // Andrew's monotone chain on (y, x), which the index order already sorts lexicographically.
  let k = 0;
  const cross = (o: number, a: number, b: number): number => {
    const ox = o % W, oy = (o - ox) / W, ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    return (ay - oy) * (bx - ox) - (ax - ox) * (by - oy);
  };
  for (let i = 0; i < n; i++) {
    while (k >= 2 && cross(out[k - 2], out[k - 1], list[i]) <= 0) k--;
    out[k++] = list[i];
  }
  for (let i = n - 2, lo = k + 1; i >= 0; i--) {
    while (k >= lo && cross(out[k - 2], out[k - 1], list[i]) <= 0) k--;
    out[k++] = list[i];
  }
  return n > 1 ? k - 1 : k;
}

/** Farthest painted (or, with `tiles`, walkable) tile of each territory from its camp, squared tiles, by 1-based territory id. */
export function territoryReach2(camps: readonly CampSite[], territoryGrid: Uint8Array, tiles: Uint8Array | null): Int32Array {
  const F = fixedLayout();
  const far2 = new Int32Array(camps.length + 1);
  for (let q = 0; q < F.painted.length; q++) {
    const t = F.painted[q], T = territoryGrid[t];
    if (!T || (tiles && (tiles[t] & MASK_MOVE) !== 0)) continue;
    const d = d2i(t, camps[T - 1].site);
    if (d > far2[T]) far2[T] = d;
  }
  return far2;
}

/**
 * CAMPS_PER_ZONE camps per zone and their territories: up to CAMP_TRIES layouts. A layout fails when a zone cannot
 * seat its camps CAMP_GAP apart from each other and from every camp already placed, or when a territory reaches past
 * TERRITORY_RADIUS_MAX (measured on painted tiles here; the final map checks its floor again).
 */
export function placeCamps(rng: Rng, part: ZonePartition): CampLayout | null {
  const F = fixedLayout(), Z = zoneLayout();
  const { zone, cost } = part;
  const zoneTiles: Int32Array[] = [];
  for (let z = 1; z <= ZONES; z++) {
    const list: number[] = [];
    for (let q = 0; q < F.painted.length; q++) if (zone[F.painted[q]] === z) list.push(F.painted[q]);
    zoneTiles.push(Int32Array.from(list));
  }
  const gap2 = CAMP_GAP * CAMP_GAP;
  const radius2 = TERRITORY_RADIUS_MAX * TERRITORY_RADIUS_MAX;
  const terr = new Uint8Array(N), tm = new Uint8Array(N), zmask = new Uint8Array(N);
  const dt = new Int32Array(N), zdt = new Int32Array(N);
  // Per partition: territory n's tiles in index order at members[memberStart[n] ..), and its hull at hullOf[hullStart[n] ..).
  const members = new Int32Array(N), memberStart = new Int32Array(CAMPS_PER_ZONE + 2);
  const hullOf = new Int32Array(N + 2 * (CAMPS_PER_ZONE + 1)), hullStart = new Int32Array(CAMPS_PER_ZONE + 2);
  const territoryGrid = new Uint8Array(N);
  for (let tryNo = 0; tryNo < CAMP_TRIES; tryNo++) {
    const camps: CampSite[] = [];
    territoryGrid.fill(0);
    const placed: number[] = [];
    let ok = true;
    for (let z = 1; z <= ZONES && ok; z++) {
      const Zt = zoneTiles[z - 1];
      zmask.fill(0);
      for (let q = 0; q < Zt.length; q++) zmask[Zt[q]] = 1;
      chamfer(zmask, zdt);
      const sites: number[] = [];
      for (let q = 0; q < Zt.length; q++) if (Z.haloOK[Zt[q]] && zdt[Zt[q]] >= HALO_DT) sites.push(Zt[q]);
      // Sites CAMP_GAP from every camp of the zones already placed (they do not move while this zone seeds).
      const clear = new Uint8Array(sites.length);
      for (let q = 0; q < sites.length; q++) {
        clear[q] = 1;
        for (const o of placed) if (d2i(o, sites[q]) < gap2) { clear[q] = 0; break; }
      }
      const k = CAMPS_PER_ZONE;
      // Seeds for coverage (k-center): the first by best-candidate sampling, each next one at the open site nearest the
      // zone tile farthest from the seeds so far, so no part of the zone is left far from every camp. Each tile's distance to
      // the nearest seed and each site's spacing are kept up to date as seeds are added (the same answers as a full rescan).
      let at = bestCandidates(rng, sites, 1, CAMP_CANDIDATES, placed, gap2);
      const minD = new Int32Array(Zt.length).fill(1 << 30);
      const spaced = clear.slice();
      let seen = 0;
      while (at.length > 0 && at.length < k) {
        for (; seen < at.length; seen++) {
          const o = at[seen];
          for (let q = 0; q < Zt.length; q++) { const d = d2i(o, Zt[q]); if (d < minD[q]) minD[q] = d; }
          for (let q = 0; q < sites.length; q++) if (spaced[q] && d2i(o, sites[q]) < gap2) spaced[q] = 0;
        }
        let far = -1, farD = -1;
        for (let q = 0; q < Zt.length; q++) if (minD[q] > farD) { farD = minD[q]; far = Zt[q]; }
        let next = -1, nextD = 1 << 30;
        for (let q = 0; q < sites.length; q++) {
          if (!spaced[q]) continue;
          const c = sites[q];
          const d = d2i(c, far);
          if (d < nextD) { nextD = d; next = c; }
        }
        if (next < 0) break;
        at.push(next);
      }
      if (at.length < k) { ok = false; failed("campSeeds"); break; }
      // The best open cell near the pole of territory n: the most inaccessible cell (5/7 chamfer, ties to the lowest
      // index) whose halo lies inside that territory and the zone, CAMP_GAP from every camp placed so far, from this
      // zone's sites already moved and from the ones still to move. The old site is the fallback. With `reach`, only
      // cells within TERRITORY_RADIUS_MAX of every tile of the territory qualify (the pole of a territory that is fat at
      // one end lies there, far from the other end), and -1 means there is none.
      const poleOf = (n: number, cur: number[], fixedSites: readonly number[], reach: boolean): number => {
        const h0 = hullStart[n], h1 = reach ? hullStart[n + 1] : h0;
        const within = (t: number): boolean => {
          for (let v = h0; v < h1; v++) if (d2i(hullOf[v], t) > radius2) return false;
          return true;
        };
        let best = reach && !within(cur[n - 1]) ? -1 : cur[n - 1], bestV = -1;
        for (let q = memberStart[n]; q < memberStart[n + 1]; q++) {
          const t = members[q];
          if (!Z.haloOK[t] || dt[t] < bestV || (dt[t] === bestV && best >= 0 && t > best)) continue;
          let inside = true;
          for (let h = 0; h < HALO_OFF.length && inside; h++) if (terr[t + HALO_OFF[h]] !== n || zone[t + HALO_OFF[h]] !== z) inside = false;
          if (!inside) continue;
          let far = true;
          for (const o of fixedSites) if (d2i(o, t) < gap2) { far = false; break; }
          for (let m = n; m < cur.length && far; m++) if (d2i(cur[m], t) < gap2) far = false;
          if (!far || (reach && !within(t))) continue;
          best = t;
          bestV = dt[t];
        }
        return best;
      };
      // Territories from the halos (each holds its halo: halos are sources), then Lloyd steps: each camp moves to the
      // pole of its territory and the zone is partitioned again. From the second partition on, the camps stand at the
      // poles of their territories as soon as every territory has one in reach of all its tiles; otherwise they move on.
      let final: number[] | null = null;
      for (let step = 0; step < LLOYD_STEPS && !final; step++) {
        for (let q = 0; q < Zt.length; q++) terr[Zt[q]] = 0;
        at.forEach((s, n) => { for (let h = 0; h < HALO_OFF.length; h++) terr[s + HALO_OFF[h]] = n + 1; });
        voronoi(zmask, Zt, terr, cost);
        tm.fill(0);
        for (let q = 0; q < Zt.length; q++) tm[Zt[q]] = terr[Zt[q]];
        chamferLabels(tm, dt);
        // Each territory's tiles (index order) and their hull, for the pole searches below.
        memberStart.fill(0);
        for (let q = 0; q < Zt.length; q++) memberStart[terr[Zt[q]] + 1]++;
        for (let n = 1; n <= k + 1; n++) memberStart[n] += memberStart[n - 1];
        const fill = memberStart.slice();
        for (let q = 0; q < Zt.length; q++) members[fill[terr[Zt[q]]]++] = Zt[q];
        hullStart[1] = 0;
        for (let n = 1; n <= k; n++) {
          const from = memberStart[n], len = memberStart[n + 1] - from;
          hullStart[n + 1] = hullStart[n] + hull(members.subarray(from, from + len), len, hullOf.subarray(hullStart[n]));
        }
        if (step >= 1) {
          const sites = at.slice(), fixedSites = placed.slice();
          let all = true;
          for (let n = 1; n <= k && all; n++) {
            const site = poleOf(n, sites, fixedSites, true);
            if (site < 0) { all = false; break; }
            fixedSites.push(site);
            sites[n - 1] = site;
          }
          if (all) { final = sites; break; }
        }
        const moved: number[] = [];
        for (let n = 1; n <= k; n++) {
          const fixedSites = placed.concat(moved), near = poleOf(n, at, fixedSites, true);
          moved.push(near >= 0 ? near : poleOf(n, at, fixedSites, false));
        }
        at = moved;
      }
      if (!final) { ok = false; failed("campRadius"); break; }
      const base = camps.length;
      for (const site of final) {
        placed.push(site);
        camps.push({ zone: z, site, elite: false, spots: [] });
      }
      // The elite camps: the zone's camp farthest from the centre, then the next farthest at least ELITE_MIN_SEP from it (else the
      // second farthest). Ties go to the earlier camp.
      const byFar: number[] = [];
      for (let c = base; c < camps.length; c++) byFar.push(c);
      const centre = CY * W + CX;
      byFar.sort((a, b) => d2i(camps[b].site, centre) - d2i(camps[a].site, centre) || a - b);
      const first = byFar[0];
      let second = -1;
      for (let k = 1; k < byFar.length && second < 0; k++) if (d2i(camps[byFar[k]].site, camps[first].site) >= ELITE_MIN_SEP * ELITE_MIN_SEP) second = byFar[k];
      if (second < 0) { second = byFar[1]; note("eliteNear"); }
      camps[first].elite = true;
      camps[second].elite = true;
      for (let q = 0; q < Zt.length; q++) territoryGrid[Zt[q]] = base + terr[Zt[q]];
    }
    if (!ok) continue;
    return { camps, territoryGrid };
  }
  return failed("camps");
}

/**
 * After the stylers and the nets: each territory's floor must be one 4-connected piece holding its camp. A floor piece cut off (by
 * a landmark wall or a styler wall) joins the same-zone territory whose floor it touches most. A piece that touches
 * only other zones' floor, of at most STRAY_MAX tiles, is walled up when it holds nothing in `keepOpen` and the rest of the
 * floor stays one piece without it (the zone keeps its painted area: nothing changes zone); otherwise it changes zone;
 * bits of its old zone's painted area that this cuts
 * off join the zone they touch, and the painted areas are evened out again by trading boundary WALL tiles only (floor
 * stays where the repair put it). Returns how many tiles changed zone, or null when a cut-off piece cannot be placed
 * (the attempt fails). `zone` and `territoryGrid` are updated in place.
 */
export function repairTerritories(
  tiles: Uint8Array, zone: Uint8Array, camps: readonly CampSite[], territoryGrid: Uint8Array, keepOpen: Uint8Array,
): number | null {
  const F = fixedLayout();
  const comp = new Int32Array(N);
  const queue = new Int32Array(N);
  const isFloor = (i: number): boolean => (tiles[i] & MASK_MOVE) === 0;
  let stray = 0, rezoned = 0;
  let floorTotal = 0;
  for (let i = 0; i < N; i++) if (isFloor(i)) floorTotal++;
  const flood = new Int32Array(N), floodMark = new Int32Array(N);
  let floodNow = 0;
  // Could the piece in queue[0..n) be walled up: nothing in it is kept open, and the rest of the floor is still one piece?
  const wallable = (n: number): boolean => {
    for (let k = 0; k < n; k++) if (keepOpen[queue[k]]) return false;
    floodNow++;
    // Mark the piece as visited so the walk around it cannot enter it, then walk the rest of the floor from the centre.
    const piece = floodNow;
    for (let k = 0; k < n; k++) floodMark[queue[k]] = piece;
    floodNow++;
    const start = CY * W + CX;
    let head = 0, tail = 0, seen = 0;
    flood[tail++] = start;
    floodMark[start] = floodNow;
    while (head < tail) {
      const i = flood[head++];
      seen++;
      for (let e = 0; e < 4; e++) {
        const j = i + NB4[e];
        if (floodMark[j] !== piece && floodMark[j] !== floodNow && isFloor(j)) { floodMark[j] = floodNow; flood[tail++] = j; }
      }
    }
    return seen === floorTotal - n;
  };
  for (let round = 0; round < 8; round++) {
    comp.fill(-1);
    let moved = false;
    stray = 0;
    for (let ci = 0; ci < camps.length; ci++) {
      const T = ci + 1, s = camps[ci].site;
      let head = 0, tail = 0;
      queue[tail++] = s;
      comp[s] = T;
      while (head < tail) {
        const i = queue[head++];
        for (let e = 0; e < 4; e++) {
          const j = i + NB4[e];
          if (comp[j] < 0 && isFloor(j) && territoryGrid[j] === T) { comp[j] = T; queue[tail++] = j; }
        }
      }
    }
    for (let q = 0; q < F.painted.length; q++) {
      const s = F.painted[q];
      if (!isFloor(s) || comp[s] >= 0) continue;
      const T = territoryGrid[s];
      let head = 0, tail = 0;
      queue[tail++] = s;
      comp[s] = 0;
      const touch = new Int32Array(camps.length + 1);
      while (head < tail) {
        const i = queue[head++];
        for (let e = 0; e < 4; e++) {
          const j = i + NB4[e];
          if (!isFloor(j) || !zone[j]) continue;
          if (territoryGrid[j] === T) { if (comp[j] < 0) { comp[j] = 0; queue[tail++] = j; } }
          else if (zone[j] === zone[s] && comp[j] > 0) touch[territoryGrid[j]]++;
        }
      }
      // The piece joins the territory it touches most, among those whose camp keeps the whole piece within TERRITORY_RADIUS_MAX.
      let bestT = 0, bestFits = false;
      for (let u = 1; u <= camps.length; u++) {
        if (touch[u] <= 0) continue;
        let fits = true;
        for (let k = 0; k < tail && fits; k++) fits = d2i(camps[u - 1].site, queue[k]) <= TERRITORY_RADIUS_MAX * TERRITORY_RADIUS_MAX;
        if (bestT === 0 || (fits && !bestFits) || (fits === bestFits && touch[u] > touch[bestT])) { bestT = u; bestFits = fits; }
      }
      // Only other zones' floor around it: from the second round on (when no same-zone home appeared), a small piece
      // changes zone and its tiles join the territory it opens onto most.
      if (bestT > 0 && tail <= WALL_UP_MAX) {
        // Joining would stretch the territory past TERRITORY_RADIUS_MAX from its camp: wall the piece up if it can be.
        const site = camps[bestT - 1].site;
        let far = false;
        for (let k = 0; k < tail && !far; k++) far = d2i(site, queue[k]) > TERRITORY_RADIUS_MAX * TERRITORY_RADIUS_MAX;
        if (far && wallable(tail)) {
          for (let k = 0; k < tail; k++) tiles[queue[k]] = TILE_WALL;
          floorTotal -= tail;
          moved = true;
          continue;
        }
      }
      if (bestT === 0 && tail <= WALL_UP_MAX && round > 0 && wallable(tail)) {
        for (let k = 0; k < tail; k++) tiles[queue[k]] = TILE_WALL;
        floorTotal -= tail;
        moved = true;
        continue;
      }
      if (bestT === 0 && tail <= STRAY_MAX && round > 0) {
        const other = new Int32Array(camps.length + 1);
        for (let k = 0; k < tail; k++) {
          for (let e = 0; e < 4; e++) {
            const j = queue[k] + NB4[e];
            if (isFloor(j) && zone[j] && zone[j] !== zone[s] && comp[j] > 0) other[territoryGrid[j]]++;
          }
        }
        for (let u = 1; u <= camps.length; u++) if (other[u] > 0 && (bestT === 0 || other[u] > other[bestT])) bestT = u;
        if (bestT > 0) {
          const nz = camps[bestT - 1].zone;
          for (let k = 0; k < tail; k++) zone[queue[k]] = nz;
          rezoned += tail;
        }
      }
      if (bestT === 0) { stray++; continue; }
      for (let k = 0; k < tail; k++) territoryGrid[queue[k]] = bestT;
      moved = true;
    }
    if (!moved) break;
  }
  if (stray > 0) return failed("A:terrStray");
  if (rezoned === 0) return 0;

  const quota = quotas(F.painted.length);
  // Tiles that may not change zone while the areas are evened out: every floor tile (the repair placed them) and the ring road.
  const keep = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (isFloor(i) || F.ring[i]) keep[i] = 1;
  const lab = new Int32Array(N);
  for (let round = 0; round < 4; round++) {
    lab.fill(0);
    let changed = false;
    // The main body of each zone: what its first camp reaches through its own zone.
    for (let z = 1; z <= ZONES; z++) {
      const start = camps.find((c) => c.zone === z)!.site;
      let head = 0, tail = 0;
      queue[tail++] = start;
      lab[start] = 1;
      while (head < tail) {
        const i = queue[head++];
        for (let e = 0; e < 4; e++) { const j = i + NB4[e]; if (!lab[j] && zone[j] === z) { lab[j] = 1; queue[tail++] = j; } }
      }
    }
    // Every other piece of a zone joins the zone it touches most.
    for (let q = 0; q < F.painted.length; q++) {
      const s0 = F.painted[q];
      if (lab[s0]) continue;
      const z = zone[s0];
      let head = 0, tail = 0;
      queue[tail++] = s0;
      lab[s0] = 2;
      const near = new Int32Array(ZONES + 1);
      while (head < tail) {
        const i = queue[head++];
        for (let e = 0; e < 4; e++) {
          const j = i + NB4[e];
          if (!zone[j]) continue;
          if (zone[j] === z) { if (!lab[j]) { lab[j] = 2; queue[tail++] = j; } } else near[zone[j]]++;
        }
      }
      let nz = 0;
      for (let u = 1; u <= ZONES; u++) if (near[u] > 0 && (nz === 0 || near[u] > near[nz])) nz = u;
      if (nz === 0) return failed("A:zoneSplit");
      for (let k = 0; k < tail; k++) zone[queue[k]] = nz;
      changed = true;
    }
    // A trade that gets stuck stops the evening-out where it is: the areas are judged by the caller's spread check (AREA_TOLERANCE).
    balance(F.paintedMask, F.painted, zone, ZONES, quota, keep);
    if (!changed) break;
  }
  // Every painted tile in a territory of its own zone: a wall that moved zone takes a neighbouring territory of its new zone.
  for (let sweep = 0; ; sweep++) {
    let left = 0;
    for (let q = 0; q < F.painted.length; q++) {
      const t = F.painted[q], T = territoryGrid[t];
      if (T && camps[T - 1].zone === zone[t]) continue;
      let nt = 0;
      for (let e = 0; e < 4 && !nt; e++) {
        const j = t + NB4[e], u = territoryGrid[j];
        if (u && zone[j] === zone[t] && camps[u - 1].zone === zone[t]) nt = u;
      }
      if (nt) territoryGrid[t] = nt; else left++;
    }
    if (left === 0) break;
    if (sweep > 60) return failed("A:terrWalls");
  }
  return rezoned;
}
