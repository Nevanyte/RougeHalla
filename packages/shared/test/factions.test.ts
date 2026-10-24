import { describe, expect, it } from "vitest";
import {
  BEATS, duel, FACTION_IDS, FACTIONS, mitigate, scaledFaction, type FactionId, type FactionSpec,
} from "../src/index";

/**
 * Reference results from the Python design engine (testing/engine.py + classes.py, v3 numbers),
 * dt = 0.002: [a, b, winner index, fight seconds, hp of a, hp of b]. Regenerate if the design
 * numbers change (a scratch script that imports both modules and prints duel(a, b, 0.002) rows).
 */
const REFERENCE: Array<[FactionId, FactionId, 0 | 1 | null, number, number, number]> = [
  ["fire", "sentenced", 0, 3.75, 383.183, 0.0],
  ["fire", "plague", 0, 2.128, 354.35, 0.0],
  ["fire", "frost", 1, 13.072, 0.0, 861.104],
  ["fire", "holy", 1, 8.098, 0.0, 1040.071],
  ["sentenced", "fire", 1, 3.75, 0.0, 383.183],
  ["sentenced", "plague", 0, 7.434, 394.71, 0.0],
  ["sentenced", "frost", 0, 16.55, 353.691, 0.0],
  ["sentenced", "holy", 1, 22.674, 0.0, 491.416],
  ["plague", "fire", 1, 2.128, 0.0, 354.35],
  ["plague", "sentenced", 1, 7.434, 0.0, 394.71],
  ["plague", "frost", 0, 37.028, 400.146, 0.0],
  ["plague", "holy", 0, 16.694, 656.382, 0.0],
  ["frost", "fire", 0, 13.072, 861.104, 0.0],
  ["frost", "sentenced", 1, 16.55, 0.0, 353.691],
  ["frost", "plague", 1, 37.028, 0.0, 400.146],
  ["frost", "holy", 0, 61.48, 990.722, 0.0],
  ["holy", "fire", 0, 8.098, 1040.071, 0.0],
  ["holy", "sentenced", 0, 22.674, 491.416, 0.0],
  ["holy", "plague", 1, 16.694, 0.0, 656.382],
  ["holy", "frost", 1, 61.48, 0.0, 990.722],
];

describe("faction duel parity with the Python design engine", () => {
  it.each(REFERENCE)("%s vs %s matches the reference", (a, b, winner, t, hpA, hpB) => {
    const r = duel(FACTIONS[a], FACTIONS[b], 0.002);
    expect(r.winner).toBe(winner);
    expect(r.t).toBeCloseTo(t, 3);
    expect(r.hpA).toBeCloseTo(hpA, 2);
    expect(r.hpB).toBeCloseTo(hpB, 2);
  });

  it("produces exactly the designed 10-edge cycle at every timestep", () => {
    const want = new Set(BEATS.map(([w, l]) => `${w}>${l}`));
    for (const dt of [0.01, 0.005, 0.002, 0.001]) {
      const got = new Set<string>();
      for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
        if (a !== b && duel(FACTIONS[a], FACTIONS[b], dt).winner === 0) got.add(`${a}>${b}`);
      }
      expect(got).toEqual(want);
    }
  });

  it("keeps the cycle under a global power scale", () => {
    for (const k of [0.25, 0.5, 2, 5, 20]) {
      for (const [w, l] of BEATS) {
        expect(duel(scaledFaction(FACTIONS[w], k), scaledFaction(FACTIONS[l], k), 0.005).winner).toBe(0);
      }
    }
  });

  it("reproduces the design sheet's damage multiplier matrix (section 5)", () => {
    const sheet: Record<FactionId, Record<FactionId, number>> = {
      fire: { fire: 0, sentenced: 0.67, plague: 1.0, frost: 0.5, holy: 0.29 },
      sentenced: { fire: 0.44, sentenced: 0, plague: 1.0, frost: 0.5, holy: 0.29 },
      plague: { fire: 0.89, sentenced: 0.53, plague: 0, frost: 0.5, holy: 0.86 },
      frost: { fire: 0.94, sentenced: 0.52, plague: 0.4, frost: 0, holy: 0.93 },
      holy: { fire: 1.0, sentenced: 0.5, plague: 0.33, frost: 0.5, holy: 0 },
    };
    for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
      if (a === b) continue;
      expect(mitigate(1, FACTIONS[a], FACTIONS[b])).toBeCloseTo(sheet[a][b], 2);
    }
  });

  it("matches the design sheet's matchup results (section 6)", () => {
    // [winner, loser, fight seconds, winner HP left in %]
    const sheet: Array<[FactionId, FactionId, number, number]> = [
      ["fire", "sentenced", 3.7, 77], ["fire", "plague", 2.1, 71],
      ["sentenced", "plague", 7.4, 56], ["sentenced", "frost", 16.6, 51],
      ["plague", "frost", 37.0, 40], ["plague", "holy", 16.7, 66],
      ["frost", "holy", 61.5, 57], ["frost", "fire", 13.1, 49],
      ["holy", "fire", 8.1, 72], ["holy", "sentenced", 22.7, 34],
    ];
    expect(sheet.map(([w, l]) => [w, l])).toEqual(BEATS.map(([w, l]) => [w, l]));
    for (const [w, l, seconds, leftPct] of sheet) {
      const r = duel(FACTIONS[w], FACTIONS[l], 0.002);
      expect(r.winner).toBe(0);
      expect(Math.abs(r.t - seconds)).toBeLessThan(0.06);
      expect(Math.round((r.hpA / FACTIONS[w].hp) * 100)).toBe(leftPct);
    }
  });

  it("keeps display names: only holy is renamed", () => {
    for (const id of FACTION_IDS) {
      expect(FACTIONS[id].displayName).toBe(id === "holy" ? "Demon Blood" : FACTIONS[id].name);
    }
    expect(FACTIONS.holy.name).toBe("Holy");
  });
});

