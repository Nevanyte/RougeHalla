// What a regional mob does (GAME_DESIGN 11), as inputs. The AI never touches state a player's client couldn't: each
// tick it reads the world and pushes `move`, `stop`, `aim`, `attack` and `release` into the mob's own InputQueue, and
// step.ts applies them through the same handlers as a player's. It runs as a system (after damage, before the next tick
// drains the queues), so a mob reacts one tick late, like a client does.
//
// Contract (the spine; the track fills the bodies in):
//   - Modes (MobBrain.mode): "idle" at its home spot, neutral: it ignores everyone. Damage wakes it (`aggro`): it turns on
//     the player with the most threat (damage done to it since it last rested) that is standing, wherever they stand, and
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
import {
  decide, hasLineOfSight, MOB_GIVE_UP_SECONDS, MOB_HOME_RADIUS, MOB_LEASH_RADIUS, MOB_REPATH_MS, type FactionId, type Vec2,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { activeWeapon, timingsOf } from "./combatant";
import type { InputQueue } from "./inputs";
import type { MobCombatant } from "./mobLife";
import { positionAt } from "./movement";
import { cancelAction } from "./weapons";
import { collisionMap, type MobBrain, type MobRuntime, type PlayerRuntime, type World } from "./world";

/** How far back the target's velocity is measured, to lead a projectile. */
const VELOCITY_WINDOW_MS = 100;
/** A path ending this close to the camp spot is a walk to it; a mob this close to it is on it (world units). */
const HEADING_HOME = 0.5;
const ON_SPOT = 0.01;

/** A mob's mind at rest on its camp spot. `phase` offsets its repath schedule (see MOB_REPATH_MS). */
export function newBrain(region: FactionId, elite: boolean, home: Vec2, homeFacing: number, phase: number): MobBrain {
  return {
    region, elite, home: { x: home.x, y: home.y }, homeFacing, mode: "idle", target: null, threat: new Map(),
    lastCombatAt: 0, lastMoveAt: 0, goal: null, moving: false, holding: false, phase, diedAt: 0, lastReadyAt: 0,
  };
}

/** The player `id` if they are still in the fight (alive, not down, no result yet), else null. */
function standingPlayer(world: World, id: string | null): PlayerState | null {
  if (id === null) return null;
  const p = world.state.players.get(id);
  const rt = world.players.get(id);
  return p !== undefined && rt !== undefined && p.status === "alive" && !rt.down && !rt.resolved ? p : null;
}

/**
 * The standing player with the most threat (ties go to whoever hit first), or null. Players who are gone or down are
 * dropped from the threat list on the way. The target may stand beyond the leash (a bow reaches 480 u, the leash is 224):
 * the mob still goes for them, and gives up at the leash edge, rather than being shot at for free while it ignores it.
 */
function pickTarget(world: World, b: MobBrain): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [id, threat] of b.threat) {
    if (standingPlayer(world, id) === null) {
      b.threat.delete(id);
      continue;
    }
    if (threat > most) {
      best = id;
      most = threat;
    }
  }
  return best;
}

/** `attackerId` (a player) just hurt the mob for `amount`: wake it and add the threat. Called by hurtMob. */
export function aggro(world: World, c: MobCombatant, attackerId: string, amount: number): void {
  const b = c.rt.brain;
  // A returning mob ignores everyone, and a mob is never an enemy of a mob.
  if (!b || c.s.status !== "alive" || b.mode === "return" || !(amount > 0) || !world.players.has(attackerId)) return;
  b.threat.set(attackerId, (b.threat.get(attackerId) ?? 0) + amount);
  b.lastCombatAt = world.state.serverTime;
  if (b.mode !== "idle") return;
  const target = pickTarget(world, b);
  if (target === null) return;
  b.mode = "fight";
  b.target = target;
  // The first move of a fight goes out at once.
  b.goal = null;
  b.moving = false;
  b.holding = false;
  b.lastReadyAt = c.s.readyAt;
}

/** Forget the fight: no target, no threat, no held trigger, no queued inputs or path; walk home. */
export function resetMob(world: World, c: MobCombatant): void {
  const b = c.rt.brain;
  if (!b || c.s.status !== "alive") return;
  b.target = null;
  b.threat.clear();
  b.goal = null;
  b.lastMoveAt = 0;
  b.moving = false;
  b.holding = false;
  b.lastReadyAt = c.s.readyAt;
  c.rt.inputs.drain();
  c.rt.path = [];
  cancelAction(world, c);
  c.rt.weapon.held = false;
  c.rt.weapon.bufferedUntil = 0;
  b.mode = "return";
  if (Math.hypot(c.s.x - b.home.x, c.s.y - b.home.y) <= MOB_HOME_RADIUS) rest(c.s, c.rt, b);
}

/** System: every regional mob thinks once per tick. An idle (or dead) mob costs one check and nothing else. */
export function thinkMobs(world: World, dtMs: number): void {
  const now = world.state.serverTime;
  for (const rt of world.mobs.values()) {
    const b = rt.brain;
    if (b === undefined || b.mode === "idle") continue;
    const s = world.state.mobs.get(rt.id);
    if (s === undefined || s.status !== "alive") continue;
    // It walked to where it was going (or the walk was refused): it is standing, whatever it last asked for.
    if (b.moving && rt.path.length === 0) b.moving = false;
    if (b.mode === "fight") fight(world, s, rt, b, now, dtMs);
    else walkHome(s, rt, b, now, dtMs);
  }
}

