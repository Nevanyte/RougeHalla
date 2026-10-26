// The map pool (ROGUELIKE_PLAN D20, R2 step 7): certified maps made ahead of time on a worker thread, so a room's first
// join never runs the generator on the event loop. Process infrastructure, outside sim/: the sim only ever receives a
// finished map (createWorld({ map })).
//
// One worker per process (mapWorker.ts) holds its own lane tables and certifies fresh crypto-random seeds with
// `certifiedMap`, one request per map, so it works only while the queue is short: an idle server costs nothing. A
// certified map comes back whole by structured clone (about 52 KB serialized, 85 KB in memory, 0.2 ms to clone), so the
// main thread never generates a map it was handed, together with its spawn walks (spawnWalks, 4 ms of path searches the
// planning deal needs: primed into the map's cache on arrival, so no tick pays for them). Its hash is checked again on
// arrival: what the pool serves is exactly the certified (seed, attempt) a client rebuilds with `generateMap(seed, attempt)`.
//
// An empty queue (a burst, a worker that is down or still warming) falls back to one synchronous `certifiedMap` on the
// main thread, logged. A worker that crashes is restarted with backoff and never takes a room down: the fallback covers
// the gap. A worker that keeps sending maps that fail the arrival check is treated as a crash too (restarted with the same
// backoff), so a broken one cannot spin a core and fill the log.
//
// Training rooms do not need a map of their own: takeForTraining() serves a copy of one of the last few maps handed out,
// so a burst of training entries drains the pool by at most one map (and a pool that is down certifies at most one).
import { randomInt } from "node:crypto";
import { Worker } from "node:worker_threads";
import { certifiedMap, mapHashU32, primeSpawnWalks, warmMapgen, type GameMap } from "@raid/shared";

/** Maps the queue holds when full: a burst of this many rooms never waits. The worker refills 8 in about 0.3 s. */
export const MAP_POOL_TARGET = 8;
/** The worker is asked for more once the queue (counting maps already asked for) is down to this many. */
export const MAP_POOL_REFILL_AT = 6;
/** First restart delay after a worker crash; it doubles with every crash in a row, up to the max. */
export const MAP_WORKER_RESTART_MS = 1_000;
export const MAP_WORKER_RESTART_MAX_MS = 60_000;
/** The server builds no decor (props): they are cosmetic, and mapHash leaves them out, so a client's decorated map hashes the same. */
export const SERVER_MAPGEN = { decor: false } as const;
/** Fresh seeds the in-process fallback tries before it gives up (a seed is discarded about 0 times in 1000). */
export const MAP_FALLBACK_SEEDS = 8;
/** Maps handed out that a training room may copy: the last this many. A training entry never takes one of its own unless none exists yet. */
export const MAP_RECENT_KEEP = 4;
/** Maps in a row that fail the arrival check before the worker counts as crashed (restart with backoff). One bad map is a blip, not a crash. */
export const MAP_REJECT_LIMIT = 3;
/** How long stop() waits for the worker thread to end before it lets go of it (a stalled terminate must not hold the shutdown). */
export const MAP_WORKER_STOP_MS = 2_000;

/** Where a room gets its map. Synchronous, so onAuth/onJoin stay synchronous. */
export interface MapSource {
  /** A certified map no other world holds: an arena room's. */
  take(): GameMap;
  /**
   * A map for a training room, which has no use for a fresh seed: a copy of a recently handed-out map when there is one
   * (never the object another world holds), else a taken one. A burst of training rooms costs the pool at most one map.
   */
  takeForTraining(): GameMap;
}

/** Main thread to worker. */
export interface MapWorkerRequest {
  kind: "make";
  seed: number;
}

/** Worker to main thread. */
export type MapWorkerReply =
  | { kind: "ready"; warmMs: number }
  /** `walks` is spawnWalks(map), computed on the worker so the main thread's planning tick does not (primeSpawnWalks). */
  | { kind: "map"; seed: number; attempt: number; hash: number; map: GameMap; walks?: readonly number[]; ms: number }
  | { kind: "discard"; seed: number; ms: number }
  /** The generator threw: a bug, not a failed attempt. The pool restarts the worker rather than feed it more seeds. */
  | { kind: "error"; seed: number; message: string };

