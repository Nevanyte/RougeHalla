// Draw-ahead of remote fighters (docs/PLAYER_PREDICTION.md Stage 2). Presentation only: nothing here is sent, and the server's
// rewind and outcomes are untouched. Pure (no Phaser), so the probe and the trace replay run it headless (bench/netProbe.ts).
//
// With the setting on, the render clock's delay drops by EXTRAPOLATE_MS (net/interpolation.ts setDrawAhead) and render time may run
// up to that far past a fighter's newest sample. A remote PLAYER is drawn past it only while the server's walk hint
// (PlayerExtraState.walkTicks >= 1, from the same patch as that sample) says it keeps walking: along walkDir, at the speed its last
// two samples show (that captures chill, terrain and buffs without recomputing a mirror), for at most
// min(EXTRAPOLATE_MS, walkTicks x TICK_MS, REMOTE_MAX_AHEAD_U of walk), clipped at walls, and never into a root the fx told of
// (a windup, a cast, a stun or root status), a death or a cut. With no hint it holds the newest sample, as before. A MOB has no hint:
// one that is moving walks on at its newest step's velocity for at most MOB_EXTRAPOLATE_MS. Players, mobs, projectiles and fx share
// the one render time.
//
// Corrections: where the drawn picture must change because a new sample, a new hint or a root arrived, the difference between what
// was drawn and the new target goes into a per-fighter offset that decays over render time, speed-capped, toward the truth and never
// past it (the net/localMotion.ts pattern). An offset that would carry the figure into a wall slides it on from where it was last
// drawn, as a body would. It is reset only by a cut (a teleport or displaceSeq change: a cut never slides) or a snap past
// REMOTE_SNAP_DISTANCE; anything else that drops one is a visible jump, counted in stats.resetsUnderSnap.
//
// Attacks: with this on, render time runs up to EXTRAPOLATE_MS later, but an attack's `t` is the render time the setting off would
// keep (attackTime; owner decision 5), so melee and a shot's origin rewind as before and a target drawn ahead may be up to one
// tick's walk past the spot the server tests.
import {
  circleClear, clearRun, decodeWalkDir, EFFECT_CASTING, EFFECT_ROOTED, EFFECT_STUNNED, EXTRAPOLATE_MS, isRanged, MIN_INTERP_DELAY_MS,
  MOB_EXTRAPOLATE_MS, PLAYER_RADIUS, PLAYER_SPEED, RANGED_RELEASE_PAUSE_MS, TICK_MS, type GameMap, type NewestWalk, type TimedFx,
  type Vec2,
} from "@raid/shared";
import type { EntityInterpolator } from "./interpolation";

/** An offset past this snaps (Kenny et al. rated snaps no worse than blends; localMotion snaps a little further). */
export const REMOTE_SNAP_DISTANCE = 32;
/** The offset decays toward 0 with this time constant (ms of render time)... */
export const REMOTE_VISUAL_TAU_MS = 50;
/** ...no faster than this (u/s) while the fighter walks (+2 per unit past 20, at most 150)... */
export const REMOTE_CORRECT_SPEED_MOVING = 120;
/** ...or while it stands (+3 per unit past 10, at most 1.5 x PLAYER_SPEED): small slides stay under the figure's walk start. */
export const REMOTE_CORRECT_SPEED_REST = 44;
/** A fighter drawn behind its walk catches up at up to this share of its walk speed on top of it (a held mover's lag). */
export const CATCHUP_SHARE = 1.0;
/** A fighter drawn ahead of its walk is pulled back at most this share of its walk speed: it slows, never turns round. */
export const AHEAD_SHARE = 0.9;
/** The most a fighter is drawn past its newest sample (u): one tick's walk. It bounds a stop's overshoot and halves a reversal's. */
export const REMOTE_MAX_AHEAD_U = (PLAYER_SPEED * EXTRAPOLATE_MS) / 1000;

const MIN_WALK_SPEED = 5;
const MAX_WALK_SPEED = 2.5 * PLAYER_SPEED;
/** The wall clip's body: a hair under the real one, so a float32 position next to a wall is not taken for one inside it. */
const CLIP_RADIUS = PLAYER_RADIUS - 1;
/** Turning the setting off keeps drawing ahead until the delay is back at the floor, or this long (ms of render time) at most... */
const DRAIN_MAX_MS = 1000;
/** ...and until every drawn offset has decayed under this (u), so ending it drops nothing visible; past DRAIN_HARD_MS it ends anyway. */
const DRAIN_OFFSET_U = 0.5;
const DRAIN_HARD_MS = 3000;
/** An offset cut by more than this (u) other than by its decay, a cut or a snap is counted in stats.resetsUnderSnap. */
const RESET_EPS_U = 0.5;
/** Steps (u) by which the slide's body shrinks while the last drawn spot already overlaps a wall (a lerp cutting a corner). */
const SLIDE_SHRINK_U = 3;
const MAX_WINDOWS = 8;

