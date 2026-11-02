// Shared by the telemetry tests: a node:sqlite adapter behind the store's Sql interface, and a small hand-checked set
// of records built from the contract's EXAMPLE_RUN.
import { DatabaseSync } from "node:sqlite";
import type { DuelRecord, OfferRecord, PlayerRecord, RunRecord } from "@raid/shared/telemetry";
import { EXAMPLE_RUN } from "../../../packages/shared/test/fixtures/telemetryRun.example";
import type { Sql, SqlValue } from "../src/telemetry/store";

export function nodeSql(): Sql & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    db,
    all: (q: string, ...b: SqlValue[]) => db.prepare(q).all(...b) as Record<string, SqlValue>[],
    run: (q: string, ...b: SqlValue[]) => {
      db.prepare(q).run(...b);
    },
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

export function count(sql: Sql, table: string): number {
  return Number(sql.all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n);
}

export const B1 = "build-new";
export const B0 = "build-old";
export const DAY1 = Date.UTC(2026, 10, 2, 18, 0, 0);
export const DAY0 = Date.UTC(2026, 10, 1, 18, 0, 0);

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function player(slot: number, over: Partial<PlayerRecord>): PlayerRecord {
  const base = structuredClone(EXAMPLE_RUN.players[1]);
  return {
    ...base, slot, bot: false, tier: undefined, persona: undefined, pid: null, death: null, tiles: undefined,
    snapshots: [], weaponMs: {}, mobKills: {}, dealt: { players: {}, mobs: {} }, taken: {}, ...over,
  };
}

function side(slot: number, faction: string, weapon: string, augments: string[] = [], bot = false): DuelRecord["sides"][0] {
  return {
    slot, bot, faction: faction as never, weapon: weapon as never, weaponsUsed: [weapon as never], augments, cardPower: slot,
    mobStatsTotal: 0, boostsTotal: 0, hp: 1, hpEnd: 0.5, dmg: { weapon: 100 }, wishes: 0, terrain: "",
  };
}

function duel(i: number, a: DuelRecord["sides"][0], b: DuelRecord["sides"][0], over: Partial<DuelRecord>): DuelRecord {
  return { i, start: 10_000, end: 20_000, sides: [a, b], first: 0, outcome: "kill", winner: 0, third: 0, clean: true, zone: "fire", coliseum: false, comeback: null, ...over };
}

function run(n: number, over: Partial<RunRecord>): RunRecord {
  return { ...structuredClone(EXAMPLE_RUN), runId: uuid(n), source: "live", build: { server: B1, commit: null }, duels: [], offers: [], camps: [], firstBlood: null, ...over };
}

const augmentOffer = (options: string[], eligible: number[], picks: OfferRecord["picks"]): OfferRecord =>
  ({ i: 0, kind: "augment", at: 100_000, camp: 3, elite: true, options, eligible, picks });

/**
 * The mini set, with its hand-checked answers in telemetryStore.test.ts:
 * run 1 and 2 are human runs of the newest build B1 on live; run 3 is a bot run of B1; run 4 is the old build;
 * run 5 is a test-source run.
 */
