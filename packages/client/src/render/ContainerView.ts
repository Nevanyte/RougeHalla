// One container (chest, loose weapon, body, or a cleared camp's shared reward chest), y-sorted by its ground position like a
// player. Its shapes are baked once per look (see bake.ts) and shown as Images, so a scene full of loot stays in the same draw
// batch as the fighters and the map. A reward chest also draws its pick range and a ring that drains over CHEST_SECONDS, with
// the seconds left as text while the player is close, and a short cue when it drops (the ring and timer are the scene's, via
// setTimer); those ground marks stay a Graphics, redrawn only when the ring steps.
import Phaser from "phaser";
import { CHEST_RANGE, CHEST_SECONDS, CONSUMABLES, isConsumableId, WIND_EMBLEM_DEF, PLAYER_RADIUS, WEAPONS, Y_SCALE, type WeaponId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { bakeScale, bakedImage, placeBake, swapBake, type Region } from "./bake";
import { WEAPON_REGION, weaponCenterX, weaponTexture } from "./FighterArt";
import { containerWeapon } from "./interact";
import { easeOutCubic, juiceScale } from "./juice";
import { DEPTH_HIGHLIGHT } from "./MapView";
import { depthFor, projX, projY } from "./projection";

/** Half the chest footprint in world units; the box is drawn CHEST_HEIGHT screen pixels tall. */
const CHEST_HALF = 11;
const CHEST_HEIGHT = 11;
/** The open lid stands up behind the box this many pixels. */
const LID_HEIGHT = 9;
/** The reward chest is a little bigger than a weapon crate. */
const REWARD_HALF = CHEST_HALF + 2;
const REWARD_HEIGHT = CHEST_HEIGHT + 2;
/** How far a loose weapon floats above its shadow, and how big its icon is drawn. */
const GROUND_HOVER = 9;
const ICON_SCALE = 0.85;
const ICON_TILT = -0.6;
const DEFAULT_LABEL: Record<string, string> = { chest: "Chest", ground: "Weapon", body: "Body", reward: "Camp chest" };

// The reward chest's ground marks (world units, drawn flat on the ground layer so no player is ever covered by them).
const GOLD = 0xffd54f;
/** The timer ring's radius: it drains clockwise from the top over CHEST_SECONDS. */
export const TIMER_RING_RADIUS = 26;
/** The timer ring is redrawn in this many steps over the chest's life (a quarter second each). */
export const RING_STEPS = CHEST_SECONDS * 4;
/** The last seconds: the ring turns red. */
const URGENT_SECONDS = 5;
/** The drop cue (an expanding ring) runs this long. */
export const DROP_CUE_MS = 450;
/** The chest fades out over its last half second, so it is gone before the server removes it. */
export const FADE_OUT_S = 0.5;
/** The seconds-left text shows while the local player is within this many pick ranges of the chest. */
export const TIMER_TEXT_REACH = 2;

/** The chest's opacity with `left` seconds to live. */
export function rewardAlpha(left: number): number {
  return left >= FADE_OUT_S ? 1 : Math.max(0, left / FADE_OUT_S);
}

/** The ring's drain as a step count (0..RING_STEPS) for `left` seconds: the ring is redrawn only when it changes. */
export function ringStep(left: number): number {
  return Math.max(0, Math.min(RING_STEPS, Math.ceil((left / CHEST_SECONDS) * RING_STEPS)));
}

/** Each look's drawing region around the container's ground point. */
const CHEST_REGION: Region = { x0: -CHEST_HALF * 1.5, y0: -(CHEST_HALF * Y_SCALE + CHEST_HEIGHT + LID_HEIGHT) - 3, x1: CHEST_HALF * 1.5, y1: CHEST_HALF * Y_SCALE * 1.3 + 3 };
const REWARD_REGION: Region = { x0: -REWARD_HALF * 1.8 - 2, y0: -(REWARD_HALF * Y_SCALE + REWARD_HEIGHT) - 4, x1: REWARD_HALF * 1.8 + 2, y1: REWARD_HALF * Y_SCALE * 1.7 + 4 };
const GROUND_REGION: Region = { x0: -18, y0: -GROUND_HOVER - 10, x1: 18, y1: 8 };
const BODY_REGION: Region = { x0: -20, y0: -12, x1: 20, y1: 10 };

export class ContainerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly shape: Phaser.GameObjects.Image;
  private readonly icon: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  /** A reward chest's flat marks (pick range, timer ring, drop cue) on the ground layer; made on the first reward. */
  private ground: Phaser.GameObjects.Graphics | null = null;
  private timerText: Phaser.GameObjects.Text | null = null;
  private groundSig = "";
  /** performance.now() when the reward chest was first timed, for its drop cue; -1 before. */
  private bornAt = -1;
  /** Where the seconds-left text sits (above the drawn chest); set when the chest is drawn. */
  private rewardLabelY = -34;
  private hidden = false;
  private kind = "";
  private shapeSig = "";
  private highlighted = false;
  private x = NaN;
  private y = NaN;

  constructor(private readonly scene: Phaser.Scene) {
    // Placeholders until the first redraw picks the look (a texture and the region it was baked over).
    this.shape = bakedImage(scene, "chest:closed", CHEST_REGION, (g) => drawChest(g, false));
    this.icon = bakedImage(scene, "chest:closed", CHEST_REGION, (g) => drawChest(g, false)).setVisible(false);
    this.label = scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#cfd8dc", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shape, this.icon, this.label]);
  }

  /** Position and depth are only touched when the synced position or kind changes (`this.kind` lags until the redraw below). */
  update(c: ContainerState, serverNow = 0): void {
    if (c.x !== this.x || c.y !== this.y || c.kind !== this.kind) {
      this.x = c.x;
      this.y = c.y;
      this.root.setPosition(projX(c.x), projY(c.y));
      // Flat containers (loose weapons, bodies) lie on the ground, so a player standing on one must draw over it.
      this.root.setDepth(depthFor(c.y, c.kind === "chest" || c.kind === "reward" ? 0 : -PLAYER_RADIUS));
      this.ground?.setPosition(projX(c.x), projY(c.y));
    }

    // A chest is shut while it still holds its weapon and stays open once that is taken.
    const weapon = containerWeapon(c);
    const def = c.items.at(0)?.def ?? "";
    const sig = `${c.kind}|${weapon ?? ""}|${def}|${c.opened}|${c.items.length}`;
    if (sig !== this.shapeSig) {
      this.shapeSig = sig;
      this.kind = c.kind;
      this.redraw(c.kind, weapon, def, c.opened || c.items.length === 0);
    }
    this.label.setText(c.kind === "chest" ? "Chest" : c.kind === "cannon" ?
      (c.readyAt > serverNow ? `Cannon · reloading ${Math.ceil((c.readyAt - serverNow) / 1000)}s` : "Travel cannon · F to blast") :
      c.label || DEFAULT_LABEL[c.kind] || "");
    this.syncLabel();
  }

  /** Hidden while the death that left this body is still ahead of render time. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.root.setVisible(!hidden);
    this.ground?.setVisible(!hidden);
  }

  /**
   * A reward chest's clock, every frame: `left` seconds to live (the server's `expiresAt` against its time now), `near` when the
   * local player is close enough to read the seconds, `now` the local clock. Drains the ring, shows the seconds, plays the drop
   * cue once (motion kinds follow the settings: reduced motion keeps a still flash) and fades the chest out at the end.
   */
  setTimer(c: { x: number; y: number }, left: number, near: boolean, now: number): void {
    if (this.kind !== "reward") return;
    if (!this.ground) {
      this.ground = this.scene.add.graphics().setDepth(DEPTH_HIGHLIGHT).setPosition(projX(c.x), projY(c.y)).setScale(1, Y_SCALE);
      this.ground.setVisible(!this.hidden);
    }
    if (!this.timerText) {
      this.timerText = this.scene.add.text(0, 0, "", {
        fontFamily: "system-ui, sans-serif", fontSize: "13px", fontStyle: "bold", color: "#ffe082", stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5, 1);
      this.root.add(this.timerText);
    }
    if (this.bornAt < 0) this.bornAt = now;
    const age = now - this.bornAt;
    const cue = age < DROP_CUE_MS;
    const step = ringStep(left);
    const urgent = left <= URGENT_SECONDS;
    const sig = `${step}|${urgent}|${cue ? Math.floor(age / 16) : -1}`;
    if (sig !== this.groundSig) {
      this.groundSig = sig;
      this.drawGround(step, urgent, cue ? age / DROP_CUE_MS : -1);
    }
    const seconds = Math.max(0, Math.ceil(left));
    this.timerText.setText(`${seconds}s`).setVisible(near && left > 0).setY(this.rewardLabelY);
    const alpha = rewardAlpha(left);
    this.root.setAlpha(alpha);
    this.ground.setAlpha(alpha);
    // The drop: the chest settles from a little bigger. A motion effect, so none under reduced motion.
    const pop = cue && juiceScale("motion") > 0 ? 1 + 0.35 * (1 - easeOutCubic(age / DROP_CUE_MS)) : 1;
    this.root.setScale(pop);
  }

  /** The pick range (faint), the timer ring (bright, draining) and, for a moment after it drops, the cue ring. */
  private drawGround(step: number, urgent: boolean, cue: number): void {
    const g = this.ground!;
    g.clear();
    g.lineStyle(1.5, GOLD, 0.16).strokeCircle(0, 0, CHEST_RANGE);
    g.fillStyle(GOLD, 0.035).fillCircle(0, 0, CHEST_RANGE);
    const color = urgent ? 0xff8a80 : GOLD;
    g.lineStyle(5, 0x000000, 0.35).strokeCircle(0, 0, TIMER_RING_RADIUS);
    if (step > 0) {
      g.lineStyle(3, color, 0.95).beginPath();
      g.arc(0, 0, TIMER_RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + (step / RING_STEPS) * Math.PI * 2, false);
      g.strokePath();
    }
    if (cue >= 0) {
      const moving = juiceScale("motion") > 0;
      if (moving || juiceScale("flash") > 0) {
        const r = moving ? 12 + 34 * easeOutCubic(cue) : 34;
        g.lineStyle(3, 0xfff59d, 1 - cue).strokeCircle(0, 0, r);
      }
    }
  }

  /** The ring itself is ContainerHighlight's; this only reveals the name of the interaction target. */
  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.syncLabel();
  }

  destroy(): void {
    this.root.destroy();
    this.ground?.destroy();
    this.ground = null;
    this.timerText = null;
  }

  /** Bodies always show who they were; everything else only names itself when it is the interaction target. */
  private syncLabel(): void {
    this.label.setVisible(this.kind === "body" || this.highlighted);
  }

  private show(key: string, region: Region, draw: (g: Phaser.GameObjects.Graphics) => void): void {
    swapBake(this.shape, this.scene, key, region, draw);
    placeBake(this.shape, region);
  }

  private redraw(kind: string, weapon: WeaponId | null, def: string, empty: boolean): void {
    this.icon.setVisible(false);
    if (kind === "body") {
      this.show("body", BODY_REGION, drawBody);
      this.label.setY(-14);
    } else if (kind === "ground") {
      this.drawGroundWeapon(weapon);
    } else if (kind === "reward") {
      this.show("chest:reward", REWARD_REGION, drawRewardChest);
      this.rewardLabelY = -(REWARD_HEIGHT + REWARD_HALF * Y_SCALE + 4);
      this.label.setY(this.rewardLabelY);
    } else if (kind === "consumable") {
      const region = { x0: -24, y0: -32, x1: 24, y1: 8 };
      this.show(`consumable:${def}`, region, (g) => drawConsumable(g, def));
      this.label.setY(-34);
    } else if (kind === "cannon") {
      this.show("travel:cannon", { x0: -28, y0: -48, x1: 28, y1: 12 }, drawCannon);
      this.label.setY(-50);
    } else {
      const open = empty;
      this.show(`chest:${open ? "open" : "closed"}`, CHEST_REGION, (g) => drawChest(g, open));
      const hd = CHEST_HALF * Y_SCALE;
      this.label.setY(-(CHEST_HEIGHT + hd + 4 + (open ? LID_HEIGHT : 0)));
    }
  }

  /** A loose weapon: its silhouette tilted over a glow in its colour. */
  private drawGroundWeapon(weapon: WeaponId | null): void {
    const cy = -GROUND_HOVER;
    this.show(`ground:${weapon ?? ""}`, GROUND_REGION, (g) => {
      g.fillStyle(0x000000, 0.3).fillEllipse(0, 0, 20, 9);
      if (weapon) {
        const color = WEAPONS[weapon].color;
        g.fillStyle(color, 0.25).fillEllipse(0, cy, 30, 16);
        g.lineStyle(1.5, color, 0.8).strokeEllipse(0, cy, 30, 16);
      }
    });
    if (weapon) {
      // Rotation is about the icon's origin, so shift it back by where its middle lands.
      const mid = weaponCenterX(weapon) * ICON_SCALE;
      const key = weaponTexture(this.scene, weapon);
      if (this.icon.texture.key !== key) this.icon.setTexture(key);
      placeBake(this.icon, WEAPON_REGION);
      this.icon.setVisible(true).setScale(ICON_SCALE / bakeScale()).setRotation(ICON_TILT)
        .setPosition(-mid * Math.cos(ICON_TILT), cy - mid * Math.sin(ICON_TILT));
    }
    this.label.setY(cy - 14);
  }
}

