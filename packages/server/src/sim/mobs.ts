// Mobs: neutral fighters in state.mobs that fight through the same combat code as players (sim/combatant.ts). Phase 9
// has only training dummies: no AI, no faction (so no armor or shield), never die, and heal back to full
// DUMMY_RESET_SECONDS after the last hit. With SimConfig.dummies the run starts with a training setup next to every
// player's spawn (spawnTraining). Phase 11 adds regional mobs (AI, drops, GV) here.
import { DUMMY_HP, DUMMY_RESET_SECONDS, type Vec2, type WeaponId } from "@raid/shared";
import { MobState } from "@raid/shared/schema";
import type { Combatant } from "./combatant";
import { InputQueue } from "./inputs";
import { chainHook, newWeaponRuntime, nextId, type World } from "./world";

export interface MobSpec {
  /** A training dummy, or a regional mob / elite (sim/mobLife.ts). */
  kind: "dummy" | "mob" | "elite";
  name: string;
  /** A FactionId (a regional mob's region); omitted for a dummy, which has none. */
  faction?: string;
  at: Vec2;
  /** Where it faces (a shield dummy blocks from that side). */
  facing?: number;
  hp?: number;
  /** In hand; a dummy never attacks, but a shield in hand still blocks and reflects. */
  weapon?: WeaponId;
}

/** Adds a mob to the state and its runtime; returns its id. */
export function addMob(world: World, spec: MobSpec): string {
  const id = nextId(world, "mob");
  const m = new MobState();
  m.kind = spec.kind;
  m.name = spec.name;
  m.faction = spec.faction ?? "";
  m.x = spec.at.x;
  m.y = spec.at.y;
  m.facing = spec.facing ?? 0;
  m.hp = m.maxHp = spec.hp ?? DUMMY_HP;
  m.status = "alive";
  m.weapon0 = spec.weapon ?? "";
  world.state.mobs.set(id, m);
  world.mobs.set(id, {
    id, inputs: new InputQueue(), path: [], history: [{ t: world.state.serverTime, x: m.x, y: m.y }],
    weapon: newWeaponRuntime(), lastHitAt: 0,
  });
  return id;
}

/**
 * The ledger's way down for a mob: `amounts` (already mitigated) land at once. A dummy can't die: a hit that would
 * empty it refills it. Returns the hp the hits were worth.
 */
export function damageMob(world: World, c: Extract<Combatant, { kind: "mob" }>, amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) if (a > 0) total += a;
  if (!(total > 0) || c.s.status !== "alive") return 0;
  c.rt.lastHitAt = world.state.serverTime;
  c.s.hp -= total;
  if (c.s.hp <= 0) c.s.hp = c.s.maxHp;
  return total;
}

/** System: dummies left alone for DUMMY_RESET_SECONDS heal back to full. */
export function resetDummies(world: World): void {
  const now = world.state.serverTime;
  for (const [id, m] of world.state.mobs) {
    const rt = world.mobs.get(id);
    if (!rt || m.kind !== "dummy" || m.hp >= m.maxHp) continue;
    if (now - rt.lastHitAt >= DUMMY_RESET_SECONDS * 1000) m.hp = m.maxHp;
  }
}

/**
 * The training setup (SimConfig.dummies) placed when the run starts, next to each player's spawn: dummies (one plain,
 * one holding a shield facing the player) and a rack of every weapon on the ground, on free floor a few tiles away.
 * Track C implements the placement.
 */
export function spawnTraining(_world: World): void {}

export function install(world: World): void {
  world.systems.push(resetDummies);
  if (world.config.dummies) chainHook(world, "raidStarted", spawnTraining);
}
