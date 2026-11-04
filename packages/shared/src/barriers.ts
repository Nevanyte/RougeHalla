// Deployed barriers (the first deployable: Frost's ice wall). A barrier is a set of map tiles that, while it stands, is LOW
// ground (TILE_LOW: it stops bodies and melee swings, not sight or shots, like a fence). The server decides the tiles once, when
// the cast lands, and syncs them on the area (`FieldState.cells`), so the server's collision map, the client's prediction and the
// art all read the same tiles; the client's aim preview runs the same `wallCells` on its own map to show where a wall would go.
// Pure: no state, no random.
import { TILE } from "./constants";
import { distPointToSegment } from "./geometry";
import { TILE_FLOOR, TILE_LOW, type GameMap } from "./map";
import type { Vec2 } from "./messages";

/** A tile is under a wall when its centre is this close to the wall's line: one tile thick along an axis, a closed staircase on a diagonal. */
export const WALL_CELL_REACH = TILE * 0.75;

/** A wall's line: its centre (the clamped aim point) and its two ends, square to the line from the caster. */
export interface WallSegment {
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Where a wall aimed from `from` at `cursor` stands: centred on the cursor clamped to `range` (no closer than `minRange`), across
 * the line from the caster, `length` long. A cursor on the caster aims along `facing`.
 */
export function wallSegmentFor(from: Vec2, cursor: Vec2, range: number, minRange: number, length: number, facing = 0): WallSegment {
  let dx = cursor.x - from.x;
  let dy = cursor.y - from.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (!(d >= 1)) {
    dx = Math.cos(facing);
    dy = Math.sin(facing);
    d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const at = Math.min(Math.max(d, minRange), range);
  const cx = from.x + ux * at;
  const cy = from.y + uy * at;
  const half = length / 2;
  // Square to the aim: (-uy, ux).
  return { cx, cy, x1: cx - uy * half, y1: cy + ux * half, x2: cx + uy * half, y2: cy - ux * half };
}

/** A tile past a wall's end is under it only within this much (so a wall `length` long takes about `length / TILE` tiles along an axis). */
export const WALL_END_SLACK = TILE / 4;

/**
 * The FLOOR tiles of `map` under the wall, as row-major indices in ascending order: a tile centre within WALL_CELL_REACH of the
 * wall's line and no further than WALL_END_SLACK past either end along it.
 */
export function wallCells(map: GameMap, seg: WallSegment): number[] {
  const reach = WALL_CELL_REACH;
  const ex = seg.x2 - seg.x1;
  const ey = seg.y2 - seg.y1;
  const len = Math.sqrt(ex * ex + ey * ey);
  const ux = len > 0 ? ex / len : 0;
  const uy = len > 0 ? ey / len : 0;
  const minX = Math.max(0, Math.floor((Math.min(seg.x1, seg.x2) - reach) / TILE));
  const maxX = Math.min(map.w - 1, Math.floor((Math.max(seg.x1, seg.x2) + reach) / TILE));
  const minY = Math.max(0, Math.floor((Math.min(seg.y1, seg.y2) - reach) / TILE));
  const maxY = Math.min(map.h - 1, Math.floor((Math.max(seg.y1, seg.y2) + reach) / TILE));
  const out: number[] = [];
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      const i = ty * map.w + tx;
      if (map.tiles[i] !== TILE_FLOOR) continue;
      const px = tx * TILE + TILE / 2;
      const py = ty * TILE + TILE / 2;
      const along = (px - seg.x1) * ux + (py - seg.y1) * uy;
      if (along < -WALL_END_SLACK || along > len + WALL_END_SLACK) continue;
      if (distPointToSegment(px, py, seg.x1, seg.y1, seg.x2, seg.y2) <= reach) out.push(i);
    }
  }
  return out;
}

/** The wire form of a cell list (FieldState.cells): base-36 indices joined by commas. */
export function encodeCells(cells: readonly number[]): string {
  return cells.map((c) => c.toString(36)).join(",");
}

/** A cell list off the wire: anything that is not a list of in-range tile indices is dropped entry by entry. */
export function decodeCells(text: string, tileCount: number): number[] {
  if (!text) return [];
  const out: number[] = [];
  for (const part of text.split(",")) {
    const n = parseInt(part, 36);
    if (Number.isInteger(n) && n >= 0 && n < tileCount) out.push(n);
  }
  return out;
}

/**
 * `base` with every FLOOR tile of `cells` turned LOW: a new map object, so the per-map caches (masks, components, paths) are its
 * own. Callers cache it per barrier set; the terrain and every other layer are shared with `base`.
 */
export function withBarriers(base: GameMap, cells: Iterable<number>): GameMap {
  const tiles = base.tiles.slice();
  for (const i of cells) if (i >= 0 && i < tiles.length && tiles[i] === TILE_FLOOR) tiles[i] = TILE_LOW;
  return { ...base, tiles };
}
