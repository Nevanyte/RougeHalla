import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonProfileStore } from "../src/persistence/ProfileStore";
import { initializeRemoteSnapshot } from "../src/persistence/RemoteSnapshot";

const TOKEN = "test-token-that-is-at-least-thirty-two-characters";
const validSnapshot = JSON.stringify({ version: 2, profiles: {} });

interface RemoteState {
  body: string | null;
  revision: number;
  requests: Array<{ method: string; headers: http.IncomingHttpHeaders; body: string }>;
  statusForPut?: number;
  delayMs?: number;
  loseNextPutResponse?: boolean;
  weakStandardEtag?: boolean;
  customSnapshotEtag?: boolean;
}

async function mockRemote(initial: string | null = null) {
  const state: RemoteState = { body: initial, revision: initial === null ? 0 : 1, requests: [] };
  const currentEtag = () => state.customSnapshotEtag ? `"r2-${state.revision}"` : `"${state.revision}"`;
  const responseEtagHeaders = () => ({
    ETag: state.weakStandardEtag ? `W/"${state.revision}"` : `"${state.revision}"`,
    ...(state.customSnapshotEtag ? { "X-Profile-Snapshot-Etag": currentEtag() } : {}),
  });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      state.requests.push({ method: req.method ?? "", headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401).end();
        return;
      }
      const send = () => {
        if (req.method === "GET") {
          if (state.body === null) {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json", ...responseEtagHeaders() }).end(state.body);
          return;
        }
        if (req.method === "PUT") {
          if (state.statusForPut) {
            res.writeHead(state.statusForPut).end();
            return;
          }
          const match = req.headers["if-match"];
          const create = req.headers["if-none-match"];
          if ((state.body === null && create !== "*") || (state.body !== null && match !== currentEtag())) {
            res.writeHead(412).end();
            return;
          }
          state.body = body;
          state.revision++;
          if (state.loseNextPutResponse) {
            state.loseNextPutResponse = false;
            res.destroy();
            return;
          }
          res.writeHead(200, responseEtagHeaders()).end();
          return;
        }
        res.writeHead(405).end();
      };
      if (state.delayMs) setTimeout(send, state.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server has no TCP address");
  const url = `http://127.0.0.1:${address.port}/snapshot`;
  return {
    state,
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

const dirs: string[] = [];
function localFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-remote-snapshot-"));
  dirs.push(dir);
  return path.join(dir, "stash.json");
}

const envFor = (url: string): NodeJS.ProcessEnv => ({ PROFILE_SNAPSHOT_URL: url, PROFILE_SNAPSHOT_TOKEN: TOKEN });
const init = (file: string, remoteUrl: string, timeoutMs = 1000) =>
  initializeRemoteSnapshot(file, envFor(remoteUrl), { timeoutMs, allowHttpLocalhost: true });

const remotes: Array<Awaited<ReturnType<typeof mockRemote>>> = [];
afterEach(async () => {
  await Promise.all(remotes.splice(0).map((r) => r.close()));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function remote(initial: string | null = null) {
  const r = await mockRemote(initial);
  remotes.push(r);
  return r;
}

describe("initializeRemoteSnapshot", () => {
  it("hydrates the local cache before returning a sink and saves with ETag compare-and-swap", async () => {
    const file = localFile();
    fs.writeFileSync(file, "stale local data");
    const r = await remote(validSnapshot);
    const sink = await init(file, r.url);
    expect(fs.readFileSync(file, "utf8")).toBe(validSnapshot);
    await sink!.save(JSON.stringify({ version: 2, profiles: { alice: { name: "alice" } } }));
    expect(r.state.requests.map((x) => x.method)).toEqual(["GET", "PUT"]);
    expect(r.state.requests[1]!.headers["if-match"]).toBe('"1"');
    expect(r.state.body).toContain("alice");
  });

  it("uses the opaque strong snapshot ETag when the standard response ETag has been weakened", async () => {
    const file = localFile();
    const r = await remote(validSnapshot);
    r.state.weakStandardEtag = true;
    r.state.customSnapshotEtag = true;
    const sink = await init(file, r.url);
    const first = JSON.stringify({ version: 2, profiles: { alice: {} } });
    await sink!.save(first);
    expect(r.state.requests[1]!.headers["if-match"]).toBe('"r2-1"');

    const second = JSON.stringify({ version: 2, profiles: { alice: {}, bobby: {} } });
    await sink!.save(second);
    expect(r.state.requests[2]!.headers["if-match"]).toBe('"r2-2"');
    expect(r.state.body).toBe(second);
  });

  it("rejects a weak standard ETag when no strong snapshot ETag is supplied", async () => {
    const file = localFile();
    const r = await remote(validSnapshot);
    r.state.weakStandardEtag = true;
    await expect(init(file, r.url)).rejects.toThrow(/weak ETag; a strong snapshot ETag is required/);
  });

  it("clears stale local data when the configured authoritative remote reports 404", async () => {
    const file = localFile();
    fs.writeFileSync(file, validSnapshot);
    const r = await remote();
    const sink = await init(file, r.url);
    expect(sink).not.toBeNull();
    expect(fs.existsSync(file)).toBe(false);
    await sink!.save(validSnapshot);
    expect(r.state.requests[1]!.headers["if-none-match"]).toBe("*");
    expect(r.state.body).toBe(validSnapshot);
  });

  it("treats a 412 as an idempotent lost response only when the current remote bytes match", async () => {
    const file = localFile();
    const r = await remote();
    const sink = await init(file, r.url);
    const snapshot = JSON.stringify({ version: 2, profiles: { alice: {} } });
    r.state.loseNextPutResponse = true;
    await expect(sink!.save(snapshot)).rejects.toThrow(/request failed/);
    await expect(sink!.save(snapshot)).resolves.toBeUndefined();
    expect(r.state.requests.map((x) => x.method)).toEqual(["GET", "PUT", "PUT", "GET"]);

    const conflicting = JSON.stringify({ version: 2, profiles: { bobby: {} } });
    r.state.body = conflicting;
    r.state.revision++;
    await expect(sink!.save(snapshot)).rejects.toThrow(/changed concurrently/);
  });

  it("fails closed on malformed remote JSON and does not fall back to local stale data", async () => {
    const file = localFile();
    fs.writeFileSync(file, validSnapshot);
    const r = await remote("{broken");
    await expect(init(file, r.url)).rejects.toThrow(/not valid JSON/);
    expect(fs.readFileSync(file, "utf8")).toBe(validSnapshot);
  });

  it("requires a complete secure configuration, while allowing an unset remote", async () => {
    expect(await initializeRemoteSnapshot(localFile(), {})).toBeNull();
    expect(await initializeRemoteSnapshot(localFile(), { PROFILE_SNAPSHOT_URL: "", PROFILE_SNAPSHOT_TOKEN: "" })).toBeNull();
    await expect(initializeRemoteSnapshot(localFile(), { PROFILE_SNAPSHOT_URL: "https://example.test" })).rejects.toThrow(/must both be configured/);
    await expect(initializeRemoteSnapshot(localFile(), envFor("http://example.test"), { allowHttpLocalhost: true })).rejects.toThrow(/must use HTTPS/);
  });

  it("rejects remote HTTP errors without using the local snapshot", async () => {
    const file = localFile();
    fs.writeFileSync(file, validSnapshot);
    const r = await remote(validSnapshot);
    r.state.statusForPut = 500;
    const sink = await init(file, r.url);
    await expect(sink!.save(validSnapshot)).rejects.toThrow(/PUT failed with HTTP 500/);
  });

  it("enforces request size limits and request timeouts", async () => {
    const file = localFile();
    const r = await remote();
    const sink = await init(file, r.url, 25);
    await expect(sink!.save(" ".repeat(8 * 1024 * 1024 + 1))).rejects.toThrow(/exceeds 8 MiB/);
    r.state.delayMs = 100;
    await expect(init(localFile(), r.url, 10)).rejects.toThrow(/request failed/);
  });

  it("plugs into JsonProfileStore and keeps a write pending when remote persistence fails", async () => {
    const file = localFile();
    const r = await remote();
    const sink = await init(file, r.url);
    r.state.statusForPut = 503;
    const store = new JsonProfileStore(file, { onSnapshot: sink!.save });
    store.claim("alice");
    await expect(store.flush()).rejects.toThrow(/PUT failed with HTTP 503/);
    r.state.statusForPut = undefined;
    await store.flush();
    expect(JSON.parse(r.state.body!).profiles.alice.name).toBe("alice");
    await store.close();
  });

  it("reconciles a lost successful PUT before retrying a newer in-memory snapshot", async () => {
    const file = localFile();
    const r = await remote();
    const sink = await init(file, r.url);
    const store = new JsonProfileStore(file, { onSnapshot: sink!.save });
    store.claim("alice");
    r.state.loseNextPutResponse = true;
    await expect(store.flush()).rejects.toThrow(/request failed/);
    expect(r.state.body).toBeTruthy(); // the remote committed, but its response was lost

    store.claim("bobby");
    await store.flush();
    expect(JSON.parse(r.state.body!).profiles).toHaveProperty("alice");
    expect(JSON.parse(r.state.body!).profiles).toHaveProperty("bobby");
    expect(r.state.requests.slice(-3).map((x) => x.method)).toEqual(["PUT", "GET", "PUT"]);
    await store.close();
  });
});
