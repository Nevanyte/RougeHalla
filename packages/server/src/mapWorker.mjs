// Bootstrap of the map worker thread. The thread loads TypeScript through tsx's ESM API, so it runs the same way under
// `node --import tsx`, the `tsx` CLI and vitest (a worker inherits none of their loaders). mapService.ts starts it.
import { register } from "tsx/esm/api";

register();
await import("./mapWorkerMain.ts");
