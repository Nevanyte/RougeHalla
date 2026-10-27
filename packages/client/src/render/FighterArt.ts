// How a fighter looks beyond its body disc: the weapon in hand, a shield's block arc and the bow's draw. Shared by
// PlayerView and MobView, which pass the synced fields and read nothing else; everything here is cosmetic.
import Phaser from "phaser";
import {
  FACTIONS, FISTS, GOLD_COLOR, PLAYER_RADIUS, SHIELD_HALF_ARC, WEAPONS, WIRE_IDENTITY_MIRRORS, Y_SCALE, attackInterval, decodeMult, hpBarFractions,
  isFactionId, isWeaponId, scaleWindup, weaponTimings, type WeaponId,
} from "@raid/shared";
import { BARRIER_COLOR } from "../ui/buffTheme";
import { bakeScale, around, bakedImage, ensureBake, pixelImage, placeBake, swapBake, type Region } from "./bake";
import { traceSector } from "./groundShapes";
import { clamp01, juiceScale } from "./juice";
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
  /** The attack-speed mirror, wire form (a player's `asMult`, thousandths; a mob has none and attacks at its faction's rate). */
  asMult?: number;
  /** The windup mirror, wire form (a player's `windupMult`, thousandths; a mob has none). */
  windupMult?: number;
}

/**
 * The weapon in hand: an empty slot of a fighter with a faction is fists (what the server fights with), so a fighter whose
 * hand is empty is drawn with two fists. Null for an id from newer server content, and for an empty slot of a fighter with no
 * faction (a training dummy) or when the caller does not say (`faction` left out).
 */
export function heldWeapon(f: Pick<FighterFields, "weapon0" | "weapon1" | "slot"> & { faction?: string }): WeaponId | null {
  const id = f.slot === 1 ? f.weapon1 : f.weapon0;
  if (id === "") return f.faction !== undefined && isFactionId(f.faction) ? FISTS : null;
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
    case "fists": return R + 4;
  }
}

/**
 * Draws `w` in the local frame of a body centred on the origin, pointing along +x. `pull` is the bow's draw: -1 for
 * not drawing, else 0 (nocked) to 1 (full draw: the string and arrow glow). `tint` replaces the weapon's own colour
 * (the golden-weapon cosmetic). `charge` (0..1) is a wand's cast gathering: its orb swells and glows. `tension`: the bow's
 * arrowhead warms up before full draw (juice).
 */
export function drawWeapon(g: Phaser.GameObjects.Graphics, w: WeaponId, pull = -1, tint?: number, charge = 0, tension = false): void {
  const color = tint ?? WEAPONS[w].color;
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
      } else if (tension && pull > TENSION_FROM) {
        // The arrowhead warms up on the way to a full draw (no ring yet: that is the ready cue).
        const k = (pull - TENSION_FROM) / (1 - TENSION_FROM);
        g.fillStyle(0xfff176, 0.06 + 0.2 * k).fillCircle(R + 24, 0, 5 + 3 * k);
      }
      break;
    }
    case "wand":
      g.fillStyle(0x6d4c41, 1).fillRect(R - 3, -2, 19, 4).strokeRect(R - 3, -2, 19, 4);
      if (charge > 0) g.fillStyle(color, 0.1 + 0.22 * charge).fillCircle(R + 19, 0, 10 + 9 * charge);
      g.fillStyle(color, 0.3).fillCircle(R + 19, 0, 10);
      g.fillStyle(color, 1).fillCircle(R + 19, 0, 5.5).strokeCircle(R + 19, 0, 5.5);
      g.fillStyle(0xffffff, 0.8).fillCircle(R + 17.6, -1.8, 1.8);
      if (charge > 0) g.fillStyle(0xffffff, 0.15 + 0.5 * charge).fillCircle(R + 19, 0, 2.5 + 3 * charge);
      break;
    case "shield":
      g.lineStyle(9.5, OUTLINE, 0.9).beginPath().arc(0, 0, R + 6, -0.85, 0.85).strokePath();
      g.lineStyle(7, color, 1).beginPath().arc(0, 0, R + 6, -0.85, 0.85).strokePath();
      g.lineStyle(1.5, OUTLINE, 0.95).fillStyle(0xeceff1, 1).fillCircle(R + 6, 0, 2.5).strokeCircle(R + 6, 0, 2.5);
      break;
    case "fists":
      // Two round fists up front in a guard, the leading one a little further out, each with a pale knuckle highlight.
      g.fillStyle(color, 1).fillCircle(R + 5, -6.5, 4.8).strokeCircle(R + 5, -6.5, 4.8);
      g.fillStyle(color, 1).fillCircle(R + 1.5, 6.5, 4.8).strokeCircle(R + 1.5, 6.5, 4.8);
      g.fillStyle(0xffffff, 0.45).fillCircle(R + 6.6, -7.9, 1.5).fillCircle(R + 3.1, 5.1, 1.5);
      break;
  }
}

