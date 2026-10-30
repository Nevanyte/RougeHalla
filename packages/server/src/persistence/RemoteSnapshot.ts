import fs from "node:fs";
import path from "node:path";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RemoteSnapshotSink {
  /** Persist the exact profile snapshot, rejecting if the remote store cannot confirm it. */
  save(json: string): Promise<void>;
}

interface RemoteSnapshotOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowHttpLocalhost?: boolean;
}

function localHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function snapshotBytes(json: string): number {
  return Buffer.byteLength(json, "utf8");
}

function ensureSnapshotJson(text: string): void {
  if (snapshotBytes(text) > MAX_SNAPSHOT_BYTES) throw new Error("remote profile snapshot exceeds 8 MiB");
  try {
    JSON.parse(text);
  } catch (err) {
    throw new Error("remote profile snapshot is not valid JSON", { cause: err });
  }
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SNAPSHOT_BYTES) throw new Error("remote profile snapshot exceeds 8 MiB");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SNAPSHOT_BYTES) {
        await reader.cancel();
        throw new Error("remote profile snapshot exceeds 8 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8");
}

/** Prefer the Worker's opaque R2 entity tag so edge response transformations cannot weaken the CAS token. */
function snapshotEtag(headers: Headers, context: string): string {
  const custom = headers.get("x-profile-snapshot-etag");
  const etag = custom ?? headers.get("etag");
  if (!etag) throw new Error(`remote profile snapshot ${context} is missing ETag`);
  // Weak entity tags are valid cache validators but cannot safely serve as If-Match write preconditions.
  if (/^W\//.test(etag)) {
    throw new Error(`remote profile snapshot ${context} has a weak ETag; a strong snapshot ETag is required`);
  }
  return etag;
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
   consume: (response: Response) => Promise<unknown> = async (response) => response,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("remote profile snapshot request timed out")), timeoutMs);
  timer.unref?.();
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      throw new Error("remote profile snapshot request failed", { cause: err });
    }
    await consume(response);
  } catch (err) {
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSnapshot(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  timeoutMs: number,
): Promise<{ kind: "missing" } | { kind: "found"; json: string; etag: string }> {
  let result: { kind: "missing" } | { kind: "found"; json: string; etag: string } | undefined;
  await request(fetchImpl, url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  }, timeoutMs, async (response) => {
    if (response.status === 404) {
      result = { kind: "missing" };
      return;
    }
    if (!response.ok) throw new Error(`remote profile snapshot GET failed with HTTP ${response.status}`);
    const etag = snapshotEtag(response.headers, "response");
    const json = await readBounded(response);
    ensureSnapshotJson(json);
    result = { kind: "found", json, etag };
  });
  return result!;
}

/** Atomically hydrate the local cache without making a partial file visible to the JSON store. */
async function hydrateLocal(file: string, json: string): Promise<void> {
  const resolved = path.resolve(file);
  const dir = path.dirname(resolved);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${resolved}.hydrate-${process.pid}`;
  const fh = await fs.promises.open(tmp, "w");
  try {
    await fh.writeFile(json, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.promises.rename(tmp, resolved);
  let directory: fs.promises.FileHandle | undefined;
  try {
    directory = await fs.promises.open(dir, "r");
    await directory.sync();
  } catch (err) {
    if (!["EISDIR", "EPERM", "EINVAL"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
  } finally {
    await directory?.close();
  }
}

/**
 * Pull the authoritative snapshot to the local cache before constructing JsonProfileStore, then return its durable
 * save callback. A configured remote 404 deliberately clears stale local state; transport or validation errors never
 * fall back to that local copy.
 */
export async function initializeRemoteSnapshot(
  stashFile: string,
  env: NodeJS.ProcessEnv = process.env,
  options: RemoteSnapshotOptions = {},
): Promise<RemoteSnapshotSink | null> {
  const rawUrl = env.PROFILE_SNAPSHOT_URL;
  const token = env.PROFILE_SNAPSHOT_TOKEN;
  if (!rawUrl && !token) return null;
  if (!rawUrl || !token || token.length < 32) {
    throw new Error("PROFILE_SNAPSHOT_URL and PROFILE_SNAPSHOT_TOKEN (at least 32 characters) must both be configured");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (err) {
    throw new Error("PROFILE_SNAPSHOT_URL must be a valid URL", { cause: err });
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) throw new Error("PROFILE_SNAPSHOT_URL must not contain credentials or a fragment");
  const httpLocal = parsedUrl.protocol === "http:" && localHost(parsedUrl.hostname) && options.allowHttpLocalhost === true;
  if (parsedUrl.protocol !== "https:" && !httpLocal) throw new Error("PROFILE_SNAPSHOT_URL must use HTTPS (HTTP is allowed only for localhost tests)");
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("PROFILE_SNAPSHOT_URL must use HTTP or HTTPS");

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("invalid remote profile snapshot timeout");
  const initial = await fetchSnapshot(fetchImpl, parsedUrl.href, token, timeoutMs);
  let etag: string | null;
  if (initial.kind === "missing") {
    etag = null;
    await fs.promises.rm(path.resolve(stashFile), { force: true });
  } else {
    etag = initial.etag;
    await hydrateLocal(stashFile, initial.json);
  }

  // A request can commit remotely while its response is lost. Keep the exact attempted bytes so a later 412 can
  // reconcile that outcome before attempting a newer in-memory snapshot.
  let pendingSnapshot: string | null = null;

  return {
    async save(json: string): Promise<void> {
      ensureSnapshotJson(json);
      for (let attempt = 0; attempt < 2; attempt++) {
        const previouslyPending = pendingSnapshot;
        pendingSnapshot = json;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
        if (etag === null) headers["If-None-Match"] = "*";
        else headers["If-Match"] = etag;
        let status = 0;
        let nextEtag: string | null = null;
        await request(fetchImpl, parsedUrl.href, {
          method: "PUT",
          headers,
          body: json,
        }, timeoutMs, async (response) => {
          status = response.status;
          nextEtag = response.headers.has("x-profile-snapshot-etag") || response.headers.has("etag")
            ? snapshotEtag(response.headers, "PUT response")
            : null;
        });
        if (status === 412) {
          // The current PUT definitely did not apply. Only a snapshot from an earlier ambiguous PUT is ours to reconcile.
          pendingSnapshot = previouslyPending;
          const current = await fetchSnapshot(fetchImpl, parsedUrl.href, token, timeoutMs);
          if (previouslyPending !== null && current.kind === "found" && current.json === previouslyPending) {
            etag = current.etag;
            pendingSnapshot = null;
            if (previouslyPending === json) return;
            if (attempt === 0) continue;
          }
          throw new Error("remote profile snapshot changed concurrently; refusing to overwrite it");
        }
        if (status !== 200 && status !== 201 && status !== 204) {
          throw new Error(`remote profile snapshot PUT failed with HTTP ${status}`);
        }
        if (!nextEtag) throw new Error("remote profile snapshot PUT response is missing ETag");
        etag = nextEtag;
        pendingSnapshot = null;
        return;
      }
      throw new Error("remote profile snapshot retry limit reached");
    },
  };
}
