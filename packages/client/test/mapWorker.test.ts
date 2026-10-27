// The room's map on the client (net/mapWorker.ts, net/mapWorkerEntry.ts, net/roomMap.ts): one attempt, built off the
// page's thread when a worker exists and on it otherwise, one object per (seed, attempt), and checked against the state's
// hash. The worker itself is exercised in-process here: a stand-in runs the entry's handler on this thread.
import { describe, expect, it, vi } from "vitest";
import { generateMap, mapHashU32, tryAttempt, type GameMap } from "@raid/shared";
import { MapLoader, spawnMapWorker, type MapWorkerHandle } from "../src/net/mapWorker";
import { mapTransferables, type MapWorkerIn, type MapWorkerOut } from "../src/net/mapWorkerProtocol";
import { checkedMap } from "../src/net/roomMap";
import { MAP_MISMATCH_MESSAGE } from "../src/net/errors";

/** The first (seed, attempt) at or after `from` whose attempt `attempt` does (or does not) certify. */
function pairWhere(certifies: boolean, attempt = 0, from = 1): { seed: number; attempt: number } {
  for (let seed = from; ; seed++) if ((tryAttempt(seed, attempt) !== null) === certifies) return { seed, attempt };
}
const GOOD = pairWhere(true);
const OTHER = pairWhere(true, 0, GOOD.seed + 1);
/** A published pair this client cannot build: that attempt does not certify. */
const BAD = pairWhere(false);

const reference = new Map<string, GameMap>();
function ref(seed: number, attempt: number): GameMap {
  const key = `${seed}:${attempt}`;
  if (!reference.has(key)) reference.set(key, generateMap(seed, attempt));
  return reference.get(key)!;
}