/** What the pool needs of a worker: node's Worker, or a test double. */
export interface MapWorkerLike {
  postMessage(msg: MapWorkerRequest): void;
  on(event: "message" | "error" | "exit", listener: (arg: any) => void): unknown;
  terminate(): unknown;
  unref?(): void;
}

export interface MapPoolOptions {
  /** Maps kept ready (MAP_POOL_TARGET). 0: no worker, every take certifies in process. */
  target?: number;
  /** Refill threshold (MAP_POOL_REFILL_AT, at most target - 1). */
  refillAt?: number;
  /** Starts a worker; the default runs mapWorker.ts on a worker_thread. */
  spawnWorker?: () => MapWorkerLike;
  /** Fresh seeds (crypto by default). */
  nextSeed?: () => number;
  /** The in-process certification (certifiedMap with SERVER_MAPGEN by default). */
  certify?: (seed: number) => GameMap | null;
  /** Builds the main thread's lane tables at start, so a fallback is not cold (default true). */
  warmMain?: boolean;
  restartMs?: number;
  restartMaxMs?: number;
  /** How long stop() waits for the worker to terminate (MAP_WORKER_STOP_MS). */
  stopTimeoutMs?: number;
  log?: (line: string) => void;
  /** Worker deaths (console.error by default). */
  warn?: (line: string) => void;
}

export interface MapPoolStats {
  /** Maps served from the queue. */
  served: number;
  /** Maps certified on the main thread because the queue was empty. */
  fallbacks: number;
  /** Seeds that certified in no attempt (worker and fallback). */
  discards: number;
  /** Worker deaths (crash, error exit, generator error, failed spawn). */
  crashes: number;
  /** Maps from the worker that failed the arrival check (never served). */
  rejected: number;
  /** Training rooms given a copy of a recent map instead of a pool map. */
  reused: number;
  /** Main-thread time spent in fallbacks, ms. */
  fallbackMs: number;
}

/** A fresh public seed: crypto-random, in the range the rooms have always used. */
export function freshSeed(): number {
  return randomInt(0, 2 ** 31);
}

/**
 * The worker as the server runs it: a plain-JS boot file registers tsx in the worker (it gets a clean execArgv, so a
 * parent's own loader is not registered twice) and loads mapWorker.ts. It works the same under `tsx` and under vitest.
 */
export function spawnMapWorker(): MapWorkerLike {
  return new Worker(new URL("./mapWorkerBoot.mjs", import.meta.url), { execArgv: [], name: "map-pool" });
}

export class MapPool implements MapSource {
  readonly target: number;
  readonly refillAt: number;
  readonly stats: MapPoolStats = { served: 0, fallbacks: 0, discards: 0, crashes: 0, rejected: 0, reused: 0, fallbackMs: 0 };
  private readonly queue: GameMap[] = [];
  /**
   * The last MAP_RECENT_KEEP maps handed out by take(), oldest first. Only ever copied from (the maps are read-only, map.ts),
   * never handed out again: the world that took one holds it alone.
   */
  private readonly recent: GameMap[] = [];
  private trainingCursor = 0;
  private worker: MapWorkerLike | null = null;
  /** Requests sent to the current worker and not answered yet. */
  private inFlight = 0;
  /** Worker deaths since its last certified map: the backoff's exponent. */
  private crashStreak = 0;
  /** Maps in a row from the current worker that failed the arrival check. */
  private rejectStreak = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private mainWarmMs = 0;
  private stopped = false;
  private waiters: { n: number; resolve: () => void }[] = [];
  private readonly spawn: () => MapWorkerLike;
  private readonly nextSeed: () => number;
  private readonly certify: (seed: number) => GameMap | null;
  private readonly warmMain: boolean;
  private readonly restartMs: number;
  private readonly restartMaxMs: number;
  private readonly stopTimeoutMs: number;
  private readonly log: (line: string) => void;
  private readonly warn: (line: string) => void;

  constructor(opts: MapPoolOptions = {}) {
    this.target = Math.max(0, Math.floor(opts.target ?? MAP_POOL_TARGET));
    this.refillAt = Math.max(0, Math.min(this.target - 1, Math.floor(opts.refillAt ?? MAP_POOL_REFILL_AT)));
    this.spawn = opts.spawnWorker ?? spawnMapWorker;
    this.nextSeed = opts.nextSeed ?? freshSeed;
    this.certify = opts.certify ?? ((seed) => certifiedMap(seed, SERVER_MAPGEN));
    this.warmMain = opts.warmMain ?? true;
    this.restartMs = opts.restartMs ?? MAP_WORKER_RESTART_MS;
    this.restartMaxMs = opts.restartMaxMs ?? MAP_WORKER_RESTART_MAX_MS;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? MAP_WORKER_STOP_MS;
    this.log = opts.log ?? ((line) => console.log(line));
    this.warn = opts.warn ?? ((line) => console.error(line));
  }

