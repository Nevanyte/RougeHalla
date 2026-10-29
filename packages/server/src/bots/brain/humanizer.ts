// The humanizer (docs/BOTS.md 2.1-2.5, 4): intents in, the commands a person would have clicked out, each at the time they
// would have clicked it. It owns when anything happens: reaction delays with the attention multipliers, the refractory gap,
// hesitation, channels (one pending intent each), the APM bucket, dedupe and the lock's re-send rule; clicks.ts owns where.
// It is the only layer that draws from `rng.motor` (delays, scatter) and `rng.lapse` (hesitation, slips).
//
// A decision is what one stimulus (or one planned step) asks for. Its intents share its click time, so a swap and a lock
// answering the same newThreat go out together, one minGap apart; two different stimuli are two decisions, kept
// `refractoryMs` apart. A step continues a plan and a timed intent keeps a rhythm, so neither is refractory with anything,
// and a timed intent never hesitates (its sigma is its error); a step or a reaction pauses with chance hesitation.p.
import { TARGET_SNAP_RADIUS, type GameMap, type Vec2 } from "@raid/shared";
import { groundClick, lockClick, moveClick } from "./clicks";
import { chance, exGaussian, gaussian, uniform } from "./random";
import type {
  BrainContext, Command, CommandType, Features, FighterId, Humanizer, Intent, IntentChannel, IntentKind, IntentPriority,
  Percept, ServerMs, Stimulus, StimulusKind, TierParams, TimedCommand,
} from "./types";

/** A lock click that picked nobody: nothing was sent, and the bot will notice that no ring appeared. */
export interface ClickMiss {
  readonly target: FighterId;
  readonly at: ServerMs;
}

/** The contract's Humanizer plus the misses, which a command list cannot carry (the brain turns each into a `clickMissed` stimulus). */
export interface HumanizerImpl extends Humanizer {
  /** The lock clicks that picked nobody since the last call, oldest first. */
  drainMisses(): readonly ClickMiss[];
}

export interface HumanizerConfig {
  readonly tier: TierParams;
  readonly map: GameMap;
  /** When given, an intent whose message type this server does not list is dropped here too (the adapter checks as well). */
  readonly features?: Features;
}

/** The rules of 2.5 and 4 as numbers. */
export const HUMANIZER_RULES = {
  /** A pending intent this old can be replaced by an intent of any priority. */
  replaceAfterMs: 500,
  /** A due intent still waiting for a token or the gap this long is dropped. */
  starveMs: 1500,
  /** Two lock commands for the same target are at least this far apart (BotClient's TARGET_RESEND_MS). */
  lockResendMs: 300,
  /** An intent equal to the one just sent on its channel is not sent again for this long. */
  repeatMs: 1500,
  /** Two points this close are the same destination. */
  samePointU: 6,
  /** Reading a text (an announcement, a chest, an offer) takes longer than seeing a threat. */
  readingMult: 1.5,
  /** The newest samples kept per stimulus kind. */
  reactionSamples: 256,
  apmWindowMs: 60_000,
} as const;

/** The bot's own HUD is this far behind its orders (downlink, uplink, a tick): an order this recent may not show in it yet. */
const SELF_LAG_MS = 250;
/** Decisions are remembered this long, for the siblings of one stimulus. */
const DECISION_KEEP_MS = 5000;
/** Misses nobody drained are not kept forever. */
const MAX_MISSES = 16;

const CHANNEL: Readonly<Record<IntentKind, IntentChannel>> = {
  lock: "order", move: "order", stop: "order", swap: "swap", pickup: "pickup", cast: "cast", plan: "menu", choose: "menu",
};
const COMMAND_TYPE: Readonly<Record<IntentKind, CommandType>> = {
  lock: "target", move: "move", stop: "stop", swap: "swap", pickup: "pickup", cast: "cast", plan: "plan", choose: "choose",
};
const COMMAND_TYPES: readonly CommandType[] = ["move", "stop", "target", "attack", "release", "swap", "pickup", "cast", "plan", "choose"];
const CHANNEL_ORDER: readonly IntentChannel[] = ["order", "swap", "pickup", "cast", "menu"];
const READING: ReadonlySet<StimulusKind> = new Set<StimulusKind>(["announcement", "chestUp", "planOffer"]);

