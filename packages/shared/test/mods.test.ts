// The card engine's pure half (balance pass, BALANCE_CONTRACT 3.2, 3.3, 4.6): foldRows (the plain fold, the one-pass conversions,
// the caps G7/G10/G11, the mult products G1/G9/G13, flags, G8's max hp), mirrorsFromFold (the attack-speed cap and asPost, G7),
// the guards' helpers (G5 lifestealTotal, G6 the barrier, G12 crit), mirrorTimings (G9's ranged windups), the weapons' AD/AP
// scaling table and scalingDamage, and the text and scaling helpers of the new kinds. The sim half is server/test/mods.test.ts
// and server/test/guards.test.ts.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, abilityCooldownMs, addToSums, AP_DOT_RATIO, AS_MULT_CAP, AS_POST_MAX, AS_POST_MIN, attackInterval, barrierCap,
  BARRIER_DECAY_SHARE_PER_SECOND, BARRIER_MAX_SHARE, BONUS_DEFENSE_CAP, BOW_WINDUP, WAND_WINDUP, clampBarrier, CONVERT_AD_AP_CAP,
  CRIT_CHANCE_MAX, CRIT_MULT, critChanceFrom, decayBarrier, effectText, encodeFlat, encodeMirrors, FACTIONS, foldedMaxHp, foldRows,
  FLAT_WIRE_PER_POINT, HP_RACE_CAP, identityMults, LIFESTEAL_MAX, lifestealTotal, LS_CAP, MAX_HP_FLOOR_SHARE, mirrorsFromFold,
  mirrorTimings, MOVE_BONUS_CAP, MULT_KEYS, OUTGOING_ROW_CAP, pacedFaction, scaleEffect, scaleWindup, scalingDamage, TRAINING_WISH_COOLDOWN_SECONDS,
  weaponTimings, WEAPON_IDS, ALL_WEAPON_IDS, WEAPONS, WISH_COOLDOWN_MULT_MIN, WISH_COOLDOWN_SECONDS, zeroSums,
  type Effect, type WeaponId, type WeaponTimings,
} from "../src/index";

/** Folds with every `requires` met and every `while` row holding unless `holds` says otherwise. */
const fold = (rows: Effect[], over: Parameters<typeof foldRows>[1] = {}) => foldRows(rows, { owns: () => true, holds: () => true, ...over });
const ad = (v: number): Effect => ({ k: "flat", stat: "ad", v });
const ap = (v: number): Effect => ({ k: "flat", stat: "ap", v });

describe("the AD and AP stats", () => {
  it("are flat stats that fold to points and to the adBonus / apBonus mirrors, in tenths on the wire", () => {
    const f = fold([ad(12), ad(21), ap(12)]);
    expect(f.sums.ad).toBe(33);
    expect(f.sums.ap).toBe(12);
    const m = mirrorsFromFold(f);
    expect([m.adBonus, m.apBonus]).toEqual([33, 12]);
    expect(encodeMirrors(m)).toMatchObject({ adBonus: 330, apBonus: 120 });
    expect(FLAT_WIRE_PER_POINT).toBe(10);
  });

  it("a fighter without them has none", () => {
    const f = fold([]);
    expect([f.sums.ad, f.sums.ap]).toEqual([0, 0]);
    expect(f.plain).toEqual(zeroSums());
  });
});

describe("earned farm rows", () => {
  it("keep growing outside ordinary sheet ceilings while sources and AP multipliers still apply", () => {
    const rows: Effect[] = [
      { k: "stat", stat: "attackSpeed", v: 1 },
      { k: "stat", stat: "moveSpeed", v: 0.5 },
      { k: "flat", stat: "armor", v: 300 },
      { k: "flat", stat: "shield", v: 300 },
      { k: "flat", stat: "ad", v: 5 },
      { k: "flat", stat: "ap", v: 10 },
      { k: "stat", stat: "maxHp", v: 0.1 },
      { k: "mult", key: "ap", v: 2 },
      { k: "convert", from: "ad", to: "ap", per: 1, cap: 60 },
    ];
    const farmRows: Effect[] = [
      { k: "stat", stat: "attackSpeed", v: 2 },
      { k: "stat", stat: "moveSpeed", v: 1 },
      { k: "flat", stat: "armor", v: 1000 },
      { k: "flat", stat: "shield", v: 1200 },
      { k: "flat", stat: "ad", v: 100 },
      { k: "flat", stat: "ap", v: 100 },
      { k: "stat", stat: "maxHp", v: 0.5 },
      { k: "stat", stat: "damage", v: 20 },
    ];
    const f = fold(rows, { baseMaxHp: 1000, farmRows });
    const m = mirrorsFromFold(f, { asMult: 0.5, speedMult: 0.5, windupMult: 1, armor: 40, shield: 40 });
    expect([f.sums.armor, f.sums.shield, f.sums.moveSpeed]).toEqual([BONUS_DEFENSE_CAP, BONUS_DEFENSE_CAP, MOVE_BONUS_CAP]);
    expect(f.farmSums.damage).toBe(20);
    expect(f.maxHp).toBe(1600);
    expect(m.asMult).toBeCloseTo(2); // capped ordinary AS and uncapped farm AS both receive the source slow
    expect(m.speedMult).toBeCloseTo(1.15);
    expect(m.armorBonus).toBe(1200);
    expect(m.shieldBonus).toBe(1400);
    expect(m.adBonus).toBe(105);
    expect(m.apBonus).toBe(340); // card conversion keeps its 60-point cap; farm AP then receives the same AP mult
  });
});

