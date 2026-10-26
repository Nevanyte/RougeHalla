// The two rings of the attack target: a thin light one on the fighter a left click would lock right now (hover), and a
// stronger red one on the locked fighter. Ground ellipses like the container highlight, but at the fighter's own depth
// (just under it, as the ground fx are) so a ring never draws over a fighter standing south of it.
import Phaser from "phaser";
import { PLAYER_RADIUS, Y_SCALE } from "@raid/shared";
import { depthFor, projX, projY } from "./projection";
import type { TargetPoint } from "./targeting";

export const HOVER_COLOR = 0xeceff1;
export const LOCK_COLOR = 0xff5252;
/** Full width of both rings: clear of the body (2 radii) and its shadow (2.2), inside a mob elite's gold ring (3.4). */
export const RING_WIDTH = PLAYER_RADIUS * 3.1;

/** Under the fighter by about its radius (like FxView's ground shapes), so one standing in front still covers the ring. */
const DEPTH_BIAS = -PLAYER_RADIUS + 0.1;

export class TargetRings {
  private readonly hover: Phaser.GameObjects.Graphics;
  private readonly lock: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.hover = scene.add.graphics().setVisible(false);
    this.hover.lineStyle(1.5, HOVER_COLOR, 0.85).strokeEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
    this.lock = scene.add.graphics().setVisible(false);
    this.lock.fillStyle(LOCK_COLOR, 0.14).fillEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
    this.lock.lineStyle(3, LOCK_COLOR, 0.95).strokeEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
  }

  /** Once per frame: where each ring is (a fighter's drawn ground position), or null to hide it. */
  update(hover: TargetPoint | null, lock: TargetPoint | null): void {
    this.place(this.hover, hover, 0);
    // A hair above the hover ring, which only shows on a different fighter but may overlap a neighbour's.
    this.place(this.lock, lock, 0.05);
  }

  destroy(): void {
    this.hover.destroy();
    this.lock.destroy();
  }

  private place(ring: Phaser.GameObjects.Graphics, at: TargetPoint | null, bias: number): void {
    if (!at) {
      ring.setVisible(false);
      return;
    }
    ring.setPosition(projX(at.x), projY(at.y)).setDepth(depthFor(at.y, DEPTH_BIAS + bias)).setVisible(true);
  }
}
