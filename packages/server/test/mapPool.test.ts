// The map pool (src/mapPool.ts; ROGUELIKE_PLAN D20, R2 step 7). Three halves:
//   - the real worker thread: what it serves is a certified (seed, attempt) whose map is exactly what generateMap(seed,
//     attempt) builds in this process, it refills after a take, and stop() ends the thread;
//   - the pool's own rules with stand-in workers: the fallback when the queue is empty, a worker that crashes, errs or
//     sends a map that is not what it claims (never served; a worker that keeps doing it is restarted with the crash
//     backoff), the restart backoff, the spawn walks that ride with a map, training's copies of recent maps, and a
//     stop() that a stalled terminate cannot hold up;
//   - the hang watchdog (a worker that owes replies and sends nothing for `hangMs` is terminated and restarted like a
//     crash), mostly on fake timeouts so every window is exact;
//   - rooms on a real server: a burst of arena rooms each gets its own certified map, published as (seed, attempt,
//     mapHash), a burst of training rooms takes at most one, a server whose worker never comes up still builds every
//     room, and the profiles are flushed before the pool is stopped.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import {
  certifiedMap, generateMap, mapHashU32, MAX_ATTEMPTS, ROOM_NAME, spawnWalks, TRAINING_ROOM_NAME, tryAttempt, type GameMap, type JoinOptions,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { roomMap } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import {
  MAP_FALLBACK_SEEDS, MAP_POOL_REFILL_AT, MAP_POOL_TARGET, MAP_RECENT_KEEP, MAP_REJECT_LIMIT, MAP_WORKER_HANG_MS, MapPool, SERVER_MAPGEN, spawnMapWorker,
  type MapWorkerLike, type MapWorkerReply, type MapWorkerRequest,
} from "../src/mapPool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(5);
  }
}

/** Seeds 0, 1, 2... from `from`: a pool's maps are then the same every run. */
const counter = (from: number) => {
  let n = from;
  return () => n++;
};

/**
 * The pool's guarantee for one served map: a certified attempt, the first of its seed, rebuilt the same here without
 * decor (as the server builds), and hashing the same as a client's decorated build of that one attempt.
 */
function expectCertifiedPair(map: GameMap): void {
  expect(map.attempt).toBeGreaterThanOrEqual(0);
  expect(map.attempt).toBeLessThan(MAX_ATTEMPTS);
  const again = generateMap(map.seed, map.attempt, SERVER_MAPGEN);
  expect(map).toEqual(again);
  expect(map.props).toEqual([]);
  expect(mapHashU32(map)).toBe(mapHashU32(generateMap(map.seed, map.attempt)));
  for (let a = 0; a < map.attempt; a++) expect(tryAttempt(map.seed, a, SERVER_MAPGEN)).toBeNull();
}

/** A worker on this thread: answers each request (or not) the way `answer` says. */
class FakeWorker extends EventEmitter implements MapWorkerLike {
  readonly posted: MapWorkerRequest[] = [];
  terminated = false;
  /** terminate() returns a promise that never settles (a thread that will not die). */
  hangOnTerminate = false;
  constructor(private readonly answer: (req: MapWorkerRequest, w: FakeWorker) => void = () => {}) {
    super();
  }
  postMessage(msg: MapWorkerRequest): void {
    this.posted.push(msg);
    this.answer(msg, this);
  }
  reply(msg: MapWorkerReply): void {
    this.emit("message", msg);
  }
  terminate(): Promise<void> | void {
    if (this.terminated) return;
    this.terminated = true;
    if (this.hangOnTerminate) return new Promise<void>(() => {});
    setImmediate(() => this.emit("exit", 1));
  }
}

/** Answers like the real worker: certifiedMap on the seed, the map sent by structured clone, on a later turn. */
const certifies = (req: MapWorkerRequest, w: FakeWorker): void => {
  setImmediate(() => {
    if (w.terminated) return;
    const map = certifiedMap(req.seed, SERVER_MAPGEN);
    w.reply(map
      ? { kind: "map", seed: req.seed, attempt: map.attempt, hash: mapHashU32(map), map: structuredClone(map), ms: 0 }
      : { kind: "discard", seed: req.seed, ms: 0 });
  });
};

const quiet = { log: () => {}, warn: () => {} };

// ================================================================= the real worker thread

describe("the map pool's worker thread", () => {
  const spawned: Worker[] = [];
  /** The `walks` field of every map message the real worker posted. */
  const shippedWalks: Array<readonly number[] | undefined> = [];
  let pool: MapPool;

  beforeAll(async () => {
    pool = new MapPool({
      target: 3, refillAt: 2, nextSeed: counter(4100), ...quiet,
      spawnWorker: () => {
        const w = spawnMapWorker() as Worker;
        w.on("message", (m: MapWorkerReply) => { if (m.kind === "map") shippedWalks.push(m.walks); });
        spawned.push(w);
        return w;
      },
    }).start();
    await pool.whenFilled();
  }, 60_000);

  afterAll(async () => {
    await pool.stop();
  });

  it("serves only certified (seed, attempt) pairs, each the map generateMap(seed, attempt) builds in this process", () => {
    expect(pool.size).toBe(3);
    const served: GameMap[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      served.push(pool.take());
      // Off the queue: no generator on this thread.
      expect(performance.now() - t0).toBeLessThan(5);
    }
    expect(served.map((m) => m.seed)).toEqual([4100, 4101, 4102]);
    for (const map of served) {
      expectCertifiedPair(map);
      // The worker's walks (shipped with the map) are the ones a computation gives, so a planning deal reads them as they are.
      expect(spawnWalks(map)).toEqual(spawnWalks(structuredClone(map)));
      expect(spawnWalks(map)).toHaveLength(map.spawnPool.length);
    }
    // They were worked out on the worker and came with each map: the main thread ran no path search for them.
    expect(shippedWalks.length).toBeGreaterThanOrEqual(3);
    for (const w of shippedWalks) expect(Array.isArray(w) && w.length >= 24).toBe(true);
    expect(pool.stats).toMatchObject({ served: 3, fallbacks: 0, rejected: 0, crashes: 0 });
  });

  it("refills after a take, from fresh seeds", async () => {
    await pool.whenFilled(3);
    const map = pool.take();
    expect(map.seed).toBeGreaterThanOrEqual(4103);
    expectCertifiedPair(map);
    await pool.whenFilled(3);
    expect(pool.size).toBe(3);
    expect(pool.stats.fallbacks).toBe(0);
    expect(spawned).toHaveLength(1);
  });

  it("stop() ends the thread, and a later take still gets a certified map in process", async () => {
    const w = spawned[0]!;
    const exited = new Promise<number>((resolve) => w.once("exit", resolve));
    await pool.stop();
    await exited;
    expect(pool.workerUp).toBe(false);
    expect(pool.size).toBe(0);
    const map = pool.take();
    expectCertifiedPair(map);
    expect(pool.stats.fallbacks).toBe(1);
  });
});

