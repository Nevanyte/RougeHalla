// The planned route drawn on the ground (render/GroundRoute.ts): everything that is not Phaser. The route (RouteState.ahead) is
// cut into PIECES, the dashes of its line and a ring round every stop that sits on a camp, and each piece fades once the
// player has walked over it. Pure, so the geometry, the walked-over rule and the timing are tested without a scene.
//
//   - Dashes are anchored to the start of their leg (the previous stop), not to the start of the polyline handed in: the route
//     handed to the minimap loses its first legs as the stops are reached, and a dash must not slide when that happens.
//   - A piece is walked over once a sample of the player's path comes within GROUND_DETECT (4 tiles) of a dash, or within
//     radius + RING_DETECT_EXTRA (1.5 tiles) of a camp ring's centre. It stays gone: a walked piece never comes back.
//   - A rebuilt route (a stop was reached or the player edited it on the Tab map) hands each new piece the state of the old piece
//     at the same place; a stretch that is new starts fresh, unless the player is standing on it, which is gone at once.
//   - Time is chunked: the walked check and the redraw run once per CHUNK_MS (ChunkClock); the fade of a walked piece is a
//     function of its age alone (fadeAlpha), so the view only sets an alpha per frame.
import { TILE, Y_SCALE, type Vec2 } from "@raid/shared";
import { ROUTE_REACH } from "../ui/planningMath";
import type { Box } from "./mapCull";
import { projX, projY } from "./projection";

/** A line piece fades once the player has come this close to it (four tiles). */
export const GROUND_DETECT = 4 * TILE;
/** A camp ring fades once the player is this much beyond its edge, or inside it (a tile and a half). */
export const RING_DETECT_EXTRA = 1.5 * TILE;
/** The walked check and the redraw happen once per chunk. */
export const CHUNK_MS = 200;
/** A walked piece takes this long to fade out: six chunks. */
export const FADE_MS = 1200;
/** Dashes: ground length of a mark and of the gap after it. */
export const DASH_ON = 22;
export const DASH_OFF = 14;
const DASH_PERIOD = DASH_ON + DASH_OFF;
/** A dash cut short by the end of its leg is dropped under this length. */
const MIN_DASH = 3;
/** Added to the farthest mob rest spot so the ring clears the mob's body. */
export const MOB_PAD = 20;
/** The player's path is sampled this far apart between two chunks, so a fast move cannot step over a piece. */
const SWEEP_STEP = TILE;
/** A move longer than this between two chunks is a teleport (the run's cut to the spawn, a long blink), not a walk. */
export const SWEEP_MAX = 16 * TILE;
/** How far apart two pieces of an old and a new route may sit and still be the same piece. */
const MATCH_DIST = 4;
const MATCH_CELL = 16;
/** Projected pixels of line and rim the bounding box of a piece allows for. */
const BOX_PAD = 6;
/** The steady layer is drawn for the camera's box snapped out to this grid, so it is rebuilt only when the camera has moved a step. */
export const WINDOW_STEP = 128;

/** What the renderer takes of a route: RouteAhead (planningMath.ts) and the minimap's MinimapRoute both fit. */
export interface RouteGeometry {
  points: readonly Vec2[];
  stops: readonly Vec2[];
}

/** The slice of a CampDef the rings read. */
export interface CampLike {
  x: number;
  y: number;
  r: number;
  spots: readonly Vec2[];
}

interface PieceBase {
  /** The time (ms) the walk reached it, or null while it is untouched; -Infinity for a piece first seen under the player's feet. */
  walkedAt: number | null;
  /** Projected bounds, for the camera window. */
  box: Box;
}

export interface DashPiece extends PieceBase {
  kind: "dash";
  /** Ground x, y pairs along the dash: two points on a straight stretch, more where it turns a corner. */
  pts: number[];
  /** Ground point halfway along it: the walked-over test reads this. */
  x: number;
  y: number;
}

export interface RingPiece extends PieceBase {
  kind: "ring";
  /** Index in map.camps. */
  camp: number;
  /** Ground centre: the camp's. */
  x: number;
  y: number;
  /** Ground radius of the drawn circle. */
  radius: number;
  /** The player is "in" it from this far from the centre. */
  detect: number;
}

export type Piece = DashPiece | RingPiece;

