// Buffs on a player (roguelike R4a, ROGUELIKE_PLAN 3.4): stacks per buff id on the synced state (PlayerState.buffs), and
// what they do in the sim. The catalog and the maths are @raid/shared buffs.ts; the rows fold in sim/mods.ts:
//   max hp       PlayerState.maxHp = the faction's hp x (1 + the maxHp rows); the hp gained comes with it, so a buff
//                never leaves you lower on the bar.
//   attack speed attackSpeedMult() feeds attackInterval/damagePerHit (combatant.ts timingsOf, weapons.ts packetFor), so
//                speed past a weapon's floor becomes damage per hit by the existing rule. It is the `asMult` mirror.
//   move speed   moveSpeedMult() is a world.moveModifiers entry (step.ts multiplies them into the weapon's move factor):
//                the `speedMult` mirror.
//   the rest     damage, vs and scale rows (the ledger's outgoing multiplier), armor and shield (combatant.ts defenseOf),
//                windup (timingsOf), lifesteal, the mark rate and triggers (sim/factions.ts).
//   bounty       half of each of a bountied victim's buffs goes to the killer (the bountyClaimed hook).
// Only players hold buffs. The kill combos (speed bursts, the kill shield, the cooldown reset) are gone (R4a). The
// barrier (PlayerState.barrier) stays for R6's skills: applyHits still lets it absorb first, and it still ends on time.
// This module must not import weapons.ts or arena.ts (they import it). A grant re-folds the mirrors at once
// (recomputeMods), so it changes the attack and the walk in the same tick.
import { bountyStacks, BUFF_IDS, FACTIONS, isFactionId, stacksIn, type BuffId } from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import { asMultOf, maxHpMultOf, recomputeMods, speedMultOf } from "./mods";
import { emit, type BoostRuntime, type PlayerRuntime, type World } from "./world";

/** The buffs a fighter holds (stacks above 0), by id, in catalog order. Empty for a mob. */
export function buffsOf(s: FighterState): Map<BuffId, number> {
  const out = new Map<BuffId, number>();
  if (!("buffs" in s)) return out;
  for (const id of BUFF_IDS) {
    const n = stacksIn(s.buffs, id);
    if (n > 0) out.set(id, n);
  }
  return out;
}

/** Multiplier on the fighter's attack speed: the decoded `asMult` mirror (1 for a mob or without buffs). */
export function attackSpeedMult(s: FighterState): number {
  return asMultOf(s);
}

/** Multiplier on the fighter's walking speed: the decoded `speedMult` mirror (1 for a mob). */
export function moveSpeedMult(world: World, c: Combatant): number {
  void world;
  return c.kind === "player" ? speedMultOf(c.s) : 1;
}

/** The hp the player's faction starts with: max hp before any buff. */
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

/**
 * Adds `amount` stacks of buff `id` to a standing player: the rows are re-folded at once (sim/mods.ts: the mirrors, the
 * sums), max hp follows, and a `buff` fx goes out. Ignored for anyone not standing or already resolved, and for an id not
 * in the catalog.
 */
export function grantBuff(world: World, p: PlayerState, rt: PlayerRuntime, id: BuffId, amount: number): void {
  if (!(amount > 0) || rt.resolved || p.status !== "alive" || !BUFF_IDS.includes(id)) return;
  const total = stacksIn(p.buffs, id) + amount;
  p.buffs.set(id, total);
  recomputeMods(world, { kind: "player", id: rt.id, s: p, rt });
  syncMaxHp(p);
  emit(world, { type: "fx", fx: { kind: "buff", id: rt.id, buff: id, stacks: amount, total } });
}

/** The part of `amount` a barrier does not absorb (the barrier shrinks by what it took). Called by applyHits. */
export function absorbShield(p: PlayerState, amount: number): number {
  if (!(p.barrier > 0)) return amount;
  const taken = Math.min(p.barrier, amount);
  p.barrier = p.barrier - taken < 1e-3 ? 0 : p.barrier - taken;
  return amount - taken;
}

/** The bountyClaimed hook: half of each of the victim's buffs goes to the killer (each grant re-folds the killer's rows). */
export function transferBuffs(world: World, killer: PlayerRuntime, victim: PlayerRuntime): void {
  const kp = world.state.players.get(killer.id);
  const vp = world.state.players.get(victim.id);
  if (!kp || !vp) return;
  for (const [id, n] of buffsOf(vp)) grantBuff(world, kp, killer, id, bountyStacks(n));
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
  const prevClaimed = world.hooks.bountyClaimed;
  world.hooks.bountyClaimed = (w, killer, victim, bounty) => {
    prevClaimed?.(w, killer, victim, bounty);
    transferBuffs(w, killer, victim);
  };
  world.systems.push(expireBoosts);
  world.moveModifiers.push(moveSpeedMult);
}