/** What draw() reads of a fighter's synced state (PlayerState and MobState both fit). */
export interface RemoteFighter { x: number; y: number; status: string; effects: number; drawStartedAt?: number }

export interface RemoteDrawOptions {
  /** How far past its newest sample a remote player with a walk hint may be drawn (ms). */
  extrapolateMs: number;
  /** ...and a moving mob (ms). */
  mobExtrapolateMs: number;
  /**
   * Measurement only (the owner's alternative to holding): a player that moves with no walk hint walks on at its newest step's
   * velocity for this long (ms). 0, the default, holds it.
   */
  heldMoverMs: number;
  maxAheadU: number;
  snapDistance: number;
  tauMs: number;
}

export const REMOTE_DRAW_DEFAULTS: Readonly<RemoteDrawOptions> = Object.freeze({
  extrapolateMs: EXTRAPOLATE_MS,
  mobExtrapolateMs: MOB_EXTRAPOLATE_MS,
  heldMoverMs: 0,
  maxAheadU: REMOTE_MAX_AHEAD_U,
  snapDistance: REMOTE_SNAP_DISTANCE,
  tauMs: REMOTE_VISUAL_TAU_MS,
});

export interface RemoteDrawStats {
  /** Offsets past snapDistance that snapped (a cut is not counted). */
  snaps: number;
  /**
   * Offsets cut by more than RESET_EPS_U with neither a cut nor a snap: a wall clip with no clear spot to slide from, or the drain
   * ending with an offset still drawn. Each is a visible jump under the snap distance; the gates want none.
   */
  resetsUnderSnap: number;
  /** Cuts render time crossed (each snaps the offset to 0). */
  cutsCrossed: number;
  /** Absorbed changes that turned the offset's direction around (a stop then a start, a strafe tap). */
  reversals: number;
  /** Changes of what the fighter is drawn toward that went into the offset. */
  discontinuities: number;
  /** Frames that held a fighter still at a pending cut. */
  frozenFrames: number;
  /** The largest one-frame correction step (u). */
  maxCorrStep: number;
}

/** What the last draw() of a fighter did, for the probe. */
export interface RemoteDrawInfo {
  /** The server time the drawn position claims to show: min(render time, newest sample + cap). */
  tDrawn: number;
  newestT: number;
  /** How far past the newest sample this frame drew (ms), and how far it was allowed to. */
  aheadMs: number;
  budgetMs: number;
  /** The newest step moves (over MIN_WALK_SPEED), and it was not drawn ahead. */
  moving: boolean;
  held: boolean;
  /** The offset's length after this frame, the correction this frame made (u), and whether it snapped. */
  offset: number;
  corrStep: number;
  snapped: boolean;
}

interface Model { t0: number; x0: number; y0: number; vx: number; vy: number; budget: number }
interface Reach { t: number; dx: number; dy: number; speed: number; reach: number }
interface Window { from: number; until: number; kind: "windup" | "cast" | "status" | "death" }
interface Fighter {
  offX: number; offY: number; model: Model | null; seenCutT: number; reach: Reach | null; info: RemoteDrawInfo;
  /** Where it was drawn last, and in which frame (0: never). */
  lastX: number; lastY: number; frame: number;
}

const freshInfo = (): RemoteDrawInfo => ({ tDrawn: 0, newestT: 0, aheadMs: 0, budgetMs: 0, moving: false, held: false, offset: 0, corrStep: 0, snapped: false });

