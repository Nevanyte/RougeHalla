// The planning module (docs/BOTS.md 8, roguelike R3): the bot uses the planning screen as a person does. The server deals each
// player two spawns in a private `plan` message. The bot reads the screen for a while (the tier's, scaled down for a window shorter
// than the live PLAN_SECONDS), takes the better of the two by the matchup of the camps nearest each (the screen shows the same
// numbers; the tier's softmax and lapse chance decide how often it takes the worse), then a start boon when one is dealt, and presses
// Ready a moment after its last choice and in any case before the timer runs out. A pick it sees no sign of in the next message is
// sent again after a short wait, a few times at most. With no deal at all it presses Ready and takes what the server gives.
//
// It acts through the brain's planning branch (no goal, no tactics, only the modules' intents) and sends only `plan` messages. The
// deal is read from the private event of this bot's own percept; nothing else of the room is looked at.
import { PLAN_SECONDS } from "@raid/shared";
import { PLAN_CAMPS, planSpawnScore } from "../../mobHunt";
import { pickOption, uniform } from "../random";
import { LEARN, PRIORITY, type BrainContext, type ChoiceKey, type FeatureModule, type Intent, type PlanMsg, type ServerMs, type TierId } from "../types";

/** The module's numbers (ms of a PLAN_SECONDS window; a shorter window scales the reading and settling times down). */
export const PLAN_RULES = {
  /** Reading the screen before the first click, uniform per tier. */
  read: { easy: [4000, 8000], normal: [3000, 6000], hard: [2000, 4000] } as Readonly<Record<TierId, readonly [number, number]>>,
  /** From the last choice standing to the Ready press: a last look. */
  settle: { easy: [800, 2200], normal: [500, 1400], hard: [300, 800] } as Readonly<Record<TierId, readonly [number, number]>>,
  /** It never reads for more than this share of the window. */
  readShare: 0.55,
  /** Ready is pressed this long before the timer at the latest (3/10 of a short window at most). */
  readyBeforeMs: 2500,
  readyBeforeShare: 0.3,
  /** With no deal this long into the phase it presses Ready. */
  noDealMs: 1000,
  /** A pick the next message still shows as none is sent again after this plus the tier's reaction, up to `maxAsks` times. */
  resendMs: 400,
  maxAsks: 3,
} as const;

/** The private `plan` message, as far as the module reads it (shared PlanMessage). */
interface Deal {
  readonly endsAt: ServerMs;
  readonly spawns: readonly [number, number];
  readonly taken: readonly [boolean, boolean];
  readonly pick: number;
  readonly boons: readonly string[];
  readonly boon: number;
}

interface Ask { readonly at: ServerMs; readonly n: number }

/** What the module keeps for one bot (the one module instance serves every bot of a room). */
interface PlanState {
  deal: Deal | null;
  /** The first planning percept: the clock of "no deal came". */
  phaseAt: ServerMs | null;
  /** Drawn when the first deal arrives: the end of the reading, the settling time, and the last moment to press Ready. */
  readUntil: ServerMs;
  settleMs: number;
  lastCall: ServerMs;
  spawnAsk: Ask | null;
  boonAsk: Ask | null;
  /** When both choices stood (or could not be made). */
  doneAt: ServerMs | null;
  readySent: boolean;
}

const states = new WeakMap<object, PlanState>();

function stateOf(ctx: BrainContext): PlanState {
  let st = states.get(ctx.cfg);
  if (!st) {
    st = { deal: null, phaseAt: null, readUntil: 0, settleMs: 0, lastCall: Infinity, spawnAsk: null, boonAsk: null, doneAt: null, readySent: false };
    states.set(ctx.cfg, st);
  }
  return st;
}

/** The deal in a private `plan` message, or null for one that is not shaped like it. */
function readDeal(msg: Readonly<Record<string, unknown>>): Deal | null {
  const { spawns, taken, endsAt } = msg as { spawns?: unknown; taken?: unknown; endsAt?: unknown };
  if (!Array.isArray(spawns) || spawns.length !== 2 || !Array.isArray(taken) || typeof endsAt !== "number") return null;
  const num = (v: unknown): number => (typeof v === "number" ? v : -1);
  const boons = Array.isArray(msg["boons"]) ? (msg["boons"] as unknown[]).filter((b): b is string => typeof b === "string") : [];
  return { endsAt, spawns: [num(spawns[0]), num(spawns[1])], taken: [taken[0] === true, taken[1] === true], pick: num(msg["pick"]), boons, boon: num(msg["boon"]) };
}

/** The bias the stats file holds for a choice, as strategy reads it (capped, and 0 when learning is off). */
function biasOf(ctx: BrainContext, key: ChoiceKey): number {
  if (!ctx.cfg.learned.enabled) return 0;
  const b = ctx.cfg.learned.bias(key);
  return LEARN.weight * Math.max(-LEARN.cap, Math.min(LEARN.cap, Number.isFinite(b) ? b : 0));
}

