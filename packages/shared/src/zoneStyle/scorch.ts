// Scorch (fire): Crater Basins (zone-shapes contract 4.1, options doc 6.1 option 2). Every camp of the zone sits in a basalt crater
// (a jagged one-tile rim of radius 5-6.5 tiles, up to 7.5 for an elite camp) that opens through 2-3 named breaches, each aimed at a
// neighbour on the camp graph (the MST of the zone's 8 camps and its front door, plus Brogue-style shortcuts); between the craters
// lies open ash, crossed by one lava river with fords (4 path steps, a gap 3-5 tiles wide) where the camp routes and the spawn
// members' walks cross it; the river's banks and fords are ember. The burnt-out forge is the zone's landmark. Fire is exempt from ember.
//
// Everything goes through placeFeature as a named feature: "crater" (job pen) with the camp's bowl as owned floor, "lavaRiver"
// (job crossing) with its fords as owned floor, "landmark" forge (jobs landmark, lee). Integer geometry and the kit's noise only:
// no trig, no Math.random; doubles appear only from + - * / and sqrt, which are exact on every engine. Seeded: the shape stream
// (the river's two draws) and the pass's noise; the craters and the forge are pure functions of the ground.
//
// The route guard (contract 3.9) is honoured before the fact, because a placed feature cannot be taken back: a crater gets an extra
// breach where a spawn member's corridor (the guard's 3-wide band along its walk) would be cut by the rim (as long as the crater
// keeps 60% of its rim), the river gets a ford where a corridor meets its band, and the ember stays off the bank along a corridor.
// The contract's `worstStretch()` is not called: it can only report what a feature has already done.
//
// Deviations from the contract text, with reasons (the WP1 report lists them with numbers):
//  - the rim is the ideal one-tile ring pushed in and out by a smooth noise along the ring, its gaps filled by lines, not the
//    jittered annulus of the raster (that one tears into arcs under 6 tiles); the second tile, the breaches' order and the
//    "no arc under 6" rule are the contract's. A breach is 2.25 tiles each side (the doc's 4-5 tiles), not 2.5: with 2.5 the rays
//    at bow range lie above the 48-64% window.
//  - a crater by the zone's edge keeps one skeleton breach and counts the frontier side as the second (p[2], p[3..]).
//  - the river is a stretch of about 54 x lenScale path steps, not the zone's whole width (a strip zone is 100+ tiles across: the
//    lava would be twice the 70-160 window and the footprint would not hold with the craters), placed at 45-75% of the zone's depth
//    where the fewest spawn walks cross it, and its fords are planned per candidate stretch (a window search).
//  - the forge keeps R_est + 3 from the camp centres (R_est + 2 when that leaves no room); a pre-filter leaves out the tiles the
//    guard would refuse (the simple-point test at a territory's neck) because a landmark is whole or nothing.
//
import { TILE_FLOOR, TILE_WALL } from "../map";
import { TERRAIN_EMBER, TERRAIN_NONE } from "../terrain";
import { DIR8 } from "./kit";
import {
  ROUTE_STRETCH_MAX, addShortcuts, campNodes, dirIndex16, dirSep16, dist2, inBeam, noiseQ, noisyPath, primMST, pseudoAngle, segDist2,
} from "./features";
import type { Edge, Node } from "./features";
import { bestLandmark, stampTemplate } from "./landmarks";
import type { LandmarkTemplate, Stamp } from "./landmarks";
import { PROP } from "./propKinds";
import { FEATURE_MIN_PIECE } from "./types";
import type { BaseCtx, CampInfo, LandmarkCtx, PropCtx, RouteGuard, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";
import { RING_DX, RING_DY, SIMPLE } from "../gridTopology";
import { areaScale, LANDMARKS_PER_ZONE, lenScale } from "./scale";

// ------------------------------------------------------------------------------------------------ numbers
/** A crater that, whatever its breaches, stretches a spawn member's walk past this (permille) is left out. */
const CRATER_STRETCH_MAX = 1050;
/** Crater radius band in quarter tiles: floor(4 x clamp(near / 2 - 0.8, 5.0, 6.5)) tiles, an elite camp up to 7.5. */
const R_MIN4 = 20, R_MAX4 = 26, R_MAX4_ELITE = 30;
/** A breach is a strip 2.25 tiles each side of the bearing (4.5 wide; contract 4.1 says 2.5, the doc says 4-5 tiles), in quarter tiles. */
const BREACH_HALF4 = 9;
const BREACHES_MIN = 2;
/** Skeleton breaches per crater (corridor breaches come on top). */
const BREACHES_MAX = 3;
/** A smaller radius wins when its ring is this many permille freer. */
const FREER_PERMILLE = 30;
/** The rim is kept when this share of its planned tiles stands. */
const RIM_KEEP_PERMILLE = 600;
/** A crater with fewer rim tiles than this (after the short arcs go) is not built: the camp stays open. */
const RIM_MIN = 8;
/** The guard's margin from a zone's edge in chamfer thirds (rimTiles 3 x 3); a crater whose ring the edge takes is a crescent. */
const FRONTIER_EDGE = 9;
/** A ring of which the zone's edge takes this many tiles is open on that side: the frontier counts as a breach (contract 4.1). */
const FRONTIER_MIN = 8;
/** The second tile of the rim: noise above this (of 1023) puts one outward of a rim tile, about three in ten. */
const SECOND_TILE_Q = 716;
/** Brogue shortcut test: the tree walk must be at least this many times the straight line, up to this many tiles long. */
const LOOP_RATIO = 1.8, LOOP_MAX_LEN = 30;

/** A ford is FORD_STEPS path steps of the river left out; edge fords keep FORD_SPACING steps apart. */
const FORD_STEPS = 4, FORD_SPACING = 9;
/** Fords closer than FORD_MERGE steps become one (up to FORD_MAX_LEN steps long); the camp routes get about one ford per FORD_PER_STEPS steps. */
const FORD_MERGE = 4, FORD_MAX_LEN = 12, FORD_PER_STEPS = 16;
const RIVER_MIN_STEPS = 12;
/** The river is about RIVER_STEPS_PER_LEN x lenScale path steps long (54 x 1.44 = 78 at 136); its path may run RIVER_REACH times that before a stretch is cut from it. */
const RIVER_STEPS_PER_LEN = 54, RIVER_REACH = 1.8;
/** The lava a stretch should hold (contract 4.1: 70-160 tiles per zone). */
const LAVA_WANT_LO = 85, LAVA_WANT_HI = 140;
/** The river's depth, as shares of the zone's depth (contract 4.1: 40-60%); the least crossed by spawn walks wins. */
const RIVER_DEPTHS: readonly number[] = [0.45, 0.55, 0.65, 0.75];
/** Ground within this many tiles of the river's depth counts as ground the river can follow (it wanders round the craters). */
const RIVER_SLACK = 7;
/** A forge keeps R_est + 3 tiles from every camp centre (R_est + 2 when that leaves no room), and FORGE_DISC from another forge. */
const FORGE_MARGINS: readonly number[] = [3, 2];
const FORGE_DISC = 12;
const FORGE_TRIES = 48;

export interface ScorchCrater {
  /** CampInfo.index of the camp. */
  readonly camp: number;
  /** Camp centre tile. */
  readonly x: number;
  readonly y: number;
  /** Radius in quarter tiles. */
  readonly r4: number;
  /** Breach bearings as DIR16 indices (the feature's params). */
  readonly dirs: readonly number[];
  /** Rim wall tiles that stand, in write order. */
  readonly rim: readonly number[];
}

export interface ScorchPlan {
  /** Tiles of the river's centre line, in flow order (empty when no river fitted). */
  riverPath: number[];
  /** Centre tile of each ford. */
  fords: number[];
  /** Lava tiles that stand. */
  lava: number[];
  /** Bank tiles on a spawn member's corridor that are no ford's: they stay plain ground (the spawn gate caps the hazards on a walk). */
  noEmber: number[];
  /** The craters that stand, in camp order. */
  craters: ScorchCrater[];
  /** Skeleton edges (the MST of the camps and the door, plus the shortcuts) and the shortcuts among them. */
  edges: number;
  loops: number;
}

// ------------------------------------------------------------------------------------------------ the landmark: the burnt-out forge
/** Contract 5.2, orientation 0 (9x7): two doors, a crate nook in two corners, a six-tile hearth. */
export const FORGE: LandmarkTemplate = {
  key: "forge",
  jobs: ["landmark", "lee"],
  rows: [
    "###dd####",
    "#c......#",
    "#.......#",
    "#..###..#",
    "#..###..d",
    "#c......d",
    "#########",
  ],
};
/** The landmark templates of this zone (index.ts and the generator's crates find them here). */
export const SCORCH_LANDMARKS: readonly LandmarkTemplate[] = [FORGE];

// ------------------------------------------------------------------------------------------------ helpers
/** The zone's own camps (c.camps lists every camp of the map), in CampInfo order. */
function zoneCamps(c: BaseCtx): CampInfo[] {
  return c.camps.filter((k) => c.mask[k.y * c.w + k.x] === 1);
}

/** R4 for a camp: floor(4 * clamp(near / 2 - 0.8, 5.0, 6.5)), the elite's cap 7.5. */
function radius4(camp: CampInfo, mine: readonly CampInfo[]): number {
  const hi = camp.elite ? R_MAX4_ELITE : R_MAX4;
  let near2 = -1;
  for (const o of mine) {
    if (o === camp) continue;
    const d = dist2(camp.x, camp.y, o.x, o.y);
    if (near2 < 0 || d < near2) near2 = d;
  }
  if (near2 < 0) return hi;
  const r4 = Math.floor(2 * Math.sqrt(near2) - 3.2);
  return r4 < R_MIN4 ? R_MIN4 : r4 > hi ? hi : r4;
}

/** Unit axis from the coliseum centre to the zone's centroid, its perpendicular, and depth / lateral readers. */
interface Frame { ux: number; uy: number; vx: number; vy: number; cx: number; cy: number }
function frameOf(c: BaseCtx): Frame {
  const cx = c.w / 2, cy = c.h / 2;
  let ux = c.zone.centroid.x - cx, uy = c.zone.centroid.y - cy;
  const m = Math.sqrt(ux * ux + uy * uy);
  if (m > 0) { ux /= m; uy /= m; } else { ux = 1; uy = 0; }
  return { ux, uy, vx: -uy, vy: ux, cx, cy };
}
const depthAt = (f: Frame, x: number, y: number): number => (x - f.cx) * f.ux + (y - f.cy) * f.uy;
const latAt = (f: Frame, x: number, y: number): number => (x - f.cx) * f.vx + (y - f.cy) * f.vy;

/** The camp graph: nodes = camps (CampInfo order) + the front door; Prim MST from the door, plus up to LOOPS_MAX shortcuts. */
function skeletonOf(c: BaseCtx, mine: readonly CampInfo[]): { nodes: Node[]; edges: Edge[]; loops: number } {
  const nodes = campNodes({ ...c, camps: mine });
  const root = nodes.length > mine.length ? nodes.length - 1 : 0;
  const edges = nodes.length > 0 ? primMST(nodes, root) : [];
  const loopsMax = Math.round(areaScale(c.zone.painted));
  addShortcuts(nodes, edges as Edge[], loopsMax, LOOP_RATIO, LOOP_MAX_LEN);
  return { nodes, edges, loops: Math.max(0, edges.length - (nodes.length - 1)) };
}

type Beam = readonly [number, number];

/** Breach vectors of camp i: toward its skeleton neighbours (nearest first, at most BREACHES_MAX, at least 3 steps of the 16 apart), at least two. */
function breachesOf(i: number, nodes: readonly Node[], edges: readonly Edge[]): Beam[] {
  const me = nodes[i];
  const others: { j: number; d2: number }[] = [];
  for (const [a, b] of edges) {
    const j = a === i ? b : b === i ? a : -1;
    if (j >= 0) others.push({ j, d2: dist2(me.x, me.y, nodes[j].x, nodes[j].y) });
  }
  others.sort((p, q) => p.d2 - q.d2 || p.j - q.j);
  const out: Beam[] = [];
  const dirs: number[] = [];
  const take = (u: Beam): boolean => {
    const d = dirIndex16(u[0], u[1]);
    for (const e of dirs) if (dirSep16(d, e) < 3) return false;
    out.push(u);
    dirs.push(d);
    return true;
  };
  for (const o of others) {
    if (out.length >= BREACHES_MAX) break;
    take([nodes[o.j].x - me.x, nodes[o.j].y - me.y]);
  }
  if (out.length < BREACHES_MIN) {
    // toward the nearest node whose bearing is at least 3 steps from every breach so far; none: opposite the first
    const rest: { j: number; d2: number }[] = [];
    for (let j = 0; j < nodes.length; j++) if (j !== i) rest.push({ j, d2: dist2(me.x, me.y, nodes[j].x, nodes[j].y) });
    rest.sort((p, q) => p.d2 - q.d2 || p.j - q.j);
    for (const o of rest) {
      if (out.length >= BREACHES_MIN) break;
      take([nodes[o.j].x - me.x, nodes[o.j].y - me.y]);
    }
    if (out.length === 0) take([1, 0]);
    if (out.length < BREACHES_MIN) take([-out[0][0], -out[0][1]]);
  }
  return out;
}

/** One camp's rim raster: the jitter and second-tile noise are cached per tile, the rim is cut for any radius and breach set. */
interface Raster {
  /** Ordered rim tiles for a radius and breaches: first ring, jagged, a 30% second tile, ordered by angle from just past breach 0. */
  rim(r4: number, beams: readonly Beam[]): number[];
  /** Permille of the ideal one-tile ring (no jitter, no breaches) that is not open ground. */
  blocked(r4: number): number;
  /** Tiles of the bowl: inside radius - 0.5. */
  bowl(r4: number): number[];
  /** The ideal ring tiles the zone's edge takes (outside the zone or inside its 3-tile margin): their number and summed offsets. */
  frontier(r4: number): { count: number; sx: number; sy: number };
}

function rasterOf(c: ShapeCtx | LandmarkCtx, camp: CampInfo, k: number): Raster {
  const { w, h, mask } = c;
  const reach = Math.ceil(R_MAX4_ELITE / 4 + 2.4) + 1;
  // the ideal ring of a radius (tile centres in [R - 0.5, R + 0.5)), cached: dx, dy, distance, pseudo-angle
  const ringCache = new Map<number, { dx: number; dy: number; d: number; pa: number }[]>();
  const ringOf = (r4: number): { dx: number; dy: number; d: number; pa: number }[] => {
    let ring = ringCache.get(r4);
    if (ring) return ring;
    const R = r4 / 4;
    const lo2 = (R - 0.5) * (R - 0.5), hi2 = (R + 0.5) * (R + 0.5);
    ring = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 >= lo2 && d2 < hi2) ring.push({ dx, dy, d: Math.sqrt(d2), pa: pseudoAngle(dx, dy) });
      }
    }
    ringCache.set(r4, ring);
    return ring;
  };
  const line = (x0: number, y0: number, x1: number, y1: number, out: number[]): void => {
    // the tiles strictly between two tiles, one per step of the longer axis (Bresenham, integers)
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let s = 1; s < n; s++) out.push(x0 + Math.floor((2 * (x1 - x0) * s + n) / (2 * n)), y0 + Math.floor((2 * (y1 - y0) * s + n) / (2 * n)));
  };
  return {
    rim(r4, beams) {
      const R = r4 / 4;
      const pa0 = beams.length > 0 ? pseudoAngle(beams[0][0], beams[0][1]) : 0;
      // the ideal ring in angle order from just past breach 0: the arc length along it is the index (a smooth noise along it
      // gives the rim its lean in and out, and the seam where the noise would jump lies inside breach 0)
      const ring = ringOf(r4).map((t) => ({ t, key: (t.pa - pa0 + 4) % 4 })).sort((p, q) => p.key - q.key || p.t.dy - q.t.dy || p.t.dx - q.t.dx);
      const out: number[] = [];
      const seen = new Set<number>();
      const put = (x: number, y: number): void => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const i = y * w + x;
        if (seen.has(i)) return;
        seen.add(i);
        out.push(i);
      };
      let px = 0, py = 0, prev = -2;
      for (let q = 0; q < ring.length; q++) {
        const { dx, dy, d } = ring[q].t;
        if (beams.some((b) => inBeam(dx, dy, b[0], b[1], BREACH_HALF4))) { prev = -2; continue; }
        const j = ((noiseQ(c, q, 0, 3, 41 + k) - 512) * 1.1) / 512;
        const f = (R + j) / d;
        const rx = camp.x + Math.floor(dx * f + 0.5), ry = camp.y + Math.floor(dy * f + 0.5);
        if (prev === q - 1 && (Math.abs(rx - px) > 1 || Math.abs(ry - py) > 1)) {
          const fill: number[] = [];
          line(px, py, rx, ry, fill);
          for (let m = 0; m < fill.length; m += 2) put(fill[m], fill[m + 1]);
        }
        put(rx, ry);
        // about three tiles in ten get a second tile outward
        if (noiseQ(c, rx, ry, 5, 77 + k) > SECOND_TILE_Q) put(camp.x + Math.floor(dx * ((R + j + 1) / d) + 0.5), camp.y + Math.floor(dy * ((R + j + 1) / d) + 0.5));
        px = rx; py = ry; prev = q;
      }
      // only open ground, and not inside a breach after the lean
      return out.filter((i) => {
        if (!mask[i] || !c.open(i)) return false;
        const dx = (i % w) - camp.x, dy = Math.floor(i / w) - camp.y;
        for (const b of beams) if (inBeam(dx, dy, b[0], b[1], BREACH_HALF4)) return false;
        return true;
      });
    },
    blocked(r4) {
      const R = r4 / 4;
      const lo2 = (R - 0.5) * (R - 0.5), hi2 = (R + 0.5) * (R + 0.5);
      let total = 0, bad = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 < lo2 || d2 >= hi2) continue;
          total++;
          const x = camp.x + dx, y = camp.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x] || !c.open(y * w + x)) bad++;
        }
      }
      return total === 0 ? 1000 : Math.floor((bad * 1000) / total);
    },
    frontier(r4) {
      const R = r4 / 4;
      const lo2 = (R - 0.5) * (R - 0.5), hi2 = (R + 0.5) * (R + 0.5);
      let count = 0, sx = 0, sy = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 < lo2 || d2 >= hi2) continue;
          const x = camp.x + dx, y = camp.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) { count++; sx += dx; sy += dy; continue; }
          const i = y * w + x;
          if (!mask[i] || c.edgeDist[i] < FRONTIER_EDGE) { count++; sx += dx; sy += dy; }
        }
      }
      return { count, sx, sy };
    },
    bowl(r4) {
      const R = r4 / 4;
      const lim = (R - 0.5) * (R - 0.5);
      const out: number[] = [];
      for (let dy = -reach; dy <= reach; dy++) {
        const y = camp.y + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          if (dx * dx + dy * dy >= lim) continue;
          const x = camp.x + dx;
          if (x < 0 || x >= w) continue;
          const i = y * w + x;
          if (mask[i]) out.push(i);
        }
      }
      return out;
    },
  };
}


