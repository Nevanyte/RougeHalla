// Forced displacement: a fighter is put somewhere else at once (a blink now; pulls, knockbacks and dash ends later). One call
// so every user does the same bookkeeping, and the clients see the same signal (`displaceSeq`): the remote interpolator cuts
// instead of sliding, and the local prediction rebases by the jump instead of snapping.
import type { Vec2 } from "@raid/shared";
import type { Combatant } from "./combatant";
import { planPath } from "./movement";
import { payLater, type World } from "./world";

/**
 * Moves `c` to `to` at once: position, rewind history reset to `to` (as the teleport does, so a swing or a shot rewound to an
 * earlier time cannot find it where it was), a walk in hand re-planned from `to` to its last waypoint (dropped if unreachable),
 * and c.s.displaceSeq = (c.s.displaceSeq + 1) & 0xff. The caller validated `to` (a clear disc on the collision map). Queued with
 * payLater while the ledger pass runs (D20).
 */
export function displace(world: World, c: Combatant, to: Vec2): void {
  if (world.combat.collecting) {
    payLater(world, () => displace(world, c, to));
    return;
  }
  c.s.x = to.x;
  c.s.y = to.y;
  c.rt.history = [{ t: world.state.serverTime, x: to.x, y: to.y }];
  // A blink or a pull does not carry the slide of the ice it left (sim/movement.ts walkFighter).
  c.rt.slip = null;
  const goal = c.rt.path.length > 0 ? c.rt.path[c.rt.path.length - 1]! : null;
  if (goal) c.rt.path = planPath(world, to, goal);
  c.s.displaceSeq = (c.s.displaceSeq + 1) & 0xff;
  // Whoever has locked it saw it where it was: its line of sight is not "lost" by the jump, it must chase to where it went (the
  // lock's "seen once" memory restarts, as for a target locked behind a wall) and re-plan at once, bounded by the leash.
  for (const rt of world.players.values()) {
    const w = rt.weapon;
    if (w.lock !== c.id) continue;
    w.lockSeen = false;
    w.lockLosLostAt = 0;
    w.lockPlanAt = -Infinity;
    w.lockGoal = null;
  }
}
