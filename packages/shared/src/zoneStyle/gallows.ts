// Gallows (sentenced): THE ROWS (zone-shapes contract 4.2, WP2), the `gallows` styler below.
import { TILE_FLOOR, TILE_LOW } from "../map";
import { ROUTE_STRETCH_MAX, campNodes, isqrt, viterbiPath, viterbiRows } from "./features";
import { bestLandmark, makeLandmarkSearch, stampTemplate } from "./landmarks";
import type { LandmarkTemplate, Stamp } from "./landmarks";
import { PROP } from "./propKinds";
import { LANDMARKS_PER_ZONE, areaScale } from "./scale";
import type { LandmarkCtx, PropCtx, RouteGuard, ShapeCtx, ZoneStyler } from "./types";

// ====================================================================================================================
// THE ROWS (zone-shapes contract 4.2, WP2): long fenced lanes toward the coliseum; you see and shoot across everything, you cross
// only at staggered gates. Fences (TILE_LOW + TERRAIN_FENCE) stop bodies and melee swings but not sight or shots, so Sentenced's bow
// shoots across a row while a melee chaser walks to a gate (at most 10 extra tiles: the guard's fenceDetour cap).
//
// The shape pass, in order (every wall and fence goes through placeFeature, whole or trimmed; no single tiles, no piece under 6):
//   1. axis: v = zone centroid - coliseum centre; rows run along x (s = x, t = y) when |vx| >= |vy|, else along y;
//   2. row positions: the lateral t of each row, a 1-D Viterbi (viterbiRows) over the open runs of >= 8 tiles per line, rows 7-9 apart;
//   3. the square: between two neighbouring rows, the 9-tile window nearest the zone's centroid (blocked tiles cost) is left open on
//      both bounding rows, and the 3x3 wall gallows stands in it (a "gallows" feature, whole). It is placed before the rows are
//      traced, so a row's path sees it (the contract lists it after the paths);
//   4. row paths: a second Viterbi per row (viterbiPath, 7 lateral states) follows the open ground by one-tile jogs; open stretches of
//      >= 10 positions become fence except at the gates (gallowsGateOpen: 3 tiles every 12, the phase alternating 2 / 8 row to row,
//      by true modulo over the whole row), so every fence tile lies within 5 tiles of a gate: a detour of at most 10 = the cap.
//      A stretch of fence under 6 tiles is dropped, and a fence that would end against a wall or the zone's edge stops a tile short;
//   5. detours: the planned fence is marked on a scratch copy of the tiles and every tile that would force a pair across it more than
//      the cap round is given up before anything is written (jogs, houses and halos make a few); one row is one feature after that;
//   6. write: each row is one "fenceRow" feature (trim; job "lane"), p = [axis, rowIndex, phase]; gate tiles are reserved first;
//   7. route guard (`route` dial): "repair" (default) opens the fence on the worst pool member's corridor, then near it, and checks
//      again, until no member's walk is stretched past ROUTE_STRETCH_MAX (at most 6 checks); "open" never fences a corridor tile (the
//      stretch stays at 1000, less fence); "none" is for ablations.
// Landmark: the guard house (GUARD_HOUSE), up to LANDMARKS_PER_ZONE per zone, the first nearest the zone's pole, the second nearest the
// front door and >= 14 tiles from the first; a house across a camp territory's boundary is scored last (it can cut the territory).
//
// `gallows` is the styler; `makeGallows(dials)` builds one with other dials (ablations, WP8's variants).
// ====================================================================================================================

/** Gate rule dials (contract 4.2 step 4; WP8's zone duel harness builds its "rows" arena from the same constants and `gallowsGateOpen`). */
export const GATE_PERIOD = 12;
export const GATE_W = 3;
/** The gate phase of row 0, 1, 2, ...: 2 for an even row index, 8 for an odd one (two rows shift a crosser about 6 tiles sideways). */
export const GATE_PHASES: readonly number[] = [2, 8];
/** Row gap (tiles between neighbouring rows), its target and the Viterbi's penalty per tile away from the target. */
export const ROW_GAP_MIN = 7;
export const ROW_GAP_MAX = 9;
export const ROW_GAP_TARGET = 8;
export const ROW_GAP_PENALTY = 2;
/** A line counts for a row position only through open runs of at least this many tiles, and a row needs a bias of this many tiles. */
export const ROW_OPEN_RUN_MIN = 8;
export const ROW_VALUE_BIAS = 12;
/** An open stretch of at least this many positions becomes fence. */
export const ROW_MIN_RUN = 10;
/** A row follows the open ground within +-ROW_WIGGLE tiles of its base position; the Viterbi's integer costs (x10 of the prototype). */
export const ROW_WIGGLE = 3;
export const ROW_BLOCKED_COST = 60;
export const ROW_DEVIATION_COST = 6;
export const ROW_JOG_COST = 12;
/** The square: a window of this many tiles along the rows, the gallows' offsets in it (prototype order), and how many windows are tried. */
export const SQUARE_WINDOW = 9;
export const GALLOWS_OFFSETS_S: readonly number[] = [3, 2, 4, 1, 5];
export const GALLOWS_OFFSETS_T: readonly number[] = [0, -1, 1, -2, 2];
export const SQUARES = 1;
const SQUARE_TRIES = 6;
/** The smallest fence piece a row keeps (the guard's FEATURE_MIN_PIECE). */
export const ROW_MIN_PIECE = 6;
/** Second guard house at least this far (tiles, centre to centre) from the first. */
export const HOUSE_MIN_SEP = 14;

