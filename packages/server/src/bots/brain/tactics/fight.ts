// Playing one fight (farm, hunt, fight goals) the way a person with the LoL-style controls does (docs/BOTS.md 4, CLAUDE.md
// "Target lock"): walk until the foe is inside the server's reach, click it ONCE, and leave the chase, the swings and the aim to
// the server. What stays here is what only the player decides: whom to click, which weapon to hold, when to walk away
// (kite.ts) and when not to start. The bot never sends aim, attack or release.
import {
  bestSlot, isRanged, lockSpacing, TARGET_RANGE,
  type FactionId, type Vec2, type WeaponId,
} from "@raid/shared";
import { bestSlotVsMob, mobWeapon } from "../../mobHunt";
import {
  PRIORITY, type BrainContext, type FighterId, type FighterView, type GoalStatus, type Intent, type MobView, type SelfView,
  type TacticsOutput,
} from "../types";
import { dist, ownTimings, reactOr, type OrbWalk, type Reflexes, type Retreat } from "./kite";

export interface FightRef {
  readonly id: FighterId;
  readonly kind: "farm" | "hunt" | "fight";
}

export interface Fight {
  act(ctx: BrainContext, ref: FightRef, knowsSuddenDeath: boolean): TacticsOutput;
  /** Another goal has the bot's orders now: the walk this fight sent is no longer on its way. */
  leave(): void;
  /** Mob engagements started (BrainStats.mobTargets). */
  readonly mobTargets: number;
}

export interface FightDeps {
  readonly orb: OrbWalk;
  readonly reflexes: Reflexes;
  readonly retreat: Retreat;
}

/** The server takes a lock within TARGET_RANGE; the bot clicks this much (u) inside it, since what it sees is a patch old. */
const LOCK_MARGIN = 40;
/** The foe counts as being attacked while locked, in sight and this much (u) past the weapon's attack range at most. */
const ATTACK_SLACK = 24;
/** Weapons are swapped for a foe this close, and no more often than SWAP_EVERY_MS plus up to SWAP_JITTER_MS (two bots answering each other would swap in lockstep). */
const SWAP_DISTANCE = 600;
const SWAP_EVERY_MS = 2000;
const SWAP_JITTER_MS = 2000;
/** No progress toward the foe, no hit on it, not attacking for this long: the goal failed. */
const NO_PROGRESS_MS = 10_000;
const PROGRESS_U = 40;
/** Walk orders are re-sent only when the destination moved this far, or after this long, or when the bot stands still. */
const MOVE_RESEND_U = 48;
const MOVE_RESEND_MS = 1500;
const STILL_RESEND_MS = 700;
/** The walk round a wall is planned no more often than this, and given up after this many plans in a row found no path. */
const REPLAN_MS = 400;
const NO_PATH_FAILS = 3;
/** The farthest waypoint of a path that is clicked: on screen, with a clear walk. */
const WAYPOINT_REACH = 520;
/** A bounty carrier below this hp share opens no new fight with a player. */
const BOUNTY_MIN_HP = 0.7;
/** Sudden death: the bot ahead on hp share keeps this far from its opponent; the lead needed to start and to keep doing it (hp shares). */
const SD_KEEP = 340;
const SD_BAND = 0.02;
/** A melee foe is a chaser when it closes in on the bot, was seen chasing, or is this close (u); farther than CHASE_RANGE it is not yet. */
const CHASE_CLOSE = 260;
const CHASE_RANGE = 380;
const CHASE_SPEED = 40;
/** A fight not touched for this long is over: the next one is a new engagement (the orb-walk dice are rolled again). */
const ENGAGEMENT_GAP_MS = 4000;

/** Whatever the bot is fighting, a player or a mob, as seen now or as remembered. */
interface Foe {
  readonly id: FighterId;
  readonly mob: boolean;
  /** On screen now (a click can land on it); false = remembered. */
  readonly seen: boolean;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly dist: number;
  readonly los: boolean;
  readonly facing: number;
  readonly hpFrac: number;
  readonly faction: FactionId | null;
  /** The weapon in its hand (a mob's own, else its region's); null = not seen yet. */
  readonly theirs: WeaponId | null;
  readonly targetable: boolean;
}

type Lookup =
  | { readonly state: "ready"; readonly foe: Foe }
  /** Down, or no longer in the run. */
  | { readonly state: "dead" }
  /** Known once but no longer findable: memory has lapsed, or a mob is walking home. */
  | { readonly state: "lost" };

const running = (why: string): GoalStatus => ({ state: "running", why });
const failed = (why: string): GoalStatus => ({ state: "failed", why });

function fromFighter(f: FighterView): Foe {
  return {
    id: f.id, mob: false, seen: true, x: f.x, y: f.y, vx: f.vx, vy: f.vy, dist: f.dist, los: f.los, facing: f.facing, hpFrac: f.hpFrac,
    faction: f.faction, theirs: f.inHand, targetable: f.targetable,
  };
}

