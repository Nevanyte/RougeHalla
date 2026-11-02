// Whole-screen juice: a tiny camera shake for what the LOCAL player lands or takes. Combat never pauses the world clock.
import { juiceScale } from "./juice";

/** The camera as far as the shake goes (Phaser's Camera has it). */
export interface ShakeCamera {
  shake(duration: number, intensity: number, force?: boolean): unknown;
  /** Phaser's camera zoom (canvas pixels per world pixel); absent = 1. */
  zoom?: number;
}

/** The shake is a fraction of the screen size: these are a pixel or two to three or four. */
export const LANDED_SHAKE = 0.0016;
export const LANDED_SHAKE_MS = 70;
export const HURT_SHAKE_MIN = 0.0018;
export const HURT_SHAKE_MAX = 0.005;
export const HURT_SHAKE_MS = 110;
/** A blow that takes less than this share of max hp is not worth a shake. */
export const HURT_MIN_SHARE = 0.02;
/** Hurt shakes grow with the share of max hp taken, up to this share. */
const HURT_FULL_SHARE = 0.25;

export class ScreenJuice {
  constructor(private readonly cam: ShakeCamera) {}

  /**
   * Phaser's shake offset is `intensity x camera.width x zoom`, and the camera matrix applies the zoom to it once more.
   * The width is canvas pixels, so dividing by zoom squared keeps the shake the same share of the screen at any zoom or DPR.
   */
  private shake(duration: number, intensity: number): void {
    const zoom = this.cam.zoom !== undefined && this.cam.zoom > 0 ? this.cam.zoom : 1;
    this.cam.shake(duration, intensity / (zoom * zoom), false);
  }

  /** Every world system shares the interpolator's current time; a local hit never pauses or speeds up the rest of the scene. */
  worldTime(renderT: number, _now: number): number {
    return renderT;
  }

  /** The local player landed a hit: nudge the camera without changing any render clocks. */
  landed(now: number): void {
    const m = juiceScale("motion");
    if (m <= 0) return;
    this.shake(LANDED_SHAKE_MS, LANDED_SHAKE * m);
  }

  /** The local player took `amount` damage of `maxHp`. */
  hurt(amount: number, maxHp: number): void {
    const m = juiceScale("motion");
    if (m <= 0 || !(maxHp > 0)) return;
    const share = amount / maxHp;
    if (!(share >= HURT_MIN_SHARE)) return;
    const k = Math.min(1, share / HURT_FULL_SHARE);
    this.shake(HURT_SHAKE_MS, (HURT_SHAKE_MIN + (HURT_SHAKE_MAX - HURT_SHAKE_MIN) * k) * m);
  }

  reset(): void {
    // Kept as a no-op for the scene lifecycle; this presentation helper has no time state.
  }
}
