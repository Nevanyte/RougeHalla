// The roguelike buffs (R4a, ROGUELIKE_PLAN 3.4): the S-curve, the 20-row catalog as the plan's table quotes it, the rows
// scaled to a stack count, the wording, the HUD's views, lifesteal's caps and the quantized stat mirrors.
import { describe, expect, it } from "vitest";
import {
  AS_MULT_CAP, BUFF_IDS, BUFF_PLATEAU, BUFF_REF_STACKS, buffCurve, buffDef, buffPower, buffRows, buffRowsOf, buffScale, buffsCountering,
  buffText, buffToast, buffView, buffViews, BUFFS, decodeMult, ELITE_BUFF_STACKS, encodeMult, FACTION_IDS, hasAnyBuffs,
  IDENTITY_MIRRORS, LIFESTEAL_MAX, lifestealShare, LS_CAP, MOB_BUFF_STACKS, MOB_TYPES, MOD_MULT_MAX, MOD_MULT_MIN,
  MULT_WIRE_PER_UNIT, capAsMult, foldStatRows, mirrorsFromSums, scaleEffect, scaleWindup, sigmoid, weaponTimings,
  WIRE_IDENTITY_MIRRORS, type Effect,
} from "../src/index";

const S = (x: number): number => sigmoid((x - 3) / 1) - sigmoid(-3);

describe("the buff curve", () => {
  it("is the plan's S(x) = sigmoid(x - 3) - sigmoid(-3), 0 at no stacks", () => {
    for (const x of [0.1, 0.5, 1, 2, 3, 4.5, 6, 10]) expect(buffCurve(x)).toBeCloseTo(S(x), 15);
    expect(buffCurve(0)).toBe(0);
    expect(buffCurve(-1)).toBe(0);
    expect(buffCurve(Number.NaN)).toBe(0);
  });

  it("scales the quoted value: 0.16x at 1 stack, 0.49x at 2, 1x at 3, 1.51x at 4, 2x at 6, a plateau of about 2.1x", () => {
    expect(buffScale(BUFF_REF_STACKS)).toBe(1);
    expect(buffScale(1)).toBeCloseTo(0.159, 3);
    expect(buffScale(2)).toBeCloseTo(0.489, 3);
    expect(buffScale(4)).toBeCloseTo(1.511, 3);
    expect(buffScale(6)).toBeCloseTo(2.0, 2);
    expect(BUFF_PLATEAU).toBeCloseTo(2.105, 3);
    expect(buffScale(1e6)).toBeCloseTo(BUFF_PLATEAU, 12);
    let last = 0;
    for (let x = 0.05; x < 12; x += 0.05) {
      const k = buffScale(x);
      expect(k).toBeGreaterThan(last);
      last = k;
    }
  });

  it("one camp at feed 0 (3 to 5 kills of 1.1 x 0.976) gives 1.1x to 1.9x the quoted value; an elite about 1x", () => {
    const m = 0.976;
    expect(buffScale(3 * MOB_BUFF_STACKS * m)).toBeGreaterThan(1.05);
    expect(buffScale(5 * MOB_BUFF_STACKS * m)).toBeLessThan(1.95);
    expect(ELITE_BUFF_STACKS).toBe(3.1);
    expect(buffScale(ELITE_BUFF_STACKS * m)).toBeCloseTo(1, 1);
  });
});

