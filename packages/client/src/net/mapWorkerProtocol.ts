// What the page and its map worker say to each other (net/mapWorker.ts, net/mapWorkerEntry.ts). Kept apart from both so
// the worker's bundle never pulls in the page side (which itself names the worker's entry).
import type { GameMap } from "@raid/shared";

/** Page to worker. */
export type MapWorkerIn =
  /** Build the fixed layout and the zone layout (about 2 ms), then run one throwaway attempt so the first real map meets a warm JIT. */
  | { kind: "warm" }
  /** Exactly `generateMap(seed, attempt)`: one attempt, never a loop. */
  | { kind: "map"; id: number; seed: number; attempt: number };

/** Worker to page. */
export type MapWorkerOut =
  | { kind: "warm"; layoutMs: number; attemptMs: number }
  | { kind: "map"; id: number; map: GameMap; ms: number }
  /** generateMap threw: on this client that attempt does not certify, so it cannot build the server's map. */
  | { kind: "fail"; id: number; message: string };

/**
 * The buffers of the map's five 136 x 136 layers (tiles, terrain, regionGrid, territoryGrid, featureGrid: 18.5 KB each) that can be
 * moved rather than copied: each owned whole by one layer. What is left (the props, the camps, the pool, the features: about 110 KB
 * of small objects) goes by structured clone, which a 136 x 136 map's reply costs well under a millisecond.
 */
export function mapTransferables(map: GameMap): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [map.tiles, map.terrain, map.regionGrid, map.territoryGrid, map.featureGrid]) {
    const buf = a.buffer;
    if (!(buf instanceof ArrayBuffer) || a.byteOffset !== 0 || a.byteLength !== buf.byteLength || out.includes(buf)) continue;
    out.push(buf);
  }
  return out;
}