// ================================================================= the pool's rules, stand-in workers

describe("the map pool's rules", () => {
  it("has named defaults: a few maps, refilled before it runs dry", () => {
    expect(MAP_POOL_TARGET).toBe(8);
    expect(MAP_POOL_REFILL_AT).toBeLessThan(MAP_POOL_TARGET);
    const pool = new MapPool({ target: 4, refillAt: 9, ...quiet, warmMain: false });
    expect(pool.refillAt).toBe(3);
  });

  it("asks for maps only up to its target, and again only once at its refill mark", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 4, refillAt: 2, nextSeed: counter(10), warmMain: false, ...quiet,
      spawnWorker: () => { const w = new FakeWorker(certifies); workers.push(w); return w; },
    }).start();
    const w = workers[0]!;
    expect(w.posted.map((r) => r.seed)).toEqual([10, 11, 12, 13]);
    await pool.whenFilled();
    pool.take(); // 3 left: above the mark, nothing asked
    expect(w.posted).toHaveLength(4);
    pool.take(); // 2 left: at the mark, topped back up to 4
    expect(w.posted.map((r) => r.seed)).toEqual([10, 11, 12, 13, 14, 15]);
    await pool.whenFilled();
    expect(pool.size).toBe(4);
    // Full and idle: the worker is asked for nothing more.
    await sleep(20);
    expect(w.posted).toHaveLength(6);
    await pool.stop();
    expect(w.terminated).toBe(true);
  });

  it("with no worker (target 0), every take certifies in process, silently", () => {
    const lines: string[] = [];
    const pool = new MapPool({ target: 0, nextSeed: counter(42), log: (l) => lines.push(l), warn: (l) => lines.push(l) }).start();
    const map = pool.take();
    expect(map.seed).toBe(42);
    expectCertifiedPair(map);
    expect(pool.stats).toMatchObject({ fallbacks: 1, served: 0 });
    expect(pool.workerUp).toBe(false);
    expect(lines).toEqual([]);
  });

  it("an empty queue falls back to one certification here, one log line each", () => {
    const lines: string[] = [];
    // A worker that never answers: the queue stays empty.
    const pool = new MapPool({
      target: 2, nextSeed: counter(70), warmMain: false, log: (l) => lines.push(l), warn: () => {},
      spawnWorker: () => new FakeWorker(),
    }).start();
    const a = pool.take();
    const b = pool.take();
    expect([a.seed, b.seed]).toEqual([72, 73]); // 70 and 71 went to the worker
    expectCertifiedPair(a);
    expect(pool.stats.fallbacks).toBe(2);
    expect(lines.filter((l) => l.includes("pool empty"))).toHaveLength(2);
    void pool.stop();
  });

  it("the fallback skips a seed that certifies in no attempt, and gives up only after MAP_FALLBACK_SEEDS of them", () => {
    let calls = 0;
    const pool = new MapPool({
      target: 0, warmMain: false, nextSeed: counter(5), ...quiet,
      certify: (seed) => (++calls === 1 ? null : certifiedMap(seed, SERVER_MAPGEN)),
    });
    const map = pool.take();
    expect(map.seed).toBe(6);
    expect(pool.stats.discards).toBe(1);
    const never = new MapPool({ target: 0, warmMain: false, ...quiet, certify: () => null });
    expect(() => never.take()).toThrow(/certified in no attempt/);
    expect(never.stats.discards).toBe(MAP_FALLBACK_SEEDS);
  });

  it("the fallback treats a seed whose certification throws as a discard and moves on to the next", () => {
    let calls = 0;
    const pool = new MapPool({
      target: 0, warmMain: false, nextSeed: counter(40), ...quiet,
      certify: (seed) => { if (++calls === 1) throw new Error("styler blew up"); return certifiedMap(seed, SERVER_MAPGEN); },
    });
    const map = pool.take();
    expect(map.seed).toBe(41);
    expect(pool.stats.discards).toBe(1);
    const broken = new MapPool({ target: 0, warmMain: false, ...quiet, certify: () => { throw new Error("always"); } });
    expect(() => broken.take()).toThrow(/certified in no attempt/);
    expect(broken.stats.discards).toBe(MAP_FALLBACK_SEEDS);
  });

  it("never serves a worker map that does not match its hash or its (seed, attempt)", async () => {
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(300), warmMain: false, ...quiet,
      spawnWorker: () => new FakeWorker((req, w) => setImmediate(() => {
        const map = certifiedMap(req.seed, SERVER_MAPGEN)!;
        const clone = structuredClone(map);
        if (req.seed === 300) clone.tiles[100] ^= 1; // corrupted on the way
        if (req.seed === 301) clone.seed = 999; // not the pair it claims
        w.reply({ kind: "map", seed: req.seed, attempt: map.attempt, hash: mapHashU32(map), map: clone, ms: 0 });
      })),
    }).start();
    await pool.whenFilled(2);
    expect(pool.stats.rejected).toBe(2);
    const served = [pool.take(), pool.take()];
    expect(served.map((m) => m.seed)).toEqual([302, 303]);
    for (const m of served) expectCertifiedPair(m);
    await pool.stop();
  });

  it("restarts a crashing worker with a doubling backoff, and rooms keep getting maps meanwhile", async () => {
    const spawnedAt: number[] = [];
    const lines: string[] = [];
    let crash = true;
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(900), warmMain: false, restartMs: 10, restartMaxMs: 40,
      log: () => {}, warn: (l) => lines.push(l),
      spawnWorker: () => {
        spawnedAt.push(performance.now());
        if (!crash) return new FakeWorker(certifies);
        const w = new FakeWorker();
        // How node reports an uncaught exception in a worker: "error", then "exit" with code 1.
        setImmediate(() => { w.emit("error", new Error("boom")); w.emit("exit", 1); });
        return w;
      },
    }).start();
    // While it is down, a room still gets a certified map.
    await until(() => pool.stats.crashes >= 1, "the first crash");
    expectCertifiedPair(pool.take());
    await until(() => spawnedAt.length >= 5, "four restarts");
    // One death per crash, though each fires both events.
    expect(pool.stats.crashes).toBe(spawnedAt.length - (pool.workerUp ? 1 : 0));
    const gaps = spawnedAt.slice(1, 5).map((t, i) => t - spawnedAt[i]!);
    expect(gaps[0]).toBeGreaterThanOrEqual(9);
    expect(gaps[1]).toBeGreaterThanOrEqual(19);
    expect(gaps[2]).toBeGreaterThanOrEqual(39);
    expect(gaps[3]).toBeGreaterThanOrEqual(39); // capped at restartMaxMs
    expect(lines.every((l) => /map worker crashed: .*boom/s.test(l))).toBe(true);
    // A worker that comes up fills the queue, and the streak is forgotten.
    crash = false;
    await pool.whenFilled(2);
    expect(pool.workerUp).toBe(true);
    expectCertifiedPair(pool.take());
    await pool.stop();
  });

  it("a worker that cannot even be started, or whose generator throws, is restarted the same way", async () => {
    let n = 0;
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 1, refillAt: 0, nextSeed: counter(1200), warmMain: false, restartMs: 1, restartMaxMs: 2, ...quiet,
      spawnWorker: () => {
        n++;
        if (n === 1) throw new Error("no threads here");
        const w = n === 2
          ? new FakeWorker((req, fw) => setImmediate(() => fw.reply({ kind: "error", seed: req.seed, message: "bug" })))
          : new FakeWorker(certifies);
        workers.push(w);
        return w;
      },
    }).start();
    expect(pool.stats.crashes).toBe(1);
    await pool.whenFilled(1);
    expect(pool.stats.crashes).toBe(2);
    expect(workers[0]!.terminated).toBe(true); // the one whose generator threw
    expectCertifiedPair(pool.take());
    await pool.stop();
  });

  it("a worker that keeps sending bad maps is restarted with the crash backoff, not refilled in a tight loop", async () => {
    const spawnedAt: number[] = [];
    const lines: string[] = [];
    const warns: string[] = [];
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 4, refillAt: 3, nextSeed: counter(500), warmMain: false, restartMs: 20, restartMaxMs: 80,
      log: (l) => lines.push(l), warn: (l) => warns.push(l),
      spawnWorker: () => {
        spawnedAt.push(performance.now());
        // Answers every request at once, every time, with a map that is not what its hash says.
        const w = new FakeWorker((req, fw) => setImmediate(() => {
          if (fw.terminated) return;
          const map = certifiedMap(req.seed, SERVER_MAPGEN)!;
          const clone = structuredClone(map);
          clone.tiles[100] ^= 1;
          fw.reply({ kind: "map", seed: req.seed, attempt: map.attempt, hash: mapHashU32(map), map: clone, ms: 0 });
        }));
        workers.push(w);
        return w;
      },
    }).start();
    await until(() => spawnedAt.length >= 4, "three restarts");
    // The bad worker was ended after MAP_REJECT_LIMIT bad maps and counted as a death, and the next start waited.
    expect(workers[0]!.terminated).toBe(true);
    expect(pool.stats.crashes).toBeGreaterThanOrEqual(3);
    expect(warns[0]).toMatch(new RegExp(`sent ${MAP_REJECT_LIMIT} maps in a row that fail the arrival check; restarting in 20 ms`));
    const gaps = spawnedAt.slice(1, 4).map((t, i) => t - spawnedAt[i]!);
    expect(gaps[0]).toBeGreaterThanOrEqual(19);
    expect(gaps[1]).toBeGreaterThanOrEqual(39);
    expect(gaps[2]).toBeGreaterThanOrEqual(79); // doubled each time, up to restartMaxMs
    // At most MAP_REJECT_LIMIT rejections per start (and a line each), whatever the worker's speed.
    expect(pool.stats.rejected).toBeLessThanOrEqual(MAP_REJECT_LIMIT * spawnedAt.length);
    expect(lines.filter((l) => l.includes("dropped worker map")).length).toBe(pool.stats.rejected);
    expect(pool.size).toBe(0);
    // Rooms keep getting a certified map from the fallback meanwhile.
    expectCertifiedPair(pool.take());
    await pool.stop();
  });

  it("one bad map is a blip: the streak starts over with the next good one, and the worker stays", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 1, refillAt: 0, nextSeed: counter(600), warmMain: false, ...quiet,
      spawnWorker: () => {
        // Seeds 600, 601 are bad, 602 good, 603, 604 bad, then good for ever: never MAP_REJECT_LIMIT in a row.
        const w = new FakeWorker((req, fw) => setImmediate(() => {
          const map = certifiedMap(req.seed, SERVER_MAPGEN)!;
          const clone = structuredClone(map);
          if (req.seed < 602 || req.seed === 603 || req.seed === 604) clone.tiles[100] ^= 1;
          fw.reply({ kind: "map", seed: req.seed, attempt: map.attempt, hash: mapHashU32(map), map: clone, ms: 0 });
        }));
        workers.push(w);
        return w;
      },
    }).start();
    await pool.whenFilled(1);
    expect(pool.take().seed).toBe(602);
    await pool.whenFilled(1);
    expect(pool.take().seed).toBe(605);
    expect(pool.stats).toMatchObject({ rejected: 4, crashes: 0 });
    expect(workers).toHaveLength(1);
    await pool.stop();
  });

  it("serves a map with the spawn walks its worker shipped, and ignores walks that do not fit", async () => {
    const real = (seed: number) => spawnWalks(certifiedMap(seed, SERVER_MAPGEN)!);
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(700), warmMain: false, ...quiet,
      spawnWorker: () => new FakeWorker((req, w) => setImmediate(() => {
        const map = certifiedMap(req.seed, SERVER_MAPGEN)!;
        // 700: walks the worker "computed" (a sentinel, to tell them from a computation); 701: a list of the wrong length.
        const walks = req.seed === 700 ? real(req.seed).map((v) => v + 1000) : [1, 2, 3];
        w.reply({ kind: "map", seed: req.seed, attempt: map.attempt, hash: mapHashU32(map), map: structuredClone(map), walks, ms: 0 });
      })),
    }).start();
    await pool.whenFilled(2);
    const [shipped, wrong] = [pool.take(), pool.take()];
    expect(spawnWalks(shipped)).toEqual(real(700).map((v) => v + 1000)); // used as sent: no search ran for it here
    expect(spawnWalks(wrong)).toEqual(real(701)); // refused: computed here
    await pool.stop();
  });

  it("training copies recent maps and takes nothing from the queue: the first entry takes one, a burst of 12 costs just that", async () => {
    const pool = new MapPool({
      target: 4, refillAt: 2, nextSeed: counter(800), warmMain: false, ...quiet, spawnWorker: () => new FakeWorker(certifies),
    }).start();
    await pool.whenFilled(4);
    const first = pool.takeForTraining(); // nothing handed out yet: a pooled map
    expect(first.seed).toBe(800);
    expect(pool.stats).toMatchObject({ served: 1, reused: 0 });
    const copies = Array.from({ length: 11 }, () => pool.takeForTraining());
    expect(pool.stats).toMatchObject({ served: 1, reused: 11, fallbacks: 0 });
    // One world, one map object: every copy is a map of its own, equal to the first and never the first itself.
    expect(new Set([first, ...copies]).size).toBe(12);
    for (const copy of copies) {
      expect(copy).toEqual(first);
      expect(copy.tiles.buffer).not.toBe(first.tiles.buffer);
      expect(copy.spawnPool).not.toBe(first.spawnPool);
    }
    // A world that wrote on its map (the sim must not, but a copy keeps the others safe) changes nobody else's.
    copies[0]!.tiles.fill(1);
    copies[0]!.spawnPool.length = 0;
    expect(pool.takeForTraining()).toEqual(first);
    expect(copies[1]).toEqual(first);
    await pool.stop();
  });

  it("training rotates through the last few maps arena rooms took, and a stopped pool forgets them", async () => {
    const pool = new MapPool({ target: 0, nextSeed: counter(900), warmMain: false, ...quiet });
    const taken = Array.from({ length: MAP_RECENT_KEEP + 2 }, () => pool.take().seed);
    expect(taken).toEqual([900, 901, 902, 903, 904, 905]);
    const lastFew = taken.slice(-MAP_RECENT_KEEP);
    const training = Array.from({ length: MAP_RECENT_KEEP + 1 }, () => pool.takeForTraining().seed);
    expect(training).toEqual([...lastFew, lastFew[0]]);
    expect(pool.stats).toMatchObject({ fallbacks: taken.length, reused: MAP_RECENT_KEEP + 1 });
    await pool.stop();
    // Nothing to copy any more: it takes one.
    expect(pool.takeForTraining().seed).toBe(906);
    expect(pool.stats.reused).toBe(MAP_RECENT_KEEP + 1);
  });

  it("stop() waits for a stalled terminate only up to its timeout, and never throws", async () => {
    const warns: string[] = [];
    const hung = new FakeWorker();
    hung.hangOnTerminate = true;
    const pool = new MapPool({ target: 1, warmMain: false, stopTimeoutMs: 40, log: () => {}, warn: (l) => warns.push(l), spawnWorker: () => hung }).start();
    const t0 = performance.now();
    await pool.stop();
    const took = performance.now() - t0;
    expect(hung.terminated).toBe(true);
    expect(took).toBeGreaterThanOrEqual(35);
    expect(took).toBeLessThan(2000);
    expect(warns.some((l) => /did not end within 40 ms/.test(l))).toBe(true);
    // A terminate that rejects, or throws, is no different.
    for (const how of ["rejects", "throws"] as const) {
      const bad = new FakeWorker();
      bad.terminate = () => { if (how === "throws") throw new Error("gone"); return Promise.reject(new Error("gone")); };
      const p2 = new MapPool({ target: 1, warmMain: false, stopTimeoutMs: 40, ...quiet, spawnWorker: () => bad }).start();
      await expect(p2.stop()).resolves.toBeUndefined();
    }
  });

  it("stop() cancels a pending restart and terminates the worker; whenFilled waiters are let go", async () => {
    let spawns = 0;
    const pool = new MapPool({
      target: 1, warmMain: false, restartMs: 30, ...quiet,
      spawnWorker: () => {
        spawns++;
        const w = new FakeWorker();
        setImmediate(() => w.emit("exit", 1));
        return w;
      },
    }).start();
    const waiting = pool.whenFilled(1);
    await until(() => pool.stats.crashes === 1, "the crash");
    await pool.stop();
    await waiting;
    await sleep(60);
    expect(spawns).toBe(1);
  });
});

