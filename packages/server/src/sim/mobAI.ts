// What a regional mob does (GAME_DESIGN 11), as inputs. The AI never touches state a player's client couldn't: each
// tick it reads the world and pushes `move`, `stop`, `aim`, `attack` and `release` into the mob's own InputQueue, and
// step.ts applies them through the same handlers as a player's. It runs as a system (after damage, before the next tick
// drains the queues), so a mob reacts one tick late, like a client does.
//
// Contract:
//   - Modes (MobBrain.mode): "idle" at its home spot, neutral: it ignores everyone. Damage from a player wakes it (`aggro`):
//     it turns on the player with the most threat (damage done to it since it last rested) that is standing, wherever they
//     stand, and goes "fight". "fight" chases and attacks that target by the weapon's spacing (policies.ts `decide`: close
//     in while far or out of sight, stand and attack in range, ranged weapons back off when the target is closer than they
//     like). It gives up, and goes "return", when it is farther than MOB_LEASH_RADIUS from home, or MOB_GIVE_UP_SECONDS
//     pass without it dealing damage (damage it TAKES does not extend the fight, so a shooter out of its reach cannot hold
//     it), or no standing player is left to fight. "return" is an evade: it walks home ignoring everyone, nothing hurts it
//     (mobLife.hurtMob), it is whole again the moment it is "idle" within MOB_HOME_RADIUS of home (the walk is shorter than heal()'s lockout),
//     where it faces homeFacing again. So kiting a mob from outside its leash gains nothing: each round ends with the mob
//     whole.
//   - Inputs: aim every tick toward the (led) target while fighting; hold/release the trigger as `decide` says (an `attack`
//     when it starts holding, a `release` when it stops); `move` only when MOB_REPATH_MS (plus
//     the mob's `phase`) passed since the last one, `stop` once when it should stand. An idle mob sends nothing at all
//     (sixty idle mobs cost no inputs).
//   - Camp-wide aggro (roguelike R5, D24; CAMP_WIDE_AGGRO): damage to one member of a camp (MobState.camp) wakes every
//     other IDLE living member of that camp onto the same target, whether or not the hit mob was already fighting. A member
//     walking home ("return") is not woken, nor is a mob of another camp. A mate woken this way holds the target with no
//     threat of its own (0): threat stays the damage each player did to THAT mob, which is what its kill credit reads
//     (mobLife.killMob), so a pull never earns a kill. If its target goes down it turns on whoever has hurt it since, or
//     gives up. Leash and give-up rules are the same as for any fight.
//   - It only ever targets players; it never attacks another mob.
//   - On the coliseum teleport (`resetMob`) it drops its fight, its inputs and its path and is put back on its camp spot at
//     full hp: the gates lock behind the players, so a mob near the coliseum could not walk home.
import {
  CAMP_WIDE_AGGRO, decide, hasLineOfSight, MOB_AIM_DEADBAND, MOB_GIVE_UP_SECONDS, MOB_HOME_RADIUS, MOB_LEASH_RADIUS, MOB_REPATH_MS, PLAYER_RADIUS,
  segmentClear, TICK_MS, wrapAngle, type FactionId, type Vec2,
} from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { activeWeapon, timingsOf } from "./combatant";
import type { InputQueue } from "./inputs";
import type { MobCombatant } from "./mobLife";
import { velocityOf } from "./movement";
import { isStunned, isUntargetableId } from "./status";
import { cancelAction } from "./weapons";
import { collisionMap, type MobBrain, type MobRuntime, type World } from "./world";

/** A ranged mob retreats only to points this far inside its leash, so backing away never carries it over the edge. */
const LEASH_MARGIN = 24;
/** A path ending this close to the camp spot is a walk to it; a mob this close to it is on it (world units). */
const HEADING_HOME = 0.5;
const ON_SPOT = 0.01;

