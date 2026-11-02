// The dashboard's routes (docs/TELEMETRY.md 8.1 and 8.3): the page, login and logout, and the JSON API. Answered by
// the Worker before the container fallthrough, so viewing stats never wakes the game container.
import { isRunId, validateRunRecord, type RunRecord } from "@raid/shared/telemetry";
import { dashboardHtml, dashboardScript, dashboardStyles } from "../dashboard/page";
import { authorized, dashboardEnabled, dashboardHeaders, handleLogin, handleLogout, sameOrigin } from "./auth";
import { gunzipText, telemetryStore, type TelemetryStoreNamespace } from "./ingest";
import { encodeExportCursor, parseOptions, parseStatsQuery } from "./query";
import { toRows, type IngestRows } from "./rows";
import type { ExportPage, IngestStatus, QueryName } from "./store";

export interface StatsEnv {
  DASHBOARD_TOKEN?: string;
  MATCHMAKE_LIMITER?: Pick<RateLimit, "limit">;
  TELEMETRY: TelemetryStoreNamespace;
  PROFILES: Pick<R2Bucket, "get" | "list">;
}

/** /api/stats/<path> -> the store's query. meta, run/:id, export and admin/reindex are handled apart. */
const ENDPOINTS: Readonly<Record<string, QueryName>> = {
  overview: "overview",
  factions: "factions",
  weapons: "weapons",
  "duels/factions": "duelFactions",
  "duels/weapons": "duelWeapons",
  "duels/summary": "duelSummary",
  offers: "offers",
  farming: "farming",
  camps: "camps",
  deaths: "deaths",
  firstblood: "firstblood",
  heatmap: "heatmap",
  runs: "runs",
  perf: "perf",
};

export const REINDEX_PAGE = 200;
const REINDEX_BATCH = 25;
const TELEMETRY_PREFIX = "telemetry/v1/";

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  const h = dashboardHeaders("application/json; charset=utf-8");
  for (const [k, v] of Object.entries(extra ?? {})) h.set(k, v);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function plain(status: number, message: string, allow?: string): Response {
  const h = dashboardHeaders("text/plain; charset=utf-8");
  if (allow) h.set("Allow", allow);
  return new Response(message, { status, headers: h });
}

function isDashboardPath(path: string): boolean {
  return path === "/stats" || path.startsWith("/stats/") || path === "/api/stats" || path.startsWith("/api/stats/");
}

/** The dashboard's answer, or null for a path that is not the dashboard's. */
export async function handleStats(request: Request, env: StatsEnv, now = Date.now()): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!isDashboardPath(path)) return null;
  const token = env.DASHBOARD_TOKEN;
  if (!dashboardEnabled(token)) {
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }

  if (path === "/stats" || path === "/stats/" || path === "/stats/app.js" || path === "/stats/app.css") {
    if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "method not allowed", "GET, HEAD");
    const [body, type] = path === "/stats/app.js" ? [dashboardScript(), "text/javascript; charset=utf-8"]
      : path === "/stats/app.css" ? [dashboardStyles(), "text/css; charset=utf-8"]
        : [dashboardHtml(), "text/html; charset=utf-8"];
    return new Response(request.method === "HEAD" ? null : body, { status: 200, headers: dashboardHeaders(type) });
  }
  if (path === "/stats/login") return handleLogin(request, { DASHBOARD_TOKEN: token, MATCHMAKE_LIMITER: env.MATCHMAKE_LIMITER }, now);
  if (path === "/stats/logout") return handleLogout(request);
  if (!path.startsWith("/api/stats/")) return plain(404, "not found");

  if (!(await authorized(request, token, now))) return json(401, { error: "unauthorized" });
  const endpoint = path.slice("/api/stats/".length);
  try {
    if (endpoint === "admin/reindex") {
      if (request.method !== "POST") return plain(405, "method not allowed", "POST");
      return await reindex(request, env, url);
    }
    if (request.method !== "GET") return plain(405, "method not allowed", "GET");
    const store = telemetryStore(env.TELEMETRY);
    if (endpoint === "meta") return json(200, await store.query("meta", { from: "", to: "", pool: "all" }, {}, now));
    if (endpoint.startsWith("run/")) {
      const runId = endpoint.slice(4);
      if (!isRunId(runId)) return json(400, { error: "bad parameter", param: "runId" });
      const key = await store.runKey(runId);
      const object = key ? await env.PROFILES.get(key) : null;
      if (!object) return json(404, { error: "not found" });
      const h = dashboardHeaders("application/json; charset=utf-8");
      return new Response(await gunzipText(object.body), { status: 200, headers: h });
    }
    const name = endpoint === "export" ? "exportPage" : ENDPOINTS[endpoint];
    if (!name) return json(404, { error: "not found" });
    const q = parseStatsQuery(url.searchParams, now);
    if (!q.ok) return json(400, { error: "bad parameter", param: q.param });
    const opts = parseOptions(endpoint, url.searchParams);
    if (!opts.ok) return json(400, { error: "bad parameter", param: opts.param });
    const answer = await store.query(name, q.value, opts.value, now);
    if (name === "exportPage") return exportStream(env, answer as ExportPage);
    return json(200, answer);
  } catch {
    return json(503, { error: "telemetry store unavailable" });
  }
}

function exportStream(env: StatsEnv, page: ExportPage): Response {
  const keys = [...page.keys];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctl) {
      while (keys.length > 0) {
        const object = await env.PROFILES.get(keys.shift()!);
        if (!object) continue;
        const text = (await gunzipText(object.body)).trim();
        if (text.length === 0 || text.includes("\n")) continue;
        ctl.enqueue(encoder.encode(`${text}\n`));
        return;
      }
      ctl.close();
    },
  });
  const h = dashboardHeaders("application/x-ndjson; charset=utf-8");
  if (page.next) h.set("X-Next-Cursor", encodeExportCursor(page.next));
  return new Response(stream, { status: 200, headers: h });
}

/** Rebuilds the store from the R2 archive, a page of objects per call (duplicates are no-ops). */
async function reindex(request: Request, env: StatsEnv, url: URL): Promise<Response> {
  if (!request.headers.get("Authorization") && !sameOrigin(request)) return json(403, { error: "forbidden" });
  if (url.searchParams.get("confirm") !== "1") return json(400, { error: "bad parameter", param: "confirm" });
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && (cursor.length > 2048 || !/^[\x21-\x7e]+$/.test(cursor))) return json(400, { error: "bad parameter", param: "cursor" });
  const listing = await env.PROFILES.list({ prefix: TELEMETRY_PREFIX, limit: REINDEX_PAGE, ...(cursor ? { cursor } : {}) });
  const store = telemetryStore(env.TELEMETRY);
  let indexed = 0;
  let duplicate = 0;
  let rejected = 0;
  let batch: IngestRows[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const statuses: IngestStatus[] = await store.ingest(batch);
    for (const s of statuses) s === "accepted" ? indexed++ : duplicate++;
    batch = [];
  };
  for (const entry of listing.objects) {
    if (!entry.key.endsWith(".json.gz")) continue;
    const object = await env.PROFILES.get(entry.key);
    if (!object) continue;
    let record: unknown;
    try {
      record = JSON.parse(await gunzipText(object.body));
    } catch {
      rejected++;
      continue;
    }
    if (validateRunRecord(record)) {
      rejected++;
      continue;
    }
    batch.push(toRows(record as RunRecord & { receivedAt?: number }));
    if (batch.length >= REINDEX_BATCH) await flush();
  }
  await flush();
  return json(200, { indexed, duplicate, rejected, cursor: listing.truncated ? listing.cursor : null });
}
