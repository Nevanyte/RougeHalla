// The Combatant abstraction: players and mobs fight through the same code (weapons, melee, projectiles, the ledger).
// Both carry the same fighter fields in their synced state (x, y, facing, hp, faction, weapon slots, readyAt, ...)
// and a CombatRuntime; what differs is how they go down (arena.ts for players, mobs.ts for mobs).
import {
  attackInterval, FACTIONS, isFactionId, isWeaponId, pacedFaction, weaponTimings, type FactionId, type FactionSpec,
  type Vec2, type WeaponId, type WeaponTimings,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
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

/** The faction as fought (DUEL_PACE applied), or null for a fighter without one (a training dummy). */
export function factionOf(s: FighterState): FactionSpec | null {
  return isFactionId(s.faction) ? PACED[s.faction] : null;
}

/** Armor and shield the damage law reads; a fighter without a faction has neither. */
export function defenseOf(s: FighterState): { armor: number; shield: number } {
  const f = factionOf(s);
  return f ? { armor: f.armor, shield: f.shield } : { armor: 0, shield: 0 };
}

export function slotWeapon(s: FighterState, slot: number): WeaponId | null {
  const w = slot === 0 ? s.weapon0 : slot === 1 ? s.weapon1 : "";
  return isWeaponId(w) ? w : null;
}

/** The weapon in hand, or null (an empty slot, or a fighter with no weapons). */
export function activeWeapon(s: FighterState): WeaponId | null {
  return slotWeapon(s, s.slot);
}

export function setSlot(s: FighterState, slot: 0 | 1, w: WeaponId | null): void {
  if (slot === 0) s.weapon0 = w ?? "";
  else s.weapon1 = w ?? "";
}

/** Rhythm of `w` in this fighter's hands (attack-speed buffs arrive in Phase 11), or null without a faction. */
export function timingsOf(s: FighterState, w: WeaponId): WeaponTimings | null {
  const f = factionOf(s);
  return f ? weaponTimings(w, attackInterval(f, w)) : null;
}

/** Still in the fight: a player alive and not yet down this tick, or a mob alive. */
export function standing(c: Combatant): boolean {
  if (c.kind === "mob") return c.s.status === "alive";
  return c.s.status === "alive" && !c.rt.down && !c.rt.resolved;
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
