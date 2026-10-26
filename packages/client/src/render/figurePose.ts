// How one fighter's figure (body disc and weapon) is posed on top of where it is drawn: anticipation over a windup, a lunge
// on the swing, a recoil on a launch, a shove and a pop when hit, squash and stretch from the drawn velocity, a lean and a
// tremble while a bow is drawn. Pure numbers (no Phaser): FigureJuice puts them on the display objects, FxView and the
// views feed it cues. Everything is an offset from the rest pose and goes to nothing when its effect is over, so a fighter
// at rest is posed exactly as before. All times are performance.now() milliseconds, except `track`'s `t`, the time the
// positions are drawn at (render time), which a hit-stop holds: a frozen fighter has not stopped walking.
import { Y_SCALE } from "@raid/shared";
import { decay, easeInOutSine, easeOutCubic, lerp } from "./juice";

/** The figure's pose, relative to rest: a shift in screen pixels, a scale about the feet, and a turn of the weapon in hand. */
export interface Pose {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  rot: number;
}

export type WindStyle = "melee" | "wand";

/** What FxView tells a fighter's figure. `a` is a ground angle. */
export interface FigureCues {
  /** A swing or a cast began and lands `ms` later. */
  windupStart(a: number, ms: number, now: number, style: WindStyle): void;
  /** The windup was cancelled, staggered or ended with nothing to show. */
  windupEnd(now: number): void;
  /** The swing landed. */
  swing(a: number, now: number): void;
  /** An arrow or a ball left. */
  launch(a: number, now: number): void;
  /** Took a blow; `away` is the ground angle it pushes toward (from the attacker), or null if unknown. */
  hit(away: number | null, now: number): void;
}

export type MotionEvent = "start" | "stop" | null;

// Windup: the body draws back and crouches while the weapon winds up, all peaking at the release.
export const WIND_BACK_PX = 3.5;
export const CAST_BACK_PX = 2;
export const WIND_CROUCH_X = 0.06;
export const WIND_CROUCH_Y = 0.08;
export const WIND_ROT = 0.75;
/** A windup nobody ended (a lost fx) lets go this long after its nominal end. */
export const WIND_GRACE_MS = 160;
/** How fast a cancelled windup relaxes. */
export const WIND_FADE_MS = 70;
// Release of a melee swing: a quick lunge toward the swing and the weapon sweeping through.
export const LUNGE_MS = 110;
export const LUNGE_PX = 6;
export const LUNGE_STRETCH = 0.12;
export const SWEEP_ROT = 0.55;
// A launch: the shooter kicks back.
export const RECOIL_MS = 130;
export const RECOIL_PX = 3.5;
// A blow taken.
export const HIT_MS = 140;
export const SHOVE_PX = 3;
export const HIT_POP = 0.08;
// Walking: stretch along the motion as it starts, squash as it stops.
export const START_TAU_MS = 110;
export const STOP_TAU_MS = 140;
export const STRETCH_ALONG = 0.14;
export const STRETCH_PERP = 0.08;
// A bow's draw.
export const BOW_LEAN_PX = 2.5;
export const BOW_SHAKE_FROM = 0.85;
export const BOW_SHAKE_PX = 0.8;

// What counts as walking (ground units per second, smoothed over render time: slower to pick up than to drop, so a stop
// is called about 50 ms after it happens and a start within a frame or two).
export const SPEED_TAU_MS = 50;
export const SPEED_DOWN_TAU_MS = 25;
export const MOVE_START_SPEED = 45;
export const MOVE_STOP_SPEED = 20;
/** A stop only counts after walking this long (a stutter in the path is not a stop). */
export const MIN_MOVE_MS = 150;
export const EVENT_GAP_MS = 120;
/** A gap this long between two samples, or a jump this far (a teleport, a snap), restarts the tracker instead of measuring. */
export const MAX_SAMPLE_DT_MS = 250;
export const MAX_STEP = 100;

