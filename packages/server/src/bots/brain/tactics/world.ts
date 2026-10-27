// World tactics (docs/BOTS.md 4): the goals with no fight in them. LOOT walks to a container, holds still and presses F; ROAM
// walks to a point; HOLD stands at the coliseum (or an ambush spot); IDLE stands. It only ever emits move, stop and pickup, and
// it re-emits the move every think so a walk that the humanizer turns into edge or minimap clicks keeps going.
import { circleClear, COLISEUM_RING_RADIUS, inColiseum, INTERACT_RANGE, PLAYER_RADIUS, type Vec2 } from "@raid/shared";
import { uniform } from "../random";
import {
  PRIORITY, type BrainContext, type ContainerView, type Goal, type GoalStatus, type Intent, type IntentBody, type TacticsOutput,
} from "../types";

export type WorldGoal = Extract<Goal, { kind: "loot" | "roam" | "hold" | "idle" }>;

export interface WorldTactics {
  act(ctx: BrainContext, goal: WorldGoal): TacticsOutput;
}

/** Inside this distance of a container we start taking; a margin under INTERACT_RANGE for stale positions. */
const PICKUP_DISTANCE = INTERACT_RANGE - 12;
/** Standing this long (ms) before F: the server position has settled, a pickup from a stale one is refused as too far. */
const STILL_BEFORE_PICKUP_MS = 150;
const PICKUP_RETRY_MS = 400;
/** A detour that takes longer than this is dropped for good, so it can never stall the hunt. */
const LOOT_BUDGET_MS = 6_000;
const LOOT_ENEMY_DISTANCE = 240;
const LOOT_MOB_DISTANCE = 220;
const LOOT_MAX_FAILS = 2;
/** Behind a wall and farther than this, the walk is sent waypoint by waypoint. */
const WAYPOINT_FROM = 150;
/** Within this (u) of its destination a roam is over. */
const ARRIVE_DISTANCE = 48;
/** A hold has arrived this close: the click scatter is under it for most clicks, and `SETTLED_*` catches the rest. */
const HOLD_ARRIVE_DISTANCE = 24;
/** The hand can land short of a point (click scatter): a bot that has stood still this long this close is as near as it will get. */
const SETTLED_MS = 800;
const SETTLED_DISTANCE = 120;
const ROAM_SETTLED_MS = 1_200;
const ROAM_SETTLED_DISTANCE = 150;
/** A stop that did not take (the bot still moves) is sent again after this long. */
const STOP_RESEND_MS = 800;
/** The coliseum point is crowded when another fighter stands this close to it. */
const CROWDED_DISTANCE = 160;
/** A goal not run for this long starts afresh when it comes back. */
const STALE_MS = 3_000;
const HOLD_SPOT_STEPS = 24;
const HOLD_SPOT_JITTER = 48;

interface Slot {
  lastActAt: number;
}

interface LootState extends Slot {
  startedAt: number;
  /** The last percept whose events were counted (act can run twice on one percept). */
  lastNow: number;
  carriedAtStart: number;
  stopAt: number | null;
  pickupAt: number | null;
  fails: number;
  final: GoalStatus | null;
}

interface HoldState extends Slot {
  stopAt: number | null;
  spot: Vec2 | null;
}

interface IdleState extends Slot {
  stopAt: number | null;
}

type State = LootState | HoldState | IdleState;

export function createWorldTactics(): WorldTactics {
  const states = new Map<string, State>();

  function slot<T extends State>(key: string, now: number, fresh: () => T): T {
    for (const [k, s] of states) if (now - s.lastActAt > STALE_MS) states.delete(k);
    let s = states.get(key) as T | undefined;
    if (!s) {
      s = fresh();
      states.set(key, s);
    }
    s.lastActAt = now;
    return s;
  }

  return {
    act(ctx, goal) {
      const now = ctx.p.now;
      switch (goal.kind) {
        case "loot":
          return actLoot(ctx, goal.container, slot(`loot:${goal.container}`, now, () => ({
            lastActAt: now, startedAt: now, lastNow: -1, carriedAtStart: carried(ctx), stopAt: null, pickupAt: null, fails: 0, final: null,
          })));
        case "roam":
          return actRoam(ctx, goal.to);
        case "hold":
          return actHold(ctx, goal, slot(`hold:${goal.why}:${Math.round(goal.at.x / 16)},${Math.round(goal.at.y / 16)}`, now, () => ({
            lastActAt: now, stopAt: null, spot: null,
          })));
        case "idle":
          return actIdle(ctx, slot("idle", now, () => ({ lastActAt: now, stopAt: null })));
      }
    },
  };
}

/**
 * The point on the ring about `centre` farthest from the other fighters in sight, with a seeded jitter so two bots in the same
 * spot do not pick the same one. On a walkable disc, and inside the coliseum when `centre` is.
 */
