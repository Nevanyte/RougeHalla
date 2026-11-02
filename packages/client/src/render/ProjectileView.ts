// Arrows and wand balls. The server announces each one once, when it is loosed (in the `fxs` batch of that step; the
// state has none), and never updates it. Directional shots fly straight from the launch; target-locked shots follow the
// target samples available to that client. A client that joins or reconnects while some fly is sent them as a batch of
// their own. When a shot stops a `projEnd` fx says where and why. That fx is played at render time, so it is kept
// (flying, then pinned at its stop point) until FxView reports the fx due, and only then removed. One that was
// reflected, deleted or destroyed does not stay pinned: something else carries on from there (see VANISHES).
import Phaser from "phaser";
import { WEAPONS, type ProjectileEnd, type ProjectileKind, type ProjectileLaunch, type TimedFx, type Vec2 } from "@raid/shared";
import { BODY_LIFT, depthFor, projX, projY, screenAngle } from "./projection";

export type ProjEndFx = Extract<TimedFx, { kind: "projEnd" }>;

const ARROW_COLOR = 0xeceff1;
const BALL_COLOR = WEAPONS.wand.color;
/** A projectile that stopped within this of where it started has no flight to draw. */
const MIN_FLIGHT = 2;
/** Past its range with no projEnd: the fx was lost, so drop it after this much more travel (u). */
const RANGE_SLACK = 40;
/** Past the reported stop time with its fx still not played (dropped as stale): drop it after this long (ms). */
const END_GRACE_MS = 1000;
/** A local preview the server never confirms is presentation only and must not linger indefinitely. */
const LOCAL_PREVIEW_MAX_MS = 1500;
/**
 * Stops that end the projectile outright rather than leave it stuck in something: a reflected arrow is replaced by a new
 * one already flying from the same point, a deleted or destroyed ball is gone. It is hidden on reaching its end point.
 */
const VANISHES: ReadonlySet<ProjectileEnd> = new Set<ProjectileEnd>(["reflected", "deleted", "destroyed"]);
/** How many finished ids are remembered (see `done`). */
const DONE_MAX = 256;

interface Tracked {
  id: string;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  range: number;
  targetId?: string;
  ownerId?: string;
  /** Local tracks use the present client clock; server-clock render delay must not make the owner's shot appear late. */
  localClock?: boolean;
  /** True until a server launch claims a predicted shot. */
  preview?: boolean;
  /** Server time corresponding to `t` on a local-clock track. */
  serverT?: number;
  /** Cached homing replay state. It is reset if render time moves backwards. */
  simT: number;
  flightX: number;
  flightY: number;
  flightVx: number;
  flightVy: number;
  traveled: number;
  /** Where, when (server time) and why the stop was reported; set when its projEnd arrives, before it is due. */
  end: { x: number; y: number; t: number; reason: ProjectileEnd } | null;
  g: Phaser.GameObjects.Graphics | null;
}

/** Resolve a visible target at the client's delayed render time; false means no safe sample is available. */
export type ProjectileTargetAt = (targetId: string, renderT: number, out: { x: number; y: number }) => boolean;

function shapeOf(kind: ProjectileKind): { speed: number; range: number } {
  const shape = WEAPONS[kind === "ball" ? "wand" : "bow"].shape;
  return shape.kind === "projectile" ? shape : { speed: 0, range: 0 };
}

export class ProjectileView {
  private readonly tracked = new Map<string, Tracked>();
  /**
   * The last DONE_MAX ids that were finished, oldest first. A late projEnd (or a patch that still lists the projectile)
   * for one of them must not bring it back as a never-seen projectile drawn frozen at its start.
   */
  private readonly done = new Set<string>();
  private localT = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Whether an authoritative projectile id is tracked or already finished, preventing late FX from consuming another token. */
  has(id: string): boolean { return this.tracked.has(id) || this.done.has(id); }

  /** A `fxs` batch announced a projectile (just loosed, or already flying when this client joined). A known or finished id is skipped. */
  noteLaunch(l: ProjectileLaunch): void {
    if (this.tracked.has(l.id) || this.done.has(l.id)) return;
    this.tracked.set(l.id, {
      ...l, targetId: l.kind === "ball" ? l.targetId : undefined, simT: l.t, flightX: l.x, flightY: l.y, flightVx: l.vx, flightVy: l.vy, traveled: 0, end: null, g: null,
    });
  }

