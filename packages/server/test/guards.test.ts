// The PvP guards of the balance pass (BALANCE_CONTRACT 4.6): G2 (no player-to-player hit takes more than 35% of the victim's max
// hp), G3 (one source's damage over time on a player takes at most 15% of max hp a second) and G4 (A Race to 0: damage dealt and
// taken is multiplied by 1 / hp fraction up to 2.5, from the hp as the pass began, and its extra damage feeds no lifesteal). The
// card engine's guards follow them (agent A3a): G1 (the row multiplier), G5 (lifesteal), G6 (the barrier), G7 (bonus defense),
// G8 (max hp), G10 (move speed), G11 (conversions) and G12 (crit); G9 (attack speed and the ranged windups) and G13 (a Wish's
// cooldown) are in mods.test.ts beside the mirrors they shape, and the pure maths of all of them in shared/test/mods.test.ts.
// Builds are crafted by hand (setExtraRows): the cards' own text is agent A3b's.
import { describe, expect, it } from "vitest";
import {
  BARRIER_DECAY_SHARE_PER_SECOND, BARRIER_MAX_SHARE, barrierCap, CONVERT_AD_AP_CAP, CRIT_CHANCE_MAX, CRIT_MULT, clampBarrier,
  decayBarrier, encodeFlat, FACTIONS, foldedMaxHp, HP_RACE_CAP, hpRaceMult, lifestealFraction, lifestealShare, lifestealTotal, LIFESTEAL_MAX,
  LS_CAP, MAX_HP_FLOOR_SHARE, MOVE_BONUS_CAP, mitigateShares, OUTGOING_ROW_CAP, PLAYER_SPEED, PVP_DOT_CAP_SHARE, PVP_HIT_CAP_SHARE, pvpFactor,
  SIG_CHILLED, TICK_MS, cardDef, type Effect,
} from "@raid/shared";
import { syncMaxHp } from "../src/sim/buffs";
import { combatant } from "../src/sim/combatant";
import { rollAttackCrit } from "../src/sim/cardState";
import { applyLedger, recordHit } from "../src/sim/ledger";
import { placeMob } from "../src/sim/mobLife";
import { addMob } from "../src/sim/mobs";
import {
  critChanceOf, lifestealMultOf, lifestealRowsOf, outgoingKindOf, outgoingMult, setExtraRows, speedMultOf, wishCooldownMultOf, type OutgoingKind,
  type VsProbe,
} from "../src/sim/mods";
import { addStatus } from "../src/sim/status";
import { hit, inStep, MAGIC, pvpArena, P, RT, tick, TRUE, type HitOpts } from "./support/pvpRig";

const HOLY_HP = FACTIONS.holy.hp;
const DT = TICK_MS / 1000;

describe("G2: the PvP per-hit cap", () => {
  it("cuts one player-to-player hit to 35% of the victim's max hp, after the multiplier and the mitigation", () => {
    expect(PVP_HIT_CAP_SHARE).toBe(0.35);
    // P 15: f = 2.82, so a raw 400 would be 1,128 against a 1,400-hp Holy
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 400);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 0.35 * HOLY_HP, 9);
  });

  it("leaves a hit under the cap alone", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 100 * pvpFactor(15), 9);
  });

  it("caps what reaches the hp, so armor and magic resist come first", () => {
    // A magic hit of raw 600 x f(15) = 1,692 is 1,692 / 3.5 = 483 against Holy's 250 magic resist: under 490 = 35%, not capped.
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 600, { shares: MAGIC });
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - (600 * pvpFactor(15)) / 3.5, 9);
  });

  it("caps each hit of a pass on its own: two hits in one tick can still take 70%", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "b", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 400);
    hit(w, "v", "b", 400);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP * 0.3, 9);
  });

  it("applies to a passive hit (a riposte) and a Wish's single hit alike, but not to the arena or to mobs", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: true });
    hit(w, "v", "a", 100_000, { passive: true, weapon: "shield" });
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP * 0.65, 9);
    // The arena is the world's own damage.
    const v2 = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    hit(v2, "v", "a", 100_000, { arena: true });
    applyLedger(v2);
    expect(P(v2, "v").status).toBe("dead");
    // A mob's hit on a player is not capped, however hard (it has no card power: its damage is what the sheet says).
    const v3 = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    const mob = addMob(v3, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    hit(v3, "v", mob, 100_000);
    applyLedger(v3);
    expect(P(v3, "v").status).toBe("dead");
  });

  it("is on the victim being a player: a mob takes the whole hit", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 }, hp: 100_000 });
    hit(w, mob, "a", 90_000);
    applyLedger(w);
    expect(w.state.mobs.get(mob)!.hp).toBe(10_000);
  });

  it("is part of the PvP rules: with them off a hit lands whole", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    hit(w, "v", "a", 800);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 800, 9);
  });
});

