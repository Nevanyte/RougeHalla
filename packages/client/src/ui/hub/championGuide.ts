// Read-only descriptions of the actual kit. Arena-paced signature values and weapon coefficients come from the shared
// combat catalog; this view never changes an ability, card, cooldown, or stat.
import {
  ALL_WEAPON_IDS, AP_DOT_RATIO, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, ENGAGE_LINGER_SECONDS, EXECUTE_BAND, FACTIONS,
  FIRE_ROAM_BURST_AP_SHARE, FIRE_ROAM_BURST_BASE, FIRE_ROAM_MAX_SPEED_MULT, FIRE_ROAM_RAMP_MS,
  HIDDEN_REVEAL_MS, LIFESTEAL_MAX, MARK_FAR_SHARE, MARK_KILL_STACK_CAP, MARK_NEAR_RANGE, MARK_TIER_HITS,
  MARK_TOP_TIER, TARGET_FORGET_SECONDS, TRAINING_WISH_COOLDOWN_SECONDS, WEAPONS, WISH_LOCK_SECONDS,
  abilityCooldownMs, maxCharges, burnDps, magicShare, markPct, pacedFaction, plagueDps, rankOf, wishOf,
  HOLY_CAMP_LIFESTEAL_PER_CLEAR, FROST_ELITE_GUARD_BONUS, FROST_ELITE_GUARD_LINGER_MS,
  FIRE_BACKLASH_PER_DEFENSE, FROST_RANGED_CHILL_MS, FROST_RANGED_CHILL_MULT, HOLY_AP_LIFESTEAL_CAP, HOLY_LIFESTEAL_PER_AP,
  MARK_BONUS_STAT_PER_POINT, PLAGUE_ZOMBIE_AD_SHARE, PLAGUE_ZOMBIE_HIT_CAP_SHARE, PLAGUE_ZOMBIE_HIT_PER_BONUS, PLAGUE_ZOMBIE_HP_PER_BONUS,
  FIRE_BURN_AD_RATIO, FROST_CHILL_BONUS_CAP, FROST_CHILL_PER_ATTACK_SPEED, FROST_CHILL_PER_SD, HOLY_LEECH_ROW_MULT,
  PLAGUE_AP_PER_HIT,
  PLAGUE_CORPSE_HP_SHARE, PLAGUE_CORPSE_LIFETIME_MS, PLAGUE_ZOMBIE_HP_SHARE, PLAGUE_ZOMBIE_HIT_SHARE, PLAGUE_ZOMBIE_REGEN_SHARE_PER_SECOND,
  PLAGUE_ZOMBIE_GROWTH_PER_BODY, PLAGUE_ZOMBIE_INTERVAL_MS,
  SENTENCED_HUNT_MOVE_BONUS, SENTENCED_HUNT_MARK_PER_STACK,
  type AbilityDef, type FactionId, type WeaponId,
} from "@raid/shared";
import { abilityTip } from "../combatTip";

export type ScalingKind = "ad" | "ap" | "health" | "defense" | "target" | "fixed";
export interface ScalingTag { kind: ScalingKind; label: string }
export interface GuideAbility {
  name: string;
  key: string;
  kind: string;
  summary: string;
  scaling: string;
  tags: ScalingTag[];
  details: string[];
}

export function guideNumber(n: number): string { return String(Number(n.toFixed(3))); }
const pct = (n: number): string => `${guideNumber(n * 100)}%`;
const seconds = (ms: number): string => `${guideNumber(ms / 1000)} s`;