describe("a product stat (lifestealMult)", () => {
  it("multiplies as 1 + v, starting from 1, whichever kind of row it comes in", () => {
    expect(zeroSums().lifestealMult).toBe(1);
    const s = zeroSums();
    addToSums(s, "lifestealMult", 1);
    addToSums(s, "lifestealMult", 0.5);
    addToSums(s, "lifesteal", 0.1);
    addToSums(s, "lifesteal", 0.1);
    expect(s.lifestealMult).toBe(3);
    expect(s.lifesteal).toBeCloseTo(0.2, 12);
    // Bloodthirst: a `while` row that doubles lifesteal below half health
    const bloodthirst: Effect = { k: "while", cond: "hpBelow", arg: 0.5, stat: "lifestealMult", v: 1 };
    expect(fold([bloodthirst]).sums.lifestealMult).toBe(2);
    expect(fold([bloodthirst], { holds: () => false }).sums.lifestealMult).toBe(1);
  });
});

describe("the conversions (convert rows)", () => {
  it("convert a stat the fighter has into another, once, after the plain fold", () => {
    // Juggernaut: 1 armor and 1 magic resist per 4 AD
    const jug: Effect[] = [
      { k: "convert", from: "ad", to: "armor", per: 0.25 }, { k: "convert", from: "ad", to: "shield", per: 0.25 }, ad(40),
    ];
    const f = fold(jug);
    expect([f.sums.armor, f.sums.shield, f.sums.ad]).toEqual([10, 10, 40]);
    expect(f.plain.armor).toBe(0); // the plain fold is kept apart
    // Spellsword: AD also counts as AP at half value
    expect(fold([{ k: "convert", from: "ad", to: "ap", per: 0.5 }, ad(33)]).sums.ap).toBe(16.5);
  });

  it("read max hp as the folded one, so the rows that raise it count in the same fold (no step stale)", () => {
    // Stone Skin: 2 armor and 2 magic resist per 100 max health; Big Brain: AP equal to 2% of max health. 1,000 hp, +20%.
    const rows: Effect[] = [
      { k: "stat", stat: "maxHp", v: 0.2 }, { k: "convert", from: "maxHp", to: "armor", per: 0.02 },
      { k: "convert", from: "maxHp", to: "ap", per: 0.02 },
    ];
    const f = foldRows(rows, { owns: () => true, baseMaxHp: 1000 });
    expect(f.maxHp).toBe(1200);
    expect(f.sums.armor).toBe(24);
    expect(f.sums.ap).toBe(24);
    // Without the base nothing is read (a fighter whose hp the fold cannot know converts nothing from it).
    expect(foldRows(rows, { owns: () => true }).sums.armor).toBe(0);
  });

  it("read attack speed and move speed as bonuses already inside their caps", () => {
    // Arcane Tempo: every 1% attack speed above base is 1 AP (per 100 on a fraction)
    const tempo: Effect = { k: "convert", from: "bonusAttackSpeed", to: "ap", per: 100 };
    expect(fold([tempo, { k: "stat", stat: "attackSpeed", v: 0.25 }]).sums.ap).toBeCloseTo(25, 9);
    expect(fold([tempo, { k: "stat", stat: "attackSpeed", v: 0.8 }]).sums.ap).toBeCloseTo((AS_MULT_CAP - 1) * 100, 9); // rows above the cap give no more
    expect(fold([tempo, { k: "stat", stat: "attackSpeed", v: -0.3 }]).sums.ap).toBe(0); // a slow converts nothing
    // Momentum: the bonus move speed (cap +30%) is added to damage
    const momentum: Effect = { k: "convert", from: "bonusMoveSpeed", to: "damage", per: 1, cap: MOVE_BONUS_CAP };
    expect(fold([momentum, { k: "stat", stat: "moveSpeed", v: 0.2 }]).sums.damage).toBeCloseTo(0.2, 12);
    expect(fold([momentum, { k: "stat", stat: "moveSpeed", v: 0.55 }]).sums.damage).toBe(MOVE_BONUS_CAP);
    expect(fold([{ ...momentum, per: 2 } as Effect, { k: "stat", stat: "moveSpeed", v: 0.2 }]).sums.damage).toBe(MOVE_BONUS_CAP); // the row's own cap
  });

  it("run in ONE pass from the plain sums: a conversion never feeds another (G11)", () => {
    // Two rows that each add half of AD to AD: both read the plain 40, not each other's result.
    const twice: Effect[] = [ad(40), { k: "convert", from: "ad", to: "ad", per: 0.5 }, { k: "convert", from: "ad", to: "ad", per: 0.5 }];
    expect(fold(twice).sums.ad).toBe(80);
    // AD made from attack speed is not read by Juggernaut, which sees the AD the rows gave: 40 -> 10 armor, not 15.
    const chain: Effect[] = [
      ad(40), { k: "stat", stat: "attackSpeed", v: 0.2 }, { k: "convert", from: "bonusAttackSpeed", to: "ad", per: 100 },
      { k: "convert", from: "ad", to: "armor", per: 0.25 },
    ];
    const f = fold(chain);
    expect(f.sums.ad).toBeCloseTo(60, 9);
    expect(f.sums.armor).toBe(10);
  });

  it("give at most CONVERT_AD_AP_CAP AD and AP each, on top of what the rows give", () => {
    expect(CONVERT_AD_AP_CAP).toBe(60);
    const f = fold([ad(400), ap(12), { k: "convert", from: "ad", to: "ap", per: 0.5 }, { k: "convert", from: "ad", to: "ad", per: 1 }]);
    expect(f.sums.ap).toBe(12 + 60);
    expect(f.sums.ad).toBe(400 + 60);
  });

  it("are skipped without their `requires`, and cannot target max hp or a product stat", () => {
    const row: Effect = { k: "convert", from: "ad", to: "armor", per: 1, requires: ["ad1"] };
    expect(foldRows([ad(10), row], { owns: () => false }).sums.armor).toBe(0);
    expect(foldRows([ad(10), row], { owns: (id) => id === "ad1" }).sums.armor).toBe(10);
    const odd = { k: "convert", from: "ad", to: "maxHp", per: 1 } as unknown as Effect; // the type forbids it; a row from outside is ignored
    expect(fold([ad(10), odd]).sums.maxHp).toBe(0);
    const prod = { k: "convert", from: "ad", to: "lifestealMult", per: 1 } as unknown as Effect;
    expect(fold([ad(10), prod]).sums.lifestealMult).toBe(1);
  });
});

