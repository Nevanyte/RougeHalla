import { describe, expect, it } from "vitest";
import { FACTION_IDS, WEAPON_BEATS, type FactionId } from "@raid/shared";
import { runDuel } from "../src/harness/duel";
import { edgeName, type Setup } from "../src/harness/matrix";
import { parityReport } from "../src/harness/parity";
import { buildReport } from "../src/harness/report";

// The harness is report-only: these tests check that it runs and that its parity block agrees with realtime.py. They
// never look at who wins a duel.

const ONE_SETUP: readonly Setup[] = [{ distance: 300, delayTicks: [0, 0], angle: 0.1 }];

describe("weapon duel harness", () => {
  // One faction, one setup, a short cap: ten short duels.
  const report = buildReport({ quick: true, factions: ["fire"], setups: ONE_SETUP, capSeconds: 12 });

  it("runs every one of the ten designed weapon edges", () => {
    expect(WEAPON_BEATS).toHaveLength(10);
    expect(report.edges).toHaveLength(10);
    for (const edge of WEAPON_BEATS) {
      const cells = report.cells.filter((c) => c.edge[0] === edge[0] && c.edge[1] === edge[1]);
      expect(cells, edgeName(edge)).toHaveLength(1);
      expect(cells[0]!.results.length).toBeGreaterThan(0);
      for (const r of cells[0]!.results) {
        expect(["kill", "draw", "cap"]).toContain(r.end);
        expect(r.seconds).toBeGreaterThan(0);
        expect(r.seconds).toBeLessThanOrEqual(12 + 0.1);
      }
      expect(report.text, edgeName(edge)).toContain(edgeName(edge));
    }
  });

  it("prints the matrix, the watch list and the parity block", () => {
    expect(report.text).toContain("MATRIX");
    expect(report.text).toContain("WATCH LIST");
    expect(report.text).toContain("Parity with testing/realtime.py");
    // The two watched edges are flagged in the matrix.
    const flagged = report.text.split("\n").filter((l) => l.includes("<- watch"));
    expect(flagged.map((l) => l.split(/\s{2,}/)[0])).toEqual(["sword > wand", "wand > bow", "axe > wand"].sort((a, b) => order(a) - order(b)));
  });

  it("matches the realtime.py interval, per-hit and backlash numbers to 1e-9", () => {
    const parity = parityReport();
    expect(parity.rows).toHaveLength(FACTION_IDS.length * 5);
    expect(parity.maxIntervalDiff).toBeLessThan(1e-9);
    expect(parity.maxPerHitDiff).toBeLessThan(1e-9);
    expect(parity.maxBacklashDiff).toBeLessThan(1e-9);
    expect(parity.maxDiff).toBeLessThan(1e-9);
    expect(report.parity.maxDiff).toBeLessThan(1e-9);
  });
});

function order(edge: string): number {
  return WEAPON_BEATS.findIndex((e) => edgeName(e) === edge);
}

describe("duel engine", () => {
  it("repeats exactly for the same spec", () => {
    const spec = { faction: "holy" as FactionId, weapons: ["wand", "bow"] as const, distance: 300, angle: 0.8, capSeconds: 8, seed: 7 };
    const a = runDuel(spec);
    const b = runDuel(spec);
    expect({ ...a, spec: undefined }).toEqual({ ...b, spec: undefined });
  });

  it("drives both clients through the real inputs: each loosing arrows and balls, each swinging", () => {
    const ranged = runDuel({ faction: "fire", weapons: ["bow", "wand"], distance: 300, capSeconds: 8, seed: 3 });
    expect(ranged.counts.shots[0]).toBeGreaterThan(0);
    expect(ranged.counts.shots[1]).toBeGreaterThan(0);
    const melee = runDuel({ faction: "fire", weapons: ["sword", "axe"], distance: 120, capSeconds: 8, seed: 3 });
    expect(melee.counts.attacks[0]).toBeGreaterThan(0);
    expect(melee.counts.attacks[1]).toBeGreaterThan(0);
  });

  it("holds a fighter back for its start offset", () => {
    let firstShot: [number, number] = [-1, -1];
    runDuel({
      faction: "fire", weapons: ["bow", "bow"], distance: 300, delayTicks: [20, 0], capSeconds: 4, seed: 5,
      onTick: (world, tick) => {
        for (const pr of world.state.projectiles.values()) {
          const i = pr.owner === "f0" ? 0 : 1;
          if (firstShot[i] < 0) firstShot[i] = tick;
        }
      },
    });
    // f1 starts at once and looses at its full draw; f0 does nothing for 20 ticks, then needs its own draw.
    expect(firstShot[1]).toBeGreaterThanOrEqual(0);
    expect(firstShot[0]).toBeGreaterThanOrEqual(20);
  });

  it("starts every faction in both arenas without a fighter inside a wall", () => {
    for (const faction of FACTION_IDS) {
      for (const arena of ["open", "pillars"] as const) {
        const r = runDuel({ faction, weapons: ["sword", "sword"], distance: 450, angle: 0.8, arena, capSeconds: 3, seed: 11 });
        expect(r.seconds).toBeGreaterThan(0);
      }
    }
  });

  it("never lets a duel run past its cap", () => {
    const r = runDuel({ faction: "frost", weapons: ["shield", "shield"], distance: 300, capSeconds: 2, seed: 1 });
    expect(r.end).toBe("cap");
    expect(r.seconds).toBeCloseTo(2, 5);
  });
});