/** The base passive, with explicit boundaries between SO, damage type, and target-dependent scaling. */
export function signatureGuide(id: FactionId): GuideAbility {
  const f = pacedFaction(FACTIONS[id]);
  const p = f.params;
  const base = { key: "P", kind: "Passive signature" };
  switch (id) {
    case "fire": return {
      ...base, name: "Dragonslayer",
      summary: "Burn and retaliate during a trade; roam between fights to charge a faster move and a magic hit burst.",
      scaling: `Burn: ${guideNumber(burnDps(f))} × weapon multiplier + ${guideNumber(AP_DOT_RATIO)} × SO + ${guideNumber(FIRE_BURN_AD_RATIO)} × Offense magic damage/s. Roaming reaches ${guideNumber(FIRE_ROAM_MAX_SPEED_MULT)}× move speed and charges a ${FIRE_ROAM_BURST_BASE} + ${guideNumber(FIRE_ROAM_BURST_AP_SHARE)} × SO magic burst over ${seconds(FIRE_ROAM_RAMP_MS)}.`,
      tags: [{ kind: "ap", label: "SO · burn & roam burst" }, { kind: "ad", label: "Offense · burn" }, { kind: "target", label: "Enemy attacks · retaliation" }],
      details: [
        `Burn = ${guideNumber(burnDps(f))} × your weapon's damage multiplier + ${guideNumber(AP_DOT_RATIO)} × SO + ${guideNumber(FIRE_BURN_AD_RATIO)} × Offense, per second. The SO and Offense parts are added after the weapon multiplier.`,
        `Retaliation per enemy attack = ${guideNumber(p.backlash!)} × the enemy's unbuffed weapon interval × your weapon's damage multiplier: about ${guideNumber(p.backlash!)} × multiplier per second of enemy attacks, whatever its faction or weapon. Enemy attack-speed bonuses create more triggers without shrinking each trigger.`,
        `Outside combat, movement speed ramps to ${guideNumber(FIRE_ROAM_MAX_SPEED_MULT)}× over ${seconds(FIRE_ROAM_RAMP_MS)}. Combat resets partial charge; taking damage does not cancel a burst already armed for an attack. The next landed basic attack consumes it for ${FIRE_ROAM_BURST_BASE} + ${guideNumber(FIRE_ROAM_BURST_AP_SHARE)} × SO magic damage, reduced by Soul Defense.`,
        "Burn deals magic damage; retaliation deals physical damage. Offense and SO feed the burn; neither increases retaliation.",
        `Two builds: the Offense burst assassin (Offense on a sword, axe or bow, roaming in for the burst, its Offense feeding the burn), or the SO burn tank (SO feeds the burn, and every point of bonus Defense + SD adds ${pct(FIRE_BACKLASH_PER_DEFENSE)} to retaliation).`,
        `The passive needs an active trade in weapon reach and line of sight. Base reach linger is ${guideNumber(ENGAGE_LINGER_SECONDS)} s; the target is forgotten after ${guideNumber(TARGET_FORGET_SECONDS)} s without contact.`,
      ],
    };
    case "sentenced": return {
      ...base, name: "Mark",
      summary: "Choose a rival to hunt, then grow stronger when they fall. Every landed hit deals a share of the target's max health (40% physical, 60% magic).",
      scaling: `Scales with target max HP, attack speed (like any weapon), every bonus stat point (${pct(MARK_BONUS_STAT_PER_POINT)} of the pulse per Offense, SO, Defense or SD point), Sentence stacks and hunt stacks.`,
      tags: [{ kind: "target", label: "Enemy max health" }, { kind: "ad", label: "Attack speed · bonus stats" }],
      details: [
        `True-damage pulse = ${pct(markPct(f, 0))} base share (plus ${pct(p.mark_kill!)} × Sentence stacks), multiplied by target max health, hit weight, distance and Heavier Sentence.`,
        `Hunt: choose one living rival from the target panel. Track their location for the rest of their life and gain ${pct(SENTENCED_HUNT_MOVE_BONUS)} movement speed while moving toward them. When they die, gain ${pct(SENTENCED_HUNT_MARK_PER_STACK)} permanent mark strength and choose again. Leaving clears the target without a reward; dying ends your hunt. Tracking does not remove Swarm's untargetable status.`,
        `Hit weight = faction base attack rate × weapon damage multiplier × attack-speed multiplier × attack interval in seconds: the same share of max health per second of attacking, so attack speed raises the mark exactly as it raises weapon damage.`,
        `Two builds: the stat bully bruiser (any mix of bonus Offense, SO, Defense and SD grows every pulse by ${pct(MARK_BONUS_STAT_PER_POINT)} per point) or the attack-speed punisher (more hits, more pulses of the target's max health).`,
        `Tier 1 starts on the first hit. Tiers 2, 3 and ${MARK_TOP_TIER} arrive at ${MARK_TIER_HITS}, ${MARK_TIER_HITS * 2} and ${MARK_TIER_HITS * 3} hit-progress respectively; the marked target's weapon swaps also promote it. Tiers do not change the pulse; tier ${MARK_TOP_TIER} denies the marked enemy's execute.`,
        `Beyond ${MARK_NEAR_RANGE} units, pulses use ${pct(MARK_FAR_SHARE)} strength. Your Trial ring restores full strength. Sentence stacks cap at ${MARK_KILL_STACK_CAP}.`,
        "A camp shares the mark. Each member's pulse is multiplied by 1/√(original camp size). Regional mobs use their faction's player-sized base HP as the pulse pool, rather than their smaller mob HP. Augments may add further scaling.",
      ],
    };
    case "plague": return {
      ...base, name: "Rat King",
      summary: "Consume a player body to raise a Plague zombie that assists you. More bodies strengthen it and grant you both max health. Disease wears down foes; execute finishes them.",
      scaling: `Disease: ${guideNumber(plagueDps(f))} × weapon multiplier per second, + ${guideNumber(PLAGUE_AP_PER_HIT)} × SO per weapon hit you land (attack speed carries it). Zombie health and attacks scale with your bonus max health and harvested bodies. The execute grows with the enemy's missing health below ${pct(EXECUTE_BAND)}.`,
      tags: [{ kind: "health", label: "Max health · zombie" }, { kind: "ap", label: "SO · disease" }, { kind: "target", label: "Enemy low health · execute" }],
      details: [
        `Disease = ${guideNumber(plagueDps(f))} × your weapon's damage multiplier per second while you trade, + ${guideNumber(PLAGUE_AP_PER_HIT)} × SO for every weapon hit you land on the target (paid evenly at your hit rate), so a fast wand or bow is the disease build.`,
        `Harvest: dead players leave green corpses on your map for ${seconds(PLAGUE_CORPSE_LIFETIME_MS)}. Walk over one to consume it automatically before another Plague does. The first raises one zombie; each body grants you ${pct(PLAGUE_CORPSE_HP_SHARE)} base max health and grows the zombie.`,
        `The zombie follows you and attacks the enemy you lock: a wand commands it from range. Its max HP is ${pct(PLAGUE_ZOMBIE_HP_SHARE)} of your max HP + ${guideNumber(PLAGUE_ZOMBIE_HP_PER_BONUS)} per point of bonus max HP, and each physical hit is ${pct(PLAGUE_ZOMBIE_HIT_SHARE)} of your max HP + ${pct(PLAGUE_ZOMBIE_HIT_PER_BONUS)} of your bonus max HP before defenses and PvP scaling. It attacks every ${seconds(PLAGUE_ZOMBIE_INTERVAL_MS)}. Each body after the first adds another ${pct(PLAGUE_ZOMBIE_GROWTH_PER_BODY)} of the zombie's base health and damage. Health from farming, cards and trades also strengthens it. It regenerates ${pct(PLAGUE_ZOMBIE_REGEN_SHARE_PER_SECOND)} of its max HP per second, slower just after it is hit.`,
        `Second build, the zombie commander: stack max health, and the zombie grows with it; each of its hits also adds ${guideNumber(PLAGUE_ZOMBIE_AD_SHARE)} × your bonus Offense (up to ${pct(PLAGUE_ZOMBIE_HIT_CAP_SHARE)} of your max HP a hit). Lock targets with a wand from range and let the zombie fight. The first build stacks attack speed and SO into disease with a wand or bow.`,
        "If the zombie dies, consume another player body to revive it with all accumulated growth. It disappears when you die or the run ends. Corpse growth no longer multiplies disease or execute damage.",
        `Extra execute damage/s = ${guideNumber(p.execute!)} × max(0, ${guideNumber(EXECUTE_BAND)} − enemy current-health fraction) × your weapon's damage multiplier. At ${pct(EXECUTE_BAND / 2)} enemy health, this adds ${guideNumber(p.execute! * EXECUTE_BAND / 2)} × weapon multiplier per second.`,
        "Disease and execute deal magic damage. SO is added once to the disease; the execute has no second SO rider. Offense does not directly increase the signature.",
        "Plague's disease and execute damage-over-time ticks cannot critically strike; auto attacks can. With Cruel Wounds, Plague gets +20% auto-attack crit chance and converts half its current crit chance into steady DoT damage instead of DoT crits.",
        `The signature requires an active trade in weapon reach and line of sight, with ${guideNumber(ENGAGE_LINGER_SECONDS)} s of base reach linger. Sentenced's final mark tier can deny the execute part.`,
      ],
    };
    case "frost": return {
      ...base, name: "Wall of Ice",
      summary: "Frozen Justice grants defenses in elite fights. Slow enemy attacks and briefly chill nearby enemies before they thaw.",
      scaling: `${pct(p.slow!)} attack slow, +${pct(FROST_CHILL_PER_SD)} per bonus SD point and +${pct(FROST_CHILL_PER_ATTACK_SPEED / 10)} per +10% bonus attack speed (at most +${pct(FROST_CHILL_BONUS_CAP)}); up to ${pct(1 - CHILL_MOVE_MULT)} movement slow within ${CHILL_MOVE_RADIUS} units for 1 s, fading over the next 3 s. Control strength does not scale with Offense or SO.`,
      tags: [{ kind: "defense", label: "Soul Defense · deeper chill" }, { kind: "fixed", label: "Attack speed · deeper chill" }],
      details: [
        `An engaged enemy's attack cooldown and damage over time progress at ${pct(1 - p.slow!)} of their usual pace: the chill cuts everything it deals. Every bonus Soul Defense point deepens the cut by ${pct(FROST_CHILL_PER_SD)} and every +10% bonus attack speed by ${pct(FROST_CHILL_PER_ATTACK_SPEED / 10)}, together at most +${pct(FROST_CHILL_BONUS_CAP)}.`,
        `Bow kiter build: your bow or wand hits chill the target's walk to ${pct(FROST_RANGED_CHILL_MULT)} for ${seconds(FROST_RANGED_CHILL_MS)} at any range, and its bonus attack speed deepens the chill. Tank build: the shield turns your bonus Defense + SD into damage, and its Soul Defense deepens the chill.`,
        `Frozen Justice grants +${FROST_ELITE_GUARD_BONUS} Defense and +${FROST_ELITE_GUARD_BONUS} Soul Defense while fighting elites, lingering ${seconds(FROST_ELITE_GUARD_LINGER_MS)} after contact. Normal mobs and players do not activate it.`,
        `Within ${CHILL_MOVE_RADIUS} units, movement is slowed by up to ${pct(1 - CHILL_MOVE_MULT)} for 1 s, then the slow fades linearly to zero over 3 s even if the enemy stays nearby.`,
        "Leaving the chill radius removes the movement slow while away. Repeated hits and switching between Frost fighters do not refresh it; 4 s clear of every Frost movement chill restores its full strength.",
        `Engagement uses the held weapon's reach and line of sight, with ${guideNumber(ENGAGE_LINGER_SECONDS)} s of base reach linger. One distant tag does not keep the aura running forever.`,
        "Health and Defense let you hold your ground longer; only Soul Defense and attack speed deepen the slow. Your weapon still has its own damage scaling.",
      ],
    };
    case "holy": return {
      ...base, name: "Radiant",
      summary: "Earn permanent lifesteal from camp clears. Heal from damage dealt, with stronger faction lifesteal as your health falls.",
      scaling: `${pct(p.ls0!)}–${pct(p.ls_cap!)} faction lifesteal, increasing with your missing-health percentage. More eligible damage dealt means more healing.`,
      tags: [{ kind: "health", label: "Missing health %" }, { kind: "target", label: "Damage dealt · healing" }],
      details: [
        `Faction lifesteal = min(${pct(p.ls_cap!)}, ${pct(p.ls0!)} + ${pct(p.ls1!)} × missing-health fraction). At half health, the faction grants ${pct(Math.min(p.ls_cap!, p.ls0! + p.ls1! * .5))} lifesteal.`,
        `Holy earns +${pct(HOLY_CAMP_LIFESTEAL_PER_CLEAR)} permanent lifesteal per eligible camp clear, shared with other living camp contributors. Mob and camp leech grow without a farming cap and receive Bloodthirst's multiplier. The faction and card portion retains its ${pct(LIFESTEAL_MAX)} limit; anti-heal reduces healing received.`,
        `SO adds ${pct(HOLY_LIFESTEAL_PER_AP)} faction lifesteal per point (at most +${pct(HOLY_AP_LIFESTEAL_CAP)}), so a Soul-damage Holy (wand, or a sword whose SO is its higher stat) sustains through its burst. Offense helps only through damage. Missing health is a fraction of maximum health, not an absolute HP amount.`,
        `Lifesteal juggernaut build: your card leech counts ${guideNumber(HOLY_LEECH_ROW_MULT)}× for Holy (still capped like any card leech), so a Leech card sustains you more than it does anyone else.`,
      ],
    };
  }
}

