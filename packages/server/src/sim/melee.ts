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
//     no stagger. Negated hits emit { kind: "block", id: holder, by: attacker, weapon } and never stagger.
//   - A normal hit is recordHit({ victim, by: { id, name }, packet: req.packet, weapon, stagger: staggers({ melee }) }).
//   - Balls: for every ball in ballsThisTick(world, attacker) whose path this tick (tickX, tickY -> x, y; a point for one
//     loosed this tick) passes through the arc, sampled at the ATTACKER'S PRESENT position (balls fly in present time),
//     extended by RANGED_SLACK, at a point with a clear line from the attacker (walls block the swing):
//     swingVsBall(weapon) -> interceptBall(world, ball, how). That also scales or cancels a
//     hit the ball already made this tick.
//   - Every landed swing emits { kind: "swing", by, weapon, x, y, a } with (x, y) the attacker's sampled origin,
//     whether or not it hit anything.
//   - Drains world.combat.melee.
import {
  inArc, onShieldFront, PLAYER_RADIUS, RANGED_SLACK, raycast, riposteShare, shieldOutcome, staggers, swingVsBall, WEAPONS,
  type ArcShape, type GameMap, type Vec2,
} from "@raid/shared";
import { activeWeapon, combatant, standing, standingCombatants, type Combatant } from "./combatant";
import { recordHit } from "./ledger";
import { positionAt } from "./movement";
import { ballsThisTick, interceptBall } from "./projectiles";
import { collisionMap, emit, type MeleeRequest, type ProjectileRuntime, type World } from "./world";

/** Spacing of the samples along a ball's path this tick: a ball covers 19 u a tick, and its own radius is 2 u. */
const BALL_SAMPLE_STEP = 1;

export function resolveMelee(world: World): void {
  const requests = world.combat.melee;
  world.combat.melee = [];
  if (requests.length === 0) return;
  const map = collisionMap(world);
  // Nobody goes down before the ledger is applied, so one list serves every request.
  const bodies = standingCombatants(world);
  for (const req of requests) {
    const attacker = combatant(world, req.attacker);
    const shape = WEAPONS[req.weapon].shape;
    if (!attacker || !standing(attacker) || shape.kind !== "arc") continue;
    const origin = positionAt(attacker.rt, attacker.s, req.rewindT);
    emit(world, { type: "fx", fx: { kind: "swing", by: attacker.id, weapon: req.weapon, x: origin.x, y: origin.y, a: req.a } });
    for (const target of bodies) {
      if (target.id === attacker.id) continue;
      const at = positionAt(target.rt, target.s, req.rewindT);
      if (!inArc(origin, req.a, shape.reach, shape.halfArc, at, PLAYER_RADIUS)) continue;
      if (raycast(map, origin.x, origin.y, at.x, at.y).hit) continue;
      land(world, req, attacker, target, origin, at);
    }
    meetBalls(world, req, attacker, shape);
  }
}

/** One swing reaches one body: a shield in front of it may negate the hit, otherwise it goes in the ledger. */
function land(world: World, req: MeleeRequest, attacker: Combatant, target: Combatant, origin: Vec2, at: Vec2): void {
  const by = { id: attacker.id, name: attacker.s.name };
  if (activeWeapon(target.s) === "shield" && onShieldFront(at, target.s.facing, origin)) {
    const outcome = shieldOutcome({ melee: req.weapon });
    if (outcome === "block" || outcome === "riposte") {
      emit(world, { type: "fx", fx: { kind: "block", id: target.id, by: attacker.id, weapon: req.weapon } });
      if (outcome === "riposte") {
        recordHit(world, {
          victim: attacker.id, by: { id: target.id, name: target.s.name },
          packet: { ...req.packet, raw: req.packet.raw * riposteShare() }, weapon: "shield", stagger: false,
        });
      }
      return;
    }
  }
  recordHit(world, { victim: target.id, by, packet: req.packet, weapon: req.weapon, stagger: staggers({ melee: req.weapon }) });
}

/** The swing meets every enemy ball that crossed its arc this tick; a bash does nothing to a ball. */
function meetBalls(world: World, req: MeleeRequest, attacker: Combatant, shape: ArcShape): void {
  const how = swingVsBall(req.weapon);
  if (!how) return;
  // Balls fly in present time, so the arc is the attacker's present one, not the rewound one the targets were tested in.
  const origin = { x: attacker.s.x, y: attacker.s.y };
  const map = collisionMap(world);
  for (const ball of ballsThisTick(world, attacker.id)) {
    if (crossesArc(map, ball, origin, req.a, shape)) interceptBall(world, ball, how);
  }
}

/**
 * Does the ball's path this tick (a point when it was loosed this tick) touch the arc, the ball's own radius counted,
 * somewhere the swing can reach (walls block it like they block body hits)?
 */
function crossesArc(map: GameMap, ball: ProjectileRuntime, origin: Vec2, a: number, shape: ArcShape): boolean {
  const dx = ball.x - ball.tickX;
  const dy = ball.y - ball.tickY;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / BALL_SAMPLE_STEP));
  for (let i = 0; i <= n; i++) {
    const p = { x: ball.tickX + (dx * i) / n, y: ball.tickY + (dy * i) / n };
    if (inArc(origin, a, shape.reach, shape.halfArc, p, RANGED_SLACK) && !raycast(map, origin.x, origin.y, p.x, p.y).hit) return true;
  }
  return false;
}
