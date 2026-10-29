import {
  ABILITIES, AP_DOT_RATIO, BLAZE_BURN_DPS, BLAZE_BURN_MS, BLAZE_MIN_DIST, BLAZE_RANGE, CHILL_MOVE_MULT,
  EXECUTE_BAND, FACTIONS, FIRE_ROAM_BURST_AP_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_CHARGE_MAX, FIRE_ROAM_RAMP_MS,
  FREEZE_RANGE, FREEZE_STUN_MS, HEAVIER_SENTENCE_PER_BONUS, LAST_STAND_HEAL_SHARE, LAST_STAND_MS,
  LAST_STAND_SPEED_BONUS, MARK_KILL_STACK_CAP, MARK_TIER_HITS, MARK_TOP_TIER, SWARM_CLOUD_RADIUS,
  SWARM_MS, TRIAL_CONVICTED_RADIUS, TRIAL_DEALT_MULT, TRIAL_EXIT_STUN_MS, TRIAL_MS,
  TRIAL_MOVE_MULT, TRIAL_RADIUS, TRIAL_TAKEN_MULT, MARK_AS_EXPONENT, MARK_BONUS_STAT_PER_POINT, MARK_BONUS_AP_WEIGHT, MARK_FARM_AS_EFFICIENCY, attackInterval, bonusMultiplier, cardRows, countIn, damagePerHit,
  damageShares, decodeMirrors, foldRows, isFactionId, isWeaponId, lifestealFraction,
  fireRoamBurstDamage, fireRoamSpeedMult, markPct, markWeight, ownedCards, pacedFaction, scalingDamage, WIRE_IDENTITY_MIRRORS,
  WEAPONS, wishOf, holyCampLifestealOf, HOLY_CAMP_LIFESTEAL_PER_CLEAR, FROST_ELITE_GUARD_BONUS,
  PLAGUE_CORPSE_DISEASE_BONUS_PER_STACK, PLAGUE_CORPSE_HP_SHARE, sentencedHuntMarkMultiplier,
} from "@raid/shared";
import type { AbilityIcon, CardCounts, FactionId, WeaponId } from "@raid/shared";

export type ChampionCombatRowId = "auto" | "passive" | "wish";
export type ChampionCombatIcon = WeaponId | AbilityIcon | "physical" | "magic" | "true" | "attackSpeed" | "leech";

export interface ChampionCombatRow {
  id: ChampionCombatRowId;
  icon: ChampionCombatIcon;
  name: string;
  /** Compact primary readout suitable for a small HUD row. */
  value: string;
  /** Brief explanation of which stats affect this row. */
  scaling: string;
  /** Full precise wording, including conditional limits and omitted modifiers. */
  tooltip: string;
  /** Auto only: raw damage components per hit before target mitigation. */
  damage?: { physical: number; magic: number; true: number };
  /** Auto only: current attacks per second from the attack-speed mirror and weapon interval. */
  attacksPerSecond?: number;
}

export interface ChampionCombatInput {
  faction: string;
  weapon0?: string;
  weapon1?: string;
  slot?: number;
  /** PlayerState wire mirrors. Missing values use their identity. */
  asMult?: number;
  windupMult?: number;
  speedMult?: number;
  armorBonus?: number;
  shieldBonus?: number;
  adBonus?: number;
  apBonus?: number;
  maxHp?: number;
  hp?: number;
  sentence?: number;
  /** Current PlayerState Fire Roam mirrors. Charge is 0..1000; ready is the armed next basic attack. */
  roamCharge?: number;
  roamReady?: boolean;
  campClears?: number;
  frostEliteGuard?: boolean;
  corpseStacks?: number;
  huntStacks?: number;
  build?: CardCounts | null;
}

export interface ChampionCombatModel {
  rows: [ChampionCombatRow, ChampionCombatRow, ChampionCombatRow];
  /** Stable cache key; changes only when inputs that affect the three rows change. */
  signature: string;
}

const fmt = (n: number): string => Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "0";
const safe = (n: number | undefined, fallback: number): number => Number.isFinite(n) ? n! : fallback;

/**
 * Build the three concise combat rows from the same shared faction, weapon, card, and Wish definitions used by the server.
 * Auto damage is the current raw packet before target mitigation; conditional outgoing effects, crits, plant-feet, and PvP scaling
 * remain target/event dependent and are deliberately described in the tooltip rather than guessed.
 */