/** Keeps the 8-connected arcs of at least `min` tiles (the guard would give the shorter ones back anyway). */
function keepArcs(tiles: readonly number[], w: number, min: number): number[] {
  if (tiles.length < min) return [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tiles) {
    const x = t % w, y = (t - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const at = new Int16Array(bw * bh).fill(-1);
  tiles.forEach((t, q) => { const x = t % w, y = (t - x) / w; at[(y - y0) * bw + x - x0] = q; });
  const comp = new Int16Array(tiles.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let q = 0; q < tiles.length; q++) {
    if (comp[q] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    comp[q] = id;
    stack.push(q);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size++;
      const x = (tiles[cur] % w) - x0, y = Math.floor(tiles[cur] / w) - y0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const j = at[ny * bw + nx];
          if (j >= 0 && comp[j] < 0) { comp[j] = id; stack.push(j); }
        }
      }
    }
    sizes.push(size);
  }
  return tiles.filter((_, q) => sizes[comp[q]] >= min);
}

/** The zone's route guard, or null on a fixture that gave no builder. */
function guardOf(c: ShapeCtx): RouteGuard | null {
  try { return c.routeGuard(); } catch { return null; }
}

/**
 * Does a spawn member's corridor (the 3-wide band around its walk, contract 3.9) stay walkable from its tile to its far end when
 * the `walled` tiles are solid? 4-connected, so a diagonal chain of walls cuts it as it cuts a body. A feature cannot be taken
 * back once placed, so the stylers decide with this test before placing: a rim or a river only cuts a walk when it cuts the band.
 */