describe("G3: the PvP damage-over-time cap", () => {
  const budget = PVP_DOT_CAP_SHARE * HOLY_HP * DT;

  it("limits one source's damage over time on one victim to 15% of its max hp a second (a tick's share of that)", () => {
    expect(PVP_DOT_CAP_SHARE).toBe(0.15);
    const w = pvpArena([{ id: "a", faction: "sentenced", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 500, { sig: "mark", shares: TRUE });
    applyLedger(w);
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(budget, 9);
    expect(budget).toBeCloseTo(10.5, 9);
  });

  it("shares the budget between that source's entries in proportion, whichever signature they are", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 300, { sig: "mark", shares: TRUE });
    hit(w, "v", "a", 100, { sig: "burn", shares: TRUE });
    applyLedger(w);
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(budget, 9);
  });

  it("gives each source its own budget on a victim", () => {
    const w = pvpArena([
      { id: "a", faction: "sentenced", build: { ad3: 5 } }, { id: "b", faction: "plague", build: { ad3: 5 } }, { id: "v", faction: "holy" },
    ]);
    hit(w, "v", "a", 500, { sig: "mark", shares: TRUE });
    hit(w, "v", "b", 500, { sig: "disease", shares: TRUE });
    applyLedger(w);
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(2 * budget, 9);
  });

  it("is a rate: tick after tick the loss stays at 15% of max hp a second", () => {
    const w = pvpArena([{ id: "a", faction: "sentenced", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    for (let i = 0; i < 20; i++) inStep(w, () => hit(w, "v", "a", 500, { sig: "mark", shares: TRUE }));
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(PVP_DOT_CAP_SHARE * HOLY_HP, 6);
  });

  it("leaves a source under its budget alone, a hit beside it unaffected, and a mob victim uncapped", () => {
    const w = pvpArena([{ id: "a", faction: "sentenced", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 3, { sig: "mark", shares: TRUE });
    hit(w, "v", "a", 100); // a hit is G2's business, not G3's
    applyLedger(w);
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(3 * pvpFactor(15) + 100 * pvpFactor(15), 9);
    const m = pvpArena([{ id: "a", faction: "sentenced", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    const mob = addMob(m, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 }, hp: 100_000 });
    hit(m, mob, "a", 500, { sig: "mark", shares: TRUE });
    applyLedger(m);
    expect(100_000 - m.state.mobs.get(mob)!.hp).toBeCloseTo(500, 9); // no PvP factor on a mob either
  });

  it("counts a Wish's damage over time as a source's too", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 500, { ability: "blaze", weapon: null, dot: true, shares: TRUE });
    applyLedger(w);
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(budget, 9);
  });
});

describe("G4: A Race to 0", () => {
  it("multiplies the damage the holder deals by 1 / its hp fraction, from the hp as the pass began", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.5 }, { id: "v", faction: "holy" }], { pvpRules: false });
    w.combat.hpRace = new Map([["a", HP_RACE_CAP]]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 200, 9);
  });

  it("multiplies the damage the holder takes by the same, whoever deals it", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy", hpFrac: 0.4 }], { pvpRules: false });
    w.combat.hpRace = new Map([["v", HP_RACE_CAP]]);
    const hp = P(w, "v").hp;
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(hp - P(w, "v").hp).toBeCloseTo(100 * 2.5, 9);
  });

  it("stops at 2.5 however low the holder is", () => {
    expect(hpRaceMult(0.5)).toBe(2);
    expect(hpRaceMult(0.4)).toBe(2.5);
    expect(hpRaceMult(0.01)).toBe(HP_RACE_CAP);
    expect(hpRaceMult(0)).toBe(HP_RACE_CAP);
    expect(hpRaceMult(1)).toBe(1);
    expect(hpRaceMult(0.05, 10)).toBe(HP_RACE_CAP); // a card row asking for more is still held to the guard
    expect(hpRaceMult(0.1, 1.5)).toBe(1.5); // and a lower ceiling stands
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.05 }, { id: "v", faction: "holy" }], { pvpRules: false });
    w.combat.hpRace = new Map([["a", 10]]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 250, 9);
  });

  it("reads the hp as the pass began for both ends: a hit that drops the holder first does not change the next one's multiplier", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.5 }, { id: "b", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    w.combat.hpRace = new Map([["a", HP_RACE_CAP]]);
    inStep(w, () => {
      hit(w, "a", "b", 100); // a falls to 217 / 835 within the pass (taken x2)...
      hit(w, "v", "a", 100); // ...but its own hit still reads 0.5: x2
      hit(w, "v", "a", 100);
    });
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 400, 9);
    // And the hit on the holder used the start fraction too: 100 x 2 at 0.5.
    expect(P(w, "a").hp).toBeCloseTo(FACTIONS.fire.hp * 0.5 - 200, 6);
  });

  it("takes nothing from a fighter that holds no Race, nor from the arena's and a Wish's damage", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.3 }, { id: "v", faction: "holy", hpFrac: 0.3 }], { pvpRules: false });
    w.combat.hpRace = new Map([["a", HP_RACE_CAP]]);
    hit(w, "v", "a", 10, { ability: "blaze", weapon: null, shares: TRUE });
    hit(w, "v", "a", 10, { arena: true });
    const hp = P(w, "v").hp;
    applyLedger(w);
    expect(hp - P(w, "v").hp).toBeCloseTo(20, 9);
  });

  it("feeds no lifesteal with its extra damage: a Holy holder heals from the hit it would have dealt without the Race", () => {
    // Holy at 50% hp heals 10% + 80% x missing = 50% of the damage it lands.
    const heal = (race: boolean): number => {
      const w = pvpArena([{ id: "h", faction: "holy", hpFrac: 0.5, weapon: "wand" }, { id: "v", faction: "fire" }], { pvpRules: false, signatures: true });
      if (race) w.combat.hpRace = new Map([["h", HP_RACE_CAP]]);
      const before = P(w, "h").hp;
      inStep(w, () => { hit(w, "v", "h", 100); });
      return P(w, "h").hp - before;
    };
    const plain = heal(false);
    const raced = heal(true);
    expect(plain).toBeCloseTo(100 * 0.5, 6);
    expect(raced).toBeCloseTo(plain, 6); // x2 on the damage, divided back out for the heal
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The card engine's guards (agent A3a). Rows are crafted by hand and go in through setExtraRows, so they are in the pass-start state.

const rows = (w: ReturnType<typeof pvpArena>, id: string, list: Effect[]): void => setExtraRows(w, combatant(w, id)!, list);
const dmg = (v: number): Effect => ({ k: "stat", stat: "damage", v });
const mult = (key: Extract<Effect, { k: "mult" }>["key"], v: number): Effect => ({ k: "mult", key, v });

describe("G1: the row multiplier", () => {
  it("stops at x2.5: the damage rows, `vs` and `scale` rows included, never multiply a hit by more", () => {
    expect(OUTGOING_ROW_CAP).toBe(2.5);
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = P(w, "a");
    rows(w, "a", [dmg(1.2), { k: "vs", test: "hpBelow", arg: 1.1, v: 0.6 }]); // 1 + 1.2 + 0.6 = 2.8
    expect(outgoingMult(a, 1)).toBe(2.5);
    expect(outgoingMult(a, 1, undefined, "hit")).toBe(2.5);
    expect(outgoingMult(a, 1.2)).toBeCloseTo(2.2, 12); // the `vs` row off: under the cap, untouched
    // the same through the real ledger: a raw 100 hit on an armor-free victim lands as 250, not 280
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 250, 9);
    // a `scale` row counts toward it as well
    rows(w, "a", [dmg(1.4), { k: "scale", src: "campsCleared", per: 0.1, step: 1 }]);
    RT(w, "a").campsCleared = 5;
    tick(w);
    expect(outgoingMult(a, 1)).toBe(2.5);
  });

  it("includes the entry's own mult: x2.5 on the hit (Boom) leaves no room for a damage row, and a kind with another mult keeps its own share", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = P(w, "a");
    rows(w, "a", [dmg(0.5), mult("hit", 2.5), mult("dot", 1.25), mult("returned", 1.25)]);
    expect(outgoingMult(a, 1, undefined, "hit")).toBe(1); // 2.5 x 1 is already the cap
    expect(outgoingMult(a, 1, undefined, "dot")).toBeCloseTo(1.5, 12); // 1.25 x 1.5 is 1.875
    expect(outgoingMult(a, 1, undefined, "other")).toBeCloseTo(1.5, 12);
    rows(w, "a", [dmg(2), mult("dot", 1.25)]);
    expect(outgoingMult(a, 1, undefined, "dot")).toBe(2); // 1.25 x 2 = the cap
    // Machine Gun's x0.4 on the hit gives the rows their full x2.5 (and no more)
    rows(w, "a", [dmg(3), mult("hit", 0.4)]);
    expect(outgoingMult(a, 1, undefined, "hit")).toBe(2.5);
  });

  it("holds the product (rows x the kind's mult) at x2.5 for every sum of damage rows and every kind", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = P(w, "a");
    const kinds: Array<[OutgoingKind, Effect[]]> = [["hit", [mult("hit", 2.5)]], ["dot", [mult("dot", 1.25)]], ["returned", [mult("returned", 1.25)]], ["other", []]];
    for (const [kind, extra] of kinds) {
      for (const sum of [0, 0.3, 0.9, 1.4, 2, 5]) {
        rows(w, "a", [dmg(sum), ...extra]);
        const own = kind === "hit" ? 2.5 : kind === "other" ? 1 : 1.25;
        expect(outgoingMult(a, 1, undefined, kind) * own, `${kind} +${sum}`).toBeLessThanOrEqual(2.5 + 1e-12);
        expect(outgoingMult(a, 1, undefined, kind), `${kind} +${sum}`).toBeGreaterThanOrEqual(1 - 1e-12);
      }
    }
  });

  it("outgoingKindOf names an entry for the cap: a tick of damage over time, damage returned, a weapon hit, or other", () => {
    expect(outgoingKindOf({ weapon: "axe" })).toBe("hit");
    expect(outgoingKindOf({ weapon: "bow", sig: undefined })).toBe("hit");
    expect(outgoingKindOf({ weapon: "axe", sig: "burn" })).toBe("dot");
    expect(outgoingKindOf({ weapon: "axe", sig: "disease" })).toBe("dot");
    expect(outgoingKindOf({ weapon: "bow", sig: "mark" })).toBe("dot");
    expect(outgoingKindOf({ weapon: null, ability: "blaze", dot: true })).toBe("dot");
    expect(outgoingKindOf({ weapon: "axe", sig: "backlash" })).toBe("returned");
    expect(outgoingKindOf({ weapon: "shield", passive: true })).toBe("returned");
    expect(outgoingKindOf({ weapon: null, ability: "freeze" })).toBe("other");
  });

  it("a fighter with no damage row is untouched (x1), and the probe answers no more than it was asked", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    expect(outgoingMult(P(w, "a"), 0.2)).toBe(1);
    const asked: string[] = [];
    const probe: VsProbe = { elite: () => { asked.push("elite"); return true; }, slowed: () => { asked.push("slowed"); return false; } };
    rows(w, "a", [{ k: "vs", test: "elite", arg: 0, v: 0.2 }]);
    expect(outgoingMult(P(w, "a"), 1, probe)).toBeCloseTo(1.2, 12);
    expect(asked).toEqual(["elite"]); // lazy: the slowed test was never asked
  });
});

