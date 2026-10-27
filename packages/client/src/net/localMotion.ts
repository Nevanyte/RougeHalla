// Where the LOCAL fighter is drawn (client-side prediction, presentation only: the server stays authoritative and nothing here
// is ever sent). Everyone else is drawn the render delay (70-150 ms: MIN_INTERP_DELAY_MS to MAX_INTERP_DELAY_MS, see shared/interp.ts RenderClock) in the past; the local fighter would be too, plus the time an order
// needs to reach the server and come back, which made a click feel a fifth of a second late. So the client walks its own
// model at once, along the same A* path the server will plan (shared findPath, the same walls), and keeps it honest:
//
//   predict  After a `move` or `stop`. `sim` walks the path at PLAYER_SPEED x the multipliers the client can know. It runs
//            `delay` (D) ahead of the server: S(T) = sim(T - D), where D is how long an order took to take effect.
//   follow   While the server holds a lock (`PlayerState.attackTarget` set): the server chases, so there is nothing to
//            predict: the newest server sample, carried on by its own velocity for at most one tick. What the server says
//            decides: it is entered when a patch shows a lock (once no move or stop of ours is still on its way, which would
//            end it) and left when the lock empties. A click on a fighter the client expects to be accepted (`expectLock`)
//            enters it at once, so the walk it interrupts stops being predicted at the click, not a round trip later; if
//            no lock shows within ORDER_EXPIRE_MS the server refused it, and the walk it interrupted is planned again.
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
//
// What keeps it from drifting: an order the server never applies (lost while reconnecting) is forgotten after
// ORDER_EXPIRE_MS (sooner at a short delay), so it cannot hold the comparison off for good; a walk the server is not walking
// (DIVERGE_PATCHES samples in a row off by more than DIVERGE_ERR, with nothing in flight and the server not heading where
// the model goes: a revive, a halt or a walk the client did not order) is dropped; an error past SNAP_DISTANCE, or an offset
// past VISUAL_SNAP_DISTANCE, snaps to the server and plans the destination again from there.
//
// An echo of a later order covers the earlier ones (`seqAcked`): a blink and a click sent after it, both held up and handled in one
// tick, are acked by the click's number even if the click's own order has been forgotten by then.
//
// A blink order is not given up on the adaptive window (a late ack would pop the fighter back and forward again, 300 u each way):
// it waits for its ack, up to JUMP_ORDER_EXPIRE_MS. The ack of a blink that shows no changed `displaceSeq` is a refusal (the
// server answers a refused cast with the echo alone): the model snaps to the server however short the jump, and the walk the
// blink dropped is planned again, as the server (which kept walking) is on it.
//
// Displacement. A blink (Blaze Step) is an order that moves the fighter at once: `blink` puts the model on its landing (the same
// pure `blinkLanding` the server runs) and the drawn fighter jumps with it; the order carries its jump so the comparison does
// not take the model's lead for a divergence while the server has not applied it. The patch that acks it also shows a changed
// `displaceSeq`: that is our own blink, and its error is the (small) difference between the two landings, absorbed like any
// other. A changed `displaceSeq` with no blink of ours behind it is a displacement the server did on its own (a pull, a knock):
// the model, its history and the drawn fighter all move by what the server says, and a walk in hand is planned again from there.
//
// Ice. On slippery ground (`FrameInput.slipAt` > 0 under the model) the server does not walk the path exactly: the fighter keeps
// a velocity and turns it toward the walk by the traction (shared/walk.ts). The model runs the same `slipWalk` there, carrying
// the velocity it walked onto the ice with; leaving the ice it grips again and plans the walk again if the slide carried it off
// the line (`regrip`). The rebase stays position-only: both sides integrate the same dynamics, so the model's velocity is already
// the server's, and a velocity correction destabilised it at a 120 ms round trip. Off ice, with no slide in hand, none of this
// runs and the walk is exactly what it was.
import {
  findPath, newSlip, PLAYER_RADIUS, PLAYER_SPEED, regrip, segmentClear, SLIP_REPLAN_MS, slipWalk, TELEPORT_DISTANCE, TICK_MS, WORLD_H, WORLD_W,
  type GameMap, type SlipState, type Vec2,
} from "@raid/shared";

export type MotionMode = "predict" | "follow";
export type OrderKind = "move" | "stop";

/** The newest authoritative state of the local fighter: its position at server time `t`, and the last order the server applied. */
export interface AuthSample {
  x: number;
  y: number;
  /** `RaidState.serverTime` of the patch. */
  t: number;
  /** `PlayerState.moveSeq`; 0 = no order applied yet. */
  moveSeq: number;
  /** `PlayerState.attackTarget` is set: the server is chasing and attacking a lock. */
  locked?: boolean;
  /** `PlayerState.displaceSeq` (uint8, wrapping): it changes whenever the server displaces the fighter (a blink, a pull). */
  displaceSeq?: number;
}

