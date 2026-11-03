// The walk hint (docs/PLAYER_PREDICTION.md Stage 2): two presentation mirrors per player, PlayerExtraState.walkDir and walkTicks,
// written from the path in hand after the tick's movement. A client draws a remote player up to one tick past its newest sample
// while walkTicks >= 1 (client net/remoteDraw.ts). Presentation only: nothing in the sim reads them, and this system only reads the
// world. The move modifiers are asked with a step of 0 (as trace.ts asks them) so the bog counts no second twice, and the vision
// queries `lockable` makes repeat, at the same server time and position, what this tick's refreshVision already did.
//
// walkTicks is a lower bound: the whole ticks the server will keep walking along walkDir at the current speed, unless a new order
// or another fighter's act intervenes (deliberately not modelled: the client absorbs those as corrections). It stops at the
// waypoint, at the weapon's known and imminent roots and at ice, and a target lock's or an attack-move's walk is replayed exactly
// for the next tick only and capped there.
import {
  decide, decodeMult, encodeWalkDir, hasLineOfSight, hasteMultiplier, lockSpacing, MASK_SIGHT, MOVE_MULT_FLOOR, PLAYER_SPEED,
  RANGED_RELEASE_PAUSE_MS, reachMask, SENTENCED_HUNT_MOVE_BONUS, TARGET_LOS_GRACE_MS, TARGET_REPATH_MS, TICK_MS, WALK_DIR_HYSTERESIS,
  WALK_HINT_MAX_TICKS, type WeaponTimings,
} from "@raid/shared";
import { activeWeapon, allCombatants, combatant, hostile, isEvading, standing, timingsOf, type Combatant } from "./combatant";
import { velocityOf } from "./movement";
import { cannotMove, isHidden, isUntargetable, isUntargetableAt, statusValue } from "./status";
import { GOAL_MOVED, lockable } from "./targeting";
import { slipAccelAt, slipAccelOf } from "./terrainEffects";
import { TIE_EPS_MS } from "./weapons";
import { chainHook, collisionMap, type World } from "./world";

type PlayerCombatant = Extract<Combatant, { kind: "player" }>;

export interface WalkHint { dir: number; ticks: number }

/**
 * Over the hint's ticks the speed mirror may still rise a little (Fire's roaming charge ramps 0.125% a tick): the waypoint test
 * reads a step this much longer, so it never claims a tick that reaches the waypoint.
 */
const SPEED_SLACK = 1.01;
/** Ice is looked for along the next steps at least this often (u), so a thin strip cannot be stepped over. */
const ICE_PROBE_U = 8;

export function install(world: World): void {
  world.systems.push(updateWalkHints);
  // The teleport and the run's end come in settle(), after the systems, and clear every path: a stale walkTicks must not ride their patch.
  chainHook(world, "teleported", zeroAll);
  chainHook(world, "runEnded", zeroAll);
}

function zeroAll(world: World): void {
  for (const p of world.state.players.values()) if (p.extra.walkTicks !== 0) p.extra.walkTicks = 0;
}

/** Writes each player's hint, each field only when its value changed (an idle or still fighter patches nothing). */
export function updateWalkHints(world: World): void {
  for (const [id, p] of world.state.players) {
    const rt = world.players.get(id);
    if (!rt) continue;
    const { dir, ticks } = walkHintOf(world, { kind: "player", id, s: p, rt });
    const x = p.extra;
    if (ticks > 0) {
      if (x.walkTicks === 0) {
        if (x.walkDir !== dir) x.walkDir = dir;
      } else {
        const d = Math.abs(dir - x.walkDir);
        if (Math.min(d, 256 - d) >= WALK_DIR_HYSTERESIS) x.walkDir = dir;
      }
    }
    if (x.walkTicks !== ticks) x.walkTicks = ticks;
  }
}

const ZERO: WalkHint = { dir: 0, ticks: 0 };

/** The hint for one player, from the state after this tick's movement: it speaks of the ticks at now + j x TICK_MS. */
export function walkHintOf(world: World, c: PlayerCombatant): WalkHint {
  const now = world.state.serverTime;
  const p = c.s;
  const rt = c.rt;
  if (world.state.phase !== "active" || !standing(c) || isEvading(c) || isHidden(world, c) || cannotMove(world, c)) return ZERO;
  if (rt.slip != null || slipAccelOf(world, c) !== 0) return ZERO;
  const q = rt.path[0];
  if (!q) return ZERO;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1e-3) return ZERO;
  const ux = dx / segLen;
  const uy = dy / segLen;

  let m = world.moveModifiers.reduce((acc, mod) => acc * mod(world, c, 0), 1);
  if (m > 0 && m < MOVE_MULT_FLOOR) m = MOVE_MULT_FLOOR;
  if (!(m > 0)) return ZERO;
  // The most the walk can be multiplied by over the next ticks barring an order or another fighter's act: slows, chill, bog and a
  // zone only end; the mirror holds the buffs; haste only ends; the hunt bonus may switch on as the hunted fighter moves.
  const speed = decodeMult(p.speedMult);
  const haste = statusValue(world, c, "haste");
  const huntUp = p.faction === "sentenced" && p.huntTarget !== "" ? 1 + SENTENCED_HUNT_MOVE_BONUS : 1;
  const mUpper = Math.max(m, speed * huntUp * (haste > 0 ? hasteMultiplier(speed, haste) : 1), 1) * SPEED_SLACK;
  const step = (PLAYER_SPEED * mUpper * TICK_MS) / 1000;

  const weapon = activeWeapon(p);
  const tm = weapon ? timingsOf(p, weapon) : null;
  const w = rt.weapon;
  const locked = w.lock !== null;
  const amove = !locked && w.attackMoveGoal !== null && weapon === "wand";
  let heldNext: boolean | undefined;
  if (locked) {
    const r = lockNext(world, c, now + TICK_MS);
    if (!r.free) return ZERO;
    heldNext = r.hold;
  }
  if (amove && acquireNext(world, c, now + TICK_MS)) return ZERO;

  let ticks = 0;
  const cap = locked || amove ? 1 : WALK_HINT_MAX_TICKS;
  for (let j = 1; j <= cap; j++) {
    const at = now + j * TICK_MS;
    // Tick j reaches path[0] and may turn there.
    if (j * step > segLen + 1e-6) break;
    if (heldAt(c, now, at, tm, j === 1 ? heldNext : undefined)) break;
    if (iceAlong(world, c, ux, uy, j * step)) break;
    ticks = j;
  }
  if (ticks === 0) return ZERO;
  return { dir: encodeWalkDir(Math.atan2(dy, dx)), ticks };
}

