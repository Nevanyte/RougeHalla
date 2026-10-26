// What the timed statuses (the synced `effects` bits) look like on the fighter they act on, one layer per bit. Cosmetic and
// redrawn every frame while anything is active, from the latest synced bits; animation runs on the local clock. A fighter
// that is hidden has no layer here: PlayerView does not draw a hidden remote fighter at all, and draws the local one faint.
// Everything is drawn in the view's container, in the fighter's local frame: the feet are (0, 0), the body disc is centred
// BODY_LIFT above, and ground shapes are squashed by Y_SCALE like every other ground shape. Reduced motion zeroes the motion
// (stars stop circling, streaks stop drifting) and keeps the pictures.
import Phaser from "phaser";
import {
  EFFECT_ANTI_HEAL, EFFECT_ATTACK_SLOWED, EFFECT_CASTING, EFFECT_DOT, EFFECT_HASTE, EFFECT_LAST_STAND, EFFECT_ROOTED, EFFECT_SILENCED,
  EFFECT_SLOWED, EFFECT_STUNNED, EFFECT_UNTARGETABLE, EFFECT_ZONED, PLAYER_RADIUS, Y_SCALE,
} from "@raid/shared";
import { juiceScale } from "./juice";
import { BODY_LIFT } from "./projection";
import { life, pulse } from "./signatureLook";

const R = PLAYER_RADIUS;
const TAU = Math.PI * 2;
const CY = -BODY_LIFT;
/** Above the hp bar and below the name: where the stun stars circle. */
const HEAD_Y = CY - R - 11;

export type StatusLayerId =
  | "root" | "zoned" | "casting" | "lastStand" | "untargetable" | "haste" | "slow" | "dot" | "stun" | "silence" | "attackSlow" | "antiHeal";

/** Where a layer is drawn: on the floor (under nothing else here), at body height, or by the head and hp bar. */
export type StatusPlane = "ground" | "body" | "head";

export interface StatusLayer {
  id: StatusLayerId;
  /** The EFFECT_* bit that shows it. */
  bit: number;
  plane: StatusPlane;
}

/** Every layer, in draw order: the floor first, then the body, then the marks by the head. */
const LAYERS: readonly StatusLayer[] = [
  { id: "root", bit: EFFECT_ROOTED, plane: "ground" },
  { id: "zoned", bit: EFFECT_ZONED, plane: "ground" },
  { id: "casting", bit: EFFECT_CASTING, plane: "body" },
  { id: "lastStand", bit: EFFECT_LAST_STAND, plane: "body" },
  { id: "untargetable", bit: EFFECT_UNTARGETABLE, plane: "body" },
  { id: "haste", bit: EFFECT_HASTE, plane: "body" },
  { id: "slow", bit: EFFECT_SLOWED, plane: "body" },
  { id: "dot", bit: EFFECT_DOT, plane: "body" },
  { id: "stun", bit: EFFECT_STUNNED, plane: "head" },
  { id: "silence", bit: EFFECT_SILENCED, plane: "head" },
  { id: "attackSlow", bit: EFFECT_ATTACK_SLOWED, plane: "head" },
  { id: "antiHeal", bit: EFFECT_ANTI_HEAL, plane: "head" },
];

/** Every bit that has a layer: a frame whose effects miss all of them draws nothing and builds nothing. */
const LAYER_BITS = LAYERS.reduce((mask, l) => mask | l.bit, 0);

/** The layers `effects` calls for, in draw order. Bits with no layer here (hidden, the spare ones) are ignored. */
export function statusLayers(effects: number): StatusLayer[] {
  const bits = effects | 0;
  return LAYERS.filter((l) => (bits & l.bit) !== 0);
}

const STUN_STAR = 0xffee58;
const SHACKLE_DARK = 0x37474f;
const SHACKLE_LIGHT = 0xb0bec5;
const SILENCE_MARK = 0xce93d8;
const SLOW_BLUE = 0x4fc3f7;
const CLOCK_TEAL = 0x80cbc4;
const HEAL_RED = 0xef5350;
const CRACK_DARK = 0x3e2723;
const FLAME_OUTER = 0xff7043;
const FLAME_INNER = 0xffca28;
const OUTLINE_PALE = 0xe0e0e0;
const CHAIN_PURPLE = 0xb39ddb;
const GOLD = 0xffd54f;
const HASTE_STREAK = 0xfff59d;
const GLOW = 0xfff8e1;

