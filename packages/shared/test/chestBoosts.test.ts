import { describe, expect, it } from "vitest";
import {
  CHEST_BOOST_DEFS, CHEST_BOOST_STATS, cardOptionView, chestBoostBonus, chestBoostGain, chestBoostId, chestBoostStat, foldRows, rollBoostOptions,
} from "../src";
import { mulberry32 } from "../src/rng";

describe("stat chest boosts", () => {
  it("is x1.2 for one pick, diminishing, and stops at three", () => {
    expect(chestBoostBonus(0)).toBe(0);
    expect(chestBoostBonus(1)).toBeCloseTo(0.2);
    expect(chestBoostBonus(2)).toBeCloseTo(0.36);
    expect(chestBoostBonus(3)).toBeCloseTo(0.488);
    expect(chestBoostBonus(9)).toBeCloseTo(0.488);
  });

  it("rolls three distinct known stats", () => {
    const ids = rollBoostOptions(mulberry32(7));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(chestBoostStat(id)).not.toBeNull();
    expect(chestBoostStat("boost:nope")).toBeNull();
  });

  it("one pick beats one mob stack of its stat and stays near one tier-I base card even on a built-up sheet", () => {
    // Mob stack and tier-I card sizes per stat (mobStats.ts REWARDS; cards.ts BASE_NUMBERS: AD/AP 12, armor/MR 15, haste 9%, vitality 9%, leech 5%).
    const stack: Record<string, number> = { ad: 1, ap: 1, armor: 1, shield: 1, maxHp: 0.01, attackSpeed: 0.01, moveSpeed: 0.005, lifesteal: 0.0025 };
    const tierI: Record<string, number> = { ad: 12, ap: 12, armor: 15, shield: 15, maxHp: 0.09, attackSpeed: 0.09, moveSpeed: 0.06, lifesteal: 0.05 };
    for (const stat of CHEST_BOOST_STATS) {
      expect(chestBoostGain(stat, 1, 0)).toBeGreaterThan(stack[stat]! * 2);
      // A built-up stat: two tier-I cards and 20 mob stacks. One pick is still under one tier-I card.
      expect(chestBoostGain(stat, 1, 2 * tierI[stat]! + 20 * stack[stat]!)).toBeLessThan(tierI[stat]! * 1.2);
      expect(chestBoostGain(stat, 1, tierI[stat]!)).toBeLessThan(tierI[stat]!);
    }
  });

  it("folds into the earned sums: x1.2 of the bonus, the floor on an empty sheet", () => {
    const rows = [{ k: "flat", stat: "ap", v: 100 }] as const;
    const base = foldRows(rows, { owns: () => true });
    const boosted = foldRows(rows, { owns: () => true, boosts: { ap: 1, ad: 1 } });
    expect(boosted.farmSums.ap).toBeCloseTo(20);
    expect(base.farmSums.ap).toBe(0);
    expect(boosted.farmSums.ad).toBeCloseTo(CHEST_BOOST_DEFS.ad.floor * 0.2);
    const hp = foldRows([], { baseMaxHp: 1000, boosts: { maxHp: 1 } });
    expect(hp.maxHp).toBeCloseTo(1000 * (1 + 0.15 * 0.2));
  });

  it("shows a chest panel view for a boost id", () => {
    const v = cardOptionView(chestBoostId("ap"), null);
    expect(v?.title).toBe("Soul Offence x1.2");
    expect(v?.blocked).toBeNull();
  });
});
