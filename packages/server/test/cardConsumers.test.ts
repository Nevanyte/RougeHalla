// The card engine's readers, wired into the combat code (balance pass, BALANCE_CONTRACT 3.3 and 4.6; agent A2b). Each test
// crafts a build by hand (setExtraRows, the rows a card folds into) and checks the live consumer, so it fails without the wiring:
//   sim/factions.ts  the `dot` and `returned` mults on the signatures, AP on damage over time (0.6 x AP of magic damage a second per
//                    running DoT signature, as its own ledger entry), Slow Burn's linger, the lifesteal system (Bloodthirst's
//                    `lifestealMult`, Siphon's `lifestealDot`, G5), `heal()`'s healTaken (Wellspring, Vampiric Pact) and the chill
//                    under `slowResist` (Iron Will);
//   sim/status.ts    slowMove and slowAttack statuses under `slowResist`.
// The ledger's own readers (G1's kind, the `vs` extras, the Race to 0 card source) are in guards.test.ts; the bog is in terrain.test.ts.
import { describe, expect, it } from "vitest";
import {
  AP_DOT_RATIO, backlashPerSwing, bonusMultiplier, burnDps, CHILL_MOVE_MULT, chillMultiplier, diseaseDps, ENGAGE_LINGER_SECONDS,
  EXECUTE_BAND, FACTIONS, lifestealFraction, lifestealTotal, markDps, mitigateShares, pacedFaction, resistSlow, SIGNATURE_WEAPONS, TICK_MS,
  type DamageShares, type Effect, type FactionId, type SignatureKind, type WeaponId,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { heal, noteContact, signatureState } from "../src/sim/factions";
import { asMultOf, recomputeMods, setExtraRows } from "../src/sim/mods";
import { addStatus, attackSlowFactor, statusMoveMultiplier } from "../src/sim/status";
import { chainHook, type LedgerEntry, type World } from "../src/sim/world";
import { hit, inStep, pvpArena, P, TRUE, tick } from "./support/pvpRig";

const DT = TICK_MS / 1000;
const spec = (f: FactionId) => pacedFaction(FACTIONS[f]);
const rows = (w: World, id: string, list: Effect[]): void => setExtraRows(w, combatant(w, id)!, list);
const ap = (v: number): Effect => ({ k: "flat", stat: "ap", v });
const mult = (key: Extract<Effect, { k: "mult" }>["key"], v: number): Effect => ({ k: "mult", key, v });
const stat = (s: Extract<Effect, { k: "stat" }>["stat"], v: number): Effect => ({ k: "stat", stat: s, v });

/** Attacker "a" of `faction` with `list` for rows, in contact with an unarmed Holy "v" 36 u away, with the entries "a" lands recorded. */
function engagedPair(faction: FactionId, list: Effect[], weapon: WeaponId = SIGNATURE_WEAPONS[faction], foe: FactionId = "holy") {
  const w = pvpArena([
    { id: "a", faction, weapon, at: { x: 200, y: 320 } },
    { id: "v", faction: foe, weapon: "", at: { x: 236, y: 320 } },
  ], { pvpRules: false, signatures: true });
  rows(w, "a", list);
  noteContact(w, "a", "v");
  const seen: LedgerEntry[] = [];
  chainHook(w, "hitLanded", (_w, e) => { if (e.by.id === "a") seen.push(e); });
  return { w, seen };
}

/** What `a` landed under `sig` since the last call, in the order it was recorded. */
function drain(seen: LedgerEntry[], sig: SignatureKind): LedgerEntry[] {
  return seen.splice(0).filter((e) => e.sig === sig);
}

const MAGIC_SHARES: DamageShares = { phys: 0, magic: 1, true: 0 };

describe("AP on damage over time (BALANCE_CONTRACT 3.3)", () => {
  const AP = 100;
  const apTick = AP_DOT_RATIO * AP * DT;

  it("Fire: the burn tick and a second, magic entry of 0.6 x AP a second under the same sig", () => {
    const { w, seen } = engagedPair("fire", [ap(AP)]);
    tick(w);
    const burn = drain(seen, "burn");
    expect(burn).toHaveLength(2);
    expect(burn[0]!.packet.raw).toBeCloseTo(burnDps(spec("fire")) * bonusMultiplier(SIGNATURE_WEAPONS.fire) * DT, 9);
    expect(burn[1]!.packet.raw).toBeCloseTo(apTick, 9);
    expect(burn[1]!.packet).toMatchObject(MAGIC_SHARES);
    expect(apTick).toBeCloseTo(3, 12);
  });

  it("no AP, no second entry", () => {
    const { w, seen } = engagedPair("fire", []);
    tick(w);
    expect(drain(seen, "burn")).toHaveLength(1);
  });

  it("Plague: beside the disease, whatever weapon is in hand (AP is flat: no weapon multiplier)", () => {
    for (const weapon of ["bow", "sword"] as const) {
      const { w, seen } = engagedPair("plague", [ap(AP)], weapon);
      tick(w);
      const disease = drain(seen, "disease");
      expect(disease, weapon).toHaveLength(2);
      expect(disease[0]!.packet.raw).toBeCloseTo(diseaseDps(spec("plague"), 1, EXECUTE_BAND) * bonusMultiplier(weapon) * DT, 9);
      expect(disease[1]!.packet.raw, weapon).toBeCloseTo(apTick, 9);
    }
  });

  it("Sentenced: the mark is the true damage, the AP part still magic; neither runs on the tick the mark has not started", () => {
    const { w, seen } = engagedPair("sentenced", [ap(AP)]);
    tick(w);
    expect(drain(seen, "mark"), "the ramp has not begun: no mark, so no AP on it").toHaveLength(0);
    tick(w);
    const mark = drain(seen, "mark");
    expect(mark).toHaveLength(2);
    expect(mark[0]!.packet.raw).toBeCloseTo(markDps(spec("sentenced"), DT) * bonusMultiplier("bow") * DT, 9);
    expect(mark[0]!.packet).toMatchObject({ phys: 0, magic: 0, true: 1 });
    expect(mark[1]!.packet.raw).toBeCloseTo(apTick, 9);
    expect(mark[1]!.packet).toMatchObject(MAGIC_SHARES);
  });

  it("Frost and Holy have no damage-over-time signature: their AP adds nothing", () => {
    for (const faction of ["frost", "holy"] as const) {
      const { w, seen } = engagedPair(faction, [ap(AP)]);
      tick(w);
      tick(w);
      expect(seen.filter((e) => e.sig !== undefined), faction).toEqual([]);
    }
  });

  it("is multiplied by the `dot` mult with the rest of the tick (Boom x1.25, Slow Burn x0.7)", () => {
    for (const m of [1.25, 0.7]) {
      const { w, seen } = engagedPair("fire", [ap(AP), mult("dot", m)]);
      tick(w);
      const burn = drain(seen, "burn");
      expect(burn[0]!.packet.raw, `main x${m}`).toBeCloseTo(burnDps(spec("fire")) * bonusMultiplier(SIGNATURE_WEAPONS.fire) * DT * m, 9);
      expect(burn[1]!.packet.raw, `AP x${m}`).toBeCloseTo(apTick * m, 9);
    }
  });

  it("is paused by a stagger with the signature (the same share of the tick)", () => {
    const { w, seen } = engagedPair("fire", [ap(AP)]);
    tick(w);
    seen.length = 0;
    w.factions!.fighters.get("a")!.dotPausedUntil = w.state.serverTime + TICK_MS / 2; // the first half of the next tick is paused
    tick(w);
    const burn = drain(seen, "burn");
    expect(burn).toHaveLength(2);
    expect(burn[1]!.packet.raw).toBeCloseTo(apTick / 2, 9);
    expect(burn[0]!.packet.raw).toBeCloseTo((burnDps(spec("fire")) * bonusMultiplier(SIGNATURE_WEAPONS.fire) * DT) / 2, 9);
  });
});

describe("the `dot` and `returned` mults on the signatures", () => {
  /** The pair with the victim's swing landing in the first tick (the backlash answers each attack the target performs). */
  function backlashPair(list: Effect[]) {
    const { w, seen } = engagedPair("fire", list);
    w.afterWeapons.unshift(() => {
      w.combat.melee.push({ attacker: "v", weapon: "sword", a: 0, rewindT: w.state.serverTime, packet: { raw: 0, phys: 1, magic: 0, true: 0 } });
    });
    return { w, seen };
  }

  it("Boom's returned x1.25 multiplies Fire's backlash, and its dot x1.25 the burn, each on its own", () => {
    const base = backlashPair([]);
    tick(base.w);
    const [plain] = drain(base.seen, "backlash");
    const raw = backlashPerSwing(spec("fire").params.backlash!, spec("holy"), "sword") * bonusMultiplier(SIGNATURE_WEAPONS.fire);
    expect(plain!.packet.raw).toBeCloseTo(raw, 9);

    const boom = backlashPair([mult("dot", 1.25), mult("returned", 1.25)]);
    tick(boom.w);
    const [returned] = drain(boom.seen, "backlash");
    expect(returned!.packet.raw).toBeCloseTo(raw * 1.25, 9);

    const onlyReturned = backlashPair([mult("returned", 1.25)]);
    tick(onlyReturned.w);
    const burn = drain(onlyReturned.seen, "burn");
    expect(burn[0]!.packet.raw, "the burn is not returned damage").toBeCloseTo(burnDps(spec("fire")) * bonusMultiplier(SIGNATURE_WEAPONS.fire) * DT, 9);

    const onlyDot = backlashPair([mult("dot", 0.7)]);
    tick(onlyDot.w);
    expect(drain(onlyDot.seen, "backlash")[0]!.packet.raw, "the backlash is not damage over time").toBeCloseTo(raw, 9);
  });
});

describe("Slow Burn: a damage-over-time signature lingers longer after the fight breaks off", () => {
  /** Ticks that carried a burn after the target left reach in the first tick (the burn of that first tick included). */
  function burningTicks(list: Effect[]): number {
    const { w, seen } = engagedPair("fire", list, "sword");
    tick(w);
    let n = drain(seen, "burn").length > 0 ? 1 : 0;
    P(w, "v").x = 700; // far out of reach, in the clear
    for (let i = 0; i < 80; i++) {
      tick(w);
      if (drain(seen, "burn").length > 0) n++;
    }
    return n;
  }
  const LINGER_TICKS = Math.round((ENGAGE_LINGER_SECONDS * 1000) / TICK_MS);

  it("burns ENGAGE_LINGER_SECONDS after the target leaves reach, and twice that with a linger x2", () => {
    expect(burningTicks([])).toBe(1 + LINGER_TICKS);
    expect(burningTicks([mult("linger", 2)])).toBe(1 + 2 * LINGER_TICKS);
  });

  it("at the card's 30% less per second", () => {
    const { w, seen } = engagedPair("fire", [mult("linger", 2), mult("dot", 0.7)], "sword");
    tick(w);
    seen.length = 0;
    P(w, "v").x = 700;
    tick(w);
    expect(drain(seen, "burn")[0]!.packet.raw).toBeCloseTo(burnDps(spec("fire")) * bonusMultiplier("sword") * DT * 0.7, 9);
  });

  it("means nothing to a faction with no damage over time: a Frost's engagement ends on time", () => {
    const { w } = engagedPair("frost", [mult("linger", 2)], "sword");
    tick(w);
    P(w, "v").x = 700;
    for (let i = 1; i <= LINGER_TICKS; i++) tick(w);
    expect(signatureState(w, "a")!.engaged, "still lingering at the plain limit").toBe(true);
    tick(w);
    expect(signatureState(w, "a")!.engaged, "and over one tick later, linger card or not").toBe(false);
  });
});

describe("lifesteal under the card readers (G5)", () => {
  /** hp "a" regains from `hits` landing in one tick (hp 50%: nothing is capped by max hp). */
  function healed(faction: FactionId, list: Effect[], hits: Array<{ raw: number; dot?: "mark" | "ability" }>, weapon: WeaponId | "" = ""): number {
    const w = pvpArena([{ id: "a", faction, hpFrac: 0.5, weapon }, { id: "v", faction: "holy" }], { pvpRules: false, signatures: true });
    rows(w, "a", list);
    const before = P(w, "a").hp;
    inStep(w, () => {
      for (const h of hits) {
        if (h.dot === "mark") hit(w, "v", "a", h.raw, { sig: "mark", shares: TRUE });
        else if (h.dot === "ability") hit(w, "v", "a", h.raw, { ability: "blaze", weapon: null, dot: true, shares: TRUE });
        else hit(w, "v", "a", h.raw);
      }
    });
    return P(w, "a").hp - before;
  }

  it("Bloodthirst's lifestealMult doubles the rows' share (0.2 becomes 0.4)", () => {
    expect(healed("fire", [stat("lifesteal", 0.2)], [{ raw: 100 }])).toBeCloseTo(20, 6);
    expect(healed("fire", [stat("lifesteal", 0.2), stat("lifestealMult", 1)], [{ raw: 100 }])).toBeCloseTo(40, 6);
  });

  it("never doubles Holy's own share, and the total stops at LIFESTEAL_MAX", () => {
    // Holy at 50% hp: its own 10% + 80% of what is missing = 50% of the damage it lands.
    const own = lifestealFraction(FACTIONS.holy, 0.5);
    expect(own).toBeCloseTo(0.5, 12);
    expect(healed("holy", [stat("lifesteal", 0.1), stat("lifestealMult", 1)], [{ raw: 100 }], "wand")).toBeCloseTo(100 * lifestealTotal(own, 0.1, 2), 6);
    expect(lifestealTotal(own, 0.1, 2)).toBeCloseTo(0.7, 12);
    expect(healed("holy", [stat("lifesteal", 0.25), stat("lifestealMult", 1)], [{ raw: 100 }], "wand")).toBeCloseTo(85, 6);
  });

  it("Siphon heals a share of the damage over time it deals and nothing of a plain hit", () => {
    const siphon = [stat("lifestealDot", 0.2)];
    expect(healed("fire", siphon, [{ raw: 100, dot: "mark" }])).toBeCloseTo(20, 6);
    expect(healed("fire", siphon, [{ raw: 100 }])).toBeCloseTo(0, 6);
    expect(healed("fire", siphon, [{ raw: 100, dot: "mark" }, { raw: 100 }])).toBeCloseTo(20, 6);
    expect(healed("fire", siphon, [{ raw: 100, dot: "ability" }]), "a Wish's damage over time is damage over time too").toBeCloseTo(20, 6);
  });

  it("Siphon stacks on the rows (doubled by Bloodthirst) for damage over time only", () => {
    const both = [stat("lifesteal", 0.2), stat("lifestealMult", 1), stat("lifestealDot", 0.2)];
    expect(healed("fire", both, [{ raw: 100 }])).toBeCloseTo(40, 6);
    expect(healed("fire", both, [{ raw: 100, dot: "mark" }])).toBeCloseTo(60, 6);
    expect(healed("fire", both, [{ raw: 100 }, { raw: 100, dot: "mark" }])).toBeCloseTo(100, 6);
    expect(lifestealTotal(0, 0.2, 2, 0.2)).toBeCloseTo(0.6, 12);
  });

  it("a fighter with no lifesteal rows heals nothing (and Holy's own is untouched by an empty Siphon)", () => {
    expect(healed("fire", [], [{ raw: 100 }])).toBe(0);
    expect(healed("holy", [], [{ raw: 100 }], "wand")).toBeCloseTo(50, 6);
  });
});

describe("healTaken (Wellspring, Vampiric Pact)", () => {
  const gain = (list: Effect[], amount = 100, opts: { lifesteal?: boolean } = {}): number => {
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.4 }, { id: "v", faction: "holy" }], { pvpRules: false, signatures: true });
    rows(w, "a", list);
    return heal(w, combatant(w, "a")!, amount, { ignoreLockout: true, ...opts });
  };

  it("Wellspring makes every heal 25% stronger", () => {
    expect(gain([])).toBeCloseTo(100, 9);
    expect(gain([stat("healTaken", 0.25)])).toBeCloseTo(125, 9);
  });

  it("Vampiric Pact takes the heal away, and a lesser value takes part of it", () => {
    expect(gain([stat("healTaken", -1)])).toBe(0);
    expect(gain([stat("healTaken", -0.5)])).toBeCloseTo(50, 9);
    expect(gain([stat("healTaken", -3)])).toBe(0); // never a negative heal
  });

  it("is exempt for lifesteal", () => {
    expect(gain([stat("healTaken", -1)], 100, { lifesteal: true })).toBeCloseTo(100, 9);
    expect(gain([stat("healTaken", 0.25)], 100, { lifesteal: true })).toBeCloseTo(100, 9);
    // through the live lifesteal system: a Holy with Vampiric Pact still heals from its hits
    const w = pvpArena([{ id: "h", faction: "holy", hpFrac: 0.5, weapon: "wand" }, { id: "v", faction: "fire" }], { pvpRules: false, signatures: true });
    rows(w, "h", [stat("healTaken", -1)]);
    const before = P(w, "h").hp;
    inStep(w, () => { hit(w, "v", "h", 100); });
    expect(P(w, "h").hp - before).toBeCloseTo(50, 6);
  });

  it("also scales what the camp heal, a heal over time and Last Stand pay (all go through heal())", () => {
    // heal() is the one funnel; a heal that arrives at full hp is cut by max hp, not by the multiplier
    const w = pvpArena([{ id: "a", faction: "fire", hpFrac: 0.9 }, { id: "v", faction: "holy" }], { pvpRules: false, signatures: true });
    rows(w, "a", [stat("healTaken", 0.25)]);
    expect(heal(w, combatant(w, "a")!, 1000, { ignoreLockout: true })).toBeCloseTo(0.1 * FACTIONS.fire.hp, 6);
  });
});