/** Runs mapWorkerEntry.ts's handler on this thread: what it posts arrives at the loader on a later task, cloned. */
class InProcessWorker implements MapWorkerHandle {
  onmessage: ((e: MessageEvent<MapWorkerOut>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readonly received: MapWorkerIn[] = [];
  readonly transfers: Transferable[][] = [];
  terminated = false;
  private handler: ((e: MessageEvent<MapWorkerIn>) => void) | null = null;

  static async create(): Promise<InProcessWorker> {
    const w = new InProcessWorker();
    const scope = {
      onmessage: null as ((e: MessageEvent<MapWorkerIn>) => void) | null,
      postMessage: (msg: MapWorkerOut, transfer: Transferable[]) => {
        w.transfers.push(transfer);
        const data = structuredClone(msg, { transfer });
        setTimeout(() => w.onmessage?.({ data } as MessageEvent<MapWorkerOut>), 0);
      },
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/net/mapWorkerEntry");
    vi.unstubAllGlobals();
    w.handler = scope.onmessage;
    return w;
  }

  postMessage(msg: MapWorkerIn): void {
    this.received.push(msg);
    setTimeout(() => this.handler?.({ data: structuredClone(msg) } as MessageEvent<MapWorkerIn>), 0);
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("the map loader without a worker (this test runner has none)", () => {
  it("has no Worker here, so the default spawn gives none", () => {
    expect(typeof Worker).toBe("undefined");
    expect(spawnMapWorker()).toBeNull();
  });

  it("builds exactly generateMap(seed, attempt) on this thread, one object per pair", async () => {
    const loader = new MapLoader();
    loader.warm(); // nothing to warm without a worker
    const a = await loader.mapFor(GOOD.seed, GOOD.attempt);
    expect(loader.usingWorker).toBe(false);
    expect(mapHashU32(a)).toBe(mapHashU32(ref(GOOD.seed, GOOD.attempt)));
    expect(a).toEqual(ref(GOOD.seed, GOOD.attempt));
    expect(await loader.mapFor(GOOD.seed, GOOD.attempt)).toBe(a);
    const b = await loader.mapFor(OTHER.seed, OTHER.attempt);
    expect(b).not.toBe(a);
    expect(b.seed).toBe(OTHER.seed);
  });

  it("runs one attempt only, and keeps the newest pairs", async () => {
    const built: string[] = [];
    const loader = new MapLoader({
      cacheSize: 2,
      build: (seed, attempt) => { built.push(`${seed}:${attempt}`); return ref(GOOD.seed, GOOD.attempt); },
    });
    await loader.mapFor(1, 0);
    await loader.mapFor(2, 0);
    await loader.mapFor(1, 0); // a hit: 1 is now the newest
    await loader.mapFor(3, 0); // 2 goes
    await loader.mapFor(1, 0);
    await loader.mapFor(2, 0);
    expect(built).toEqual(["1:0", "2:0", "3:0", "2:0"]);
  });

  it("rejects a pair whose attempt does not certify here, and does not keep the failure", async () => {
    const loader = new MapLoader();
    await expect(loader.mapFor(BAD.seed, BAD.attempt)).rejects.toThrow(/does not certify/);
    await expect(loader.mapFor(BAD.seed, BAD.attempt)).rejects.toThrow(/does not certify/);
  });
});

describe("the map loader with its worker", () => {
  it("warms the worker once, then has it build the published attempt and move the tile layers", async () => {
    const w = await InProcessWorker.create();
    const loader = new MapLoader({ spawn: () => w, build: () => { throw new Error("must not build on the page's thread"); } });
    loader.warm();
    loader.warm();
    const map = await loader.mapFor(GOOD.seed, GOOD.attempt);
    expect(loader.usingWorker).toBe(true);
    expect(w.received.map((m) => m.kind)).toEqual(["warm", "map"]);
    expect(map).toEqual(ref(GOOD.seed, GOOD.attempt));
    expect(mapHashU32(map)).toBe(mapHashU32(ref(GOOD.seed, GOOD.attempt)));
    // The warm reply moves nothing; the map's five 136 x 136 layers (tiles, terrain, regionGrid, territoryGrid, featureGrid) are moved, not copied.
    expect(w.transfers.map((t) => t.length)).toEqual([0, 5]);
    expect(await loader.mapFor(GOOD.seed, GOOD.attempt)).toBe(map);
    expect(w.received).toHaveLength(2);
  });

  it("a pair the worker cannot build is rejected", async () => {
    const w = await InProcessWorker.create();
    const loader = new MapLoader({ spawn: () => w });
    await expect(loader.mapFor(BAD.seed, BAD.attempt)).rejects.toThrow(/does not certify/);
  });

  it("a worker that fails hands what it owed, and every later map, to the page's thread", async () => {
    const posted: MapWorkerIn[] = [];
    const w: MapWorkerHandle & { terminated?: boolean } = {
      onmessage: null, onerror: null,
      postMessage: (m) => { posted.push(m); },
      terminate: () => { w.terminated = true; },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = new MapLoader({ spawn: () => w });
    const owed = loader.mapFor(GOOD.seed, GOOD.attempt);
    expect(posted).toHaveLength(1);
    w.onerror!(new Event("error"));
    expect(w.terminated).toBe(true);
    expect(await owed).toEqual(ref(GOOD.seed, GOOD.attempt));
    expect(loader.usingWorker).toBe(false);
    expect((await loader.mapFor(OTHER.seed, OTHER.attempt)).seed).toBe(OTHER.seed);
    expect(posted).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /** A worker that takes every request and never answers. */
  function silentWorker(): MapWorkerHandle & { terminated: boolean; posted: MapWorkerIn[] } {
    const w: MapWorkerHandle & { terminated: boolean; posted: MapWorkerIn[] } = {
      onmessage: null, onerror: null, terminated: false, posted: [],
      postMessage: (m) => { w.posted.push(m); },
      terminate: () => { w.terminated = true; },
    };
    return w;
  }

  it("a worker that never answers is dropped after the request timeout; what it owed and every later map is built on the page's thread", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const w = silentWorker();
      const loader = new MapLoader({ spawn: () => w, requestTimeoutMs: 5000 });
      const first = loader.mapFor(GOOD.seed, GOOD.attempt);
      await vi.advanceTimersByTimeAsync(2000);
      const second = loader.mapFor(OTHER.seed, OTHER.attempt); // its own clock starts at its own post
      expect(w.posted).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2999);
      expect(loader.usingWorker).toBe(true);
      expect(w.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(2); // the first request is 5001 ms old
      expect(w.terminated).toBe(true);
      expect(loader.usingWorker).toBe(false);
      expect(await first).toEqual(ref(GOOD.seed, GOOD.attempt));
      expect(await second).toEqual(ref(OTHER.seed, OTHER.attempt)); // the second one's own timer is gone: it is not left to time out
      // Later requests never reach the dead worker.
      const later = loader.mapFor(BAD.seed, BAD.attempt);
      later.catch(() => {});
      await vi.advanceTimersByTimeAsync(1);
      await expect(later).rejects.toThrow(/does not certify/);
      expect(w.posted).toHaveLength(2);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a worker that answers in time leaves no timer behind", async () => {
    const w = await InProcessWorker.create();
    vi.useFakeTimers();
    try {
      const loader = new MapLoader({ spawn: () => w, requestTimeoutMs: 5000 });
      const made = loader.mapFor(GOOD.seed, GOOD.attempt);
      await vi.advanceTimersByTimeAsync(10);
      expect(await made).toEqual(ref(GOOD.seed, GOOD.attempt));
      expect(loader.usingWorker).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reply the page cannot read (messageerror) drops the worker like a crash", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const w = silentWorker();
      const loader = new MapLoader({ spawn: () => w });
      const owed = loader.mapFor(GOOD.seed, GOOD.attempt);
      expect(w.onmessageerror).toBeTypeOf("function");
      w.onmessageerror!(new Event("messageerror") as MessageEvent);
      expect(w.terminated).toBe(true);
      expect(loader.usingWorker).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await owed).toEqual(ref(GOOD.seed, GOOD.attempt));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a worker whose postMessage throws is dropped, and the request is built here", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const w = silentWorker();
      w.postMessage = () => { throw new Error("DataCloneError"); };
      const loader = new MapLoader({ spawn: () => w });
      const made = loader.mapFor(GOOD.seed, GOOD.attempt);
      await vi.advanceTimersByTimeAsync(1);
      expect(await made).toEqual(ref(GOOD.seed, GOOD.attempt));
      expect(loader.usingWorker).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("a spawn that throws means no worker, not a broken page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loader = new MapLoader({ spawn: () => { throw new Error("blocked by CSP"); } });
    loader.warm();
    expect((await loader.mapFor(GOOD.seed, GOOD.attempt)).seed).toBe(GOOD.seed);
    warn.mockRestore();
  });

  it("moves only buffers that one layer owns whole", () => {
    const map = structuredClone(ref(GOOD.seed, GOOD.attempt));
    expect(mapTransferables(map)).toHaveLength(5);
    expect(mapTransferables(map)).toContain(map.featureGrid.buffer);
    const shared = new Uint8Array(map.tiles.length * 2);
    map.terrain = shared.subarray(0, map.tiles.length);
    map.regionGrid = shared.subarray(map.tiles.length);
    map.territoryGrid = map.tiles;
    map.featureGrid = map.tiles;
    expect(mapTransferables(map)).toEqual([map.tiles.buffer]);
  });
});

describe("the room's map, checked against the state", () => {
  it("is the loader's map when the published hash matches", async () => {
    const loader = new MapLoader();
    const map = ref(GOOD.seed, GOOD.attempt);
    const got = await checkedMap({ seed: GOOD.seed, attempt: GOOD.attempt, mapHash: mapHashU32(map) }, loader);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.map).toBe(await loader.mapFor(GOOD.seed, GOOD.attempt));
  });

  it("matches the hash of a server build without decor: the client draws props, the hash leaves them out", async () => {
    const server = generateMap(GOOD.seed, GOOD.attempt, { decor: false });
    const loader = new MapLoader();
    const got = await checkedMap({ seed: GOOD.seed, attempt: GOOD.attempt, mapHash: mapHashU32(server) }, loader);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.map.props.length).toBe(ref(GOOD.seed, GOOD.attempt).props.length);
    // And a wrong hash is a mismatch whichever way the server built.
    for (const decor of [true, false]) {
      const hash = mapHashU32(generateMap(GOOD.seed, GOOD.attempt, { decor }));
      const bad = await checkedMap({ seed: GOOD.seed, attempt: GOOD.attempt, mapHash: (hash + 1) >>> 0 }, loader);
      expect(bad.ok).toBe(false);
    }
  });

  it("is a mismatch, with the seed, attempt and both hashes, when the server published another hash", async () => {
    const hash = mapHashU32(ref(GOOD.seed, GOOD.attempt));
    const got = await checkedMap({ seed: GOOD.seed, attempt: GOOD.attempt, mapHash: (hash ^ 1) >>> 0 }, new MapLoader());
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.detail).toContain(`seed ${GOOD.seed} attempt ${GOOD.attempt}`);
      expect(got.detail).toContain(hash.toString(16).padStart(8, "0"));
      expect(got.detail).toContain(((hash ^ 1) >>> 0).toString(16).padStart(8, "0"));
    }
  });

  it("is a mismatch, not a crash, when the published attempt does not build here", async () => {
    const got = await checkedMap({ seed: BAD.seed, attempt: BAD.attempt, mapHash: 0x1234 }, new MapLoader());
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.detail).toMatch(/does not build here/);
  });

  it("tells the player to reload", () => {
    expect(MAP_MISMATCH_MESSAGE).toBe("This raid's map did not match your client. Please reload.");
  });
});