describe("G5: lifesteal", () => {
  it("rows alone heal at most LS_CAP of the damage dealt (the live lifesteal system), whatever they add up to", () => {
    expect([LS_CAP, LIFESTEAL_MAX]).toEqual([0.25, 0.85]);
    const heal = (rowSum: number): number => {
      const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.5 }, { id: "v", faction: "holy" }], { pvpRules: false, signatures: true });
      rows(w, "a", [{ k: "stat", stat: "lifesteal", v: rowSum }]);
      const before = P(w, "a").hp;
      inStep(w, () => { hit(w, "v", "a", 100); });
      return P(w, "a").hp - before;
    };
    expect(heal(0.1)).toBeCloseTo(10, 6);
    expect(heal(0.9)).toBeCloseTo(25, 6);
    expect(heal(5)).toBeCloseTo(25, 6);
  });

  it("with Holy's own share the total stops at LIFESTEAL_MAX (the live system)", () => {
    const w = pvpArena([{ id: "h", faction: "holy", hpFrac: 0.1, weapon: "wand" }, { id: "v", faction: "fire" }], { pvpRules: false, signatures: true });
    rows(w, "h", [{ k: "stat", stat: "lifesteal", v: 0.25 }]);
    const own = lifestealFraction(FACTIONS.holy, 0.1);
    expect(own).toBeCloseTo(0.75, 12); // 0.1 + 0.8 x 0.9 at 10% hp, held to Holy's own ls_cap 0.75: with the rows' 0.25 that is 1.0, over the cap
    expect(own + 0.25).toBeGreaterThan(LIFESTEAL_MAX);
    const before = P(w, "h").hp;
    inStep(w, () => { hit(w, "v", "h", 100); });
    expect(P(w, "h").hp - before).toBeCloseTo(100 * LIFESTEAL_MAX, 6);
    expect(lifestealShare(own, 0.25)).toBe(LIFESTEAL_MAX);
  });

  it("Bloodthirst's lifestealMult doubles the capped rows, not Holy's own, and the total is still held to LIFESTEAL_MAX (the readers the system will compose)", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    const a = P(w, "a");
    rows(w, "a", [{ k: "stat", stat: "lifesteal", v: 0.4 }, { k: "while", cond: "hpBelow", arg: 2, stat: "lifestealMult", v: 1 }]);
    expect(lifestealRowsOf(a)).toBe(0.4); // the raw sum: the cap is the share's
    expect(lifestealMultOf(a)).toBe(2);
    expect(lifestealTotal(0, lifestealRowsOf(a), lifestealMultOf(a))).toBe(0.5); // 0.25 capped, then x2
    expect(lifestealTotal(0.75, lifestealRowsOf(a), lifestealMultOf(a))).toBe(LIFESTEAL_MAX);
    rows(w, "a", [{ k: "stat", stat: "lifesteal", v: 0.4 }, { k: "while", cond: "hpBelow", arg: 0.01, stat: "lifestealMult", v: 1 }]);
    expect(lifestealMultOf(a)).toBe(1); // the condition off: no doubling
  });
});

