// Knowledge (brain/knowledge.ts, docs/BOTS.md 2.7): the counter wheels as one bot knows them, the mob matchup share with its
// fixed error, and the fight odds the strategy and tactics share.
import { describe, expect, it } from "vitest";
import {
  BEATS, FACTION_IDS, WEAPON_BEATS, WEAPON_IDS, factionEdge, matchupScore, mulberry32, weaponEdge,
  type FactionId, type WeaponId,
} from "@raid/shared";
import { createKnowledge } from "../../src/bots/brain/knowledge";
import { TIERS, type OpponentSnapshot, type TierId, type TierParams } from "../../src/bots/brain/types";
import { matchupShare } from "../../src/bots/mobHunt";
import { selfView } from "./fixtures";

const tierWith = (id: TierId, over: Partial<TierParams> = {}): TierParams => ({ ...TIERS[id], ...over });

/** How many of the 10 faction and 10 weapon edges the bot reads as non-zero. */
function knownEdges(k: ReturnType<typeof createKnowledge>): { factions: number; weapons: number } {
  return {
    factions: BEATS.filter(([w, l]) => k.factionEdge(w, l) !== 0).length,
    weapons: WEAPON_BEATS.filter(([w, l]) => k.weaponEdge(w, l) !== 0).length,
  };
}

function them(over: Partial<OpponentSnapshot> = {}): OpponentSnapshot {
  return { id: "foe", faction: "sentenced", inHand: "axe", otherSlot: null, hpFrac: 1, bounty: 0, dist: 300, tint: 0, ...over };
}

/** An rng that answers the masks from a script: ten faction draws, ten weapon draws, then 0.5 for everything after. */
function scripted(factionDraw: number, weaponDraw: number): () => number {
  let n = 0;
  return () => (n++ < 10 ? factionDraw : n <= 20 ? weaponDraw : 0.5);
}

describe("the wheels a bot knows", () => {
  it("knows about the tier's share of the 20 edges, drawn once per bot", () => {
    const expected: Record<TierId, number> = { easy: 0.4, normal: 0.7, hard: 0.95 };
    for (const id of ["easy", "normal", "hard"] as const) {
      let known = 0;
      const bots = 300;
      for (let seed = 1; seed <= bots; seed++) {
        const k = knownEdges(createKnowledge(TIERS[id], mulberry32(seed)));
        known += k.factions + k.weapons;
      }
      expect(Math.abs(known / (bots * 20) - expected[id]), id).toBeLessThan(0.025);
    }
  });

  it("is fixed for the life of the bot and the same for the same seed", () => {
    const a = createKnowledge(TIERS.normal, mulberry32(42));
    const b = createKnowledge(TIERS.normal, mulberry32(42));
    for (const x of FACTION_IDS) {
      for (const y of FACTION_IDS) {
        expect(a.factionEdge(x, y)).toBe(a.factionEdge(x, y));
        expect(a.factionEdge(x, y)).toBe(b.factionEdge(x, y));
      }
    }
    for (const x of WEAPON_IDS) for (const y of WEAPON_IDS) expect(a.weaponEdge(x, y)).toBe(b.weaponEdge(x, y));
  });

  it("reads the true edge where it knows it, 0 where it does not, and 0 for a mirror", () => {
    const sees = createKnowledge(tierWith("hard", { knowledge: 1 }), mulberry32(1));
    const blind = createKnowledge(tierWith("hard", { knowledge: 0 }), mulberry32(1));
    for (const x of FACTION_IDS) {
      for (const y of FACTION_IDS) {
        expect(sees.factionEdge(x, y)).toBe(factionEdge(x, y));
        expect(blind.factionEdge(x, y)).toBe(0);
      }
    }
    for (const x of WEAPON_IDS) {
      for (const y of WEAPON_IDS) {
        expect(sees.weaponEdge(x, y)).toBe(weaponEdge(x, y));
        expect(blind.weaponEdge(x, y)).toBe(0);
      }
    }
  });

  it("reads an edge the same from either side: what it knows of fire beating sentenced it knows of sentenced losing to fire", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const k = createKnowledge(TIERS.easy, mulberry32(seed));
      for (const [w, l] of BEATS) expect(k.factionEdge(w, l)).toBe(0 - k.factionEdge(l, w));
      for (const [w, l] of WEAPON_BEATS) expect(k.weaponEdge(w, l)).toBe(0 - k.weaponEdge(l, w));
    }
  });
});

describe("the mob matchup share", () => {
  it("is mobHunt's share plus an error that stays inside the tier's noise and inside 0..1", () => {
    for (const id of ["easy", "normal", "hard"] as const) {
      const tier = TIERS[id];
      for (let seed = 1; seed <= 30; seed++) {
        const k = createKnowledge(tier, mulberry32(seed));
        for (const me of FACTION_IDS) {
          for (const region of FACTION_IDS) {
            for (const elite of [false, true]) {
              const share = k.mobShare(me, region, elite);
              const truth = matchupShare(me, region, elite);
              expect(share).toBeGreaterThanOrEqual(0);
              expect(share).toBeLessThanOrEqual(1);
              expect(Math.abs(share - truth)).toBeLessThanOrEqual(tier.mobShareNoise + 1e-9);
              expect(k.mobShare(me, region, elite)).toBe(share); // fixed per bot
            }
          }
        }
      }
    }
  });

  it("is exact with no noise and differs between bots with some", () => {
    const exact = createKnowledge(tierWith("hard", { mobShareNoise: 0 }), mulberry32(5));
    for (const me of FACTION_IDS) for (const region of FACTION_IDS) expect(exact.mobShare(me, region, false)).toBe(matchupShare(me, region, false));
    const a = createKnowledge(TIERS.easy, mulberry32(1));
    const b = createKnowledge(TIERS.easy, mulberry32(2));
    const differs = FACTION_IDS.some((me) => FACTION_IDS.some((region) => a.mobShare(me, region, false) !== b.mobShare(me, region, false)));
    expect(differs).toBe(true);
  });
});

