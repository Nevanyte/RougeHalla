// The bot's strategy layer (docs/BOTS.md 4, 5, 6.2): which ONE goal it pursues. Every think it scores the candidates it can
// name (farm, hunt, fight, loot, flee, roam, hold), each as persona weight x base value plus LEARN.weight x the learned bias,
// picks one with a softmax at the tier's temperature (with lapses), and keeps the current goal unless another beats it by
// HYSTERESIS. Stateful per bot: the avoid list and chase timers of the pursuit-ring breaker, the exclusions after a failure,
// and the mob hunt (huntAdapter.ts). Pure otherwise: time is the percept's, randomness is `ctx.rng.decide` and `.lapse`.
import {
  COMBO_TIER1_STACKS, COMBO_TIER2_STACKS, REGION_BUFF, REGION_WEAPONS, SIGNATURE_WEAPONS, TARGET_RANGE, TILE, feedScore,
  isRanged, rewardCurve, sigmoid,
  type BuffStat, type Vec2, type WeaponId,
} from "@raid/shared";
import { bestEdge, type MobHuntStats } from "../mobHunt";
import { createHuntAdapter, wantsMobs, type HuntAdapter } from "./huntAdapter";
import { gaussian, pickOption } from "./random";
import {
  LEARN,
  type BrainContext, type ChoiceKey, type FighterId, type FighterMemory, type FightOdds, type Goal, type GoalDecision,
  type GoalStatus, type OpponentSnapshot, type RoamWhy, type ServerMs, type StrategyLayer,
} from "./types";

// ---- the pursuit-ring breaker (ported from BotClient: three bots on a ring, each chasing the one ahead, never meet)
/** A hunt that has not got this much closer (u) in persona.chaseGiveUpMs (+ jitter) is a loop... */
export const ORBIT_PROGRESS = 40;
export const ORBIT_JITTER_MS = 1500;
/** ...its target is then left alone this long, unless it comes within ORBIT_MIN_DISTANCE or hits the bot. */
export const ORBIT_AVOID_MS = 6000;
export const ORBIT_MIN_DISTANCE = 150;

/** A candidate must beat the current goal by this much to replace it. */
export const HYSTERESIS = 0.1;

// ---- base values. Utilities live on a 0..1 scale; the committed fight and fleeing sit above everything a persona can want.
const FIGHT_U = 0.85;
const FLEE_U = 1.1;
const FLEE_DEPTH_U = 0.15;
const HUNT_CAP = 0.84;
const COLISEUM_ROAM_U = 0.5;
/** Below the wait (0.06): walking to the map centre, where everybody ends up, is the last thing a bot that avoids fights does. */
const CENTRE_ROAM_U = 0.03;
const PATROL_U = 0.1;
const WAIT_U = 0.06;
/** A holder in the coliseum waits this long plus up to this much more (x how timid it is) before it joins a fight. */
const HOLD_PATIENCE_MS = 12_000;
const HOLD_PATIENCE_SPAN_MS = 36_000;
/** What lying low is worth to a bot at the bottom of its hp ramp (it fades to nothing at the re-engage hp). */
const LIE_LOW_U = 0.18;
const CAMP_ROAM_FACTOR = 0.7;
const MAX_UTILITY = 1.3;

const FLEE_NEAR = 360;
const FLEE_KEEP = 520;
const FLEE_MOB_NEAR = 320;
const FLEE_HIT_MS = 2500;
const FLEE_GIVE_UP_MS = 8000;
const FLEE_BAN_MS = 6000;
const FLEE_MIN_MS = 1500;
const FLEE_SPAN_MS = 1500;

const THIRD_PARTY_MS = 6000;
const REMEMBERED_HUNT_MS = 12_000;
const BOUNTY_FULL = 30;
/** A crown on the foe lowers the logit needed to open on it, by this much at BOUNTY_FULL for a bounty-minded persona (x persona.bounty). */
const BOUNTY_LOGIT_RELIEF = 0.8;
/** The weight of the third-party cue grows with how much the persona likes it: x (BUSY_BASE + persona.thirdParty). */
const BUSY_BASE = 0.5;
/** A misjudgement of a foe holds this long before the bot sizes it up afresh. */
const JUDGE_KEEP_MS = 5000;
/** How fast the utility of a hunt grows above the needed logit: 1 - exp(-HUNT_SHARPNESS x surplus). */
const HUNT_SHARPNESS = 1.5;
/** An evasion is kept at least this long, and its radius is wider by this much once under way (so it does not flicker at the edge). */
const EVADE_KEEP_MS = 1800;
const EVADE_HYSTERESIS = 120;
/** A player is "coming" when it is walking at the bot (memory's chasingMe) or inside this share of the wary radius. */
const EVADE_CLOSE_SHARE = 0.55;
/** Evading outranks a farm (up to 0.84) and a loot detour, and yields to a fight already begun (0.85) and to a hurt flight (1.1). */
const EVADE_U = 0.9;
/**
 * The first minute is for mobs and loot: every fight is asked for this much more logit at the start of the raid, falling to nothing
 * by OPENING_MS. (Nobody opens a coin flip while the camps are untouched; a victim already hurt, or a sure thing, is still taken.)
 */
/**
 * The first minute is for the camps: every fight is asked for this much more logit (a coin flip needs about 3.5 more, a sure thing
 * is still taken) at the start of the raid, falling to nothing by OPENING_MS. Without it the first kills came at 11 s, before any
 * camp was touched (docs/BOTS_TUNING.md 0).
 */
const OPENING_LOGIT = 3.5;
const OPENING_MS = 60_000;
/** The opening's restraint fades out as the patience timer runs under OPENING_TIMER_FREE_MS + OPENING_TIMER_SPAN_MS and is gone at the first. */
const OPENING_TIMER_FREE_MS = 20_000;
const OPENING_TIMER_SPAN_MS = 60_000;
const HP_READY_FLOOR = 0.15;
const STALE_FACTOR = 0.55;

const LOOT_GROUND_RADIUS = 15 * TILE;
const LOOT_CHEST_RADIUS = 8 * TILE;
const LOOT_EARLY_MS = 25_000;
const LOOT_ENEMY_NEAR = 240;
const LOOT_MOB_NEAR = 220;
const LOOT_BUDGET_MS = 8000;
const LOOT_SKIP_MS = 30_000;

