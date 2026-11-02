import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import {
  TELEMETRY_INGEST_MAX_COMPRESSED_BYTES,
  TELEMETRY_INGEST_MAX_RECORDS,
  telemetryObjectKey,
  type IngestResponse,
  type RunRecord,
} from "@raid/shared/telemetry";
import { handleTelemetryIngest, type IngestEnv, type TelemetryStoreRpc } from "../src/telemetry/ingest";
import { ingestRows, migrate, runKey, runQuery } from "../src/telemetry/store";
import { EXAMPLE_RUN, nodeSql } from "./telemetryHelpers";

const TOKEN = "telemetry-ingest-test-token-0123456789abcdef";
const BUILD = { serverBuild: "a1b2c3d4e5f60718", sourceCommit: "feedface" };

class FakeR2 {
  objects = new Map<string, { body: Uint8Array; options?: R2PutOptions }>();
  fail = false;
  async put(key: string, body: Uint8Array, options?: R2PutOptions) {
    if (this.fail) throw new Error("r2 down");
    this.objects.set(key, { body, options });
    return {} as R2Object;
  }
}

function fakeEnv(token: string | null = TOKEN) {
  const sql = nodeSql();
  migrate(sql);
  const r2 = new FakeR2();
  let storeFail = false;
  const rpc: TelemetryStoreRpc = {
    ingest: async (rows) => {
      if (storeFail) throw new Error("do down");
      return rows.map((r) => ingestRows(sql, r));
    },
    query: async (name, q, opts, now) => runQuery(sql, name, q, opts, now),
    runKey: async (id) => runKey(sql, id),
  };
  const env: IngestEnv = {
    TELEMETRY_TOKEN: token ?? undefined,
    PROFILES: r2 as unknown as Pick<R2Bucket, "put">,
    TELEMETRY: { idFromName: () => ({}) as DurableObjectId, get: () => rpc },
  };
  return { env, sql, r2, failStore: () => (storeFail = true) };
}

const ndjson = (records: unknown[]) => records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("https://game.example/_internal/telemetry", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/x-ndjson", "Content-Encoding": "gzip", ...headers },
    body,
  });
}

const gz = (s: string) => gzipSync(Buffer.from(s));
const withId = (n: number): RunRecord => ({ ...structuredClone(EXAMPLE_RUN), runId: `3f2b8c1e-5d4a-4b6f-9c2e-${String(n).padStart(12, "0")}` });