  /** Maps ready to serve. */
  get size(): number {
    return this.queue.length;
  }

  /** True while a worker is running (it may still be warming up). */
  get workerUp(): boolean {
    return this.worker !== null;
  }

  /** Warms the main thread's tables and starts the worker. Idempotent. */
  start(): this {
    if (this.started || this.stopped) return this;
    this.started = true;
    if (this.warmMain) {
      const t0 = performance.now();
      warmMapgen();
      this.mainWarmMs = performance.now() - t0;
    }
    if (this.target > 0) this.startWorker();
    return this;
  }

  /**
   * A certified map, synchronously: the oldest in the queue, else one certified here and now (logged: it blocks the
   * event loop for about 35 ms, 75-120 at p99). Throws only if MAP_FALLBACK_SEEDS fresh seeds in a row all fail.
   */
  take(): GameMap {
    const map = this.queue.shift();
    if (map) {
      this.stats.served++;
      this.refill();
      return this.noteHandedOut(map);
    }
    return this.noteHandedOut(this.fallback());
  }

  /**
   * A map for a training room (a one-player practice room has no use for a seed of its own): a copy of one of the last
   * MAP_RECENT_KEEP maps handed out, in turn, so a burst of training entries takes nothing from the queue. A structured clone
   * (0.2 ms), so no two worlds ever hold one object. With nothing handed out yet it is take(), and the next ones copy that.
   */
  takeForTraining(): GameMap {
    const n = this.recent.length;
    if (n === 0) return this.take();
    this.stats.reused++;
    return structuredClone(this.recent[this.trainingCursor++ % n]!);
  }