  /** Starts a cosmetic local shot at the release edge. It never predicts a collision or damage. */
  predictLocal(l: ProjectileLaunch): void {
    if (this.tracked.has(l.id) || this.done.has(l.id)) return;
    const now = Math.max(this.localT, l.t);
    this.localT = now;
    this.tracked.set(l.id, {
      ...l, targetId: l.kind === "ball" ? l.targetId : undefined,
      t: now, simT: now, flightX: l.x, flightY: l.y, flightVx: l.vx, flightVy: l.vy,
      traveled: 0, end: null, g: null, localClock: true, preview: true, serverT: l.t,
    });
  }

  /**
   * Replaces a local preview with the server's projectile id while keeping its current drawn position. `predictedId` is the
   * root scheduler's FIFO match. An absent or expired id creates a standalone authoritative track, leaving other previews alone.
   */
  noteLocalLaunch(l: ProjectileLaunch, predictedId?: string): void {
    if (this.done.has(l.id)) return;
    const existing = this.tracked.get(l.id);
    if (existing) return;
    const candidate = predictedId ? this.tracked.get(predictedId) : undefined;
    const preview = candidate?.preview ? candidate : undefined;
    if (!preview) {
      const now = Math.max(this.localT, l.t);
      this.localT = now;
      this.tracked.set(l.id, {
        ...l, targetId: l.kind === "ball" ? l.targetId : undefined,
        t: l.t, simT: l.t, flightX: l.x, flightY: l.y, flightVx: l.vx, flightVy: l.vy,
        traveled: 0, end: null, g: null, localClock: true, preview: false, serverT: l.t,
      });
      return;
    }

    const now = Math.max(this.localT, l.t);
    this.localT = now;
    // Bring the preview to the current local clock before replacing its id. The authoritative velocity/range now own the
    // remaining trajectory, while the already-visible portion remains continuous.
    const elapsed = Math.max(0, now - preview.t);
    let x = preview.flightX, y = preview.flightY;
    if (!preview.targetId) {
      const d = Math.min(preview.range, Math.hypot(preview.vx, preview.vy) * elapsed / 1000);
      const speed = Math.hypot(preview.vx, preview.vy);
      if (speed > 0) { x = preview.x + preview.vx * d / speed; y = preview.y + preview.vy * d / speed; }
    } else {
      const dt = Math.min(elapsed, Math.max(0, now - preview.simT));
      x += preview.flightVx * dt / 1000;
      y += preview.flightVy * dt / 1000;
    }
    const oldSpeed = Math.hypot(preview.vx, preview.vy);
    const oldTravel = Math.min(preview.range, preview.targetId
      ? preview.traveled + oldSpeed * Math.max(0, now - preview.simT) / 1000
      : Math.hypot(x - preview.x, y - preview.y));
    this.tracked.delete(preview.id);
    preview.id = l.id;
    preview.kind = l.kind;
    preview.x = x; preview.y = y;
    preview.vx = l.vx; preview.vy = l.vy;
    preview.t = now;
    preview.range = Math.max(0, l.range - oldTravel);
    preview.targetId = l.kind === "ball" ? l.targetId : undefined;
    preview.simT = now;
    preview.flightX = x; preview.flightY = y;
    preview.flightVx = l.vx; preview.flightVy = l.vy;
    preview.traveled = 0;
    preview.end = null;
    preview.localClock = true;
    preview.preview = false;
    preview.serverT = now;
    this.tracked.set(l.id, preview);
  }

  /**
   * A projEnd fx arrived (it plays later). Its stop point caps the flight, so a projectile never overshoots a wall or a
   * body while the fx waits for render time. One never announced (loosed and stopped within a step) flies its
   * short path from the fx's own start.
   */
  noteEnd(fx: ProjEndFx): void {
    if (this.done.has(fx.id)) return;
    let tr = this.tracked.get(fx.id);
    if (!tr) {
      const len = Math.hypot(fx.x - fx.x0, fx.y - fx.y0);
      if (len < MIN_FLIGHT) return;
      const { speed, range } = shapeOf(fx.proj);
      tr = {
        id: fx.id, kind: fx.proj, x: fx.x0, y: fx.y0, vx: ((fx.x - fx.x0) / len) * speed, vy: ((fx.y - fx.y0) / len) * speed,
        t: fx.t0, range, simT: fx.t0, flightX: fx.x0, flightY: fx.y0,
        flightVx: ((fx.x - fx.x0) / len) * speed, flightVy: ((fx.y - fx.y0) / len) * speed, traveled: 0, end: null, g: null,
      };
      this.tracked.set(fx.id, tr);
    }
    const endT = tr.localClock && tr.serverT !== undefined ? tr.t + (fx.t - tr.serverT) : fx.t;
    tr.end = { x: fx.x, y: fx.y, t: endT, reason: fx.reason };
  }

