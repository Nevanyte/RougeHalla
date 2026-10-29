// Read-only descriptions of the actual kit. Arena-paced signature values and weapon coefficients come from the shared
// combat catalog; this view never changes an ability, card, cooldown, or stat.
import {
  ALL_WEAPON_IDS, AP_DOT_RATIO, CHILL_MOVE_MULT, CHILL_MOVE_RADIUS, ENGAGE_LINGER_SECONDS, EXECUTE_BAND, FACTIONS,
  HIDDEN_REVEAL_MS, LIFESTEAL_MAX, MARK_FAR_SHARE, MARK_KILL_STACK_CAP, MARK_NEAR_RANGE, MARK_TAX_THRESHOLD, MARK_TIER_HITS,
  MARK_TOP_TIER, TARGET_FORGET_SECONDS, TRAINING_WISH_COOLDOWN_SECONDS, WEAPONS, WISH_LOCK_SECONDS,
  abilityCooldownMs, burnDps, magicShare, markPct, pacedFaction, plagueDps, rankOf, wishOf,
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

/** The base passive, with explicit boundaries between AP, damage type, and target-dependent scaling. */
export function signatureGuide(id: FactionId): GuideAbility {
  const f = pacedFaction(FACTIONS[id]);
  const p = f.params;
  const base = { key: "P", kind: "Passive signature" };
  switch (id) {
    case "fire": return {
      ...base, name: "Dragonslayer",
      summary: "Burn your opponent during a sustained trade. Each attack they make triggers physical retaliation.",
      scaling: `Burn: ${guideNumber(burnDps(f))} × weapon multiplier + ${guideNumber(AP_DOT_RATIO)} × AP magic damage/s. Faster enemy attacks trigger more retaliation.`,
      tags: [{ kind: "ap", label: "AP · burn" }, { kind: "target", label: "Enemy attacks · retaliation" }],
      details: [
        `Burn = ${guideNumber(burnDps(f))} × your weapon's damage multiplier + ${guideNumber(AP_DOT_RATIO)} × AP, per second. The AP part is added after the weapon multiplier.`,
        `Retaliation per enemy attack = ${guideNumber(p.backlash!)} × enemy base attack rate × enemy unbuffed weapon interval × your weapon's damage multiplier. Enemy attack-speed bonuses create more triggers without shrinking each trigger.`,
        "Burn deals magic damage; retaliation deals physical damage. AD does not directly increase either signature value.",
        `The passive needs an active trade in weapon reach and line of sight. Base reach linger is ${guideNumber(ENGAGE_LINGER_SECONDS)} s; the target is forgotten after ${guideNumber(TARGET_FORGET_SECONDS)} s without contact.`,
      ],
    };
    case "sentenced": return {
      ...base, name: "Mark",
      summary: "Landed hits build a mark that deals true damage, taxes attack speed, suppresses damage, and eventually protects you from executes.",
      scaling: "Scales with the enemy's maximum health, your Sentence stacks, and the weight of each weapon hit. AD and AP do not directly scale the mark.",
      tags: [{ kind: "target", label: "Enemy max health" }, { kind: "target", label: "Sentence stacks" }],
      details: [
        `True-damage pulse = (${pct(markPct(f, 0))} + ${pct(p.mark_kill!)} × Sentence stacks) × target max health × hit weight × tier multiplier × distance share.`,
        `Hit weight = faction base attack rate × weapon damage multiplier × attack-speed multiplier × attack interval in seconds; chill compensation preserves the pulse's time value. These percentages are per unit of hit weight, not a flat percentage on every hit.`,
        `Tier 1 starts on the first hit. Tiers 2, 3 and ${MARK_TOP_TIER} arrive at ${MARK_TIER_HITS}, ${MARK_TIER_HITS * 2} and ${MARK_TIER_HITS * 3} hit-progress respectively; the marked target's weapon swaps also promote it.`,
        `Tier 2 taxes attack rate above ${guideNumber(MARK_TAX_THRESHOLD)}/s: keep ${pct(p.tax_keep!)} of the excess, capped at ${guideNumber(p.tax_cap!)}/s. Tier 3 reduces outgoing damage by ${pct(1 - p.suppress!)}. Tier ${MARK_TOP_TIER} multiplies pulses by ${guideNumber(p.mark_amp!)} and denies the marked enemy's execute.`,
        `Beyond ${MARK_NEAR_RANGE} units, pulses use ${pct(MARK_FAR_SHARE)} strength and the attack-speed tax lifts. Your Trial ring restores full strength. Sentence stacks cap at ${MARK_KILL_STACK_CAP}.`,
        "A camp shares the mark. Each member's pulse is multiplied by 1/√(original camp size). Regional mobs use their faction's player-sized base HP as the pulse pool, rather than their smaller mob HP. Augments may add further scaling.",
      ],
    };
    case "plague": return {
      ...base, name: "Rat King",
      summary: "Wear your opponent down with disease. Below half health, they take an additional execute that grows as their health falls.",
      scaling: `Disease: ${guideNumber(plagueDps(f))} × weapon multiplier + ${guideNumber(AP_DOT_RATIO)} × AP magic damage/s. The execute grows with the enemy's missing health below ${pct(EXECUTE_BAND)}.`,
      tags: [{ kind: "ap", label: "AP · disease" }, { kind: "target", label: "Enemy low health · execute" }],
      details: [
        `Disease = ${guideNumber(plagueDps(f))} × your weapon's damage multiplier + ${guideNumber(AP_DOT_RATIO)} × AP, per second.`,
        `Extra execute damage/s = ${guideNumber(p.execute!)} × max(0, ${guideNumber(EXECUTE_BAND)} − enemy current-health fraction) × your weapon's damage multiplier. At ${pct(EXECUTE_BAND / 2)} enemy health, this adds ${guideNumber(p.execute! * EXECUTE_BAND / 2)} × weapon multiplier per second.`,
        "Disease and execute deal magic damage. AP is added once to the disease; the execute has no second AP rider. AD does not directly increase the signature.",
        `The signature requires an active trade in weapon reach and line of sight, with ${guideNumber(ENGAGE_LINGER_SECONDS)} s of base reach linger. Sentenced's final mark tier can deny the execute part.`,
      ],
    };
    case "frost": return {
      ...base, name: "Wall of Ice",
      summary: "Slow the attacks of enemies trading with you. Enemies close enough are also slowed when moving.",
      scaling: `${pct(p.slow!)} attack slow; ${pct(1 - CHILL_MOVE_MULT)} movement slow within ${CHILL_MOVE_RADIUS} units. Control strength is fixed rather than scaling with AD or AP.`,
      tags: [{ kind: "fixed", label: "Fixed control" }, { kind: "defense", label: "Durability · stay in reach" }],
      details: [
        `An engaged enemy's attack cooldown progresses at ${pct(1 - p.slow!)} of its usual pace.`,
        `Movement speed is multiplied by ${guideNumber(CHILL_MOVE_MULT)} within ${CHILL_MOVE_RADIUS} units of the Frost fighter chilling it.`,
        `Engagement uses the held weapon's reach and line of sight, with ${guideNumber(ENGAGE_LINGER_SECONDS)} s of base reach linger. One distant tag does not keep the aura running forever.`,
        "Health, armor and magic resist let you hold your ground longer; they do not increase the base slow. Your weapon still has its own damage scaling.",
      ],
    };
    case "holy": return {
      ...base, name: "Radiant",
      summary: "Heal from the damage you deal. The lower your health, the more lifesteal your faction grants.",
      scaling: `${pct(p.ls0!)}–${pct(p.ls_cap!)} faction lifesteal, increasing with your missing-health percentage. More eligible damage dealt means more healing.`,
      tags: [{ kind: "health", label: "Missing health %" }, { kind: "target", label: "Damage dealt · healing" }],
      details: [
        `Faction lifesteal = min(${pct(p.ls_cap!)}, ${pct(p.ls0!)} + ${pct(p.ls1!)} × missing-health fraction). At half health, the faction grants ${pct(Math.min(p.ls_cap!, p.ls0! + p.ls1! * .5))} lifesteal.`,
        `Faction lifesteal combines with card and mob-reward leech, up to ${pct(LIFESTEAL_MAX)} total. Anti-heal reduces healing received.`,
        "AD and AP help only through damage sources that use them. They do not directly change the lifesteal percentage. Missing health is a fraction of maximum health, not an absolute HP amount.",
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
  const cooldown = cooldownMs >= 60_000 ? `${guideNumber(cooldownMs / 60_000)} min cooldown` : `${seconds(cooldownMs)} cooldown`;
  const effects = rank.effects;
  const status = effects.find(e => e.do === "status");
  const zone = effects.find(e => e.do === "zone");
  const trail = effects.find(e => e.do === "trail");
  const floor = effects.find(e => e.do === "deathFloor");
  const scaling = id === "frost" && status?.do === "status" ? `Fixed ${seconds(status.ms)} stun · no AD/AP scaling.`
    : id === "plague" && status?.do === "status" ? `Fixed ${seconds(status.ms)} concealment · no AD/AP scaling.`
    : id === "sentenced" && zone?.do === "zone" ? `Fixed ${seconds(zone.ms)} ring: enemy deals ${pct(1 - zone.dealtMult)} less and takes ${pct(zone.takenFromCasterMult - 1)} more damage from you.`
    : id === "fire" && trail?.do === "trail" ? `Fixed ${guideNumber(trail.dps)} true damage/s on the trail · no AD/AP scaling.`
    : floor?.do === "deathFloor" ? `Fixed ${seconds(floor.ms)} death floor; heals back ${pct(floor.healBack)} of damage held.`
    : "Fixed base effect values · no AD/AP scaling.";
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
      "AD and AP do not increase this Wish's base effect values. Augments can alter cooldowns or add effects; the numbers here describe the unmodified kit.",
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
  const labels = { ad: "AD", ap: "AP", hp: "bonus max HP", def: "(bonus armor + bonus MR)" };
  const scaling = (Object.entries(weapon.scaling) as Array<[keyof typeof labels, number]>)
    .sort((a, b) => b[1] - a[1])
    .map(([stat, ratio]) => `${guideNumber(ratio)} × ${labels[stat]}`).join(" + ");
  return {
    name: weapon.name, scaling,
    detail: `Bonus damage per hit = (${scaling}) × attack-speed multiplier × attack interval in seconds. AD, bonus HP and defense scaling deal physical damage; AP scaling deals magic damage.`,
  };
}
export const GUIDE_WEAPON_IDS = ALL_WEAPON_IDS;