export function wishGuide(id: FactionId): GuideAbility & { def: AbilityDef; cooldown: string; targeting: string } {
  const def = wishOf(id)!;
  const rank = rankOf(def, 1);
  const target = rank.targeting;
  const targeting = target.kind === "unit" ? `Enemy · ${target.range} u` : target.kind === "point"
    ? `Cursor · ${target.minRange}–${target.range} u` : target.kind === "self" ? "Self" : "Direction";
  const cooldownMs = abilityCooldownMs(def, 1, {});
  const charges = maxCharges(def, 1);
  const every = cooldownMs >= 60_000 ? `${guideNumber(cooldownMs / 60_000)} min` : seconds(cooldownMs);
  const cooldown = charges > 1 ? `${charges} charges · 1 back every ${every}` : `${every} cooldown`;
  const effects = rank.effects;
  const status = effects.find(e => e.do === "status");
  const zone = effects.find(e => e.do === "zone");
  const trail = effects.find(e => e.do === "trail");
  const floor = effects.find(e => e.do === "deathFloor");
  const scaling = id === "frost" && status?.do === "status" ? `Fixed ${seconds(status.ms)} stun · no Offense/SO scaling.`
    : id === "plague" && status?.do === "status" ? `Fixed ${seconds(status.ms)} concealment · no Offense/SO scaling.`
    : id === "sentenced" && zone?.do === "zone" ? `Fixed ${seconds(zone.ms)} ring: enemy deals ${pct(1 - zone.dealtMult)} less, moves ${pct(1 - zone.moveMult)} slower, takes ${pct(zone.takenFromCasterMult - 1)} more damage from you, and is stunned for ${seconds(zone.exitStunMs)} on exit.`
    : id === "fire" && trail?.do === "trail" ? `Fixed ${guideNumber(trail.dps)} true damage/s on the trail · no Offense/SO scaling.`
    : floor?.do === "deathFloor" ? `Fixed ${seconds(floor.ms)} death floor; heals back ${pct(floor.healBack)} of damage held.`
    : "Fixed base effect values · no Offense/SO scaling.";
  const summaries: Record<FactionId, string> = {
    fire: "Blink toward your cursor through walls and leave a burning trail behind you.",
    sentenced: "Trap an enemy in a judgment ring: weaken their damage, strengthen yours, and stun them if they leave.",
    plague: "Become a hidden swarm to break enemy targeting and reposition.",
    frost: "Stun the enemy nearest your cursor to catch them or interrupt their attack.",
    holy: "Survive lethal damage briefly, move faster, then recover a share of the damage the effect held.",
  };
  return {
    def, name: def.name, key: "D", kind: "Active Wish", summary: summaries[id], scaling,
    tags: [{ kind: "fixed", label: "Fixed base values" }, ...(id === "holy" ? [{ kind: "target" as const, label: "Damage held · heal" }] : [])], cooldown, targeting,
    details: [
      ...abilityTip(def).split("\n").slice(2),
      ...(zone?.do === "zone" && zone.convictedRadius !== undefined
        ? [`Against a convicted target (mark tier 3+), ring radius is ${zone.convictedRadius} u instead of ${zone.radius} u. Your mark remains at full strength inside your Trial ring.`] : []),
      ...(id === "plague" ? [`Your own attack or cast temporarily reveals you until it lands, plus ${seconds(HIDDEN_REVEAL_MS)}. Concealment is not invulnerability.`] : []),
      ...(def.ownOrder ? ["Casting replaces your current attack and movement order."] : []),
      `Available after the run's initial ${WISH_LOCK_SECONDS} s lock. Training cooldown: ${TRAINING_WISH_COOLDOWN_SECONDS} s.`,
      "Offense and SO do not increase this Wish's base effect values. Augments can alter cooldowns or add effects; the numbers here describe the unmodified kit.",
      ...(rank.castMs > 0 ? [`Cast interruption: ${def.cancelledBy.join(", ")}.`] : []),
      `Cannot cast while affected by ${def.blockedBy.join(" or ")}.`,
    ],
  };
}