describe("the sheet stats' caps (G7, G8, G10)", () => {
  it("hold bonus armor and magic resist at +200 each, conversions included", () => {
    expect(BONUS_DEFENSE_CAP).toBe(200);
    const f = fold([
      { k: "flat", stat: "armor", v: 150 }, ad(300), { k: "convert", from: "ad", to: "armor", per: 1, cap: 80 },
      { k: "flat", stat: "shield", v: 250 },
    ]);
    expect([f.sums.armor, f.sums.shield]).toEqual([200, 200]);
    // The mirrors hold them at +200 with the sources' flat bonuses added too.
    const m = mirrorsFromFold(f, { asMult: 1, speedMult: 1, windupMult: 1, armor: 30, shield: -50 });
    expect([m.armorBonus, m.shieldBonus]).toEqual([200, 150]);
    // A penalty goes through untouched.
    expect(fold([{ k: "flat", stat: "armor", v: -40 }]).sums.armor).toBe(-40);
  });

  it("hold the rows' move speed bonus at +30%, and leave a slow alone", () => {
    expect(MOVE_BONUS_CAP).toBe(0.3);
    expect(fold([{ k: "stat", stat: "moveSpeed", v: 0.45 }]).sums.moveSpeed).toBe(0.3);
    expect(fold([{ k: "stat", stat: "moveSpeed", v: -0.2 }]).sums.moveSpeed).toBeCloseTo(-0.2, 12);
    expect(mirrorsFromFold(fold([{ k: "stat", stat: "moveSpeed", v: 0.45 }]), { asMult: 1, speedMult: 0.5, windupMult: 1, armor: 0, shield: 0 }).speedMult).toBeCloseTo(0.65, 12);
  });

  it("keep max hp at half of the faction's at the least", () => {
    expect(MAX_HP_FLOOR_SHARE).toBe(0.5);
    expect(foldedMaxHp(1000, -0.25)).toBe(750);
    expect(foldedMaxHp(1000, -0.9)).toBe(500);
    expect(foldedMaxHp(0, 0.5)).toBe(0);
    expect(foldRows([{ k: "stat", stat: "maxHp", v: -0.8 }], { baseMaxHp: 835 }).maxHp).toBe(417.5);
  });
});