export class RemoteDraw {
  readonly options: RemoteDrawOptions;
  readonly stats: RemoteDrawStats = { snaps: 0, resetsUnderSnap: 0, cutsCrossed: 0, reversals: 0, discontinuities: 0, frozenFrames: 0, maxCorrStep: 0 };
  private on = false;
  private draining = false;
  private drainFrom = 0;
  private map: GameMap | null = null;
  private lastRenderT = Number.NaN;
  private dtMs = 0;
  private frameNo = 0;
  private readonly fighters = new Map<string, Fighter>();
  private readonly windows = new Map<string, Window[]>();
  private readonly walk: NewestWalk = { t: 0, x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
  private readonly base = { x: 0, y: 0 };
  private readonly probe = { x: 0, y: 0 };
  private readonly slid = { x: 0, y: 0 };

  constructor(private readonly interp: EntityInterpolator, options: Partial<RemoteDrawOptions> = {}) {
    this.options = { ...REMOTE_DRAW_DEFAULTS, ...options };
  }

  get enabled(): boolean { return this.on; }

  /** Render time may still run past the newest sample: on, or turned off and still draining. */
  get drawsAhead(): boolean { return this.on || this.draining; }

  /**
   * On: the delay drops by EXTRAPOLATE_MS and fighters are drawn ahead. Off: the delay slews back and fighters keep being drawn
   * ahead until it is there (render time would otherwise run past their newest sample for that while and freeze them), then this
   * is exactly sample().
   */
  setEnabled(on: boolean): void {
    this.interp.setDrawAhead(on);
    if (on) {
      // Back on while draining: the offsets still drawn carry on (clearing them would jump every figure that has one).
      if (!this.on && !this.draining) this.fighters.clear();
      this.on = true;
      this.draining = false;
    } else if (this.on) {
      this.on = false;
      this.draining = true;
      this.drainFrom = this.lastRenderT;
    }
  }

  /** Once a frame, before draw(): the walls to clip at (with the gates when they are shut) and this frame's render time. */
  beginFrame(map: GameMap | null, renderT: number): void {
    this.dtMs = Number.isFinite(this.lastRenderT) ? Math.min(250, Math.max(0, renderT - this.lastRenderT)) : 0;
    this.lastRenderT = renderT;
    this.frameNo++;
    if (map !== this.map) {
      this.map = map;
      for (const f of this.fighters.values()) f.reach = null;
    }
    if (this.draining) {
      if (!Number.isFinite(this.drainFrom)) this.drainFrom = renderT;
      const spent = renderT - this.drainFrom;
      if (this.interp.delayMs >= MIN_INTERP_DELAY_MS - 0.5 || spent >= DRAIN_MAX_MS) {
        // Only a figure drawn last frame can show a jump: one out of sight keeps an offset that nothing decays.
        let left = 0;
        for (const f of this.fighters.values()) if (f.frame === this.frameNo - 1 && Math.hypot(f.offX, f.offY) > DRAIN_OFFSET_U) left++;
        if (left === 0 || spent >= DRAIN_HARD_MS) {
          this.stats.resetsUnderSnap += left;
          this.draining = false;
          this.fighters.clear();
        }
      }
    }
  }

  /** Every fx at its arrival (a root in the newest batch matters before render time reaches it). */
  noteFx(fx: TimedFx): void {
    switch (fx.kind) {
      case "windup": {
        const from = fx.t + (isRanged(fx.weapon) ? Math.max(0, fx.ms - RANGED_RELEASE_PAUSE_MS) : 0);
        this.addWindow(fx.by, { from, until: fx.t + fx.ms, kind: "windup" });
        break;
      }
      case "cast":
        if (fx.ms > 0) this.addWindow(fx.by, { from: fx.t, until: fx.t + fx.ms, kind: "cast" });
        break;
      case "castEnd":
        this.dropWindows(fx.by, "cast");
        break;
      case "status":
        if (fx.status === "stun" || fx.status === "root") this.addWindow(fx.id, { from: fx.t, until: fx.t + fx.ms, kind: "status" });
        break;
      case "cancel":
      case "stagger":
        this.dropWindows(fx.id, "windup");
        break;
      case "death":
        this.addWindow(fx.id, { from: fx.t, until: Infinity, kind: "death" });
        break;
      default:
        break;
    }
  }

  /**
   * Where to draw fighter `id` at render time `t` into `out`: the draw-ahead's position, or with it off (and drained), exactly
   * `interp.sample`. False when there is no data for it.
   */
  draw(id: string, kind: "player" | "mob", f: RemoteFighter, t: number, out: { x: number; y: number }): boolean {
    if (!this.on && !this.draining) {
      if (this.fighters.size > 0) this.fighters.delete(id);
      return this.interp.sample(id, t, out);
    }
    const buf = this.interp.buffer(id);
    const newest = buf?.latest;
    if (!buf || !newest) return false;
    const o = this.options;
    const w = this.walk;
    const ok = buf.walk(w);
    const cap = kind === "player" ? o.extrapolateMs : o.mobExtrapolateMs;
    this.dropRevived(id, f, newest.t);

    let budget = 0;
    let dirX = 0;
    let dirY = 0;
    let speed = 0;
    const stepSpeed = ok ? Math.hypot(w.vx, w.vy) : 0;
    if (kind === "player") {
      const h = this.interp.hintOf(id);
      if (ok && h && h.t === w.t && h.ticks >= 1) {
        budget = Math.min(o.extrapolateMs, h.ticks * TICK_MS);
        const a = decodeWalkDir(h.dir);
        dirX = Math.cos(a);
        dirY = Math.sin(a);
        speed = w.speed;
      } else if (o.heldMoverMs > 0 && stepSpeed > MIN_WALK_SPEED) {
        budget = Math.min(o.heldMoverMs, cap);
        dirX = w.vx / stepSpeed;
        dirY = w.vy / stepSpeed;
        speed = stepSpeed;
      }
    } else if (stepSpeed > MIN_WALK_SPEED) {
      budget = o.mobExtrapolateMs;
      dirX = w.vx / stepSpeed;
      dirY = w.vy / stepSpeed;
      speed = stepSpeed;
    }
    if (speed < MIN_WALK_SPEED || speed > MAX_WALK_SPEED || f.status !== "alive" || (f.effects & (EFFECT_STUNNED | EFFECT_ROOTED | EFFECT_CASTING)) !== 0
      || this.interp.cutPending || buf.lastCutT > t || (kind === "mob" && (f.drawStartedAt ?? 0) !== 0)) budget = 0;
    if (budget > 0) budget = Math.min(budget, Math.max(0, this.stopAt(id, w.t) - w.t), (o.maxAheadU * 1000) / speed);

    let st = this.fighters.get(id);
    if (!st) {
      st = { offX: 0, offY: 0, model: null, seenCutT: buf.lastCutT, reach: null, info: freshInfo(), lastX: 0, lastY: 0, frame: 0 };
      this.fighters.set(id, st);
    }
    if (budget > 0) {
      if (!this.map) budget = 0;
      else {
        let r = st.reach;
        if (!r || r.t !== w.t || r.dx !== dirX || r.dy !== dirY || r.speed !== speed) {
          r = { t: w.t, dx: dirX, dy: dirY, speed, reach: clearRun(this.map, w, dirX, dirY, (speed * cap) / 1000, CLIP_RADIUS) };
          st.reach = r;
        }
        budget = Math.min(budget, (r.reach * 1000) / speed);
      }
    }

    const base = this.base;
    const ahead = buf.sampleAhead(t, base, budget, dirX, dirY, speed);
    if (ahead < 0) return false;
    const model: Model = { t0: newest.t, x0: newest.x, y0: newest.y, vx: dirX * speed, vy: dirY * speed, budget };

    let corr = 0;
    let snapped = false;
    let frozen = false;
    if (st.frame !== 0 && st.frame !== this.frameNo - 1) {
      // Not drawn last frame (out of the caller's range): there is no figure on screen to keep continuous, so nothing carries over.
      st.offX = 0;
      st.offY = 0;
      st.model = null;
    }
    if (buf.lastCutT > st.seenCutT && t >= buf.lastCutT) {
      // A cut is drawn where it lands, never slid into.
      st.offX = 0;
      st.offY = 0;
      st.seenCutT = buf.lastCutT;
      this.stats.cutsCrossed++;
    } else {
      const m = st.model;
      if (m && t > m.t0 && (m.t0 !== model.t0 || m.budget !== model.budget || m.vx !== model.vx || m.vy !== model.vy)) {
        // What is drawn stays where it was: the change goes into the offset.
        const e = Math.min(t - m.t0, m.budget) / 1000;
        const dx = m.x0 + m.vx * e - base.x;
        const dy = m.y0 + m.vy * e - base.y;
        if (Math.hypot(st.offX, st.offY) > 0.5 && st.offX * (st.offX + dx) + st.offY * (st.offY + dy) < 0) this.stats.reversals++;
        st.offX += dx;
        st.offY += dy;
        if (dx !== 0 || dy !== 0) this.stats.discontinuities++;
      }
      if (buf.lastCutT > t || this.interp.cutPending) {
        // Stand where it was drawn until render time reaches the cut (not even the walls move it: the teleport's patch shuts the
        // coliseum gates, and the spot it stands on may be one).
        this.stats.frozenFrames++;
        frozen = true;
      } else {
        const mag = Math.hypot(st.offX, st.offY);
        if (mag > o.snapDistance) {
          st.offX = 0;
          st.offY = 0;
          this.stats.snaps++;
          snapped = true;
          corr = mag;
        } else if (mag < 1e-4) {
          st.offX = 0;
          st.offY = 0;
        } else {
          const capSpeed = correctionCap(mag, st.offX, st.offY, ok ? w.vx : 0, ok ? w.vy : 0);
          const dec = Math.min(mag, mag * (1 - Math.exp(-this.dtMs / o.tauMs)), (capSpeed * this.dtMs) / 1000);
          const k = (mag - dec) / mag;
          st.offX *= k;
          st.offY *= k;
          corr = dec;
        }
      }
    }
    st.model = model;
    // The offset may not carry the fighter into a wall (rounding a corner, it still points back along the old leg): from where it was
    // last drawn the figure moves toward its target as far as it would have moved this frame, sliding along the wall as a body would
    // round the corner, and the offset becomes what that leaves, so nothing jumps and it keeps closing. Only with nowhere clear to
    // slide from is the offset cut at the wall: a reset the gates count.
    if (this.map && !frozen && (st.offX !== 0 || st.offY !== 0)) {
      const p = this.probe;
      p.x = base.x + st.offX;
      p.y = base.y + st.offY;
      if (!circleClear(this.map, p, CLIP_RADIUS)) {
        const q = this.slid;
        const left = Math.hypot(base.x - st.lastX, base.y - st.lastY);
        const k = left > 1e-9 ? Math.min(1, Math.hypot(p.x - st.lastX, p.y - st.lastY) / left) : 0;
        if (st.frame === this.frameNo - 1
          && slideFrom(this.map, st.lastX, st.lastY, st.lastX + (base.x - st.lastX) * k, st.lastY + (base.y - st.lastY) * k, base, q)) {
          st.offX = q.x - base.x;
          st.offY = q.y - base.y;
        } else {
          const mag = Math.hypot(st.offX, st.offY);
          const ux = st.offX / mag;
          const uy = st.offY / mag;
          const run = clearRun(this.map, base, ux, uy, mag, CLIP_RADIUS);
          if (mag - run > RESET_EPS_U) this.stats.resetsUnderSnap++;
          st.offX = ux * run;
          st.offY = uy * run;
        }
      }
    }
    out.x = base.x + st.offX;
    out.y = base.y + st.offY;
    st.lastX = out.x;
    st.lastY = out.y;
    st.frame = this.frameNo;

    if (corr > this.stats.maxCorrStep) this.stats.maxCorrStep = corr;
    const info = st.info;
    info.tDrawn = Math.min(t, newest.t + cap);
    info.newestT = newest.t;
    info.aheadMs = ahead;
    info.budgetMs = budget;
    info.moving = stepSpeed > MIN_WALK_SPEED;
    info.held = info.moving && budget === 0;
    info.offset = Math.hypot(st.offX, st.offY);
    info.corrStep = corr;
    info.snapped = snapped;
    return true;
  }

  /**
   * The `t` an attack sends at render time `renderT`: the render time the clock would keep with the setting off (owner decision 5,
   * docs/PLAYER_PREDICTION.md), so melee and a shot's origin rewind exactly as far as before. That is EXTRAPOLATE_MS earlier, less
   * whatever the delay's ceiling took back; while draining, the delay asked (the setting off's) instead of the one still slewing to
   * it. Off and drained, or on the legacy clock, it is `renderT`.
   */
  attackTime(renderT: number): number {
    const i = this.interp;
    let lead = 0;
    if (i.aheadMs > 0) lead = Math.min(i.aheadMs, Math.max(0, i.maxDelayMs - i.delayMs));
    else if (this.draining) lead = Math.min(EXTRAPOLATE_MS, Math.max(0, i.targetDelayMs - i.delayMs));
    return renderT - lead;
  }

  /** The draw-ahead's own position at time `t` without the correction offset (projectile homing aims there), else sample(). */
  modelAt(id: string, t: number, out: { x: number; y: number }): boolean {
    const m = this.on || this.draining ? this.fighters.get(id)?.model : undefined;
    if (!m || t <= m.t0) return this.interp.sample(id, t, out);
    const e = Math.min(t - m.t0, m.budget) / 1000;
    out.x = m.x0 + m.vx * e;
    out.y = m.y0 + m.vy * e;
    return true;
  }

  /** What the last draw() of `id` did, if it drew it ahead. */
  lastOf(id: string): Readonly<RemoteDrawInfo> | undefined {
    return this.fighters.get(id)?.info;
  }

  forget(id: string): void {
    this.fighters.delete(id);
    this.windows.delete(id);
  }

  reset(): void {
    this.fighters.clear();
    this.windows.clear();
    this.lastRenderT = Number.NaN;
    this.dtMs = 0;
  }

  /** The earliest time at or after `t0` the fx say the fighter is held (Infinity: none known). */
  private stopAt(id: string, t0: number): number {
    const list = this.windows.get(id);
    if (!list) return Infinity;
    let at = Infinity;
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i]!;
      if (w.until < t0 - 1000) { list.splice(i, 1); continue; }
      if (w.until > t0 && w.from < w.until) at = Math.min(at, Math.max(w.from, t0));
    }
    return at;
  }

  private addWindow(id: string, w: Window): void {
    let list = this.windows.get(id);
    if (!list) { list = []; this.windows.set(id, list); }
    list.push(w);
    if (list.length > MAX_WINDOWS) list.shift();
  }

  private dropWindows(id: string, kind: Window["kind"]): void {
    const list = this.windows.get(id);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.kind === kind) list.splice(i, 1);
  }

  /** A death the newest patch contradicts (a training revive, in the same tick) holds nobody. */
  private dropRevived(id: string, f: RemoteFighter, newestT: number): void {
    const list = this.windows.get(id);
    if (!list || f.status !== "alive") return;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.kind === "death" && list[i]!.from <= newestT) list.splice(i, 1);
  }
}