describe("the catalog", () => {
  it("has one buff per mob type, in MOB_TYPES order, with its zone, elite flag and name", () => {
    expect(BUFFS.map((b) => b.id)).toEqual(MOB_TYPES.map((t) => t.id));
    expect(BUFF_IDS).toHaveLength(20);
    for (const t of MOB_TYPES) expect(buffDef(t.id)).toMatchObject({ zone: t.zone, elite: t.elite, name: t.name });
    for (const zone of FACTION_IDS) {
      expect(BUFFS.filter((b) => b.zone === zone)).toHaveLength(4);
      expect(BUFFS.filter((b) => b.zone === zone && b.elite)).toHaveLength(1);
    }
    expect(buffDef("nope")).toBeUndefined();
  });

  // The plan's table, value at 3 stacks (every value doubled by the owner after the R4a power report).
  const QUOTED: ReadonlyArray<[string, string]> = [
    ["emberImp", "+10% damage"],
    ["cinderHound", "+10% move speed while chasing your target"],
    ["magmaBrute", "+6% max HP and +20 magic resist"],
    ["wyrmling", "+20% damage to targets above 70% HP"],
    ["bailiff", "+16% mark ramp speed (Sentenced only)"],
    ["chainWarden", "Your hits slow movement 10% for 1 s (up to 25%)"],
    ["inquisitor", "+12% damage to a target you have kept hitting for 3 s"],
    ["executioner", "+30% damage to targets below 30% HP"],
    ["plagueRat", "+8% attack speed"],
    ["bloatfly", "Your hits deal 8 damage/s for 3 s"],
    ["rotMonk", "Your hits cut healing 12% for 3 s (up to 40%)"],
    ["ratOgre", "+16% damage to targets below 50% HP"],
    ["frostWisp", "Your hits slow attacks 6% for 2 s (up to 15%)"],
    ["iceGolem", "+8% max HP"],
    ["rimeStalker", "+20 armor"],
    ["glacialWarden", "+20% damage to slowed or chilled targets"],
    ["acolyte", "+4% lifesteal"],
    ["seraphShard", "+16 magic resist"],
    ["penitent", "+2% damage per 10% HP missing"],
    ["bloodSaint", "Below 30% HP: heal 20% of max HP (once per run)"],
  ];
  it.each(QUOTED)("%s reads %j at 3 stacks", (id, text) => {
    expect(buffDef(id)!.text).toBe(text);
    expect(buffText(id)).toBe(text);
    expect(buffText(id, 3)).toBe(text);
  });

  it("marks exactly the rows that need the status runtime (R4b): on-hit statuses, vs slowed, vs streak", () => {
    const needs = BUFFS.filter((b) => b.needs === "status").map((b) => b.id).sort();
    expect(needs).toEqual(["bloatfly", "chainWarden", "frostWisp", "glacialWarden", "inquisitor", "rotMonk"]);
    for (const b of BUFFS) {
      expect(b.effects.some((e) => e.needs === "status")).toBe(b.needs === "status");
      for (const e of b.effects) if (e.k === "onHit") expect(e.needs).toBe("status");
    }
  });

  it("tags every buff: Bailiff is Sentenced's own, the defensive ones counter the factions they resist", () => {
    for (const b of BUFFS) expect(b.worksWith.length).toBeGreaterThan(0);
    expect(buffDef("bailiff")!.worksWith).toEqual(["sentenced"]);
    // Attack speed is weapon damage: it suits the factions whose damage is mostly their weapon's; it still counters anyone.
    expect(buffDef("plagueRat")!.worksWith).toEqual(["frost", "holy", "plague"]);
    expect(buffDef("plagueRat")!.counters).toEqual(["any"]);
    expect(buffsCountering("holy").map((b) => b.id)).toEqual(expect.arrayContaining(["executioner", "rotMonk", "rimeStalker"]));
    expect(buffsCountering("fire").map((b) => b.id)).toEqual(expect.arrayContaining(["magmaBrute", "seraphShard"]));
  });
});