/** A mob's mind at rest on its camp spot. `phase` offsets its repath schedule (see MOB_REPATH_MS). */
export function newBrain(region: FactionId, elite: boolean, home: Vec2, homeFacing: number, phase: number): MobBrain {
  return {
    region, elite, home: { x: home.x, y: home.y }, homeFacing, mode: "idle", target: null, threat: new Map(),
    lastCombatAt: 0, lastMoveAt: 0, goal: null, moving: false, holding: false, phase, diedAt: 0, lastAim: NaN,
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
 * dropped from the threat list on the way. The target may stand beyond the leash (a bow shoots 240 u, so an archer can
 * hit a mob from outside its 288 u leash): the mob still goes for them, and gives up at the leash edge, rather than
 * being shot at for free while it ignores it.
 */
function pickTarget(world: World, b: MobBrain): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [id, threat] of b.threat) {
    if (standingPlayer(world, id) === null) {
      b.threat.delete(id);
      continue;
    }
    // Hidden or untargetable (Swarm): the threat is kept, but it is not a target while it is out of reach.
    if (isUntargetableId(world, id)) continue;
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
  if (b.mode === "idle") {
    const target = pickTarget(world, b);
    if (target === null) return;
    wake(world, b, target);
  }
  if (CAMP_WIDE_AGGRO && b.mode === "fight" && b.target !== null) wakeCamp(world, c, b.target);
}

function wake(world: World, b: MobBrain, target: string): void {
  b.mode = "fight";
  b.target = target;
  // The give-up timer runs from the wake; from then on only damage the mob deals restarts it (ledger.recordHit).
  b.lastCombatAt = world.state.serverTime;
  // The first move of a fight goes out at once.
  b.goal = null;
  b.moving = false;
  b.holding = false;
}

/** D24: every other idle, living member of `c`'s camp wakes onto `target` (no threat of its own: see the header). */
function wakeCamp(world: World, c: MobCombatant, target: string): void {
  const camp = c.s.camp;
  if (!(camp >= 1)) return;
  for (const rt of world.mobs.values()) {
    const b = rt.brain;
    if (rt.id === c.id || b === undefined || b.mode !== "idle") continue;
    const s = world.state.mobs.get(rt.id);
    if (s === undefined || s.camp !== camp || s.status !== "alive") continue;
    if (!b.threat.has(target)) b.threat.set(target, 0);
    wake(world, b, target);
  }
}

/**
 * Forget the fight and go home: no target, no threat, no held trigger, no queued inputs or path. Used by the coliseum
 * teleport, when everyone alive has just left the map and the gates are locked behind them: a mob near the coliseum could
 * not walk home through them (and one on a gate tile would be inside the wall), so it is put back on its camp spot at full
 * hp, idle. Nobody is in reach and the arrivals are immune, so nothing can use the pop.
 */
export function resetMob(world: World, c: MobCombatant): void {
  const b = c.rt.brain;
  if (!b || c.s.status !== "alive") return;
  b.target = null;
  b.threat.clear();
  b.goal = null;
  b.lastMoveAt = 0;
  b.moving = false;
  b.holding = false;
  c.rt.inputs.drain();
  c.rt.path = [];
  cancelAction(world, c);
  c.rt.weapon.held = false;
  c.rt.weapon.bufferedUntil = 0;
  c.s.x = b.home.x;
  c.s.y = b.home.y;
  c.s.facing = b.homeFacing;
  c.s.hp = c.s.maxHp;
  c.rt.history = [{ t: world.state.serverTime, x: b.home.x, y: b.home.y }];
  b.mode = "idle";
}

/**
 * A mob whose shield blocked or reflected a player's hit took no damage, so nothing woke it. Being attacked is being
 * attacked: it wakes onto that player (a Frost mob facing a shield-bashing player would otherwise never fight back).
 */
function wakeOnBlocks(world: World): void {
  for (const ev of world.events) {
    if (ev.type !== "fx" || ev.fx.kind !== "block") continue;
    const rt = world.mobs.get(ev.fx.id);
    const s = world.state.mobs.get(ev.fx.id);
    if (!rt?.brain || !s || s.status !== "alive" || rt.brain.mode !== "idle") continue;
    aggro(world, { kind: "mob", id: ev.fx.id, s, rt }, ev.fx.by, 1);
  }
}

/** System: every regional mob thinks once per tick. An idle (or dead) mob costs one check and nothing else. */
export function thinkMobs(world: World, dtMs: number): void {
  if (world.events.length > 0) wakeOnBlocks(world);
  const now = world.state.serverTime;
  for (const rt of world.mobs.values()) {
    const b = rt.brain;
    if (b === undefined || b.mode === "idle") continue;
    const s = world.state.mobs.get(rt.id);
    if (s === undefined || s.status !== "alive") continue;
    // A stunned mob does not think (step.ts drains its inputs); its timers wait with it.
    if (isStunned(world, { kind: "mob", id: rt.id, s, rt })) continue;
    // It walked to where it was going (or the walk was refused): it is standing, whatever it last asked for.
    if (b.moving && rt.path.length === 0) b.moving = false;
    if (b.mode === "fight") fight(world, s, rt, b, now, dtMs);
    else walkHome(world, s, rt, b, now, dtMs);
  }
}

function fight(world: World, s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  // Last tick's trigger input has been applied by now, so this is what the sim holds; if anything else let go of it
  // (a teleport, a swap) the next `hold` presses again.
  b.holding = rt.weapon.held;
  if (Math.hypot(s.x - b.home.x, s.y - b.home.y) > MOB_LEASH_RADIUS || now - b.lastCombatAt >= MOB_GIVE_UP_SECONDS * 1000) {
    giveUp(world, s, rt, b, now, dtMs);
    return;
  }
  let id = b.target;
  let target = standingPlayer(world, id);
  // A target that turned untargetable is as good as gone (the pick below skips it too); with no one else, the mob goes home.
  if (target !== null && isUntargetableId(world, id!)) target = null;
  if (id === null || target === null) {
    id = b.target = pickTarget(world, b);
    target = standingPlayer(world, id);
    if (id === null || target === null) {
      giveUp(world, s, rt, b, now, dtMs);
      return;
    }
    b.goal = null; // a new target: set off for it at once
  }
  const weapon = activeWeapon(s);
  if (weapon === null) return; // nothing to fight with: the give-up timer brings it home

  const self = { x: s.x, y: s.y };
  const at = { x: target.x, y: target.y };
  const map = collisionMap(world);
  const tm = timingsOf(s, weapon);
  const home = b.home;
  const out = decide({
    self,
    target: at,
    targetVel: velocityOf(world.players.get(id)!, target, now),
    los: hasLineOfSight(map, self, at),
    weapon,
    ready: now >= s.readyAt,
    // The mob's inputs take effect on the next tick, like a client's.
    inputDelay: TICK_MS / 1000,
    windup: tm?.windup ?? 0,
    // A ranged mob backs off only inside its leash (past it the fight would end in an evade, and a melee player could
    // never catch it), and only to points that open the gap; cornered, decide() stands it still to shoot.
    walkable: (from, to) => Math.hypot(to.x - home.x, to.y - home.y) <= MOB_LEASH_RADIUS - LEASH_MARGIN
      && Math.hypot(to.x - at.x, to.y - at.y) > Math.hypot(from.x - at.x, from.y - at.y)
      && segmentClear(map, from, to, PLAYER_RADIUS),
  });

  const q = rt.inputs;
  // Facing is synced to every client, so a mob re-aims only when the angle moved past the deadband; the attack and
  // release inputs below carry the exact angle, so a shot or a swing is never off.
  if (!(Math.abs(wrapAngle(out.aim - b.lastAim)) < MOB_AIM_DEADBAND)) {
    q.pushAim(out.aim);
    b.lastAim = out.aim;
  }
  if (out.hold && !b.holding) {
    q.pushAction({ kind: "attack", a: out.aim });
    b.lastAim = out.aim;
    b.holding = true;
  } else if (!out.hold && b.holding) {
    q.pushAction({ kind: "release", a: out.aim });
    b.lastAim = out.aim;
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
function giveUp(world: World, s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  disarm(world, s, rt, b);
  b.mode = "return";
  b.target = null;
  b.threat.clear();
  b.goal = null;
  walkHome(world, s, rt, b, now, dtMs);
}

/**
 * Whatever the mob had started is dropped, not finished: a swing or a cast still winding up never lands, a drawn bow is
 * not loosed. It also stops aiming, so walking turns it away from the people it was fighting. A mob that is going home
 * is untouchable and must be harmless too.
 */
function disarm(world: World, s: MobState, rt: MobRuntime, b: MobBrain): void {
  cancelAction(world, { kind: "mob", id: rt.id, s, rt });
  const w = rt.weapon;
  w.held = false;
  w.bufferedUntil = 0;
  w.aimAt = 0;
  b.holding = false;
}

function walkHome(world: World, s: MobState, rt: MobRuntime, b: MobBrain, now: number, dtMs: number): void {
  if (Math.hypot(s.x - b.home.x, s.y - b.home.y) <= MOB_HOME_RADIUS) rest(world, s, rt, b);
  else if (repathDue(b, now, dtMs)) sendMove(rt.inputs, b, b.home.x, b.home.y, now);
}

/**
 * Home again: neutral, facing the way the camp wants. A walk that is already heading for the spot is left to finish its
 * last few units (a `stop` here would leave the mob short of its spot); otherwise it is sent to the spot once.
 */
function rest(world: World, s: MobState, rt: MobRuntime, b: MobBrain): void {
  const q = rt.inputs;
  disarm(world, s, rt, b);
  const end = rt.path.length > 0 ? rt.path[rt.path.length - 1]! : null;
  if (end === null || Math.hypot(end.x - b.home.x, end.y - b.home.y) > HEADING_HOME) {
    if (Math.hypot(s.x - b.home.x, s.y - b.home.y) > ON_SPOT) q.pushMove({ kind: "move", x: b.home.x, y: b.home.y });
    else if (end !== null) q.pushMove({ kind: "stop" });
  }
  q.pushAim(b.homeFacing);
  b.lastAim = b.homeFacing;
  // Back at its camp it is whole again: it was untouchable on the way.
  s.hp = s.maxHp;
  b.mode = "idle";
  b.target = null;
  b.threat.clear();
  b.goal = null;
  b.moving = false;
}

export function install(world: World): void {
  world.systems.push(thinkMobs);
}
