// Projectiles. An arrow or a ball is synced once when loosed (ProjectileState: kind, owner, start, velocity, time,
// range) and never updated: every client computes its straight flight from that. The server flies each one in present
// time, in PROJECTILE_SUBSTEP_MS steps. In each step, in this order:
//   1. it moves, stopping at a wall (collisionMap: closed gates block) or at the end of its range;
//   2. a ball deletes every enemy arrow that came within BALL_ARROW_RADIUS of it during the step, in line of sight;
//   3. it meets the first body along its step whose centre, where that body was at that moment (history), comes within
//      RANGED_HIT_REACH. An arrow on a raised shield's front is reflected: it stops, and a new arrow owned by the holder
//      flies on from the contact point with the mirrored velocity, the full bow range (an arrow reflected before keeps
//      only the range it has left) and the same damage. Anything else is a hit, recorded in the damage ledger and
//      applied with every other hit after melee.
// When it stops it leaves the state, and a `projEnd` fx says exactly where and why. Its owner is never hit by it. It
// outlives its owner: its hit still lands (credited by name only once the owner has left or is out of the run).
// Projectiles loosed this tick (spawnProjectiles, after the sweep) leave from where the owner's client drew it and
// first move in the next tick's sweep.
import {
  ballDeletesArrow, PROJECTILE_SUBSTEP_MS, projectileOnShieldFront, RANGED_HIT_REACH, raycast, reflectVelocity,
  WEAPONS, type ProjectileEnd, type ProjectileKind, type Vec2, type WeaponId,
} from "@raid/shared";
import { ProjectileState } from "@raid/shared/schema";
import { activeWeapon, combatant, standingCombatants, type Combatant } from "./combatant";
import { recordHit } from "./ledger";
import { positionAt } from "./movement";
import { chainHook, collisionMap, emit, nextId, type DamagePacket, type ProjectileRuntime, type World } from "./world";

export function install(world: World): void {
  // The teleport moves everyone into the coliseum: nothing in flight may follow them in.
  chainHook(world, "teleported", (w) => clearProjectiles(w, "cleared"));
}

interface Launch {
  kind: ProjectileKind;
  weapon: WeaponId;
  owner: string;
  ownerName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  range: number;
  packet: DamagePacket;
}

function launch(world: World, l: Launch): ProjectileRuntime {
  const id = nextId(world, "p");
  const st = new ProjectileState();
  st.kind = l.kind;
  st.owner = l.owner;
  st.x = l.x;
  st.y = l.y;
  st.vx = l.vx;
  st.vy = l.vy;
  st.t = l.t;
  st.range = l.range;
  world.state.projectiles.set(id, st);
  const pr: ProjectileRuntime = {
    id, state: st, kind: l.kind, weapon: l.weapon, owner: l.owner, ownerName: l.ownerName,
    x: l.x, y: l.y, simT: l.t, traveled: 0, tickX: l.x, tickY: l.y, packet: l.packet, halved: false, ended: false,
  };
  world.projectiles.set(id, pr);
  world.combat.swept.push(pr);
  return pr;
}

/** Stops `pr` at (x, y): out of the state, and a projEnd fx. A no-op for one already stopped. */
export function endProjectile(world: World, pr: ProjectileRuntime, x: number, y: number, reason: ProjectileEnd): void {
  if (pr.ended) return;
  pr.ended = true;
  pr.x = x;
  pr.y = y;
  world.projectiles.delete(pr.id);
  world.state.projectiles.delete(pr.id);
  const st = pr.state;
  emit(world, {
    type: "fx", fx: { kind: "projEnd", id: pr.id, proj: pr.kind, x0: st.x, y0: st.y, t0: st.t, x, y, reason },
  });
}

export function clearProjectiles(world: World, reason: ProjectileEnd): void {
  for (const pr of [...world.projectiles.values()]) endProjectile(world, pr, pr.x, pr.y, reason);
}

/**
 * The spawn phase: this tick's arrows and balls leave from where their owner's client drew it (the request's origin,
 * the same rewound position melee swings from), at the present time.
 */
export function spawnProjectiles(world: World): void {
  const spawns = world.combat.spawns;
  world.combat.spawns = [];
  const now = world.state.serverTime;
  for (const req of spawns) {
    const owner = combatant(world, req.owner);
    const shape = WEAPONS[req.weapon].shape;
    if (!owner || shape.kind !== "projectile") continue;
    const from = req.origin ?? owner.s;
    launch(world, {
      kind: req.kind, weapon: req.weapon, owner: owner.id, ownerName: owner.s.name, x: from.x, y: from.y,
      vx: Math.cos(req.a) * shape.speed, vy: Math.sin(req.a) * shape.speed, t: now, range: shape.range, packet: req.packet,
    });
  }
}

