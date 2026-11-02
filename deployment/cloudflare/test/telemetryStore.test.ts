import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRunRecord, wilson95, type RunRecord, type StatsEnvelope } from "@raid/shared/telemetry";
import { parseOptions, parseStatsQuery } from "../src/telemetry/query";
import { toRows } from "../src/telemetry/rows";
import { QUERY_NAMES, QueryCache, ingestRows, migrate, pruneBefore, runKey, runQuery, type QueryName, type ResolvedQuery, type Sql } from "../src/telemetry/store";
import { B0, B1, DAY1, EXAMPLE_RUN, count, miniSet, nodeSql } from "./telemetryHelpers";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../testing/telemetry/fixtures/runs-v1.ndjson");
const NOW = DAY1 + 3_600_000;

function loaded() {
  const sql = nodeSql();
  migrate(sql);
  for (const r of miniSet()) expect(ingestRows(sql, toRows(r))).toBe("accepted");
  return sql;
}

function q(params: Record<string, string> = {}): ResolvedQuery {
  const parsed = parseStatsQuery(new URLSearchParams(params), NOW);
  if (!parsed.ok) throw new Error(`bad ${parsed.param}`);
  return parsed.value;
}

function rows<T>(sql: ReturnType<typeof nodeSql>, name: QueryName, params: Record<string, string> = {}, endpoint = ""): T[] {
  const opts = parseOptions(endpoint, new URLSearchParams(params));
  if (!opts.ok) throw new Error(`bad ${opts.param}`);
  return (runQuery(sql, name, q(params), opts.value, NOW) as StatsEnvelope<T>).rows;
}

describe("telemetry store: ingest", () => {
  it("migrates idempotently and ingests the example once (a duplicate touches nothing)", () => {
    const sql = nodeSql();
    migrate(sql);
    migrate(sql);
    expect(ingestRows(sql, toRows(EXAMPLE_RUN))).toBe("accepted");
    const tables = ["runs", "players", "player_weapons", "player_cards", "offers", "offer_options", "camp_clears", "duels", "duel_cards", "heat_cells"];
    const before = Object.fromEntries(tables.map((t) => [t, count(sql, t)]));
    const heat = sql.all("SELECT SUM(secs) AS s FROM heat_cells")[0].s;
    expect(before.runs).toBe(1);
    expect(before.players).toBe(2);
    expect(before.duels).toBe(1);
    expect(heat).toBe(3);
    expect(ingestRows(sql, toRows(EXAMPLE_RUN))).toBe("duplicate");
    expect(Object.fromEntries(tables.map((t) => [t, count(sql, t)]))).toEqual(before);
    expect(sql.all("SELECT SUM(secs) AS s FROM heat_cells")[0].s).toBe(3);
    expect(runKey(sql, EXAMPLE_RUN.runId)).toMatch(/^telemetry\/v1\/build=a1b2c3d4e5f60718\/date=2026-11-02\/3f2b8c1e/);
  });

  it("rolls back a record whose rows fail midway", () => {
    const sql = nodeSql();
    migrate(sql);
    const r = toRows(EXAMPLE_RUN);
    r.players.push({ ...r.players[0] }); // duplicate primary key
    expect(() => ingestRows(sql, r)).toThrow();
    expect(count(sql, "runs")).toBe(0);
    expect(count(sql, "players")).toBe(0);
    expect(ingestRows(sql, toRows(EXAMPLE_RUN))).toBe("accepted");
  });

  it("ingests the generated fixture when it exists, else variations of the example", () => {
    const sql = nodeSql();
    migrate(sql);
    let records: RunRecord[];
    if (fs.existsSync(FIXTURE)) {
      records = fs.readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunRecord);
    } else {
      records = Array.from({ length: 30 }, (_, i) => ({
        ...structuredClone(EXAMPLE_RUN), runId: `3f2b8c1e-5d4a-4b6f-9c2e-${String(i).padStart(12, "0")}`,
        endedAtEpoch: EXAMPLE_RUN.endedAtEpoch + i * 3_600_000,
      }));
    }
    for (const r of records) {
      expect(validateRunRecord(r)).toBeNull();
      expect(ingestRows(sql, toRows(r))).toBe("accepted");
    }
    expect(count(sql, "runs")).toBe(records.length);
    for (const r of records) expect(ingestRows(sql, toRows(r))).toBe("duplicate");
    const all = { build: "any", source: "any", pool: "all", from: "2020-01-01", to: "2030-12-31" };
    for (const name of ["overview", "factions", "weapons", "duelFactions", "duelWeapons", "duelSummary", "offers", "farming", "camps", "deaths", "firstblood", "heatmap", "runs", "perf"] as QueryName[]) {
      expect(() => runQuery(sql, name, q(all), {}, NOW)).not.toThrow();
    }
  });

  it("prunes old runs with their children and heat rows", () => {
    const sql = loaded();
    const removed = pruneBefore(sql, "2026-11-02");
    expect(removed).toBe(2); // runs 2 and 4 ended on 2026-11-01
    expect(count(sql, "runs")).toBe(3);
    expect(Number(sql.all("SELECT COUNT(*) AS n FROM players WHERE run_id NOT IN (SELECT run_id FROM runs)")[0].n)).toBe(0);
    expect(Number(sql.all("SELECT COUNT(*) AS n FROM duels WHERE run_id NOT IN (SELECT run_id FROM runs)")[0].n)).toBe(0);
    expect(Number(sql.all("SELECT COUNT(*) AS n FROM heat_cells WHERE day < '2026-11-02'")[0].n)).toBe(0);
  });
});

