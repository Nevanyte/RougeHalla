// The guards: every tile a styler changes goes through here. A blocker may only land on a FLOOR tile of the zone's own mask
// that is not protected, not owned by a feature, keeps the rim margin, fits the footprint budget, leaves the zone's floor (and
// its territory's) 4-connected, keeps LOW features thin and keeps ICE free of solid neighbours. Because every write is checked
// against the zone alone, a zone's output does not depend on the order zones are styled in. Features (placeFeature) are
// transactions over those writes: each write is logged and a feature that does not stand is rolled back (contract 3.1).
import { TILE } from "../constants";
import { SIMPLE, RING_DX, RING_DY } from "../gridTopology";
import { TILE_FLOOR, TILE_LOW, TILE_WALL } from "../map";
import type { MapFeature, MapProp, RegionFaction, TilePt } from "../map";
import { hashSeed, mulberry32 } from "../rng";
import { TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TERRAIN_NONE } from "../terrain";
import type { PropKindSpec } from "../terrain";
import { makeNoise } from "./kit";
import { FEATURE_MIN_PIECE } from "./types";
import type {
  BaseCtx, BlockKind, CampInfo, FeatureDraft, FeatureSpec, LandmarkCtx, PlacedFeature, PropCtx, RouteGuard, RouteGuardBuilder, ShapeCtx,
  StyleCaps, SurfaceCtx, SurfaceKind, ZoneInfo,
} from "./types";

const LOW_KIND: Readonly<Record<Exclude<BlockKind, "wall">, number>> = { lava: TERRAIN_LAVA, fence: TERRAIN_FENCE, crevasse: TERRAIN_CREVASSE };
const SURFACE_KIND: Readonly<Record<SurfaceKind, number>> = { ember: TERRAIN_EMBER, bog: TERRAIN_BOG, ice: TERRAIN_ICE, light: TERRAIN_LIGHT };
/** Manhattan radius 2 around a tile, the tile itself left out. */
const DIAMOND2: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0], [0, -2], [2, 0], [0, 2], [-2, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
/** Footprint cost per blocker, in hundredths of a tile: WALL and LOW both count 1.0 (contract 0.1.8). */
const COST_WALL = 100;
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
  /** The attempt's feature log (shared across zones and passes; appended to). */
  features: FeatureDraft[];
  /** 1 + feature-log index per tile, 0 = unowned (shared across zones and passes). */
  featureOwner: Uint16Array;
  /** Pool members standing in this zone (tile indices, pick order); empty in the landmark stage. */
  spawns: readonly number[];
  /** walkField16 to the coliseum centre at pool-pick time; null in the landmark stage and on fixtures. */
  centreWalk: Int32Array | null;
  /** Builds the zone's route guard on the first `routeGuard()`; absent: `routeGuard()` throws. */
  routeGuard?: RouteGuardBuilder;
}

