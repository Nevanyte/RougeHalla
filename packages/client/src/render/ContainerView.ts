// One container (chest, loose weapon, or body), y-sorted by its ground position like a player.
import Phaser from "phaser";
import { PLAYER_RADIUS, WEAPONS, Y_SCALE, type WeaponId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { drawWeapon, weaponCenterX } from "./FighterArt";
import { containerWeapon } from "./interact";
import { depthFor, projX, projY } from "./projection";

/** Half the chest footprint in world units; the box is drawn CHEST_HEIGHT screen pixels tall. */
const CHEST_HALF = 11;
const CHEST_HEIGHT = 11;
/** The open lid stands up behind the box this many pixels. */
const LID_HEIGHT = 9;
/** How far a loose weapon floats above its shadow, and how big its icon is drawn. */
const GROUND_HOVER = 9;
const ICON_SCALE = 0.85;
const ICON_TILT = -0.6;
const DEFAULT_LABEL: Record<string, string> = { chest: "Chest", ground: "Weapon", body: "Body" };

export class ContainerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly shape: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private kind = "";
  private shapeSig = "";
  private highlighted = false;
  private x = NaN;
  private y = NaN;

  constructor(scene: Phaser.Scene) {
    this.shape = scene.add.graphics();
    this.icon = scene.add.graphics().setVisible(false);
    this.label = scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#cfd8dc", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shape, this.icon, this.label]);
  }

  /** Position and depth are only touched when the synced position or kind changes (`this.kind` lags until the redraw below). */
  update(c: ContainerState): void {
    if (c.x !== this.x || c.y !== this.y || c.kind !== this.kind) {
      this.x = c.x;
      this.y = c.y;
      this.root.setPosition(projX(c.x), projY(c.y));
      // Flat containers (loose weapons, bodies) lie on the ground, so a player standing on one must draw over it.
      this.root.setDepth(depthFor(c.y, c.kind === "chest" ? 0 : -PLAYER_RADIUS));
    }

    // A chest is shut while it still holds its weapon and stays open once that is taken.
    const weapon = containerWeapon(c);
    const sig = `${c.kind}|${weapon ?? ""}`;
    if (sig !== this.shapeSig) {
      this.shapeSig = sig;
      this.kind = c.kind;
      this.redraw(c.kind, weapon);
    }
    this.label.setText(c.label || DEFAULT_LABEL[c.kind] || "");
    this.syncLabel();
  }

  /** Hidden while the death that left this body is still ahead of render time. */
  setHidden(hidden: boolean): void {
    this.root.setVisible(!hidden);
  }

  /** The ring itself is ContainerHighlight's; this only reveals the name of the interaction target. */
  setHighlight(on: boolean): void {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.syncLabel();
  }

  destroy(): void {
    this.root.destroy();
  }

  /** Bodies always show who they were; everything else only names itself when it is the interaction target. */
  private syncLabel(): void {
    this.label.setVisible(this.kind === "body" || this.highlighted);
  }

  private redraw(kind: string, weapon: WeaponId | null): void {
    const g = this.shape;
    g.clear();
    this.icon.clear().setVisible(false);
    if (kind === "body") this.drawBody(g);
    else if (kind === "ground") this.drawGroundWeapon(g, weapon);
    else this.drawChest(g, weapon === null);
  }

  private drawChest(g: Phaser.GameObjects.Graphics, open: boolean): void {
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
    this.label.setY(-(lift + hd + 4 + (open ? LID_HEIGHT : 0)));
  }

  /** A loose weapon: its silhouette tilted over a glow in its colour. */
  private drawGroundWeapon(g: Phaser.GameObjects.Graphics, weapon: WeaponId | null): void {
    const cy = -GROUND_HOVER;
    g.fillStyle(0x000000, 0.3).fillEllipse(0, 0, 20, 9);
    if (weapon) {
      const color = WEAPONS[weapon].color;
      g.fillStyle(color, 0.25).fillEllipse(0, cy, 30, 16);
      g.lineStyle(1.5, color, 0.8).strokeEllipse(0, cy, 30, 16);
      // Rotation is about the icon's origin, so shift it back by where its middle lands.
      const mid = weaponCenterX(weapon) * ICON_SCALE;
      this.icon.clear().setVisible(true).setScale(ICON_SCALE).setRotation(ICON_TILT)
        .setPosition(-mid * Math.cos(ICON_TILT), cy - mid * Math.sin(ICON_TILT));
      drawWeapon(this.icon, weapon);
    }
    this.label.setY(cy - 14);
  }

  private drawBody(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x15181c, 0.95).fillEllipse(0, -2, 36, 16);
    g.lineStyle(1.5, 0x4a525c, 1).strokeEllipse(0, -2, 36, 16);
    g.lineStyle(2, 0xc0583f, 1);
    g.lineBetween(-7, -6, 7, 2);
    g.lineBetween(-7, 2, 7, -6);
    this.label.setY(-14);
  }
}