describe("the mult rows", () => {
  it("multiply per key, and a key with no row is exactly 1", () => {
    expect(identityMults()).toEqual({ asPost: 1, hit: 1, dot: 1, returned: 1, ap: 1, wishCooldown: 1, hpRace: 1, linger: 1 });
    expect(Object.keys(identityMults())).toEqual([...MULT_KEYS]);
    // Here Comes the Boom
    const boom: Effect[] = [
      { k: "mult", key: "asPost", v: 0.5 }, { k: "mult", key: "hit", v: 2.5 }, { k: "mult", key: "dot", v: 1.25 }, { k: "mult", key: "returned", v: 1.25 },
    ];
    expect(fold(boom).mults).toEqual({ ...identityMults(), asPost: 0.5, hit: 2.5, dot: 1.25, returned: 1.25 });
    // Boom and Machine Gun together: the asPost halves and doubles; the hit 2.5 x 0.4 is exactly 1
    const both = fold([...boom, { k: "mult", key: "asPost", v: 2 }, { k: "mult", key: "hit", v: 0.4 }]).mults;
    expect([both.asPost, both.hit]).toEqual([1, 1]);
  });

  it("are held to their guards: asPost to 0.5..2, hit to the row cap, a Wish cooldown above half, a Race to 0 to HP_RACE_CAP", () => {
    const f = fold([
      { k: "mult", key: "asPost", v: 0.1 }, { k: "mult", key: "hit", v: 4 }, { k: "mult", key: "wishCooldown", v: 0.2 }, { k: "mult", key: "hpRace", v: 9 },
    ]).mults;
    expect(f).toMatchObject({ asPost: AS_POST_MIN, hit: OUTGOING_ROW_CAP, wishCooldown: WISH_COOLDOWN_MULT_MIN, hpRace: HP_RACE_CAP });
    expect(fold([{ k: "mult", key: "asPost", v: 9 }]).mults.asPost).toBe(AS_POST_MAX);
    expect([AS_POST_MIN, AS_POST_MAX, WISH_COOLDOWN_MULT_MIN, OUTGOING_ROW_CAP, HP_RACE_CAP]).toEqual([0.5, 2, 0.5, 2.5, 2.5]);
  });

  it("scale AP after the conversions and their cap (Arcane Overload)", () => {
    const f = fold([ap(12), ad(400), { k: "convert", from: "ad", to: "ap", per: 1 }, { k: "mult", key: "ap", v: 1.5 }]);
    expect(f.sums.ap).toBe((12 + CONVERT_AD_AP_CAP) * 1.5);
    expect(f.plain.ap).toBe(12); // the plain fold is unscaled
  });

  it("are skipped without their `requires`", () => {
    expect(foldRows([{ k: "mult", key: "hit", v: 2, requires: ["x"] }], { owns: () => false }).mults.hit).toBe(1);
  });
});

describe("the flags", () => {
  it("are on while their row is", () => {
    const f = fold([{ k: "flag", flag: "lockSecondSlot" }, { k: "flag", flag: "noCrit", requires: ["thick"] }], { owns: (id) => id !== "thick" });
    expect([...f.flags]).toEqual(["lockSecondSlot"]);
    expect(fold([{ k: "flag", flag: "noCrit" }]).flags.has("noCrit")).toBe(true);
    expect(fold([]).flags.size).toBe(0);
  });
});