describe("telemetry store: hand-checked queries", () => {
  it("defaults to the newest build, live source and humans", () => {
    const sql = loaded();
    const env = runQuery(sql, "overview", q(), {}, NOW) as StatsEnvelope<{ runs: number; players: number; humans: number; bots: number; duels: number; medianDurationS: number; medianFirstBloodS: number; voided: number }>;
    expect(env.query.build).toBe(B1);
    expect(env.query.source).toBe("live");
    expect(env.query.pool).toBe("humans");
    expect(env.query.from).toBe("2026-10-20");
    expect(env.query.to).toBe("2026-11-02");
    expect(env.generatedAt).toBe(NOW);
    expect(env.rows).toEqual([{ runs: 2, players: 4, humans: 4, bots: 2, duels: 3, medianDurationS: 270, medianFirstBloodS: 165, voided: 0 }]);
  });

  it("faction win rates per pool, build and source", () => {
    const sql = loaded();
    const f = rows<{ faction: string; win: { n: number; k: number }; avgPlace: number }>(sql, "factions");
    expect(f.map((r) => [r.faction, r.win.k, r.win.n, r.avgPlace])).toEqual([["fire", 1, 2, 1.5], ["frost", 1, 2, 1.5]]);
    expect(f[0].win).toEqual(wilson95(1, 2));
    const bots = rows<{ faction: string; win: { n: number; k: number } }>(sql, "factions", { pool: "bots" });
    expect(bots.map((r) => [r.faction, r.win.k, r.win.n])).toEqual([["holy", 0, 1], ["plague", 1, 1]]);
    const old = rows<{ faction: string; win: { k: number } }>(sql, "factions", { build: B0 });
    expect(old.map((r) => [r.faction, r.win.k])).toEqual([["holy", 0], ["sentenced", 1]]);
    const anySource = rows<{ faction: string; win: { n: number } }>(sql, "factions", { source: "any" });
    expect(anySource.map((r) => r.faction)).toEqual(["fire", "frost", "holy", "sentenced"]);
    expect(rows(sql, "factions", { faction: "fire" }).length).toBe(1);
    expect(rows(sql, "factions", { from: "2026-11-02" }).length).toBe(2); // run 1 only: fire lost, frost won
  });

  it("weapon win rate and held share", () => {
    const sql = loaded();
    const w = rows<{ weapon: string; win: { n: number; k: number }; heldShare: number }>(sql, "weapons");
    // held: axe 30+20, fists 10, sword 40+50 = 150 s.
    expect(w.map((r) => [r.weapon, r.win.k, r.win.n, r.heldShare])).toEqual([
      ["axe", 1, 2, 0.3333], ["fists", 0, 0, 0.0667], ["sword", 1, 2, 0.6],
    ]);
  });

  it("duel matrices from both orientations, clean kills by default", () => {
    const sql = loaded();
    const m = rows<{ row: string; col: string; win: { n: number; k: number }; medianDurationS: number }>(sql, "duelFactions", {}, "duels/factions");
    expect(m.map((c) => [c.row, c.col, c.win.k, c.win.n, c.medianDurationS])).toEqual([["fire", "frost", 0, 1, 10], ["frost", "fire", 1, 1, 10]]);
    const all = rows<{ row: string; col: string; win: { n: number; k: number } }>(sql, "duelFactions", { clean: "0" }, "duels/factions");
    expect(all.map((c) => [c.row, c.col, c.win.k, c.win.n])).toEqual([["fire", "frost", 1, 2], ["frost", "fire", 1, 2]]);
    const weapons = rows<{ row: string; col: string; win: { k: number; n: number } }>(sql, "duelWeapons", {}, "duels/weapons");
    expect(weapons.map((c) => [c.row, c.col, c.win.k, c.win.n])).toEqual([["axe", "sword", 1, 1], ["sword", "axe", 0, 1]]);
    const narrowed = rows<{ row: string }>(sql, "duelFactions", { faction: "frost" }, "duels/factions");
    expect(narrowed.map((c) => c.row)).toEqual(["frost"]);
    const bots = rows<{ row: string; win: { k: number } }>(sql, "duelFactions", { pool: "bots" }, "duels/factions");
    expect(bots.map((c) => [c.row, c.win.k])).toEqual([["holy", 0], ["plague", 1]]);
  });

  it("duel summary", () => {
    const sql = loaded();
    const [s] = rows<{ n: number; outcomes: Record<string, number>; clean: { k: number }; disengage: { k: number; n: number }; comeback: { k: number; n: number }; firstStrikerWins: { k: number; n: number }; medianDurationS: number }>(sql, "duelSummary");
    expect(s.n).toBe(3);
    expect(s.outcomes).toEqual({ kill: 2, disengage: 1 });
    expect(s.clean.k).toBe(2);
    expect([s.disengage.k, s.disengage.n]).toEqual([1, 3]);
    expect([s.comeback.k, s.comeback.n]).toEqual([1, 1]);
    expect([s.firstStrikerWins.k, s.firstStrikerWins.n]).toEqual([1, 2]);
    expect(s.medianDurationS).toBe(10);
  });

  it("offers: pick rate, picked vs offered-not-picked, duel win", () => {
    const sql = loaded();
    const o = rows<{ option: string; offered: number; pick: { k: number; n: number }; winPicked: { k: number; n: number }; winNotPicked: { k: number; n: number }; duelWin: { k: number; n: number } }>(sql, "offers", {}, "offers");
    const by = Object.fromEntries(o.map((r) => [r.option, r]));
    expect(by.quickdraw.offered).toBe(4);
    expect([by.quickdraw.pick.k, by.quickdraw.pick.n]).toEqual([2, 4]);
    expect([by.quickdraw.winPicked.k, by.quickdraw.winPicked.n]).toEqual([1, 2]);
    expect([by.quickdraw.winNotPicked.k, by.quickdraw.winNotPicked.n]).toEqual([1, 2]);
    expect([by.quickdraw.duelWin.k, by.quickdraw.duelWin.n]).toEqual([1, 1]);
    expect([by.ad2.pick.k, by.ad2.winNotPicked.k, by.ad2.winNotPicked.n]).toEqual([0, 2, 4]);
    expect(by.glassCannon.offered).toBe(2);
    expect(rows(sql, "offers", { kind: "trophy" }, "offers")).toEqual([]);
  });

  it("farming, camps, deaths, first blood, heat, runs and perf", () => {
    const sql = loaded();
    const farm = rows<{ faction: string; avgMobKills: number; powerAt: (number | null)[] }>(sql, "farming");
    expect(farm.find((r) => r.faction === "frost")).toMatchObject({ avgMobKills: 2, powerAt: [2, null, null, null] });
    expect(farm.find((r) => r.faction === "fire")?.powerAt).toEqual([4, null, null, null]);
    const camps = rows<{ type: string; faction: string; clears: number; medianClearS: number }>(sql, "camps", {}, "camps");
    expect(camps).toEqual([{ type: "frostGrunt", elite: "", faction: "frost", weapon: null, clears: 1, medianClearS: 20, playerDeaths: 0 }]);
    const byWeapon = rows<{ weapon: string; faction: null }>(sql, "camps", { by: "weapon" }, "camps");
    expect(byWeapon.map((r) => [r.weapon, r.faction])).toEqual([["axe", null]]);
    const deaths = rows<{ kind: string; faction: string; detail: string; n: number; share: number }>(sql, "deaths");
    expect(deaths).toEqual([
      { kind: "player", faction: "fire", detail: "frost", n: 1, share: 1 },
      { kind: "mob", faction: "frost", detail: "frostBrute", n: 1, share: 1 },
    ]);
    const fb = rows<{ fromS: number; n: number }>(sql, "firstblood");
    expect(fb.length).toBe(21);
    expect(fb.filter((b) => b.n > 0).map((b) => [b.fromS, b.n])).toEqual([[90, 1], [225, 1]]);
    const heat = runQuery(sql, "heatmap", q(), {}, NOW) as { cells: number[][]; w: number; runs: number };
    expect(heat).toMatchObject({ w: 34, cells: [[5, 7, 3]], runs: 2 });
    const botHeat = runQuery(sql, "heatmap", q({ pool: "bots" }), {}, NOW) as { cells: number[][]; runs: number };
    expect(botHeat).toMatchObject({ cells: [[5, 7, 1]], runs: 1 });
    const list = rows<{ runId: string; durationS: number; winnerFaction: string }>(sql, "runs", {}, "runs");
    expect(list.map((r) => [r.runId.slice(-1), r.durationS, r.winnerFaction])).toEqual([["1", 240, "frost"], ["2", 300, "fire"]]);
    expect(rows(sql, "runs", { limit: "1" }, "runs").length).toBe(1);
    expect(rows(sql, "runs", { before: String(DAY1) }, "runs").length).toBe(1);
    const [perf] = rows<{ samples: number; fpsP50: number; rttP95: number; reconnectsPerRun: number; afk: { n: number } }>(sql, "perf");
    expect(perf).toMatchObject({ samples: 1, fpsP50: 120, rttP95: 70, reconnectsPerRun: 0 });
    expect(perf.afk.n).toBe(4);
  });

  it("meta lists builds and seeds", () => {
    const sql = loaded();
    const m = runQuery(sql, "meta", q(), {}, NOW) as { builds: { build: string; runs: number; commit: string | null }[]; runs: number; seeds: unknown[] };
    expect(m.runs).toBe(5);
    expect(m.builds.map((b) => [b.build, b.runs, b.commit])).toEqual([[B1, 4, null], [B0, 1, "abc"]]);
    expect(m.seeds).toEqual([{ seed: 1234, attempt: 0, runs: 5 }]);
  });

  it("export pages through the filter with a cursor", () => {
    const sql = loaded();
    const p1 = runQuery(sql, "exportPage", q({ pool: "all" }), { limit: 2 }, NOW) as { keys: string[]; next: { endedAt: number; runId: string } | null };
    expect(p1.keys.length).toBe(2);
    expect(p1.next).not.toBeNull();
    const p2 = runQuery(sql, "exportPage", q({ pool: "all" }), { limit: 2, cursor: p1.next! }, NOW) as { keys: string[]; next: unknown };
    expect(p2.keys.length).toBe(1);
    expect(p2.next).toBeNull();
    expect(new Set([...p1.keys, ...p2.keys]).size).toBe(3);
  });
});