/** One shared counter hands each fighter its own phase, so a crowd of stunned fighters does not circle in step. */
let nextPhase = 0;

/** A back-half point of a ground ring is hidden behind the body unless it clears the disc. */
function ringVisible(r: number, th: number): boolean {
  return Math.sin(th) >= 0 || Math.abs(Math.cos(th)) * r > R + 1;
}

export class StatusArt {
  /** One Graphics in the view's container, over the body, weapon and hp bar. */
  readonly g: Phaser.GameObjects.Graphics;
  private drawn = false;
  private readonly phase = (nextPhase++ * 0.37) % 1;

  /** `barHalfW`: half the width of the fighter's hp bar, so the anti-heal mark can sit beside it. */
  constructor(scene: Phaser.Scene, private readonly barHalfW = 14) {
    this.g = scene.add.graphics();
  }

  /** `effects`: the synced bits; `now`: performance.now(). */
  update(effects: number, now = performance.now()): void {
    const bits = effects | 0;
    // Runs for every fighter every frame: no layer list is built, the common frame (no status) returns at once.
    if ((bits & LAYER_BITS) === 0) {
      this.reset();
      return;
    }
    this.drawn = true;
    const g = this.g.clear();
    // Motion rides one clock, brightness another: reduced motion freezes the first and keeps the second.
    const tm = juiceScale("motion") > 0 ? now : 0;
    const tf = juiceScale("flash") > 0 ? now : 0;
    for (let i = 0; i < LAYERS.length; i++) {
      const layer = LAYERS[i]!;
      if ((bits & layer.bit) !== 0) this.draw(g, layer.id, tm, tf);
    }
  }

  /** Draws nothing (the fighter is not drawn, or has no status). A no-op while already clear. */
  reset(): void {
    if (!this.drawn) return;
    this.drawn = false;
    this.g.clear();
  }

  private draw(g: Phaser.GameObjects.Graphics, id: StatusLayerId, tm: number, tf: number): void {
    switch (id) {
      case "root": return this.drawShackles(g);
      case "zoned": return this.drawChain(g, tm);
      case "casting": return this.drawGlow(g, tf);
      case "lastStand": return this.drawRim(g, tf);
      case "untargetable": return this.drawDashes(g, tm);
      case "haste": return this.drawHaste(g, tm);
      case "slow": return this.drawDrag(g, tm);
      case "dot": return this.drawFlames(g, tm);
      case "stun": return this.drawStars(g, tm);
      case "silence": return this.drawSilence(g, tf);
      case "attackSlow": return this.drawClock(g, tm);
      case "antiHeal": return this.drawCrackedCross(g, tf);
    }
  }

  /** Rooted: an iron ring locked round the feet, with a chain link or two (only the front half is drawn: the body hides the rest). */
  private drawShackles(g: Phaser.GameObjects.Graphics): void {
    const r = R + 5;
    this.frontArc(g, r, 4.5, SHACKLE_DARK, 0.9);
    this.frontArc(g, r, 2.2, SHACKLE_LIGHT, 1);
    // Two chunky links where the ring meets a chain.
    g.lineStyle(1.6, SHACKLE_LIGHT, 1).fillStyle(SHACKLE_DARK, 1);
    this.link(g, r, Math.PI * 0.2);
    this.link(g, r, Math.PI * 0.8);
  }