/** Radius of the drawn block arc; the real cone has no length, so this only has to be readable. */
const BLOCK_ARC_RADIUS = 40;
const BLOCK_FILL = 0x90a4ae;
const BLOCK_EDGE = 0xcfd8dc;
/** The bow pull is redrawn in this many steps; smoother than the eye can tell at 20 Hz patches. */
const PULL_STEPS = 16;
/** A bow's arrowhead starts to glow past this share of the draw (full draw has its own, stronger cue). */
const TENSION_FROM = 0.6;
/** The wand's charge glow is redrawn in this many steps. */
const CHARGE_STEPS = 8;
/**
 * The held weapon is drawn a little over life size: the body disc is only 24 px across and the weapon is what tells a
 * far-off fighter's kit apart.
 */
const HELD_SCALE = 1.15;
/**
 * A chill pushes a draw's start time later by under 0.6 x one tick (30 ms) per tick; a new start further ahead than this
 * is a new draw (the next one after a shot), not the same draw slowing down.
 */
const DRAW_PUSH_SLACK_MS = 100;

/**
 * Seconds a bow takes to loose (the server's own formula, timingsOf: the interval shrinks with the attack-speed mirror
 * `asMult`, the windup is a share of it up to a cap, and the windup mirror `windupMult` then scales it through scaleWindup),
 * or 0 without a faction. Both mirrors are the wire form (thousandths), as the state carries them; an absent one is the
 * identity. The draw is fixed now, so full pull is the whole windup. A mob's faction is scaled down in hp and damage only,
 * so its rate, and with it the draw, is the plain faction's, with no mirrors.
 */
export function fullDrawSeconds(
  faction: string, asMult: number = WIRE_IDENTITY_MIRRORS.asMult, windupMult: number = WIRE_IDENTITY_MIRRORS.windupMult,
): number {
  if (!isFactionId(faction)) return 0;
  const timings = weaponTimings("bow", attackInterval(FACTIONS[faction], "bow", decodeMult(asMult)));
  return scaleWindup(timings, decodeMult(windupMult)).windup;
}

/** One start of a draw as the server had it, and the server time of the patch that first showed it. */
interface DrawStart { patchT: number; start: number }

/**
 * Follows one fighter's bow draw (its synced `drawStartedAt`) for display. The state runs ahead of what is drawn, and a
 * chill pushes the start later a little every tick, so the pull at render time must use the start the server had back
 * then: the newest one would understate it by the push made over the render delay.
 */
export class DrawTrack {
  /** The start in effect at render time (0 = no draw). */
  start = 0;
  /** Starts not yet passed by render time: the one in effect first, then the newer ones by patch time. */
  private readonly starts: DrawStart[] = [];
  /** The newest start, whose pushes a restart is told from. */
  private latest = 0;
  /** The server time the draw stopped (Infinity = still on). */
  private end = Infinity;
  /** Render time has reached this draw's start at least once; from then on it stays on screen. */
  private shown = false;

  /** Once per frame with the fighter's synced `drawStartedAt`; true while a draw is on screen at `renderT`. */
  track(drawStartedAt: number, renderT: number, patchT: number): boolean {
    if (drawStartedAt > 0) {
      const ahead = drawStartedAt - this.latest;
      if (this.latest === 0 || this.end !== Infinity || ahead < 0 || ahead > DRAW_PUSH_SLACK_MS) {
        // A new draw: the first one, or the next after a shot.
        this.starts.length = 0;
        this.starts.push({ patchT, start: drawStartedAt });
        this.end = Infinity;
        this.shown = false;
      } else if (drawStartedAt !== this.latest) {
        // The same draw, its start pushed later by a chill.
        this.starts.push({ patchT, start: drawStartedAt });
      }
      this.latest = drawStartedAt;
    } else if (this.latest > 0 && this.end === Infinity) {
      this.end = patchT;
    }
    if (this.latest === 0) return false;
    if (renderT >= this.end) {
      this.reset();
      return false;
    }
    // Keep the newest start render time has reached, and anything newer.
    while (this.starts.length > 1 && this.starts[1]!.patchT <= renderT) this.starts.shift();
    this.start = this.starts[0]!.start;
    // A pushed start can slip back ahead of render time for a frame or two; once shown, the draw stays up instead of
    // blinking out and in.
    if (renderT >= this.start) this.shown = true;
    return this.shown;
  }

