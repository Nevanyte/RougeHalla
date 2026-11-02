// The balance dashboard over REAL records, with no Worker or Cloudflare account:
//   npx tsx deployment/cloudflare/scripts/dashboardLocal.ts <file.ndjson|dir>... [--port 8789] [--open]
// Reads run records (a tournament's `--telemetry DIR`, a dev server's TELEMETRY_DIR), posts them through the Worker's
// own ingest handler (gzip NDJSON, validation, the R2 key) into an in-memory R2 and the store module on node:sqlite,
// then serves the Worker's own `handleStats` routes on localhost. Tournament runs are source "tournament" with no
// humans, so open /stats?source=tournament&pool=bots (printed at start). Local preview only: plain http, no Secure cookie.
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { TELEMETRY_INGEST_MAX_RECORDS } from "@raid/shared/telemetry";
import { handleTelemetryIngest, type TelemetryStoreNamespace } from "../src/telemetry/ingest";
import { handleStats } from "../src/telemetry/routes";
import { ingestRows, migrate, runKey, runQuery, type Sql, type SqlValue } from "../src/telemetry/store";

const args = process.argv.slice(2);
const flag = (name: string) => args.indexOf(name);
const port = flag("--port") >= 0 ? Number(args[flag("--port") + 1]) : 8789;
const open = args.includes("--open");
const inputs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
if (inputs.length === 0) {
  console.error("usage: dashboardLocal.ts <file.ndjson|dir>... [--port 8789] [--open]");
  process.exit(2);
}
const DASH = process.env.DASHBOARD_TOKEN ?? "local-dashboard-token-0123456789abcdef";
const INGEST = "local-ingest-token-0123456789abcdef0123";

function nodeSql(): Sql {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    all: (q: string, ...b: SqlValue[]) => db.prepare(q).all(...b) as Record<string, SqlValue>[],
    run: (q: string, ...b: SqlValue[]) => void db.prepare(q).run(...b),
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth++;
      db.exec("BEGIN");
      try {
        const r = fn();
        db.exec("COMMIT");
        return r;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        depth--;
      }
    },
  };
}

const sql = nodeSql();
migrate(sql);
const rpc = {
  ingest: async (rows: Parameters<typeof ingestRows>[1][]) => rows.map((r) => ingestRows(sql, r)),
  query: async (...a: Parameters<typeof runQuery> extends [Sql, ...infer R] ? R : never) => runQuery(sql, ...a),
  runKey: async (id: string) => runKey(sql, id),
};
const TELEMETRY = { idFromName: () => ({}), get: () => rpc } as unknown as TelemetryStoreNamespace;

const objects = new Map<string, Uint8Array>();
const PROFILES = {
  put: async (key: string, value: ArrayBuffer | Uint8Array) => void objects.set(key, new Uint8Array(value as ArrayBuffer)),
  get: async (key: string) => {
    const v = objects.get(key);
    return v ? { body: new Response(v as unknown as BodyInit).body! } : null;
  },
  list: async ({ prefix = "" }: { prefix?: string }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
} as never;

function files(p: string): string[] {
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).filter((f) => /\.ndjson(\.gz)?$/.test(f)).sort().map((f) => join(p, f));
}

const lines = inputs.flatMap(files).flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim().length > 0));
const totals = { accepted: 0, duplicate: 0, rejected: 0 };
for (let i = 0; i < lines.length; i += TELEMETRY_INGEST_MAX_RECORDS) {
  const body = gzipSync(lines.slice(i, i + TELEMETRY_INGEST_MAX_RECORDS).join("\n") + "\n");
  const res = await handleTelemetryIngest(new Request("http://local/_internal/telemetry", {
    method: "POST", body,
    headers: { Authorization: `Bearer ${INGEST}`, "Content-Encoding": "gzip", "Content-Type": "application/x-ndjson", "Content-Length": String(body.byteLength) },
  }), { TELEMETRY_TOKEN: INGEST, PROFILES, TELEMETRY }, { serverBuild: "", sourceCommit: null });
  if (res.status !== 200) throw new Error(`ingest ${res.status}: ${await res.text()}`);
  const r = (await res.json()) as { accepted: unknown[]; duplicate: unknown[]; rejected: { reason: string }[] };
  totals.accepted += r.accepted.length;
  totals.duplicate += r.duplicate.length;
  totals.rejected += r.rejected.length;
  for (const x of r.rejected) console.warn("rejected:", x.reason);
}
console.log(`ingested ${lines.length} records: ${JSON.stringify(totals)}`);

const env = { DASHBOARD_TOKEN: DASH, TELEMETRY, PROFILES };
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  if (open && !headers.has("authorization") && (req.url ?? "").startsWith("/api/stats/")) headers.set("authorization", `Bearer ${DASH}`);
  const host = req.headers.host ?? `localhost:${port}`;
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method, headers, ...(chunks.length > 0 && req.method !== "GET" && req.method !== "HEAD" ? { body: Buffer.concat(chunks) } : {}),
  });
  const answer = (await handleStats(request, env)) ?? new Response("not found", { status: 404 });
  const out: Record<string, string> = {};
  answer.headers.forEach((v, k) => {
    // The Worker's cookie is Secure (https only); drop the flag so a browser keeps it on plain localhost.
    out[k] = k === "set-cookie" ? v.replace(/;\s*Secure/i, "") : v;
  });
  res.writeHead(answer.status, out);
  res.end(Buffer.from(await answer.arrayBuffer()));
}).listen(port, () => {
  console.log(`dashboard on http://localhost:${port}/stats?source=any&pool=all` + (open ? " (no login)" : ` (token: ${DASH})`));
});