/**
 * Is position `s` of a row a gate? `s` counts from the row's origin (the zone box's first tile along the row, `sLo`), `phase` is the
 * row's (2 or 8). A TRUE modulo, so the lead of the row (s < phase) has gates too. A gate is `width` consecutive positions every
 * `period`.
 */
export function gallowsGateOpen(s: number, phase: number, period: number = GATE_PERIOD, width: number = GATE_W): boolean {
  return ((((s - phase) % period) + period) % period) < width;
}

/** The phase of row `index` (ascending lateral position): GATE_PHASES alternate, 2 on even indices. */
export function gallowsRowPhase(index: number, phases: readonly number[] = GATE_PHASES): number {
  return phases[((index % phases.length) + phases.length) % phases.length];
}

/** The farthest a fence tile can lie from a gate tile, in tiles, for a gate rule: (period - width + 1) / 2 rounded up. */
export function gallowsMaxGateDistance(period: number = GATE_PERIOD, width: number = GATE_W): number {
  return Math.ceil((period - width + 1) / 2);
}

/** The guard house (contract 5.2): 8x7, two doors, two crate nooks; jobs landmark + lee. Orientation 0. */
export const GUARD_HOUSE: LandmarkTemplate = {
  key: "guardHouse",
  jobs: ["landmark", "lee"],
  rows: [
    "###dd###",
    "#c....c#",
    "#......#",
    "#......#",
    "#......d",
    "#c.....d",
    "########",
  ],
};

/**
 * Every dial of the Rows in one place. `route` is how the pool members' walks are kept: "open" never fences a corridor tile (the
 * stretch stays 1000), "repair" fences everything and opens the worst member's corridor afterwards until the stretch is under the
 * threshold (more fence, more route-guard calls), "none" does neither (ablations only).
 */
export interface GallowsDials {
  gapMin: number;
  gapMax: number;
  gapTarget: number;
  gapPenalty: number;
  period: number;
  width: number;
  phases: readonly number[];
  minRun: number;
  squares: number;
  route: "open" | "repair" | "none";
}
export const GALLOWS_DIALS: GallowsDials = {
  gapMin: ROW_GAP_MIN, gapMax: ROW_GAP_MAX, gapTarget: ROW_GAP_TARGET, gapPenalty: ROW_GAP_PENALTY,
  period: GATE_PERIOD, width: GATE_W, phases: GATE_PHASES, minRun: ROW_MIN_RUN, squares: SQUARES, route: "repair",
};

/** One placed row. */
export interface GallowsRow {
  /** p[0]: 0 = along x, 1 = along y. */
  axis: number;
  /** p[1]: index among the base rows, ascending lateral position (a row that did not stand leaves its index unused). */
  index: number;
  /** p[2]: 2 or 8. */
  phase: number;
  /** The base row's lateral coordinate (y for axis 0, x for axis 1). */
  t0: number;
  /** The fence tiles that stand (tile indices, write order). */
  tiles: number[];
  /** Fence tiles at the foot of a gate (a gate post stands there). */
  posts: number[];
  /** Gate tiles of the row (reserved floor, tile indices). */
  gates: number[];
}

export interface GallowsPlan {
  /** 0 = rows along x, 1 = along y. */
  axis: number;
  /** The zone box's first tile along the rows (the origin of the gate rule) and the first lateral tile. */
  sLo: number;
  tLo: number;
  /** Lateral coordinates the row Viterbi chose. */
  baseRows: number[];
  rows: GallowsRow[];
  /** The gallows' 9 tiles (row-major), [] when none stands. */
  gallows: number[];
  /** The open window of the square: neighbouring base rows k, k + 1 and its first position (relative to sLo), or null. */
  square: { k: number; s: number } | null;
  /** Row path tiles left unfenced because a pool member's corridor lies on them. */
  corridorOpened: number;
  /** worstStretch() at the end (permille; 1000 when the zone has no members) and whether the safety net had to open anything. */
  stretch: number;
  repaired: number;
  /** Fence tiles the plan gave up before writing (the detour rule on the finished rows), and which. */
  planned: number;
  dropped: number[];
  /** Fence tiles the detour relax gave back (a pair across them would walk more than the cap round). */
  relaxed: number;
  /** route-guard checks spent (worstStretch calls). */
  checks: number;
  /** Rows whose fence the repair gave back entirely (they stay recorded, owning gate floor only). */
  emptyRows: number;
  /** The guard house stamps (landmark pass), for the props. */
  houses: number;
}

const EMPTY_PLAN = (): GallowsPlan => ({
  axis: 0, sLo: 0, tLo: 0, baseRows: [], rows: [], gallows: [], square: null, corridorOpened: 0, stretch: 1000, repaired: 0, planned: 0, dropped: [], relaxed: 0, checks: 0, emptyRows: 0, houses: 0,
});