function fight(world: World, s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  // Last tick's trigger input has been applied by now, so this is what the sim holds; if anything else let go of it
  // (a teleport, a swap) the next `hold` presses again.
  b.holding = rt.weapon.held;
  // Starting an attack counts as dealing damage: a mob that is swinging at someone does not tire of it.
  if (s.readyAt > b.lastReadyAt) b.lastCombatAt = now;
  b.lastReadyAt = s.readyAt;
  if (Math.hypot(s.x - b.home.x, s.y - b.home.y) > MOB_LEASH_RADIUS || now - b.lastCombatAt >= MOB_GIVE_UP_SECONDS * 1000) {
    giveUp(s, rt, b, now, dtMs);
    return;
  }
  let id = b.target;
  let target = standingPlayer(world, id);
  if (id === null || target === null) {
    id = b.target = pickTarget(world, b);
    target = standingPlayer(world, id);
    if (id === null || target === null) {
      giveUp(s, rt, b, now, dtMs);
      return;
    }
    b.goal = null; // a new target: set off for it at once
  }
  const weapon = activeWeapon(s);
  if (weapon === null) return; // nothing to fight with: the give-up timer brings it home

  const self = { x: s.x, y: s.y };
  const at = { x: target.x, y: target.y };
  const out = decide({
    self,
    target: at,
    targetVel: velocityOf(world.players.get(id)!, target, now),
    los: hasLineOfSight(collisionMap(world), self, at),
    weapon,
    ready: now >= s.readyAt,
    drawSeconds: s.drawStartedAt > 0 ? (now - s.drawStartedAt) / 1000 : 0,
    fullDraw: timingsOf(s, weapon)?.fullDraw ?? 0,
  });

  const q = rt.inputs;
  q.pushAim(out.aim);
  if (out.release) {
    // A bow at full draw: loose it, and press again next tick for the next draw.
    q.pushAction({ kind: "release", a: out.aim });
    b.holding = false;
  } else if (out.hold && !b.holding) {
    q.pushAction({ kind: "attack", a: out.aim });
    b.holding = true;
  } else if (!out.hold && b.holding) {
    q.pushAction({ kind: "release", a: out.aim });
    b.holding = false;
  }

  if (out.move === "stop") {
    if (b.moving) {
      q.pushMove({ kind: "stop" });
      b.moving = false;
    }
  } else if (out.move !== null && repathDue(b, now, dtMs)) {
    sendMove(q, b, out.move.x, out.move.y, now);
  }
}

/** The target's velocity (u/s) over the last VELOCITY_WINDOW_MS, from its recorded positions. */
function velocityOf(rt: PlayerRuntime, p: PlayerState, now: number): Vec2 {
  const before = positionAt(rt, p, now - VELOCITY_WINDOW_MS);
  const dt = VELOCITY_WINDOW_MS / 1000;
  return { x: (p.x - before.x) / dt, y: (p.y - before.y) / dt };
}

/**
 * May this mob send a move now? The first move of a leg (a fresh fight, a new target, the walk home) goes out at once.
 * Later ones wait for MOB_REPATH_MS since its last, and then for the tick on which its own schedule (the mob's `phase`
 * into a MOB_REPATH_MS cycle) comes round, so mobs that woke together do not all path on the same tick. A goal that moved
 * is not a reason to go sooner: the schedule is the throttle.
 */
function repathDue(b: MobBrain, now: number, dtMs: number): boolean {
  if (b.goal === null) return true;
  if (now - b.lastMoveAt < MOB_REPATH_MS) return false;
  return Math.floor((now + b.phase) / MOB_REPATH_MS) !== Math.floor((now - dtMs + b.phase) / MOB_REPATH_MS);
}

function sendMove(q: InputQueue, b: MobBrain, x: number, y: number, now: number): void {
  q.pushMove({ kind: "move", x, y });
  b.goal = { x, y };
  b.lastMoveAt = now;
  b.moving = true;
}

/** The fight is over for this mob: drop the trigger, forget the people and start for home. */
function giveUp(s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  if (b.holding) {
    rt.inputs.pushAction({ kind: "release", a: rt.weapon.aim });
    b.holding = false;
  }
  b.mode = "return";
  b.target = null;
  b.threat.clear();
  b.goal = null;
  walkHome(s, rt, b, now, dtMs);
}

function walkHome(s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  if (Math.hypot(s.x - b.home.x, s.y - b.home.y) <= MOB_HOME_RADIUS) rest(s, rt, b);
  else if (repathDue(b, now, dtMs)) sendMove(rt.inputs, b, b.home.x, b.home.y, now);
}

/**
 * Home again: neutral, facing the way the camp wants. A walk that is already heading for the spot is left to finish its
 * last few units (a `stop` here would leave the mob short of its spot); otherwise it is sent to the spot once.
 */
function rest(s: MobState, rt: MobRuntime, b: MobBrain): void {
  const q = rt.inputs;
  if (b.holding) {
    q.pushAction({ kind: "release", a: b.homeFacing });
    b.holding = false;
  }
  const end = rt.path.length > 0 ? rt.path[rt.path.length - 1]! : null;
  if (end === null || Math.hypot(end.x - b.home.x, end.y - b.home.y) > HEADING_HOME) {
    if (Math.hypot(s.x - b.home.x, s.y - b.home.y) > ON_SPOT) q.pushMove({ kind: "move", x: b.home.x, y: b.home.y });
    else if (end !== null) q.pushMove({ kind: "stop" });
  }
  q.pushAim(b.homeFacing);
  b.mode = "idle";
  b.target = null;
  b.threat.clear();
  b.goal = null;
  b.moving = false;
}

export function install(world: World): void {
  world.systems.push(thinkMobs);
}