/** Walking distances are worked out for this many camps only (the nearest that pass the filters); the rest go by straight line. */
const CAMP_MAX_WALKS = 4;
const PATIENCE_DASH_MS = 20_000;
const PATROL_REVISIT_MS = 45_000;
const PATROL_AGE_FULL_MS = 120_000;
const ARRIVED = 96;
const HOLD_SAFE = 260;
const MAP_SPAN = 2000;
const EXCLUDE_FAILED_MS = 5000;
const EXCLUDE_DONE_MS = 1500;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);

export interface StrategyOptions {
  /** Tactics' last `attacking` (the stall watch's "busy"). Without it a lock plus `ctx.engaged` stands in. */
  attacking?: () => boolean;
  log?: (msg: string) => void;
}

interface Chase { id: FighterId; best: number; since: ServerMs; limit: number }

/** Read-only view of the layer's memory, for tests and the debug log. */
export interface StrategyState {
  readonly avoidId: FighterId | null;
  readonly avoidUntil: ServerMs;
  readonly chase: Readonly<Chase> | null;
  readonly goalSince: ServerMs;
  /** Every candidate of the last decision, before the pick. */
  readonly candidates: readonly GoalDecision[];
}

export interface Strategy extends StrategyLayer {
  readonly state: StrategyState;
  /** The mob hunt's counters (BrainStats.mobTargets, mobDrops, retreats, mobFocusMs). Zeros before the first decision. */
  readonly huntStats: MobHuntStats;
  /** The mob the hunt is on, if any (null once the strategy chose something else). */
  readonly huntTarget: string | null;
  /** Awake mobs near a point, for tactics' pickup rule. Empty before the first decision. */
  awakeNear(from: Vec2, radius: number, now: ServerMs): Vec2[];
}

interface Cand extends GoalDecision { readonly key: string }

/** A player the bot knows of: on screen now, or remembered. */
interface Enemy {
  readonly id: FighterId;
  readonly pos: Vec2;
  readonly dist: number;
  readonly hpFrac: number;
  readonly bounty: number;
  readonly visible: boolean;
  readonly immune: boolean;
  readonly targetable: boolean;
  /** ms since it was last on screen; 0 when visible. */
  readonly age: number;
  readonly snap: OpponentSnapshot;
  /** 0..1: seen trading hits with a third fighter, and how recently. */
  readonly cue: number;
}

export function createStrategy(opts: StrategyOptions = {}): Strategy {
  return new StrategyImpl(opts);
}

function goalKey(g: Goal): string {
  switch (g.kind) {
    case "idle": return "idle";
    case "farm": return `farm:${g.mob}`;
    case "hunt": return `hunt:${g.target}`;
    case "fight": return `fight:${g.target}`;
    case "loot": return `loot:${g.container}`;
    case "flee": return "flee";
    case "roam": return `roam:${g.why}:${Math.round(g.to.x / (3 * TILE))},${Math.round(g.to.y / (3 * TILE))}`;
    case "hold": return `hold:${g.why}`;
    case "module": return `module:${g.module}:${JSON.stringify(g.data)}`;
  }
}

class StrategyImpl implements Strategy {
  private adapter: HuntAdapter | null = null;
  private avoidId: FighterId | null = null;
  private avoidUntil = 0;
  private avoidSince = 0;
  private chase: Chase | null = null;
  private currentKey = "";
  private goalSince = 0;
  private fleeBanUntil = 0;
  private readonly excluded = new Map<string, ServerMs>();
  private readonly lootSkip = new Map<string, ServerMs>();
  /** The misjudgement (a standard normal draw) of each foe, and when it is drawn afresh. */
  private readonly judged = new Map<FighterId, { until: ServerMs; z: number }>();
  private last: readonly GoalDecision[] = [];

  constructor(private readonly opts: StrategyOptions) {}

  get state(): StrategyState {
    return { avoidId: this.avoidId, avoidUntil: this.avoidUntil, chase: this.chase, goalSince: this.goalSince, candidates: this.last };
  }

  get huntStats(): MobHuntStats {
    return this.adapter?.stats ?? { targets: 0, drops: 0, retreats: 0, focusMs: 0 };
  }

  get huntTarget(): string | null {
    return this.adapter?.hunter.target ?? null;
  }

  awakeNear(from: Vec2, radius: number, now: ServerMs): Vec2[] {
    return this.adapter?.awakeNear(from, radius, now) ?? [];
  }

