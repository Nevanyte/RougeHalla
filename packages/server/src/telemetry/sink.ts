// Where finished run records go (docs/TELEMETRY.md 6.1): the Worker's ingest over HTTPS (gzip NDJSON, bounded queue, retries,
// then drop) and a local NDJSON directory. Nothing here runs on the tick: `submit` only schedules work (setImmediate), and the
// game never waits for a record. Telemetry never touches the profile store or the server's health.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  telemetryDay, TELEMETRY_BATCH_HEADER, TELEMETRY_FLUSH_DELAY_MS, TELEMETRY_INGEST_MAX_COMPRESSED_BYTES,
  TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES, TELEMETRY_INGEST_MAX_RECORDS, TELEMETRY_QUEUE_MAX_BYTES, TELEMETRY_QUEUE_MAX_RECORDS,
  TELEMETRY_RECORD_MAX_BYTES, TELEMETRY_REQUEST_TIMEOUT_MS, TELEMETRY_RETRY_DELAYS_MS, TELEMETRY_SCHEMA_HEADER, TELEMETRY_SCHEMA_VERSION,
  type IngestResponse, type RunRecord,
} from "@raid/shared";

const gzip = promisify(zlib.gzip);

export interface SinkStats { sent: number; dropped: number; failed: number; queued: number }

export interface TelemetrySink {
  /** Never throws, never blocks: the record is serialized and sent later. */
  submit(record: RunRecord): void;
  /** Flush what it can, then give up. */
  close(deadlineMs: number): Promise<void>;
  stats(): SinkStats;
}

type Log = (line: string) => void;

/** At most one line a minute per kind of failure; never a record or a token. */
function throttledLog(log: Log, now: () => number = Date.now): (kind: string, line: string) => void {
  const last = new Map<string, number>();
  return (kind, line) => {
    const t = now();
    if ((last.get(kind) ?? -Infinity) + 60_000 > t) return;
    last.set(kind, t);
    log(line);
  };
}

/**
 * One record as one NDJSON line, within TELEMETRY_RECORD_MAX_BYTES: an oversized record goes without its tiles
 * (`truncated.tiles`), and one still too big is null (dropped).
 */
export function serializeRecord(record: RunRecord, maxBytes = TELEMETRY_RECORD_MAX_BYTES): string | null {
  let line = JSON.stringify(record);
  if (Buffer.byteLength(line) <= maxBytes) return line;
  const slim: RunRecord = {
    ...record,
    players: record.players.map(({ tiles: _tiles, ...p }) => p),
    truncated: { ...record.truncated, tiles: true },
  };
  line = JSON.stringify(slim);
  return Buffer.byteLength(line) <= maxBytes ? line : null;
}

const later = (fn: () => void): void => { setImmediate(fn); };
const sleep = (ms: number): Promise<void> => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

export interface HttpSinkOptions {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  flushDelayMs?: number;
  maxQueueRecords?: number;
  maxQueueBytes?: number;
  maxBatchRecords?: number;
  maxRecordBytes?: number;
  log?: Log;
}

interface Queued { runId: string; line: string; bytes: number }