function makeBandCheck(c: ShapeCtx): (band: readonly number[], walled: readonly number[]) => boolean {
  const { w, h } = c;
  const n = w * h;
  const inBand = new Int32Array(n), seen = new Int32Array(n), solid = new Uint8Array(n);
  const queue = new Int32Array(n);
  let epoch = 0;
  return (band, walled) => {
    if (band.length < 12) return true;
    epoch++;
    for (const t of band) inBand[t] = epoch;
    for (const t of walled) solid[t] = 1;
    let ok = false;
    const start = band[0];
    if (c.tiles[start] === TILE_FLOOR && !solid[start]) {
      let head = 0, tail = 0;
      queue[tail++] = start;
      seen[start] = epoch;
      const visit = (j: number): void => {
        if (inBand[j] === epoch && seen[j] !== epoch && c.tiles[j] === TILE_FLOOR && !solid[j]) { seen[j] = epoch; queue[tail++] = j; }
      };
      while (head < tail) {
        const i = queue[head++];
        const x = i % w;
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (i >= w) visit(i - w);
        if (i < n - w) visit(i + w);
      }
      // the band's last sample: its final nine tiles
      for (let q = band.length - 9; q < band.length; q++) if (seen[band[q]] === epoch) { ok = true; break; }
    }
    for (const t of walled) solid[t] = 0;
    return ok;
  };
}

