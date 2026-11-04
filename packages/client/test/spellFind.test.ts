// A spell find in the world (render/interact.ts, render/ContainerView.ts): F takes it like a weapon, the weapon bar says what the
// pickup swaps, and its label says how long a copy someone laid down still reloads. No spell exists yet, so this file registers one.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABILITIES, ABILITY_IDS, TILE_FLOOR, mapFromTiles, type AbilityDef, type AbilityId } from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { spellLabel } from "../src/render/ContainerView";
import { containerSpell, nearestContainer, spellFindHint } from "../src/render/interact";

const SPELL = "clientFindSpell" as AbilityId;
const def = {
  id: SPELL, name: "Find Spell", blurb: "", kind: "spell", faction: null, flat: true, ownOrder: false, dropsLock: false,
  cancelledBy: [], blockedBy: [], ai: ["buff"], telegraph: "none", icon: "cross", color: 0xffffff,
  ranks: [{ cooldownMs: 1000, castMs: 0, targeting: { kind: "self" }, shape: { kind: "none" }, effects: [] }],
} as AbilityDef;
beforeAll(() => {
  (ABILITY_IDS as AbilityId[]).push(SPELL);
  (ABILITIES as Record<string, AbilityDef>)[SPELL] = def;
});
afterAll(() => {
  (ABILITY_IDS as AbilityId[]).pop();
  delete (ABILITIES as Record<string, AbilityDef>)[SPELL];
});

const map = mapFromTiles(8, 8, new Uint8Array(64).fill(TILE_FLOOR));
const box = (id: string, kind: string, itemDef: string, x = 32): ContainerState => ({
  id, kind, x, y: 32, label: kind, items: [{ uid: id, def: itemDef }], readyAt: 0,
} as unknown as ContainerState);
const boxes = (rows: ContainerState[]) => ({
  forEach(cb: (c: ContainerState, id: string) => void) { for (const c of rows) cb(c, c.id); },
});

describe("a spell find", () => {
  it("is what F takes when it is the nearest thing in reach, and only when it holds a spell", () => {
    const find = box("s", "spell", SPELL);
    const weapon = box("w", "ground", "sword", 60);
    expect(containerSpell(find)).toBe(def);
    expect(nearestContainer(boxes([find, weapon]), map, { x: 32, y: 32 })).toBe(find);
    // A find whose item is no spell (a forged id, a Wish) is never offered: the weapon beside it is.
    const odd = box("x", "spell", "blaze");
    expect(containerSpell(odd)).toBeNull();
    expect(nearestContainer(boxes([odd, weapon]), map, { x: 32, y: 32 })).toBe(weapon);
    // And a spell id in a weapon container is no spell find.
    expect(containerSpell(box("g", "ground", SPELL))).toBeNull();
  });

  it("the hint says what the pickup does with the spell held", () => {
    expect(spellFindHint(null, def)).toBe("take Find Spell (Shift casts it)");
    expect(spellFindHint({ ...def, name: "Old" }, def)).toBe("swap Old for Find Spell");
  });

  it("its label names the spell and, for a copy still reloading, the seconds left", () => {
    expect(spellLabel("Find Spell", 0, 5000)).toBe("Find Spell");
    expect(spellLabel("Find Spell", 7200, 5000)).toBe("Find Spell · reloading 3s");
    expect(spellLabel("", 0, 0)).toBe("Spell");
  });
});
