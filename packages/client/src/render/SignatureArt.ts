// What the faction signatures look like on the fighter they act on (the synced `sig` bits and `brand`). Cosmetic and
// redrawn every frame while anything is active, from the latest synced values; animation runs on the local clock.
// The ground layer goes under the body (sigils and rings lie on the floor, squashed by Y_SCALE like the shadow), the
// aura layer over it (rim, crystals, embers and the execute skull sit at body height).
import Phaser from "phaser";
import { PLAYER_RADIUS, SIG_BURNING, SIG_CHILLED, SIG_DISEASED, SIG_EXECUTE, Y_SCALE } from "@raid/shared";
import { brandLook, life, pulse } from "./signatureLook";
import { BODY_LIFT } from "./projection";

const R = PLAYER_RADIUS;
const TAU = Math.PI * 2;

const BRAND_RING = 0xb388ff;
const BRAND_STAR = 0xe1bee7;
const BRAND_FILL = 0x7c4dff;

const ICE_RIM = 0xe1f5fe;
const ICE_FILL = 0xb3e5fc;
const ICE_EDGE = 0x01579b;
const CRYSTALS = 6;

const PLAGUE_HAZE = 0x9ccc65;
const PLAGUE_DOT = 0xc5e1a5;
const EXECUTE_EDGE = 0xc6ff00;
const EXECUTE_FILL = 0x33691e;
const EXECUTE_TEETH = 16;
const SKULL_BONE = 0xe6ee9c;
const SKULL_DARK = 0x1b1f24;

const EMBER_COLORS = [0xff9800, 0xffeb3b, 0xff5722] as const;
const EMBERS = 6;
const HAZE_DOTS = 5;

/** The execute ring's inner and outer radius: a toothed collar around the feet that reads from far away. */
const EXECUTE_R_IN = R + 7;
const EXECUTE_R_OUT = R + 19;

export class SignatureArt {
  /** Floor layer; goes under the body in the view's container. */
  readonly ground: Phaser.GameObjects.Graphics;
  /** Body-height layer; goes over the body and its weapon. */
  readonly aura: Phaser.GameObjects.Graphics;
  private drawn = false;

  /** `barHalfW`: half the width of the fighter's hp bar, so the execute skull can sit beside it. */
  constructor(scene: Phaser.Scene, private readonly barHalfW = 14) {
    this.ground = scene.add.graphics();
    this.aura = scene.add.graphics();
  }

  /** `enabled` is false outside an active run, when the sim has frozen the synced values. */
  update(sig: number, brand: number, enabled: boolean, now = performance.now()): void {
    if (!enabled || (sig === 0 && !(brand > 0))) {
      if (this.drawn) {
        this.ground.clear();
        this.aura.clear();
        this.drawn = false;
      }
      return;
    }
    this.drawn = true;
    const ground = this.ground.clear();
    const aura = this.aura.clear();
    const diseased = (sig & (SIG_DISEASED | SIG_EXECUTE)) !== 0;
    if (diseased) this.drawHaze(ground, aura, now);
    if ((sig & SIG_EXECUTE) !== 0) this.drawExecute(ground, aura, now);
    if (brand > 0) this.drawBrand(ground, aura, brand, now);
    if ((sig & SIG_BURNING) !== 0) this.drawEmbers(aura, now);
    if ((sig & SIG_CHILLED) !== 0) this.drawFrost(aura, now);
  }

  /** Plague's disease: a faint green haze on the floor and a few motes drifting up off the body. */
  private drawHaze(ground: Phaser.GameObjects.Graphics, aura: Phaser.GameObjects.Graphics, now: number): void {
    const rx = R + 13;
    ground.fillStyle(PLAGUE_HAZE, pulse(now, 0.7, 0.1, 0.2)).fillEllipse(0, 0, rx * 2, rx * 2 * Y_SCALE);
    for (let i = 0; i < HAZE_DOTS; i++) {
      const p = life(now, 1500, i, HAZE_DOTS);
      const x = Math.sin(i * 2.4 + p * 2) * R * 0.85;
      const y = -BODY_LIFT + 8 - p * 28;
      aura.fillStyle(PLAGUE_DOT, Math.sin(Math.PI * p) * 0.75).fillCircle(x, y, 1.4 + 1.2 * (1 - p));
    }
  }

  /**
   * Plague's execute is running (a Plague is engaged and this fighter is under half hp): a pulsing toothed ring under
   * the body and a little skull beside the hp bar.
   */
  private drawExecute(ground: Phaser.GameObjects.Graphics, aura: Phaser.GameObjects.Graphics, now: number): void {
    const beat = pulse(now, 2.5);
    ground.fillStyle(EXECUTE_FILL, 0.2 + 0.2 * beat).lineStyle(2, EXECUTE_EDGE, 0.5 + 0.5 * beat).beginPath();
    for (let i = 0; i < EXECUTE_TEETH * 2; i++) {
      const th = (i / (EXECUTE_TEETH * 2)) * TAU;
      const r = i % 2 === 0 ? EXECUTE_R_OUT : EXECUTE_R_IN;
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r * Y_SCALE;
      if (i === 0) ground.moveTo(x, y);
      else ground.lineTo(x, y);
    }
    ground.closePath().fillPath().strokePath();

    // The skull sits to the right of the hp bar (hp bar top = -BODY_LIFT - R - 8, 4 px tall).
    const sx = this.barHalfW + 9;
    const sy = -BODY_LIFT - R - 6;
    aura.fillStyle(EXECUTE_EDGE, 0.15 + 0.25 * beat).fillCircle(sx, sy, 8);
    aura.fillStyle(SKULL_BONE, 1).lineStyle(1, SKULL_DARK, 0.9);
    aura.fillCircle(sx, sy - 1, 4.6).strokeCircle(sx, sy - 1, 4.6);
    aura.fillRect(sx - 2.6, sy + 2, 5.2, 3.2).strokeRect(sx - 2.6, sy + 2, 5.2, 3.2);
    aura.fillStyle(SKULL_DARK, 1).fillCircle(sx - 1.9, sy - 1.2, 1.3).fillCircle(sx + 1.9, sy - 1.2, 1.3);
    aura.lineStyle(1, SKULL_DARK, 0.9).lineBetween(sx - 0.8, sy + 2, sx - 0.8, sy + 5).lineBetween(sx + 0.8, sy + 2, sx + 0.8, sy + 5);
  }

