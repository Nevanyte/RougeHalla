// Mob strength on FISTS, held in the suite (balance contract A11, bench/mobDuel.ts --style stand): a starter with an empty hand (how every
// run starts) beats ONE normal mob of every zone almost always and keeps most of its hp, and wins against an elite most of the
// time. The grid pools every type of a zone (seed s meets the zone's normal type (s - 1) mod 4 and its elite (s - 1) mod 2), so the
// roles (hp, damage, speed, weapon) are all in it. The runs are deterministic: a failure is a retune.
import { describe, expect, it } from "vitest";
import { FACTION_IDS, MOB_TYPES } from "@raid/shared";
import { cellStats, runGrid, runMobDuel, typeForSeed, verdict } from "../bench/mobDuel";

describe("mobDuel on fists (A11)", () => {
  const normal = runGrid({ elite: false, style: "stand", seeds: 4 });
  const elite = runGrid({ elite: true, style: "stand", seeds: 4 });

  it("beats a normal mob in at least 23 of the 25 pairings, with at least 75% of its hp left on average", () => {
    const v = verdict(normal);
    expect(25 - v.pairingsBelow90).toBeGreaterThanOrEqual(23);
    expect(v.overallMean).toBeGreaterThanOrEqual(0.75);
  });

  it("beats an elite in at least 18 of the 25 pairings", () => {
    expect(verdict(elite).pairingsWon).toBeGreaterThanOrEqual(18);
  });

  it("meets every normal type of a zone across four seeds, and both of its elites across two", () => {
    for (const zone of FACTION_IDS) {
      const normals = [1, 2, 3, 4].map((s) => typeForSeed(zone, false, s));
      expect(new Set(normals).size).toBe(4);
      const elites = [1, 2].map((s) => typeForSeed(zone, true, s));
      expect(new Set(elites).size).toBe(2);
      for (const id of [...normals, ...elites]) expect(MOB_TYPES.find((t) => t.id === id)!.zone).toBe(zone);
    }
    for (const player of FACTION_IDS) for (const region of FACTION_IDS) {
      expect(normal.cells[player][region].results.map((r) => r.spec.type)).toEqual([1, 2, 3, 4].map((s) => typeForSeed(region, false, s)));
    }
  });

  it("is deterministic and fights the type it was given", () => {
    const a = runMobDuel({ player: "fire", region: "frost", elite: false, type: "frostbowSentry", seed: 1, style: "stand" });
    expect(runMobDuel({ player: "fire", region: "frost", elite: false, type: "frostbowSentry", seed: 1, style: "stand" })).toEqual(a);
    expect(a.spec.type).toBe("frostbowSentry");
    expect(cellStats([a]).n).toBe(1);
  });
}, 120_000);
