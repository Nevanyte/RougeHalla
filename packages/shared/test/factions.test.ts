import { describe, expect, it } from "vitest";
import {
  duel, FACTION_IDS, FACTION_PAIRS, FACTIONS, scaledFaction, type FactionId, type FactionSpec,
} from "../src/index";

/**
 * Reference results from the Python design engine (testing/engine.py + classes.py, the faction rework's sheet: no counters,
 * testing/TUNING_BALANCE.md section 13), dt = 0.002: [a, b, winner index, fight seconds, hp of a, hp of b]. Regenerate if the design numbers
 * change (testing/matchup_band.py --reference prints these rows).
 */
const REFERENCE: Array<[FactionId, FactionId, 0 | 1 | null, number, number, number]> = [
  ["fire", "sentenced", 0, 10.164, 25.927, 0.0],
  ["fire", "plague", 1, 8.704, 0.0, 1.484],
  ["fire", "frost", 1, 15.062, 0.0, 2.891],
  ["fire", "holy", 1, 13.016, 0.0, 21.25],
  ["sentenced", "fire", 1, 10.164, 0.0, 25.927],
  ["sentenced", "plague", 1, 16.082, 0.0, 1.449],
  ["sentenced", "frost", 1, 27.81, 0.0, 16.691],
  ["sentenced", "holy", 1, 24.032, 0.0, 11.059],
  ["plague", "fire", 0, 8.704, 1.484, 0.0],
  ["plague", "sentenced", 0, 16.082, 1.449, 0.0],
  ["plague", "frost", 1, 23.854, 0.0, 2.545],
  ["plague", "holy", 0, 20.406, 10.191, 0.0],
  ["frost", "fire", 0, 15.062, 2.891, 0.0],
  ["frost", "sentenced", 0, 27.81, 16.691, 0.0],
  ["frost", "plague", 0, 23.854, 2.545, 0.0],
  ["frost", "holy", 1, 35.722, 0.0, 30.411],
  ["holy", "fire", 0, 13.016, 21.25, 0.0],
  ["holy", "sentenced", 0, 24.032, 11.059, 0.0],
  ["holy", "plague", 1, 20.406, 0.0, 10.191],
  ["holy", "frost", 0, 35.722, 30.411, 0.0],
];

/** Signed hp left of `a` (its share when it wins, minus `b`'s share when `b` does). */
function margin(ra: FactionSpec, rb: FactionSpec, dt = 0.002): number {
  const r = duel(ra, rb, dt);
  return r.winner === 0 ? r.hpA / ra.hp : r.winner === 1 ? -r.hpB / rb.hp : 0;
}

/** The faction rework's bounds (testing/test_rpsls.py holds the same): the weapon-less engine at the sheet's own pace. */
const MAX_MARGIN = 0.1;
const MEAN_MARGIN = 0.06;

describe("faction duel parity with the Python design engine", () => {
  it.each(REFERENCE)("%s vs %s matches the reference", (a, b, winner, t, hpA, hpB) => {
    const r = duel(FACTIONS[a], FACTIONS[b], 0.002);
    expect(r.winner).toBe(winner);
    expect(r.t).toBeCloseTo(t, 3);
    expect(r.hpA).toBeCloseTo(hpA, 2);
    expect(r.hpB).toBeCloseTo(hpB, 2);
  });

  it("has no counters: every pair ends near an even fight at every timestep", () => {
    for (const dt of [0.01, 0.005, 0.002]) {
      const ms = FACTION_PAIRS.map(([a, b]) => margin(FACTIONS[a], FACTIONS[b], dt));
      for (const [i, m] of ms.entries()) expect(Math.abs(m), `${FACTION_PAIRS[i]!.join("-")} at dt ${dt}`).toBeLessThanOrEqual(MAX_MARGIN);
      expect(ms.reduce((s, m) => s + Math.abs(m), 0) / ms.length).toBeLessThanOrEqual(MEAN_MARGIN);
    }
  });

  it("lists each unordered pair once", () => {
    const keys = FACTION_PAIRS.map(([a, b]) => [a, b].sort().join("-"));
    expect(new Set(keys).size).toBe(10);
    for (const [a, b] of FACTION_PAIRS) expect(a).not.toBe(b);
  });

  it("keeps every margin under a global power scale", () => {
    for (const k of [0.25, 0.5, 2, 5]) {
      for (const [a, b] of FACTION_PAIRS) {
        const base = margin(FACTIONS[a], FACTIONS[b], 0.005);
        expect(Math.abs(margin(scaledFaction(FACTIONS[a], k), scaledFaction(FACTIONS[b], k), 0.005) - base)).toBeLessThan(0.02);
      }
    }
  });

  it("gives every faction armor equal to its shield, so no damage type counters a defense profile", () => {
    for (const id of FACTION_IDS) expect(FACTIONS[id].armor, id).toBe(FACTIONS[id].shield);
  });

  it("keeps the identities in the numbers: Fire the frailest, Frost the best defended, Plague the fastest", () => {
    const by = (key: (f: FactionSpec) => number) => [...FACTION_IDS].sort((x, y) => key(FACTIONS[y]) - key(FACTIONS[x]));
    expect(by((f) => -f.hp)[0]).toBe("fire");
    expect(by((f) => -f.armor)[0]).toBe("fire");
    expect(by((f) => f.armor)[0]).toBe("frost");
    expect(by((f) => f.rate)[0]).toBe("plague");
    expect(FACTIONS.holy.sustain).toBe("radiant");
  });

  it("keeps display names: only holy is renamed", () => {
    for (const id of FACTION_IDS) {
      expect(FACTIONS[id].displayName).toBe(id === "holy" ? "Holy" : FACTIONS[id].name);
    }
    expect(FACTIONS.holy.name).toBe("Holy");
  });
});

/**
 * With no counters left, an identity is load-bearing when taking it away moves its owner's pairs a long way (testing/test_rpsls.py
 * section 7): each main signature must move at least one of its owner's four margins by ID_MIN_SHIFT points of hp.
 */
describe("identity test: removing a signature moves its owner's matchups", () => {
  const ID_MIN_SHIFT = 15;
  const VARIANTS: Array<{ owner: FactionId; label: string; params: Record<string, number> }> = [
    { owner: "fire", label: "remove burn and backlash", params: { burn: 0, backlash: 0 } },
    { owner: "sentenced", label: "remove the mark", params: { mark_pct: 0, mark_kill: 0 } },
    { owner: "plague", label: "remove disease and execute", params: { plague: 0, execute: 0 } },
    { owner: "frost", label: "remove the slow", params: { slow: 0 } },
    { owner: "holy", label: "remove lifesteal", params: { ls0: 0, ls1: 0 } },
  ];
  it.each(VARIANTS)("$owner: $label", (v) => {
    const owner = FACTIONS[v.owner];
    const roster: Record<FactionId, FactionSpec> = { ...FACTIONS, [v.owner]: { ...owner, params: { ...owner.params, ...v.params } } };
    const owned = FACTION_PAIRS.filter(([a, b]) => a === v.owner || b === v.owner);
    expect(owned).toHaveLength(4);
    const shift = Math.max(...owned.map(([a, b]) => Math.abs(margin(roster[a], roster[b]) - margin(FACTIONS[a], FACTIONS[b])) * 100));
    expect(shift).toBeGreaterThanOrEqual(ID_MIN_SHIFT);
  });
});