describe("telemetry store: injection probes", () => {
  const probes = ["' OR 1=1 --", "x\"; DROP TABLE runs; --", "1); DELETE FROM runs; --", "fire' --", "%", "../../etc"];

  it("rejects every probe at the parameter parser", () => {
    for (const key of ["build", "from", "to", "pool", "source", "faction", "weapon"]) {
      for (const p of probes) {
        const r = parseStatsQuery(new URLSearchParams({ [key]: p }), NOW);
        expect(r.ok, `${key}=${p}`).toBe(false);
        if (!r.ok) expect(r.param).toBe(key);
      }
    }
    for (const [endpoint, key] of [["duels/factions", "clean"], ["duels/factions", "outcomes"], ["offers", "kind"], ["camps", "by"], ["runs", "limit"], ["runs", "before"], ["export", "cursor"], ["export", "limit"]]) {
      for (const p of probes) {
        const r = parseOptions(endpoint, new URLSearchParams({ [key]: p }));
        expect(r.ok, `${endpoint} ${key}=${p}`).toBe(false);
      }
    }
  });

  it("binds a hostile value as data even past the parser", () => {
    const sql = loaded();
    for (const p of probes) {
      const hostile = { ...q({ source: "any" }), build: p, faction: p as never, weapon: p as never };
      for (const name of ["overview", "factions", "weapons", "duelFactions", "duelSummary", "offers", "farming", "camps", "deaths", "firstblood", "heatmap", "runs", "perf", "exportPage"] as QueryName[]) {
        runQuery(sql, name, hostile, { kind: p as never, by: p as never, outcomes: [p as never] }, NOW);
      }
    }
    expect(count(sql, "runs")).toBe(5);
    expect(runKey(sql, "' OR 1=1 --")).toBeNull();
  });
});

