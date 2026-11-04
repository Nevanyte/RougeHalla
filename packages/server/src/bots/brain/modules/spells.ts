// The spells module: a bot takes a spell it finds on the map, as a person does. A spell find is a rune on the ground (its colour and
// name say which spell); F takes it into the spell slot, and the spell held before lies down in its place. The bot takes one only
// while its slot is empty (it has no way yet to tell one spell from another as a choice), within reach at once, and walks to one
// it sees nearby when nothing better is on: a module goal scored under a committed fight. Casting a held spell is the Wishes
// module's (the same cast policy, by the spell's intent tags). No spell exists yet, so no find is ever seen and this module idles.
import {
  PRIORITY,
  type BrainContext, type ContainerView, type FeatureModule, type GoalDecision, type Intent, type ServerMs, type TacticsOutput,
} from "../types";

/** The module's numbers (u, ms, utility on strategy's 0..1 scale). */
export const SPELL_RULES = {
  /** A find this near (u) is worth a walk to a bot with an empty slot. */
  walkReach: 640,
  /** The walk's worth (times 0.25 + 0.75 x persona.loot), plus up to `near` for a near one: under a committed fight (0.85). */
  value: 0.6,
  near: 0.15,
  cap: 0.8,
  /** An enemy player this near (u) keeps the bot where it is: it does not walk off for a find. */
  threatNear: 400,
  /** A walk to one find is given up after this long, and that find is skipped for `skipMs`. */
  giveUpMs: 8000,
  skipMs: 30_000,
  /** One pickup is asked for per find at most this often (a refused one costs nothing and is asked again). */
  retryMs: 1000,
} as const;

interface SpellState {
  /** The find being walked to and since when. */
  walk: { readonly id: string; readonly since: ServerMs } | null;
  /** Finds given up on, until when. */
  readonly skipped: Map<string, ServerMs>;
  readonly asked: Map<string, ServerMs>;
}

const states = new WeakMap<object, SpellState>();

function stateOf(ctx: BrainContext): SpellState {
  let st = states.get(ctx.cfg);
  if (!st) states.set(ctx.cfg, (st = { walk: null, skipped: new Map(), asked: new Map() }));
  return st;
}

/** The slot is empty and the bot can act: a find is worth taking. */
function wantsSpell(ctx: BrainContext): boolean {
  const { p } = ctx;
  return p.extras.spell === null && p.hud.phase === "active" && p.self.status === "alive";
}

const finds = (ctx: BrainContext): ContainerView[] => ctx.p.containers.filter((c) => c.kind === "spell" && c.spell !== undefined);

function skipped(ctx: BrainContext, st: SpellState, id: string): boolean {
  const until = st.skipped.get(id);
  if (until === undefined) return false;
  if (ctx.p.now < until) return true;
  st.skipped.delete(id);
  return false;
}

/** The pickup of a find in reach, or null (asked again only after the retry gap). */
function pickupIntent(ctx: BrainContext, st: SpellState): Intent | null {
  if (!wantsSpell(ctx)) return null;
  const here = finds(ctx).filter((c) => c.interactable).sort((a, b) => a.dist - b.dist)[0];
  if (!here) return null;
  const asked = st.asked.get(here.id);
  if (asked !== undefined && ctx.p.now - asked < SPELL_RULES.retryMs) return null;
  st.asked.set(here.id, ctx.p.now);
  return { kind: "pickup", container: here.id, priority: PRIORITY.goal, timing: { kind: "step" }, why: `take the spell at ${here.id}` };
}

/** The nearest find worth walking to now, or null. */
function walkTarget(ctx: BrainContext, st: SpellState): ContainerView | null {
  if (!wantsSpell(ctx)) return null;
  const threat = ctx.p.fighters.some((f) => f.status === "alive" && f.dist <= SPELL_RULES.threatNear);
  if (threat) return null;
  let best: ContainerView | null = null;
  for (const c of finds(ctx)) {
    if (c.dist > SPELL_RULES.walkReach || skipped(ctx, st, c.id)) continue;
    if (best === null || c.dist < best.dist) best = c;
  }
  return best;
}

const end = (state: "done" | "running", why: string, intents: readonly Intent[] = []): TacticsOutput => ({ intents, status: { state, why }, attacking: false });

export const spellsModule: FeatureModule = {
  id: "spells",
  enabled: (f) => f.spells,

  goals(ctx): readonly GoalDecision[] {
    const st = stateOf(ctx);
    const find = walkTarget(ctx, st);
    if (!find) return [];
    const near = Math.max(0, 1 - find.dist / SPELL_RULES.walkReach);
    const utility = Math.min(SPELL_RULES.cap, SPELL_RULES.value * (0.25 + 0.75 * ctx.cfg.persona.loot) + SPELL_RULES.near * near);
    return [{ goal: { kind: "module", module: "spells", data: { find: find.id } }, utility, why: `a spell lies at ${find.id}` }];
  },

  intents(ctx): readonly Intent[] {
    const pick = pickupIntent(ctx, stateOf(ctx));
    return pick ? [pick] : [];
  },

  act(ctx, goal): TacticsOutput {
    const st = stateOf(ctx);
    const id = String(goal.data["find"]);
    const find = finds(ctx).find((c) => c.id === id);
    if (!find || !wantsSpell(ctx)) {
      st.walk = null;
      return end("done", "the find is gone, or a spell is in hand");
    }
    if (st.walk?.id !== id) st.walk = { id, since: ctx.p.now };
    if (ctx.p.now - st.walk.since > SPELL_RULES.giveUpMs) {
      st.skipped.set(id, ctx.p.now + SPELL_RULES.skipMs);
      st.walk = null;
      return end("done", "gave up on the find");
    }
    const pick = pickupIntent(ctx, st);
    if (pick) return end("running", "taking the spell", [pick]);
    if (find.interactable) return end("running", "at the find");
    return end("running", "walking to a spell", [{ kind: "move", to: { x: find.x, y: find.y }, priority: PRIORITY.goal, timing: { kind: "step" }, why: `to the spell at ${id}` }]);
  },
};
