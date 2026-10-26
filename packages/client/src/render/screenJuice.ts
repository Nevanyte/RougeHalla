// Whole-screen juice: the hit-stop and the tiny camera shake. Both only for what the LOCAL player lands or takes.
import { juiceScale } from "./juice";

/** How long the world holds after the local player lands a hit (real ms), and the least gap between two holds. */
export const HIT_STOP_MS = 50;
export const HIT_STOP_GAP_MS = 150;
/** After a hold the drawn time runs this many times faster than real time until it has caught up (net: it catches up in the hold's length). */
export const HIT_STOP_CATCHUP = 2;
/** No hold is longer than this, whatever it is asked for. */
export const HIT_STOP_MAX_MS = 120;
/** A render-time step this far out (a clock resync, a stalled tab) is a jump, not time passing: the hold is dropped. */
const MAX_STEP_MS = 250;

/**
 * The time the world is drawn at. Normally it is the render time itself; for a moment after the local player lands a hit
 * it stands still (remote fighters, projectiles and fx all read it), then runs fast until it has caught up, so the blow
 * seems to land with weight. The local fighter is not drawn from it: it keeps moving and turning, so the controls stay as
 * live as ever.
 */
export class HitStop {
  private active = false;
  private drawT = 0;
  private lastTrue = 0;
  private holdUntil = 0;
  private nextAllowed = 0;
  private started = false;

  /** Holds the drawn time for `ms` of real time from `now`, unless one ended less than HIT_STOP_GAP_MS ago. True if it held. */
  trigger(now: number, ms = HIT_STOP_MS): boolean {
    if (!this.started || !(ms > 0) || now < this.nextAllowed) return false;
    if (!this.active) {
      this.active = true;
      this.drawT = this.lastTrue;
    }
    this.holdUntil = now + Math.min(ms, HIT_STOP_MAX_MS);
    this.nextAllowed = this.holdUntil + HIT_STOP_GAP_MS;
    return true;
  }

  /** Once per frame with the render time and the real time; returns the time to draw the world at. */
  apply(trueT: number, now: number): number {
    if (!this.started) {
      this.started = true;
      this.lastTrue = trueT;
      this.drawT = trueT;
      return trueT;
    }
    const step = trueT - this.lastTrue;
    this.lastTrue = trueT;
    if (!this.active) {
      this.drawT = trueT;
      return trueT;
    }
    if (step < 0 || step > MAX_STEP_MS) {
      this.active = false;
      this.drawT = trueT;
      return trueT;
    }
    if (now >= this.holdUntil) this.drawT += step * HIT_STOP_CATCHUP;
    if (this.drawT >= trueT) {
      this.active = false;
      this.drawT = trueT;
    }
    return this.drawT;
  }

  /** True while the drawn time is held or catching up. */
  get lagging(): boolean {
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.started = false;
    this.nextAllowed = 0;
    this.holdUntil = 0;
  }
}

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
  private readonly stop = new HitStop();

  constructor(private readonly cam: ShakeCamera) {}

  /**
   * Phaser's shake offset is `intensity x camera.width x zoom`, and the camera matrix applies the zoom to it once more.
   * The width is canvas pixels, so dividing by zoom squared keeps the shake the same share of the screen at any zoom or DPR.
   */
  private shake(duration: number, intensity: number): void {
    const zoom = this.cam.zoom !== undefined && this.cam.zoom > 0 ? this.cam.zoom : 1;
    this.cam.shake(duration, intensity / (zoom * zoom), false);
  }

  /** The time to draw the world at this frame (see HitStop). Call once per frame, first. */
  worldTime(renderT: number, now: number): number {
    return this.stop.apply(renderT, now);
  }

  /** The local player landed a hit: hold the world a moment and nudge the camera. */
  landed(now: number): void {
    const m = juiceScale("motion");
    if (m <= 0) return;
    this.stop.trigger(now, HIT_STOP_MS * m);
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
    this.stop.reset();
  }
}
