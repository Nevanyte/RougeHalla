// Moving on purpose while the server's lock is playing the fight (docs/BOTS.md 2.6): the orb-walk, the sidestep that beats a
// ball, the juke that beats an arrow, and the retreat step. Every one is a `move`, and a move drops the lock on the server
// (CLAUDE.md "Target lock"), so each costs a click to lock again: that is the price of leaving the fight, and the reason a
// kite is something a tier does only with the chance it is given.
//
// A move given while the bot's own locked attack is winding up CANCELS that attack (no swing, ball or arrow). So nothing here
// walks until the shot has left: the orb-walk waits for the launch, and a juke is timed to just after the other fighter's.
import {
  attackInterval, BOW_WINDUP, FACTIONS, pacedFaction, PLAYER_RADIUS, PLAYER_SPEED, RANGED_HIT_REACH, weaponTimings,
  type FactionId, type FactionSpec, type Vec2, type WeaponId,
} from "@raid/shared";
import { retreatPoint } from "../../mobHunt";
import { exGaussianMean } from "../random";
import {
  PRIORITY, type BrainContext, type FighterId, type Intent, type IntentTiming, type PathService, type ProjectileView, type SelfView,
  type ServerMs, type StimulusKind,
} from "../types";

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The smallest absolute difference of two angles (radians). */
export function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** A reaction if one of `kinds` (about `subject`, or about nobody in particular) is among this frame's stimuli, else the next step of a plan. */
export function reactOr(ctx: BrainContext, kinds: readonly StimulusKind[], subject: string | null): IntentTiming {
  const st = ctx.mem.stimuli.find((s) => kinds.includes(s.kind) && (subject === null || s.subject === subject || s.subject === null));
  return st ? { kind: "react", stimulus: st } : { kind: "step" };
}

const PACED = new Map<FactionId, FactionSpec>();
function paced(f: FactionId): FactionSpec {
  let spec = PACED.get(f);
  if (!spec) PACED.set(f, (spec = pacedFaction(FACTIONS[f])));
  return spec;
}

/** The bot's own attack rhythm (ms): the cooldown and the windup the sim computes for it, or null while it has no faction. */
export function ownTimings(self: SelfView, weapon: WeaponId): { readonly intervalMs: number; readonly windupMs: number } | null {
  if (self.faction === null) return null;
  const t = weaponTimings(weapon, attackInterval(paced(self.faction), weapon, self.asMult));
  return { intervalMs: t.interval * 1000, windupMs: t.windup * 1000 };
}

// ------------------------------------------------------------------------------------------------------------ a step away

/** Headings tried when a wall is in the way, in order: straight, then slide along it either side (never more than 60 degrees off). */
const TURNS = [0, 0.5, -0.5, 1.05, -1.05];
const LENGTHS = [1, 0.6];

/**
 * A point about `stepU` straight away from `threat` (turned by `jitter` radians), turned or shortened until the walk to it is
 * clear. Null when no heading is clear: cornered, so the caller stands and trades.
 */