interface Pending {
  readonly channel: IntentChannel;
  readonly intent: Intent;
  /** Raised when an equal intent of higher priority is offered. */
  priority: IntentPriority;
  readonly submittedAt: ServerMs;
  readonly key: string;
  /** Click time before the bucket and the gap. */
  readonly due: ServerMs;
  /** Counts toward the refractory gap (it answers a stimulus). */
  readonly independent: boolean;
}

interface Converted {
  readonly cmd: Command | null;
  /** The hand moved: a token and the gap are used (a missed click is spent too, a pickup the client would not send is not). */
  readonly spent: boolean;
}
const NOT_SENT: Converted = { cmd: null, spent: false };

/** HumanizerStats as the humanizer writes it; the object is handed out as the readonly view and stays live. */
interface MutableStats {
  commands: Record<CommandType, number>;
  reactions: Partial<Record<StimulusKind, number[]>>;
  targetClicks: number;
  clickMissed: number;
  clickWrong: number;
  hesitations: number;
  lapses: number;
  throttled: number;
  superseded: number;
  apmPeak: number;
}

const near = (a: Vec2, b: Vec2): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= HUMANIZER_RULES.samePointU;

/** The same click: the same kind aimed at the same fighter, container or point (within samePointU). */
function sameIntent(a: Intent, b: Intent): boolean {
  switch (a.kind) {
    case "lock": return b.kind === "lock" && a.target === b.target;
    case "move": return b.kind === "move" && near(a.to, b.to);
    case "stop": return b.kind === "stop";
    case "swap": return b.kind === "swap" && a.slot === b.slot;
    case "pickup": return b.kind === "pickup" && a.container === b.container;
    case "cast":
      return b.kind === "cast" && a.slot === b.slot
        && (a.target !== undefined || b.target !== undefined ? a.target === b.target : near(a, b));
    case "plan": return b.kind === "plan" && JSON.stringify(a.msg) === JSON.stringify(b.msg);
    case "choose": return b.kind === "choose" && JSON.stringify(a.msg) === JSON.stringify(b.msg);
  }
}

function decisionKey(i: Intent): string {
  const t = i.timing;
  switch (t.kind) {
    case "react": return `r|${t.stimulus.kind}|${t.stimulus.subject ?? ""}|${t.stimulus.at}`;
    case "step": return `s|${CHANNEL[i.kind]}|${i.kind}`;
    case "timed": return `t|${i.kind}|${t.due}`;
  }
}