// ================================================================= the hang watchdog

describe("the map pool's hang watchdog", () => {
  let base: GameMap;
  beforeAll(() => {
    base = certifiedMap(5, SERVER_MAPGEN)!;
  });
  // Only the timeouts are faked: FakeWorker's setImmediate and whenFilled's promises stay real, so a `certifies` worker
  // still answers on a later turn while the test moves the clock by hand.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A reply that passes the arrival check, whatever seed was asked for (the pool does not match a reply to its request). */
  const goodMap = (): MapWorkerReply => ({ kind: "map", seed: base.seed, attempt: base.attempt, hash: mapHashU32(base), map: structuredClone(base), ms: 0 });
  /** Spawns FakeWorkers that never answer, remembering each. */
  const silentWorkers = (into: FakeWorker[]) => () => { const w = new FakeWorker(); into.push(w); return w; };
  const hangLines = (warns: string[]) => warns.map((l) => Number(/restarting in (\d+) ms/.exec(l)?.[1]));

  it("has a named default, well above a cold worker's first map", () => {
    expect(MAP_WORKER_HANG_MS).toBe(5000);
    const w = new FakeWorker();
    const pool = new MapPool({ target: 2, warmMain: false, ...quiet, spawnWorker: () => w }).start();
    vi.advanceTimersByTime(MAP_WORKER_HANG_MS - 1);
    expect(w.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(w.terminated).toBe(true);
    expect(pool.stats.hangs).toBe(1);
  });

  it("terminates a worker that never replies, exactly hangMs after its first request, and logs it as a death", async () => {
    const warns: string[] = [];
    const w = new FakeWorker();
    const pool = new MapPool({
      target: 3, nextSeed: counter(1600), warmMain: false, hangMs: 1000, restartMs: 10_000, log: () => {}, warn: (l) => warns.push(l),
      spawnWorker: () => w,
    }).start();
    expect(vi.getTimerCount()).toBe(1); // three requests, one timer
    vi.advanceTimersByTime(999);
    expect(w.terminated).toBe(false);
    expect(pool.workerUp).toBe(true);
    vi.advanceTimersByTime(1);
    expect(w.terminated).toBe(true);
    expect(pool.workerUp).toBe(false);
    expect(pool.stats).toMatchObject({ hangs: 1, crashes: 1 });
    expect(warns).toEqual(["[maps] map worker hung: no map in 1000 ms with 3 on the way; restarting in 10000 ms (rooms certify on the main thread until then)"]);
    expect(vi.getTimerCount()).toBe(1); // the restart's; the watchdog is gone
    await pool.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("covers the gap with the fallback exactly as for a crash, and serves the restarted worker's maps", async () => {
    const workers: FakeWorker[] = [];
    const lines: string[] = [];
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(1650), warmMain: false, hangMs: 1000, restartMs: 200, log: (l) => lines.push(l), warn: () => {},
      spawnWorker: () => { const w = new FakeWorker(workers.length === 0 ? undefined : certifies); workers.push(w); return w; },
    }).start();
    // Stuck: the queue stays empty and a room's map is certified here.
    expectCertifiedPair(pool.take());
    expect(lines.some((l) => l.includes("pool empty (2 on the way)"))).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(workers[0]!.terminated).toBe(true);
    // Hung and not yet restarted: the same fallback as a crashed worker's gap.
    expectCertifiedPair(pool.take());
    expect(lines.some((l) => l.includes("pool empty (worker down)"))).toBe(true);
    expect(pool.stats).toMatchObject({ fallbacks: 2, served: 0, hangs: 1 });
    vi.advanceTimersByTime(200);
    expect(workers).toHaveLength(2);
    await pool.whenFilled(2);
    // The new worker's seeds (the stuck one had 1650 and 1651, the fallbacks 1652 and 1653) come out of the queue.
    expect(pool.take().seed).toBe(1654);
    expect(pool.stats).toMatchObject({ served: 1, fallbacks: 2, hangs: 1, crashes: 1 });
    await pool.stop();
  });

  it("never restarts a worker that is slow but answering: every reply restarts the clock", async () => {
    // A serial worker at 600 ms a map against a 1000 ms limit: the fourth request waits 2400 ms in all, but no silence passes 600.
    let asked = 0;
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 4, refillAt: 3, nextSeed: counter(1700), warmMain: false, hangMs: 1000, ...quiet,
      spawnWorker: () => {
        const w = new FakeWorker((_req, fw) => { setTimeout(() => fw.reply(goodMap()), 600 * ++asked); });
        workers.push(w);
        return w;
      },
    }).start();
    vi.advanceTimersByTime(2400);
    expect(pool.size).toBe(4);
    expect(pool.stats).toMatchObject({ hangs: 0, crashes: 0 });
    expect(workers).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // idle again
    await pool.stop();
  });

  it("measures from the last reply: a worker that answers two and then goes quiet is caught hangMs later", async () => {
    let asked = 0;
    const warns: string[] = [];
    const pool = new MapPool({
      target: 4, refillAt: 3, nextSeed: counter(1750), warmMain: false, hangMs: 1000, log: () => {}, warn: (l) => warns.push(l),
      spawnWorker: () => new FakeWorker((_req, fw) => { if (++asked <= 2) setTimeout(() => fw.reply(goodMap()), 600 * asked); }),
    }).start();
    vi.advanceTimersByTime(1200); // replies at 600 and 1200, two requests still owed
    expect(pool.size).toBe(2);
    vi.advanceTimersByTime(999);
    expect(pool.stats.hangs).toBe(0);
    vi.advanceTimersByTime(1); // 1000 ms after the last reply, 2200 after the first request
    expect(pool.stats.hangs).toBe(1);
    expect(warns[0]).toMatch(/hung: no map in 1000 ms with 2 on the way/);
    // The maps it did send stay good: they are still served.
    expect(pool.take().seed).toBe(base.seed);
    await pool.stop();
  });

  it("a worker's ready message counts as a sign of life, so a slow start is not a hang", async () => {
    const w = new FakeWorker();
    const pool = new MapPool({ target: 2, nextSeed: counter(1790), warmMain: false, hangMs: 1000, ...quiet, spawnWorker: () => w }).start();
    vi.advanceTimersByTime(900);
    w.reply({ kind: "ready", warmMs: 880 });
    vi.advanceTimersByTime(900); // 1800 ms after the request, 900 after ready
    expect(pool.stats.hangs).toBe(0);
    vi.advanceTimersByTime(100);
    expect(pool.stats.hangs).toBe(1);
    await pool.stop();
  });

  it("asking for more while requests are out does not move the clock", async () => {
    let asked = 0;
    const warns: string[] = [];
    const pool = new MapPool({
      target: 3, refillAt: 2, nextSeed: counter(1800), warmMain: false, hangMs: 1000, log: () => {}, warn: (l) => warns.push(l),
      // Only the first request is ever answered (at 100 ms).
      spawnWorker: () => new FakeWorker((_req, fw) => { if (++asked === 1) setTimeout(() => fw.reply(goodMap()), 100); }),
    }).start();
    vi.advanceTimersByTime(100); // one map in, two requests still owed: the clock restarted here
    expect(pool.size).toBe(1);
    vi.advanceTimersByTime(400);
    pool.take(); // the queue is empty and the worker owes two: it is asked for one more
    expect(asked).toBe(4);
    expect(vi.getTimerCount()).toBe(1); // still the one timer
    vi.advanceTimersByTime(599);
    expect(pool.stats.hangs).toBe(0);
    vi.advanceTimersByTime(1); // 1000 ms after the reply: the newer request did not buy time
    expect(pool.stats.hangs).toBe(1);
    expect(warns[0]).toMatch(/with 3 on the way/);
    await pool.stop();
  });

  it("holds no timer while idle or with no worker, and one per worker while requests are out", async () => {
    const none = new MapPool({ target: 0, nextSeed: counter(1850), ...quiet }).start();
    none.take();
    expect(vi.getTimerCount()).toBe(0);

    const w = new FakeWorker(certifies);
    const pool = new MapPool({ target: 4, refillAt: 3, nextSeed: counter(1860), warmMain: false, hangMs: 1000, ...quiet, spawnWorker: () => w }).start();
    expect(vi.getTimerCount()).toBe(1); // four requests, one timer
    await pool.whenFilled();
    expect(vi.getTimerCount()).toBe(0); // the last reply stopped it
    vi.advanceTimersByTime(60_000);
    expect(w.terminated).toBe(false);
    expect(pool.stats).toMatchObject({ hangs: 0, crashes: 0 });
    pool.take(); // down to the refill mark: one request goes out
    expect(vi.getTimerCount()).toBe(1);
    pool.take(); // another while the first is out: still one timer
    expect(vi.getTimerCount()).toBe(1);
    await pool.whenFilled();
    expect(vi.getTimerCount()).toBe(0);
    await pool.stop();
  });

  it("stop() clears a pending watchdog: no restart afterwards and no handle left", async () => {
    let spawns = 0;
    const w = new FakeWorker();
    const pool = new MapPool({
      target: 2, warmMain: false, hangMs: 1000, restartMs: 10, ...quiet, spawnWorker: () => { spawns++; return w; },
    }).start();
    expect(vi.getTimerCount()).toBe(1);
    await pool.stop();
    expect(w.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(pool.stats).toMatchObject({ hangs: 0, crashes: 0 });
    expect(spawns).toBe(1);
  });

  it("a worker that dies on its own takes its watchdog with it, and its replacement gets a clock of its own", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 2, warmMain: false, hangMs: 1000, restartMs: 50, ...quiet, spawnWorker: silentWorkers(workers),
    }).start();
    vi.advanceTimersByTime(600);
    workers[0]!.emit("exit", 1);
    expect(pool.stats).toMatchObject({ crashes: 1, hangs: 0 });
    expect(vi.getTimerCount()).toBe(1); // the restart's, not a hang's
    vi.advanceTimersByTime(50);
    expect(workers).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1); // the new worker's
    vi.advanceTimersByTime(999);
    expect(pool.stats.hangs).toBe(0); // 1000 ms after its own first request, not after the old worker's
    vi.advanceTimersByTime(1);
    expect(pool.stats).toMatchObject({ crashes: 2, hangs: 1 });
    await pool.stop();
  });

  it("ignores everything the terminated worker still says, and its late exit is not a second death", async () => {
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(1900), warmMain: false, hangMs: 1000, restartMs: 50, ...quiet, spawnWorker: silentWorkers(workers),
    }).start();
    vi.advanceTimersByTime(1000);
    expect(workers[0]!.terminated).toBe(true);
    vi.advanceTimersByTime(50);
    const [stale, current] = [workers[0]!, workers[1]!];
    expect(current.posted).toHaveLength(2);
    vi.advanceTimersByTime(500); // half-way through the new worker's clock
    // The hung worker wakes up and talks: none of it is queued, counted, answered with a request or taken as a sign of life.
    stale.reply(goodMap());
    stale.reply({ kind: "discard", seed: 1, ms: 0 });
    stale.reply({ kind: "error", seed: 2, message: "late" });
    stale.reply({ kind: "ready", warmMs: 1 });
    stale.emit("error", new Error("late"));
    stale.emit("exit", 1);
    await new Promise((r) => setImmediate(r)); // its own terminate() exit
    expect(pool.size).toBe(0);
    expect(pool.stats).toMatchObject({ served: 0, rejected: 0, discards: 0, crashes: 1, hangs: 1 });
    expect(current.posted).toHaveLength(2); // a stale reply read as the current worker's would have refilled
    expect(current.terminated).toBe(false);
    expect(pool.workerUp).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(499);
    expect(pool.stats.hangs).toBe(1);
    vi.advanceTimersByTime(1); // the current worker's clock ran from its own start; the stale reply did not restart it
    expect(pool.stats).toMatchObject({ crashes: 2, hangs: 2 });
    await pool.stop();
  });

  it("repeated hangs back off like crashes, and a good map starts the backoff over", async () => {
    const warns: string[] = [];
    const workers: FakeWorker[] = [];
    const pool = new MapPool({
      target: 1, refillAt: 0, nextSeed: counter(1950), warmMain: false, hangMs: 50, restartMs: 100, restartMaxMs: 400,
      log: () => {}, warn: (l) => warns.push(l),
      spawnWorker: () => {
        // Workers 1 to 4 never answer. The 5th answers its first request and then goes quiet.
        let asked = 0;
        const w = new FakeWorker((_req, fw) => { if (workers.length === 5 && ++asked === 1) setTimeout(() => fw.reply(goodMap()), 10); });
        workers.push(w);
        return w;
      },
    }).start();
    const runUntil = (done: () => boolean) => { for (let ms = 0; !done() && ms < 20_000; ms += 10) vi.advanceTimersByTime(10); };
    runUntil(() => workers.length === 5);
    expect(hangLines(warns)).toEqual([100, 200, 400, 400]); // doubled, then held at restartMaxMs
    expect(pool.stats).toMatchObject({ hangs: 4, crashes: 4 });
    vi.advanceTimersByTime(10);
    expect(pool.size).toBe(1); // a good map arrived: the streak is forgotten
    pool.take(); // asks again; the worker is quiet now
    runUntil(() => pool.stats.hangs === 5);
    expect(hangLines(warns)).toEqual([100, 200, 400, 400, 100]);
    expect(warns.every((l) => l.includes("map worker hung: no map in 50 ms with 1 on the way"))).toBe(true);
    await pool.stop();
  });

  it("(real timers) terminates a worker that never replies, restarts it, and serves the new worker's maps; the timer holds nothing open", async () => {
    vi.useRealTimers();
    const refTimers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
    const before = refTimers();
    const probe = setTimeout(() => {}, 1000); // the count does see a timer that keeps the process alive
    expect(refTimers()).toBe(before + 1);
    clearTimeout(probe);

    const workers: FakeWorker[] = [];
    const warns: string[] = [];
    const pool = new MapPool({
      target: 2, refillAt: 1, nextSeed: counter(2000), warmMain: false, hangMs: 40, restartMs: 20, log: () => {}, warn: (l) => warns.push(l),
      spawnWorker: () => { const w = new FakeWorker(workers.length === 0 ? undefined : certifies); workers.push(w); return w; },
    }).start();
    expect(refTimers()).toBe(before); // a watchdog is pending, and it is unreffed
    expectCertifiedPair(pool.take()); // meanwhile a room still gets a map
    await until(() => pool.stats.hangs === 1, "the hang");
    expect(workers[0]!.terminated).toBe(true);
    expect(warns[0]).toMatch(/map worker hung: no map in 40 ms with 2 on the way; restarting in 20 ms/);
    await pool.whenFilled(2);
    expect(workers).toHaveLength(2);
    expect(pool.workerUp).toBe(true);
    const served = pool.take();
    expect(served.seed).toBe(2003); // the stuck worker had 2000 and 2001, the fallback 2002
    expectCertifiedPair(served);
    expect(pool.stats).toMatchObject({ served: 1, fallbacks: 1, hangs: 1, crashes: 1 });
    await pool.stop();
    expect(refTimers()).toBeLessThanOrEqual(before); // (a timer left over from an earlier test may have run out meanwhile)
  });
});