export function pickHoldSpot(ctx: BrainContext, centre: Vec2, ringRadius: number): Vec2 {
  const map = ctx.svc.paths.collisionMap();
  const others = ctx.p.fighters.filter((f) => f.status === "alive");
  const phase = uniform(ctx.rng.decide, 0, (2 * Math.PI) / HOLD_SPOT_STEPS);
  const inside = inColiseum(map, centre.x, centre.y);
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  let fallback: Vec2 | null = null;
  let fallbackScore = -Infinity;
  for (let i = 0; i < HOLD_SPOT_STEPS; i++) {
    const angle = phase + (2 * Math.PI * i) / HOLD_SPOT_STEPS;
    const jitter = uniform(ctx.rng.decide, 0, HOLD_SPOT_JITTER);
    const pt = { x: centre.x + Math.cos(angle) * ringRadius, y: centre.y + Math.sin(angle) * ringRadius };
    if (!circleClear(map, pt, PLAYER_RADIUS)) continue;
    let nearest = Infinity;
    for (const f of others) nearest = Math.min(nearest, Math.hypot(f.x - pt.x, f.y - pt.y));
    const score = (nearest === Infinity ? 0 : nearest) + jitter;
    if (score > fallbackScore) { fallback = pt; fallbackScore = score; }
    if (inside && !inColiseum(map, pt.x, pt.y)) continue;
    if (score > bestScore) { best = pt; bestScore = score; }
  }
  return best ?? fallback ?? { x: centre.x, y: centre.y };
}

// ======================================================================================================================= loot

