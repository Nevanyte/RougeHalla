// The PvP factor (BALANCE_CONTRACT 3.4, decision D7): every player-to-player ledger entry is multiplied by pvpFactor(card power of
// its attacker), and so is the mark's pulse (a share of the target's max hp paid with each landed hit). It is read from the state as the pass began, so no
// order decides it, and it never touches mobs, dummies, Wishes or the arena. The harness's duelScale seam multiplies next to it.
import { describe, expect, it } from "vitest";
import { cardPower, FACTIONS, MARK_AS_EXPONENT, markPct, markWeight, pacedFaction, pvpFactor, PVP_F0, PVP_FMAX, PVP_P0 } from "@raid/shared";
import { attackSpeedMult } from "../src/sim/buffs";
import { modsOf } from "../src/sim/mods";
import { applyLedger } from "../src/sim/ledger";
import { noteContact } from "../src/sim/factions";
import { addMob } from "../src/sim/mobs";
import { hit, inStep, MAGIC, pvpArena, P, RT, tick, TRUE } from "./support/pvpRig";

const F0 = pvpFactor(0);

describe("the PvP factor on a player-to-player hit", () => {
  it("multiplies a weapon hit by f(0) when neither holds a card", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100 * F0, 9);
    expect(F0).toBe(PVP_F0);
  });

  it("follows the attacker's card power: P = the sum of tier x count over its cards", () => {
    // ad2 x2 (tier 2, twice) and haste1: P = 5
    const build = { ad2: 2, haste1: 1 };
    expect(cardPower(build)).toBe(5);
    const w = pvpArena([{ id: "a", faction: "fire", build }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100 * pvpFactor(5), 9);
    expect(pvpFactor(5)).toBeCloseTo(PVP_F0 + (PVP_FMAX - PVP_F0) * (1 - Math.exp(-5 / PVP_P0)), 12);
  });

  it("reads the attacker's power, not the victim's", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy", build: { ad3: 3 } }]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100 * F0, 9);
  });

  it("multiplies signature damage too (a burn, a mark), typed or not", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad1: 1 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 5, { sig: "mark", shares: TRUE }); // a tick's chunk: under the DoT budget (G3) of 10.5 on a 1,400-hp Holy
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 5 * pvpFactor(1), 9);
  });

  it("is applied before mitigation, so armor and magic resist cut the multiplied hit", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad1: 1 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 100, { shares: MAGIC });
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - (100 * pvpFactor(1)) / (1 + FACTIONS.holy.shield / 100), 9);
  });
});

describe("what the PvP factor never touches", () => {
  it("a mob's hit on a player, a player's hit on a mob, and a dummy", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 2 } }, { id: "v", faction: "holy" }]);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    const mobHp = w.state.mobs.get(mob)!.hp;
    hit(w, mob, "a", 100);
    applyLedger(w);
    expect(w.state.mobs.get(mob)!.hp).toBeCloseTo(mobHp - 100, 9);
    // The mob is the dealer: a mob is not in state.players, so nothing scales (and it has no card power).
    hit(w, "v", mob, 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100, 9);
  });

  it("a Wish's damage (an ability entry) and the arena's own damage", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 2 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 5, { ability: "blaze", weapon: null, dot: true, shares: TRUE }); // small enough for the DoT cap (G3) not to bind
    hit(w, "v", "a", 10, { arena: true });
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 15, 9);
  });

  it("an entry scaled to 0 (a mob on a mob, a destroyed ball) stays 0", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 2 } }, { id: "v", faction: "holy" }]);
    hit(w, "v", "a", 100, { scale: 0 });
    applyLedger(w);
    expect(P(w, "v").hp).toBe(FACTIONS.holy.hp);
  });

  it("nothing when the rules are off (the arithmetic worlds of the other tests)", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad3: 2 } }, { id: "v", faction: "holy" }], { pvpRules: false });
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100, 9);
  });
});