function drawChest(g: Phaser.GameObjects.Graphics, open: boolean): void {
  const hw = CHEST_HALF;
  const hd = CHEST_HALF * Y_SCALE;
  const lift = CHEST_HEIGHT;
  g.fillStyle(0x000000, 0.3).fillEllipse(0, 1, hw * 2.8, hd * 2.6);
  if (open) {
    // The lid stands up behind the box; the inside is dark.
    g.fillStyle(0x5d4037, 1).fillRect(-hw, -hd - lift - LID_HEIGHT, hw * 2, LID_HEIGHT);
    g.lineStyle(1, 0x2b1d18, 0.9).strokeRect(-hw, -hd - lift - LID_HEIGHT, hw * 2, LID_HEIGHT);
  }
  g.fillStyle(open ? 0x4e342e : 0x7b5233, 1).fillRect(-hw, hd - lift, hw * 2, lift);
  g.fillStyle(open ? 0x1e1511 : 0x9a6b43, 1).fillRect(-hw, -hd - lift, hw * 2, hd * 2);
  g.lineStyle(1, 0x2b1d18, 0.9);
  g.strokeRect(-hw, -hd - lift, hw * 2, hd * 2 + lift);
  g.lineBetween(-hw, hd - lift, hw, hd - lift);
  if (!open) {
    // Iron band and latch.
    g.fillStyle(0xb0bec5, 1).fillRect(-hw, hd - lift, hw * 2, 2.5);
    g.fillStyle(0xffd54f, 1).fillRect(-2, hd - lift - 1, 4, 5);
  }
}

