import { describe, expect, it } from "vitest";
import {
  FIRE_ROAM_BURST_AP_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_CHARGE_MAX, FIRE_ROAM_RAMP_MS,
  fireRoamBurstDamage, fireRoamCharge, fireRoamSpeedMult,
} from "../src/fireRoam";

describe("Fire roaming", () => {
  it("ramps linearly to 1.5x over twenty seconds", () => {
    expect(fireRoamCharge(0)).toBe(0);
    expect(fireRoamSpeedMult(fireRoamCharge(FIRE_ROAM_RAMP_MS / 2))).toBe(1.25);
    expect(fireRoamCharge(FIRE_ROAM_RAMP_MS)).toBe(FIRE_ROAM_CHARGE_MAX);
    expect(fireRoamSpeedMult(FIRE_ROAM_CHARGE_MAX)).toBe(1.5);
    expect(fireRoamCharge(FIRE_ROAM_RAMP_MS * 2)).toBe(FIRE_ROAM_CHARGE_MAX);
  });

  it("scales the charged burst from flat damage and AP", () => {
    expect(fireRoamBurstDamage(0)).toBe(FIRE_ROAM_BURST_BASE);
    expect(fireRoamBurstDamage(100)).toBe(FIRE_ROAM_BURST_BASE + FIRE_ROAM_BURST_AP_SHARE * 100);
  });
});
