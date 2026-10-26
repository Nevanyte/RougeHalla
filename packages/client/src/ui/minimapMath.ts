// The minimap's maths, kept pure so the click mapping and the view rectangle can be tested without a DOM. The map is drawn
// into a square that covers max(WORLD_W, WORLD_H) world units, so a point's place on the minimap is a fraction of the
// element's rect; nothing here assumes the element is a given number of screen pixels wide (the overlay is CSS-scaled).
import { WORLD_H, WORLD_W } from "@raid/shared";
import { unproject } from "../render/projection";

/** The part of getBoundingClientRect() the mapping reads: real screen CSS pixels, the overlay's scale included. */
export interface ClientRect { left: number; top: number; width: number; height: number }

export interface Point { x: number; y: number }

/** A rectangle as fractions of the minimap square: (0, 0) is its top-left, (1, 1) its bottom-right. */
export interface FracRect { x: number; y: number; w: number; h: number }

export const MINIMAP_MIN = 150;
export const MINIMAP_MAX = 240;
/** Share of the overlay's height the minimap takes before the clamp. */
const HEIGHT_SHARE = 0.26;
/** Half the weapon bar, plus the gap that keeps the minimap clear of it (overlay px). */
const BAR_CLEARANCE = 107 + 10;
const RIGHT_GUTTER = 12;
/** On a very narrow overlay the minimap shrinks below MINIMAP_MIN rather than run into the weapon bar, down to this. */
const NARROW_FLOOR = 110;
/** The most backing pixels a side may have: a 240 px map at 1.5x on a 2x screen is 720. */
const BACKING_MAX = 1024;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The side of the square the map is drawn into, in world units. */
export function mapSpan(worldW: number = WORLD_W, worldH: number = WORLD_H): number {
  return Math.max(worldW, worldH);
}

/**
 * The minimap's side in overlay pixels: about a quarter of the overlay's height, 150 to 240, and never wider than the
 * space between the right edge and the centred weapon bar.
 */
export function minimapSize(uiW: number, uiH: number): number {
  const wanted = clamp(Math.round(uiH * HEIGHT_SHARE), MINIMAP_MIN, MINIMAP_MAX);
  const room = Math.floor(uiW / 2 - RIGHT_GUTTER - BAR_CLEARANCE);
  return Math.min(wanted, Math.max(NARROW_FLOOR, room));
}

/** The canvas backing store's side in device pixels for an element `size` overlay pixels wide: crisp at any scale and dpr. */
export function minimapBacking(size: number, uiScale: number, dpr: number): number {
  return clamp(Math.round(size * uiScale * dpr), 32, BACKING_MAX);
}

/**
 * The world point under a pointer. Maps the pointer's fraction of the rect, so it holds at any element size or place;
 * the result is clamped into the world (the pointer may be captured and outside the element).
 */
export function minimapToWorld(
  clientX: number, clientY: number, rect: ClientRect, worldW: number = WORLD_W, worldH: number = WORLD_H,
): Point {
  const span = mapSpan(worldW, worldH);
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  return { x: clamp(fx * span, 0, worldW), y: clamp(fy * span, 0, worldH) };
}

/** The inverse: where (in client pixels) a world point is drawn on a minimap that occupies `rect`. */
export function worldToMinimap(
  x: number, y: number, rect: ClientRect, worldW: number = WORLD_W, worldH: number = WORLD_H,
): Point {
  const span = mapSpan(worldW, worldH);
  return { x: rect.left + (x / span) * rect.width, y: rect.top + (y / span) * rect.height };
}

/**
 * What the camera sees, as fractions of the minimap square. `center` is the camera's centre in projected (drawn)
 * coordinates and the visible size is in projected pixels too; the ground is squashed vertically by Y_SCALE, so the
 * rectangle on the map is taller than the screen's own proportions. It is not clamped: near an edge it hangs off the map.
 */
export function viewRectOnMinimap(
  center: Point, visibleW: number, visibleH: number, worldW: number = WORLD_W, worldH: number = WORLD_H,
): FracRect {
  const span = mapSpan(worldW, worldH);
  const lo = unproject(center.x - visibleW / 2, center.y - visibleH / 2);
  const hi = unproject(center.x + visibleW / 2, center.y + visibleH / 2);
  return { x: lo.x / span, y: lo.y / span, w: (hi.x - lo.x) / span, h: (hi.y - lo.y) / span };
}
