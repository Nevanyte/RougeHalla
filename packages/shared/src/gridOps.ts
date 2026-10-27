// The generator's grid tables at the map's size (MAP_TILES_W x MAP_TILES_H) and its connectivity net. The size-free versions live
// in gridTopology.ts; these are module constants for the generator's hot loops (zone-shapes contract 3.2: moved out of the retired
// cover.ts). Integer arithmetic only.
import { MAP_TILES_H, MAP_TILES_W } from "./constants";
import { SIMPLE as TOPO_SIMPLE } from "./gridTopology";
import { MASK_MOVE as MOVE_MASK, TILE_WALL as WALL_TILE } from "./map";
import type { TilePt } from "./map";

const W = MAP_TILES_W;
const H = MAP_TILES_H;
const N = W * H;
const MASK_MOVE = MOVE_MASK, TILE_WALL = WALL_TILE;

/**
 * The 3x3 neighbourhood of a tile as a cycle of 8 cells (N, NE, E, SE, S, SW, W, NW). SIMPLE[mask] says whether turning the
 * centre of a floor patch into wall keeps its 4-connected floor neighbours linked through the ring (gridTopology's table).
 */
export const SIMPLE: Uint8Array = TOPO_SIMPLE;
export const RING_DX: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
export const RING_DY: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];
/** Index offsets of the 8 ring cells at the map's width. */
export const RING_OFF: readonly number[] = RING_DX.map((dx, q) => RING_DY[q] * W + dx);
/** Index offsets of the 4 orthogonal neighbours (N, E, S, W) at the map's width. */
export const NB4: readonly number[] = [-W, 1, W, -1];

/**
 * Anything walkable not 4-connected to the seed tile becomes wall. With `log`, every tile it walls is pushed to it (the generator
 * records those as the zones' `infill` features).
 */
export function enforceConnectivity(tiles: Uint8Array, seedTile: TilePt, log?: number[]): void {
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const start = seedTile.y * W + seedTile.x;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    if (x > 0) visit(i - 1);
    if (x < W - 1) visit(i + 1);
    if (y > 0) visit(i - W);
    if (y < H - 1) visit(i + W);
  }
  function visit(j: number): void {
    if (seen[j] || (tiles[j] & MASK_MOVE) !== 0) return;
    seen[j] = 1;
    queue[tail++] = j;
  }
  for (let i = 0; i < tiles.length; i++) {
    if ((tiles[i] & MASK_MOVE) === 0 && !seen[i]) {
      tiles[i] = TILE_WALL;
      if (log) log.push(i);
    }
  }
}