  /** The front half of the ground ellipse of horizontal radius `r`, as one stroked path. */
  private frontArc(g: Phaser.GameObjects.Graphics, r: number, width: number, color: number, alpha: number): void {
    const steps = 14;
    g.lineStyle(width, color, alpha).beginPath();
    for (let i = 0; i <= steps; i++) {
      const th = (i / steps) * Math.PI;
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r * Y_SCALE;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  private link(g: Phaser.GameObjects.Graphics, r: number, th: number): void {
    const x = Math.cos(th) * r;
    const y = Math.sin(th) * r * Y_SCALE;
    g.fillEllipse(x, y + 1, 8, 5).strokeEllipse(x, y + 1, 8, 5);
  }

  /** In a Trial: a purple chain of links round the feet, slowly turning. */
  private drawChain(g: Phaser.GameObjects.Graphics, tm: number): void {
    const r = R + 10;
    const links = 14;
    const turn = tm * 0.0004 + this.phase * TAU;
    g.lineStyle(1.5, CHAIN_PURPLE, 0.9);
    for (let i = 0; i < links; i++) {
      const th = (i / links) * TAU + turn;
      if (!ringVisible(r, th)) continue;
      const x = Math.cos(th) * r;
      const y = Math.sin(th) * r * Y_SCALE;
      // Links alternate flat and upright, as a chain's do.
      if (i % 2 === 0) g.strokeEllipse(x, y, 7.5, 4);
      else g.strokeEllipse(x, y, 3.5, 5.5);
    }
  }

  /** Casting: a soft warm glow round the body that breathes. */
  private drawGlow(g: Phaser.GameObjects.Graphics, tf: number): void {
    g.fillStyle(GLOW, pulse(tf, 3, 0.1, 0.22)).fillCircle(0, CY, R + 5);
    g.lineStyle(1.5, GLOW, 0.4).strokeCircle(0, CY, R + 7);
  }

  /** Last Stand: a gold rim hugging the body, with a fainter one outside it. */
  private drawRim(g: Phaser.GameObjects.Graphics, tf: number): void {
    const a = pulse(tf, 1.2, 0.7, 1);
    g.fillStyle(GOLD, 0.12 * a).fillCircle(0, CY, R + 2);
    g.lineStyle(3, GOLD, a).strokeCircle(0, CY, R + 2.5);
    g.lineStyle(2, GOLD, 0.35 * a).strokeCircle(0, CY, R + 6);
  }

  /** Untargetable: a dashed outline round the body, crawling slowly. */
  private drawDashes(g: Phaser.GameObjects.Graphics, tm: number): void {
    const dashes = 10;
    const turn = tm * 0.0008 + this.phase * TAU;
    g.lineStyle(1.8, OUTLINE_PALE, 0.9);
    for (let i = 0; i < dashes; i++) {
      const a0 = (i / dashes) * TAU + turn;
      g.beginPath().arc(0, CY, R + 3.5, a0, a0 + (TAU / dashes) * 0.55).strokePath();
    }
  }

  /** Haste: short light streaks off both flanks of the body, flicking out. */
  private drawHaste(g: Phaser.GameObjects.Graphics, tm: number): void {
    g.lineStyle(1.8, HASTE_STREAK, 0.75);
    for (let k = 0; k < 3; k++) {
      const p = life(tm, 420, k, 3);
      const len = 6 + 8 * p;
      const y = CY - 6 + k * 6;
      const near = R + 3 + 4 * p;
      g.lineBetween(-near, y, -near - len, y).lineBetween(near, y, near + len, y);
    }
  }

  /** Slowed: pale-blue streaks dragging off the body's trailing side and drooping as they go. */
  private drawDrag(g: Phaser.GameObjects.Graphics, tm: number): void {
    for (let k = 0; k < 3; k++) {
      const p = life(tm, 1100, k, 3);
      const y = CY - 7 + k * 7 + p * 5;
      const x0 = -R - 2 - p * 8;
      g.lineStyle(2, SLOW_BLUE, 0.8 * (1 - p)).lineBetween(x0, y, x0 - 10, y + 3);
    }
  }

  /** Damage over time (a burning trail, a poison): small flames licking up off the body. */
  private drawFlames(g: Phaser.GameObjects.Graphics, tm: number): void {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const p = life(tm, 700, i, n);
      const bx = Math.sin(i * 2.3 + this.phase * TAU) * R * 0.8;
      const by = CY + 7 - p * 18;
      const h = 9 * (1 - 0.45 * p);
      const w = 3.2 * (1 - 0.3 * p);
      const a = 1 - 0.7 * p * p;
      this.flame(g, bx, by, w, h, FLAME_OUTER, a);
      this.flame(g, bx, by, w * 0.55, h * 0.55, FLAME_INNER, a);
    }
  }

  /** One flame: a teardrop on base (bx, by), half-width `w`, height `h`. */
  private flame(g: Phaser.GameObjects.Graphics, bx: number, by: number, w: number, h: number, color: number, alpha: number): void {
    g.fillStyle(color, alpha).beginPath().moveTo(bx - w, by).lineTo(bx - w * 0.7, by - h * 0.5).lineTo(bx, by - h)
      .lineTo(bx + w * 0.7, by - h * 0.5).lineTo(bx + w, by).closePath().fillPath();
  }

  /** Stunned: three little stars circling the head (those on the far side of the orbit are dimmer). */
  private drawStars(g: Phaser.GameObjects.Graphics, tm: number): void {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU + tm * 0.005 + this.phase * TAU;
      const x = Math.cos(th) * 13;
      const y = HEAD_Y + Math.sin(th) * 4;
      const a = Math.sin(th) < 0 ? 0.6 : 1;
      g.lineStyle(2, STUN_STAR, a).lineBetween(x - 3.5, y, x + 3.5, y).lineBetween(x, y - 3.5, x, y + 3.5);
      g.lineStyle(1, STUN_STAR, a * 0.8).lineBetween(x - 2.2, y - 2.2, x + 2.2, y + 2.2).lineBetween(x - 2.2, y + 2.2, x + 2.2, y - 2.2);
    }
  }

