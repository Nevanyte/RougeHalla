import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, attackInterval, decodeMult, encodeFlat, encodeMult, FACTIONS, FACTION_IDS, mapFromTiles, mulberry32,
  pacedFaction, WEAPONS,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, weaponDamageShares,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import { recomputeMods } from "../src/sim/mods";
import type { GameMap } from "@raid/shared";
import { weaponAttackExample } from "../../client/src/ui/hub/weaponGuide";
import { championCombatModel } from "../../client/src/ui/championCombatModel";

function arena(): GameMap {
  const w = 20;
  const h = 12;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  return {
    ...mapFromTiles(w, h, tiles),
    spawns: [{ x: 3 * TILE + 16, y: 5 * TILE + 16 }, { x: 16 * TILE + 16, y: 5 * TILE + 16 }],
  };
}

describe("readable weapon damage shares match server packets", () => {
  it("matches packetFor across every player faction and weapon with all scaling inputs", () => {
    for (const faction of FACTION_IDS) {
      const world = createGameWorld({
        config: {
          minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
          suddenDeathSeconds: 3600, pvpRules: false,
        },
        random: mulberry32(41), map: arena(),
      }, { signatures: false });
      addPlayer(world, "p0", "fighter", { faction });
      addPlayer(world, "p1", "opponent", { faction: "frost" });
      step(world, TICK_MS);

      const p = world.state.players.get("p0")!;
      p.adBonus = encodeFlat(80);
      p.apBonus = encodeFlat(105);
      p.armorBonus = encodeFlat(35);
      p.shieldBonus = encodeFlat(45);
      p.asMult = encodeMult(1.25);
      p.maxHp = p.hp = FACTIONS[faction].hp + 180;
      const c = combatant(world, "p0")!;

      for (const weapon of ALL_WEAPON_IDS) {
        const expected = packetFor(c, weapon);
        const actual = weaponDamageShares(p, weapon);
        expect(actual.phys, `${faction}/${weapon} physical`).toBeCloseTo(expected.phys, 12);
        expect(actual.magic, `${faction}/${weapon} magic`).toBeCloseTo(expected.magic, 12);
        expect(actual.true, `${faction}/${weapon} true`).toBeCloseTo(expected.true, 12);
        expect(actual.phys + actual.magic + actual.true, `${faction}/${weapon} normalized`).toBeCloseTo(1, 12);
        const guide = weaponAttackExample(faction, weapon, { ad: 80, ap: 105, bonusMaxHp: 180, bonusDefense: 80 }, 1.25);
        expect(guide.total, `${faction}/${weapon} guide raw hit`).toBeCloseTo(expected.raw, 10);
        expect(guide.phys, `${faction}/${weapon} guide physical`).toBeCloseTo(expected.raw * expected.phys, 10);
        expect(guide.magic, `${faction}/${weapon} guide magic`).toBeCloseTo(expected.raw * expected.magic, 10);
      }
    }
  });

  it("matches champion combat raw autos across factions, weapons, attack speeds, and hit multipliers", () => {
    for (const faction of FACTION_IDS) {
      const world = createGameWorld({
        config: {
          minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
          suddenDeathSeconds: 3600, pvpRules: false,
        },
        random: mulberry32(51), map: arena(),
      }, { signatures: false });
      addPlayer(world, "p0", "fighter", { faction });
      addPlayer(world, "p1", "opponent", { faction: "frost" });
      step(world, TICK_MS);

      const p = world.state.players.get("p0")!;
      const c = combatant(world, "p0")!;
      for (const card of ["", "hereComesTheBoom", "machineGun"]) {
        p.build.clear();
        if (card) p.build.set(card, 1);
        recomputeMods(world, c);
        // Test effective current mirrors directly, including values that bind a weapon's interval floor.
        for (const asMult of [1, 1.4, 3]) {
          p.asMult = encodeMult(asMult);
          p.adBonus = encodeFlat(80);
          p.apBonus = encodeFlat(105);
          p.armorBonus = encodeFlat(35);
          p.shieldBonus = encodeFlat(45);
          p.maxHp = p.hp = FACTIONS[faction].hp + 180;
          for (const weapon of ALL_WEAPON_IDS) {
            const expected = packetFor(c, weapon);
            // This is the target-independent packet only: victim-conditional damage rows, procs/on-hit effects,
            // crits, Plant Your Feet, PvP scaling, and mitigation happen later in the server pipeline.
            const auto = championCombatModel({
              faction, weapon0: weapon, slot: 0, asMult: p.asMult, adBonus: p.adBonus, apBonus: p.apBonus,
              armorBonus: p.armorBonus, shieldBonus: p.shieldBonus, maxHp: p.maxHp, hp: p.hp, build: p.build,
            }).rows[0]!;
            expect(auto.id).toBe("auto");
            expect(auto.damage!.physical, `${faction}/${weapon}/${asMult}/${card || "no hit card"} physical`).toBeCloseTo(expected.raw * expected.phys, 10);
            expect(auto.damage!.magic, `${faction}/${weapon}/${asMult}/${card || "no hit card"} magic`).toBeCloseTo(expected.raw * expected.magic, 10);
            expect(auto.damage!.true, `${faction}/${weapon}/${asMult}/${card || "no hit card"} true`).toBeCloseTo(expected.raw * expected.true, 10);
            expect(auto.tooltip).toContain("outgoing damage bonuses");
            expect(auto.tooltip).toContain("conditional effects");
            expect(auto.tooltip).toContain("critical hits");
            const interval = attackInterval(pacedFaction(FACTIONS[faction]), weapon, decodeMult(p.asMult));
            expect(auto.attacksPerSecond, `${faction}/${weapon}/${asMult}/${card || "no hit card"} rate`).toBeCloseTo(1 / interval, 10);
          }
        }
      }
    }
  });
});
