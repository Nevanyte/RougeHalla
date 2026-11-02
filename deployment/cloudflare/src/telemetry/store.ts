// The telemetry summary store (docs/TELEMETRY.md 7.2 and 8.3): schema, idempotent ingest and one pure query per
// dashboard endpoint, over a tiny SQL interface so the Durable Object and a node:sqlite test run the same code.
// Every value is bound with `?`; the only identifiers in a query come from fixed tables in this file.
import {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_SNAPSHOT_MINUTES,
  wilson95,
  type CampRow,
  type DeathKind,
  type DeathRow,
  type DuelOutcome,
  type DuelSummaryRow,
  type FactionRow,
  type FarmingRow,
  type FirstBloodBin,
  type HeatmapResponse,
  type MatrixCell,
  type OfferKind,
  type OfferRow,
  type OverviewRow,
  type PerfRow,
  type RecordSource,
  type RunEnd,
  type RunListRow,
  type StatsEnvelope,
  type StatsMeta,
  type StatsQuery,
  type WeaponRow,
} from "@raid/shared/telemetry";
import { CHILD_TABLES, HEAT_GRID, type IngestRows, type Row } from "./rows";

export type SqlValue = string | number | null;
type FactionId = FactionRow["faction"];
type WeaponId = WeaponRow["weapon"];

export interface Sql {
  all(query: string, ...bind: SqlValue[]): Record<string, SqlValue>[];
  run(query: string, ...bind: SqlValue[]): void;
  tx<T>(fn: () => T): T;
  /** Rows the engine has read so far (the DO's cursor.rowsRead), when the adapter can tell. */
  rowsRead?(): number;
}

/** A query reading more rows than this carries a note (docs/TELEMETRY.md 7.2). */
export const ROWS_READ_NOTE = 200_000;
export const STORE_SCHEMA = "1";

