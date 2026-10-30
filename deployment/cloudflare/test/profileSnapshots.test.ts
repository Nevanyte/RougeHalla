import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { handleProfileSnapshot, PROFILE_SNAPSHOT_MAX_BYTES } from "../src/profileSnapshots";

const TOKEN = "profile-snapshot-test-secret-value-32bytes";
const goodSnapshot = JSON.stringify({ version: 2, profiles: { player1: { name: "player1", token: "owner-token" } } });

class FakeBucket {
  value: Uint8Array | null = null;
  etag = "";
  writes = 0;

  async get(_key: string): Promise<R2ObjectBody | null> {
    if (!this.value) return null;
    const data = this.value.buffer.slice(this.value.byteOffset, this.value.byteOffset + this.value.byteLength) as ArrayBuffer;
    const blob = new Blob([data]);
    return {
      body: blob.stream(),
      httpEtag: `"${this.etag}"`,
      arrayBuffer: () => blob.arrayBuffer(),
      text: () => blob.text(),
      json: async <T>() => JSON.parse(await blob.text()) as T,
      blob: async () => blob,
      bodyUsed: false,
      key: "profiles/current.json",
      version: this.etag,
      size: this.value.byteLength,
      etag: this.etag,
      uploaded: new Date(),
      httpMetadata: {},
      customMetadata: undefined,
      checksums: {} as R2Checksums,
      writeHttpMetadata: () => {},
      storageClass: "Standard",
    } as unknown as R2ObjectBody;
  }

  async put(_key: string, body: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null, options?: R2PutOptions): Promise<R2Object | null> {
    const condition = options?.onlyIf as Headers | undefined;
    if (condition?.get("If-None-Match") === "*" && this.value !== null) return null;
    const ifMatch = condition?.get("If-Match");
    if (ifMatch && ifMatch !== `"${this.etag}"`) return null;
    const raw = typeof body === "string" ? new TextEncoder().encode(body)
      : body instanceof Uint8Array ? body
        : body instanceof ArrayBuffer ? new Uint8Array(body)
          : null;
    if (!raw) throw new Error("unexpected fake bucket body");
    this.value = new Uint8Array(raw);
    this.etag = `e${++this.writes}`;
    return { httpEtag: `"${this.etag}"`, etag: this.etag } as R2Object;
  }
}

