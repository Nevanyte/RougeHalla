// Appends a room's movement trace (sim/trace.ts) to a JSONL file (TRACE_INPUTS). Rows are buffered in memory and written by
// `flush`, which the room calls about once a second and on dispose: never a synchronous write inside a tick.
import fs from "node:fs";
import path from "node:path";
import type { TraceRow } from "../sim/trace";

/**
 * Bytes one writer appends before it stops recording. A row is roughly 0.3 to 1 KB, so an 8-player room at 20 Hz writes about 50 to 150 KB/s:
 * a TRACE_INPUTS left set on a hosting server would otherwise fill the disk.
 */
export const TRACE_MAX_BYTES = 512 * 1024 * 1024;

/** Every append still in flight in this process, so a bench can wait for the file to be complete (traceWritesSettled). */
const inFlight = new Set<Promise<void>>();

export class TraceWriter {
  private rows: TraceRow[] = [];
  private chain: Promise<void>;
  private failed = false;
  private written = 0;

  constructor(private readonly file: string, private readonly maxBytes: number = TRACE_MAX_BYTES) {
    this.chain = fs.promises.mkdir(path.dirname(file), { recursive: true }).then(() => {}, (err: unknown) => this.fail(err));
  }

  push(row: TraceRow): void {
    // A stopped writer buffers nothing, so a full or broken trace costs no memory either.
    if (!this.failed) this.rows.push(row);
  }

  /** Writes what is buffered; appends are chained, so the file keeps the rows in order. */
  flush(): Promise<void> {
    if (this.rows.length === 0 || this.failed) return this.chain;
    const rows = this.rows;
    this.rows = [];
    const write = this.chain.then(async () => {
      if (this.failed) return;
      let text = "";
      for (const r of rows) text += `${JSON.stringify(r)}\n`;
      const bytes = Buffer.byteLength(text);
      if (this.written + bytes > this.maxBytes) {
        this.fail(new Error(`the ${this.maxBytes}-byte cap is reached`));
        return;
      }
      this.written += bytes;
      await fs.promises.appendFile(this.file, text);
    }).catch((err: unknown) => this.fail(err));
    this.chain = write;
    inFlight.add(write);
    void write.finally(() => inFlight.delete(write));
    return write;
  }

  private fail(err: unknown): void {
    // A trace is measurement only: losing it must never take the room down, so it stops after one report.
    if (!this.failed) console.error(`[trace] cannot write ${this.file}; recording stopped:`, err);
    this.failed = true;
    this.rows = [];
  }
}

/** Resolves once every trace append started so far in this process has landed (or failed). */
export async function traceWritesSettled(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}