describe("telemetry ingest (handler)", () => {
  it("is 404 without a configured token, 401 without the bearer, 405 for other methods", async () => {
    expect((await handleTelemetryIngest(post(gz("")), fakeEnv(null).env, BUILD)).status).toBe(404);
    expect((await handleTelemetryIngest(post(gz("")), fakeEnv("short").env, BUILD)).status).toBe(404);
    const { env } = fakeEnv();
    expect((await handleTelemetryIngest(post(gz(""), { Authorization: "Bearer wrong-token-wrong-token-wrong-token" }), env, BUILD)).status).toBe(401);
    expect((await handleTelemetryIngest(new Request("https://game.example/_internal/telemetry"), env, BUILD)).status).toBe(401);
    const get = new Request("https://game.example/_internal/telemetry", { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect((await handleTelemetryIngest(get, env, BUILD)).status).toBe(405);
  });

  it("checks size, encoding and type before reading", async () => {
    const { env } = fakeEnv();
    const body = gz(ndjson([EXAMPLE_RUN]));
    expect((await handleTelemetryIngest(post(body, { "Content-Length": String(TELEMETRY_INGEST_MAX_COMPRESSED_BYTES + 1) }), env, BUILD)).status).toBe(413);
    expect((await handleTelemetryIngest(post(body, { "Content-Encoding": "br" }), env, BUILD)).status).toBe(415);
    expect((await handleTelemetryIngest(post(body, { "Content-Type": "application/json" }), env, BUILD)).status).toBe(415);
    expect((await handleTelemetryIngest(post(Buffer.from("not gzip at all")), env, BUILD)).status).toBe(400);
    const many = Array.from({ length: TELEMETRY_INGEST_MAX_RECORDS + 1 }, (_, i) => withId(i));
    expect((await handleTelemetryIngest(post(gz(ndjson(many))), env, BUILD)).status).toBe(413);
  });

  it("aborts a gzip bomb at the decompressed cap", async () => {
    const { env, r2 } = fakeEnv();
    const bomb = gzipSync(Buffer.alloc(9 * 1024 * 1024, 32));
    expect(bomb.byteLength).toBeLessThan(TELEMETRY_INGEST_MAX_COMPRESSED_BYTES);
    expect((await handleTelemetryIngest(post(bomb), env, BUILD)).status).toBe(413);
    expect(r2.objects.size).toBe(0);
  });

  it("archives under the documented key, fills the commit and is idempotent on retry", async () => {
    const { env, sql, r2 } = fakeEnv();
    const rec = withId(1);
    rec.build = { server: BUILD.serverBuild, commit: null };
    const bad = { ...withId(2), players: [] };
    const first = await handleTelemetryIngest(post(gz(ndjson([rec, bad, "{not json"]))), env, BUILD, 5000);
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const body = await first.json() as IngestResponse;
    expect(body.accepted).toEqual([rec.runId]);
    expect(body.duplicate).toEqual([]);
    expect(body.rejected).toEqual([{ runId: bad.runId, reason: "players" }, { runId: null, reason: "invalid JSON" }]);
    const key = telemetryObjectKey(rec.build.server, rec.endedAtEpoch, rec.runId);
    expect(key).toBe(`telemetry/v1/build=${BUILD.serverBuild}/date=2026-11-02/${rec.runId}.json.gz`);
    const stored = r2.objects.get(key)!;
    expect(stored.options?.httpMetadata).toEqual({ contentType: "application/json", contentEncoding: "gzip" });
    expect(stored.options?.customMetadata).toEqual({ v: "1", source: "test", humans: "1", bots: "1" });
    const archived = JSON.parse((await import("node:zlib")).gunzipSync(stored.body).toString());
    expect(archived.build.commit).toBe("feedface");
    expect(archived.receivedAt).toBe(5000);
    expect(sql.all("SELECT commit_sha, received_at FROM runs")).toEqual([{ commit_sha: "feedface", received_at: 5000 }]);

    const retry = await handleTelemetryIngest(post(gz(ndjson([rec]))), env, BUILD, 6000);
    expect(await retry.json()).toEqual({ accepted: [], duplicate: [rec.runId], rejected: [] });
    expect(Number(sql.all("SELECT COUNT(*) AS n FROM players")[0].n)).toBe(2);
    expect(r2.objects.size).toBe(1);
  });

  it("leaves another build's null commit alone", async () => {
    const { env, sql } = fakeEnv();
    const rec = withId(3);
    rec.build = { server: "otherbuild", commit: null };
    expect((await handleTelemetryIngest(post(gz(ndjson([rec]))), env, BUILD)).status).toBe(200);
    expect(sql.all("SELECT commit_sha FROM runs")).toEqual([{ commit_sha: null }]);
  });

  it("answers 503 for the whole batch when R2 or the store fails", async () => {
    const a = fakeEnv();
    a.r2.fail = true;
    expect((await handleTelemetryIngest(post(gz(ndjson([withId(4)]))), a.env, BUILD)).status).toBe(503);
    const b = fakeEnv();
    b.failStore();
    expect((await handleTelemetryIngest(post(gz(ndjson([withId(5)]))), b.env, BUILD)).status).toBe(503);
  });
});

describe("telemetry ingest (Miniflare: SQLite Durable Object and R2)", () => {
  it("ingests through the real DO, serves the dashboard API and keeps a retry idempotent", async () => {
    const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const bundle = await build({
      stdin: {
        contents: `import { handleTelemetryIngest } from "./telemetry/ingest";
          import { handleStats } from "./telemetry/routes";
          export { TelemetryStore } from "./telemetry/durable";
          export default { async fetch(request, env) {
            const url = new URL(request.url);
            if (url.pathname === "/_internal/telemetry") return handleTelemetryIngest(request, env, { serverBuild: "x", sourceCommit: null });
            return (await handleStats(request, env)) ?? new Response("fallthrough", { status: 418 });
          } };`,
        resolveDir: sourceDir,
        sourcefile: "telemetry-worker.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "es2022",
      external: ["cloudflare:workers"],
    });
    const DASH = "dashboard-test-token-0123456789abcdef0123";
    const miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-28",
      bindings: { TELEMETRY_TOKEN: TOKEN, DASHBOARD_TOKEN: DASH },
      r2Buckets: { PROFILES: "telemetry-integration-test" },
      durableObjects: { TELEMETRY: { className: "TelemetryStore", useSQLite: true } },
    }));
    try {
      const send = (records: unknown[]) => miniflare.dispatchFetch("https://worker.test/_internal/telemetry", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/x-ndjson", "Content-Encoding": "gzip" },
        body: gz(ndjson(records)),
      });
      const rec = { ...withId(9), source: "live" as const };
      const first = await send([rec]);
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ accepted: [rec.runId], duplicate: [], rejected: [] });
      const again = await send([rec]);
      expect(await again.json()).toEqual({ accepted: [], duplicate: [rec.runId], rejected: [] });
      const r2 = await miniflare.getR2Bucket("PROFILES");
      const listed = await r2.list({ prefix: "telemetry/v1/" });
      expect(listed.objects.map((o) => o.key)).toEqual([telemetryObjectKey(rec.build.server, rec.endedAtEpoch, rec.runId)]);

      const api = (p: string, init: { method?: string } = {}) => miniflare.dispatchFetch(`https://worker.test${p}`, {
        method: init.method ?? "GET", headers: { Authorization: `Bearer ${DASH}` },
      });
      const factions = await api("/api/stats/factions?pool=all&from=2026-11-01&to=2026-11-03");
      expect(factions.status).toBe(200);
      const env = await factions.json() as { rows: { faction: string; win: { n: number; k: number } }[]; query: { build: string } };
      expect(env.query.build).toBe(rec.build.server);
      expect(env.rows.map((r) => [r.faction, r.win.k, r.win.n])).toEqual([["fire", 0, 1], ["frost", 1, 1]]);
      const one = await api(`/api/stats/run/${rec.runId}`);
      expect(one.status).toBe(200);
      expect((await one.json() as RunRecord).runId).toBe(rec.runId);
      const exported = await api("/api/stats/export?pool=all&from=2026-11-01&to=2026-11-03");
      expect(exported.headers.get("Content-Type")).toMatch(/^application\/x-ndjson/);
      const lines = (await exported.text()).trim().split("\n");
      expect(lines.map((l) => JSON.parse(l).runId)).toEqual([rec.runId]);
      const reindex = await api("/api/stats/admin/reindex?confirm=1", { method: "POST" });
      expect(await reindex.json()).toEqual({ indexed: 0, duplicate: 1, rejected: 0, cursor: null });
      expect((await api("/api/stats/admin/reindex", { method: "POST" })).status).toBe(400);
      expect((await miniflare.dispatchFetch("https://worker.test/api/stats/meta")).status).toBe(401);
    } finally {
      await miniflare.dispose();
    }
  }, 30_000);
});
