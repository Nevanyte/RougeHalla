// Grid topology shared by the generator and the zone stylers. Everything here is size-free: no module-level W/H/N, the map
// size always comes from the caller. Integer and + - * / only, so client and server agree to the bit.
import { TILE_FLOOR } from "./map";

/**
 * The 3x3 neighbourhood of a tile as a cycle of 8 cells (N, NE, E, SE, S, SW, W, NW): bit q of a mask is set when ring
 * cell q is floor. SIMPLE[mask] says whether turning the centre into solid keeps its 4-connected floor neighbours linked
 * through the ring, i.e. whether no corridor is cut and no pocket is sealed. (mapgen.ts keeps an identical private copy.)
 */
export const SIMPLE: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let m = 0; m < 256; m++) {
    let comp = 0;
    for (let q = 0; q < 8; q += 2) {
      if ((m >> q) & 1) { comp = 1 << q; break; }
    }
    for (let again = true; again;) {
      again = false;
      for (let q = 0; q < 8; q++) {
        if (!((comp >> q) & 1)) continue;
        for (const nb of [(q + 1) & 7, (q + 7) & 7]) {
          if (((m >> nb) & 1) && !((comp >> nb) & 1)) { comp |= 1 << nb; again = true; }
        }
      }
    }
    let ok = true;
    for (let q = 0; q < 8; q += 2) if (((m >> q) & 1) && !((comp >> q) & 1)) ok = false;
    table[m] = ok ? 1 : 0;
  }
  return table;
})();

/** Ring cell q is at (RING_DX[q], RING_DY[q]) from the centre: N, NE, E, SE, S, SW, W, NW. */
export const RING_DX: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];
export const RING_DY: readonly number[] = [-1, -1, 0, 1, 1, 1, 0, -1];

/** Index offsets of the 8 ring cells in a row-major grid `w` wide (for tiles with all 8 neighbours inside the grid). */
export function ringOffsets(w: number): number[] {
  return RING_DX.map((dx, q) => RING_DY[q] * w + dx);
}

/** Index offsets of the 4 orthogonal neighbours (N, E, S, W) in a grid `w` wide. */
export function nb4Offsets(w: number): number[] {
  return [-w, 1, w, -1];
}

/**
 * Walking distance from tile `from` to every floor tile over the 8-connected grid, without cutting corners, in fifths of a
 * tile (a diagonal step costs 7, about 5 * sqrt(2)); -1 where unreachable. Only TILE_FLOOR is walkable.
 */
export function walkDistances(tiles: Uint8Array, w: number, h: number, from: number): Int32Array {
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  if (tiles[from] !== TILE_FLOOR) return dist;
  const best = new Int32Array(n).fill(1 << 30);
  const buckets: number[][] = [[], [], [], [], [], [], [], []];
  best[from] = 0;
  buckets[0].push(from);
  for (let d = 0, left = 1; left > 0; d++) {
    const bucket = buckets[d & 7];
    while (bucket.length > 0) {
      const i = bucket.pop()!;
      left--;
      if (dist[i] >= 0 || best[i] !== d) continue;
      dist[i] = d;
      const x = i % w, y = (i - x) / w;
      for (let q = 0; q < 8; q++) {
        const nx = x + RING_DX[q], ny = y + RING_DY[q];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || tiles[ny * w + nx] !== TILE_FLOOR) continue;
        const diagonal = (q & 1) === 1;
        if (diagonal && (tiles[y * w + nx] !== TILE_FLOOR || tiles[ny * w + x] !== TILE_FLOOR)) continue;
        const nd = d + (diagonal ? 7 : 5), j = ny * w + nx;
        if (nd < best[j]) { best[j] = nd; buckets[nd & 7].push(j); left++; }
      }
    }
  }
  return dist;
}