export function createHttpSink(opts: HttpSinkOptions): TelemetrySink {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? TELEMETRY_REQUEST_TIMEOUT_MS;
  const delays = opts.retryDelaysMs ?? TELEMETRY_RETRY_DELAYS_MS;
  const flushDelay = opts.flushDelayMs ?? TELEMETRY_FLUSH_DELAY_MS;
  const maxRecords = opts.maxQueueRecords ?? TELEMETRY_QUEUE_MAX_RECORDS;
  const maxBytes = opts.maxQueueBytes ?? TELEMETRY_QUEUE_MAX_BYTES;
  const maxBatch = opts.maxBatchRecords ?? TELEMETRY_INGEST_MAX_RECORDS;
  const maxRecordBytes = opts.maxRecordBytes ?? TELEMETRY_RECORD_MAX_BYTES;
  const warn = throttledLog(opts.log ?? ((l) => console.warn(l)));
  const queue: Queued[] = [];
  let queuedBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let pendingSerialize = 0;
  let closing = false;
  const s = { sent: 0, dropped: 0, failed: 0 };

  function enqueue(q: Queued): void {
    queue.push(q);
    queuedBytes += q.bytes;
    while (queue.length > maxRecords || queuedBytes > maxBytes) {
      const old = queue.shift()!;
      queuedBytes -= old.bytes;
      s.dropped++;
      warn("full", "[telemetry] the send queue is full: dropping the oldest record");
    }
  }

  function arm(): void {
    if (timer || inFlight || queue.length === 0 || closing) return;
    timer = setTimeout(() => { timer = null; void flush(true); }, flushDelay);
    timer.unref?.();
  }

  /** One POST of `body` (gzip): "done", "drop" (a config error) or "retry". */
  async function post(body: Buffer, batchId: string, n: number): Promise<"done" | "drop" | "retry"> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    t.unref?.();
    try {
      const res = await fetchImpl(opts.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/x-ndjson",
          "Content-Encoding": "gzip",
          [TELEMETRY_SCHEMA_HEADER]: String(TELEMETRY_SCHEMA_VERSION),
          [TELEMETRY_BATCH_HEADER]: batchId,
        },
        body: new Uint8Array(body) as Uint8Array<ArrayBuffer>,
        signal: controller.signal,
      });
      if (res.status === 200) {
        let parsed: IngestResponse | null = null;
        try { parsed = (await res.json()) as IngestResponse; } catch { parsed = null; }
        const ok = parsed ? (parsed.accepted?.length ?? 0) + (parsed.duplicate?.length ?? 0) : n;
        const rejected = parsed?.rejected?.length ?? 0;
        s.sent += ok;
        s.failed += rejected;
        for (const r of parsed?.rejected ?? []) warn(`reject:${r.reason}`, `[telemetry] a record was rejected: ${String(r.reason).slice(0, 80)}`);
        return "done";
      }
      try { await res.body?.cancel(); } catch { /* nothing to read */ }
      if (res.status === 401 || res.status === 400 || res.status === 413 || res.status === 415) {
        warn(`http${res.status}`, `[telemetry] ingest refused a batch with HTTP ${res.status}: dropped`);
        return "drop";
      }
      warn("retry", `[telemetry] ingest answered HTTP ${res.status}: will retry`);
      return "retry";
    } catch {
      warn("network", "[telemetry] ingest request failed: will retry");
      return "retry";
    } finally {
      clearTimeout(t);
    }
  }

  async function sendBatch(batch: Queued[], retries: boolean): Promise<void> {
    const body = await gzip(Buffer.from(batch.map((q) => q.line).join("\n") + "\n"));
    if (body.byteLength > TELEMETRY_INGEST_MAX_COMPRESSED_BYTES) {
      if (batch.length > 1) {
        const half = Math.ceil(batch.length / 2);
        await sendBatch(batch.slice(0, half), retries);
        await sendBatch(batch.slice(half), retries);
        return;
      }
      s.dropped++;
      return;
    }
    const batchId = randomUUID();
    for (let attempt = 0; ; attempt++) {
      const verdict = await post(body, batchId, batch.length);
      if (verdict === "done") return;
      if (verdict === "drop" || !retries || attempt >= delays.length || closing) { s.failed += batch.length; return; }
      await sleep(delays[attempt]!);
    }
  }

  async function flush(retries: boolean): Promise<void> {
    if (inFlight || queue.length === 0) return;
    const batch: Queued[] = [];
    let bytes = 0;
    while (queue.length > 0 && batch.length < maxBatch && bytes + queue[0]!.bytes <= TELEMETRY_INGEST_MAX_DECOMPRESSED_BYTES) {
      const q = queue.shift()!;
      queuedBytes -= q.bytes;
      bytes += q.bytes + 1;
      batch.push(q);
    }
    if (batch.length === 0) { const q = queue.shift()!; queuedBytes -= q.bytes; s.dropped++; return; }
    inFlight = sendBatch(batch, retries).catch(() => { s.failed += batch.length; }).finally(() => { inFlight = null; arm(); });
    await inFlight;
  }

  return {
    submit(record) {
      try {
        pendingSerialize++;
        later(() => {
          pendingSerialize--;
          try {
            const line = serializeRecord(record, maxRecordBytes);
            if (line === null) { s.dropped++; warn("size", "[telemetry] a record was over the size cap: dropped"); return; }
            enqueue({ runId: record.runId, line, bytes: Buffer.byteLength(line) });
            arm();
          } catch {
            s.dropped++;
          }
        });
      } catch {
        s.dropped++;
      }
    },
    async close(deadlineMs) {
      const deadline = sleep(Math.max(0, deadlineMs));
      const work = (async () => {
        while (pendingSerialize > 0) await new Promise<void>((r) => setImmediate(r));
        closing = true;
        if (timer) { clearTimeout(timer); timer = null; }
        if (inFlight) await inFlight;
        while (queue.length > 0) await flush(false);
      })().catch(() => {});
      await Promise.race([work, deadline]);
      closing = true;
      if (timer) { clearTimeout(timer); timer = null; }
    },
    stats: () => ({ ...s, queued: queue.length }),
  };
}

