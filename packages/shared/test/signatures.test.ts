import { describe, expect, it } from "vitest";
import {
  BEATS, bonusMultiplier, burnDps, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier, damageFlash,
  DAMAGE_FLASH_FULL_SHARE, DAMAGE_FLASH_MIN_SHARE, diseaseDps, DOT_FX_MS, ENGAGE_LINGER_SECONDS, ENGAGE_TRADE_SECONDS,
  engageRange, FACTION_IDS, FACTIONS, factionEdge, HEAL_LOCKOUT_SECONDS, isDot, markDps, markShare, MATCHUP_FULL_RANGE,
  MATCHUP_RANGE, matchupScore, matchupTint, pacedFaction, TARGET_FORGET_SECONDS, WEAPON_IDS, WEAPONS,
  type FactionId, type FactionSpec, type SignatureKind, type WeaponId,
} from "../src/index";

const SHEET = FACTIONS;
const PACED: Readonly<Record<FactionId, FactionSpec>> = Object.fromEntries(
  FACTION_IDS.map((id) => [id, pacedFaction(FACTIONS[id])]),
) as Record<FactionId, FactionSpec>;

/** The weakest flash a hit past the threshold shows (private to signatures.ts). */
const FLASH_FLOOR = 0.25;

describe("timing constants", () => {
  it("have the designed values", () => {
    expect(ENGAGE_LINGER_SECONDS).toBe(1.25);
    expect(ENGAGE_TRADE_SECONDS).toBe(3);
    expect(TARGET_FORGET_SECONDS).toBe(10);
    expect(HEAL_LOCKOUT_SECONDS).toBe(3);
    expect(DOT_FX_MS).toBe(500);
    expect(CHILL_MOVE_RADIUS).toBe(100);
    expect(CHILL_MOVE_MULT).toBe(0.4);
  });

  it("nest: the linger is shorter than the trade window, which is shorter than the forget time", () => {
    expect(ENGAGE_LINGER_SECONDS).toBeLessThan(ENGAGE_TRADE_SECONDS);
    expect(ENGAGE_TRADE_SECONDS).toBeLessThan(TARGET_FORGET_SECONDS);
  });

  it("the chill's walking slow is the same 0.4 as Frost's cooldown slow", () => {
    expect(CHILL_MOVE_MULT).toBeCloseTo(chillMultiplier(FACTIONS.frost), 12);
  });
});

describe("engageRange", () => {
  it.each<[WeaponId | null, number]>([
    ["sword", 64 + 12],
    ["axe", 60 + 12],
    ["shield", 44 + 12],
    ["bow", 480 + 14],
    ["wand", 420 + 14],
    [null, 0],
  ])("%s reaches %d centre to centre", (weapon, range) => {
    expect(engageRange(weapon)).toBe(range);
  });

  it("is the arc plus the target's body for a swing, the flight range plus the hit reach for a projectile", () => {
    for (const w of WEAPON_IDS) {
      const shape = WEAPONS[w].shape;
      const expected = shape.kind === "arc" ? shape.reach + 12 : shape.range + 14;
      expect(engageRange(w), w).toBe(expected);
    }
  });
});

describe("bonusMultiplier", () => {
  it.each(WEAPON_IDS)("%s is its dpsMult", (w) => {
    expect(bonusMultiplier(w)).toBe(WEAPONS[w].dpsMult);
  });

  it("matches the design numbers and is 0 with an empty hand", () => {
    expect(WEAPON_IDS.map((w) => bonusMultiplier(w))).toEqual([1.0, 0.8, 0.85, 0.75, 0.9]);
    expect(bonusMultiplier(null)).toBe(0);
  });
});

describe("burnDps", () => {
  it("is Fire's burn: 10 on the sheet, 20 paced", () => {
    expect(burnDps(SHEET.fire)).toBe(10);
    expect(burnDps(PACED.fire)).toBe(20);
  });

  it.each(FACTION_IDS.filter((f) => f !== "fire"))("is 0 for %s", (f) => {
    expect(burnDps(SHEET[f])).toBe(0);
    expect(burnDps(PACED[f])).toBe(0);
  });
});

