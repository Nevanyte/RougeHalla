// How a fighter looks beyond its body disc: the weapon in hand, a shield's block arc and the bow's draw. Shared by
// PlayerView and MobView, which pass the synced fields and read nothing else; everything here is cosmetic.
import Phaser from "phaser";
import {
  FACTIONS, PLAYER_RADIUS, SHIELD_HALF_ARC, WEAPONS, attackInterval, isFactionId, isWeaponId, weaponTimings,
  type WeaponId,
} from "@raid/shared";
import { traceSector } from "./groundShapes";
import { BODY_LIFT, screenAngle } from "./projection";

export const NEUTRAL_COLOR = 0x9e9e9e;
const OUTLINE = 0x1b1f24;
const R = PLAYER_RADIUS;

/** Faction colour for a synced faction id; fighters without one (training dummies) are grey. */
export function factionColor(faction: string): number {
  return isFactionId(faction) ? FACTIONS[faction].color : NEUTRAL_COLOR;
}

/** The synced fields a fighter's look reads; PlayerState and MobState both have them. */
export interface FighterFields {
  facing: number;
  faction: string;
  weapon0: string;
  weapon1: string;
  slot: number;
  drawStartedAt: number;
}

/** The weapon in hand, or null (an empty slot, or an id from newer server content). */
export function heldWeapon(f: Pick<FighterFields, "weapon0" | "weapon1" | "slot">): WeaponId | null {
  const id = f.slot === 1 ? f.weapon1 : f.weapon0;
  return isWeaponId(id) ? id : null;
}

/** Where along +x each silhouette's middle sits, so an icon can be centred on a point (ground weapons). */
export function weaponCenterX(w: WeaponId): number {
  switch (w) {
    case "sword": return R + 14;
    case "axe": return R + 13;
    case "bow": return R + 9;
    case "wand": return R + 10;
    case "shield": return R + 4;
  }
}

/**
 * Draws `w` in the local frame of a body centred on the origin, pointing along +x. `pull` is the bow's draw: -1 for
 * not drawing, else 0 (nocked) to 1 (full draw: the string and arrow glow).
 */
export function drawWeapon(g: Phaser.GameObjects.Graphics, w: WeaponId, pull = -1): void {
  const color = WEAPONS[w].color;
  // A dark, fairly opaque edge on every part so the silhouette holds against both light and dark floors.
  g.lineStyle(1.5, OUTLINE, 0.95);
  switch (w) {
    case "sword":
      g.fillStyle(0x6d4c41, 1).fillRect(R - 4, -1.8, 6, 3.6).strokeRect(R - 4, -1.8, 6, 3.6);
      g.fillStyle(0xffd54f, 1).fillRect(R + 1, -5.5, 3, 11).strokeRect(R + 1, -5.5, 3, 11);
      g.fillStyle(color, 1).fillRect(R + 4, -2.5, 24, 5).strokeRect(R + 4, -2.5, 24, 5);
      g.fillTriangle(R + 28, -2.5, R + 28, 2.5, R + 35, 0);
      g.beginPath().moveTo(R + 28, -2.5).lineTo(R + 35, 0).lineTo(R + 28, 2.5).strokePath();
      break;
    case "axe":
      g.fillStyle(0x8d6e63, 1).fillRect(R - 3, -2, 30, 4).strokeRect(R - 3, -2, 30, 4);
      g.fillStyle(color, 1).beginPath()
        .moveTo(R + 15, -1.5).lineTo(R + 19, -10).lineTo(R + 29, -8).lineTo(R + 26, 0).lineTo(R + 29, 8).lineTo(R + 19, 10)
        .lineTo(R + 15, 1.5).closePath().fillPath().strokePath();
      break;
    case "bow": {
      // The arc bulges forward; the string's middle is pulled back toward the body while drawing.
      const tipX = R + 5;
      const tipY = 14.3;
      const ready = pull >= 1;
      const nockX = tipX - 9 * Math.max(0, Math.min(1, pull));
      g.lineStyle(6, OUTLINE, 0.9).beginPath().arc(R - 4, 0, 17, -1, 1).strokePath();
      g.lineStyle(3.5, color, 1).beginPath().arc(R - 4, 0, 17, -1, 1).strokePath();
      g.lineStyle(1.2, ready ? 0xfff59d : 0xeceff1, 0.95).beginPath().moveTo(tipX, -tipY).lineTo(nockX, 0).lineTo(tipX, tipY).strokePath();
      if (pull >= 0) {
        g.lineStyle(1.5, 0xefebe9, 1).lineBetween(nockX, 0, R + 22, 0);
        g.fillStyle(ready ? 0xfff176 : 0xcfd8dc, 1).fillTriangle(R + 22, -2.5, R + 22, 2.5, R + 28, 0);
      }
      if (ready) {
        g.fillStyle(0xfff176, 0.35).fillCircle(R + 24, 0, 8);
        g.lineStyle(2, 0xfff176, 0.7).strokeCircle(0, 0, R + 4);
      }
      break;
    }
    case "wand":
      g.fillStyle(0x6d4c41, 1).fillRect(R - 3, -2, 19, 4).strokeRect(R - 3, -2, 19, 4);
      g.fillStyle(color, 0.3).fillCircle(R + 19, 0, 10);
      g.fillStyle(color, 1).fillCircle(R + 19, 0, 5.5).strokeCircle(R + 19, 0, 5.5);
      g.fillStyle(0xffffff, 0.8).fillCircle(R + 17.6, -1.8, 1.8);
      break;
    case "shield":
      g.lineStyle(9.5, OUTLINE, 0.9).beginPath().arc(0, 0, R + 6, -0.85, 0.85).strokePath();
      g.lineStyle(7, color, 1).beginPath().arc(0, 0, R + 6, -0.85, 0.85).strokePath();
      g.lineStyle(1.5, OUTLINE, 0.95).fillStyle(0xeceff1, 1).fillCircle(R + 6, 0, 2.5).strokeCircle(R + 6, 0, 2.5);
      break;
  }
}

