// What the HUD says about hp and the barrier (shared/hpView.ts).
import { describe, expect, it } from "vitest";
import { barrierStrength, BARRIER_FULL_SHARE, hpBarFractions, hpText } from "../src/index";

// The kill combos that gave a barrier are gone; Second Skin and R6's skills bring barriers back, and the HUD's draw scale and bar maths stay.
describe("the barrier", () => {
  it("is a full ring at BARRIER_FULL_SHARE of max hp (the old Bulwark's 30%) and proportional below it", () => {
    expect(BARRIER_FULL_SHARE).toBeCloseTo(0.3, 12);
    expect(barrierStrength(150, 500)).toBe(1);
    expect(barrierStrength(75, 500)).toBeCloseTo(0.5, 12);
    expect(barrierStrength(9999, 500)).toBe(1);
    expect(barrierStrength(0, 500)).toBe(0);
    expect(barrierStrength(10, 0)).toBe(0);
    expect(barrierStrength(Number.NaN, 500)).toBe(0);
  });

  it("splits the hp bar into hp and barrier shares of max hp", () => {
    expect(hpBarFractions(400, 500, 0)).toEqual({ hp: 0.8, barrier: 0 });
    const a = hpBarFractions(250, 500, 75);
    expect(a.hp).toBeCloseTo(0.5, 12);
    expect(a.barrier).toBeCloseTo(0.15, 12);
  });

  it("shrinks both segments when hp plus the barrier is more than max hp", () => {
    const a = hpBarFractions(500, 500, 100);
    expect(a.hp + a.barrier).toBeCloseTo(1, 12);
    expect(a.hp).toBeCloseTo(500 / 600, 12);
    expect(a.barrier).toBeCloseTo(100 / 600, 12);
  });

  it("is 0 for nothing and survives junk", () => {
    expect(hpBarFractions(0, 0, 0)).toEqual({ hp: 0, barrier: 0 });
    expect(hpBarFractions(-5, 100, -5)).toEqual({ hp: 0, barrier: 0 });
    expect(hpBarFractions(Number.NaN, 100, Number.NaN)).toEqual({ hp: 0, barrier: 0 });
  });

  it("writes the hp readout with the barrier when there is one", () => {
    expect(hpText(400, 500, 0)).toBe("HP 400/500");
    expect(hpText(1416.25, 1416.25, 0)).toBe("HP 1417/1417");
    expect(hpText(1540, 1540.0000000000002, 0)).toBe("HP 1540/1540");
    expect(hpText(Number.EPSILON, 500, 0)).toBe("HP 1/500");
    expect(hpText(399.2, 500, 74.3)).toBe("HP 400/500 +75 barrier");
    expect(hpText(400, 500, 0.0001)).toBe("HP 400/500 +1 barrier");
    expect(hpText(400, 500, -3)).toBe("HP 400/500");
  });
});