/** A transaction mark: the log length and the counters as they were. */
interface TxMark { len: number; walls: number; lows: number }

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
  /** Features this pass recorded. */
  featuresAdded = 0;
  private joinLeft: number;
  private readonly limit100: number;
  private readonly rimMin: number;
  private readonly propCap: number;
  private readonly NB4: readonly number[];
  // The transaction log: one entry per tile write while a feature is being placed (the tile, and its class, kind and `wrote`
  // flag before the write). Outside placeFeature nothing is logged.
  private txOn = false;
  private txTile: number[] = [];
  private txClass: number[] = [];
  private txKind: number[] = [];
  private txWrote: number[] = [];
  private guard: RouteGuard | null = null;

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

  isOwned(i: number): boolean {
    return i >= 0 && i < this.n && this.init.featureOwner[i] !== 0;
  }

  /** This zone's features so far, in log order (landmarks first: their stage runs before the shape pass). */
  zoneFeatures(): readonly MapFeature[] {
    const f = this.init.info.faction;
    return this.init.features.filter((d) => d.zone === f);
  }

  /** The zone's route guard, built on first call by the init's builder (`ctx` is the context it is built from). */
  routeGuardFor(ctx: BaseCtx): RouteGuard {
    if (this.guard) return this.guard;
    if (!this.init.routeGuard) throw new Error("routeGuard: no route guard builder was given to this zone pass");
    this.guard = this.init.routeGuard(ctx);
    return this.guard;
  }

  // -------------------------------------------------------------------------------- blockers

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

  /** The static part of canBlock: FLOOR, in the zone, not protected, not owned, past the rim, not reserved, off the grid edge. */
  open(i: number): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w, h } = this;
    if (!init.mask[i] || init.hard[i] || init.noBlock[i] || init.tiles[i] !== TILE_FLOOR || this.reserved[i] || init.edgeDist[i] < this.rimMin) return false;
    if (init.featureOwner[i] !== 0) return false;
    const x = i % w, y = (i - x) / w;
    return x > 0 && y > 0 && x < w - 1 && y < h - 1;
  }

  canBlock(i: number, kind: BlockKind): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w, h } = this;
    const { mask, hard, tiles, noBlock, edgeDist, territory } = init;
    if (!mask[i] || hard[i] || init.featureOwner[i] !== 0) return false;
    const t = tiles[i];
    if (t === TILE_LOW) {
      if (kind !== "wall") return false;
      // A LOW tile this pass wrote is already in the footprint (WALL and LOW cost the same). One it did not write (the generator's
      // river) is a NEW wall in the footprint and pays like a floor tile.
      return init.wrote[i] === 1 || COST_WALL * this.walls + COST_LOW * this.lows + COST_WALL <= this.limit100;
    }
    if (t !== TILE_FLOOR) return false;
    if (noBlock[i] || this.reserved[i] || edgeDist[i] < this.rimMin) return false;
    const x = i % w, y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return false;
    const cost = kind === "wall" ? COST_WALL : COST_LOW;
    if (COST_WALL * this.walls + COST_LOW * this.lows + cost > this.limit100) return false;
    if (this.nearIce(x, y)) return false;
    if (kind === "fence" && !this.detourOk(i, init.caps.fenceDetour, 3)) return false;
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
    this.log(i);
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
    this.log(i);
    tiles[i] = TILE_FLOOR;
    terrain[i] = TERRAIN_NONE;
    wrote[i] = 0;
    this.lows--;
    return true;
  }

  fenceDetourOk(i: number): boolean {
    return this.detourOk(i, this.init.caps.fenceDetour, 3);
  }

  // -------------------------------------------------------------------------------- features
  private log(i: number): void {
    if (!this.txOn) return;
    const { tiles, terrain, wrote } = this.init;
    this.txTile.push(i);
    this.txClass.push(tiles[i]);
    this.txKind.push(terrain[i]);
    this.txWrote.push(wrote[i]);
  }

  private mark(): TxMark {
    return { len: this.txTile.length, walls: this.walls, lows: this.lows };
  }

  /** Undoes every logged write after `m`, newest first, and restores the counters. */
  private rollback(m: TxMark): void {
    const { tiles, terrain, wrote } = this.init;
    for (let k = this.txTile.length - 1; k >= m.len; k--) {
      const i = this.txTile[k];
      tiles[i] = this.txClass[k];
      terrain[i] = this.txKind[k];
      wrote[i] = this.txWrote[k];
    }
    this.txTile.length = this.txClass.length = this.txKind.length = this.txWrote.length = m.len;
    this.walls = m.walls;
    this.lows = m.lows;
  }

  /** Gives tile i back to what it was before log entry k (its first write in the feature), keeping the counters right. */
  private giveBack(k: number): void {
    const { tiles, terrain, wrote } = this.init;
    const i = this.txTile[k], cur = tiles[i], old = this.txClass[k];
    if (cur === TILE_WALL) {
      this.walls--;
      if (old === TILE_LOW && this.txWrote[k]) this.lows++;
    } else if (cur === TILE_LOW && old === TILE_FLOOR) this.lows--;
    tiles[i] = old;
    terrain[i] = this.txKind[k];
    wrote[i] = this.txWrote[k];
  }

  /** Size of the 8-connected piece of tile i's class (WALL or LOW) holding it, counted up to `cap`. */
  private pieceSize(i: number, cap: number): number {
    const { w, h } = this;
    const { tiles } = this.init;
    const sc = this.init.scratch;
    const { mark, qa } = sc;
    const cls = tiles[i];
    const stamp = ++sc.epoch;
    let head = 0, tail = 0;
    qa[tail++] = i; mark[i] = stamp;
    while (head < tail && tail < cap) {
      const cur = qa[head++];
      const x = cur % w, y = (cur - x) / w;
      for (let q = 0; q < 8 && tail < cap; q++) {
        const nx = x + RING_DX[q], ny = y + RING_DY[q];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mark[j] === stamp || tiles[j] !== cls) continue;
        mark[j] = stamp;
        qa[tail++] = j;
      }
    }
    return tail;
  }

  placeFeature(spec: FeatureSpec): PlacedFeature | null {
    const { init } = this;
    const { tiles, mask, featureOwner, features } = init;
    const blocks = spec.blocks;
    if (spec.groups && spec.groups.length !== blocks.length) throw new RangeError(`placeFeature: ${spec.groups.length} groups for ${blocks.length} blocks`);
    if (this.txOn) throw new Error("placeFeature: features do not nest");
    this.txOn = true;
    const start = this.mark();
    // The log index of each block's write (-1: refused or rolled back).
    const entry = new Int32Array(blocks.length).fill(-1);
    const put = (b: number): boolean => {
      const before = this.txTile.length;
      if (!this.block(blocks[b][0], blocks[b][1])) return false;
      entry[b] = before;
      return true;
    };
    let ok = true;
    if (spec.mode === "whole") {
      for (let b = 0; b < blocks.length && ok; b++) ok = put(b);
    } else if (spec.mode === "trim") {
      for (let b = 0; b < blocks.length; b++) put(b);
    } else {
      // Groups in order of first appearance; each stands whole or is rolled back to where it began.
      const groups = spec.groups ?? new Array<number>(blocks.length).fill(0);
      const order: number[] = [];
      const seen = new Set<number>();
      for (const g of groups) if (!seen.has(g)) { seen.add(g); order.push(g); }
      let standing = 0;
      for (const g of order) {
        const m = this.mark();
        let whole = true;
        for (let b = 0; b < blocks.length && whole; b++) if (groups[b] === g) whole = put(b);
        if (whole) standing++;
        else {
          this.rollback(m);
          for (let b = 0; b < blocks.length; b++) if (groups[b] === g) entry[b] = -1;
        }
      }
      ok = standing >= (spec.minGroups ?? 1);
    }
    if (ok && spec.mode === "trim") {
      // Small pieces holding a tile written here give those tiles back (walls already on the map count towards a piece).
      const minPiece = spec.minPiece ?? FEATURE_MIN_PIECE;
      const sc = init.scratch;
      const back: number[] = [];
      for (let b = 0; b < blocks.length; b++) {
        if (entry[b] < 0) continue;
        const i = blocks[b][0];
        if (tiles[i] === TILE_FLOOR) continue;
        if (this.pieceSize(i, minPiece) >= minPiece) continue;
        // The piece is small: every written tile in it goes back (the search above enumerated the whole piece).
        const stamp = sc.epoch;
        for (let c = 0; c < blocks.length; c++) if (entry[c] >= 0 && sc.mark[blocks[c][0]] === stamp && tiles[blocks[c][0]] !== TILE_FLOOR) back.push(c);
        for (const c of back) { this.giveBack(entry[c]); entry[c] = -1; }
        back.length = 0;
      }
      let stands = 0;
      for (let b = 0; b < blocks.length; b++) if (entry[b] >= 0 && tiles[blocks[b][0]] !== TILE_FLOOR) stands++;
      ok = stands * 1000 >= (spec.minSharePermille ?? 600) * blocks.length;
    }
    // The blocks that stand, each tile once (a tile listed twice, or given back after a later write, counts as it ends up).
    const written: number[] = [];
    if (ok) {
      const sc = init.scratch;
      const stamp = ++sc.epoch;
      for (let b = 0; b < blocks.length; b++) {
        const i = blocks[b][0];
        if (entry[b] < 0 || tiles[i] === TILE_FLOOR || sc.mark[i] === stamp) continue;
        sc.mark[i] = stamp;
        written.push(i);
      }
    }
    // Floor tiles: FLOOR in this zone and owned by nobody (the blocks just written are no longer FLOOR).
    const floor: number[] = [];
    if (ok && spec.floor) {
      const sc = init.scratch;
      const stamp = ++sc.epoch;
      for (const f of spec.floor) {
        if (!(f >= 0 && f < this.n) || !mask[f] || tiles[f] !== TILE_FLOOR || featureOwner[f] !== 0 || sc.mark[f] === stamp) continue;
        sc.mark[f] = stamp;
        floor.push(f);
      }
    }
    this.txOn = false;
    if (!ok || written.length + floor.length === 0) {
      this.rollback(start);
      return null;
    }
    this.txTile.length = this.txClass.length = this.txKind.length = this.txWrote.length = 0;
    const id = features.length;
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (const list of [written, floor]) {
      for (const i of list) {
        featureOwner[i] = id + 1;
        const x = i % this.w, y = (i - x) / this.w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    features.push({
      kind: spec.kind, variant: spec.variant ?? "", zone: init.info.faction, jobs: spec.jobs.slice(), ax: spec.anchor[0], ay: spec.anchor[1],
      p: spec.params ? spec.params.slice() : [], bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, tiles: written.length + floor.length,
    });
    this.featuresAdded++;
    return { id, written, refused: blocks.length - written.length };
  }

  // -------------------------------------------------------------------------------- surfaces
  canSurface(i: number, kind: SurfaceKind): boolean {
    if (!(i >= 0 && i < this.n)) return false;
    const { init, w } = this;
    const { mask, hard, tiles, terrain, noBlock } = init;
    if (!mask[i] || hard[i] || tiles[i] !== TILE_FLOOR || terrain[i] !== TERRAIN_NONE) return false;
    if (kind !== "light" && noBlock[i] === 1) return false;
    // A landmark's floor is protected no more (its feature owns it); only its light may be lit there, no hazard.
    if (kind !== "light") {
      const o = init.featureOwner[i];
      if (o !== 0 && init.features[o - 1].kind === "landmark") return false;
    }
    // A hazard that slows a walk (bog, ice) never lies on a pool member's corridor (contract 3.9): the spawn gate caps the hazard
    // tiles on every member's walk.
    if ((kind === "bog" || kind === "ice") && this.guard !== null && this.guard.corridor[i] === 1) return false;
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

/** The camps whose centre lies in the zone (`camps` of a context is this zone's: the stylers' graphs are over its own camps). */
function zoneCampsOf(init: ZoneRuntimeInit): readonly CampInfo[] {
  const { mask, w } = init;
  return init.camps.filter((k) => mask[k.y * w + k.x] === 1);
}

/** The read-only part every context shares; `stream` picks the rng (0 shape, 1 decor, 2 surface, 3 landmark). */
function baseOf(rt: ZoneRuntime, stream: number): BaseCtx {
  const { init } = rt;
  return {
    w: init.w, h: init.h, seed: init.seed, attempt: init.attempt, zone: init.info, mask: init.mask, hard: init.hard, noBlock: init.noBlock,
    tiles: init.tiles, terrain: init.terrain, edgeDist: init.edgeDist, territory: init.territory, camps: zoneCampsOf(init),
    rng: mulberry32(streamSeedOf(init, stream)),
    noise: makeNoise(streamSeedOf(init, stream + 100)),
    at: (x, y) => rt.at(x, y),
    spawns: init.spawns,
    centreWalk: init.centreWalk,
    zoneFeatures: () => rt.zoneFeatures(),
    isOwned: (i) => rt.isOwned(i),
  };
}

/** The writing part of the shape and landmark contexts (stream 0 or 3). */
function writerOf(rt: ZoneRuntime, stream: number): LandmarkCtx {
  return {
    ...baseOf(rt, stream),
    caps: rt.init.caps,
    canBlock: (i, kind) => rt.canBlock(i, kind),
    block: (i, kind) => rt.block(i, kind),
    release: (i) => rt.release(i),
    fenceDetourOk: (i) => rt.fenceDetourOk(i),
    reserve: (i) => { if (i >= 0 && i < rt.n) rt.reserved[i] = 1; },
    isReserved: (i) => rt.reserved[i] === 1,
    open: (i) => rt.open(i),
    placeFeature: (spec) => rt.placeFeature(spec),
  };
}

export function shapeCtx(rt: ZoneRuntime): ShapeCtx {
  const ctx: ShapeCtx = { ...writerOf(rt, 0), routeGuard: () => rt.routeGuardFor(ctx) };
  return ctx;
}

/** The landmark stage's context: the shape context's writers on stream 3 (STYLE_STREAM.landmark), no route guard. */
export function landmarkCtx(rt: ZoneRuntime): LandmarkCtx {
  return writerOf(rt, 3);
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