/** Radius of the drawn block arc; the real cone has no length, so this only has to be readable. */
const BLOCK_ARC_RADIUS = 40;
const BLOCK_FILL = 0x90a4ae;
const BLOCK_EDGE = 0xcfd8dc;
/** The bow pull is redrawn in this many steps; smoother than the eye can tell at 20 Hz patches. */
const PULL_STEPS = 16;
/**
 * The held weapon is drawn a little over life size: the body disc is only 24 px across and the weapon is what tells a
 * far-off fighter's kit apart.
 */
const HELD_SCALE = 1.15;
/**
 * A chill pushes a draw's start time later by under 0.6 x one tick (30 ms) per tick; a new start further ahead than this
 * is a restart (a stagger), not the same draw slowing down.
 */
const DRAW_PUSH_SLACK_MS = 100;

const fullDraws = new Map<string, number>();
/** Seconds to a full draw for this faction's bow (the server's own formula), or 0 without a faction. */
function fullDrawSeconds(faction: string): number {
  let v = fullDraws.get(faction);
  if (v === undefined) {
    v = isFactionId(faction) ? weaponTimings("bow", attackInterval(FACTIONS[faction], "bow")).fullDraw : 0;
    fullDraws.set(faction, v);
  }
  return v;
}

export class FighterArt {
  /** The shield's block arc on the ground; goes under the body in the view's container. */
  readonly ground: Phaser.GameObjects.Graphics;
  /** The weapon in hand at body height; goes over the body. */
  readonly held: Phaser.GameObjects.Graphics;
  private heldSig = "";
  private arcSig = "";
  /** The bow draw being shown: its server start time (0 = none) and the server time it stopped (Infinity = still on). */
  private drawStart = 0;
  private drawEnd = Infinity;
  /** Render time has reached this draw's start at least once; from then on it stays on screen (see trackDraw). */
  private drawShown = false;

  constructor(scene: Phaser.Scene) {
    this.ground = scene.add.graphics();
    this.held = scene.add.graphics().setPosition(0, -BODY_LIFT).setScale(HELD_SCALE);
  }

