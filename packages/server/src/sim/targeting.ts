// The target lock (the LoL-style controls). A `target {id}` order locks an enemy; from then on the server plays the
// player's weapon against it as a mob would: it walks into range, attacks whenever the cooldown allows, faces it (the
// shield's block cone follows) and aims every attack at it, until the lock ends. It is a player's input made server side
// (sim/mobAI.ts is the same idea for mobs), so it never touches state a client could not: it sets the path, the trigger
// and the aim, and the weapon state machine does the rest (sim/weapons.ts).
//
// Accepting (handleTarget). The target must be another combatant that is standing, not evading, hostile (not the fighter
// itself, and a mob never locks a mob: only players lock at all) and within TARGET_RANGE centre to centre, and the player
// must hold a weapon. Anything else is ignored without changing a thing. Line of sight is not needed: an enemy seen behind
// a pillar is locked and the chase walks around it, as in LoL (nothing is attacked without a clear line). Accepting locks
// it and lets go of the trigger (the upkeep below holds it from then on).
//
// Orders replace each other in arrival order within a tick (step.ts applies a move where it arrived among the actions):
// `move` and `stop` end the lock (dropLock, weapons.ts), as does `attack`; a `target` ends whatever came before it. A
// move to an unreachable point still ends the lock: the order was given.
//
// Upkeep (updateTargets, once per tick right after the inputs, before the weapons). For every locked player: the lock ends
// when the target is no longer standing, is evading, is farther than TARGET_RANGE, has been out of line of sight for
// TARGET_LOS_GRACE_MS after having been in it (until then the chase paths around the wall; a target locked behind a wall
// is chased until it is first seen), or the player holds no weapon. Ending it clears the
// trigger and the chase path: the player stops where it stands. Otherwise policies.ts `decide` plays the weapon with
// lockSpacing (close in until within the weapon's `far`, then stand and attack, never back off) against the target's
// present position and its velocity:
//   walk    toward the target, re-planned at most every TARGET_REPATH_MS, and only when the goal moved or the path ran out
//   trigger held while the target is in range with a clear line, so the next attack starts the moment the cooldown allows
//   aim     every attack goes where `decide` aims (the cursor's `aim` input is ignored while locked); the synced facing is
//           written only past MOB_AIM_DEADBAND, as a mob's is
// An attack the lock starts remembers its target and is aimed again at it as it lands or leaves (weapons.ts `land`).
import {
  decide, hasLineOfSight, lockSpacing, MOB_AIM_DEADBAND, TARGET_LOS_GRACE_MS, TARGET_RANGE, TARGET_REPATH_MS, TICK_MS, wrapAngle,
  type Vec2,
} from "@raid/shared";
import {
  activeWeapon, combatant, hostile, isEvading, standing, timingsOf, type Combatant,
} from "./combatant";
import { planPath, velocityOf } from "./movement";
import { dropLock, setLock } from "./weapons";
import { collisionMap, type ActionHandler, type World } from "./world";

/** The chase re-plans only when the point it walks to moved this far (world units). */
const GOAL_MOVED = 8;

export function install(world: World): void {
  world.actions.target = handleTarget;
}

/** Can `c` hold `t` as a target: a standing enemy within TARGET_RANGE that is not walking home? */
function lockable(c: Combatant, t: Combatant): boolean {
  return standing(t) && !isEvading(t) && hostile(c, t) && Math.hypot(t.s.x - c.s.x, t.s.y - c.s.y) <= TARGET_RANGE;
}