  private reset(): void {
    this.start = 0;
    this.latest = 0;
    this.starts.length = 0;
    this.end = Infinity;
    this.shown = false;
  }
}

/** Where a weapon's drawing sits in its texture: the body's centre is the origin, +x is the way it points. Wide enough for every weapon, glow and ring. */
export const WEAPON_REGION: Region = { x0: -22, y0: -24, x1: 56, y1: 24 };

/** The block arc is baked in this many facings around the circle; the arc turns in steps of 360 / SECTOR_FACINGS degrees. */
const SECTOR_FACINGS = 96;
/** The ground sector's region: the radius, the flattening and a little for the rim line. */
const SECTOR_REGION: Region = {
  x0: -(BLOCK_ARC_RADIUS + 2), y0: -(BLOCK_ARC_RADIUS * Y_SCALE + 2), x1: BLOCK_ARC_RADIUS + 2, y1: BLOCK_ARC_RADIUS * Y_SCALE + 2,
};

/**
 * The texture of a weapon as it is held (a bake of `drawWeapon`, shared by every fighter that looks the same): `pullStep` is the bow's
 * draw in PULL_STEPS (-1 = not drawing), `chargeStep` the wand's glow in CHARGE_STEPS, `gold` the golden weapon look and `tension`
 * the juice flag of the warming arrowhead. Returns the texture key.
 */
export function weaponTexture(scene: Phaser.Scene, weapon: WeaponId, pullStep = -1, gold = false, chargeStep = 0, tension = false): string {
  const key = `weapon:${weapon}:${pullStep}:${gold ? 1 : 0}:${chargeStep}:${tension ? 1 : 0}`;
  return ensureBake(scene, key, WEAPON_REGION, (g) => {
    drawWeapon(g, weapon, pullStep < 0 ? -1 : pullStep / PULL_STEPS, gold ? GOLD_COLOR : undefined, chargeStep / CHARGE_STEPS, tension);
  });
}

/** The block arc facing the ground angle SECTOR_FACINGS-th part `facingIndex` of a turn. Returns the texture key. */
function sectorTexture(scene: Phaser.Scene, facingIndex: number): string {
  return ensureBake(scene, `sector:${facingIndex}`, SECTOR_REGION, (g) => {
    g.fillStyle(BLOCK_FILL, 0.16).lineStyle(1.5, BLOCK_EDGE, 0.8);
    traceSector(g, 0, 0, BLOCK_ARC_RADIUS, (facingIndex * 2 * Math.PI) / SECTOR_FACINGS, SHIELD_HALF_ARC);
    g.fillPath().strokePath();
  });
}

/** The facing as an index into the SECTOR_FACINGS bakes. */
export const facingIndexOf = (facing: number): number => {
  const turns = facing / (2 * Math.PI);
  return ((Math.round((turns - Math.floor(turns)) * SECTOR_FACINGS) % SECTOR_FACINGS) + SECTOR_FACINGS) % SECTOR_FACINGS;
};

