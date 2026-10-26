// The two rings of the attack target: a thin light one on the fighter a left click would lock right now (hover), and a
// stronger red one on the locked fighter. Ground ellipses like the container highlight, but at the fighter's own depth
// (just under it, as the ground fx are) so a ring never draws over a fighter standing south of it.
// Juice (render/juice.ts): the lock ring is heavier, breathes slowly, and when it lands on a new fighter it scales in from
// LOCK_PULSE_FROM x with a flash ring.
import Phaser from "phaser";
import { PLAYER_RADIUS, Y_SCALE } from "@raid/shared";
import { BAKE_SCALE, bakedImage, type Region } from "./bake";
import { easeOutCubic, juiceScale, lerp } from "./juice";
import { depthFor, projX, projY } from "./projection";
import type { TargetPoint } from "./targeting";

export const HOVER_COLOR = 0xeceff1;
export const LOCK_COLOR = 0xff5252;
const LOCK_INNER_COLOR = 0xff8a80;
/** Full width of both rings: clear of the body (2 radii) and its shadow (2.2), inside a mob elite's gold ring (3.4). */
export const RING_WIDTH = PLAYER_RADIUS * 3.1;

/** Under the fighter by about its radius (like FxView's ground shapes), so one standing in front still covers the ring. */
const DEPTH_BIAS = -PLAYER_RADIUS + 0.1;

/** The ring lands on a new lock this big and settles to its own size over LOCK_PULSE_MS; the flash ring fades over the same. */
export const LOCK_PULSE_FROM = 1.6;
export const LOCK_PULSE_MS = 180;
/** Breathing: a slow swell of the ring (motion) and of its opacity (not motion). */
export const LOCK_BREATH_MS = 1700;
export const LOCK_BREATH_SCALE = 0.035;
const LOCK_ALPHA_LOW = 0.8;
const LOCK_ALPHA_HIGH = 1;

/** The rings are baked (they never change shape; only their place, scale and alpha do): their drawing's own coordinates around the fighter's feet. */
const RING_REGION: Region = { x0: -RING_WIDTH / 2 - 4, y0: -RING_WIDTH * Y_SCALE / 2 - 4, x1: RING_WIDTH / 2 + 4, y1: RING_WIDTH * Y_SCALE / 2 + 4 };

export class TargetRings {
  private readonly hover: Phaser.GameObjects.Image;
  private readonly lock: Phaser.GameObjects.Image;
  private readonly flash: Phaser.GameObjects.Image;
  /** Who the lock ring was last on ("" = nobody), and when it landed there. */
  private lockedId = "";
  private pulseAt = -Infinity;

  constructor(scene: Phaser.Scene) {
    this.hover = bakedImage(scene, "ring:hover", RING_REGION, (g) => {
      g.lineStyle(1.5, HOVER_COLOR, 0.85).strokeEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
    }).setVisible(false);
    this.lock = bakedImage(scene, "ring:lock", RING_REGION, (g) => {
      g.fillStyle(LOCK_COLOR, 0.2).fillEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
      g.lineStyle(4, LOCK_COLOR, 1).strokeEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
      g.lineStyle(1.5, LOCK_INNER_COLOR, 0.9).strokeEllipse(0, 0, RING_WIDTH * 0.78, RING_WIDTH * 0.78 * Y_SCALE);
    }).setVisible(false);
    this.flash = bakedImage(scene, "ring:flash", RING_REGION, (g) => {
      g.lineStyle(2.5, 0xffffff, 1).strokeEllipse(0, 0, RING_WIDTH, RING_WIDTH * Y_SCALE);
    }).setVisible(false);
  }

  /**
   * Once per frame: where each ring is (a fighter's drawn ground position), or null to hide it. `lockId` names the locked
   * fighter, so a lock that moves to another one pulses. `now` is performance.now().
   */
  update(hover: TargetPoint | null, lock: TargetPoint | null, lockId = "", now = performance.now()): void {
    this.place(this.hover, hover, 0);
    // A hair above the hover ring, which only shows on a different fighter but may overlap a neighbour's.
    this.place(this.lock, lock, 0.05);
    if (!lock) {
      this.lockedId = "";
      this.flash.setVisible(false);
      return;
    }
    if (lockId !== this.lockedId) {
      this.lockedId = lockId;
      this.pulseAt = now;
    }
    const m = juiceScale("motion");
    const f = juiceScale("flash");
    const q = (now - this.pulseAt) / LOCK_PULSE_MS;
    const breath = 0.5 + 0.5 * Math.sin((now / LOCK_BREATH_MS) * Math.PI * 2);
    const settle = q < 1 ? lerp(LOCK_PULSE_FROM, 1, easeOutCubic(q)) : 1;
    const scale = 1 + (settle - 1) * m + LOCK_BREATH_SCALE * breath * m;
    this.lock.setScale(scale / BAKE_SCALE).setAlpha(f > 0 ? lerp(LOCK_ALPHA_LOW, LOCK_ALPHA_HIGH, breath) : 1);
    if (q < 1 && f > 0) {
      this.flash.setPosition(projX(lock.x), projY(lock.y)).setDepth(depthFor(lock.y, DEPTH_BIAS + 0.06)).setScale(scale / BAKE_SCALE)
        .setAlpha(Math.min(1, f) * (1 - q)).setVisible(true);
    } else {
      this.flash.setVisible(false);
    }
  }

  destroy(): void {
    this.hover.destroy();
    this.lock.destroy();
    this.flash.destroy();
  }

  private place(ring: Phaser.GameObjects.Image, at: TargetPoint | null, bias: number): void {
    if (!at) {
      ring.setVisible(false);
      return;
    }
    ring.setPosition(projX(at.x), projY(at.y)).setDepth(depthFor(at.y, DEPTH_BIAS + bias)).setVisible(true);
  }
}