const POSE_MIN = 0.75;
const POSE_MAX = 1.3;
const IMPULSE_END = 0.02;

// Indices into the little pose vectors below (deviations from rest).
const OX = 0;
const OY = 1;
const ROT = 2;
const SX = 3;
const SY = 4;

/** Unit vector of ground angle `a` as it is drawn (the ground is squashed by Y_SCALE). */
function unitX(a: number): number {
  const x = Math.cos(a);
  return x / Math.hypot(x, Math.sin(a) * Y_SCALE);
}
function unitY(a: number): number {
  const y = Math.sin(a) * Y_SCALE;
  return y / Math.hypot(Math.cos(a), y);
}

export class FigurePose implements FigureCues {
  /** The pose of the last sample(); one object, reused. */
  readonly pose: Pose = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0 };
  /** The wand's charge, 0..1, as of the last sample() (a glow, so it is not scaled with the motion setting). */
  charge = 0;

  // The windup in progress, and the one that just ended (relaxing).
  private windOn = false;
  private windStart = 0;
  private windMs = 1;
  private windStyle: WindStyle = "melee";
  private windX = 0;
  private windY = 0;
  private fadeFrom = 0;
  private fadeAt = 0;
  // The release (a swing's lunge or a launch's recoil): from the wound-up pose, through a peak, back to rest.
  private relAt = -1;
  private relMs = 1;
  private relPeakAt = 0.4;
  private readonly relFrom = new Float64Array(5);
  private readonly relPeak = new Float64Array(5);
  private hitAt = -1;
  private hitX = 0;
  private hitY = 0;
  // Walking.
  private impAt = -1;
  private impAmp = 0;
  private impTau = START_TAU_MS;
  private hasLast = false;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private speed = 0;
  private moving = false;
  private movedMs = 0;
  private lastEventAt = -Infinity;
  /** Ground angle of the last walking direction (valid once something moved). */
  moveAngle = 0;
  private moveUX = 1;
  private moveUY = 0;
  private readonly tmp = new Float64Array(5);

  // ------------------------------------------------------------------------------------------------------- cues

  windupStart(a: number, ms: number, now: number, style: WindStyle): void {
    this.windOn = true;
    this.windStart = now;
    this.windMs = Math.max(1, ms);
    this.windStyle = style;
    this.windX = Math.cos(a);
    this.windY = Math.sin(a) * Y_SCALE;
    this.fadeFrom = 0;
  }

  windupEnd(now: number): void {
    if (!this.windOn) return;
    this.fadeFrom = this.level(now);
    this.fadeAt = now;
    this.windOn = false;
  }

  swing(a: number, now: number): void {
    this.windInto(this.level(now), this.relFrom);
    this.stopWind();
    const along = LUNGE_STRETCH;
    const perp = -LUNGE_STRETCH * 0.6;
    const ux = unitX(a);
    const uy = unitY(a);
    const p = this.relPeak;
    p[OX] = Math.cos(a) * LUNGE_PX;
    p[OY] = Math.sin(a) * Y_SCALE * LUNGE_PX;
    p[ROT] = SWEEP_ROT;
    p[SX] = perp + (along - perp) * ux * ux;
    p[SY] = perp + (along - perp) * uy * uy;
    this.relAt = now;
    this.relMs = LUNGE_MS;
    this.relPeakAt = 0.4;
  }

  launch(a: number, now: number): void {
    this.windInto(this.level(now), this.relFrom);
    this.stopWind();
    const p = this.relPeak;
    p[OX] = -Math.cos(a) * RECOIL_PX;
    p[OY] = -Math.sin(a) * Y_SCALE * RECOIL_PX;
    p[ROT] = 0;
    p[SX] = 0;
    p[SY] = 0;
    this.relAt = now;
    this.relMs = RECOIL_MS;
    this.relPeakAt = 0.25;
  }

  hit(away: number | null, now: number): void {
    this.hitAt = now;
    this.hitX = away === null ? 0 : Math.cos(away);
    this.hitY = away === null ? 0 : Math.sin(away) * Y_SCALE;
  }

  // ---------------------------------------------------------------------------------------------------- walking

  /**
   * Once per frame with where the fighter is drawn (ground), the time that position is drawn at (render time: a frozen
   * clock measures nothing) and `now`. Says when walking started or stopped; the squash and stretch follow from it.
   */
  track(x: number, y: number, t: number, now: number): MotionEvent {
    if (!this.hasLast) {
      this.hasLast = true;
      this.lastX = x;
      this.lastY = y;
      this.lastT = t;
      return null;
    }
    const dt = t - this.lastT;
    // Nothing to measure while the drawn time stands still (a hit-stop, or a second look within the same frame).
    if (dt <= 0) return null;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    this.lastT = t;
    const dist = Math.hypot(dx, dy);
    if (dt > MAX_SAMPLE_DT_MS || dist > MAX_STEP) {
      this.speed = 0;
      this.moving = false;
      this.movedMs = 0;
      return null;
    }
    const inst = (dist / dt) * 1000;
    this.speed += (inst - this.speed) * (1 - decay(dt, inst > this.speed ? SPEED_TAU_MS : SPEED_DOWN_TAU_MS));
    if (inst > MOVE_STOP_SPEED) {
      this.moveAngle = Math.atan2(dy, dx);
      this.moveUX = unitX(this.moveAngle);
      this.moveUY = unitY(this.moveAngle);
    }
    let event: MotionEvent = null;
    if (!this.moving) {
      if (this.speed > MOVE_START_SPEED) {
        this.moving = true;
        this.movedMs = 0;
        event = "start";
      }
    } else {
      this.movedMs += dt;
      if (this.speed < MOVE_STOP_SPEED) {
        this.moving = false;
        if (this.movedMs >= MIN_MOVE_MS) event = "stop";
      }
    }
    if (event !== null) {
      if (now - this.lastEventAt < EVENT_GAP_MS) return null;
      this.lastEventAt = now;
      this.impAt = now;
      this.impAmp = event === "start" ? 1 : -1;
      this.impTau = event === "start" ? START_TAU_MS : STOP_TAU_MS;
    }
    return event;
  }

  /** Forget everything: the fighter is out of sight (down, or not yet drawn), so nothing carries over to when it returns. */
  reset(): void {
    this.windOn = false;
    this.fadeFrom = 0;
    this.relAt = -1;
    this.hitAt = -1;
    this.impAt = -1;
    this.hasLast = false;
    this.speed = 0;
    this.moving = false;
    this.movedMs = 0;
    this.charge = 0;
    const p = this.pose;
    p.ox = 0;
    p.oy = 0;
    p.sx = 1;
    p.sy = 1;
    p.rot = 0;
  }

  // ------------------------------------------------------------------------------------------------------ pose

  /**
   * The pose at `now`. `m` is juiceScale("motion"): the deviations from rest are scaled by it, so 0 is exactly the rest pose.
   * `pull` is the bow's draw (0..1, or -1 for none) and `facing` the ground angle it is drawn toward.
   */
  sample(now: number, m: number, pull: number, facing: number): Pose {
    const level = this.level(now);
    this.charge = this.windStyle === "wand" ? level : 0;
    const d = this.tmp;
    this.windInto(level, d);
    let ox = d[OX]!;
    let oy = d[OY]!;
    let rot = d[ROT]!;
    let sx = d[SX]!;
    let sy = d[SY]!;

    if (this.relAt >= 0) {
      const q = (now - this.relAt) / this.relMs;
      if (q >= 1) {
        this.relAt = -1;
      } else {
        const f = this.relPeakAt;
        const k = q < f ? easeOutCubic(q / f) : easeInOutSine((q - f) / (1 - f));
        const from = q < f ? this.relFrom : this.relPeak;
        const to = q < f ? this.relPeak : null;
        ox += lerp(from[OX]!, to ? to[OX]! : 0, k);
        oy += lerp(from[OY]!, to ? to[OY]! : 0, k);
        rot += lerp(from[ROT]!, to ? to[ROT]! : 0, k);
        sx += lerp(from[SX]!, to ? to[SX]! : 0, k);
        sy += lerp(from[SY]!, to ? to[SY]! : 0, k);
      }
    }

    if (this.hitAt >= 0) {
      const q = (now - this.hitAt) / HIT_MS;
      if (q >= 1) {
        this.hitAt = -1;
      } else {
        const k = (1 - q) * (1 - q);
        ox += this.hitX * SHOVE_PX * k;
        oy += this.hitY * SHOVE_PX * k;
        sx += HIT_POP * k;
        sy += HIT_POP * k;
      }
    }

    if (this.impAt >= 0) {
      const v = this.impAmp * decay(now - this.impAt, this.impTau);
      if (Math.abs(v) < IMPULSE_END) {
        this.impAt = -1;
      } else {
        // Along the walk: longer on a start, shorter on a stop; across it the other way round. Mixed onto the screen axes by
        // how much of the walk lies along each.
        const along = STRETCH_ALONG * v;
        const perp = -STRETCH_PERP * v;
        sx += perp + (along - perp) * this.moveUX * this.moveUX;
        sy += perp + (along - perp) * this.moveUY * this.moveUY;
      }
    }

    if (pull > 0) {
      const lean = BOW_LEAN_PX * pull * pull;
      ox -= Math.cos(facing) * lean;
      oy -= Math.sin(facing) * Y_SCALE * lean;
      if (pull >= BOW_SHAKE_FROM) {
        const amp = (BOW_SHAKE_PX * (pull - BOW_SHAKE_FROM)) / (1 - BOW_SHAKE_FROM);
        ox += Math.sin(now * 0.09) * amp;
        oy += Math.cos(now * 0.13) * amp * 0.7;
      }
    }

    const p = this.pose;
    // `+ 0` turns a -0 into 0.
    p.ox = ox * m + 0;
    p.oy = oy * m + 0;
    p.rot = rot * m + 0;
    p.sx = Math.min(POSE_MAX, Math.max(POSE_MIN, 1 + sx * m));
    p.sy = Math.min(POSE_MAX, Math.max(POSE_MIN, 1 + sy * m));
    return p;
  }

  // -------------------------------------------------------------------------------------------------- internals

  /** How far the windup has come (0..1), peaking at the release; a finished one relaxes from where it let go. */
  private level(now: number): number {
    if (this.windOn) {
      const end = this.windStart + this.windMs;
      if (now > end + WIND_GRACE_MS) {
        this.windOn = false;
        this.fadeFrom = 1;
        this.fadeAt = end + WIND_GRACE_MS;
      } else {
        return easeInOutSine((now - this.windStart) / this.windMs);
      }
    }
    if (this.fadeFrom > 0) {
      const l = this.fadeFrom * decay(now - this.fadeAt, WIND_FADE_MS);
      if (l >= 0.005) return l;
      this.fadeFrom = 0;
    }
    return 0;
  }

  private stopWind(): void {
    this.windOn = false;
    this.fadeFrom = 0;
  }

  /** Writes the wound-up pose at `level` into `out` (deviations from rest). */
  private windInto(level: number, out: Float64Array): void {
    const melee = this.windStyle === "melee";
    const back = (melee ? WIND_BACK_PX : CAST_BACK_PX) * level;
    out[OX] = -this.windX * back;
    out[OY] = -this.windY * back;
    out[ROT] = melee ? -WIND_ROT * level : 0;
    out[SX] = WIND_CROUCH_X * level;
    out[SY] = -WIND_CROUCH_Y * level;
  }
}
