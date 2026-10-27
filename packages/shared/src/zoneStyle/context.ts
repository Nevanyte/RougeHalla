// The guards: every tile a styler changes goes through here. A blocker may only land on a FLOOR tile of the zone's own mask
// that is not protected, keeps the rim margin, fits the footprint budget, leaves the zone's floor (and its territory's)
// 4-connected, keeps straight wall runs short, keeps LOW features thin and keeps ICE free of solid neighbours. Because
// every write is checked against the zone alone, a zone's output does not depend on the order zones are styled in.
import { TILE } from "../constants";
import { SIMPLE, RING_DX, RING_DY } from "../gridTopology";
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../map";
import type { MapProp, RegionFaction, TilePt } from "../map";
import { hashSeed, mulberry32 } from "../rng";
import { TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TERRAIN_NONE } from "../terrain";
import type { PropKindSpec } from "../terrain";
import { makeNoise } from "./kit";
import type { BaseCtx, BlockKind, CampInfo, PropCtx, ShapeCtx, StyleCaps, SurfaceCtx, SurfaceKind, ZoneInfo } from "./types";

const LOW_KIND: Readonly<Record<Exclude<BlockKind, "wall">, number>> = { lava: TERRAIN_LAVA, fence: TERRAIN_FENCE, crevasse: TERRAIN_CREVASSE };
const SURFACE_KIND: Readonly<Record<SurfaceKind, number>> = { ember: TERRAIN_EMBER, bog: TERRAIN_BOG, ice: TERRAIN_ICE, light: TERRAIN_LIGHT };
/** Manhattan radius 2 around a tile, the tile itself left out. */
const DIAMOND2: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0], [0, -2], [2, 0], [0, 2], [-2, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const COST_WALL = 35;
const COST_LOW = 100;

/** Scratch arrays shared by every zone pass of one styleZones call (join checks run thousands of times). */
export interface Scratch {
  mark: Int32Array;
  qa: Int32Array;
  qb: Int32Array;
  depth: Int16Array;
  epoch: number;
}

export function makeScratch(n: number): Scratch {
  return { mark: new Int32Array(n), qa: new Int32Array(n), qb: new Int32Array(n), depth: new Int16Array(n), epoch: 0 };
}

export interface ZoneRuntimeInit {
  w: number;
  h: number;
  seed: number;
  attempt: number;
  info: ZoneInfo;
  mask: Uint8Array;
  hard: Uint8Array;
  noBlock: Uint8Array;
  noProp: Uint8Array;
  tiles: Uint8Array;
  terrain: Uint8Array;
  props: MapProp[];
  edgeDist: Int32Array;
  territory: Uint8Array | null;
  camps: readonly CampInfo[];
  caps: StyleCaps;
  scratch: Scratch;
  /** Tiles this pass wrote (shared across zones: a zone only writes its own tiles). */
  wrote: Uint8Array;
  propKinds: readonly PropKindSpec[];
}

/** Everything one zone pass shares between its shape, surface and prop contexts. */
export class ZoneRuntime {
  readonly w: number;
  readonly h: number;
  readonly n: number;
  walls = 0;
  lows = 0;
  refused = 0;
  joinUsed = 0;
  surfaced = 0;
  propsAdded = 0;
  readonly reserved: Uint8Array;
  private joinLeft: number;
  private readonly limit100: number;
  private readonly rimMin: number;
  private readonly propCap: number;
  private readonly NB4: readonly number[];

  constructor(readonly init: ZoneRuntimeInit) {
    this.w = init.w;
    this.h = init.h;
    this.n = init.w * init.h;
    this.reserved = new Uint8Array(this.n);
    this.joinLeft = init.caps.joinChecks;
    this.limit100 = init.caps.footprintPct * init.info.painted;
    this.rimMin = init.caps.rimTiles * 3;
    this.propCap = Math.floor((8 * init.info.painted) / 100);
    this.NB4 = [-init.w, 1, init.w, -1];
  }

  at(x: number, y: number): number {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? y * this.w + x : -1;
  }

  // -------------------------------------------------------------------------------- blockers
  /** Straight horizontal or vertical WALL run through tile i if it were a wall. */
  private wallRunOk(i: number): boolean {
    const { w, h, init } = this;
    const { tiles, caps } = init;
    const x = i % w, y = (i - x) / w;
    let run = 1;
    for (let k = x - 1; k >= 0 && tiles[y * w + k] === TILE_WALL; k--) run++;
    for (let k = x + 1; k < w && tiles[y * w + k] === TILE_WALL; k++) run++;
    if (run > caps.maxWallRun) return false;
    run = 1;
    for (let k = y - 1; k >= 0 && tiles[k * w + x] === TILE_WALL; k--) run++;
    for (let k = y + 1; k < h && tiles[k * w + x] === TILE_WALL; k++) run++;
    return run <= caps.maxWallRun;
  }

  private nearIce(x: number, y: number): boolean {
    const { terrain } = this.init;
    for (let q = 0; q < 8; q++) {
      const j = this.at(x + RING_DX[q], y + RING_DY[q]);
      if (j >= 0 && terrain[j] === TERRAIN_ICE) return true;
    }
    return false;
  }

  /** Is there a FLOOR tile within manhattan 2 of (x, y), other than tile `except`? */
  private floorNear(x: number, y: number, except: number): boolean {
    const { tiles } = this.init;
    for (const [dx, dy] of DIAMOND2) {
      const j = this.at(x + dx, y + dy);
      if (j >= 0 && j !== except && tiles[j] === TILE_FLOOR) return true;
    }
    return false;
  }

  /**
   * LOW features stay thin: every LOW tile keeps a FLOOR tile within manhattan 2 (validateTerrain's T5 allows 4), so a click
   * on a river or a fence walks to a bank. Turning tile i solid must not strand a LOW tile near it, nor be one itself.
   */
  private lowSupportOk(x: number, y: number, i: number, becomesLow: boolean): boolean {
    const { tiles } = this.init;
    if (becomesLow && !this.floorNear(x, y, i)) return false;
    for (const [dx, dy] of DIAMOND2) {
      const j = this.at(x + dx, y + dy);
      if (j >= 0 && tiles[j] === TILE_LOW && !this.floorNear(j % this.w, (j - (j % this.w)) / this.w, i)) return false;
    }
    return true;
  }

  /**
   * Are all of tile i's orthogonal FLOOR neighbours that lie in `scope` (scope[j] === value) still joined once i is solid,
   * walking only FLOOR tiles of that scope? Alternating breadth-first search from the first neighbour towards each other
   * one: the smaller side runs dry first when i is a cut.
   */
  private joinedWithout(i: number, scope: Uint8Array, value: number): boolean {
    const { w, h, NB4 } = this;
    const { tiles } = this.init;
    const x = i % w, y = (i - x) / w;
    const ends: number[] = [];
    for (let e = 0; e < 4; e++) {
      const nx = x + (e === 1 ? 1 : e === 3 ? -1 : 0), ny = y + (e === 0 ? -1 : e === 2 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = i + NB4[e];
      if (tiles[j] === TILE_FLOOR && scope[j] === value) ends.push(j);
    }
    if (ends.length <= 1) return true;
    const saved = tiles[i];
    tiles[i] = TILE_WALL;
    let ok = true;
    for (let k = 1; k < ends.length && ok; k++) ok = this.joins(ends[0], ends[k], scope, value);
    tiles[i] = saved;
    return ok;
  }

  /**
   * Walking the floor of this zone (4-connected, tile i taken as solid), can floor tile a reach floor tile b in at most `limit`
   * steps? A bounded breadth-first search: a fence that cuts a street must not leave only a long way round.
   */
  private reachesWithin(a: number, b: number, i: number, limit: number): boolean {
    const { w, h, NB4 } = this;
    const { tiles, mask } = this.init;
    const sc = this.init.scratch;
    const { mark, qa, depth } = sc;
    const stamp = ++sc.epoch;
    let head = 0, tail = 0;
    qa[tail++] = a; mark[a] = stamp; depth[a] = 0;
    while (head < tail) {
      const cur = qa[head++];
      if (cur === b) return true;
      if (depth[cur] >= limit) continue;
      const x = cur % w, y = (cur - x) / w;
      for (let e = 0; e < 4; e++) {
        const nx = x + (e === 1 ? 1 : e === 3 ? -1 : 0), ny = y + (e === 0 ? -1 : e === 2 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = cur + NB4[e];
        if (j === i || tiles[j] !== TILE_FLOOR || !mask[j] || mark[j] === stamp) continue;
        mark[j] = stamp;
        depth[j] = depth[cur] + 1;
        qa[tail++] = j;
      }
    }
    return false;
  }

  /**
   * The detour a fence or wall on tile i would force on the pairs of floor tiles it stands between: tiles k steps either side of
   * it along a row or a column (k = 1 for a wall, 1..3 for a fence: pairs up to 6 tiles apart) with open floor between them
   * and i. Each pair must still walk from one to the other in at most 2k + cap steps.
   */
  private detourOk(i: number, cap: number, reach: number): boolean {
    const { w, h, init } = this;
    const { tiles, mask } = init;
    const x = i % w, y = (i - x) / w;
    for (const step of [w, 1]) {
      for (let k = 1; k <= reach; k++) {
        if (step === 1 ? x - k < 0 || x + k >= w : y - k < 0 || y + k >= h) break; // off the grid: no pair this far across
        const a = i - k * step, b = i + k * step;
        if (tiles[a] !== TILE_FLOOR || tiles[b] !== TILE_FLOOR || !mask[a] || !mask[b]) break; // no pair this far across
        if (!this.reachesWithin(a, b, i, 2 * k + cap)) return false;
      }
    }
    return true;
  }

  private joins(s: number, u: number, scope: Uint8Array, value: number): boolean {
    const { w, h, NB4 } = this;
    const sc = this.init.scratch;
    const { tiles } = this.init;
    const { mark, qa, qb } = sc;
    const markA = ++sc.epoch, markB = ++sc.epoch;
    let headA = 0, tailA = 0, headB = 0, tailB = 0;
    qa[tailA++] = s; mark[s] = markA;
    qb[tailB++] = u; mark[u] = markB;
    while (headA < tailA && headB < tailB) {
      const i = qa[headA++];
      const x = i % w, y = (i - x) / w;
      for (let e = 0; e < 4; e++) {
        const nx = x + (e === 1 ? 1 : e === 3 ? -1 : 0), ny = y + (e === 0 ? -1 : e === 2 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = i + NB4[e];
        if (tiles[j] !== TILE_FLOOR || scope[j] !== value) continue;
        if (mark[j] === markB) return true;
        if (mark[j] !== markA) { mark[j] = markA; qa[tailA++] = j; }
      }
      const i2 = qb[headB++];
      const x2 = i2 % w, y2 = (i2 - x2) / w;
      for (let e = 0; e < 4; e++) {
        const nx = x2 + (e === 1 ? 1 : e === 3 ? -1 : 0), ny = y2 + (e === 0 ? -1 : e === 2 ? 1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = i2 + NB4[e];
        if (tiles[j] !== TILE_FLOOR || scope[j] !== value) continue;
        if (mark[j] === markA) return true;
        if (mark[j] !== markB) { mark[j] = markB; qb[tailB++] = j; }
      }
    }
    return false;
  }

  /** The static part of canBlock: FLOOR, in the zone, not protected, past the rim, not reserved, off the grid edge. */
  open(i: number): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w, h } = this;
    if (!init.mask[i] || init.hard[i] || init.noBlock[i] || init.tiles[i] !== TILE_FLOOR || this.reserved[i] || init.edgeDist[i] < this.rimMin) return false;
    const x = i % w, y = (i - x) / w;
    return x > 0 && y > 0 && x < w - 1 && y < h - 1;
  }

  canBlock(i: number, kind: BlockKind): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w, h } = this;
    const { mask, hard, tiles, noBlock, edgeDist, territory } = init;
    if (!mask[i] || hard[i]) return false;
    const t = tiles[i];
    if (t === TILE_LOW) {
      if (kind !== "wall" || !this.wallRunOk(i)) return false;
      // A LOW tile this pass wrote turns from COST_LOW into the cheaper COST_WALL (the budget only drops, no check). One it did
      // not write (the generator's river) is a NEW wall in the footprint and pays the wall cost like a floor tile.
      return init.wrote[i] === 1 || COST_WALL * this.walls + COST_LOW * this.lows + COST_WALL <= this.limit100;
    }
    if (t !== TILE_FLOOR) return false;
    if (noBlock[i] || this.reserved[i] || edgeDist[i] < this.rimMin) return false;
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
    const cost = kind === "wall" ? COST_WALL : COST_LOW;
    if (COST_WALL * this.walls + COST_LOW * this.lows + cost > this.limit100) return false;
    if (this.nearIce(x, y)) return false;
    if (kind === "wall" && !this.wallRunOk(i)) return false;
    if ((kind === "fence" && !this.detourOk(i, init.caps.fenceDetour, 3)) || (kind === "wall" && !this.detourOk(i, init.caps.wallDetour, 1))) return false;
    if (!this.lowSupportOk(x, y, i, kind !== "wall")) return false;
    // The simple-point test on this zone's own floor; a FLOOR neighbour of another zone is a seam, never written next to.
    let m = 0, mt = 0;
    const tv = territory ? territory[i] : 0;
    for (let q = 0; q < 8; q++) {
      const j = i + RING_DY[q] * w + RING_DX[q];
      if (tiles[j] !== TILE_FLOOR) continue;
      if (!mask[j]) return false;
      m |= 1 << q;
      if (tv !== 0 && territory![j] === tv) mt |= 1 << q;
    }
    if (!SIMPLE[m]) {
      if (this.joinLeft <= 0) return false;
      this.joinLeft--;
      this.joinUsed++;
      if (!this.joinedWithout(i, mask, 1)) return false;
    }
    if (tv !== 0 && !SIMPLE[mt]) {
      if (this.joinLeft <= 0) return false;
      this.joinLeft--;
      this.joinUsed++;
      if (!this.joinedWithout(i, territory!, tv)) return false;
    }
    return true;
  }

  block(i: number, kind: BlockKind): boolean {
    if (!this.canBlock(i, kind)) {
      this.refused++;
      return false;
    }
    const { tiles, terrain, wrote } = this.init;
    if (tiles[i] === TILE_LOW) {
      // A pillar standing in the river: the LOW kind stays on the tile (decor only), sight is now blocked. Only a tile this pass
      // wrote gives its LOW count back; a river the generator laid is not ours to refund, the pillar is a new wall.
      tiles[i] = TILE_WALL;
      if (wrote[i]) this.lows--;
      this.walls++;
    } else if (kind === "wall") {
      tiles[i] = TILE_WALL;
      terrain[i] = TERRAIN_NONE;
      this.walls++;
    } else {
      tiles[i] = TILE_LOW;
      terrain[i] = LOW_KIND[kind];
      this.lows++;
    }
    wrote[i] = 1;
    return true;
  }

  release(i: number): boolean {
    const { tiles, terrain, wrote } = this.init;
    if (!(i >= 0 && i < this.n) || !wrote[i] || tiles[i] !== TILE_LOW) return false;
    tiles[i] = TILE_FLOOR;
    terrain[i] = TERRAIN_NONE;
    wrote[i] = 0;
    this.lows--;
    return true;
  }

  fenceDetourOk(i: number): boolean {
    return this.detourOk(i, this.init.caps.fenceDetour, 3);
  }

  // -------------------------------------------------------------------------------- surfaces
  canSurface(i: number, kind: SurfaceKind): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w } = this;
    const { mask, hard, tiles, terrain, noBlock } = init;
    if (!mask[i] || hard[i] || tiles[i] !== TILE_FLOOR || terrain[i] !== TERRAIN_NONE) return false;
    if (kind !== "light" && noBlock[i] === 1) return false;
    if (kind === "bog" || kind === "light") return true;
    const x = i % w, y = (i - x) / w;
    if (kind === "ember") {
      for (let q = 0; q < 8; q++) {
        const j = this.at(x + RING_DX[q], y + RING_DY[q]);
        if (j >= 0 && tiles[j] === TILE_LOW && terrain[j] === TERRAIN_LAVA) return true;
      }
      return false;
    }
    // ICE: the fighter slides, and a wall or LOW tile within one tile of the sheet breaks the client's prediction
    for (let q = 0; q < 8; q++) {
      const j = this.at(x + RING_DX[q], y + RING_DY[q]);
      if (j < 0 || tiles[j] !== TILE_FLOOR) return false;
    }
    return true;
  }

  surface(i: number, kind: SurfaceKind): boolean {
    if (!this.canSurface(i, kind)) return false;
    this.init.terrain[i] = SURFACE_KIND[kind];
    this.surfaced++;
    return true;
  }

  // -------------------------------------------------------------------------------- props
  prop(kind: number, x: number, y: number, v: number): boolean {
    const i = this.at(x, y);
    if (i < 0 || this.propsAdded >= this.propCap) return false;
    const { mask, noProp, tiles, props, propKinds, info } = this.init;
    if (!mask[i] || noProp[i]) return false;
    const spec = propKinds[kind];
    if (!spec || tiles[i] !== spec.on || (spec.home !== null && spec.home !== info.faction)) return false;
    props.push({ kind, x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, v });
    this.propsAdded++;
    return true;
  }
}