describe("the attack-speed mirror (G9)", () => {
  const SRC = { asMult: 1, speedMult: 1, windupMult: 1, armor: 0, shield: 0 };
  const speed = (v: number): Effect => ({ k: "stat", stat: "attackSpeed", v });
  const post = (v: number): Effect => ({ k: "mult", key: "asPost", v });

  it("caps the rows at AS_MULT_CAP and multiplies asPost AFTER the cap: Boom 0.5 to 0.75, Machine Gun up to 3.0", () => {
    expect(mirrorsFromFold(fold([speed(0.8)])).asMult).toBe(AS_MULT_CAP);
    expect(mirrorsFromFold(fold([speed(0.8), post(0.5)])).asMult).toBe(AS_MULT_CAP * 0.5);
    expect(mirrorsFromFold(fold([speed(0.8), post(2)])).asMult).toBe(AS_MULT_CAP * 2);
    expect(mirrorsFromFold(fold([speed(0.2), post(2)])).asMult).toBeCloseTo(2.4, 12);
    expect(mirrorsFromFold(fold([post(0.5)])).asMult).toBe(0.5);
    // Both extremes at once land in the contract's 0.5..3.0 effective range
    for (const rows of [[speed(2), post(2)], [post(0.5)], [post(0.001)], [post(99), speed(5)]]) {
      const a = mirrorsFromFold(fold(rows)).asMult;
      expect(a).toBeGreaterThanOrEqual(0.5 - 1e-12);
      expect(a).toBeLessThanOrEqual(AS_MULT_CAP * AS_POST_MAX + 1e-12);
    }
  });

  it("keeps the sources' slows below the cap as before: the cap is on rows times sources, asPost after", () => {
    expect(mirrorsFromFold(fold([speed(1)]), { ...SRC, asMult: 0.5 }).asMult).toBe(1); // 2.0 x 0.5, under the cap
    expect(mirrorsFromFold(fold([speed(0.5)]), { ...SRC, asMult: 1.5 }).asMult).toBe(AS_MULT_CAP);
    expect(mirrorsFromFold(fold([speed(0.5), post(0.5)]), { ...SRC, asMult: 0.8 }).asMult).toBeCloseTo(0.6, 12);
  });

  it("is the plain 1 + sum without any extra row, bit for bit as before the engine", () => {
    for (const v of [0, 0.037, 0.08 * 1.234567, 0.4999]) {
      expect(mirrorsFromFold(fold([speed(v)])).asMult).toBe(1 + v);
    }
  });
});

describe("mirrorTimings: ranged windups follow attack speed (updated G9 timing rule)", () => {
  const rangedOf = (w: WeaponId) => (id: keyof typeof FACTIONS): WeaponTimings => weaponTimings(w, attackInterval(pacedFaction(FACTIONS[id]), w, 1));

  it("shortens windup with faster attack speed and lengthens it with slower attack speed", () => {
    for (const id of Object.keys(FACTIONS) as Array<keyof typeof FACTIONS>) {
      const f = pacedFaction(FACTIONS[id]);
      for (const w of ["bow", "wand"] as const) {
        const base = rangedOf(w)(id).windup;
        for (const as of [1, 1.2, 1.5, 2, 3]) {
          const t = mirrorTimings(f, w, as, 1);
          expect(t.windup, `${id} ${w} x${as}`).toBe(weaponTimings(w, t.interval).windup);
          if (as > 1) expect(t.windup, `${id} ${w} x${as}`).toBeLessThanOrEqual(base + 1e-12);
          expect(t.interval, `${id} ${w} x${as}`).toBe(attackInterval(f, w, as));
        }
        // Slower than base: the windup grows with the interval up to its cap, never past it
        for (const as of [0.5, 0.75]) {
          const t = mirrorTimings(f, w, as, 1);
          expect(t.windup, `${id} ${w} x${as}`).toBe(weaponTimings(w, t.interval).windup);
          expect(t.windup, `${id} ${w} x${as}`).toBeGreaterThanOrEqual(base - 1e-12);
          expect(t.windup, `${id} ${w} x${as}`).toBeLessThanOrEqual(w === "bow" ? BOW_WINDUP : WAND_WINDUP + 1e-12);
        }
      }
    }
  });

  it("is the old formula wherever the windup was already at or above its base (no attack-speed change, melee weapons)", () => {
    const f = pacedFaction(FACTIONS.fire);
    expect(mirrorTimings(f, "bow", 1, 1)).toEqual(weaponTimings("bow", attackInterval(f, "bow", 1)));
    for (const w of ["sword", "axe", "shield", "fists"] as const) {
      for (const as of [0.5, 1, 1.5, 3]) {
        expect(mirrorTimings(f, w, as, 0.5), `${w} x${as}`).toEqual(scaleWindup(weaponTimings(w, attackInterval(f, w, as)), 0.5));
      }
    }
  });

  it("attack speed shortens the bow windup with its interval", () => {
    const f = pacedFaction(FACTIONS.plague);
    const base = weaponTimings("bow", attackInterval(f, "bow", 1)).windup;
    const old = weaponTimings("bow", attackInterval(f, "bow", 1.5)).windup;
    expect(old).toBeLessThan(base);
    expect(mirrorTimings(f, "bow", 1.5, 1).windup).toBe(old);
  });

  it("scaleWindup never cuts a ranged windup, even one raised above its interval, whatever the mult", () => {
    const t: WeaponTimings = { interval: 0.4, windup: 0.6, root: 0, ranged: true };
    for (const mult of [0.2, 0.9, 1, 1.2, 3]) expect(scaleWindup(t, mult).windup, `x${mult}`).toBeGreaterThanOrEqual(0.6);
    const melee: WeaponTimings = { interval: 0.4, windup: 0.25, root: 0, ranged: false };
    expect(scaleWindup(melee, 0.5).windup).toBe(0.125); // a melee windup still shortens
    expect(scaleWindup(melee, 4).windup).toBe(0.4); // and is held to its interval
  });
});

