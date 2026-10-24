// The trail cosmetic: what a moving player leaves behind. Purely visual, driven from the owner's PlayerView.update() with
// the interpolated ground position, so it follows what is drawn. It lives in world space (not in the player's container),
// because a trail must stay where the player was while the player moves on.
//
// Samples sit in a fixed ring buffer and age out on performance.now(), so there are no timers to clean up and nothing
// is allocated per frame. One Graphics is cleared and redrawn only while a sample is alive; a standing player's trail
// fades out and then costs nothing.
import Phaser from "phaser";
import type { TrailCosmetic, TrailStyle } from "@raid/shared";
import { projX, projY } from "./projection";

const MAX_SAMPLES = 16;
/** A sample is laid once the player is this far (world units) from the last one. */
const SAMPLE_SPACING = 10;
const SPACING_SQ = SAMPLE_SPACING * SAMPLE_SPACING;
/** A single frame's move longer than this is a teleport or a stalled tab: restart instead of drawing a line across the map. */
const RESET_DIST = 120;
const MOVE_EPS = 0.01;
/** Sparks burn out sooner than the other styles fade. */
const LIFE_MS: Record<TrailStyle, number> = { dots: 600, streak: 600, sparks: 420 };
/** Screen pixels above the ground: reads as coming off the body, not buried in the shadow. */
const TRAIL_LIFT = 6;
const DOT_RADIUS = 3.5;
const STREAK_WIDTH = 7;
const STREAK_MIN_WIDTH = 0.75;
const SPARKS_PER_SAMPLE = 2;
const SPARK_SCATTER = 7;
/** Each spark has an (x, y) offset. */
const JITTER_STRIDE = SPARKS_PER_SAMPLE * 2;

