import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generateMap } from "@raid/shared";
import { createMapWorker, generateMapAsync, MAP_REQUEST_TIMEOUT_MS } from "../src/mapService";

const worker = createMapWorker();
afterAll(async () => { await worker.close(); });

describe("map worker", () => {
  // The map crosses a thread boundary by structured clone: it has to be exactly the map the main thread would have built, for
  // every seed (mapgen retries attempts on some, seed 732 among the slowest), with typed arrays and plain objects intact.
  it("hands back exactly generateMap(seed) for a spread of seeds, as plain data", async () => {
    const seeds = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 732, 987, 1597, 2584, 4181, 6765, 10946, 2 ** 31 - 1];
    for (const seed of seeds) {
      const remote = await worker.generate(seed);
      expect(remote, `seed ${seed}`).toStrictEqual(generateMap(seed));
      expect(remote.tiles).toBeInstanceOf(Uint8Array);
      expect(remote.regionGrid).toBeInstanceOf(Uint8Array);
      expect(remote.territoryGrid).toBeInstanceOf(Uint8Array);
    }
  }, 120_000);

  it("answers several requests in flight each with its own map", async () => {
    const seeds = [41, 42, 43, 44, 45, 46];
    const maps = await Promise.all(seeds.map((s) => worker.generate(s)));
    maps.forEach((m, i) => expect(m.seed).toBe(seeds[i]));
    expect(maps[3]).toStrictEqual(generateMap(44));
  }, 60_000);

  it("rejects when the thread dies (the caller then generates the map itself)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-mapworker-"));
    const bad = path.join(dir, "dies.mjs");
    fs.writeFileSync(bad, "process.exit(3);\n");
    const w = createMapWorker(pathToFileURL(bad));
    try {
      await expect(w.generate(1)).rejects.toThrow(/exited|died|map worker/);
    } finally {
      await w.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects what a seed it cannot build raises", async () => {
    // generateMap throws on none of the real seeds, so the error path is driven with a script that always answers an error.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-mapworker-"));
    const stub = path.join(dir, "errors.mjs");
    fs.writeFileSync(
      stub,
      'import { parentPort } from "node:worker_threads";\n'
        + 'parentPort.on("message", (r) => parentPort.postMessage({ id: r.id, error: "boom" }));\n'
        + "parentPort.postMessage({ ready: true });\n",
    );
    const w = createMapWorker(pathToFileURL(stub));
    try {
      await expect(w.generate(1)).rejects.toThrow("boom");
    } finally {
      await w.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("a worker that hangs", () => {
  // A hung worker must give up well inside Colyseus's seat reservation window (15 s, armed before onCreate runs), or the room is
  // disposed while it waits (test/roomCreateDispose.test.ts). The slowest real map takes about 80 ms.
  it("times out its default well under the seat reservation window", () => {
    expect(MAP_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(MAP_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(1000);
  });

  function stubWorker(source: string): { url: URL; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-mapworker-"));
    const file = path.join(dir, "stub.mjs");
    fs.writeFileSync(file, source);
    return { url: pathToFileURL(file), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it("rejects a request the thread never answers, after the timeout, and does not trust that thread with the next one", async () => {
    const stub = stubWorker('import { parentPort } from "node:worker_threads";\nparentPort.on("message", () => {});\nparentPort.postMessage({ ready: true });\n');
    const w = createMapWorker(stub.url, 200, 200);
    try {
      const t0 = Date.now();
      await expect(w.generate(1)).rejects.toThrow(/timed out/);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
      expect(Date.now() - t0).toBeLessThan(2000);
      // The thread was terminated: the next request starts a fresh one (which hangs the same way) instead of queueing behind it.
      await expect(w.generate(2)).rejects.toThrow(/timed out|gone|exited/);
    } finally {
      await w.close();
      stub.cleanup();
    }
  }, 30_000);

  it("rejects when the thread never says it is ready", async () => {
    const stub = stubWorker('import { parentPort } from "node:worker_threads";\nparentPort.on("message", () => {});\nsetInterval(() => {}, 1000);\n');
    const w = createMapWorker(stub.url, 200, 200);
    try {
      const t0 = Date.now();
      await expect(w.generate(1)).rejects.toThrow(/timed out|did not start/);
      expect(Date.now() - t0).toBeLessThan(2000);
      await expect(w.warm()).rejects.toThrow();
    } finally {
      await w.close();
      stub.cleanup();
    }
  }, 30_000);
});

describe("generateMapAsync", () => {
  it("falls back to generating on the calling thread (the worker is off under vitest)", async () => {
    expect(await generateMapAsync(7)).toStrictEqual(generateMap(7));
  });
});
