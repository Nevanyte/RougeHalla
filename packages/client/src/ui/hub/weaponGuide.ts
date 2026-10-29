import {
  ARROW_REFLECT_SHARE, BALL_AFTER_ARROW, FACTIONS, RIPOSTE_SHARE, SHIELD_BLOCK_SHARE, SWORD_BALL_SCALE, WEAPON_BEATS, WEAPONS,
  attackInterval, damagePerHit, damageShares, pacedFaction, scalingDamage,
  type FactionId, type ScalingStats, type WeaponId,
} from "@raid/shared";
import { guideNumber, weaponScalingGuide } from "./championGuide";

export const COMBAT_GUIDE_RULES = [
  "Champion = passive + Wish + base attack damage. Weapon = reach + attack rhythm + stat scaling + counter mechanics.",
  "AD and AP are scaling stats, not damage types. Your champion sets the base attack's type; AD adds physical damage and AP adds magic damage only where a coefficient exists.",
  "Armor reduces physical damage. Magic resist reduces magic damage. True damage ignores both. A counter is an advantage, not a guaranteed win or a hidden damage bonus.",
];

const ROLES: Record<WeaponId, { role: string; build: string; play: string }> = {
  sword: { role: "Fast melee · interrupts", build: "AD + on-hit effects", play: "Stay close and time your swings to interrupt slower attacks. Approach archers through cover; avoid a shield's front." },
  bow: { role: "Long range · kiting", build: "AD + attack speed", play: "Attack, move after the arrow leaves, then attack again. Keep melee fighters at range; watch for wand balls and shields." },
  wand: { role: "Ranged splash · anti-arrow", build: "AP first · AD secondary", play: "Send balls through incoming arrows and clustered enemies. A shield does not stop balls; sword and axe swings can intercept them." },
  shield: { role: "Frontal defense · retaliation", build: "Armor/MR first · AP secondary", play: "Aim toward incoming sword hits and arrows. Your front matters: axe, fists and wand bypass the weapon's block mechanics." },
  axe: { role: "Heavy melee · armor shred", build: "AD first · bonus health secondary", play: "Close the gap, cut through shield blocking and intercept wand balls. Armor shred helps physical damage; archers can keep you at range." },
  fists: { role: "Empty hand · fast, short reach", build: "AD or AP · find a weapon", play: "Fists bypass shield blocking and carry strong on-hit effects, but have the shortest reach and reduced base damage. They sit outside the counter wheel." },
};

export function weaponMechanics(id: WeaponId): string[] {
  const w = WEAPONS[id];
  switch (id) {
    case "sword": return [
      "Unblocked hits stagger: cancel a windup or cast, with a short immunity between staggers. Bow draws resist stagger.",
      `A swing that meets a wand ball cuts its damage to ${guideNumber(SWORD_BALL_SCALE * 100)}%, once per ball.`,
      `On-hit effects have ${guideNumber(w.onHitPower)}× strength.`,
    ];
    case "bow": return ["Longest weapon attack range. Unit-targeted arrows follow their target after launch; directional shots fly straight.", "Move freely after launch. Moving before launch cancels a unit-targeted windup."];
    case "wand": {
      const s = w.special!;
      return [`Balls delete enemy arrows they meet, keeping ${guideNumber(BALL_AFTER_ARROW * 100)}% of their current damage after each interception. Balls pass through shield blocking.`, ...(s.kind === "splash" ? [`Impact splashes ${guideNumber(s.share * 100)}% damage to other enemies within ${s.radius} units.`] : [])];
    }
    case "shield": return [
      `From the front, prevent ${guideNumber(SHIELD_BLOCK_SHARE * 100)}% of sword/bash damage. A blocked sword hit cannot stagger; return ${guideNumber(SHIELD_BLOCK_SHARE * RIPOSTE_SHARE * 100)}% of its original damage before modifiers.`,
      `A frontal arrow reflects ${guideNumber(ARROW_REFLECT_SHARE * 100)}% of its damage; you still take the other ${guideNumber((1 - ARROW_REFLECT_SHARE) * 100)}%.`,
      "Axe, fists and wand bypass blocking, not your armor or magic resist. The shield is not invulnerability.",
    ];
    case "axe": {
      const s = w.special!;
      return ["Swings destroy wand balls they meet and bypass shield blocking.", ...(s.kind === "shred" ? [`Each hit removes ${s.armor} armor for ${s.ms / 1000} seconds, up to ${s.cap} total. Shred improves physical damage, not magic damage.`] : []), "You can move as soon as the swing lands; there is no extra recovery root."];
    }
    case "fists": return [`No item equipped. On-hit effects have ${guideNumber(w.onHitPower)}× strength.`, "Bypass shield blocking; no stagger, ball interception or counter-wheel advantage."];
  }
}