export class FighterArt {
  /** The shield's block arc on the ground; goes under the body in the view's container. An Image of a baked arc. */
  readonly ground: Phaser.GameObjects.Image;
  /** The weapon in hand at body height; goes over the body. An Image of a baked weapon. */
  readonly held: Phaser.GameObjects.Image;
  private heldSig = "";
  private arcSig = -1;
  /** Draw the weapon in hand in gold (a golden weapon look applies). Part of the redraw signature. */
  private gold = false;
  private readonly draw = new DrawTrack();
  /** Juice: a turn added to the weapon's facing (a wind-up or a swing's sweep). */
  poseRot = 0;
  /** The bow's pull as drawn at the last update (-1 = not drawing), which the figure's tension and lean follow. */
  pull = -1;
  /** Juice: the wand's cast charge in CHARGE_STEPS (0 = none). */
  private chargeStep = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ground = pixelImage(scene).setVisible(false);
    placeBake(this.ground, SECTOR_REGION);
    this.held = pixelImage(scene).setVisible(false).setPosition(0, -BODY_LIFT);
    placeBake(this.held, WEAPON_REGION);
    this.held.setScale(HELD_SCALE / bakeScale());
  }

  /** Golden weapon look on or off; takes effect at the next update(). */
  setGold(on: boolean): void {
    this.gold = on;
  }

  /** A wand's cast charge, 0..1 (juice); takes effect at the next update(). */
  setCharge(charge: number): void {
    this.chargeStep = Math.round(clamp01(charge) * CHARGE_STEPS);
  }

  /**
   * `renderT`: the server time being drawn. `patchT`: the server time of the newest patch, which stamps when a draw
   * stopped (the state ran ahead of what is drawn, so the pull is kept until render time reaches that moment).
   * Returns the weapon in hand (fists for the empty hand of a fighter with a faction).
   */
  update(f: FighterFields, renderT: number, patchT: number): WeaponId | null {
    const weapon = heldWeapon(f);
    // Tracked every frame, not only with a bow in hand, so a draw that a swap cancelled can't linger.
    const drawing = this.draw.track(f.drawStartedAt, renderT, patchT);
    // Only while a bow is being drawn: the time to full draw follows the attack-speed and windup mirrors, which change with a drop.
    const full = weapon === "bow" && drawing ? fullDrawSeconds(f.faction, f.asMult, f.windupMult) : 0;
    // Clamped at both ends: a chill can leave the start a few ms ahead of render time while the draw is on screen.
    const pull = full > 0 ? Math.max(0, Math.min(1, (renderT - this.draw.start) / 1000 / full)) : -1;
    this.pull = pull;

    this.held.setVisible(weapon !== null).setRotation(screenAngle(f.facing) + this.poseRot);
    const charge = weapon === "wand" ? this.chargeStep : 0;
    // The last step is the full draw's ring and glow, so it is only taken at a full draw, not by rounding up from 97%.
    const pullStep = pull < 0 ? -1 : pull >= 1 ? PULL_STEPS : Math.min(PULL_STEPS - 1, Math.round(pull * PULL_STEPS));
    const sig = `${weapon ?? ""}|${pullStep}|${this.gold ? 1 : 0}|${charge}`;
    if (sig !== this.heldSig) {
      this.heldSig = sig;
      if (weapon) {
        const key = weaponTexture(this.scene, weapon, pullStep, this.gold, charge, juiceScale("flash") > 0);
        if (this.held.texture.key !== key) this.held.setTexture(key);
      }
    }

    // Ground angles, not screen ones: the arc is built from projected ground points (see groundShapes).
    const arc = weapon === "shield" ? facingIndexOf(f.facing) : -1;
    if (arc !== this.arcSig) {
      this.arcSig = arc;
      this.ground.setVisible(arc >= 0);
      if (arc >= 0) this.ground.setTexture(sectorTexture(this.scene, arc));
    }
    return weapon;
  }
}

/** The soft dark ellipse under every fighter: a bake shared by all of them. */
const SHADOW_REGION: Region = { x0: -R * 1.1 - 2, y0: -R * 0.55 - 2, x1: R * 1.1 + 2, y1: R * 0.55 + 2 };
export function shadowImage(scene: Phaser.Scene): Phaser.GameObjects.Image {
  return bakedImage(scene, "shadow", SHADOW_REGION, (g) => { g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, R * 2.2, R * 1.1); });
}

const HP_BAR_H = 4;
const BAR_BACK_COLOR = 0x000000;

/**
 * The small hp bar over a fighter: hp in green to red, then the barrier in pale blue after it (both as shares of
 * max hp). `top` is the bar's y in the view's local frame. It changes only when what it shows moves by half a pixel or
 * its colour changes. Three flat rectangles, each an Image of the shared 1x1 white texture.
 */
export class HpBar {
  /** Goes in the view's container where the bar belongs. */
  readonly root: Phaser.GameObjects.Container;
  private readonly back: Phaser.GameObjects.Image;
  private readonly fill: Phaser.GameObjects.Image;
  private readonly barrier: Phaser.GameObjects.Image;
  private sig = "";

  constructor(scene: Phaser.Scene) {
    this.back = pixelImage(scene).setOrigin(0, 0).setTint(BAR_BACK_COLOR).setAlpha(0.6);
    this.fill = pixelImage(scene).setOrigin(0, 0);
    this.barrier = pixelImage(scene).setOrigin(0, 0).setTint(BARRIER_COLOR);
    this.root = scene.add.container(0, 0, [this.back, this.fill, this.barrier]).setVisible(false);
  }

