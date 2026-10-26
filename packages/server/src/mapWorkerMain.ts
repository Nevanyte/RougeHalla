// Runs in the map worker thread (mapWorker.mjs): generateMap(seed) off the main thread's event loop. The map is plain data
// (typed arrays, arrays and objects), so the structured clone that postMessage makes is the same map the main thread would
// have built (test/mapService.test.ts checks it for a spread of seeds). The lane tables mapgen keeps (about 18 MB) live here.
import { parentPort } from "node:worker_threads";
import { generateMap } from "@raid/shared";

if (!parentPort) throw new Error("mapWorkerMain.ts runs in a worker thread");
const port = parentPort;
port.on("message", (req: { id: number; seed: number }) => {
  try {
    port.postMessage({ id: req.id, map: generateMap(req.seed) });
  } catch (err) {
    port.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
});
port.postMessage({ ready: true });