  decide(ctx: BrainContext, current: Goal, status: GoalStatus): GoalDecision {
    const { p, cfg } = ctx;
    const now = p.now;
    if (p.self.status !== "alive") {
      this.last = [];
      return { goal: { kind: "idle" }, utility: 0, why: "not alive" };
    }
    this.adapter ??= createHuntAdapter(cfg, { attacking: this.opts.attacking, log: this.opts.log });
    const adapter = this.adapter;
    this.sync(current, now);
    this.settle(current, status, now);
    const hunt = adapter.decide(ctx);
    const enemies = enemiesOf(ctx);
    this.refreshAvoid(ctx, enemies);
    this.trackChase(ctx, current, enemies);

    const sd = p.hud.suddenDeathAt > 0 && now >= p.hud.suddenDeathAt;
    const cands: Cand[] = [];
    const add = (c: Cand | null): void => { if (c) cands.push(c); };
    const flee = this.flee(ctx, current, hunt.kind === "retreat" ? hunt.from : null, enemies);
    add(flee);
    const fight = this.fight(ctx, current, enemies);
    add(fight);
    const fightTarget = fight && fight.goal.kind === "fight" ? fight.goal.target : null;
    if (p.hud.inColiseum) {
      for (const c of this.coliseum(ctx, current, enemies, sd, fightTarget)) add(c);
    } else {
      if (hunt.kind === "mob") add(this.farm(ctx, hunt.id));
      const hcands = this.hunts(ctx, enemies, sd ? "sd" : "normal", fightTarget);
      for (const c of hcands) add(c);
      add(this.evade(ctx, current, enemies, hcands, fight));
      add(this.lastSeen(ctx, enemies));
      if (wantsMobs(hunt)) for (const c of this.camps(ctx)) add(c);
      add(this.patienceDash(ctx));
      add(this.patrol(ctx));
      add(this.lieLow(ctx));
      add(this.centre(ctx));
    }
    for (const c of this.loot(ctx, enemies)) add(c);
    for (const m of cfg.modules) {
      if (!m.enabled(cfg.features)) continue;
      for (const g of m.goals?.(ctx) ?? []) cands.push({ ...g, utility: Math.max(0, g.utility), key: goalKey(g.goal) });
    }
    const live = dedupe(cands.filter((c) => !this.isExcluded(c.key, now)));
    // Standing still is what a bot does when it has nothing else, not an option it draws against real ones (an Easy softmax would pick it for ten seconds on end).
    if (live.length === 0) {
      live.push({ goal: { kind: "hold", at: { x: p.self.x, y: p.self.y }, why: "wait" }, utility: WAIT_U, why: "nothing to do", key: "hold:wait" });
    }
    this.last = live.map(({ key: _key, ...d }) => d);
    if (live.length === 0) return { goal: { kind: "idle" }, utility: 0, why: "nothing to do" };
    const curKey = goalKey(current);
    const cur = live.find((c) => c.key === curKey) ?? null;

    let chosen: Cand;
    if (cur && current.kind === "fight" && status.state !== "done" && status.state !== "failed" && !flee
      && now - this.goalSince < cfg.tier.attention.reconsiderMs) {
      chosen = cur; // tunnel vision: a fight is only weighed against the rest every reconsiderMs, a flee excepted
    } else {
      const pick = pickOption(ctx.rng.decide, ctx.rng.lapse, live.map((c) => c.utility), cfg.tier.softmaxT, cfg.tier.lapseP);
      chosen = live[pick.index]!;
      // Standing around is not a commitment: any real option replaces it, or a bot with nothing to do would stand all run.
      const idling = current.kind === "idle" || (current.kind === "hold" && current.why === "wait");
      if (cur && !idling && chosen.key !== cur.key && chosen.utility < cur.utility + HYSTERESIS) chosen = cur;
    }

    if (chosen.goal.kind !== "farm" && adapter.hunter.target !== null) adapter.release(ctx);
    const kept = chosen.key === curKey;
    const out: GoalDecision = {
      goal: kept && JSON.stringify(chosen.goal) === JSON.stringify(current) ? current : chosen.goal,
      utility: chosen.utility,
      why: kept ? `keeping: ${chosen.why}` : chosen.why,
    };
    return kept || !chosen.choice ? out : { ...out, choice: chosen.choice };
  }

  // ---------------------------------------------------------------------------------------------------------- bookkeeping

  /** Times how long the current goal has run. Compared by key: a flee that is renewed, a roam target that creeps, is one goal. */
  private sync(current: Goal, now: ServerMs): void {
    const key = goalKey(current);
    if (key !== this.currentKey) {
      this.currentKey = key;
      this.goalSince = now;
    }
  }

  /** A goal that tactics reports done or failed is not offered again at once; a failed flee means cornered, a failed pickup a lost cause. */
  private settle(current: Goal, status: GoalStatus, now: ServerMs): void {
    for (const [k, until] of this.excluded) if (until <= now) this.excluded.delete(k);
    for (const [k, until] of this.lootSkip) if (until <= now) this.lootSkip.delete(k);
    // A flee that ran its leg out is renewed by the next think, not shut out.
    if (status.state === "failed" || (status.state === "done" && current.kind !== "flee")) {
      this.excluded.set(goalKey(current), now + (status.state === "failed" ? EXCLUDE_FAILED_MS : EXCLUDE_DONE_MS));
      if (status.state === "failed" && current.kind === "flee") this.fleeBanUntil = now + FLEE_BAN_MS;
      if (status.state === "failed" && current.kind === "loot") this.lootSkip.set(current.container, now + LOOT_SKIP_MS);
    }
    if (current.kind === "loot" && now - this.goalSince > LOOT_BUDGET_MS) this.lootSkip.set(current.container, now + LOOT_SKIP_MS);
  }

  private isExcluded(key: string, now: ServerMs): boolean {
    const until = this.excluded.get(key);
    return until !== undefined && until > now;
  }

  private attacking(ctx: BrainContext): boolean {
    return this.opts.attacking ? this.opts.attacking() : ctx.p.self.attackTarget !== null && ctx.engaged;
  }

  /** The avoidance ends when the target comes close, hits the bot, or after ORBIT_AVOID_MS. */
  private refreshAvoid(ctx: BrainContext, enemies: readonly Enemy[]): void {
    const id = this.avoidId;
    if (id === null) return;
    const now = ctx.p.now;
    if (now >= this.avoidUntil) { this.avoidId = null; return; }
    const m = ctx.mem.fighters.get(id);
    const hit = (m?.hitMeAt != null && m.hitMeAt >= this.avoidSince) || ctx.mem.self.recentHits.some((h) => h.by === id && h.t >= this.avoidSince);
    const close = enemies.some((e) => e.id === id && e.visible && e.dist < ORBIT_MIN_DISTANCE);
    if (hit || close) this.avoidId = null;
  }

  /**
   * Times the chase of the current hunt's target. One that is not closing in for too long gets its target avoided from now on.
   * Walking off for a weapon, a farm or a flee is not a chase going nowhere: the timer restarts when the hunt does.
   */
  private trackChase(ctx: BrainContext, current: Goal, enemies: readonly Enemy[]): void {
    if (current.kind !== "hunt" && current.kind !== "fight") { this.chase = null; return; }
    const e = enemies.find((x) => x.id === current.target);
    if (!e) { this.chase = null; return; }
    const now = ctx.p.now;
    const c = this.chase;
    if (!c || c.id !== e.id) {
      this.chase = { id: e.id, best: e.dist, since: now, limit: ctx.cfg.persona.chaseGiveUpMs + ctx.rng.decide() * ORBIT_JITTER_MS };
    } else if (this.attacking(ctx) || e.dist < ORBIT_MIN_DISTANCE || e.dist < c.best - ORBIT_PROGRESS) {
      c.best = e.dist;
      c.since = now;
    } else if (now - c.since > c.limit) {
      this.opts.log?.(`chase of ${e.id} is going nowhere: turning on someone else`);
      this.avoidId = e.id;
      this.avoidSince = now;
      this.avoidUntil = now + ORBIT_AVOID_MS;
      this.chase = null;
    }
  }

