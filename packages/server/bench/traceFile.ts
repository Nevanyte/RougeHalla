// Reads a JSONL movement trace (TRACE_INPUTS, sim/trace.ts) for bench/predictBench.ts. Line by line: a live trace can outgrow the
// longest string Node will make, and a server killed mid-append leaves a cut last line that must not cost the whole report.
import fs from "node:fs";
import readline from "node:readline";
import type { TraceRow } from "../src/sim/trace";

export interface TraceRead {
  rows: TraceRow[];
  /** Lines left out: server-filled bots (only with `humansOnly`), players whose connection was down, and lines that are not a row. */
  skipped: { bots: number; dropped: number; unparsable: number };
}

export async function readTrace(file: string, humansOnly: boolean): Promise<TraceRead> {
  const out: TraceRead = { rows: [], skipped: { bots: 0, dropped: 0, unparsable: 0 } };
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    let row: TraceRow;
    try {
      row = JSON.parse(line) as TraceRow;
    } catch {
      out.skipped.unparsable++;
      continue;
    }
    if (typeof row !== "object" || row === null || typeof row.tick !== "number" || typeof row.x !== "number") {
      out.skipped.unparsable++;
      continue;
    }
    // A fighter nobody steers during its reconnect grace is no one's movement. (A trace from before these columns has neither.)
    if (row.dropped === true) { out.skipped.dropped++; continue; }
    if (humansOnly && row.bot === true) { out.skipped.bots++; continue; }
    out.rows.push(row);
  }
  return out;
}