export class TrailView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly lifeMs: number;
  // Ring buffer, oldest at `tail`. Ground coordinates; projected when drawn.
  private readonly xs = new Float64Array(MAX_SAMPLES);
  private readonly ys = new Float64Array(MAX_SAMPLES);
  private readonly ts = new Float64Array(MAX_SAMPLES);
  private readonly jitter = new Float32Array(MAX_SAMPLES * JITTER_STRIDE);
  private tail = 0;
  private count = 0;
  /** False until the first update after a reset, so a player appearing somewhere never trails from the origin. */
  private known = false;
  private lastX = 0;
  private lastY = 0;
  private sampleX = 0;
  private sampleY = 0;
  /** performance.now() when the player last moved: the streak's head fades from this moment once they stand still. */
  private headT = 0;
  private drawn = false;

  constructor(scene: Phaser.Scene, readonly cosmetic: TrailCosmetic) {
    this.g = scene.add.graphics().setVisible(false);
    this.lifeMs = LIFE_MS[cosmetic.style];
  }

  /** `x`, `y`: the owner's drawn ground position; `now`: performance.now(). */
  update(x: number, y: number, now: number): void {
    if (!this.known) {
      this.known = true;
      this.lastX = this.sampleX = x;
      this.lastY = this.sampleY = y;
    }
    const mx = x - this.lastX;
    const my = y - this.lastY;
    this.lastX = x;
    this.lastY = y;
    const moved = mx * mx + my * my;
    if (moved > RESET_DIST * RESET_DIST) {
      this.count = 0;
      this.sampleX = x;
      this.sampleY = y;
    } else if (moved > MOVE_EPS * MOVE_EPS) {
      this.headT = now;
      const sx = x - this.sampleX;
      const sy = y - this.sampleY;
      if (sx * sx + sy * sy >= SPACING_SQ) this.push(x, y, now);
    }

    while (this.count > 0 && now - this.ts[this.tail] >= this.lifeMs) {
      this.tail = (this.tail + 1) % MAX_SAMPLES;
      this.count--;
    }
    if (this.count === 0) {
      this.hideDrawing();
      return;
    }

    const g = this.g.clear().setVisible(true);
    this.drawn = true;
    // Below the owner and below everyone the trail runs behind, so it never covers a player: anyone standing on it sorts
    // above it. Only a player entirely north of the trail sorts under it, and they are clear of it on screen.
    let minY = y;
    for (let n = 0; n < this.count; n++) {
      const yy = this.ys[(this.tail + n) % MAX_SAMPLES];
      if (yy < minY) minY = yy;
    }
    g.setDepth(minY - 0.5);

    const color = this.cosmetic.color;
    switch (this.cosmetic.style) {
      case "dots": this.drawDots(g, color, now); break;
      case "streak": this.drawStreak(g, color, x, y, now); break;
      case "sparks": this.drawSparks(g, color, now); break;
    }
  }

  /** Forgets the path (the owner is hidden or gone); the next update starts a fresh trail. */
  reset(): void {
    this.known = false;
    this.count = 0;
    this.tail = 0;
    this.hideDrawing();
  }

  destroy(): void {
    this.g.destroy();
  }

  private hideDrawing(): void {
    if (!this.drawn) return;
    this.g.clear().setVisible(false);
    this.drawn = false;
  }

  private push(x: number, y: number, now: number): void {
    if (this.count === MAX_SAMPLES) {
      this.tail = (this.tail + 1) % MAX_SAMPLES;
      this.count--;
    }
    const i = (this.tail + this.count) % MAX_SAMPLES;
    this.count++;
    this.xs[i] = this.sampleX = x;
    this.ys[i] = this.sampleY = y;
    this.ts[i] = now;
    if (this.cosmetic.style === "sparks") {
      for (let k = 0; k < JITTER_STRIDE; k++) this.jitter[i * JITTER_STRIDE + k] = (Math.random() * 2 - 1) * SPARK_SCATTER;
    }
  }

  /** 1 for a sample just laid, falling to 0 as it reaches the end of its life. */
  private strength(t: number, now: number): number {
    return Math.max(0, 1 - (now - t) / this.lifeMs);
  }

  private drawDots(g: Phaser.GameObjects.Graphics, color: number, now: number): void {
    for (let n = 0; n < this.count; n++) {
      const i = (this.tail + n) % MAX_SAMPLES;
      const s = this.strength(this.ts[i], now);
      g.fillStyle(color, 0.8 * s).fillCircle(projX(this.xs[i]), projY(this.ys[i], TRAIL_LIFT), DOT_RADIUS * (0.45 + 0.55 * s));
    }
  }

  /** A polyline from the owner back through the samples, thinner and fainter toward the tail. */
  private drawStreak(g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, now: number): void {
    let px = projX(x);
    let py = projY(y, TRAIL_LIFT);
    let ps = this.strength(this.headT, now);
    for (let n = this.count - 1; n >= 0; n--) {
      const i = (this.tail + n) % MAX_SAMPLES;
      const qx = projX(this.xs[i]);
      const qy = projY(this.ys[i], TRAIL_LIFT);
      const s = this.strength(this.ts[i], now);
      const m = (ps + s) / 2;
      g.lineStyle(Math.max(STREAK_MIN_WIDTH, STREAK_WIDTH * m), color, 0.75 * m).lineBetween(px, py, qx, qy);
      px = qx;
      py = qy;
      ps = s;
    }
  }

  /** Each sample throws a couple of specks that drift outward and up while they shrink and fade. */
  private drawSparks(g: Phaser.GameObjects.Graphics, color: number, now: number): void {
    for (let n = 0; n < this.count; n++) {
      const i = (this.tail + n) % MAX_SAMPLES;
      const u = Math.min(1, (now - this.ts[i]) / this.lifeMs);
      const spread = 0.3 + 1.2 * u;
      const bx = projX(this.xs[i]);
      const by = projY(this.ys[i], TRAIL_LIFT + 5 * u);
      g.fillStyle(color, 1 - u);
      for (let k = 0; k < SPARKS_PER_SAMPLE; k++) {
        const o = i * JITTER_STRIDE + k * 2;
        g.fillCircle(bx + this.jitter[o] * spread, by + this.jitter[o + 1] * spread, 0.5 + 1.8 * (1 - u));
      }
    }
  }
}