/** What the client knows about the local fighter this frame. */
export interface FrameInput {
  /** Status "alive": anything else (a lobby, a corpse) is drawn where the server has it. */
  alive: boolean;
  /** Walk speed multiplier right now: the speed mirror, a kill's burst, the chill. 1 = PLAYER_SPEED. */
  speedMult: number;
  /** An attack's root the client knows of holds the fighter still (the axe's, after its swing). */
  rooted: boolean;
  /** The cursor's aim is streaming, so the server's facing follows the cursor, not the walk. */
  aiming: boolean;
  /** The slide traction (u/s^2) under a point for this fighter: 0 off ice and for a faction that grips it (Frost). Absent: no ice. */
  slipAt?: (x: number, y: number) => number;
  /** The walls the server collides with now (the gated copy while the gates are locked), for the slide; absent: the map of the last order. */
  map?: GameMap;
}

/** An error up to here (world units) is absorbed smoothly; beyond it the fighter snaps to the server's position. */
export const SNAP_DISTANCE = 96;
/** An offset between drawn and predicted position this large is a divergence the smoothing cannot be hiding: snap. */
export const VISUAL_SNAP_DISTANCE = 1.5 * SNAP_DISTANCE;
/**
 * A sample this far (u) from where the model had it, for this many in a row with no order in flight, and the server not
 * heading the way the model walks, means the walk the model is on is not what the server does. (Timing alone is under a tick
 * of walking, 8.5 u, and corrects itself in one sample; a speed the client missed adds a few units per sample, in the same direction.)
 */
export const DIVERGE_ERR = 6;
/** The same, while the model slides and for SLIP_GRACE_MS after: two near-identical paths stay 6 to 10 u apart on ice for longer than a few patches. */
export const DIVERGE_ERR_SLIP = 16;
/** After the model leaves ice the server may still be sliding to its grip: the slide's divergence rule holds this long (ms). */
export const SLIP_GRACE_MS = 500;
export const DIVERGE_PATCHES = 3;
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
/** Orders kept: how many, and for how long. An order the server has not applied within ORDER_EXPIRE_MS is given up on. */
const MAX_ORDERS = 32;
const ORDER_KEEP_MS = 2500;
export const ORDER_EXPIRE_MS = DELAY_MAX_MS + 200;
/**
 * An order is given up on after 2 delays and this long (never sooner than the floor, never later than ORDER_EXPIRE_MS); until the
 * first ack has measured a delay, after ORDER_EXPIRE_MS, so a slow link learns its delay instead of forgetting every order.
 */
const ORDER_EXPIRE_MARGIN_MS = 250;
const ORDER_EXPIRE_FLOOR_MS = 350;
/** A blink order waits this long for its ack, however short the delay estimate says: its model is 300 u ahead of the server. */
export const JUMP_ORDER_EXPIRE_MS = 1500;
/** A blink given up on is remembered this long (ms), to recognise its late ack. */
const EXPIRED_JUMP_KEEP_MS = 4000;
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
  /** A blink: how far (u) it moved the model at once. The server has not applied it yet, so the model is this far from it. */
  jump?: number;
  /** A blink: the vector it moved the model by, where it landed, and the walk it dropped (planned again if the server refuses). */
  jumpBy?: Vec2;
  landing?: Vec2;
  resume?: { goal: Vec2; map: GameMap } | null;
  /** A move or a stop: the walk it ordered (null: a stop). Unset for orders that leave the walk alone (a cast, an unreachable move). */
  walk?: { goal: Vec2; map: GameMap } | null;
}

/** `jump`: a blink's landing; the model was at the pose before it until then and is never between. */
interface Pose { c: number; x: number; y: number; jump?: true }

/**
 * Whether the server's `moveSeq` echo covers order number `seq`: it is that order or a later one, in the order numbers' own
 * count (1..255 and round again). The server processes orders in the order they were sent, so an echo of a later order says the
 * earlier ones were handled too (applied, or skipped by a later order of the same tick), even if the client has forgotten them.
 */
export function seqAcked(seq: number, moveSeq: number): boolean {
  return moveSeq !== 0 && (moveSeq - seq + 255) % 255 < 128;
}

