// Fake 2.5D: the ground plane is squashed vertically and things with height are drawn upward.
// Phaser's "world" coordinates are screen-projected space; game logic only ever sees ground (x, y).
import { Y_SCALE } from "@raid/shared";

export function projX(x: number): number {
  return x;
}

export function projY(y: number, height = 0): number {
  return y * Y_SCALE - height;
}

/** Inverse of the ground projection (height 0). Used for click-to-move. */
export function unproject(px: number, py: number): { x: number; y: number } {
  return { x: px, y: py / Y_SCALE };
}

/** Y-sort: anything further "south" on the ground draws on top. */
export function depthFor(y: number, bias = 0): number {
  return y + bias;
}