  // ------------------------------------------------------------------------------------------------------------ candidates

  /** Utility = base + LEARN.weight x the learned bias of the key, which can never move it by more than weight x cap. */
  private scored(ctx: BrainContext, goal: Goal, base: number, why: string, choice?: ChoiceKey): Cand {
    let u = base;
    if (choice && ctx.cfg.learned.enabled) {
      const b = ctx.cfg.learned.bias(choice);
      u += LEARN.weight * clamp(Number.isFinite(b) ? b : 0, -LEARN.cap, LEARN.cap);
    }
    return { goal, utility: clamp(u, 0, MAX_UTILITY), why, key: goalKey(goal), ...(choice ? { choice } : {}) };
  }

  /** Away from whoever is near and dangerous while hurt: below fleeHp, and (once running) until reengageHp or out of reach. */
  private flee(ctx: BrainContext, current: Goal, retreatFrom: readonly Vec2[] | null, enemies: readonly Enemy[]): Cand | null {
    const { p, mem, cfg } = ctx;
    const now = p.now;
    if (now < this.fleeBanUntil) return null;
    const me = p.self;
    const persona = cfg.persona;
    const hp = me.maxHp > 0 ? me.hp / me.maxHp : 1;
    const wasFleeing = current.kind === "flee";
    const radius = wasFleeing ? FLEE_KEEP : FLEE_NEAR;
    const threats: Vec2[] = [];
    for (const e of enemies) if (e.visible && e.dist <= radius) threats.push(e.pos);
    for (const h of mem.self.recentHits) {
      if (h.by === null || now - h.t > FLEE_HIT_MS) continue;
      const at = positionOf(ctx, h.by);
      if (at) threats.push(at);
    }
    for (const q of this.awakeNear(me, FLEE_MOB_NEAR, now)) threats.push(q);
    if (retreatFrom) threats.push(...retreatFrom);
    if (threats.length === 0) return null;
    const fleeHp = persona.fleeHp;
    const hurt = hp < fleeHp || (wasFleeing && hp < persona.reengageHp);
    if (!hurt && retreatFrom === null) return null;
    // A chaser that keeps pace for this long cannot be outrun: turn and fight (the old bot's "cornered").
    if (wasFleeing && now - this.goalSince > FLEE_GIVE_UP_MS && threats.some((t) => dist(t, me) < ORBIT_MIN_DISTANCE)) {
      this.fleeBanUntil = now + FLEE_BAN_MS;
      return null;
    }
    const depth = clamp01(1 - hp / fleeHp);
    const from = threats.slice(0, 6);
    return this.scored(ctx, { kind: "flee", from, until: now + FLEE_MIN_MS + FLEE_SPAN_MS * depth },
      FLEE_U + FLEE_DEPTH_U * depth, `hp ${Math.round(hp * 100)}% below ${Math.round(persona.fleeHp * 100)}%, ${threats.length} threat(s)`);
  }

  /**
   * Keeping out of the way of a player it does not want to fight (docs/BOTS_TUNING.md 3): one that is walking at the bot or already
   * close, and that no hunt candidate wants, makes the bot walk off for a moment. A fight already begun is not left this way (that is
   * the hurt flight's business), and neither is a mob fight. The tier's `wary` is the radius it notices at; 0 never evades.
   */
  private evade(ctx: BrainContext, current: Goal, enemies: readonly Enemy[], hunts: readonly Cand[], fight: Cand | null): Cand | null {
    const { p, mem } = ctx;
    const r0 = ctx.cfg.tier.wary;
    if (r0 <= 0 || fight || ctx.engaged || p.now < this.fleeBanUntil || p.hud.gatesLocked) return null;
    const r = current.kind === "flee" ? r0 + EVADE_HYSTERESIS : r0;
    const wanted = new Set(hunts.flatMap((c) => (c.goal.kind === "hunt" ? [c.goal.target] : [])));
    const from: Vec2[] = [];
    for (const e of enemies) {
      if (!e.visible || e.dist > r || !e.targetable || e.immune || wanted.has(e.id)) continue;
      if (mem.fighters.get(e.id)?.chasingMe === true || e.dist < EVADE_CLOSE_SHARE * r) from.push(e.pos);
    }
    if (from.length === 0) return null;
    return this.scored(ctx, { kind: "flee", from: from.slice(0, 4), until: p.now + EVADE_KEEP_MS }, EVADE_U, `keeping away from ${from.length} player(s) it does not want to fight`);
  }

  /** Already trading blows with a player: keep it. The lock names the target; failing that, whoever hit the bot last. */
  private fight(ctx: BrainContext, current: Goal, enemies: readonly Enemy[]): Cand | null {
    const { p, mem } = ctx;
    let target: Enemy | undefined;
    if (ctx.engaged) {
      if (p.self.attackTarget !== null) target = enemies.find((e) => e.id === p.self.attackTarget && e.visible);
      if (!target) {
        const hits = [...mem.self.recentHits].sort((a, b) => b.t - a.t);
        for (const h of hits) {
          target = h.by === null ? undefined : enemies.find((e) => e.id === h.by && e.visible);
          if (target) break;
        }
      }
    }
    if (!target && current.kind === "fight") target = enemies.find((e) => e.id === current.target && e.visible && e.dist < TARGET_RANGE);
    if (!target) return null;
    return this.scored(ctx, { kind: "fight", target: target.id }, FIGHT_U, `trading blows with ${target.id}`);
  }

