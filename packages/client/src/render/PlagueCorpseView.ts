// A separate, low green corpse on the ground: the ordinary body container continues to hold its weapon loot.
import type Phaser from "phaser";
import type { PlagueCorpseState } from "@raid/shared/schema";
import { PLAYER_RADIUS } from "@raid/shared";
import { depthFor, projX, projY } from "./projection";

interface DrawnCorpse {
  graphics: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
}

/** Draws corpses only when the local Plague player has ordinary world vision of them. */
export class PlagueCorpseView {
  private readonly drawn = new Map<string, DrawnCorpse>();

  constructor(private readonly scene: Phaser.Scene) {}

  update(
    corpses: { forEach(cb: (corpse: PlagueCorpseState, id: string) => void): void },
    now: number,
    eligible: boolean,
    canSee: (point: { x: number; y: number }) => boolean,
  ): void {
    const active = new Set<string>();
    if (eligible) corpses.forEach((corpse, id) => {
      if (!(corpse.expiresAt > now) || !Number.isFinite(corpse.x + corpse.y)) return;
      active.add(id);
      const visible = canSee(corpse);
      let entry = this.drawn.get(id);
      if (!entry && visible) {
        const graphics = this.scene.add.graphics();
        this.paint(graphics);
        entry = { graphics, x: NaN, y: NaN };
        this.drawn.set(id, entry);
      }
      if (!entry) return;
      if (corpse.x !== entry.x || corpse.y !== entry.y) {
        entry.x = corpse.x;
        entry.y = corpse.y;
        entry.graphics.setPosition(projX(corpse.x), projY(corpse.y)).setDepth(depthFor(corpse.y, -PLAYER_RADIUS - 0.25));
      }
      entry.graphics.setVisible(visible);
    });

    for (const [id, entry] of this.drawn) {
      if (active.has(id)) continue;
      entry.graphics.destroy();
      this.drawn.delete(id);
    }
  }

  destroy(): void {
    for (const { graphics } of this.drawn.values()) graphics.destroy();
    this.drawn.clear();
  }

  private paint(g: Phaser.GameObjects.Graphics): void {
    // Shallow diseased puddle and exposed pale bones. The footprint matches a player body, with the glow kept close to the ground.
    g.fillStyle(0x15381c, 0.92).fillEllipse(0, 4, 42, 23);
    g.fillStyle(0x2e8c3d, 0.98).fillEllipse(0, 0, 35, 19);
    g.fillStyle(0x62bc4a, 0.9).fillEllipse(-2, -1, 23, 12);
    g.lineStyle(3, 0xc6e9a3, 0.95).lineBetween(-8, -3, 8, 3).lineBetween(-7, 3, 7, -3);
    g.fillStyle(0xdaf2b5, 0.98).fillCircle(-9, -4, 2.2).fillCircle(9, 4, 2.2);
    g.lineStyle(1, 0x91d675, 0.8).strokeEllipse(0, 0, 35, 19);
  }
}