describe("the weapons' AD and AP scaling (BALANCE_CONTRACT 3.3)", () => {
  it("is the contract's table, for the five weapons and fists", () => {
    expect(WEAPONS.sword.scaling).toEqual({ ad: 1.0 });
    // The acceptance pass moved the axe (1.2), the bow (0.9) and the wand's AP (1.2) to 1.0 so that a card is worth the same per
    // point of dpsMult on every weapon and the weapon loop holds at minute 5 as it does at minute 0 (weapons.ts WeaponScaling).
    expect(WEAPONS.axe.scaling).toEqual({ ad: 1.0, hp: 0.02 });
    expect(WEAPONS.bow.scaling).toEqual({ ad: 1.0 });
    expect(WEAPONS.wand.scaling).toEqual({ ad: 0.3, ap: 1.0 });
    expect(WEAPONS.shield.scaling).toEqual({ ap: 0.3, def: 0.4 });
    expect(WEAPONS.fists.scaling).toEqual({ ad: 0.6, ap: 0.6 });
    expect(ALL_WEAPON_IDS).toHaveLength(6);
  });

  const ZERO = { ad: 0, ap: 0, bonusMaxHp: 0, bonusDefense: 0 };

  it("adds nothing without stats, and per point of each stat times asMult x interval", () => {
    for (const w of ALL_WEAPON_IDS) expect(scalingDamage(w, ZERO, 1.3, 0.7), w).toEqual({ phys: 0, magic: 0 });
    const I = 0.6;
    // sword: AD 1.0 (physical)
    expect(scalingDamage("sword", { ...ZERO, ad: 40 }, 1, I)).toEqual({ phys: 40 * I, magic: 0 });
    // bow: AD 1.0
    expect(scalingDamage("bow", { ...ZERO, ad: 40 }, 1, I).phys).toBeCloseTo(1.0 * 40 * I, 12);
    // wand: AD 0.3 physical and AP 1.0 magic
    const wand = scalingDamage("wand", { ...ZERO, ad: 10, ap: 50 }, 1, I);
    expect(wand.phys).toBeCloseTo(0.3 * 10 * I, 12);
    expect(wand.magic).toBeCloseTo(1.0 * 50 * I, 12);
    // axe: AD 1.0 and 2% of the bonus max hp, both physical
    expect(scalingDamage("axe", { ...ZERO, ad: 20, bonusMaxHp: 300 }, 1, I).phys).toBeCloseTo((1.0 * 20 + 0.02 * 300) * I, 12);
    // shield: AP 0.3 magic, and 0.4 of the bonus armor plus magic resist, physical
    const shield = scalingDamage("shield", { ...ZERO, ap: 20, bonusDefense: 60 }, 1, I);
    expect(shield.magic).toBeCloseTo(0.3 * 20 * I, 12);
    expect(shield.phys).toBeCloseTo(0.4 * 60 * I, 12);
    // fists: the hybrid
    const fists = scalingDamage("fists", { ...ZERO, ad: 10, ap: 10 }, 1, I);
    expect([fists.phys, fists.magic]).toEqual([0.6 * 10 * I, 0.6 * 10 * I]);
  });

  it("attack speed multiplies the dps, and a floor turns the surplus into bigger hits", () => {
    const f = pacedFaction(FACTIONS.holy);
    const stats = { ...ZERO, ad: 30 };
    const dps = (as: number): number => {
      const interval = attackInterval(f, "sword", as);
      return (scalingDamage("sword", stats, as, interval).phys) / interval;
    };
    // Below the floor the dps is the scaling x AD x asMult, whatever the faction's rate
    expect(dps(1)).toBeCloseTo(30, 9);
    expect(dps(1.1)).toBeCloseTo(33, 9);
    for (const id of Object.keys(FACTIONS) as Array<keyof typeof FACTIONS>) {
      const g = pacedFaction(FACTIONS[id]);
      const i = attackInterval(g, "sword", 1);
      if (i > WEAPONS.sword.floor * 1.5) expect(scalingDamage("sword", stats, 1, i).phys / i, id).toBeCloseTo(30, 9);
    }
    // Past the floor a hit gets bigger (as x floor), the interval does not shrink
    const slow = pacedFaction(FACTIONS.frost);
    const floorAs = 1 / (slow.rate * (1 + WEAPONS.sword.boost) * WEAPONS.sword.floor) * 2;
    const interval = attackInterval(slow, "sword", floorAs);
    expect(interval).toBe(WEAPONS.sword.floor);
    expect(scalingDamage("sword", stats, floorAs, interval).phys).toBeCloseTo(30 * floorAs * WEAPONS.sword.floor, 9);
  });
});