export const handleTarget: ActionHandler = (world, c, cmd) => {
  if (cmd.kind !== "target" || c.kind !== "player") return;
  const t = combatant(world, cmd.id);
  if (!t || !lockable(c, t) || activeWeapon(c.s) === null) return;
  const w = c.rt.weapon;
  // Clicking the fighter already locked changes nothing: players re-click their target all the time, and starting over
  // would forget that it was seen and let go of the trigger (losing the cooldown's carried remainder).
  if (w.lock === t.id) return;
  // An order may cost one path search right away, at most one per TARGET_REPATH_MS per player: a modified client could
  // otherwise buy one per message (MAX_ACTIONS_PER_TICK a tick). The chase's own re-plans have their own throttle.
  const now = world.state.serverTime;
  const fresh = now - w.lockSearchAt >= TARGET_REPATH_MS;
  let path: Vec2[] | null = null;
  if (!hasLineOfSight(collisionMap(world), c.s, t.s)) {
    // Out of sight, it must be somewhere the chase can walk to (nothing reaches a mob across the coliseum's locked gates),
    // and finding out is the search: an order that comes too soon after the last one is refused.
    if (!fresh) return;
    w.lockSearchAt = now;
    path = planPath(world, c.s, t.s);
    if (path.length === 0) return;
  }
  setLock(c, t.id);
  // The lock walks and holds the trigger from here; an earlier walk and trigger are let go. The search out of sight was
  // the chase's first plan; in sight, the chase plans at once if the order's budget allows, else when its throttle does.
  c.rt.path = path ?? [];
  if (path) {
    w.lockPlanAt = now;
    w.lockGoal = { x: t.s.x, y: t.s.y };
  } else if (fresh) {
    w.lockSearchAt = now;
    w.lockPlanAt = -Infinity;
  }
  w.held = false;
  w.bufferedUntil = 0;
};

/** Every locked player follows its target for this tick: the drop rules, then the chase, the trigger and the aim. */
export function updateTargets(world: World): void {
  for (const rt of world.players.values()) {
    if (rt.weapon.lock === null) continue;
    const s = world.state.players.get(rt.id);
    if (s) follow(world, { kind: "player", id: rt.id, s, rt });
  }
}

function follow(world: World, c: Combatant): void {
  const now = world.state.serverTime;
  const w = c.rt.weapon;
  const t = w.lock === null ? null : combatant(world, w.lock);
  const weapon = activeWeapon(c.s);
  const tm = weapon ? timingsOf(c.s, weapon) : null;
  if (!standing(c) || !t || !weapon || !tm || !lockable(c, t)) {
    dropLock(c);
    return;
  }
  const self = { x: c.s.x, y: c.s.y };
  const at = { x: t.s.x, y: t.s.y };
  const los = hasLineOfSight(collisionMap(world), self, at);
  if (los) {
    w.lockSeen = true;
    w.lockLosLostAt = 0;
  } else if (!w.lockSeen) {
    // Locked behind a wall: chase until it is first seen (the leash still bounds it).
  } else if (w.lockLosLostAt === 0) w.lockLosLostAt = now;
  else if (now - w.lockLosLostAt >= TARGET_LOS_GRACE_MS) {
    dropLock(c);
    return;
  }

  const out = decide({
    self, target: at, targetVel: velocityOf(t.rt, at, now), los, weapon, ready: now >= c.s.readyAt, windup: tm.windup,
    spacing: lockSpacing(weapon),
  });

  if (out.move === "stop") {
    if (c.rt.path.length > 0) c.rt.path = [];
  } else if (out.move !== null && !chase(world, c, out.move, now, los)) {
    return;
  }

  if (out.hold) {
    if (!w.held) w.pressedAt = now;
    w.held = true;
  } else {
    w.held = false;
  }

  // A locked attack is timed like an input with no `t`: it rewinds by one tick, not by a client's render lag.
  w.lagMs = TICK_MS;
  w.aim = out.aim;
  w.aimAt = now;
  if (Math.abs(wrapAngle(out.aim - c.s.facing)) >= MOB_AIM_DEADBAND) c.s.facing = out.aim;
}

/**
 * Walks toward `goal`: plans a path when there is none or the goal moved, but not more often than TARGET_REPATH_MS. A goal
 * in sight that can't be planned to leaves the path as it was (as a move order to such a point does); one out of sight with
 * no way to it ends the lock (the gates locked between them). Returns false when it ended the lock.
 */
function chase(world: World, c: Combatant, goal: Vec2, now: number, los: boolean): boolean {
  const w = c.rt.weapon;
  const moved = w.lockGoal === null || Math.hypot(goal.x - w.lockGoal.x, goal.y - w.lockGoal.y) > GOAL_MOVED;
  if (!moved && c.rt.path.length > 0) return true;
  if (now - w.lockPlanAt < TARGET_REPATH_MS) return true;
  w.lockPlanAt = now;
  w.lockGoal = { x: goal.x, y: goal.y };
  const path = planPath(world, c.s, goal);
  if (path.length > 0) c.rt.path = path;
  else if (!los) {
    dropLock(c);
    return false;
  }
  return true;
}
