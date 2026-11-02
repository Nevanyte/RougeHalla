// The telemetry sinks (docs/TELEMETRY.md 6.1): submit never blocks or throws, gzip NDJSON with the right headers, retries with
// backoff, drop-oldest when full, a 401 dropped, the close deadline, the size cap; and the config's validation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { telemetryDay, TELEMETRY_BATCH_HEADER, TELEMETRY_SCHEMA_HEADER, type RunRecord } from "@raid/shared";
import { EXAMPLE_RUN } from "../../shared/test/fixtures/telemetryRun.example";
import { telemetryConfigFromEnv, telemetryEnabled } from "../src/telemetry/config";
import { pidOf } from "../src/telemetry/identity";
import { createFileSink, createHttpSink, createSyncFileSink, serializeRecord } from "../src/telemetry/sink";

const TOKEN = "t".repeat(40);
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function rec(i: number): RunRecord {
  const hex = i.toString(16).padStart(12, "0");
  return { ...EXAMPLE_RUN, runId: `3f2b8c1e-5d4a-4b6f-9c2e-${hex}` };
}

interface Call { headers: Record<string, string>; lines: RunRecord[] }

function fakeFetch(answers: Array<number | "throw">, calls: Call[], opts: { stall?: Promise<void> } = {}): typeof fetch {
  let i = 0;
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = Buffer.from(init!.body as Uint8Array);
    const lines = gunzipSync(body).toString("utf8").trim().split("\n").map((l) => JSON.parse(l) as RunRecord);
    calls.push({ headers: init!.headers as Record<string, string>, lines });
    if (opts.stall) await opts.stall;
    const a = answers[Math.min(i++, answers.length - 1)]!;
    if (a === "throw") throw new Error("network down");
    const body200 = { accepted: lines.map((l) => l.runId), duplicate: [], rejected: [] };
    return new Response(a === 200 ? JSON.stringify(body200) : "nope", { status: a });
  }) as typeof fetch;
}

const quiet = (): void => {};

describe("telemetry http sink", () => {
  it("submit returns at once and sends gzip NDJSON with the bearer and schema headers", async () => {
    const calls: Call[] = [];
    const sink = createHttpSink({ url: "https://x.test/_internal/telemetry", token: TOKEN, fetchImpl: fakeFetch([200], calls), flushDelayMs: 5, log: quiet });
    const t0 = performance.now();
    sink.submit(rec(1));
    sink.submit(rec(2));
    expect(performance.now() - t0).toBeLessThan(5); // nothing is serialized or sent inside submit
    expect(calls).toHaveLength(0);
    await wait(40);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.lines.map((l) => l.runId)).toEqual([rec(1).runId, rec(2).runId]);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.headers["Content-Encoding"]).toBe("gzip");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/x-ndjson");
    expect(calls[0]!.headers[TELEMETRY_SCHEMA_HEADER]).toBe("1");
    expect(calls[0]!.headers[TELEMETRY_BATCH_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sink.stats()).toMatchObject({ sent: 2, dropped: 0, failed: 0, queued: 0 });
  });

  it("retries a 503 and a network error with the same batch, then succeeds", async () => {
    const calls: Call[] = [];
    const sink = createHttpSink({ url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([503, "throw", 200], calls), flushDelayMs: 1, retryDelaysMs: [5, 5, 5], log: quiet });
    sink.submit(rec(1));
    await wait(80);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers[TELEMETRY_BATCH_HEADER])).size).toBe(1);
    expect(sink.stats()).toMatchObject({ sent: 1, failed: 0 });
  });

  it("gives up after the last retry, and drops a 401 at once", async () => {
    const calls: Call[] = [];
    const sink = createHttpSink({ url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([500], calls), flushDelayMs: 1, retryDelaysMs: [2, 2], log: quiet });
    sink.submit(rec(1));
    await wait(60);
    expect(calls).toHaveLength(3);
    expect(sink.stats()).toMatchObject({ sent: 0, failed: 1 });
    const calls2: Call[] = [];
    const sink2 = createHttpSink({ url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([401], calls2), flushDelayMs: 1, retryDelaysMs: [2, 2], log: quiet });
    sink2.submit(rec(1));
    await wait(40);
    expect(calls2).toHaveLength(1);
    expect(sink2.stats()).toMatchObject({ sent: 0, failed: 1 });
  });

  it("drops the oldest record when the queue is full while a batch is stalled in flight", async () => {
    const calls: Call[] = [];
    let release!: () => void;
    const stall = new Promise<void>((r) => { release = r; });
    const sink = createHttpSink({
      url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([200], calls, { stall }), flushDelayMs: 1, maxQueueRecords: 3, maxBatchRecords: 1, log: quiet,
    });
    sink.submit(rec(0));
    await wait(20); // rec 0 is in flight, stalled
    for (let i = 1; i <= 5; i++) sink.submit(rec(i));
    await tick();
    await tick();
    expect(sink.stats()).toMatchObject({ dropped: 2, queued: 3 });
    release();
    await wait(60);
    expect(calls.flatMap((c) => c.lines.map((l) => l.runId))).toEqual([0, 3, 4, 5].map((i) => rec(i).runId));
  });

  it("close() flushes what is queued and returns by its deadline even if the endpoint hangs", async () => {
    const calls: Call[] = [];
    const sink = createHttpSink({ url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([200], calls), flushDelayMs: 60_000, log: quiet });
    sink.submit(rec(1));
    await sink.close(1000);
    expect(calls).toHaveLength(1);
    const hang = createHttpSink({ url: "https://x.test/t", token: TOKEN, fetchImpl: fakeFetch([200], [], { stall: new Promise(() => {}) }), flushDelayMs: 60_000, log: quiet });
    hang.submit(rec(1));
    const t0 = performance.now();
    await hang.close(50);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("serializeRecord drops the tiles of an oversized record, then the record", () => {
    const big = { ...EXAMPLE_RUN, players: EXAMPLE_RUN.players.map((p) => ({ ...p, tiles: "A".repeat(40_000) })) };
    const slim = serializeRecord(big, 40_000)!;
    expect(slim).not.toBeNull();
    const parsed = JSON.parse(slim) as RunRecord;
    expect(parsed.truncated?.tiles).toBe(true);
    expect(parsed.players.every((p) => p.tiles === undefined)).toBe(true);
    expect(serializeRecord(big, 100)).toBeNull();
  });
});

