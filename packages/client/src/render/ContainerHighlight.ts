// The ring under the container the player would loot. One shared Image on the ground layer (below every
// y-sorted entity) rather than a child of each container, so it can never draw over a player standing north of it.
import Phaser from "phaser";
import { Y_SCALE } from "@raid/shared";
import { bakedImage, type Region } from "./bake";
import { DEPTH_HIGHLIGHT } from "./MapView";
import { projX, projY } from "./projection";

const RING_RADIUS = 24;
const RING_REGION: Region = { x0: -RING_RADIUS - 3, y0: -RING_RADIUS * Y_SCALE - 3, x1: RING_RADIUS + 3, y1: RING_RADIUS * Y_SCALE + 3 };

export class ContainerHighlight {
  private readonly ring: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene) {
    // Baked: the ring never changes shape, only where it stands.
    this.ring = bakedImage(scene, "ring:loot", RING_REGION, (g) => {
      g.fillStyle(0xffd54f, 0.08).fillEllipse(0, 0, RING_RADIUS * 2, RING_RADIUS * 2 * Y_SCALE);
      g.lineStyle(2, 0xffd54f, 0.95).strokeEllipse(0, 0, RING_RADIUS * 2, RING_RADIUS * 2 * Y_SCALE);
    }).setDepth(DEPTH_HIGHLIGHT).setVisible(false);
  }

  /** Centres the ring on a container's ground position. */
  show(x: number, y: number): void {
    this.ring.setPosition(projX(x), projY(y)).setVisible(true);
  }

  hide(): void {
    this.ring.setVisible(false);
  }

  destroy(): void {
    this.ring.destroy();
  }
}
