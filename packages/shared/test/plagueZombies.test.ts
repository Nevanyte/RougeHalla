import { describe, expect, it } from "vitest";
import {
  plagueZombieStats, PLAGUE_ZOMBIE_AD_SHARE, PLAGUE_ZOMBIE_HIT_CAP_SHARE, PLAGUE_ZOMBIE_HIT_PER_BONUS, PLAGUE_ZOMBIE_HIT_SHARE,
  PLAGUE_ZOMBIE_HP_PER_BONUS, PLAGUE_ZOMBIE_HP_SHARE, PLAGUE_ZOMBIE_INTERVAL_MS, PLAGUE_ZOMBIE_WINDUP_MS,
} from "../src/index";

describe("Plague zombie scaling", () => {
  it("is a share of the owner's max hp, and attacks once a second", () => {
    const z = plagueZombieStats(1000, 1);
    expect(z.maxHp).toBeCloseTo(1000 * PLAGUE_ZOMBIE_HP_SHARE, 9);
    expect(z.damage).toBeCloseTo(1000 * PLAGUE_ZOMBIE_HIT_SHARE, 9);
    expect(PLAGUE_ZOMBIE_INTERVAL_MS).toBe(1000); expect(PLAGUE_ZOMBIE_WINDUP_MS).toBe(200);
  });

  it("grows mostly with the owner's BONUS max hp: building health is how a Plague builds its zombie", () => {
    const plain = plagueZombieStats(1000, 1, { baseHp: 1000 });
    const built = plagueZombieStats(1500, 1, { baseHp: 1000 });
    expect(built.maxHp).toBeCloseTo(1500 * PLAGUE_ZOMBIE_HP_SHARE + 500 * PLAGUE_ZOMBIE_HP_PER_BONUS, 9);
    expect(built.damage).toBeCloseTo(1500 * PLAGUE_ZOMBIE_HIT_SHARE + 500 * PLAGUE_ZOMBIE_HIT_PER_BONUS, 9);
    // 50% more owner health is far more than 50% more zombie.
    expect(built.maxHp / plain.maxHp).toBeGreaterThan(3);
  });

  it("has twice the hp it had before the owner's \"2x zombie HP\" ruling (4% of max hp + 0.4 per bonus point), at every owner hp and body count, with its damage untouched", () => {
    expect([PLAGUE_ZOMBIE_HP_SHARE, PLAGUE_ZOMBIE_HP_PER_BONUS]).toEqual([0.08, 0.8]);
    expect([PLAGUE_ZOMBIE_HIT_SHARE, PLAGUE_ZOMBIE_HIT_PER_BONUS]).toEqual([0.003, 0.025]);
    for (const [ownerHp, bodies, baseHp] of [[1000, 1, 1000], [1500, 1, 1000], [1500, 3, 1000], [2400, 5, 1000], [1000, 1, undefined]] as const) {
      const z = plagueZombieStats(ownerHp, bodies, baseHp === undefined ? {} : { baseHp });
      const growth = 1 + (bodies - 1) * 0.1;
      const extra = baseHp === undefined ? 0 : Math.max(0, ownerHp - baseHp);
      expect(z.maxHp, `${ownerHp}/${bodies}`).toBeCloseTo(2 * (ownerHp * 0.04 + extra * 0.4) * growth, 9);
      expect(z.damage, `${ownerHp}/${bodies}`).toBeCloseTo(Math.min((ownerHp * 0.003 + extra * 0.025) * growth, ownerHp * 0.03 * growth), 9);
    }
  });

  it("adds ten percent to both for each further body", () => {
    const one = plagueZombieStats(1500, 1, { baseHp: 1000 });
    const three = plagueZombieStats(1500, 3, { baseHp: 1000 });
    expect(three.maxHp).toBeCloseTo(one.maxHp * 1.2, 9);
    expect(three.damage).toBeCloseTo(one.damage * 1.2, 9);
  });

  it("takes a little of the owner's bonus Offense, and a hit never passes the old 3% of max hp; SO adds nothing", () => {
    expect(plagueZombieStats(1000, 1, { ad: 20 }).damage).toBeCloseTo(1000 * PLAGUE_ZOMBIE_HIT_SHARE + PLAGUE_ZOMBIE_AD_SHARE * 20, 9);
    expect(plagueZombieStats(1000, 1, { ad: 1e6 }).damage).toBeCloseTo(1000 * PLAGUE_ZOMBIE_HIT_CAP_SHARE, 9);
    expect(plagueZombieStats(1000, 1, { ap: 500 } as never).damage).toBeCloseTo(plagueZombieStats(1000, 1).damage, 9);
  });
});
