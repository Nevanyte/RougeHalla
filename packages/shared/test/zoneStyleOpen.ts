// A synthetic OPEN map for the stylers, shaped like the zone generator's hook input (part D's habitat): 96x96, a solid border,
// a coliseum disc in the middle, five organic zones around it of about 1700 tiles each, and per zone four camp clearings
// (9x9 with halo), three spawns (5x5) and three chests (3x3) as protected ground. No cover rocks: the stylers run before cover.
// Test scaffolding only (it may use Math.sin; no recipe does).
import { hash2, vnoise } from "../src/zoneStyle/kit";
import { REGION_FACTIONS } from "../src/map";
import type { StyleState } from "../src/zoneStyle";
import { TILE_WALL } from "../src/map";

export const OPEN_W = 96;

export interface OpenFixture {
  st: StyleState;
  w: number;
  h: number;
  /** The tiles before styling. */
  tiles0: Uint8Array;
}

export function openFixture(seed: number, w = OPEN_W, h = OPEN_W): OpenFixture {
  const n = w * h;
  const tiles = new Uint8Array(n);
  const zone = new Uint8Array(n);
  const protect = new Uint8Array(n);
  const cx = w / 2, cy = h / 2;
  const a0 = hash2(seed, 1, 1) * 6.2832;
  const seeds = REGION_FACTIONS.map((_, k) => {
    const a = a0 + (k * 6.2832) / 5 + (hash2(seed, k, 2) - 0.5) * 0.5;
    return [cx + 0.3 * w * Math.cos(a), cy + 0.3 * h * Math.sin(a)] as const;
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x < 3 || y < 3 || x >= w - 3 || y >= h - 3) { tiles[i] = TILE_WALL; protect[i] = 1; continue; }
      const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      if (d < 14) { protect[i] = 1; continue; }
      let best = 1e9, bk = 0;
      seeds.forEach(([sx, sy], k) => {
        const dd = Math.sqrt((x - sx) * (x - sx) + (y - sy) * (y - sy)) + 7 * (vnoise(x, y, 10, 100 + k + seed * 7) - 0.5);
        if (dd < best) { best = dd; bk = k; }
      });
      zone[i] = bk + 1;
    }
  }
  // protected ground inside each zone: camps (9x9), spawns (5x5), chests (3x3), on tiles well inside the zone
  const stamp = (px: number, py: number, r: number): void => {
    for (let y = py - r; y <= py + r; y++) for (let x = px - r; x <= px + r; x++) if (x >= 0 && y >= 0 && x < w && y < h && zone[y * w + x]) protect[y * w + x] = 1;
  };
  for (let k = 1; k <= 5; k++) {
    const want = [[4, 4], [3, 2], [3, 1]] as const; // [count, radius]
    const placed: Array<[number, number]> = [];
    for (const [count, r] of want) {
      for (let t = 0, got = 0; t < 600 && got < count; t++) {
        const x = 4 + Math.floor(hash2(seed * 131 + k, t * 7 + r, 3) * (w - 8)), y = 4 + Math.floor(hash2(seed * 131 + k, t * 7 + r, 4) * (h - 8));
        if (zone[y * w + x] !== k) continue;
        let inside = true;
        for (let dy = -r - 3; dy <= r + 3 && inside; dy++) for (let dx = -r - 3; dx <= r + 3; dx++) { const j = (y + dy) * w + x + dx; if (zone[j] !== k) { inside = false; break; } }
        if (!inside || placed.some(([px, py]) => Math.max(Math.abs(px - x), Math.abs(py - y)) < 7 + r)) continue;
        placed.push([x, y]);
        stamp(x, y, r);
        got++;
      }
    }
  }
  const st: StyleState = {
    w, h, seed, attempt: 0, tiles, terrain: new Uint8Array(n), props: [], zone, zoneFaction: REGION_FACTIONS, protect,
    territory: null, camps: [], keepLow: new Uint8Array(n),
  };
  return { st, w, h, tiles0: tiles.slice() };
}