function schedule(ctx: BrainContext, st: PlanState, deal: Deal, at: ServerMs): void {
  const window = Math.max(1, deal.endsAt - at);
  const scale = Math.min(1, window / (PLAN_SECONDS * 1000));
  const tier = ctx.cfg.tier.id;
  const [rlo, rhi] = PLAN_RULES.read[tier];
  const [slo, shi] = PLAN_RULES.settle[tier];
  st.readUntil = at + Math.min(uniform(ctx.rng.decide, rlo, rhi) * scale, PLAN_RULES.readShare * window);
  st.settleMs = uniform(ctx.rng.decide, slo, shi) * scale;
  st.lastCall = deal.endsAt - Math.min(PLAN_RULES.readyBeforeMs, PLAN_RULES.readyBeforeShare * window);
}

/** The better of the free spawns for this bot's faction and weapon, softened by the tier like any other choice. */
function chooseSpawn(ctx: BrainContext, deal: Deal, free: readonly (0 | 1)[]): 0 | 1 {
  const me = ctx.p.self;
  if (free.length === 1 || me.faction === null) return free[0]!;
  const weapon = me.weapons[me.slot];
  const utilities = free.map((k) => {
    const index = deal.spawns[k];
    const zone = ctx.cfg.map.spawnPool[index]?.zone;
    return planSpawnScore(ctx.cfg.map, index, me.faction!, weapon) / PLAN_CAMPS + (zone ? biasOf(ctx, `spawn|${me.faction}|${zone}`) : 0);
  });
  const tier = ctx.cfg.tier;
  return free[pickOption(ctx.rng.decide, ctx.rng.lapse, utilities, tier.softmaxT, tier.lapseP).index]!;
}

/** With nothing to go by but the bias, a boon is the bot's whim: the stats file's favourite, else any of them. */
function chooseBoon(ctx: BrainContext, deal: Deal): 0 | 1 {
  const me = ctx.p.self;
  const dealt = deal.boons.slice(0, 2);
  const utilities = dealt.map((id) => (me.faction ? biasOf(ctx, `boon|${me.faction}|${id}`) : 0));
  const tier = ctx.cfg.tier;
  return pickOption(ctx.rng.decide, ctx.rng.lapse, utilities, tier.softmaxT, tier.lapseP).index === 1 ? 1 : 0;
}

const plan = (msg: PlanMsg, why: string): Intent => ({ kind: "plan", msg, priority: PRIORITY.goal, timing: { kind: "step" }, why });

/** Can ask now: never asked, or the wait for the server's word is over and the asks are not used up. */
const mayAsk = (ctx: BrainContext, a: Ask | null): boolean => a === null || (a.n < PLAN_RULES.maxAsks && ctx.p.now - a.at >= PLAN_RULES.resendMs + ctx.cfg.tier.reaction.mu);
/** Nothing more to wait for: it has been asked as often as it will be and the last wait is over. */
const spentAsks = (ctx: BrainContext, a: Ask | null): boolean => a !== null && a.n >= PLAN_RULES.maxAsks && ctx.p.now - a.at >= PLAN_RULES.resendMs + ctx.cfg.tier.reaction.mu;

export const planningModule: FeatureModule = {
  id: "planning",
  enabled: (f) => f.planning,

  observe(ctx) {
    for (const e of ctx.p.events) {
      if (e.kind !== "private" || e.type !== "plan") continue;
      const deal = readDeal(e.msg);
      if (!deal) continue;
      const st = stateOf(ctx);
      if (st.deal === null) schedule(ctx, st, deal, e.t);
      st.deal = deal;
    }
  },

  intents(ctx): readonly Intent[] {
    const { p } = ctx;
    if (p.hud.phase !== "planning") return [];
    const st = stateOf(ctx);
    const now = p.now;
    st.phaseAt ??= now;
    if (st.readySent) return [];
    const ready = (why: string): readonly Intent[] => {
      st.readySent = true;
      return [plan({ ready: true }, why)];
    };

    const deal = st.deal;
    if (deal === null) return now - st.phaseAt >= PLAN_RULES.noDealMs ? ready("no deal came: ready, the server picks") : [];
    // Out of time: whatever is undone, the server places the bot as it would a person who ran out the clock.
    if (now >= st.lastCall) return ready("the timer is nearly out");
    if (now < st.readUntil) return [];

    const free = ([0, 1] as const).filter((k) => deal.spawns[k] >= 0 && !deal.taken[k]);
    if (deal.pick < 0 && free.length > 0 && !spentAsks(ctx, st.spawnAsk)) {
      if (!mayAsk(ctx, st.spawnAsk)) return [];
      const k = chooseSpawn(ctx, deal, free);
      st.spawnAsk = { at: now, n: (st.spawnAsk?.n ?? 0) + 1 };
      return [plan({ spawn: k }, `spawn ${deal.spawns[k]} (option ${k})`)];
    }
    if (deal.boons.length > 0 && deal.boon < 0 && !spentAsks(ctx, st.boonAsk)) {
      if (!mayAsk(ctx, st.boonAsk)) return [];
      const b = chooseBoon(ctx, deal);
      st.boonAsk = { at: now, n: (st.boonAsk?.n ?? 0) + 1 };
      return [plan({ boon: b }, `boon ${deal.boons[b]}`)];
    }

    st.doneAt ??= now;
    return now >= st.doneAt + st.settleMs ? ready("choices made") : [];
  },
};
