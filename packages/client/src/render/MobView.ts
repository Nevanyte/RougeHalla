import Phaser from "phaser";
import { PLAYER_RADIUS } from "@raid/shared";
import type { MobState } from "@raid/shared/schema";
import { BodyFlash, FighterArt, drawHpBar, factionColor } from "./FighterArt";
import { BODY_LIFT, depthFor, projX, projY, screenAngle } from "./projection";

const HIT_FLASH_MS = 120;
/** A mob's hp is far larger than a player's, so its bar is wider to match its weight on screen. */
const HP_BAR_W = 36;

/** A neutral fighter (Phase 9: the training dummy) drawn like a player without the player-only marks. */
export class MobView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Arc;
  private readonly nose: Phaser.GameObjects.Rectangle;
  private readonly hpBar: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly art: FighterArt;
  private readonly flashing: BodyFlash;

  constructor(scene: Phaser.Scene) {
    const shadow = scene.add.ellipse(0, 0, PLAYER_RADIUS * 2.2, PLAYER_RADIUS * 1.1, 0x000000, 0.35);
    this.art = new FighterArt(scene);
    this.body = scene.add.circle(0, -BODY_LIFT, PLAYER_RADIUS, factionColor("")).setStrokeStyle(2, 0x111111, 0.8);
    this.flashing = new BodyFlash(this.body, factionColor(""));
    this.nose = scene.add.rectangle(0, -BODY_LIFT, PLAYER_RADIUS, 4, 0x111111, 0.8).setOrigin(0, 0.5);
    this.hpBar = scene.add.graphics();
    this.label = scene.add.text(0, -BODY_LIFT - PLAYER_RADIUS - 18, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#b0bec5", stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [shadow, this.art.ground, this.body, this.nose, this.art.held, this.hpBar, this.label]);
  }

  flash(ms = HIT_FLASH_MS): void {
    this.flashing.trigger(ms);
  }

  update(x: number, y: number, m: MobState, renderT: number, patchT: number): void {
    this.flashing.tick();
    const visible = m.status === "alive";
    this.root.setVisible(visible);
    if (!visible) return;
    this.flashing.setColor(factionColor(m.faction));
    this.root.setPosition(projX(x), projY(y));
    this.root.setDepth(depthFor(y));
    const weapon = this.art.update(m, renderT, patchT);
    this.nose.setVisible(weapon === null).setRotation(screenAngle(m.facing));
    this.label.setText(m.name);
    drawHpBar(this.hpBar, m.maxHp > 0 ? m.hp / m.maxHp : 0, -BODY_LIFT - PLAYER_RADIUS - 8, HP_BAR_W);
  }

  destroy(): void {
    this.root.destroy();
  }
}