export function championCombatModel(input: ChampionCombatInput): ChampionCombatModel {
  const factionId: FactionId = isFactionId(input.faction) ? input.faction : "fire";
  const faction = pacedFaction(FACTIONS[factionId]);
  const weaponId: WeaponId = isWeaponId(input.slot === 1 ? input.weapon1 : input.weapon0)
    ? (input.slot === 1 ? input.weapon1 : input.weapon0) as WeaponId : "fists";
  const wire = {
    ...WIRE_IDENTITY_MIRRORS,
    asMult: safe(input.asMult, WIRE_IDENTITY_MIRRORS.asMult),
    windupMult: safe(input.windupMult, WIRE_IDENTITY_MIRRORS.windupMult),
    speedMult: safe(input.speedMult, WIRE_IDENTITY_MIRRORS.speedMult),
    armorBonus: safe(input.armorBonus, 0), shieldBonus: safe(input.shieldBonus, 0),
    adBonus: safe(input.adBonus, 0), apBonus: safe(input.apBonus, 0),
  };
  const mirrors = decodeMirrors(wire);
  const interval = attackInterval(faction, weaponId, mirrors.asMult);
  const attacksPerSecond = 1 / interval;
  const base = damagePerHit(faction, weaponId, mirrors.asMult);
  const bonusHp = Math.max(0, safe(input.maxHp, FACTIONS[factionId].hp) - FACTIONS[factionId].hp);
  const scalingValues = scalingDamage(weaponId, {
    ad: mirrors.adBonus, ap: mirrors.apBonus, bonusMaxHp: bonusHp,
    bonusDefense: Math.max(0, mirrors.armorBonus) + mirrors.shieldBonus,
  }, mirrors.asMult, interval);
  const rows = ownedCards(input.build);
  const effects = rows.flatMap(({ def, count }) => Array.from({ length: count }, () => cardRows(def.id, factionId)).flat());
  const owns = (id: string): boolean => countIn(input.build, id) > 0;
  const folded = foldRows(effects, { owns });
  const hitMult = folded.mults.hit;
  const shares = damageShares(faction);
  const physical = (base * shares.phys + scalingValues.phys) * hitMult;
  const magic = (base * shares.magic + scalingValues.magic) * hitMult;
  const trueDamage = base * shares.true * hitMult;
  const total = physical + magic + trueDamage;
  const fireRoamText = factionId === "fire"
    ? ` Fire Roam is ${input.roamReady ? "armed" : `${fmt(Math.min(FIRE_ROAM_CHARGE_MAX, Math.max(0, safe(input.roamCharge, 0))))}/${FIRE_ROAM_CHARGE_MAX} charged`}`
      + ` (${fmt((fireRoamSpeedMult(safe(input.roamCharge, 0)) - 1) * 100)}% move speed); after ${fmt(FIRE_ROAM_RAMP_MS / 1000)} s out of combat, the next landed basic attack adds ${fmt(fireRoamBurstDamage(mirrors.apBonus))} magic (${FIRE_ROAM_BURST_BASE} + ${fmt(FIRE_ROAM_BURST_AP_SHARE)}× SO). Incoming damage resets partial charge but does not cancel an already armed burst; Soul Defense mitigates the burst.`
    : "";
  const weapon = WEAPONS[weaponId];
  const scaleParts: Array<[number | undefined, string]> = [
    [weapon.scaling.ad, "Offense"], [weapon.scaling.ap, "SO"], [weapon.scaling.hp, "bonus HP"], [weapon.scaling.def, "bonus defense"],
  ];
  const scaleTerms = scaleParts.filter(([coefficient]) => (coefficient ?? 0) !== 0).map(([coefficient, label]) => `${fmt(coefficient ?? 0)}× ${label}`).join(" + ") || "none";
  const auto: ChampionCombatRow = {
    id: "auto", icon: weaponId, name: `${weapon.name} hit`, value: `${fmt(total)} / hit · ${fmt(attacksPerSecond)}/s`,
    scaling: scaleTerms,
    tooltip: `Raw damage per hit before target mitigation: ${fmt(physical)} physical, ${fmt(magic)} magic, ${fmt(trueDamage)} true. `
      + `Attack rate uses your current attack-speed mirror (${fmt(mirrors.asMult)}×) and this weapon's interval. `
      + `Weapon scaling (${scaleTerms}) adds ${fmt(scalingValues.phys)} physical and ${fmt(scalingValues.magic)} magic before the ${fmt(hitMult)}× hit multiplier. `
      + "This raw packet excludes target defenses, outgoing damage bonuses, conditional effects, critical hits, Plant Your Feet, and player-versus-player scaling."
      + fireRoamText,
    damage: { physical, magic, true: trueDamage }, attacksPerSecond,
  };
  const passive = passiveRow(input, factionId, faction, weaponId, mirrors, bonusHp, folded.mults.dot, folded.mults.returned,
    folded.sums.executeBand, folded.flags.has("heavierSentence"));
  const wish = wishRow(factionId);
  const resultRows: [ChampionCombatRow, ChampionCombatRow, ChampionCombatRow] = [auto, passive, wish];
  return { rows: resultRows, signature: resultRows.map(row => `${row.id}|${row.icon}|${row.name}|${row.value}|${row.scaling}|${row.tooltip}`).join("\n") };
}

