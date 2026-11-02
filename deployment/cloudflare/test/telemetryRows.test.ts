import { describe, expect, it } from "vitest";
import { telemetryObjectKey } from "@raid/shared/telemetry";
import { CHILD_TABLES, toRows } from "../src/telemetry/rows";
import { COLUMNS } from "../src/telemetry/store";
import { EXAMPLE_RUN, miniSet } from "./telemetryHelpers";

describe("toRows", () => {
  it("flattens the example record into every table", () => {
    const r = toRows(EXAMPLE_RUN, 123);
    expect(r.runId).toBe(EXAMPLE_RUN.runId);
    expect(r.run).toMatchObject({
      run_id: EXAMPLE_RUN.runId, source: "test", build: "a1b2c3d4e5f60718", commit_sha: "6c41ed9", day: "2026-11-02",
      duration_ms: 240_000, end_reason: "winner", winner_slot: 0, winner_faction: "frost", win_bonus_paid: 0,
      teleports: 1, first_teleport_ms: 180_000, first_blood_ms: 230_000, first_blood_victim_faction: "fire", duels: 1,
      truncated: 0, received_at: 123, raw_key: telemetryObjectKey("a1b2c3d4e5f60718", EXAMPLE_RUN.endedAtEpoch, EXAMPLE_RUN.runId),
    });
    const [p0, p1] = r.players;
    expect(p0).toMatchObject({
      slot: 0, pid: "0123456789abcdef", bot: 0, faction: "frost", won: 1, place: 1, mob_kills: 10, elite_kills: 1,
      main_weapon: "axe", card_power: 4, mob_stats_total: 10, boosts_total: 1, max_hp: 1180, dmg_players: 760.5,
      dmg_mobs: 5200, dmg_taken: 1310, healed: 380, wish_casts: 1, wish_landed: 1, potions: 1, gv_total: 12,
      fps_p50: 143, frame_p95: 8.5, rtt_p50: 54, rtt_p95: 71, death_kind: null,
    });
    expect(p1).toMatchObject({ bot: 1, tier: "hard", persona: "hunter", death_kind: "player", death_detail: "frost", death_coliseum: 1, won: 0, fps_p50: null });
    expect(r.player_cards.filter((c) => c.slot === 0).map((c) => [c.card, c.count])).toEqual([
      ["ad1", 2], ["vitality1", 1], ["quickdraw", 1], ["boost:ad", 1],
    ]);
    expect(r.player_weapons.filter((w) => w.slot === 0).map((w) => [w.weapon, w.ms])).toEqual([["fists", 30_000], ["axe", 210_000]]);
    expect(r.player_amounts.find((a) => a.slot === 0 && a.dir === "dealtPlayers" && a.source === "weapon")?.amount).toBe(640.5);
    expect(r.power_snaps).toHaveLength(1);
    expect(r.offers).toHaveLength(2);
    expect(JSON.parse(String(r.offers[1].options))).toEqual(["ad2", "quickdraw", "glassCannon"]);
    // Two offers x one eligible slot x three options.
    expect(r.offer_options).toHaveLength(6);
    expect(r.offer_options.filter((o) => o.picked === 1).map((o) => [o.i, o.option])).toEqual([[0, "boost:ad"], [1, "quickdraw"]]);
    expect(r.camp_clears[0]).toMatchObject({ mob_type: "frostGrunt", clear_ms: 20_000, killer_faction: "frost", killer_weapon: "axe", killer_bot: 0, contributors: 1 });
    expect(r.duels[0]).toMatchObject({ bots: 1, a_faction: "frost", b_faction: "fire", dur_ms: 15_000, a_dmg: 760.5, b_dmg: 410, comeback: 0, clean: 1 });
    expect(r.duel_cards).toEqual([{ run_id: EXAMPLE_RUN.runId, i: 0, side: 0, card: "quickdraw" }]);
    // "FB4VHhYe" = (20,30) (21,30) (22,30): one 4-tile cell, 3 s, human.
    expect(r.heat_cells).toEqual([{ build: "a1b2c3d4e5f60718", day: "2026-11-02", source: "test", bot: 0, cx: 5, cy: 7, secs: 3 }]);
  });

  it("emits only known columns and every row names its run", () => {
    for (const record of [EXAMPLE_RUN, ...miniSet()]) {
      const r = toRows(record);
      for (const k of Object.keys(r.run)) expect(COLUMNS.runs).toContain(k);
      for (const t of CHILD_TABLES) {
        for (const row of r[t]) {
          expect(row.run_id).toBe(record.runId);
          for (const k of Object.keys(row)) expect(COLUMNS[t], `${t}.${k}`).toContain(k);
        }
      }
    }
  });

  it("counts pickers of an offer with no eligible list, marks never-chose as -2 and skips absent tiles", () => {
    const rec = structuredClone(EXAMPLE_RUN);
    rec.offers = [
      { i: 0, kind: "stat", at: 1, camp: -1, elite: false, options: ["boost:ad", "boost:ap", "boost:armor"], eligible: [], picks: [{ slot: 1, option: 2, at: 2 }] },
      { i: 1, kind: "trophy", at: 3, camp: -1, elite: false, options: ["kill:ad", "kill:ap", "kill:maxHp"], eligible: [0], picks: [] },
      { i: 1, kind: "trophy", at: 3, camp: -1, elite: false, options: ["dup"], eligible: [0], picks: [] },
    ];
    rec.players[0].tiles = "//8VHg=="; // (255, 255) absent, then (21, 30)
    const r = toRows(rec);
    expect(r.offers).toHaveLength(2);
    expect(r.offer_options.filter((o) => o.i === 0).map((o) => [o.slot, o.pos, o.picked, o.choice])).toEqual([[1, 0, 0, 2], [1, 1, 0, 2], [1, 2, 1, 2]]);
    expect(r.offer_options.filter((o) => o.i === 1).every((o) => o.choice === -2 && o.picked === 0)).toBe(true);
    expect(r.heat_cells).toEqual([{ build: "a1b2c3d4e5f60718", day: "2026-11-02", source: "test", bot: 0, cx: 5, cy: 7, secs: 1 }]);
  });

  it("tags a mob death with its camp's type and flags truncation", () => {
    const rec = structuredClone(EXAMPLE_RUN);
    rec.players[1].death = { kind: "mob", at: 5, mobType: "frostElite", elite: true, camp: 24, zone: "frost", coliseum: false };
    rec.truncated = { duels: 3 };
    const r = toRows(rec);
    expect(r.players[1]).toMatchObject({ death_kind: "mob", death_detail: "frostElite", death_camp: 24, death_camp_type: "frostGrunt" });
    expect(r.run.truncated).toBe(1);
  });
});