  draw(hp: number, maxHp: number, barrier: number, top: number, w = 28): void {
    const share = hpBarFractions(hp, maxHp, barrier);
    const hpPx = Math.round(share.hp * w * 2);
    const barrierPx = Math.round(share.barrier * w * 2);
    // The colour follows hp against max hp: a barrier that shrinks the bar's scale must not turn healthy hp yellow or red.
    const f = Math.min(1, Math.max(0, hp / (maxHp > 0 ? maxHp : 1)));
    const color = f > 0.5 ? 0x66bb6a : f > 0.25 ? 0xffca28 : 0xef5350;
    // The colour is in the signature: crossing 50% or 25% inside the same half pixel must still repaint.
    const sig = `${hpPx}|${barrierPx}|${w}|${top}|${color}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.setVisible(true);
    this.back.setPosition(-w / 2, top).setDisplaySize(w, HP_BAR_H);
    this.fill.setVisible(hpPx > 0);
    if (hpPx > 0) this.fill.setPosition(-w / 2, top).setDisplaySize(hpPx / 2, HP_BAR_H).setTint(color);
    this.barrier.setVisible(barrierPx > 0);
    if (barrierPx > 0) this.barrier.setPosition(-w / 2 + hpPx / 2, top).setDisplaySize(barrierPx / 2, HP_BAR_H);
  }

  /** Draws nothing (a mob at full health out of a fight). A no-op while already hidden. */
  hide(): void {
    if (this.sig === "") return;
    this.sig = "";
    this.root.setVisible(false);
  }
}

/** The look of a disc's rim: a stroke centred on the edge. Width 0 = no rim. */
export interface Rim {
  readonly width: number;
  readonly color: number;
  readonly alpha: number;
}

const hex = (n: number): string => (n >>> 0).toString(16);

/**
 * A flat disc with an optional rim, as an Image of a baked circle: the body of a fighter (faction colour, a rim that cosmetics
 * and the elite mark change) and its skin core. A new colour or rim swaps the texture for another bake, so a handful of looks
 * are shared by everyone.
 */
export class BodyDisc {
  readonly image: Phaser.GameObjects.Image;
  private fill: number;
  private rim: Rim;
  private key = "";

  constructor(private readonly scene: Phaser.Scene, private readonly radius: number, fill: number, rim: Rim = { width: 0, color: 0, alpha: 1 }) {
    this.fill = fill;
    this.rim = rim;
    this.image = pixelImage(scene);
    placeBake(this.image, this.region());
    this.apply();
  }

  /** Room for the widest rim any cosmetic gives. */
  private region(): Region {
    return around(this.radius + 5);
  }

  setFill(color: number): void {
    if (color === this.fill) return;
    this.fill = color;
    this.apply();
  }

  setRim(width: number, color: number, alpha: number): void {
    const r = this.rim;
    if (r.width === width && r.color === color && r.alpha === alpha) return;
    this.rim = { width, color, alpha };
    this.apply();
  }

  private apply(): void {
    const { radius, fill, rim } = this;
    const key = `disc:${radius}:${hex(fill)}:${rim.width}:${hex(rim.color)}:${rim.alpha}`;
    if (key === this.key) return;
    this.key = key;
    swapBake(this.image, this.scene, key, this.region(), (g) => {
      g.fillStyle(fill, 1).fillCircle(0, 0, radius);
      if (rim.width > 0) g.lineStyle(rim.width, rim.color, rim.alpha).strokeCircle(0, 0, radius);
    });
  }
}

/** A white flash on a body disc for a moment; polled from the view's update() so no timer needs cleaning up. */
export class BodyFlash {
  private until = 0;
  private on = false;

  constructor(private readonly body: BodyDisc, private color: number) {}

  setColor(color: number): void {
    if (color === this.color) return;
    this.color = color;
    if (!this.on) this.body.setFill(color);
  }

  trigger(ms: number): void {
    this.until = performance.now() + ms;
    if (!this.on) {
      this.on = true;
      this.body.setFill(0xffffff);
    }
  }

  tick(): void {
    if (this.on && performance.now() >= this.until) {
      this.on = false;
      this.until = 0;
      this.body.setFill(this.color);
    }
  }
}
