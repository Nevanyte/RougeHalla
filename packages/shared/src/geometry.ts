// Segment / grid-ray helpers shared by server sim (hitscan, LOS, bots) and client (fog, aim). Lengths use
// Math.sqrt(dx * dx + dy * dy), never Math.hypot: the generator calls findPath (segmentClear, raycast) to certify spawn walks, and
// hypot may differ in its last bit between engines (zone-shapes contract 0.1.5).
import { TILE } from "./constants";
import { MASK_MOVE, MASK_SIGHT } from "./map";
import type { GameMap } from "./map";
import type { Vec2 } from "./messages";

export interface RayHit { hit: boolean; x: number; y: number; dist: number }

export function distPointToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = px - (ax + abx * t), ey = py - (ay + aby * t);
  return Math.sqrt(ex * ex + ey * ey);
}

/** Does the tile (tx, ty) stop a query with this mask? Out of bounds blocks every query. `blocksTile` with the map's fields hoisted. */
function blocked(tiles: Uint8Array, w: number, h: number, tx: number, ty: number, mask: number): boolean {
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
  return (tiles[ty * w + tx] & mask) !== 0;
}

/**
 * Amanatides-Woo DDA in world units. `hit` means the segment enters a tile that `mask` blocks (default MASK_SIGHT:
 * walls only, LOW is see-through; pass MASK_MOVE for what stops a body, a reach mask for a swing) at or before
 * (x1, y1); (x, y) is the entry point on that tile's boundary and `dist` the distance from the
 * start. A start inside a blocked tile hits at distance 0. A miss reports (x1, y1) and the full length.
 * Passing exactly through a tile vertex counts as entering both neighbouring tiles, so the result
 * is symmetric under swapping the endpoints (for endpoints off the grid lines, whatever the mask), and under MASK_MOVE
 * agrees with the pathfinder's no-corner-cutting rule.
 */
export function raycast(map: GameMap, x0: number, y0: number, x1: number, y1: number, mask: number = MASK_SIGHT): RayHit {
  // NaN/Infinity would never terminate the DDA; treat them as blocked at the origin.
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return { hit: true, x: x0, y: y0, dist: 0 };
  const tiles = map.tiles;
  const mw = map.w;
  const mh = map.h;
  let tx = Math.floor(x0 / TILE);
  let ty = Math.floor(y0 / TILE);
  if (blocked(tiles, mw, mh, tx, ty, mask)) return { hit: true, x: x0, y: y0, dist: 0 };

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { hit: false, x: x1, y: y1, dist: 0 };

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  // Ray parameter t in [0, 1] at which the next vertical / horizontal grid line is crossed.
  let tMaxX = stepX === 0 ? Infinity : ((tx + (stepX > 0 ? 1 : 0)) * TILE - x0) / dx;
  let tMaxY = stepY === 0 ? Infinity : ((ty + (stepY > 0 ? 1 : 0)) * TILE - y0) / dy;

  for (;;) {
    const t = tMaxX < tMaxY ? tMaxX : tMaxY;
    if (t > 1) return { hit: false, x: x1, y: y1, dist: len };
    const crossX = tMaxX <= t;
    const crossY = tMaxY <= t;
    const ex = crossX ? (stepX > 0 ? tx + 1 : tx) * TILE : x0 + dx * t;
    const ey = crossY ? (stepY > 0 ? ty + 1 : ty) * TILE : y0 + dy * t;
    if (crossX && crossY && (blocked(tiles, mw, mh, tx + stepX, ty, mask) || blocked(tiles, mw, mh, tx, ty + stepY, mask))) {
      return { hit: true, x: ex, y: ey, dist: t * len };
    }
    if (crossX) {
      tx += stepX;
      tMaxX = ((tx + (stepX > 0 ? 1 : 0)) * TILE - x0) / dx;
    }
    if (crossY) {
      ty += stepY;
      tMaxY = ((ty + (stepY > 0 ? 1 : 0)) * TILE - y0) / dy;
    }
    if (blocked(tiles, mw, mh, tx, ty, mask)) return { hit: true, x: ex, y: ey, dist: t * len };
  }
}

/** True iff the segment a-b meets no tile `mask` blocks (default MASK_SIGHT: walls only). */
export function hasLineOfSight(map: GameMap, a: Vec2, b: Vec2, mask: number = MASK_SIGHT): boolean {
  return !raycast(map, a.x, a.y, b.x, b.y, mask).hit;
}

/**
 * True iff a disc of `radius` centred at `p` overlaps no tile `mask` blocks (default MASK_MOVE: any solid tile, so a
 * body never overlaps LOW either): an exact circle-vs-tile-rect test over the tiles the disc can reach (out-of-bounds
 * blocks). Tangent is not overlap. A zero-radius disc is a point, clear iff its tile is not blocked. Non-finite input
 * is never clear.
 */
export function circleClear(map: GameMap, p: Vec2, radius: number, mask: number = MASK_MOVE): boolean {
  const cx = p.x;
  const cy = p.y;
  if (!Number.isFinite(cx + cy + radius)) return false;
  const tiles = map.tiles;
  const mw = map.w;
  const mh = map.h;
  const tx = Math.floor(cx / TILE);
  const ty = Math.floor(cy / TILE);
  if (radius <= 0) return !blocked(tiles, mw, mh, tx, ty, mask);
  const reach = Math.max(1, Math.ceil(radius / TILE));
  const r2 = radius * radius;
  for (let j = ty - reach; j <= ty + reach; j++) {
    for (let i = tx - reach; i <= tx + reach; i++) {
      if (!blocked(tiles, mw, mh, i, j, mask)) continue;
      const nx = Math.min(Math.max(cx, i * TILE), (i + 1) * TILE);
      const ny = Math.min(Math.max(cy, j * TILE), (j + 1) * TILE);
      const ddx = cx - nx;
      const ddy = cy - ny;
      if (ddx * ddx + ddy * ddy < r2) return false;
    }
  }
  return true;
}

/**
 * True iff a disc of `radius` swept from a to b touches no tile `mask` blocks (default MASK_MOVE). Implemented as the
 * centre ray plus rays offset +-radius perpendicular to the motion, plus disc-vs-tile tests at both endpoints, all under
 * the same mask.
 *
 * Why that is enough: a blocked tile is a TILE-sized square, so any tile intersecting the swept strip
 * must cross one of the offset rays or poke into an end cap, and the caps are covered by the
 * endpoint discs. For radius > TILE the ray count grows so no tile can slip between two rays.
 * It errs on the blocked side only for exact grazes (a ray touching a tile edge or vertex).
 */
export function segmentClear(map: GameMap, a: Vec2, b: Vec2, radius: number, mask: number = MASK_MOVE): boolean {
  if (!circleClear(map, a, radius, mask) || !circleClear(map, b, radius, mask)) return false;
  if (raycast(map, a.x, a.y, b.x, b.y, mask).hit) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0 || radius <= 0) return true;
  const nx = -dy / len;
  const ny = dx / len;
  const rays = Math.ceil(radius / TILE);
  for (let k = 1; k <= rays; k++) {
    const off = (radius * k) / rays;
    const ox = nx * off;
    const oy = ny * off;
    if (raycast(map, a.x + ox, a.y + oy, b.x + ox, b.y + oy, mask).hit) return false;
    if (raycast(map, a.x - ox, a.y - oy, b.x - ox, b.y - oy, mask).hit) return false;
  }
  return true;
}