describe("G6: the barrier", () => {
  it("holds at most 25% of max hp and loses 5% of max hp a second", () => {
    expect([BARRIER_MAX_SHARE, BARRIER_DECAY_SHARE_PER_SECOND]).toEqual([0.25, 0.05]);
    for (const hp of [500, 835, 1400]) {
      expect(barrierCap(hp)).toBe(0.25 * hp);
      expect(clampBarrier(10 * hp, hp)).toBe(0.25 * hp);
      expect(decayBarrier(0.25 * hp, hp, 1)).toBeCloseTo(0.2 * hp, 9);
      expect(decayBarrier(0.25 * hp, hp, 5)).toBe(0); // gone in five seconds from full
    }
  });
});

describe("G7: bonus armor and magic resist", () => {
  it("count as +200 at the most: a victim with +500 armor takes what +200 lets through", () => {
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    rows(w, "v", [{ k: "flat", stat: "armor", v: 300 }, { k: "flat", stat: "armor", v: 200 }, { k: "flat", stat: "shield", v: 999 }]);
    const v = P(w, "v");
    const def = { armor: FACTIONS.fire.armor + 200, shield: FACTIONS.fire.shield + 200 };
    const hp0 = v.hp;
    hit(w, "v", "a", 100);
    hit(w, "v", "a", 100, { shares: MAGIC });
    applyLedger(w);
    expect(hp0 - v.hp).toBeCloseTo(mitigateShares(100, { phys: 1, magic: 0, true: 0 }, def) + mitigateShares(100, { phys: 0, magic: 1, true: 0 }, def), 9);
    expect(v.armorBonus).toBe(encodeFlat(200));
    expect(v.shieldBonus).toBe(encodeFlat(200));
  });
});