function streamSeedOf(init: ZoneRuntimeInit, stream: number): number {
  return hashSeed(init.seed, init.attempt, init.info.index, stream);
}

/** The read-only part every context shares; `stream` picks the rng (0 shape, 1 decor, 2 surface). */
function baseOf(rt: ZoneRuntime, stream: number): BaseCtx {
  const { init } = rt;
  return {
    w: init.w, h: init.h, seed: init.seed, attempt: init.attempt, zone: init.info, mask: init.mask, hard: init.hard, noBlock: init.noBlock,
    tiles: init.tiles, terrain: init.terrain, edgeDist: init.edgeDist, territory: init.territory, camps: init.camps,
    rng: mulberry32(streamSeedOf(init, stream)),
    noise: makeNoise(streamSeedOf(init, stream + 100)),
    at: (x, y) => rt.at(x, y),
  };
}

export function shapeCtx(rt: ZoneRuntime): ShapeCtx {
  return {
    ...baseOf(rt, 0),
    caps: rt.init.caps,
    canBlock: (i, kind) => rt.canBlock(i, kind),
    block: (i, kind) => rt.block(i, kind),
    release: (i) => rt.release(i),
    fenceDetourOk: (i) => rt.fenceDetourOk(i),
    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },
    isReserved: (i) => rt.reserved[i] === 1,
    open: (i) => rt.open(i),
  };
}