/** The doubled-coordinate squared distance between a stamp's box centre and the point (px2, py2) (both doubled tile coordinates). */
function boxDist2(bx: number, by: number, bw: number, bh: number, px2: number, py2: number): number {
  const dx = 2 * bx + bw - px2, dy = 2 * by + bh - py2;
  return dx * dx + dy * dy;
}

/**
 * Does the stamp lie in one camp territory? A house across a territory boundary can cut a territory's floor in two (its walls
 * split the part on one side from the rest unless a door happens to open onto it): the guard then refuses its walls, so such a
 * stamp is scored last. Without a territory grid (a fixture) every stamp qualifies.
 */
function inOneTerritory(c: LandmarkCtx, s: Stamp): boolean {
  const terr = c.territory;
  if (!terr) return true;
  let id = -1;
  for (const list of [s.walls, s.floor, s.doors, s.nooks, s.lights]) {
    for (const i of list) {
      if (id < 0) id = terr[i];
      else if (terr[i] !== id) return false;
    }
  }
  return true;
}

/** The Rows' landmark pass: guard houses, whole or not at all (contract 4.2 step 9). */
function landmarkRows(c: LandmarkCtx): void {
  const want = Math.min(LANDMARKS_PER_ZONE, Math.round(areaScale(c.zone.painted)));
  if (want < 1) return;
  const pole = c.zone.pole;
  const px2 = 2 * pole.x + 1, py2 = 2 * pole.y + 1;
  const before = c.zoneFeatures().length;
  const FAR = 1e12;
  // the bound is the score without its FAR penalties, so the search asks the territory test for a handful of candidates only
  const search = makeLandmarkSearch(c);
  bestLandmark(c, GUARD_HOUSE, (s) => -boxDist2(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h, px2, py2) - (inOneTerritory(c, s) ? 0 : FAR), 12, {
    search, bound: (b) => -boxDist2(b.x, b.y, b.w, b.h, px2, py2),
  });
  if (want < 2) return;
  const placed = c.zoneFeatures().slice(before).filter((f) => f.kind === "landmark");
  const first = placed.length > 0 ? placed[0].bbox : null;
  // the second: nearest the front door (else the zone's centroid), and HOUSE_MIN_SEP tiles from the first
  const nodes = campNodes(c);
  const door = nodes.length > 0 && nodes[nodes.length - 1].kind === "door" ? nodes[nodes.length - 1] : null;
  const tx2 = door ? 2 * door.x + 1 : Math.round(2 * c.zone.centroid.x), ty2 = door ? 2 * door.y + 1 : Math.round(2 * c.zone.centroid.y);
  const sep2 = 4 * HOUSE_MIN_SEP * HOUSE_MIN_SEP;
  bestLandmark(c, GUARD_HOUSE, (s) => {
    let sc = -boxDist2(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h, tx2, ty2);
    if (!inOneTerritory(c, s)) sc -= FAR;
    if (first && boxDist2(s.bbox.x, s.bbox.y, s.bbox.w, s.bbox.h, 2 * first.x + first.w, 2 * first.y + first.h) < sep2) sc -= FAR;
    return sc;
  }, 12, { search, bound: (b) => -boxDist2(b.x, b.y, b.w, b.h, tx2, ty2) });
}

/** Route-guard checks a zone may spend (contract 3.9: at most 6). */
const ROUTE_CHECKS_MAX = 6;

/**
 * The fence tiles of `rel`'s complement that sit in 8-connected pieces under ROW_MIN_PIECE tiles, added to `rel` (the plan's rows'
 * tiles, all rows together).
 */
function addSmallPieces(c: ShapeCtx, plan: GallowsPlan, rel: Set<number>): void {
  const { w, h } = c;
  const live = new Set<number>();
  for (const row of plan.rows) for (const i of row.tiles) if (!rel.has(i)) live.add(i);
  const seen = new Set<number>();
  for (const start of [...live].sort((p, q) => p - q)) {
    if (seen.has(start)) continue;
    const comp = [start];
    seen.add(start);
    for (let head = 0; head < comp.length; head++) {
      const x = comp[head] % w, y = (comp[head] - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (live.has(j) && !seen.has(j)) { seen.add(j); comp.push(j); }
      }
    }
    if (comp.length < ROW_MIN_PIECE) for (const i of comp) rel.add(i);
  }
}

/**
 * Gives back the fence tiles `rel` and every fence piece left under ROW_MIN_PIECE tiles; with `keepRows` a row it would empty keeps
 * all its fence (a recorded row owns at least one fence tile). Returns the tiles released. The tiles stay owned by their row (a gate is owned
 * floor); the plan's rows lose them.
 */
