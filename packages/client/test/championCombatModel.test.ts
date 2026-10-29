import { describe, expect, it } from "vitest";
import {
  ABILITIES, AP_DOT_RATIO, BLAZE_BURN_DPS, BLAZE_BURN_MS, CHILL_MOVE_MULT, EXECUTE_BAND, FACTIONS,
  FIRE_ROAM_BURST_AP_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_MAX_SPEED_MULT, FIRE_ROAM_RAMP_MS,
  LAST_STAND_HEAL_SHARE, LAST_STAND_MS, LAST_STAND_SPEED_BONUS, MARK_AS_EXPONENT, MARK_BONUS_STAT_PER_POINT, MARK_BONUS_AP_WEIGHT, MARK_FARM_AS_EFFICIENCY,
  TRIAL_EXIT_STUN_MS, TRIAL_MOVE_MULT, TRIAL_MS, TRIAL_TAKEN_MULT, WIRE_IDENTITY_MIRRORS,
  attackInterval, bonusMultiplier, damagePerHit, damageShares, encodeFlat, encodeMult,
  decodeMirrors, fireRoamBurstDamage, fireRoamSpeedMult, foldRows, lifestealFraction, markPct, markWeight, ownedCards, pacedFaction, scalingDamage, WEAPONS,
} from "@raid/shared";
import { championCombatModel, type ChampionCombatInput } from "../src/ui/championCombatModel";

const factions = ["fire", "sentenced", "plague", "frost", "holy"] as const;
const weapons = ["sword", "bow", "wand", "shield", "axe", "fists"] as const;
const round = (n: number): number => Math.round(n * 1e8) / 1e8;
const player = (over: Partial<ChampionCombatInput> = {}): ChampionCombatInput => ({
  faction: "fire", weapon0: "fists", weapon1: "", slot: 0,
  ...WIRE_IDENTITY_MIRRORS,
  maxHp: FACTIONS.fire.hp, hp: FACTIONS.fire.hp, sentence: 0, build: {}, ...over,
});