  /**
   * Sentenced's brand: a sigil on the floor that grows with the mark (a bigger, brighter ring whose bright arc closes
   * at 100, and a pentagram that gains a stroke per fifth). Complete, it pulses and sends a ring outward, and a purple
   * glow wraps the body.
   */
  private drawBrand(ground: Phaser.GameObjects.Graphics, aura: Phaser.GameObjects.Graphics, brand: number, now: number): void {
    const b = brandLook(brand);
    if (!b) return;
    const beat = b.full ? pulse(now, 1.6, 0.75, 1) : 1;
    const a = b.alpha * beat;
    const rx = b.rx;
    const ry = rx * Y_SCALE;

    ground.fillStyle(BRAND_FILL, 0.07 + 0.13 * b.k).fillEllipse(0, 0, rx * 2, ry * 2);
    ground.lineStyle(2, BRAND_RING, a * 0.4).strokeEllipse(0, 0, rx * 2, ry * 2);
    // The bright arc runs clockwise from the top and closes the ring at 100.
    const steps = Math.max(3, Math.ceil(56 * b.k));
    ground.lineStyle(3, BRAND_RING, a).beginPath();
    for (let i = 0; i <= steps; i++) {
      const th = -Math.PI / 2 + (i / steps) * TAU * b.k;
      const x = Math.cos(th) * rx;
      const y = Math.sin(th) * ry;
      if (i === 0) ground.moveTo(x, y);
      else ground.lineTo(x, y);
    }
    ground.strokePath();

    // A turning pentagram, one stroke per fifth of the brand.
    const rot = now * 0.0004 * (0.5 + b.k);
    const sr = rx * 0.72;
    ground.lineStyle(1.5, BRAND_STAR, a * 0.9);
    for (let i = 0; i < b.strokes; i++) {
      const t0 = rot + (i / 5) * TAU;
      const t1 = rot + (((i + 2) % 5) / 5) * TAU;
      ground.lineBetween(Math.cos(t0) * sr, Math.sin(t0) * sr * Y_SCALE, Math.cos(t1) * sr, Math.sin(t1) * sr * Y_SCALE);
    }

    if (b.full) {
      const p = (now / 900) % 1;
      ground.lineStyle(2, BRAND_RING, (1 - p) * 0.6).strokeEllipse(0, 0, rx * 2 * (1 + 0.35 * p), ry * 2 * (1 + 0.35 * p));
      aura.lineStyle(3, BRAND_RING, 0.45 + 0.4 * pulse(now, 1.6)).strokeCircle(0, -BODY_LIFT, R + 5);
    }
  }

  /** A fighter a Fire is engaged with: a few embers rising off it and a faint hot rim. Subtle on purpose. */
  private drawEmbers(aura: Phaser.GameObjects.Graphics, now: number): void {
    const flicker = pulse(now, 9, 0, 1);
    aura.lineStyle(2, 0xff7043, 0.25 + 0.25 * flicker).strokeCircle(0, -BODY_LIFT, R + 1);
    for (let i = 0; i < EMBERS; i++) {
      const p = life(now, 800, i, EMBERS);
      const x = Math.sin(i * 1.9) * R * 0.9 + Math.sin(p * 6 + i) * 2;
      const y = -BODY_LIFT + 6 - p * 34;
      const spark = 0.55 + 0.45 * Math.sin(now / 55 + i * 5);
      aura.fillStyle(EMBER_COLORS[i % EMBER_COLORS.length]!, (1 - 0.6 * p) * spark).fillCircle(x, y, 1.3 + 1.9 * (1 - p));
    }
  }

  /** Chilled: an icy rim, a pale film over the body and a ring of crystals (the same look whoever chills it). */
  private drawFrost(aura: Phaser.GameObjects.Graphics, now: number): void {
    const cy = -BODY_LIFT;
    aura.fillStyle(ICE_FILL, 0.22).fillCircle(0, cy, R);
    aura.lineStyle(2.5, ICE_RIM, 0.9).strokeCircle(0, cy, R + 1.5);
    for (let i = 0; i < CRYSTALS; i++) {
      const th = (i / CRYSTALS) * TAU + 0.35;
      const len = i % 2 === 0 ? 11 : 7.5;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const bx = c * (R + 0.5);
      const by = cy + s * (R + 0.5);
      // Base corners sit either side of the spoke; the tip points away from the body.
      const px = -s * 3.5;
      const py = c * 3.5;
      const shine = 0.8 + 0.2 * Math.sin(now / 220 + i * 1.3);
      aura.fillStyle(ICE_RIM, shine).lineStyle(1, ICE_EDGE, 0.7);
      aura.fillTriangle(bx + px, by + py, bx - px, by - py, bx + c * len, by + s * len);
      aura.strokeTriangle(bx + px, by + py, bx - px, by - py, bx + c * len, by + s * len);
    }
  }
}
