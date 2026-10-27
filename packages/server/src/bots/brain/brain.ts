// The brain (docs/BOTS.md 4): memory -> strategy -> tactics (+ feature modules) -> humanizer, once per percept. This file is the
// glue and owns the cadence: when strategy and tactics think, the sequence number the real client puts on its orders, the
// stall watch the e2e bounds, and the stats. Every decision is made by a layer; every random number comes from the bot's own
// seeded streams (decide, motor, lapse) and from a fourth, derived one that fixes what the bot knows of the counter wheels, so a
// brain replays exactly from its seed and its percepts. Time is `percept.now`.
//
// A feature module is optional by construction: a disabled one is never called, and one that throws is logged and switched off
// for the rest of the run (the brain runs on the room's event loop; a module is the part most likely to meet a state it has not
// seen). The core layers are not guarded: a bug there should be loud.
import { ENGAGE_TRADE_SECONDS, mulberry32, TILE, type FactionId, type Rng, type RunResult } from "@raid/shared";
import { createHumanizer } from "./humanizer";
import { createKnowledge } from "./knowledge";
import { createMemory } from "./memory";
import { uniform } from "./random";
import { createStrategy } from "./strategy";
import { createTactics } from "./tactics";
import {
  type Brain, type BrainConfig, type BrainContext, type BrainFactory, type BrainRngs, type BrainStats, type FeatureModule,
  type Goal, type GoalDecision, type GoalKind, type GoalStatus, type Intent, type IntentChannel, type IntentKind,
  type MemoryView, type Percept, type RunSummary, type ServerMs, type Stimulus, type StimulusKind, type TacticsOutput,
  type TimedCommand,
} from "./types";

/** The brain's own timings (ms) and thresholds. */
export const BRAIN_RULES = {
  /** A stall counts after the bot has stood still this long without a reason (the old BotClient's STILL_GRACE_MS). */
  stillGraceMs: 600,
  /** The bot moved less than this (u) between two percepts: standing still. */
  stillEps: 1,
  /** Tactics think at least this often whatever the goal (a world goal's slot goes stale after 3 s). */
  actMaxGapMs: 2000,
  /** A weapon picked up this soon after a loot goal was current is a grab. */
  grabWindowMs: 2000,
} as const;

/** Stimuli that make strategy decide at once instead of waiting for its cadence (types.ts StrategyLayer). */
const SALIENT: ReadonlySet<StimulusKind> = new Set<StimulusKind>([
  "newThreat", "lowHp", "teleport", "targetDown", "announcement", "chestUp", "planOffer", "lockLost",
]);

const CHANNEL: Readonly<Record<IntentKind, IntentChannel>> = {
  lock: "order", move: "order", stop: "order", swap: "swap", pickup: "pickup", cast: "cast", plan: "menu", choose: "menu",
};

