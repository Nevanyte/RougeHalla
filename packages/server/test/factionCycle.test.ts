// The faction-cycle harness (src/harness/factionCycle.ts, trades mode) against testing/realtime.py: every phase pair of
// all 70 cells (ten edges x the five loop weapons and fists, plus the ten signature openings) must give the same winner and the
// same hp fractions as the Python reference at the game's duel pace (the PvP factor off: the cycle at the design pace).
//
// fixtures/realtime-paced.json is that reference's output. Regenerate it from the repo root after changing realtime.py,
// the faction numbers, weapon timings or DUEL_PACE (needs python3 with numpy):
//   python3 testing/realtime_paced.py --k 2 --nmax 5 --sub 1 --pairs > packages/server/test/fixtures/realtime-paced.json
// `npm run harness:factions -- --python` prints the same comparison for any grid, with the full tables.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DUEL_PACE, type FactionId, type WeaponId } from "@raid/shared";
import { cellStats, phaseGrid, runCell, type CellStats, type DuelResult, type Fighter } from "../src/harness/factionCycle";

interface FixtureCell {
  kind: "mirror" | "sig";
  a: { faction: FactionId; weapon: WeaponId };
  b: { faction: FactionId; weapon: WeaponId };
  stats: CellStats;
  /** [win, frac0, frac1, t], a-major. */
  pairs: [number, number, number, number][];
}
interface Fixture { k: number; sub: number; nmax: number; cells: FixtureCell[] }

const fixture: Fixture = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "realtime-paced.json"), "utf8"),
);

/** The fixture rounds hp fractions to 6 decimals. */
const FRAC_TOLERANCE = 1e-5;
/** ... and fight times to 4 (the sim's are exact multiples of the tick, up to float noise). */
const T_TOLERANCE = 1e-3;

const label = (c: FixtureCell): string => `${c.kind} ${c.a.faction}(${c.a.weapon}) > ${c.b.faction}(${c.b.weapon})`;

const maxDiff = (xs: number[], ys: number[]): number => Math.max(0, ...xs.map((x, i) => Math.abs(x - ys[i]!)));

describe("fixture", () => {
  it("was generated at the game's duel pace, with every cell and a full grid of pairs", () => {
    expect(fixture.k).toBe(DUEL_PACE);
    expect(fixture.cells).toHaveLength(70);
    expect(fixture.cells.filter((c) => c.kind === "mirror")).toHaveLength(60);
    expect(fixture.cells.filter((c) => c.kind === "sig")).toHaveLength(10);
    for (const c of fixture.cells) expect(c.pairs.length).toBe(c.stats.P);
  });
});

describe("parity with realtime.py (trades mode)", () => {
  for (const cell of fixture.cells) {
    it(label(cell), () => {
      const results = runCell(cell.a, cell.b, { nmax: fixture.nmax, sub: fixture.sub });
      expect(results).toHaveLength(cell.pairs.length);

      const winners = results.map((r) => r.win);
      expect(winners).toEqual(cell.pairs.map((p) => p[0]));
      expect(maxDiff(results.map((r) => r.frac0), cell.pairs.map((p) => p[1]))).toBeLessThan(FRAC_TOLERANCE);
      expect(maxDiff(results.map((r) => r.frac1), cell.pairs.map((p) => p[2]))).toBeLessThan(FRAC_TOLERANCE);

      const stats = cellStats(results);
      expect(stats.P).toBe(cell.stats.P);
      expect(stats.rate).toBeCloseTo(cell.stats.rate, 9);
      expect(stats.draws).toBeCloseTo(cell.stats.draws, 9);
      expect(Math.abs(stats.worst - cell.stats.worst)).toBeLessThan(FRAC_TOLERANCE);
      expect(Math.abs(stats.mean - cell.stats.mean)).toBeLessThan(FRAC_TOLERANCE);

      expect(maxDiff(results.map((r) => r.t), cell.pairs.map((p) => p[3]))).toBeLessThan(T_TOLERANCE);
      expect(Math.abs(stats.t - cell.stats.t)).toBeLessThan(T_TOLERANCE);
      expect(Math.abs(stats.tmax - cell.stats.tmax)).toBeLessThan(T_TOLERANCE);
    });
  }
});

