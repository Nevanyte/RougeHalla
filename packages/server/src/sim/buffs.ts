// What the cards leave on a player's body (balance pass; the per-kill buffs this module was named for are gone, BALANCE_CONTRACT 3.6):
//   max hp       PlayerState.maxHp = the faction's hp x (1 + the maxHp rows); the hp gained comes with it, so a card
//                never leaves you lower on the bar (syncMaxHp, called after recomputeMods by grantCard).
//   attack speed attackSpeedMult() feeds attackInterval/damagePerHit (combatant.ts timingsOf, weapons.ts packetFor), so
//                speed past a weapon's floor becomes damage per hit by the existing rule. It is the `asMult` mirror.
//   move speed   moveSpeedMult() is a world.moveModifiers entry (step.ts multiplies them into the weapon's move factor):
//                the `speedMult` mirror.
//   the rest     damage, vs and scale rows (the ledger's outgoing multiplier), armor and shield (combatant.ts defenseOf),
//                windup (timingsOf), lifesteal, the mark rate and triggers (sim/factions.ts): see sim/mods.ts.
//   barrier      PlayerState.barrier: applyHits lets it absorb first, and it ends on time (grantBarrier, expireBoosts).
// Only players hold cards. The name is history; the file keeps these helpers where the other modules import them from.
// This module must not import weapons.ts or arena.ts (they import it). A card re-folds the mirrors at once (recomputeMods).
import { FACTIONS, isFactionId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import { asMultOf, maxHpMultOf, speedMultOf } from "./mods";
import type { BoostRuntime, PlayerRuntime, World } from "./world";

/** Multiplier on the fighter's attack speed: the decoded `asMult` mirror (1 for a mob or without cards). */
export function attackSpeedMult(s: FighterState): number {
  return asMultOf(s);
}

/** Multiplier on the fighter's walking speed: the decoded `speedMult` mirror (1 for a mob). */
export function moveSpeedMult(world: World, c: Combatant): number {
  void world;
  return c.kind === "player" ? speedMultOf(c.s) : 1;
}

/** The hp the player's faction starts with: max hp before any card. */
export function baseMaxHp(p: PlayerState): number {
  return isFactionId(p.faction) ? FACTIONS[p.faction].hp : p.maxHp;
}

/**
 * Re-derives max hp from the folded maxHp rows (sim/mods.ts; call recomputeMods first). A rise brings the same hp with
 * it; a dead player is not healed.
 */
export function syncMaxHp(p: PlayerState): void {
  const max = baseMaxHp(p) * maxHpMultOf(p);
  const delta = max - p.maxHp;
  if (Math.abs(delta) < 1e-9) return;
  p.maxHp = max;
  if (p.hp > 0) p.hp = Math.min(max, p.hp + Math.max(0, delta));
}

/** The part of `amount` a barrier does not absorb (the barrier shrinks by what it took). Called by applyHits. */
export function absorbShield(p: PlayerState, amount: number): number {
  if (!(p.barrier > 0)) return amount;
  const taken = Math.min(p.barrier, amount);
  p.barrier = p.barrier - taken < 1e-3 ? 0 : p.barrier - taken;
  return amount - taken;
}

function boostOf(rt: PlayerRuntime): BoostRuntime {
  return (rt.boost ??= { shieldUntil: 0 });
}

/** Gives a player a barrier of `hp` until `until` (server ms); the larger barrier and the later end win. For R6's skills. */
export function grantBarrier(p: PlayerState, rt: PlayerRuntime, hp: number, until: number): void {
  if (!(hp > 0) || p.status !== "alive") return;
  p.barrier = Math.max(p.barrier, hp);
  const boost = boostOf(rt);
  boost.shieldUntil = Math.max(boost.shieldUntil, until);
}

/** System: a barrier ends on time, and a player who went down keeps none (it would show on their body). */
export function expireBoosts(world: World): void {
  const now = world.state.serverTime;
  for (const [id, rt] of world.players) {
    const boost = rt.boost;
    if (!boost || !(boost.shieldUntil > 0)) continue;
    const p = world.state.players.get(id);
    if (now >= boost.shieldUntil || (p && p.status !== "alive")) {
      boost.shieldUntil = 0;
      if (p) p.barrier = 0;
    }
  }
}

export function install(world: World): void {
  world.systems.push(expireBoosts);
  world.moveModifiers.push(moveSpeedMult);
}
