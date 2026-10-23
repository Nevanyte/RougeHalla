import Phaser from "phaser";
import { PLAYER_RADIUS, TELEPORT_IMMUNITY_MS } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { depthFor, projX, projY } from "./projection";

/** Screen pixels the body disc floats above the ground shadow; shots and floating text are drawn at this height too. */
export const BODY_LIFT = 14;
const LOCAL_COLOR = 0x4caf50;
const REMOTE_COLOR = 0xe5a823;
const HIT_COLOR = 0xffffff;
const HIT_FLASH_MS = 120;
const SHIELD_COLOR = 0x4fc3f7;

// The bounty crown sits above the name label, drawn from its base centre so scaling it grows it upward.
const CROWN_COLOR = 0xffd54f;
const CROWN_EDGE = 0x5d4037;
const CROWN_W = 22;
const CROWN_H = 13;
/** Clear of the name label (bottom at -BODY_LIFT - PLAYER_RADIUS - 18, 11px tall). */
const CROWN_BASE_Y = -BODY_LIFT - PLAYER_RADIUS - 33;
/** The crown grows from 1x to 1 + CROWN_GROWTH as the bounty approaches CROWN_FULL_BOUNTY (about a feed score of 8). */
const CROWN_GROWTH = 0.5;
const CROWN_FULL_BOUNTY = 150;

/** One player drawn as a raised disc over a ground shadow, y-sorted by ground position. */
export class PlayerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly shieldRing: Phaser.GameObjects.Graphics;
  private readonly crown: Phaser.GameObjects.Graphics;
  private readonly crownLabel: Phaser.GameObjects.Text;
  private readonly baseColor: number;
  /** The bounty the crown was last drawn for (0 = hidden), so it is redrawn only when the number changes. */
  private crownBounty = 0;
  /** performance.now() deadline of the hit flash; 0 when idle. Polled in update() so no timer needs cleaning up. */
  private flashUntil = 0;
  private flashing = false;

  constructor(scene: Phaser.Scene, readonly isLocal: boolean) {
    const color = isLocal ? LOCAL_COLOR : REMOTE_COLOR;
    this.baseColor = color;
    const shadow = scene.add.ellipse(0, 0, PLAYER_RADIUS * 2.2, PLAYER_RADIUS * 1.1, 0x000000, 0.35);
    this.body = scene.add.circle(0, -BODY_LIFT, PLAYER_RADIUS, color).setStrokeStyle(2, 0x111111, 0.8);
    this.nose = scene.add.rectangle(0, -BODY_LIFT, PLAYER_RADIUS, 4, 0x111111, 0.8).setOrigin(0, 0.5);
    this.hpBar = scene.add.graphics();
    this.shieldRing = scene.add.graphics();
    this.label = scene.add.text(0, -BODY_LIFT - PLAYER_RADIUS - 18, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: isLocal ? "#b9f6ca" : "#ffe0a3",
    }).setOrigin(0.5, 1);
    this.crown = scene.add.graphics().setVisible(false);
    this.crown.fillStyle(CROWN_COLOR, 1).lineStyle(1.5, CROWN_EDGE, 1);
    this.crown.beginPath()
      .moveTo(-CROWN_W / 2, 0).lineTo(-CROWN_W / 2, -CROWN_H * 0.7).lineTo(-CROWN_W / 4, -CROWN_H * 0.3)
      .lineTo(0, -CROWN_H).lineTo(CROWN_W / 4, -CROWN_H * 0.3).lineTo(CROWN_W / 2, -CROWN_H * 0.7)
      .lineTo(CROWN_W / 2, 0).closePath().fillPath().strokePath();
    this.crown.setPosition(0, CROWN_BASE_Y);
    this.crownLabel = scene.add.text(0, 0, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", fontStyle: "bold",
      color: "#ffe082", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1).setVisible(false);
    this.root = scene.add.container(0, 0, [
      shadow, this.body, this.nose, this.shieldRing, this.hpBar, this.label, this.crown, this.crownLabel,
    ]);
  }

  /** Paints the body white for a moment (a hit landed on this player). */
  flash(ms = HIT_FLASH_MS): void {
    this.flashUntil = performance.now() + ms;
    if (!this.flashing) {
      this.flashing = true;
      this.body.setFillStyle(HIT_COLOR);
    }
  }

  /**
   * `renderT`: the server time this frame is drawn at. `drawAsAlive`: the player's death is still ahead of the render
   * time they are drawn at, so keep showing them.
   */
  update(x: number, y: number, p: PlayerState, renderT: number, drawAsAlive = false): void {
    if (this.flashing && performance.now() >= this.flashUntil) {
      this.flashing = false;
      this.flashUntil = 0;
      this.body.setFillStyle(this.baseColor);
    }
    const visible = drawAsAlive || p.status === "alive" || p.status === "lobby";
    this.root.setVisible(visible);
    if (!visible) return;
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    this.nose.setRotation(p.facing);
    this.label.setText(p.name);

    const w = 28;
    const frac = p.maxHp > 0 ? Math.max(0, p.hp / p.maxHp) : 0;
    const top = -BODY_LIFT - PLAYER_RADIUS - 8;
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.6).fillRect(-w / 2, top, w, 4);
    this.hpBar.fillStyle(frac > 0.5 ? 0x66bb6a : frac > 0.25 ? 0xffca28 : 0xef5350, 1).fillRect(-w / 2, top, w * frac, 4);

    // Immunity runs from the teleport tick `t` to t + TELEPORT_IMMUNITY_MS. `p` is the latest patch, ahead of the delayed
    // positions drawn here, so the ring is judged at render time: it shows from the moment this body lands in the
    // coliseum until the drawn world passes the end. Against server now it would sit on the old spot for ~INTERP_DELAY_MS
    // before the jump and vanish that much early.
    this.shieldRing.clear();
    const left = p.immuneUntil - renderT;
    if (left > 0 && left <= TELEPORT_IMMUNITY_MS) {
      this.shieldRing.lineStyle(3, SHIELD_COLOR, 0.35 + 0.65 * (left / TELEPORT_IMMUNITY_MS));
      this.shieldRing.strokeCircle(0, -BODY_LIFT, PLAYER_RADIUS + 6);
    }

    // Only a drawn player is marked: the early return above hides the whole container (crown included) for the dead.
    this.setCrown(p.bounty > 0 ? Math.floor(p.bounty) : 0);
  }

  /** Shows the crown for `bounty` GV, scaled with it; 0 hides it. A no-op while the number is unchanged. */
  private setCrown(bounty: number): void {
    if (bounty === this.crownBounty) return;
    this.crownBounty = bounty;
    const on = bounty > 0;
    this.crown.setVisible(on);
    this.crownLabel.setVisible(on);
    if (!on) return;
    const scale = 1 + CROWN_GROWTH * Math.min(1, bounty / CROWN_FULL_BOUNTY);
    this.crown.setScale(scale);
    this.crownLabel.setText(String(bounty)).setPosition(0, CROWN_BASE_Y - CROWN_H * scale - 1);
  }

  destroy(): void {
    this.root.destroy();
  }
}
