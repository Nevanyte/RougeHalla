import { describe, expect, it } from "vitest";
import {
  BEATS, bonusMultiplier, burnDps, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, chillMultiplier, damageFlash,
  DAMAGE_FLASH_FULL_SHARE, DAMAGE_FLASH_MIN_SHARE, diseaseDps, DOT_FX_MS, ENGAGE_LINGER_SECONDS, ENGAGE_TRADE_SECONDS,
  engageRange, FACTION_IDS, FACTIONS, factionEdge, executeDps, HEAL_LOCKOUT_SECONDS, isDot, markPct, markTierOf, markWeight, MATCHUP_FULL_RANGE,
  MATCHUP_RANGE, MARK_TIER_HITS, matchupScore, matchupTint, pacedFaction, plagueDps, taxedRate, TARGET_FORGET_SECONDS, WEAPON_IDS, WEAPONS,
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
    expect(CHILL_MOVE_MULT).toBe(0.7);
  });

  it("nest: the linger is shorter than the trade window, which is shorter than the forget time", () => {
    expect(ENGAGE_LINGER_SECONDS).toBeLessThan(ENGAGE_TRADE_SECONDS);
    expect(ENGAGE_TRADE_SECONDS).toBeLessThan(TARGET_FORGET_SECONDS);
  });

  it("the chill's walking slow is milder than Frost's 0.4 cooldown slow (owner decision)", () => {
    expect(CHILL_MOVE_MULT).toBeGreaterThan(chillMultiplier(FACTIONS.frost));
    expect(CHILL_MOVE_MULT).toBeLessThan(1);
  });
});

