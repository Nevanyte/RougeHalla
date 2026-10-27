// The slide: how a fighter walks on slippery ground (ice). Pure: the map is read, the body, its slide state and its path
// are mutated in place. The server's movement (sim/movement.ts walkFighter) and the client's model of the local fighter
// call the same code, so the two agree on a trajectory up to float noise. Only + - * / and sqrt do arithmetic (plus the
// exact floor, min, max and abs), so the same inputs give the same trajectory on every engine, and nothing draws from a
// random stream. It builds no tables; it allocates small result objects (one per substep, one per walk), and a re-plan
// builds a path (findPath).
//
// The model is acceleration-limited traction. The velocity turns toward the path-following velocity by at most
// `accel * dt` per step, and the body moves by the exact integral of that piecewise-linear velocity. So a start takes
// PLAYER_SPEED / accel seconds, a stop slides v^2 / (2 accel), and a step of any size gives the same trajectory as many
// small ones for a constant target. A clicked point is reached exactly: the last leg brakes (the target speed is the
// largest one from which a step's travel still leaves room to stop).
import { TICK_MS, PLAYER_RADIUS, TILE } from "./constants";
import { segmentClear } from "./geometry";
import { isSolidTile } from "./map";
import type { GameMap } from "./map";
import type { Vec2 } from "./messages";
import { findPath } from "./pathfind";

/**
 * A fighter's slide: velocity (u/s), the gate anchor (the last waypoint passed, or where this path began), the path array
 * it was anchored on (identity: a new array re-anchors) and the earliest time a stuck slide may plan again. The optional
 * fields are the livelock breaker (slipWalk): the goal the latest stuck re-plans were aimed at, how many in a row, the
 * closest the body stood to it at one, and when the last was; and `gripUntil`, the time until which the fighter walks its
 * path exactly instead of sliding. A state that never got stuck never has them.
 */
export interface SlipState {
  vx: number; vy: number; ax: number; ay: number; path: readonly Vec2[] | null; replanAt: number;
  stuckX?: number; stuckY?: number; stuckN?: number; stuckBest?: number; stuckAt?: number;
  gripUntil?: number;
}

/** A slide that starts at (x, y) already moving at (vx, vy): what a fighter carries onto the ice. */
export function newSlip(x: number, y: number, vx: number, vy: number): SlipState {
  return { vx, vy, ax: x, ay: y, path: null, replanAt: -Infinity };
}

export interface SlipResult {
  /** A solid tile stopped the body on an axis in this step. */
  hit: boolean;
  /** Waypoints consumed. */
  reached: number;
  /** Distance moved. */
  moved: number;
}

/** A waypoint this close is passed whatever the gate says (FIRST PICK). */
export const SLIP_REACH = 4;
/** A slide that is stuck on a wall plans again at most this often (= TARGET_REPATH_MS). */
export const SLIP_REPLAN_MS = 250;
/**
 * The livelock breaker: this many stuck re-plans in a row toward one goal (each within SLIP_STUCK_WINDOW_MS of the one before,
 * none leaving the body a tile closer to the goal than the best so far) mean the slide cannot make a turn it keeps overshooting
 * (a one-tile corridor with a side corridor, all ice). The fighter then walks its path exactly for SLIP_GRIP_MS and slides again.
 */
export const SLIP_STUCK_REPLANS = 3;
export const SLIP_STUCK_WINDOW_MS = 2000;
export const SLIP_GRIP_MS = 1000;
/** The last waypoint counts as reached within this, at a speed one step's braking can kill. */
const ARRIVE_EPS = 0.5;

/**
 * The x a disc of radius `r` at (x, y) reaches moving by dx: the exact first contact with a movement-solid tile's face or
 * corner (`face -/+ r`, or `face -/+ sqrt(r^2 - gap^2)` past a corner). The sweep visits every column between the start
 * and the end, so no step length tunnels. Out of bounds is solid.
 */
