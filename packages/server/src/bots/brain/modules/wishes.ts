// The Wishes module (docs/BOTS.md 8): the bot presses D the way a person does. It reads the Wish slot as the weapon bar shows it
// (`extras.wish`: ability, ready time, a cast under way) and its own status bits, describes the moment to the shared cast policy
// (`decideCast` by the ability's intent tags, never by id) and emits a `cast` intent, timed as an answer to what made the moment
// (a hit, a low-hp warning, a new enemy, a windup at it) or as the next step of a plan when nothing new happened. The humanizer
// supplies the reaction time, the hesitation and the hand: a unit cast is resolved like a lock click, so it can miss.
//
// Swarm hides its caster, and a hidden fighter's own swing reveals it. A bot that has decided to cast it (or is hidden) therefore
// slips away from the nearest enemy and locks nobody until the hiding is over, as a person who walks off to get away would. That is
// a module goal (strategy scores it above everything else while it holds), with the same walk offered as a reflex beside the
// current goal's intents for the moments before strategy has adopted it.
//
// This is the one brain file that imports from outside the brain's own folder and @raid/shared: `bots/abilityPolicy.ts` (pure, and
// shared-only itself; test/bots/boundary.test.ts allows exactly that path for this file).
import { EFFECT_CASTING, EFFECT_HIDDEN, rankOf, TARGET_SNAP_RADIUS, type AbilityDef, type Vec2 } from "@raid/shared";
import { decideCast, ESCAPE_HP_HIT, hidesCaster, PEEL_DISTANCE, type CastSituation } from "../../abilityPolicy";
import { awayPoint } from "../tactics/kite";
import {
  PRIORITY,
  type BrainContext, type FeatureModule, type FighterView, type Goal, type GoalDecision, type Intent, type IntentTiming, type MobView,
  type ServerMs, type StimulusKind, type TacticsOutput, type WishView,
} from "../types";

/** The module's numbers (ms, u). */
export const WISH_RULES = {
  /** A Wish is asked for at most this often: a refused or fizzled cast costs nothing, so it is simply asked again. */
  retryMs: 1000,
  /** A hit on the bot this recent is "being hit" for the Wish's escape and sustain rules (the policy's `recentlyHit`). */
  recentHitMs: 1500,
  /** An enemy is "chasing" when it walks at the bot at least this fast (u/s) along the line between them, within this cosine of it. */
  chaseClosing: 20,
  chaseCos: 0.7,
  /** An enemy that hit the bot this recently and stands this close is on it, still or not (a melee fighter locked on stops at reach). */
  onItDistance: PEEL_DISTANCE,
  /** Easy remembers its Wish this share of the times it becomes available (drawn once per availability, from `rng.decide`). */
  easyRemembers: 0.6,
  /** A hiding Wish decided but not yet sent keeps the bot slipping this long at most (the humanizer's reaction and hesitation). */
  slipPendingMs: 2500,
  /** After it was sent: the cast's own time plus this, until the hiding shows in the bot's bits (latency, the patch, the delay ring). */
  slipGraceMs: 700,
  /** Strategy scores the slip above a flee (1.1) and every persona goal. */
  slipUtility: 1.4,
  /** One leg of the slip, and how long it is kept before the heading is chosen again from where the enemy is now. */
  slipStepU: 300,
  slipKeepMs: 1200,
  slipArrivedU: 60,
} as const;

/** The module goal that walks away from the enemy while the bot is (about to be) hidden. */
const SLIP_GOAL: Extract<Goal, { kind: "module" }> = { kind: "module", module: "wishes", data: { mode: "slip" } };

/** The stimuli that make a cast sensible, most telling first: a human presses D because of one of them. */
const CAST_STIMULI: readonly StimulusKind[] = ["lowHp", "hpLoss", "windupAtMe", "drawAtMe", "newThreat", "incoming"];