// ================================================================= rooms on a real server

describe("rooms take their maps from the pool", () => {
  type ClientRoom = Room<any, RaidState>;

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as net.AddressInfo;
        s.close(() => resolve(port));
      });
    });
  }

  interface Running { server: RaidServer; port: number; dir: string; rooms: ClientRoom[]; names: number }

  async function boot(pool?: MapPool): Promise<Running> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-maps-"));
    const port = await freePort();
    const server = await startServer(
      { ...loadConfig({}), port, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"), planSeconds: 0 },
      pool ? { maps: pool } : {},
    );
    return { server, port, dir, rooms: [], names: 0 };
  }

  async function shutdown(r: Running): Promise<void> {
    for (const room of r.rooms) await room.leave(true).catch(() => {});
    try {
      await r.server.stop();
    } finally {
      fs.rmSync(r.dir, { recursive: true, force: true });
    }
  }

  /** A fresh profile in a fresh room (training by default; the arena's lobby with ROOM_NAME), joined the way the client does. */
  async function freshRoom(r: Running, name: string): Promise<ClientRoom> {
    const profile = `mp${++r.names}`;
    const res = await fetch(`http://127.0.0.1:${r.port}/api/profile/${profile}`);
    const { token } = (await res.json()) as { token: string };
    const options: JoinOptions = { profile, token };
    const room = await new Client(`http://127.0.0.1:${r.port}`).create<RaidState>(name, options);
    r.rooms.push(room);
    await until(() => room.state?.players?.size === 1, "the room's first state");
    return room;
  }
  const trainingRoom = (r: Running): Promise<ClientRoom> => freshRoom(r, TRAINING_ROOM_NAME);
  const arenaRoom = (r: Running): Promise<ClientRoom> => freshRoom(r, ROOM_NAME);

  /** What a client (decor on) and a bot (decor off) check: the published attempt builds a map with the published hash. */
  function expectPublishedMap(room: ClientRoom): GameMap {
    const { seed, attempt, mapHash } = room.state;
    const map = generateMap(seed, attempt);
    expect(mapHashU32(map)).toBe(mapHash);
    expect(roomMap(room.state)).toEqual(generateMap(seed, attempt, SERVER_MAPGEN));
    expect(mapHash).not.toBe(0);
    return map;
  }

  it("a burst of 8 arena rooms takes 8 different pooled maps with no fallback, and the pool refills", async () => {
    const r = await boot();
    try {
      await r.server.maps.whenFilled();
      const rooms = await Promise.all(Array.from({ length: MAP_POOL_TARGET }, () => arenaRoom(r)));
      expect(r.server.maps.stats).toMatchObject({ served: MAP_POOL_TARGET, fallbacks: 0 });
      const seeds = new Set(rooms.map((room) => room.state.seed));
      expect(seeds.size).toBe(MAP_POOL_TARGET);
      for (const room of rooms) expectPublishedMap(room);
      // Past the burst the queue fills again on its own.
      await r.server.maps.whenFilled();
      const more = await arenaRoom(r);
      expectPublishedMap(more);
      expect(r.server.maps.stats.fallbacks).toBe(0);
    } finally {
      await shutdown(r);
    }
    expect(r.server.maps.workerUp).toBe(false);
  }, 60_000);

  it("a burst of 14 training rooms takes one pooled map and copies it, and every room still publishes a map that rebuilds", async () => {
    const r = await boot();
    try {
      await r.server.maps.whenFilled();
      const rooms = await Promise.all(Array.from({ length: 14 }, () => trainingRoom(r)));
      expect(r.server.maps.stats).toMatchObject({ served: 1, reused: 13, fallbacks: 0 });
      for (const room of rooms) expectPublishedMap(room);
      expect(new Set(rooms.map((room) => room.state.mapHash)).size).toBe(1);
      // The queue was not drained, so an arena room right after still has its own pooled map.
      const arena = await arenaRoom(r);
      expectPublishedMap(arena);
      expect(r.server.maps.stats).toMatchObject({ served: 2, fallbacks: 0 });
    } finally {
      await shutdown(r);
    }
  }, 60_000);

  it("a server whose map worker never comes up still builds every room", async () => {
    const pool = new MapPool({
      ...quiet, restartMs: 5, restartMaxMs: 20,
      spawnWorker: () => { throw new Error("worker threads are broken"); },
    });
    const r = await boot(pool);
    try {
      const rooms = await Promise.all([arenaRoom(r), arenaRoom(r), arenaRoom(r)]);
      for (const room of rooms) expectPublishedMap(room);
      expect(pool.stats.fallbacks).toBe(3);
      expect(pool.stats.crashes).toBeGreaterThanOrEqual(1);
      // Training costs the down pool nothing more: it copies a map the arena rooms took.
      const practice = await Promise.all([trainingRoom(r), trainingRoom(r)]);
      for (const room of practice) expectPublishedMap(room);
      expect(pool.stats).toMatchObject({ fallbacks: 3, reused: 2 });
    } finally {
      await shutdown(r);
    }
  }, 60_000);
});