describe("G8: max hp", () => {
  it("never falls below half the faction's, and a Glass Cannon's -25% is the card that asks for less", () => {
    expect(MAX_HP_FLOOR_SHARE).toBe(0.5);
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    rows(w, "a", [{ k: "stat", stat: "maxHp", v: -0.25 }]);
    syncMaxHp(P(w, "a"));
    expect(P(w, "a").maxHp).toBeCloseTo(0.75 * FACTIONS.holy.hp, 9);
    rows(w, "a", [{ k: "stat", stat: "maxHp", v: -0.9 }]);
    syncMaxHp(P(w, "a"));
    expect(P(w, "a").maxHp).toBeCloseTo(0.5 * FACTIONS.holy.hp, 9);
    expect(P(w, "a").hp).toBeLessThanOrEqual(P(w, "a").maxHp);
    expect(foldedMaxHp(FACTIONS.holy.hp, -5)).toBe(0.5 * FACTIONS.holy.hp);
  });
});

describe("G10: move speed", () => {
  it("rows add at most +30%: a tick's walk is x1.3, not x1.45", () => {
    expect(MOVE_BONUS_CAP).toBe(0.3);
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    const a = P(w, "a");
    rows(w, "a", [{ k: "stat", stat: "moveSpeed", v: 0.45 }]);
    expect(speedMultOf(a)).toBe(1.3);
    const x0 = a.x;
    RT(w, "a").path = [{ x: x0 + 400, y: a.y }];
    tick(w);
    expect(a.x - x0).toBeCloseTo(PLAYER_SPEED * (TICK_MS / 1000) * 1.3, 9);
  });
});

describe("G11: conversions", () => {
  it("give at most +60 AD and +60 AP each, from the rows as they stood, with no conversion feeding another", () => {
    expect(CONVERT_AD_AP_CAP).toBe(60);
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    const a = P(w, "a");
    rows(w, "a", [
      { k: "flat", stat: "ad", v: 400 }, { k: "flat", stat: "ap", v: 12 },
      { k: "convert", from: "ad", to: "ap", per: 0.5 }, // Spellsword: 200 AP asked for, 60 given
      { k: "convert", from: "ad", to: "armor", per: 0.25 }, // Juggernaut reads the 400 AD, not an AD a conversion added
      { k: "convert", from: "bonusAttackSpeed", to: "ad", per: 100 },
      { k: "stat", stat: "attackSpeed", v: 0.3 },
    ]);
    expect(a.apBonus).toBe(encodeFlat(12 + 60));
    expect(a.adBonus).toBe(encodeFlat(400 + 30)); // 30 AD from 30% attack speed, under the cap
    expect(a.armorBonus).toBe(encodeFlat(100));
  });
});

