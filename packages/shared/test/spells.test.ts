// The spell slot's pure rules (shared/spells.ts). No spell exists yet, so the catalog is empty; the rules that pick and place are
// checked with a spell registered in this file only (vitest isolates each file's modules). The server's side, a real map
// included, is server/test/spells.test.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ABILITIES, ABILITY_IDS, chooseSpellFinds, isSpellId, mapFromTiles, pickSpell, regionCode, spellIds, spellPool, spellReadyAt,
  spellReload, spellTakenText, TILE, TILE_FLOOR, type AbilityDef, type AbilityId, type GameMap,
} from "../src/index";

describe("the catalog today", () => {
  it("holds no spell, and an empty pool places nothing", () => {
    expect(spellIds()).toEqual([]);
    expect(spellPool()).toEqual([]);
    for (const id of ABILITY_IDS) expect(isSpellId(id)).toBe(false);
    expect(isSpellId("")).toBe(false);
    expect(isSpellId(7)).toBe(false);
    expect(pickSpell([], 0.3)).toBeNull();
  });
});

describe("with a spell registered", () => {
  const ID = "spellUnderTest" as AbilityId;
  const def: AbilityDef = {
    id: ID, name: "Test Spell", blurb: "", kind: "spell", faction: null, flat: true, ownOrder: false, dropsLock: false,
    cancelledBy: [], blockedBy: [], ai: ["buff"], telegraph: "none", icon: "cross", color: 0xffffff,
    ranks: [{ cooldownMs: 5000, charges: 3, castMs: 0, targeting: { kind: "self" }, shape: { kind: "none" }, effects: [] }],
  };
  beforeAll(() => {
    (ABILITY_IDS as AbilityId[]).push(ID);
    (ABILITIES as Record<string, AbilityDef>)[ID] = def;
  });
  afterAll(() => {
    (ABILITY_IDS as AbilityId[]).pop();
    delete (ABILITIES as Record<string, AbilityDef>)[ID];
  });

  it("is in the catalog and the pool; its reload is its rank's charges and cooldown", () => {
    expect(spellIds()).toEqual([ID]);
    expect(spellPool()).toEqual([ID]);
    expect(isSpellId(ID)).toBe(true);
    expect(spellReload(def)).toEqual({ charges: 3, reloadMs: 5000 });
    expect(spellReadyAt(def, 0)).toBe(0);
    expect(spellReadyAt(def, 20_000)).toBe(10_000);
    expect(spellTakenText(def)).toBe("Spell: Test Spell (Shift)");
  });

  /** A 40x10 floor: tiles x < 20 are the Fire zone, the rest Holy; ground spots along a row. */
  function twoZones(): GameMap {
    const W = 40, H = 10;
    const map = mapFromTiles(W, H, new Uint8Array(W * H).fill(TILE_FLOOR));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) map.regionGrid[y * W + x] = regionCode(x < 20 ? "fire" : "holy");
    map.groundSpots = Array.from({ length: 19 }, (_, i) => ({ x: (1 + i * 2) * TILE + TILE / 2, y: 5 * TILE + TILE / 2 }));
    return map;
  }

  it("places `perZone` finds a zone at the lowest hashes, clear of what is taken and of each other", () => {
    const map = twoZones();
    const taken = [map.groundSpots[0]!];
    const unit = (stream: 0 | 1, spot: number) => (stream === 0 ? spot / 100 : 0.5);
    const finds = chooseSpellFinds(map, [ID], 2, taken, 3, unit);
    // Fire: spot 0 is taken and spot 1 is 2 tiles from it (under 3), so spots 2 and 4 (spot 3 is 2 tiles from spot 2).
    expect(finds.filter((f) => f.zone === "fire").map((f) => map.groundSpots.findIndex((s) => s.x === f.at.x))).toEqual([2, 4]);
    expect(finds.filter((f) => f.zone === "holy")).toHaveLength(2);
    for (const f of finds) expect(f.spell).toBe(ID);
    for (let i = 0; i < finds.length; i++) {
      for (let j = i + 1; j < finds.length; j++) {
        expect(Math.hypot(finds[i]!.at.x - finds[j]!.at.x, finds[i]!.at.y - finds[j]!.at.y)).toBeGreaterThanOrEqual(3 * TILE);
      }
    }
    // A spot outside every zone (none, the coliseum) never holds one.
    map.regionGrid.fill(0);
    expect(chooseSpellFinds(map, [ID], 2, [], 3, unit)).toEqual([]);
  });
});