export function weaponGuide(id: WeaponId) {
  const w = WEAPONS[id];
  const labels = { ad: "AD", ap: "AP", hp: "bonus max HP", def: "combined bonus armor + MR" };
  const gains = (Object.entries(w.scaling) as Array<[keyof typeof labels, number]>).sort((a, b) => b[1] - a[1]).map(([stat, coefficient]) => {
    const amount = stat === "hp" ? 100 : 10;
    return `+${amount} ${labels[stat]} → +${guideNumber(amount * coefficient)} ${stat === "ap" ? "magic" : "physical"} damage/s`;
  });
  return {
    id, ...weaponScalingGuide(id), ...ROLES[id], gains, mechanics: weaponMechanics(id),
    range: w.shape.kind === "arc" ? `${w.shape.reach} units · melee reach (+ target body)` : `${w.shape.range} units · attack range`,
    beats: WEAPON_BEATS.filter(([winner]) => winner === id).map(([, loser]) => loser),
    losesTo: WEAPON_BEATS.filter(([, loser]) => loser === id).map(([winner]) => winner),
  };
}

/** Unmodified weapon packet, before passives, mitigation, crits, augments or PvP multipliers. */
export function weaponAttackExample(faction: FactionId, weapon: WeaponId, stats: ScalingStats, asMult = 1) {
  const f = pacedFaction(FACTIONS[faction]);
  const interval = attackInterval(f, weapon, asMult);
  const base = damagePerHit(f, weapon, asMult);
  const share = damageShares(f);
  const added = scalingDamage(weapon, stats, asMult, interval);
  const phys = base * share.phys + added.phys;
  const magic = base * share.magic + added.magic;
  return { interval, attacksPerSecond: 1 / interval, phys, magic, true: base * share.true, total: phys + magic + base * share.true };
}

export interface ChampionBuildExample { weapon: WeaponId; name: string; stats: string; why: string; caution: string }
export const CHAMPION_BUILDS: Record<FactionId, readonly [ChampionBuildExample, ChampionBuildExample]> = {
  fire: [
    { weapon: "wand", name: "Burn caster", stats: "AP + health", why: "AP grows both wand hits and your burn. Ranged trades let you apply burn without standing in melee.", caution: "AP does not scale physical retaliation or Blaze's fixed true damage." },
    { weapon: "axe", name: "Durable duelist", stats: "AD + bonus health", why: "AD and bonus health grow axe hits. Armor shred can also help your physical retaliation; extra durability keeps you trading.", caution: "The burn remains magic damage; armor shred does not strengthen it." },
  ],
  sentenced: [
    { weapon: "sword", name: "Close-range judge", stats: "Attack speed + AD + durability", why: "Fast landed hits advance mark tiers sooner. Stay close for full mark strength; AD grows the weapon hit.", caution: "AD does not grow the true-damage mark, and its pulse is weighted per weapon hit." },
    { weapon: "bow", name: "Patient pursuer", stats: "AD + attack speed", why: "Range helps keep hits landing and build mark tiers while repositioning. Trial can hold an enemy for a sustained trade.", caution: "At long range the mark is weaker unless the enemy is inside your Trial ring. AP does not scale the mark." },
  ],
  plague: [
    { weapon: "wand", name: "Disease caster", stats: "AP + health", why: "AP grows wand hits and adds to disease. Splash helps when enemies group together.", caution: "The execute grows as the enemy falls below half health; it has no second AP rider." },
    { weapon: "bow", name: "Attrition archer", stats: "AD + mobility + durability", why: "AD grows arrows. Range helps maintain the ongoing trade needed for disease and execute.", caution: "AD does not directly grow disease; leaving reach or losing contact ends the passive trade." },
  ],
  frost: [
    { weapon: "shield", name: "Control wall", stats: "Armor + MR + health", why: "Bonus armor and MR grow bash damage while durability helps you keep enemies in your control range.", caution: "The slow is fixed; defense and AP do not increase it. Face incoming hits to block." },
    { weapon: "axe", name: "Chasing bruiser", stats: "AD + bonus health", why: "Both stats grow axe hits. Close-range movement slow helps you stay beside an enemy while you shred armor.", caution: "You still need to close the gap; the movement slow has a much shorter radius than ranged attacks." },
  ],
  holy: [
    { weapon: "sword", name: "Sustain duelist", stats: "AD + attack speed + health", why: "Weapon damage feeds Radiant's healing. Fast attacks and strong on-hit effects suit continuous close trades.", caution: "Damage stats improve healing through eligible damage dealt, not by increasing the lifesteal percentage." },
    { weapon: "wand", name: "Ranged sustain", stats: "AP + health", why: "AP grows wand damage, which can feed your lifesteal. Splash offers value against grouped enemies.", caution: "AP does not scale the lifesteal percentage or Last Stand's base effects. Enemy MR and anti-heal reduce the payoff." },
  ],
};
