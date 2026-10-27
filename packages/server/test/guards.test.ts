// The PvP guards of the balance pass (BALANCE_CONTRACT 4.6): G2 (no player-to-player hit takes more than 35% of the victim's max
// hp), G3 (one source's damage over time on a player takes at most 15% of max hp a second) and G4 (A Race to 0: damage dealt and
// taken is multiplied by 1 / hp fraction up to 2.5, from the hp as the pass began, and its extra damage feeds no lifesteal). The
// other guards (G1, G5-G13) belong to the card engine's tests. Builds are crafted by hand: the cards' own text is agent A3's.
import { describe, expect, it } from "vitest";
import {
  FACTIONS, HP_RACE_CAP, hpRaceMult, PVP_DOT_CAP_SHARE, PVP_HIT_CAP_SHARE, pvpFactor, TICK_MS,
} from "@raid/shared";
import { applyLedger } from "../src/sim/ledger";
import { addMob } from "../src/sim/mobs";
import { hit, inStep, MAGIC, pvpArena, P, TRUE } from "./support/pvpRig";

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
