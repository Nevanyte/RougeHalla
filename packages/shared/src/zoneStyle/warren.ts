// Warren (plague): The Barrows (zone-shapes contract 4.3, options doc 6.3 option 1). Every road between two camps (an edge of the
// zone's Gabriel graph over its 8 camps and its front door) forks round a noisy round rock barrow: go left on dry ground, right
// through the bog crescent on the barrow's wet flank, or straight through the 3-wide tunnel bored into the biggest barrows. One
// collapsed burrow (a landmark, 9x9 with two 2-wide doors on the road's axis) stands on each of the two longest roads and is that
// road's barrow. Plague is exempt from the bog (x0.7 for everyone else), so the wet fork is its home advantage.
//
// Every wall goes through `placeFeature` as a named feature: kind "barrow" (jobs fork, plus choke for a tunnel barrow) owns the rock,
// the tunnel slot and the bog crescent it holds; kind "landmark" (variant "burrow", jobs landmark and fork) is the burrow.
// Feature params (contract 2.6): barrow `[radius4, tunnel 0/1, dir16 of the road, wetSide -1/+1]`, the anchor is the barrow's centre
// tile. The road is A -> B for the Gabriel edge (a, b), a < b, in campNodes order (camps in CampInfo order, the door last): `dir16`
// is dirIndex16 of u = B - A, the centre tile lies within 3 tiles of the line, and with p = tile - centre
//   rock:     16 |p|^2 <= (radius4 + jitter4)^2, jitter4 in -3..3 from noiseQ(x, y, 4, 310 + k) (a noisy disc, radius4 in quarter tiles);
//   tunnel:   16 cross(p, u)^2 < 36 |u|^2 (the 3-wide slot along the road: those tiles are owned floor, not rock);
//   crescent: (R + 0.8)^2 <= |p|^2 <= (R + 4.5)^2, wet * (py ux - px uy) >= |u|, |p . u| <= (R + 1.5) |u| (R = radius4 / 4): owned floor
//             that is BOG, kept to the tiles off the spawn walks' corridors, 3 tiles clear of every camp's clearing, in pieces of 8+.
// `dir16` is the road's direction rounded to 22.5 degrees, so a reader that rebuilds the sets from the params is a little off; the
// feature's own tiles (featureGrid, terrain) are exact: the crescent is the barrow's BOG tiles, the tunnel its owned plain floor.
// The wet side is the noise coin of the contract unless the other flank keeps more bog off the corridors. Integers throughout:
// + - * /, sqrt, floor, round and the kit's integer geometry.
//
// Deviation from contract 4.3 step 5 (route guard), measured over 200 seeds: a barrow may not stand on a spawn walk's own line (the
// middle row of a corridor, `coreOf`) and may clip at most CLIP_MAX tiles of it; it may overlap the corridor's fringe. Keeping every
// barrow off the whole 3-wide corridor, as written, leaves 6.1 barrows a zone and 20% of the seeds at 8 or more (the corridors of 5-7
// members cover a quarter of the zone and every road crosses one); with this rule it is 8.4 and 72%, and the route guard's worst
// stretch stays at 1000-1028 permille (the limit is 1030). A barrow also stands 2 tiles beyond its radius from every pool member.
import { TILE_FLOOR, TILE_WALL } from "../map";
import { areaScale, LANDMARKS_PER_ZONE } from "./scale";
import { ROUTE_STRETCH_MAX, campNodes, dirIndex16, discOffsets, gabrielEdges, noiseQ, segDist2 } from "./features";
import type { Node } from "./features";
import { placeLandmark, stampFits, stampTemplate } from "./landmarks";
import type { LandmarkTemplate } from "./landmarks";
import { PROP } from "./propKinds";
import type { BaseCtx, FeatureSpec, LandmarkCtx, PlacedFeature, PropCtx, RouteGuard, ShapeCtx, SurfaceCtx, ZoneStyler } from "./types";

/** The collapsed burrow (contract 5.2, orientation 0): two 2-wide doors on the west and east sides, two crate nooks, two walls of 15. */
export const BURROW: LandmarkTemplate = {
  key: "burrow",
  jobs: ["landmark", "fork"],
  rows: [
    "__#####__",
    "_##...##_",
    "##c....##",
    "#.......#",
    "d.......d",
    "d.......d",
    "##....c##",
    "_##...##_",
    "__#####__",
  ],
};
/** The Warren's landmark templates, for the generator's crates and the art (a feature's `variant` is the template key). */
export const WARREN_LANDMARKS: readonly LandmarkTemplate[] = [BURROW];

