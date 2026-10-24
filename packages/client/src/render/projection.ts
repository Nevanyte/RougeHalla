// Fake 2.5D: the ground plane is squashed vertically and things with height are drawn upward.
// Phaser's "world" coordinates are screen-projected space; game logic only ever sees ground (x, y).
import { Y_SCALE } from "@raid/shared";

/** Screen pixels a fighter's body disc floats above its ground shadow; projectiles and floating text are drawn at this height too. */
export const BODY_LIFT = 14;

export function projX(x: number): number {
  return x;
}

export function projY(y: number, height = 0): number {
  return y * Y_SCALE - height;
}

/** Inverse of the ground projection (height 0). Used for click-to-move and aiming. */
export function unproject(px: number, py: number): { x: number; y: number } {
  return { x: px, y: py / Y_SCALE };
}

/** Screen-space angle of a ground-plane direction: the ground is squashed by Y_SCALE, so angles flatten toward horizontal. */
export function screenAngle(a: number): number {
  return Math.atan2(Math.sin(a) * Y_SCALE, Math.cos(a));
}

/** Y-sort: anything further "south" on the ground draws on top. */
export function depthFor(y: number, bias = 0): number {
  return y + bias;
}
