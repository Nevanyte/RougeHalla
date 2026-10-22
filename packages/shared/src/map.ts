// Map contract. `generateMap(seed)` in mapgen.ts must produce identical output on client and server.
import { TILE } from "./constants";
import type { Vec2 } from "./messages";

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;

/** Inclusive-exclusive tile rect: covers tx in [x, x+w), ty in [y, y+h). */
export interface TileRect { x: number; y: number; w: number; h: number }

export interface ExtractZoneDef { id: string; name: string; x: number; y: number; r: number }

export interface GameMap {
  seed: number;
  /** Size in tiles. */
  w: number;
  h: number;
  /** Row-major, length w*h, TILE_FLOOR / TILE_WALL. Border is always wall. */
  tiles: Uint8Array;
  /** Building footprints (including their walls), for floor shading only. */
  buildings: TileRect[];
  /** World-space points (tile centers), all mutually reachable. */
  spawns: Vec2[];
  extracts: ExtractZoneDef[];
  crateSpots: Vec2[];
  groundSpots: Vec2[];
}

export function tileIndex(map: GameMap, tx: number, ty: number): number {
  return ty * map.w + tx;
}

/** Out-of-bounds counts as wall. */
export function isWallTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
  return map.tiles[ty * map.w + tx] === TILE_WALL;
}

export function isWallAt(map: GameMap, x: number, y: number): boolean {
  return isWallTile(map, worldToTile(x), worldToTile(y));
}

export function worldToTile(v: number): number {
  return Math.floor(v / TILE);
}

export function tileToWorldCenter(t: number): number {
  return t * TILE + TILE / 2;
}
