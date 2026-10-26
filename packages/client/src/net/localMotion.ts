// Where the LOCAL fighter is drawn (client-side prediction, presentation only: the server stays authoritative and nothing here
// is ever sent). Everyone else is drawn INTERP_DELAY_MS in the past; the local fighter would be too, plus the time an order
// needs to reach the server and come back, which made a click feel a fifth of a second late. So the client walks its own
// model at once, along the same A* path the server will plan (shared findPath, the same walls), and keeps it honest:
//
//   predict  After a `move` or `stop`. `sim` walks the path at PLAYER_SPEED x the multipliers the client can know. It runs
//            `delay` (D) ahead of the server: S(T) = sim(T - D), where D is how long an order took to take effect.
//   follow   After a `target`: the server chases, so there is nothing to predict: the newest server sample, carried on by its
//            own velocity for at most one tick.
//
// Orders carry a `seq` (1..255) that the server echoes in `PlayerState.moveSeq` on the tick it applies the order. The patch
// that first shows a seq gives that order's delay: the server stepped one tick of walking in the very tick it applied the
// order, so S(T) = sim(c + TICK_MS) for a leg that started at client time c, i.e. delay = T - TICK_MS - c. It may be
// negative (a click that landed just before a tick) and is not rounded to the tick grid.
//
// Reconciliation ("rebase"): on each new sample, err = S(T) - sim at (T - delay). A small error moves `sim` by err and the
// drawn position by nothing: the same amount goes into `visual`, an offset that decays (a 100 ms time constant, and at most
// the CORRECT_SPEED_* below, so a correction can slow or hurry a walking fighter but not turn it round). Drawn = sim + visual. Errors past SNAP_DISTANCE
// (a teleport, a burst of speed the client did not model) snap. Two things keep the comparison honest: the delay used is that of
// the last order that changed WHEN the fighter moves (a start, a stop, a turn; re-sending nearly the same direction while the
// mouse is held does not, so its phase against the tick grid does not make the fighter wobble), and no comparison is made while
// the sim's history at (T - delay) already follows an order the server has not applied yet.
import {
  findPath, PLAYER_RADIUS, PLAYER_SPEED, segmentClear, TELEPORT_DISTANCE, TICK_MS, type GameMap, type Vec2,
} from "@raid/shared";

export type MotionMode = "predict" | "follow";
export type OrderKind = "move" | "stop" | "target";

/** The newest authoritative state of the local fighter: its position at server time `t`, and the last order the server applied. */
export interface AuthSample {
  x: number;
  y: number;
  /** `RaidState.serverTime` of the patch. */
  t: number;
  /** `PlayerState.moveSeq`; 0 = no order applied yet. */
  moveSeq: number;
}

/** What the client knows about the local fighter this frame. */
export interface FrameInput {
  /** Status "alive": anything else (a lobby, a corpse) is drawn where the server has it. */
  alive: boolean;
  /** Walk speed multiplier right now: buff stacks, a kill's burst, the chill. 1 = PLAYER_SPEED. */
  speedMult: number;
  /** An attack's root the client knows of holds the fighter still (the axe's, after its swing). */
  rooted: boolean;
  /** The cursor's aim is streaming, so the server's facing follows the cursor, not the walk. */
  aiming: boolean;
}

/** An error up to here (world units) is absorbed smoothly; beyond it the fighter snaps to the server's position. */
export const SNAP_DISTANCE = 96;
/** Rebase corrections smaller than this are ignored while the fighter moves, and (nearly) exact ones at rest. */
export const REBASE_DEADZONE = 0.5;
export const REST_DEADZONE = 0.05;
/** The offset between drawn and predicted position decays with this time constant... */
export const VISUAL_TAU_MS = 100;
/**
 * ...but never faster than this (u/s). While the fighter walks, a correction may slow it or hurry it, never turn it round: 70,
 * rising by 2 per unit of offset past 20 to at most the second figure. Standing, it is gentle for a small slide (just under
 * what FigureJuice takes for a walk starting, 45 u/s) and brisker the farther it has to go: 44 plus 3 per unit past 10, at most
 * the second figure (never faster than a run).
 */