function giveBack(c: ShapeCtx, plan: GallowsPlan, rel: Set<number>, keepRows: boolean): number {
  if (rel.size === 0) return 0;
  addSmallPieces(c, plan, rel);
  if (keepRows) for (const row of plan.rows) if (row.tiles.length > 0 && row.tiles.every((i) => rel.has(i))) for (const i of row.tiles) rel.delete(i);
  let released = 0;
  for (const i of [...rel].sort((p, q) => p - q)) if (c.release(i)) released++;
  for (const row of plan.rows) {
    row.tiles = row.tiles.filter((i) => c.tiles[i] === TILE_LOW);
    row.posts = row.posts.filter((i) => c.tiles[i] === TILE_LOW);
  }
  return released;
}

/** Opens the rows' fence within Chebyshev `radius` of a tile of `band` (a pool member's corridor), then the pieces that leaves. */
function openAround(c: ShapeCtx, plan: GallowsPlan, band: readonly number[], radius: number): number {
  const { w, h } = c;
  const near = new Set<number>();
  for (const b of band) {
    const bx = b % w, by = (b - bx) / w;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const x = bx + dx, y = by + dy;
      if (x >= 0 && y >= 0 && x < w && y < h) near.add(y * w + x);
    }
  }
  const rel = new Set<number>();
  for (const row of plan.rows) for (const i of row.tiles) if (near.has(i)) rel.add(i);
  return giveBack(c, plan, rel, true);
}

/**
 * Later fence tiles of a row can close the way round an earlier one (a tile was only checked when it went down, with the rest of its
 * row still open), and a jog adds a step: looks at the finished rows once more and gives back every fence tile that now forces a pair
 * of floor tiles across it more than the detour cap, up to three rounds. Returns the tiles given back.
 */
function relaxRows(c: ShapeCtx, plan: GallowsPlan, holes: readonly number[]): number {
  if (holes.length === 0) return 0;
  const { w, h } = c;
  // only the fence near a tile that did not stand can differ from the plan
  const near = new Set<number>();
  for (const g of holes) {
    const gx = g % w, gy = (g - gx) / w;
    for (let dy = -DETOUR_REACH; dy <= DETOUR_REACH; dy++) for (let dx = -DETOUR_REACH; dx <= DETOUR_REACH; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) near.add(ny * w + nx);
    }
  }
  let total = 0;
  for (let round = 0; round < 3; round++) {
    const rel = new Set<number>();
    for (const row of plan.rows) for (const i of row.tiles) if (near.has(i) && c.tiles[i] === TILE_LOW && !c.fenceDetourOk(i)) rel.add(i);
    const n = giveBack(c, plan, rel, false);
    if (n === 0) break;
    total += n;
  }
  return total;
}

/**
 * The detour rule on a grid of your own: does every pair of floor tiles k = 1..3 steps either side of fence tile `i` (along its row or
 * column) still walk to each other within 2k + cap steps, with `i` taken as solid (4-connected FLOOR of the zone)? The guard's
 * detourOk, on `tiles` (a scratch copy with the planned fence marked), so a row is checked as it will finally stand. The usual
 * answer needs no search: walk along the fence line to the first tile that is not fence and cross there (an L: 2d + 2k steps), and
 * only a pair whose L is blocked (a jog, a wall, a second fence) is searched, breadth-first.
 */
function detourHolds(tiles: Uint8Array, mask: Uint8Array, w: number, h: number, i: number, cap: number, seen: Int32Array, queue: Int32Array, depth: Int16Array, stampRef: { n: number }): boolean {
  const x = i % w, y = (i - x) / w;
  for (let pass = 0; pass < 2; pass++) {
    const step = pass === 0 ? w : 1;
    // the fence line runs the other way: `along` is one tile along it
    const along = pass === 0 ? 1 : w;
    for (let k = 1; k <= 3; k++) {
      if (pass === 0 ? y - k < 0 || y + k >= h : x - k < 0 || x + k >= w) break;
      const a = i - k * step, b = i + k * step;
      if (tiles[a] !== TILE_FLOOR || tiles[b] !== TILE_FLOOR || !mask[a] || !mask[b]) break;
      const limit = 2 * k + cap;
      // the L: along the line either way to the first tile that is not fence, then across at that tile
      let ok = false;
      for (let dir = -1; dir <= 1 && !ok; dir += 2) {
        for (let d = 1; 2 * d + 2 * k <= limit; d++) {
          const g = i + dir * d * along;
          const gx = pass === 0 ? x + dir * d : x, gy = pass === 0 ? y : y + dir * d;
          if (gx < 0 || gy < 0 || gx >= w || gy >= h) break;
          if (tiles[g] === TILE_LOW) continue;
          // g is the first tile off the fence line; the crossing column is g's: g - k*step .. g + k*step must all be floor in the zone
          if (tiles[g] !== TILE_FLOOR || !mask[g]) break;
          let clear = true;
          for (let q = -k; q <= k && clear; q++) { const t = g + q * step; if (tiles[t] !== TILE_FLOOR || !mask[t]) clear = false; }
          // and the way along the two sides back to a and b is the line itself: tiles at lateral -k / +k from i to g
          for (let q = 1; q <= d && clear; q++) {
            const ta = a + dir * q * along, tb = b + dir * q * along;
            if (tiles[ta] !== TILE_FLOOR || !mask[ta] || tiles[tb] !== TILE_FLOOR || !mask[tb]) clear = false;
          }
          if (clear) ok = true;
          break;
        }
      }
      if (ok) continue;
      const stamp = ++stampRef.n;
      let head = 0, tail = 0, found = false;
      queue[tail++] = a;
      seen[a] = stamp;
      depth[a] = 0;
      while (head < tail) {
        const cur = queue[head++];
        if (cur === b) { found = true; break; }
        if (depth[cur] >= limit) continue;
        const cx = cur % w, cy = (cur - cx) / w;
        for (let e = 0; e < 4; e++) {
          const nx = cx + (e === 1 ? 1 : e === 3 ? -1 : 0), ny = cy + (e === 0 ? -1 : e === 2 ? 1 : 0);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (j === i || seen[j] === stamp || tiles[j] !== TILE_FLOOR || !mask[j]) continue;
          seen[j] = stamp;
          depth[j] = depth[cur] + 1;
          queue[tail++] = j;
        }
      }
      if (!found) return false;
    }
  }
  return true;
}

