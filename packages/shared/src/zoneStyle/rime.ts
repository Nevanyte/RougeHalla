// Rime (frost): a glacier. Wide frozen lakes (ICE, free floor), angular convex ice shelves (WALL), two crevasses (a LOW kind of
// their own, with 2-tile bridges) and almost nothing else: the lightest footprint. The 480 u sight cap pins sight in
// every zone, so the Rime reads open by surface (pale ice), low faceted shards and the fewest structure walls. ICE keeps
// every wall and LOW tile out of its 8-neighbourhood (a slide meeting a face breaks the client's prediction), so the
// lakes are carved out around the shelves and the cover. Part D 4.4's recipe, scaled to the zone.
import { TILE_FLOOR, TILE_WALL } from "../map";
import { TERRAIN_ICE } from "../terrain";
import { randInt } from "../rng";
import type { Rng } from "../rng";
import { breakLowRuns, chance, DIR8, low, pickOpen, pickTile, steer, vnoise, wall } from "./kit";
import { PROP } from "./propKinds";
import { sizeScale } from "./scale";
import type { PropCtx, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";

export interface LakePlan { cx: number; cy: number; a: number; b: number }
export interface ShelfPlan { cx: number; cy: number; rad: number; cells: Array<[number, number]>; walls: number[] }

export interface RimePlan {
  lakes: LakePlan[];
  /** Salt of the shore warp noise, shared by the lakes (its own, so the shape and surface passes agree on every shore). */
  warpSalt: number;
  shelves: ShelfPlan[];
  /** Crevasse tiles (LOW) the styler wrote, per crevasse. */
  crevasses: number[][];
}

/** Glaze patches: the share of the zone that gets ice on top of the lakes, on the ice-ready tiles with the highest noise. */
const GLAZE_ZONE_SHARE = 0.045;

const NORMALS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

/**
 * The cells of one angular shelf, as offsets from its centre: the intersection of 4-8 half-planes (the four axis normals
 * always, each diagonal with p 0.75), at axis distance rad * (0.7 .. 1.3) and diagonal distance rad * (1 .. 1.7), nearest
 * the centre first. An intersection of half-planes is convex.
 */
export function facetShelfCells(rng: Rng, rad: number): Array<[number, number]> {
  const picks: number[] = [];
  for (let k = 0; k < 8; k++) if (chance(rng, 0.75) || k < 4) picks.push(k);
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

/** The lake test (< 1 inside): an ellipse with a noise-warped shore; `warp` is the zone's warp field (0..1 per tile). */
function lakeValue(lake: LakePlan, x: number, y: number, warp: number): number {
  const ox = x - lake.cx, oy = y - lake.cy;
  return (ox * ox) / (lake.a * lake.a) + (oy * oy) / (lake.b * lake.b) + 0.5 * (warp - 0.5);
}

/** The warp noise of the whole grid inside the zone's box, computed once (a lake test is then a lookup). */
function warpField(c: { w: number; h: number; zone: ShapeCtx["zone"] }, salt: number): Float32Array {
  const out = new Float32Array(c.w * c.h);
  const { bbox } = c.zone;
  for (let y = Math.max(0, bbox.y - 12); y < Math.min(c.h, bbox.y + bbox.h + 12); y++) {
    for (let x = Math.max(0, bbox.x - 12); x < Math.min(c.w, bbox.x + bbox.w + 12); x++) out[y * c.w + x] = vnoise(x, y, 4, salt);
  }
  return out;
}

function shape(c: ShapeCtx): RimePlan {
  const r = c.rng;
  const w = c.w;
  const sc = sizeScale(c.zone.painted);
  const plan: RimePlan = { lakes: [], warpSalt: randInt(r, 0, 1 << 30), shelves: [], crevasses: [] };
  const warp = warpField(c, plan.warpSalt);
  // 1. where the lakes go (painted by the surface pass; the shelves need to know their shores)
  const nL = c.zone.painted > 2000 ? 3 : 2;
  const aLo = Math.max(4, Math.floor(5 * sc)), aHi = Math.max(aLo + 2, Math.floor(9 * sc));
  const bLo = Math.max(3, Math.floor(4 * sc)), bHi = Math.max(bLo + 2, Math.floor(8 * sc));
  const centreDist = Math.max(6, Math.floor(18 * sc));
  // ICE needs all eight neighbours to be floor, so a lake is worth the ice-ready tiles inside it: of 40 sampled lakes each
  // takes the one with the most (a finished map leaves few clean patches; on an open map every lake qualifies alike)
  const iceReady = (x: number, y: number): boolean => {
    const i = c.at(x, y);
    if (i < 0 || !c.mask[i] || c.hard[i] || c.noBlock[i] === 1 || c.tiles[i] !== TILE_FLOOR) return false;
    for (const [dx, dy] of DIR8) { const j = c.at(x + dx, y + dy); if (j < 0 || c.tiles[j] !== TILE_FLOOR) return false; }
    return true;
  };
  for (let k = 0; k < nL; k++) {
    let best: LakePlan | null = null, bestScore = -1;
    for (let t = 0; t < 40; t++) {
      const s = pickTile(c, 100, (x, y) => c.edgeDist[y * w + x] >= centreDist);
      if (!s) break;
      const lake: LakePlan = { cx: s[0], cy: s[1], a: randInt(r, aLo, aHi), b: randInt(r, bLo, bHi) };
      let score = 0;
      for (let oy = -lake.b - 1; oy <= lake.b + 1; oy++) for (let ox = -lake.a - 1; ox <= lake.a + 1; ox++) { const gi = c.at(lake.cx + ox, lake.cy + oy); if (gi >= 0 && lakeValue(lake, lake.cx + ox, lake.cy + oy, warp[gi]) < 1 && iceReady(lake.cx + ox, lake.cy + oy)) score++; }
      if (score > bestScore) { bestScore = score; best = lake; }
    }
    if (best) {
      plan.lakes.push(best);
      // keep the lake's ground clear of shelves and crevasses: they would take its ice
      for (let oy = -best.b - 1; oy <= best.b + 1; oy++) for (let ox = -best.a - 1; ox <= best.a + 1; ox++) {
        const i = c.at(best.cx + ox, best.cy + oy);
        if (i >= 0 && lakeValue(best, best.cx + ox, best.cy + oy, warp[i]) < 1) c.reserve(i);
      }
    }
  }
  const inLake = (x: number, y: number): boolean => {
    const gi = c.at(x, y);
    return gi >= 0 && plan.lakes.some((l) => lakeValue(l, x, y, warp[gi]) < 1);
  };
  // 2. angular shelves, half of them on a lake shore
  for (let k = 0; k < 4; k++) {
    const shore = k % 2 === 0;
    const s = pickOpen(c, (x, y) => {
      if (!shore) return true;
      if (inLake(x, y)) return false;
      for (const [dx, dy] of DIR8) if (inLake(x + 2 * dx, y + 2 * dy)) return true;
      return false;
    }) ?? (shore ? pickOpen(c) : null);
    if (!s) continue;
    const rad = randInt(r, 2, 4);
    const sh: ShelfPlan = { cx: s[0], cy: s[1], rad, cells: facetShelfCells(r, rad), walls: [] };
    for (const [ox, oy] of sh.cells) if (wall(c, s[0] + ox, s[1] + oy)) sh.walls.push(c.at(s[0] + ox, s[1] + oy));
    plan.shelves.push(sh);
    if (sh.walls.length > 0 && chance(r, 0.4)) {
      const cx = s[0] + randInt(r, -5, 6), cy = s[1] + randInt(r, -5, 6), rad2 = randInt(r, 1, 3);
      const sh2: ShelfPlan = { cx, cy, rad: rad2, cells: facetShelfCells(r, rad2), walls: [] };
      for (const [ox, oy] of sh2.cells) if (wall(c, cx + ox, cy + oy)) sh2.walls.push(c.at(cx + ox, cy + oy));
      plan.shelves.push(sh2);
    }
  }
  // 3. crevasses with bridges
  for (let k = 0; k < 2; k++) {
    const s = pickOpen(c);
    if (!s) continue;
    let [x, y] = s;
    let h = randInt(r, 0, 8);
    const len = randInt(r, Math.max(7, Math.floor(10 * sc)), Math.max(9, Math.floor(17 * sc)));
    let since = 0, gap = 0, nextGap = randInt(r, 6, 9);
    const tiles: number[] = [];
    for (let st = 0; st < len; st++) {
      if (gap > 0) gap--;
      else {
        if (low(c, x, y, "crevasse")) tiles.push(c.at(x, y));
        if (++since >= nextGap) { gap = 2; since = 0; nextGap = randInt(r, 6, 9); }
      }
      if (chance(r, 0.25)) h = (h + (chance(r, 0.5) ? 1 : 7)) & 7;
      const nh = steer(c, x, y, h, chance(r, 0.5));
      if (nh < 0) break;
      h = nh;
      x += DIR8[h][0]; y += DIR8[h][1];
    }
    plan.crevasses.push(tiles);
  }
  breakLowRuns(c, 12);
  return plan;
}

/** The frozen lakes (a tile needs all eight neighbours FLOOR, so they thin out around rocks and shelves), plus glaze patches. */
function surface(c: SurfaceCtx, plan: RimePlan): void {
  const w = c.w;
  const warp = warpField(c, plan.warpSalt);
  for (const lake of plan.lakes) {
    for (let oy = -lake.b - 3; oy <= lake.b + 3; oy++) {
      for (let ox = -lake.a - 3; ox <= lake.a + 3; ox++) {
        const x = lake.cx + ox, y = lake.cy + oy;
        const i = c.at(x, y);
        if (i < 0) continue;
        if (lakeValue(lake, x, y, warp[i]) < 1) c.surface(i, "ice");
      }
    }
  }
  // glaze: of the tiles that can still take ice, the ones with the highest noise, up to a share of the zone
  const ready: Array<[number, number]> = [];
  for (let i = 0; i < c.w * c.h; i++) {
    if (!c.mask[i] || !c.canSurface(i, "ice")) continue;
    ready.push([i, c.noise.value(i % w, (i - (i % w)) / w, 6, 41)]);
  }
  ready.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const glaze = Math.floor(GLAZE_ZONE_SHARE * c.zone.painted);
  for (let k = 0; k < ready.length && k < glaze; k++) c.surface(ready[k][0], "ice");
}

function props(c: PropCtx, plan: RimePlan): void {
  const n = c.w * c.h;
  const shelf = new Uint8Array(n);
  for (const sh of plan.shelves) for (const i of sh.walls) shelf[i] = 1;
  for (let i = 0; i < n; i++) {
    if (!c.mask[i]) continue;
    const x = i % c.w, y = (i - x) / c.w;
    const v = Math.floor(c.noise.hash(x, y, 90) * 3);
    if (c.tiles[i] === TILE_FLOOR) {
      if (c.terrain[i] === TERRAIN_ICE) { if (c.noise.hash(x, y, 1) < 0.04) c.prop(PROP.frost_sparkle, x, y, v); }
      else if (c.terrain[i] === 0 && c.noise.hash(x, y, 2) < 0.025) c.prop(PROP.snow_drift, x, y, v);
    } else if (c.tiles[i] === TILE_WALL) {
      const u = c.noise.hash(x, y, 3);
      if (shelf[i] && u < 0.12) c.prop(PROP.icicle, x, y, v);
      else if (u < 0.04) c.prop(PROP.ice_spire, x, y, v);
    }
  }
}

export const rime: ZoneStyler<RimePlan> = { id: "rime", faction: "frost", version: 1, shape, surface, props };