describe("diseaseDps", () => {
  it("is Plague's plague plus the execute that grows below half hp (sheet: 40 and 2050)", () => {
    const p = SHEET.plague;
    expect(diseaseDps(p, 1.0)).toBe(40);
    expect(diseaseDps(p, 0.75)).toBe(40);
    expect(diseaseDps(p, 0.5)).toBe(40);
    expect(diseaseDps(p, 0.25)).toBeCloseTo(40 + 2050 * 0.25, 9);
    expect(diseaseDps(p, 0)).toBeCloseTo(40 + 2050 * 0.5, 9);
  });

  it("paced: the plague and the execute are doubled", () => {
    const p = PACED.plague;
    expect(diseaseDps(p, 1.0)).toBe(80);
    expect(diseaseDps(p, 0.5)).toBe(80);
    expect(diseaseDps(p, 0.25)).toBeCloseTo(80 + 4100 * 0.25, 9);
    expect(diseaseDps(p, 0)).toBeCloseTo(80 + 4100 * 0.5, 9);
  });

  it("never goes below the plain disease for a foe above half hp", () => {
    expect(diseaseDps(SHEET.plague, 3)).toBe(40);
  });

  it.each(FACTION_IDS.filter((f) => f !== "plague"))("is 0 for %s", (f) => {
    expect(diseaseDps(SHEET[f], 0.1)).toBe(0);
    expect(diseaseDps(PACED[f], 0.1)).toBe(0);
  });
});

describe("markDps and markShare", () => {
  it("ramps linearly from 0 with the seconds in reach, then holds at the cap (sheet: 35 per s, cap 275)", () => {
    const s = SHEET.sentenced;
    expect(markDps(s, 0)).toBe(0);
    expect(markDps(s, 1)).toBe(35);
    expect(markDps(s, 4)).toBe(140);
    expect(markDps(s, 275 / 35)).toBeCloseTo(275, 9);
    expect(markDps(s, 8)).toBe(275);
    expect(markDps(s, 100)).toBe(275);
  });

  it("treats a negative elapsed time as none", () => {
    expect(markDps(SHEET.sentenced, -3)).toBe(0);
    expect(markShare(SHEET.sentenced, -3)).toBe(0);
  });

  it("paced: the ramp is k squared and the cap k, so the mark fills in half the time", () => {
    const s = PACED.sentenced;
    expect(markDps(s, 1)).toBe(140);
    expect(markDps(s, 2)).toBe(280);
    expect(markDps(s, 550 / 140)).toBeCloseTo(550, 9);
    expect(markDps(s, 10)).toBe(550);
  });

  it("markShare is the mark's progress to its cap, 0..1", () => {
    expect(markShare(SHEET.sentenced, 0)).toBe(0);
    expect(markShare(SHEET.sentenced, 1)).toBeCloseTo(35 / 275, 12);
    expect(markShare(SHEET.sentenced, 50)).toBe(1);
    expect(markShare(PACED.sentenced, 1)).toBeCloseTo(140 / 550, 12);
    expect(markShare(PACED.sentenced, 4)).toBe(1);
  });

  it("markShare is 0 without a positive cap", () => {
    const capless: FactionSpec = { ...SHEET.sentenced, params: { mark_ramp: 35, mark_cap: 0 } };
    expect(markShare(capless, 5)).toBe(0);
  });

  it.each(FACTION_IDS.filter((f) => f !== "sentenced"))("are 0 for %s", (f) => {
    expect(markDps(SHEET[f], 5)).toBe(0);
    expect(markDps(PACED[f], 5)).toBe(0);
    expect(markShare(SHEET[f], 5)).toBe(0);
    expect(markShare(PACED[f], 5)).toBe(0);
  });
});

describe("chillMultiplier", () => {
  it("is Frost's 1 - slow = 0.4, sheet and paced alike", () => {
    expect(chillMultiplier(SHEET.frost)).toBeCloseTo(0.4, 12);
    expect(chillMultiplier(PACED.frost)).toBeCloseTo(0.4, 12);
  });

  it.each(FACTION_IDS.filter((f) => f !== "frost"))("is 1 (no chill) for %s", (f) => {
    expect(chillMultiplier(SHEET[f])).toBe(1);
    expect(chillMultiplier(PACED[f])).toBe(1);
  });
});