const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY, v INTEGER NOT NULL, source TEXT NOT NULL, build TEXT NOT NULL, commit_sha TEXT,
    day TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL,
    end_reason TEXT NOT NULL, seed INTEGER NOT NULL, attempt INTEGER NOT NULL, map_hash INTEGER NOT NULL,
    humans INTEGER NOT NULL, bots INTEGER NOT NULL, winner_slot INTEGER NOT NULL, winner_faction TEXT,
    win_bonus_paid INTEGER NOT NULL, teleports INTEGER NOT NULL, first_teleport_ms INTEGER, first_blood_ms INTEGER,
    first_blood_victim_faction TEXT, duels INTEGER NOT NULL, truncated INTEGER NOT NULL, raw_key TEXT NOT NULL,
    received_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS runs_build_day ON runs(build, day)`,
  `CREATE INDEX IF NOT EXISTS runs_day ON runs(day)`,
  `CREATE INDEX IF NOT EXISTS runs_source_day ON runs(source, day)`,
  `CREATE INDEX IF NOT EXISTS runs_ended ON runs(ended_at)`,
  `CREATE TABLE IF NOT EXISTS players (
    run_id TEXT NOT NULL, slot INTEGER NOT NULL, pid TEXT, bot INTEGER NOT NULL, tier TEXT, persona TEXT,
    faction TEXT NOT NULL, spawn_zone TEXT NOT NULL, spawn_picked INTEGER NOT NULL, place INTEGER NOT NULL,
    outcome TEXT NOT NULL, won INTEGER NOT NULL, alive_ms INTEGER NOT NULL, death_kind TEXT, death_detail TEXT,
    death_ms INTEGER, death_zone TEXT, death_coliseum INTEGER, death_camp INTEGER, death_camp_type TEXT,
    kills INTEGER NOT NULL, bot_kills INTEGER NOT NULL, mob_kills INTEGER NOT NULL, elite_kills INTEGER NOT NULL,
    camps_cleared INTEGER NOT NULL, farm_ms INTEGER NOT NULL, main_weapon TEXT NOT NULL, card_power REAL NOT NULL,
    mob_stats_total REAL NOT NULL, boosts_total REAL NOT NULL, max_hp REAL NOT NULL, dmg_players REAL NOT NULL,
    dmg_mobs REAL NOT NULL, dmg_taken REAL NOT NULL, overkill REAL NOT NULL, healed REAL NOT NULL,
    wish_casts INTEGER NOT NULL, wish_landed INTEGER NOT NULL, potions INTEGER NOT NULL,
    quests_accepted INTEGER NOT NULL, quests_completed INTEGER NOT NULL, gv_total REAL NOT NULL,
    drops INTEGER NOT NULL, reconnects INTEGER NOT NULL, fps_p50 REAL, frame_p95 REAL, rtt_p50 REAL, rtt_p95 REAL,
    afk INTEGER NOT NULL, afk_ms INTEGER NOT NULL, quit INTEGER NOT NULL,
    PRIMARY KEY (run_id, slot)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS players_faction ON players(faction, bot)`,
  `CREATE INDEX IF NOT EXISTS players_weapon ON players(main_weapon, bot)`,
  `CREATE INDEX IF NOT EXISTS players_pid ON players(pid) WHERE pid IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS players_death ON players(death_kind, faction)`,
  `CREATE TABLE IF NOT EXISTS player_weapons (run_id TEXT NOT NULL, slot INTEGER NOT NULL, weapon TEXT NOT NULL,
    ms INTEGER NOT NULL, PRIMARY KEY (run_id, slot, weapon)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS player_weapons_w ON player_weapons(weapon)`,
  `CREATE TABLE IF NOT EXISTS player_zones (run_id TEXT NOT NULL, slot INTEGER NOT NULL, zone TEXT NOT NULL,
    ms INTEGER NOT NULL, PRIMARY KEY (run_id, slot, zone)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS player_cards (run_id TEXT NOT NULL, slot INTEGER NOT NULL, card TEXT NOT NULL,
    count INTEGER NOT NULL, PRIMARY KEY (run_id, slot, card)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS player_cards_card ON player_cards(card)`,
  `CREATE TABLE IF NOT EXISTS player_mobs (run_id TEXT NOT NULL, slot INTEGER NOT NULL, mob_type TEXT NOT NULL,
    kills INTEGER NOT NULL, PRIMARY KEY (run_id, slot, mob_type)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS player_amounts (run_id TEXT NOT NULL, slot INTEGER NOT NULL, dir TEXT NOT NULL,
    source TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (run_id, slot, dir, source)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS power_snaps (run_id TEXT NOT NULL, slot INTEGER NOT NULL, minute INTEGER NOT NULL,
    card_power REAL NOT NULL, mob_stats_total REAL NOT NULL, boosts_total REAL NOT NULL, max_hp REAL NOT NULL,
    ad REAL NOT NULL, ap REAL NOT NULL, armor REAL NOT NULL, shield REAL NOT NULL, as_mult REAL NOT NULL,
    speed_mult REAL NOT NULL, PRIMARY KEY (run_id, slot, minute)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS offers (run_id TEXT NOT NULL, i INTEGER NOT NULL, kind TEXT NOT NULL,
    at_ms INTEGER NOT NULL, camp INTEGER NOT NULL, elite INTEGER NOT NULL, options TEXT NOT NULL,
    PRIMARY KEY (run_id, i)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS offer_options (run_id TEXT NOT NULL, i INTEGER NOT NULL, slot INTEGER NOT NULL,
    pos INTEGER NOT NULL, kind TEXT NOT NULL, option TEXT NOT NULL, picked INTEGER NOT NULL, choice INTEGER NOT NULL,
    PRIMARY KEY (run_id, i, slot, pos)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS offer_options_opt ON offer_options(kind, option)`,
  `CREATE TABLE IF NOT EXISTS camp_clears (run_id TEXT NOT NULL, camp INTEGER NOT NULL, cycle INTEGER NOT NULL,
    zone TEXT NOT NULL, mob_type TEXT NOT NULL, elite_type TEXT NOT NULL, engaged_ms INTEGER NOT NULL,
    cleared_ms INTEGER NOT NULL, clear_ms INTEGER NOT NULL, killer_slot INTEGER NOT NULL, killer_faction TEXT,
    killer_weapon TEXT, killer_bot INTEGER, contributors INTEGER NOT NULL, player_deaths INTEGER NOT NULL,
    PRIMARY KEY (run_id, camp, cycle)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS camp_clears_type ON camp_clears(mob_type, killer_faction)`,
  `CREATE TABLE IF NOT EXISTS duels (run_id TEXT NOT NULL, i INTEGER NOT NULL, start_ms INTEGER NOT NULL,
    dur_ms INTEGER NOT NULL, a_slot INTEGER NOT NULL, b_slot INTEGER NOT NULL, bots INTEGER NOT NULL,
    a_faction TEXT NOT NULL, b_faction TEXT NOT NULL, a_weapon TEXT NOT NULL, b_weapon TEXT NOT NULL,
    a_power REAL NOT NULL, b_power REAL NOT NULL, a_stacks REAL NOT NULL, b_stacks REAL NOT NULL,
    a_hp REAL NOT NULL, b_hp REAL NOT NULL, a_hp_end REAL NOT NULL, b_hp_end REAL NOT NULL,
    a_dmg REAL NOT NULL, b_dmg REAL NOT NULL, a_wishes INTEGER NOT NULL, b_wishes INTEGER NOT NULL,
    first INTEGER NOT NULL, outcome TEXT NOT NULL, winner INTEGER NOT NULL, third INTEGER NOT NULL,
    clean INTEGER NOT NULL, zone TEXT NOT NULL, coliseum INTEGER NOT NULL, comeback INTEGER,
    PRIMARY KEY (run_id, i)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS duels_factions ON duels(a_faction, b_faction, outcome, clean)`,
  `CREATE INDEX IF NOT EXISTS duels_weapons ON duels(a_weapon, b_weapon, outcome, clean)`,
  `CREATE INDEX IF NOT EXISTS duels_bots ON duels(bots, outcome)`,
  `CREATE TABLE IF NOT EXISTS duel_cards (run_id TEXT NOT NULL, i INTEGER NOT NULL, side INTEGER NOT NULL,
    card TEXT NOT NULL, PRIMARY KEY (run_id, i, side, card)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS duel_cards_card ON duel_cards(card)`,
  // `source` is in the key (an addition to the 7.2 sketch) so the heatmap honours the source filter.
  `CREATE TABLE IF NOT EXISTS heat_cells (build TEXT NOT NULL, day TEXT NOT NULL, source TEXT NOT NULL,
    bot INTEGER NOT NULL, cx INTEGER NOT NULL, cy INTEGER NOT NULL, secs INTEGER NOT NULL,
    PRIMARY KEY (build, day, source, bot, cx, cy)) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS heat_cells_day ON heat_cells(day)`,
];

/** Column lists per table, the only identifiers an insert uses (a row's other keys are ignored). */
export const COLUMNS: Record<"runs" | (typeof CHILD_TABLES)[number] | "heat_cells", readonly string[]> = {
  runs: ["run_id", "v", "source", "build", "commit_sha", "day", "started_at", "ended_at", "duration_ms", "end_reason",
    "seed", "attempt", "map_hash", "humans", "bots", "winner_slot", "winner_faction", "win_bonus_paid", "teleports",
    "first_teleport_ms", "first_blood_ms", "first_blood_victim_faction", "duels", "truncated", "raw_key", "received_at"],
  players: ["run_id", "slot", "pid", "bot", "tier", "persona", "faction", "spawn_zone", "spawn_picked", "place", "outcome",
    "won", "alive_ms", "death_kind", "death_detail", "death_ms", "death_zone", "death_coliseum", "death_camp",
    "death_camp_type", "kills", "bot_kills", "mob_kills", "elite_kills", "camps_cleared", "farm_ms", "main_weapon",
    "card_power", "mob_stats_total", "boosts_total", "max_hp", "dmg_players", "dmg_mobs", "dmg_taken", "overkill",
    "healed", "wish_casts", "wish_landed", "potions", "quests_accepted", "quests_completed", "gv_total", "drops",
    "reconnects", "fps_p50", "frame_p95", "rtt_p50", "rtt_p95", "afk", "afk_ms", "quit"],
  player_weapons: ["run_id", "slot", "weapon", "ms"],
  player_zones: ["run_id", "slot", "zone", "ms"],
  player_cards: ["run_id", "slot", "card", "count"],
  player_mobs: ["run_id", "slot", "mob_type", "kills"],
  player_amounts: ["run_id", "slot", "dir", "source", "amount"],
  power_snaps: ["run_id", "slot", "minute", "card_power", "mob_stats_total", "boosts_total", "max_hp", "ad", "ap",
    "armor", "shield", "as_mult", "speed_mult"],
  offers: ["run_id", "i", "kind", "at_ms", "camp", "elite", "options"],
  offer_options: ["run_id", "i", "slot", "pos", "kind", "option", "picked", "choice"],
  camp_clears: ["run_id", "camp", "cycle", "zone", "mob_type", "elite_type", "engaged_ms", "cleared_ms", "clear_ms",
    "killer_slot", "killer_faction", "killer_weapon", "killer_bot", "contributors", "player_deaths"],
  duels: ["run_id", "i", "start_ms", "dur_ms", "a_slot", "b_slot", "bots", "a_faction", "b_faction", "a_weapon",
    "b_weapon", "a_power", "b_power", "a_stacks", "b_stacks", "a_hp", "b_hp", "a_hp_end", "b_hp_end", "a_dmg", "b_dmg",
    "a_wishes", "b_wishes", "first", "outcome", "winner", "third", "clean", "zone", "coliseum", "comeback"],
  duel_cards: ["run_id", "i", "side", "card"],
  heat_cells: ["build", "day", "source", "bot", "cx", "cy", "secs"],
};

const INSERT: Record<string, string> = {};
for (const [table, cols] of Object.entries(COLUMNS)) {
  INSERT[table] = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
}

function values(table: keyof typeof COLUMNS, row: Row): SqlValue[] {
  return COLUMNS[table].map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    return String(v);
  });
}

/** Creates the schema (idempotent). Called in the DO's constructor under blockConcurrencyWhile. */
export function migrate(sql: Sql): void {
  sql.tx(() => {
    for (const s of SCHEMA) sql.run(s);
    sql.run(`INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO NOTHING`, STORE_SCHEMA);
  });
}

export type IngestStatus = "accepted" | "duplicate";

/** One transaction per record, idempotent by run_id: a duplicate stops at the first statement. */
export function ingestRows(sql: Sql, rows: IngestRows): IngestStatus {
  return sql.tx(() => {
    const got = sql.all(`${INSERT.runs} ON CONFLICT(run_id) DO NOTHING RETURNING run_id`, ...values("runs", rows.run));
    if (got.length === 0) return "duplicate";
    for (const table of CHILD_TABLES) {
      for (const row of rows[table] ?? []) {
        if (row.run_id !== rows.runId) throw new Error(`row of ${table} names another run`);
        sql.run(INSERT[table], ...values(table, row));
      }
    }
    for (const row of rows.heat_cells ?? []) {
      sql.run(`${INSERT.heat_cells} ON CONFLICT(build, day, source, bot, cx, cy) DO UPDATE SET secs = secs + excluded.secs`, ...values("heat_cells", row));
    }
    return "accepted";
  });
}

/** Retention: deletes runs (and their children) and heat rows of days before `day` (yyyy-mm-dd). Returns runs removed. */
export function pruneBefore(sql: Sql, day: string): number {
  return sql.tx(() => {
    const n = Number(sql.all(`SELECT COUNT(*) AS n FROM runs WHERE day < ?`, day)[0]?.n ?? 0);
    for (const table of CHILD_TABLES) sql.run(`DELETE FROM ${table} WHERE run_id IN (SELECT run_id FROM runs WHERE day < ?)`, day);
    sql.run(`DELETE FROM runs WHERE day < ?`, day);
    sql.run(`DELETE FROM heat_cells WHERE day < ?`, day);
    return n;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Queries.

/** A parsed query: StatsQuery with its defaults resolved (query.ts) and `build: "any"` allowed. */
export interface ResolvedQuery extends StatsQuery {
  from: string;
  to: string;
}

export interface QueryOptions {
  clean?: boolean;
  outcomes?: DuelOutcome[];
  kind?: OfferKind;
  by?: "faction" | "weapon";
  limit?: number;
  /** runs: ended_at strictly before this epoch ms. */
  before?: number;
  /** export: the last (ended_at, run_id) of the previous page. */
  cursor?: { endedAt: number; runId: string };
}

export const QUERY_NAMES = [
  "meta", "overview", "factions", "weapons", "duelFactions", "duelWeapons", "duelSummary", "offers", "farming", "camps",
  "deaths", "firstblood", "heatmap", "runs", "perf", "exportPage",
] as const;
export type QueryName = (typeof QUERY_NAMES)[number];

interface Ctx {
  sql: Sql;
  q: ResolvedQuery;
  notes: string[];
  read: number;
}

function all(ctx: Ctx, query: string, bind: SqlValue[]): Record<string, SqlValue>[] {
  const rows = ctx.sql.all(query, ...bind);
  ctx.read += rows.length;
  return rows;
}

const n = (v: SqlValue | undefined): number => (typeof v === "number" ? v : v === null || v === undefined ? 0 : Number(v));
const round = (x: number, d = 3): number => {
  const m = 10 ** d;
  return Math.round(x * m) / m;
};

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The runs filter, on alias r: build, day range, source; with `runPool` the run-level pool (humans: a run with any human). */
function runWhere(q: ResolvedQuery, runPool: boolean): [string, SqlValue[]] {
  const w: string[] = ["r.day >= ?", "r.day <= ?"];
  const bind: SqlValue[] = [q.from, q.to];
  if (q.build && q.build !== "any") {
    w.push("r.build = ?");
    bind.push(q.build);
  }
  if (q.source) {
    w.push("r.source = ?");
    bind.push(q.source);
  }
  if (runPool && q.pool === "humans") w.push("r.humans > 0");
  if (runPool && q.pool === "bots") w.push("r.humans = 0");
  return [w.join(" AND "), bind];
}

/** Player rows (alias p): the pool, faction and main weapon. */
function playerWhere(q: ResolvedQuery, opts: { weapon?: boolean } = {}): [string, SqlValue[]] {
  const w: string[] = [];
  const bind: SqlValue[] = [];
  if (q.pool === "humans") w.push("p.bot = 0");
  if (q.pool === "bots") w.push("p.bot = 1");
  if (q.faction) {
    w.push("p.faction = ?");
    bind.push(q.faction);
  }
  if (q.weapon && opts.weapon !== false) {
    w.push("p.main_weapon = ?");
    bind.push(q.weapon);
  }
  return [w.length ? ` AND ${w.join(" AND ")}` : "", bind];
}

/**
 * Duels (alias d): humans = both sides human, bots = both bots, all = any. The unary `+` keeps SQLite (which has no
 * ANALYZE statistics here) from driving the join through duels_bots, which scanned every duel of the pool in the
 * table once per run in range; the duels are reached from the runs by their primary key instead.
 */
function duelPool(q: ResolvedQuery): string {
  if (q.pool === "humans") return " AND +d.bots = 0";
  if (q.pool === "bots") return " AND +d.bots = 2";
  return "";
}

/** Either side of a duel matches the faction and weapon filters (both on the same side). */
function duelEitherSide(q: ResolvedQuery): [string, SqlValue[]] {
  const side = (s: "a" | "b"): [string, SqlValue[]] => {
    const w: string[] = [];
    const bind: SqlValue[] = [];
    if (q.faction) {
      w.push(`d.${s}_faction = ?`);
      bind.push(q.faction);
    }
    if (q.weapon) {
      w.push(`d.${s}_weapon = ?`);
      bind.push(q.weapon);
    }
    return [w.join(" AND "), bind];
  };
  const [a, ab] = side("a");
  if (!a) return ["", []];
  const [b, bb] = side("b");
  return [` AND ((${a}) OR (${b}))`, [...ab, ...bb]];
}

const FINISHED = "r.end_reason IN ('winner', 'draw')";

function resolveBuild(sql: Sql, q: ResolvedQuery): ResolvedQuery {
  if (q.build !== undefined) return q;
  const w = ["day >= ?", "day <= ?"];
  const bind: SqlValue[] = [q.from, q.to];
  if (q.source) {
    w.push("source = ?");
    bind.push(q.source);
  }
  const row = sql.all(`SELECT build FROM runs WHERE ${w.join(" AND ")} ORDER BY ended_at DESC LIMIT 1`, ...bind)[0];
  return row && typeof row.build === "string" ? { ...q, build: row.build } : q;
}

function meta(sql: Sql): StatsMeta {
  const builds = sql.all(
    `SELECT build, MAX(commit_sha) AS commit_sha, MIN(day) AS first_day, MAX(day) AS last_day, COUNT(*) AS runs, MAX(ended_at) AS last
     FROM runs GROUP BY build ORDER BY last DESC LIMIT 100`,
  ).map((r) => ({
    build: String(r.build), commit: r.commit_sha === null ? null : String(r.commit_sha),
    firstDay: String(r.first_day), lastDay: String(r.last_day), runs: n(r.runs),
  }));
  const tot = sql.all(`SELECT MIN(day) AS f, MAX(day) AS l, COUNT(*) AS n FROM runs`)[0] ?? {};
  const seeds = sql.all(`SELECT seed, attempt, COUNT(*) AS runs FROM runs GROUP BY seed, attempt ORDER BY runs DESC, seed LIMIT 100`)
    .map((r) => ({ seed: n(r.seed), attempt: n(r.attempt), runs: n(r.runs) }));
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION, builds,
    firstDay: tot.f === null || tot.f === undefined ? null : String(tot.f),
    lastDay: tot.l === null || tot.l === undefined ? null : String(tot.l),
    runs: n(tot.n), seeds,
  };
}

function overview(ctx: Ctx): OverviewRow[] {
  const { q } = ctx;
  const [rw, rb] = runWhere(q, true);
  const runs = all(ctx, `SELECT r.duration_ms AS dur, r.first_blood_ms AS fb, r.end_reason AS e FROM runs r WHERE ${rw}`, rb);
  const [rwAll, rbAll] = runWhere(q, false);
  const [pw, pb] = playerWhere({ ...q, pool: "all" });
  const pl = all(ctx, `SELECT COUNT(*) AS n, SUM(p.bot = 0) AS h, SUM(p.bot = 1) AS b FROM players p JOIN runs r ON r.run_id = p.run_id WHERE ${rwAll}${pw}`, [...rbAll, ...pb])[0] ?? {};
  const [dw, db] = duelEitherSide(q);
  const duels = all(ctx, `SELECT COUNT(*) AS n FROM duels d JOIN runs r ON r.run_id = d.run_id WHERE ${rwAll}${duelPool(q)}${dw}`, [...rbAll, ...db])[0] ?? {};
  const humans = n(pl.h);
  const bots = n(pl.b);
  const fb = median(runs.filter((r) => r.fb !== null).map((r) => n(r.fb)));
  return [{
    runs: runs.length,
    players: q.pool === "humans" ? humans : q.pool === "bots" ? bots : n(pl.n),
    humans, bots, duels: n(duels.n),
    medianDurationS: round((median(runs.map((r) => n(r.dur))) ?? 0) / 1000, 1),
    medianFirstBloodS: fb === null ? null : round(fb / 1000, 1),
    voided: runs.filter((r) => r.e === "void" || r.e === "abandoned").length,
  }];
}

function factions(ctx: Ctx): FactionRow[] {
  const [rw, rb] = runWhere(ctx.q, false);
  const [pw, pb] = playerWhere(ctx.q);
  return all(ctx,
    `SELECT p.faction AS f, COUNT(*) AS n, SUM(p.won) AS k, AVG(p.place) AS place, AVG(p.kills + p.bot_kills) AS kills,
       AVG(p.mob_kills) AS mk, AVG(p.alive_ms) AS alive
     FROM players p JOIN runs r ON r.run_id = p.run_id WHERE ${rw} AND ${FINISHED}${pw} GROUP BY p.faction ORDER BY p.faction`,
    [...rb, ...pb],
  ).map((r) => ({
    faction: String(r.f) as FactionId, win: wilson95(n(r.k), n(r.n)), avgPlace: round(n(r.place), 2),
    avgKills: round(n(r.kills), 2), avgMobKills: round(n(r.mk), 2), avgAliveS: round(n(r.alive) / 1000, 1),
  }));
}

function weapons(ctx: Ctx): WeaponRow[] {
  const [rw, rb] = runWhere(ctx.q, false);
  const [pw, pb] = playerWhere(ctx.q);
  const win = all(ctx,
    `SELECT p.main_weapon AS w, COUNT(*) AS n, SUM(p.won) AS k FROM players p JOIN runs r ON r.run_id = p.run_id
     WHERE ${rw} AND ${FINISHED}${pw} GROUP BY p.main_weapon`, [...rb, ...pb]);
  const [pw2, pb2] = playerWhere(ctx.q, { weapon: false });
  const held = all(ctx,
    `SELECT w.weapon AS w, SUM(w.ms) AS ms FROM player_weapons w JOIN players p ON p.run_id = w.run_id AND p.slot = w.slot
     JOIN runs r ON r.run_id = w.run_id WHERE ${rw}${pw2} GROUP BY w.weapon`, [...rb, ...pb2]);
  const total = held.reduce((t, r) => t + n(r.ms), 0);
  const heldBy = new Map(held.map((r) => [String(r.w), n(r.ms)]));
  const winBy = new Map(win.map((r) => [String(r.w), r]));
  const ids = [...new Set([...winBy.keys(), ...(ctx.q.weapon ? [] : heldBy.keys())])].sort();
  return ids.map((w) => ({
    weapon: w as WeaponId,
    win: wilson95(n(winBy.get(w)?.k), n(winBy.get(w)?.n)),
    heldShare: total > 0 ? round((heldBy.get(w) ?? 0) / total, 4) : 0,
  }));
}

const DEFAULT_OUTCOMES: DuelOutcome[] = ["kill"];

function duelMatrix(ctx: Ctx, dim: "faction" | "weapon", opts: QueryOptions): MatrixCell[] {
  const { q } = ctx;
  const [rw, rb] = runWhere(q, false);
  const outcomes = opts.outcomes?.length ? opts.outcomes : DEFAULT_OUTCOMES;
  const clean = opts.clean === false ? "" : " AND d.clean = 1";
  const rows = all(ctx,
    `SELECT d.a_faction AS af, d.b_faction AS bf, d.a_weapon AS aw, d.b_weapon AS bw, d.winner AS w, d.dur_ms AS dur
     FROM duels d JOIN runs r ON r.run_id = d.run_id
     WHERE ${rw}${duelPool(q)}${clean} AND d.winner >= 0 AND d.outcome IN (${outcomes.map(() => "?").join(", ")})`,
    [...rb, ...outcomes],
  );
  const cells = new Map<string, { row: string; col: string; k: number; n: number; dur: number[] }>();
  const add = (rf: string, rwp: string, cf: string, cw: string, won: boolean, dur: number) => {
    if (q.faction && rf !== q.faction) return;
    if (q.weapon && rwp !== q.weapon) return;
    const row = dim === "faction" ? rf : rwp;
    const col = dim === "faction" ? cf : cw;
    const key = `${row}\u0000${col}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { row, col, k: 0, n: 0, dur: [] }));
    c.n++;
    if (won) c.k++;
    c.dur.push(dur);
  };
  for (const r of rows) {
    const dur = n(r.dur);
    add(String(r.af), String(r.aw), String(r.bf), String(r.bw), n(r.w) === 0, dur);
    add(String(r.bf), String(r.bw), String(r.af), String(r.aw), n(r.w) === 1, dur);
  }
  return [...cells.values()]
    .sort((a, b) => (a.row < b.row ? -1 : a.row > b.row ? 1 : a.col < b.col ? -1 : a.col > b.col ? 1 : 0))
    .map((c) => ({ row: c.row, col: c.col, win: wilson95(c.k, c.n), medianDurationS: round((median(c.dur) ?? 0) / 1000, 1) }));
}

function duelSummary(ctx: Ctx): DuelSummaryRow[] {
  const { q } = ctx;
  const [rw, rb] = runWhere(q, false);
  const [dw, db] = duelEitherSide(q);
  const rows = all(ctx,
    `SELECT d.outcome AS o, d.winner AS w, d.first AS f, d.clean AS c, d.comeback AS cb, d.dur_ms AS dur
     FROM duels d JOIN runs r ON r.run_id = d.run_id WHERE ${rw}${duelPool(q)}${dw}`, [...rb, ...db]);
  const outcomes: Partial<Record<DuelOutcome, number>> = {};
  let clean = 0, dis = 0, third = 0, cbN = 0, cbK = 0, fsN = 0, fsK = 0;
  for (const r of rows) {
    const o = String(r.o) as DuelOutcome;
    outcomes[o] = (outcomes[o] ?? 0) + 1;
    if (n(r.c) === 1) clean++;
    if (o === "disengage") dis++;
    if (o === "thirdParty") third++;
    if (r.cb !== null && r.cb !== undefined) {
      cbN++;
      if (n(r.cb) === 1) cbK++;
    }
    if (n(r.w) >= 0 && n(r.f) < 2) {
      fsN++;
      if (n(r.f) === n(r.w)) fsK++;
    }
  }
  const total = rows.length;
  return [{
    n: total, outcomes, clean: wilson95(clean, total), disengage: wilson95(dis, total), thirdParty: wilson95(third, total),
    comeback: wilson95(cbK, cbN), firstStrikerWins: wilson95(fsK, fsN),
    medianDurationS: round((median(rows.map((r) => n(r.dur))) ?? 0) / 1000, 1),
  }];
}

function offers(ctx: Ctx, opts: QueryOptions): OfferRow[] {
  const { q } = ctx;
  const kind: OfferKind = opts.kind ?? "augment";
  const [rw, rb] = runWhere(q, false);
  const [pw, pb] = playerWhere(q);
  const rows = all(ctx,
    `SELECT o.option AS opt, COUNT(*) AS n, SUM(o.picked) AS k,
       SUM(o.picked * (${FINISHED})) AS pn, SUM(o.picked * p.won * (${FINISHED})) AS pk,
       SUM((1 - o.picked) * (${FINISHED})) AS nn, SUM((1 - o.picked) * p.won * (${FINISHED})) AS nk
     FROM offer_options o JOIN players p ON p.run_id = o.run_id AND p.slot = o.slot JOIN runs r ON r.run_id = o.run_id
     WHERE ${rw}${pw} AND +o.kind = ? GROUP BY o.option`, // `+`: drive from the runs in range, not offer_options_opt
    [...rb, ...pb, kind],
  );
  const duelWin = new Map<string, { n: number; k: number }>();
  if (kind === "augment") {
    const w: string[] = [];
    const bind: SqlValue[] = [];
    if (q.faction) {
      w.push("(CASE c.side WHEN 0 THEN d.a_faction ELSE d.b_faction END) = ?");
      bind.push(q.faction);
    }
    if (q.weapon) {
      w.push("(CASE c.side WHEN 0 THEN d.a_weapon ELSE d.b_weapon END) = ?");
      bind.push(q.weapon);
    }
    for (const r of all(ctx,
      `SELECT c.card AS card, COUNT(*) AS n, SUM(d.winner = c.side) AS k
       FROM duel_cards c JOIN duels d ON d.run_id = c.run_id AND d.i = c.i JOIN runs r ON r.run_id = c.run_id
       WHERE ${rw}${duelPool(q)} AND d.outcome = 'kill' AND d.clean = 1${w.map((x) => ` AND ${x}`).join("")}
       GROUP BY c.card`, [...rb, ...bind])) {
      duelWin.set(String(r.card), { n: n(r.n), k: n(r.k) });
    }
  }
  return rows
    .map((r): OfferRow => {
      const row: OfferRow = {
        kind, option: String(r.opt), offered: n(r.n), pick: wilson95(n(r.k), n(r.n)),
        winPicked: wilson95(n(r.pk), n(r.pn)), winNotPicked: wilson95(n(r.nk), n(r.nn)),
      };
      if (kind === "augment") {
        const d = duelWin.get(row.option);
        row.duelWin = wilson95(d?.k ?? 0, d?.n ?? 0);
      }
      return row;
    })
    .sort((a, b) => b.offered - a.offered || (a.option < b.option ? -1 : 1));
}

function farming(ctx: Ctx): FarmingRow[] {
  const [rw, rb] = runWhere(ctx.q, false);
  const [pw, pb] = playerWhere(ctx.q);
  const base = all(ctx,
    `SELECT p.faction AS f, COUNT(*) AS n, AVG(p.mob_kills) AS mk, AVG(p.elite_kills) AS ek, AVG(p.farm_ms) AS fm
     FROM players p JOIN runs r ON r.run_id = p.run_id WHERE ${rw}${pw} GROUP BY p.faction ORDER BY p.faction`, [...rb, ...pb]);
  const snaps = all(ctx,
    `SELECT p.faction AS f, s.minute AS m, AVG(s.card_power) AS cp, AVG(s.mob_stats_total) AS ms
     FROM power_snaps s JOIN players p ON p.run_id = s.run_id AND p.slot = s.slot JOIN runs r ON r.run_id = s.run_id
     WHERE ${rw}${pw} GROUP BY p.faction, s.minute`, [...rb, ...pb]);
  const at = new Map<string, { cp: number; ms: number }>();
  for (const s of snaps) at.set(`${s.f}:${n(s.m)}`, { cp: n(s.cp), ms: n(s.ms) });
  return base.map((r) => {
    const f = String(r.f);
    return {
      faction: f as FactionId, players: n(r.n), avgMobKills: round(n(r.mk), 2), avgEliteKills: round(n(r.ek), 2),
      avgFarmS: round(n(r.fm) / 1000, 1),
      powerAt: TELEMETRY_SNAPSHOT_MINUTES.map((m) => {
        const v = at.get(`${f}:${m}`);
        return v ? round(v.cp, 2) : null;
      }),
      mobStatsAt: TELEMETRY_SNAPSHOT_MINUTES.map((m) => {
        const v = at.get(`${f}:${m}`);
        return v ? round(v.ms, 2) : null;
      }),
    };
  });
}

function camps(ctx: Ctx, opts: QueryOptions): CampRow[] {
  const { q } = ctx;
  const by = opts.by === "weapon" ? "weapon" : "faction";
  const col = by === "weapon" ? "c.killer_weapon" : "c.killer_faction";
  const [rw, rb] = runWhere(q, false);
  const w: string[] = [];
  const bind: SqlValue[] = [];
  if (q.pool === "humans") w.push("c.killer_bot = 0");
  if (q.pool === "bots") w.push("c.killer_bot = 1");
  if (q.faction) {
    w.push("c.killer_faction = ?");
    bind.push(q.faction);
  }
  if (q.weapon) {
    w.push("c.killer_weapon = ?");
    bind.push(q.weapon);
  }
  const rows = all(ctx,
    `SELECT c.mob_type AS t, c.elite_type AS e, ${col} AS g, c.clear_ms AS ms, c.player_deaths AS pd
     FROM camp_clears c JOIN runs r ON r.run_id = c.run_id WHERE ${rw}${w.map((x) => ` AND ${x}`).join("")}`, [...rb, ...bind]);
  const groups = new Map<string, { t: string; e: string; g: string | null; ms: number[]; pd: number }>();
  for (const r of rows) {
    const g = r.g === null ? null : String(r.g);
    const key = `${r.t}\u0000${r.e}\u0000${g ?? ""}`;
    let x = groups.get(key);
    if (!x) groups.set(key, (x = { t: String(r.t), e: String(r.e), g, ms: [], pd: 0 }));
    x.ms.push(n(r.ms));
    x.pd += n(r.pd);
  }
  return [...groups.values()]
    .sort((a, b) => b.ms.length - a.ms.length || (a.t < b.t ? -1 : 1))
    .map((x) => ({
      type: x.t, elite: x.e,
      faction: by === "faction" ? (x.g as FactionId | null) : null,
      weapon: by === "weapon" ? (x.g as WeaponId | null) : null,
      clears: x.ms.length, medianClearS: round((median(x.ms) ?? 0) / 1000, 1), playerDeaths: x.pd,
    }));
}

/** `share` is the row's share of its victim faction's deaths (each faction's bar sums to 1). */
function deaths(ctx: Ctx): DeathRow[] {
  const [rw, rb] = runWhere(ctx.q, false);
  const [pw, pb] = playerWhere(ctx.q);
  const rows = all(ctx,
    `SELECT p.death_kind AS k, p.faction AS f, COALESCE(p.death_detail, '') AS d, COUNT(*) AS n
     FROM players p JOIN runs r ON r.run_id = p.run_id WHERE ${rw}${pw} AND p.death_kind IS NOT NULL
     GROUP BY p.death_kind, p.faction, COALESCE(p.death_detail, '') ORDER BY p.faction, n DESC`, [...rb, ...pb]);
  const byFaction = new Map<string, number>();
  for (const r of rows) byFaction.set(String(r.f), (byFaction.get(String(r.f)) ?? 0) + n(r.n));
  return rows.map((r) => ({
    kind: String(r.k) as DeathKind, faction: String(r.f) as FactionId, detail: String(r.d), n: n(r.n),
    share: round(n(r.n) / (byFaction.get(String(r.f)) || 1), 4),
  }));
}

export const FIRST_BLOOD_BIN_S = 15;
export const FIRST_BLOOD_LAST_S = 300;
/** The last bin is [300 s, this): every later first blood is counted in it. */
export const FIRST_BLOOD_OPEN_END_S = 3600;

function firstblood(ctx: Ctx): FirstBloodBin[] {
  const [rw, rb] = runWhere(ctx.q, true);
  const bins: FirstBloodBin[] = [];
  for (let s = 0; s < FIRST_BLOOD_LAST_S; s += FIRST_BLOOD_BIN_S) bins.push({ fromS: s, toS: s + FIRST_BLOOD_BIN_S, n: 0 });
  bins.push({ fromS: FIRST_BLOOD_LAST_S, toS: FIRST_BLOOD_OPEN_END_S, n: 0 });
  for (const r of all(ctx, `SELECT r.first_blood_ms AS ms FROM runs r WHERE ${rw} AND r.first_blood_ms IS NOT NULL`, rb)) {
    const s = Math.max(0, n(r.ms) / 1000);
    bins[Math.min(bins.length - 1, Math.floor(s / FIRST_BLOOD_BIN_S))].n++;
  }
  return bins;
}

function heatmap(ctx: Ctx, now: number): HeatmapResponse {
  const { q } = ctx;
  const w = ["h.day >= ?", "h.day <= ?"];
  const bind: SqlValue[] = [q.from, q.to];
  if (q.build && q.build !== "any") {
    w.push("h.build = ?");
    bind.push(q.build);
  }
  if (q.source) {
    w.push("h.source = ?");
    bind.push(q.source);
  }
  if (q.pool === "humans") w.push("h.bot = 0");
  if (q.pool === "bots") w.push("h.bot = 1");
  const cells = all(ctx, `SELECT h.cx AS x, h.cy AS y, SUM(h.secs) AS s FROM heat_cells h WHERE ${w.join(" AND ")} GROUP BY h.cx, h.cy ORDER BY h.cy, h.cx`, bind)
    .map((r): [number, number, number] => [n(r.x), n(r.y), n(r.s)])
    .filter((c) => c[2] > 0);
  const [rw, rb] = runWhere(q, true);
  const runs = n(all(ctx, `SELECT COUNT(*) AS n FROM runs r WHERE ${rw}`, rb)[0]?.n);
  return { query: q, w: HEAT_GRID, h: HEAT_GRID, cells, runs, generatedAt: now };
}

export const RUNS_LIMIT_MAX = 100;
export const EXPORT_LIMIT_MAX = 500;

function runList(ctx: Ctx, opts: QueryOptions): RunListRow[] {
  const [rw, rb] = runWhere(ctx.q, true);
  const limit = Math.max(1, Math.min(RUNS_LIMIT_MAX, Math.floor(opts.limit ?? 50)));
  const before = opts.before !== undefined ? " AND r.ended_at < ?" : "";
  const bind = opts.before !== undefined ? [...rb, opts.before] : rb;
  return all(ctx,
    `SELECT r.run_id AS id, r.build AS b, r.ended_at AS e, r.duration_ms AS d, r.humans AS h, r.bots AS bo,
       r.end_reason AS er, r.winner_faction AS wf, r.source AS s
     FROM runs r WHERE ${rw}${before} ORDER BY r.ended_at DESC, r.run_id DESC LIMIT ?`, [...bind, limit],
  ).map((r) => ({
    runId: String(r.id), build: String(r.b), endedAtEpoch: n(r.e), durationS: round(n(r.d) / 1000, 1), humans: n(r.h),
    bots: n(r.bo), end: String(r.er) as RunEnd, winnerFaction: r.wf === null ? null : (String(r.wf) as FactionId),
    source: String(r.s) as RecordSource,
  }));
}

function perf(ctx: Ctx): PerfRow[] {
  const [rw, rb] = runWhere(ctx.q, false);
  const [pw, pb] = playerWhere(ctx.q);
  const rows = all(ctx,
    `SELECT p.fps_p50 AS fps, p.frame_p95 AS fr, p.rtt_p50 AS r50, p.rtt_p95 AS r95
     FROM players p JOIN runs r ON r.run_id = p.run_id
     WHERE ${rw}${pw} AND (p.fps_p50 IS NOT NULL OR p.frame_p95 IS NOT NULL OR p.rtt_p50 IS NOT NULL OR p.rtt_p95 IS NOT NULL)`,
    [...rb, ...pb]);
  const agg = all(ctx,
    `SELECT COUNT(*) AS n, COUNT(DISTINCT p.run_id) AS runs, SUM(p.reconnects) AS rc, SUM(p.afk) AS afk, SUM(p.quit) AS quit
     FROM players p JOIN runs r ON r.run_id = p.run_id WHERE ${rw}${pw}`, [...rb, ...pb])[0] ?? {};
  const med = (key: string) => {
    const m = median(rows.filter((r) => r[key] !== null).map((r) => n(r[key])));
    return m === null ? null : round(m, 1);
  };
  return [{
    samples: rows.length, fpsP50: med("fps"), frameMsP95: med("fr"), rttP50: med("r50"), rttP95: med("r95"),
    reconnectsPerRun: n(agg.runs) > 0 ? round(n(agg.rc) / n(agg.runs), 3) : 0,
    afk: wilson95(n(agg.afk), n(agg.n)), quit: wilson95(n(agg.quit), n(agg.n)),
  }];
}

export interface ExportPage {
  keys: string[];
  next: { endedAt: number; runId: string } | null;
}

function exportPage(ctx: Ctx, opts: QueryOptions): ExportPage {
  const [rw, rb] = runWhere(ctx.q, true);
  const limit = Math.max(1, Math.min(EXPORT_LIMIT_MAX, Math.floor(opts.limit ?? 100)));
  const c = opts.cursor;
  const after = c ? " AND (r.ended_at < ? OR (r.ended_at = ? AND r.run_id < ?))" : "";
  const bind = c ? [...rb, c.endedAt, c.endedAt, c.runId] : rb;
  const rows = all(ctx, `SELECT r.raw_key AS k, r.ended_at AS e, r.run_id AS id FROM runs r WHERE ${rw}${after}
    ORDER BY r.ended_at DESC, r.run_id DESC LIMIT ?`, [...bind, limit + 1]);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    keys: page.map((r) => String(r.k)),
    next: rows.length > limit && last ? { endedAt: n(last.e), runId: String(last.id) } : null,
  };
}

/**
 * Answers of the query RPC, kept until the data changes. The data changes only when a run is ingested or the retention
 * alarm prunes, so the DO clears this then; a dashboard's 60 s refresh of an unchanged window costs no SQL. The key
 * is the whole request (the resolved query carries its days, so a new day is a new key); an answer keeps the
 * `generatedAt` of when it was computed. The export is not kept (its pages are large and read once).
 */
export class QueryCache {
  private readonly answers = new Map<string, unknown>();
  constructor(private readonly max = 128) {}

  get(name: QueryName, q: ResolvedQuery, opts: QueryOptions, compute: () => unknown): unknown {
    if (name === "exportPage") return compute();
    const key = JSON.stringify([name, q, opts]);
    if (this.answers.has(key)) return this.answers.get(key);
    const answer = compute();
    if (this.answers.size >= this.max) this.answers.delete(this.answers.keys().next().value as string);
    this.answers.set(key, answer);
    return answer;
  }

  clear(): void {
    this.answers.clear();
  }

  get size(): number {
    return this.answers.size;
  }
}

export function runKey(sql: Sql, runId: string): string | null {
  const row = sql.all(`SELECT raw_key FROM runs WHERE run_id = ?`, runId)[0];
  return row && typeof row.raw_key === "string" ? row.raw_key : null;
}

/**
 * The one entry point of the DO's `query` RPC. `name` must be one of QUERY_NAMES (anything else throws, which the
 * route never sends). Envelope-shaped answers echo the resolved query (the default build filled in).
 */
export function runQuery(sql: Sql, name: QueryName, query: ResolvedQuery, opts: QueryOptions = {}, now = Date.now()): unknown {
  if (name === "meta") return meta(sql);
  const q = resolveBuild(sql, query);
  const ctx: Ctx = { sql, q, notes: [], read: 0 };
  const before = sql.rowsRead?.() ?? 0;
  const env = <T>(rows: T[]): StatsEnvelope<T> => {
    const read = sql.rowsRead ? sql.rowsRead() - before : ctx.read;
    if (read > ROWS_READ_NOTE) ctx.notes.push(`This view read ${read} rows; narrow the dates or the build for a faster answer.`);
    const out: StatsEnvelope<T> = { query: q, generatedAt: now, rows };
    if (ctx.notes.length) out.notes = ctx.notes;
    return out;
  };
  switch (name) {
    case "overview": return env(overview(ctx));
    case "factions": return env(factions(ctx));
    case "weapons": return env(weapons(ctx));
    case "duelFactions": return env(duelMatrix(ctx, "faction", opts));
    case "duelWeapons": return env(duelMatrix(ctx, "weapon", opts));
    case "duelSummary": return env(duelSummary(ctx));
    case "offers": {
      const e = env(offers(ctx, opts));
      if (opts.kind === "stat") (e.notes ??= []).push("A crate's stat chest is offered to the players in range at the drop; anyone who picked from it counts as offered too.");
      return e;
    }
    case "farming": return env(farming(ctx));
    case "camps": return env(camps(ctx, opts));
    case "deaths": return env(deaths(ctx));
    case "firstblood": return env(firstblood(ctx));
    case "heatmap": return heatmap(ctx, now);
    case "runs": return env(runList(ctx, opts));
    case "perf": return env(perf(ctx));
    case "exportPage": return exportPage(ctx, opts);
    default: {
      const never: never = name;
      throw new Error(`unknown query ${String(never)}`);
    }
  }
}