export function miniSet(): RunRecord[] {
  const r1 = run(1, {
    startedAtEpoch: DAY1 - 240_000, endedAtEpoch: DAY1, durationMs: 240_000, humans: 2, bots: 0, winnerSlot: 0,
    firstBlood: { at: 230_000, victim: 1, killer: 0 },
    players: [
      player(0, {
        faction: "frost", mainWeapon: "axe", outcome: "won", place: 1, weaponMs: { axe: 30_000, fists: 10_000 }, mobKills: { frostGrunt: 4 },
        tiles: "FB4VHhYe", client: { v: 1, fpsP50: 120, frameMsP95: 9, rttP50: 50, rttP95: 70 },
        snapshots: [{ minute: 1, maxHp: 1000, ad: 0, ap: 0, armor: 0, shield: 0, asMult: 1, speedMult: 1, cardPower: 2, mobStatsTotal: 4, boostsTotal: 0 }],
      }),
      player(1, {
        faction: "fire", mainWeapon: "sword", outcome: "died", place: 2, weaponMs: { sword: 40_000 },
        death: { kind: "player", at: 230_000, bySlot: 0, weapon: "axe", zone: "fire", coliseum: false },
        snapshots: [{ minute: 1, maxHp: 1000, ad: 0, ap: 0, armor: 0, shield: 0, asMult: 1, speedMult: 1, cardPower: 4, mobStatsTotal: 2, boostsTotal: 0 }],
      }),
    ],
    duels: [duel(0, side(0, "frost", "axe", ["quickdraw"]), side(1, "fire", "sword"), { first: 0, winner: 0, outcome: "kill", clean: true, comeback: true })],
    offers: [augmentOffer(["ad2", "quickdraw", "glassCannon"], [0, 1], [{ slot: 0, option: 1, at: 101_000 }, { slot: 1, option: -1, at: 102_000 }])],
    camps: [{ camp: 4, cycle: 0, zone: "frost", type: "frostGrunt", elite: "", engagedAt: 40_000, clearedAt: 60_000, killerSlot: 0, contributors: [0, 1], playerDeaths: 0 }],
  });
  const r2 = run(2, {
    startedAtEpoch: DAY0 - 300_000, endedAtEpoch: DAY0, durationMs: 300_000, humans: 2, bots: 0, winnerSlot: 0,
    firstBlood: { at: 100_000, victim: 1, killer: -1 },
    players: [
      player(0, { faction: "fire", mainWeapon: "sword", outcome: "won", place: 1, weaponMs: { sword: 50_000 } }),
      player(1, {
        faction: "frost", mainWeapon: "axe", outcome: "died", place: 2, weaponMs: { axe: 20_000 },
        death: { kind: "mob", at: 100_000, mobType: "frostBrute", elite: false, camp: 3, zone: "frost", coliseum: false },
      }),
    ],
    duels: [
      duel(0, side(0, "fire", "sword"), side(1, "frost", "axe"), { outcome: "disengage", winner: -1, first: 1, clean: true }),
      duel(1, side(0, "fire", "sword"), side(1, "frost", "axe"), { outcome: "kill", winner: 0, first: 1, clean: false, third: 2 }),
    ],
    offers: [augmentOffer(["quickdraw", "ad2", "rhythm"], [0, 1], [{ slot: 1, option: 0, at: 101_000 }])],
  });
  const r3 = run(3, {
    startedAtEpoch: DAY1 - 100_000, endedAtEpoch: DAY1 - 50_000, durationMs: 50_000, humans: 0, bots: 2, winnerSlot: 0,
    players: [
      player(0, { bot: true, tier: "hard", faction: "plague", mainWeapon: "bow", outcome: "won", place: 1, tiles: "FB4=" }),
      player(1, { bot: true, tier: "easy", faction: "holy", mainWeapon: "wand", outcome: "died", place: 2 }),
    ],
    duels: [duel(0, side(0, "plague", "bow", [], true), side(1, "holy", "wand", [], true), { outcome: "kill", winner: 0 })],
  });
  const r4 = run(4, {
    build: { server: B0, commit: "abc" }, startedAtEpoch: DAY0 - 600_000, endedAtEpoch: DAY0 - 500_000, durationMs: 100_000, humans: 2, bots: 0,
    players: [player(0, { faction: "sentenced", outcome: "won", place: 1 }), player(1, { faction: "holy", place: 2 })],
  });
  const r5 = run(5, {
    source: "test", startedAtEpoch: DAY1 - 400_000, endedAtEpoch: DAY1 - 300_000, durationMs: 100_000, humans: 2, bots: 0,
    players: [player(0, { faction: "sentenced", outcome: "won", place: 1 }), player(1, { faction: "holy", place: 2 })],
  });
  return [r1, r2, r3, r4, r5];
}

export { EXAMPLE_RUN };