/** What the module keeps for one bot (keyed on the brain's own config object: the one module instance serves every bot of a room). */
interface WishState {
  /** The Wish was usable at the last observation: a new availability draws the Easy gate again. */
  available: boolean;
  /** This availability is remembered (always, except for Easy's draw). */
  remembers: boolean;
  lastTryAt: ServerMs;
  /** A Wish that hides its caster was decided at this time (null: none outstanding), with its cast time. */
  armedAt: ServerMs | null;
  castMs: number;
  /** Where the enemy it slips from last stood. */
  from: Vec2 | null;
  /** The slip's current leg. */
  leg: { readonly to: Vec2; readonly at: ServerMs } | null;
}

const states = new WeakMap<object, WishState>();

function stateOf(ctx: BrainContext): WishState {
  let st = states.get(ctx.cfg);
  if (!st) {
    st = { available: false, remembers: true, lastTryAt: Number.NEGATIVE_INFINITY, armedAt: null, castMs: 0, from: null, leg: null };
    states.set(ctx.cfg, st);
  }
  return st;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The def behind `extras.wish.def`, if it is one (it is opaque to the brain's contract). */
function defOf(view: WishView | undefined): AbilityDef | null {
  const def = view?.def as Partial<AbilityDef> | null | undefined;
  return def && typeof def === "object" && Array.isArray(def.ranks) && def.ranks.length > 0 && Array.isArray(def.ai) && Array.isArray(def.blockedBy)
    ? (def as AbilityDef)
    : null;
}

/** The bot's own EFFECT_* bits (the status icons on its own fighter). */
const ownBits = (ctx: BrainContext): number => ctx.p.extras.effects?.[ctx.p.self.id] ?? 0;

const alive = (f: { readonly status: string }): boolean => f.status === "alive";

/** The nearest enemy player on screen. */
function nearestEnemy(ctx: BrainContext): FighterView | null {
  let best: FighterView | null = null;
  for (const f of ctx.p.fighters) if (alive(f) && (best === null || f.dist < best.dist)) best = f;
  return best;
}

/** Walking at the bot, or on it: the policy's "chasing". */
function chasing(ctx: BrainContext, f: FighterView): boolean {
  const speed = Math.hypot(f.vx, f.vy);
  if (speed > 0 && f.dist > 1) {
    const me = ctx.p.self;
    const toward = (f.vx * (me.x - f.x) + f.vy * (me.y - f.y)) / f.dist;
    if (toward >= WISH_RULES.chaseClosing && toward / speed > WISH_RULES.chaseCos) return true;
  }
  const hit = ctx.mem.fighters.get(f.id)?.hitMeAt;
  return hit != null && ctx.p.now - hit <= WISH_RULES.recentHitMs && f.dist <= WISH_RULES.onItDistance;
}

/** The player or mob the goal is fighting, if it is on screen. */
function foeOf(ctx: BrainContext, goal: Goal): CastSituation["foe"] {
  let id: string | null = null;
  if (goal.kind === "hunt" || goal.kind === "fight") id = goal.target;
  else if (goal.kind === "farm") id = goal.mob;
  if (id === null) return null;
  const f = ctx.p.fighters.find((x) => x.id === id && alive(x));
  if (f) return { id: f.id, x: f.x, y: f.y, d: f.dist, los: f.los, targetable: f.targetable };
  const m: MobView | undefined = ctx.p.mobs.find((x) => x.id === id && alive(x));
  return m ? { id: m.id, x: m.x, y: m.y, d: m.dist, los: m.los, targetable: true, mob: true } : null;
}

/**
 * The moment as the shared policy wants it, from the percept and memory alone: the bot's hp share, bits and whether it was hit
 * lately; the goal's target if it is on screen; the nearest enemy player, and whether it is coming.
 */
export function castSituation(ctx: BrainContext, goal: Goal): CastSituation {
  const { p, mem } = ctx;
  const me = p.self;
  const hit = mem.self.lastHitAt;
  const near = nearestEnemy(ctx);
  return {
    me: {
      x: me.x, y: me.y, hpFrac: me.maxHp > 0 ? me.hp / me.maxHp : 1, effects: ownBits(ctx),
      recentlyHit: hit !== null && p.now - hit <= WISH_RULES.recentHitMs,
    },
    foe: foeOf(ctx, goal),
    threat: near
      ? { x: near.x, y: near.y, d: near.dist, chasing: chasing(ctx, near), id: near.id, los: near.los, targetable: near.targetable }
      : null,
    map: ctx.cfg.map,
    gatesLocked: p.hud.gatesLocked,
  };
}

/** A reaction to the stimulus that made the moment, else the next step of a plan already made. */
function timingOf(ctx: BrainContext): IntentTiming {
  const stimuli = ctx.mem.stimuli;
  for (const kind of CAST_STIMULI) {
    const stimulus = stimuli.find((s) => s.kind === kind);
    if (stimulus) return { kind: "react", stimulus };
  }
  return { kind: "step" };
}

/** The ability as this tier plays it: Easy keeps only the defensive tags (the panic button), every other tier all of them. */
function playedDef(ctx: BrainContext, def: AbilityDef): AbilityDef | null {
  if (ctx.cfg.tier.id !== "easy") return def;
  const ai = def.ai.filter((i) => i === "escape" || i === "sustain");
  return ai.length === 0 ? null : { ...def, ai };
}

/** The Wish is usable now: the run is on, the bot stands, and the slot's ready time has come. */
function usable(ctx: BrainContext, view: WishView): boolean {
  const { p } = ctx;
  return p.hud.phase === "active" && p.self.status === "alive" && p.now >= view.readyAt;
}

// ============================================================================================================== the slip

/** Is the bot hidden, casting a hiding Wish, or has it just decided to (or sent it, and the hiding has yet to show)? */
function slipping(ctx: BrainContext, st: WishState): boolean {
  const bits = ownBits(ctx);
  if ((bits & EFFECT_HIDDEN) !== 0) return true;
  if (st.armedAt === null) return false;
  const { now } = ctx.p;
  const sent = ctx.mem.self.lastCast;
  const at = sent && sent.cmd.type === "cast" && sent.at >= st.armedAt ? sent.at : null;
  // What the server shows of a cast (the bit) only appears once it is accepted and the patch is in; the bot's own record of having
  // sent it covers the time before, and a cast the server refused frees it after the cast's time and the grace.
  if (at !== null ? now < at + st.castMs + WISH_RULES.slipGraceMs || (bits & EFFECT_CASTING) !== 0 : now < st.armedAt + WISH_RULES.slipPendingMs) return true;
  st.armedAt = null;
  return false;
}

/**
 * The walk away from the nearest enemy (or from where it last stood), re-chosen from where that is now once its leg has run its
 * time or been walked. The same destination is offered again at every think: the humanizer sends nothing twice, and it keeps a lock
 * that tactics wants to click from taking the order channel in between. Null: nobody to slip from, or no clear heading.
 */
function slipStep(ctx: BrainContext, st: WishState): Intent | null {
  const { p } = ctx;
  const near = nearestEnemy(ctx);
  if (near) st.from = { x: near.x, y: near.y };
  const from = st.from;
  if (from === null) return null;
  const leg = st.leg;
  let to = leg && p.now - leg.at < WISH_RULES.slipKeepMs && dist(p.self, leg.to) > WISH_RULES.slipArrivedU ? leg.to : null;
  if (to === null) {
    to = awayPoint(ctx.svc.paths, p.self, from, WISH_RULES.slipStepU, 0);
    if (to === null) return null;
    st.leg = { to, at: p.now };
  }
  return { kind: "move", to, priority: PRIORITY.reflex, timing: timingOf(ctx), why: "slip away: hidden or about to be" };
}

// ============================================================================================================== the cast

/** The cast to send for this goal now, or null. Marks the attempt, and arms the slip when the Wish hides its caster. */
function castIntent(ctx: BrainContext, st: WishState, goal: Goal): Intent | null {
  const { p } = ctx;
  const view = p.extras.wish;
  const def = defOf(view);
  if (!view || !def || !usable(ctx, view) || view.casting || !st.remembers || p.now - st.lastTryAt < WISH_RULES.retryMs) return null;
  const played = playedDef(ctx, def);
  if (!played) return null;
  const s = castSituation(ctx, goal);
  const choice = decideCast(played, view.rank, s);
  if (!choice) return null;

  st.lastTryAt = p.now;
  const rank = rankOf(def, view.rank);
  if (hidesCaster(def, view.rank)) {
    st.armedAt = p.now;
    st.castMs = rank.castMs;
    const from = s.threat ?? s.foe;
    if (from) st.from = { x: from.x, y: from.y };
    st.leg = null;
  }
  const priority = s.me.hpFrac < ESCAPE_HP_HIT ? PRIORITY.reflex : PRIORITY.combat;
  const why = `cast ${def.name}`;
  if (choice.id !== undefined) {
    const snapRadius = rank.targeting.kind === "unit" ? rank.targeting.snapRadius : TARGET_SNAP_RADIUS;
    return {
      kind: "cast", slot: "wish", x: choice.x, y: choice.y, target: choice.id, at: { x: choice.x, y: choice.y }, snapRadius,
      priority, timing: timingOf(ctx), why,
    };
  }
  return { kind: "cast", slot: "wish", x: choice.x, y: choice.y, priority, timing: timingOf(ctx), why };
}

// =============================================================================================================== the module

export const wishesModule: FeatureModule = {
  id: "wishes",
  enabled: (f) => f.wishes,

  observe(ctx) {
    const st = stateOf(ctx);
    const view = ctx.p.extras.wish;
    const now = view !== undefined && usable(ctx, view);
    if (now && !st.available) {
      // Easy forgets its Wish some of the times it could have used it.
      st.remembers = ctx.cfg.tier.id !== "easy" || ctx.rng.decide() < WISH_RULES.easyRemembers;
    }
    st.available = now;
  },

  goals(ctx): readonly GoalDecision[] {
    const st = stateOf(ctx);
    if (!defOf(ctx.p.extras.wish) || !slipping(ctx, st) || (st.from === null && nearestEnemy(ctx) === null)) return [];
    return [{ goal: SLIP_GOAL, utility: WISH_RULES.slipUtility, why: "hidden behind a Swarm, or about to be: slip away, lock nobody" }];
  },

  intents(ctx, goal): readonly Intent[] {
    const st = stateOf(ctx);
    if (!defOf(ctx.p.extras.wish)) return [];
    const out: Intent[] = [];
    // The cast first: arming the slip is part of deciding it, and the walk follows in the same think.
    const cast = castIntent(ctx, st, goal);
    if (cast) out.push(cast);
    if (slipping(ctx, st)) {
      const step = slipStep(ctx, st);
      if (step) out.push(step);
    }
    return out;
  },

  act(ctx, goal): TacticsOutput {
    const st = stateOf(ctx);
    if (goal.data["mode"] !== "slip") return { intents: [], status: { state: "failed", why: `unknown wishes goal` }, attacking: false };
    if (!defOf(ctx.p.extras.wish) || !slipping(ctx, st)) {
      return { intents: [], status: { state: "done", why: "no longer hidden or about to be" }, attacking: false };
    }
    const intents: Intent[] = [];
    // A cast the server refused (a missed click) is asked again once the retry gap has passed.
    const cast = castIntent(ctx, st, goal);
    if (cast) intents.push(cast);
    const step = slipStep(ctx, st);
    // Nobody to slip from, or cornered: the goal is over, and strategy picks what to do hidden.
    if (!step) return { intents, status: { state: "done", why: st.from === null ? "hidden with nobody to slip from" : "cornered" }, attacking: false };
    intents.push(step);
    return { intents, status: { state: "running", why: "slipping away" }, attacking: false };
  },
};
