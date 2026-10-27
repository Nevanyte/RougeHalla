// What the page and its map worker say to each other (net/mapWorker.ts, net/mapWorkerEntry.ts). Kept apart from both so
// the worker's bundle never pulls in the page side (which itself names the worker's entry).
import type { GameMap } from "@raid/shared";

/** Page to worker. */
export type MapWorkerIn =
  /** Build the lane tables, then run one throwaway attempt so the first real map meets a warm JIT. */
  | { kind: "warm" }
  /** Exactly `generateMap(seed, attempt)`: one attempt, never a loop. */
  | { kind: "map"; id: number; seed: number; attempt: number };

/** Worker to page. */
export type MapWorkerOut =
  | { kind: "warm"; tablesMs: number; attemptMs: number }
  | { kind: "map"; id: number; map: GameMap; ms: number }
  /** generateMap threw: on this client that attempt does not certify, so it cannot build the server's map. */
  | { kind: "fail"; id: number; message: string };

/** The buffers of the map's four tile layers that can be moved rather than copied: each owned whole by one layer. */
export function mapTransferables(map: GameMap): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const a of [map.tiles, map.terrain, map.regionGrid, map.territoryGrid]) {
    const buf = a.buffer;
    if (!(buf instanceof ArrayBuffer) || a.byteOffset !== 0 || a.byteLength !== buf.byteLength || out.includes(buf)) continue;
    out.push(buf);
  }
  return out;
}