describe("phaseGrid", () => {
  const fireAxe: Fighter = { faction: "fire", weapon: "axe" };
  const sentencedSword: Fighter = { faction: "sentenced", weapon: "sword" };
  const frostShield: Fighter = { faction: "frost", weapon: "shield" };
  // Fire swings 0.6/s and the axe adds 40%: one swing per 1 / (0.6 x 1.4) = 1.190476 s, which is 23.8 ticks of 50 ms,
  // so the grid has 24 offsets, 1.190476 / 24 = 0.049603 s apart.
  const interval = 1 / (0.6 * 1.4);

  it("spreads one offset per started tick of the interval, evenly from zero", () => {
    const { offs, m } = phaseGrid(fireAxe, sentencedSword);
    expect(m).toBe(1);
    expect(offs).toHaveLength(24);
    expect(offs[0]).toBe(0);
    offs.forEach((o, i) => expect(o).toBeCloseTo((i * interval) / 24, 12));
    expect(offs[23]!).toBeLessThan(interval);
  });

  it("sub refines the grid", () => {
    const { offs } = phaseGrid(fireAxe, sentencedSword, 2);
    expect(offs).toHaveLength(48);
    expect(offs[1]).toBeCloseTo(interval / 48, 12);
  });

  it("stretches the span to interval / 0.48 for a side under Frost's chill, at the same spacing", () => {
    const { offs, m } = phaseGrid(fireAxe, frostShield);
    const span = interval / 0.48;
    expect(m).toBeCloseTo(0.48, 12);
    // 2.480159 s is 49.6 ticks: 50 offsets, 0.049603 s apart, the last one a step short of the span.
    expect(offs).toHaveLength(50);
    expect(offs[1]).toBeCloseTo(interval / 24, 12);
    expect(offs[49]! + offs[1]!).toBeCloseTo(span, 12);
  });

  it("thins to nmax offsets that include the first and the last", () => {
    const full = phaseGrid(fireAxe, sentencedSword).offs;
    const thin = phaseGrid(fireAxe, sentencedSword, 1, 5).offs;
    // Indices 0, 5.75, 11.5, 17.25, 23 of the 24, rounded: 0, 6, 12, 17, 23.
    expect(thin).toEqual([0, 6, 12, 17, 23].map((i) => full[i]));
    expect(thin[0]).toBe(0);
    expect(thin[4]).toBe(full[23]);
  });

  it("rounds a tie in the thinning to the even index, as numpy does", () => {
    // Plague's sword: 1 / (1.85 x 2.15) = 0.251414 s, 5.03 ticks, 6 offsets. Three of them sit at indices 0, 2.5 and 5;
    // numpy rounds 2.5 to 2 where Math.round would pick 3.
    const plagueSword: Fighter = { faction: "plague", weapon: "sword" };
    const fire: Fighter = { faction: "fire", weapon: "sword" };
    const full = phaseGrid(plagueSword, fire).offs;
    expect(full).toHaveLength(6);
    expect(phaseGrid(plagueSword, fire, 1, 3).offs).toEqual([full[0], full[2], full[5]]);
  });

  it("leaves a grid alone when nmax is not smaller", () => {
    const full = phaseGrid(fireAxe, sentencedSword).offs;
    expect(phaseGrid(fireAxe, sentencedSword, 1, 24).offs).toEqual(full);
    expect(phaseGrid(fireAxe, sentencedSword, 1, 99).offs).toEqual(full);
  });
});

describe("cellStats", () => {
  const r = (win: DuelResult["win"], frac0: number, frac1: number, t: number): DuelResult => ({ win, frac0, frac1, t });

  it("summarises the first fighter: wins, hp left where it won, draws, median and longest fight", () => {
    const stats = cellStats([r(0, 0.8, 0, 3), r(0, 0.6, 0, 5), r(1, 0, 0.5, 4), r(-1, 0, 0, 400)]);
    expect(stats.P).toBe(4);
    expect(stats.rate).toBe(0.5);
    expect(stats.draws).toBe(0.25);
    // A loss and a draw leave it 0 hp, so they pull the worst down to 0 and the mean to (0.8 + 0.6) / 4.
    expect(stats.worst).toBe(0);
    expect(stats.mean).toBeCloseTo(0.35, 12);
    expect(stats.t).toBe(4.5);
    expect(stats.tmax).toBe(400);
  });

  it("takes the middle fight time for an odd count and the worst winner hp for a clean sweep", () => {
    const stats = cellStats([r(0, 0.7, 0, 9), r(0, 0.5, 0, 2), r(0, 0.9, 0, 4)]);
    expect(stats.rate).toBe(1);
    expect(stats.draws).toBe(0);
    expect(stats.worst).toBe(0.5);
    expect(stats.mean).toBeCloseTo(0.7, 12);
    expect(stats.t).toBe(4);
    expect(stats.tmax).toBe(9);
  });

  it("ignores the second fighter's hp, and counts a loss by the first fighter as a miss", () => {
    const stats = cellStats([r(1, 0, 0.9, 6), r(1, 0, 0.1, 7)]);
    expect(stats.rate).toBe(0);
    expect(stats.worst).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.draws).toBe(0);
    expect(stats.t).toBe(6.5);
  });
});
