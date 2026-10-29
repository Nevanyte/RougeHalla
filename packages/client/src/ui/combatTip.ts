import {
  abilityCooldownMs, BASE_STAT_IDS, cardRows, countIn, damageShares, FACTIONS, isFactionId, ownsBase, ownedCards, rankOf,
  weaponDamageShares, WISH_COOLDOWN_MULT_MIN, WEAPONS,
  type AbilityDef, type AbilityEffect, type BaseStatId, type CardCounts, type DamageShares, type FactionSpec, type ReadableFighter, type WeaponId,
} from "@raid/shared";

const pct = (n: number): string => `${Math.round(n * 100)}%`;
const num = (n: number): string => {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};
const seconds = (ms: number): string => `${num(ms / 1000)} s`;

function effectTip(effect: AbilityEffect): string[] {
  switch (effect.do) {
    case "status": {
      const labels: Readonly<Record<string, string>> = {
        stun: "Stun", root: "Root", silence: "Silence", slowMove: "Move slow", slowAttack: "Attack slow",
        antiHeal: "Anti-heal", dot: "Damage over time", invulnerable: "Invulnerable", untargetable: "Untargetable",
        hidden: "Hidden", zoned: "Zone", deathFloor: "Death floor", haste: "Move speed bonus",
      };
      const value = effect.value === undefined ? "" : ` (${pct(effect.value)})`;
      return [`${labels[effect.status] ?? effect.status}: ${seconds(effect.ms)}${value}`];
    }
    case "cleanse": return [`Cleanses: ${effect.classes.join(", ")}`];
    case "deathFloor": return [`Death floor: ${effect.floorHp} HP for ${seconds(effect.ms)}`, `Heal back ${pct(effect.healBack)} of damage held`];
    case "zone": return [
      `Zone lasts ${seconds(effect.ms)} · radius ${effect.radius} u`,
      `Target deals ${pct(effect.dealtMult)} damage, moves at ${pct(effect.moveMult)} speed, and takes ${pct(effect.takenFromCasterMult)} from you`,
      `Leaving stuns for ${seconds(effect.exitStunMs)}`,
    ];
    case "cloud": return [`Cloud lasts ${seconds(effect.ms)} · radius ${effect.radius} u`];
    case "blink": return [`Blink distance: ${effect.minDist}–${effect.maxDist} u`];
    case "trail": return [`Trail: ${num(effect.dps)} true damage/s for ${seconds(effect.ms)}`, `Burn lingers ${seconds(effect.dotMs)} · width ${effect.halfWidth * 2} u`];
    default: {
      const exhaustive: never = effect;
      void exhaustive;
      return [];
    }
  }
}

/** Full, rank-specific ability details for click-through HUD hover tooltips. */
export function abilityTip(
  def: AbilityDef, rank = 1, cooldownMs?: number, context: { training?: boolean; wishCooldownMult?: number } = {},
): string {
  const r = rankOf(def, rank);
  const lines = [def.name, def.blurb];
  const target = r.targeting;
  if (target.kind === "unit") lines.push(`Target range: ${target.range} u`);
  else if (target.kind === "point") lines.push(target.minRange > 0
    ? `Reach: ${target.minRange}–${target.range} u`
    : `Reach: up to ${target.range} u`);
  else if (target.kind === "dir") lines.push("Aim: direction");
  if (r.shape.kind === "circle") lines.push(`Area radius: ${r.shape.radius} u`);
  else if (r.shape.kind === "line") lines.push(`Line: ${r.shape.length} × ${r.shape.width} u`);
  else if (r.shape.kind === "cone") lines.push(`Cone radius: ${r.shape.radius} u`);
  if (r.castMs > 0) lines.push(`Cast: ${seconds(r.castMs)}`);
  for (const effect of r.effects) lines.push(...effectTip(effect));
  const cooldown = cooldownMs ?? abilityCooldownMs(def, rank, context);
  lines.push(`Cooldown: ${cooldown >= 60_000 ? `${num(cooldown / 60_000)} min` : `${num(cooldown / 1000)} s`}`);
  return lines.join("\n");
}

/** The live Wish cooldown multiplier from the fighter's owned cards, matching the server's folded mult rows. */
export function wishCooldownMultiplier(build: CardCounts | null | undefined, faction: string): number {
  let mult = 1;
  const owns = (id: string): boolean => BASE_STAT_IDS.includes(id as BaseStatId)
    ? ownsBase(build, id as BaseStatId)
    : countIn(build, id) > 0;
  for (const { def, count } of ownedCards(build)) {
    for (const row of cardRows(def.id, faction)) {
      if (row.k !== "mult" || row.key !== "wishCooldown" || row.requires?.some((id) => !owns(id))) continue;
      mult *= row.v ** count;
    }
  }
  return Math.max(WISH_COOLDOWN_MULT_MIN, mult);
}

export function damageProfileText(faction: string): string {
  if (!isFactionId(faction)) return "Damage type unknown";
  return `Damage: ${shareParts(damageShares(FACTIONS[faction])).join(" · ")}`;
}

function shareParts(shares: DamageShares): string[] {
  return [
    shares.phys > 0 ? `${pct(shares.phys)} physical` : "",
    shares.magic > 0 ? `${pct(shares.magic)} magic` : "",
    shares.true > 0 ? `${pct(shares.true)} true` : "",
  ].filter(Boolean);
}

/** Effective current type mix from public Offense/SO and other weapon-scaling mirrors. */
export function weaponDamageTypeText(fighter: ReadableFighter, weapon: WeaponId): string {
  if (!isFactionId(fighter.faction)) return "Damage type unknown";
  return `Current hit type: ${shareParts(weaponDamageShares(fighter, weapon)).join(" · ")}`;
}

export function weaponTip(weapon: WeaponId, fighterOrFaction: ReadableFighter | string): string {
  const w = WEAPONS[weapon];
  const shape = w.shape.kind === "arc"
    ? `Melee arc: ${w.shape.reach} u`
    : `${w.shape.projectile === "arrow" ? "Arrow" : "Ball"}: ${w.shape.range} attack range · ${w.shape.speed} speed; locked shots home for up to 5 s`;
  const damage = typeof fighterOrFaction === "string"
    ? damageProfileText(fighterOrFaction)
    : weaponDamageTypeText(fighterOrFaction, weapon);
  return [`${w.name} · ${w.shape.kind === "arc" ? "melee" : "ranged"}`, shape, damage].join("\n");
}

export function factionCombatTip(faction: string): string {
  if (!isFactionId(faction)) return "Damage type unknown";
  const f: FactionSpec = FACTIONS[faction];
  return `${f.displayName}\n${damageProfileText(faction)}`;
}