/** Where a ball and an arrow came closest during their stretches this substep (both moving straight, in step). */
function closestApproach(ball: Stretch, arrow: Stretch): { ball: Vec2; arrow: Vec2 } {
  const rx = ball.ax - arrow.ax;
  const ry = ball.ay - arrow.ay;
  const vx = (ball.bx - ball.ax) - (arrow.bx - arrow.ax);
  const vy = (ball.by - ball.ay) - (arrow.by - arrow.ay);
  const vv = vx * vx + vy * vy;
  const s = vv > 0 ? Math.min(1, Math.max(0, -(rx * vx + ry * vy) / vv)) : 1;
  return {
    ball: { x: ball.ax + (ball.bx - ball.ax) * s, y: ball.ay + (ball.by - ball.ay) * s },
    arrow: { x: arrow.ax + (arrow.bx - arrow.ax) * s, y: arrow.ay + (arrow.by - arrow.ay) * s },
  };
}

/** One projectile's stretch in the current substep: from (ax, ay) to (bx, by), and whether that is where it stops. */
interface Stretch { pr: ProjectileRuntime; ax: number; ay: number; bx: number; by: number; len: number; stop: ProjectileEnd | null }

/** The earliest point along a stretch within RANGED_HIT_REACH of `p`, as a share of the stretch, or null. */
function contactShare(s: Stretch, p: { x: number; y: number }): number | null {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const fx = s.ax - p.x;
  const fy = s.ay - p.y;
  const c = fx * fx + fy * fy - RANGED_HIT_REACH * RANGED_HIT_REACH;
  // Starting inside the reach counts only when heading into the body: an arrow loosed past someone overlapping the
  // shooter from behind doesn't hit them at the muzzle.
  if (c <= 0) return fx * dx + fy * dy <= 0 ? 0 : null;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const u = (-b - Math.sqrt(disc)) / (2 * a);
  return u >= 0 && u <= 1 ? u : null;
}

/**
 * The first standing body (not the owner) the stretch meets at substep time `t`, and the contact point. Bodies met at
 * the same point (both already within reach when the step began) go by whose centre is nearer the stretch's start,
 * then by the tick's secret rank, never by join order. A mob's shot flies past other mobs (they never hurt each other),
 * so a camp's archers don't eat their own arrows and a player can't hide behind a camp-mate.
 */
function firstBody(
  world: World, s: Stretch, bodies: readonly Combatant[], t: number, rank: ReadonlyMap<string, number>,
): { c: Combatant; x: number; y: number } | null {
  let best: { c: Combatant; u: number; d: number; r: number } | null = null;
  const mobShot = world.mobs.has(s.pr.owner);
  for (const c of bodies) {
    if (c.id === s.pr.owner || (mobShot && c.kind === "mob")) continue;
    const at = positionAt(c.rt, c.s, t);
    const u = contactShare(s, at);
    if (u === null) continue;
    const d = Math.hypot(at.x - s.ax, at.y - s.ay);
    const r = rank.get(c.id) ?? Infinity;
    if (!best || u < best.u || (u === best.u && (d < best.d || (d === best.d && r < best.r)))) best = { c, u, d, r };
  }
  if (!best) return null;
  return { c: best.c, x: s.ax + (s.bx - s.ax) * best.u, y: s.ay + (s.by - s.ay) * best.u };
}

/**
 * The sweep phase: every projectile flies from where it was to the present, PROJECTILE_SUBSTEP_MS at a time. Bodies are
 * the fighters standing when the sweep starts (this tick's damage lands only after melee).
 */