  /** Reconciles a launch-and-stop FX that arrived without a separate launch event (for example, a short arrow flight). */
  noteLocalEnd(fx: ProjEndFx, predictedId?: string): void {
    if (this.done.has(fx.id) || this.tracked.has(fx.id)) return;
    const candidate = predictedId ? this.tracked.get(predictedId) : undefined;
    const preview = candidate?.preview ? candidate : undefined;
    const dx = fx.x - fx.x0, dy = fx.y - fx.y0;
    const len = Math.hypot(dx, dy);
    if (len < MIN_FLIGHT) {
      if (preview?.preview) this.finish(preview.id);
      this.done.add(fx.id);
      if (this.done.size > DONE_MAX) this.done.delete(this.done.values().next().value!);
      return;
    }
    const { speed, range } = shapeOf(fx.proj);
    if (!(speed > 0)) return;
    const now = Math.max(this.localT, fx.t);
    this.localT = now;
    const duration = Math.max(0, fx.t - fx.t0, len / speed * 1000);
    let tr = preview?.preview ? preview : undefined;
    if (!tr) {
      tr = {
        id: fx.id, kind: fx.proj, x: fx.x0, y: fx.y0,
        vx: dx / len * speed, vy: dy / len * speed, t: now - duration, range,
        simT: now - duration, flightX: fx.x0, flightY: fx.y0, flightVx: dx / len * speed, flightVy: dy / len * speed,
        traveled: 0, end: null, g: null, localClock: true, preview: false, serverT: now - duration,
      };
    } else {
      this.tracked.delete(tr.id);
      tr.id = fx.id;
      tr.kind = fx.proj;
      tr.x = fx.x0; tr.y = fx.y0;
      tr.vx = dx / len * speed; tr.vy = dy / len * speed;
      tr.t = now - duration;
      tr.range = range;
      tr.targetId = undefined;
      tr.simT = tr.t;
      tr.flightX = fx.x0; tr.flightY = fx.y0;
      tr.flightVx = tr.vx; tr.flightVy = tr.vy;
      tr.traveled = 0;
      tr.preview = false;
      tr.localClock = true;
      tr.serverT = now - duration;
    }
    tr.end = { x: fx.x, y: fx.y, t: now, reason: fx.reason };
    this.tracked.set(fx.id, tr);
  }

  /** Its projEnd is due: stop drawing it (FxView draws the impact). */
  finish(id: string): void {
    this.done.add(id);
    if (this.done.size > DONE_MAX) this.done.delete(this.done.values().next().value!);
    const tr = this.tracked.get(id);
    if (!tr) return;
    tr.g?.destroy();
    this.tracked.delete(id);
  }

  update(renderT: number, targetAt?: ProjectileTargetAt, canSee: (point: Vec2) => boolean = () => true, localT = renderT): void {
    this.localT = localT;
    for (const tr of this.tracked.values()) {
      const now = tr.localClock ? localT : renderT;
      if (tr.preview && now - tr.t > Math.min(LOCAL_PREVIEW_MAX_MS, (tr.range + RANGE_SLACK) / Math.max(1, Math.hypot(tr.vx, tr.vy)) * 1000)) {
        this.finish(tr.id);
        continue;
      }
      const speed = Math.hypot(tr.vx, tr.vy);
      if (tr.targetId) {
        this.updateHoming(tr, now, speed, targetAt, canSee);
        continue;
      }
      const travelled = speed * ((now - tr.t) / 1000);
      if (tr.end ? now > tr.end.t + END_GRACE_MS : travelled > tr.range + RANGE_SLACK) {
        this.finish(tr.id);
        continue;
      }
      // Not loosed yet as drawn: the patch is ahead of render time.
      if (travelled < 0 || speed === 0) {
        tr.g?.setVisible(false);
        continue;
      }
      const limit = tr.end ? Math.hypot(tr.end.x - tr.x, tr.end.y - tr.y) : tr.range;
      if (tr.end && VANISHES.has(tr.end.reason) && travelled >= limit) {
        this.finish(tr.id);
        continue;
      }
      const d = Math.min(travelled, limit) / speed;
      const ended = tr.end !== null && now >= tr.end.t;
      const x = ended ? tr.end!.x : tr.x + tr.vx * d;
      const y = ended ? tr.end!.y : tr.y + tr.vy * d;
      if (!canSee({ x, y })) { tr.g?.setVisible(false); continue; }
      const g = tr.g ?? this.create(tr);
      g.setVisible(true).setPosition(projX(x), projY(y, BODY_LIFT)).setDepth(depthFor(y));
      if (tr.kind === "ball") g.setScale(1 + 0.1 * Math.sin(now / 60));
    }
  }

