// The camp gates of balance contract 6.3 (bench/campDuel.ts `--types`), held in the suite: starters on FISTS clear a 4-mob camp of
// every normal mob type in at least 80% of their runs (20 of 25), and every elite type's camp falls to at least one starter faction
// on its zone's weapon. The roles (shared mobs.ts MOB_ROLE_DEFS) are tuned against exactly this; the real sim plays every run
// (a few seconds in all), and the runs are deterministic, so a failure is a retune, not noise.
import { describe, expect, it } from "vitest";
import { MOB_TYPES } from "@raid/shared";
import { GATE_NORMAL, typesReport } from "../bench/campDuel";

describe("campDuel --types (the camp gates of 6.3)", () => {
  const verdict = typesReport({ seeds: 5, size: 4, cap: 90, weapon: "fists", quiet: true });

  it("plays every one of the 30 types against the five starter factions", () => {
    expect(verdict.clears).toHaveLength(MOB_TYPES.length);
    for (const c of verdict.clears) expect(c.runs, c.id).toBe(25);
  });

  it("clears every normal type's camp in at least 80% of the fists runs", () => {
    for (const c of verdict.clears.filter((x) => !x.elite)) expect(c.cleared / c.runs, c.id).toBeGreaterThanOrEqual(GATE_NORMAL);
    expect(verdict.normalFails).toEqual([]);
  });

  it("has every elite type's camp cleared by at least one faction on the zone's weapon", () => {
    expect(verdict.eliteFails).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("leaves elite camps for armed players: starters on fists do not clear them all", () => {
    const elites = verdict.clears.filter((x) => x.elite);
    expect(elites.length).toBe(10);
    expect(elites.some((c) => c.cleared < c.runs)).toBe(true);
  });
}, 120_000);