describe("telemetry file sink", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it("appends one record a line to runs-<day>.ndjson", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-"));
    dirs.push(dir);
    const sink = createFileSink({ dir: path.join(dir, "nested") });
    sink.submit(rec(1));
    sink.submit(rec(2));
    await sink.close(2000);
    const file = path.join(dir, "nested", `runs-${telemetryDay(EXAMPLE_RUN.endedAtEpoch)}.ndjson`);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as RunRecord);
    expect(lines.map((l) => l.runId)).toEqual([rec(1).runId, rec(2).runId]);
    expect(sink.stats()).toMatchObject({ sent: 2, failed: 0 });
  });

  it("the sync sink writes each record inside submit, with no event-loop turn (the tournament's batch loop)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "telemetry-"));
    dirs.push(dir);
    const sink = createSyncFileSink({ dir: path.join(dir, "nested") });
    const file = path.join(dir, "nested", `runs-${telemetryDay(EXAMPLE_RUN.endedAtEpoch)}.ndjson`);
    sink.submit(rec(1));
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
    sink.submit(rec(2));
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as RunRecord);
    expect(lines.map((l) => l.runId)).toEqual([rec(1).runId, rec(2).runId]);
    expect(sink.stats()).toEqual({ sent: 2, dropped: 0, failed: 0, queued: 0 });
  });
});

describe("telemetry config and identity", () => {
  it("needs URL and token together, https, a long token; bad values switch the remote sink off without throwing", () => {
    const logs: string[] = [];
    const log = (l: string): void => { logs.push(l); };
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "https://h/_internal/telemetry" }, { log }).url).toBeNull();
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "http://h/x", TELEMETRY_TOKEN: TOKEN }, { log }).url).toBeNull();
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "https://u:p@h/x", TELEMETRY_TOKEN: TOKEN }, { log }).url).toBeNull();
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "https://h/x#f", TELEMETRY_TOKEN: TOKEN }, { log }).url).toBeNull();
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "https://h/x", TELEMETRY_TOKEN: "short" }, { log }).url).toBeNull();
    expect(telemetryConfigFromEnv({ TELEMETRY_URL: "http://localhost:9/x", TELEMETRY_TOKEN: TOKEN }, { log, allowHttpLocalhost: true }).url).toBe("http://localhost:9/x");
    const ok = telemetryConfigFromEnv({ TELEMETRY_URL: "https://h/x", TELEMETRY_TOKEN: TOKEN, TELEMETRY_SOURCE: "live", TELEMETRY_POSITIONS: "0" }, { log });
    expect(ok).toMatchObject({ url: "https://h/x", token: TOKEN, source: "live", positions: false });
    expect(telemetryEnabled(ok)).toBe(true);
    expect(telemetryEnabled(telemetryConfigFromEnv({}, { log }))).toBe(false);
    expect(telemetryConfigFromEnv({ TELEMETRY_DIR: "/tmp/x" }, { log })).toMatchObject({ dir: "/tmp/x", source: "dev" });
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("pid is a salted 16-hex HMAC of the lowercased callsign, never the callsign; null without a salt", () => {
    const salt = "s".repeat(40);
    const a = pidOf(salt, "Alice")!;
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(pidOf(salt, "alice")).toBe(a);
    expect(pidOf("x".repeat(40), "alice")).not.toBe(a);
    expect(pidOf(null, "alice")).toBeNull();
  });
});
