import { describe, expect, it } from "vitest";
import { HOLY_CAMP_LIFESTEAL_PER_CLEAR, holyCampLifestealOf } from "../src/index";

describe("Holy Demon Blood camp lifesteal", () => {
  it("grows by a quarter point per eligible camp clear without a farming cap", () => {
    expect(HOLY_CAMP_LIFESTEAL_PER_CLEAR).toBe(0.0025);
    expect(holyCampLifestealOf(0)).toBe(0);
    expect(holyCampLifestealOf(1)).toBe(0.0025);
    expect(holyCampLifestealOf(4)).toBe(0.01);
    expect(holyCampLifestealOf(1000)).toBe(2.5);
  });

  it("normalizes invalid and fractional counts safely", () => {
    expect(holyCampLifestealOf(-2)).toBe(0);
    expect(holyCampLifestealOf(1.99)).toBe(0.0025);
    expect(holyCampLifestealOf(Number.NaN)).toBe(0);
  });
});