describe("slowResist (Iron Will)", () => {
  const slowed = (kind: "slowMove" | "slowAttack", value: number, list: Effect[]) => {
    const w = pvpArena([{ id: "a", faction: "fire" }, { id: "v", faction: "holy" }], { pvpRules: false });
    rows(w, "a", list);
    const c = combatant(w, "a")!;
    addStatus(w, c, { kind, source: { id: "v", name: "V" }, ms: 4000, value });
    recomputeMods(w, c);
    return { w, c };
  };

  it("resistSlow takes a share off the cut: 0.7 becomes 0.82 at 40%, 1 at 100%, and a non-slow passes", () => {
    expect(resistSlow(0.7, 0.4)).toBeCloseTo(0.82, 12);
    expect(resistSlow(0.7, 0)).toBe(0.7);
    expect(resistSlow(0.7, 1)).toBe(1);
    expect(resistSlow(0.7, 5)).toBe(1);
    expect(resistSlow(1, 0.4)).toBe(1);
    expect(resistSlow(1.3, 0.4)).toBe(1.3);
  });

  it("a slowMove status cuts the walk by its value, less by the resist", () => {
    const plain = slowed("slowMove", 0.4, []);
    expect(statusMoveMultiplier(plain.w, plain.c)).toBeCloseTo(0.6, 12);
    const iron = slowed("slowMove", 0.4, [stat("slowResist", 0.4)]);
    expect(statusMoveMultiplier(iron.w, iron.c)).toBeCloseTo(1 - 0.4 * 0.6, 12);
    const all = slowed("slowMove", 0.4, [stat("slowResist", 1)]);
    expect(statusMoveMultiplier(all.w, all.c)).toBeCloseTo(1, 12);
  });

  it("a slowAttack status cuts the attack-speed mirror by its value, less by the resist", () => {
    const plain = slowed("slowAttack", 0.3, []);
    expect(attackSlowFactor(plain.w, plain.c)).toBeCloseTo(0.7, 12);
    expect(asMultOf(plain.c.s)).toBeCloseTo(0.7, 3);
    const iron = slowed("slowAttack", 0.3, [stat("slowResist", 0.4)]);
    expect(attackSlowFactor(iron.w, iron.c)).toBeCloseTo(0.82, 12);
    expect(asMultOf(iron.c.s)).toBeCloseTo(0.82, 3);
  });

  it("the resist reaches the mirror when the card is taken after the slow (the per-tick pass asks the source again)", () => {
    const { w, c } = slowed("slowAttack", 0.3, []);
    expect(asMultOf(c.s)).toBeCloseTo(0.7, 3);
    rows(w, "a", [stat("slowResist", 0.4)]);
    tick(w);
    expect(asMultOf(c.s)).toBeCloseTo(0.82, 3);
  });

  describe("Frost's chill", () => {
    const CHILL = chillMultiplier(FACTIONS.frost);
    /** A Frost in contact with a Fire with `list` for rows: the Fire's chill after a tick, and the move modifiers' product on it. */
    function chilled(list: Effect[]) {
      const w = pvpArena([
        { id: "f", faction: "frost", weapon: "sword", at: { x: 200, y: 320 } },
        { id: "v", faction: "fire", weapon: "sword", at: { x: 236, y: 320 } },
      ], { pvpRules: false, signatures: true });
      rows(w, "v", list);
      noteContact(w, "f", "v");
      tick(w);
      const v = combatant(w, "v")!;
      const walk = w.moveModifiers.reduce((acc, mod) => acc * mod(w, v, TICK_MS), 1);
      return { chill: signatureState(w, "v")!.chill, walk };
    }

    it("cuts the attack rate and the walk, less by the resist", () => {
      const plain = chilled([]);
      expect(plain.chill).toBeCloseTo(CHILL, 12);
      expect(plain.walk).toBeCloseTo(CHILL_MOVE_MULT, 12);
      const iron = chilled([stat("slowResist", 0.4)]);
      expect(iron.chill).toBeCloseTo(resistSlow(CHILL, 0.4), 12);
      expect(iron.chill).toBeGreaterThan(plain.chill);
      expect(iron.walk).toBeCloseTo(resistSlow(CHILL_MOVE_MULT, 0.4), 12);
      expect(iron.walk).toBeCloseTo(0.82, 12);
    });

    it("a resist of 100% is no chill at all", () => {
      const all = chilled([stat("slowResist", 1)]);
      expect(all.chill).toBe(1);
      expect(all.walk).toBe(1);
    });
  });
});

describe("the AP entry is magic damage", () => {
  it("it is cut by the victim's magic resist and not by its armor", () => {
    const { w } = engagedPair("fire", [ap(100)]);
    const v = P(w, "v");
    const hp = v.hp;
    tick(w);
    const def = { armor: FACTIONS.holy.armor, shield: FACTIONS.holy.shield };
    const main = burnDps(spec("fire")) * bonusMultiplier(SIGNATURE_WEAPONS.fire) * DT;
    const apPart = AP_DOT_RATIO * 100 * DT;
    expect(hp - v.hp).toBeCloseTo(mitigateShares(main, MAGIC_SHARES, def) + mitigateShares(apPart, MAGIC_SHARES, def), 9);
    expect(mitigateShares(apPart, MAGIC_SHARES, def)).toBeLessThan(mitigateShares(apPart, { phys: 1, magic: 0, true: 0 }, def));
  });
});
