// What a regional mob does (GAME_DESIGN 11), as inputs. The AI never touches state a player's client couldn't: each
// tick it reads the world and pushes `move`, `stop`, `aim`, `attack` and `release` into the mob's own InputQueue, and
// step.ts applies them through the same handlers as a player's. It runs as a system (after damage, before the next tick
// drains the queues), so a mob reacts one tick late, like a client does.
//
// Contract (the spine; the track fills the bodies in):
//   - Modes (MobBrain.mode): "idle" at its home spot, neutral: it ignores everyone. Damage wakes it (`aggro`): it turns on
//     the player with the most threat (damage done to it since it last rested) that is standing and inside the leash, and
//     goes "fight". "fight" chases and attacks that target by the weapon's spacing (policies.ts `decide`: close in while
//     far or out of sight, stand and attack in range, ranged weapons back off when the target is closer than they like).
//     It gives up, and goes "return", when it is farther than MOB_LEASH_RADIUS from home, or MOB_GIVE_UP_SECONDS pass with
//     no damage dealt or taken, or no standing player is left to fight. "return" walks home ignoring everyone (damage
//     still hurts it but does not wake it), heals (mobLife), and is "idle" again within MOB_HOME_RADIUS of home, where it
//     faces homeFacing again.
//   - Inputs: aim every tick toward the (led) target while fighting; hold/release the trigger as `decide` says (an `attack`
//     when it starts holding, a `release` when it stops or a bow is at full draw); `move` only when the goal changed or
//     MOB_REPATH_MS (plus the mob's `phase`) passed since the last one, `stop` once when it should stand. An idle mob sends
//     nothing at all (sixty idle mobs cost no inputs).
//   - It only ever targets players; it never attacks another mob.
//   - On the coliseum teleport (`resetMob`) it drops its fight, its inputs and its path, and walks home.
import type { FactionId, Vec2 } from "@raid/shared";
import type { MobBrain, LedgerEntry, World } from "./world";
import type { MobCombatant } from "./mobLife";

/** A mob's mind at rest on its camp spot. `phase` offsets its repath schedule (see MOB_REPATH_MS). */
export function newBrain(region: FactionId, elite: boolean, home: Vec2, homeFacing: number, phase: number): MobBrain {
  return {
    region, elite, home: { x: home.x, y: home.y }, homeFacing, mode: "idle", target: null, threat: new Map(),
    lastCombatAt: 0, lastMoveAt: 0, goal: null, moving: false, holding: false, phase, diedAt: 0,
  };
}

/** `attackerId` (a player) just hurt the mob for `amount`: wake it and add the threat. Called by hurtMob. */
export function aggro(_world: World, _c: MobCombatant, _attackerId: string, _amount: number): void {}

/** Forget the fight: no target, no threat, no held trigger, no queued inputs or path; walk home. */
export function resetMob(_world: World, _c: MobCombatant): void {}

/** System: every regional mob thinks once per tick. */
export function thinkMobs(_world: World, _dtMs: number): void {}

export type { LedgerEntry };

export function install(_world: World): void {}
