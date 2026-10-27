// The Combatant abstraction: players and mobs fight through the same code (weapons, melee, projectiles, the ledger).
// Both carry the same fighter fields in their synced state (x, y, facing, hp, faction, weapon slots, readyAt, ...)
// and a CombatRuntime; what differs is how they go down (arena.ts for players, mobs.ts for mobs).
import {
  ELITE_K, FACTIONS, FISTS, isFactionId, isRegionalKind, isWeaponId, mirrorTimings, MOB_K, mobFaction, pacedFaction,
  type FactionId, type FactionSpec, type Vec2, type WeaponId, type WeaponTimings,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { attackSpeedMult } from "./buffs";
import { defenseBonusOf, windupMultOf } from "./mods";
import { positionAt } from "./movement";
import type { MobRuntime, PlayerRuntime, World } from "./world";

export type Combatant =
  | { kind: "player"; id: string; s: PlayerState; rt: PlayerRuntime }
  | { kind: "mob"; id: string; s: MobState; rt: MobRuntime };

/** The synced fields every fighter has. */
export type FighterState = PlayerState | MobState;

const PACED: Readonly<Record<FactionId, FactionSpec>> = Object.fromEntries(
  Object.entries(FACTIONS).map(([id, spec]) => [id, pacedFaction(spec)]),
) as Record<FactionId, FactionSpec>;

/** A regional mob fights as its region's faction scaled down (MOB_K, an elite ELITE_K), paced like any faction. */
function pacedMobs(k: number, eliteK: number): Record<"mob" | "elite", Record<FactionId, FactionSpec>> {
  const table = (elite: boolean, scale: number) =>
    Object.fromEntries(Object.keys(FACTIONS).map((id) => [id, pacedFaction(mobFaction(id as FactionId, elite, scale))])) as Record<FactionId, FactionSpec>;
  return { mob: table(false, k), elite: table(true, eliteK) };
}
let PACED_MOBS = pacedMobs(MOB_K, ELITE_K);
let scales = { mob: MOB_K, elite: ELITE_K };

/** The scale mobs of this kind are built with right now (MOB_K and ELITE_K unless a balance sweep changed them). */
export function mobScale(elite: boolean): number {
  return elite ? scales.elite : scales.mob;
}

/**
 * Balance sweeps and the mob duel harness only: from now on mobs fight (and are built, see placeMob) at these scales.
 * Call it with no arguments to go back to MOB_K and ELITE_K. The game never calls it.
 */
export function setMobScalesForHarness(k: number = MOB_K, eliteK: number = ELITE_K): void {
  scales = { mob: k, elite: eliteK };
  PACED_MOBS = pacedMobs(k, eliteK);
}

/** The faction as fought (DUEL_PACE applied, a regional mob scaled down), or null for a fighter without one (a training dummy). */
export function factionOf(s: FighterState): FactionSpec | null {
  if (!isFactionId(s.faction)) return null;
  if ("kind" in s && isRegionalKind(s.kind)) return PACED_MOBS[s.kind][s.faction];
  return PACED[s.faction];
}

/**
 * Armor and shield the damage law reads: the faction's, plus what the fighter's mods add (the armorBonus and shieldBonus
 * mirrors). A fighter without a faction (a training dummy) has neither.
 */
export function defenseOf(s: FighterState): { armor: number; shield: number } {
  const f = factionOf(s);
  if (!f) return { armor: 0, shield: 0 };
  const bonus = defenseBonusOf(s);
  return { armor: f.armor + bonus.armor, shield: f.shield + bonus.shield };
}

/**
 * The weapon a slot fights with: the item in it, or fists for an empty slot (a hand is never weaponless: a run starts with
 * both slots empty). Null only for a slot that is not 0 or 1. Use `slotItem` for what is physically in the slot.
 */
export function slotWeapon(s: FighterState, slot: number): WeaponId | null {
  if (slot !== 0 && slot !== 1) return null;
  const w = slot === 0 ? s.weapon0 : s.weapon1;
  if (w === "") return FISTS;
  return isWeaponId(w) ? w : null;
}

/** The loop weapon actually carried in a slot, or null for an empty slot. Fists are never an item (a literal "fists" counts as empty). */
export function slotItem(s: FighterState, slot: number): WeaponId | null {
  const w = slotWeapon(s, slot);
  return w === null || w === FISTS ? null : w;
}

/** The weapon in hand: fists when the hand is empty. Null only for a fighter whose slot is out of range. */
export function activeWeapon(s: FighterState): WeaponId | null {
  return slotWeapon(s, s.slot);
}

/** Nothing carried in the hand's slot: the fighter fights unarmed. */
export function handIsEmpty(s: FighterState): boolean {
  return slotItem(s, s.slot) === null;
}

export function setSlot(s: FighterState, slot: 0 | 1, w: WeaponId | null): void {
  const item = w === null || w === FISTS ? "" : w; // fists are what an empty slot fights with, never what it holds
  if (slot === 0) s.weapon0 = item;
  else s.weapon1 = item;
}

/** Rhythm of `w` in this fighter's hands (the asMult and windupMult mirrors applied; a ranged windup never under its base-speed value, G9), or null without a faction. */
export function timingsOf(s: FighterState, w: WeaponId): WeaponTimings | null {
  const f = factionOf(s);
  return f ? mirrorTimings(f, w, attackSpeedMult(s), windupMultOf(s)) : null;
}

/**
 * A regional mob walking home (sim/mobAI.ts "return") is evading: nothing hurts it, it starts nothing new (a shot already in the air still lands),
 * and it is not a body at all, so an arrow or a swing passes through it (no block, no reflect, no riposte) and it takes no signature contact.
 */
export function isEvading(c: Combatant | undefined): boolean {
  return c !== undefined && c.kind === "mob" && c.rt.brain?.mode === "return";
}

/** Still in the fight: a player alive and not yet down this tick, or a mob alive. */
export function standing(c: Combatant): boolean {
  if (c.kind === "mob") return c.s.status === "alive";
  return c.s.status === "alive" && !c.rt.down && !c.rt.resolved;
}

/**
 * May `a` attack `b`? Not itself, and mobs are allies of each other (they never hurt each other, so a player's target lock
 * and a mob's fight both skip them). Quest givers are nobody's enemy. Otherwise any two players, and a player and any
 * regional mob or dummy, are enemies.
 */
export function isQuestGiver(c: Combatant): boolean {
  return c.kind === "mob" && c.s.kind === "quest";
}

export function hostile(a: Combatant, b: Combatant): boolean {
  return a.id !== b.id && !isQuestGiver(a) && !isQuestGiver(b) && !(a.kind === "mob" && b.kind === "mob");
}

export function combatant(world: World, id: string): Combatant | null {
  const p = world.state.players.get(id);
  const prt = world.players.get(id);
  if (p && prt) return { kind: "player", id, s: p, rt: prt };
  const m = world.state.mobs.get(id);
  const mrt = world.mobs.get(id);
  if (m && mrt) return { kind: "mob", id, s: m, rt: mrt };
  return null;
}

/** Every fighter in the room, players first (in join order), then mobs. */
export function allCombatants(world: World): Combatant[] {
  const out: Combatant[] = [];
  for (const [id, s] of world.state.players) {
    const rt = world.players.get(id);
    if (rt) out.push({ kind: "player", id, s, rt });
  }
  for (const [id, s] of world.state.mobs) {
    const rt = world.mobs.get(id);
    if (rt) out.push({ kind: "mob", id, s, rt });
  }
  return out;
}

export function standingCombatants(world: World): Combatant[] {
  return allCombatants(world).filter(standing);
}

/** Where the fighter was at server time `t` (see positionAt). */
export function combatantAt(c: Combatant, t: number): Vec2 {
  return positionAt(c.rt, c.s, t);
}
