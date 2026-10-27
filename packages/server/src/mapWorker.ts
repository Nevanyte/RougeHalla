// The map pool's worker thread (mapPool.ts): its own warm layout tables, and one certified map per "make" request, posted back
// whole. It never decides how many maps to make: the pool asks only while its queue is short, so an idle server sleeps.
import { parentPort } from "node:worker_threads";
import { certifiedMap, mapHashU32, spawnWalks, warmMapgen } from "@raid/shared";
import { SERVER_MAPGEN, type MapWorkerReply, type MapWorkerRequest } from "./mapPool";

const port = parentPort;
if (!port) throw new Error("mapWorker.ts runs on a worker thread (mapPool.ts starts it)");

const post = (reply: MapWorkerReply): void => port.postMessage(reply);

const t0 = performance.now();
warmMapgen();
post({ kind: "ready", warmMs: performance.now() - t0 });

port.on("message", (req: MapWorkerRequest) => {
  if (req?.kind !== "make") return;
  const seed = req.seed;
  const t = performance.now();
  try {
    const map = certifiedMap(seed, SERVER_MAPGEN);
    const ms = performance.now() - t;
    if (!map) post({ kind: "discard", seed, ms });
    // A structured clone, not a transfer: the five tile layers (featureGrid included) are 92 KB at 136x136, and the copy costs less
    // than a check that nothing else holds their buffers. The spawn walks (the generator certified them with findPath and primed
    // them into the map's cache, so spawnWalks costs nothing here) go with the map, so the main
    // thread's first planning tick does not run them.
    else post({ kind: "map", seed, attempt: map.attempt, hash: mapHashU32(map), map, walks: spawnWalks(map).slice(), ms });
  } catch (err) {
    post({ kind: "error", seed, message: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
});