function fromMob(m: MobView): Foe {
  return {
    id: m.id, mob: true, seen: true, x: m.x, y: m.y, vx: m.vx, vy: m.vy, dist: m.dist, los: m.los, facing: m.facing, hpFrac: m.hpFrac,
    faction: m.faction, theirs: mobWeapon({ weapon0: m.inHand ?? "", faction: m.faction ?? "" }), targetable: true,
  };
}

function remembered(ctx: BrainContext, id: FighterId, mob: boolean, at: Vec2, hpFrac: number, faction: FactionId | null, theirs: WeaponId | null): Foe {
  const me = ctx.p.self;
  return {
    id, mob, seen: false, x: at.x, y: at.y, vx: 0, vy: 0, dist: dist(me, at), los: ctx.svc.paths.los(me, at), facing: 0, hpFrac, faction,
    theirs, targetable: true,
  };
}

function lookup(ctx: BrainContext, id: FighterId): Lookup {
  const { p, mem } = ctx;
  const f = p.fighters.find((x) => x.id === id);
  if (f) return f.status === "alive" ? { state: "ready", foe: fromFighter(f) } : { state: "dead" };
  const m = p.mobs.find((x) => x.id === id);
  if (m) return m.status === "alive" ? { state: "ready", foe: fromMob(m) } : { state: "dead" };
  const fm = mem.fighters.get(id);
  if (fm) {
    if (!fm.alive) return { state: "dead" };
    const w = mem.whereabouts(id, p.now);
    return w ? { state: "ready", foe: remembered(ctx, id, false, w.at, fm.hpFrac, fm.faction, fm.inHand) } : { state: "lost" };
  }
  const mm = mem.mobs.get(id);
  if (mm) {
    if (!mm.alive) return { state: "dead" };
    if (mm.returning) return { state: "lost" };
    return {
      state: "ready",
      foe: remembered(ctx, id, true, mm.pos, mm.hpFrac, mm.faction, mobWeapon({ weapon0: mm.inHand ?? "", faction: mm.faction ?? "" })),
    };
  }
  return { state: "dead" };
}

/** A melee foe that is coming for the bot (or already on it): the one an orb-walk is for. */
function isMeleeChaser(ctx: BrainContext, foe: Foe): boolean {
  if (foe.theirs === null || isRanged(foe.theirs) || foe.dist > CHASE_RANGE) return false;
  const me = ctx.p.self;
  const closing = ((me.x - foe.x) * foe.vx + (me.y - foe.y) * foe.vy) / Math.max(foe.dist, 1);
  return closing > CHASE_SPEED || foe.dist < CHASE_CLOSE || ctx.mem.fighters.get(foe.id)?.chasingMe === true;
}

const lockIntent = (ctx: BrainContext, foe: Foe, why: string): Intent => ({
  kind: "lock", target: foe.id, at: { x: foe.x, y: foe.y }, priority: PRIORITY.combat,
  timing: reactOr(ctx, ["lockLost", "clickMissed", "orderFailed", "targetDown", "newThreat"], foe.id), why,
});