  /** Silenced: a small face at the head's right with a crossed-out mouth. */
  private drawSilence(g: Phaser.GameObjects.Graphics, tf: number): void {
    const x = R + 9;
    const y = CY - R + 1;
    const a = pulse(tf, 1.5, 0.75, 1);
    g.fillStyle(0x263238, 0.8 * a).fillCircle(x, y, 5.8).lineStyle(1.5, SILENCE_MARK, a).strokeCircle(x, y, 5.8);
    g.lineStyle(1.5, SILENCE_MARK, a).lineBetween(x - 3, y + 1.5, x + 3, y + 1.5);
    g.lineStyle(1.8, 0xef5350, a).lineBetween(x - 3.6, y - 3.4, x + 3.6, y + 3.4).lineBetween(x - 3.6, y + 3.4, x + 3.6, y - 3.4);
  }

  /** Attack-slowed: a clock face at the head's left whose hand creeps round. */
  private drawClock(g: Phaser.GameObjects.Graphics, tm: number): void {
    const x = -(R + 9);
    const y = CY - R + 1;
    g.fillStyle(0x263238, 0.8).fillCircle(x, y, 5.8).lineStyle(1.5, CLOCK_TEAL, 1).strokeCircle(x, y, 5.8);
    const hand = tm * 0.0012 + this.phase * TAU;
    g.lineStyle(1.5, CLOCK_TEAL, 1)
      .lineBetween(x, y, x + Math.cos(hand) * 4.2, y + Math.sin(hand) * 4.2)
      .lineBetween(x, y, x, y - 2.6);
    g.fillStyle(CLOCK_TEAL, 1).fillCircle(x, y, 1);
  }

  /** Anti-heal: a red cross with a crack through it, beside the hp bar's left end. */
  private drawCrackedCross(g: Phaser.GameObjects.Graphics, tf: number): void {
    const x = -(this.barHalfW + 9);
    const y = CY - R - 12;
    const a = pulse(tf, 1.2, 0.7, 1);
    g.fillStyle(0xffffff, 0.85 * a).fillRect(x - 5, y - 5, 10, 10);
    g.fillStyle(HEAL_RED, a).fillRect(x - 1.7, y - 4.2, 3.4, 8.4).fillRect(x - 4.2, y - 1.7, 8.4, 3.4);
    g.lineStyle(1.3, CRACK_DARK, a).beginPath().moveTo(x - 1, y - 5).lineTo(x + 1, y - 2).lineTo(x - 1.5, y + 1).lineTo(x + 1, y + 5).strokePath();
  }
}