// ------------------------------------------------------------------------------------------------ craters
function placeCraters(c: ShapeCtx, mine: readonly CampInfo[], r4s: number[], nodes: readonly Node[], edges: readonly Edge[], G: RouteGuard | null, plan: ScorchPlan): void {
  const connected = G && G.members.length > 0 ? makeBandCheck(c) : null;
  const rimMark = connected ? new Uint8Array(c.w * c.h) : null;
  // The worst member stretch as the craters stand so far: a rim that touches a corridor is asked about (contract 4.1.6) and must not
  // push it past ROUTE_STRETCH_MAX (or past what it was: an earlier crater, a forge, may already stand over it).
  let stretch = G && G.members.length > 0 ? G.worstStretch() : 1000;
  for (let k = 0; k < mine.length; k++) {
    const camp = mine[k];
    const ras = rasterOf(c, camp, k);
    // the radius: the largest, unless a smaller one has a ring clearly freer
    let r4 = r4s[k];
    const cands = [r4];
    if (r4 - 4 >= R_MIN4) cands.push(r4 - 4);
    if (r4 - 8 >= R_MIN4) cands.push(r4 - 8);
    if (cands.length > 1) {
      const base = ras.blocked(cands[0]);
      let bestShare = base;
      for (let q = 1; q < cands.length; q++) {
        const s = ras.blocked(cands[q]);
        if (s + FREER_PERMILLE <= base && s < bestShare) { bestShare = s; r4 = cands[q]; }
      }
    }
    r4s[k] = r4;
    let beams = breachesOf(k, nodes, edges).slice();
    // A crater by the zone's edge is a crescent: the frontier side of the ring is open ground (the guard keeps walls three tiles
    // from the edge), which is a breach of its own, so the skeleton cuts it once, toward its nearest neighbour, and the flanks stay.
    const fr = ras.frontier(r4);
    let frontierDir = -1;
    if (fr.count >= FRONTIER_MIN && (fr.sx !== 0 || fr.sy !== 0)) {
      frontierDir = dirIndex16(fr.sx, fr.sy);
      beams = beams.filter((b) => dirSep16(dirIndex16(b[0], b[1]), frontierDir) >= 3).slice(0, 1);
      if (beams.length === 0) beams = breachesOf(k, nodes, edges).slice(0, 1);
    }
    let rim = keepArcs(ras.rim(r4, beams), c.w, FEATURE_MIN_PIECE);
    // route guard (contract 3.9): where the rim would cut a spawn member's corridor, one more breach at the crossing, as long as
    // the crater keeps at least 60% of the rim it would have without it (a pen with no wall is no pen: the spawn gate drops the
    // member whose walk it still cuts)
    const floorTiles = Math.max(10, Math.floor((rim.length * RIM_KEEP_PERMILLE) / 1000));
    if (G && connected && rimMark) {
      for (let guardIter = 0; guardIter < 4 && rim.length > 0; guardIter++) {
        for (const t of rim) rimMark[t] = 1;
        let cut: readonly number[] | null = null;
        let first = -1;
        for (let m = 0; m < G.members.length && !cut; m++) {
          const band = G.corridorOf(m);
          first = -1;
          for (let q = 0; q < band.length; q++) if (rimMark[band[q]] === 1) { first = q; break; }
          if (first < 0 || !connected(band, []) || connected(band, rim)) continue;
          cut = band;
        }
        let sx = 0, sy = 0, cnt = 0;
        if (cut) {
          const hx = cut[first] % c.w, hy = (cut[first] - hx) / c.w;
          for (const t of cut) {
            if (rimMark[t] !== 1) continue;
            const x = t % c.w, y = (t - x) / c.w;
            if (Math.abs(x - hx) <= 3 && Math.abs(y - hy) <= 3) { sx += x - camp.x; sy += y - camp.y; cnt++; }
          }
        }
        for (const t of rim) rimMark[t] = 0;
        if (!cut || cnt === 0) break;
        const bx = Math.round(sx / cnt), by = Math.round(sy / cnt);
        if (bx === 0 && by === 0) break;
        const more = keepArcs(ras.rim(r4, [...beams, [bx, by]]), c.w, FEATURE_MIN_PIECE);
        if (more.length < floorTiles) break;
        beams.push([bx, by]);
        rim = more;
      }
    }
    // The guard's word (contract 4.1.6): a rim that stretches a member's walk past the threshold gets one more breach where the
    // rim crosses the worst member's corridor (as above, while it keeps 60% of its rim), at most twice; a crater that still stretches
    // a walk past CRATER_STRETCH_MAX (the 5% the contract accepts elsewhere) is left out, the camp stays open ground.
    let over = false;
    if (G && G.members.length > 0 && rim.length >= RIM_MIN) {
      for (let tries = 0; ; tries++) {
        if (!G.touches(rim)) break;
        const s = G.worstStretch(rim);
        if (s <= Math.max(ROUTE_STRETCH_MAX, stretch)) { stretch = Math.max(stretch, s); break; }
        // a breach to add: the rim tiles on the worst member's corridor, around the first of them
        const band = G.corridorOf(G.worstMember());
        const onRim = new Set<number>(rim);
        let first = -1;
        for (let q = 0; q < band.length && first < 0; q++) if (onRim.has(band[q])) first = band[q];
        let more: number[] | null = null, bx = 0, by = 0;
        if (tries < 2 && first >= 0) {
          const hx = first % c.w, hy = (first - hx) / c.w;
          let sx = 0, sy = 0, cnt = 0;
          for (const t of band) {
            if (!onRim.has(t)) continue;
            const x = t % c.w, y = (t - x) / c.w;
            if (Math.abs(x - hx) <= 3 && Math.abs(y - hy) <= 3) { sx += x - camp.x; sy += y - camp.y; cnt++; }
          }
          bx = Math.round(sx / cnt); by = Math.round(sy / cnt);
          if (cnt > 0 && (bx !== 0 || by !== 0)) {
            const wider = keepArcs(ras.rim(r4, [...beams, [bx, by]]), c.w, FEATURE_MIN_PIECE);
            if (wider.length >= floorTiles) more = wider;
          }
        }
        if (more === null) {
          if (s > CRATER_STRETCH_MAX) over = true; else stretch = Math.max(stretch, s);
          break;
        }
        beams.push([bx, by]);
        rim = more;
      }
    }
    if (over || rim.length < RIM_MIN) continue;
    const dirs = beams.map((b) => dirIndex16(b[0], b[1]));
    if (frontierDir >= 0 && dirs.every((d) => dirSep16(d, frontierDir) >= 3)) dirs.push(frontierDir);
    const placed = c.placeFeature({
      kind: "crater",
      jobs: ["pen"],
      anchor: [camp.x, camp.y],
      params: [camp.index, r4, dirs.length, ...dirs],
      blocks: rim.map((i) => [i, "wall"] as const),
      floor: ras.bowl(r4),
      mode: "trim",
      minSharePermille: RIM_KEEP_PERMILLE,
    });
    if (placed) plan.craters.push({ camp: camp.index, x: camp.x, y: camp.y, r4, dirs, rim: placed.written });
  }
}

