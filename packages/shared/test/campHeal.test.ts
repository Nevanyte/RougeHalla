// The camp-clear heal's curve (balance contract 7.1, shared/rules.ts campHealAmount): missing hp times an S-curve of how much is
// missing. The contract's table is the oracle.
import { describe, expect, it } from "vitest";
import { CAMP_HEAL_HI, CAMP_HEAL_LO, CAMP_HEAL_MID, CAMP_HEAL_WIDTH, campHealAmount } from "../src/index";

const MAX = 1000;
/** [hp before as a share of max, the heal as a share of max hp, hp after] straight from the contract's table (percent). */
const TABLE: ReadonlyArray<readonly [number, number, number]> = [
  [95, 1.4, 96], [90, 2.8, 93], [80, 6.7, 87], [70, 13.1, 83], [60, 24.0, 84],
  [50, 38.1, 88], [40, 52.0, 92], [30, 64.2, 94], [20, 75.0, 95], [10, 85.1, 95],
];

describe("campHealAmount: the contract's table", () => {
  it.each(TABLE)("hp %i%% heals %f%% of max hp and leaves the player at %i%%", (hp, healPct, afterPct) => {
    const heal = campHealAmount((hp / 100) * MAX, MAX);
    expect(Math.abs((heal / MAX) * 100 - healPct), `${hp}%`).toBeLessThanOrEqual(0.06);
    expect(Math.round(hp + (heal / MAX) * 100)).toBe(afterPct);
  });

  it("has the constants the contract names", () => {
    expect([CAMP_HEAL_LO, CAMP_HEAL_HI, CAMP_HEAL_MID, CAMP_HEAL_WIDTH]).toEqual([0.25, 0.95, 0.4, 0.1]);
  });

  it("is missing x f(m) with f between LO and HI, rising with the missing share", () => {
    let last = -1;
    for (let missing = 1; missing <= 99; missing++) {
      const m = missing / 100;
      const heal = campHealAmount((1 - m) * MAX, MAX);
      const f = heal / (m * MAX);
      expect(f, `m ${m}`).toBeGreaterThan(CAMP_HEAL_LO);
      expect(f, `m ${m}`).toBeLessThan(CAMP_HEAL_HI);
      expect(f, `m ${m}`).toBeGreaterThan(last);
      last = f;
    }
  });

  it("a player hurt to 5-90% leaves a camp between 82.5% and 96%; a scratched one stays a hair above where it started", () => {
    for (let hp = 5; hp <= 90; hp++) {
      const after = hp + (campHealAmount((hp / 100) * MAX, MAX) / MAX) * 100;
      expect(after, `hp ${hp}%`).toBeGreaterThanOrEqual(Math.min(82.5, hp));
      expect(after, `hp ${hp}%`).toBeLessThanOrEqual(96);
    }
    for (let hp = 91; hp <= 99; hp++) {
      const after = hp + (campHealAmount((hp / 100) * MAX, MAX) / MAX) * 100;
      expect(after, `hp ${hp}%`).toBeGreaterThan(hp);
      expect(after, `hp ${hp}%`).toBeLessThan(hp + (100 - hp) * 0.3); // under 30% of what is missing
    }
    expect(campHealAmount(0.99 * MAX, MAX) / MAX).toBeLessThan(0.003);
  });

  it("scales with the pool, never passes max hp, and is 0 for a full, over-full or empty-max pool", () => {
    expect(campHealAmount(250, 500)).toBeCloseTo(campHealAmount(500, 1000) / 2, 9);
    for (let hp = 0; hp <= 100; hp += 5) expect(hp + campHealAmount(hp, 100)).toBeLessThanOrEqual(100);
    expect(campHealAmount(1000, 1000)).toBe(0);
    expect(campHealAmount(1200, 1000)).toBe(0);
    expect(campHealAmount(0, 0)).toBe(0);
    expect(campHealAmount(5, Number.NaN)).toBe(0);
  });

  it("a player at 0 hp heals as if at 0 (a clamp, never a negative pool or NaN)", () => {
    expect(campHealAmount(0, 1000)).toBeCloseTo(1000 * (CAMP_HEAL_LO + (CAMP_HEAL_HI - CAMP_HEAL_LO) / (1 + Math.exp(-(1 - CAMP_HEAL_MID) / CAMP_HEAL_WIDTH))), 9);
    expect(campHealAmount(-50, 1000)).toBe(campHealAmount(0, 1000));
  });
});