/**
 * Moves a disc from (x0, y0) toward (x1, y1), a step on the way to `goal`, as a body would, into `out`: straight while clear, then the
 * rest along x and then y, so it slides along a wall instead of stopping dead at a corner. Its radius is CLIP_RADIUS, shrunk in
 * SLIDE_SHRINK_U steps while the start or the goal overlaps a wall (the lerp of two tick positions can cut a corner by a unit or two),
 * so it never ends deeper in a wall than the deeper of the two and can always reach the goal. False when even a point there is in one.
 */
function slideFrom(map: GameMap, x0: number, y0: number, x1: number, y1: number, goal: Vec2, out: { x: number; y: number }): boolean {
  const a: Vec2 = { x: x0, y: y0 };
  let r = CLIP_RADIUS;
  while (r > 0 && !(circleClear(map, a, r) && circleClear(map, goal, r))) r = Math.max(0, r - SLIDE_SHRINK_U);
  if (!circleClear(map, a, r)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len > 1e-9) {
    const run = clearRun(map, a, dx / len, dy / len, len, r);
    a.x += (dx / len) * run;
    a.y += (dy / len) * run;
    const rx = x1 - a.x;
    if (Math.abs(rx) > 1e-6) a.x += Math.sign(rx) * clearRun(map, a, Math.sign(rx), 0, Math.abs(rx), r);
    const ry = y1 - a.y;
    if (Math.abs(ry) > 1e-6) a.y += Math.sign(ry) * clearRun(map, a, 0, Math.sign(ry), Math.abs(ry), r);
  }
  out.x = a.x;
  out.y = a.y;
  return true;
}

/**
 * How fast (u/s) an offset of `mag` along (offX, offY) may shrink, given the fighter's newest step (vx, vy). At rest the slow caps
 * keep a small slide under the figure's walk start. Drawn behind a walk it may catch up at its walk speed on top (a held mover's lag
 * is speed x the time held), and drawn ahead or to the side the pull back is under the walk speed, so it slows and never turns round.
 */
export function correctionCap(mag: number, offX: number, offY: number, vx: number, vy: number): number {
  const s = Math.hypot(vx, vy);
  if (s <= MIN_WALK_SPEED) return Math.min(1.5 * PLAYER_SPEED, REMOTE_CORRECT_SPEED_REST + 3 * Math.max(0, mag - 10));
  const moving = Math.min(150, REMOTE_CORRECT_SPEED_MOVING + 2 * Math.max(0, mag - 20));
  return offX * vx + offY * vy < 0 ? Math.max(moving, CATCHUP_SHARE * s) : Math.min(moving, AHEAD_SHARE * s);
}