describe("fight odds", () => {
  const full = createKnowledge(tierWith("hard", { knowledge: 1 }), mulberry32(1));
  const blind = createKnowledge(tierWith("hard", { knowledge: 0 }), mulberry32(1));

  it("is the matchup score plus twice the hp lead, as matchupScore reads it, when every edge is known", () => {
    const factions: FactionId[] = [...FACTION_IDS];
    const weapons: WeaponId[] = [...WEAPON_IDS];
    for (const f of factions) {
      for (const g of factions) {
        for (const w of weapons) {
          for (const x of weapons) {
            const me = selfView({ faction: f, weapons: [w, null], slot: 0, hp: 100, maxHp: 100 });
            const odds = full.odds(me, them({ faction: g, inHand: x, hpFrac: 1 }));
            expect(odds.edge).toBe(matchupScore({ faction: f, weapon: w }, { faction: g, weapon: x }));
            expect(odds.known).toBe(true);
          }
        }
      }
    }
  });

  it("adds twice the hp-share lead, and clamps the whole at +-2", () => {
    const me = selfView({ faction: "fire", weapons: ["sword", null], hp: 80, maxHp: 100 });
    // fire beats sentenced (+1), sword vs wand (+1): a score of 2 already, so the lead only shows on a mirror.
    const mirror = full.odds(me, them({ faction: "fire", inHand: "sword", hpFrac: 0.5 }));
    expect(mirror.edge).toBeCloseTo(2 * (0.8 - 0.5), 9);
    expect(full.odds(me, them({ faction: "fire", inHand: "sword", hpFrac: 1 })).edge).toBeCloseTo(-0.4, 9);
    expect(full.odds(me, them({ faction: "sentenced", inHand: "axe", hpFrac: 0 })).edge).toBe(2);
    const hurt = selfView({ faction: "fire", weapons: ["axe", null], hp: 5, maxHp: 100 });
    expect(full.odds(hurt, them({ faction: "holy", inHand: "sword", hpFrac: 1 })).edge).toBe(-2);
  });

  it("uses only the faction part when their weapon is not known, and is then not fully known", () => {
    const me = selfView({ faction: "fire", weapons: ["axe", null] });
    const odds = full.odds(me, them({ faction: "sentenced", inHand: null }));
    expect(odds.edge).toBe(factionEdge("fire", "sentenced"));
    expect(odds.known).toBe(false);
  });

  it("reads an unknown edge as 0, which leaves only the hp lead", () => {
    const me = selfView({ faction: "fire", weapons: ["sword", null], hp: 100, maxHp: 100 });
    const odds = blind.odds(me, them({ faction: "sentenced", inHand: "axe", hpFrac: 0.5 }));
    expect(odds.edge).toBeCloseTo(1, 9);
    expect(odds.known).toBe(false);
  });

  it("falls back to the UI tint (2 x tint) when the edges are unknown and the tint is showing", () => {
    const me = selfView({ faction: "fire", weapons: ["sword", null], hp: 100, maxHp: 100 });
    expect(blind.odds(me, them({ tint: 0.5 })).edge).toBeCloseTo(1, 9);
    expect(blind.odds(me, them({ tint: -1 })).edge).toBe(-2);
    expect(blind.odds(me, them({ tint: -0.25 })).edge).toBeCloseTo(-0.5, 9);
    expect(blind.odds(me, them({ tint: 0.5 })).known).toBe(false);
    // Out of the tint's range there is nothing to read.
    expect(blind.odds(me, them({ tint: 0, dist: 600 })).edge).toBe(0);
  });

  it("prefers what it knows to the tint", () => {
    const me = selfView({ faction: "fire", weapons: ["sword", null], hp: 100, maxHp: 100 });
    const odds = full.odds(me, them({ faction: "sentenced", inHand: "axe", tint: -1 }));
    expect(odds.edge).toBe(2);
    expect(odds.known).toBe(true);
  });

  it("is only partly known when one wheel is, and then trusts the tint over its half", () => {
    const factionsOnly = createKnowledge(tierWith("normal", { knowledge: 0.5 }), scripted(0, 0.99));
    const me = selfView({ faction: "fire", weapons: ["sword", null], hp: 100, maxHp: 100 });
    const quiet = factionsOnly.odds(me, them({ faction: "sentenced", inHand: "axe", tint: 0 }));
    expect(quiet.known).toBe(false);
    expect(quiet.edge).toBe(1); // the faction edge alone
    const shown = factionsOnly.odds(me, them({ faction: "sentenced", inHand: "axe", tint: 1 }));
    expect(shown.edge).toBe(2); // the tint carries both
    expect(shown.known).toBe(false);
  });

  it("copes with a fighter of no known faction and a bot with no weapon", () => {
    const me = selfView({ faction: "fire", weapons: [null, null], hp: 50, maxHp: 100 });
    const odds = full.odds(me, them({ faction: null, inHand: null, hpFrac: 0.5 }));
    expect(odds.edge).toBe(0);
    expect(odds.known).toBe(false);
    expect(typeof odds.why).toBe("string");
  });
});
