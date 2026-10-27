// generateMap(seed) costs 20-80 ms of synchronous work (the first map of a process about 80 ms: it also builds mapgen's 18 MB
// of lane tables), and a room used to pay it inside its first join, stalling every other room in the process. This runs it in a
// worker thread instead, awaited by RaidRoom.onCreate; onJoin stays synchronous and hands the finished map to createWorld.
//
// The synchronous generateMap is the fallback everywhere it can't be avoided: the worker disabled (MAP_WORKER=0), a process
// that cannot start it, a worker that dies, errors or does not answer within MAP_REQUEST_TIMEOUT_MS. Under vitest (VITEST set) the
// worker is off unless MAP_WORKER=1, or a test asks for one with createMapWorker(), so a test file does not pay for a thread it
// never uses.
import { Worker } from "node:worker_threads";
import { generateMap, type GameMap } from "@raid/shared";

/**
 * How long one map may take, the start of the thread included. It is well under Colyseus's seat reservation window (15 s): core
 * arms a room's auto-dispose timer for that long before onCreate runs, and a room still waiting for its map when it fires is
 * disposed (RaidRoom.onCreate then refuses it). The slowest real map takes about 80 ms and a cold thread under a second.
 */
export const MAP_REQUEST_TIMEOUT_MS = 3_000;
/** The thread loads tsx and builds mapgen's lane tables before it says it is ready; the warm-up at startup has longer than a request. */
export const MAP_START_TIMEOUT_MS = 10_000;

export interface MapWorker {
  /** Resolves with the map, or rejects when the worker cannot deliver it (the caller falls back to generating it itself). */
  generate(seed: number): Promise<GameMap>;
  /** Starts the thread and builds the lane tables, so the first real request does not wait for them. */
  warm(): Promise<void>;
  close(): Promise<void>;
}

interface Pending { resolve: (map: GameMap) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }

export function createMapWorker(
  script: URL = new URL("./mapWorker.mjs", import.meta.url),
  requestTimeoutMs = MAP_REQUEST_TIMEOUT_MS,
  startTimeoutMs = MAP_START_TIMEOUT_MS,
): MapWorker {
  let worker: Worker | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (err: Error) => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); }
    pending.clear();
  };

  function start(): Promise<void> {
    if (ready) return ready;
    ready = new Promise<void>((resolve, reject) => {
      // execArgv emptied: a worker inherits the parent's `--import tsx`, and mapWorker.mjs registers tsx itself.
      const w = new Worker(script, { execArgv: [] });
      worker = w;
      w.unref();
      let startTimer: NodeJS.Timeout | undefined;
      const die = (err: Error) => {
        clearTimeout(startTimer);
        if (worker === w) { worker = null; ready = null; }
        reject(err);
        failAll(err);
      };
      // A thread that never says it is ready would otherwise hold its requests for good: a request's own timer is not what ends this.
      startTimer = setTimeout(() => { die(new Error("map worker did not start in time")); void w.terminate(); }, startTimeoutMs);
      startTimer.unref();
      w.on("message", (m: { id?: number; map?: GameMap; error?: string; ready?: true }) => {
        if (m.ready) { clearTimeout(startTimer); resolve(); return; }
        const p = m.id === undefined ? undefined : pending.get(m.id);
        if (!p) return;
        pending.delete(m.id!);
        clearTimeout(p.timer);
        if (m.map) p.resolve(m.map);
        else p.reject(new Error(m.error ?? "map worker failed"));
      });
      w.on("error", die);
      w.on("exit", (code) => die(new Error(`map worker exited (${code})`)));
    });
    // The caller of start() sees a rejection too; this keeps one nobody awaits from being unhandled.
    ready.catch(() => {});
    return ready;
  }

  return {
    generate(seed) {
      // One deadline for the whole call, the start of a thread included: a room's onCreate waits for it.
      return new Promise<GameMap>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("map worker timed out"));
          // A thread that stopped answering (or never started) is not trusted with the next request.
          void worker?.terminate();
        }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        start().then(() => {
          // No longer pending: the timer fired, or the thread died, while it started.
          if (!pending.has(id)) return;
          if (!worker) { failAll(new Error("map worker is gone")); return; }
          worker.postMessage({ id, seed });
        }, () => { /* die() has failed every pending request, this one included */ });
      });
    },
    warm: start,
    async close() {
      const w = worker;
      worker = null;
      ready = null;
      failAll(new Error("map worker closed"));
      await w?.terminate();
    },
  };
}

let shared: MapWorker | null = null;
let disabled = process.env.MAP_WORKER === "0" || process.env.MAP_WORKER === "false"
  || (process.env.VITEST !== undefined && process.env.MAP_WORKER !== "1");

/** The process's worker, started on first use; null when disabled. */
function sharedWorker(): MapWorker | null {
  if (disabled) return null;
  return (shared ??= createMapWorker());
}

/** Starts the shared worker ahead of the first room (the server calls this at startup). Never throws. */
export function warmMapWorker(): void {
  sharedWorker()?.warm().catch((err) => {
    console.warn(`[server] map worker unavailable, generating maps on the main thread: ${err instanceof Error ? err.message : err}`);
    disabled = true;
  });
}

/** Generates the map of `seed` without blocking the event loop when it can, and on it when it must. */
export async function generateMapAsync(seed: number): Promise<GameMap> {
  const w = sharedWorker();
  if (w) {
    try {
      return await w.generate(seed);
    } catch (err) {
      console.warn(`[server] map worker failed (${err instanceof Error ? err.message : err}); generating on the main thread`);
      // A worker that cannot run once will not later: stop paying for it on every room.
      disabled = true;
      shared = null;
      void w.close().catch(() => {});
    }
  }
  return generateMap(seed);
}

export async function closeMapWorker(): Promise<void> {
  const w = shared;
  shared = null;
  await w?.close();
}