const finite = (p: Vec2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

// ------------------------------------------------------------------------------------------------------------------- timing

/** How opaque a piece is `age` ms after the walk reached it: 1, then a straight line down to 0 over FADE_MS. */
export function fadeAlpha(age: number): number {
  if (!(age > 0)) return 1;
  return age >= FADE_MS ? 0 : 1 - age / FADE_MS;
}

/** The throttle: true once per CHUNK_MS (and on the first call, or the first after reset or a clock that went backwards). */
export class ChunkClock {
  private at = -Infinity;
  constructor(readonly ms: number = CHUNK_MS) {}

  due(now: number): boolean {
    if (!Number.isFinite(now)) return false;
    if (now >= this.at && now - this.at < this.ms) return false;
    this.at = now;
    return true;
  }

  /** The next call to due() answers true. */
  reset(): void {
    this.at = -Infinity;
  }
}

// ---------------------------------------------------------------------------------------------------------------- geometry

/** Index pairs [a, b] into `points`: leg k runs from the previous stop (or the first point) to stop k. */
export function legRanges(points: readonly Vec2[], stops: readonly Vec2[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = 0;
  let first = true;
  for (const stop of stops) {
    // The first stop may be the first point itself (a route with no start); every later one is past the stop before it.
    let found = -1;
    for (let k = first ? 0 : from + 1; k < points.length; k++) {
      if (points[k]!.x === stop.x && points[k]!.y === stop.y) { found = k; break; }
    }
    first = false;
    if (found < 0) break;
    if (found > from) out.push([from, found]);
    from = found;
  }
  // Anything past the last stop found (it should not exist) is one more leg.
  if (from < points.length - 1) out.push([from, points.length - 1]);
  return out;
}

function projectedBox(pts: readonly number[], pad: number): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = projX(pts[i]!), y = projY(pts[i + 1]!);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

function makeDash(pts: number[]): DashPiece | null {
  let length = 0;
  for (let i = 2; i < pts.length; i += 2) length += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  if (length < MIN_DASH) return null;
  // The point halfway along the dash.
  let left = length / 2;
  let x = pts[0]!, y = pts[1]!;
  for (let i = 2; i < pts.length; i += 2) {
    const seg = Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
    if (seg >= left) {
      const t = seg > 0 ? left / seg : 0;
      x = pts[i - 2]! + (pts[i]! - pts[i - 2]!) * t;
      y = pts[i - 1]! + (pts[i + 1]! - pts[i - 1]!) * t;
      break;
    }
    left -= seg;
  }
  return { kind: "dash", pts, x, y, walkedAt: null, box: projectedBox(pts, BOX_PAD) };
}

/** Walks one leg (points a..b), cutting it into dashes of DASH_ON with DASH_OFF between, the first dash at its start. */
function dashLeg(points: readonly Vec2[], a: number, b: number, out: DashPiece[]): void {
  let arc = 0;
  let dashStart = 0;
  let dashEnd = DASH_ON;
  let cur: number[] | null = null;
  const close = (): void => {
    const dash = cur ? makeDash(cur) : null;
    if (dash) out.push(dash);
    cur = null;
  };
  for (let i = a; i < b; i++) {
    const p = points[i]!, q = points[i + 1]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(len > 0)) continue;
    const end = arc + len;
    while (dashStart < end) {
      const lo = Math.max(dashStart, arc), hi = Math.min(dashEnd, end);
      if (hi > lo) {
        const t0 = (lo - arc) / len, t1 = (hi - arc) / len;
        if (cur === null) cur = [p.x + (q.x - p.x) * t0, p.y + (q.y - p.y) * t0];
        cur.push(p.x + (q.x - p.x) * t1, p.y + (q.y - p.y) * t1);
      }
      if (dashEnd <= end) {
        close();
        dashStart += DASH_PERIOD;
        dashEnd += DASH_PERIOD;
      } else break;
    }
    arc = end;
  }
  close();
}

/** The dashes of a route's line. */
export function routeDashes(points: readonly Vec2[], stops: readonly Vec2[]): DashPiece[] {
  const usable = points.filter(finite);
  const out: DashPiece[] = [];
  if (usable.length < 2) return out;
  for (const [a, b] of legRanges(usable, stops.filter(finite))) dashLeg(usable, a, b, out);
  return out;
}

/** Ground radius of the circle round a camp: its clearing, and every mob rest spot with room for the mob's body. */
export function ringRadius(camp: CampLike): number {
  let far = 0;
  for (const s of camp.spots) far = Math.max(far, Math.hypot(s.x - camp.x, s.y - camp.y));
  return Math.max(camp.r, far + MOB_PAD);
}

/** Indexes in `camps` of the camps the stops sit on (a stop within `reach` of a camp's centre is that camp's), once each, in stop order. */
export function campStops(stops: readonly Vec2[], camps: readonly CampLike[], reach: number = ROUTE_REACH): number[] {
  const out: number[] = [];
  for (const s of stops) {
    if (!finite(s)) continue;
    let best = -1, bestD = reach;
    camps.forEach((c, i) => {
      const d = Math.hypot(c.x - s.x, c.y - s.y);
      if (d <= bestD) { best = i; bestD = d; }
    });
    if (best >= 0 && !out.includes(best)) out.push(best);
  }
  return out;
}

/** A ring round each camp the route stops at. */
export function campRings(stops: readonly Vec2[], camps: readonly CampLike[]): RingPiece[] {
  return campStops(stops, camps).map((i) => {
    const c = camps[i]!;
    const radius = ringRadius(c);
    const box: Box = { x: projX(c.x) - radius - BOX_PAD, y: projY(c.y) - radius * Y_SCALE - BOX_PAD, w: 2 * radius + 2 * BOX_PAD, h: 2 * radius * Y_SCALE + 2 * BOX_PAD };
    return { kind: "ring", camp: i, x: c.x, y: c.y, radius, detect: radius + RING_DETECT_EXTRA, walkedAt: null, box };
  });
}

/** Points along the player's move from `from` to `to`, SWEEP_STEP apart, ending at `to`; just `to` for a teleport. */
export function sweepSamples(from: Vec2 | null, to: Vec2): Vec2[] {
  if (!from) return [{ x: to.x, y: to.y }];
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d > SWEEP_MAX || d <= SWEEP_STEP) return [{ x: to.x, y: to.y }];
  const n = Math.ceil(d / SWEEP_STEP);
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) out.push({ x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n });
  return out;
}