describe("factionEdge", () => {
  it("is 0 for a mirror", () => {
    for (const f of FACTION_IDS) expect(factionEdge(f, f)).toBe(0);
  });

  it("is antisymmetric", () => {
    for (const a of FACTION_IDS) for (const b of FACTION_IDS) expect(factionEdge(a, b)).toBe(-factionEdge(b, a) || 0);
  });

  it("gives every faction exactly two wins and two losses", () => {
    for (const a of FACTION_IDS) {
      const edges = FACTION_IDS.filter((b) => b !== a).map((b) => factionEdge(a, b));
      expect(edges.filter((e) => e === 1), a).toHaveLength(2);
      expect(edges.filter((e) => e === -1), a).toHaveLength(2);
    }
  });

  it("is +1 for every (winner, loser) of BEATS and -1 the other way", () => {
    expect(BEATS).toHaveLength(10);
    for (const [w, l] of BEATS) {
      expect(factionEdge(w, l), `${w} over ${l}`).toBe(1);
      expect(factionEdge(l, w), `${l} under ${w}`).toBe(-1);
    }
  });
});

describe("matchupScore", () => {
  it("adds the faction edge and the weapon edge", () => {
    // Fire beats Sentenced (+1) and a sword beats an axe (+1).
    expect(matchupScore({ faction: "fire", weapon: "sword" }, { faction: "sentenced", weapon: "axe" })).toBe(2);
    expect(matchupScore({ faction: "sentenced", weapon: "axe" }, { faction: "fire", weapon: "sword" })).toBe(-2);
    // A mirror of factions leaves the weapon edge alone.
    expect(matchupScore({ faction: "fire", weapon: "sword" }, { faction: "fire", weapon: "axe" })).toBe(1);
    expect(matchupScore({ faction: "fire", weapon: "axe" }, { faction: "fire", weapon: "sword" })).toBe(-1);
    // Mirror weapons leave the faction edge alone.
    expect(matchupScore({ faction: "frost", weapon: "wand" }, { faction: "holy", weapon: "wand" })).toBe(1);
  });

  it("lets the two edges cancel: Fire's axe against Sentenced's bow is +1 - 1", () => {
    expect(matchupScore({ faction: "fire", weapon: "axe" }, { faction: "sentenced", weapon: "bow" })).toBe(0);
  });

  it("has no weapon edge when either hand is empty", () => {
    expect(matchupScore({ faction: "fire", weapon: null }, { faction: "sentenced", weapon: "axe" })).toBe(1);
    expect(matchupScore({ faction: "fire", weapon: "sword" }, { faction: "sentenced", weapon: null })).toBe(1);
    expect(matchupScore({ faction: "sentenced", weapon: null }, { faction: "fire", weapon: null })).toBe(-1);
    expect(matchupScore({ faction: "plague", weapon: null }, { faction: "plague", weapon: null })).toBe(0);
  });

  it("stays within -2..+2 for every pairing and flips sign when the sides swap", () => {
    for (const fa of FACTION_IDS) for (const fb of FACTION_IDS) {
      for (const wa of [...WEAPON_IDS, null]) for (const wb of [...WEAPON_IDS, null]) {
        const s = matchupScore({ faction: fa, weapon: wa }, { faction: fb, weapon: wb });
        const back = matchupScore({ faction: fb, weapon: wb }, { faction: fa, weapon: wa });
        expect(Math.abs(s)).toBeLessThanOrEqual(2);
        expect(s).toBe(-back || 0);
      }
    }
  });
});

