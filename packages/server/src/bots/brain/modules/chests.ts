// The chests module (docs/BOTS.md 8, roguelike R5): a cleared camp's shared chest holds three skills for CHEST_SECONDS, one pick each,
// first come first served. The bot does what a person does.
//
//   - Every chest that is up is a gold blip on the minimap with its seconds left, so the bot knows where each is and for how long
//     (`extras.chests`, map-wide). It does NOT know what is in one: the cards show only while the panel is open, within pick range and
//     in sight, and perception hands them over under exactly that rule (`options` is null otherwise). The decision to walk to a chest
//     therefore never looks at a card: from afar every chest is a skill, and that is all it is.
//   - A walk is a module goal scored beside the others (loot weight, a crowd at the chest, how near it is) and run by `act`; whether
//     it is worth walking, reachable in the chest's time, safe to leave a fight for, and when to give up on it is chestHunt.ts
//     (`ChestHunter`, unchanged), fed from the percept.
//   - Within pick range the cards are read, and `choose` goes out once for the chest, whatever the bot is doing (a pick moves nobody):
//     the best free card it can use (`chooseOption`), else a skip. It answers the panel opening, like a person reading three cards
//     (the humanizer's reading reaction), so a Hard bot is quick and an Easy one slow. A pick that lost the race (someone took that
//     card first: the next percept shows it) is made again on another card, three tries at most inside a few seconds.
//   - What the bot holds is what it took: the HUD's passives row is the bot's own record, kept here from the chests it picked at.
import { CHEST_RANGE, EFFECT_CASTING, EFFECT_STUNNED } from "@raid/shared";
import { CHEST_HUNT, ChestHunter, chooseOption, type ChestInput, type ChestLike } from "../../chestHunt";
import {
  PRIORITY,
  type BrainContext, type FeatureModule, type GoalDecision, type GoalKind, type Intent, type IntentTiming, type RewardChestView, type ServerMs,
  type TacticsOutput,
} from "../types";

/** The module's numbers (u, ms, utility on strategy's 0..1 scale). */
export const CHEST_RULES = {
  /** A reachable chest to a bot that lives for loot: a permanent skill for a short walk (times 0.25 + 0.75 x persona.loot). */
  value: 0.9,
  /** More for the persona that likes a crowd (x persona.thirdParty) when another player stands at the chest: it is about to go. */
  crowd: 0.15,
  crowdReach: 3 * CHEST_RANGE,
  /** And more the nearer it is (none beyond nearReach). */
  near: 0.2,
  nearReach: 800,
  /** Below the committed fight (0.85), level with the hunt's cap: a chest never takes a bot out of a fight it is in. */
  cap: 0.84,
  /** A pick is made again only inside this long of the first, and on another card, at most maxAsks cards. */
  askWindowMs: 4000,
  maxAsks: 3,
  /** An awake mob this close (u) is a fight the bot is in: only a near chest is worth leaving it for. */
  mobNear: 220,
} as const;

/** A chest seen from afar: one card the bot will take, whatever it is (so the walk never depends on the real cards). */
const BLIND: readonly string[] = ["?"];

interface Ask { first: ServerMs; option: number; n: number }

/** What the module keeps for one bot (the one module instance serves every bot of a room). */
interface ChestState {
  /** The walk the goal is running: its stall record and the chests it gave up on. */
  readonly hunter: ChestHunter;
  /** Skill id -> rank, from the chests this bot took a card at. */
  readonly build: Record<string, number>;
  readonly counted: Set<string>;
  /** When each chest's cards were first readable, and the pick asked for. */
  readonly readable: Map<string, ServerMs>;
  readonly asks: Map<string, Ask>;
  /** The goal kind the brain last ran. */
  goal: GoalKind;
}

const states = new WeakMap<object, ChestState>();

function stateOf(ctx: BrainContext): ChestState {
  let st = states.get(ctx.cfg);
  if (!st) {
    st = { hunter: new ChestHunter(CHEST_HUNT, ctx.svc.log), build: {}, counted: new Set(), readable: new Map(), asks: new Map(), goal: "idle" };
    states.set(ctx.cfg, st);
  }
  return st;
}

