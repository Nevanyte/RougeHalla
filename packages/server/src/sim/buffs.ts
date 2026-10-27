// What the cards leave on a player's body (balance pass; the per-kill buffs this module was named for are gone, BALANCE_CONTRACT 3.6):
//   max hp       PlayerState.maxHp = the faction's hp x (1 + the maxHp rows); the hp gained comes with it, so a card
//                never leaves you lower on the bar (syncMaxHp, called after recomputeMods by grantCard).
//   attack speed attackSpeedMult() feeds attackInterval/damagePerHit (combatant.ts timingsOf, weapons.ts packetFor), so
//                speed past a weapon's floor becomes damage per hit by the existing rule. It is the `asMult` mirror.
//   move speed   moveSpeedMult() is a world.moveModifiers entry (step.ts multiplies them into the weapon's move factor):
//                the `speedMult` mirror.
//   the rest     damage, vs and scale rows (the ledger's outgoing multiplier), armor and shield (combatant.ts defenseOf),
//                windup (timingsOf), lifesteal, the mark rate and triggers (sim/factions.ts): see sim/mods.ts.
//   barrier      PlayerState.barrier: applyHits lets it absorb first, and it ends on time (grantBarrier, expireBoosts). G6 holds every barrier to
//                BARRIER_MAX_SHARE of max hp; one a heal made (Second Skin, grantHealBarrier) also decays BARRIER_DECAY_SHARE_PER_SECOND of max hp a second.
// Only players hold cards. The name is history; the file keeps these helpers where the other modules import them from.
// This module must not import weapons.ts or arena.ts (they import it). A card re-folds the mirrors at once (recomputeMods).
import { BARRIER_DECAY_SHARE_PER_SECOND, BARRIER_MAX_SHARE, clampBarrier, decayBarrier, FACTIONS, isFactionId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import { asMultOf, flatMaxHpOf, maxHpMultOf, speedMultOf } from "./mods";
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
  // The faction's hp times the rows' multiplier, plus what Tank Engine has earned outright (G8: at most TANK_ENGINE_CAP).
  const max = baseMaxHp(p) * maxHpMultOf(p) + flatMaxHpOf(p);
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

/** How long a full Second Skin barrier lasts: the cap over the decay (5 s). */
const HEAL_BARRIER_LIFE_MS = (BARRIER_MAX_SHARE / BARRIER_DECAY_SHARE_PER_SECOND) * 1000;

/** Gives a player a barrier of `hp` until `until` (server ms); the larger barrier and the later end win, never past G6's cap. For R6's skills. */
export function grantBarrier(p: PlayerState, rt: PlayerRuntime, hp: number, until: number): void {
  if (!(hp > 0) || p.status !== "alive") return;
  p.barrier = clampBarrier(Math.max(p.barrier, hp), p.maxHp);
  const boost = boostOf(rt);
  boost.shieldUntil = Math.max(boost.shieldUntil, until);
}

/**
 * Second Skin (G6): `hp` more barrier, added to what the player holds and held to BARRIER_MAX_SHARE of max hp. It decays from here on
 * (expireBoosts) and is gone after at most HEAL_BARRIER_LIFE_MS without another heal.
 */
export function grantHealBarrier(p: PlayerState, rt: PlayerRuntime, hp: number, now: number): void {
  if (!(hp > 0) || p.status !== "alive") return;
  p.barrier = clampBarrier(p.barrier + hp, p.maxHp);
  const boost = boostOf(rt);
  boost.decays = true;
  boost.shieldUntil = Math.max(boost.shieldUntil, now + HEAL_BARRIER_LIFE_MS);
}

/**
 * System: a barrier ends on time, and a player who went down keeps none (it would show on their body). A barrier a heal made
 * (`decays`) also loses BARRIER_DECAY_SHARE_PER_SECOND of max hp for every second it stands (`dtMs` is the step; none when called outside the tick).
 */
export function expireBoosts(world: World, dtMs = 0): void {
  const now = world.state.serverTime;
  for (const [id, rt] of world.players) {
    const boost = rt.boost;
    if (!boost || !(boost.shieldUntil > 0)) continue;
    const p = world.state.players.get(id);
    if (now >= boost.shieldUntil || (p && p.status !== "alive") || (boost.decays === true && p && !(p.barrier > 0))) {
      boost.shieldUntil = 0;
      boost.decays = false;
      if (p) p.barrier = 0;
    } else if (boost.decays === true && p && dtMs > 0) {
      p.barrier = decayBarrier(p.barrier, p.maxHp, dtMs / 1000);
    }
  }
}

export function install(world: World): void {
  world.systems.push(expireBoosts);
  world.moveModifiers.push(moveSpeedMult);
}