export function awayPoint(paths: PathService, self: Vec2, threat: Vec2, stepU: number, jitter: number): Vec2 | null {
  const base = Math.atan2(self.y - threat.y, self.x - threat.x) + jitter;
  for (const turn of TURNS) {
    for (const share of LENGTHS) {
      const a = base + turn;
      const p = { x: self.x + Math.cos(a) * stepU * share, y: self.y + Math.sin(a) * stepU * share };
      if (paths.clear(self, p)) return p;
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------------- orb-walk

/** A walk-away whose lock never dropped (the move was lost) is given up on after this long. */
const AWAY_TAKE_MS = 900;
/** An orb-walk cycle that has not locked again by now is over: the ordinary lock logic takes the fight back. */
const AWAY_MAX_MS = 3000;
/** The re-lock lands this long before the cooldown ends, so the server attacks the moment it can. */
const RELOCK_LEAD_MS = 100;
/**
 * Walking off needs cooldown left to walk in: the step click takes a step's delay and the uplink to land, and the re-lock goes
 * out RELOCK_LEAD_MS early, so this much must remain besides. Most bows leave far less (a Plague bow is rooted for 255 of its
 * 277 ms), so they stand; measured in the real sim a shorter wait was a loss about as often as a gain once latency was in.
 */
const MIN_WALK_MS = 100;
/** A readyAt that rose by less than this share of the cooldown was a swap's penalty or a chill stretching it, not a new shot. */
const NEW_SHOT_SHARE = 0.9;

export interface OrbWalk {
  /** A new engagement: the shots already fired are not cycles. */
  reset(readyAt: ServerMs): void;
  /**
   * The order to send now (the step away after a shot, or the timed re-lock), "wait" to keep the order channel quiet while the
   * step is on its way, or null to play the lock as usual. `locked` is the server's lock on the foe (`self.attackTarget`).
   */
  step(ctx: BrainContext, foe: { readonly id: FighterId; readonly x: number; readonly y: number }, weapon: WeaponId, locked: boolean): Intent | "wait" | null;
  readonly cycles: number;
}

/**
 * The cycle for a ranged bot against a melee chaser: locked, the server shoots; once its own shot has LEFT (a jump of
 * `readyAt`, the bow's draw cleared, the wand's windup over) it walks `stepU` away, which drops the lock; when the walk has
 * taken it re-locks, timed to land just before the cooldown ends. Two orders a shot, so the humanizer's APM thins it on its own.
 */
export function createOrbWalk(): OrbWalk {
  let cycleReady: ServerMs = Number.POSITIVE_INFINITY;
  let phase: "shoot" | "away" = "shoot";
  let awayAt = 0;
  let applied = false;
  const orb = {
    cycles: 0,
    reset(readyAt: ServerMs) {
      cycleReady = readyAt;
      phase = "shoot";
      applied = false;
    },
    step(ctx: BrainContext, foe: { readonly id: FighterId; readonly x: number; readonly y: number }, weapon: WeaponId, locked: boolean): Intent | "wait" | null {
      const { self, now } = ctx.p;
      if (phase === "away") {
        if (!applied) {
          if (!locked) applied = true;
          else if (now - awayAt > AWAY_TAKE_MS) { phase = "shoot"; return null; }
          else return "wait";
        }
        if (locked || now - awayAt > AWAY_MAX_MS) { phase = "shoot"; return null; }
        return {
          kind: "lock", target: foe.id, at: { x: foe.x, y: foe.y }, priority: PRIORITY.combat,
          timing: { kind: "timed", due: Math.max(self.readyAt - RELOCK_LEAD_MS, now) }, why: "orb-walk re-lock at the cooldown",
        };
      }
      const t = ownTimings(self, weapon);
      if (!t || !locked || self.readyAt <= cycleReady) return null;
      if (self.readyAt - cycleReady < t.intervalMs * NEW_SHOT_SHARE) { cycleReady = self.readyAt; return null; }
      const launchAt = self.readyAt - t.intervalMs + t.windupMs;
      if (now < launchAt || (weapon === "bow" && self.drawStartedAt > 0)) return null; // still winding up: a move now would cancel the shot
      cycleReady = self.readyAt; // this shot has left; whether the bot walks after it or not, it is settled
      const tier = ctx.cfg.tier;
      if (self.readyAt - now < exGaussianMean(tier.step) + APPLY_LAG_MS + MIN_WALK_MS + RELOCK_LEAD_MS) return null; // nearly over: stand and shoot again
      const o = tier.orbwalk;
      const jitter = (ctx.rng.decide() * 2 - 1) * o.angleJitter;
      const to = awayPoint(ctx.svc.paths, self, foe, o.stepU, jitter);
      if (!to) return null; // cornered: stand and trade
      phase = "away";
      awayAt = now;
      applied = false;
      orb.cycles++;
      return { kind: "move", to, priority: PRIORITY.combat, timing: { kind: "step" }, why: "orb-walk: step away after the shot" };
    },
  };
  return orb;
}

// ------------------------------------------------------------------------------------------------------------- reflexes

/** The sidestep a dodge must make to be clear of a ball (BOTS.md 2.6: hit reach plus the body), and the step it actually takes. */
const SIDESTEP_U = RANGED_HIT_REACH + PLAYER_RADIUS;
const DODGE_U = 32;
/** The juke's step: enough to put an arrow's lead in the wrong place. */
const JUKE_U = 44;
/** A projectile whose origin is this close to the bot was loosed from its own body. */
const OWN_ORIGIN = 20;
/** Uplink and the wait for the next step between a click and the server applying it (docs/BOTS.md 2.1). */
const APPLY_LAG_MS = 55;
/** An arrow's release is read this far ahead; the juke lands this long after it. */
const JUKE_AFTER_MS = 30;
/** A shot is "at the bot" when it is this close and its aim line passes within JUKE_LATERAL u of it (memory.ts reads "aimed at me" the same way). */
const JUKE_RANGE = 300;
const JUKE_LATERAL = 60;
const JUKE_WINDOW_MS = 1500;
/** Decisions remembered (a projectile id, or a windup), oldest forgotten first. */
const REMEMBER = 48;

export interface Reflex {
  readonly kind: "dodge" | "juke";
  readonly intent: Intent;
  /** The order channel stays quiet until then: the re-lock waits for the sidestep. */
  readonly holdUntil: ServerMs;
}

export interface Reflexes {
  /** A sidestep or a juke if one is due and the dice say so. At most one per call; a dodge outranks a juke. */
  check(ctx: BrainContext): Reflex | null;
  readonly holdUntil: ServerMs;
  readonly dodges: number;
  readonly jukes: number;
}

interface Course { readonly ttiMs: number; readonly offset: number; readonly nx: number; readonly ny: number }

/** Where a straight projectile will pass the bot, and how long it has: null when it is not coming at it, or is its own. */
function course(pr: ProjectileView, self: SelfView, lagMs: number): Course | null {
  if (pr.from === self.id || Math.hypot(pr.x0 - self.x, pr.y0 - self.y) < OWN_ORIGIN) return null;
  const speed = Math.hypot(pr.vx, pr.vy);
  if (speed < 1) return null;
  const ux = pr.vx / speed;
  const uy = pr.vy / speed;
  const rx = self.x - pr.x;
  const ry = self.y - pr.y;
  const along = rx * ux + ry * uy;
  const offset = -rx * uy + ry * ux;
  const left = pr.range - Math.hypot(pr.x - pr.x0, pr.y - pr.y0);
  if (Math.abs(offset) > SIDESTEP_U || along < 0 || along > left + RANGED_HIT_REACH) return null;
  // The percept shows the ball where it was `lagMs` ago.
  const ttiMs = (along / speed) * 1000 - lagMs;
  return ttiMs > 0 ? { ttiMs, offset, nx: -uy, ny: ux } : null;
}

export function createReflexes(): Reflexes {
  const decided = new Map<string, boolean>();
  const remember = (key: string, yes: boolean): void => {
    decided.delete(key);
    decided.set(key, yes);
    if (decided.size > REMEMBER) decided.delete(decided.keys().next().value as string);
  };
  const r = {
    holdUntil: 0,
    dodges: 0,
    jukes: 0,
    check(ctx: BrainContext): Reflex | null {
      const found = dodge(ctx) ?? (ctx.p.now < r.holdUntil ? null : juke(ctx));
      if (found) r.holdUntil = found.holdUntil;
      return found;
    },
  };

  function dodge(ctx: BrainContext): Reflex | null {
    const { p, rng } = ctx;
    const tier = ctx.cfg.tier;
    if (tier.dodgeP <= 0) return null;
    const lagMs = Math.max(0, p.now - p.viewT);
    for (const pr of p.projectiles) {
      if (decided.has(pr.id)) continue;
      const c = course(pr, p.self, lagMs);
      if (!c) continue;
      // A ball seen for the first time is answered at the reaction time; one the bot was already watching, at a plan's step.
      const stim = ctx.mem.stimuli.find((s) => s.kind === "incoming" && s.subject === pr.id);
      const lead = exGaussianMean(stim ? tier.reaction : tier.step);
      const walkMs = (SIDESTEP_U / (PLAYER_SPEED * Math.max(0.3, p.self.speedMult))) * 1000;
      if (c.ttiMs < lead + APPLY_LAG_MS + walkMs) { remember(pr.id, false); continue; }
      const yes = rng.decide() < tier.dodgeP;
      remember(pr.id, yes);
      if (!yes) continue;
      const side = c.offset >= 0 ? 1 : -1;
      const to = sideStep(ctx.svc.paths, p.self, c.nx, c.ny, side, DODGE_U);
      if (!to) continue;
      r.dodges++;
      const timing: IntentTiming = stim ? { kind: "react", stimulus: stim } : { kind: "step" };
      return {
        kind: "dodge", holdUntil: p.now + lead + walkMs + 200,
        intent: { kind: "move", to, priority: PRIORITY.reflex, timing, why: `sidestep an incoming ${pr.kind}` },
      };
    }
    return null;
  }

  /** A shot about to leave a visible fighter's weapon at the bot: direction change timed to land just after the release. */
  function juke(ctx: BrainContext): Reflex | null {
    const { p, rng } = ctx;
    const tier = ctx.cfg.tier;
    if (tier.jukeP <= 0) return null;
    const me = p.self;
    for (const s of shots(ctx)) {
      if (decided.has(s.key)) continue;
      const due = s.releaseAt + JUKE_AFTER_MS;
      if (due <= p.now || due - p.now > JUKE_WINDOW_MS) { remember(s.key, false); continue; }
      const from = { x: s.x, y: s.y };
      if (!aimedAt(from, s.aim, me)) continue;
      const known = ctx.mem.fighters.get(s.by);
      if (known && known.feints > 0 && tier.feintRead > 0 && rng.decide() < tier.feintRead) { remember(s.key, false); continue; }
      const yes = rng.decide() < tier.jukeP;
      remember(s.key, yes);
      if (!yes) continue;
      const bearing = Math.atan2(me.y - s.y, me.x - s.x);
      const side = rng.decide() < 0.5 ? 1 : -1;
      const to = sideStep(ctx.svc.paths, me, -Math.sin(bearing), Math.cos(bearing), side, JUKE_U);
      if (!to) continue;
      r.jukes++;
      return {
        kind: "juke", holdUntil: due + 450,
        intent: { kind: "move", to, priority: PRIORITY.reflex, timing: { kind: "timed", due }, why: "juke the shot as it leaves" },
      };
    }
    return null;
  }
  return r;
}

/** A point `len` along the unit normal (nx, ny) on `side`, else on the other side; null when neither walk is clear. */
function sideStep(paths: PathService, self: Vec2, nx: number, ny: number, side: 1 | -1, len: number): Vec2 | null {
  for (const s of [side, -side]) {
    const p = { x: self.x + nx * s * len, y: self.y + ny * s * len };
    if (paths.clear(self, p)) return p;
  }
  return null;
}

function aimedAt(from: Vec2, aim: number, at: Vec2): boolean {
  const d = dist(from, at);
  if (d > JUKE_RANGE) return false;
  const diff = angleGap(aim, Math.atan2(at.y - from.y, at.x - from.x));
  return d < 1 || (diff < Math.PI / 2 && d * Math.sin(diff) <= JUKE_LATERAL);
}

interface Shot { readonly key: string; readonly by: FighterId; readonly x: number; readonly y: number; readonly aim: number; readonly releaseAt: ServerMs }

/** Bow draws in sight (the pull is drawn) and wand windups announced since the last percept: when each shot will leave. */
function shots(ctx: BrainContext): Shot[] {
  const { p } = ctx;
  const out: Shot[] = [];
  for (const f of [...p.fighters, ...p.mobs]) {
    if (f.status !== "alive" || f.inHand !== "bow" || f.drawStartedAt <= 0) continue;
    const windup = f.faction ? weaponTimings("bow", attackInterval(paced(f.faction), "bow")).windup : BOW_WINDUP;
    out.push({ key: `${f.id}@${f.drawStartedAt}`, by: f.id, x: f.x, y: f.y, aim: f.facing, releaseAt: f.drawStartedAt + windup * 1000 });
  }
  for (const e of p.events) {
    if (e.kind !== "windup" || e.weapon !== "wand" || e.by === p.self.id) continue;
    const who = p.fighters.find((f) => f.id === e.by) ?? p.mobs.find((m) => m.id === e.by);
    if (who) out.push({ key: `${e.by}@${e.t}`, by: e.by, x: who.x, y: who.y, aim: e.a, releaseAt: e.t + e.ms });
  }
  return out;
}

// -------------------------------------------------------------------------------------------------------------- retreat

/** A walk to a retreat point is kept this long, then chosen again from where the threats are now. */
const RETREAT_KEEP_MS = 1200;
const RETREAT_ARRIVED = 48;

export interface Retreat {
  reset(): void;
  /** mobHunt's `retreatPoint` from `threats`, kept while it still leads away; null when cornered. */
  point(ctx: BrainContext, threats: readonly Vec2[]): Vec2 | null;
}

export function createRetreat(): Retreat {
  let dest: Vec2 | null = null;
  let at = 0;
  return {
    reset() { dest = null; },
    point(ctx, threats) {
      const { self, now } = ctx.p;
      if (dest && now - at < RETREAT_KEEP_MS && dist(self, dest) > RETREAT_ARRIVED) {
        let nearMe = Infinity;
        let nearDest = Infinity;
        for (const t of threats) { nearMe = Math.min(nearMe, dist(t, self)); nearDest = Math.min(nearDest, dist(t, dest)); }
        if (nearDest >= nearMe) return dest;
      }
      dest = threats.length > 0 ? retreatPoint(self, threats, (a, b) => ctx.svc.paths.clear(a, b)) : null;
      at = now;
      return dest;
    },
  };
}
