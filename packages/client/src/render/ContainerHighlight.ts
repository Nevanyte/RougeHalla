// The ring under the container the player would loot. One shared Graphics on the ground layer (below every
// y-sorted entity) rather than a child of each container, so it can never draw over a player standing north of it.
import Phaser from "phaser";
import { Y_SCALE } from "@raid/shared";
import { DEPTH_HIGHLIGHT } from "./MapView";
import { projX, projY } from "./projection";

const RING_RADIUS = 24;

export class ContainerHighlight {
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.ring = scene.add.graphics().setDepth(DEPTH_HIGHLIGHT).setVisible(false);
    this.ring.fillStyle(0xffd54f, 0.08).fillEllipse(0, 0, RING_RADIUS * 2, RING_RADIUS * 2 * Y_SCALE);
    this.ring.lineStyle(2, 0xffd54f, 0.95).strokeEllipse(0, 0, RING_RADIUS * 2, RING_RADIUS * 2 * Y_SCALE);
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