  destroy(): void {
    for (const tr of this.tracked.values()) tr.g?.destroy();
    this.tracked.clear();
    this.done.clear();
  }

  private updateHoming(tr: Tracked, renderT: number, speed: number, targetAt: ProjectileTargetAt | undefined, canSee: (point: Vec2) => boolean): void {
    if (speed === 0) { tr.g?.setVisible(false); return; }
    if (renderT < tr.simT) {
      tr.simT = tr.t;
      tr.flightX = tr.x;
      tr.flightY = tr.y;
      tr.flightVx = tr.vx;
      tr.flightVy = tr.vy;
      tr.traveled = 0;
    }
    const timeLimit = (tr.range + RANGE_SLACK) / speed * 1000;
    if (tr.end ? renderT > tr.end.t + END_GRACE_MS : renderT - tr.t > timeLimit) {
      this.finish(tr.id);
      return;
    }
    // A known stop caps simulation while its fx waits for render time. Otherwise replay at the same 10 ms cadence as the server.
    const stopAt = tr.end ? Math.min(renderT, tr.end.t) : renderT;
    const aim = { x: 0, y: 0 };
    while (tr.simT < stopAt) {
      const nextT = Math.min(stopAt, tr.simT + 10);
      const aimT = tr.localClock && tr.serverT !== undefined ? tr.serverT + (nextT - tr.t) : nextT;
      if (tr.targetId && targetAt?.(tr.targetId, aimT, aim)) {
        const dx = aim.x - tr.flightX;
        const dy = aim.y - tr.flightY;
        const d = Math.hypot(dx, dy);
        if (d > 1e-6) { tr.flightVx = (dx / d) * speed; tr.flightVy = (dy / d) * speed; }
      }
      const dt = (nextT - tr.simT) / 1000;
      const len = Math.min(speed * dt, Math.max(0, tr.range - tr.traveled));
      const scale = len / speed;
      tr.flightX += tr.flightVx * scale;
      tr.flightY += tr.flightVy * scale;
      tr.traveled += len;
      tr.simT = nextT;
      if (tr.traveled >= tr.range) break;
    }
    if (tr.end && renderT >= tr.end.t) {
      if (VANISHES.has(tr.end.reason)) { this.finish(tr.id); return; }
      tr.flightX = tr.end.x;
      tr.flightY = tr.end.y;
    } else if (!tr.end && renderT >= tr.t + tr.range / speed * 1000) {
      this.finish(tr.id);
      return;
    }
    if (!canSee({ x: tr.flightX, y: tr.flightY })) { tr.g?.setVisible(false); return; }
    const g = tr.g ?? this.create(tr);
    g.setVisible(true).setPosition(projX(tr.flightX), projY(tr.flightY, BODY_LIFT)).setDepth(depthFor(tr.flightY));
    if (tr.kind === "arrow") g.setRotation(screenAngle(Math.atan2(tr.flightVy, tr.flightVx)));
    else g.setScale(1 + 0.1 * Math.sin(renderT / 60));
  }

  private create(tr: Tracked): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics().setVisible(false);
    if (tr.kind === "arrow") {
      // Along +x, rotated to the velocity as drawn on the squashed ground.
      g.lineStyle(3, 0xffffff, 0.14).lineBetween(-28, 0, -10, 0);
      g.lineStyle(5, ARROW_COLOR, 1).lineBetween(-16, 0, 12, 0);
      g.lineStyle(1.5, 0xa1887f, 1).lineBetween(-10, 0, -14, -3).lineBetween(-10, 0, -14, 3);
      g.fillStyle(ARROW_COLOR, 1).fillTriangle(10, -7, 10, 7, 22, 0);
      g.setRotation(screenAngle(Math.atan2(tr.vy, tr.vx)));
    } else {
      g.fillStyle(BALL_COLOR, 0.18).fillCircle(0, 0, 12);
      g.fillStyle(BALL_COLOR, 0.4).fillCircle(0, 0, 7.5);
      g.fillStyle(BALL_COLOR, 1).fillCircle(0, 0, 4.5);
      g.fillStyle(0xffffff, 0.85).fillCircle(-1, -1, 1.8);
    }
    tr.g = g;
    return g;
  }
}
