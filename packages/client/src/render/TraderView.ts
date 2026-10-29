import Phaser from "phaser";
import { TRADER_RANGE, type TraderLike } from "@raid/shared";
import { depthFor, projX, projY } from "./projection";

interface TraderViewFrame {
  traders?: { forEach(cb: (trader: TraderLike) => void): void };
  me?: { x: number; y: number; status: string };
  canSee?: (point: TraderLike) => boolean;
}

export class TraderView {
  private readonly figures = new Map<string, { root: Phaser.GameObjects.Container; hint: Phaser.GameObjects.Text }>();
  constructor(private readonly scene: Phaser.Scene) {}

  update(frame: TraderViewFrame): void {
    const seen = new Set<string>();
    frame.traders?.forEach(t => {
      if (frame.canSee && !frame.canSee(t)) return;
      seen.add(t.id);
      const view = this.figures.get(t.id) ?? this.make(t);
      this.figures.set(t.id, view);
      view.root.setPosition(projX(t.x), projY(t.y)).setDepth(depthFor(t.y));
      view.hint.setVisible(frame.me?.status === "alive" && Math.hypot(frame.me.x - t.x, frame.me.y - t.y) <= TRADER_RANGE);
    });
    for (const [id, view] of this.figures) if (!seen.has(id)) { view.root.destroy(); this.figures.delete(id); }
  }

  destroy(): void { for (const view of this.figures.values()) view.root.destroy(); this.figures.clear(); }

  private make(t: TraderLike) {
    const color = t.kind === "stats" ? 0xba9bed : 0xe2bc72;
    const g = this.scene.add.graphics();
    g.fillStyle(0x000000, .25).fillEllipse(0, 1, 34, 14);
    g.fillStyle(color, 1).fillRoundedRect(-10, -31, 20, 24, 5);
    g.fillStyle(0xe8cba9, 1).fillCircle(0, -38, 8);
    g.lineStyle(3, 0x4e3824, 1).lineBetween(14, -32, 14, -2);
    if (t.kind === "stats") g.fillStyle(0xd0b5ff, 1).fillCircle(14, -35, 5);
    else g.fillStyle(0x74542d, 1).fillRoundedRect(-21, -25, 10, 15, 3);
    const label = this.scene.add.text(0, -58, t.name, { fontFamily: "system-ui", fontSize: "12px", color: `#${color.toString(16)}`, stroke: "#000", strokeThickness: 3 }).setOrigin(.5, 1);
    const hint = this.scene.add.text(0, 12, "Trade panel open", { fontFamily: "system-ui", fontSize: "11px", color: "#fff2ba", stroke: "#000", strokeThickness: 3 }).setOrigin(.5, 0).setVisible(false);
    return { root: this.scene.add.container(0, 0, [g, label, hint]), hint };
  }
}