export interface WarrenBarrow {
  /** The feature's index in the attempt's log. */
  readonly id: number;
  /** Centre tile. */
  readonly cx: number;
  readonly cy: number;
  /** Radius in quarter tiles. */
  readonly r4: number;
  readonly tunnel: boolean;
  readonly dir16: number;
  readonly wet: 1 | -1;
  /** Rock tiles that stand (write order). */
  readonly walls: readonly number[];
  /** The tunnel's slot, the floor tiles it owns (empty without a tunnel), ordered along the road. */
  readonly slot: readonly number[];
  /** The bog crescent, owned floor (the surface pass paints it). */
  readonly crescent: readonly number[];
}

export interface WarrenPlan {
  readonly barrows: WarrenBarrow[];
  /** Each tunnel's centre line (the slot's tile indices in walking order, A -> B). */
  readonly tunnels: number[][];
  /** Every barrow's crescent (all the bog the surface pass may paint). */
  readonly crescent: number[];
  /** Walls at a tunnel's two mouths (decor). */
  readonly mouths: number[];
  /** The bog painted by the surface pass. */
  bog: number[];
  /** Roads long enough for a barrow (burrow roads left out), and how many barrows stand. */
  roads: number;
  placed: number;
}

// ------------------------------------------------------------------------------------------------ dials
/** Barrows per 1710 tiles of zone (contract 4.3: 6, i.e. 12 at 136x136) and tunnel barrows per 1710 tiles (2, i.e. 4). */
const BARROWS_PER_REF = 6;
const TUNNELS_PER_REF = 2;
/** A road shorter than this (tiles, squared) takes no barrow; a burrow needs 18. */
const ROAD_MIN2 = 15 * 15;
const BURROW_ROAD_MIN2 = 18 * 18;
/** Radius in quarter tiles: 0.2 L clamped to 2.6..4.6 tiles (11 = 2.75, 18 = 4.5), shrunk by 2 (half a tile). A tunnel needs 14 (3.5). */
const R4_MIN = 11;
const R4_MAX = 18;
const R4_TUNNEL = 14;
/** Tiles kept clear between a barrow and the end of its road, in tenths: a camp 5.2, the front door 2.0. */
const PAD_CAMP10 = 52;
const PAD_DOOR10 = 20;
/** Centre search: t along the road (permille) and tiles across, in preference order; accept a score of 620 permille. */
const T_PERMILLE = [500, 450, 550, 400, 600, 350, 650];
const ACROSS = [0, 1, -1, 2, -2, 3, -3];
const ACCEPT_PERMILLE = 620;
/** A barrow stands this far (quarter tiles, 2 tiles) beyond its radius from a spawn pool member, so no spawn sits in a notch of the rock. */
const MEMBER_GAP4 = 8;
/** A barrow that cannot stand clear of a spawn walk's line may clip it by this many tiles (0: never). */
const CLIP_MAX = 3;
/** A bog piece under this many tiles is dropped; bog keeps this many tiles from a camp's clearing. */
const BOG_MIN_PIECE = 8;
const BOG_CAMP_GAP = 3;
/** The burrow's centre lies at t 0.4..0.6 of its road and up to 2 tiles across. */
const BURROW_T = [500, 450, 550, 400, 600];
const BURROW_ACROSS = [0, 1, -1, 2, -2];
/** Roads tried for the burrows before the stage gives up (the contract names the two longest). */
const BURROW_ROADS_TRIED = 6;
/** The burrow is on a road when its centre is this close (tiles, squared) to the road's segment: the barrow pass skips that road. */
const BURROW_ROAD_NEAR2 = 25;

// ------------------------------------------------------------------------------------------------ the road graph
interface Road { readonly a: Node; readonly b: Node; readonly dx: number; readonly dy: number; readonly d2: number; readonly len: number }

/** The zone's camps and its front door as graph nodes (the context's camps are this zone's). */
function zoneNodes(c: BaseCtx): Node[] {
  return campNodes(c);
}

const nodeKey = (n: Node): number => n.y * 100000 + n.x;

/** The Gabriel edges of at least `min2` (squared tiles) as roads, longest first (ties by node position). */
function roads(nodes: readonly Node[], min2: number): Road[] {
  const out: Road[] = [];
  for (const [a, b] of gabrielEdges(nodes)) {
    const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y, d2 = dx * dx + dy * dy;
    if (d2 >= min2) out.push({ a: nodes[a], b: nodes[b], dx, dy, d2, len: Math.sqrt(d2) });
  }
  return out.sort((p, q) => q.d2 - p.d2 || nodeKey(p.a) - nodeKey(q.a) || nodeKey(p.b) - nodeKey(q.b));
}