function passiveRow(input: ChampionCombatInput, factionId: FactionId, faction: typeof FACTIONS[FactionId], weapon: WeaponId, mirrors: ReturnType<typeof decodeMirrors>, bonusHp: number,
  dotMult: number, returnedMult: number, executeBandBonus: number, heavierSentence: boolean): ChampionCombatRow {
  const bm = bonusMultiplier(weapon);
  switch (factionId) {
    case "fire": {
      const burnBase = faction.params.burn! * bm;
      const burnAp = AP_DOT_RATIO * mirrors.apBonus;
      const burn = (burnBase + burnAp) * dotMult;
      return {
        id: "passive", icon: "magic", name: "Dragonslayer", value: `${fmt(burn)} magic/s`,
        scaling: `SO adds ${fmt(AP_DOT_RATIO)} magic DPS/point · DoT ×${fmt(dotMult)}`,
        tooltip: `While trading, burn deals ${fmt(burn)} magic DPS: ${fmt(burnBase)} from your faction plus ${fmt(burnAp)} from SO (${fmt(AP_DOT_RATIO)} per SO), including the ${fmt(dotMult)}× DoT multiplier. `
          + `Engaged enemies also take physical backlash per swing: ${fmt(faction.params.backlash! * bm * returnedMult)} × their base attack rate × their unbuffed weapon interval.`,
      };
    }
    case "sentenced": {
      const stacks = Math.max(0, Math.min(MARK_KILL_STACK_CAP, Math.floor(safe(input.sentence, 0))));
      const heavierScale = heavierSentence ? 1 + HEAVIER_SENTENCE_PER_BONUS * (bonusHp / faction.hp) : 1;
      const wireAs = safe(input.asMult, WIRE_IDENTITY_MIRRORS.asMult);
      const bonusStats = {
        ad: mirrors.adBonus, ap: mirrors.apBonus, armor: mirrors.armorBonus, magicResist: mirrors.shieldBonus,
      };
      const pulse = markPct(faction, stacks, heavierScale, bonusStats)
        * markWeight(faction, weapon, decodeMirrors({ ...WIRE_IDENTITY_MIRRORS, asMult: wireAs }).asMult, MARK_AS_EXPONENT)
        * sentencedHuntMarkMultiplier(safe(input.huntStacks, 0));
      const bonusTotal = bonusStats.ad + bonusStats.ap + bonusStats.armor + bonusStats.magicResist;
      const weightedBonusTotal = bonusStats.ad + MARK_BONUS_AP_WEIGHT * bonusStats.ap + bonusStats.armor + bonusStats.magicResist;
      return {
        id: "passive", icon: "true", name: "Sentence", value: `${fmt(pulse * 100)}% target HP / hit`,
        scaling: `+${fmt((faction.params.mark_kill ?? 0) * 100)}%/kill stack · ${fmt(weightedBonusTotal)} weighted bonus stats · ×${fmt(faction.params.mark_amp ?? 1)} at tier ${MARK_TOP_TIER}`,
        tooltip: `A tier-1 mark pulse is ${fmt(pulse * 100)}% of target max HP per hit using ${WEAPONS[weapon].name}'s actual hit weight. `
          + `A mark starts at tier 1, advances every ${MARK_TIER_HITS} hits, and reaches ×${fmt(faction.params.mark_amp ?? 1)} at tier ${MARK_TOP_TIER}. `
          + `Your ${stacks} Sentence kill stacks add ${fmt((faction.params.mark_kill ?? 0) * 100)}% target max HP each. Bonus Offense ${fmt(bonusStats.ad)}, SO ${fmt(bonusStats.ap)}, Defense ${fmt(bonusStats.armor)}, and SD ${fmt(bonusStats.magicResist)} add ${fmt(bonusTotal)} raw bonus-stat points (${fmt(weightedBonusTotal)} weighted for the mark).${heavierSentence ? ` Heavier Sentence adds ${fmt(HEAVIER_SENTENCE_PER_BONUS * (bonusHp / faction.hp) * 100)}% from bonus HP.` : ""} `
          + `Offense, Defense, and SD add ${fmt(MARK_BONUS_STAT_PER_POINT * 100)}% mark strength per point; SO has ${MARK_BONUS_AP_WEIGHT}× weight and adds ${fmt(MARK_BONUS_STAT_PER_POINT * MARK_BONUS_AP_WEIGHT * 100)}% per point. Attack-speed bonuses from cards and farming are ${fmt(MARK_FARM_AS_EFFICIENCY * 100)}% effective; your base attack speed is unchanged. `
          + `Completed hunts add ${fmt((sentencedHuntMarkMultiplier(safe(input.huntStacks, 0)) - 1) * 100)}% permanent mark strength. `
          + "Distance, camp sharing, Trial, and the current mark progress change the exact pulse.",
      };
    }
    case "plague": {
      const band = Math.min(1, Math.max(0, EXECUTE_BAND + executeBandBonus));
      const stacks = Math.max(0, safe(input.corpseStacks, 0));
      const growth = 1 + stacks * PLAGUE_CORPSE_DISEASE_BONUS_PER_STACK;
      const disease = (faction.params.plague! * bm + AP_DOT_RATIO * mirrors.apBonus) * dotMult * growth;
      return {
        id: "passive", icon: "magic", name: "Rat King disease", value: `${fmt(disease)} magic/s`,
        scaling: `SO +${fmt(AP_DOT_RATIO * growth)} DPS/point · ${fmt(stacks)} corpses · +${fmt(stacks * PLAGUE_CORPSE_HP_SHARE * 100)}% HP`,
        tooltip: `While trading, disease deals ${fmt(disease)} magic DPS, with SO adding ${fmt(AP_DOT_RATIO * growth * dotMult)} magic DPS per point. `
          + `Corpse harvest multiplies disease (including its SO damage) by ${fmt(growth)}; each corpse grants ${fmt(PLAGUE_CORPSE_HP_SHARE * 100)}% base max HP and ${fmt(PLAGUE_CORPSE_DISEASE_BONUS_PER_STACK * 100)}% disease strength. `
          + `Below ${fmt(band * 100)}% target HP, execute adds ${fmt(faction.params.execute! * bm * dotMult)} × (${fmt(band)} − target HP fraction) magic DPS. Both include the ${fmt(dotMult)}× DoT multiplier; corpse stacks do not amplify the execute.`,
      };
    }
    case "frost":
      return {
        id: "passive", icon: "attackSpeed", name: "Ice wall", value: `${fmt(faction.params.slow! * 100)}% AS · ${fmt((1 - CHILL_MOVE_MULT) * 100)}% MS slow`,
        scaling: `Frozen Justice: +${FROST_ELITE_GUARD_BONUS} Defense/SD · ${input.frostEliteGuard ? "ACTIVE" : "elite fights"}`,
        tooltip: `While engaged, Frost slows enemy attack-cooldown progress by ${fmt(faction.params.slow! * 100)}%. Nearby enemies also move at ${fmt(CHILL_MOVE_MULT * 100)}% speed briefly, then thaw over 3 seconds. Frozen Justice grants +${FROST_ELITE_GUARD_BONUS} Defense and Soul Defense while fighting elites, lingering for 2 seconds after contact. This passive deals no damage and does not scale with Offense or SO.`,
      };
    case "holy": {
      const hpFrac = input.maxHp && input.maxHp > 0 ? Math.max(0, Math.min(1, safe(input.hp, input.maxHp) / input.maxHp)) : 1;
      const share = lifestealFraction(faction, hpFrac);
      const camps = Math.max(0, safe(input.campClears, 0));
      const campLeech = holyCampLifestealOf(camps) * (countIn(input.build, "bloodthirst") > 0 && hpFrac < 0.5 ? 2 : 1);
      return {
        id: "passive", icon: "leech", name: "Radiant", value: `${fmt((share + campLeech) * 100)}% life steal`,
        scaling: `${fmt(camps)} camps · +${fmt(campLeech * 100)}% earned leech`,
        tooltip: `Heal for ${fmt((share + campLeech) * 100)}% of post-mitigation damage dealt at your current health (${fmt(hpFrac * 100)}% HP), before card and mob leech. The faction share is ${fmt(faction.params.ls0! * 100)}% plus ${fmt(faction.params.ls1! * 100)}% times missing health, capped at ${fmt(faction.params.ls_cap! * 100)}%. Each eligible camp clear adds ${fmt(HOLY_CAMP_LIFESTEAL_PER_CLEAR * 100)}% permanent lifesteal without a farming cap. Bloodthirst also doubles that earned bonus below half health.`,
      };
    }
  }
}

