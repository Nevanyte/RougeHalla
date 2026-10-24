// Arrows and wand balls. The server syncs each one once, when it is loosed, and never updates it: every client flies it
// in a straight line, position(T) = (x, y) + (vx, vy) * (T - t) / 1000, with T the render time. When it stops it
// leaves the state and a `projEnd` fx says where and why. That fx is played at render time, so the projectile is kept
// (flying, then pinned at its stop point) until FxView reports the fx due, and only then removed.
import Phaser from "phaser";
import { WEAPONS, type ProjectileKind, type TimedFx } from "@raid/shared";
import type { ProjectileState } from "@raid/shared/schema";
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

interface Tracked {
  id: string;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  range: number;
  /** Where and when (server time) the stop was reported; set when its projEnd arrives, before it is due. */
  end: { x: number; y: number; t: number } | null;
  g: Phaser.GameObjects.Graphics | null;
}

function shapeOf(kind: ProjectileKind): { speed: number; range: number } {
  const shape = WEAPONS[kind === "ball" ? "wand" : "bow"].shape;
  return shape.kind === "projectile" ? shape : { speed: 0, range: 0 };
}

export class ProjectileView {
  private readonly tracked = new Map<string, Tracked>();

  constructor(private readonly scene: Phaser.Scene) {}

  /** Once per patch: picks up what was loosed. Entries are immutable, so a known id is skipped. */
  sync(projectiles: { forEach(cb: (p: ProjectileState, id: string) => void): void }): void {
    projectiles.forEach((p, id) => {
      if (this.tracked.has(id)) return;
      this.tracked.set(id, {
        id, kind: p.kind === "ball" ? "ball" : "arrow", x: p.x, y: p.y, vx: p.vx, vy: p.vy, t: p.t, range: p.range,
        end: null, g: null,
      });
    });
  }

  /**
   * A projEnd fx arrived (it plays later). Its stop point caps the flight, so a projectile never overshoots a wall or a
   * body while the fx waits for render time. One never seen in the state (loosed and stopped within a patch) flies its
   * short path from the fx's own start.
   */
  noteEnd(fx: ProjEndFx): void {
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
    tr.end = { x: fx.x, y: fx.y, t: fx.t };
  }

  /** Its projEnd is due: stop drawing it (FxView draws the impact). */
  finish(id: string): void {
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