  /** The mob the hunt picked: persona.pve x the reward curve (a fed bot gets less out of a mob), elites by appetite. */
  private farm(ctx: BrainContext, mobId: FighterId): Cand | null {
    const { p, mem, cfg } = ctx;
    const me = p.self;
    const m = mem.mobs.get(mobId);
    const persona = cfg.persona;
    const reward = rewardCurve(feedScore(me.kills, me.mobKills));
    let base = persona.pve * (0.35 + 0.5 * reward);
    if (m?.kind === "elite") base *= 0.55 + 0.45 * persona.eliteAppetite;
    const first = me.mobKills === 0 && !mem.choices.some((k) => k.startsWith("opener|"));
    const choice = first && me.faction !== null && m?.faction ? (`opener|${me.faction}|${m.faction}` as ChoiceKey) : undefined;
    return this.scored(ctx, { kind: "farm", mob: mobId, camp: m?.campId ?? null }, base,
      `${m?.faction ?? "?"} ${m?.kind ?? "mob"}, reward ${reward.toFixed(2)}`, choice);
  }

  /** The players worth chasing: odds against the persona's threshold, the bounty on them, a third fighter already engaged with them. */
  private hunts(ctx: BrainContext, enemies: readonly Enemy[], mode: "normal" | "sd", fightTarget: FighterId | null): Cand[] {
    const { p, cfg, know } = ctx;
    const now = p.now;
    const persona = cfg.persona;
    const me = p.self;
    const hpShare = me.maxHp > 0 ? me.hp / me.maxHp : 1;
    const span = Math.max(0.01, persona.reengageHp - persona.fleeHp);
    const hpReady = clamp((hpShare - persona.fleeHp) / span, HP_READY_FLOOR, 1);
    const out: Cand[] = [];
    let avoided: Enemy | null = null;
    for (const e of enemies) {
      if (e.id === fightTarget || e.immune || !e.targetable) continue;
      if (!e.visible && e.age > REMEMBERED_HUNT_MS) continue;
      if (this.avoidId === e.id && now < this.avoidUntil && e.dist >= ORBIT_MIN_DISTANCE) { avoided = e; continue; }
      const c = this.huntCand(ctx, e, know.odds(me, e.snap), mode, hpReady);
      if (c) out.push(c);
    }
    if (out.length === 0 && avoided) {
      const c = this.huntCand(ctx, avoided, know.odds(me, avoided.snap), mode, hpReady); // the last one standing
      if (c) out.push(c);
    }
    return out.sort((a, b) => b.utility - a.utility).slice(0, 3);
  }

  /**
   * How the bot sizes up opening a fight with `e` (BOTS_TUNING.md 2): a logistic of the hp lead, whether the foe is busy with a third
   * fighter, and the matchup the hue shows, each read with the tier's weight, plus a misjudgement. Returns the logit; the chance to win
   * is its sigmoid.
   */
  private appraise(ctx: BrainContext, e: Enemy, odds: FightOdds): number {
    const { p, cfg } = ctx;
    const a = cfg.tier.appraisal;
    const me = p.self;
    const mine = me.maxHp > 0 ? me.hp / me.maxHp : 1;
    let j = this.judged.get(e.id);
    if (!j || j.until <= p.now) {
      j = { until: p.now + JUDGE_KEEP_MS, z: gaussian(ctx.rng.decide) };
      this.judged.set(e.id, j);
    }
    return a.bias + a.lead * (mine - e.hpFrac) + a.busy * (BUSY_BASE + cfg.persona.thirdParty) * e.cue + a.hue * odds.score + a.noise * j.z;
  }

  private huntCand(ctx: BrainContext, e: Enemy, odds: FightOdds, mode: "normal" | "sd", hpReady: number): Cand | null {
    const persona = ctx.cfg.persona;
    const bountyShare = clamp01(e.bounty / BOUNTY_FULL);
    const fresh = e.visible ? 1 : STALE_FACTOR * (1 - e.age / REMEMBERED_HUNT_MS);
    const goal: Goal = { kind: "hunt", target: e.id };
    if (mode === "sd") {
      // Sudden death burns every hp pool at the same share: the weak fall first, so go for the weak one that is near.
      const u = (0.6 + 0.25 * (1 - e.hpFrac) + 0.1 * (1 - Math.min(1, e.dist / 800))) * fresh;
      return this.scored(ctx, goal, Math.min(HUNT_CAP, u), `sudden death: ${e.id} at ${Math.round(e.hpFrac * 100)}% hp`);
    }
    const logit = this.appraise(ctx, e, odds);
    const sinceStart = ctx.p.now - ctx.p.hud.raidStartedAt;
    const timerLeft = ctx.p.hud.patienceEndsAt > 0 ? ctx.p.hud.patienceEndsAt - ctx.p.now : Infinity;
    // The first minute is for the camps; with the patience timer nearly out the coliseum forces the fight anyway, so nothing is held back.
    const opening = sinceStart < OPENING_MS
      ? OPENING_LOGIT * (1 - Math.max(0, sinceStart) / OPENING_MS) * clamp((timerLeft - OPENING_TIMER_FREE_MS) / OPENING_TIMER_SPAN_MS, 0, 1)
      : 0;
    const needed = persona.engageEdge + opening + (ctx.p.self.bounty > 0 ? persona.bountyCaution : 0) - BOUNTY_LOGIT_RELIEF * persona.bounty * bountyShare;
    const surplus = logit - needed;
    // A person does not walk up to a fight they do not expect to win by enough for their taste.
    if (surplus <= 0) return null;
    const gate = 1 - Math.exp(-HUNT_SHARPNESS * surplus);
    let u = persona.pvp * gate * hpReady * (1 - 0.3 * Math.min(1, e.dist / 800)) * fresh;
    u += (0.25 * persona.bounty * bountyShare + 0.2 * persona.thirdParty * e.cue) * (e.visible ? 1 : 0.7);
    return this.scored(ctx, goal, Math.min(HUNT_CAP, u), `${e.id}: ${Math.round(100 / (1 + Math.exp(-logit)))}% to win, wants ${Math.round(100 / (1 + Math.exp(-needed)))}%${e.cue > 0 ? ", third party" : ""}`);
  }