describe("G12: critical strikes", () => {
  it("chance stops at 50%, the multiple is 1.5, and noCrit takes the chance away", () => {
    expect([CRIT_CHANCE_MAX, CRIT_MULT]).toEqual([0.5, 1.5]);
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    rows(w, "a", [{ k: "stat", stat: "critChance", v: 0.35 }, { k: "stat", stat: "critChance", v: 0.35 }]);
    expect(critChanceOf(P(w, "a"))).toBe(0.5);
    rows(w, "a", [{ k: "stat", stat: "critChance", v: 0.2 }]);
    expect(critChanceOf(P(w, "a"))).toBe(0.2);
    rows(w, "a", [{ k: "stat", stat: "critChance", v: 0.2 }, { k: "flag", flag: "noCrit" }]);
    expect(critChanceOf(P(w, "a"))).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The ledger's card readers (agent A2b): which mult shares G1's cap with an entry, the `vs` rows that need the world, and the
// Race to 0 that a card carries. Each fails without sim/ledger.ts passing the entry's kind, vsExtras and the card source.

describe("G1 in the ledger: an entry's own mult shares the cap, by the kind of entry", () => {
  /** What a raw-100 hit of `o`'s kind takes off an armor-free Holy from an attacker with `list` for rows (PvP factor off). */
  const lost = (list: Effect[], o: HitOpts = {}): number => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", list);
    hit(w, "v", "a", 100, o);
    applyLedger(w);
    return HOLY_HP - P(w, "v").hp;
  };

  it("a weapon hit with the `hit` mult x2: damage rows of +120% leave room for x1.25, not x2.2", () => {
    expect(lost([dmg(1.2), mult("hit", 2)])).toBeCloseTo(125, 9);
    expect(lost([dmg(1.2)])).toBeCloseTo(220, 9); // the same rows without the mult: nothing to share the cap with
    expect(lost([dmg(0.5), mult("hit", 2.5)])).toBeCloseTo(100, 9); // Boom: no room at all
    expect(lost([dmg(3), mult("hit", 0.4)])).toBeCloseTo(250, 9); // Machine Gun: the rows get the whole x2.5
  });

  it("damage over time with the `dot` mult x1.25 leaves room for x2.0", () => {
    expect(lost([dmg(1.2), mult("dot", 1.25)], { sig: "mark", shares: TRUE })).toBeCloseTo(200, 9);
    expect(lost([dmg(1.2), mult("dot", 1.25)], { sig: "burn", shares: TRUE })).toBeCloseTo(200, 9);
    expect(lost([dmg(1.2), mult("dot", 1.25)], { ability: "blaze", weapon: null, dot: true, shares: TRUE }), "a Wish is flat: no rows at all").toBeCloseTo(100, 9);
  });

  it("returned damage with the `returned` mult x1.25 leaves room for x2.0, a riposte and Fire's backlash alike", () => {
    expect(lost([dmg(1.2), mult("returned", 1.25)], { passive: true, weapon: "shield" })).toBeCloseTo(200, 9);
    expect(lost([dmg(1.2), mult("returned", 1.25)], { sig: "backlash" })).toBeCloseTo(200, 9);
  });

  it("a mult of another kind takes no room from this one", () => {
    expect(lost([dmg(1.2), mult("dot", 1.25), mult("returned", 1.25)])).toBeCloseTo(220, 9); // a plain hit
    expect(lost([dmg(1.2), mult("hit", 2.5), mult("returned", 1.25)], { sig: "mark", shares: TRUE })).toBeCloseTo(220, 9); // a tick of the mark
  });
});

describe("the `vs` rows that need the world, through the ledger (sim/vsProbe.ts)", () => {
  const vs = (test: "slowed" | "elite" | "higherPower"): Effect => ({ k: "vs", test, arg: 0, v: 0.3 });

  it("slowed: a victim under a slowMove status takes 30% more, as does one that Frost chills", () => {
    const lost = (prep: ((w: ReturnType<typeof pvpArena>) => void) | null, list: Effect[]): number => {
      const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
      rows(w, "a", list);
      prep?.(w);
      hit(w, "v", "a", 100);
      applyLedger(w);
      return HOLY_HP - P(w, "v").hp;
    };
    const slow = (w: ReturnType<typeof pvpArena>): void => {
      addStatus(w, combatant(w, "v")!, { kind: "slowMove", source: { id: "a", name: "A" }, ms: 4000, value: 0.3 });
    };
    const chill = (w: ReturnType<typeof pvpArena>): void => { P(w, "v").sig = SIG_CHILLED; };
    expect(lost(null, [vs("slowed")])).toBeCloseTo(100, 9);
    expect(lost(slow, [vs("slowed")])).toBeCloseTo(130, 9);
    expect(lost(chill, [vs("slowed")])).toBeCloseTo(130, 9);
    expect(lost(slow, [])).toBeCloseTo(100, 9);
  });

  it("elite: an elite mob takes 30% more and a normal one does not", () => {
    const lost = (elite: boolean, list: Effect[]): number => {
      const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
      rows(w, "a", list);
      const id = placeMob(w, { region: "holy", elite, at: { x: 900, y: 320 } });
      const m = w.state.mobs.get(id)!;
      const hp = m.hp;
      hit(w, id, "a", 40);
      applyLedger(w);
      return hp - m.hp;
    };
    const base = lost(true, []);
    expect(base).toBeGreaterThan(0);
    expect(lost(true, [vs("elite")])).toBeCloseTo(base * 1.3, 9);
    expect(lost(false, [vs("elite")])).toBeCloseTo(lost(false, []), 9);
  });

  it("higherPower: a victim holding more card power takes 30% more; an equal or weaker one does not", () => {
    const lost = (attackerCards: Record<string, number>, victimCards: Record<string, number>, list: Effect[]): number => {
      const w = pvpArena([
        { id: "a", faction: "fire", build: attackerCards }, { id: "v", faction: "holy", build: victimCards },
      ], { pvpRules: false });
      rows(w, "a", list);
      hit(w, "v", "a", 100);
      applyLedger(w);
      return HOLY_HP - P(w, "v").hp;
    };
    expect(lost({}, { ad3: 5 }, [vs("higherPower")])).toBeCloseTo(130, 9);
    expect(lost({ ad3: 5 }, { ad3: 5 }, [vs("higherPower")])).toBeCloseTo(100, 9);
    expect(lost({ ad3: 5 }, {}, [vs("higherPower")])).toBeCloseTo(100, 9);
    expect(lost({}, { ad3: 5 }, [])).toBeCloseTo(100, 9);
  });

  it("the hp tests still work beside them, and the probe stays lazy (the existing higherFeed and thirdParty rows are untouched)", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy", hpFrac: 0.5 }], { pvpRules: false });
    rows(w, "a", [{ k: "vs", test: "hpBelow", arg: 0.6, v: 0.5 }, vs("slowed")]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(HOLY_HP * 0.5 - P(w, "v").hp).toBeCloseTo(150, 6);
  });
});

describe("G4 from a card: the `hpRace` mult row is the source, not only the test seam", () => {
  const race = (v: number): Effect => mult("hpRace", v);

  it("multiplies what the holder deals by 1 / its hp fraction, up to the row's ceiling", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.5 }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [race(HP_RACE_CAP)]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 200, 9);
    // a lower ceiling stands: x1.5 at 40% hp (1 / 0.4 would be 2.5)
    const low = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.4 }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(low, "a", [race(1.5)]);
    hit(low, "v", "a", 100);
    applyLedger(low);
    expect(P(low, "v").hp).toBeCloseTo(HOLY_HP - 150, 9);
  });

  it("multiplies what the holder takes, whoever deals it", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy", hpFrac: 0.4 }], { pvpRules: false });
    rows(w, "v", [race(HP_RACE_CAP)]);
    const hp = P(w, "v").hp;
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(hp - P(w, "v").hp).toBeCloseTo(250, 9);
  });

  it("stops at 2.5 however large the row, and a fighter without the row is untouched", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.05 }, { id: "b", faction: "fire", hpFrac: 0.05 }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [race(10)]);
    hit(w, "v", "a", 100);
    hit(w, "v", "b", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 250 - 100, 9);
  });

  it("feeds no lifesteal with its extra damage: a Holy holder heals from the hit it would have dealt without the Race", () => {
    const run = (cards: Effect[]): { healed: number; dealt: number } => {
      const w = pvpArena([{ id: "h", faction: "holy", hpFrac: 0.5, weapon: "wand" }, { id: "v", faction: "fire" }], { pvpRules: false, signatures: true });
      rows(w, "h", cards);
      const before = P(w, "h").hp;
      const foe = P(w, "v").hp;
      inStep(w, () => { hit(w, "v", "h", 100); });
      return { healed: P(w, "h").hp - before, dealt: foe - P(w, "v").hp };
    };
    const plain = run([]);
    expect(plain.healed).toBeCloseTo(50, 6);
    expect(plain.dealt).toBeCloseTo(100, 6);
    const raced = run([race(HP_RACE_CAP)]);
    expect(raced.dealt, "the Race really doubled the hit").toBeCloseTo(200, 6);
    expect(raced.healed).toBeCloseTo(plain.healed, 6);
    // Race + a lifesteal row: the heal is still the share of the unraced damage
    expect(run([race(HP_RACE_CAP), { k: "stat", stat: "lifesteal", v: 0.1 }]).healed).toBeCloseTo(100 * lifestealShare(0.5, 0.1), 6);
  });

  it("the test seam still beats the row for the fighter it names", () => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.5 }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [race(HP_RACE_CAP)]);
    w.combat.hpRace = new Map([["a", 1.5]]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(HOLY_HP - 150, 9);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The phase-B hooks under the guards (agent A4): a critical strike and Plant Your Feet's damage are baked into the packet and share
// G1's cap with the rows, the crit accumulator never beats G12's 50%, a bleed or a returned hit is a player-to-player entry like any other
// (G2, G3), and no hook moves a Wish's cooldown but Wishful Thinking (G13).

describe("G1 with a critical strike or Plant Your Feet baked into the packet", () => {
  /** What a hit of base raw 100, baked into `packet` by a crit (x1.5) or the like, takes off an armor-free Holy from an attacker with `list` for rows. */
  const lostWith = (list: Effect[], baked: number, crit: boolean): number => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", list);
    recordHit(w, {
      victim: "v", by: { id: "a", name: "A" }, packet: { raw: 100 * baked, phys: 1, magic: 0, true: 0, mult: baked, ...(crit ? { crit: true } : {}) },
      weapon: "axe", stagger: false,
    });
    applyLedger(w);
    return HOLY_HP - P(w, "v").hp;
  };

  it("a crit leaves the rows room for x2.5 / 1.5: the whole hit stays at x2.5 of the plain one", () => {
    expect(lostWith([dmg(1.2)], 1.5, true)).toBeCloseTo(250, 9); // 150 x (2.5 / 1.5), not 150 x 2.2 = 330
    expect(lostWith([dmg(0.3)], 1.5, true)).toBeCloseTo(195, 9); // under the cap: 150 x 1.3
    expect(lostWith([dmg(1.2)], 1, false)).toBeCloseTo(220, 9); // no crit: the rows get their x2.2
  });

  it("Boom's x2.5 hit mult and a crit together are x2.5 in all: the rows give way to both", () => {
    // The packet Boom's holder records already carries its x2.5 (packetFor) and the crit its x1.5: 100 x 2.5 x 1.5 = 375 raw, 1.5 baked beyond `hit`.
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [dmg(0.5), mult("hit", 2.5)]);
    recordHit(w, { victim: "v", by: { id: "a", name: "A" }, packet: { raw: 375, phys: 1, magic: 0, true: 0, mult: 1.5, crit: true }, weapon: "axe", stagger: false });
    applyLedger(w);
    // x2.5 / (2.5 x 1.5) on the rows: 375 x 0.667 = 250, the cap's x2.5 of the plain 100 and not the 3.75 the product asks for.
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(250, 9);
  });

  it("Plant Your Feet's x1.25 is a baked multiplier too", () => {
    expect(lostWith([dmg(1.2)], 1.25, false)).toBeCloseTo(250, 9);
  });

  it("outgoingMult takes the baked multiplier as its fifth argument, 1 by default", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [dmg(1.2)]);
    expect(outgoingMult(P(w, "a"), 1, undefined, "hit")).toBeCloseTo(2.2, 12);
    expect(outgoingMult(P(w, "a"), 1, undefined, "hit", 1.5)).toBeCloseTo(2.5 / 1.5, 12);
    expect(outgoingMult(P(w, "a"), 1, undefined, "hit", 0)).toBeCloseTo(2.2, 12); // a bad value is no multiplier
  });

  it("Tunnel Vision's streak rows and a Glass Cannon's stat row share the cap like any other damage row", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", [dmg(1.5), { k: "scale", src: "streak", per: 0.04, step: 1, cap: 0.4 }]);
    expect(outgoingMult(P(w, "a"), 1, { streak: () => 10 })).toBe(2.5);
    expect(outgoingMult(P(w, "a"), 1, { streak: () => 3 })).toBeCloseTo(2.5, 12); // 1 + 1.5 + 0.12 = 2.62
    rows(w, "a", [dmg(0.5), { k: "scale", src: "streak", per: 0.04, step: 1, cap: 0.4 }]);
    expect(outgoingMult(P(w, "a"), 1, { streak: () => 3 })).toBeCloseTo(1.62, 12);
    expect(outgoingMult(P(w, "a"), 1, { streak: () => 40 })).toBeCloseTo(1.9, 12); // the row's own cap of +40%
    expect(outgoingMult(P(w, "a"), 1)).toBeCloseTo(1.5, 12); // no probe: no streak
  });
});