/** A point as the server's `parsePoint` takes it: clamped to the world, so both sides plan to the same place. */
export function clampToWorld(p: Vec2): Vec2 {
  return { x: Math.min(Math.max(p.x, 0), WORLD_W), y: Math.min(Math.max(p.y, 0), WORLD_H) };
}

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
  /** Where the walk in hand is going and the walls it was planned on, to plan it again after a snap. */
  private goal: Vec2 | null = null;
  private goalMap: GameMap | null = null;
  /** Samples in a row that were further than DIVERGE_ERR from the model. */
  private off = 0;
  /** The server moved the fighter on its own at this server time (a teleport, a revive): the sample that reaches it snaps. */
  private cutAt = Infinity;
  /** The last `displaceSeq` seen (null before the first sample). A different one in a sample is a displacement. */
  private lastDisplaceSeq: number | null = null;
  /** Blinks given up on (their order waited out JUMP_ORDER_EXPIRE_MS): their landing, to recognise a very late ack as our own. */
  private expiredJumps: Array<{ landing: Vec2; until: number }> = [];
  /** A lock is awaited until this client time (`expectLock`; 0 = not), and the walk to take up again if it never comes. */
  private hope = 0;
  private resume: { goal: Vec2; map: GameMap } | null = null;
  private readonly scratch: Vec2 = { x: 0, y: 0 };
  /** The model's slide while it is on ice (null: it walks its path exactly), and the model's own velocity over the last frame (u/s). */
  private slip: SlipState | null = null;
  private lvx = 0;
  private lvy = 0;
  /** The client time until which the slide's divergence rule still holds after the model left the ice. */
  private slidUntil = -Infinity;
  /** The traction lookup and the map of the last frame, kept for the places that start a slide between frames. */
  private slipAt: ((x: number, y: number) => number) | null = null;
  private frameMap: GameMap | null = null;

  get ready(): boolean { return this._ready; }
  get mode(): MotionMode { return this._mode; }
  /** The estimated time an order takes to take effect on the server (ms; smoothed over the acknowledged orders). */
  get delay(): number { return this._delay; }
  /** How far the drawn position is from the predicted one right now (u). */
  get visualOffset(): number { return Math.hypot(this.visual.x, this.visual.y); }
  /** Orders sent that the server has not yet applied. */
  get pendingOrders(): number { return this.orders.reduce((n, o) => n + (o.applied ? 0 : 1), 0); }
  /** A blink of ours the server has not answered yet (accepted or refused): its model is ahead of the server by the jump. */
  get pendingJump(): boolean { return this.orders.some((o) => !o.applied && o.jump !== undefined); }
  /** The model's own position (without the smoothing offset), for tools and tests. */
  get predicted(): Readonly<Vec2> { return this.sim; }
  /** Whether the model is walking a path this frame. */
  get walking(): boolean { return this.moved; }
  /** The model's slide velocity (u/s) while it is on ice, else null: the feet effects read it. */
  get slipVelocity(): Readonly<Vec2> | null { return this.slip ? { x: this.slip.vx, y: this.slip.vy } : null; }

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
    this.goal = null;
    this.goalMap = null;
    this.off = 0;
    this.cutAt = Infinity;
    this.lastDisplaceSeq = null;
    this.expiredJumps.length = 0;
    this.hope = 0;
    this.resume = null;
    this.slip = null;
    this.lvx = 0;
    this.lvy = 0;
    this.slidUntil = -Infinity;
    this.slipAt = null;
    this.frameMap = null;
  }

  /**
   * The player clicked a fighter and the client expects the server to take the lock (it is in reach, and not the one already
   * locked). The walk in hand stops being predicted at once (the server chases from the moment it applies the order);
   * whether it did is up to the next patches (see the header).
   */
  expectLock(c: number): void {
    if (!this.auth || !this._ready || this._mode === "follow") return;
    this.resume = this.goal && this.goalMap && this.path.length > 0 ? { goal: this.goal, map: this.goalMap } : null;
    this.enterFollow(c);
    this.hope = c + ORDER_EXPIRE_MS;
  }

  /**
   * The server is about to move or halt the fighter on its own (the teleport, a training revive): the walk in hand and the
   * orders in flight are void now, and the first sample from server time `t` on snaps instead of sliding.
   */
  cut(t: number): void {
    if (Number.isFinite(t)) this.cutAt = Math.min(this.cutAt, t);
    this.path = [];
    this.goal = null;
    this.moved = false;
    this.slip = null;
    this.lvx = 0;
    this.lvy = 0;
    this.orders.length = 0;
    this.expiredJumps.length = 0;
  }

  /**
   * The player gave an order, at client clock `c` (= the clock that stamps the patches). `seq` (1..255) is what the message
   * carries. A move to a point the shared pathfinder cannot reach changes nothing (the server ignores the point, though it
   * still counts the order and drops the lock). The point is clamped to the world first, as the server does. `map` is the
   * walls the server collides with: the gated map while the coliseum gates are locked. (A lock is not an order here: the
   * model follows the server's `attackTarget`, see `observe`.)
   */
  order(kind: OrderKind, seq: number, c: number, target: Vec2 | undefined, map: GameMap): void {
    if (!this.auth || !this._ready) return;
    this.expireOrders(c);
    this.hope = 0;
    this.resume = null;
    const to = target ? clampToWorld(target) : undefined;
    const origin = this._mode === "follow" ? this.lookahead(map) : this.sim;
    const path = kind === "move" && to ? findPath(map, origin, to, PLAYER_RADIUS) : [];
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
      // The server has been sliding on with the chase's velocity: the model carries it from the new origin.
      this.slip = this.slideFrom(origin.x, origin.y, map);
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
    this.goal = kind === "move" && to ? to : null;
    this.goalMap = map;
    this.note(seq, c, timing || wasFollow, { walk: kind === "move" && to ? { goal: to, map } : null });
  }

  /**
   * The player cast a blink (Blaze Step) at client clock `c`, with order number `seq` (`cast` carries it, as `move` does), and
   * the shared `blinkLanding` gave `landing`. The model jumps there at once and the drawn fighter with it; a walk in hand and a
   * lock stop being predicted (the cast is an order of its own: the server drops both). The order is remembered with its jump
   * so the rebase does not read the model's lead as a divergence until the server has applied it. A blink the server refuses
   * is echoed in `moveSeq` all the same (with no `displaceSeq` change): the rebase then finds the server where it was, and snaps.
   */
  blink(seq: number, c: number, landing: Vec2): void {
    if (!this.auth || !this._ready) return;
    this.expireOrders(c);
    this.hope = 0;
    // The walk this drops: the server keeps walking it if it refuses the cast (a lock it also keeps, and shows).
    const resume = this._mode === "predict" && this.goal && this.goalMap && this.path.length > 0 ? { goal: this.goal, map: this.goalMap } : null;
    this.resume = null;
    this._mode = "predict";
    const origin = { x: this.sim.x, y: this.sim.y };
    const h = this.history;
    // What was recorded in this clock's future never happened (the clock only runs back when it resynchronises).
    while (h.length > 0 && h[h.length - 1]!.c >= c) h.pop();
    h.push({ c, x: origin.x, y: origin.y });
    h.push({ c, x: landing.x, y: landing.y, jump: true });
    this.sim.x = landing.x;
    this.sim.y = landing.y;
    // The drawn fighter jumps with the model: no offset of an older correction rides along to the landing (it could be in rock).
    this.visual.x = 0;
    this.visual.y = 0;
    this.path = [];
    this.goal = null;
    this.moved = false;
    // The server's displace() clears the slide: a blink never carries one.
    this.slip = null;
    this.lvx = 0;
    this.lvy = 0;
    // The model is at its landing from `c` on: `simAt` must not carry a later time along the walk it just left.
    this.c = c;
    const by = { x: landing.x - origin.x, y: landing.y - origin.y };
    this.note(seq, c, true, { jump: Math.hypot(by.x, by.y), jumpBy: by, landing: { x: landing.x, y: landing.y }, resume });
  }

  /**
   * An order of ours that does not move the model (a cast with a telegraph) went out with order number `seq`: the server echoes
   * the number in `moveSeq` when it processes it, accepted or refused, which measures the delay like any order's and lets it
   * stand in the list so that the orders before it are acked with it.
   */
  noteOrder(seq: number, c: number): void {
    if (!this.auth || !this._ready) return;
    this.expireOrders(c);
    this.note(seq, c, false);
  }

  /**
   * A patch arrived: the local fighter's server state. Called once per patch, in arrival order; `c` is the client clock now.
   * The order it acknowledges (its `moveSeq`) gives the delay; in `predict` mode the sample then pulls the model back in line,
   * in `follow` mode it simply is the position. The server's lock (`locked`) is what puts the model in `follow` (once no
   * move or stop of ours is still on its way, which would end the lock) and takes it out again.
   */
  observe(s: AuthSample, c: number): void {
    const prev = this.auth;
    if (prev && s.t <= prev.t) return;
    if (!prev) {
      this.auth = { ...s };
      this.lastDisplaceSeq = s.displaceSeq ?? 0;
      this.snapTo(s);
      if (s.locked === true) this._mode = "follow";
      this._ready = true;
      return;
    }
    const wasFollow = this._mode === "follow";
    const oldFollow = wasFollow ? this.followPos(c, this.scratch) : null;
    const ox = oldFollow?.x ?? 0, oy = oldFollow?.y ?? 0;
    const dt = s.t - prev.t;
    // A displacement (a blink, a pull) moves the fighter in one tick: neither a teleport nor a speed.
    const displaced = s.displaceSeq !== undefined && s.displaceSeq !== this.lastDisplaceSeq;
    if (s.displaceSeq !== undefined) this.lastDisplaceSeq = s.displaceSeq;
    this.expireOrders(c);
    // A displacement is our own blink when an order of ours that blinks is acked with it (or one given up on is recognised by
    // its landing); a blink acked with NO displacement was refused (the server echoes a refused cast and does nothing else).
    let own = false;
    let refused: Order | null = null;
    if (displaced) own = this.ackedJump(s.moveSeq) !== null || this.expiredJumpAt(s);
    else refused = this.ackedJump(s.moveSeq);
    const jumped = !displaced && Math.hypot(s.x - prev.x, s.y - prev.y) > TELEPORT_DISTANCE;
    if (dt <= 200 && !displaced) {
      this.vx = ((s.x - prev.x) / dt) * 1000;
      this.vy = ((s.y - prev.y) / dt) * 1000;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    this.auth = { x: s.x, y: s.y, t: s.t, moveSeq: s.moveSeq };
    const cut = s.t >= this.cutAt;
    if (cut) this.cutAt = Infinity;
    if (jumped || cut || !this.alive) {
      // A jump is not a velocity: nothing slides on from it.
      this.snapTo(s, false, false);
      if (s.locked === true && this.alive) this._mode = "follow";
      return;
    }
    this.ack(s.moveSeq, s.t);
    if (refused) {
      this.settleRefused(s, refused);
      return;
    }
    if (displaced && !own) {
      // The server moved the fighter on its own: follow it, with no smoothing (a blink is not slid into).
      if (wasFollow) {
        this.snapTo(s);
        if (s.locked === true) this._mode = "follow";
      } else {
        this.shiftTo(s);
      }
      return;
    }
    const locked = s.locked === true;
    if (!wasFollow && locked && !this.orders.some((o) => !o.applied)) {
      this.enterFollow(c);
      return;
    }
    if (wasFollow) {
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
      if (locked) {
        this.hope = 0;
        this.resume = null;
      } else if (this._mode === "follow" && !(this.hope > 0 && c < this.hope)) {
        // The lock ended (its target fell, left reach, or an order of ours was applied), or the one expected never came.
        this.leaveFollow();
      }
    } else {
      this.rebase(s);
    }
  }

  /**
   * The server answered order `seq` on the tick stamped `t`: measures that order's delay and moves the estimate. Every order of
   * ours that `seq` covers (it, and the ones sent before it that the server skipped: two orders in one tick, only the last
   * applies) counts as applied, whether or not the list still holds the order named. A seq that covers nothing unapplied (0, a
   * repeated sample, a stranger's) is ignored. When the named order is gone (it waited out its expiry while an older blink
   * stalled), the delay is measured on the newest order the echo does cover.
   */
  ack(seq: number, t: number): void {
    if (seq === 0) return;
    const covered = this.orders.filter((q) => !q.applied && seqAcked(q.seq, seq));
    if (covered.length === 0) return;
    const o = covered.find((q) => q.seq === seq) ?? covered[covered.length - 1]!;
    o.delay = clamp(t - TICK_MS - o.c, DELAY_MIN_MS, DELAY_MAX_MS);
    this._delay = this.delayKnown ? this._delay + DELAY_EMA * (o.delay - this._delay) : o.delay;
    this.delayKnown = true;
    let timing = false;
    for (const q of covered) {
      timing = timing || q.timing;
      q.applied = true;
    }
    if (timing) this.align = o.delay;
  }

  /** The order sent with number `seq` is still waiting for the server's answer (an unknown or an answered one is not). */
  orderPending(seq: number): boolean {
    return this.orders.some((o) => o.seq === seq && !o.applied);
  }

  /** Once per frame, `c` the client clock (see order), `dtMs` the time since the last frame. */
  frame(c: number, dtMs: number, input: FrameInput): void {
    const auth = this.auth;
    if (!auth) return;
    const dt = clamp(dtMs, 0, MAX_FRAME_MS);
    this.expireOrders(c);
    this.aiming = input.aiming;
    this.alive = input.alive;
    this.slipAt = input.slipAt ?? null;
    this.frameMap = input.slipAt ? input.map ?? null : null;
    if (!input.alive) {
      this.snapTo(auth, false, false);
      this.c = c;
      this.record(c);
      this.draw();
      return;
    }
    const x0 = this.sim.x, y0 = this.sim.y;
    if (this._mode === "predict") {
      this.speed = PLAYER_SPEED * Math.max(0, input.speedMult) * (input.rooted ? 0 : 1);
      this.moved = false;
      const slipAt = this.slipAt;
      const map = this.frameMap ?? this.goalMap;
      // Off the ice the fighter grips again: the walk it slid off is planned again from here if its next leg is not clear.
      if (this.slip !== null && !(slipAt !== null && slipAt(this.sim.x, this.sim.y) > 0)) {
        this.slip = null;
        this.slidUntil = c + SLIP_GRACE_MS;
        if (map) this.path = regrip(map, this.sim, this.path);
      }
      if (slipAt !== null && map && dt > 0 && slipAt(this.sim.x, this.sim.y) > 0) {
        const slip = (this.slip ??= newSlip(this.sim.x, this.sim.y, this.lvx, this.lvy));
        // The clock only runs back when it resynchronises: a stuck slide's next plan is never further off than one interval.
        if (slip.replanAt > c + SLIP_REPLAN_MS) slip.replanAt = c;
        const r = slipWalk(map, this.sim, slip, this.path, dt, this.speed, slipAt, c, PLAYER_RADIUS);
        this.moved = r.moved > 1e-9;
      } else if (this.path.length > 0 && this.speed > 0 && dt > 0) {
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
    // What the model carries onto ice, if the next frame finds it there.
    if (dt > 0) {
      this.lvx = ((this.sim.x - x0) / dt) * 1000;
      this.lvy = ((this.sim.y - y0) / dt) * 1000;
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

  /** An order the server has not applied within ORDER_EXPIRE_MS is lost (a message sent while reconnecting): it must not hold the comparison off for good. */
  private expireOrders(c: number): void {
    const o = this.orders;
    const after = this.delayKnown
      ? Math.min(ORDER_EXPIRE_MS, Math.max(ORDER_EXPIRE_FLOOR_MS, 2 * Math.max(0, this._delay) + ORDER_EXPIRE_MARGIN_MS))
      : ORDER_EXPIRE_MS;
    // What was ordered after a blink still unanswered depends on it (its walk starts at the landing): it waits as long as the blink.
    const blinkAt = o.findIndex((q) => !q.applied && q.jump !== undefined);
    for (let i = o.length - 1; i >= 0; i--) {
      const q = o[i]!;
      if (q.applied) continue;
      const long = q.jump !== undefined || (blinkAt >= 0 && i > blinkAt);
      if (c - q.c <= (long ? JUMP_ORDER_EXPIRE_MS : after)) continue;
      if (q.landing) this.expiredJumps.push({ landing: q.landing, until: c + EXPIRED_JUMP_KEEP_MS });
      o.splice(i, 1);
    }
    for (let i = this.expiredJumps.length - 1; i >= 0; i--) if (c > this.expiredJumps[i]!.until) this.expiredJumps.splice(i, 1);
  }

  private note(seq: number, c: number, timing: boolean, extra?: Partial<Order>): void {
    this.orders.push({ seq, c, delay: null, applied: false, timing, ...extra });
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
    // Where the model would be drawn by now (a frame may have passed since it last walked): the drawn position runs on from there.
    const ahead = this.simAt(c);
    const was = { x: ahead?.x ?? this.sim.x, y: ahead?.y ?? this.sim.y };
    this._mode = "follow";
    this.path = [];
    this.goal = null;
    this.moved = false;
    // The server's chase is followed, not modelled: no slide of ours.
    this.slip = null;
    this.followPos(c, this.sim);
    this.visual.x += was.x - this.sim.x;
    this.visual.y += was.y - this.sim.y;
  }

  /**
   * The lock is over: the server stands where it is, and so does the model, with nothing to walk. But a lock that never came
   * (refused) left the walk it interrupted going on: that is planned again from the server's position.
   */
  private leaveFollow(): void {
    this._mode = "predict";
    this.path = [];
    this.goal = null;
    this.moved = false;
    // A lock that ends on ice leaves the server sliding to a stop with the chase's velocity, and the model slides with it.
    this.slip = this.slideFrom(this.sim.x, this.sim.y);
    const r = this.resume;
    this.hope = 0;
    this.resume = null;
    if (r) {
      const path = findPath(r.map, this.sim, r.goal, PLAYER_RADIUS);
      if (path.length > 0) {
        this.path = path;
        this.goal = r.goal;
        this.goalMap = r.map;
      }
    }
  }

  /** Where a walk ordered now begins when the server is chasing: where it will be when it applies the order, if that is clear ground. */
  private lookahead(map: GameMap): Vec2 {
    const ms = clamp(this._delay, 0, LOOKAHEAD_MAX_MS) / 1000;
    const ahead = { x: this.sim.x + this.vx * ms, y: this.sim.y + this.vy * ms };
    return ms > 0 && segmentClear(map, this.sim, ahead, PLAYER_RADIUS) ? ahead : { x: this.sim.x, y: this.sim.y };
  }

  /**
   * Sit where the server has the fighter and forget the orders in flight. A snap that reconciles a walk (`replan`) plans its
   * destination again from there and carries on; the others (a death, a teleport, the lobby) stand.
   */
  private snapTo(at: { x: number; y: number }, replan = false, carry = true): void {
    const goal = replan && this.path.length > 0 ? this.goal : null;
    const map = this.goalMap;
    this.sim.x = at.x;
    this.sim.y = at.y;
    this.visual.x = 0;
    this.visual.y = 0;
    this.path = [];
    this.goal = null;
    this._mode = "predict";
    this.moved = false;
    // The server is sliding where it stands if the sample says it moves on ice: the model takes the sample's velocity.
    this.slip = carry ? this.slideFrom(at.x, at.y) : null;
    if (!carry) {
      this.lvx = 0;
      this.lvy = 0;
    }
    this.hope = 0;
    this.resume = null;
    this.off = 0;
    this.history.length = 0;
    this.orders.length = 0;
    if (goal && map) {
      const path = findPath(map, this.sim, goal, PLAYER_RADIUS);
      if (path.length > 0) {
        this.path = path;
        this.goal = goal;
      }
    }
  }

  /** The first blink of ours not yet answered that the sample's `moveSeq` covers: it, or an order sent after it (only the last of a tick applies). */
  private ackedJump(moveSeq: number): Order | null {
    for (const o of this.orders) if (!o.applied && o.jump !== undefined && seqAcked(o.seq, moveSeq)) return o;
    return null;
  }

  /** A displacement that ends where a blink we gave up on would have landed: that blink, very late. */
  private expiredJumpAt(s: AuthSample): boolean {
    return this.expiredJumps.some((j) => Math.hypot(j.landing.x - s.x, j.landing.y - s.y) <= SNAP_DISTANCE);
  }

  /**
   * The server answered our blink with the echo alone: it refused it, and is where it was. The model snaps to it however short
   * the jump was, and orders sent after the blink stay in flight (their acks are still to come). What the server walks is what
   * the last order after the blink said (a move: planned again from the server's position, even if the model has walked its
   * own copy to the end; a stop: nothing), else the walk the blink dropped, which the server never stopped.
   */
  private settleRefused(s: AuthSample, blink: Order): void {
    const after = this.orders.slice(this.orders.indexOf(blink) + 1);
    const later = this.orders.filter((o) => !o.applied);
    this.snapTo(s, true);
    this.orders.push(...later);
    let walk = blink.resume;
    for (const q of after) if (q.walk !== undefined) walk = q.walk;
    if (!walk) return;
    const path = findPath(walk.map, this.sim, walk.goal, PLAYER_RADIUS);
    if (path.length > 0) {
      this.path = path;
      this.goal = walk.goal;
      this.goalMap = walk.map;
    }
  }

  /**
   * The server displaced the fighter by something other than our blink: the model, the history it is compared against and
   * so the drawn fighter (the smoothing offset is left alone) all move by what the sample says, with no snap test. A walk in
   * hand is planned again from there to its destination (dropped if that is unreachable).
   */
  private shiftTo(s: AuthSample): void {
    const at = s.t - this.align;
    const ref = this.simAt(at);
    if (!ref) {
      this.snapTo(s, true);
      return;
    }
    // A blink of ours the server has not applied yet already lies in the model at `at`: the sample is the server's position
    // BEFORE it, so what the model is compared with is the history without that jump, and the jump stays on top.
    let ex = s.x - ref.x;
    let ey = s.y - ref.y;
    for (const o of this.orders) {
      if (o.applied || !o.jumpBy || o.c > at) continue;
      ex += o.jumpBy.x;
      ey += o.jumpBy.y;
    }
    this.sim.x += ex;
    this.sim.y += ey;
    for (const p of this.history) {
      p.x += ex;
      p.y += ey;
    }
    this.off = 0;
    // The server's displace() cleared the slide: it starts again from rest.
    this.slip = null;
    this.lvx = 0;
    this.lvy = 0;
    const goal = this.path.length > 0 ? this.goal : null;
    this.path = [];
    this.goal = null;
    this.moved = false;
    if (goal && this.goalMap) {
      const path = findPath(this.goalMap, this.sim, goal, PLAYER_RADIUS);
      if (path.length > 0) {
        this.path = path;
        this.goal = goal;
      }
    }
  }

  /**
   * A slide that starts at (x, y) with the server's sampled velocity, when that is slippery ground, the server is moving and the
   * model has a map to collide with; else null. The model's own last-frame velocity becomes the sample's too, so a slide that
   * starts on the next frame carries the same.
   */
  private slideFrom(x: number, y: number, map: GameMap | null = this.frameMap ?? this.goalMap): SlipState | null {
    this.lvx = this.vx;
    this.lvy = this.vy;
    const at = this.slipAt;
    return at !== null && map !== null && (this.vx !== 0 || this.vy !== 0) && at(x, y) > 0 ? newSlip(x, y, this.vx, this.vy) : null;
  }

  /** The model at client time `t`: from the history, or carried on along the path for a time not yet reached (a negative delay). */
  private simAt(t: number): Vec2 | null {
    const h = this.history;
    if (t >= this.c) {
      if (this.slip) {
        // A slide is carried on straight by its velocity (only a negative delay and enterFollow's look-ahead ask).
        this.scratch.x = this.sim.x + (this.slip.vx * (t - this.c)) / 1000;
        this.scratch.y = this.sim.y + (this.slip.vy * (t - this.c)) / 1000;
        return this.scratch;
      }
      walkAlong(this.sim, this.path, (this.speed * (t - this.c)) / 1000, this.scratch);
      return this.scratch;
    }
    if (h.length === 0 || t < h[0]!.c) return null;
    let i = h.length - 1;
    while (i > 0 && h[i - 1]!.c > t) i--;
    const b = h[i]!;
    const a = h[Math.max(0, i - 1)]!;
    // A blink's landing is a jump: the model was at the pose before it until then, never between.
    const k = b.jump === true ? 0 : b.c > a.c ? clamp((t - a.c) / (b.c - a.c), 0, 1) : 1;
    this.scratch.x = a.x + (b.x - a.x) * k;
    this.scratch.y = a.y + (b.y - a.y) * k;
    return this.scratch;
  }

  private rebase(s: AuthSample): void {
    const at = s.t - this.align;
    const next = this.orders.find((o) => !o.applied);
    const ref = this.simAt(at);
    if (!ref) return;
    const ex = s.x - ref.x;
    const ey = s.y - ref.y;
    const err = Math.hypot(ex, ey);
    // The model at `at` already follows an order the server has not applied: it says little about where the server is, but a
    // gap beyond what that order's walk can explain is a divergence all the same.
    if (next && at >= next.c) {
      // A blink not applied yet has put the model that much ahead of the server.
      let jumps = 0;
      for (const o of this.orders) if (!o.applied && o.jump !== undefined && o.c <= at) jumps += o.jump;
      if (err > SNAP_DISTANCE + (PLAYER_SPEED * (at - next.c)) / 1000 + jumps) this.snapTo(s, true);
      return;
    }
    this.noteDivergence(err);
    const still = !this.moved && this.path.length === 0 && Math.hypot(this.vx, this.vy) < 5;
    if (err <= (still ? REST_DEADZONE : REBASE_DEADZONE)) return;
    if (err > SNAP_DISTANCE) {
      this.snapTo(s, true);
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
    // Corrections keep adding up faster than they run out: not smoothing any more.
    if (this.visualOffset > VISUAL_SNAP_DISTANCE) this.snapTo(s, true);
  }

  /**
   * Counts samples in a row that are off by more than DIVERGE_ERR. Enough of them, with the server not heading where the model
   * walks (standing still, or another way), mean the model is walking a path the server is not on: it is dropped, and the
   * model stands (and is pulled to the samples) instead of running away from them.
   */
  private noteDivergence(err: number): void {
    // On ice, and just after: two near-identical paths stay several units apart for longer than a few patches.
    const icy = this.slip !== null || this.c < this.slidUntil;
    this.off = err > (icy ? DIVERGE_ERR_SLIP : DIVERGE_ERR) ? this.off + 1 : 0;
    if (this.off < DIVERGE_PATCHES || this.path.length === 0) return;
    const speed = Math.hypot(this.vx, this.vy);
    const heading = (hx: number, hy: number): number => {
      const h = Math.hypot(hx, hy);
      return speed > 5 && h > 1e-6 ? (this.vx * hx + this.vy * hy) / (speed * h) : -1;
    };
    const t = this.path[0]!;
    let along = heading(t.x - this.sim.x, t.y - this.sim.y);
    // A sliding model goes where its velocity says, which a fresh turn has not yet pointed at the next waypoint.
    if (this.slip) along = Math.max(along, heading(this.slip.vx, this.slip.vy));
    if (along > 0.7) return;
    this.path = [];
    this.goal = null;
    this.moved = false;
    this.off = 0;
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
    while (h.length > 0 && h[h.length - 1]!.c >= c) {
      const last = h[h.length - 1]!;
      // A blink in this very instant: its landing is where the model is now (and stays the jump).
      if (last.jump === true && last.c === c) {
        last.x = this.sim.x;
        last.y = this.sim.y;
        return;
      }
      h.pop();
    }
    h.push({ c, x: this.sim.x, y: this.sim.y });
    while (h.length > 2 && h[0]!.c < c - HISTORY_MS) h.shift();
  }

  private draw(): void {
    this.drawn.x = this.sim.x + this.visual.x;
    this.drawn.y = this.sim.y + this.visual.y;
  }
}