export function surfaceCtx(rt: ZoneRuntime): SurfaceCtx {
  return {
    ...baseOf(rt, 2),
    canSurface: (i, kind) => rt.canSurface(i, kind),
    surface: (i, kind) => rt.surface(i, kind),
  };
}

export function propCtx(rt: ZoneRuntime): PropCtx {
  return {
    ...baseOf(rt, 1),
    prop: (kind, x, y, v) => rt.prop(kind, x, y, v),
  };
}

// ------------------------------------------------------------------------------------------------ zone info
/** The zone's summary: counts, bounding box, deepest tile, centroid and major axis (closed-form eigenvector, sqrt only). */
export function zoneInfoOf(index: number, faction: RegionFaction, mask: Uint8Array, tiles: Uint8Array, edgeDist: Int32Array, w: number, h: number): ZoneInfo {
  let painted = 0, floor = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0, deepest = -1, deepestD = -1;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    painted++;
    if (tiles[i] === TILE_FLOOR) floor++;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    sx += x + 0.5;
    sy += y + 0.5;
    if (edgeDist[i] > deepestD) { deepestD = edgeDist[i]; deepest = i; }
  }
  if (painted === 0) {
    return { index, faction, painted: 0, floor: 0, bbox: { x: 0, y: 0, w: 0, h: 0 }, pole: { x: 0, y: 0 }, centroid: { x: 0, y: 0 }, axis: { x: 1, y: 0 } };
  }
  const cx = sx / painted, cy = sy / painted;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const dx = (i % w) + 0.5 - cx, dy = Math.floor(i / w) + 0.5 - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const half = (sxx - syy) / 2;
  const lambda = (sxx + syy) / 2 + Math.sqrt(half * half + sxy * sxy);
  let ax = sxy, ay = lambda - sxx;
  if (ax === 0 && ay === 0) { ax = sxx >= syy ? 1 : 0; ay = sxx >= syy ? 0 : 1; }
  const len = Math.sqrt(ax * ax + ay * ay);
  ax /= len; ay /= len;
  if (ax < 0 || (ax === 0 && ay < 0)) { ax = -ax; ay = -ay; }
  const pole: TilePt = { x: deepest % w, y: (deepest - (deepest % w)) / w };
  return { index, faction, painted, floor, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, pole, centroid: { x: cx, y: cy }, axis: { x: ax, y: ay } };
}
