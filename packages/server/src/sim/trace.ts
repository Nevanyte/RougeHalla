// The movement trace: one row per standing player per active tick, the data a "predict the next movement" model is trained
// and scored on (sim/predictBaselines.ts, bench/predictBench.ts). Pure: rows go to the caller's sink and nothing here does I/O
// (RaidRoom writes them as JSONL when TRACE_INPUTS is set). It reads the world after the tick's damage and changes nothing.
import { MOVE_MULT_FLOOR, RANGED_RELEASE_PAUSE_MS, type Vec2, type WeaponId } from "@raid/shared";
import type { MobState, PlayerState } from "@raid/shared/schema";
import { moveSpeedMult } from "./buffs";
import { activeWeapon, standing, type Combatant } from "./combatant";
import type { ActionCommand, DrainedInputs } from "./inputs";
import { velocityOf } from "./movement";
import { cannotMove, isCasting } from "./status";
import { moveMultiplierOf } from "./weapons";
import { chainHook, type CombatRuntime, type World } from "./world";

/** How much of the path ahead a row carries (u): far more than a walk covers within any horizon worth predicting. */
export const TRACE_PATH_REACH = 600;
/** ...and at most this many of its waypoints. */
export const TRACE_PATH_POINTS = 16;

/**
 * An order the player sent that the tick applied, in arrival order. Positions are world units, angles radians. Every action kind
 * beyond the four with a payload of its own is recorded by kind alone, so a new one needs no edit here.
 */
export type TraceOrder =
  | { k: "move" | "attackMove"; x: number; y: number }
  | { k: "stop" }
  | { k: "aim" | "attack" | "release"; a: number }
  | { k: "target"; id: string }
  | { k: "cast"; slot: string; x: number; y: number; id?: string }
  | { k: Exclude<ActionCommand["kind"], "attack" | "release" | "target" | "cast"> };

/** The nearest standing enemy (player or mob), relative to the row's player. */
export interface TraceEnemy { id: string; kind: "player" | "mob"; dx: number; dy: number; vx: number; vy: number }

/** One player at the end of one active tick (after movement and damage, before the tick settles). Times are server ms. */
export interface TraceRow {
  /** The run (a room id): player ids are only unique within one. */
  run: string;
  tick: number;
  serverTime: number;
  id: string;
  faction: string;
  /** The weapon in hand: "fists" for an empty hand. */
  weapon: WeaponId | null;
  /** A server-filled bot: a live trace mixes scripted and human movement, so rows must be separable. */
  bot: boolean;
  x: number;
  y: number;
  facing: number;
  /** Velocity over the last 100 ms of recorded positions (movement.ts velocityOf), u/s. */
  vx: number;
  vy: number;
  /** The walk in hand: its final waypoint, the length still to walk from (x, y), and its leading waypoints (TRACE_PATH_REACH). */
  pathEnd: Vec2 | null;
  pathLen: number;
  path: Vec2[];
  /** The position changed this tick (the last two recorded positions differ). A forced move resets the history, so it never counts. */
  walkedThisTick: boolean;
  /** On ice the walk is the shared slide, not the path, so a path-following prediction is wrong there. */
  slip: boolean;
  /** The weapon's attack winding up (it roots the fighter; a ranged one only for its last RANGED_RELEASE_PAUSE_MS). */
  action: { kind: "swing" | "cast" | "draw"; landsAt: number } | null;
  /** The walk is held this tick (a windup, the axe's root, a stun, a root, a cast with a cast time). */
  rooted: boolean;
  /** The known root ahead, as one window [rootFrom, rootUntil] (null: none known). */
  rootFrom: number | null;
  rootUntil: number | null;
  /** PlayerState.attackTarget, or null. */
  lock: string | null;
  /** hp / maxHp. */
  hp: number;
  /** The last time the player landed or took a hit (any ledger entry that got through, damage over time included). */
  lastHitAt: number | null;
  enemy: TraceEnemy | null;
  /** PlayerState.effects (the EFFECT_* bits). */
  effects: number;
  /** The decoded speedMult mirror (buffs and passives). */
  speedMult: number;
  /** Every world.moveModifiers entry multiplied, floored as step.ts floors it (the mirror, the chill, slows, haste, bog; 0 under a stun, root or cast). Not the weapon's root. */
  walkMult: number;
  /** PlayerState.displaceSeq: it changes on a blink or other forced move (the coliseum teleport does not change it). */
  displaceSeq: number;
  orders: TraceOrder[];
}