describe("order independence", () => {
  it("two attackers hitting each other in one pass use their pass-start power, whatever order the entries were recorded in", () => {
    const run = (swap: boolean): number[] => {
      const w = pvpArena([
        { id: "a", faction: "holy", build: { ad3: 1 } },
        { id: "b", faction: "holy", build: { ad1: 1 } },
        { id: "c", faction: "holy" },
      ]);
      inStep(w, () => {
        const order = [["b", "a", 100], ["a", "b", 100], ["c", "a", 50]] as const;
        for (const [v, by, raw] of swap ? [...order].reverse() : order) hit(w, v, by, raw);
      });
      return ["a", "b", "c"].map((id) => P(w, id).hp);
    };
    expect(run(true)).toEqual(run(false));
  });

  it("a card taken in the inputs phase counts in that tick's pass (the build is read as the pass begins)", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    inStep(w, () => {
      P(w, "a").build.set("ad3", 1);
      hit(w, "v", "a", 100);
    });
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100 * pvpFactor(3), 9);
  });
});

describe("the duelScale seam", () => {
  it("multiplies an attacker's player-to-player entries next to the factor", () => {
    const w = pvpArena([{ id: "a", faction: "fire", build: { ad1: 1 } }, { id: "v", faction: "holy" }]);
    w.combat.duelScale = new Map([["a", 1.5]]);
    hit(w, "v", "a", 100);
    applyLedger(w);
    expect(P(w, "v").hp).toBeCloseTo(FACTIONS.holy.hp - 100 * pvpFactor(1) * 1.5, 9);
  });

  it("is ignored for a mob victim", () => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }]);
    const mob = addMob(w, { kind: "dummy", name: "Warden", at: { x: 900, y: 320 } });
    w.combat.duelScale = new Map([["a", 3]]);
    const hp = w.state.mobs.get(mob)!.hp;
    hit(w, mob, "a", 100);
    applyLedger(w);
    expect(w.state.mobs.get(mob)!.hp).toBeCloseTo(hp - 100, 9);
  });
});

describe("the mark's pulse", () => {
  const SENTENCED = pacedFaction(FACTIONS.sentenced);
  /** A Sentenced on a bow lands one hit on a player (or a mob) 40 u away: the damage its first pulse did, and the victim's max hp. */
  const pulse = (build: Record<string, number>, against: "player" | "mob", rules = true): { amount: number; maxHp: number; expectedRaw: number } => {
    const w = pvpArena([
      { id: "s", faction: "sentenced", at: { x: 300, y: 320 }, weapon: "bow", build },
      { id: "v", faction: "holy", at: { x: 340, y: 320 }, weapon: "" },
    ], { pvpRules: rules, signatures: true });
    let victim = "v";
    if (against === "mob") {
      victim = addMob(w, { kind: "dummy", name: "Warden", at: { x: 340, y: 320 } });
      RT(w, "v").path = [];
      P(w, "v").x = 900;
      P(w, "v").y = 320;
    }
    noteContact(w, "s", victim);
    inStep(w, () => hit(w, victim, "s", 1, { weapon: "bow" }));
    const pulses = w.combat.landed.filter((h) => h.by === "s" && h.sig === "mark");
    expect(pulses).toHaveLength(1);
    const maxHp = against === "mob" ? w.state.mobs.get(victim)!.maxHp : P(w, victim).maxHp;
    const mirrors = modsOf(P(w, "s"));
    const expectedRaw = markPct(SENTENCED, 0, 1, {
      ad: mirrors.adBonus, ap: mirrors.apBonus, armor: mirrors.armorBonus, magicResist: mirrors.shieldBonus,
    }) * maxHp * markWeight(SENTENCED, "bow", attackSpeedMult(P(w, "s")), MARK_AS_EXPONENT);
    return { amount: pulses[0]!.amount, maxHp, expectedRaw };
  };

  it("is paid at f(0) against a player with no cards, and at f(P) with them", () => {
    const none = pulse({}, "player");
    expect(none.amount).toBeCloseTo(none.expectedRaw * pvpFactor(0), 6);
    const carded = pulse({ ad3: 2 }, "player");
    expect(carded.amount).toBeCloseTo(carded.expectedRaw * pvpFactor(6), 6);
    expect(carded.amount).toBeGreaterThan(none.amount * 2);
  });

  it("is paid whole against a mob, and with the rules off", () => {
    const mob = pulse({ ad3: 2 }, "mob");
    expect(mob.amount).toBeCloseTo(mob.expectedRaw, 6);
    const off = pulse({ ad3: 2 }, "player", false);
    expect(off.amount).toBeCloseTo(off.expectedRaw, 6);
  });
});
