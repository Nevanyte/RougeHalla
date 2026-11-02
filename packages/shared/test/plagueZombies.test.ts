import { describe, expect, it } from "vitest";
import { plagueZombieStats, PLAGUE_ZOMBIE_INTERVAL_MS, PLAGUE_ZOMBIE_WINDUP_MS } from "../src/index";

describe("Plague zombie scaling", () => {
  it("starts at 55% of owner max health and hits for 2% once a second", () => {
    expect(plagueZombieStats(1000, 1)).toEqual({ maxHp: 550, damage: 20 });
    expect(PLAGUE_ZOMBIE_INTERVAL_MS).toBe(1000); expect(PLAGUE_ZOMBIE_WINDUP_MS).toBe(200);
  });
  it("adds ten percent to both pet stats for each further body, with owner health growth applied first", () => {
    expect(plagueZombieStats(1000, 3)).toEqual({ maxHp: 660, damage: 24 });
    expect(plagueZombieStats(2000, 3)).toEqual({ maxHp: 1320, damage: 48 });
  });
  it("the owner's SO rider raises a hit up to the old 3% of max health and no further", () => {
    expect(plagueZombieStats(1000, 1, { ap: 20 }).damage).toBeCloseTo(25, 9); // 20 + 0.25 x 20
    expect(plagueZombieStats(1000, 1, { ap: 400 }).damage).toBeCloseTo(30, 9); // capped: 3% of 1000
    expect(plagueZombieStats(1000, 3, { ap: 400 }).damage).toBeCloseTo(36, 9); // the cap grows with the bodies too
  });
});