/** The camera's box snapped out to a WINDOW_STEP grid and grown by one step each side: it covers the view until the view has moved a step. */
export function quantizeWindow(view: Box, step: number = WINDOW_STEP): Box {
  const x0 = Math.floor(view.x / step) * step - step;
  const y0 = Math.floor(view.y / step) * step - step;
  const x1 = Math.ceil((view.x + view.w) / step) * step + step;
  const y1 = Math.ceil((view.y + view.h) / step) * step + step;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------------------------------------------------------------------- model

const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;

export class GroundRouteModel {
  private pieces: Piece[] = [];
  private camps: readonly CampLike[] = [];
  /** Where the player was at the last step: the walk between there and the next sample is swept. */
  private last: Vec2 | null = null;

  setCamps(camps: readonly CampLike[]): void {
    this.camps = camps;
  }

  get size(): number {
    return this.pieces.length;
  }

  /** Every piece of the current route, walked or not. */
  all(): readonly Piece[] {
    return this.pieces;
  }

  /**
   * Replaces the route (null or empty clears it). Each new piece takes the state of the old piece at the same place (the same
   * camp for a ring); one with no old piece is fresh, except under the player (`at`): that is gone at once, so an edit made
   * while standing on the line never brings back the stretch behind.
   */
  setRoute(route: RouteGeometry | null, at: Vec2 | null): void {
    const next: Piece[] = route ? [...routeDashes(route.points, route.stops), ...campRings(route.stops, this.camps)] : [];
    const dashes = new Map<string, DashPiece[]>();
    const rings = new Map<number, RingPiece>();
    for (const p of this.pieces) {
      if (p.kind === "ring") { rings.set(p.camp, p); continue; }
      const key = cellKey(Math.floor(p.x / MATCH_CELL), Math.floor(p.y / MATCH_CELL));
      const list = dashes.get(key);
      if (list) list.push(p); else dashes.set(key, [p]);
    }
    const standing = at !== null && finite(at);
    for (const p of next) {
      if (p.kind === "ring") {
        const old = rings.get(p.camp);
        if (old) p.walkedAt = old.walkedAt;
        else if (standing && Math.hypot(p.x - at!.x, p.y - at!.y) <= p.detect) p.walkedAt = -Infinity;
        continue;
      }
      const old = matchDash(dashes, p);
      if (old) p.walkedAt = old.walkedAt;
      else if (standing && Math.hypot(p.x - at!.x, p.y - at!.y) <= GROUND_DETECT) p.walkedAt = -Infinity;
    }
    this.pieces = next;
  }

  /**
   * One chunk of the walk: the player is at `at` now, `now` ms. Returns the pieces the walk reached since the last step (their
   * `walkedAt` is now). A null `at` (dead, not placed yet) walks nothing and forgets where the player was.
   */
  step(at: Vec2 | null, now: number): Piece[] {
    if (!at || !finite(at)) { this.last = null; return []; }
    const samples = sweepSamples(this.last, at);
    this.last = { x: at.x, y: at.y };
    const reached: Piece[] = [];
    for (const p of this.pieces) {
      if (p.walkedAt !== null) continue;
      const detect = p.kind === "ring" ? p.detect : GROUND_DETECT;
      for (const s of samples) {
        if (Math.hypot(p.x - s.x, p.y - s.y) <= detect) {
          p.walkedAt = now;
          reached.push(p);
          break;
        }
      }
    }
    return reached;
  }

  /** The untouched pieces in the camera window (a projected box; null = all of them): what the steady layer draws. */
  pristine(window: Box | null): Piece[] {
    return this.pieces.filter((p) => p.walkedAt === null && (window === null || overlaps(p.box, window)));
  }

  /** Forgets the route and where the player was (a new run). */
  clear(): void {
    this.pieces = [];
    this.last = null;
  }
}

function matchDash(grid: Map<string, DashPiece[]>, p: DashPiece): DashPiece | null {
  const cx = Math.floor(p.x / MATCH_CELL), cy = Math.floor(p.y / MATCH_CELL);
  let best: DashPiece | null = null, bestD = MATCH_DIST;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(cellKey(cx + dx, cy + dy));
      if (!list) continue;
      for (const o of list) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d <= bestD) { best = o; bestD = d; }
      }
    }
  }
  return best;
}
