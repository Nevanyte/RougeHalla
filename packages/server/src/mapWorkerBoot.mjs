// Entry of the map pool's worker thread (mapPool.ts spawnMapWorker). Plain JS on purpose: the worker starts with a clean
// execArgv, so it registers tsx itself and then loads the TypeScript worker. That works the same under `tsx` (dev,
// start) and under vitest, whose own module loader a worker thread does not inherit.
import { register } from "tsx/esm/api";

register();
await import("./mapWorker.ts");
