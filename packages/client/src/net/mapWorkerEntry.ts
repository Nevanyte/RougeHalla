// The map worker (started by net/mapWorker.ts): the layout tables and every room's map are built here, never on
// the page's thread, so the hub and the loading screen keep animating while they are.
import { generateMap, tryAttempt, warmMapgen } from "@raid/shared";
import { mapTransferables, type MapWorkerIn, type MapWorkerOut } from "./mapWorkerProtocol";

/** The throwaway warm-up attempt's seed: any seed does, its map is dropped (R1 note section 3). */
const WARM_SEED = 1;

interface WorkerScope {
  onmessage: ((e: MessageEvent<MapWorkerIn>) => void) | null;
  postMessage(msg: MapWorkerOut, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.kind === "warm") {
    const t0 = performance.now();
    warmMapgen();
    const t1 = performance.now();
    tryAttempt(WARM_SEED, 0);
    scope.postMessage({ kind: "warm", layoutMs: t1 - t0, attemptMs: performance.now() - t1 }, []);
    return;
  }
  if (msg.kind !== "map") return;
  try {
    const t0 = performance.now();
    const map = generateMap(msg.seed, msg.attempt);
    scope.postMessage({ kind: "map", id: msg.id, map, ms: performance.now() - t0 }, mapTransferables(map));
  } catch (err) {
    scope.postMessage({ kind: "fail", id: msg.id, message: err instanceof Error ? err.message : String(err) }, []);
  }
};
