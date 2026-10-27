// Projectiles. An arrow or a ball is announced once when loosed (a ProjectileLaunch: kind, start, velocity, time, range;
// rooms/FxChannel.ts puts it in the `fxs` batch of that step) and never updated: every client computes its straight flight
// from that. It is not in the synced state, only in `world.projectiles`. The server flies each one in present time, in
// PROJECTILE_SUBSTEP_MS steps. In each step, in this order:
//   1. it moves, stopping at a wall (collisionMap: closed gates block) or at the end of its range;
//   2. a ball deletes every enemy arrow that came within BALL_ARROW_RADIUS of it during the step, in line of sight, and
//      keeps BALL_AFTER_ARROW of its damage for each arrow it deleted;
//   3. it meets the first body along its step whose centre, where that body was at that moment (history), comes within
//      RANGED_HIT_REACH. An arrow on a raised shield's front is reflected: it stops, and a new arrow owned by the holder
//      flies on from the contact point with the mirrored velocity, the full bow range (an arrow reflected before keeps
//      only the range it has left) and ARROW_REFLECT_SHARE of the damage, the holder taking the rest as a normal hit; one
//      already reflected MAX_ARROW_REFLECTIONS times is just blocked. Anything else is a hit, recorded in the damage ledger and applied with every other hit after melee.
// When it stops it leaves `world.projectiles`, and a `projEnd` fx says exactly where and why. Its owner is never hit by
// it. It outlives its owner: its hit still lands (credited by name only once the owner has left or is out of the run).
// Projectiles loosed this tick (spawnProjectiles, after the sweep) leave from where the owner's client drew it and
// first move in the next tick's sweep.
import {
  ARROW_REFLECT_SHARE, ballDeletesArrow, BALL_AFTER_ARROW, MAX_ARROW_REFLECTIONS, PROJECTILE_SUBSTEP_MS, projectileOnShieldFront,
  RANGED_HIT_REACH, raycast, reflectVelocity,
  WEAPONS, type ProjectileEnd, type ProjectileKind, type Vec2, type WeaponId,
} from "@raid/shared";
import { activeWeapon, combatant, isEvading, isQuestGiver, standingCombatants, type Combatant } from "./combatant";
import { recordHit } from "./ledger";
import { returnedMultOf } from "./mods";
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
  reflections?: number;
}

function launch(world: World, l: Launch): ProjectileRuntime {
  const id = nextId(world, "p");
  const pr: ProjectileRuntime = {
    id, launch: { id, kind: l.kind, x: l.x, y: l.y, vx: l.vx, vy: l.vy, t: l.t, range: l.range },
    kind: l.kind, weapon: l.weapon, owner: l.owner, ownerName: l.ownerName,
    x: l.x, y: l.y, simT: l.t, traveled: 0, tickX: l.x, tickY: l.y, packet: l.packet, halved: false, ended: false,
    reflections: l.reflections ?? 0,
  };
  world.projectiles.set(id, pr);
  world.combat.swept.push(pr);
  return pr;
}

/** Stops `pr` at (x, y): out of `world.projectiles`, and a projEnd fx. A no-op for one already stopped. */
export function endProjectile(world: World, pr: ProjectileRuntime, x: number, y: number, reason: ProjectileEnd): void {
  if (pr.ended) return;
  pr.ended = true;
  pr.x = x;
  pr.y = y;
  world.projectiles.delete(pr.id);
  const st = pr.launch;
  emit(world, {
    type: "fx", fx: { kind: "projEnd", id: pr.id, proj: pr.kind, x0: st.x, y0: st.y, t0: st.t, x, y, reason },
  });
}

export function clearProjectiles(world: World, reason: ProjectileEnd): void {
  for (const pr of [...world.projectiles.values()]) endProjectile(world, pr, pr.x, pr.y, reason);
}