export interface FileSinkOptions { dir: string; log?: Log; maxRecordBytes?: number }

/** One record a line in `<dir>/runs-<yyyy-mm-dd>.ndjson` (the day of its end), appended in order by one async chain. */
export function createFileSink(opts: FileSinkOptions): TelemetrySink {
  const warn = throttledLog(opts.log ?? ((l) => console.warn(l)));
  const s = { sent: 0, dropped: 0, failed: 0 };
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let madeDir = false;
  return {
    submit(record) {
      try {
        pending++;
        later(() => {
          let line: string | null = null;
          try { line = serializeRecord(record, opts.maxRecordBytes); } catch { line = null; }
          if (line === null) { pending--; s.dropped++; return; }
          const file = path.join(opts.dir, `runs-${telemetryDay(record.endedAtEpoch)}.ndjson`);
          const text = line + "\n";
          chain = chain.then(async () => {
            try {
              if (!madeDir) { await fs.promises.mkdir(opts.dir, { recursive: true }); madeDir = true; }
              await fs.promises.appendFile(file, text);
              s.sent++;
            } catch {
              s.failed++;
              warn("file", "[telemetry] could not append to the telemetry directory");
            } finally {
              pending--;
            }
          });
        });
      } catch {
        s.dropped++;
      }
    },
    async close(deadlineMs) {
      const work = (async () => {
        while (pending > 0) { await new Promise<void>((r) => setImmediate(r)); await chain; }
      })();
      await Promise.race([work, sleep(Math.max(0, deadlineMs))]);
    },
    stats: () => ({ ...s, queued: pending }),
  };
}

/**
 * The file sink for a caller that never yields to the event loop between records (the tournament plays a whole
 * batch in one synchronous loop, so the async sink's setImmediate work would pin every game's record in memory until
 * the batch ended and then write them in one burst): `submit` serializes and appends at once, so each record is
 * released when its game ends. Not for a server's tick, which must never wait on the disk.
 */
export function createSyncFileSink(opts: FileSinkOptions): TelemetrySink {
  const warn = throttledLog(opts.log ?? ((l) => console.warn(l)));
  const s = { sent: 0, dropped: 0, failed: 0 };
  let madeDir = false;
  return {
    submit(record) {
      let line: string | null = null;
      try { line = serializeRecord(record, opts.maxRecordBytes); } catch { line = null; }
      if (line === null) { s.dropped++; return; }
      try {
        if (!madeDir) { fs.mkdirSync(opts.dir, { recursive: true }); madeDir = true; }
        fs.appendFileSync(path.join(opts.dir, `runs-${telemetryDay(record.endedAtEpoch)}.ndjson`), line + "\n");
        s.sent++;
      } catch {
        s.failed++;
        warn("file", "[telemetry] could not append to the telemetry directory");
      }
    },
    async close() {},
    stats: () => ({ ...s, queued: 0 }),
  };
}

/** Every record to each sink. */
export function multiSink(sinks: readonly TelemetrySink[]): TelemetrySink {
  return {
    submit(record) { for (const k of sinks) k.submit(record); },
    async close(deadlineMs) { await Promise.all(sinks.map((k) => k.close(deadlineMs))); },
    stats() {
      const out = { sent: 0, dropped: 0, failed: 0, queued: 0 };
      for (const k of sinks) { const st = k.stats(); out.sent += st.sent; out.dropped += st.dropped; out.failed += st.failed; out.queued += st.queued; }
      return out;
    },
  };
}
