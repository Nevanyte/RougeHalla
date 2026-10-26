// What the camera sees, as a box in projected pixels, and whether a chunk of the static map is in it. MapView hides the chunks
// outside the box: a Phaser Graphics replays its whole command buffer every frame whether or not the camera shows it (there is no
// culling for it), so a 96 x 96 map drawn as a handful of Graphics costs the same at any zoom. Pure, so it is tested without Phaser.
import { topLeftForScroll } from "../view/viewport";

/** A rectangle in projected (drawn) pixels. */
export interface Box { x: number; y: number; w: number; h: number }

/**
 * Projected pixels added on every side of the camera's box: a camera shake, a frame of travel, and the lifted face of a wall that
 * stands just off screen. Generous on purpose: a chunk shown a moment early costs nothing, one hidden a moment early is a flash.
 */
export const CULL_PAD = 96;

/**
 * The projected box the camera shows (zoom about its centre, as Phaser does), grown by `pad`. Null when the camera's numbers are
 * not usable (not yet laid out): the caller then shows everything.
 */
export function cameraBox(scrollX: number, scrollY: number, camW: number, camH: number, zoom: number, pad: number = CULL_PAD): Box | null {
  if (![scrollX, scrollY, camW, camH, zoom].every(Number.isFinite) || zoom <= 0 || camW <= 0 || camH <= 0) return null;
  const tl = topLeftForScroll(scrollX, scrollY, camW, camH, zoom);
  return { x: tl.x - pad, y: tl.y - pad, w: camW / zoom + pad * 2, h: camH / zoom + pad * 2 };
}

/** Whether two boxes share any area (touching edges do not count). */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