describe("championCombatModel", () => {
  it("updates passive readouts from permanent champion progress and elite combat", () => {
    const plague = player({ faction: "plague", weapon0: "bow", apBonus: encodeFlat(10) });
    const baseDisease = Number.parseFloat(championCombatModel(plague).rows[1].value);
    const harvested = championCombatModel({ ...plague, corpseStacks: 5 }).rows[1];
    expect(Number.parseFloat(harvested.value)).toBeCloseTo(baseDisease * 1.1, 1);
    expect(harvested.scaling).toContain("5 corpses");
    expect(harvested.scaling).toContain("+15% HP");

    const holy = player({ faction: "holy", hp: FACTIONS.holy.hp, maxHp: FACTIONS.holy.hp });
    const baseLeech = Number.parseFloat(championCombatModel(holy).rows[1].value);
    expect(Number.parseFloat(championCombatModel({ ...holy, campClears: 8 }).rows[1].value)).toBeCloseTo(baseLeech + 2, 8);
    expect(championCombatModel({ ...holy, campClears: 8 }).rows[1].scaling).toContain("8 camps");

    expect(championCombatModel(player({ faction: "frost", frostEliteGuard: true })).rows[1].scaling).toContain("ACTIVE");
    expect(championCombatModel(player({ faction: "frost" })).rows[1].scaling).toContain("elite fights");

    const sentenced = player({ faction: "sentenced", weapon0: "bow" });
    const baseMark = Number.parseFloat(championCombatModel(sentenced).rows[1].value);
    const hunted = championCombatModel({ ...sentenced, huntStacks: 5 }).rows[1];
    expect(Number.parseFloat(hunted.value)).toBeCloseTo(baseMark * 1.1, 1);
    expect(hunted.tooltip).toContain("Completed hunts add 10%");
  });
  it("matches shared current per-hit formula and damage types for every faction and weapon", () => {
    for (const factionId of factions) for (const weaponId of weapons) for (const as of [1, 1.14, 2.5]) {
      const faction = pacedFaction(FACTIONS[factionId]);
      const input = player({
        faction: factionId, weapon0: weaponId, asMult: encodeMult(as),
        adBonus: encodeFlat(24), apBonus: encodeFlat(18), armorBonus: encodeFlat(15), shieldBonus: encodeFlat(10),
        maxHp: FACTIONS[factionId].hp + 120,
      });
      const model = championCombatModel(input);
      const auto = model.rows[0]!;
      const actualAs = as;
      const interval = attackInterval(faction, weaponId, actualAs);
      const base = damagePerHit(faction, weaponId, actualAs);
      const extra = scalingDamage(weaponId, {
        ad: 24, ap: 18, bonusMaxHp: 120, bonusDefense: 25,
      }, actualAs, interval);
      const shares = damageShares(faction);
      expect(auto.id).toBe("auto");
      expect(auto.attacksPerSecond).toBeCloseTo(1 / interval, 8);
      expect(auto.damage!.physical).toBeCloseTo(base * shares.phys + extra.phys, 8);
      expect(auto.damage!.magic).toBeCloseTo(base * shares.magic + extra.magic, 8);
      expect(auto.damage!.true).toBeCloseTo(base * shares.true, 8);
      expect(auto.scaling).toBe(Object.entries(WEAPONS[weaponId].scaling).map(([key, value]) => {
        const label = key === "def" ? "bonus defense" : key === "hp" ? "bonus HP" : key === "ad" ? "Offense" : key === "ap" ? "SO" : key.toUpperCase();
        return `${value}× ${label}`;
      }).join(" + "));
      expect(model.rows).toHaveLength(3);
      expect(model.signature).toContain("auto|");
    }
  });

  it("uses the damage multiplier cards but does not pretend conditional or PvP damage is raw packet damage", () => {
    // Here Comes the Boom's asPost mirror is authoritative too; 0.5 is the folded wire value for this loadout.
    const input = player({ faction: "fire", weapon0: "sword", build: { hereComesTheBoom: 1 }, adBonus: encodeFlat(10), asMult: encodeMult(0.5) });
    const model = championCombatModel(input);
    const auto = model.rows[0]!;
    const base = damagePerHit(pacedFaction(FACTIONS.fire), "sword", 0.5);
    const extra = scalingDamage("sword", { ad: 10, ap: 0, bonusMaxHp: 0, bonusDefense: 0 }, 0.5, attackInterval(pacedFaction(FACTIONS.fire), "sword", 0.5));
    expect(auto.damage?.physical).toBeCloseTo(extra.phys * 2.5, 8);
    expect(auto.damage?.magic).toBeCloseTo(base * 2.5, 8);
    expect(auto.tooltip).toContain("2.5× hit multiplier");
    expect(auto.tooltip).toContain("excludes target defenses, outgoing damage bonuses, conditional effects, critical hits, Plant Your Feet, and player-versus-player scaling");
    expect(ownedCards(input.build).length).toBe(1);
    expect(foldRows(ownedCards(input.build).flatMap(({ def, count }) => Array.from({ length: count }, () => def.effects).flat())).mults.hit).toBe(2.5);
  });

  it("keeps Fire auto magic and its fixed true-damage trail Wish distinct from Offense/SO scaling", () => {
    const input = player({ faction: "fire", weapon0: "sword", apBonus: encodeFlat(10) });
    const [auto, passive, wish] = championCombatModel(input).rows;
    expect(auto.damage?.magic).toBeGreaterThan(auto.damage?.physical ?? 0);
    expect(passive.name).toBe("Dragonslayer");
    expect(passive.value).toContain(`${round(FACTIONS.fire.params.burn! * 2 * bonusMultiplier("sword") + AP_DOT_RATIO * 10)} magic/s`);
    expect(wish.icon).toBe(ABILITIES.blaze.icon);
    expect(wish.value).toContain(`${BLAZE_BURN_DPS} true DPS`);
    expect(wish.value).toContain(`${BLAZE_BURN_MS / 1000}s trail`);
    expect(wish.tooltip).toContain("does not scale with Offense, SO, weapon, or card damage multipliers");
  });

  it("tracks Fire Roam charge and armed magic burst with its current SO", () => {
    const ap = 32;
    const charge = 600;
    const active = championCombatModel(player({ faction: "fire", apBonus: encodeFlat(ap), roamCharge: charge })).rows[0]!;
    expect(active.tooltip).toContain(`${charge}/1000 charged`);
    expect(active.tooltip).toContain(`${round((fireRoamSpeedMult(charge) - 1) * 100)}% move speed`);
    expect(active.tooltip).toContain(`${round(fireRoamBurstDamage(ap))} magic (${FIRE_ROAM_BURST_BASE} + ${FIRE_ROAM_BURST_AP_SHARE}× SO)`);
    expect(active.tooltip).toContain(`${FIRE_ROAM_RAMP_MS / 1000} s out of combat`);
    expect(active.tooltip).toContain("Incoming damage resets partial charge but does not cancel an already armed burst");
    const ready = championCombatModel(player({ faction: "fire", roamCharge: 1000, roamReady: true })).rows[0]!;
    expect(ready.tooltip).toContain("Fire Roam is armed");
    expect(ready.tooltip).toContain(`${FIRE_ROAM_MAX_SPEED_MULT * 100 - 100}% move speed`);
  });

  it("applies unconditional DoT scaling and describes Plague's fixed execute formula", () => {
    const input = player({ faction: "plague", weapon0: "bow", apBonus: encodeFlat(20), build: { hereComesTheBoom: 1 } });
    const plain = championCombatModel(input).rows[1]!;
    const faction = pacedFaction(FACTIONS.plague);
    const expectedBase = (faction.params.plague! * bonusMultiplier("bow") + AP_DOT_RATIO * 20) * 1.25;
    expect(plain.value).toContain(`${round(expectedBase)} magic/s`);
    expect(plain.value).not.toContain("execute");
    expect(plain.tooltip).toContain("Below 50% target HP, execute adds");
    expect(plain.tooltip).toContain("1.25× DoT multiplier");
  });

  it("reports Sentenced weapon-weighted pulse and scales the mark with kill stacks", () => {
    const zero = championCombatModel(player({ faction: "sentenced", weapon0: "wand", sentence: 0 })).rows[1]!;
    const stacks = championCombatModel(player({ faction: "sentenced", weapon0: "wand", sentence: 3 })).rows[1]!;
    expect(stacks.value).not.toBe(zero.value);
    expect(stacks.scaling).toContain(`+${round(pacedFaction(FACTIONS.sentenced).params.mark_kill! * 100)}%/kill stack`);
    expect(stacks.tooltip).toContain("Wand's actual hit weight");
    expect(championCombatModel(player({ faction: "sentenced", weapon0: "axe" })).rows[1]!.value).toContain("target HP / hit");
  });

  it("matches Sentenced's real mark pulse from decoded Offense, SO, armor, SD, AS, and equipped weapon", () => {
    const input = player({
      faction: "sentenced", weapon0: "wand", sentence: 4, asMult: encodeMult(1.7),
      adBonus: encodeFlat(31), apBonus: encodeFlat(22), armorBonus: encodeFlat(45), shieldBonus: encodeFlat(18),
    });
    const decoded = decodeMirrors({ ...WIRE_IDENTITY_MIRRORS, ...input });
    const faction = pacedFaction(FACTIONS.sentenced);
    const expected = markPct(faction, 4, 1, {
      ad: decoded.adBonus, ap: decoded.apBonus, armor: decoded.armorBonus, magicResist: decoded.shieldBonus,
    }) * markWeight(faction, "wand", decoded.asMult, MARK_AS_EXPONENT);
    const row = championCombatModel(input).rows[1]!;
    expect(row.value).toBe(`${Math.round(expected * 10000) / 100}% target HP / hit`);
    expect(row.tooltip).toContain("bonus-stat points");
    const rawPoints = decoded.adBonus + decoded.apBonus + decoded.armorBonus + decoded.shieldBonus;
    const weightedPoints = decoded.adBonus + MARK_BONUS_AP_WEIGHT * decoded.apBonus + decoded.armorBonus + decoded.shieldBonus;
    expect(row.tooltip).toContain(`${round(rawPoints)} raw bonus-stat points (${round(weightedPoints)} weighted for the mark)`);
    expect(row.tooltip).toContain(`SO has ${MARK_BONUS_AP_WEIGHT}× weight and adds ${MARK_BONUS_STAT_PER_POINT * MARK_BONUS_AP_WEIGHT * 100}% per point`);
    expect(row.tooltip).toContain(`Attack-speed bonuses from cards and farming are ${MARK_FARM_AS_EFFICIENCY * 100}% effective`);
    expect(row.scaling).toContain(`${round(weightedPoints)} weighted bonus stats`);
    expect(row.value).not.toBe(championCombatModel(player({ faction: "sentenced", weapon0: "wand", sentence: 4 })).rows[1]!.value);
  });

  it("makes a flat SO reward stronger than an equal earned AS reward against a normal-health target", () => {
    const faction = pacedFaction(FACTIONS.sentenced);
    const weapon = "bow" as const;
    for (const stacks of [0, 10, 30]) {
      const baseAs = 1 + stacks * 0.01 * MARK_FARM_AS_EFFICIENCY;
      const interval = attackInterval(faction, weapon, baseAs);
      const baseHit = damagePerHit(faction, weapon, baseAs);
      const bonusStats = { ap: stacks };
      const baseMarkDps = markPct(faction, 0, 1, bonusStats) * 800 * markWeight(faction, weapon, baseAs, MARK_AS_EXPONENT) / interval;
      const apMarkDps = markPct(faction, 0, 1, { ap: stacks + 1 }) * 800 * markWeight(faction, weapon, baseAs, MARK_AS_EXPONENT) / interval;
      const baseWeaponScaling = scalingDamage(weapon, { ad: 0, ap: stacks, bonusMaxHp: 0, bonusDefense: 0 }, baseAs, interval);
      const apWeaponScaling = scalingDamage(weapon, { ad: 0, ap: stacks + 1, bonusMaxHp: 0, bonusDefense: 0 }, baseAs, interval);
      const apAutoDps = (baseHit + apWeaponScaling.phys + apWeaponScaling.magic) / interval;
      const asMult = baseAs + 0.01 * MARK_FARM_AS_EFFICIENCY;
      const asInterval = attackInterval(faction, weapon, asMult);
      const asMarkDps = markPct(faction, 0, 1, bonusStats) * 800 * markWeight(faction, weapon, asMult, MARK_AS_EXPONENT) / asInterval;
      const asWeaponScaling = scalingDamage(weapon, { ad: 0, ap: stacks, bonusMaxHp: 0, bonusDefense: 0 }, asMult, asInterval);
      const asAutoDps = (damagePerHit(faction, weapon, asMult) + asWeaponScaling.phys + asWeaponScaling.magic) / asInterval;
      const baseAutoDps = (baseHit + baseWeaponScaling.phys + baseWeaponScaling.magic) / interval;
      expect((apMarkDps + apAutoDps) - (baseMarkDps + baseAutoDps), `SO vs AS at ${stacks} prior rewards`).toBeGreaterThan((asMarkDps + asAutoDps) - (baseMarkDps + baseAutoDps));
    }
  });

  it("uses current hp for Radiant lifesteal and reports Frost control without damage", () => {
    const holy = player({ faction: "holy", hp: 700, maxHp: 1400 });
    const holyRow = championCombatModel(holy).rows[1]!;
    expect(holyRow.value).toContain(`${round(lifestealFraction(pacedFaction(FACTIONS.holy), 0.5) * 100)}%`);
    expect(holyRow.tooltip).toContain(`${FACTIONS.holy.params.ls1! * 100}% times missing health`);
    expect(holyRow.scaling).toContain("0 camps");
    const frostRow = championCombatModel(player({ faction: "frost" })).rows[1]!;
    expect(frostRow.value).toContain(`${FACTIONS.frost.params.slow! * 100}% AS`);
    expect(frostRow.value).toContain(`${round((1 - CHILL_MOVE_MULT) * 100)}% MS slow`);
    expect(frostRow.tooltip).toContain("does not scale with Offense or SO");
  });

  it("shows concise utility Wish values for all factions", () => {
    const expected: Record<(typeof factions)[number], string[]> = {
      fire: [`${BLAZE_BURN_DPS} true DPS`, `${BLAZE_BURN_MS / 1000}s trail`],
      sentenced: [`${TRIAL_MS / 1000}s zone`, "20% less dealt"],
      plague: ["8s hidden", "72 radius"], frost: ["1.25s stun", "450 range"],
      holy: [`${LAST_STAND_MS / 1000}s floor at 1 HP`, `+${LAST_STAND_SPEED_BONUS * 100}% move`],
    };
    for (const faction of factions) {
      const wish = championCombatModel(player({ faction })).rows[2]!;
      for (const text of expected[faction]) expect(wish.value).toContain(text);
      expect(wish.tooltip.length).toBeGreaterThan(wish.value.length);
    }
    const trial = championCombatModel(player({ faction: "sentenced" })).rows[2]!;
    expect(trial.scaling).toContain(`${round((1 - TRIAL_MOVE_MULT) * 100)}% slower`);
    expect(trial.scaling).toContain(`${TRIAL_EXIT_STUN_MS / 1000}s exit stun`);
    expect(LAST_STAND_HEAL_SHARE).toBe(0.3);
    expect(TRIAL_TAKEN_MULT).toBe(1.2);
    expect(TRIAL_MS).toBe(5000);
    expect(EXECUTE_BAND).toBe(0.5);
  });
});