describe("telemetry store: query plans and the answer cache", () => {
  // The DO never runs ANALYZE, so these are the plans it gets. Every query that joins runs must reach its child
  // rows from the runs in range by run_id, never through a secondary index that ignores run_id (that scanned every
  // human duel, or every augment option, of the whole retention once per run or per query).
  it("drives every child table of a runs join by run_id, for every pool and offer kind", () => {
    const base = nodeSql();
    migrate(base);
    const bad: string[] = [];
    const sql: Sql = {
      ...base,
      all: (query, ...bind) => {
        const plan = (base.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...bind) as { detail: string }[]).map((r) => r.detail);
        if (/JOIN runs r/.test(query)) {
          const first = plan.find((d) => /^(SEARCH|SCAN) /.test(d)) ?? "";
          if (!/^(SEARCH|SCAN) r /.test(first)) bad.push(`${query.slice(0, 60)} :: ${plan.join(" | ")}`);
          for (const d of plan) {
            if (/^(SEARCH|SCAN) (?!r )\w+ /.test(d) && !/run_id=/.test(d)) bad.push(`${query.slice(0, 60)} :: ${d}`);
          }
        }
        return base.all(query, ...bind);
      },
    };
    for (const pool of ["humans", "bots", "all"]) {
      for (const source of ["live", "any"]) {
        for (const name of QUERY_NAMES) {
          for (const kind of ["augment", "stat"]) {
            const params = new URLSearchParams({ pool, source, kind });
            const parsed = parseStatsQuery(params, NOW);
            const opts = parseOptions(name === "offers" ? "offers" : "", params);
            if (!parsed.ok || !opts.ok) throw new Error("bad params");
            runQuery(sql, name, parsed.value, opts.value, NOW);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps an answer until cleared, keyed by the whole request, and never keeps the export", () => {
    const sql = loaded();
    const cache = new QueryCache(2);
    let computed = 0;
    const ask = (name: QueryName, params: Record<string, string> = {}) =>
      cache.get(name, q(params), {}, () => {
        computed++;
        return runQuery(sql, name, q(params), {}, NOW);
      });
    const a = ask("overview");
    expect(ask("overview")).toBe(a);
    expect(computed).toBe(1);
    ask("overview", { pool: "bots" });
    expect(computed).toBe(2);
    ask("factions"); // over the cap of 2: the oldest goes
    expect(cache.size).toBe(2);
    ask("overview");
    expect(computed).toBe(4);
    ask("exportPage");
    ask("exportPage");
    expect(computed).toBe(6);
    cache.clear();
    ask("factions");
    expect(computed).toBe(7);
  });
});