describe("engageRange", () => {
  it.each<[WeaponId | null, number]>([
    ["sword", 64 + 12],
    ["axe", 60 + 12],
    ["shield", 44 + 12],
    ["bow", 240 + 14],
    ["wand", 220 + 14],
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

  it("matches the design numbers (the 9.1 tuning) and is 0 with an empty hand", () => {
    expect(WEAPON_IDS.map((w) => bonusMultiplier(w))).toEqual([0.75, 0.8, 0.8, 0.75, 0.77]);
    expect(bonusMultiplier(null)).toBe(0);
  });
});

describe("burnDps", () => {
  it("is Fire's burn: 18 on the sheet, 36 paced", () => {
    expect(burnDps(SHEET.fire)).toBe(18);
    expect(burnDps(PACED.fire)).toBe(36);
  });

  it.each(FACTION_IDS.filter((f) => f !== "fire"))("is 0 for %s", (f) => {
    expect(burnDps(SHEET[f])).toBe(0);
    expect(burnDps(PACED[f])).toBe(0);
  });
});

describe("diseaseDps", () => {
  it("is Plague's plague plus the execute that grows below half hp (sheet: 43 and 415)", () => {
    const p = SHEET.plague;
    expect(diseaseDps(p, 1.0)).toBe(43);
    expect(diseaseDps(p, 0.75)).toBe(43);
    expect(diseaseDps(p, 0.5)).toBe(43);
    expect(diseaseDps(p, 0.25)).toBeCloseTo(43 + 415 * 0.25, 9);
    expect(diseaseDps(p, 0)).toBeCloseTo(43 + 415 * 0.5, 9);
  });

  it("paced: the plague and the execute are doubled", () => {
    const p = PACED.plague;
    expect(diseaseDps(p, 1.0)).toBe(86);
    expect(diseaseDps(p, 0.5)).toBe(86);
    expect(diseaseDps(p, 0.25)).toBeCloseTo(86 + 830 * 0.25, 9);
    expect(diseaseDps(p, 0)).toBeCloseTo(86 + 830 * 0.5, 9);
  });

  it("never goes below the plain disease for a foe above half hp", () => {
    expect(diseaseDps(SHEET.plague, 3)).toBe(43);
  });

  it.each(FACTION_IDS.filter((f) => f !== "plague"))("is 0 for %s", (f) => {
    expect(diseaseDps(SHEET[f], 0.1)).toBe(0);
    expect(diseaseDps(PACED[f], 0.1)).toBe(0);
  });
});

describe("plagueDps and executeDps", () => {
  it("are Plague's flat disease and the execute that grows below half hp (sheet: 43 and 415)", () => {
    const p = SHEET.plague;
    expect(plagueDps(p)).toBe(43);
    expect(executeDps(p, 1.0)).toBe(0);
    expect(executeDps(p, 0.5)).toBe(0);
    expect(executeDps(p, 0.25)).toBeCloseTo(415 * 0.25, 9);
    expect(executeDps(p, 0)).toBeCloseTo(415 * 0.5, 9);
    expect(plagueDps(p) + executeDps(p, 0.25)).toBeCloseTo(diseaseDps(p, 0.25), 12);
  });

  it("an execute band widens the execute and never below zero", () => {
    expect(executeDps(SHEET.plague, 0.5, 0.6)).toBeCloseTo(41.5, 9);
    expect(executeDps(SHEET.plague, 3)).toBe(0);
  });

  it.each(FACTION_IDS.filter((f) => f !== "plague"))("are 0 for %s", (f) => {
    expect(plagueDps(SHEET[f])).toBe(0);
    expect(executeDps(SHEET[f], 0.1)).toBe(0);
  });
});

describe("markTierOf (the mark's tiers, docs/SENTENCED_REDESIGN.md R3)", () => {
  it("is 0 before the first hit, 1 at it, and one more every MARK_TIER_HITS hits up to 4", () => {
    expect(MARK_TIER_HITS).toBe(3);
    const at = (hits: number): number => markTierOf(hits);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map(at)).toEqual([0, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  it("credits a fraction of a hit (Gathering Storm's 1.5 a hit) and never goes past tier 4", () => {
    expect(markTierOf(1.5 * 2)).toBe(2);
    expect(markTierOf(1.5 * 4)).toBe(3);
    expect(markTierOf(1.5 * 6)).toBe(4);
    expect(markTierOf(1e9)).toBe(4);
  });

  it("a weapon swap promotes without a hit, and either path alone reaches a tier (the higher wins, they do not add)", () => {
    expect(markTierOf(0, 1)).toBe(2);
    expect(markTierOf(0, 3)).toBe(4);
    expect(markTierOf(0, 9)).toBe(4);
    expect(markTierOf(7, 1)).toBe(3);
    expect(markTierOf(1, 2)).toBe(3);
    expect(markTierOf(3, 1)).toBe(2);
  });

  it("reads another tier length (the reference duel's tier_hits) and 0 for nothing", () => {
    expect(markTierOf(3, 0, 1.5)).toBe(3);
    expect(markTierOf(0, 0)).toBe(0);
    expect(markTierOf(-4, 0)).toBe(0);
  });
});

describe("taxedRate (the tier-2 attack-speed tax, R5)", () => {
  const keep = SHEET.sentenced.params.tax_keep!;
  const cap = SHEET.sentenced.params.tax_cap!;

  it("leaves a rate at or under 1.0 alone", () => {
    for (const r of [0.45, 0.6, 0.9, 0.95, 1.0]) expect(taxedRate(r, keep, cap)).toBe(r);
  });

  it("keeps the configured 38% of excess speed: Plague’s 1.85 becomes 1.323", () => {
    expect(keep).toBe(0.38);
    expect(taxedRate(1.85, keep, cap)).toBeCloseTo(1.323, 12);
    expect(taxedRate(1.2, keep, cap)).toBeCloseTo(1.076, 12);
    expect(taxedRate(1.85, 0.5, cap)).toBeCloseTo(1.425, 12);
  });

  it("is held to the 1.6 ceiling however fast the fighter is", () => {
    expect(taxedRate(2.2, keep, cap)).toBeCloseTo(1.456, 12);
    expect(taxedRate(3.0, keep, cap)).toBe(1.6);
    expect(taxedRate(10, keep, cap)).toBe(1.6);
  });

  it("never raises a rate", () => {
    for (const r of [0.2, 1, 1.05, 1.6, 1.85, 2.5, 4]) expect(taxedRate(r, keep, cap)).toBeLessThanOrEqual(r);
  });
});

describe("markWeight and markPct (the pulse's share, R4)", () => {
  it("a hit's weight is its share of the faction's base hit, so a pulse follows the weapon's dpsMult over 1 + boost", () => {
    for (const w of WEAPON_IDS) {
      const f = SHEET.sentenced;
      const unfloored = WEAPONS[w].dpsMult / (1 + WEAPONS[w].boost);
      if (1 / (f.rate * (1 + WEAPONS[w].boost)) >= WEAPONS[w].floor) expect(markWeight(f, w)).toBeCloseTo(unfloored, 12);
    }
  });

  it("attack speed changes nothing until the interval floor binds, then makes bigger hits and so bigger pulses", () => {
    const f = SHEET.sentenced;
    expect(markWeight(f, "sword", 1.5)).toBeCloseTo(markWeight(f, "sword", 1), 12);
    expect(markWeight(f, "sword", 3)).toBeGreaterThan(markWeight(f, "sword", 1));
  });

  it("markPct is the share plus a kill-stack's share each, times the Heavier Sentence scale", () => {
    const f = SHEET.sentenced;
    const base = f.params.mark_pct!;
    const kill = f.params.mark_kill!;
    expect(markPct(f, 0)).toBeCloseTo(base, 12);
    expect(markPct(f, 3)).toBeCloseTo(base + 3 * kill, 12);
    expect(markPct(f, 5, 1.2)).toBeCloseTo((base + 5 * kill) * 1.2, 12);
    expect(markPct(f, -2)).toBeCloseTo(base, 12);
  });

  it("five kill-stacks make the share x2.25 (the spec's 0.6% to 1.35%)", () => {
    const f = SHEET.sentenced;
    expect(markPct(f, 5) / markPct(f, 0)).toBeCloseTo(2.25, 12);
  });

  it("is paced with the hit: the share doubles at k = 2 and the tier clock halves", () => {
    expect(PACED.sentenced.params.mark_pct).toBeCloseTo(SHEET.sentenced.params.mark_pct! * 2, 12);
    expect(PACED.sentenced.params.mark_kill).toBeCloseTo(SHEET.sentenced.params.mark_kill! * 2, 12);
    expect(PACED.sentenced.params.tier_hits).toBeCloseTo(SHEET.sentenced.params.tier_hits! / 2, 12);
    expect(PACED.sentenced.params.suppress).toBe(SHEET.sentenced.params.suppress);
  });

  it.each(FACTION_IDS.filter((f) => f !== "sentenced"))("%s has no mark", (f) => {
    expect(markPct(SHEET[f], 5)).toBe(0);
  });
});

describe("chillMultiplier", () => {
  it("is Frost's 1 - slow = 0.48, sheet and paced alike", () => {
    expect(chillMultiplier(SHEET.frost)).toBeCloseTo(0.48, 12);
    expect(chillMultiplier(PACED.frost)).toBeCloseTo(0.48, 12);
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

  it.each<SignatureKind>(["burn", "disease"])("never flashes for damage over time (%s)", (sig) => {
    expect(damageFlash(MAX, MAX, sig)).toBe(0);
    expect(damageFlash(0.3 * MAX, MAX, sig)).toBe(0);
  });

  it("does flash for backlash, which is a hit on one swing", () => {
    expect(damageFlash(0.3 * MAX, MAX, "backlash")).toBe(1);
    expect(damageFlash(0.1 * MAX, MAX, "backlash")).toBe(damageFlash(0.1 * MAX, MAX));
  });
});

describe("isDot", () => {
  it("is true for burn and disease, and false for the mark: a pulse per hit is no damage over time", () => {
    expect(isDot("burn")).toBe(true);
    expect(isDot("disease")).toBe(true);
    expect(isDot("mark")).toBe(false);
  });

  it("is false for backlash and for no signature", () => {
    expect(isDot("backlash")).toBe(false);
    expect(isDot(undefined)).toBe(false);
  });
});