// ------------------------------------------------------------------------------------------------ the landmark: the collapsed burrow
function landmark(c: LandmarkCtx): void {
  const want = Math.min(LANDMARKS_PER_ZONE, Math.max(1, Math.round(areaScale(c.zone.painted))));
  const nodes = zoneNodes(c);
  if (nodes.length < 2) return;
  let placed = 0, tried = 0;
  for (const road of roads(nodes, BURROW_ROAD_MIN2)) {
    if (placed >= want || tried >= BURROW_ROADS_TRIED) break;
    tried++;
    if (placeBurrow(c, road)) placed++;
  }
}

/** The burrow on a road: centre at t 0.4..0.6 and up to 2 tiles across, doors on the axis nearest the road's direction (within 2 steps of DIR16). */
function placeBurrow(c: LandmarkCtx, road: Road): boolean {
  const { a, dx, dy, len } = road;
  const rot = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
  const mirror = noiseQ(c, a.x, a.y, 1, 401) < 512;
  for (const tp of BURROW_T) {
    for (const off of BURROW_ACROSS) {
      const cx = Math.round(a.x + (dx * tp) / 1000 - (dy * off) / len);
      const cy = Math.round(a.y + (dy * tp) / 1000 + (dx * off) / len);
      // the mirror image has the same walls and floor, only its crate nooks swap: one stamp per centre is enough
      const s = stampTemplate(BURROW, cx - 4, cy - 4, rot, mirror, c.w, c.h);
      if (!s || !stampFits(c, s)) continue;
      if (placeLandmark(c, BURROW, s, rot, mirror)) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ the barrows
/** What the planning of the barrows reads: the zone's ground (lazily classified, and taken by each plan), the corridors and the camps. */
interface Ground {
  readonly c: ShapeCtx;
  /** Per tile: 0 not asked yet, 1 free ground (`open`), 2 not free (or taken by a plan). */
  readonly seen: Uint8Array;
  /** 1 on a spawn walk's own line (the corridor's middle row). */
  readonly core: Uint8Array;
  /** The corridor band. */
  readonly corridor: Uint8Array;
  /** Camps near the zone as x, y, squared keep-out radius (clearing + BOG_CAMP_GAP), flattened. */
  readonly camps: Float64Array;
  /** Spawn pool members of the zone as x, y, flattened. */
  readonly members: Int32Array;
  /** Scratch for the crescent's pieces. */
  readonly mark: Uint8Array;
}

function freeAt(g: Ground, i: number): boolean {
  let v = g.seen[i];
  if (v === 0) { v = g.c.open(i) ? 1 : 2; g.seen[i] = v; }
  return v === 1;
}

/** Free ground off the corridors and clear of the camps: where a crescent may become bog. */
function bogAt(g: Ground, i: number): boolean {
  if (g.corridor[i] === 1 || !freeAt(g, i)) return false;
  const w = g.c.w, x = i % w, y = (i - x) / w;
  const k = g.camps;
  for (let q = 0; q < k.length; q += 3) {
    const ex = k[q] - x, ey = k[q + 1] - y;
    if (ex * ex + ey * ey <= k[q + 2]) return false;
  }
  return true;
}

/**
 * The spawn walks' own lines: corridor tiles with a full ring of corridor around them (the 3-wide band's middle row). A barrow may
 * clip the fringe of a corridor, and a few tiles of this line (CLIP_MAX), never more.
 */
function coreOf(corridor: Uint8Array, bb: { x: number; y: number; w: number; h: number }, w: number, h: number): Uint8Array {
  const core = new Uint8Array(corridor.length);
  for (let y = Math.max(1, bb.y); y < Math.min(h - 1, bb.y + bb.h); y++) {
    for (let x = Math.max(1, bb.x); x < Math.min(w - 1, bb.x + bb.w); x++) {
      const i = y * w + x;
      if (corridor[i] === 1 && corridor[i - 1] + corridor[i + 1] + corridor[i - w] + corridor[i + w] + corridor[i - w - 1] + corridor[i - w + 1] + corridor[i + w - 1] + corridor[i + w + 1] === 8) core[i] = 1;
    }
  }
  return core;
}

interface BarrowSite {
  readonly road: Road;
  readonly k: number;
  readonly r4: number;
  readonly cx: number;
  readonly cy: number;
  readonly wet: 1 | -1;
  /** Squared distance (tiles) from the centre to the road's line: the tunnel goes to the barrows nearest their road. */
  readonly off2: number;
  /** The rock's tiles, centre-out. */
  readonly rock: number[];
  readonly crescent: number[];
}

/**
 * The noisy disc of a barrow: a tile is rock when 16 d^2 <= (radius4 + jitter4)^2. With `keys` given, pushes the rock (squared
 * distance, tile) for the centre-out order. With `core` given, counts the rock tiles standing on it and stops once it passes `limit`.
 */
function rockScan(c: BaseCtx, jit: Int8Array, cx: number, cy: number, r4: number, k: number, keys: number[] | null, core: Uint8Array | null, limit: number): number {
  const { w, h } = c;
  const reach = Math.ceil((r4 + 3) / 4);
  let hits = 0;
  for (let y = cy - reach; y <= cy + reach; y++) {
    if (y < 0 || y >= h) continue;
    for (let x = cx - reach; x <= cx + reach; x++) {
      if (x < 0 || x >= w) continue;
      const i = y * w + x;
      const ex = x - cx, ey = y - cy;
      let jv = jit[i];
      if (jv === -128) { jv = Math.round(((noiseQ(c, x, y, 4, 310 + k) - 512) * 13) / 2560); jit[i] = jv; }
      const rr = r4 + jv;
      if (rr <= 0 || 16 * (ex * ex + ey * ey) > rr * rr) continue;
      if (core !== null && core[i] === 1 && ++hits > limit) return hits;
      if (keys !== null) keys.push((ex * ex + ey * ey) * 1048576 + i);
    }
  }
  return hits;
}

const FLAT_DISCS = new Map<number, Int8Array>();
/** discOffsets(r4) as one flat array, dx and dy alternating (the hot loops walk it without taking tuples apart). */
function flatDisc(r4: number): Int8Array {
  let out = FLAT_DISCS.get(r4);
  if (!out) {
    const list = discOffsets(r4);
    out = new Int8Array(2 * list.length);
    list.forEach(([ox, oy], q) => { out![2 * q] = ox; out![2 * q + 1] = oy; });
    FLAT_DISCS.set(r4, out);
  }
  return out;
}

/**
 * Is the rock of a barrow at (cx, cy) on at most `limit` tiles of `core`? Exact, with two shortcuts that need no noise: the disc of
 * radius r4 - 3 is rock whatever the jitter (more core tiles in it than the limit: no), and so is nothing outside the disc of r4 + 3
 * (no more core tiles in it than the limit: yes). Only a disc in between is scanned tile by tile.
 */
function clipsWithin(c: BaseCtx, jit: Int8Array, core: Uint8Array, cx: number, cy: number, r4: number, k: number, limit: number): boolean {
  const { w, h } = c;
  let sure = 0;
  const inner = flatDisc(r4 - 3);
  for (let q = 0; q < inner.length; q += 2) {
    const x = cx + inner[q], y = cy + inner[q + 1];
    if (x >= 0 && y >= 0 && x < w && y < h && core[y * w + x] === 1 && ++sure > limit) return false;
  }
  let possible = 0;
  const outer = flatDisc(r4 + 3);
  for (let q = 0; q < outer.length; q += 2) {
    const x = cx + outer[q], y = cy + outer[q + 1];
    if (x >= 0 && y >= 0 && x < w && y < h && core[y * w + x] === 1) possible++;
  }
  return possible <= limit || rockScan(c, jit, cx, cy, r4, k, null, core, limit) <= limit;
}

/** The rock of a barrow, centre-out (by squared distance, then tile index). */
function rockOf(c: BaseCtx, jit: Int8Array, cx: number, cy: number, r4: number, k: number): number[] {
  const keys: number[] = [];
  rockScan(c, jit, cx, cy, r4, k, keys, null, 0);
  keys.sort((p, q) => p - q);
  return keys.map((v) => v % 1048576);
}

/** The bog crescent on one side of the road, alongside the barrow: the tiles of its geometry that can stay bog, in pieces of 8 or more. */
function crescentOf(g: Ground, cx: number, cy: number, r4: number, ux: number, uy: number, wet: number): number[] {
  const c = g.c;
  const u2 = ux * ux + uy * uy;
  const lo = 5 * r4 + 16, hi = 5 * r4 + 90; // R + 0.8 and R + 4.5 in twentieths of a tile
  const alongMax = r4 + 6; // R + 1.5 in quarter tiles
  const reach = Math.ceil((r4 + 18) / 4);
  const raw: number[] = [];
  for (let y = cy - reach; y <= cy + reach; y++) {
    for (let x = cx - reach; x <= cx + reach; x++) {
      const i = c.at(x, y);
      if (i < 0) continue;
      const ex = x - cx, ey = y - cy;
      const d400 = 400 * (ex * ex + ey * ey);
      if (d400 < lo * lo || d400 > hi * hi) continue;
      const side = wet * (ey * ux - ex * uy);
      if (side < 0 || side * side < u2) continue;
      const along = ex * ux + ey * uy;
      if (16 * along * along > alongMax * alongMax * u2) continue;
      if (bogAt(g, i)) raw.push(i);
    }
  }
  // the pieces of BOG_MIN_PIECE tiles or more (4-connected), in discovery order
  const { mark } = g;
  const w = c.w;
  for (const i of raw) mark[i] = 1;
  const out: number[] = [];
  for (const s0 of raw) {
    if (mark[s0] !== 1) continue;
    const piece = [s0];
    mark[s0] = 2;
    for (let q = 0; q < piece.length; q++) {
      const i = piece[q];
      if (mark[i - 1] === 1) { mark[i - 1] = 2; piece.push(i - 1); }
      if (mark[i + 1] === 1) { mark[i + 1] = 2; piece.push(i + 1); }
      if (mark[i - w] === 1) { mark[i - w] = 2; piece.push(i - w); }
      if (mark[i + w] === 1) { mark[i + w] = 2; piece.push(i + w); }
    }
    if (piece.length >= BOG_MIN_PIECE) for (const i of piece) out.push(i);
  }
  for (const i of raw) mark[i] = 0;
  return out;
}

interface Cand { readonly score: number; readonly order: number; readonly cx: number; readonly cy: number }

/** Centres along a road for radius `r4` that pass the open-share test, best first (score = open share - 20 |across| - 200 |t - 0.5|, in permille). */
function candidatesFor(g: Ground, road: Road, r4: number, padA: number, padB: number): Cand[] {
  const { a, dx, dy, len } = road;
  const { w, h } = g.c;
  const disc = flatDisc(r4);
  const count = disc.length / 2;
  const mem = g.members;
  const out: Cand[] = [];
  let order = 0;
  for (const tp of T_PERMILLE) {
    const fits = (len * tp) / 100 >= padA + 2.5 * r4 && (len * (1000 - tp)) / 100 >= padB + 2.5 * r4;
    for (const off of ACROSS) {
      order++;
      if (!fits) continue;
      const cx = Math.round(a.x + (dx * tp) / 1000 - (dy * off) / len);
      const cy = Math.round(a.y + (dy * tp) / 1000 + (dx * off) / len);
      let near = false;
      for (let q = 0; q < mem.length && !near; q += 2) near = 16 * ((mem[q] - cx) * (mem[q] - cx) + (mem[q + 1] - cy) * (mem[q + 1] - cy)) <= (r4 + MEMBER_GAP4) * (r4 + MEMBER_GAP4);
      if (near) continue;
      // the score needs `need` free tiles of the disc: give up on the candidate as soon as too many are not free
      const penalty = 20 * Math.abs(off) + Math.floor(Math.abs(tp - 500) / 5);
      const need = Math.ceil(((ACCEPT_PERMILLE + penalty) * count) / 1000);
      let spare = count - need, ok = 0;
      for (let q = 0; q < disc.length; q += 2) {
        const x = cx + disc[q], y = cy + disc[q + 1];
        if (x >= 0 && y >= 0 && x < w && y < h && freeAt(g, y * w + x)) ok++;
        else if (--spare < 0) break;
      }
      if (spare < 0) continue;
      const score = Math.floor((1000 * ok) / count) - penalty;
      if (score >= ACCEPT_PERMILLE) out.push({ score, order, cx, cy });
    }
  }
  return out.sort((p, q) => q.score - p.score || p.order - q.order);
}

/**
 * The centre of the road's barrow: the radius shrinks (by half a tile) until the road's ends and the open ground allow it, then the
 * freest disc along the road wins; its rock must keep off the spawn walks' own lines, first with none of them under it, then (last
 * resort) clipping at most CLIP_MAX tiles. Null: no barrow on this road.
 */
function siteOf(g: Ground, road: Road, k: number): BarrowSite | null {
  const c = g.c;
  const { a, b, d2, dx, dy } = road;
  const padA = a.kind === "door" ? PAD_DOOR10 : PAD_CAMP10, padB = b.kind === "door" ? PAD_DOOR10 : PAD_CAMP10;
  const radii: number[] = [];
  for (let r4 = Math.max(R4_MIN, Math.min(R4_MAX, Math.floor(0.8 * road.len))); r4 >= R4_MIN; r4 -= 2) {
    const need = padA + padB + 5 * r4;
    if (need * need <= 100 * d2) radii.push(r4);
  }
  if (radii.length === 0) return null;
  const lists: Array<Cand[] | undefined> = radii.map(() => undefined);
  const jit = new Int8Array(c.w * c.h).fill(-128);
  for (const clipMax of CLIP_MAX > 0 ? [0, CLIP_MAX] : [0]) {
    for (let q = 0; q < radii.length; q++) {
      const r4 = radii[q];
      const list = (lists[q] ??= candidatesFor(g, road, r4, padA, padB));
      for (const cand of list) {
        if (!clipsWithin(c, jit, g.core, cand.cx, cand.cy, r4, k, clipMax)) continue;
        // the wet flank: the noise picks a side, and the other one wins when more of its crescent can stay bog
        let wet: 1 | -1 = noiseQ(c, cand.cx, cand.cy, 1, 301) < 512 ? 1 : -1;
        let crescent = crescentOf(g, cand.cx, cand.cy, r4, dx, dy, wet);
        const other = crescentOf(g, cand.cx, cand.cy, r4, dx, dy, -wet);
        if (other.length > crescent.length) { crescent = other; wet = wet === 1 ? -1 : 1; }
        const cross = (cand.cx - road.a.x) * dy - (cand.cy - road.a.y) * dx;
        return { road, k, r4, cx: cand.cx, cy: cand.cy, wet, off2: (cross * cross) / d2, rock: rockOf(c, jit, cand.cx, cand.cy, r4, k), crescent };
      }
    }
  }
  return null;
}

/** Is rock tile i on the 3-wide slot a tunnel bores along the site's road (|across| < 1.5)? */
function inSlot(site: BarrowSite, i: number, w: number): boolean {
  const ex = (i % w) - site.cx, ey = Math.floor(i / w) - site.cy;
  const cross = ex * site.road.dy - ey * site.road.dx;
  return 16 * cross * cross < 36 * site.road.d2;
}

/** Places a barrow (a trim feature: the rock, with the slot and the crescent owned as floor). Null when it does not stand. */
function placeBarrow(c: ShapeCtx, site: BarrowSite, tunnel: boolean): { placed: PlacedFeature; slot: number[] } | null {
  const { road, cx, cy } = site;
  const w = c.w;
  const slot: number[] = [];
  const blocks: Array<readonly [number, "wall"]> = [];
  for (const i of site.rock) {
    if (tunnel && inSlot(site, i, w)) { slot.push(i); continue; }
    blocks.push([i, "wall"]);
  }
  const spec: FeatureSpec = {
    kind: "barrow",
    jobs: tunnel ? ["fork", "choke"] : ["fork"],
    anchor: [cx, cy],
    params: [site.r4, tunnel ? 1 : 0, dirIndex16(road.dx, road.dy), site.wet],
    blocks,
    floor: [...slot, ...site.crescent],
    mode: "trim",
  };
  const placed = c.placeFeature(spec);
  return placed ? { placed, slot } : null;
}

/** Measurements the route guard may be asked for while the plan is pruned (the guard's budget is six a zone). */
const ROUTE_TRIES = 4;

/**
 * Leaves out barrows until the plan's rock (a tunnel barrow's slot stays floor) no longer stretches the worst member's walk past
 * ROUTE_STRETCH_MAX: each round drops the site with the most rock tiles beside that member's corridor. `sites` is edited in place.
 */
function pruneForRoute(
  guard: RouteGuard, sites: BarrowSite[], tunnelOrder: (list: readonly BarrowSite[]) => number[], tunnelsMax: number, w: number, h: number,
): void {
  for (let round = 0; round < ROUTE_TRIES; round++) {
    const bored = new Set<number>(tunnelOrder(sites).slice(0, Math.max(0, tunnelsMax)));
    const rock: number[] = [];
    sites.forEach((site, k) => { for (const i of site.rock) if (!(bored.has(k) && inSlot(site, i, w))) rock.push(i); });
    if (guard.worstStretch(rock) <= ROUTE_STRETCH_MAX) return;
    const near = new Uint8Array(w * h);
    for (const t of guard.corridorOf(guard.worstMember())) {
      const x = t % w, y = (t - x) / w;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (x + ox >= 0 && y + oy >= 0 && x + ox < w && y + oy < h) near[(y + oy) * w + x + ox] = 1;
    }
    let worst = -1, worstScore = 0;
    sites.forEach((site, k) => {
      let score = 0;
      for (const i of site.rock) if (near[i] === 1) score++;
      if (score > worstScore) { worstScore = score; worst = k; }
    });
    if (worst < 0) return;
    sites.splice(worst, 1);
  }
}

function shape(c: ShapeCtx): WarrenPlan {
  const plan: WarrenPlan = { barrows: [], tunnels: [], crescent: [], mouths: [], bog: [], roads: 0, placed: 0 };
  // The route guard is asked for first: it must exist for the surface pass's `canSurface` to keep bog off the corridors.
  const guard = c.routeGuard();
  const nodes = zoneNodes(c);
  if (nodes.length < 2) return plan;
  const scale = areaScale(c.zone.painted);
  const barrowsMax = Math.round(BARROWS_PER_REF * scale), tunnelsMax = Math.round(TUNNELS_PER_REF * scale);
  const burrows: Array<readonly [number, number]> = [];
  for (const f of c.zoneFeatures()) if (f.kind === "landmark" && f.variant === "burrow") burrows.push([f.bbox.x + (f.bbox.w - 1) / 2, f.bbox.y + (f.bbox.h - 1) / 2]);
  const all = roads(nodes, ROAD_MIN2).filter((r) => !burrows.some(([bx, by]) => segDist2(bx, by, r.a.x, r.a.y, r.b.x, r.b.y) < BURROW_ROAD_NEAR2));
  plan.roads = all.length;
  if (barrowsMax <= 0 || all.length === 0) return plan;

  // 1. Plan: radius and centre per road (longest first) on the ground as it stands, each plan taking its tiles from the later ones.
  const { w, h } = c;
  const bb = c.zone.bbox;
  const campList: number[] = [];
  for (const k of c.camps) {
    if (k.x < bb.x - 12 || k.x > bb.x + bb.w + 12 || k.y < bb.y - 12 || k.y > bb.y + bb.h + 12) continue;
    campList.push(k.x, k.y, (k.r + BOG_CAMP_GAP) * (k.r + BOG_CAMP_GAP));
  }
  const memberList: number[] = [];
  for (const i of c.spawns) memberList.push(i % w, (i - (i % w)) / w);
  const g: Ground = {
    c, seen: new Uint8Array(w * h), core: guard.members.length > 0 ? coreOf(guard.corridor, bb, w, h) : new Uint8Array(w * h), corridor: guard.corridor,
    camps: Float64Array.from(campList), members: Int32Array.from(memberList), mark: new Uint8Array(w * h),
  };
  const sites: BarrowSite[] = [];
  for (const road of all) {
    if (sites.length >= barrowsMax) break;
    const site = siteOf(g, road, sites.length);
    if (!site) continue;
    sites.push(site);
    for (const i of site.rock) g.seen[i] = 2;
    for (const i of site.crescent) g.seen[i] = 2;
  }

  // 1b. The route guard's word on the plan (contract 4.3.5): measured with the rock standing (the guard is asked about walls that are
  //     not written yet), a plan that stretches a member's walk past the threshold loses the barrow that crowds that member's
  //     corridor most, and is measured again (a placed feature cannot be taken back, so this is the only place to act).
  const tunnelOrder = (list: readonly BarrowSite[]): number[] =>
    list.map((_, i) => i).filter((i) => list[i].r4 >= R4_TUNNEL).sort((p, q) => list[q].r4 - list[p].r4 || list[p].off2 - list[q].off2 || list[q].road.d2 - list[p].road.d2 || p - q);
  if (guard.members.length > 0) pruneForRoute(guard, sites, tunnelOrder, tunnelsMax, w, h);

  // 2. Write: the tunnel barrows first (the largest radii, the nearest their road among equals), then the rest, each as a trim feature.
  const bigFirst = tunnelOrder(sites);
  let tunnelsLeft = tunnelsMax;
  const done = new Uint8Array(sites.length);
  const roadOf = new Map<WarrenBarrow, Road>();
  const put = (idx: number, tunnel: boolean): boolean => {
    const site = sites[idx];
    let r = placeBarrow(c, site, tunnel);
    let bored = tunnel;
    if (!r && tunnel) { r = placeBarrow(c, site, false); bored = false; }
    if (!r) return false;
    const bar: WarrenBarrow = {
      id: r.placed.id, cx: site.cx, cy: site.cy, r4: site.r4, tunnel: bored, dir16: dirIndex16(site.road.dx, site.road.dy), wet: site.wet,
      walls: r.placed.written, slot: r.slot, crescent: site.crescent,
    };
    plan.barrows.push(bar);
    roadOf.set(bar, site.road);
    return bored;
  };
  for (const idx of bigFirst) {
    if (tunnelsLeft <= 0) break;
    done[idx] = 1;
    if (put(idx, true)) tunnelsLeft--;
  }
  for (let idx = 0; idx < sites.length; idx++) if (!done[idx]) put(idx, false);

  // 3. The tunnels' centre lines and mouths, the crescents that stand.
  const t = c.tiles;
  for (const bar of plan.barrows) {
    plan.crescent.push(...bar.crescent);
    if (!bar.tunnel || bar.slot.length === 0) continue;
    const { dx, dy } = roadOf.get(bar)!;
    const along = (i: number): number => ((i % w) - bar.cx) * dx + (Math.floor(i / w) - bar.cy) * dy;
    const slot = bar.slot.slice().sort((p, q) => along(p) - along(q) || p - q);
    plan.tunnels.push(slot);
    const inSlot = new Set(slot);
    const walls = new Set(bar.walls);
    for (const s of slot) {
      // a mouth tile has plain floor beside it that is not part of the slot
      if (![s - 1, s + 1, s - w, s + w].some((j) => t[j] === TILE_FLOOR && !inSlot.has(j))) continue;
      const x = s % w, y = Math.floor(s / w);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const j = c.at(x + ox, y + oy);
        if (j >= 0 && walls.has(j) && t[j] === TILE_WALL && !plan.mouths.includes(j)) plan.mouths.push(j);
      }
    }
  }
  plan.placed = plan.barrows.length;
  return plan;
}

// ------------------------------------------------------------------------------------------------ surface: the bog crescents
function surface(c: SurfaceCtx, plan: WarrenPlan): void {
  // The shape pass kept only crescent tiles that can stay bog (off the corridors, clear of the camps, in pieces of 8 or more).
  for (const i of plan.crescent) if (c.isOwned(i) && c.surface(i, "bog")) plan.bog.push(i);
}

// ------------------------------------------------------------------------------------------------ props
function props(c: PropCtx, plan: WarrenPlan): void {
  const w = c.w;
  const mouth = new Set(plan.mouths);
  for (const bar of plan.barrows) {
    for (const i of bar.walls) {
      const x = i % w, y = (i - x) / w;
      const v = Math.floor(c.noise.hash(x, y, 90) * 3);
      if (mouth.has(i)) { c.prop(PROP.tunnel_beam, x, y, v); continue; }
      const u = c.noise.hash(x, y, 1);
      if (u < 0.16) c.prop(PROP.fungus_cap, x, y, v);
      else if (u < 0.26) c.prop(PROP.drip, x, y, v);
    }
  }
  // reeds on the bog's edge: a bog tile with plain floor beside it
  for (const i of plan.bog) {
    const x = i % w, y = (i - x) / w;
    if (c.noise.hash(x, y, 3) >= 0.3) continue;
    if ([i - 1, i + 1, i - w, i + w].some((j) => c.tiles[j] === TILE_FLOOR && c.terrain[j] === 0)) c.prop(PROP.reed, x, y, Math.floor(c.noise.hash(x, y, 91) * 3));
  }
  // rubble on the burrow's floor (not its doors or crate nooks)
  for (const f of c.zoneFeatures()) {
    if (f.kind !== "landmark" || f.variant !== "burrow") continue;
    const s = stampTemplate(BURROW, f.ax, f.ay, (f.p[0] & 3) as 0 | 1 | 2 | 3, f.p[1] === 1, c.w, c.h);
    if (!s) continue;
    for (const i of s.floor) {
      const x = i % w, y = (i - x) / w;
      if (c.noise.hash(x, y, 4) < 0.18) c.prop(PROP.burrow_rubble, x, y, Math.floor(c.noise.hash(x, y, 92) * 3));
    }
  }
}

export const warren: ZoneStyler<WarrenPlan> = { id: "warren", faction: "plague", version: 400, landmark, shape, surface, props };