export function championGuide(id: FactionId) {
  const faction = FACTIONS[id];
  return {
    faction, passive: signatureGuide(id), wish: wishGuide(id),
    baseDamage: [faction.phys > 0 ? `${pct(faction.phys)} physical` : "", magicShare(faction) > 0 ? `${pct(magicShare(faction))} magic` : "", faction.trueShare > 0 ? `${pct(faction.trueShare)} true` : ""].filter(Boolean).join(" · "),
  };
}

export function weaponScalingGuide(id: WeaponId): { name: string; scaling: string; detail: string } {
  const weapon = WEAPONS[id];
  const labels = { ad: "Offense", ap: "SO", hp: "bonus max HP", def: "(bonus Defense + bonus SD)" };
  const scaling = (Object.entries(weapon.scaling) as Array<[keyof typeof labels, number]>)
    .sort((a, b) => b[1] - a[1])
    .map(([stat, ratio]) => `${guideNumber(ratio)} × ${labels[stat]}`).join(weapon.dominant ? " or " : " + ")
    + (weapon.dominant ? " (whichever is higher)" : "");
  return {
    name: weapon.name, scaling,
    detail: `Bonus damage per hit = (${scaling}) × attack-speed multiplier × attack interval in seconds. Offense, bonus HP and defense scaling deal physical damage; SO scaling deals magic damage.`,
  };
}
export const GUIDE_WEAPON_IDS = ALL_WEAPON_IDS;