export function createFight(deps: FightDeps): Fight {
  const { orb, reflexes, retreat } = deps;

  let engagement: { readonly id: FighterId; readonly kite: boolean } | null = null;
  let lastFightAt = Number.NEGATIVE_INFINITY;
  let progress: { id: FighterId; best: number; hp: number; since: number } | null = null;
  let plan: { id: FighterId; at: number; goal: Vec2; pts: readonly Vec2[] | null } | null = null;
  let noPath = 0;
  let lastMove: { to: Vec2; at: number } | null = null;
  let held = false;
  let nextSwapAt = 0;
  let sdHold = false;
  const mobsSeen = new Set<FighterId>();
  const fight = {
    mobTargets: 0,
    act,
    leave() { lastMove = null; held = false; plan = null; },
  };

  /** The walk round a wall, planned at most every REPLAN_MS; null = no path (counted: see NO_PATH_FAILS). */
  function planned(ctx: BrainContext, foe: Foe): readonly Vec2[] | null {
    const { self, now } = ctx.p;
    if (plan && plan.id === foe.id && now - plan.at < REPLAN_MS && dist(plan.goal, foe) < 96) return plan.pts;
    const pts = ctx.svc.paths.path(self, foe);
    const ok = pts !== null && pts.length > 0;
    plan = { id: foe.id, at: now, goal: { x: foe.x, y: foe.y }, pts: ok ? pts : null };
    noPath = ok ? 0 : noPath + 1;
    return plan.pts;
  }

  /** The farthest waypoint that is on screen and walkable in a straight line: one click carries the bot round the corner. */
  function waypoint(ctx: BrainContext, pts: readonly Vec2[], foe: Foe): Vec2 {
    const me = ctx.p.self;
    let best: Vec2 | null = null;
    for (const q of pts) {
      if (dist(me, q) <= 24) continue;
      if (best === null) best = q;
      if (dist(me, q) > WAYPOINT_REACH) break;
      if (ctx.svc.paths.clear(me, q)) best = q;
    }
    return best ?? { x: foe.x, y: foe.y };
  }

  /** A walk order to `to`, unless the same one is already on its way. */
  function walk(ctx: BrainContext, to: Vec2, foe: Foe, why: string): Intent | null {
    const { now } = ctx.p;
    if (lastMove && dist(lastMove.to, to) < MOVE_RESEND_U && now - lastMove.at < MOVE_RESEND_MS) {
      const idle = now - ctx.mem.self.stillSince > STILL_RESEND_MS && now - lastMove.at > STILL_RESEND_MS;
      if (!idle) return null;
    }
    lastMove = { to, at: now };
    held = false;
    return { kind: "move", to, priority: PRIORITY.goal, timing: reactOr(ctx, ["newThreat"], foe.id), why };
  }

  /** An order that is not a walk replaces the walk on the server, so the next walk order must be sent again. */
  const ordered = (): void => { lastMove = null; held = false; };

  function swapFor(ctx: BrainContext, foe: Foe, weapon: WeaponId): Intent | null {
    const { self, now } = ctx.p;
    if (now < nextSwapAt || self.drawStartedAt > 0 || !foe.seen || foe.dist > SWAP_DISTANCE || foe.theirs === null) return null;
    const t = ownTimings(self, weapon);
    if (t && now < self.readyAt - t.intervalMs + t.windupMs) return null; // a swap now would cancel the windup
    const slot = self.slot;
    const want = foe.mob ? bestSlotVsMob(self.weapons, slot, foe.theirs) : bestSlot(self.weapons, slot, foe.theirs);
    if (want === slot) return null;
    const next = self.weapons[want];
    // A player's wheel is only as good as what the bot knows of it (an unknown edge reads 0, so there is nothing to gain).
    if (!foe.mob && next !== null && ctx.know.weaponEdge(next, foe.theirs) <= ctx.know.weaponEdge(weapon, foe.theirs)) return null;
    nextSwapAt = now + SWAP_EVERY_MS + ctx.rng.decide() * SWAP_JITTER_MS;
    return {
      kind: "swap", slot: want, priority: PRIORITY.combat, timing: reactOr(ctx, ["foeSwapped", "newThreat"], foe.id),
      why: `${weapon} -> ${next} against ${foe.theirs}`,
    };
  }

  /** The hand holds nothing: take the other slot if it has a weapon. */
  function arm(self: SelfView): TacticsOutput {
    const other = self.weapons[self.slot === 0 ? 1 : 0];
    if (self.faction !== null && other !== null) {
      const intent: Intent = { kind: "swap", slot: self.slot === 0 ? 1 : 0, priority: PRIORITY.combat, timing: { kind: "step" }, why: "empty hand" };
      return { intents: [intent], status: running("taking the other weapon"), attacking: false };
    }
    return { intents: [], status: failed(self.faction === null ? "no faction yet" : "nothing to fight with"), attacking: false };
  }

  function act(ctx: BrainContext, ref: FightRef, knowsSd: boolean): TacticsOutput {
    const { p, mem, rng, cfg } = ctx;
    const self = p.self;
    const now = p.now;
    if (self.status !== "alive") return { intents: [], status: failed("not alive"), attacking: false };
    const weapon = self.weapons[self.slot];
    if (weapon === null || self.faction === null) return arm(self);

    const look = lookup(ctx, ref.id);
    if (look.state === "dead") { engagement = null; return { intents: [], status: { state: "done", why: "target down" }, attacking: false }; }
    if (look.state === "lost") return { intents: [], status: failed("lost track of the target"), attacking: false };
    const foe = look.foe;
    if (foe.mob && p.hud.inColiseum) return { intents: [], status: failed("no mobs in the coliseum"), attacking: false };
    if (foe.mob && p.hud.gatesLocked) return { intents: [], status: failed("the gates are locked: no mob can be reached"), attacking: false };

    if (!engagement || engagement.id !== foe.id || now - lastFightAt > ENGAGEMENT_GAP_MS) {
      engagement = { id: foe.id, kite: rng.decide() < cfg.tier.orbwalk.p * cfg.persona.kite };
      progress = null;
      plan = null;
      noPath = 0;
      sdHold = false;
      ordered();
      orb.reset(self.readyAt);
      if (foe.mob && !mobsSeen.has(foe.id)) { mobsSeen.add(foe.id); fight.mobTargets++; }
    }
    lastFightAt = now;

    const locked = self.attackTarget === foe.id;
    const spacing = lockSpacing(weapon);
    const attacking = locked && foe.seen && foe.los && foe.dist <= spacing.attackRange + ATTACK_SLACK;
    const mine = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    const swap = swapFor(ctx, foe, weapon);
    /** Out of the ordinary: the watch for a fight going nowhere starts again from here. */
    const touch = (): void => { if (progress) progress.since = now; };
    const finish = (order: Intent | null, status: GoalStatus, att: boolean): TacticsOutput => ({
      intents: [order, swap].filter((i): i is Intent => i !== null), status, attacking: att,
    });

    // A ball or an arrow on its way pre-empts everything on the order channel; strategy hears of it as "blocked".
    const reflex = reflexes.check(ctx);
    if (reflex) {
      touch();
      ordered();
      return finish(reflex.intent, { state: "blocked", why: `${reflex.kind}: ${reflex.intent.why}` }, false);
    }
    if (now < reflexes.holdUntil) { touch(); return finish(null, running("a sidestep is on its way"), false); }

    // Whoever opens a fight with a player while wearing a crown and hurt is asking for it.
    if (ref.kind === "hunt" && !foe.mob && self.bounty > 0 && mine < BOUNTY_MIN_HP && !locked && !ctx.engaged) {
      touch();
      return finish(null, { state: "blocked", why: "carrying a bounty below 70% hp: no new fight" }, false);
    }

    // Sudden death burns every hp pool at the same share, so the lower share falls first: the bot ahead, if it knows, stays away.
    const sdOn = knowsSd && p.hud.suddenDeathAt > 0 && now >= p.hud.suddenDeathAt && !foe.mob && foe.seen;
    if (sdOn) {
      const lead = mine - foe.hpFrac;
      sdHold = sdHold ? lead > -SD_BAND : lead > SD_BAND;
    } else sdHold = false;
    if (sdHold) {
      touch();
      if (foe.dist < SD_KEEP) {
        const to = retreat.point(ctx, [foe]);
        if (to) {
          ordered();
          return finish(
            { kind: "move", to, priority: PRIORITY.combat, timing: reactOr(ctx, ["newThreat"], foe.id), why: "sudden death: ahead, keeping distance" },
            running("sudden death: keeping distance"), false,
          );
        }
        // Cornered: nothing to gain by waiting, fight.
      } else {
        if (held) return finish(null, running("sudden death: keeping distance"), false);
        held = true;
        lastMove = null;
        return finish(
          { kind: "stop", priority: PRIORITY.combat, timing: { kind: "step" }, why: "sudden death: ahead, standing off" },
          running("sudden death: keeping distance"), false,
        );
      }
    }

    // The watch for a fight that goes nowhere.
    if (!progress || progress.id !== foe.id) progress = { id: foe.id, best: foe.dist, hp: foe.hpFrac, since: now };
    else if (attacking || foe.dist < progress.best - PROGRESS_U || foe.hpFrac < progress.hp - 0.001) {
      progress.best = Math.min(progress.best, foe.dist);
      progress.hp = foe.hpFrac;
      progress.since = now;
    } else if (now - progress.since > NO_PROGRESS_MS) {
      progress = null;
      return finish(null, failed("no progress in 10 s"), false);
    }

    // A ranged bot against a melee chaser, with the chance it rolled for this engagement: shoot, walk, shoot (kite.ts).
    if (engagement.kite && foe.seen && isRanged(weapon) && isMeleeChaser(ctx, foe)) {
      const k = orb.step(ctx, foe, weapon, locked);
      if (k === "wait") return finish(null, running("orb-walk: stepping off"), false);
      if (k) { ordered(); return finish(k, running("orb-walk"), false); }
    }

    if (locked) return finish(null, running("locked: the server is fighting"), attacking);

    // Not locked yet: walk until the server will take the click, then click once (and again only while it has not taken it).
    const reach = TARGET_RANGE - LOCK_MARGIN;
    const toward = !foe.seen || foe.dist > reach;
    if (!toward && !foe.targetable) return finish(null, running("target cannot be clicked now"), false);
    let to: Vec2 = { x: foe.x, y: foe.y };
    if (!foe.los) {
      const pts = planned(ctx, foe);
      if (!pts) {
        if (noPath >= NO_PATH_FAILS) return finish(null, failed("no path to the target"), false);
        return finish(null, running("looking for a way to the target"), false);
      }
      if (toward) to = waypoint(ctx, pts, foe);
    }
    if (toward) return finish(walk(ctx, to, foe, foe.seen ? "approach" : "go to where it was last seen"), running("approaching"), false);
    ordered();
    return finish(lockIntent(ctx, foe, "lock the foe"), running("locking"), false);
  }

  return fight;
}