export interface TraceOptions {
  /** Written into every row's `run` (default ""). */
  run?: string;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Starts recording `world`'s active ticks into `sink`: a system appended to world.systems (so it runs after every module's,
 * the stat mirrors' fold included) and the inputsApplied hook for the orders. The lobby and planning ticks run no systems,
 * so nothing is recorded there.
 */
export function installTrace(world: World, sink: (row: TraceRow) => void, opts: TraceOptions = {}): void {
  const run = opts.run ?? "";
  const orders = new Map<string, TraceOrder[]>();
  const lastHitAt = new Map<string, number>();

  chainHook(world, "inputsApplied", (_w, c, drained) => {
    if (c.kind !== "player") return;
    const list = ordersOf(drained);
    if (list.length > 0) orders.set(c.id, list);
  });

  world.systems.push((w) => {
    const s = w.state;
    const now = s.serverTime;
    for (const h of w.combat.landed) {
      if (w.players.has(h.by)) lastHitAt.set(h.by, now);
      if (w.players.has(h.victim)) lastHitAt.set(h.victim, now);
    }
    for (const [id, p] of s.players) {
      const rt = w.players.get(id);
      if (!rt) continue;
      const c: Combatant = { kind: "player", id, s: p, rt };
      if (!standing(c)) continue;
      sink(rowOf(w, c, run, orders.get(id) ?? [], lastHitAt.get(id) ?? null));
    }
    orders.clear();
  });
}

/** The drained inputs in the order they arrived (the move and the aim slot in before actions[moveBefore] and actions[aimBefore]). */
export function ordersOf(d: Readonly<DrainedInputs>): TraceOrder[] {
  const out: TraceOrder[] = [];
  const n = d.actions.length;
  for (let i = 0; i <= n; i++) {
    if (d.move !== null && i === Math.min(d.moveBefore, n)) {
      const m = d.move;
      out.push(m.kind === "stop" ? { k: "stop" } : { k: m.kind, x: r2(m.x), y: r2(m.y) });
    }
    if (d.aim !== null && i === Math.min(d.aimBefore, n)) out.push({ k: "aim", a: r3(d.aim) });
    const a = d.actions[i];
    if (!a) continue;
    switch (a.kind) {
      case "attack": case "release": out.push({ k: a.kind, a: r3(a.a) }); break;
      case "target": out.push({ k: "target", id: a.id }); break;
      case "cast": out.push(a.id !== undefined
        ? { k: "cast", slot: a.slot, x: r2(a.x), y: r2(a.y), id: a.id }
        : { k: "cast", slot: a.slot, x: r2(a.x), y: r2(a.y) }); break;
      default: out.push({ k: a.kind });
    }
  }
  return out;
}

function rowOf(world: World, c: Extract<Combatant, { kind: "player" }>, run: string, orders: TraceOrder[], lastHitAt: number | null): TraceRow {
  const s = world.state;
  const now = s.serverTime;
  const p = c.s;
  const w = c.rt.weapon;
  const v = velocityOf(c.rt, p, now);
  const walk = pathOf(p, c.rt.path);
  const root = rootWindow(c, now);
  return {
    run,
    tick: s.tick,
    serverTime: now,
    id: c.id,
    faction: p.faction,
    weapon: activeWeapon(p),
    bot: p.bot,
    x: r2(p.x),
    y: r2(p.y),
    facing: r3(p.facing),
    vx: r2(v.x),
    vy: r2(v.y),
    pathEnd: walk.end,
    pathLen: walk.len,
    path: walk.lead,
    walkedThisTick: walkedThisTick(c.rt),
    slip: c.rt.slip != null,
    action: w.action ? { kind: w.action.kind, landsAt: w.action.landsAt } : null,
    rooted: moveMultiplierOf(world, c) === 0 || cannotMove(world, c),
    rootFrom: root ? root.from : null,
    rootUntil: root ? root.until : null,
    lock: p.attackTarget !== "" ? p.attackTarget : null,
    hp: p.maxHp > 0 ? r3(p.hp / p.maxHp) : 0,
    lastHitAt,
    enemy: nearestEnemy(world, c, now),
    effects: p.effects,
    speedMult: moveSpeedMult(world, c),
    walkMult: r3(walkMultOf(world, c)),
    displaceSeq: p.displaceSeq,
    orders,
  };
}

/**
 * The modifiers' product as step.ts floors it (without the weapon's root, which `rooted` and the root window carry). The modifiers
 * are called with a step of 0: terrainEffects' bog counts `dtMs` into world.hazards.stats, and the default step would count that
 * fighter-second a second time.
 */
function walkMultOf(world: World, c: Combatant): number {
  const m = world.moveModifiers.reduce((acc, mod) => acc * mod(world, c, 0), 1);
  return m > 0 && m < MOVE_MULT_FLOOR ? MOVE_MULT_FLOOR : m;
}

/** History is recorded in the movement phase of the tick, so its last two samples are this tick's step. */
function walkedThisTick(rt: CombatRuntime): boolean {
  const h = rt.history;
  if (h.length < 2) return false;
  const a = h[h.length - 2]!;
  const b = h[h.length - 1]!;
  return Math.abs(b.x - a.x) > 1e-6 || Math.abs(b.y - a.y) > 1e-6;
}

function pathOf(from: Vec2, path: readonly Vec2[]): { end: Vec2 | null; len: number; lead: Vec2[] } {
  if (path.length === 0) return { end: null, len: 0, lead: [] };
  const lead: Vec2[] = [];
  let len = 0;
  let prev = from;
  for (const q of path) {
    if (len <= TRACE_PATH_REACH && lead.length < TRACE_PATH_POINTS) lead.push({ x: r2(q.x), y: r2(q.y) });
    len += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  const end = path[path.length - 1]!;
  return { end: { x: r2(end.x), y: r2(end.y) }, len: r2(len), lead };
}

/**
 * The root ahead that is already known, merged into one window: the weapon's windup (a swing from now, a cast or a draw only
 * for the pause before its release), the axe's root, a stun or root status, and a cast with a cast time. Null when none.
 */
function rootWindow(c: Combatant, now: number): { from: number; until: number } | null {
  let from = Infinity;
  let until = -Infinity;
  const add = (a: number, b: number): void => {
    if (!(b > now)) return;
    from = Math.min(from, Math.max(a, now));
    until = Math.max(until, b);
  };
  const w = c.rt.weapon;
  if (w.action) add(w.action.kind === "swing" ? now : w.action.landsAt - RANGED_RELEASE_PAUSE_MS, w.action.landsAt);
  add(now, w.rootUntil);
  for (const st of c.rt.statuses ?? []) if (st.kind === "stun" || st.kind === "root") add(now, st.until);
  if (isCasting(c) && c.rt.cast) add(now, c.rt.cast.landsAt);
  return until > now ? { from, until } : null;
}

/**
 * The nearest standing fighter `c` may attack: another player, or any mob but a quest giver or its own Plague zombie. Allocation-free
 * until the winner.
 */
function nearestEnemy(world: World, c: Combatant, now: number): TraceEnemy | null {
  let best: { id: string; kind: "player" | "mob"; s: PlayerState | MobState; rt: CombatRuntime } | null = null;
  let bestD = Infinity;
  for (const [id, s] of world.state.players) {
    if (id === c.id || s.status !== "alive") continue;
    const rt = world.players.get(id);
    if (!rt || rt.down || rt.resolved) continue;
    const d = Math.hypot(s.x - c.s.x, s.y - c.s.y);
    if (d < bestD) { bestD = d; best = { id, kind: "player", s, rt }; }
  }
  for (const [id, s] of world.state.mobs) {
    if (s.status !== "alive" || s.kind === "quest" || (s.kind === "zombie" && s.ownerId === c.id)) continue;
    const rt = world.mobs.get(id);
    if (!rt) continue;
    const d = Math.hypot(s.x - c.s.x, s.y - c.s.y);
    if (d < bestD) { bestD = d; best = { id, kind: "mob", s, rt }; }
  }
  if (!best) return null;
  const v = velocityOf(best.rt, best.s, now);
  return { id: best.id, kind: best.kind, dx: r2(best.s.x - c.s.x), dy: r2(best.s.y - c.s.y), vx: r2(v.x), vy: r2(v.y) };
}