/** A cleared camp's shared chest: a shut chest with a gold glow and a gold band, so it never reads as a weapon crate. */
function drawRewardChest(g: Phaser.GameObjects.Graphics): void {
  const hw = REWARD_HALF;
  const hd = hw * Y_SCALE;
  const lift = REWARD_HEIGHT;
  g.fillStyle(GOLD, 0.16).fillEllipse(0, 1, hw * 3.6, hd * 3.4);
  g.fillStyle(0x000000, 0.3).fillEllipse(0, 1, hw * 2.8, hd * 2.6);
  g.fillStyle(0x7b5233, 1).fillRect(-hw, hd - lift, hw * 2, lift);
  g.fillStyle(0xb98a4d, 1).fillRect(-hw, -hd - lift, hw * 2, hd * 2);
  g.lineStyle(1.5, GOLD, 1).strokeRect(-hw, -hd - lift, hw * 2, hd * 2 + lift);
  g.lineBetween(-hw, hd - lift, hw, hd - lift);
  g.fillStyle(GOLD, 1).fillRect(-hw, hd - lift, hw * 2, 3);
  g.fillStyle(0xfff59d, 1).fillRect(-2.5, hd - lift - 1, 5, 6);
}

function drawBody(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x15181c, 0.95).fillEllipse(0, -2, 36, 16);
  g.lineStyle(1.5, 0x4a525c, 1).strokeEllipse(0, -2, 36, 16);
  g.lineStyle(2, 0xc0583f, 1);
  g.lineBetween(-7, -6, 7, 2);
  g.lineBetween(-7, 2, 7, -6);
}