export function sweepProjectiles(world: World, dtMs: number): void {
  world.combat.swept = [];
  if (world.projectiles.size === 0) return;
  const now = world.state.serverTime;
  const map = collisionMap(world);
  const bodies = standingCombatants(world);
  const active = [...world.projectiles.values()];
  for (const pr of active) {
    pr.tickX = pr.x;
    pr.tickY = pr.y;
    world.combat.swept.push(pr);
  }
  const steps = Math.max(1, Math.round(dtMs / PROJECTILE_SUBSTEP_MS));
  for (let k = 1; k <= steps; k++) {
    const t = now - dtMs + (dtMs * k) / steps;
    const stretches: Stretch[] = [];
    for (const pr of active) {
      // A reflection made in this substep starts moving in the next one.
      if (pr.ended || pr.simT >= t) continue;
      const st = pr.state;
      const dt = (t - pr.simT) / 1000;
      let bx = pr.x + st.vx * dt;
      let by = pr.y + st.vy * dt;
      let len = Math.hypot(bx - pr.x, by - pr.y);
      let stop: ProjectileEnd | null = null;
      const left = st.range - pr.traveled;
      if (len >= left) {
        const f = len > 0 ? left / len : 0;
        bx = pr.x + (bx - pr.x) * f;
        by = pr.y + (by - pr.y) * f;
        len = left;
        stop = "range";
      }
      const wall = raycast(map, pr.x, pr.y, bx, by);
      if (wall.hit) {
        bx = wall.x;
        by = wall.y;
        len = wall.dist;
        stop = "wall";
      }
      stretches.push({ pr, ax: pr.x, ay: pr.y, bx, by, len, stop });
    }
    for (const ball of stretches) {
      if (ball.pr.kind !== "ball" || ball.pr.ended) continue;
      for (const arrow of stretches) {
        if (arrow.pr.kind !== "arrow" || arrow.pr.ended || arrow.pr.owner === ball.pr.owner) continue;
        // Tested where they came closest, not only where the substep ends (head on they close 13 u per substep), and
        // never around a wall corner.
        const at = closestApproach(ball, arrow);
        if (ballDeletesArrow(at.ball, at.arrow) && !raycast(map, at.ball.x, at.ball.y, at.arrow.x, at.arrow.y).hit) {
          endProjectile(world, arrow.pr, at.arrow.x, at.arrow.y, "deleted");
        }
      }
    }
    for (const s of stretches) {
      const pr = s.pr;
      if (pr.ended) continue;
      const hit = firstBody(world, s, bodies, t, world.combat.rank);
      if (!hit) {
        pr.x = s.bx;
        pr.y = s.by;
        pr.traveled += s.len;
        pr.simT = t;
        if (s.stop) endProjectile(world, pr, s.bx, s.by, s.stop);
        continue;
      }
      const st = pr.state;
      if (pr.kind === "arrow" && activeWeapon(hit.c.s) === "shield" && projectileOnShieldFront(hit.c.s.facing, st.vx, st.vy)) {
        endProjectile(world, pr, hit.x, hit.y, "reflected");
        const v = reflectVelocity(st.vx, st.vy, hit.c.s.facing);
        const bow = WEAPONS.bow.shape;
        // A first reflection flies the full bow range; an arrow already reflected keeps only what it has left, so two
        // shields facing each other can't bounce one forever.
        const left = st.range - pr.traveled - Math.hypot(hit.x - s.ax, hit.y - s.ay);
        const range = pr.weapon === "shield" ? Math.max(0, left) : bow.kind === "projectile" ? bow.range : st.range;
        active.push(launch(world, {
          kind: "arrow", weapon: "shield", owner: hit.c.id, ownerName: hit.c.s.name, x: hit.x, y: hit.y,
          vx: v.vx, vy: v.vy, t, range, packet: pr.packet,
        }));
        emit(world, { type: "fx", fx: { kind: "block", id: hit.c.id, by: pr.owner, weapon: pr.weapon } });
        continue;
      }
      recordHit(world, {
        victim: hit.c.id, by: { id: pr.owner, name: pr.ownerName }, packet: pr.packet, weapon: pr.weapon,
        projectile: pr.id, stagger: false,
      });
      endProjectile(world, pr, hit.x, hit.y, "hit");
    }
  }
}

/** The balls not owned by `ownerId` that flew (or were loosed) this tick: what a swing landing now can meet. */
export function ballsThisTick(world: World, ownerId: string): ProjectileRuntime[] {
  return world.combat.swept.filter((pr) => pr.kind === "ball" && pr.owner !== ownerId);
}

/**
 * A swing met `ball` this tick. "destroy" stops it and cancels any hit it already made this tick; a scale (the sword's
 * SWORD_BALL_SCALE) applies to its damage from now on and to a hit it made this tick, once per ball.
 */
export function interceptBall(world: World, ball: ProjectileRuntime, how: { scale: number } | "destroy"): void {
  if (how === "destroy") {
    for (const e of world.combat.ledger) if (e.projectile === ball.id) e.scale = 0;
    endProjectile(world, ball, ball.x, ball.y, "destroyed");
    return;
  }
  if (ball.halved) return;
  ball.halved = true;
  // A new packet: the ledger entry of a hit this tick shares the old object and is scaled on its own.
  ball.packet = { ...ball.packet, raw: ball.packet.raw * how.scale };
  for (const e of world.combat.ledger) if (e.projectile === ball.id) e.scale *= how.scale;
}