/**
 * The planned fence of all rows as it will stand: marks it on a scratch copy of the tiles and gives up every tile that would force a
 * pair across it more than the detour cap round (rounds of: check, drop, drop the pieces under ROW_MIN_PIECE), so no row is written
 * only to be taken back. `rows` are edited in place.
 */
function planDetours(c: ShapeCtx, rows: ReadonlyArray<{ blocks: number[]; posts: Set<number> }>, cap: number, out?: number[]): number {
  const { w, h } = c;
  const n = w * h;
  const sim = c.tiles.slice() as Uint8Array;
  for (const r of rows) for (const i of r.blocks) sim[i] = TILE_LOW;
  const seen = new Int32Array(n), queue = new Int32Array(n), depth = new Int16Array(n), stampRef = { n: 0 };
  let dropped = 0;
  // later rounds look only at the fence near what the last round took
  let recheck: Set<number> | null = null;
  for (let round = 0; round < 4; round++) {
    const bad: number[] = [];
    for (const r of rows) {
      for (const i of r.blocks) {
        if (sim[i] !== TILE_LOW || (recheck !== null && !recheck.has(i))) continue;
        if (!detourHolds(sim, c.mask, w, h, i, cap, seen, queue, depth, stampRef)) bad.push(i);
      }
    }
    for (const i of bad) sim[i] = TILE_FLOOR;
    // pieces under ROW_MIN_PIECE (8-connected over the planned fence)
    const gone: number[] = bad.slice();
    for (const r of rows) {
      for (const start of r.blocks) {
        if (sim[start] !== TILE_LOW) continue;
        const comp = [start];
        const stamp = ++stampRef.n;
        seen[start] = stamp;
        for (let head = 0; head < comp.length && comp.length < ROW_MIN_PIECE; head++) {
          const x = comp[head] % w, y = (comp[head] - x) / w;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const j = ny * w + nx;
            if (sim[j] === TILE_LOW && seen[j] !== stamp && c.mask[j]) { seen[j] = stamp; comp.push(j); }
          }
        }
        if (comp.length < ROW_MIN_PIECE) for (const i of comp) { sim[i] = TILE_FLOOR; gone.push(i); }
      }
    }
    dropped += gone.length;
    if (gone.length === 0) break;
    recheck = new Set<number>();
    for (const g of gone) {
      const gx = g % w, gy = (g - gx) / w;
      for (let dy = -DETOUR_REACH; dy <= DETOUR_REACH; dy++) for (let dx = -DETOUR_REACH; dx <= DETOUR_REACH; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) recheck.add(ny * w + nx);
      }
    }
  }
  for (const r of rows) {
    if (out) for (const i of r.blocks) if (sim[i] !== TILE_LOW) out.push(i);
    r.blocks = r.blocks.filter((i) => sim[i] === TILE_LOW);
    for (const i of [...r.posts]) if (sim[i] !== TILE_LOW) r.posts.delete(i);
  }
  return dropped;
}

/** How far (Chebyshev, tiles) a removed fence tile can change another tile's detour: a pair is 3 apart and a way round at most 10 long. */
const DETOUR_REACH = 14;