/** moveMultiplierOf's rule (sim/weapons.ts) evaluated at a future tick `at`: the root a weapon already imposes then. */
export function weaponHoldsAt(c: Combatant, at: number): boolean {
  const w = c.rt.weapon;
  if (at < w.rootUntil) return true;
  if (w.action && at + TIE_EPS_MS < w.action.landsAt) return w.action.kind === "swing" || at >= w.action.landsAt - RANGED_RELEASE_PAUSE_MS;
  return false;
}

/**
 * Is tick `at`'s walk held by what the server already knows: the weapon's root now, or the root of the attack a held (or buffered)
 * trigger starts as soon as the cooldown allows, counted from the earliest start it could have (so it errs on the held side). An
 * attack not started yet starts no earlier than `now`: one that could have started by now would have.
 */
function heldAt(c: PlayerCombatant, now: number, at: number, tm: WeaponTimings | null, heldOverride: boolean | undefined): boolean {
  if (weaponHoldsAt(c, at)) return true;
  if (!tm || (tm.windup <= 0 && tm.root <= 0)) return false;
  const w = c.rt.weapon;
  const held = heldOverride ?? w.held;
  if (!(held || w.bufferedUntil >= c.s.readyAt)) return false;
  const start = Math.max(c.s.readyAt, w.action ? w.action.landsAt : 0, now);
  const holdFrom = start + (tm.ranged ? Math.max(0, tm.windup * 1000 - RANGED_RELEASE_PAUSE_MS) : 0);
  return at >= holdFrom - TIE_EPS_MS;
}

/** Slippery ground anywhere along the next `dist` of the walk (sampled at most ICE_PROBE_U apart, both ends included). */
function iceAlong(world: World, c: PlayerCombatant, ux: number, uy: number, dist: number): boolean {
  const n = Math.max(1, Math.ceil(dist / ICE_PROBE_U));
  for (let i = 1; i <= n; i++) {
    const d = (dist * i) / n;
    if (slipAccelAt(world, c, c.s.x + ux * d, c.s.y + uy * d) !== 0) return true;
  }
  return false;
}

/**
 * targeting.ts `follow` for the tick at `at`, replayed on the present state (which is what it reads then: nobody moves before it):
 * free when the lock keeps its path (no drop, no stop, no re-plan), with the trigger it will hold.
 */
function lockNext(world: World, c: PlayerCombatant, at: number): { free: boolean; hold: boolean } {
  const w = c.rt.weapon;
  const p = c.s;
  const t = w.lock === null ? null : combatant(world, w.lock);
  const tm = activeWeapon(p) === "wand" ? timingsOf(p, "wand") : null;
  // Its hiding may come back (a reveal window ending) by then: the lock drops.
  if (!t || !tm || !lockable(world, c, t) || isUntargetableAt(t, at)) return { free: false, hold: false };
  const map = collisionMap(world);
  const seen = hasLineOfSight(map, p, t.s);
  const reach = reachMask("wand");
  const clear = reach === MASK_SIGHT ? seen : seen && hasLineOfSight(map, p, t.s, reach);
  if (!seen && w.lockSeen && w.lockLosLostAt > 0 && at - w.lockLosLostAt >= TARGET_LOS_GRACE_MS) return { free: false, hold: false };
  const out = decide({
    self: { x: p.x, y: p.y }, target: { x: t.s.x, y: t.s.y }, targetVel: velocityOf(t.rt, t.s, at), los: clear, weapon: "wand",
    ready: at >= p.readyAt, windup: tm.windup, spacing: lockSpacing("wand"),
  });
  if (out.move === "stop") return { free: false, hold: false };
  if (out.move !== null) {
    const goal = out.move;
    const moved = w.lockGoal === null || Math.hypot(goal.x - w.lockGoal.x, goal.y - w.lockGoal.y) > GOAL_MOVED;
    if ((moved || c.rt.path.length === 0) && at - w.lockPlanAt >= TARGET_REPATH_MS) return { free: false, hold: false };
  }
  return { free: true, hold: out.hold };
}

/**
 * targeting.ts `acquireAttackMoveTarget`'s own test on the present state: would the attack-move lock someone next tick? A fighter
 * hidden now whose reveal window opens by then (its own attack or cast this tick) counts, one shown now whose hiding comes back
 * does not.
 */
function acquireNext(world: World, c: PlayerCombatant, at: number): boolean {
  const range = lockSpacing("wand").attackRange;
  const map = collisionMap(world);
  for (const cand of allCombatants(world)) {
    if (Math.hypot(cand.s.x - c.s.x, cand.s.y - c.s.y) > range || isUntargetableAt(cand, at)) continue;
    const now = lockable(world, c, cand) || (isUntargetable(world, cand) && standing(cand) && hostile(c, cand));
    if (now && hasLineOfSight(map, c.s, cand.s)) return true;
  }
  return false;
}