// ------------------------------------------------------------------------------------------------ the river
function placeRiver(c: ShapeCtx, mine: readonly CampInfo[], r4s: readonly number[], nodes: readonly Node[], edges: readonly Edge[], G: RouteGuard | null, plan: ScorchPlan): void {
  const { w, h } = c;
  const n = w * h;
  const rng = c.rng;
  const F = frameOf(c);
  // the zone's usable ground (the static rules) and its extent along and across the axis
  const bb = c.zone.bbox;
  const usable: number[] = [];
  let dLo = Infinity, dHi = -Infinity;
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const i = y * w + x;
      if (!c.open(i)) continue;
      usable.push(i);
      const d = depthAt(F, x + 0.5, y + 0.5);
      if (d < dLo) dLo = d;
      if (d > dHi) dHi = d;
    }
  }
  if (usable.length < 60) return;
  // 1. the depth, among RIVER_DEPTHS shares of the zone's (contract 4.1: 40-60%). The spawn members stand on one walking contour,
  //    mostly in the zone's inner half, and a river farther out crosses fewer of their walks (each crossing wants a ford, and a
  //    ford cuts a piece out of the river): the depth that spares the most walks and still has the longest ground wins.
  const target = Math.max(RIVER_MIN_STEPS + 8, Math.round(RIVER_STEPS_PER_LEN * lenScale(c.zone.painted)));
  const memberDepth: number[] = [];
  if (G) for (const m of G.members) memberDepth.push(depthAt(F, (m % w) + 0.5, Math.floor(m / w) + 0.5));
  const jitter = rng();
  interface Band { dR: number; latA: number; latB: number; score: number }
  let band: Band | null = null;
  for (const share of RIVER_DEPTHS) {
    const dq = dLo + (dHi - dLo) * (share + 0.04 * jitter);
    // 2. the lateral run of ground at that depth (bins of 2 tiles within RIVER_SLACK of it, gaps of three bins bridged); the run with
    //    the most camp routes crossing it is the river's reach, cut to RIVER_REACH x the target around the median of its routes
    let bandLo = Infinity, bandHi = -Infinity;
    for (const i of usable) {
      const x = i % w, y = (i - x) / w;
      if (Math.abs(depthAt(F, x + 0.5, y + 0.5) - dq) > RIVER_SLACK) continue;
      const l = latAt(F, x + 0.5, y + 0.5);
      if (l < bandLo) bandLo = l;
      if (l > bandHi) bandHi = l;
    }
    if (bandLo > bandHi) continue;
    const nBins = Math.floor((bandHi - bandLo) / 2) + 1;
    const cover = new Uint8Array(nBins);
    for (const i of usable) {
      const x = i % w, y = (i - x) / w;
      if (Math.abs(depthAt(F, x + 0.5, y + 0.5) - dq) > RIVER_SLACK) continue;
      cover[Math.floor((latAt(F, x + 0.5, y + 0.5) - bandLo) / 2)] = 1;
    }
    const routeLats: number[] = [];
    for (const [ea, eb] of edges) {
      const A = nodes[ea], B = nodes[eb];
      const da = depthAt(F, A.x + 0.5, A.y + 0.5) - dq, db = depthAt(F, B.x + 0.5, B.y + 0.5) - dq;
      if (da === db || (da < 0) === (db < 0)) continue;
      const t = da / (da - db), la = latAt(F, A.x + 0.5, A.y + 0.5), lb = latAt(F, B.x + 0.5, B.y + 0.5);
      routeLats.push(la + t * (lb - la));
    }
    let runLo = 0, runHi = nBins - 1, runScore = -Infinity;
    for (let b0 = 0; b0 < nBins;) {
      if (!cover[b0]) { b0++; continue; }
      let b1 = b0;
      while (b1 + 1 < nBins && (cover[b1 + 1] || (b1 + 2 < nBins && cover[b1 + 2]) || (b1 + 3 < nBins && cover[b1 + 3]))) b1++;
      const lo = bandLo + 2 * b0, hi = bandLo + 2 * b1 + 2;
      let nE = 0;
      for (const l of routeLats) if (l >= lo && l <= hi) nE++;
      const sc = Math.min(hi - lo, 2 * target) + 8 * nE;
      if (sc > runScore) { runScore = sc; runLo = b0; runHi = b1; }
      b0 = b1 + 1;
    }
    let latA = bandLo + 2 * runLo + 2, latB = bandLo + 2 * runHi;
    const reach = RIVER_REACH * target;
    if (latB - latA > reach) {
      const inRun = routeLats.filter((l) => l >= latA && l <= latB).sort((p1, p2) => p1 - p2);
      const mid = inRun.length > 0 ? inRun[inRun.length >> 1] : (latA + latB) / 2;
      const lo = Math.min(Math.max(mid - reach / 2, latA), latB - reach);
      latA = lo;
      latB = lo + reach;
    }
    // the walks this depth crosses: the members standing farther out than it
    let crossed = 0;
    for (const d of memberDepth) if (d > dq + 1) crossed++;
    const sc = Math.min(latB - latA, target) - 7 * crossed + 3 * Math.min(routeLats.length, 3);
    if (!band || sc > band.score) band = { dR: dq, latA, latB, score: sc };
  }
  if (!band) return;
  const { dR, latA, latB } = band;
  const nearestTo = (d: number, l: number): number => {
    const px = F.cx + d * F.ux + l * F.vx, py = F.cy + d * F.uy + l * F.vy;
    let best = -1, bd = Infinity;
    for (const i of usable) {
      const x = i % w, y = (i - x) / w;
      const e = (x + 0.5 - px) * (x + 0.5 - px) + (y + 0.5 - py) * (y + 0.5 - py);
      if (e < bd) { bd = e; best = i; }
    }
    return best;
  };
  const a = nearestTo(dR, latA);
  const b = nearestTo(dR + (rng() - 0.5) * 12, latB);
  if (a < 0 || b < 0 || a === b) return;
  // 3. the noisy cheapest path: +400 inside any crater (radius + 2.5), +8 per tile of depth off dR, ground the static rules refuse,
  //    and a little on the corridors of the spawn members (it crosses them, it does not run along them)
  const nearCrater = new Uint8Array(n);
  for (let q = 0; q < mine.length; q++) {
    const r = r4s[q] / 4 + 2.5, reach = Math.ceil(r);
    for (let dy = -reach; dy <= reach; dy++) {
      const y = mine[q].y + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -reach; dx <= reach; dx++) {
        const x = mine[q].x + dx;
        if (x >= 0 && x < w && dx * dx + dy * dy < r * r) nearCrater[y * w + x] = 1;
      }
    }
  }
  const cost = (j: number): number => {
    const x = j % w, y = (j - x) / w;
    const dd = depthAt(F, x + 0.5, y + 0.5) - dR;
    return (nearCrater[j] === 1 ? 400 : 0) + Math.floor((dd < 0 ? -dd : dd) * 8) + (c.open(j) ? 0 : 1000) + (G && G.corridor[j] === 1 ? 6 : 0);
  };
  const path = noisyPath(c, a, b, 11, cost);
  const len = path.length;
  if (len < RIVER_MIN_STEPS) return;
  // 4. the width at each step (2, 3 where the noise is high) and the square of tiles it would stamp
  const wd = new Uint8Array(len);
  const sq: number[][] = [];
  const corridorAt = new Uint8Array(len);
  for (let s = 0; s < len; s++) {
    wd[s] = noiseQ(c, s / 5, 3.3, 1, 13) > 716 ? 3 : 2;
    const x = path[s] % w, y = (path[s] - x) / w;
    const list: number[] = [];
    for (let oy = 0; oy < wd[s]; oy++) {
      for (let ox = 0; ox < wd[s]; ox++) {
        const t = c.at(x + ox - (wd[s] >> 1), y + oy - (wd[s] >> 1));
        if (t >= 0) { list.push(t); if (G && G.corridor[t] === 1) corridorAt[s] = 1; }
      }
    }
    sq.push(list);
  }
  // 5. the steps where a camp route (a skeleton edge, its middle 70%) passes within 3 tiles of the path
  const edgeAt: { k: number; d: number }[] = [];
  for (const [ea, eb] of edges) {
    const A = nodes[ea], B = nodes[eb];
    const ax = A.x + 0.15 * (B.x - A.x), ay = A.y + 0.15 * (B.y - A.y), bx = A.x + 0.85 * (B.x - A.x), by = A.y + 0.85 * (B.y - A.y);
    let bestS = -1, bestD = Infinity;
    for (let s = 0; s < len; s++) {
      const px = path[s] % w, py = (path[s] - px) / w;
      const d = segDist2(px, py, ax, ay, bx, by);
      if (d < bestD) { bestD = d; bestS = s; }
    }
    if (bestS >= 0 && bestD <= 9) edgeAt.push({ k: bestS, d: bestD });
  }
  edgeAt.sort((p, q) => p.d - q.d || p.k - q.k);
  // 6. fords of a stretch [s0, s1): a ford is a run of path steps the river leaves out, the tiles their squares would stamp stay
  //    floor and belong to the river; every other step of the stretch is lava
  type Ford = [number, number];
  const mark = new Uint8Array(n);
  const blocksFor = (s0: number, s1: number, fords: readonly Ford[]): { tiles: number[]; keepOut: number[] } => {
    mark.fill(0);
    const keepOut: number[] = [];
    const out = new Uint8Array(len);
    for (const [f0, f1] of fords) {
      for (let s = f0; s < f1; s++) {
        out[s] = 1;
        for (const t of sq[s]) if (mark[t] === 0) { mark[t] = 2; keepOut.push(t); }
      }
    }
    const tiles: number[] = [];
    for (let s = s0; s < s1; s++) {
      if (out[s]) continue;
      for (const t of sq[s]) if (mark[t] === 0) { mark[t] = 1; if (c.open(t)) tiles.push(t); }
    }
    return { tiles, keepOut };
  };
  const planFords = (s0: number, s1: number, corridorCap = Infinity): { fords: Ford[]; runsTotal: number; routes: number } => {
    let fords: Ford[] = [];
    const normalize = (list: Ford[]): Ford[] => {
      const sorted = list.map((f) => [Math.max(s0 + 1, f[0]), Math.min(s1 - 1, f[1])] as Ford).filter((f) => f[1] > f[0]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const o: Ford[] = [];
      for (const f of sorted) {
        const last = o.length > 0 ? o[o.length - 1] : null;
        if (last && f[0] - last[1] < FORD_MERGE && Math.max(last[1], f[1]) - last[0] <= FORD_MAX_LEN) last[1] = Math.max(last[1], f[1]);
        else o.push([f[0], f[1]]);
      }
      return o;
    };
    const apart = (k: number, gap: number): boolean => {
      for (const f of fords) if (k >= f[0] - gap && k < f[1] + gap) return false;
      return true;
    };
    const around = (k: number): Ford => [k - (FORD_STEPS >> 1), k - (FORD_STEPS >> 1) + FORD_STEPS];
    // a ford over each run of steps whose square meets a member's corridor (the route guard, contract 3.9)
    let runStart = -1, lastHit = -9;
    const runs: Ford[] = [];
    for (let s = s0; s < s1; s++) {
      if (!corridorAt[s]) continue;
      if (runStart >= 0 && s - lastHit <= 2) runs[runs.length - 1][1] = s + 1; else { runs.push([s, s + 1]); runStart = s; }
      lastHit = s;
    }
    for (const r of runs.slice(0, corridorCap)) {
      const need = FORD_STEPS - (r[1] - r[0]);
      fords.push(need > 0 ? [r[0] - (need >> 1), r[1] + need - (need >> 1)] : [r[0], r[1]]);
    }
    fords = normalize(fords);
    // a ford on each camp route that crosses the stretch, unless a ford (a corridor's) already stands on it, up to one per
    // FORD_PER_STEPS steps; two edge fords keep FORD_SPACING between them
    const wantEdge = Math.max(2, Math.round((s1 - s0) / FORD_PER_STEPS));
    let routes = 0;
    const edgeKs: number[] = [];
    for (const e of edgeAt) {
      if (routes >= wantEdge) break;
      if (e.k < s0 + 3 || e.k > s1 - 4) continue;
      if (fords.some((f) => e.k >= f[0] - 1 && e.k < f[1] + 1)) { routes++; continue; }
      if (edgeKs.some((k) => Math.abs(k - e.k) < FORD_SPACING)) continue;
      edgeKs.push(e.k);
      fords = normalize([...fords, around(e.k)]);
      routes++;
    }
    for (const q of [0.3, 0.7, 0.5]) {
      if (fords.length >= 2) break;
      const k = s0 + Math.floor((s1 - s0) * q);
      if (apart(k, 6)) fords = normalize([...fords, around(k)]);
    }
    return { fords, runsTotal: runs.length, routes };
  };
  // 7. the stretch: three lengths round the target, every third step as a start; the lava in range, every spawn corridor with a
  //    ford (or the first few), the most routes
  interface Cand { score: number; s0: number; s1: number; cap: number }
  const cands: Cand[] = [];
  const lengths = [target - 14, target, target + 14].filter((l, q, all) => l >= 24 && l <= len && all.indexOf(l) === q);
  if (lengths.length === 0) lengths.push(len);
  for (const L of lengths) {
    for (let s0 = 0; s0 + L <= len; s0 += 3) {
      // all of the spawn members' corridors get a ford, or the first few: a corridor left to the river costs its member a detour
      // (the spawn gate drops it if it comes to that), a ford costs lava
      for (const cap of [Infinity, 3, 2]) {
        const p = planFords(s0, s0 + L, cap);
        const lava = blocksFor(s0, s0 + L, p.fords).tiles.length;
        const pen = lava < LAVA_WANT_LO ? (LAVA_WANT_LO - lava) * 2 : lava > LAVA_WANT_HI ? (lava - LAVA_WANT_HI) : 0;
        const uncovered = p.runsTotal - Math.min(cap, p.runsTotal);
        cands.push({ score: -pen - 2 * Math.min(cap, p.runsTotal) - 9 * uncovered + 3 * Math.min(p.routes, 3) - 2 * Math.max(0, p.fords.length - 4), s0, s1: s0 + L, cap });
        if (p.runsTotal <= cap) break;
      }
    }
  }
  if (cands.length === 0) { cands.push({ score: 0, s0: 0, s1: len, cap: Infinity }); }
  cands.sort((p, q) => q.score - p.score || p.s0 - q.s0 || p.s1 - q.s1 || q.cap - p.cap);
  // 8. place the best stretch that stands (the guard may refuse ground); at most three tries
  const tried: Cand[] = [];
  for (const cand of cands) {
    if (tried.length >= 3) break;
    if (tried.some((t) => Math.abs(t.s0 - cand.s0) < 12 && Math.abs(t.s1 - cand.s1) < 12)) continue;
    tried.push(cand);
    // the candidate's corridors first, then fewer (a refused river is tried again with fewer fords, the spawn gate drops the members it cuts)
    for (const cap of [cand.cap, Math.min(cand.cap, 2), 0].filter((v, q, all) => all.indexOf(v) === q)) {
      const p = planFords(cand.s0, cand.s1, cap);
      const bl = blocksFor(cand.s0, cand.s1, p.fords);
      if (bl.tiles.length < 12) continue;
      let widthSum = 0, widthN = 0;
      for (let s = cand.s0; s < cand.s1; s++) {
        let inside = false;
        for (const f of p.fords) if (s >= f[0] && s < f[1]) { inside = true; break; }
        if (!inside) { widthSum += wd[s]; widthN++; }
      }
      const width2 = widthN > 0 ? Math.round((2 * widthSum) / widthN) : 4;
      const fordTiles = p.fords.map((f) => path[(f[0] + f[1]) >> 1]);
      // The river owns its ember bank (the surface pass cannot own a tile; the shape gates want every changed tile owned): the free
      // floor round the lava it plans, off the spawn corridors except at a ford (the rule `plan.noEmber` applies to the lava that
      // stands). Floor a refused lava tile leaves unlit stays owned plain floor.
      const fordSet = new Set<number>(bl.keepOut);
      const bank = new Set<number>();
      for (const t of bl.tiles) {
        const x = t % w, y = (t - x) / w;
        for (const [dx, dy] of DIR8) {
          const j = c.at(x + dx, y + dy);
          if (j >= 0 && c.tiles[j] === TILE_FLOOR && !fordSet.has(j) && !(G && G.members.length > 0 && G.corridor[j] === 1)) bank.add(j);
        }
      }
      const placed = c.placeFeature({
        kind: "lavaRiver",
        jobs: ["crossing"],
        anchor: [path[cand.s0] % w, (path[cand.s0] - (path[cand.s0] % w)) / w],
        params: [width2, fordTiles.length, ...fordTiles],
        blocks: bl.tiles.map((t) => [t, "lava"] as const),
        floor: [...bl.keepOut, ...Array.from(bank).sort((p1, p2) => p1 - p2)],
        mode: "trim",
      });
      if (!placed) continue;
      plan.riverPath = path.slice(cand.s0, cand.s1);
      plan.fords = fordTiles;
      plan.lava = placed.written.slice();
      if (G && G.members.length > 0) {
        // the bank along a corridor stays plain unless it is a ford's (a ford is where the walk crosses; ember there is the point)
        const ford = new Uint8Array(n);
        for (const t of bl.keepOut) ford[t] = 1;
        const seen = new Uint8Array(n);
        for (const t of plan.lava) {
          const x = t % w, y = (t - x) / w;
          for (const [dx, dy] of DIR8) {
            const j = c.at(x + dx, y + dy);
            if (j >= 0 && G.corridor[j] === 1 && !ford[j] && !seen[j]) { seen[j] = 1; plan.noEmber.push(j); }
          }
        }
      }
      return;
    }
  }
}