  /** A bountied (or hunted) player not seen for a while: walk toward where it probably is. */
  private lastSeen(ctx: BrainContext, enemies: readonly Enemy[]): Cand | null {
    const persona = ctx.cfg.persona;
    let best: Cand | null = null;
    for (const e of enemies) {
      if (e.visible || e.age <= REMEMBERED_HUNT_MS || e.dist < ARRIVED) continue;
      if (e.bounty <= 0 && persona.pvp < 0.7) continue;
      const u = Math.min(HUNT_CAP, 0.45 * persona.bounty * clamp01(e.bounty / BOUNTY_FULL) + 0.15 * persona.pvp);
      const c = this.scored(ctx, { kind: "roam", to: e.pos, why: "lastSeen" }, u, `${e.id} last seen ${Math.round(e.age / 1000)} s ago`);
      if (!best || c.utility > best.utility) best = c;
    }
    return best;
  }

  /** Weapons lying about or in a chest: a second weapon that counters what the bot has seen, or any when it carries one. */
  private loot(ctx: BrainContext, enemies: readonly Enemy[]): Cand[] {
    const { p, mem, cfg, know } = ctx;
    const me = p.self;
    const now = p.now;
    const persona = cfg.persona;
    if (ctx.engaged) return [];
    const carried = me.weapons.filter((w): w is WeaponId => w !== null);
    const nearest = enemies.reduce((m, e) => (e.visible ? Math.min(m, e.dist) : m), Infinity);
    if (nearest < LOOT_ENEMY_NEAR || this.awakeNear(me, LOOT_MOB_NEAR, now).length > 0) return [];
    const early = now - p.hud.raidStartedAt <= LOOT_EARLY_MS;

    interface Seen { id: string; kind: string; pos: Vec2; closed: boolean; weapon: WeaponId | null | undefined; seenAt: ServerMs; visible: boolean }
    const all = new Map<string, Seen>();
    for (const [id, c] of mem.containers) {
      if (c.skipped) { all.delete(id); continue; }
      all.set(id, { id, kind: c.kind, pos: c.pos, closed: c.closed, weapon: c.weapon, seenAt: c.seenAt, visible: false });
    }
    for (const c of p.containers) {
      if (mem.containers.get(c.id)?.skipped) continue;
      all.set(c.id, { id: c.id, kind: c.kind, pos: { x: c.x, y: c.y }, closed: c.closed, weapon: c.weapon, seenAt: now, visible: true });
    }

    const counter = (w: WeaponId): number => {
      let sum = 0;
      let n = 0;
      for (const e of enemies) {
        const theirs = e.snap.inHand ?? e.snap.otherSlot ?? (e.snap.faction ? SIGNATURE_WEAPONS[e.snap.faction] : null);
        if (!theirs) continue;
        sum += know.weaponEdge(w, theirs);
        n++;
      }
      return n === 0 ? 0 : sum / n;
    };
    const heldBest = carried.length === 0 ? -1 : Math.max(...carried.map(counter));

    const out: Cand[] = [];
    for (const c of all.values()) {
      if (!c.closed || c.weapon === null) continue;
      if (this.lootSkip.has(c.id)) continue;
      if (c.kind === "ground" && !c.visible && now - c.seenAt > 60_000) continue; // unseen for a minute: someone took it
      const reach = c.kind === "ground" ? LOOT_GROUND_RADIUS : c.kind === "body" ? LOOT_CHEST_RADIUS : c.kind === "chest" && early ? LOOT_CHEST_RADIUS : 0;
      const d = dist(me, c.pos);
      if (d >= reach) continue;
      if (enemies.some((e) => dist(e.pos, c.pos) < d)) continue; // somebody else is nearer: they get there first
      const w = c.weapon;
      let base: number;
      let choice: ChoiceKey | undefined;
      if (w === undefined) {
        if (carried.length >= 2) continue;
        base = 0.3; // a chest or body out of interact range: contents unknown
      } else {
        if (carried.includes(w)) continue;
        const k = counter(w);
        if (carried.length < 2) {
          base = 0.5 + 0.35 * k;
          if (carried.length === 1 && me.faction !== null) choice = `second|${me.faction}|${w}` as ChoiceKey;
        } else {
          // Both hands full: only a weapon that counters something and clearly improves on what is held.
          if (k <= 0.34 || k < heldBest + 0.3) continue;
          base = 0.35 + 0.3 * (k - heldBest);
        }
      }
      const u = persona.loot * base * (1 - 0.5 * (d / reach)) + (early && carried.length < 2 ? 0.1 * persona.loot : 0);
      out.push(this.scored(ctx, { kind: "loot", container: c.id }, Math.min(0.8, u), `${w ?? "?"} in ${c.kind} ${Math.round(d)} u away`, choice));
    }
    return out.sort((a, b) => b.utility - a.utility).slice(0, 2);
  }