export function createHumanizer(cfg: HumanizerConfig): HumanizerImpl {
  const { tier, map } = cfg;
  const pending = new Map<IntentChannel, Pending>();
  const decisionDue = new Map<string, ServerMs>();
  const lastSent = new Map<IntentChannel, { readonly intent: Intent; readonly at: ServerMs }>();
  let lastLock: { readonly target: FighterId; readonly at: ServerMs } | null = null;
  let lastReact: { readonly key: string; readonly at: ServerMs } | null = null;
  let lastSendAt = Number.NEGATIVE_INFINITY;
  const refillPerMs = tier.apm / 60_000;
  let tokens: number = tier.burst;
  let tokensAt = 0;
  const sentTimes: ServerMs[] = [];
  let misses: ClickMiss[] = [];

  const stats: MutableStats = {
    commands: Object.fromEntries(COMMAND_TYPES.map((t) => [t, 0])) as Record<CommandType, number>,
    reactions: {},
    targetClicks: 0, clickMissed: 0, clickWrong: 0, hesitations: 0, lapses: 0, throttled: 0, superseded: 0, apmPeak: 0,
  };

  // ------------------------------------------------------------------------------------------------------- scheduling

  function reactionDelay(stim: Stimulus, ctx: BrainContext): number {
    if (stim.kind === "teleport") return exGaussian(ctx.rng.motor, tier.daze);
    let mult = stim.central ? 1 : tier.attention.peripheryMult;
    if (stim.kind === "newThreat" && ctx.engaged) mult *= tier.attention.engagedMult;
    if (READING.has(stim.kind)) mult *= HUMANIZER_RULES.readingMult;
    return exGaussian(ctx.rng.motor, tier.reaction) * mult;
  }

  /** At most one pause per decision. */
  function hesitation(ctx: BrainContext): number {
    const h = tier.hesitation;
    if (!chance(ctx.rng.lapse, h.p)) return 0;
    stats.hesitations++;
    return uniform(ctx.rng.lapse, h.minMs, h.maxMs);
  }

  /** Moves `due` after every other decision it falls within refractoryMs of. */
  function afterRefractory(due: ServerMs, key: string, replaced: Pending | undefined): ServerMs {
    const taken: ServerMs[] = [];
    for (const q of pending.values()) if (q.independent && q.key !== key && q !== replaced) taken.push(q.due);
    if (lastReact && lastReact.key !== key) taken.push(lastReact.at);
    if (taken.length === 0) return due;
    taken.sort((a, b) => a - b);
    for (let pass = 0; pass <= taken.length; pass++) {
      let moved = false;
      for (const c of taken) {
        if (Math.abs(due - c) < tier.refractoryMs) {
          due = c + tier.refractoryMs;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return due;
  }

  function newDecisionDue(intent: Intent, key: string, replaced: Pending | undefined, ctx: BrainContext): ServerMs {
    const now = ctx.p.now;
    const t = intent.timing;
    switch (t.kind) {
      case "react": {
        const known = decisionDue.get(key);
        if (known !== undefined) return Math.max(now, known);
        const due = afterRefractory(Math.max(now, t.stimulus.at + reactionDelay(t.stimulus, ctx)) + hesitation(ctx), key, replaced);
        decisionDue.set(key, due);
        return due;
      }
      case "step": return now + exGaussian(ctx.rng.motor, tier.step) + hesitation(ctx);
      case "timed": return Math.max(now, t.due + gaussian(ctx.rng.motor, 0, tier.timingSigmaMs));
    }
  }

  /** The server's lock is already on it. Not trusted for a moment after an order of ours, which the HUD has yet to show. */
  function alreadyLocked(target: FighterId, p: Percept, now: ServerMs): boolean {
    if (p.self.attackTarget !== target) return false;
    const order = lastSent.get("order");
    return !(order && now - order.at < SELF_LAG_MS && !(order.intent.kind === "lock" && order.intent.target === target));
  }

  function repeatsLast(intent: Intent, ch: IntentChannel, now: ServerMs): boolean {
    const last = lastSent.get(ch);
    if (!last || !sameIntent(last.intent, intent)) return false;
    if (now - last.at >= (intent.kind === "lock" ? HUMANIZER_RULES.lockResendMs : HUMANIZER_RULES.repeatMs)) return false;
    // A stimulus newer than the click is a reason to answer again (the order failed, the click missed).
    return !(intent.timing.kind === "react" && intent.timing.stimulus.at > last.at);
  }

  function offer(intent: Intent, ctx: BrainContext): void {
    const now = ctx.p.now;
    const ch = CHANNEL[intent.kind];
    if (cfg.features && !cfg.features.messageTypes.includes(COMMAND_TYPE[intent.kind])) return;
    if (intent.kind === "lock" && alreadyLocked(intent.target, ctx.p, now)) return;

    const prev = pending.get(ch);
    if (prev && sameIntent(prev.intent, intent)) {
      if (intent.priority < prev.priority) prev.priority = intent.priority;
      return;
    }
    if (prev && intent.priority > prev.priority && now - prev.submittedAt <= HUMANIZER_RULES.replaceAfterMs) return;
    if (repeatsLast(intent, ch, now)) {
      // Changed its mind back to what it is already doing.
      if (prev) {
        pending.delete(ch);
        stats.superseded++;
      }
      return;
    }

    const key = decisionKey(intent);
    const amends = prev !== undefined && prev.key === key;
    let due = amends ? prev.due : newDecisionDue(intent, key, prev, ctx);
    if (intent.kind === "lock" && lastLock?.target === intent.target) due = Math.max(due, lastLock.at + HUMANIZER_RULES.lockResendMs);
    if (prev && !amends) stats.superseded++;
    pending.set(ch, {
      channel: ch, intent, priority: intent.priority, submittedAt: amends ? prev.submittedAt : now, key, due,
      independent: intent.timing.kind === "react",
    });
  }

  function submit(intents: readonly Intent[], ctx: BrainContext): void {
    const now = ctx.p.now;
    for (const [key, due] of decisionDue) if (due < now - DECISION_KEEP_MS) decisionDue.delete(key);
    // Most urgent first: a reflex on a channel is not undone by a chore offered beside it.
    const ordered = intents.length > 1 ? [...intents].sort((a, b) => a.priority - b.priority) : intents;
    for (const intent of ordered) offer(intent, ctx);
  }

  // ------------------------------------------------------------------------------------------------------------ clicks

  function convert(q: Pending, t: ServerMs, ctx: BrainContext): Converted {
    const p = ctx.p;
    const i = q.intent;
    switch (i.kind) {
      case "lock": {
        const weapon = p.self.weapons[p.self.slot] ?? "fists";
        if (weapon === "wand" && alreadyLocked(i.target, p, t)) return NOT_SENT;
        if (weapon !== "wand" && p.now < p.self.readyAt) return NOT_SENT;
        const click = lockClick(ctx.rng.motor, ctx.rng.lapse, tier, p, { id: i.target, at: i.at });
        stats.targetClicks++;
        if (click.slipped) stats.lapses++;
        lastLock = { target: i.target, at: t };
        if (weapon !== "wand") {
          const a = Math.atan2(click.cursor.y - p.self.y, click.cursor.x - p.self.x);
          return { cmd: { type: "attack", msg: { a } }, spent: true };
        }
        if (click.picked === null) {
          stats.clickMissed++;
          misses.push({ target: i.target, at: t });
          if (misses.length > MAX_MISSES) misses.shift();
          return { cmd: null, spent: true };
        }
        if (click.picked !== i.target) stats.clickWrong++;
        return { cmd: { type: "target", msg: { id: click.picked } }, spent: true };
      }
      case "move": {
        if (!Number.isFinite(i.to.x) || !Number.isFinite(i.to.y)) return NOT_SENT;
        const click = moveClick(ctx.rng.motor, tier, map, p.self, i.to);
        return { cmd: { type: "move", msg: { x: click.to.x, y: click.to.y } }, spent: true };
      }
      case "stop": return { cmd: { type: "stop", msg: {} }, spent: true };
      case "swap": return { cmd: { type: "swap", msg: { slot: i.slot } }, spent: true };
      case "pickup": {
        // F does nothing in the client unless the container is the interaction target.
        const c = p.containers.find((x) => x.id === i.container);
        if (!c || !c.interactable) return NOT_SENT;
        return { cmd: { type: "pickup", msg: { containerId: i.container } }, spent: true };
      }
      case "cast": {
        if (i.target !== undefined) {
          const click = lockClick(ctx.rng.motor, ctx.rng.lapse, tier, p, { id: i.target, at: i.at ?? i }, i.snapRadius ?? TARGET_SNAP_RADIUS);
          if (click.slipped) stats.lapses++;
          const hit = click.picked === null ? undefined : p.fighters.find((f) => f.id === click.picked) ?? p.mobs.find((m) => m.id === click.picked);
          const msg = hit ? { slot: i.slot, x: hit.x, y: hit.y, id: hit.id } : { slot: i.slot, x: click.cursor.x, y: click.cursor.y };
          return { cmd: { type: "cast", msg }, spent: true };
        }
        const at = groundClick(ctx.rng.motor, tier, map, p.self, i);
        return { cmd: { type: "cast", msg: { slot: i.slot, x: at.x, y: at.y } }, spent: true };
      }
      case "plan": return { cmd: { type: "plan", msg: i.msg }, spent: true };
      case "choose": {
        // The chest panel takes clicks only while it is open: a bot that has walked out of reach (or whose chest is gone) since it
        // meant to pick clicks nothing.
        const chests = p.extras.chests;
        if (chests && chests.find((c) => c.id === i.msg.chest)?.options == null) return NOT_SENT;
        return { cmd: { type: "choose", msg: i.msg }, spent: true };
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------- the bucket

  /** The earliest time the next command may go: a token and minGapMs after the last one. */
  function nextSlot(): ServerMs {
    const tokenAt = tokens >= 1 ? tokensAt : tokensAt + (1 - tokens) / refillPerMs;
    return Math.max(lastSendAt + tier.minGapMs, tokenAt);
  }

  function spend(t: ServerMs): void {
    tokens = Math.min(tier.burst, tokens + (t - tokensAt) * refillPerMs) - 1;
    tokensAt = t;
    lastSendAt = t;
  }

  function note(cmd: Command, t: ServerMs): void {
    stats.commands[cmd.type]++;
    sentTimes.push(t);
    while (sentTimes[0]! <= t - HUMANIZER_RULES.apmWindowMs) sentTimes.shift();
    if (sentTimes.length > stats.apmPeak) stats.apmPeak = sentTimes.length;
  }

  function recordReaction(stim: Stimulus, t: ServerMs): void {
    const list = (stats.reactions[stim.kind] ??= []);
    list.push(t - stim.at);
    if (list.length > HUMANIZER_RULES.reactionSamples) list.shift();
  }

  // --------------------------------------------------------------------------------------------------------------- release

  function release(ctx: BrainContext): readonly TimedCommand[] {
    const now = ctx.p.now;
    // A person who is down clicks nothing, and what they meant to do is moot by the time they are up. (On the planning screen the
    // player is still in the lobby's status, and clicks.)
    if (ctx.p.self.status !== "alive" && ctx.p.hud.phase !== "planning") {
      pending.clear();
      return [];
    }
    const out: TimedCommand[] = [];
    for (let guard = 0; guard < 64 && pending.size > 0; guard++) {
      let first = Infinity;
      for (const q of pending.values()) if (q.due < first) first = q.due;
      const t = Math.max(nextSlot(), first);
      if (t > now) break;

      let starved = false;
      for (const [ch, q] of pending) {
        if (q.due <= t && t - q.due > HUMANIZER_RULES.starveMs) {
          pending.delete(ch);
          stats.throttled++;
          starved = true;
        }
      }
      if (starved) continue;

      // Under starvation reflex beats combat beats goal beats chore; then the earlier due; then the channel order.
      let best: Pending | null = null;
      for (const ch of CHANNEL_ORDER) {
        const q = pending.get(ch);
        if (!q || q.due > t) continue;
        if (best === null || q.priority < best.priority || (q.priority === best.priority && q.due < best.due)) best = q;
      }
      if (best === null) break;
      pending.delete(best.channel);

      const res = convert(best, t, ctx);
      if (!res.spent) continue;
      spend(t);
      const stim = best.intent.timing.kind === "react" ? best.intent.timing.stimulus : null;
      if (best.independent) lastReact = { key: best.key, at: t };
      if (stim) recordReaction(stim, t);
      lastSent.set(best.channel, { intent: best.intent, at: t });
      if (res.cmd) {
        note(res.cmd, t);
        out.push({ at: t, cmd: res.cmd, intent: best.intent.kind, priority: best.priority, stimulus: stim });
        // Button-up belongs to the same physical click and does not spend another action budget token.
        if (res.cmd.type === "attack") {
          stats.commands.release++;
          out.push({ at: t, cmd: { type: "release", msg: { a: res.cmd.msg.a } }, intent: best.intent.kind, priority: best.priority, stimulus: stim });
        }
      }
    }
    for (const [ch, q] of pending) {
      if (now - q.due > HUMANIZER_RULES.starveMs) {
        pending.delete(ch);
        stats.throttled++;
      }
    }
    return out;
  }

  function drainMisses(): readonly ClickMiss[] {
    const out = misses;
    misses = [];
    return out;
  }

  return { submit, release, stats, drainMisses };
}
