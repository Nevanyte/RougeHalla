import { describe, expect, it } from "vitest";
import { plagueZombieStats, PLAGUE_ZOMBIE_INTERVAL_MS, PLAGUE_ZOMBIE_WINDUP_MS } from "../src/index";

describe("Plague zombie scaling", () => {
  it("starts at 35% of owner max health and hits for 3% once a second", () => {
    expect(plagueZombieStats(1000, 1)).toEqual({ maxHp: 350, damage: 30 });
    expect(PLAGUE_ZOMBIE_INTERVAL_MS).toBe(1000); expect(PLAGUE_ZOMBIE_WINDUP_MS).toBe(200);
  });
  it("adds ten percent to both pet stats for each further body, with owner health growth applied first", () => {
    expect(plagueZombieStats(1000, 3)).toEqual({ maxHp: 420, damage: 36 });
    expect(plagueZombieStats(2000, 3)).toEqual({ maxHp: 840, damage: 72 });
  });
});