describe("G12: the accumulator", () => {
  it("never crits more often than the chance, and a chance past 50% is held to it", () => {
    for (const [chance, per1000] of [[1 / 3, 333], [0.2, 200], [0.5, 500], [0.9, 500], [0.05, 50]] as const) {
      const w = pvpArena([{ id: "a", faction: "holy", weapon: "sword" }, { id: "v", faction: "fire" }], { pvpRules: false });
      rows(w, "a", [{ k: "stat", stat: "critChance", v: chance }]);
      let crits = 0;
      for (let i = 0; i < 1000; i++) if (rollAttackCrit(combatant(w, "a")!)) crits++;
      expect(Math.abs(crits - per1000), `chance ${chance}`).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic: the same chance crits on the same attacks, and a fighter with none (or a mob) never does", () => {
    const seq = (): boolean[] => {
      const w = pvpArena([{ id: "a", faction: "holy", weapon: "sword" }, { id: "v", faction: "fire" }], { pvpRules: false });
      rows(w, "a", [{ k: "stat", stat: "critChance", v: 0.3 }]);
      return Array.from({ length: 30 }, () => rollAttackCrit(combatant(w, "a")!));
    };
    expect(seq()).toEqual(seq());
    const w = pvpArena([{ id: "a", faction: "holy", weapon: "sword" }, { id: "v", faction: "fire" }], { pvpRules: false });
    expect(Array.from({ length: 20 }, () => rollAttackCrit(combatant(w, "a")!)).some(Boolean)).toBe(false);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    expect(rollAttackCrit(combatant(w, mob)!)).toBe(false);
  });
});

describe("the hooks' damage is player-to-player damage like any other (G2, G3)", () => {
  it("a bleed counts in G3's per-second budget with the rest of its source's damage over time", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    addStatus(w, combatant(w, "v")!, { kind: "dot", source: { id: "a", name: "A" }, ms: 5000, tag: "bleed:1", value: 1_000_000, data: { shares: { phys: 1, magic: 0, true: 0 } } }, { quiet: true });
    const before = P(w, "v").hp;
    tick(w);
    const budget = PVP_DOT_CAP_SHARE * P(w, "v").maxHp * DT;
    expect(before - P(w, "v").hp).toBeCloseTo(budget, 6);
  });

  it("Spiked Shell's returned damage and an Overkill splash are capped to 35% of the victim's max hp, as a hit", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 5 } }, { id: "v", faction: "holy" }]);
    inStep(w, () => { recordHit(w, { victim: "v", by: { id: "a", name: "A" }, packet: { raw: 1_000_000, phys: 1, magic: 0, true: 0 }, weapon: "axe", stagger: false, passive: true, final: true, derived: true }); });
    expect(HOLY_HP - P(w, "v").hp).toBeCloseTo(PVP_HIT_CAP_SHARE * HOLY_HP, 6);
  });
});

describe("G13: Wishes stay flat but for Arcane Overload and Wishful Thinking", () => {
  it("no phase-B card moves a Wish's cooldown multiplier", () => {
    const w = pvpArena([{ id: "a", faction: "holy" }, { id: "v", faction: "fire" }], { pvpRules: false });
    const everyHook = ["festeringArcana", "rhythm", "overkill", "tankEngine", "pocketSand", "gambler", "adrenaline", "cruelWounds", "thirdTimesTheCharm",
      "eyeForAnEye", "bestOffense", "tunnelVision", "firstImpressions", "plantYourFeet", "wishfulThinking", "hemorrhage", "spikedShell"];
    for (const id of everyHook) {
      const def = cardDef(id)!;
      for (const row of def.effects) expect(row.k === "mult" && row.key === "wishCooldown", `${id} ${JSON.stringify(row)}`).toBe(false);
    }
    expect(wishCooldownMultOf(P(w, "a"))).toBe(1);
  });
});
