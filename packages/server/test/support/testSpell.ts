// No spell exists yet (the spell slot is architecture only), so the spell tests register their own: a file that calls this adds
// test-only defs of kind "spell" to ABILITIES and ABILITY_IDS for its own tests (vitest isolates each file's modules, and afterAll
// takes them out again). The fx codec builds its ability table when it is imported, so a test spell has no fx code: use these
// in sim tests, which read events, not in a test that packs fx.
import { afterAll, beforeAll } from "vitest";
import { ABILITIES, ABILITY_IDS, type AbilityDef, type AbilityId, type AbilityRank } from "@raid/shared";

/** A self-cast spell that lands in its own tick: a short haste. Two uses, one back every 6 s. */
export const BOLT = "testBolt" as AbilityId;
/** A spell with a cast time (the pickup is refused while it is cast). One use, 10 s to reload; never placed on the map. */
export const WARD = "testWard" as AbilityId;
/** A third spell, placed three times as often as the bolt. */
export const SPARK = "testSpark" as AbilityId;

export const BOLT_RELOAD_MS = 6000;
export const WARD_RELOAD_MS = 10_000;
export const WARD_CAST_MS = 500;

function spell(id: AbilityId, rank: AbilityRank, extra: Partial<AbilityDef> = {}): AbilityDef {
  return {
    id, name: id, blurb: "A spell for tests.", kind: "spell", faction: null, flat: true, ownOrder: false, dropsLock: false,
    cancelledBy: ["stun", "silence"], blockedBy: ["stun", "silence"], ai: ["buff"], telegraph: "none", icon: "cross", color: 0xffffff,
    ranks: [rank], ...extra,
  };
}

export const TEST_SPELLS: readonly AbilityDef[] = [
  spell(BOLT, {
    cooldownMs: BOLT_RELOAD_MS, charges: 2, castMs: 0, targeting: { kind: "self" }, shape: { kind: "none" },
    effects: [{ do: "status", to: "self", status: "haste", ms: 1000, value: 0.1 }],
  }),
  spell(WARD, {
    cooldownMs: WARD_RELOAD_MS, castMs: WARD_CAST_MS, targeting: { kind: "self" }, shape: { kind: "none" },
    effects: [{ do: "status", to: "self", status: "haste", ms: 1000, value: 0.1 }],
  }, { spawnWeight: 0 }),
  spell(SPARK, {
    cooldownMs: 4000, castMs: 0, targeting: { kind: "self" }, shape: { kind: "none" },
    effects: [{ do: "status", to: "self", status: "haste", ms: 1000, value: 0.1 }],
  }, { spawnWeight: 3 }),
];

/** Registers TEST_SPELLS for the calling file's tests. */
export function useTestSpells(): void {
  const ids = ABILITY_IDS as AbilityId[];
  const defs = ABILITIES as Record<string, AbilityDef>;
  beforeAll(() => {
    for (const d of TEST_SPELLS) {
      ids.push(d.id);
      defs[d.id] = d;
    }
  });
  afterAll(() => {
    for (const d of TEST_SPELLS) {
      const i = ids.indexOf(d.id);
      if (i >= 0) ids.splice(i, 1);
      delete defs[d.id];
    }
  });
}
