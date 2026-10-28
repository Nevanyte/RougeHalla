import { describe, expect, it } from "vitest";
import { combatDamageShares, combatReadability, damageShares, FACTIONS, FACTION_IDS, weaponDamageShares, WIRE_IDENTITY_MIRRORS } from "../src/index";

function fighter(faction: (typeof FACTION_IDS)[number]) {
  return {
    faction, weapon0: "fists", weapon1: "", slot: 0, hp: FACTIONS[faction].hp, maxHp: FACTIONS[faction].hp,
    build: {} as Record<string, number>, ...WIRE_IDENTITY_MIRRORS,
  };
}

describe("combat readability", () => {
  it.each(FACTION_IDS)("uses a fresh %s as the growth baseline", (faction) => {
    const p = fighter(faction);
    const view = combatReadability(p);
    expect(view.powerRatio).toBeCloseTo(1, 12);
    expect(view.power).toBe(0);
    expect(view.topStats).toEqual([]);
    expect(combatDamageShares(p)).toEqual(damageShares(FACTIONS[faction]));
  });

  it("uses card power and the PvP factor for the growth cue", () => {
    const p = fighter("frost");
    p.build = { ad2: 1, ap3: 1 };
    p.adBonus = 210;
    p.apBonus = 330;
    const view = combatReadability(p);
    expect(view.powerRatio).toBeGreaterThan(1);
    expect(view.topStats.map((s) => s.key)).toEqual(["ap", "ad"]);
    expect(view.topStats[0]?.short).toBe("AP");
  });

  it("blends weapon scaling into the actual physical and magic damage shares", () => {
    const p = fighter("plague");
    p.weapon0 = "wand";
    const base = combatDamageShares(p);
    expect(base).toEqual(damageShares(FACTIONS.plague));

    p.adBonus = 500;
    const withAd = combatDamageShares(p);
    expect(withAd.phys).toBeGreaterThan(base.phys);

    p.adBonus = 0;
    p.apBonus = 500;
    const withAp = combatDamageShares(p);
    expect(withAp.magic).toBeGreaterThan(base.magic);
    expect(withAp.phys).toBeLessThan(base.phys);
    expect(withAp.phys + withAp.magic + withAp.true).toBeCloseTo(1, 12);
  });

  it("can report each weapon slot's damage mix with the same current mirrors", () => {
    const p = fighter("plague");
    p.adBonus = 200;
    p.apBonus = 300;
    const bow = weaponDamageShares(p, "bow");
    const wand = weaponDamageShares(p, "wand");
    expect(bow.phys).toBeGreaterThan(damageShares(FACTIONS.plague).phys);
    expect(wand.magic).toBeGreaterThan(damageShares(FACTIONS.plague).magic);
    expect(bow.phys + bow.magic + bow.true).toBeCloseTo(1, 12);
    expect(wand.phys + wand.magic + wand.true).toBeCloseTo(1, 12);
  });

  it("does not use current HP, bounty, or hidden-state flags for power", () => {
    const p = fighter("fire");
    p.build = { vitality2: 1, ad1: 1 };
    p.maxHp *= 1.16;
    const baseline = combatReadability(p);
    const runtime = { ...p, hp: 1, bounty: 500, effects: 1 << 9 };
    expect(combatReadability(runtime)).toEqual(baseline);
  });
});
