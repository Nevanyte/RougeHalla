// What the phase-B cards remember and decide, as small pure-ish helpers the combat files call (balance pass, BALANCE_CONTRACT 4.6,
// agent A4). A leaf: it imports only shared, sim/mods.ts and the world types, so the weapon phase, the ledger and the signature
// code can all use it without a cycle. The machinery that WRITES most of this memory (the systems, the hooks on a hit, a block or a
// kill) is sim/cardHooks.ts; the on-hit effects are sim/onHit.ts.
//
// Every roll here is deterministic and order-free:
//   crit        a per-player accumulator (G12): each attack adds the crit chance and crits on reaching 1, so a chance of 1/3 crits every
//               third attack and a chance of 0.2 every fifth. It reads and writes only that player's own memory, in the weapon phase
//               (an attack landing) or once a tick for its damage over time.
//   Gambler     a hash of the world's secret salt, the tick, the attacker, the victim and the entry's place among that pair's entries:
//               the same fight rolls the same whatever order fighters, entries or victims were handled in.
//   streaks     the memory is the pass-start state (it is only written by a system after the ledger pass), so every entry of a pass
//               reads the same count.
import {
  CRIT_EPSILON, GAMBLER_CHANCE, GAMBLER_DOWN, GAMBLER_UP, PLANT_FEET_MS, STREAK_GAP_SECONDS,
} from "@raid/shared";
import type { Combatant } from "./combatant";
import { critChanceOf, hasFlag } from "./mods";
import { saltedUnit, type CardRuntime, type LedgerEntry, type PlayerRuntime, type World } from "./world";

/** A player's card memory, created on first use. */
export function cardsOf(rt: PlayerRuntime): CardRuntime {
  return (rt.cards ??= {
    critAcc: 0, critAccDot: 0, dotRollTick: -1, dotCrit: false, streak: null, stillX: NaN, stillY: NaN, stillSince: 0,
    prevented: 0, tankHp: 0, boostUntil: 0, boostAs: 1, boostMove: 1, wishCast: null, trims: [],
  });
}

// ------------------------------------------------------------------------------------------------------------------------ crit

/** Adds the chance to an accumulator; true when it reaches 1 (and takes the 1 off). */
function accumulate(acc: number, chance: number): { acc: number; crit: boolean } {
  const next = acc + chance;
  return next >= 1 - CRIT_EPSILON ? { acc: next - 1, crit: true } : { acc: next, crit: false };
}

/**
 * One weapon attack landing: does it critically strike? A player's accumulator takes its crit chance (critChanceOf: the `critChance`
 * rows, held to CRIT_CHANCE_MAX, none under Thick Skull) and fires at 1. A mob and a player with no chance never crit (and move nothing).
 */
export function rollAttackCrit(c: Combatant): boolean {
  if (c.kind !== "player") return false;
  const chance = critChanceOf(c.s);
  if (!(chance > 0)) return false;
  const cards = cardsOf(c.rt);
  const r = accumulate(cards.critAcc, chance);
  cards.critAcc = r.acc;
  return r.crit;
}

/**
 * Does this tick's damage over time of `c` critically strike? Only with the `dotCrit` flag (Cruel Wounds). One roll per player per
 * tick, taken the first time the tick asks, shared by every damage-over-time entry the player records that tick (a signature, its AP
 * twin, a bleed...), so which entry comes first changes nothing.
 */
export function rollDotCrit(world: World, c: Combatant): boolean {
  if (c.kind !== "player" || !hasFlag(c.s, "dotCrit")) return false;
  const chance = critChanceOf(c.s);
  if (!(chance > 0)) return false;
  const cards = cardsOf(c.rt);
  const tick = world.state.tick;
  if (cards.dotRollTick === tick) return cards.dotCrit;
  const r = accumulate(cards.critAccDot, chance);
  cards.critAccDot = r.acc;
  cards.dotRollTick = tick;
  cards.dotCrit = r.crit;
  return r.crit;
}

// ----------------------------------------------------------------------------------------------------------------------- streaks

/**
 * The hits `attackerId` has landed in a row on `victimId` before this tick's pass: 0 for a victim that is not the streak's target,
 * for no streak, and for one whose last hit was STREAK_GAP_SECONDS ago or more. Reads the memory as the pass began (written only after it).
 */
export function streakBefore(world: World, attackerId: string, victimId: string): number {
  const s = world.players.get(attackerId)?.cards?.streak;
  if (!s || s.target !== victimId) return 0;
  return world.state.serverTime - s.last >= STREAK_GAP_SECONDS * 1000 ? 0 : s.count;
}

// -------------------------------------------------------------------------------------------------------------------- Plant Your Feet

/** Has the player stood still long enough for Plant Your Feet to arm its next attack? (The flag, and PLANT_FEET_MS since it was last seen moving.) */
export function plantArmed(world: World, c: Combatant): boolean {
  if (c.kind !== "player" || !hasFlag(c.s, "plantFeet")) return false;
  const cards = c.rt.cards;
  return !!cards && world.state.serverTime - cards.stillSince >= PLANT_FEET_MS;
}

/** The armed attack was spent: the player has to stand still for PLANT_FEET_MS again. */
export function spendPlant(world: World, c: Combatant): void {
  if (c.kind === "player") cardsOf(c.rt).stillSince = world.state.serverTime;
}

// ---------------------------------------------------------------------------------------------------------------------- Gambler

/**
 * Gambler's factor for one ledger entry: GAMBLER_UP with chance GAMBLER_CHANCE, GAMBLER_DOWN with the same chance, else 1. A hash of
 * the secret salt, the tick, the attacker, the victim and `index` (the entry's place among the entries of this attacker on this
 * victim in the ledger), so no processing order changes it.
 */
export function gamblerFactor(world: World, e: Pick<LedgerEntry, "by" | "victim">, index: number): number {
  const roll = saltedUnit(world, world.state.tick, e.by.id, e.victim, index);
  return roll < GAMBLER_CHANCE ? GAMBLER_UP : roll < 2 * GAMBLER_CHANCE ? GAMBLER_DOWN : 1;
}
