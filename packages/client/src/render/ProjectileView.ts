// Arrows and wand balls. The server announces each one once, when it is loosed (in the `fxs` batch of that step; the
// state has none), and never updates it: every client flies it in a straight line,
// position(T) = (x, y) + (vx, vy) * (T - t) / 1000, with T the render time. A client that joins or reconnects while some
// fly is sent them as a batch of their own, with the same tuples. When it stops a `projEnd` fx says where and why. That fx is played at render time, so the projectile is kept
// (flying, then pinned at its stop point) until FxView reports the fx due, and only then removed. One that was
// reflected, deleted or destroyed does not stay pinned: something else carries on from there (see VANISHES).
import Phaser from "phaser";
import { WEAPONS, type ProjectileEnd, type ProjectileKind, type ProjectileLaunch, type TimedFx } from "@raid/shared";
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
  /** Where, when (server time) and why the stop was reported; set when its projEnd arrives, before it is due. */
  end: { x: number; y: number; t: number; reason: ProjectileEnd } | null;
  g: Phaser.GameObjects.Graphics | null;
}

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

  constructor(private readonly scene: Phaser.Scene) {}

  /** A `fxs` batch announced a projectile (just loosed, or already flying when this client joined). A known or finished id is skipped. */
  noteLaunch(l: ProjectileLaunch): void {
    if (this.tracked.has(l.id) || this.done.has(l.id)) return;
    this.tracked.set(l.id, { ...l, end: null, g: null });
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
        t: fx.t0, range, end: null, g: null,
      };
      this.tracked.set(fx.id, tr);
    }
    tr.end = { x: fx.x, y: fx.y, t: fx.t, reason: fx.reason };
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

  update(renderT: number): void {
    for (const tr of this.tracked.values()) {
      const speed = Math.hypot(tr.vx, tr.vy);
      const travelled = speed * ((renderT - tr.t) / 1000);
      if (tr.end ? renderT > tr.end.t + END_GRACE_MS : travelled > tr.range + RANGE_SLACK) {
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
      const x = tr.x + tr.vx * d;
      const y = tr.y + tr.vy * d;
      const g = tr.g ?? this.create(tr);
      g.setVisible(true).setPosition(projX(x), projY(y, BODY_LIFT)).setDepth(depthFor(y));
      if (tr.kind === "ball") g.setScale(1 + 0.1 * Math.sin(renderT / 60));
    }
  }

  destroy(): void {
    for (const tr of this.tracked.values()) tr.g?.destroy();
    this.tracked.clear();
    this.done.clear();
  }

  private create(tr: Tracked): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics().setVisible(false);
    if (tr.kind === "arrow") {
      // Along +x, rotated to the velocity as drawn on the squashed ground.
      g.lineStyle(3, 0xffffff, 0.14).lineBetween(-28, 0, -10, 0);
      g.lineStyle(2, ARROW_COLOR, 1).lineBetween(-10, 0, 8, 0);
      g.lineStyle(1.5, 0xa1887f, 1).lineBetween(-10, 0, -14, -3).lineBetween(-10, 0, -14, 3);
      g.fillStyle(ARROW_COLOR, 1).fillTriangle(8, -3, 8, 3, 14, 0);
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
