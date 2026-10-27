import { describe, expect, it } from "vitest";
import { HP_RACE_CAP, hpRaceMult, PVP_F0, PVP_FMAX, PVP_P0, pvpFactor, SIGNATURE_SHARES } from "../src/index";

describe("pvpFactor", () => {
  it("is the contract's curve: 0.75 + 2.25 (1 - exp(-P / 6))", () => {
    expect([PVP_F0, PVP_FMAX, PVP_P0]).toEqual([0.75, 3.0, 6]);
    const want: Array<[number, number]> = [[0, 0.75], [1, 1.10], [2, 1.39], [3, 1.64], [5, 2.02], [6, 2.17], [10, 2.58], [15, 2.82]];
    for (const [p, f] of want) expect(pvpFactor(p), `P ${p}`).toBeCloseTo(f, 2);
  });

  it("rises with power, never past the maximum, and treats a bad power as none", () => {
    let prev = 0;
    for (let p = 0; p <= 60; p++) {
      const f = pvpFactor(p);
      expect(f).toBeGreaterThan(prev);
      expect(f).toBeLessThanOrEqual(PVP_FMAX);
      prev = f;
    }
    expect(pvpFactor(-3)).toBe(PVP_F0);
    expect(pvpFactor(Number.NaN)).toBe(PVP_F0);
    expect(pvpFactor(Infinity)).toBeCloseTo(PVP_FMAX, 9);
  });

  it("gains half of its growth by P 4: the snowball brake", () => {
    expect(pvpFactor(4)).toBeGreaterThan((PVP_F0 + PVP_FMAX) / 2 - 0.1);
  });
});

describe("hpRaceMult", () => {
  it("is 1 / the hp fraction between 1 and the cap", () => {
    expect(hpRaceMult(1)).toBe(1);
    expect(hpRaceMult(0.5)).toBe(2);
    expect(hpRaceMult(0.8)).toBeCloseTo(1.25, 9);
    expect(hpRaceMult(0.2)).toBe(HP_RACE_CAP);
    expect(hpRaceMult(0)).toBe(HP_RACE_CAP);
    expect(hpRaceMult(2)).toBe(1);
  });
});

describe("SIGNATURE_SHARES (decision D6)", () => {
  it("types each signature: burn and disease magic, backlash physical, the mark true", () => {
    expect(SIGNATURE_SHARES.burn).toEqual({ phys: 0, magic: 1, true: 0 });
    expect(SIGNATURE_SHARES.disease).toEqual({ phys: 0, magic: 1, true: 0 });
    expect(SIGNATURE_SHARES.backlash).toEqual({ phys: 1, magic: 0, true: 0 });
    expect(SIGNATURE_SHARES.mark).toEqual({ phys: 0, magic: 0, true: 1 });
  });

  it("every entry is a whole packet: the shares sum to 1", () => {
    for (const s of Object.values(SIGNATURE_SHARES)) expect(s.phys + s.magic + s.true).toBe(1);
  });
});