/**
 * CLASS_SHEET.md section 4: strip one signature and the owner's matchups must visibly change.
 * A main signature must flip at least one of the owner's four required edges AND move a margin
 * by 20+ points; a sub-mechanic must flip an edge OR move a margin by 15+ points. Margin =
 * winner's remaining HP fraction minus loser's, in points; a shift above 100 means the result
 * reversed. The variants, flip sets and shifts below are the sheet's rows.
 */
describe("identity test: removing a signature changes the matchups", () => {
  type Edge = `${FactionId}>${FactionId}`;
  type Roster = Record<FactionId, FactionSpec>;

  interface Variant {
    owner: FactionId;
    label: string;
    kind: "main" | "sub";
    /** Edges the sheet says flip (and no others). */
    flips: Edge[];
    /** Largest margin shift the sheet reports, in points. */
    sheetShift: number;
    params: Record<string, number>;
  }

  const VARIANTS: Variant[] = [
    { owner: "fire", label: "remove burn and backlash", kind: "main",
      flips: ["fire>sentenced", "fire>plague"], sheetShift: 131, params: { burn: 0, backlash: 0 } },
    { owner: "fire", label: "remove backlash only", kind: "sub",
      flips: ["fire>sentenced", "fire>plague"], sheetShift: 127, params: { backlash: 0 } },
    { owner: "sentenced", label: "remove the mark", kind: "main",
      flips: ["sentenced>plague", "sentenced>frost"], sheetShift: 152, params: { mark_ramp: 0 } },
    // A ramp this steep reaches the cap on the first tick, i.e. the mark is at full strength from t = 0.
    { owner: "sentenced", label: "mark appears at full strength (no ramp)", kind: "sub",
      flips: [], sheetShift: 70, params: { mark_ramp: 1e9 } },
    { owner: "plague", label: "remove the execute", kind: "main",
      flips: ["plague>frost"], sheetShift: 43, params: { execute: 0 } },
    { owner: "plague", label: "remove the flat disease", kind: "sub",
      flips: ["plague>frost", "plague>holy"], sheetShift: 114, params: { plague: 0 } },
    { owner: "frost", label: "remove the slow", kind: "main",
      flips: ["frost>holy"], sheetShift: 108, params: { slow: 0 } },
    { owner: "holy", label: "remove lifesteal", kind: "main",
      flips: ["holy>sentenced"], sheetShift: 37, params: { ls0: 0, ls1: 0 } },
    { owner: "holy", label: "flat lifesteal (no missing-health scaling)", kind: "sub",
      flips: [], sheetShift: 26, params: { ls1: 0 } },
  ];

  const DT = 0.002;
  const edgeKey = (w: FactionId, l: FactionId): Edge => `${w}>${l}`;

  /** For each designed edge: did the designed winner still win, and by how many points. */
  function edgeMargins(roster: Roster): Map<Edge, { holds: boolean; margin: number }> {
    const out = new Map<Edge, { holds: boolean; margin: number }>();
    for (const [w, l] of BEATS) {
      const r = duel(roster[w], roster[l], DT);
      out.set(edgeKey(w, l), {
        holds: r.winner === 0,
        margin: (r.hpA / roster[w].hp - r.hpB / roster[l].hp) * 100,
      });
    }
    return out;
  }

  const base = edgeMargins(FACTIONS);

  it("the unmodified roster holds every designed edge", () => {
    for (const [edge, m] of base) expect(m.holds, edge).toBe(true);
  });

  it.each(VARIANTS)("$owner: $label", (v) => {
    const owner = FACTIONS[v.owner];
    const roster: Roster = { ...FACTIONS, [v.owner]: { ...owner, params: { ...owner.params, ...v.params } } };
    const got = edgeMargins(roster);

    const flipped = BEATS.map(([w, l]) => edgeKey(w, l)).filter((e) => !got.get(e)!.holds);
    expect(new Set(flipped)).toEqual(new Set(v.flips));

    const owned = BEATS.filter(([w, l]) => w === v.owner || l === v.owner).map(([w, l]) => edgeKey(w, l));
    expect(owned).toHaveLength(4);
    const shift = Math.max(...owned.map((e) => Math.abs(got.get(e)!.margin - base.get(e)!.margin)));

    expect(shift).toBeGreaterThanOrEqual(v.sheetShift - 2);
    expect(shift).toBeLessThanOrEqual(v.sheetShift + 2);

    const ownedFlips = flipped.filter((e) => owned.includes(e));
    if (v.kind === "main") {
      expect(ownedFlips.length).toBeGreaterThanOrEqual(1);
      expect(shift).toBeGreaterThanOrEqual(20);
    } else {
      expect(ownedFlips.length >= 1 || shift >= 15).toBe(true);
    }
  });
});
