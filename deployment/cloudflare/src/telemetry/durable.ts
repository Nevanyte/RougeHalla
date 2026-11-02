// The TelemetryStore Durable Object (SQLite): the SQL adapter over ctx.storage, the ingest and query RPCs, and the
// daily retention alarm. All logic is in store.ts; this file only adapts it.
import { DurableObject } from "cloudflare:workers";
import { telemetryDay } from "@raid/shared/telemetry";
import type { IngestRows } from "./rows";
import { QUERY_NAMES, ingestRows, migrate, pruneBefore, runKey, runQuery, type IngestStatus, type QueryName, type QueryOptions, type ResolvedQuery, type Sql, type SqlValue } from "./store";

export const DEFAULT_RETAIN_DAYS = 400;
const DAY_MS = 86_400_000;

export interface TelemetryStoreEnv {
  TELEMETRY_RETAIN_DAYS?: string;
}

export function durableSql(storage: DurableObjectStorage): Sql {
  let read = 0;
  return {
    all(query: string, ...bind: SqlValue[]) {
      const cursor = storage.sql.exec(query, ...bind);
      const rows = cursor.toArray() as Record<string, SqlValue>[];
      read += cursor.rowsRead;
      return rows;
    },
    run(query: string, ...bind: SqlValue[]) {
      const cursor = storage.sql.exec(query, ...bind);
      cursor.toArray();
      read += cursor.rowsRead;
    },
    tx<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    },
    rowsRead: () => read,
  };
}

export function retainDays(env: TelemetryStoreEnv): number {
  const n = Number(env.TELEMETRY_RETAIN_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : DEFAULT_RETAIN_DAYS;
}

export class TelemetryStore extends DurableObject<TelemetryStoreEnv> {
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: TelemetryStoreEnv) {
    super(ctx, env);
    this.sql = durableSql(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql);
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }

  async ingest(rows: IngestRows[]): Promise<IngestStatus[]> {
    return rows.map((r) => ingestRows(this.sql, r));
  }

  async query(name: QueryName, q: ResolvedQuery, opts: QueryOptions, now: number): Promise<unknown> {
    if (!(QUERY_NAMES as readonly string[]).includes(name)) throw new Error("unknown query");
    return runQuery(this.sql, name, q, opts, now);
  }

  async runKey(runId: string): Promise<string | null> {
    return runKey(this.sql, runId);
  }

  async alarm(): Promise<void> {
    const cutoff = telemetryDay(Date.now() - retainDays(this.env) * DAY_MS);
    pruneBefore(this.sql, cutoff);
    await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
  }
}