/** A seed for one of the bot's streams: the bot's seed mixed with a tag, so no two streams of a bot (or of two bots) march in step. */
function derive(seed: number, tag: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tag + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Two goals are the same goal when this is: a roam whose target creeps, a flee that is renewed, are one goal (strategy.ts goalKey). */
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

function describe(g: Goal): string {
  switch (g.kind) {
    case "farm": return `farm ${g.mob}`;
    case "hunt": return `hunt ${g.target}`;
    case "fight": return `fight ${g.target}`;
    case "loot": return `loot ${g.container}`;
    case "roam": return `roam to ${Math.round(g.to.x)},${Math.round(g.to.y)} (${g.why})`;
    case "hold": return `hold ${g.why}`;
    case "module": return `module ${g.module}`;
    case "flee": return "flee";
    case "idle": return "idle";
  }
}

const RUNNING: GoalStatus = { state: "running", why: "start" };
const NO_OUTPUT: TacticsOutput = { intents: [], status: RUNNING, attacking: false };

/**
 * The modules the brain and its strategy see: the same modules, each call guarded. A module that throws is logged once and then
 * reports itself disabled, so no layer calls it again.
 */
function guardModules(mods: readonly FeatureModule[], log: (msg: string) => void): readonly FeatureModule[] {
  const faulted = new Set<string>();
  const run = <T>(m: FeatureModule, what: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (err) {
      faulted.add(m.id);
      log(`module ${m.id}: ${what} threw (${err instanceof Error ? err.message : String(err)}); switched off`);
      return fallback;
    }
  };
  return mods.map((m): FeatureModule => ({
    id: m.id,
    enabled: (f) => !faulted.has(m.id) && run(m, "enabled", () => m.enabled(f), false),
    ...(m.observe ? { observe: (ctx: BrainContext): void => { run(m, "observe", () => m.observe!(ctx), undefined); } } : {}),
    ...(m.goals ? { goals: (ctx: BrainContext): readonly GoalDecision[] => run(m, "goals", () => m.goals!(ctx), []) } : {}),
    ...(m.intents ? { intents: (ctx: BrainContext, g: Goal): readonly Intent[] => run(m, "intents", () => m.intents!(ctx, g), []) } : {}),
    ...(m.adjust
      ? { adjust: (ctx: BrainContext, g: Goal, intents: readonly Intent[]): readonly Intent[] => run(m, "adjust", () => m.adjust!(ctx, g, intents), intents) }
      : {}),
    ...(m.act
      ? {
        act: (ctx: BrainContext, g: Extract<Goal, { kind: "module" }>): TacticsOutput => run<TacticsOutput>(
          m, "act", () => m.act!(ctx, g), { intents: [], status: { state: "failed", why: `module ${m.id} failed` }, attacking: false },
        ),
      }
      : {}),
  }));
}

/** Tactics' intents with the modules' folded in: at most one per channel; a module wins on cast and menu, and elsewhere only with a higher priority. */
function mergeIntents(base: readonly Intent[], extra: readonly Intent[]): readonly Intent[] {
  const out = base.slice();
  const claimed = new Set<IntentChannel>();
  for (const i of extra) {
    const ch = CHANNEL[i.kind];
    if (claimed.has(ch)) continue;
    const at = out.findIndex((o) => CHANNEL[o.kind] === ch);
    if (at < 0) {
      out.push(i);
      claimed.add(ch);
    } else if (ch === "cast" || ch === "menu" || i.priority < out[at]!.priority) {
      out[at] = i;
      claimed.add(ch);
    }
  }
  return out;
}

export const createBrain: BrainFactory = (cfg: BrainConfig): Brain => {
  const { tier } = cfg;
  const log = cfg.services.log;
  const rng: BrainRngs = {
    decide: mulberry32(derive(cfg.seed, 0)),
    motor: mulberry32(derive(cfg.seed, 1)),
    lapse: mulberry32(derive(cfg.seed, 2)),
  };
  const knowledgeRng: Rng = mulberry32(derive(cfg.seed, 3));
  const know = createKnowledge(tier, knowledgeRng);
  const memory = createMemory({ tier, map: cfg.map, selfId: cfg.id, features: cfg.features });
  const humanizer = createHumanizer({ tier, map: cfg.map, features: cfg.features });
  const tactics = createTactics();
  const guarded = guardModules(cfg.modules, log);
  const bcfg: BrainConfig = guarded.length === 0 ? cfg : { ...cfg, modules: guarded };

  let lastTactics: TacticsOutput = NO_OUTPUT;
  const strategy = createStrategy({ attacking: () => lastTactics.attacking, log: (msg) => log(`${cfg.name}: ${msg}`) });

  // The memory the layers read: the live view, with this percept's stimuli (memory's plus the humanizer's missed clicks).
  const base = memory.view;
  let stimuli: readonly Stimulus[] = [];
  const mem: MemoryView = {
    get fighters() { return base.fighters; },
    get mobs() { return base.mobs; },
    get camps() { return base.camps; },
    get containers() { return base.containers; },
    get self() { return base.self; },
    get stimuli() { return stimuli; },
    get bounties() { return base.bounties; },
    get choices() { return base.choices; },
    whereabouts: (id, now) => base.whereabouts(id, now),
  };

  let goal: Goal = { kind: "idle" };
  let status: GoalStatus = RUNNING;
  let started = false;
  let nextStrategyAt = 0;
  let nextThinkAt = 0;
  let orderSeq = 0;
  let faction: FactionId | null = null;
  const goalCounts: Partial<Record<GoalKind, number>> = {};

  // The stall watch and the grab count (BrainStats).
  let stillSince: ServerMs | null = null;
  let lastPos: { x: number; y: number } | null = null;
  let maxStall = 0;
  let grabs = 0;
  let carried: number | null = null;
  let lootAt = Number.NEGATIVE_INFINITY;

  const draw = (d: { readonly mean: number; readonly jitter: number }): number => uniform(rng.decide, d.mean - d.jitter, d.mean + d.jitter);

  /** The real client's order number: 1..255 and round again (0 is "no order yet" in PlayerState.moveSeq). */
  function stamp(tc: TimedCommand): TimedCommand {
    const c = tc.cmd;
    if (c.type === "move") {
      orderSeq = (orderSeq % 255) + 1;
      return { ...tc, cmd: { type: "move", msg: { ...c.msg, seq: orderSeq } } };
    }
    if (c.type === "stop") {
      orderSeq = (orderSeq % 255) + 1;
      return { ...tc, cmd: { type: "stop", msg: { ...c.msg, seq: orderSeq } } };
    }
    return tc;
  }

  function flush(released: readonly TimedCommand[]): readonly TimedCommand[] {
    if (released.length === 0) return released;
    const out: TimedCommand[] = [];
    for (const tc of released) {
      const sent = stamp(tc);
      memory.noteSent(sent);
      out.push(sent);
    }
    return out;
  }

  function isEngaged(p: Percept): boolean {
    const traded = (t: ServerMs | null): boolean => t !== null && p.now - t <= ENGAGE_TRADE_SECONDS * 1000;
    return (p.self.attackTarget !== null && lastTactics.attacking) || traded(base.self.lastHitAt) || traded(base.self.lastDealtAt);
  }

  function watchStall(p: Percept): void {
    const me = p.self;
    // Deliberate waiting is not a stall: a fight, a bow pull, a pickup, a hold the strategy chose, and sudden death, where the bot
    // ahead on hp share keeps its distance on purpose and the burn is the clock (it can stand off for as long as the burn takes).
    const suddenDeath = p.hud.suddenDeathAt > 0 && p.now >= p.hud.suddenDeathAt;
    const busy = lastTactics.attacking || me.drawStartedAt > 0 || goal.kind === "loot" || (goal.kind === "hold" && goal.why !== "wait") || suddenDeath;
    const moved = lastPos === null || Math.hypot(me.x - lastPos.x, me.y - lastPos.y) >= BRAIN_RULES.stillEps;
    if (stillSince === null || busy || moved) stillSince = p.now;
    lastPos = { x: me.x, y: me.y };
    maxStall = Math.max(maxStall, p.now - stillSince - BRAIN_RULES.stillGraceMs);
  }

  function watchGrabs(p: Percept): void {
    const n = (p.self.weapons[0] !== null ? 1 : 0) + (p.self.weapons[1] !== null ? 1 : 0);
    if (goal.kind === "loot") lootAt = p.now;
    if (carried !== null && n > carried && p.now - lootAt <= BRAIN_RULES.grabWindowMs) grabs++;
    carried = n;
  }

  /** Switches to the decision's goal. True when it is a different goal (not the same one with new numbers). */
  function adopt(d: GoalDecision, now: ServerMs): boolean {
    const changed = goalKey(d.goal) !== goalKey(goal);
    goal = d.goal;
    if (!changed) return false;
    goalCounts[goal.kind] = (goalCounts[goal.kind] ?? 0) + 1;
    if (d.choice) memory.recordChoice(d.choice);
    lastTactics = { ...lastTactics, attacking: false };
    log(`${cfg.name}: ${describe(goal)} (${d.why}, utility ${d.utility.toFixed(2)}) at ${Math.round(now)}`);
    return true;
  }

  function act(ctx: BrainContext, mods: readonly FeatureModule[]): TacticsOutput {
    const g = goal;
    if (g.kind === "module") {
      const m = mods.find((x) => x.id === g.module);
      if (!m?.act) return { intents: [], status: { state: "failed", why: `no module "${g.module}" to run this goal` }, attacking: false };
      return m.act(ctx, g);
    }
    const out = tactics.act(ctx, g);
    const extra: Intent[] = [];
    for (const m of mods) if (m.intents) extra.push(...m.intents(ctx, g));
    let intents = extra.length === 0 ? out.intents : mergeIntents(out.intents, extra);
    for (const m of mods) if (m.adjust) intents = m.adjust(ctx, g, intents);
    return intents === out.intents ? out : { ...out, intents };
  }

  const brain: Brain = {
    id: cfg.id,

    get goal() { return goal; },

    get stats(): BrainStats {
      const hunt = strategy.huntStats;
      const t = tactics.stats();
      return {
        ...humanizer.stats,
        mobTargets: hunt.targets, mobDrops: hunt.drops, retreats: hunt.retreats, mobFocusMs: hunt.focusMs,
        grabs, maxStallMs: maxStall,
        dodges: t.dodges, jukes: t.jukes, kiteCycles: t.kiteCycles,
        goals: { ...goalCounts },
      };
    },

    tick(p: Percept): readonly TimedCommand[] {
      const now = p.now;
      // The path service shared by the room is told the frame's clock and gates (a no-op for a service that has no setFrame).
      (cfg.services.paths as { setFrame?: (t: ServerMs, gatesLocked: boolean) => void }).setFrame?.(now, p.hud.gatesLocked);

      const alive = p.self.status === "alive";
      const observed = memory.observe(p);
      const missed = humanizer.drainMisses();
      stimuli = alive && missed.length > 0
        ? [...observed, ...missed.map((m): Stimulus => ({ kind: "clickMissed", at: now, subject: m.target, central: true }))]
        : observed;
      if (p.self.faction !== null) faction = p.self.faction;

      const ctx: BrainContext = { cfg: bcfg, p, mem, know, svc: cfg.services, rng, engaged: isEngaged(p) };
      const mods = bcfg.modules.filter((m) => m.enabled(cfg.features));
      for (const m of mods) m.observe?.(ctx);

      if (!alive || p.hud.phase !== "active") {
        stillSince = null;
        lastPos = null;
        // The planning screen has no goal and no tactics: only the modules act (the planning module reads the deal and answers it).
        if (p.hud.phase === "planning") {
          const intents = mods.flatMap((m) => m.intents?.(ctx, { kind: "idle" }) ?? []);
          if (intents.length > 0) humanizer.submit(intents, ctx);
        }
        return flush(humanizer.release(ctx));
      }

      watchStall(p);
      watchGrabs(p);

      const first = !started;
      started = true;
      let changed = first;
      if (first || now >= nextStrategyAt || status.state !== "running" || stimuli.some((s) => SALIENT.has(s.kind))) {
        const decision = strategy.decide(ctx, goal, status);
        status = { state: "running", why: "decided" };
        nextStrategyAt = now + draw(tier.strategyMs);
        changed = adopt(decision, now) || first;
      }

      const toast = p.events.some((e) => e.kind === "toast");
      if (changed || toast || stimuli.length > 0 || now >= nextThinkAt) {
        const out = act(ctx, mods);
        lastTactics = out;
        status = out.status;
        nextThinkAt = now + Math.min(draw(tier.thinkMs), BRAIN_RULES.actMaxGapMs);
        if (out.intents.length > 0) humanizer.submit(out.intents, ctx);
      }

      return flush(humanizer.release(ctx));
    },

    end(result: RunResult | null): RunSummary {
      return {
        tier: tier.id,
        persona: cfg.persona.id,
        faction,
        outcome: result?.outcome ?? "void",
        place: result?.place ?? 0,
        players: result?.players ?? 0,
        choices: [...base.choices],
      };
    },
  };
  return brain;
};