describe("matchupTint", () => {
  it("is 0 at or beyond MATCHUP_RANGE, however strong the score", () => {
    expect(matchupTint(2, MATCHUP_RANGE)).toBe(0);
    expect(matchupTint(2, MATCHUP_RANGE + 1)).toBe(0);
    expect(matchupTint(-2, 10_000)).toBe(0);
  });

  it("is 0 for an even matchup at any distance", () => {
    expect(matchupTint(0, 0)).toBe(0);
    expect(matchupTint(0, MATCHUP_FULL_RANGE)).toBe(0);
    expect(matchupTint(0, 300)).toBe(0);
  });

  it("is |score| / 2 at or below MATCHUP_FULL_RANGE", () => {
    expect(matchupTint(2, 0)).toBe(1);
    expect(matchupTint(2, MATCHUP_FULL_RANGE)).toBe(1);
    expect(matchupTint(1, MATCHUP_FULL_RANGE)).toBe(0.5);
    expect(matchupTint(1.5, 40)).toBe(0.75);
  });

  it("fades linearly between MATCHUP_FULL_RANGE and MATCHUP_RANGE", () => {
    const mid = (MATCHUP_FULL_RANGE + MATCHUP_RANGE) / 2;
    expect(matchupTint(2, mid)).toBeCloseTo(0.5, 12);
    expect(matchupTint(1, mid)).toBeCloseTo(0.25, 12);
    expect(matchupTint(2, MATCHUP_FULL_RANGE + 1)).toBeCloseTo(1 - 1 / (MATCHUP_RANGE - MATCHUP_FULL_RANGE), 12);
    expect(matchupTint(2, MATCHUP_RANGE - 1)).toBeCloseTo(1 / (MATCHUP_RANGE - MATCHUP_FULL_RANGE), 12);
  });

  it("never grows with distance", () => {
    let prev = Infinity;
    for (let d = 0; d <= MATCHUP_RANGE + 50; d += 10) {
      const v = matchupTint(2, d);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it("takes its sign from the score", () => {
    expect(matchupTint(-2, 100)).toBe(-1);
    expect(matchupTint(-1, 100)).toBe(-0.5);
    expect(matchupTint(1, 100)).toBeGreaterThan(0);
    expect(matchupTint(-1, 300)).toBeCloseTo(-matchupTint(1, 300), 12);
  });

  it("clamps |score| above 2", () => {
    expect(matchupTint(5, 100)).toBe(1);
    expect(matchupTint(-5, 100)).toBe(-1);
    expect(matchupTint(3, 300)).toBeCloseTo(matchupTint(2, 300), 12);
  });
});

describe("damageFlash", () => {
  const MAX = 1000;
  const share = (s: number): number => damageFlash(s * MAX, MAX);

  it("is 0 below DAMAGE_FLASH_MIN_SHARE of max hp", () => {
    expect(share(DAMAGE_FLASH_MIN_SHARE * 0.99)).toBe(0);
    expect(share(0.001)).toBe(0);
  });

  it("starts at the floor at the threshold", () => {
    expect(damageFlash(2, 100)).toBeCloseTo(FLASH_FLOOR, 12);
    expect(share(DAMAGE_FLASH_MIN_SHARE + 1e-6)).toBeGreaterThanOrEqual(FLASH_FLOOR);
  });

  it("is full at DAMAGE_FLASH_FULL_SHARE and above", () => {
    expect(damageFlash(25, 100)).toBeCloseTo(1, 12);
    expect(share(DAMAGE_FLASH_FULL_SHARE)).toBeCloseTo(1, 12);
    expect(share(0.5)).toBe(1);
    expect(damageFlash(5000, 100)).toBe(1);
  });

  it("rises linearly from the floor to 1 between the thresholds", () => {
    const midShare = (DAMAGE_FLASH_MIN_SHARE + DAMAGE_FLASH_FULL_SHARE) / 2;
    expect(share(midShare)).toBeCloseTo((FLASH_FLOOR + 1) / 2, 9);
  });

  it("is monotone in the amount and stays within the floor and 1 once it shows", () => {
    let prev = 0;
    for (let a = 0; a <= 400; a += 2) {
      const v = damageFlash(a, MAX);
      expect(v).toBeGreaterThanOrEqual(prev);
      if (v > 0) {
        expect(v).toBeGreaterThanOrEqual(FLASH_FLOOR);
        expect(v).toBeLessThanOrEqual(1);
      }
      prev = v;
    }
  });

  it.each<number>([0, -5, NaN])("is 0 for the non-positive amount %s", (amount) => {
    expect(damageFlash(amount, MAX)).toBe(0);
  });

  it("is 0 without a positive max hp", () => {
    expect(damageFlash(100, 0)).toBe(0);
    expect(damageFlash(100, -10)).toBe(0);
  });

  it.each<SignatureKind>(["burn", "disease", "mark"])("never flashes for damage over time (%s)", (sig) => {
    expect(damageFlash(MAX, MAX, sig)).toBe(0);
    expect(damageFlash(0.3 * MAX, MAX, sig)).toBe(0);
  });

  it("does flash for backlash, which is a hit on one swing", () => {
    expect(damageFlash(0.3 * MAX, MAX, "backlash")).toBe(1);
    expect(damageFlash(0.1 * MAX, MAX, "backlash")).toBe(damageFlash(0.1 * MAX, MAX));
  });
});

describe("isDot", () => {
  it("is true for burn, disease and mark", () => {
    expect(isDot("burn")).toBe(true);
    expect(isDot("disease")).toBe(true);
    expect(isDot("mark")).toBe(true);
  });

  it("is false for backlash and for no signature", () => {
    expect(isDot("backlash")).toBe(false);
    expect(isDot(undefined)).toBe(false);
  });
});