describe("the guards' helpers", () => {
  it("G5: lifesteal rows stop at LS_CAP before the multiplier, the whole share at LIFESTEAL_MAX", () => {
    expect([LS_CAP, LIFESTEAL_MAX]).toEqual([0.25, 0.85]);
    expect(lifestealTotal(0, 0.1)).toBeCloseTo(0.1, 12);
    expect(lifestealTotal(0, 0.9)).toBe(0.25);
    expect(lifestealTotal(0, 0.9, 2)).toBe(0.5); // Bloodthirst doubles the capped rows
    expect(lifestealTotal(0, 0.1, 2)).toBeCloseTo(0.2, 12);
    expect(lifestealTotal(0.75, 0.9, 2)).toBe(LIFESTEAL_MAX); // Holy's own 0.75 plus 0.5 is held to 0.85
    expect(lifestealTotal(0.75, 0.25)).toBe(LIFESTEAL_MAX); // 1.0 -> 0.85
    expect(lifestealTotal(0.5, 0)).toBe(0.5); // Holy's own is not multiplied
    expect(lifestealTotal(0.5, 0, 2)).toBe(0.5);
    expect(lifestealTotal(0, -3)).toBe(0);
    expect(lifestealTotal(0, 0.1, 1, 0.2)).toBeCloseTo(0.3, 12); // Siphon: a damage-over-time tick heals more
    expect(lifestealTotal(0, 0, 1, 5)).toBe(LIFESTEAL_MAX);
    expect(lifestealTotal(0.75, 0.9, 2, 0.2, 0.1)).toBeCloseTo(LIFESTEAL_MAX + 0.2, 12);
  });

  it("G6: a barrier holds at most 25% of max hp and loses 5% of it a second", () => {
    expect([BARRIER_MAX_SHARE, BARRIER_DECAY_SHARE_PER_SECOND]).toEqual([0.25, 0.05]);
    expect(barrierCap(1400)).toBe(350);
    expect(clampBarrier(900, 1400)).toBe(350);
    expect(clampBarrier(100, 1400)).toBe(100);
    expect(clampBarrier(-5, 1400)).toBe(0);
    expect(decayBarrier(350, 1000, 1)).toBe(300);
    expect(decayBarrier(350, 1000, 2)).toBe(250);
    expect(decayBarrier(350, 1000, 0.05)).toBeCloseTo(347.5, 9);
    expect(decayBarrier(30, 1000, 1)).toBe(0);
    expect(decayBarrier(30, 1000, -4)).toBe(30);
  });

  it("G12: crit chance stops at 50%, is nothing under noCrit, and a crit is x1.5", () => {
    expect([CRIT_CHANCE_MAX, CRIT_MULT]).toEqual([0.5, 1.5]);
    expect(critChanceFrom(0.2, false)).toBe(0.2);
    expect(critChanceFrom(0.9, false)).toBe(0.5);
    expect(critChanceFrom(0.9, true)).toBe(0);
    expect(critChanceFrom(-0.1, false)).toBe(0);
  });

  it("3.3: AP on damage over time is 0.6 of the AP", () => {
    expect(AP_DOT_RATIO).toBe(0.6);
  });
});

describe("a Wish's cooldown (G13)", () => {
  const freeze = ABILITIES.freeze;
  it("is flat, except for the card-level wishCooldown mult, which only a Wish takes", () => {
    const base = WISH_COOLDOWN_SECONDS * 1000;
    expect(abilityCooldownMs(freeze, 1, {})).toBe(base);
    expect(abilityCooldownMs(freeze, 1, { reduction: 0.5 })).toBe(base); // flat: no reduction
    expect(abilityCooldownMs(freeze, 1, { wishCooldownMult: 2 })).toBe(2 * base); // Arcane Overload
    expect(abilityCooldownMs(freeze, 1, { wishCooldownMult: 1 })).toBe(base);
    expect(abilityCooldownMs(freeze, 1, { wishCooldownMult: 0.1 })).toBe(base * WISH_COOLDOWN_MULT_MIN); // never under half
    expect(abilityCooldownMs(freeze, 1, { wishCooldownMult: 0 })).toBe(base); // nonsense is no multiplier
    expect(abilityCooldownMs(freeze, 1, { training: true, wishCooldownMult: 2 })).toBe(TRAINING_WISH_COOLDOWN_SECONDS * 1000);
  });
});