function drawConsumable(g: Phaser.GameObjects.Graphics, def: string): void {
  if (def === WIND_EMBLEM_DEF) {
    g.fillStyle(0x65e4b6, 0.15).fillEllipse(0, -10, 38, 28);
    g.lineStyle(3, 0xb2fff0, 1).beginPath().moveTo(-13, -18).lineTo(7, -18).lineTo(12, -22).lineTo(7, -26).strokePath();
    g.beginPath().moveTo(-17, -10).lineTo(14, -10).lineTo(19, -14).strokePath();
    g.beginPath().moveTo(-10, -2).lineTo(6, -2).lineTo(10, 2).strokePath();
    return;
  }
  const color = isConsumableId(def) ? CONSUMABLES[def].color : 0xf45b78;
  g.fillStyle(0x000000, 0.3).fillEllipse(0, 1, 22, 9);
  g.lineStyle(2, 0xffffff, 0.8).fillStyle(color, 0.9).fillRoundedRect(-7, -18, 14, 17, 4).strokeRoundedRect(-7, -18, 14, 17, 4);
  g.fillStyle(0xdac7a5, 1).fillRect(-4, -23, 8, 6);
  g.lineStyle(2, 0xffffff, 1).lineBetween(-3, -10, 3, -10).lineBetween(0, -13, 0, -7);
}

function drawCannon(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x000000, 0.4).fillEllipse(0, 2, 48, 22);
  g.fillStyle(0x263746, 1).fillCircle(-12, -3, 9).fillCircle(12, -3, 9);
  g.lineStyle(3, 0xffd54f, 1).fillStyle(0x607d8b, 1).fillRoundedRect(-10, -40, 20, 35, 5).strokeRoundedRect(-10, -40, 20, 35, 5);
  g.fillStyle(0x101a23, 1).fillEllipse(0, -39, 17, 9);
}