const dist = (a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The run is on, the bot stands, and the gates are open (the teleport takes every chest away). */
const live = (ctx: BrainContext): boolean => ctx.p.self.status === "alive" && ctx.p.hud.phase === "active" && !ctx.p.hud.inColiseum;

/** In a fight, or one is on the bot's doorstep: only a near chest is worth leaving it for. */
function fighting(ctx: BrainContext, st: ChestState): boolean {
  const { p, cfg } = ctx;
  if (ctx.engaged || st.goal === "fight" || st.goal === "hunt") return true;
  if (p.fighters.some((f) => f.status === "alive" && f.dist < cfg.persona.playerThreat)) return true;
  for (const m of ctx.mem.mobs.values()) if (m.alive && m.awake && dist(m.pos, p.self) <= CHEST_RULES.mobNear) return true;
  return false;
}

/** Running from something, or too hurt to be walking anywhere: no chest is worth it. */
function retreating(ctx: BrainContext, st: ChestState): boolean {
  const me = ctx.p.self;
  return st.goal === "flee" || (me.maxHp > 0 && me.hp / me.maxHp < ctx.cfg.persona.fleeHp);
}

/**
 * The hunt's input from the percept. A chest whose cards are shut to the bot gets the blind card; one it can read gets its cards
 * (the hunt decides a pick only for those). The walk is by path for the tiers that path, else a straight line x 1.3, as their camp
 * routes are.
 */
function huntInput(ctx: BrainContext, st: ChestState, skipTried: boolean): ChestInput {
  const { p, cfg } = ctx;
  const me = p.self;
  const chests: ChestLike[] = [];
  for (const c of p.extras.chests ?? []) {
    if (c.picked || (skipTried && st.hunter.tried(c.id))) continue;
    chests.push({
      id: c.id, kind: "reward", x: c.x, y: c.y, expiresAt: c.expiresAt, options: c.options ?? BLIND, takenBy: c.options ? c.takenBy : [], pickers: [],
    });
  }
  return {
    now: p.now,
    serverTime: p.now,
    self: { id: me.id, x: me.x, y: me.y, faction: me.faction ?? "", weapons: me.weapons, build: st.build },
    chests,
    walk: (to) => (cfg.tier.route.walkPaths ? ctx.svc.paths.walk(me, to)?.dist ?? null : dist(me, to) * 1.3),
    sight: (to) => ctx.svc.paths.los(me, to),
    fighting: fighting(ctx, st),
    retreating: retreating(ctx, st),
    inColiseum: p.hud.inColiseum,
  };
}

/** What a walk to this chest is worth to this bot (a goal's utility). */
function worth(ctx: BrainContext, c: RewardChestView): number {
  const { persona } = ctx.cfg;
  const crowded = ctx.p.fighters.some((f) => f.status === "alive" && dist(f, c) <= CHEST_RULES.crowdReach);
  const near = Math.max(0, 1 - dist(ctx.p.self, c) / CHEST_RULES.nearReach);
  return Math.min(
    CHEST_RULES.cap,
    CHEST_RULES.value * (0.25 + 0.75 * persona.loot) + (crowded ? CHEST_RULES.crowd * persona.thirdParty : 0) + CHEST_RULES.near * near,
  );
}

/** The nearest chest whose cards the bot can read, that it has not picked at and that has time left; null when its asks have run out. */
function cardsInReach(ctx: BrainContext, st: ChestState): RewardChestView | null {
  const { p } = ctx;
  if (!live(ctx)) return null;
  let chest: RewardChestView | null = null;
  for (const c of p.extras.chests ?? []) {
    if (c.options === null || c.picked || c.expiresAt - p.now <= CHEST_HUNT.pickMarginMs) continue;
    if (chest === null || dist(p.self, c) < dist(p.self, chest)) chest = c;
  }
  const ask = chest === null ? undefined : st.asks.get(chest.id);
  return chest !== null && ask !== undefined && p.now - ask.first > CHEST_RULES.askWindowMs ? null : chest;
}

/**
 * The `choose` to send for the chest it is in reach of, or null. Asks again only for a different card (the first was taken before
 * the pick landed) and only inside askWindowMs of the first ask.
 */
function pickIntent(ctx: BrainContext, st: ChestState): Intent | null {
  const { p } = ctx;
  const me = p.self;
  // The server refuses a pick from a stunned or casting player, and a refusal is a try spent: wait it out.
  if (((p.extras.effects?.[me.id] ?? 0) & (EFFECT_STUNNED | EFFECT_CASTING)) !== 0) return null;
  const chest = cardsInReach(ctx, st);
  if (chest === null || chest.options === null) return null;

  const option = chooseOption(chest.options, chest.takenBy, { faction: me.faction ?? "", weapons: me.weapons, build: st.build });
  const ask = st.asks.get(chest.id);
  if (!ask) st.asks.set(chest.id, { first: p.now, option, n: 1 });
  else if (ask.option !== option) {
    if (ask.n >= CHEST_RULES.maxAsks) return null;
    ask.option = option;
    ask.n++;
  }
  const opened = st.readable.get(chest.id) ?? p.now;
  return {
    kind: "choose", msg: { chest: chest.id, pick: option }, priority: PRIORITY.combat,
    timing: { kind: "react", stimulus: { kind: "chestUp", at: opened, subject: chest.id, central: true } },
    why: option >= 0 ? `chest ${chest.id}: card ${option} (${chest.options[option]})` : `chest ${chest.id}: nothing to use, skip`,
  };
}

/** A walk is the answer to the chest appearing when this percept brought it, else the next step of a plan. */
function walkTiming(ctx: BrainContext, chest: string): IntentTiming {
  const stimulus = ctx.mem.stimuli.find((s) => s.kind === "chestUp" && s.subject === chest);
  return stimulus ? { kind: "react", stimulus } : { kind: "step" };
}

const end = (state: "done" | "failed" | "running", why: string, intents: readonly Intent[] = []): TacticsOutput => ({ intents, status: { state, why }, attacking: false });

export const chestsModule: FeatureModule = {
  id: "chests",
  enabled: (f) => f.chests,

  observe(ctx) {
    const chests = ctx.p.extras.chests;
    if (!chests) return;
    const st = stateOf(ctx);
    for (const c of chests) {
      if (c.options === null) {
        // Out of reach of the cards again (the panel closed): a pick still on its way is not clicked, and the next visit starts afresh.
        st.readable.delete(c.id);
        st.asks.delete(c.id);
        continue;
      }
      if (!st.readable.has(c.id)) st.readable.set(c.id, ctx.p.now);
      if (st.counted.has(c.id)) continue;
      const i = c.takenBy.indexOf(ctx.p.self.id);
      if (i < 0) continue;
      st.counted.add(c.id);
      const skill = c.options[i];
      if (skill) st.build[skill] = Math.min(2, (st.build[skill] ?? 0) + 1);
    }
  },

  goals(ctx): readonly GoalDecision[] {
    const chests = ctx.p.extras.chests;
    if (!chests || chests.length === 0 || !live(ctx)) return [];
    const st = stateOf(ctx);
    // In reach of the cards with the pick still to make: the bot stays for it (leaving would take it out of reach again).
    const here = cardsInReach(ctx, st);
    if (here) return [{ goal: { kind: "module", module: "chests", data: { chest: here.id } }, utility: worth(ctx, here), why: `taking its pick at chest ${here.id}` }];
    // A fresh hunt each time: its stall record belongs to a walk that is under way (the real one, in `act`), not to a question.
    const d = new ChestHunter(CHEST_HUNT).decide(huntInput(ctx, st, true));
    if (d.kind !== "walk") return [];
    const chest = chests.find((c) => c.id === d.chest);
    if (!chest) return [];
    return [{ goal: { kind: "module", module: "chests", data: { chest: d.chest } }, utility: worth(ctx, chest), why: `reward chest ${d.chest}` }];
  },

  intents(ctx, goal): readonly Intent[] {
    const st = stateOf(ctx);
    st.goal = goal.kind;
    const pick = pickIntent(ctx, st);
    return pick ? [pick] : [];
  },

  act(ctx, goal): TacticsOutput {
    const st = stateOf(ctx);
    st.goal = "module";
    const id = String(goal.data["chest"]);
    const { p } = ctx;
    const chest = (p.extras.chests ?? []).find((c) => c.id === id);
    if (!chest || chest.picked || chest.expiresAt <= p.now || !live(ctx)) return end("done", "the chest is gone, or already picked");

    const intents: Intent[] = [];
    const pick = pickIntent(ctx, st);
    if (pick) intents.push(pick);
    const d = st.hunter.decide(huntInput(ctx, st, false));
    if (d.kind === "walk" && d.chest === id) {
      // In reach of its cards it stands: the pick is on its way.
      if (chest.options === null) intents.push({ kind: "move", to: { x: chest.x, y: chest.y }, priority: PRIORITY.goal, timing: walkTiming(ctx, id), why: `to reward chest ${id}` });
      return end("running", "walking to the chest", intents);
    }
    const ask = st.asks.get(id);
    if (pick || (chest.options !== null && ask !== undefined && p.now - ask.first <= CHEST_RULES.askWindowMs)) return end("running", "taking its pick", intents);
    return end("done", d.kind === "walk" ? "another chest is nearer" : "not worth the walk, or given up");
  },
};