export function sweepX(map: GameMap, x: number, y: number, dx: number, r: number): number {
  if (dx === 0) return x;
  const nx = x + dx;
  const j0 = Math.floor((y - r) / TILE);
  const j1 = Math.floor((y + r) / TILE);
  let best = nx;
  if (dx > 0) {
    const i0 = Math.floor(x / TILE);
    const i1 = Math.floor((nx + r) / TILE);
    for (let i = i0; i <= i1; i++) {
      const face = i * TILE;
      if (face < x - 1e-9) continue;
      for (let j = j0; j <= j1; j++) {
        if (!isSolidTile(map, i, j)) continue;
        const gy = Math.max(0, j * TILE - y, y - (j + 1) * TILE);
        if (gy >= r) continue;
        const c = face - Math.sqrt(r * r - gy * gy);
        if (c < best) best = c;
      }
    }
    return Math.max(x, best);
  }
  const i0 = Math.floor((nx - r) / TILE);
  const i1 = Math.floor(x / TILE);
  for (let i = i0; i <= i1; i++) {
    const face = (i + 1) * TILE;
    if (face > x + 1e-9) continue;
    for (let j = j0; j <= j1; j++) {
      if (!isSolidTile(map, i, j)) continue;
      const gy = Math.max(0, j * TILE - y, y - (j + 1) * TILE);
      if (gy >= r) continue;
      const c = face + Math.sqrt(r * r - gy * gy);
      if (c > best) best = c;
    }
  }
  return Math.min(x, best);
}

/** sweepX with the axes swapped. */
export function sweepY(map: GameMap, x: number, y: number, dy: number, r: number): number {
  if (dy === 0) return y;
  const ny = y + dy;
  const i0 = Math.floor((x - r) / TILE);
  const i1 = Math.floor((x + r) / TILE);
  let best = ny;
  if (dy > 0) {
    const j0 = Math.floor(y / TILE);
    const j1 = Math.floor((ny + r) / TILE);
    for (let j = j0; j <= j1; j++) {
      const face = j * TILE;
      if (face < y - 1e-9) continue;
      for (let i = i0; i <= i1; i++) {
        if (!isSolidTile(map, i, j)) continue;
        const gx = Math.max(0, i * TILE - x, x - (i + 1) * TILE);
        if (gx >= r) continue;
        const c = face - Math.sqrt(r * r - gx * gx);
        if (c < best) best = c;
      }
    }
    return Math.max(y, best);
  }
  const j0 = Math.floor((ny - r) / TILE);
  const j1 = Math.floor(y / TILE);
  for (let j = j0; j <= j1; j++) {
    const face = (j + 1) * TILE;
    if (face > y + 1e-9) continue;
    for (let i = i0; i <= i1; i++) {
      if (!isSolidTile(map, i, j)) continue;
      const gx = Math.max(0, i * TILE - x, x - (i + 1) * TILE);
      if (gx >= r) continue;
      const c = face + Math.sqrt(r * r - gx * gx);
      if (c > best) best = c;
    }
  }
  return Math.min(y, best);
}

/** Moves the disc by (mx, my), x first and then y; a blocked axis loses its velocity. Returns whether anything blocked it. */
function moveDisc(map: GameMap, p: Vec2, s: SlipState, mx: number, my: number, r: number): boolean {
  let hit = false;
  const nx = sweepX(map, p.x, p.y, mx, r);
  if (Math.abs(nx - (p.x + mx)) > 1e-9) { s.vx = 0; hit = true; }
  p.x = nx;
  const ny = sweepY(map, p.x, p.y, my, r);
  if (Math.abs(ny - (p.y + my)) > 1e-9) { s.vy = 0; hit = true; }
  p.y = ny;
  return hit;
}

/**
 * One step of `dt` seconds on slippery ground. `cap` is the top speed (PLAYER_SPEED times the fighter's multipliers) and
 * `accel` the traction (slipAccel). The velocity turns toward the path-following velocity (toward path[0] at `cap`,
 * braking to a stop on the last waypoint) by at most `accel * dt`; the body moves by the exact integral of that
 * piecewise-linear velocity and is swept against movement-solid tiles (x, then y), losing the velocity component a wall
 * stops, so it runs along the wall. `cap <= 0` (a windup or any root) plants the fighter: the velocity is zeroed.
 * Intermediate waypoints are consumed once passed (the gate: past the line through the waypoint across the incoming leg)
 * or within SLIP_REACH, so a lagging velocity overshoots a corner on the outside and never orbits it. The last waypoint is
 * consumed on arrival at a speed one step's braking can kill. A path array other than the one the slide was anchored on
 * re-anchors it at `p`. Mutates p, s and path.
 */