function req(method: string, headers: Record<string, string> = {}, body?: BodyInit): Request {
  return new Request("https://game.example/_internal/profiles", { method, headers, body });
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const bucketView = (bucket: FakeBucket) => bucket as unknown as Pick<R2Bucket, "get" | "put">;

describe("internal R2 profile snapshot endpoint", () => {
  it("requires a configured long secret and an exact bearer token without touching R2", async () => {
    const bucket = new FakeBucket();
    expect((await handleProfileSnapshot(req("GET"), bucketView(bucket), TOKEN)).status).toBe(401);
    expect((await handleProfileSnapshot(req("GET", { Authorization: `Bearer ${"x".repeat(32)}` }), bucketView(bucket), TOKEN)).status).toBe(401);
    expect((await handleProfileSnapshot(req("GET", auth), bucketView(bucket), "too-short")).status).toBe(401);
    expect(bucket.writes).toBe(0);
  });

  it("returns the snapshot and its ETag only to an authenticated reader", async () => {
    const bucket = new FakeBucket();
    const created = await handleProfileSnapshot(req("PUT", { ...auth, "If-None-Match": "*" }, goodSnapshot), bucketView(bucket), TOKEN);
    expect(created.status).toBe(204);
    const read = await handleProfileSnapshot(req("GET", auth), bucketView(bucket), TOKEN);
    expect(read.status).toBe(200);
    expect(read.headers.get("ETag")).toBe('"e1"');
    expect(read.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(read.headers.get("X-Profile-Snapshot-Etag")).toBe('"e1"');
    expect(created.headers.get("X-Profile-Snapshot-Etag")).toBe('"e1"');
    expect(await read.text()).toBe(goodSnapshot);
  });

  it("returns 404 for a missing snapshot and rejects write conditions that are absent or ambiguous", async () => {
    const bucket = new FakeBucket();
    expect((await handleProfileSnapshot(req("GET", auth), bucketView(bucket), TOKEN)).status).toBe(404);
    expect((await handleProfileSnapshot(req("PUT", auth, goodSnapshot), bucketView(bucket), TOKEN)).status).toBe(428);
    expect((await handleProfileSnapshot(req("PUT", { ...auth, "If-Match": '"a"', "If-None-Match": "*" }, goodSnapshot), bucketView(bucket), TOKEN)).status).toBe(428);
  });

  it("requires a valid v2 profiles shape and limits request bodies to 8 MiB", async () => {
    const bucket = new FakeBucket();
    const bad = JSON.stringify({ version: 2, profiles: { player1: { name: "other", token: "t" } } });
    expect((await handleProfileSnapshot(req("PUT", { ...auth, "If-None-Match": "*" }, bad), bucketView(bucket), TOKEN)).status).toBe(400);
    expect((await handleProfileSnapshot(req("PUT", { ...auth, "If-None-Match": "*" }, "{"), bucketView(bucket), TOKEN)).status).toBe(400);
    expect(PROFILE_SNAPSHOT_MAX_BYTES).toBe(8 * 1024 * 1024);
    const oversized = req("PUT", { ...auth, "If-None-Match": "*", "Content-Length": String(PROFILE_SNAPSHOT_MAX_BYTES + 1) }, "{}");
    expect((await handleProfileSnapshot(oversized, bucketView(bucket), TOKEN)).status).toBe(413);
    expect(bucket.writes).toBe(0);
  });

  it("uses R2 compare-and-swap on create and update and reports stale writers", async () => {
    const bucket = new FakeBucket();
    const create = await handleProfileSnapshot(req("PUT", { ...auth, "If-None-Match": "*" }, goodSnapshot), bucketView(bucket), TOKEN);
    expect(create.status).toBe(204);
    expect(create.headers.get("ETag")).toBe('"e1"');

    const next = JSON.stringify({ version: 2, profiles: {} });
    const stale = await handleProfileSnapshot(req("PUT", { ...auth, "If-Match": '"old"' }, next), bucketView(bucket), TOKEN);
    expect(stale.status).toBe(412);
    expect(bucket.writes).toBe(1);

    const update = await handleProfileSnapshot(req("PUT", { ...auth, "If-Match": '"e1"' }, next), bucketView(bucket), TOKEN);
    expect(update.status).toBe(204);
    expect(update.headers.get("ETag")).toBe('"e2"');
    expect(bucket.writes).toBe(2);
  });

  it("only permits GET and PUT after authentication", async () => {
    const bucket = new FakeBucket();
    const response = await handleProfileSnapshot(req("DELETE", auth), bucketView(bucket), TOKEN);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, PUT");
  });
});

describe("profile snapshot R2 integration", () => {
  it("uses real Miniflare R2 auth, reads, create-only writes, ETag updates, and stale-write conflicts", async () => {
    const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
    const bundle = await build({
      stdin: {
        contents: `import { handleProfileSnapshot } from "./profileSnapshots";
          export default { fetch(request, env) { return handleProfileSnapshot(request, env.PROFILES, env.PROFILE_SNAPSHOT_TOKEN); } };`,
        resolveDir: sourceDir,
        sourcefile: "snapshot-worker.ts",
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      target: "es2022",
    });
    const miniflare = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: "2026-10-28",
      bindings: { PROFILE_SNAPSHOT_TOKEN: TOKEN },
      r2Buckets: { PROFILES: "profiles-integration-test" },
    }));
    const dispatch = (method: string, headers: Record<string, string> = {}, body?: string) =>
      miniflare.dispatchFetch("https://worker.test/_internal/profiles", { method, headers, body });

    try {
      expect((await dispatch("GET")).status).toBe(401);
      expect((await dispatch("GET", { Authorization: `Bearer ${TOKEN}` })).status).toBe(404);

      const create = await dispatch("PUT", { Authorization: `Bearer ${TOKEN}`, "If-None-Match": "*" }, goodSnapshot);
      expect(create.status).toBe(204);
      const initialEtag = create.headers.get("ETag");
      expect(initialEtag).toMatch(/^".+"$/);

      const read = await dispatch("GET", { Authorization: `Bearer ${TOKEN}` });
      expect(read.status).toBe(200);
      expect(read.headers.get("ETag")).toBe(initialEtag);
      expect(await read.text()).toBe(goodSnapshot);

      const secondCreate = await dispatch("PUT", { Authorization: `Bearer ${TOKEN}`, "If-None-Match": "*" }, goodSnapshot);
      expect(secondCreate.status).toBe(412);
      const stale = await dispatch("PUT", { Authorization: `Bearer ${TOKEN}`, "If-Match": '"stale-etag"' }, goodSnapshot);
      expect(stale.status).toBe(412);

      const replacement = JSON.stringify({ version: 2, profiles: {} });
      const update = await dispatch("PUT", { Authorization: `Bearer ${TOKEN}`, "If-Match": initialEtag! }, replacement);
      expect(update.status).toBe(204);
      expect(update.headers.get("ETag")).not.toBe(initialEtag);
      const finalRead = await dispatch("GET", { Authorization: `Bearer ${TOKEN}` });
      expect(await finalRead.text()).toBe(replacement);
    } finally {
      await miniflare.dispose();
    }
  });
});
