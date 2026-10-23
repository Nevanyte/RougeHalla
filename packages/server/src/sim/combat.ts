// Combat gameplay module: hitscan attacks with lag compensation. Weapons and armor come from the
// item catalog; a player with no weapon fights with FISTS. step.ts only runs actions for alive
// players in an active raid, so the handler doesn't re-check that for the shooter.
import {
  bestArmor, bestWeapon, MAX_REWIND_MS, MELEE_SLACK, PLAYER_RADIUS, RANGED_SLACK, raycast, TICK_MS, type ArmorDef,
  type WeaponDef,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage } from "./arena";
import { positionAt } from "./movement";
import { collisionMap, emit, type ActionHandler, type World } from "./world";

export { MELEE_SLACK, RANGED_SLACK } from "@raid/shared";

/** Below this the click is on top of the shooter and has no usable direction. */
const MIN_AIM_LENGTH = 1e-3;

const defsOf = (p: PlayerState): string[] => Array.from(p.inventory, (i) => i.def);

/** Damage after armor: always at least 1, so armor can never make a hit harmless. */
export function damageAgainst(weapon: WeaponDef, armor: ArmorDef | null): number {
  return Math.max(1, Math.round(weapon.damage * (1 - (armor?.reduction ?? 0))));
}

/**
 * Projects `point` onto the ray from (ox, oy) along the unit vector (dx, dy):
 * `s` is the distance along the ray, `perp` the distance off its line.
 */
export function projectOnRay(
  ox: number, oy: number, dx: number, dy: number, px: number, py: number,
): { s: number; perp: number } {
  const rx = px - ox;
  const ry = py - oy;
  return { s: rx * dx + ry * dy, perp: Math.abs(rx * dy - ry * dx) };
}

export const handleAttack: ActionHandler = (world, p, rt, cmd) => {
  if (cmd.kind !== "attack") return;
  const now = world.state.serverTime;
  if (now < rt.nextAttackAt) return;

  const weapon = bestWeapon(defsOf(p));
  let dx = cmd.x - p.x;
  let dy = cmd.y - p.y;
  const aim = Math.hypot(dx, dy);
  if (aim < MIN_AIM_LENGTH) {
    dx = Math.cos(p.facing);
    dy = Math.sin(p.facing);
  } else {
    dx /= aim;
    dy /= aim;
  }
  p.facing = Math.atan2(dy, dx);
  rt.nextAttackAt = now + weapon.cooldownMs;
  // Keep facing the target for a moment even while walking (cosmetic; see step.ts).
  rt.aimFacingUntil = now + weapon.cooldownMs;

  // The click carries the (interpolated) time the shooter saw; never trust it beyond the rewind window.
  // The upper bound is the last *published* tick: during this tick's action loop some targets may
  // already have moved (actionOrder is shuffled), and no client has seen those positions yet.
  const published = now - TICK_MS;
  const rewindT = cmd.t !== undefined && Number.isFinite(cmd.t)
    ? Math.min(Math.max(cmd.t, now - MAX_REWIND_MS), published)
    : published;

  // Walls are static, so they are tested from the shooter's current position without any rewind.
  const wall = raycast(collisionMap(world), p.x, p.y, p.x + dx * weapon.range, p.y + dy * weapon.range);
  const reach = wall.hit ? wall.dist : weapon.range;
  const reachRadius = PLAYER_RADIUS + (weapon.melee ? MELEE_SLACK : RANGED_SLACK);

  let victimId: string | null = null;
  let victim: PlayerState | null = null;
  let hitS = Infinity;
  for (const [id, q] of world.state.players) {
    if (id === rt.id || q.status !== "alive") continue;
    const rtq = world.players.get(id);
    if (!rtq) continue;
    // At or after the newest sample, use that sample rather than the live position, which may
    // already include this tick's movement (order-dependent).
    const last = rtq.history[rtq.history.length - 1];
    const at = last && rewindT >= last.t ? last : positionAt(rtq, q, rewindT);
    const { s, perp } = projectOnRay(p.x, p.y, dx, dy, at.x, at.y);
    if (s < 0 || s > reach || perp > reachRadius) continue;
    if (s < hitS) { hitS = s; victimId = id; victim = q; }
  }

  const endX = victim ? p.x + dx * hitS : wall.hit ? wall.x : p.x + dx * reach;
  const endY = victim ? p.y + dy * hitS : wall.hit ? wall.y : p.y + dy * reach;
  emit(world, {
    type: "fx",
    fx: { kind: "shot", by: rt.id, x1: p.x, y1: p.y, x2: endX, y2: endY, hit: victimId, melee: weapon.melee },
  });
  if (!victim || victimId === null) return;

  // Kill credit, the death fx and the down all happen in applyDamage; the result waits for the end of the tick.
  applyDamage(world, victim, world.players.get(victimId)!, damageAgainst(weapon, bestArmor(defsOf(victim))), { id: rt.id, p, rt });
};

export function install(world: World): void {
  world.actions.attack = handleAttack;
}