describe("rows at a stack count", () => {
  it("at 3 stacks are the catalog's rows (those the sim applies)", () => {
    for (const b of BUFFS) {
      expect(buffRowsOf(b.id, 3)).toEqual(b.effects.filter((e) => e.needs !== "status"));
      expect(buffRowsOf(b.id, 3, { includeNeeds: true })).toEqual(b.effects);
    }
  });

  it("scale every number by S(n) / S(3), never an on-hit cap", () => {
    const k = buffScale(5.5);
    // The quoted numbers come from the catalog, so a retune is a data edit; what is pinned here is the scaling.
    const row = <K extends Effect["k"]>(id: string, kind: K, i = 0): Extract<Effect, { k: K }> => {
      const e = buffDef(id)!.effects[i]!;
      expect(e.k).toBe(kind);
      return e as Extract<Effect, { k: K }>;
    };
    const imp = row("emberImp", "stat");
    const brute = [row("magmaBrute", "stat"), row("magmaBrute", "flat", 1)] as const;
    const penitent = row("penitent", "scale");
    const warden = row("chainWarden", "onHit");
    expect(buffRowsOf("emberImp", 5.5)).toEqual([{ k: "stat", stat: "damage", v: imp.v * k }]);
    expect(buffRowsOf("magmaBrute", 5.5)).toEqual([{ k: "stat", stat: "maxHp", v: brute[0].v * k }, { k: "flat", stat: "shield", v: brute[1].v * k }]);
    expect(buffRowsOf("penitent", 5.5)).toEqual([{ k: "scale", src: "ownMissingHp", per: penitent.per * k, step: 0.1 }]);
    expect(buffRowsOf("chainWarden", 5.5, { includeNeeds: true })).toEqual([
      { k: "onHit", status: "slowMove", per: warden.per * k, cap: warden.cap, ms: 1000, needs: "status" },
    ]);
    expect(warden.cap).toBe(0.25); // the cap never scales: the doubled per-hit slow still stops where it did
    const saint = buffRowsOf("bloodSaint", 5.5)[0] as Extract<Effect, { k: "trigger" }>;
    const saintDef = row("bloodSaint", "trigger").do;
    expect(saintDef.do).toBe("heal");
    expect(saint.do).toEqual({ do: "heal", share: (saintDef as { share: number }).share * k, ignoreLockout: true });
    expect(saint.arg).toBe(0.3);
    // scaleEffect leaves the catalog alone.
    expect(buffDef("emberImp")!.effects[0]).toEqual({ k: "stat", stat: "damage", v: imp.v });
    expect(scaleEffect({ k: "vs", test: "hpBelow", arg: 0.3, v: 0.15 }, 2)).toEqual({ k: "vs", test: "hpBelow", arg: 0.3, v: 0.3 });
  });

  it("buffRows takes a Map or a record, skips nothing-held and unknown ids, and lists rows in catalog order", () => {
    const a = buffRows(new Map([["seraphShard", 2], ["emberImp", 4], ["junk", 3], ["iceGolem", 0]]));
    const b = buffRows({ emberImp: 4, seraphShard: 2 });
    expect(a).toEqual(b);
    expect(a).toEqual([...buffRowsOf("emberImp", 4), ...buffRowsOf("seraphShard", 2)]);
    expect(buffRows({})).toEqual([]);
    expect(buffRows({ chainWarden: 3 })).toEqual([]);
    expect(buffRows({ chainWarden: 3 }, { includeNeeds: true })).toHaveLength(1);
  });

  it("buffPower is 3 x the scale summed: one buff at 3 stacks is 3, spreading is worth less", () => {
    expect(buffPower({})).toBe(0);
    expect(buffPower({ emberImp: 3 })).toBe(3);
    expect(buffPower({ emberImp: 1.5, iceGolem: 1.5 })).toBeLessThan(buffPower({ emberImp: 3 }));
  });

  it("buffText scales the numbers: Ember Imp at 6 stacks is +20% damage", () => {
    const imp = buffDef("emberImp")!.effects[0] as Extract<Effect, { k: "stat" }>;
    const rime = buffDef("rimeStalker")!.effects[0] as Extract<Effect, { k: "flat" }>;
    expect(buffText("emberImp", 6)).toBe(`+${Math.round(imp.v * buffScale(6) * 1000) / 10}% damage`);
    expect(buffText("emberImp", 6)).toBe("+20% damage"); // S(6) / S(3) is 2.0 to the percent
    expect(buffText("rimeStalker", 1)).toBe(`+${Math.round(rime.v * buffScale(1) * 10) / 10} armor`);
    expect(buffText("nope", 3)).toBe("");
  });
});

describe("the HUD's views", () => {
  it("lists the buffs held in catalog order, with the line now, the quoted line and the next kill's gain", () => {
    const views = buffViews({ iceGolem: 2.2, emberImp: 3.3 }, 0.5);
    expect(views.map((v) => v.id)).toEqual(["emberImp", "iceGolem"]);
    const imp = views[0]!;
    expect(imp).toMatchObject({ name: "Ember Imp", zone: "fire", elite: false, stacks: 3.3, stacksText: "3.3", active: true });
    expect(imp.scale).toBe(buffScale(3.3));
    expect(imp.text).toBe(buffText("emberImp", 3.3));
    expect(imp.quoted).toBe("+10% damage");
    expect(imp.nextGain).toBeCloseTo(MOB_BUFF_STACKS * 0.5, 12);
    expect(imp.nextText).toBe(buffText("emberImp", 3.3 + MOB_BUFF_STACKS * 0.5));
    expect(buffView("wyrmling", 0)!.nextGain).toBe(ELITE_BUFF_STACKS);
    expect(buffView("chainWarden", 3)!.active).toBe(false);
    expect(buffView("nope", 3)).toBeNull();
    expect(hasAnyBuffs({})).toBe(false);
    expect(hasAnyBuffs(new Map([["acolyte", 0.4]]))).toBe(true);
  });

  it("toasts as the plan writes it: \"Ember Imp +1.1 (3.2): +10.x% damage\"", () => {
    expect(buffToast("emberImp", 1.1, 3.2)).toBe(`Ember Imp +1.1 (3.2): ${buffText("emberImp", 3.2)}`);
    expect(buffToast("emberImp", 1.1, 3)).toBe("Ember Imp +1.1 (3.0): +10% damage");
    expect(buffToast("newThing", 1, 1)).toBe("newThing +1.0 (1.0)");
  });
});

describe("lifesteal's caps", () => {
  it("rows add up to LS_CAP at most, Holy's own comes on top, and the total never passes LIFESTEAL_MAX", () => {
    expect(LS_CAP).toBe(0.25);
    expect(lifestealShare(0, 0)).toBe(0);
    expect(lifestealShare(0, 0.02)).toBe(0.02);
    expect(lifestealShare(0, 0.9)).toBe(LS_CAP);
    expect(lifestealShare(0.3, 0.9)).toBe(0.3 + LS_CAP);
    expect(lifestealShare(0.95, 0.2)).toBe(LIFESTEAL_MAX);
    expect(lifestealShare(0.4, 0)).toBe(0.4); // Holy alone is unchanged
    expect(lifestealShare(0, -0.5)).toBe(0);
  });
});