export const CORRECT_SPEED_MOVING = 70;
export const CORRECT_SPEED_MOVING_MAX = 120;
export const CORRECT_SPEED_REST = 44;
export const CORRECT_SPEED_REST_MAX = 1.5 * PLAYER_SPEED;
/** The order delay estimate before any order has been acknowledged, its bounds, and how fast it follows new measurements. */
export const DELAY_INIT_MS = TICK_MS;
export const DELAY_MIN_MS = -TICK_MS;
export const DELAY_MAX_MS = 400;
const DELAY_EMA = 0.25;
/** How far back the predicted path is remembered for comparing with the server (it only has to cover delay + a patch). */
const HISTORY_MS = 1500;
/** Orders waiting for their acknowledgement: how many, and for how long. */
const MAX_ORDERS = 32;
const ORDER_KEEP_MS = 2500;
/** A frame is never simulated as longer than this (a stalled tab must not walk the model through a wall). */
const MAX_FRAME_MS = 100;
/** A new order whose first step is within this angle (cos) of the way the fighter walks does not change when it moves. */
const SAME_DIRECTION_COS = Math.cos((12 * Math.PI) / 180);
/** Entering `predict` from `follow`, the model starts this far ahead of the server sample (at most) along its velocity. */
const LOOKAHEAD_MAX_MS = 300;

interface Order {
  seq: number;
  /** Client clock when it was sent. */
  c: number;
  /** Measured once the server has applied it; null before. */
  delay: number | null;
  applied: boolean;
  /** Whether it changed when the fighter moves (see the header): only those set the delay the rebase aligns with. */
  timing: boolean;
}

interface Pose { c: number; x: number; y: number }

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Walks `dist` along `path` from `from`, writing the end point to `out` and returning how many waypoints were reached.
 * Does not touch the path: the caller drops what was passed.
 */
function walkAlong(from: Vec2, path: readonly Vec2[], dist: number, out: Vec2): number {
  let x = from.x;
  let y = from.y;
  let budget = dist;
  let i = 0;
  while (budget > 0 && i < path.length) {
    const t = path[i]!;
    const dx = t.x - x;
    const dy = t.y - y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      x = t.x;
      y = t.y;
      budget -= d;
      i++;
    } else {
      x += (dx / d) * budget;
      y += (dy / d) * budget;
      budget = 0;
    }
  }
  out.x = x;
  out.y = y;
  return i;
}

export class LocalMotion {
  /** Where the local fighter is drawn: the model plus the smoothing offset. Valid once `ready`. */
  readonly drawn: Vec2 = { x: 0, y: 0 };

  private auth: AuthSample | null = null;
  /** The server velocity (u/s) over the last two samples. */
  private vx = 0;
  private vy = 0;
  private _mode: MotionMode = "predict";
  private readonly sim: Vec2 = { x: 0, y: 0 };
  private readonly visual: Vec2 = { x: 0, y: 0 };
  private path: Vec2[] = [];
  /** The sim advanced in the latest frame. */
  private moved = false;
  /** The client clock of the latest frame, and the speed (u/s) the sim walked at in it. */
  private c = 0;
  private speed = PLAYER_SPEED;
  private aiming = false;
  private history: Pose[] = [];
  private orders: Order[] = [];
  private _delay = DELAY_INIT_MS;
  private delayKnown = false;
  /** The delay the rebase aligns the server's samples with (see the header). */
  private align = DELAY_INIT_MS;
  private _ready = false;
  /** The latest frame saw the fighter alive. */
  private alive = true;
  private readonly scratch: Vec2 = { x: 0, y: 0 };

  get ready(): boolean { return this._ready; }
  get mode(): MotionMode { return this._mode; }
  /** The estimated time an order takes to take effect on the server (ms; smoothed over the acknowledged orders). */
  get delay(): number { return this._delay; }
  /** How far the drawn position is from the predicted one right now (u). */
  get visualOffset(): number { return Math.hypot(this.visual.x, this.visual.y); }
  /** Orders sent that the server has not yet applied. */
  get pendingOrders(): number { return this.orders.reduce((n, o) => n + (o.applied ? 0 : 1), 0); }
  /** The model's own position (without the smoothing offset), for tools and tests. */
  get predicted(): Readonly<Vec2> { return this.sim; }
  /** Whether the model is walking a path this frame. */
  get walking(): boolean { return this.moved; }