/** Stops every projectile in flight that `owners` loosed (the training console's clear: a practice mob is gone, its shots go with it). */
export function clearProjectilesOf(world: World, owners: ReadonlySet<string>, reason: ProjectileEnd): void {
  if (owners.size === 0) return;
  for (const pr of [...world.projectiles.values()]) if (owners.has(pr.owner)) endProjectile(world, pr, pr.x, pr.y, reason);
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
      vx: Math.cos(req.a) * shape.speed, vy: Math.sin(req.a) * shape.speed, t: now, range: shape.range * (req.rangeMult ?? 1), packet: req.packet,
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
 * so a camp's archers don't eat their own arrows and a player can't hide behind a camp-mate. Every shot passes quest givers.
 */
function firstBody(
  world: World, s: Stretch, bodies: readonly Combatant[], t: number, rank: ReadonlyMap<string, number>,
): { c: Combatant; x: number; y: number } | null {
  let best: { c: Combatant; u: number; d: number; r: number } | null = null;
  const mobShot = world.mobs.has(s.pr.owner);
  for (const c of bodies) {
    if (c.id === s.pr.owner || (mobShot && c.kind === "mob") || isEvading(c) || isQuestGiver(c)) continue;
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
      const st = pr.launch;
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
          // Deleting an arrow costs the ball part of its damage (balance pass).
          ball.pr.packet = { ...ball.pr.packet, raw: ball.pr.packet.raw * BALL_AFTER_ARROW };
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
      const st = pr.launch;
      if (pr.kind === "arrow" && activeWeapon(hit.c.s) === "shield" && projectileOnShieldFront(hit.c.s.facing, st.vx, st.vy)) {
        const block = { kind: "block" as const, id: hit.c.id, by: pr.owner, weapon: pr.weapon };
        emit(world, { type: "fx", fx: pr.weapon === "shield" ? { ...block, passive: true } : block });
        if (pr.reflections >= MAX_ARROW_REFLECTIONS) {
          endProjectile(world, pr, hit.x, hit.y, "blocked");
          const shooter = combatant(world, pr.owner);
          if (shooter) world.hooks.blocked?.(world, hit.c, shooter, pr.packet, false);
          continue;
        }
        endProjectile(world, pr, hit.x, hit.y, "reflected");
        const shooter = combatant(world, pr.owner);
        if (shooter) world.hooks.blocked?.(world, hit.c, shooter, { ...pr.packet, raw: pr.packet.raw * ARROW_REFLECT_SHARE }, false);
        // The shield returns only ARROW_REFLECT_SHARE of the arrow; the holder takes the rest as a normal hit (balance pass). An arrow
        // that was reflected already (weapon "shield") is damage its owner returns: see returnedFlag.
        recordHit(world, {
          victim: hit.c.id, by: { id: pr.owner, name: pr.ownerName }, packet: returnedPacket(world, pr, pr.packet.raw * (1 - ARROW_REFLECT_SHARE)),
          weapon: pr.weapon, projectile: pr.id, stagger: false, ...returnedFlag(pr),
        });
        const v = reflectVelocity(st.vx, st.vy, hit.c.s.facing);
        const bow = WEAPONS.bow.shape;
        // A first reflection flies the full bow range; an arrow already reflected keeps only what it has left, so two
        // shields facing each other can't bounce one forever.
        const left = st.range - pr.traveled - Math.hypot(hit.x - s.ax, hit.y - s.ay);
        const range = pr.weapon === "shield" ? Math.max(0, left) : bow.kind === "projectile" ? bow.range : st.range;
        active.push(launch(world, {
          kind: "arrow", weapon: "shield", owner: hit.c.id, ownerName: hit.c.s.name, x: hit.x, y: hit.y,
          vx: v.vx, vy: v.vy, t, range, packet: { ...pr.packet, raw: pr.packet.raw * ARROW_REFLECT_SHARE }, reflections: pr.reflections + 1,
        }));
        continue;
      }
      recordHit(world, {
        victim: hit.c.id, by: { id: pr.owner, name: pr.ownerName }, packet: returnedPacket(world, pr, pr.packet.raw), weapon: pr.weapon,
        projectile: pr.id, stagger: false, ...returnedFlag(pr),
      });
      splashFrom(world, pr, hit.c, bodies, t, map);
      endProjectile(world, pr, hit.x, hit.y, "hit");
    }
  }
}

/**
 * A reflected arrow (weapon "shield", owned by the holder) is damage RETURNED to its shooter, as a riposte is: its entry is `passive`
 * (kind "returned" for G1; it sets off no `hitTaken`, so a Spiked Shell on the archer never answers its own arrow, and counts as no hit of
 * the holder's for the streak, the on-hit effects or Wishful Thinking), and the holder's `returned` mult (Boom's x1.25) is in its packet.
 * Any other projectile is its shooter's hit as ever.
 */
const returnedFlag = (pr: ProjectileRuntime): { passive?: true } => (pr.weapon === "shield" ? { passive: true } : {});

function returnedPacket(world: World, pr: ProjectileRuntime, raw: number): DamagePacket {
  if (pr.weapon !== "shield") return raw === pr.packet.raw ? pr.packet : { ...pr.packet, raw };
  const owner = combatant(world, pr.owner);
  return { ...pr.packet, raw: owner ? raw * returnedMultOf(owner.s) : raw };
}

/**
 * The wand's special (WEAPONS.wand.special, BALANCE_CONTRACT 3.3): a ball that hit `primary` also hits every OTHER enemy within the
 * splash radius of it, for the splash share of the ball's damage. One ledger entry each, `derived` (a follow-on, not a hit of its own
 * for the cards) and carrying the ball's id, so a swing that halves or destroys the ball this tick scales the splash with it. The
 * primary is never hit twice, a mob's ball never reaches another mob (mobs never hurt each other), and a wall stops the splash.
 */
function splashFrom(
  world: World, pr: ProjectileRuntime, primary: Combatant, bodies: readonly Combatant[], t: number, map: ReturnType<typeof collisionMap>,
): void {
  const special = WEAPONS[pr.weapon].special;
  if (!special || special.kind !== "splash" || pr.kind !== "ball" || world.config.weaponSpecials === false) return;
  const centre = positionAt(primary.rt, primary.s, t);
  const mobShot = world.mobs.has(pr.owner);
  for (const c of bodies) {
    if (c.id === pr.owner || c.id === primary.id || isEvading(c) || isQuestGiver(c) || (mobShot && c.kind === "mob")) continue;
    const at = positionAt(c.rt, c.s, t);
    if (Math.hypot(at.x - centre.x, at.y - centre.y) > special.radius) continue;
    if (raycast(map, centre.x, centre.y, at.x, at.y).hit) continue;
    recordHit(world, {
      victim: c.id, by: { id: pr.owner, name: pr.ownerName }, packet: pr.packet, weapon: pr.weapon, projectile: pr.id, stagger: false,
      scale: special.share, derived: true,
    });
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