  /** Resolves once the queue holds `n` maps (default: full), or at stop. For tests and benches. */
  whenFilled(n = this.target): Promise<void> {
    if (this.queue.length >= n || this.stopped) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ n, resolve }));
  }

  /**
   * Terminates the worker and cancels a pending restart. The queue is dropped. Idempotent. Waits for the thread to end for
   * at most `stopTimeoutMs` and never throws: a terminate that stalls must not hold up whatever shuts down after the pool.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const w = this.worker;
    this.worker = null;
    this.inFlight = 0;
    this.queue.length = 0;
    this.recent.length = 0;
    for (const w2 of this.waiters.splice(0)) w2.resolve();
    if (!w) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), this.stopTimeoutMs);
    });
    if (await Promise.race([this.end(w).then(() => false), timedOut])) this.warn(`[maps] map worker did not end within ${this.stopTimeoutMs} ms; not waiting for it`);
    clearTimeout(timer);
  }

  private noteHandedOut(map: GameMap): GameMap {
    this.recent.push(map);
    if (this.recent.length > MAP_RECENT_KEEP) this.recent.shift();
    return map;
  }

  /** terminate(), started now; settles when the thread is gone, whether or not that went well. */
  private end(w: MapWorkerLike): Promise<void> {
    try {
      return Promise.resolve(w.terminate()).then(() => {}, () => {});
    } catch {
      return Promise.resolve();
    }
  }

  /** Ends a worker without waiting for it (it is already replaced or dead as far as the pool is concerned). */
  private discard(w: MapWorkerLike): void {
    void this.end(w);
  }

  private fallback(): GameMap {
    const t0 = performance.now();
    for (let i = 0; i < MAP_FALLBACK_SEEDS; i++) {
      const seed = this.nextSeed();
      const map = this.certify(seed);
      if (!map) {
        this.stats.discards++;
        continue;
      }
      const ms = performance.now() - t0;
      this.stats.fallbacks++;
      this.stats.fallbackMs += ms;
      // A pool of size 0 is the configured path (tests, MAP_POOL=0), not a miss worth a line.
      if (this.target > 0) {
        const why = this.worker ? `${this.inFlight} on the way` : this.stopped ? "pool stopped" : "worker down";
        this.log(`[maps] pool empty (${why}): certified seed ${seed} attempt ${map.attempt} on the main thread in ${ms.toFixed(0)} ms`);
      }
      this.refill();
      return map;
    }
    throw new Error(`[maps] ${MAP_FALLBACK_SEEDS} fresh seeds in a row certified in no attempt`);
  }

  private startWorker(): void {
    if (this.stopped || this.worker) return;
    let w: MapWorkerLike;
    try {
      w = this.spawn();
    } catch (err) {
      this.workerDied(null, `could not start: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.worker = w;
    this.inFlight = 0;
    this.rejectStreak = 0;
    // The pool never keeps the process alive: a server that is done exits even if nobody stopped it.
    w.unref?.();
    w.on("message", (msg: MapWorkerReply) => this.onReply(w, msg));
    w.on("error", (err: unknown) => this.workerDied(w, `crashed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`));
    w.on("exit", (code: number) => this.workerDied(w, `exited with code ${code}`));
    this.refill(true);
  }

  private onReply(w: MapWorkerLike, msg: MapWorkerReply): void {
    if (w !== this.worker) return;
    switch (msg.kind) {
      case "ready":
        this.log(`[maps] map worker ready: lane tables in ${msg.warmMs.toFixed(0)} ms (main thread: ${this.mainWarmMs.toFixed(0)} ms)`);
        return;
      case "map": {
        this.inFlight = Math.max(0, this.inFlight - 1);
        const map = msg.map;
        // The structured clone is trusted no further than its hash: a map that does not match what the worker certified
        // (or is not the pair it claims) is never served.
        if (map?.seed !== msg.seed || map.attempt !== msg.attempt || mapHashU32(map) !== msg.hash) {
          this.stats.rejected++;
          this.rejectStreak++;
          this.log(`[maps] dropped worker map for seed ${msg.seed} attempt ${msg.attempt}: it does not match its hash`);
          // A worker that cannot send a good map is as broken as one that crashes: restart it with the crash backoff,
          // instead of refilling at once for as long as it keeps answering (a core spun and a line logged every ~35 ms).
          if (this.rejectStreak >= MAP_REJECT_LIMIT) {
            this.workerDied(w, `sent ${this.rejectStreak} maps in a row that fail the arrival check`);
            this.discard(w);
            return;
          }
        } else {
          this.crashStreak = 0;
          this.rejectStreak = 0;
          // The walks are the worker's word, like the map's other fields past the hash: they only feed the planning deal.
          if (msg.walks) primeSpawnWalks(map, msg.walks);
          this.queue.push(map);
          this.wake();
        }
        this.refill();
        return;
      }
      case "discard":
        this.inFlight = Math.max(0, this.inFlight - 1);
        this.stats.discards++;
        this.log(`[maps] seed ${msg.seed} certified in no attempt (${msg.ms.toFixed(0)} ms): discarded`);
        this.refill();
        return;
      case "error":
        this.workerDied(w, `generator error on seed ${msg.seed}: ${msg.message}`);
        this.discard(w);
        return;
    }
  }

  /** Asks for maps up to the target once the queue (with what is on the way) is at the refill mark, or always with `force`. */
  private refill(force = false): void {
    const w = this.worker;
    if (!w || this.stopped) return;
    const have = this.queue.length + this.inFlight;
    if (!force && have > this.refillAt) return;
    for (let n = have; n < this.target; n++) {
      this.inFlight++;
      w.postMessage({ kind: "make", seed: this.nextSeed() });
    }
  }

  private wake(): void {
    if (this.waiters.length === 0) return;
    const still: typeof this.waiters = [];
    for (const w of this.waiters) (this.queue.length >= w.n ? w.resolve() : still.push(w));
    this.waiters = still;
  }

  /** Once per death (a crash fires both "error" and "exit"): logged, and a restart is scheduled with backoff. */
  private workerDied(w: MapWorkerLike | null, why: string): void {
    if (w !== null && w !== this.worker) return;
    this.worker = null;
    this.inFlight = 0;
    if (this.stopped) return;
    this.stats.crashes++;
    const delay = Math.min(this.restartMaxMs, this.restartMs * 2 ** Math.min(this.crashStreak, 16));
    this.crashStreak++;
    this.warn(`[maps] map worker ${why}; restarting in ${delay} ms (rooms certify on the main thread until then)`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.startWorker();
    }, delay);
    this.restartTimer.unref?.();
  }
}
