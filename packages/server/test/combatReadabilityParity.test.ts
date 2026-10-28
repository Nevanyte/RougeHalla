import { describe, expect, it } from "vitest";
import {
  ALL_WEAPON_IDS, encodeFlat, encodeMult, FACTIONS, FACTION_IDS, mapFromTiles, mulberry32,
  TICK_MS, TILE, TILE_FLOOR, TILE_WALL, weaponDamageShares,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import { packetFor } from "../src/sim/weapons";
import type { GameMap } from "@raid/shared";

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
      }
    }
  });
});