  /**
   * Camps to walk to when no mob is in reach (docs/BOTS.md 2.7): the nearest `horizon` camps, by walking distance for the tiers
   * that path, weighed by the bot's own belief about the matchup and by whether the camp's drops feed the combo it is stacking.
   */
  private camps(ctx: BrainContext): Cand[] {
    const { p, mem, cfg, know } = ctx;
    const me = p.self;
    const persona = cfg.persona;
    if (me.faction === null || me.mobKills >= persona.mobKillGoal) return [];
    if (me.maxHp > 0 && me.hp / me.maxHp < Math.max(0.5, persona.fleeHp + 0.05)) return [];
    const stat = stackingStat(me.stacks);
    const first = !mem.choices.some((k) => k.startsWith("opener|"));
    const near = cfg.map.camps
      .map((camp) => ({ camp, d: dist(me, camp) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, cfg.tier.route.horizon);
    const out: Cand[] = [];
    let walks = 0;
    for (const { camp, d } of near) {
      const cm = mem.camps.get(camp.id);
      if (cm?.clearedAt != null) continue;
      const elite = camp.eliteSpot >= 0;
      const theirs = REGION_WEAPONS[camp.zone];
      if (isRanged(theirs) || bestEdge(me.weapons, theirs) <= -2 || (elite && bestEdge(me.weapons, theirs) < 0)) continue; // the hunt never takes these
      if (d < camp.r) continue; // standing in it: whatever the hunt would take, it takes from here
      const share = know.mobShare(me.faction, camp.zone, elite);
      if (share < (elite ? 0.6 : 0.5)) continue;
      let walk = d * 1.3;
      if (cfg.tier.route.walkPaths && walks++ < CAMP_MAX_WALKS) {
        const w = ctx.svc.paths.walk(me, camp);
        if (w === null) continue;
        walk = w.dist;
      }
      const buff = stat !== null && REGION_BUFF[camp.zone] === stat ? 0.1 : 0;
      const value = 0.3 + 0.4 * share + buff + 0.25 * (1 - Math.min(1, walk / MAP_SPAN));
      let u = persona.pve * CAMP_ROAM_FACTOR * value;
      if (elite) u *= 0.55 + 0.45 * persona.eliteAppetite;
      if (cm?.contestedAt != null && p.now - cm.contestedAt < 20_000) u *= 0.7;
      const why: RoamWhy = cm?.visitedAt == null ? "explore" : "camp";
      const choice = first ? (`opener|${me.faction}|${camp.zone}` as ChoiceKey) : undefined;
      out.push(this.scored(ctx, { kind: "roam", to: { x: camp.x, y: camp.y }, why }, u, `${camp.id} (${camp.zone}), share ${share.toFixed(2)}`, choice));
    }
    return out.sort((a, b) => b.utility - a.utility).slice(0, 2);
  }

  /** The patience timer is about to teleport everyone: drift toward the coliseum. */
  private patienceDash(ctx: BrainContext): Cand | null {
    const { p, cfg } = ctx;
    const left = p.hud.patienceEndsAt - p.now;
    if (p.hud.patienceEndsAt <= 0 || left <= 0 || left > PATIENCE_DASH_MS || p.hud.gatesLocked) return null;
    const to = cfg.map.coliseum.centre;
    if (dist(p.self, to) < ARRIVED) return null;
    return this.scored(ctx, { kind: "roam", to: { x: to.x, y: to.y }, why: "coliseum" }, COLISEUM_ROAM_U, `patience ends in ${Math.round(left / 1000)} s`);
  }

  /**
   * With nothing to fight, fetch or farm, a bot still looks for people: it walks to the camp it has seen least recently (a camp is
   * where the others go for mobs). Without it a bot that has had enough of mobs would stand at the map centre until the timer.
   */
  private patrol(ctx: BrainContext): Cand | null {
    const { p, mem, cfg } = ctx;
    let best: { camp: Vec2; id: string; score: number } | null = null;
    for (const camp of cfg.map.camps) {
      const d = dist(p.self, camp);
      if (d < camp.r + ARRIVED) continue;
      const visited = mem.camps.get(camp.id)?.visitedAt ?? null;
      const age = visited === null ? PATROL_AGE_FULL_MS : p.now - visited;
      if (age < PATROL_REVISIT_MS) continue;
      const score = Math.min(1, age / PATROL_AGE_FULL_MS) - d / (2 * MAP_SPAN);
      if (!best || score > best.score) best = { camp, id: camp.id, score };
    }
    if (!best) return null;
    // A hurt bot does not go looking for people (lieLow); a healthy one with nothing to do walks to the camp it saw longest ago.
    return this.scored(ctx, { kind: "roam", to: { x: best.camp.x, y: best.camp.y }, why: "explore" },
      (PATROL_U + 0.06 * cfg.persona.pvp) * this.healthy(ctx), `looking for people at ${best.id}`);
  }

  /** 0.15..1: 1 from the persona's re-engage hp up, 0.15 at its flee hp and below (the same ramp the hunts use). */
  private healthy(ctx: BrainContext): number {
    const { self } = ctx.p;
    const persona = ctx.cfg.persona;
    const hp = self.maxHp > 0 ? self.hp / self.maxHp : 1;
    return clamp((hp - persona.fleeHp) / Math.max(0.01, persona.reengageHp - persona.fleeHp), HP_READY_FLOOR, 1);
  }

  /** Hurt, with nothing to fight for and no hp to get back: a person stops where it is and waits for the timer instead of wandering. */
  private lieLow(ctx: BrainContext): Cand | null {
    const h = this.healthy(ctx);
    if (h >= 1) return null;
    const { self } = ctx.p;
    return this.scored(ctx, { kind: "hold", at: { x: self.x, y: self.y }, why: "ambush" }, LIE_LOW_U * (1 - h), `hurt (${Math.round((self.hp / Math.max(1, self.maxHp)) * 100)}% hp): lying low`);
  }

  private centre(ctx: BrainContext): Cand | null {
    const { p, cfg } = ctx;
    const to = { x: (cfg.map.w * TILE) / 2, y: (cfg.map.h * TILE) / 2 };
    if (dist(p.self, to) < 2 * ARRIVED) return null;
    return this.scored(ctx, { kind: "roam", to, why: "centre" }, CENTRE_ROAM_U, "nothing better to do");
  }

  /**
   * Inside the coliseum (docs/BOTS.md 4, tactics). Before sudden death a bot with coliseum < 0.5 holds a spot away from the others
   * and waits for two of them to engage; a bolder one opens on the weakest visible enemy. Sudden death hunts the weak and near.
   */
  private coliseum(ctx: BrainContext, current: Goal, enemies: readonly Enemy[], sd: boolean, fightTarget: FighterId | null): Cand[] {
    const { p, cfg, know } = ctx;
    const persona = cfg.persona;
    const me = p.self;
    if (sd) return this.hunts(ctx, enemies, "sd", fightTarget);
    const out: Cand[] = [];
    const cue = enemies.reduce((m, e) => Math.max(m, e.cue), 0);
    if (p.hud.alive > 2 && persona.coliseum < 1) {
      // Everybody waiting for two others to start would wait until the burn: patience runs out, sooner for the bolder.
      const since = ctx.mem.self.teleportedAt === null ? 0 : p.now - ctx.mem.self.teleportedAt;
      const patience = Math.max(0, 1 - since / (HOLD_PATIENCE_MS + HOLD_PATIENCE_SPAN_MS * (1 - persona.coliseum)));
      const u = (1 - persona.coliseum) * 0.85 * (1 - 0.8 * persona.thirdParty * cue) * patience;
      out.push(this.scored(ctx, { kind: "hold", at: this.holdSpot(ctx, current, enemies), why: "coliseum" }, u, `hold the ring (aggression ${persona.coliseum})`));
    }
    for (const e of enemies) {
      if (e.id === fightTarget || e.immune || !e.targetable || (!e.visible && e.age > REMEMBERED_HUNT_MS)) continue;
      const edge = know.odds(me, e.snap).edge;
      const bountyShare = clamp01(e.bounty / BOUNTY_FULL);
      const fresh = e.visible ? 1 : STALE_FACTOR * (1 - e.age / REMEMBERED_HUNT_MS);
      const u = (0.3 + 0.55 * persona.coliseum * (0.5 + 0.5 * sigmoid(edge)) + 0.25 * (1 - e.hpFrac)
        + 0.4 * persona.thirdParty * e.cue + 0.15 * persona.bounty * bountyShare) * fresh;
      out.push(this.scored(ctx, { kind: "hunt", target: e.id }, Math.min(HUNT_CAP, u), `coliseum: ${e.id} at ${Math.round(e.hpFrac * 100)}% hp`));
    }
    out.sort((a, b) => b.utility - a.utility).splice(4);
    // Nobody to fight and no ring to hold: walk to the middle, where they are.
    const middle = cfg.map.coliseum.centre;
    if (dist(me, middle) > 2 * ARRIVED) {
      out.push(this.scored(ctx, { kind: "roam", to: { x: middle.x, y: middle.y }, why: "coliseum" }, CENTRE_ROAM_U + 0.05 * persona.coliseum, "find the others"));
    }
    return out;
  }

  /** A spot on the ring away from the others: the bot's own place if it is clear of them, else the best inner spawn. */
  private holdSpot(ctx: BrainContext, current: Goal, enemies: readonly Enemy[]): Vec2 {
    const me = ctx.p.self;
    const others = enemies.map((e) => e.pos);
    const clearance = (pt: Vec2): number => others.reduce((m, o) => Math.min(m, dist(pt, o)), Infinity);
    if (current.kind === "hold" && current.why === "coliseum" && clearance(current.at) >= HOLD_SAFE) return current.at;
    let best: Vec2 = { x: me.x, y: me.y };
    let bestScore = Math.min(clearance(best), 600);
    for (const s of ctx.cfg.map.coliseum.innerSpawns) {
      const score = Math.min(clearance(s), 600) - 0.35 * dist(me, s);
      if (score > bestScore) { bestScore = score; best = { x: s.x, y: s.y }; }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------------------------------------------- helpers

function dedupe(cands: readonly Cand[]): Cand[] {
  const best = new Map<string, Cand>();
  for (const c of cands) {
    const old = best.get(c.key);
    if (!old || c.utility > old.utility) best.set(c.key, c);
  }
  return [...best.values()];
}

/** The stat the bot is stacking toward a combo: the fullest one still under the 3-stack combo, else under the 5-stack one. */
function stackingStat(stacks: Readonly<Record<BuffStat, number>>): BuffStat | null {
  let best: BuffStat | null = null;
  for (const [lo, hi] of [[0, COMBO_TIER1_STACKS], [COMBO_TIER1_STACKS, COMBO_TIER2_STACKS]] as const) {
    for (const s of ["hp", "attackSpeed", "moveSpeed"] as const) {
      const v = stacks[s];
      if (v > lo && v < hi && (best === null || v > stacks[best])) best = s;
    }
    if (best !== null) return best;
  }
  return null;
}

/** Where a fighter or mob is, as far as the bot knows: on screen, else remembered. */
function positionOf(ctx: BrainContext, id: FighterId): Vec2 | null {
  const f = ctx.p.fighters.find((x) => x.id === id);
  if (f) return { x: f.x, y: f.y };
  const m = ctx.p.mobs.find((x) => x.id === id);
  if (m) return { x: m.x, y: m.y };
  return ctx.mem.fighters.get(id)?.pos ?? ctx.mem.mobs.get(id)?.pos ?? null;
}

/** 0..1: this fighter was seen trading hits with a third fighter (not the bot) lately, and that fighter still stands. */
function thirdPartyCue(m: Readonly<FighterMemory> | undefined, selfId: FighterId, now: ServerMs, ctx: BrainContext): number {
  if (!m || m.engagedWith === null || m.engagedAt === null || m.engagedWith === selfId) return 0;
  const age = now - m.engagedAt;
  if (age > THIRD_PARTY_MS) return 0;
  if (ctx.mem.fighters.get(m.engagedWith)?.alive === false) return 0;
  return 1 - age / THIRD_PARTY_MS;
}

/** The standing players the bot knows of: everyone on screen, and those remembered (position from the memory's whereabouts). */
function enemiesOf(ctx: BrainContext): Enemy[] {
  const { p, mem } = ctx;
  const now = p.now;
  const out: Enemy[] = [];
  const onScreen = new Set<string>();
  for (const f of p.fighters) {
    onScreen.add(f.id);
    if (f.status !== "alive") continue;
    const m = mem.fighters.get(f.id);
    const bounty = Math.max(f.bounty, mem.bounties.get(f.id) ?? 0);
    out.push({
      id: f.id, pos: { x: f.x, y: f.y }, dist: f.dist, hpFrac: f.hpFrac, bounty, visible: true, immune: f.immune, targetable: f.targetable,
      age: 0, cue: thirdPartyCue(m, p.self.id, now, ctx),
      snap: { id: f.id, faction: f.faction, inHand: f.inHand, otherSlot: m?.otherSlot ?? null, hpFrac: f.hpFrac, bounty, dist: f.dist, tint: f.tint },
    });
  }
  for (const [id, m] of mem.fighters) {
    if (onScreen.has(id) || !m.alive) continue;
    const w = mem.whereabouts(id, now);
    if (!w) continue;
    const d = dist(p.self, w.at);
    const bounty = Math.max(m.bounty, mem.bounties.get(id) ?? 0);
    out.push({
      id, pos: { x: w.at.x, y: w.at.y }, dist: d, hpFrac: m.hpFrac, bounty, visible: false, immune: false, targetable: true,
      age: Math.max(0, now - m.seenAt), cue: thirdPartyCue(m, p.self.id, now, ctx),
      snap: { id, faction: m.faction, inHand: m.inHand, otherSlot: m.otherSlot, hpFrac: m.hpFrac, bounty, dist: d, tint: 0 },
    });
  }
  return out;
}