function carried(ctx: BrainContext): number {
  return ctx.p.self.weapons.filter((w) => w !== null).length;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function out(intents: readonly Intent[], status: GoalStatus): TacticsOutput {
  return { intents, status, attacking: false };
}

function goalIntent(body: IntentBody, why: string, priority: Intent["priority"] = PRIORITY.goal): Intent {
  return { ...body, priority, timing: { kind: "step" }, why };
}

function toastKind(text: string): "gone" | "far" | null {
  const t = text.trim().replace(/\.$/, "").toLowerCase();
  if (t === "nothing there" || t === "nothing to take") return "gone";
  if (t === "too far away" || t === "can't reach that") return "far";
  return null;
}

function holdsNoWeapon(c: { readonly closed: boolean; readonly weapon: unknown }): boolean {
  return !c.closed || c.weapon === null;
}

function actLoot(ctx: BrainContext, id: string, st: LootState): TacticsOutput {
  const { p, mem, svc } = ctx;
  const me = p.self;
  const now = p.now;
  const finish = (status: GoalStatus): TacticsOutput => {
    st.final = status;
    return out([], status);
  };
  if (st.final) return out([], st.final);

  if (st.lastNow !== now) {
    st.lastNow = now;
    for (const e of p.events) {
      if (e.kind !== "toast" || st.pickupAt === null || e.t < st.pickupAt) continue;
      const kind = toastKind(e.text);
      if (kind === "gone") st.fails = LOOT_MAX_FAILS;
      else if (kind === "far") st.fails++;
    }
  }

  const seen = p.containers.find((c) => c.id === id);
  const remembered = mem.containers.get(id);
  if (carried(ctx) > st.carriedAtStart) return finish({ state: "done", why: "picked up" });
  if (st.fails >= LOOT_MAX_FAILS) return finish({ state: "failed", why: "refused" });
  if (seen ? holdsNoWeapon(seen) : remembered && holdsNoWeapon(remembered)) return finish({ state: "done", why: "emptied" });
  if (remembered?.skipped) return finish({ state: "failed", why: "skipped" });
  if (!seen && !remembered) return finish({ state: "failed", why: "gone" });
  if (now - st.startedAt > LOOT_BUDGET_MS) return finish({ state: "failed", why: "budget" });
  if (p.fighters.some((f) => f.status === "alive" && f.dist < LOOT_ENEMY_DISTANCE)) return finish({ state: "failed", why: "enemy near" });
  if (p.mobs.some((m) => m.status !== "dead" && m.dist < LOOT_MOB_DISTANCE && mobAwake(ctx, m))) return finish({ state: "failed", why: "mob near" });

  const at: Vec2 = seen ?? remembered!.pos;
  const d = dist(me, at);
  if (seen && seen.interactable && d <= PICKUP_DISTANCE) return takeIt(ctx, st, seen);

  const to = nextStep(ctx, at, d);
  if (to === null) return finish({ state: "failed", why: "unreachable" });
  return out([goalIntent({ kind: "move", to }, "to the container")], { state: "running", why: "walking" });
}

function mobAwake(ctx: BrainContext, m: { readonly id: string; readonly vx: number; readonly vy: number }): boolean {
  const known = ctx.mem.mobs.get(m.id);
  return known ? known.awake : Math.hypot(m.vx, m.vy) > 20;
}

/** In reach: halt so the server's position settles, then press F once the bot has stood still. */
function takeIt(ctx: BrainContext, st: LootState, c: ContainerView): TacticsOutput {
  const now = ctx.p.now;
  const still = now - ctx.mem.self.stillSince >= STILL_BEFORE_PICKUP_MS;
  const running: GoalStatus = { state: "running", why: still ? "taking" : "settling" };
  if (!still) {
    if (st.stopAt !== null && now - st.stopAt < STOP_RESEND_MS) return out([], running);
    st.stopAt = now;
    return out([goalIntent({ kind: "stop" }, "hold still for the pickup")], running);
  }
  if (st.pickupAt !== null && now - st.pickupAt < PICKUP_RETRY_MS) return out([], running);
  st.pickupAt = now;
  return out([goalIntent({ kind: "pickup", container: c.id }, "take the weapon")], running);
}

/** Where to click next: the container itself, or around a wall the next waypoint of the walk. Null when there is no way. */
function nextStep(ctx: BrainContext, at: Vec2, d: number): Vec2 | null {
  const me = ctx.p.self;
  const paths = ctx.svc.paths;
  if (d <= WAYPOINT_FROM || paths.los(me, at)) return { x: at.x, y: at.y };
  const route = paths.path(me, at);
  if (route === null) return paths.walk(me, at) === null ? null : { x: at.x, y: at.y };
  const next = route.find((w) => dist(me, w) > 2 * PLAYER_RADIUS) ?? route[route.length - 1]!;
  return { x: next.x, y: next.y };
}

// ======================================================================================================================= roam

function actRoam(ctx: BrainContext, to: Vec2): TacticsOutput {
  const me = ctx.p.self;
  const d = dist(me, to);
  if (d <= ARRIVE_DISTANCE) return out([], { state: "done", why: "arrived" });
  if (d <= ROAM_SETTLED_DISTANCE && ctx.p.now - ctx.mem.self.stillSince >= ROAM_SETTLED_MS) {
    return out([], { state: "done", why: "close enough" });
  }
  if (ctx.svc.paths.walk(me, to) === null) return out([], { state: "failed", why: "unreachable" });
  return out([goalIntent({ kind: "move", to: { x: to.x, y: to.y } }, "roam")], { state: "running", why: "walking" });
}

// ======================================================================================================================= hold

/** A halt that is sent once, and again only if the bot is still moving a while later (the first never took). */
function stopOnce(ctx: BrainContext, st: { stopAt: number | null }, why: string): readonly Intent[] {
  const now = ctx.p.now;
  const moving = now - ctx.mem.self.stillSince < STILL_BEFORE_PICKUP_MS;
  if (st.stopAt !== null && !(moving && now - st.stopAt >= STOP_RESEND_MS)) return [];
  st.stopAt = now;
  return [goalIntent({ kind: "stop" }, why, PRIORITY.chore)];
}

function crowded(ctx: BrainContext, at: Vec2): boolean {
  return ctx.p.fighters.some((f) => f.status === "alive" && dist(f, at) < CROWDED_DISTANCE);
}

function actHold(ctx: BrainContext, goal: Extract<WorldGoal, { kind: "hold" }>, st: HoldState): TacticsOutput {
  // An ambush or a wait is standing where the bot is; only the coliseum is a place to walk to.
  if (goal.why !== "coliseum") return out(stopOnce(ctx, st, `hold (${goal.why})`), { state: "running", why: "holding" });

  const me = ctx.p.self;
  if (st.stopAt === null && st.spot === null && ctx.cfg.persona.coliseum < 0.5 && crowded(ctx, goal.at)) {
    st.spot = pickHoldSpot(ctx, ctx.svc.paths.collisionMap().coliseum.centre, COLISEUM_RING_RADIUS);
  }
  const target = st.spot ?? goal.at;
  const d = dist(me, target);
  const settled = d <= SETTLED_DISTANCE && ctx.p.now - ctx.mem.self.stillSince >= SETTLED_MS;
  if (st.stopAt !== null || d <= HOLD_ARRIVE_DISTANCE || settled) {
    return out(stopOnce(ctx, st, "hold the coliseum"), { state: "running", why: "holding" });
  }
  if (ctx.svc.paths.walk(me, target) === null) return out([], { state: "failed", why: "unreachable" });
  return out([goalIntent({ kind: "move", to: { x: target.x, y: target.y } }, "to the coliseum spot")], { state: "running", why: "walking" });
}

// ======================================================================================================================= idle

function actIdle(ctx: BrainContext, st: IdleState): TacticsOutput {
  return out(stopOnce(ctx, st, "idle"), { state: "running", why: "idle" });
}
