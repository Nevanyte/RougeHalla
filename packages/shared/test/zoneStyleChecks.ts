// Independent checks shared by the zone styler tests.
import { TILE_FLOOR, TILE_LOW } from "../src/map";
import { TERRAIN_FENCE } from "../src/terrain";

/**
 * Pairs of floor tiles k = 1..3 steps either side of a fence tile (along its row or column, floor between): the number of
 * them that need more than 2k + cap steps to walk to each other (4-connected, over floor). Independent of the guard's code.
 */
export function fenceStraightViolations(tiles: Uint8Array, terrain: Uint8Array, w: number, h: number, cap = 10): number {
  let bad = 0;
  for (let i = 0; i < w * h; i++) {
    if (tiles[i] !== TILE_LOW || terrain[i] !== TERRAIN_FENCE) continue;
    for (const step of [w, 1]) {
      for (let k = 1; k <= 3; k++) {
        const a = i - k * step, b = i + k * step;
        if (tiles[a] !== TILE_FLOOR || tiles[b] !== TILE_FLOOR) break;
        // breadth-first from a, depth limited to 2k + cap
        const depth = new Map<number, number>([[a, 0]]);
        const queue = [a];
        let found = false;
        for (let head = 0; head < queue.length && !found; head++) {
          const cur = queue[head], d = depth.get(cur)!;
          if (cur === b) { found = true; break; }
          if (d >= 2 * k + cap) continue;
          const x = cur % w;
          for (const nb of [x > 0 ? cur - 1 : -1, x < w - 1 ? cur + 1 : -1, cur - w, cur + w]) {
            if (nb >= 0 && nb < w * h && tiles[nb] === TILE_FLOOR && !depth.has(nb)) { depth.set(nb, d + 1); queue.push(nb); }
          }
        }
        if (!found) bad++;
      }
    }
  }
  return bad;
}

