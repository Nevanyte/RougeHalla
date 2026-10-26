// Hand-built maps with LOW tiles (fences, lava, crevasses) for the terrain-reach tests: a walled room of floor with strips
// of LOW in it, made through mapFromTiles(w, h, tiles, 0, terrain) like a generated map's two layers. Not a test file.
import {
  mapFromTiles, PLAYER_RADIUS, TERRAIN_FENCE, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, worldToTile,
  type GameMap, type Vec2,
} from "@raid/shared";

export type TilePt = readonly [tx: number, ty: number];

/** Tile coordinates of a vertical strip at column `tx`, rows `y0..y1` (inclusive). */
export const vertical = (tx: number, y0: number, y1: number): TilePt[] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => [tx, y0 + i] as const);

export interface RoomOpts {
  /** LOW tiles, each carrying `kind` in the terrain layer. */
  low?: readonly TilePt[];
  /** Terrain kind of the LOW tiles (TERRAIN_FENCE by default). */
  kind?: number;
  /** Extra WALL tiles inside the border. */
  walls?: readonly TilePt[];
  /** Spawn points (world units); eight along the top row by default, so any test can start a run. */
  spawns?: readonly Vec2[];
}

/** A `w` x `h` room of floor inside a wall border, with `low` strips and `walls` set in it. */
export function roomMap(w: number, h: number, opts: RoomOpts = {}): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  for (const [tx, ty] of opts.low ?? []) { tiles[ty * w + tx] = TILE_LOW; terrain[ty * w + tx] = opts.kind ?? TERRAIN_FENCE; }
  for (const [tx, ty] of opts.walls ?? []) tiles[ty * w + tx] = TILE_WALL;
  const map = mapFromTiles(w, h, tiles, 0, terrain);
  map.spawns = (opts.spawns ?? Array.from({ length: 8 }, (_, i) => tileCentre(2 + i, 2))).map((s) => ({ ...s }));
  return map;
}

export const tileCentre = (tx: number, ty: number): Vec2 => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

/** Where a body stands pressed against the west face of tile column `tx`, and against the east face (56 u apart across one tile). */
export const westOf = (tx: number, y: number): Vec2 => ({ x: tx * TILE - PLAYER_RADIUS, y });
export const eastOf = (tx: number, y: number): Vec2 => ({ x: (tx + 1) * TILE + PLAYER_RADIUS, y });

/** The class of the tile under a point, read straight off the layer (no helper in between). */
export function tileClassAt(map: GameMap, p: Vec2): number {
  const tx = worldToTile(p.x);
  const ty = worldToTile(p.y);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return TILE_WALL;
  return map.tiles[ty * map.w + tx]!;
}
