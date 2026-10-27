// The tactics layer (docs/BOTS.md 4): executes the strategy's one goal as intents. Fights (farm, hunt, fight) are fight.ts, the
// orb-walk, dodges and jukes are kite.ts, the goals with no fight in them (loot, roam, hold, idle) are tactics/world.ts, which
// this file only dispatches to. One instance per bot: it keeps its own kite, dodge and swap timers and nothing else.
//
// Arbitration (BOTS.md 4): a reflex (the first flee step, a dodge, a juke) takes the order channel at PRIORITY.reflex and
// reports status "blocked", so strategy decides again on the same frame. The humanizer owns every delay; this layer only says
// what and, for the humanizer, which stimulus or time it answers.
import { isRegionalKind, type Vec2 } from "@raid/shared";
import {
  PRIORITY, type BrainContext, type Goal, type Intent, type IntentChannel, type Stimulus, type TacticsLayer, type TacticsOutput,
} from "./types";
import { createFight } from "./tactics/fight";
import { createOrbWalk, createReflexes, createRetreat } from "./tactics/kite";
import { createWorldTactics, type WorldGoal, type WorldTactics } from "./tactics/world";

export interface TacticsStats {
  readonly dodges: number;
  readonly jukes: number;
  readonly kiteCycles: number;
  readonly retreats: number;
  readonly mobTargets: number;
}

export type Tactics = TacticsLayer & { stats(): TacticsStats; getStats(): TacticsStats };

/** The humanizer's channel for an intent (types.ts IntentChannel): lock, move and stop replace each other. */
export function channelOf(intent: Intent): IntentChannel {
  switch (intent.kind) {
    case "lock": case "move": case "stop": return "order";
    case "swap": return "swap";
    case "pickup": return "pickup";
    case "cast": return "cast";
    case "plan": case "choose": return "menu";
  }
}

export function createTactics(world: WorldTactics = createWorldTactics()): Tactics {
  const orb = createOrbWalk();
  const reflexes = createReflexes();
  const retreat = createRetreat();
  const fight = createFight({ orb, reflexes, retreat });
  /** Drawn once, the first time the bot is asked to act: does it know that sudden death burns every pool at the same share? */
  let knowsSuddenDeath: boolean | null = null;
  let fleeing = false;
  let retreats = 0;

  /** Visible enemies' positions, for a flee that was not told what from. */
  function threatsIn(ctx: BrainContext): Vec2[] {
    const out: Vec2[] = [];
    for (const f of ctx.p.fighters) if (f.status === "alive") out.push({ x: f.x, y: f.y });
    for (const m of ctx.p.mobs) if (m.status === "alive" && ctx.mem.mobs.get(m.id)?.awake) out.push({ x: m.x, y: m.y });
    return out;
  }

  function flee(ctx: BrainContext, goal: Extract<Goal, { kind: "flee" }>): TacticsOutput {
    const { p, mem } = ctx;
    if (p.now >= goal.until) { fleeing = false; retreat.reset(); return { intents: [], status: { state: "done", why: "the flight is over" }, attacking: false }; }
    const from = goal.from.length > 0 ? goal.from : threatsIn(ctx);
    const to = retreat.point(ctx, from);
    if (!to) {
      // Cornered: no heading is clear. Fight whatever is nearest on screen.
      const nearest = [
        ...p.fighters.filter((f) => f.status === "alive").map((f) => ({ id: f.id, d: f.dist, mob: false })),
        ...p.mobs.filter((m) => m.status === "alive" && isRegionalKind(m.kind)).map((m) => ({ id: m.id, d: m.dist, mob: true })),
      ].sort((a, b) => a.d - b.d)[0];
      if (!nearest) return { intents: [], status: { state: "failed", why: "cornered with nobody in sight" }, attacking: false };
      const out = fight.act(ctx, { id: nearest.id, kind: nearest.mob ? "farm" : "fight" }, knowsSuddenDeath ?? false);
      return out.status.state === "running" ? { ...out, status: { state: "running", why: "cornered: fighting on" } } : out;
    }
    const first = !fleeing;
    fleeing = true;
    if (first) retreats++;
    const stim: Stimulus | undefined = mem.stimuli.find((s) => s.kind === "lowHp" || s.kind === "hpLoss");
    const intent: Intent = {
      kind: "move", to, priority: PRIORITY.reflex, timing: stim ? { kind: "react", stimulus: stim } : { kind: "step" }, why: "flee",
    };
    return {
      intents: [intent],
      status: first ? { state: "blocked", why: "fleeing: strategy re-decides" } : { state: "running", why: "fleeing" },
      attacking: false,
    };
  }

  /**
   * A goal with no fight in it still dodges: the reflex takes the order channel from whatever world tactics wanted there, and
   * keeps it while the sidestep or the juke is on its way (a roam step offered meanwhile would replace the pending reflex).
   */
  function dispatchWorld(ctx: BrainContext, goal: WorldGoal): TacticsOutput {
    const out = world.act(ctx, goal);
    const reflex = reflexes.check(ctx);
    if (!reflex && ctx.p.now >= reflexes.holdUntil) return out;
    const rest = out.intents.filter((i) => channelOf(i) !== "order");
    if (!reflex) return { ...out, intents: rest };
    return {
      intents: [...rest, reflex.intent],
      status: { state: "blocked", why: `${reflex.kind}: ${reflex.intent.why}` },
      attacking: false,
    };
  }

  const tactics = {
    act(ctx: BrainContext, goal: Goal): TacticsOutput {
      knowsSuddenDeath ??= ctx.rng.decide() < ctx.cfg.tier.knowledge;
      if (goal.kind !== "flee" && fleeing) { fleeing = false; retreat.reset(); }
      if (goal.kind !== "farm" && goal.kind !== "hunt" && goal.kind !== "fight") fight.leave();
      switch (goal.kind) {
        case "farm": return fight.act(ctx, { id: goal.mob, kind: "farm" }, knowsSuddenDeath);
        case "hunt": return fight.act(ctx, { id: goal.target, kind: "hunt" }, knowsSuddenDeath);
        case "fight": return fight.act(ctx, { id: goal.target, kind: "fight" }, knowsSuddenDeath);
        case "flee": return flee(ctx, goal);
        case "loot": case "roam": case "hold": case "idle": return dispatchWorld(ctx, goal);
        case "module": return { intents: [], status: { state: "failed", why: `module goal "${goal.module}" is run by its module` }, attacking: false };
      }
    },
    stats(): TacticsStats {
      return { dodges: reflexes.dodges, jukes: reflexes.jukes, kiteCycles: orb.cycles, retreats, mobTargets: fight.mobTargets };
    },
    getStats(): TacticsStats {
      return tactics.stats();
    },
  };
  return tactics;
}

