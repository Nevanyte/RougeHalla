// POST /_internal/telemetry (docs/TELEMETRY.md 6.2): the container's gzipped NDJSON batch of RunRecords. Each valid
// record is archived in R2 under its deterministic key and flattened into the store; ingest is idempotent by runId,
// so the container's retries are harmless.
import {
  TELEMETRY_INGEST_MAX_COMPRESSED_BYTES,
  TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES,
  TELEMETRY_INGEST_MAX_RECORDS,
  TELEMETRY_RECORD_MAX_BYTES,
  TELEMETRY_SECRET_MIN_CHARS,
  isRunId,
  telemetryObjectKey,
  validateRunRecord,
  type IngestResponse,
  type RunRecord,
} from "@raid/shared/telemetry";
import { constantTimeEqual } from "./auth";
import { toRows, type IngestRows } from "./rows";
import type { IngestStatus, QueryName, QueryOptions, ResolvedQuery } from "./store";

/** The Durable Object's RPC surface as the Worker calls it. */
export interface TelemetryStoreRpc {
  ingest(rows: IngestRows[]): Promise<IngestStatus[]>;
  query(name: QueryName, q: ResolvedQuery, opts: QueryOptions, now: number): Promise<unknown>;
  runKey(runId: string): Promise<string | null>;
}

export interface TelemetryStoreNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): TelemetryStoreRpc;
}

/** The single store instance (docs/TELEMETRY.md 13: one DO for all telemetry). */
export const TELEMETRY_STORE_NAME = "telemetry-v1";

export function telemetryStore(ns: TelemetryStoreNamespace): TelemetryStoreRpc {
  return ns.get(ns.idFromName(TELEMETRY_STORE_NAME));
}

export interface IngestEnv {
  TELEMETRY_TOKEN?: string;
  PROFILES: Pick<R2Bucket, "put">;
  TELEMETRY: TelemetryStoreNamespace;
}

export interface IngestBuild {
  serverBuild: string;
  sourceCommit: string | null;
}

function text(status: number, message: string): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function bearerOk(request: Request, token: string): boolean {
  const auth = request.headers.get("Authorization");
  return !!auth?.startsWith("Bearer ") && constantTimeEqual(auth.slice(7), token);
}

// The stream types' BufferSource writable side does not narrow to Uint8Array in workers-types.
function gunzipStream(): ReadableWritablePair<Uint8Array, Uint8Array> {
  return new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
}

type BodyResult ={ ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 413 };

/** Streams the gzip body through DecompressionStream, counting both sides; a cap aborts at once (a gzip bomb). */
async function readGzip(body: ReadableStream<Uint8Array>): Promise<BodyResult> {
  let compressed = 0;
  let over = false;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      compressed += chunk.byteLength;
      if (compressed > TELEMETRY_INGEST_MAX_COMPRESSED_BYTES) {
        over = true;
        ctl.error(new Error("compressed body too large"));
        return;
      }
      ctl.enqueue(chunk);
    },
  });
  const reader = body.pipeThrough(counter).pipeThrough(gunzipStream()).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES) {
        over = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: over ? 413 : 400 };
  }
  if (over) return { ok: false, status: 413 };
  if (compressed === 0) return { ok: false, status: 400 };
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.byteLength;
  }
  return { ok: true, bytes };
}

export async function gzipBytes(data: string): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream.pipeThrough(gunzipStream())).text();
}

export async function handleTelemetryIngest(request: Request, env: IngestEnv, build: IngestBuild, now = Date.now()): Promise<Response> {
  const token = env.TELEMETRY_TOKEN;
  if (!token || token.length < TELEMETRY_SECRET_MIN_CHARS) return text(404, "not found");
  if (!bearerOk(request, token)) return text(401, "unauthorized");
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }
  const length = request.headers.get("Content-Length");
  if (length !== null && !(Number(length) <= TELEMETRY_INGEST_MAX_COMPRESSED_BYTES)) return text(413, "batch too large");
  if ((request.headers.get("Content-Encoding") ?? "").trim().toLowerCase() !== "gzip") return text(415, "gzip required");
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/x-ndjson") return text(415, "application/x-ndjson required");
  if (!request.body) return text(400, "empty body");

  const body = await readGzip(request.body);
  if (!body.ok) return text(body.status, body.status === 413 ? "batch too large" : "invalid gzip");
  let ndjson: string;
  try {
    ndjson = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
  } catch {
    return text(400, "invalid utf-8");
  }
  const lines = ndjson.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return text(400, "no records");
  if (lines.length > TELEMETRY_INGEST_MAX_RECORDS) return text(413, "too many records");

  const result: IngestResponse = { accepted: [], duplicate: [], rejected: [] };
  const encoder = new TextEncoder();
  const valid: { record: RunRecord & { receivedAt: number }; json: string }[] = [];
  for (const line of lines) {
    let parsed: unknown;
    if (encoder.encode(line).byteLength > TELEMETRY_RECORD_MAX_BYTES) {
      result.rejected.push({ runId: runIdOf(line), reason: "record too large" });
      continue;
    }
    try {
      parsed = JSON.parse(line);
    } catch {
      result.rejected.push({ runId: null, reason: "invalid JSON" });
      continue;
    }
    const problem = validateRunRecord(parsed);
    if (problem) {
      const id = (parsed as { runId?: unknown } | null)?.runId;
      result.rejected.push({ runId: isRunId(id) ? id : null, reason: problem });
      continue;
    }
    const record = parsed as RunRecord & { receivedAt: number };
    if (record.build.commit == null) record.build.commit = record.build.server === build.serverBuild ? build.sourceCommit : null;
    record.receivedAt = now;
    valid.push({ record, json: JSON.stringify(record) });
  }

  if (valid.length > 0) {
    try {
      for (const { record, json } of valid) {
        await env.PROFILES.put(telemetryObjectKey(record.build.server, record.endedAtEpoch, record.runId), await gzipBytes(json), {
          httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
          customMetadata: { v: String(record.v), source: String(record.source), humans: String(record.humans), bots: String(record.bots) },
        });
      }
      const statuses = await telemetryStore(env.TELEMETRY).ingest(valid.map(({ record }) => toRows(record, now)));
      valid.forEach(({ record }, i) => (statuses[i] === "duplicate" ? result.duplicate : result.accepted).push(record.runId));
    } catch {
      return text(503, "telemetry store unavailable");
    }
  }
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function runIdOf(line: string): string | null {
  const m = /"runId"\s*:\s*"([0-9a-f-]{36})"/.exec(line.slice(0, 4096));
  return m && isRunId(m[1]) ? m[1] : null;
}