// ------------------------------------------------------------------------------------------------ the styler
function shape(c: ShapeCtx): ScorchPlan {
  const plan: ScorchPlan = { riverPath: [], fords: [], lava: [], noEmber: [], craters: [], edges: 0, loops: 0 };
  const mine = zoneCamps(c);
  const G = guardOf(c);
  const { nodes, edges, loops } = skeletonOf(c, mine);
  plan.edges = edges.length;
  plan.loops = loops;
  const r4s = mine.map((k) => radius4(k, mine));
  placeCraters(c, mine, r4s, nodes, edges, G, plan);
  placeRiver(c, mine, r4s, nodes, edges, G, plan);
  return plan;
}

/** The ember bank: every free floor tile touching lava (8 neighbours) is EMBER, the fords' sides included. */
function surface(c: SurfaceCtx, plan: ScorchPlan): void {
  const skip = new Set<number>(plan.noEmber);
  for (const t of plan.lava) {
    const x = t % c.w, y = (t - x) / c.w;
    for (const [dx, dy] of DIR8) {
      const j = c.at(x + dx, y + dy);
      if (j >= 0 && !skip.has(j)) c.surface(j, "ember");
    }
  }
}

function props(c: PropCtx, plan: ScorchPlan): void {
  const { w } = c;
  const bb = c.zone.bbox;
  // crater lips: one rim wall in six
  for (const cr of plan.craters) {
    for (const t of cr.rim) {
      const x = t % w, y = (t - x) / w;
      const u = c.noise.hash(x, y, 3), v = Math.floor(c.noise.hash(x, y, 90) * 4);
      if (u < 1 / 6) c.prop(PROP.crater_lip, x, y, v);
      else if (u < 0.3) c.prop(PROP.glow_crack, x, y, v);
    }
  }
  // the forge: walls glow, an anvil and a slag heap on its floor
  for (const f of c.zoneFeatures()) {
    if (f.kind !== "landmark" || f.variant !== FORGE.key) continue;
    for (let y = f.bbox.y; y < f.bbox.y + f.bbox.h; y++) {
      for (let x = f.bbox.x; x < f.bbox.x + f.bbox.w; x++) {
        const i = y * w + x;
        if (c.tiles[i] !== TILE_WALL || !c.isOwned(i)) continue;
        if (c.noise.hash(x, y, 3) < 0.2) c.prop(PROP.glow_crack, x, y, Math.floor(c.noise.hash(x, y, 90) * 4));
      }
    }
    const s = stampTemplate(FORGE, f.ax, f.ay, (f.p[0] & 3) as 0 | 1 | 2 | 3, f.p[1] === 1, c.w, c.h);
    if (!s) continue;
    const doorAt = new Set(s.doors);
    const floor = s.floor.filter((i) => {
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (doorAt.has((y + dy) * w + x + dx)) return false;
      return true;
    });
    if (floor.length < 2) continue;
    const a = floor[Math.floor(c.noise.hash(f.ax, f.ay, 5) * floor.length)];
    let b = floor[Math.floor(c.noise.hash(f.ay, f.ax, 6) * floor.length)];
    if (b === a) b = floor[(floor.indexOf(a) + 1) % floor.length];
    c.prop(PROP.anvil, a % w, (a - (a % w)) / w, 0);
    c.prop(PROP.slag_heap, b % w, (b - (b % w)) / w, 0);
  }
  // the ash and the ember vents (the bank is the only place a vent opens)
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      const i = y * w + x;
      if (!c.mask[i] || c.tiles[i] !== TILE_FLOOR) continue;
      const v = Math.floor(c.noise.hash(x, y, 90) * 4);
      if (c.terrain[i] === TERRAIN_EMBER) { if (c.noise.hash(x, y, 1) < 0.12) c.prop(PROP.ember_vent, x, y, v); }
      else if (c.terrain[i] === TERRAIN_NONE && c.noise.hash(x, y, 2) < 0.02) c.prop(PROP.ash_drift, x, y, v);
    }
  }
}