function wishRow(faction: FactionId): ChampionCombatRow {
  const def = ABILITIES[wishOf(faction)!.id];
  switch (def.id) {
    case "freeze": return { id: "wish", icon: def.icon, name: def.name, value: `${fmt(FREEZE_STUN_MS / 1000)}s stun · ${fmt(FREEZE_RANGE)} range`, scaling: "No damage scaling", tooltip: `${def.blurb} Fixed ${fmt(FREEZE_STUN_MS / 1000)} second stun within ${FREEZE_RANGE} range; no damage.` };
    case "swarm": return { id: "wish", icon: def.icon, name: def.name, value: `${fmt(SWARM_MS / 1000)}s hidden · ${SWARM_CLOUD_RADIUS} radius`, scaling: "No damage scaling", tooltip: `${def.blurb} Hidden for ${fmt(SWARM_MS / 1000)} seconds; the cloud radius is ${SWARM_CLOUD_RADIUS}. No damage.` };
    case "trial": return { id: "wish", icon: def.icon, name: def.name, value: `${fmt(TRIAL_MS / 1000)}s zone · ${fmt((1 - TRIAL_DEALT_MULT) * 100)}% less dealt`, scaling: `${fmt((1 - TRIAL_MOVE_MULT) * 100)}% slower · +${fmt((TRIAL_TAKEN_MULT - 1) * 100)}% taken · ${fmt(TRIAL_EXIT_STUN_MS / 1000)}s exit stun`, tooltip: `${def.blurb} The ring lasts ${fmt(TRIAL_MS / 1000)} seconds, radius ${TRIAL_RADIUS} (or ${TRIAL_CONVICTED_RADIUS} on a convicted mark); its target deals ${fmt(TRIAL_DEALT_MULT * 100)}% damage, moves at ${fmt(TRIAL_MOVE_MULT * 100)}% speed, takes ${fmt(TRIAL_TAKEN_MULT * 100)}%, and is stunned ${fmt(TRIAL_EXIT_STUN_MS / 1000)} seconds on exit. No damage scaling.` };
    case "blaze": return { id: "wish", icon: def.icon, name: def.name, value: `${BLAZE_BURN_DPS} true DPS · ${fmt(BLAZE_BURN_MS / 1000)}s trail`, scaling: `${BLAZE_MIN_DIST}–${BLAZE_RANGE} blink · fixed damage`, tooltip: `${def.blurb} Blink ${BLAZE_MIN_DIST}–${BLAZE_RANGE} units and leave a ${fmt(BLAZE_BURN_MS / 1000)} second trail dealing fixed ${BLAZE_BURN_DPS} true damage per second. Wish damage does not scale with Offense, SO, weapon, or card damage multipliers.` };
    case "lastStand": return { id: "wish", icon: def.icon, name: def.name, value: `${fmt(LAST_STAND_MS / 1000)}s floor at 1 HP · +${fmt(LAST_STAND_SPEED_BONUS * 100)}% move`, scaling: `${fmt(LAST_STAND_HEAL_SHARE * 100)}% of held damage healed back`, tooltip: `${def.blurb} For ${fmt(LAST_STAND_MS / 1000)} seconds, health cannot fall below 1, movement speed rises ${fmt(LAST_STAND_SPEED_BONUS * 100)}%, and ${fmt(LAST_STAND_HEAL_SHARE * 100)}% of damage held back is healed after the effect. No damage scaling.` };
  }
}
