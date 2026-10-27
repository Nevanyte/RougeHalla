// The room's map, built off the page's thread (ROGUELIKE_PLAN D20, R2 step 8). The map is never synced: the state says
// (seed, attempt), and every client runs exactly that one attempt of the shared generator. The attempt (a 136 x 136 map: about 60-90
// ms in Chrome once warm, more cold) would freeze the page, so a Web Worker runs it:
//   - at app boot, once the hub is up (warmWhenIdle), it builds the layout tables (a few ms) and runs one throwaway attempt, so the
//     first real map meets a warm JIT;
//   - when a room is joined, mapFor(seed, attempt) asks it for that map, which comes back with its tile layers moved,
//     not copied.
// Where there is no worker (tests, an old browser, a worker that failed to load, crashed, sent a message the page could not
// read, or did not answer a request within REQUEST_TIMEOUT_MS) the same call builds the map on this thread instead, so
// nothing else changes. One map per (seed, attempt): every consumer of a room gets the same object.
import { generateMap, type GameMap } from "@raid/shared";
import type { MapWorkerIn, MapWorkerOut } from "./mapWorkerProtocol";

/** What the loader needs of a worker: a Web Worker, or a test double. */
export interface MapWorkerHandle {
  postMessage(msg: MapWorkerIn): void;
  onmessage: ((e: MessageEvent<MapWorkerOut>) => void) | null;
  onerror: ((e: Event) => void) | null;
  /** A reply the page could not deserialize. */
  onmessageerror?: ((e: MessageEvent) => void) | null;
  terminate(): void;
}

/** A request the worker has not answered by then marks it failed (a cold attempt takes ~0.1-0.2 s; a stalled worker never answers). */
export const REQUEST_TIMEOUT_MS = 5_000;

export interface MapLoaderOptions {
  /** Starts the worker; null when there is none. Default: the module worker in mapWorkerEntry.ts, if Worker exists. */
  spawn?: () => MapWorkerHandle | null;
  /** The in-thread build (generateMap by default). */
  build?: (seed: number, attempt: number) => GameMap;
  /** Maps kept by (seed, attempt). The room being joined, and the one before it for a quick way back. */
  cacheSize?: number;
  /** How long a request waits for the worker before the worker is dropped and the map built here (REQUEST_TIMEOUT_MS). */
  requestTimeoutMs?: number;
}

/** The module worker, as Vite bundles it (the `new Worker(new URL(...))` form must stay literal for that). */
export function spawnMapWorker(): MapWorkerHandle | null {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./mapWorkerEntry.ts", import.meta.url), { type: "module", name: "maps" }) as unknown as MapWorkerHandle;
}

interface Pending {
  seed: number;
  attempt: number;
  resolve: (map: GameMap) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MapLoader {
  private readonly spawn: () => MapWorkerHandle | null;
  private readonly build: (seed: number, attempt: number) => GameMap;
  private readonly cacheSize: number;
  private readonly requestTimeoutMs: number;
  private worker: MapWorkerHandle | null = null;
  /** No worker can be had (none in this environment, or one failed): everything is built on this thread. */
  private noWorker = false;
  private warmed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Insertion order is age: the oldest entry goes first. */
  private readonly cache = new Map<string, Promise<GameMap>>();

  constructor(opts: MapLoaderOptions = {}) {
    this.spawn = opts.spawn ?? spawnMapWorker;
    this.build = opts.build ?? ((seed, attempt) => generateMap(seed, attempt));
    this.cacheSize = Math.max(1, opts.cacheSize ?? 2);
    this.requestTimeoutMs = Math.max(1, opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS);
  }

  /** True while maps are built on a worker. */
  get usingWorker(): boolean {
    return this.worker !== null;
  }

  /** Starts the worker and has it build its tables and warm up. Idempotent; a no-op without a worker. */
  warm(): void {
    if (this.warmed) return;
    this.warmed = true;
    this.ensureWorker()?.postMessage({ kind: "warm" });
  }

  /**
   * Exactly `generateMap(seed, attempt)`, the same object for every call with the same pair. Rejects when that attempt
   * does not certify here: this client cannot build the server's map.
   */
  mapFor(seed: number, attempt: number): Promise<GameMap> {
    const key = `${seed}:${attempt}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const made = this.request(seed, attempt);
    this.cache.set(key, made);
    for (const old of this.cache.keys()) {
      if (this.cache.size <= this.cacheSize) break;
      this.cache.delete(old);
    }
    // A failed build is not kept: the next ask tries again.
    made.catch(() => { if (this.cache.get(key) === made) this.cache.delete(key); });
    return made;
  }

  private request(seed: number, attempt: number): Promise<GameMap> {
    const w = this.ensureWorker();
    if (!w) return this.inThread(seed, attempt);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      // A worker that never answers (it hung, or died without an error event) must not leave the join waiting for ever:
      // past the timeout it is dropped like one that crashed, and this request and every later one are built here.
      const timer = setTimeout(() => this.workerFailed(w, `no answer to a request within ${this.requestTimeoutMs} ms`), this.requestTimeoutMs);
      this.pending.set(id, { seed, attempt, resolve, reject, timer });
      try {
        w.postMessage({ kind: "map", id, seed, attempt });
      } catch (err) {
        this.workerFailed(w, err);
      }
    });
  }

  /** On a later task, so whatever the caller put on screen (the loading screen) is painted before the page blocks. */
  private inThread(seed: number, attempt: number): Promise<GameMap> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(this.build(seed, attempt));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }, 0);
    });
  }

  private ensureWorker(): MapWorkerHandle | null {
    if (this.worker || this.noWorker) return this.worker;
    let w: MapWorkerHandle | null = null;
    try {
      w = this.spawn();
    } catch (err) {
      console.warn("[maps] no map worker; maps are built on the page's thread", err);
    }
    if (!w) {
      this.noWorker = true;
      return null;
    }
    w.onmessage = (e) => this.onReply(w, e.data);
    w.onerror = (e) => this.workerFailed(w, e);
    w.onmessageerror = (e) => this.workerFailed(w, e);
    this.worker = w;
    return w;
  }

  private onReply(w: MapWorkerHandle, msg: MapWorkerOut): void {
    if (w !== this.worker) return;
    if (msg.kind === "warm") {
      if (import.meta.env?.DEV) console.debug(`[maps] worker warm: layout ${msg.layoutMs.toFixed(0)} ms, warm-up attempt ${msg.attemptMs.toFixed(0)} ms`);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.kind === "map") p.resolve(msg.map);
    else p.reject(new Error(msg.message));
  }

  /** A worker that fails (it did not load, crashed, sent an unreadable message or stopped answering) is dropped for good; what it owed is built here instead. */
  private workerFailed(w: MapWorkerHandle, why: unknown): void {
    if (w !== this.worker) return;
    console.warn("[maps] the map worker failed; maps are built on the page's thread from now on", why);
    this.worker = null;
    this.noWorker = true;
    try { w.terminate(); } catch { /* already gone */ }
    const owed = [...this.pending.values()];
    this.pending.clear();
    for (const p of owed) {
      clearTimeout(p.timer);
      this.inThread(p.seed, p.attempt).then(p.resolve, p.reject);
    }
  }
}

/** The page's one loader. */
export const mapLoader = new MapLoader();

/** Warms the loader once the page has a quiet moment (the hub is already drawn), or after `fallbackMs` at the latest. */
export function warmWhenIdle(loader: MapLoader = mapLoader, fallbackMs = 1500): void {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => loader.warm(), { timeout: fallbackMs });
  else setTimeout(() => loader.warm(), Math.min(fallbackMs, 300));
}
