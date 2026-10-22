// One lootable container (crate, loose item, or body), y-sorted by its ground position like a player.
import Phaser from "phaser";
import { PLAYER_RADIUS, Y_SCALE, itemDef } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { depthFor, projX, projY } from "./projection";

/** Half the crate footprint in world units; the box is drawn CRATE_HEIGHT screen pixels tall. */
const CRATE_HALF = 10;
const CRATE_HEIGHT = 10;
/** How far a loose item floats above its shadow. */
const GROUND_HOVER = 7;
const FALLBACK_COLOR = 0x888888;
const DEFAULT_LABEL: Record<string, string> = { crate: "Crate", ground: "Item", body: "Body" };

export class ContainerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly shape: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private kind = "";
  private shapeSig = "";
  private highlighted = false;
  private x = NaN;
  private y = NaN;

  constructor(scene: Phaser.Scene) {
    this.shape = scene.add.graphics();
    this.label = scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#cfd8dc", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [this.shape, this.label]);
  }

  /** Position and depth are only touched when the synced position or kind changes (`this.kind` lags until the redraw below). */
  update(c: ContainerState): void {
    if (c.x !== this.x || c.y !== this.y || c.kind !== this.kind) {
      this.x = c.x;
      this.y = c.y;
      this.root.setPosition(projX(c.x), projY(c.y));
      // Flat containers (loose items, bodies) lie on the ground, so a player standing on one must draw over it.
      this.root.setDepth(depthFor(c.y, c.kind === "crate" ? 0 : -PLAYER_RADIUS));
    }

    const firstDef = c.items.length > 0 ? c.items.at(0).def : "";
    const sig = `${c.kind}|${firstDef}`;
    if (sig !== this.shapeSig) {
      this.shapeSig = sig;
      this.kind = c.kind;
      this.redraw(c.kind, firstDef);
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

  private redraw(kind: string, firstDef: string): void {
    const g = this.shape;
    g.clear();
    if (kind === "body") this.drawBody(g);
    else if (kind === "ground") this.drawGroundItem(g, itemDef(firstDef)?.color ?? FALLBACK_COLOR);
    else this.drawCrate(g, firstDef === "");
  }

  private drawCrate(g: Phaser.GameObjects.Graphics, empty: boolean): void {
    const hw = CRATE_HALF;
    const hd = CRATE_HALF * Y_SCALE;
    const lift = CRATE_HEIGHT;
    g.fillStyle(0x000000, 0.3).fillEllipse(0, 1, hw * 2.8, hd * 2.6);
    g.fillStyle(empty ? 0x3f322d : 0x6d4c41, 1).fillRect(-hw, hd - lift, hw * 2, lift);
    g.fillStyle(empty ? 0x5d4a43 : 0x8d6e63, 1).fillRect(-hw, -hd - lift, hw * 2, hd * 2);
    g.lineStyle(1, 0x2b1d18, 0.9);
    g.strokeRect(-hw, -hd - lift, hw * 2, hd * 2 + lift);
    g.lineBetween(-hw, hd - lift, hw, hd - lift);
    g.lineStyle(1, 0x2b1d18, 0.5).lineBetween(-hw, -lift, hw, -lift);
    this.label.setY(-(lift + hd + 4));
  }

  private drawGroundItem(g: Phaser.GameObjects.Graphics, color: number): void {
    const cy = -GROUND_HOVER;
    g.fillStyle(0x000000, 0.3).fillEllipse(0, 0, 18, 8);
    g.fillStyle(color, 1);
    g.lineStyle(1.5, 0xeceff1, 0.6);
    g.beginPath();
    g.moveTo(0, cy - 8);
    g.lineTo(10, cy);
    g.lineTo(0, cy + 8);
    g.lineTo(-10, cy);
    g.closePath();
    g.fillPath();
    g.strokePath();
    this.label.setY(cy - 8 - 4);
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
