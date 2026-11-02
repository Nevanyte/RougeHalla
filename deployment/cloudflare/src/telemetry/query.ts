// The dashboard API's query parameters (docs/TELEMETRY.md 8.2) -> a ResolvedQuery and the per-endpoint options.
// Every value is checked against a fixed set or a strict pattern; a bad one names its parameter in a 400.
import { DUEL_OUTCOMES, telemetryDay, type DuelOutcome, type OfferKind, type RecordSource, type StatsPool } from "@raid/shared/telemetry";
import { EXPORT_LIMIT_MAX, RUNS_LIMIT_MAX, type QueryOptions, type ResolvedQuery } from "./store";

export const DEFAULT_DAYS = 14;
const FACTIONS = new Set(["fire", "sentenced", "plague", "frost", "holy"]);
const WEAPONS = new Set(["sword", "bow", "wand", "shield", "axe", "fists"]);
const SOURCES = new Set<RecordSource>(["live", "dev", "tournament", "bench", "test"]);
const POOLS = new Set<StatsPool>(["humans", "bots", "all"]);
const BUILD = /^[A-Za-z0-9._-]{1,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MATRIX_OUTCOMES = new Set<DuelOutcome>(["kill", "thirdParty", "hazard"]);
const OFFER_KINDS = new Set<OfferKind>(["augment", "stat", "trophy"]);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; param: string };

function validDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && telemetryDay(t) === s;
}

/** The common filters. `now` sets the default range: the 14 UTC days ending today. */
export function parseStatsQuery(params: URLSearchParams, now: number): Parsed<ResolvedQuery> {
  const get = (k: string): string | null => {
    const v = params.get(k);
    return v === null || v === "" ? null : v;
  };
  const build = get("build");
  if (build !== null && !BUILD.test(build)) return { ok: false, param: "build" };
  const to = get("to") ?? telemetryDay(now);
  if (!validDay(to)) return { ok: false, param: "to" };
  const from = get("from") ?? telemetryDay(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_DAYS - 1) * 86_400_000);
  if (!validDay(from) || from > to) return { ok: false, param: "from" };
  const pool = (get("pool") ?? "humans") as StatsPool;
  if (!POOLS.has(pool)) return { ok: false, param: "pool" };
  const sourceRaw = get("source") ?? "live";
  if (sourceRaw !== "any" && !SOURCES.has(sourceRaw as RecordSource)) return { ok: false, param: "source" };
  const faction = get("faction");
  if (faction !== null && !FACTIONS.has(faction)) return { ok: false, param: "faction" };
  const weapon = get("weapon");
  if (weapon !== null && !WEAPONS.has(weapon)) return { ok: false, param: "weapon" };
  const q: ResolvedQuery = { from, to, pool };
  if (build !== null) q.build = build;
  if (sourceRaw !== "any") q.source = sourceRaw as RecordSource;
  if (faction !== null) q.faction = faction as ResolvedQuery["faction"];
  if (weapon !== null) q.weapon = weapon as ResolvedQuery["weapon"];
  return { ok: true, value: q };
}

function intParam(params: URLSearchParams, key: string, min: number, max: number): Parsed<number | undefined> {
  const v = params.get(key);
  if (v === null || v === "") return { ok: true, value: undefined };
  if (!/^\d{1,16}$/.test(v)) return { ok: false, param: key };
  const x = Number(v);
  if (!Number.isSafeInteger(x) || x < min || x > max) return { ok: false, param: key };
  return { ok: true, value: x };
}

/** The extra parameters of one endpoint (section 8.3). Unknown parameters are ignored. */
export function parseOptions(endpoint: string, params: URLSearchParams): Parsed<QueryOptions> {
  const o: QueryOptions = {};
  if (endpoint === "duels/factions" || endpoint === "duels/weapons") {
    const clean = params.get("clean");
    if (clean !== null && clean !== "") {
      if (clean !== "0" && clean !== "1") return { ok: false, param: "clean" };
      o.clean = clean === "1";
    }
    const outcomes = params.get("outcomes");
    if (outcomes !== null && outcomes !== "") {
      const list = outcomes.split(",");
      if (list.length > DUEL_OUTCOMES.length || list.some((x) => !MATRIX_OUTCOMES.has(x as DuelOutcome))) return { ok: false, param: "outcomes" };
      o.outcomes = [...new Set(list)] as DuelOutcome[];
    }
  }
  if (endpoint === "offers") {
    const kind = params.get("kind");
    if (kind !== null && kind !== "") {
      if (!OFFER_KINDS.has(kind as OfferKind)) return { ok: false, param: "kind" };
      o.kind = kind as OfferKind;
    }
  }
  if (endpoint === "camps") {
    const by = params.get("by");
    if (by !== null && by !== "") {
      if (by !== "faction" && by !== "weapon") return { ok: false, param: "by" };
      o.by = by;
    }
  }
  if (endpoint === "runs" || endpoint === "export") {
    const limit = intParam(params, "limit", 1, endpoint === "runs" ? RUNS_LIMIT_MAX : EXPORT_LIMIT_MAX);
    if (!limit.ok) return limit;
    if (limit.value !== undefined) o.limit = limit.value;
  }
  if (endpoint === "runs") {
    const before = intParam(params, "before", 0, 8.64e15);
    if (!before.ok) return before;
    if (before.value !== undefined) o.before = before.value;
  }
  if (endpoint === "export") {
    const cursor = params.get("cursor");
    if (cursor !== null && cursor !== "") {
      const c = decodeExportCursor(cursor);
      if (!c) return { ok: false, param: "cursor" };
      o.cursor = c;
    }
  }
  return { ok: true, value: o };
}

/** The export's cursor: "<ended_at>.<runId>" of the last record sent. */
export function encodeExportCursor(c: { endedAt: number; runId: string }): string {
  return `${c.endedAt}.${c.runId}`;
}

export function decodeExportCursor(s: string): { endedAt: number; runId: string } | null {
  const m = /^(\d{1,16})\.([0-9a-f-]{36})$/.exec(s);
  if (!m || !RUN_ID.test(m[2])) return null;
  const endedAt = Number(m[1]);
  return Number.isSafeInteger(endedAt) ? { endedAt, runId: m[2] } : null;
}