/** The Rows' shape pass. */
function shapeRows(c: ShapeCtx, d: GallowsDials): GallowsPlan {
  const plan = EMPTY_PLAN();
  const { w, h } = c;
  const bb = c.zone.bbox;
  const vx = c.zone.centroid.x - w / 2, vy = c.zone.centroid.y - h / 2;
  const horizontal = Math.abs(vx) >= Math.abs(vy);
  const tLo = horizontal ? bb.y : bb.x, nT = horizontal ? bb.h : bb.w;
  const sLo = horizontal ? bb.x : bb.y, nS = horizontal ? bb.w : bb.h;
  plan.axis = horizontal ? 0 : 1;
  plan.sLo = sLo;
  plan.tLo = tLo;
  if (nS < d.minRun || nT < d.gapMin + 1) return plan;
  let guard: RouteGuard | null = null;
  try { guard = c.routeGuard(); } catch { guard = null; }
  const corridor = d.route === "open" && guard ? guard.corridor : null;
  /** Tile index of position s on line t. */
  const idx = (s: number, t: number): number => (horizontal ? t * w + s : s * w + t);

  // The open grid over the zone's box: okG[(t - tLo) * nS + (s - sLo)] = 1 where a blocker may land and no corridor lies.
  const okG = new Uint8Array(nS * nT);
  for (let tt = 0; tt < nT; tt++) {
    for (let ss = 0; ss < nS; ss++) {
      const i = idx(sLo + ss, tLo + tt);
      okG[tt * nS + ss] = c.open(i) && (corridor === null || corridor[i] === 0) ? 1 : 0;
    }
  }
  let corridorOpened = 0;
  const okAt = (s: number, t: number): boolean => {
    const ss = s - sLo, tt = t - tLo;
    return ss >= 0 && tt >= 0 && ss < nS && tt < nT && okG[tt * nS + ss] === 1;
  };

  // 2. Row positions: a line is worth its open runs of >= 8 tiles, less a bias; rows 7-9 apart.
  const value = new Int32Array(nT);
  for (let tt = 0; tt < nT; tt++) {
    let run = 0, sum = 0;
    for (let ss = 0; ss <= nS; ss++) {
      if (ss < nS && okG[tt * nS + ss] === 1) run++;
      else { if (run >= ROW_OPEN_RUN_MIN) sum += run; run = 0; }
    }
    value[tt] = sum - ROW_VALUE_BIAS;
  }
  const base = viterbiRows(value, tLo, d.gapMin, d.gapMax, d.gapTarget, d.gapPenalty);
  plan.baseRows = base;
  if (base.length === 0) return plan;

  // 3. The square: the 9-tile window between two neighbouring base rows nearest the centroid, blocked tiles costing.
  let win: { k: number; s: number } | null = null;
  if (d.squares > 0 && base.length >= 2 && nS >= SQUARE_WINDOW) {
    const stride = nS + 1;
    const blockedSum = new Int32Array((nT + 1) * stride);
    for (let tt = 0; tt < nT; tt++) {
      for (let ss = 0; ss < nS; ss++) {
        blockedSum[(tt + 1) * stride + ss + 1] = blockedSum[tt * stride + ss + 1] + blockedSum[(tt + 1) * stride + ss] - blockedSum[tt * stride + ss] + (okG[tt * nS + ss] === 1 ? 0 : 1);
      }
    }
    const cxi = Math.round(2 * c.zone.centroid.x), cyi = Math.round(2 * c.zone.centroid.y);
    const cs2 = horizontal ? cxi : cyi, ct2 = horizontal ? cyi : cxi;
    // the SQUARE_TRIES best windows, ascending by (score, k, s): a small insertion list, no sort of all of them
    const cands: Array<{ score: number; k: number; s: number }> = [];
    for (let k = 0; k + 1 < base.length; k++) {
      const t0 = Math.max(0, base[k] - 1 - tLo), t1 = Math.min(nT - 1, base[k + 1] + 1 - tLo);
      const dt = base[k] + base[k + 1] + 1 - ct2;
      for (let ss = 0; ss + SQUARE_WINDOW <= nS; ss++) {
        const blocked = blockedSum[(t1 + 1) * stride + ss + SQUARE_WINDOW] - blockedSum[t0 * stride + ss + SQUARE_WINDOW] - blockedSum[(t1 + 1) * stride + ss] + blockedSum[t0 * stride + ss];
        const ds = 2 * (sLo + ss) + SQUARE_WINDOW - cs2;
        const score = isqrt(ds * ds + dt * dt) + 6 * blocked;
        if (cands.length === SQUARE_TRIES && score >= cands[SQUARE_TRIES - 1].score) continue; // ties keep the earlier (lower k, then s)
        let at = cands.length;
        while (at > 0 && cands[at - 1].score > score) at--;
        cands.splice(at, 0, { score, k, s: ss });
        if (cands.length > SQUARE_TRIES) cands.pop();
      }
    }
    /** The gallows at the first fitting offset of the window (k, ss), in the prototype's order; its tiles, or null. */
    const stand = (k: number, ss: number): number[] | null => {
      const mid = Math.round((base[k] + base[k + 1]) / 2);
      for (const offS of GALLOWS_OFFSETS_S) {
        for (const offT of GALLOWS_OFFSETS_T) {
          const s0 = sLo + ss + offS, t0 = mid + offT - 1;
          let free = true;
          for (let a = 0; a < 3 && free; a++) for (let b = 0; b < 3; b++) if (!okAt(s0 + a, t0 + b)) { free = false; break; }
          if (!free) continue;
          const blocks: Array<readonly [number, "wall"]> = [];
          for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) blocks.push([idx(s0 + a, t0 + b), "wall"]);
          blocks.sort((p, q) => p[0] - q[0]);
          const placed = c.placeFeature({
            kind: "gallows", jobs: ["landmark"], anchor: [horizontal ? s0 : t0, horizontal ? t0 : s0], params: [], blocks, mode: "whole",
          });
          if (placed) return placed.written.slice();
        }
      }
      return null;
    };
    for (let q = 0; q < cands.length && q < SQUARE_TRIES && !win; q++) {
      const tiles9 = stand(cands[q].k, cands[q].s);
      if (!tiles9) continue;
      plan.gallows = tiles9;
      for (const i of tiles9) {
        const x = i % w, y = (i - x) / w;
        okG[((horizontal ? y : x) - tLo) * nS + ((horizontal ? x : y) - sLo)] = 0;
      }
      win = { k: cands[q].k, s: cands[q].s };
    }
  }
  plan.square = win;

  // 4. Row paths, runs, gates.
  interface RowPlan { index: number; phase: number; t0: number; blocks: number[]; posts: Set<number>; gates: number[] }
  const rowPlans: RowPlan[] = [];
  const entryS: number[] = [], entryI: number[] = [];
  for (let r = 0; r < base.length; r++) {
    const t0 = base[r];
    const phase = gallowsRowPhase(r, d.phases);
    const path = viterbiPath(nS, ROW_WIGGLE, (k, dt) => (okAt(sLo + k, t0 + dt) ? 0 : ROW_BLOCKED_COST) + ROW_DEVIATION_COST * (dt < 0 ? -dt : dt), ROW_JOG_COST);
    const rp: RowPlan = { index: r, phase, t0, blocks: [], posts: new Set<number>(), gates: [] };
    entryS.length = 0;
    entryI.length = 0;
    let prevT = -1;
    // The tile that stopped the run before this one (-1: the box edge). A fence that ends against a wall or the zone's edge has
    // no way round at that end, so it stops a tile short; one that ends at a halo, a corridor or the rim can be walked round.
    let stopTile = -1, startClosed = true;
    const closed = (i: number): boolean => i < 0 || !c.mask[i] || c.tiles[i] !== TILE_FLOOR;
    const flush = (endTile: number): void => {
      const len = entryS.length;
      if (len > 0 && entryS[len - 1] - entryS[0] + 1 >= d.minRun) {
        // segments: maximal stretches of fence between gates, windows and the run's ends
        let seg: number[] = [];
        let startFlank = false, prevGate = false, cutStart = startClosed;
        const closeSeg = (endFlank: boolean, cutEnd: boolean): void => {
          if (cutStart) seg.shift();
          if (cutEnd) seg.pop();
          if (seg.length >= ROW_MIN_PIECE) {
            for (const i of seg) rp.blocks.push(i);
            if (startFlank) rp.posts.add(seg[0]);
            if (endFlank) rp.posts.add(seg[seg.length - 1]);
          }
          seg = [];
          cutStart = false;
        };
        for (let e = 0; e < len; e++) {
          const s = entryS[e], i = entryI[e];
          const gate = gallowsGateOpen(s - sLo, phase, d.period, d.width);
          const skip = win !== null && (r === win.k || r === win.k + 1) && s >= sLo + win.s && s < sLo + win.s + SQUARE_WINDOW;
          if (gate) {
            rp.gates.push(i);
            closeSeg(true, false);
          } else if (skip) {
            closeSeg(false, false);
          } else {
            if (seg.length === 0) startFlank = prevGate;
            seg.push(i);
          }
          prevGate = gate;
        }
        closeSeg(false, closed(endTile));
      }
      entryS.length = 0;
      entryI.length = 0;
      prevT = -1;
    };
    for (let k = 0; k < nS; k++) {
      const s = sLo + k, t = t0 + path[k];
      if (okAt(s, t)) {
        if (entryS.length === 0) startClosed = closed(stopTile);
        if (entryS.length > 0 && t !== prevT && okAt(s - 1, t)) { entryS.push(s - 1); entryI.push(idx(s - 1, t)); }
        entryS.push(s);
        entryI.push(idx(s, t));
        prevT = t;
      } else {
        const here = t >= tLo && t < tLo + nT ? idx(s, t) : -1;
        if (corridor !== null && here >= 0 && corridor[here] === 1 && c.open(here)) corridorOpened++;
        flush(here);
        stopTile = here;
      }
    }
    flush(-1);
    rowPlans.push(rp);
  }
  plan.corridorOpened = corridorOpened;

  // The fence as it will finally stand must keep the detour rule: take back the tiles that would break it before anything is written.
  plan.planned = planDetours(c, rowPlans, c.caps.fenceDetour, plan.dropped);

  // Gates are reserved before any row is written (a later blocker never closes one).
  for (const rp of rowPlans) if (rp.blocks.length >= ROW_MIN_PIECE) for (const i of rp.gates) c.reserve(i);

  // 6. Write: one fenceRow feature per row.
  const { tiles } = c;
  /** Planned tiles that did not stand (the guard refused them, or the trim took them back): the only places the plan's checks can be off. */
  const holes: number[] = [];
  for (const rp of rowPlans) {
    if (rp.blocks.length < ROW_MIN_PIECE) continue;
    const first = rp.blocks[0];
    const placed = c.placeFeature({
      kind: "fenceRow", jobs: ["lane"], anchor: [first % w, (first - (first % w)) / w], params: [plan.axis, rp.index, rp.phase],
      blocks: rp.blocks.map((i) => [i, "fence"] as const), mode: "trim", minPiece: ROW_MIN_PIECE,
    });
    if (!placed) { for (const i of rp.blocks) holes.push(i); continue; }
    if (placed.refused > 0) for (const i of rp.blocks) if (tiles[i] !== TILE_LOW) holes.push(i);
    plan.rows.push({
      axis: plan.axis, index: rp.index, phase: rp.phase, t0: rp.t0, tiles: placed.written.slice(),
      posts: [...rp.posts].filter((i) => tiles[i] === TILE_LOW).sort((p, q) => p - q), gates: rp.gates,
    });
  }

  plan.relaxed = relaxRows(c, plan, holes);

  // 5. The route guard: the "open" mode already kept every corridor clear (one check is the safety net); "repair" opens the worst
  //    member's corridor, the fence tiles on it and then near it, until the stretch is under the threshold.
  if (guard && guard.members.length > 0) {
    let st = guard.worstStretch();
    plan.checks = 1;
    if (d.route === "repair") {
      let calls = 1, radius = 0;
      while (st > ROUTE_STRETCH_MAX && calls < ROUTE_CHECKS_MAX) {
        const opened = openAround(c, plan, guard.corridorOf(guard.worstMember()), radius);
        if (opened === 0) { radius++; if (radius > 2) break; continue; }
        plan.repaired += opened;
        radius = 0;
        st = guard.worstStretch();
        calls++;
        plan.checks = calls;
      }
    }
    plan.stretch = st;
  }
  plan.emptyRows = plan.rows.filter((r) => r.tiles.length === 0).length;
  plan.houses = c.zoneFeatures().filter((f) => f.kind === "landmark" && f.variant === GUARD_HOUSE.key).length;
  return plan;
}

