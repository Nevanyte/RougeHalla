import Phaser from "phaser";
import { PLAYER_RADIUS } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { depthFor, projX, projY } from "./projection";

/** Screen pixels the body disc floats above the ground shadow; shots and floating text are drawn at this height too. */
export const BODY_LIFT = 14;
const LOCAL_COLOR = 0x4caf50;
const REMOTE_COLOR = 0xe5a823;
const HIT_COLOR = 0xffffff;
const HIT_FLASH_MS = 120;

/** One player drawn as a raised disc over a ground shadow, y-sorted by ground position. */
export class PlayerView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly extractRing: Phaser.GameObjects.Graphics;
  private readonly baseColor: number;
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
    this.extractRing = scene.add.graphics();
    this.label = scene.add.text(0, -BODY_LIFT - PLAYER_RADIUS - 18, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: isLocal ? "#b9f6ca" : "#ffe0a3",
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [shadow, this.body, this.nose, this.extractRing, this.hpBar, this.label]);
  }

  /** Paints the body white for a moment (a hit landed on this player). */
  flash(ms = HIT_FLASH_MS): void {
    this.flashUntil = performance.now() + ms;
    if (!this.flashing) {
      this.flashing = true;
      this.body.setFillStyle(HIT_COLOR);
    }
  }

  /** `drawAsAlive`: the player's death is still ahead of the render time they are drawn at, so keep showing them. */
  update(x: number, y: number, p: PlayerState, drawAsAlive = false): void {
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

    this.extractRing.clear();
    if (p.extractProgress > 0) {
      this.extractRing.lineStyle(3, 0x4fc3f7, 1);
      this.extractRing.beginPath();
      this.extractRing.arc(0, -BODY_LIFT, PLAYER_RADIUS + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p.extractProgress);
      this.extractRing.strokePath();
    }
  }

  destroy(): void {
    this.root.destroy();
  }
}
