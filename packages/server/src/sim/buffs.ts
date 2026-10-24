// Buffs on a player (GAME_DESIGN 12.2): stacks per stat on the synced state, the bonuses they give, and the combos a
// kill sets off. The maths is in @raid/shared buffs.ts; this applies it to the sim:
//   hp           PlayerState.maxHp = the faction's hp x the stacks' multiplier; the hp gained comes with it, so a buff
//                never leaves you lower on the bar.
//   attack speed attackSpeedMult() feeds attackInterval/damagePerHit (combatant.ts timingsOf, weapons.ts packetFor), so
//                speed past a weapon's floor becomes damage per hit by the existing rule.
//   move speed   moveSpeedMult() feeds moveMultiplierOf (weapons.ts): the stacks' bonus times the strongest running burst.
//   kill combos  onKill() runs after every kill (a player's, a mob's): speed bursts, the absorb shield, a cooldown reset.
//   bounty       half of a bountied victim's stacks go to the killer (the bountyClaimed hook).
// Only players hold stacks; a mob's multipliers are 1. This module must not import weapons.ts or arena.ts (they import it).
import {
  activeCombos, bountyStacks, BUFF_STATS, buffMultiplier, comboFor, comboTier, FACTIONS, isFactionId, killEffects,
  zeroStacks, type BuffStat, type Stacks,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import type { Combatant, FighterState } from "./combatant";
import { emit, type BoostRuntime, type PlayerRuntime, type World } from "./world";

const STAT_FIELD = { hp: "stacksHp", attackSpeed: "stacksAs", moveSpeed: "stacksMs" } as const;

export function stacksOf(s: FighterState): Stacks {
  return "stacksHp" in s ? { hp: s.stacksHp, attackSpeed: s.stacksAs, moveSpeed: s.stacksMs } : zeroStacks();
}

/** Multiplier on the fighter's attack speed (1 for a mob or without stacks). */
export function attackSpeedMult(s: FighterState): number {
  return "stacksAs" in s ? buffMultiplier("attackSpeed", s.stacksAs) : 1;
}

/** Multiplier on the fighter's walking speed: the move-speed stacks times the strongest burst still running. */
export function moveSpeedMult(world: World, c: Combatant): number {
  if (c.kind !== "player") return 1;
  let m = buffMultiplier("moveSpeed", c.s.stacksMs);
  const bursts = c.rt.boost?.bursts;
  if (bursts && bursts.length > 0) {
    const now = world.state.serverTime;
    let best = 1;
    for (const b of bursts) if (now < b.until && b.mult > best) best = b.mult;
    m *= best;
  }
  return m;
}

/** The hp the player's faction starts with: max hp before any hp stacks. */
export function baseMaxHp(p: PlayerState): number {
  return isFactionId(p.faction) ? FACTIONS[p.faction].hp : p.maxHp;
}

/** Re-derives max hp from the hp stacks. A rise brings the same hp with it; a dead player is not healed. */
export function syncMaxHp(p: PlayerState): void {
  const max = baseMaxHp(p) * buffMultiplier("hp", p.stacksHp);
  const delta = max - p.maxHp;
  if (Math.abs(delta) < 1e-9) return;
  p.maxHp = max;
  if (p.hp > 0) p.hp = Math.min(max, p.hp + Math.max(0, delta));
}

function boostOf(rt: PlayerRuntime): BoostRuntime {
  return (rt.boost ??= { bursts: [], shieldUntil: 0 });
}

/**
 * Adds `amount` stacks of `stat` to a standing player: max hp follows for hp stacks, a `buff` fx goes out, and crossing
 * a combo threshold sends a `combo` fx. Ignored for anyone not standing or already resolved.
 */
export function grantStacks(world: World, p: PlayerState, rt: PlayerRuntime, stat: BuffStat, amount: number): void {
  if (!(amount > 0) || rt.resolved || p.status !== "alive") return;
  const field = STAT_FIELD[stat];
  const before = p[field];
  const total = before + amount;
  p[field] = total;
  if (stat === "hp") syncMaxHp(p);
  emit(world, { type: "fx", fx: { kind: "buff", id: rt.id, stat, stacks: amount, total } });
  if (comboTier(total) > comboTier(before)) {
    const combo = comboFor(stat, total);
    if (combo) emit(world, { type: "fx", fx: { kind: "combo", id: rt.id, combo: combo.id, proc: false } });
  }
}

/** A kill by this player (a player's or a mob's): whatever their combos do on a kill. */
export function onKill(world: World, p: PlayerState, rt: PlayerRuntime): void {
  if (rt.resolved || p.status !== "alive") return;
  const stacks = stacksOf(p);
  const combos = activeCombos(stacks);
  if (combos.length === 0) return;
  const fx = killEffects(stacks);
  const now = world.state.serverTime;
  const boost = boostOf(rt);
  for (const b of fx.bursts) boost.bursts.push({ mult: b.mult, until: now + b.ms });
  if (fx.shield) {
    p.barrier = Math.max(p.barrier, fx.shield.share * p.maxHp);
    boost.shieldUntil = Math.max(boost.shieldUntil, now + fx.shield.ms);
  }
  if (fx.resetCooldown) {
    p.readyAt = Math.min(p.readyAt, now);
    // A ranged shooter's half speed lasts until the cooldown ends, so a reset ends it too.
    rt.weapon.recoverUntil = Math.min(rt.weapon.recoverUntil, now);
  }
  for (const c of combos) emit(world, { type: "fx", fx: { kind: "combo", id: rt.id, combo: c.id, proc: true } });
}

/** The part of `amount` a kill shield does not absorb (the shield shrinks by what it took). Called by applyHits. */
export function absorbShield(p: PlayerState, amount: number): number {
  if (!(p.barrier > 0)) return amount;
  const taken = Math.min(p.barrier, amount);
  p.barrier = p.barrier - taken < 1e-3 ? 0 : p.barrier - taken;
  return amount - taken;
}

/** The bountyClaimed hook: half of the victim's stacks, stat by stat, go to the killer. */
export function transferStacks(world: World, killer: PlayerRuntime, victim: PlayerRuntime): void {
  const kp = world.state.players.get(killer.id);
  const vp = world.state.players.get(victim.id);
  if (!kp || !vp) return;
  const held = stacksOf(vp);
  for (const stat of BUFF_STATS) grantStacks(world, kp, killer, stat, bountyStacks(held[stat]));
}

/** System: bursts and the kill shield end on time. */
export function expireBoosts(world: World): void {
  const now = world.state.serverTime;
  for (const [id, rt] of world.players) {
    const boost = rt.boost;
    if (!boost) continue;
    if (boost.bursts.length > 0) boost.bursts = boost.bursts.filter((b) => now < b.until);
    if (boost.shieldUntil > 0) {
      const p = world.state.players.get(id);
      // A player who went down keeps no shield: it would show on their body for up to 8 s.
      if (now >= boost.shieldUntil || (p && p.status !== "alive")) {
        boost.shieldUntil = 0;
        if (p) p.barrier = 0;
      }
    }
  }
}

export function install(world: World): void {
  const prevClaimed = world.hooks.bountyClaimed;
  world.hooks.bountyClaimed = (w, killer, victim, bounty) => {
    prevClaimed?.(w, killer, victim, bounty);
    transferStacks(w, killer, victim);
  };
  const prevKilled = world.hooks.playerKilled;
  world.hooks.playerKilled = (w, killer) => {
    prevKilled?.(w, killer);
    const p = w.state.players.get(killer.id);
    if (p) onKill(w, p, killer);
  };
  world.systems.push(expireBoosts);
}
