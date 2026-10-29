// A Plague companion is a fighter, but its green upright silhouette and bond ring distinguish it from regional mobs.
import type Phaser from "phaser";
import type { MobState } from "@raid/shared/schema";
import { bakeScale, bakedImage } from "./bake";
import { HpBar, shadowImage } from "./FighterArt";
import { FigurePose } from "./figurePose";
import { juiceScale } from "./juice";
import { depthFor, projX, projY } from "./projection";
import { StatusArt } from "./StatusArt";

const DEATH_MS = 450;
const FIGURE_TOP = 44;
export const ZOMBIE_FRIEND_COLOR = "#d6ffb7";
export const ZOMBIE_OTHER_COLOR = "#b6c99e";

/** Growth stays legible without an unbounded late-game figure covering other fighters. The first corpse is its base size. */
export function zombieScale(corpses: number): number {
  return 1 + Math.min(0.65, Math.log2(1 + Math.max(0, Number.isFinite(corpses) ? corpses - 1 : 0)) * 0.12);
}

export interface ZombieOwnerLook { name: string; corpses: number; local: boolean }

export class ZombieView {
  private readonly root: Phaser.GameObjects.Container;
  private readonly figure: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Image;
  private readonly bond: Phaser.GameObjects.Image;
  private readonly hp: HpBar;
  private readonly label: Phaser.GameObjects.Text;
  private readonly status: StatusArt;
  readonly cues = new FigurePose();
  private diedAt = -1;
  private flashUntil = 0;
  private flashing = false;
  private labelText = "";
  private local: boolean | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.hp = new HpBar(scene);
    this.status = new StatusArt(scene, 18);
    this.bond = bakedImage(scene, "zombie:bond", { x0: -20, y0: -11, x1: 20, y1: 11 }, g => {
      g.lineStyle(1.7, 0xffffff, 0.9).strokeEllipse(0, 0, 35, 16);
      g.fillStyle(0xffffff, 1).fillCircle(0, 7, 2);
    });
    this.body = bakedImage(scene, "zombie:figure", { x0: -25, y0: -46, x1: 25, y1: 3 }, drawZombie);
    this.figure = scene.add.container(0, 0, [this.body]);
    this.label = scene.add.text(0, -58, "", {
      fontFamily: "system-ui, sans-serif", fontSize: "10px", color: ZOMBIE_FRIEND_COLOR, stroke: "#07120b", strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.root = scene.add.container(0, 0, [shadowImage(scene), this.bond, this.figure, this.hp.root, this.label, this.status.g]);
  }

  flash(ms = 120): void { this.flashUntil = performance.now() + ms; }

  update(x: number, y: number, m: MobState, renderT: number, patchT: number, owner: ZombieOwnerLook): void {
    if (m.status === "alive") this.diedAt = -1;
    else if (this.diedAt < 0) this.diedAt = patchT;
    const dying = this.diedAt >= 0 && renderT >= this.diedAt;
    const fade = this.diedAt < 0 ? 1 : Math.max(0, Math.min(1, 1 - (renderT - this.diedAt) / DEATH_MS));
    this.root.setPosition(projX(x), projY(y)).setDepth(depthFor(y)).setVisible(fade > 0).setAlpha(fade).setScale(1 - (1 - fade) * 0.4);
    if (fade <= 0) { this.cues.reset(); this.status.reset(); this.hp.hide(); return; }

    const now = performance.now(), size = zombieScale(owner.corpses);
    this.cues.track(x, y, renderT, now);
    const pose = this.cues.sample(now, juiceScale("motion"), 0, m.facing);
    this.figure.setPosition(pose.ox, pose.oy).setScale(size * pose.sx, size * pose.sy);
    this.bond.setScale(size / bakeScale());
    const flashing = now < this.flashUntil && juiceScale("flash") > 0;
    if (flashing !== this.flashing) {
      this.flashing = flashing;
      this.body.setTint(0xffffff).setTintMode(flashing ? 1 : 0); // Phaser TintModes.FILL / MULTIPLY
    }
    if (owner.local !== this.local) {
      this.local = owner.local;
      this.bond.setTint(owner.local ? 0xc7ffad : 0x7f9965);
      this.label.setColor(owner.local ? ZOMBIE_FRIEND_COLOR : ZOMBIE_OTHER_COLOR);
    }
    const text = owner.local ? "Your zombie" : owner.name ? `${owner.name}'s zombie` : "Plague zombie";
    if (text !== this.labelText) { this.labelText = text; this.label.setText(text); }
    this.label.setY(-FIGURE_TOP * size - 14).setVisible(!dying);
    if (dying || m.maxHp <= 0) this.hp.hide();
    else this.hp.draw(m.hp, m.maxHp, 0, -FIGURE_TOP * size - 8, 34 + (size - 1) * 10);
    this.status.update(dying ? 0 : m.effects | 0, now);
  }

  destroy(): void { this.cues.reset(); this.root.destroy(); }
}

function drawZombie(g: Phaser.GameObjects.Graphics): void {
  // Uneven feet, exposed shin bones and a torn dark tunic ground the figure at y=0.
  g.lineStyle(5, 0x9cbd78, 1).lineBetween(-5, -16, -7, -2).lineBetween(5, -16, 8, -3);
  g.fillStyle(0x283b27, 1).fillRoundedRect(-12, -3, 9, 4, 2).fillRoundedRect(5, -4, 10, 4, 2);
  g.fillStyle(0x344c35, 1).fillRoundedRect(-9, -31, 18, 18, 4);
  g.fillStyle(0x182b20, 1).fillTriangle(-9, -14, -5, -19, -2, -13).fillTriangle(3, -13, 6, -18, 9, -14);
  // Asymmetric, reaching arms and pale ribs make the companion read as undead at game zoom.
  g.lineStyle(6, 0x6c9f4d, 1).lineBetween(-8, -28, -18, -22).lineBetween(-18, -22, -22, -27);
  g.lineBetween(8, -28, 18, -25).lineBetween(18, -25, 22, -31);
  g.lineStyle(2, 0xc5df9e, 1).lineBetween(-4, -25, 4, -24).lineBetween(-4, -21, 3, -20);
  g.fillStyle(0x75a650, 1).fillRoundedRect(-8, -44, 17, 17, 5);
  g.fillStyle(0xabc785, 1).fillRoundedRect(-7, -43, 12, 8, 3);
  g.fillStyle(0x172e1a, 1).fillCircle(-3, -36, 2.5).fillCircle(4, -36, 2.5);
  g.fillStyle(0xcaff83, 1).fillCircle(-3, -36, 1).fillCircle(4, -36, 1);
  g.lineStyle(2, 0x2b4227, 1).lineBetween(-3, -30, 5, -31);
  g.fillStyle(0xd5e7ae, 1).fillRect(-1, -32, 2, 3).fillRect(3, -32, 2, 2);
}
