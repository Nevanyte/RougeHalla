// The melee phase: swings whose windup ended this tick (world.combat.melee, queued by sim/weapons.ts) become hits in
// the damage ledger. Runs after the projectile sweep and the spawns, before the ledger is applied (step.ts).
//
// Contract (track A implements it; the rules themselves are in @raid/shared interactions.ts):
//   - Each request is resolved independently and none of them sees the others' effects (they land at the same moment):
//     a fighter staggered or killed by one swing this tick still lands its own.
//   - "What I saw is what I hit": the attacker's position AND every target's position are sampled at req.rewindT
//     (positionAt over their history). Present walls (collisionMap) block: a target counts only with a clear line from
//     the attacker's sampled position to the target's sampled centre (raycast).
//   - Targets: every standing combatant except the attacker, players and mobs alike, inside the arc
//     (inArc(origin, req.a, shape.reach, shape.halfArc, targetPos, PLAYER_RADIUS)). A swing hits everyone in it.
//   - A target with a shield in hand (activeWeapon === "shield") whose front faces the attacker
//     (onShieldFront(targetPos, target.facing, origin), both sampled positions, the holder's current facing):
//     shieldOutcome({ melee: weapon }): "pierce" (axe) is a normal hit; "block" (a bash) is negated; "riposte" (sword)
//     is negated and riposteShare() of the packet is recorded on the attacker, by the holder, weapon "shield",
//     no stagger, `passive: true` (it is no attack of the holder's own: sim/factions.ts lets it set a target only for a
//     holder that has none). Negated hits emit { kind: "block", id: holder, by: attacker, weapon } and never stagger.
//   - A normal hit is recordHit({ victim, by: { id, name }, packet: req.packet, weapon, stagger: staggers({ melee }) }).
//   - Balls: for every ball in ballsThisTick(world, attacker) whose path this tick (tickX, tickY -> x, y; a point for one
//     loosed this tick) passes through the arc, sampled at the ATTACKER'S PRESENT position (balls fly in present time),
//     extended by RANGED_SLACK: swingVsBall(weapon) -> interceptBall(world, ball, how). That also scales or cancels a
//     hit the ball already made this tick.
//   - Every landed swing emits { kind: "swing", by, weapon, x, y, a } with (x, y) the attacker's sampled origin,
//     whether or not it hit anything.
//   - Drains world.combat.melee.
import type { World } from "./world";

export function resolveMelee(world: World): void {
  world.combat.melee = [];
}
