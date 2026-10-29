import { describe, expect, it } from "vitest";
import { ALL_WEAPON_IDS, FACTION_IDS, WEAPON_BEATS, WEAPONS } from "@raid/shared";
import { CHAMPION_BUILDS, weaponAttackExample, weaponGuide } from "../src/ui/hub/weaponGuide";

describe("weapon scaling illustrations", () => {
  it("makes the confusing magic-champion physical-weapon split explicit", () => {
    const example = weaponAttackExample("fire", "sword", { ad: 20, ap: 0, bonusMaxHp: 0, bonusDefense: 0 });
    // Fire: 0.6 attacks/s × 200 arena hit × .75 = 90 base magic DPS, plus 20 physical DPS.
    expect(example.attacksPerSecond).toBeCloseTo(1.29);
    expect(example.magic).toBeCloseTo(90 / 1.29);
    expect(example.phys).toBeCloseTo(20 / 1.29);
    expect(example.total).toBeCloseTo(110 / 1.29);
  });

  it.each(ALL_WEAPON_IDS)("derives %s's two counter edges and scaling examples from the live catalog", id => {
    const model = weaponGuide(id);
    expect(model.beats).toEqual(WEAPON_BEATS.filter(([a]) => a === id).map(([, b]) => b));
    expect(model.losesTo).toEqual(WEAPON_BEATS.filter(([, b]) => b === id).map(([a]) => a));
    expect(model.gains).toHaveLength(Object.keys(WEAPONS[id].scaling).length);
    expect(model.mechanics.length).toBeGreaterThan(0);
  });

  it("shows all ten champion builds as examples with the limits of their scaling", () => {
    for (const faction of FACTION_IDS) {
      const builds = CHAMPION_BUILDS[faction];
      expect(new Set(builds.map(b => b.weapon)).size).toBe(2);
      expect(builds.every(b => ALL_WEAPON_IDS.includes(b.weapon) && b.caution.length > 20)).toBe(true);
    }
  });

  it("teaches bow skillshots, wand-only lock-on and the wand's furthest range", () => {
    const bow = weaponGuide("bow"), wand = weaponGuide("wand");
    expect(bow.mechanics.join(" ")).toContain("directional skillshots that fly straight");
    expect(bow.mechanics.join(" ")).not.toMatch(/follow their target|unit-targeted|Longest weapon attack range/);
    expect(bow.mechanics.join(" ")).toContain("Movement pauses during the draw");
    expect(wand.mechanics.join(" ")).toContain("only weapon with lock-on");
    expect(wand.mechanics.join(" ")).toContain("within their travel range");
    expect(wand.mechanics.join(" ")).toContain("Longest weapon range");
    expect(wand.mechanics.join(" ")).toContain("Movement pauses during the cast");
    const bowShape = WEAPONS.bow.shape, wandShape = WEAPONS.wand.shape;
    if (bowShape.kind !== "projectile" || wandShape.kind !== "projectile") throw new Error("expected ranged weapons");
    expect(wandShape.range).toBeGreaterThan(bowShape.range);
  });
});
