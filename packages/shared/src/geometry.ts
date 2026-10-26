// Segment / grid-ray helpers shared by server sim (hitscan, LOS, bots) and client (fog, aim).
import { TILE } from "./constants";
import { blocksMovementTile, blocksSightTile } from "./map";
import type { GameMap } from "./map";
import type { Vec2 } from "./messages";

export interface RayHit { hit: boolean; x: number; y: number; dist: number }

/** Which tiles stop a ray: blocksSightTile (walls) for sight and shots, blocksMovementTile (walls and low ground) for bodies. */
export type TileBlocks = (map: GameMap, tx: number, ty: number) => boolean;

export function distPointToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * Amanatides-Woo DDA in world units. `hit` means the segment enters a wall tile at or before
 * (x1, y1); (x, y) is the entry point on that tile's boundary and `dist` the distance from the
 * start. A start inside a wall hits at distance 0. A miss reports (x1, y1) and the full length.
 * Passing exactly through a tile vertex counts as entering both neighbouring tiles, so the result
 * is symmetric under swapping the endpoints and agrees with the pathfinder's no-corner-cutting rule.
 * `blocked` picks the tiles that stop it: sight (TILE_WALL) by default, so shots and line of sight pass over low ground.
 */
export function raycast(map: GameMap, x0: number, y0: number, x1: number, y1: number, blocked: TileBlocks = blocksSightTile): RayHit {
  // NaN/Infinity would never terminate the DDA; treat them as blocked at the origin.
  if (!Number.isFinite(x0 + y0 + x1 + y1)) return { hit: true, x: x0, y: y0, dist: 0 };
  let tx = Math.floor(x0 / TILE);
  let ty = Math.floor(y0 / TILE);
  if (blocked(map, tx, ty)) return { hit: true, x: x0, y: y0, dist: 0 };

  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
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
    if (crossX && crossY && (blocked(map, tx + stepX, ty) || blocked(map, tx, ty + stepY))) {
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
    if (blocked(map, tx, ty)) return { hit: true, x: ex, y: ey, dist: t * len };
  }
}

export function hasLineOfSight(map: GameMap, a: Vec2, b: Vec2): boolean {
  return !raycast(map, a.x, a.y, b.x, b.y).hit;
}

/**
 * True iff a disc of `radius` centred at `p` overlaps no tile that blocks movement (walls and low ground): an exact
 * circle-vs-tile-rect test over the tiles the disc can reach (out-of-bounds counts as wall). Tangent is not overlap. A
 * zero-radius disc is a point, clear iff it stands on a floor tile. Non-finite input is never clear.
 */
export function circleClear(map: GameMap, p: Vec2, radius: number): boolean {
  const cx = p.x;
  const cy = p.y;
  if (!Number.isFinite(cx + cy + radius)) return false;
  if (radius <= 0) return !blocksMovementTile(map, Math.floor(cx / TILE), Math.floor(cy / TILE));
  const reach = Math.max(1, Math.ceil(radius / TILE));
  const tx = Math.floor(cx / TILE);
  const ty = Math.floor(cy / TILE);
  const r2 = radius * radius;
  for (let j = ty - reach; j <= ty + reach; j++) {
    for (let i = tx - reach; i <= tx + reach; i++) {
      if (!blocksMovementTile(map, i, j)) continue;
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
 * True iff a disc of `radius` swept from a to b touches no tile that blocks movement. Implemented as the centre ray plus
 * rays offset +-radius perpendicular to the motion, plus disc-vs-tile tests at both endpoints.
 *
 * Why that is enough: a wall tile is a TILE-sized square, so any tile intersecting the swept strip
 * must cross one of the offset rays or poke into an end cap, and the caps are covered by the
 * endpoint discs. For radius > TILE the ray count grows so no tile can slip between two rays.
 * It errs on the blocked side only for exact grazes (a ray touching a tile edge or vertex).
 */
export function segmentClear(map: GameMap, a: Vec2, b: Vec2, radius: number): boolean {
  if (!circleClear(map, a, radius) || !circleClear(map, b, radius)) return false;
  if (raycast(map, a.x, a.y, b.x, b.y, blocksMovementTile).hit) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || radius <= 0) return true;
  const nx = -dy / len;
  const ny = dx / len;
  const rays = Math.ceil(radius / TILE);
  for (let k = 1; k <= rays; k++) {
    const off = (radius * k) / rays;
    const ox = nx * off;
    const oy = ny * off;
    if (raycast(map, a.x + ox, a.y + oy, b.x + ox, b.y + oy, blocksMovementTile).hit) return false;
    if (raycast(map, a.x - ox, a.y - oy, b.x - ox, b.y - oy, blocksMovementTile).hit) return false;
  }
  return true;
}