  /**
   * `renderT`: the server time being drawn. `patchT`: the server time of the newest patch, which stamps when a draw
   * stopped (the state ran ahead of what is drawn, so the pull is kept until render time reaches that moment).
   * Returns the weapon in hand.
   */
  update(f: FighterFields, renderT: number, patchT: number): WeaponId | null {
    const weapon = heldWeapon(f);
    // Tracked every frame, not only with a bow in hand, so a draw that a swap cancelled can't linger.
    const drawing = this.trackDraw(f, renderT, patchT);
    const full = fullDrawSeconds(f.faction);
    // Clamped at both ends: a chill can leave the start a few ms ahead of render time while the draw is on screen.
    const pull = weapon === "bow" && drawing && full > 0 ? Math.max(0, Math.min(1, (renderT - this.drawStart) / 1000 / full)) : -1;

    this.held.setVisible(weapon !== null).setRotation(screenAngle(f.facing));
    const sig = `${weapon ?? ""}|${pull < 0 ? -1 : Math.round(pull * PULL_STEPS)}`;
    if (sig !== this.heldSig) {
      this.heldSig = sig;
      this.held.clear();
      if (weapon) drawWeapon(this.held, weapon, pull);
    }

    // Ground angles, not screen ones: the arc is built from projected ground points (see groundShapes).
    const arcSig = weapon === "shield" ? String(Math.round(f.facing * 200)) : "";
    if (arcSig !== this.arcSig) {
      this.arcSig = arcSig;
      this.ground.clear();
      if (weapon === "shield") {
        this.ground.fillStyle(BLOCK_FILL, 0.16).lineStyle(1.5, BLOCK_EDGE, 0.8);
        traceSector(this.ground, 0, 0, BLOCK_ARC_RADIUS, f.facing, SHIELD_HALF_ARC);
        this.ground.fillPath().strokePath();
      }
    }
    return weapon;
  }

  /** True while a draw is on screen at `renderT`. */
  private trackDraw(f: FighterFields, renderT: number, patchT: number): boolean {
    if (f.drawStartedAt > 0) {
      const ahead = f.drawStartedAt - this.drawStart;
      if (this.drawStart === 0 || this.drawEnd !== Infinity || ahead < 0 || ahead > DRAW_PUSH_SLACK_MS) {
        // A new draw: the first one, or a stagger restarting it.
        this.drawStart = f.drawStartedAt;
        this.drawEnd = Infinity;
        this.drawShown = false;
      } else {
        // The same draw, its start pushed later by a chill (or unchanged).
        this.drawStart = f.drawStartedAt;
      }
    } else if (this.drawStart > 0 && this.drawEnd === Infinity) {
      this.drawEnd = patchT;
    }
    if (this.drawStart === 0) return false;
    if (renderT >= this.drawEnd) {
      this.drawStart = 0;
      this.drawEnd = Infinity;
      this.drawShown = false;
      return false;
    }
    // A pushed start can slip back ahead of render time for a frame or two; once shown, the draw stays up instead of
    // blinking out and in.
    if (renderT >= this.drawStart) this.drawShown = true;
    return this.drawShown;
  }
}

/** The small hp bar over a fighter: `top` is its y in the view's local frame. */
export function drawHpBar(g: Phaser.GameObjects.Graphics, frac: number, top: number, w = 28): void {
  const f = Math.max(0, Math.min(1, frac));
  g.clear();
  g.fillStyle(0x000000, 0.6).fillRect(-w / 2, top, w, 4);
  g.fillStyle(f > 0.5 ? 0x66bb6a : f > 0.25 ? 0xffca28 : 0xef5350, 1).fillRect(-w / 2, top, w * f, 4);
}

/** A white flash on a body disc for a moment; polled from the view's update() so no timer needs cleaning up. */
export class BodyFlash {
  private until = 0;
  private on = false;

  constructor(private readonly body: Phaser.GameObjects.Arc, private color: number) {}

  setColor(color: number): void {
    if (color === this.color) return;
    this.color = color;
    if (!this.on) this.body.setFillStyle(color);
  }

  trigger(ms: number): void {
    this.until = performance.now() + ms;
    if (!this.on) {
      this.on = true;
      this.body.setFillStyle(0xffffff);
    }
  }

  tick(): void {
    if (this.on && performance.now() >= this.until) {
      this.on = false;
      this.until = 0;
      this.body.setFillStyle(this.color);
    }
  }
}