describe("the quantized mirrors (shared/mods.ts)", () => {
  it("carry thousandths: decode is exactly wire / 1000, encode rounds half up", () => {
    expect(MULT_WIRE_PER_UNIT).toBe(1000);
    expect(encodeMult(1)).toBe(1000);
    expect(encodeMult(1.04)).toBe(1040);
    expect(encodeMult(1.0625)).toBe(1063); // 1062.5 rounds up
    expect(encodeMult(0.9374)).toBe(937);
    expect(decodeMult(1040)).toBe(1040 / 1000);
    expect(decodeMult(Number.NaN)).toBe(1);
    expect(decodeMult(undefined as unknown as number)).toBe(1);
  });

  it("clamps to MOD_MULT_MIN..MOD_MULT_MAX (a uint16 holds it) and reads a bad value as the identity", () => {
    expect(encodeMult(0)).toBe(MOD_MULT_MIN * 1000);
    expect(encodeMult(-3)).toBe(50);
    expect(encodeMult(1e9)).toBe(MOD_MULT_MAX * 1000);
    expect(encodeMult(MOD_MULT_MAX * 1000)).toBeLessThan(65536);
    expect(encodeMult(Number.NaN)).toBe(1000);
    expect(encodeMult(Number.POSITIVE_INFINITY)).toBe(1000);
  });

  it("is idempotent: what the sim decodes and encodes again is the same wire value, for every value on the wire", () => {
    for (let w = 50; w <= 20000; w++) expect(encodeMult(decodeMult(w))).toBe(w);
  });

  it("cap attack speed at AS_MULT_CAP (League's approach: one cap on the total), slows untouched, and the cap travels exactly", () => {
    expect(AS_MULT_CAP).toBe(1.5); // owner ruling, raised from 1.25 (testing/TUNING_ROGUE.md)
    expect(capAsMult(1.51)).toBe(AS_MULT_CAP);
    expect(capAsMult(20)).toBe(AS_MULT_CAP);
    expect(capAsMult(AS_MULT_CAP)).toBe(AS_MULT_CAP);
    for (const x of [1.49, 1.3, 1.25, 1.2, 1.08, 1, 0.8, 0.05]) expect(capAsMult(x)).toBe(x);
    expect(decodeMult(encodeMult(AS_MULT_CAP))).toBe(AS_MULT_CAP);
    expect(encodeMult(capAsMult(1.7))).toBe(1500);
  });

  it("no buff, nor every buff at once at its plateau, reaches the attack-speed cap: today it binds only on stacked sources", () => {
    for (const b of BUFFS) {
      const sums = foldStatRows(buffRowsOf(b.id, 1e6, { includeNeeds: true }), { holds: () => true, owns: () => true });
      expect(mirrorsFromSums(sums).asMult, b.id).toBeLessThan(AS_MULT_CAP);
    }
    const all = Object.fromEntries(BUFF_IDS.map((id) => [id, 1e6]));
    const sums = foldStatRows(buffRows(all), { holds: () => true, owns: () => true });
    expect(sums.attackSpeed).toBeGreaterThan(0);
    expect(1 + sums.attackSpeed).toBeLessThan(AS_MULT_CAP);
  });

  it("the wire identity is 1000, 1000, 1000, 0, 0", () => {
    expect(WIRE_IDENTITY_MIRRORS).toEqual({ asMult: 1000, windupMult: 1000, speedMult: 1000, armorBonus: 0, shieldBonus: 0 });
    expect(IDENTITY_MIRRORS).toEqual({ asMult: 1, windupMult: 1, speedMult: 1, armorBonus: 0, shieldBonus: 0 });
  });

  it("scaleWindup stretches the windup (never past the interval) and the axe's root with it", () => {
    const axe = weaponTimings("axe", 1);
    expect(scaleWindup(axe, 1)).toBe(axe);
    const slow = scaleWindup(axe, 1.2);
    expect(slow.windup).toBeCloseTo(axe.windup * 1.2, 12);
    expect(slow.root).toBeCloseTo(axe.root * 1.2, 12);
    expect(slow.interval).toBe(axe.interval);
    const sword = weaponTimings("sword", 1);
    expect(scaleWindup(sword, 50).windup).toBe(1);
    expect(scaleWindup(sword, 0.5).windup).toBeCloseTo(sword.windup / 2, 12);
    expect(scaleWindup(sword, 0.5).root).toBe(0);
    // A short axe windup keeps its root no shorter than the windup.
    const a = scaleWindup(weaponTimings("axe", 1), 3);
    expect(a.root).toBeGreaterThanOrEqual(a.windup);
  });
});