// ================================================================= shutdown order

describe("shutting the server down", () => {
  it("flushes the profiles before it stops the map pool, and a worker that will not die cannot hold the shutdown", async () => {
    const hung = new FakeWorker();
    hung.hangOnTerminate = true;
    const pool = new MapPool({ target: 1, warmMain: false, stopTimeoutMs: 100, ...quiet, spawnWorker: () => hung });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-maps-"));
    const port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const { port: p } = s.address() as net.AddressInfo;
        s.close(() => resolve(p));
      });
    });
    const server = await startServer({ ...loadConfig({}), port, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"), planSeconds: 0 }, { maps: pool });
    const order: string[] = [];
    const closeStore = server.store.close.bind(server.store);
    server.store.close = async () => { order.push("store.close"); await closeStore(); order.push("store.closed"); };
    const stopPool = pool.stop.bind(pool);
    pool.stop = async () => { order.push("maps.stop"); await stopPool(); order.push("maps.stopped"); };
    try {
      const t0 = performance.now();
      await server.stop();
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(hung.terminated).toBe(true);
      // The whole flush (store.closed) is behind us before the pool is even asked to stop.
      expect(order.indexOf("store.closed")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("maps.stop")).toBeGreaterThan(order.indexOf("store.closed"));
      expect(order.at(-1)).toBe("maps.stopped");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

// ================================================================= the bots' map

describe("a bot's map", () => {
  it("is the published attempt, built without decor, and a hash that does not match is a hard error", () => {
    const map = certifiedMap(7, SERVER_MAPGEN)!;
    const state = { seed: 7, attempt: map.attempt, mapHash: mapHashU32(map) };
    expect(roomMap(state)).toEqual(map);
    expect(() => roomMap({ ...state, mapHash: (state.mapHash ^ 1) >>> 0 })).toThrow(/map mismatch on seed 7 attempt/);
    // A published attempt that does not certify here cannot be the server's either.
    let seed = 1;
    while (tryAttempt(seed, 0, SERVER_MAPGEN)) seed++;
    expect(() => roomMap({ seed, attempt: 0, mapHash: 1 })).toThrow(/does not certify/);
  });
});