export function slipStep(map: GameMap, p: Vec2, s: SlipState, path: Vec2[], dt: number, cap: number, accel: number, r: number): SlipResult {
  const res: SlipResult = { hit: false, reached: 0, moved: 0 };
  if (s.path !== path) { s.ax = p.x; s.ay = p.y; s.path = path; }
  // `!(cap > 0)` rather than `cap <= 0`: a NaN cap would write NaN into the body's position for good.
  if (!(cap > 0)) { s.vx = 0; s.vy = 0; return res; }
  while (path.length > 1) {
    const w = path[0]!;
    const gx = w.x - s.ax, gy = w.y - s.ay;
    const px = p.x - w.x, py = p.y - w.y;
    if (px * gx + py * gy >= 0 || px * px + py * py <= SLIP_REACH * SLIP_REACH) {
      s.ax = w.x; s.ay = w.y; path.shift(); res.reached++;
    } else break;
  }
  let dvx = 0, dvy = 0, d = 0;
  if (path.length > 0) {
    const w = path[0]!;
    const dx = w.x - p.x, dy = w.y - p.y;
    d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-9) {
      let sp = cap;
      if (path.length === 1) {
        const brake = accel * (Math.sqrt(dt * dt + (2 * d) / accel) - dt);
        if (brake < sp) sp = brake;
      }
      dvx = (dx / d) * sp; dvy = (dy / d) * sp;
    }
  }
  const ex = dvx - s.vx, ey = dvy - s.vy;
  const e = Math.sqrt(ex * ex + ey * ey);
  const lim = accel * dt;
  let mx: number, my: number, nvx: number, nvy: number;
  if (e <= lim) {
    const t1 = e > 0 ? e / accel : 0;
    mx = ((s.vx + dvx) / 2) * t1 + dvx * (dt - t1);
    my = ((s.vy + dvy) / 2) * t1 + dvy * (dt - t1);
    nvx = dvx; nvy = dvy;
  } else {
    nvx = s.vx + (ex / e) * lim; nvy = s.vy + (ey / e) * lim;
    mx = ((s.vx + nvx) / 2) * dt; my = ((s.vy + nvy) / 2) * dt;
  }
  const x0 = p.x, y0 = p.y;
  if (path.length === 1) {
    const m = Math.sqrt(mx * mx + my * my);
    const sp = Math.sqrt(nvx * nvx + nvy * nvy);
    if (m >= d - ARRIVE_EPS && sp <= lim + 1e-6) {
      const w = path[0]!;
      s.vx = 0; s.vy = 0;
      res.hit = moveDisc(map, p, s, w.x - p.x, w.y - p.y, r);
      s.vx = 0; s.vy = 0;
      path.shift(); res.reached++;
      const ax = p.x - x0, ay = p.y - y0;
      res.moved = Math.sqrt(ax * ax + ay * ay);
      return res;
    }
  }
  s.vx = nvx; s.vy = nvy;
  res.hit = moveDisc(map, p, s, mx, my, r);
  if (path.length === 0 && s.vx * s.vx + s.vy * s.vy < 1e-6) { s.vx = 0; s.vy = 0; }
  const bx = p.x - x0, by = p.y - y0;
  res.moved = Math.sqrt(bx * bx + by * by);
  return res;
}

/**
 * `dtMs` of sliding in substeps of at most TICK_MS (the server calls it with one tick, the client with a frame). `slipAt` is
 * the traction under a point for this fighter, asked at the start of every substep: the walk stops substepping the moment
 * the centre leaves slippery ground (the caller grips from then on). A substep that hits a wall while the next leg is not
 * clear plans again to the last waypoint, at most once per SLIP_REPLAN_MS of `now` (any clock both sides agree on).
 *
 * The safety net for a map the slide cannot steer on (ice that touches a wall: validateTerrain T11 refuses such a map, this is
 * for one that got through): SLIP_STUCK_REPLANS stuck re-plans toward one goal, with no progress toward it, set `s.gripUntil`.
 * Until then (`now` < gripUntil) the fighter walks its path exactly, as off ice (a clear leg walked at `cap`, the leg planned
 * again if it is not clear), keeping the velocity it walks at, and then slides again if it is still on ice. The grip lives in
 * the state, so every caller that runs this walk (the server's walkFighter, the client's model) takes it in step.
 */