  /** Forgets everything (a new scene). */
  reset(): void {
    this.auth = null;
    this.vx = 0;
    this.vy = 0;
    this._mode = "predict";
    this.visual.x = 0;
    this.visual.y = 0;
    this.path = [];
    this.moved = false;
    this.history.length = 0;
    this.orders.length = 0;
    this._delay = DELAY_INIT_MS;
    this.align = DELAY_INIT_MS;
    this.delayKnown = false;
    this._ready = false;
  }

  /**
   * The player gave an order, at client clock `c` (= the clock that stamps the patches). `seq` (1..255) is what the message
   * carries, for a move or a stop. A move to a point the shared pathfinder cannot reach changes nothing (the server ignores
   * the point, though it still counts the order and drops the lock). `map` is the walls the server collides with: the gated
   * map while the coliseum gates are locked.
   */
  order(kind: OrderKind, seq: number, c: number, target: Vec2 | undefined, map: GameMap): void {
    if (!this.auth || !this._ready) return;
    if (kind === "target") {
      this.enterFollow(c);
      return;
    }
    const origin = this._mode === "follow" ? this.lookahead(map) : this.sim;
    const path = kind === "move" && target ? findPath(map, origin, target, PLAYER_RADIUS) : [];
    if (kind === "move" && path.length === 0) {
      this.note(seq, c, false);
      return;
    }
    // From `follow` the server has been walking on since the sample, and will have walked on `delay` more when it applies this.
    const wasFollow = this._mode === "follow";
    let timing = true;
    if (wasFollow) {
      this.visual.x += this.sim.x - origin.x;
      this.visual.y += this.sim.y - origin.y;
      this.sim.x = origin.x;
      this.sim.y = origin.y;
      this._mode = "predict";
    } else if (!this.moved) {
      timing = kind === "move";
    } else if (kind === "move" && this.path.length > 0) {
      const a = this.path[0]!;
      const b = path[0]!;
      const ax = a.x - this.sim.x, ay = a.y - this.sim.y, bx = b.x - this.sim.x, by = b.y - this.sim.y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-6 && lb > 1e-6 && (ax * bx + ay * by) / (la * lb) >= SAME_DIRECTION_COS) timing = false;
    }
    this.path = path;
    this.note(seq, c, timing || wasFollow);
  }

  /**
   * A patch arrived: the local fighter's server state. Called once per patch, in arrival order; `c` is the client clock now.
   * The order it acknowledges (its `moveSeq`) gives the delay; in `predict` mode the sample then pulls the model
   * back in line, in `follow` mode it simply is the position.
   */
  observe(s: AuthSample, c: number): void {
    const prev = this.auth;
    if (prev && s.t <= prev.t) return;
    if (!prev) {
      this.auth = { ...s };
      this.snapTo(s);
      this._ready = true;
      return;
    }
    const oldFollow = this._mode === "follow" ? this.followPos(c, this.scratch) : null;
    const ox = oldFollow?.x ?? 0, oy = oldFollow?.y ?? 0;
    const dt = s.t - prev.t;
    const jumped = Math.hypot(s.x - prev.x, s.y - prev.y) > TELEPORT_DISTANCE;
    if (dt <= 200) {
      this.vx = ((s.x - prev.x) / dt) * 1000;
      this.vy = ((s.y - prev.y) / dt) * 1000;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    this.auth = { x: s.x, y: s.y, t: s.t, moveSeq: s.moveSeq };
    if (jumped || !this.alive) {
      this.snapTo(s);
      return;
    }
    this.ack(s.moveSeq, s.t);
    if (this._mode === "follow") {
      const p = this.followPos(c, this.scratch);
      const jx = p.x - ox, jy = p.y - oy;
      if (Math.hypot(jx, jy) > SNAP_DISTANCE) this.snapTo(s);
      else {
        // The sample replaces the extrapolation; what drawn would jump by goes into the smoothing offset instead.
        this.sim.x = p.x;
        this.sim.y = p.y;
        this.visual.x -= jx;
        this.visual.y -= jy;
      }
    } else {
      this.rebase(s);
    }
  }

  /**
   * The server applied order `seq` on the tick stamped `t`: measures that order's delay and moves the estimate. A seq the
   * list does not hold (0, an order too old, a stranger's) is ignored. Orders sent before it that the server skipped (two
   * orders in one tick: only the last applies) count as applied too.
   */
  ack(seq: number, t: number): void {
    if (seq === 0) return;
    let i = this.orders.length - 1;
    while (i >= 0 && this.orders[i]!.seq !== seq) i--;
    if (i < 0) return;
    const o = this.orders[i]!;
    if (o.applied) return;
    o.delay = clamp(t - TICK_MS - o.c, DELAY_MIN_MS, DELAY_MAX_MS);
    this._delay = this.delayKnown ? this._delay + DELAY_EMA * (o.delay - this._delay) : o.delay;
    this.delayKnown = true;
    let timing = o.timing;
    for (let j = 0; j <= i; j++) {
      const q = this.orders[j]!;
      if (!q.applied) timing = timing || q.timing;
      q.applied = true;
    }
    if (timing) this.align = o.delay;
  }

  /** Once per frame, `c` the client clock (see order), `dtMs` the time since the last frame. */
  frame(c: number, dtMs: number, input: FrameInput): void {
    const auth = this.auth;
    if (!auth) return;
    const dt = clamp(dtMs, 0, MAX_FRAME_MS);
    this.aiming = input.aiming;
    this.alive = input.alive;
    if (!input.alive) {
      this.snapTo(auth);
      this.c = c;
      this.record(c);
      this.draw();
      return;
    }
    if (this._mode === "predict") {
      this.speed = PLAYER_SPEED * Math.max(0, input.speedMult) * (input.rooted ? 0 : 1);
      this.moved = false;
      if (this.path.length > 0 && this.speed > 0 && dt > 0) {
        const reached = walkAlong(this.sim, this.path, (this.speed * dt) / 1000, this.scratch);
        this.moved = Math.hypot(this.scratch.x - this.sim.x, this.scratch.y - this.sim.y) > 1e-9;
        this.sim.x = this.scratch.x;
        this.sim.y = this.scratch.y;
        if (reached > 0) this.path.splice(0, reached);
      }
    } else {
      this.followPos(c, this.sim);
      this.moved = Math.hypot(this.vx, this.vy) > 5;
    }
    this.decay(dt);
    this.c = c;
    this.record(c);
    this.draw();
  }

  /**
   * The direction the walk faces (radians) while the predicted path is being walked, or null: standing, rooted, following
   * the server, or with the aim streaming (then the server's facing follows the cursor and its patch is the best there is).
   */
  facing(): number | null {
    if (this._mode !== "predict" || !this.moved || this.aiming || this.path.length === 0) return null;
    const t = this.path[0]!;
    const dx = t.x - this.sim.x, dy = t.y - this.sim.y;
    return dx === 0 && dy === 0 ? null : Math.atan2(dy, dx);
  }

  // ------------------------------------------------------------------------------------------------------------------

  private note(seq: number, c: number, timing: boolean): void {
    this.orders.push({ seq, c, delay: null, applied: false, timing });
    while (this.orders.length > MAX_ORDERS || (this.orders.length > 0 && this.orders[0]!.c < c - ORDER_KEEP_MS)) this.orders.shift();
  }

  /** The sample carried on by its velocity for at most one tick: where the server has the fighter about now. */
  private followPos(c: number, out: Vec2): Vec2 {
    const a = this.auth!;
    const e = clamp(c - a.t, 0, TICK_MS) / 1000;
    out.x = a.x + this.vx * e;
    out.y = a.y + this.vy * e;
    return out;
  }

  private enterFollow(c: number): void {
    if (this._mode === "follow") return;
    const was = { x: this.sim.x, y: this.sim.y };
    this._mode = "follow";
    this.path = [];
    this.moved = false;
    this.followPos(c, this.sim);
    this.visual.x += was.x - this.sim.x;
    this.visual.y += was.y - this.sim.y;
  }

  /** Where a walk ordered now begins when the server is chasing: where it will be when it applies the order, if that is clear ground. */
  private lookahead(map: GameMap): Vec2 {
    const ms = clamp(this._delay, 0, LOOKAHEAD_MAX_MS) / 1000;
    const ahead = { x: this.sim.x + this.vx * ms, y: this.sim.y + this.vy * ms };
    return ms > 0 && segmentClear(map, this.sim, ahead, PLAYER_RADIUS) ? ahead : { x: this.sim.x, y: this.sim.y };
  }

  private snapTo(at: { x: number; y: number }): void {
    this.sim.x = at.x;
    this.sim.y = at.y;
    this.visual.x = 0;
    this.visual.y = 0;
    this.path = [];
    this._mode = "predict";
    this.moved = false;
    this.history.length = 0;
    this.orders.length = 0;
  }

  /** The model at client time `t`: from the history, or carried on along the path for a time not yet reached (a negative delay). */
  private simAt(t: number): Vec2 | null {
    const h = this.history;
    if (t >= this.c) {
      walkAlong(this.sim, this.path, (this.speed * (t - this.c)) / 1000, this.scratch);
      return this.scratch;
    }
    if (h.length === 0 || t < h[0]!.c) return null;
    let i = h.length - 1;
    while (i > 0 && h[i - 1]!.c > t) i--;
    const b = h[i]!;
    const a = h[Math.max(0, i - 1)]!;
    const k = b.c > a.c ? clamp((t - a.c) / (b.c - a.c), 0, 1) : 1;
    this.scratch.x = a.x + (b.x - a.x) * k;
    this.scratch.y = a.y + (b.y - a.y) * k;
    return this.scratch;
  }

  private rebase(s: AuthSample): void {
    const at = s.t - this.align;
    const next = this.orders.find((o) => !o.applied);
    // The model at `at` already follows an order the server has not applied: it says nothing about where the server is.
    if (next && at >= next.c) return;
    const ref = this.simAt(at);
    if (!ref) return;
    const ex = s.x - ref.x;
    const ey = s.y - ref.y;
    const err = Math.hypot(ex, ey);
    const still = !this.moved && this.path.length === 0 && Math.hypot(this.vx, this.vy) < 5;
    if (err <= (still ? REST_DEADZONE : REBASE_DEADZONE)) return;
    if (err > SNAP_DISTANCE) {
      this.snapTo(s);
      return;
    }
    this.sim.x += ex;
    this.sim.y += ey;
    for (const p of this.history) {
      p.x += ex;
      p.y += ey;
    }
    this.visual.x -= ex;
    this.visual.y -= ey;
  }

  /** The smoothing offset runs down: exponentially, but at most as fast as the CORRECT_SPEED_* caps allow. */
  private decay(dt: number): void {
    const mag = Math.hypot(this.visual.x, this.visual.y);
    if (mag < 1e-4) {
      this.visual.x = 0;
      this.visual.y = 0;
      return;
    }
    if (dt <= 0) return;
    const speedCap = this.moved
      ? Math.min(CORRECT_SPEED_MOVING_MAX, CORRECT_SPEED_MOVING + 2 * Math.max(0, mag - 20))
      : Math.min(CORRECT_SPEED_REST_MAX, CORRECT_SPEED_REST + 3 * Math.max(0, mag - 10));
    const cap = speedCap * (dt / 1000);
    const dec = Math.min(mag, mag * (1 - Math.exp(-dt / VISUAL_TAU_MS)), cap);
    const k = (mag - dec) / mag;
    this.visual.x *= k;
    this.visual.y *= k;
  }

  private record(c: number): void {
    const h = this.history;
    // The clock only runs back when it resynchronises: what was recorded in its future never happened.
    while (h.length > 0 && h[h.length - 1]!.c >= c) h.pop();
    h.push({ c, x: this.sim.x, y: this.sim.y });
    while (h.length > 2 && h[0]!.c < c - HISTORY_MS) h.shift();
  }

  private draw(): void {
    this.drawn.x = this.sim.x + this.visual.x;
    this.drawn.y = this.sim.y + this.visual.y;
  }
}
