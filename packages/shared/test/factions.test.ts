import { describe, expect, it } from "vitest";
import {
  BEATS, duel, FACTION_IDS, FACTIONS, mitigate, scaledFaction, type FactionId, type FactionSpec,
} from "../src/index";

/**
 * Reference results from the Python design engine (testing/engine.py + classes.py, the balance pass's compressed sheet with
 * typed signatures), dt = 0.002: [a, b, winner index, fight seconds, hp of a, hp of b]. Regenerate if the design numbers
 * change (testing/matchup_band.py --reference prints these rows).
 */
const REFERENCE: Array<[FactionId, FactionId, 0 | 1 | null, number, number, number]> = [
  ["fire", "sentenced", 0, 11.05, 334.735, 0.0],
  ["fire", "plague", 0, 8.066, 282.735, 0.0],
  ["fire", "frost", 1, 11.266, 0.0, 405.601],
  ["fire", "holy", 1, 9.156, 0.0, 301.104],
  ["sentenced", "fire", 1, 11.05, 0.0, 334.735],
  ["sentenced", "plague", 0, 21.482, 161.967, 0.0],
  ["sentenced", "frost", 0, 27.668, 105.759, 0.0],
  ["sentenced", "holy", 1, 26.484, 0.0, 284.076],
  ["plague", "fire", 1, 8.066, 0.0, 282.735],
  ["plague", "sentenced", 1, 21.482, 0.0, 161.967],
  ["plague", "frost", 0, 32.174, 365.014, 0.0],
  ["plague", "holy", 0, 34.972, 275.191, 0.0],
  ["frost", "fire", 0, 11.266, 405.601, 0.0],
  ["frost", "sentenced", 1, 27.668, 0.0, 105.759],
  ["frost", "plague", 1, 32.174, 0.0, 365.014],
  ["frost", "holy", 0, 26.814, 221.825, 0.0],
  ["holy", "fire", 0, 9.156, 301.104, 0.0],
  ["holy", "sentenced", 0, 26.484, 284.076, 0.0],
  ["holy", "plague", 1, 34.972, 0.0, 275.191],
  ["holy", "frost", 1, 26.814, 0.0, 221.825],
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
      fire: { fire: 0, sentenced: 0.45, plague: 1.0, frost: 0.34, holy: 0.29 },
      sentenced: { fire: 0.80, sentenced: 0, plague: 0.77, frost: 0.52, holy: 0.54 },
      plague: { fire: 0.94, sentenced: 0.43, plague: 0, frost: 0.74, holy: 0.86 },
      frost: { fire: 0.97, sentenced: 0.43, plague: 0.41, frost: 0, holy: 0.93 },
      holy: { fire: 1.0, sentenced: 0.43, plague: 0.34, frost: 0.83, holy: 0 },
    };
    for (const a of FACTION_IDS) for (const b of FACTION_IDS) {
      if (a === b) continue;
      expect(mitigate(1, FACTIONS[a], FACTIONS[b])).toBeCloseTo(sheet[a][b], 2);
    }
  });

  it("matches the design sheet's matchup results (section 6)", () => {
    // [winner, loser, fight seconds, winner HP left in %]
    const sheet: Array<[FactionId, FactionId, number, number]> = [
      ["fire", "sentenced", 11.05, 40], ["fire", "plague", 8.066, 34],
      ["sentenced", "plague", 21.482, 18], ["sentenced", "frost", 27.668, 12],
      ["plague", "frost", 32.174, 27], ["plague", "holy", 34.972, 20],
      ["frost", "holy", 26.814, 18], ["frost", "fire", 11.266, 34],
      ["holy", "fire", 9.156, 22], ["holy", "sentenced", 26.484, 20],
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
      flips: ["fire>sentenced", "fire>plague"], sheetShift: 92.9, params: { burn: 0, backlash: 0 } },
    { owner: "fire", label: "remove backlash only", kind: "sub",
      flips: ["fire>sentenced", "fire>plague"], sheetShift: 77.7, params: { backlash: 0 } },
    { owner: "sentenced", label: "remove the mark", kind: "main",
      flips: ["sentenced>plague", "sentenced>frost"], sheetShift: 90.3, params: { mark_pct: 0, mark_kill: 0 } },
    // A tier clock this slow never reaches tier 2: no tax, no suppression, no amplifier, no denial.
    { owner: "sentenced", label: "the mark never climbs a tier", kind: "sub",
      flips: ["sentenced>plague", "sentenced>frost"], sheetShift: 42.5, params: { tier_hits: 1e9 } },
    { owner: "sentenced", label: "remove the output suppression only", kind: "sub",
      flips: ["sentenced>plague", "sentenced>frost"], sheetShift: 25.0, params: { suppress: 1 } },
    { owner: "sentenced", label: "remove the attack-speed tax only", kind: "sub",
      flips: ["sentenced>plague"], sheetShift: 19.7, params: { tax_keep: 1, tax_cap: 1e9 } },
    { owner: "plague", label: "remove the execute", kind: "main",
      flips: ["plague>holy"], sheetShift: 31.3, params: { execute: 0 } },
    { owner: "plague", label: "remove the flat disease", kind: "sub",
      flips: ["plague>frost", "plague>holy"], sheetShift: 78, params: { plague: 0 } },
    { owner: "frost", label: "remove the slow", kind: "main",
      flips: ["frost>holy"], sheetShift: 68, params: { slow: 0 } },
    { owner: "holy", label: "remove lifesteal", kind: "main",
      flips: ["holy>fire", "holy>sentenced"], sheetShift: 28.9, params: { ls0: 0, ls1: 0 } },
    { owner: "holy", label: "flat lifesteal (no missing-health scaling)", kind: "sub",
      flips: ["holy>sentenced"], sheetShift: 23.5, params: { ls1: 0 } },
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