/** Decor of the Rows: chains on the fence, gate posts and lanterns at the gates, the gallows, banners and stocks in the guard houses. */
function propsRows(c: PropCtx, plan: GallowsPlan): void {
  const { w, h } = c;
  const hv = (x: number, y: number, salt: number): number => c.noise.hash(x, y, salt);
  const var3 = (x: number, y: number): number => Math.floor(hv(x, y, 90) * 3);
  for (const row of plan.rows) {
    const posts = new Set(row.posts);
    for (const i of row.tiles) {
      const x = i % w, y = (i - x) / w;
      if (c.tiles[i] !== TILE_LOW) continue;
      if (posts.has(i)) {
        c.prop(PROP.gate_post, x, y, var3(x, y));
        if (hv(x, y, 5) < 1 / 3) {
          // a lantern on the lane side of the post, one tile off the fence
          const sx = plan.axis === 0 ? 0 : 1, sy = plan.axis === 0 ? 1 : 0;
          const side = hv(x, y, 6) < 0.5 ? -1 : 1;
          const lx = x + side * sx, ly = y + side * sy;
          if (lx >= 0 && ly >= 0 && lx < w && ly < h && c.tiles[ly * w + lx] === TILE_FLOOR) c.prop(PROP.lantern, lx, ly, var3(lx, ly));
        }
      } else if (hv(x, y, 3) < 0.2) {
        c.prop(PROP.chain, x, y, var3(x, y));
      }
    }
  }
  if (plan.gallows.length > 0) {
    const mid = plan.gallows[4];
    c.prop(PROP.gallows, mid % w, (mid - (mid % w)) / w, var3(mid % w, Math.floor(mid / w)));
  }
  for (const f of c.zoneFeatures()) {
    if (f.kind !== "landmark" || f.variant !== GUARD_HOUSE.key) continue;
    const s = stampTemplate(GUARD_HOUSE, f.ax, f.ay, (f.p[0] & 3) as 0 | 1 | 2 | 3, f.p[1] === 1, w, h);
    if (!s) continue;
    let banners = 0;
    for (const i of s.walls) {
      const x = i % w, y = (i - x) / w;
      if (banners < 4 && c.tiles[i + w] === TILE_FLOOR && hv(x, y, 2) < 0.3 && c.prop(PROP.banner, x, y, var3(x, y))) banners++;
    }
    if (s.floor.length > 0) {
      const i = s.floor[s.floor.length >> 1];
      c.prop(PROP.stocks, i % w, (i - (i % w)) / w, var3(i % w, Math.floor(i / w)));
    }
  }
}

/** Builds a Rows styler with other dials (the default is `gallows`). */
export function makeGallows(dials: Partial<GallowsDials> = {}): ZoneStyler<GallowsPlan> {
  // another period keeps the half-period stagger between neighbouring rows (period 10: phases 2 and 7) unless phases are given
  const phases = dials.phases ?? (dials.period !== undefined ? [GATE_PHASES[0], GATE_PHASES[0] + Math.floor(dials.period / 2)] : GATE_PHASES);
  const d: GallowsDials = { ...GALLOWS_DIALS, ...dials, phases };
  return {
    id: "gallows",
    faction: "sentenced",
    version: 400,
    landmark: (c) => landmarkRows(c),
    shape: (c) => shapeRows(c, d),
    props: propsRows,
  };
}

/** The Rows. */
export const gallows: ZoneStyler<GallowsPlan> = makeGallows();