// ------------------------------------------------------------------------------------------------ landmarks
/**
 * The guard's local test for a wall on tile i, read on the ground as it stands: the zone's floor ring around it and its
 * territory's floor ring both stay in one piece (gridTopology's SIMPLE table). A landmark is placed whole or not at all, so the
 * candidates that would be refused at a territory's narrow neck are left out before they are scored.
 */
function simpleWallOk(c: BaseCtx): (i: number) => boolean {
  const { w, mask, tiles, territory } = c;
  return (i) => {
    const tv = territory ? territory[i] : 0;
    let m = 0, mt = 0;
    for (let q = 0; q < 8; q++) {
      const j = i + RING_DY[q] * w + RING_DX[q];
      if (tiles[j] !== TILE_FLOOR) continue;
      if (!mask[j]) return false;
      m |= 1 << q;
      if (tv !== 0 && territory![j] === tv) mt |= 1 << q;
    }
    return SIMPLE[m] === 1 && (tv === 0 || SIMPLE[mt] === 1);
  };
}
function landmark(c: LandmarkCtx): void {
  const want = Math.min(LANDMARKS_PER_ZONE, Math.round(areaScale(c.zone.painted)));
  if (want <= 0) return;
  const mine = zoneCamps(c);
  const { w, h } = c;
  const rEst = mine.map((k) => radius4(k, mine) / 4);
  // the zone's depth range (the middle 40% of it scores)
  const F = frameOf(c);
  const bb = c.zone.bbox;
  let dLo = Infinity, dHi = -Infinity;
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    for (let x = bb.x; x < bb.x + bb.w; x++) {
      if (!c.mask[y * w + x]) continue;
      const d = depthAt(F, x + 0.5, y + 0.5);
      if (d < dLo) dLo = d;
      if (d > dHi) dHi = d;
    }
  }
  const span = dHi - dLo > 0 ? dHi - dLo : 1;
  const simple = simpleWallOk(c);
  // c.open and the simple-point test do not depend on the margin: asked once per tile (0 unknown, 1 yes, 2 no)
  const wallOk = new Uint8Array(w * h);
  const okAt = (i: number): boolean => {
    if (wallOk[i] === 0) wallOk[i] = c.open(i) && simple(i) ? 1 : 2;
    return wallOk[i] === 1;
  };
  const centres: { x: number; y: number }[] = [];
  /** The tiles no stamp may touch: the protected ground, R_est + margin round each camp, FORGE_DISC round the forges already standing. */
  const excluded = (margin: number): Uint8Array => {
    const ext = c.hard.slice();
    const disc = (cx: number, cy: number, r: number): void => {
      const reach = Math.ceil(r);
      for (let dy = -reach; dy <= reach; dy++) {
        const y = Math.floor(cy) + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -reach; dx <= reach; dx++) {
          const x = Math.floor(cx) + dx;
          if (x >= 0 && x < w && (x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy) < r * r) ext[y * w + x] = 1;
        }
      }
    };
    for (let q = 0; q < mine.length; q++) disc(mine[q].x + 0.5, mine[q].y + 0.5, rEst[q] + margin);
    for (const m of centres) disc(m.x, m.y, FORGE_DISC);
    return ext;
  };
  const score = (s: Stamp): number => {
    const mx = s.bbox.x + s.bbox.w / 2, my = s.bbox.y + s.bbox.h / 2;
    let near = Infinity, nearCamp = -1;
    for (let q = 0; q < mine.length; q++) {
      const d = Math.sqrt((mx - mine[q].x - 0.5) * (mx - mine[q].x - 0.5) + (my - mine[q].y - 0.5) * (my - mine[q].y - 0.5));
      const m = d - (rEst[q] + 3);
      if (m < near) { near = m; nearCamp = q; }
    }
    let sc = near > 6 ? 6 : near;
    const f = (depthAt(F, mx, my) - dLo) / span;
    if (f >= 0.3 && f <= 0.7) sc += 2;
    // a door side faces the nearest camp
    if (nearCamp >= 0) {
      const tx = mine[nearCamp].x + 0.5 - mx, ty = mine[nearCamp].y + 0.5 - my, tl = Math.sqrt(tx * tx + ty * ty) || 1;
      let best = -1;
      for (const dI of s.doors) {
        const ddx = (dI % w) + 0.5 - mx, ddy = Math.floor(dI / w) + 0.5 - my, dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const cs = (ddx * tx + ddy * ty) / (dl * tl);
        if (cs > best) best = cs;
      }
      sc += 2 * best;
    }
    // a stable per-position wobble so seeds differ among equally good spots
    return sc + (noiseQ(c, s.bbox.x, s.bbox.y, 7, 99) / 1024) * 2;
  };
  for (let k = 0; k < want; k++) {
    // R_est + 3 from every camp, else R_est + 2 (a forge may touch the lip of a crater rather than not stand at all)
    let placed = null;
    for (const margin of FORGE_MARGINS) {
      const ext = excluded(margin);
      const view: LandmarkCtx = { ...c, hard: ext, open: (i) => ext[i] === 0 && okAt(i) };
      placed = bestLandmark(view, FORGE, score, FORGE_TRIES);
      if (placed) break;
    }
    if (!placed) break;
    const box = c.zoneFeatures().filter((f) => f.kind === "landmark")[k]?.bbox;
    if (!box) break;
    centres.push({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  }
}

/** The Scorch styler: Crater Basins. */
export const scorch: ZoneStyler<ScorchPlan> = { id: "scorch", faction: "fire", version: 400, landmark, shape, surface, props };