export function slipWalk(
  map: GameMap, p: Vec2, s: SlipState, path: Vec2[], dtMs: number, cap: number,
  slipAt: (x: number, y: number) => number, now: number, r: number,
): SlipResult {
  const out: SlipResult = { hit: false, reached: 0, moved: 0 };
  // A clock that ran back (the client's resynchronises) never holds the grip for longer than its length.
  if (s.gripUntil !== undefined && s.gripUntil > now + SLIP_GRIP_MS) s.gripUntil = now + SLIP_GRIP_MS;
  let left = dtMs;
  while (left > 1e-9) {
    const accel = slipAt(p.x, p.y);
    if (!(accel > 0)) break;
    const h = left < TICK_MS ? left : TICK_MS;
    left -= h;
    if (s.gripUntil !== undefined && now < s.gripUntil) {
      gripStep(map, p, s, path, h / 1000, cap, r, out);
      continue;
    }
    const step = slipStep(map, p, s, path, h / 1000, cap, accel, r);
    out.moved += step.moved;
    out.reached += step.reached;
    if (step.hit) out.hit = true;
    if (step.hit && path.length > 0 && now >= s.replanAt && !segmentClear(map, p, path[0]!, r)) {
      s.replanAt = now + SLIP_REPLAN_MS;
      const goal = path[path.length - 1]!;
      noteStuck(s, p, goal, now);
      const next = findPath(map, p, goal, r);
      path.splice(0, path.length, ...next);
      s.ax = p.x; s.ay = p.y;
    }
  }
  return out;
}

/** Counts a stuck re-plan toward `goal`; the SLIP_STUCK_REPLANS-th in a row (see there) starts the grip. */
function noteStuck(s: SlipState, p: Vec2, goal: Vec2, now: number): void {
  const gx = goal.x - p.x, gy = goal.y - p.y;
  const d = Math.sqrt(gx * gx + gy * gy);
  const again = s.stuckX === goal.x && s.stuckY === goal.y && now - (s.stuckAt ?? -Infinity) <= SLIP_STUCK_WINDOW_MS;
  const best = s.stuckBest ?? d;
  s.stuckAt = now;
  if (again && d >= best - TILE) {
    s.stuckN = (s.stuckN ?? 0) + 1;
    if (d < best) s.stuckBest = d;
  } else {
    s.stuckX = goal.x; s.stuckY = goal.y; s.stuckN = 1; s.stuckBest = d;
  }
  if (s.stuckN! >= SLIP_STUCK_REPLANS) { s.gripUntil = now + SLIP_GRIP_MS; s.stuckN = 0; }
}

/**
 * One substep of the grip: today's plain walk (advanceAlongPath in the server's movement.ts, without its facing): a clear leg
 * walked at `cap`, no collision. A path array the slide was not anchored on is walked from its start, so its first leg is
 * checked like regrip checks it (planned again if blocked). The velocity becomes the walk's, so the slide that follows the grip
 * starts from it.
 */
function gripStep(map: GameMap, p: Vec2, s: SlipState, path: Vec2[], dt: number, cap: number, r: number, out: SlipResult): void {
  if (s.path !== path) {
    s.ax = p.x; s.ay = p.y; s.path = path;
    if (path.length > 0 && !segmentClear(map, p, path[0]!, r)) {
      const next = findPath(map, p, path[path.length - 1]!, r);
      path.splice(0, path.length, ...next);
    }
  }
  const x0 = p.x, y0 = p.y;
  let budget = cap > 0 ? cap * dt : 0;
  while (budget > 0 && path.length > 0) {
    const w = path[0]!;
    const dx = w.x - p.x, dy = w.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= budget) {
      p.x = w.x; p.y = w.y; budget -= d;
      s.ax = w.x; s.ay = w.y;
      path.shift(); out.reached++;
    } else {
      p.x += (dx / d) * budget; p.y += (dy / d) * budget; budget = 0;
    }
  }
  const mx = p.x - x0, my = p.y - y0;
  s.vx = mx / dt; s.vy = my / dt;
  out.moved += Math.sqrt(mx * mx + my * my);
}

/**
 * Leaving the ice: the fighter grips again, and `path` (the walk it slid off) is kept if its next leg is clear from here, else
 * planned again to its last waypoint (empty when that is unreachable). The slide may have carried the body off the planned
 * line, and the plain walker never collides, so walking a blocked leg would clip a wall.
 */
export function regrip(map: GameMap, p: Vec2, path: Vec2[]): Vec2[] {
  if (path.length === 0 || segmentClear(map, p, path[0]!, PLAYER_RADIUS)) return path;
  return findPath(map, p, path[path.length - 1]!, PLAYER_RADIUS);
}