describe("text and scaling for the new kinds", () => {
  it("effectText words every new row", () => {
    expect(effectText({ k: "flat", stat: "ad", v: 12 })).toBe("+12 attack damage");
    expect(effectText({ k: "flat", stat: "ap", v: 21 })).toBe("+21 ability power");
    expect(effectText({ k: "stat", stat: "slowResist", v: 0.4 })).toBe("+40% slow resistance");
    expect(effectText({ k: "stat", stat: "critChance", v: 0.2 })).toBe("+20% critical strike chance");
    expect(effectText({ k: "stat", stat: "lifestealMult", v: 1 })).toBe("x2 lifesteal from your lifesteal effects");
    expect(effectText({ k: "stat", stat: "lifestealDot", v: 0.2 })).toBe("+20% lifesteal on damage over time");
    expect(effectText({ k: "vs", test: "elite", arg: 0, v: 0.25 })).toBe("+25% damage to elite monsters");
    expect(effectText({ k: "vs", test: "higherPower", arg: 0, v: 0.1 })).toBe("+10% damage to players with more card power than you");
    expect(effectText({ k: "scale", src: "campsCleared", per: 0.03, step: 1, cap: 0.24 })).toBe("+3% damage for every camp you helped clear (up to +24%)");
    expect(effectText({ k: "while", cond: "unarmed", arg: 0, stat: "attackSpeed", v: 0.4 })).toBe("+40% attack speed while unarmed");
    expect(effectText({ k: "while", cond: "fightTime", arg: 3, stat: "damage", v: 0.65 })).toBe("+65% damage once a fight has lasted 3 s");
    expect(effectText({ k: "convert", from: "ad", to: "armor", per: 0.25 })).toBe("+1 armor per 4 attack damage");
    expect(effectText({ k: "convert", from: "maxHp", to: "ap", per: 0.02 })).toBe("+2 ability power per 100 max HP");
    expect(effectText({ k: "convert", from: "bonusAttackSpeed", to: "ap", per: 100 })).toBe("+1 ability power per 1% bonus attack speed");
    expect(effectText({ k: "convert", from: "bonusMoveSpeed", to: "damage", per: 1, cap: 0.3 })).toBe("+1% damage per 1% bonus move speed (up to 30%)");
    expect(effectText({ k: "mult", key: "asPost", v: 0.5 })).toBe("attack speed x0.5");
    expect(effectText({ k: "mult", key: "hit", v: 2.5 })).toBe("damage per hit x2.5");
    expect(effectText({ k: "mult", key: "wishCooldown", v: 2 })).toBe("Wish cooldown x2");
    expect(effectText({ k: "flag", flag: "lockSecondSlot" })).toBe("Your second weapon slot is locked");
    expect(effectText({ k: "flag", flag: "noCrit" })).toBe("Your hits can never critically strike");
  });

  it("scaleEffect scales a conversion's rate and cap, a mult's distance from 1, and leaves a flag alone", () => {
    expect(scaleEffect({ k: "convert", from: "ad", to: "armor", per: 0.25, cap: 20 }, 2)).toEqual({ k: "convert", from: "ad", to: "armor", per: 0.5, cap: 40 });
    expect(scaleEffect({ k: "convert", from: "ad", to: "armor", per: 0.25 }, 2)).toEqual({ k: "convert", from: "ad", to: "armor", per: 0.5 });
    expect(scaleEffect({ k: "mult", key: "hit", v: 2.5 }, 2)).toEqual({ k: "mult", key: "hit", v: 4 });
    expect(scaleEffect({ k: "mult", key: "hit", v: 2.5 }, 1)).toEqual({ k: "mult", key: "hit", v: 2.5 });
    expect(scaleEffect({ k: "flag", flag: "noCrit" }, 3)).toEqual({ k: "flag", flag: "noCrit" });
    expect(scaleEffect({ k: "scale", src: "campsCleared", per: 0.03, step: 1, cap: 0.24 }, 0.5)).toEqual({ k: "scale", src: "campsCleared", per: 0.015, step: 1, cap: 0.12 });
    expect(scaleEffect({ k: "flat", stat: "ad", v: 12 }, 0.5)).toEqual({ k: "flat", stat: "ad", v: 6 });
  });
});

describe("the wire form of the AD and AP mirrors", () => {
  it("is float64 tenths like the armor mirrors: whole tenths, half up, uncapped", () => {
    expect(encodeFlat(33)).toBe(330);
    expect(encodeFlat(0.04)).toBe(0);
    expect(encodeFlat(12.34)).toBe(123);
    // An AP of 108 (a hundred-odd points) is represented at the same tenths precision.
    expect(encodeFlat(108)).toBe(1080);
    expect(encodeFlat(1e9)).toBe(1e10);
    expect(WEAPON_IDS).toHaveLength(5);
  });
});
