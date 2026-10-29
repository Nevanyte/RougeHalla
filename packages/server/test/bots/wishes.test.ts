// The Wishes module (brain/modules/wishes.ts, docs/BOTS.md 8): when a bot presses D, how the press is timed, what a unit cast
// carries, and how a bot that hides behind Swarm keeps from revealing itself. The shared policy (`decideCast`, bots/abilityPolicy.ts)
// has its own cases in test/abilityPolicy.test.ts; here it is exercised through the module, one situation per Wish, on synthetic
// percepts. The last block plays a whole brain against a small stand-in for the server's cast rules.
import { describe, expect, it } from "vitest";
import {
  ABILITIES, abilityInSlot, BLAZE_RANGE, EFFECT_CASTING, EFFECT_HIDDEN, EFFECT_ROOTED, EFFECT_SILENCED, EFFECT_STUNNED, FREEZE_RANGE,
  TARGET_SNAP_RADIUS, TILE, TRIAL_RANGE, WISH_COOLDOWN_SECONDS, WISHES,
  type FactionId, type FxEvent, type Vec2,
} from "@raid/shared";
import { createBrain } from "../../src/bots/brain/brain";
import { createHumanizer } from "../../src/bots/brain/humanizer";
import { createMemory } from "../../src/bots/brain/memory";
import { awayPoint } from "../../src/bots/brain/tactics/kite";
import { enabledModules } from "../../src/bots/brain/modules/index";
import { castSituation, WISH_RULES, wishesModule } from "../../src/bots/brain/modules/wishes";
import {
  PRIORITY, TIERS,
  type BrainConfig, type BrainContext, type Command, type FighterView, type Goal, type Intent, type MemoryView, type ObservedEvent, type Percept,
  type Stimulus, type StimulusKind, type TierId, type TimedCommand, type WishView,
} from "../../src/bots/brain/types";
import { InputQueue, enqueueClientMessage } from "../../src/sim/inputs";
import { decideCast } from "../../src/bots/abilityPolicy";
import { FRAME_MS, plainPlayer, plainState, runPerception, T0 as KIT_T0, type PlainState, type Scenario } from "./fairnessKit";
import {
  brainConfig, ctx as makeCtx, emptyMemory, features, fighter, hudView, mobView, pathService, percept, rngs, selfView, testMap,
} from "./fixtures";

/**
 * Where the bot stands: open floor on the test map with a clear walk 300 u away from a foe 160 u east of it, and a clear line 240 u
 * east to it (the generated map is cave-like, so the spawn points are not all that open).
 */
function openSpot(): Vec2 {
  const map = testMap();
  const paths = pathService(map);
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 2; tx++) {
      const a = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      if (paths.clear(a, { x: a.x + 240, y: a.y }) && awayPoint(paths, a, { x: a.x + 160, y: a.y }, 300, 0) !== null) return a;
    }
  }
  throw new Error("no open spot on the test map");
}
const SPOT = openSpot();
const ME = selfView({ x: SPOT.x, y: SPOT.y });
const NOW = 200_000;
const WISH_FEATURES = features({ messageTypes: ["move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "cast"], wishes: true, statusEffects: true, fields: true });

const stim = (kind: StimulusKind, at: number, subject: string | null = null): Stimulus => ({ kind, at, subject, central: true });

function wishView(faction: FactionId, over: Partial<WishView> = {}): WishView {
  const slot = abilityInSlot({ faction }, "wish")!;
  return { ability: slot.def.id, def: slot.def, rank: slot.rank, readyAt: 0, casting: false, ...over };
}

interface Scene {
  faction?: FactionId;
  tier?: TierId;
  now?: number;
  hpFrac?: number;
  /** The bot's own EFFECT_* bits. */
  bits?: number;
  wish?: Partial<WishView>;
  fighters?: FighterView[];
  mobs?: Percept["mobs"];
  stimuli?: Stimulus[];
  /** Milliseconds ago the bot was last hurt. */
  hurtAgo?: number;
  gatesLocked?: boolean;
  goal?: Goal;
  /** A cast the driver sent (the click time). */
  sentCastAt?: number;
  /** Bits of the other fighters. */
  others?: Record<string, number>;
}

/** One module call's inputs. Pass the same `cfg` to keep a bot's state between calls. */
function scene(cfg: BrainConfig, s: Scene = {}): { ctx: BrainContext; goal: Goal } {
  const now = s.now ?? NOW;
  const faction = s.faction ?? "fire";
  const hp = Math.round((s.hpFrac ?? 1) * 100);
  const self = selfView({ x: ME.x, y: ME.y, faction, hp, maxHp: 100 });
  const p = percept({
    now, self, hud: hudView({ phase: "active", gatesLocked: s.gatesLocked ?? false }), features: WISH_FEATURES,
    fighters: s.fighters ?? [], mobs: s.mobs ?? [],
    extras: { wish: wishView(faction, s.wish), effects: { [self.id]: s.bits ?? 0, ...s.others } },
  });
  const base = emptyMemory();
  const mem: MemoryView = {
    ...base,
    stimuli: s.stimuli ?? [],
    self: {
      ...base.self,
      lastHitAt: s.hurtAgo === undefined ? null : now - s.hurtAgo,
      lastCast: s.sentCastAt === undefined ? null : sentCast(s.sentCastAt),
    },
  };
  return { ctx: makeCtx({ cfg, p, mem, rng: rngs(cfg.seed) }), goal: s.goal ?? { kind: "idle" } };
}

function sentCast(at: number): TimedCommand {
  return { at, cmd: { type: "cast", msg: { slot: "wish", x: 0, y: 0 } }, intent: "cast", priority: PRIORITY.combat, stimulus: null };
}

const cfgFor = (tier: TierId = "hard", seed = 1): BrainConfig => brainConfig(tier, "hunter", { seed, features: WISH_FEATURES, modules: [wishesModule] });

/** The module's intents for one scene. */
function intentsOf(cfg: BrainConfig, s: Scene = {}): readonly Intent[] {
  const { ctx, goal } = scene(cfg, s);
  wishesModule.observe?.(ctx);
  return wishesModule.intents!(ctx, goal);
}
const casts = (list: readonly Intent[]): Extract<Intent, { kind: "cast" }>[] => list.filter((i): i is Extract<Intent, { kind: "cast" }> => i.kind === "cast");

const east = (d: number, over: Partial<FighterView> = {}): FighterView => fighter({ id: "foe", x: ME.x + d, y: ME.y, dist: d, ...over });
const huntFoe: Goal = { kind: "hunt", target: "foe" };
/** A fighter walking at the bot. */
const charging = (d: number, over: Partial<FighterView> = {}): FighterView => east(d, { vx: -170, vy: 0, ...over });

// =============================================================================================================== one per Wish

describe("each Wish is cast in the moment its intent tags describe", () => {
  it("Freeze (Frost: control, peel, engage): a unit cast on the foe the goal is fighting, in sight within the range", () => {
    const list = intentsOf(cfgFor(), { faction: "frost", fighters: [east(300)], goal: huntFoe });
    expect(casts(list)).toEqual([expect.objectContaining({
      kind: "cast", slot: "wish", target: "foe", at: { x: ME.x + 300, y: ME.y }, x: ME.x + 300, y: ME.y, snapRadius: TARGET_SNAP_RADIUS,
    })]);
    const out = (d: number, over: Partial<FighterView> = {}) => casts(intentsOf(cfgFor(), { faction: "frost", fighters: [east(d, over)], goal: huntFoe }));
    expect(out(FREEZE_RANGE - 16)).toHaveLength(1);
    expect(out(FREEZE_RANGE - 15)).toHaveLength(0);
    expect(out(200, { los: false })).toHaveLength(0);
    expect(out(200, { targetable: false })).toHaveLength(0);
  });

  it("Freeze peels: an enemy on it and charging is frozen even with nothing locked; one that stands off is not", () => {
    const peel = casts(intentsOf(cfgFor(), { faction: "frost", fighters: [charging(140)], goal: { kind: "roam", to: ME, why: "explore" } }));
    expect(peel).toEqual([expect.objectContaining({ target: "foe" })]);
    expect(casts(intentsOf(cfgFor(), { faction: "frost", fighters: [east(140)], goal: { kind: "roam", to: ME, why: "explore" } }))).toHaveLength(0);
    // Walking away is not chasing.
    expect(casts(intentsOf(cfgFor(), { faction: "frost", fighters: [east(140, { vx: 170 })], goal: { kind: "roam", to: ME, why: "explore" } }))).toHaveLength(0);
  });

  it("Freeze reads a chaser as one that hit it lately and stands on it, though it stands still (a melee fighter locked on stops at reach)", () => {
    const cfg = cfgFor();
    const { ctx } = scene(cfg, { faction: "frost", fighters: [east(100)], goal: { kind: "roam", to: ME, why: "explore" } });
    const mem = { ...ctx.mem, fighters: new Map([["foe", { ...blankFoe(), hitMeAt: NOW - 400 }]]) } as MemoryView;
    const situation = castSituation({ ...ctx, mem }, { kind: "idle" });
    expect(situation.threat).toMatchObject({ id: "foe", chasing: true });
    expect(castSituation(ctx, { kind: "idle" }).threat).toMatchObject({ id: "foe", chasing: false });
  });

  it("Swarm (Plague: escape): a self cast in trouble, at the bot's own position; at peace, none", () => {
    const trouble = casts(intentsOf(cfgFor(), { faction: "plague", hpFrac: 0.4, fighters: [east(200)], goal: huntFoe }));
    expect(trouble).toHaveLength(1);
    expect(trouble[0]).toMatchObject({ kind: "cast", slot: "wish", x: ME.x, y: ME.y, priority: PRIORITY.reflex });
    expect(trouble[0]!.target).toBeUndefined();
    expect(casts(intentsOf(cfgFor(), { faction: "plague", hpFrac: 1, fighters: [east(200)], goal: huntFoe }))).toHaveLength(0);
    // Low hp with the threat not close, and nobody hitting it: not yet.
    expect(casts(intentsOf(cfgFor(), { faction: "plague", hpFrac: 0.45, fighters: [east(400)], goal: huntFoe }))).toHaveLength(0);
    // Low hp while being hit is enough.
    expect(casts(intentsOf(cfgFor(), { faction: "plague", hpFrac: 0.5, hurtAgo: 300 }))).toHaveLength(1);
    expect(casts(intentsOf(cfgFor(), { faction: "plague", hpFrac: 0.5, hurtAgo: 2000 }))).toHaveLength(0);
  });

  it("Trial (Sentenced: engage, control): a unit cast on the foe in sight within 400 u less a margin; never at a mob", () => {
    const list = casts(intentsOf(cfgFor(), { faction: "sentenced", fighters: [east(250)], goal: { kind: "fight", target: "foe" } }));
    expect(list).toEqual([expect.objectContaining({ target: "foe", priority: PRIORITY.combat })]);
    expect(casts(intentsOf(cfgFor(), { faction: "sentenced", fighters: [east(TRIAL_RANGE - 15)], goal: huntFoe }))).toHaveLength(0);
    const mob = mobView({ id: "m1", x: ME.x + 100, y: ME.y, dist: 100 });
    expect(casts(intentsOf(cfgFor(), { faction: "sentenced", mobs: [mob], goal: { kind: "farm", mob: "m1", camp: null } }))).toHaveLength(0);
  });

  it("Blaze Step (Fire: escape, engage): a point cast away from the threat when in trouble, and toward a foe at a gap worth closing", () => {
    const escape = casts(intentsOf(cfgFor(), { faction: "fire", hpFrac: 0.4, fighters: [charging(150)], goal: huntFoe }));
    expect(escape).toHaveLength(1);
    expect(escape[0]!.target).toBeUndefined();
    expect(escape[0]!.x).toBeLessThan(ME.x);
    expect(Math.hypot(escape[0]!.x - ME.x, escape[0]!.y - ME.y)).toBeCloseTo(BLAZE_RANGE, 6);

    const engage = casts(intentsOf(cfgFor(), { faction: "fire", fighters: [east(200)], goal: huntFoe }));
    expect(engage).toHaveLength(1);
    expect(engage[0]!.x).toBeCloseTo(ME.x + 160, 6);
    expect(engage[0]!.y).toBeCloseTo(ME.y, 6);
    // A gap too small to be worth a blink.
    expect(casts(intentsOf(cfgFor(), { faction: "fire", fighters: [east(100)], goal: huntFoe }))).toHaveLength(0);
  });

  it("Last Stand (Holy: sustain, escape): a self cast at very low hp while being hit, and in the other kinds of trouble too", () => {
    const sustain = casts(intentsOf(cfgFor(), { faction: "holy", hpFrac: 0.3, hurtAgo: 100 }));
    expect(sustain).toEqual([expect.objectContaining({ x: ME.x, y: ME.y, priority: PRIORITY.reflex })]);
    expect(casts(intentsOf(cfgFor(), { faction: "holy", hpFrac: 0.3 }))).toHaveLength(0);
    expect(casts(intentsOf(cfgFor(), { faction: "holy", hpFrac: 0.45, fighters: [east(150)] }))).toHaveLength(1);
    expect(casts(intentsOf(cfgFor(), { faction: "holy", hpFrac: 0.8, hurtAgo: 100, fighters: [east(150)] }))).toHaveLength(0);
  });

  it("every Wish has a moment in which it is cast and a calm in which it is not", () => {
    const moments: Record<FactionId, Scene> = {
      frost: { fighters: [east(300)], goal: huntFoe },
      plague: { hpFrac: 0.3, hurtAgo: 100 },
      sentenced: { fighters: [east(250)], goal: huntFoe },
      fire: { hpFrac: 0.4, fighters: [charging(150)], goal: huntFoe },
      holy: { hpFrac: 0.3, hurtAgo: 100 },
    };
    for (const faction of Object.keys(WISHES) as FactionId[]) {
      expect(casts(intentsOf(cfgFor(), { faction, ...moments[faction] })), `${faction} in its moment`).toHaveLength(1);
      expect(casts(intentsOf(cfgFor(), { faction })), `${faction} at peace`).toHaveLength(0);
    }
  });

  it("decides what the shared policy decides for the situation it builds, nothing more", () => {
    for (const faction of Object.keys(WISHES) as FactionId[]) {
      const s: Scene = { faction, hpFrac: 0.4, hurtAgo: 200, fighters: [charging(150)], goal: huntFoe };
      const { ctx, goal } = scene(cfgFor(), s);
      const def = ABILITIES[WISHES[faction]];
      const want = decideCast(def, 1, castSituation(ctx, goal));
      expect(casts(wishesModule.intents!(ctx, goal)).length, faction).toBe(want ? 1 : 0);
    }
  });
});

/** A fighter record as memory holds it, for a test that sets one field. */
function blankFoe(): NonNullable<ReturnType<MemoryView["fighters"]["get"]>> {
  return {
    id: "foe", name: "Foe", bot: false, faction: "frost", weaponsSeen: [], inHand: "sword", otherSlot: null, seenAt: NOW, pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 }, hpFrac: 1, bounty: 0, alive: true, diedAt: null, hitMeAt: null, hitByMeAt: null, damageToMe: 0, damageByMe: 0,
    engagedWith: null, engagedAt: null, chasingMe: false, wishSeenAt: null, wishReadyGuess: null, feints: 0, lastFeintAt: null,
  };
}

// ============================================================================================================== the situation

describe("the situation the module describes to the policy", () => {
  it("is built from the percept: the bot's hp share, bits and recent hit; the goal's target; the nearest enemy and whether it comes", () => {
    const cfg = cfgFor();
    const { ctx, goal } = scene(cfg, {
      faction: "frost", hpFrac: 0.6, bits: EFFECT_ROOTED, hurtAgo: 1000, goal: huntFoe,
      fighters: [east(400, { id: "far" }), charging(180, { id: "near" }), east(300)],
    });
    const s = castSituation(ctx, goal);
    expect(s.me).toEqual({ x: ME.x, y: ME.y, hpFrac: 0.6, effects: EFFECT_ROOTED, recentlyHit: true });
    expect(s.foe).toMatchObject({ id: "foe", d: 300, los: true, targetable: true });
    expect(s.foe!.mob).toBeUndefined();
    expect(s.threat).toMatchObject({ id: "near", d: 180, chasing: true, los: true, targetable: true });
    expect(s.gatesLocked).toBe(false);
    expect(s.map).toBe(cfg.map);
    // Hit more than 1.5 s ago is not "being hit".
    expect(castSituation(scene(cfg, { hurtAgo: 1600 }).ctx, goal).me.recentlyHit).toBe(false);
    expect(castSituation(scene(cfg, { gatesLocked: true }).ctx, goal).gatesLocked).toBe(true);
  });

  it("names a mob the goal farms with the mob flag, and takes no foe from a goal that fights nobody", () => {
    const mob = mobView({ id: "m1", x: ME.x + 100, y: ME.y, dist: 100 });
    const farm = castSituation(scene(cfgFor(), { mobs: [mob] }).ctx, { kind: "farm", mob: "m1", camp: null });
    expect(farm.foe).toMatchObject({ id: "m1", mob: true });
    expect(castSituation(scene(cfgFor(), { fighters: [east(200)] }).ctx, { kind: "roam", to: ME, why: "explore" }).foe).toBeNull();
    // A target that has left the screen is no foe.
    expect(castSituation(scene(cfgFor(), {}).ctx, huntFoe).foe).toBeNull();
  });

  it("a chaser is judged by its velocity toward the bot (cos > 0.7 and closing), not by its side of the screen", () => {
    const at = (vx: number, vy: number): boolean | undefined =>
      castSituation(scene(cfgFor(), { fighters: [east(200, { vx, vy })] }).ctx, { kind: "idle" }).threat?.chasing;
    expect(at(-170, 0)).toBe(true);
    expect(at(-120, 120)).toBe(true); // 45 degrees off the line: cos 0.707
    expect(at(-100, 170)).toBe(false); // too far round
    expect(at(0, 0)).toBe(false);
    expect(at(10, 0)).toBe(false);
    expect(at(-10, 0)).toBe(false); // too slow to be coming
  });
});

// ========================================================================================================== when it may cast

describe("never when the Wish cannot be cast, once a second at most", () => {
  const trouble: Scene = { faction: "plague", hpFrac: 0.3, hurtAgo: 100, fighters: [east(150)], goal: huntFoe };

  it("not while the slot says it is casting, nor while the bot's bits say so", () => {
    expect(casts(intentsOf(cfgFor(), trouble))).toHaveLength(1);
    expect(casts(intentsOf(cfgFor(), { ...trouble, wish: { casting: true } }))).toHaveLength(0);
    expect(casts(intentsOf(cfgFor(), { ...trouble, bits: EFFECT_CASTING }))).toHaveLength(0);
  });

  it("not while stunned or silenced (every Wish lists both); a root does not stop one", () => {
    for (const faction of Object.keys(WISHES) as FactionId[]) {
      const s: Scene = { ...trouble, faction, fighters: [charging(150)] };
      expect(casts(intentsOf(cfgFor(), s)), `${faction} free`).toHaveLength(1);
      expect(casts(intentsOf(cfgFor(), { ...s, bits: EFFECT_STUNNED })), `${faction} stunned`).toHaveLength(0);
      expect(casts(intentsOf(cfgFor(), { ...s, bits: EFFECT_SILENCED })), `${faction} silenced`).toHaveLength(0);
      expect(casts(intentsOf(cfgFor(), { ...s, bits: EFFECT_ROOTED })), `${faction} rooted`).toHaveLength(1);
    }
  });

  it("not before the slot's ready time, by the server's clock; at it, yes", () => {
    const early = { ...trouble, wish: { readyAt: NOW + 1 } };
    expect(casts(intentsOf(cfgFor(), early))).toHaveLength(0);
    expect(casts(intentsOf(cfgFor(), { ...trouble, wish: { readyAt: NOW } }))).toHaveLength(1);
    // The 45 s lock at the start of a run, then 300 s after a cast.
    expect(casts(intentsOf(cfgFor(), { ...trouble, now: 60_000 + 44_999, wish: { readyAt: 60_000 + 45_000 } }))).toHaveLength(0);
    expect(casts(intentsOf(cfgFor(), { ...trouble, now: 60_000 + 45_000, wish: { readyAt: 60_000 + 45_000 } }))).toHaveLength(1);
  });

  it("not outside a running raid, not when the bot is down, not on a faction without a Wish", () => {
    const { ctx, goal } = scene(cfgFor(), trouble);
    expect(wishesModule.intents!({ ...ctx, p: { ...ctx.p, hud: hudView({ phase: "lobby" }) } }, goal)).toEqual([]);
    expect(casts(wishesModule.intents!({ ...ctx, p: { ...ctx.p, self: selfView({ ...ctx.p.self, status: "dead" }) } }, goal))).toEqual([]);
    expect(wishesModule.intents!({ ...ctx, p: { ...ctx.p, extras: { effects: {} } } }, goal)).toEqual([]);
    expect(wishesModule.intents!({ ...ctx, p: { ...ctx.p, extras: { wish: { ...wishView("plague"), def: { not: "a def" } } } } }, goal)).toEqual([]);
  });

  it("asks at most once a second: a refused or fizzled cast costs nothing, so it is asked again after the gap", () => {
    const cfg = cfgFor();
    const at = (dt: number): number => casts(intentsOf(cfg, { ...trouble, faction: "holy", now: NOW + dt })).length;
    expect(at(0)).toBe(1);
    expect(at(50)).toBe(0);
    expect(at(500)).toBe(0);
    expect(at(999)).toBe(0);
    expect(at(1000)).toBe(1);
    expect(at(1500)).toBe(0);
    expect(at(2000)).toBe(1);
  });

  it("keeps each bot's own count: another bot of the room is not held off by the first", () => {
    const a = cfgFor("hard", 1);
    const b = cfgFor("hard", 2);
    expect(casts(intentsOf(a, { ...trouble, faction: "holy" }))).toHaveLength(1);
    expect(casts(intentsOf(b, { ...trouble, faction: "holy" }))).toHaveLength(1);
    expect(casts(intentsOf(a, { ...trouble, faction: "holy", now: NOW + 100 }))).toHaveLength(0);
  });
});

// ================================================================================================================ the timing

describe("a cast is timed as an answer to what made the moment, or as the next step", () => {
  const trouble: Scene = { faction: "holy", hpFrac: 0.3, hurtAgo: 100 };

  it("reacts to the stimulus that came with the percept, the most telling first", () => {
    const hp = stim("hpLoss", NOW, "foe");
    const low = stim("lowHp", NOW);
    const threat = stim("newThreat", NOW, "foe");
    const [cast] = casts(intentsOf(cfgFor(), { ...trouble, stimuli: [threat, hp, low] }));
    expect(cast!.timing).toEqual({ kind: "react", stimulus: low });
    expect(casts(intentsOf(cfgFor(), { ...trouble, stimuli: [threat, hp] }))[0]!.timing).toEqual({ kind: "react", stimulus: hp });
    expect(casts(intentsOf(cfgFor(), { ...trouble, stimuli: [stim("windupAtMe", NOW, "foe")] }))[0]!.timing).toMatchObject({ kind: "react" });
  });

  it("is a step when nothing new came with the percept (the foe has stood there for a while)", () => {
    expect(casts(intentsOf(cfgFor(), trouble))[0]!.timing).toEqual({ kind: "step" });
    expect(casts(intentsOf(cfgFor(), { ...trouble, stimuli: [stim("arrived", NOW), stim("teleport", NOW)] }))[0]!.timing).toEqual({ kind: "step" });
  });

  it("goes out through the humanizer after the tier's reaction time, as a `cast` command the server takes", () => {
    for (const id of ["easy", "hard"] as const) {
      const tier = { ...TIERS[id], hesitation: { p: 0, minMs: 0, maxMs: 0 } };
      const cfg = brainConfig(id, "hunter", { tier, features: WISH_FEATURES, modules: [wishesModule] });
      const s = { ...trouble, stimuli: [stim("hpLoss", NOW, "foe")] };
      const { ctx } = scene(cfg, s);
      const h = createHumanizer({ tier, map: testMap(), features: WISH_FEATURES });
      h.submit(casts(wishesModule.intents!(ctx, { kind: "idle" })), ctx);
      const later = (t: number): BrainContext => makeCtx({ cfg, rng: ctx.rng, p: { ...ctx.p, now: t } });
      expect(h.release(later(NOW + tier.reaction.floor - 1))).toEqual([]);
      const out = h.release(later(NOW + tier.reaction.cap + 200));
      expect(out).toHaveLength(1);
      expect(out[0]!.at - NOW).toBeGreaterThanOrEqual(tier.reaction.floor);
      expect(out[0]!.cmd).toMatchObject({ type: "cast", msg: { slot: "wish" } });
      expect(enqueueClientMessage(new InputQueue(), "cast", (out[0]!.cmd as Extract<Command, { type: "cast" }>).msg)).toBe(true);
    }
  });
});

describe("a unit cast is resolved like a lock click", () => {
  it("carries the fighter and where it is drawn, and the humanizer sends the id of the fighter the picker found", () => {
    const foe = east(300, { vx: 0, vy: 0 });
    const tier = { ...TIERS.hard, hesitation: { p: 0, minMs: 0, maxMs: 0 }, targetScatter: { ...TIERS.hard.targetScatter, sigma: 2, slipP: 0 } };
    const cfg = brainConfig("hard", "hunter", { tier, features: WISH_FEATURES, modules: [wishesModule] });
    const { ctx, goal } = scene(cfg, { faction: "sentenced", fighters: [foe], goal: huntFoe });
    const [cast] = casts(wishesModule.intents!(ctx, goal));
    expect(cast).toMatchObject({ target: "foe", at: { x: foe.x, y: foe.y }, snapRadius: TARGET_SNAP_RADIUS });
    const h = createHumanizer({ tier, map: testMap(), features: WISH_FEATURES });
    h.submit([cast!], ctx);
    const out = h.release(makeCtx({ cfg, rng: ctx.rng, p: { ...ctx.p, now: NOW + 3000 } }));
    expect(out[0]!.cmd).toMatchObject({ type: "cast", msg: { slot: "wish", id: "foe" } });
  });

  it("can miss: a click that lands on nobody sends the cast without the id, which the server refuses for free", () => {
    const foe = east(300);
    // A hand as unsteady as Easy's at its worst, on a Hard bot (Easy would not cast Trial at all).
    const tier = { ...TIERS.hard, hesitation: { p: 0, minMs: 0, maxMs: 0 }, targetScatter: { sigma: 120, lagS: 0, slipP: 0, slipMult: 1 } };
    let missed = 0;
    let hit = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const cfg = brainConfig("hard", "hunter", { tier, seed, features: WISH_FEATURES, modules: [wishesModule] });
      const { ctx, goal } = scene(cfg, { faction: "sentenced", fighters: [foe], goal: huntFoe });
      const [cast] = casts(wishesModule.intents!(ctx, goal));
      const h = createHumanizer({ tier, map: testMap(), features: WISH_FEATURES });
      h.submit([cast!], ctx);
      const out = h.release(makeCtx({ cfg, rng: ctx.rng, p: { ...ctx.p, now: NOW + 5000 } }));
      const msg = (out[0]!.cmd as Extract<Command, { type: "cast" }>).msg;
      if (msg.id === undefined) missed++;
      else hit++;
    }
    expect(missed).toBeGreaterThan(0);
    expect(hit).toBeGreaterThan(0);
  });
});

// ============================================================================================================= tier knobs

describe("tiers", () => {
  /** Plague in trouble: the Wish that Easy plays (a panic button). */
  const panic: Scene = { faction: "plague", hpFrac: 0.3, hurtAgo: 100, fighters: [east(150)], goal: huntFoe };

  function remembers(tier: TierId, seeds: number, s: Scene): number {
    let n = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      const cfg = cfgFor(tier, seed);
      const first = scene(cfg, { ...s, tier });
      wishesModule.observe!(first.ctx);
      if (casts(wishesModule.intents!(first.ctx, first.goal)).length > 0) n++;
    }
    return n / seeds;
  }

  it("Easy remembers its panic button 60% of the times it becomes available, drawn once per availability", () => {
    const share = remembers("easy", 400, panic);
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.7);
    // The draw is one per availability, not one per look: the same bot gives the same answer at every look.
    const cfg = cfgFor("easy", 3);
    const answers = new Set<boolean>();
    for (let k = 0; k < 6; k++) {
      const s = scene(cfg, { ...panic, tier: "easy", now: NOW + k * 1500 });
      wishesModule.observe!(s.ctx);
      answers.add(casts(wishesModule.intents!(s.ctx, s.goal)).length > 0);
    }
    expect(answers.size).toBe(1);
  });

  it("a new availability draws again (the Wish comes back after its cooldown)", () => {
    const outcomes = new Set<boolean>();
    for (let seed = 1; seed <= 60; seed++) {
      const cfg = cfgFor("easy", seed);
      const cooling = scene(cfg, { ...panic, tier: "easy", wish: { readyAt: NOW + 300_000 } });
      wishesModule.observe!(cooling.ctx);
      const ready = scene(cfg, { ...panic, tier: "easy", now: NOW + 300_000, wish: { readyAt: NOW + 300_000 } });
      wishesModule.observe!(ready.ctx);
      outcomes.add(casts(wishesModule.intents!(ready.ctx, ready.goal)).length > 0);
    }
    expect(outcomes).toEqual(new Set([true, false]));
  });

  it("Hard and Normal always remember, and make no draw", () => {
    expect(remembers("hard", 40, panic)).toBe(1);
    expect(remembers("normal", 40, panic)).toBe(1);
    const cfg = cfgFor("hard", 5);
    const s = scene(cfg, panic);
    const before = s.ctx.rng.decide();
    const t = scene(cfgFor("hard", 5), panic);
    wishesModule.observe!(t.ctx);
    expect(t.ctx.rng.decide()).toBe(before);
  });

  it("Easy plays only the defensive tags: Freeze and Trial (control, engage, peel) are never cast by it; Hard and Normal cast them", () => {
    const frost: Scene = { faction: "frost", fighters: [east(300)], goal: huntFoe };
    const sentenced: Scene = { faction: "sentenced", fighters: [east(250)], goal: huntFoe };
    expect(remembers("easy", 40, frost)).toBe(0);
    expect(remembers("easy", 40, sentenced)).toBe(0);
    expect(remembers("normal", 10, frost)).toBe(1);
    expect(remembers("hard", 10, sentenced)).toBe(1);
    // Fire's escape stays for Easy, its engage does not.
    expect(remembers("easy", 100, { faction: "fire", hpFrac: 0.4, fighters: [charging(150)], goal: huntFoe })).toBeGreaterThan(0.4);
    expect(remembers("easy", 40, { faction: "fire", fighters: [east(200)], goal: huntFoe })).toBe(0);
  });
});

// ============================================================================================================ the Swarm slip

describe("a bot that is about to hide, or hidden, slips away and locks nobody", () => {
  const swarm: Scene = { faction: "plague", hpFrac: 0.35, hurtAgo: 100, fighters: [east(160)], goal: { kind: "fight", target: "foe" } };
  const away = (m: Intent): boolean => m.kind === "move" && Math.hypot(m.to.x - (ME.x + 160), m.to.y - ME.y) > 160 + 100;

  it("walks away from the enemy beside the cast it decides, as a reflex that takes the order channel from a lock", () => {
    const list = intentsOf(cfgFor(), swarm);
    expect(list.map((i) => i.kind).sort()).toEqual(["cast", "move"]);
    const move = list.find((i) => i.kind === "move")!;
    expect(move.priority).toBe(PRIORITY.reflex);
    expect(away(move)).toBe(true);
    expect(list.some((i) => i.kind === "lock")).toBe(false);
  });

  it("offers the slip as a module goal above a flee, for the pending time, and walks it away as that goal", () => {
    const cfg = cfgFor();
    intentsOf(cfg, swarm);
    const during = scene(cfg, { ...swarm, now: NOW + 600 });
    const goals = wishesModule.goals!(during.ctx);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.goal).toEqual({ kind: "module", module: "wishes", data: { mode: "slip" } });
    expect(goals[0]!.utility).toBe(1.4);
    expect(goals[0]!.utility).toBeGreaterThan(1.1); // strategy's FLEE_U
    const out = wishesModule.act!(during.ctx, goals[0]!.goal as Extract<Goal, { kind: "module" }>);
    expect(out.status.state).toBe("running");
    expect(out.attacking).toBe(false);
    expect(out.intents.some((i) => i.kind === "lock")).toBe(false);
    const move = out.intents.find((i) => i.kind === "move")!;
    expect(move.priority).toBe(PRIORITY.reflex);
    expect(away(move)).toBe(true);
  });

  it("offers it no more, and ends the goal, once the pending time has run out with no cast ever sent: a refused cast frees the bot", () => {
    const cfg = cfgFor();
    intentsOf(cfg, swarm);
    // The moment has passed (it was healed, or the enemy left): nothing asks for the Wish again.
    const calm: Scene = { ...swarm, hpFrac: 1, hurtAgo: undefined, now: NOW + WISH_RULES.slipPendingMs };
    // Just before the end it still holds.
    expect(wishesModule.goals!(scene(cfg, { ...calm, now: NOW + WISH_RULES.slipPendingMs - 1 }).ctx)).toHaveLength(1);
    const late = scene(cfg, calm);
    expect(wishesModule.goals!(late.ctx)).toEqual([]);
    expect(wishesModule.act!(late.ctx, { kind: "module", module: "wishes", data: { mode: "slip" } }).status.state).toBe("done");
    // ...and tactics' own intents are left alone again.
    expect(wishesModule.intents!(late.ctx, late.goal)).toEqual([]);
  });

  it("asks again after the retry gap while the moment lasts, and the slip goes on with it", () => {
    const cfg = cfgFor();
    intentsOf(cfg, swarm);
    const again = intentsOf(cfg, { ...swarm, now: NOW + WISH_RULES.retryMs });
    expect(again.map((i) => i.kind).sort()).toEqual(["cast", "move"]);
    expect(wishesModule.goals!(scene(cfg, { ...swarm, now: NOW + WISH_RULES.retryMs + WISH_RULES.slipPendingMs - 1 }).ctx)).toHaveLength(1);
  });

  it("after the cast was sent it holds for the cast's own time and a grace, then lets go if no cast and no hiding ever showed", () => {
    const cfg = cfgFor();
    intentsOf(cfg, swarm);
    const sentAt = NOW + 300;
    const castMs = ABILITIES.swarm.ranks[0]!.castMs;
    const slip = (dt: number, over: Scene = {}) => wishesModule.goals!(scene(cfg, { ...swarm, now: sentAt + dt, sentCastAt: sentAt, wish: { readyAt: NOW + 300_000 }, ...over }).ctx);
    expect(slip(0)).toHaveLength(1);
    expect(slip(castMs + WISH_RULES.slipGraceMs - 1)).toHaveLength(1);
    expect(slip(castMs + WISH_RULES.slipGraceMs)).toEqual([]);
  });

  it("holds while the server shows the cast, or the hiding (whatever the clock says), and lets go when it ends", () => {
    const cfg = cfgFor();
    intentsOf(cfg, swarm);
    const sentAt = NOW + 300;
    const base: Scene = { ...swarm, sentCastAt: sentAt, wish: { readyAt: NOW + 300_000 } };
    const late = sentAt + 5000;
    expect(wishesModule.goals!(scene(cfg, { ...base, now: late, bits: EFFECT_CASTING }).ctx)).toHaveLength(1);
    expect(wishesModule.goals!(scene(cfg, { ...base, now: late, bits: EFFECT_HIDDEN }).ctx)).toHaveLength(1);
    expect(wishesModule.goals!(scene(cfg, { ...base, now: late + 8000, bits: 0 }).ctx)).toEqual([]);
  });

  it("is hidden by the bit alone, with no cast of the module's: it still locks nobody", () => {
    const cfg = cfgFor();
    const hidden: Scene = { ...swarm, hpFrac: 1, hurtAgo: undefined, bits: EFFECT_HIDDEN, wish: { readyAt: NOW + 300_000 } };
    // The enemy is on screen: there is somebody to slip from.
    const s = scene(cfg, hidden);
    expect(wishesModule.goals!(s.ctx)).toHaveLength(1);
    const out = wishesModule.act!(s.ctx, { kind: "module", module: "wishes", data: { mode: "slip" } });
    expect(out.intents.map((i) => i.kind)).toEqual(["move"]);
    // Tactics asked for a lock beside it: the module's reflex is there to take the channel.
    expect(wishesModule.intents!(s.ctx, s.goal).map((i) => i.kind)).toEqual(["move"]);
  });

  it("with nobody in sight and nobody remembered there is nobody to slip from: no goal, and a goal already held ends", () => {
    const cfg = cfgFor();
    const s = scene(cfg, { faction: "plague", bits: EFFECT_HIDDEN, wish: { readyAt: NOW + 300_000 } });
    expect(wishesModule.goals!(s.ctx)).toEqual([]);
    expect(wishesModule.act!(s.ctx, { kind: "module", module: "wishes", data: { mode: "slip" } }).status.state).toBe("done");
  });

  it("walks to the same place until its leg is run, then chooses again from where the enemy is now", () => {
    const cfg = cfgFor();
    const first = intentsOf(cfg, swarm).find((i) => i.kind === "move")!;
    const again = (dt: number) => wishesModule.intents!(scene(cfg, { ...swarm, now: NOW + dt, hpFrac: 1, bits: EFFECT_HIDDEN, wish: { readyAt: NOW + 300_000 } }).ctx, swarm.goal!).find((i) => i.kind === "move")!;
    expect(again(300)).toMatchObject({ to: (first as Extract<Intent, { kind: "move" }>).to });
    expect(again(WISH_RULES.slipKeepMs + 100)).toBeDefined();
  });

  it("does not hide a Wish that does not hide: Last Stand, Blaze Step and Freeze arm no slip", () => {
    for (const faction of ["holy", "fire", "frost"] as const) {
      const cfg = cfgFor();
      const s: Scene = { faction, hpFrac: 0.3, hurtAgo: 100, fighters: [charging(150)], goal: huntFoe };
      expect(casts(intentsOf(cfg, s)).length, faction).toBeLessThanOrEqual(1);
      expect(wishesModule.goals!(scene(cfg, { ...s, now: NOW + 500 }).ctx), faction).toEqual([]);
    }
  });
});

// ================================================================================================= the module in the registry

describe("the module is registered and enabled by the Wishes feature", () => {
  it("is in the registry by default, on for a server with Wishes and off without", () => {
    expect(enabledModules(WISH_FEATURES).map((m) => m.id)).toContain("wishes");
    expect(enabledModules(features()).map((m) => m.id)).not.toContain("wishes");
    expect(wishesModule.enabled(WISH_FEATURES)).toBe(true);
    expect(wishesModule.enabled(features({ wishes: false, statusEffects: true }))).toBe(false);
  });
});

// ====================================================================================================== what it learns of others

/** n frames FRAME_MS apart: a bot at SELF with a Frost player 200 u east, and what `events` says per frame. */
function sceneRun(n: number, events: (k: number) => FxEvent[], foeAt: Vec2 | null = { x: ME.x + 200, y: ME.y }): Percept[] {
  const frames = Array.from({ length: n }, (_, k) => {
    const state: PlainState = plainState({ serverTime: KIT_T0 + k * FRAME_MS });
    state.players.set("me", plainPlayer({ name: "Me", x: ME.x, y: ME.y, faction: "fire", weapon0: "axe" }));
    if (foeAt) state.players.set("foe", plainPlayer({ name: "Foe", ...foeAt, faction: "frost", weapon0: "sword" }));
    state.roster = ["me", "foe"];
    return { state, events: events(k), launches: [], toasts: [] };
  });
  const s: Scenario = {
    seed: 0, map: testMap(), selfId: "me", features: WISH_FEATURES, frames,
    roles: {
      onscreenPlayers: [], onscreenMobs: [], farPlayers: [], farMobs: [], ringPlayers: [], ringMobs: [], hidden: [], farContainers: [],
      shutChests: [], announced: [],
    },
  };
  return runPerception(s);
}

describe("a Wish landing on screen (the real fx codec, perception and memory)", () => {
  it("is turned into an ext event that names the caster, and memory counts the cooldown from it", () => {
    const landAt = 12;
    const percepts = sceneRun(30, (k) => (k === landAt ? [{ kind: "castLand", by: "foe", ability: "freeze", target: "me", x: ME.x, y: ME.y }] : []));
    const ext = percepts.flatMap((p) => p.events).filter((e) => e.kind === "ext");
    expect(ext).toHaveLength(1);
    expect(ext[0]).toMatchObject({ kind: "ext", fx: "castLand", data: { by: "foe", ability: "freeze", target: "me" } });

    const memory = createMemory({ tier: TIERS.hard, map: testMap(), selfId: "me", features: WISH_FEATURES });
    const seen: Stimulus[] = [];
    for (const p of percepts) seen.push(...memory.observe(p));
    const foe = memory.view.fighters.get("foe")!;
    expect(foe.wishSeenAt).toBe(ext[0]!.t);
    expect(foe.wishReadyGuess).toBe(ext[0]!.t + WISH_COOLDOWN_SECONDS * 1000);
    expect(seen.filter((s) => s.kind === "castSeen")).toMatchObject([{ subject: "foe" }]);
  });

  it("a Wish the bot cast itself, or one cast off screen, teaches memory nothing about anybody", () => {
    const own = sceneRun(30, (k) => (k === 12 ? [{ kind: "castLand", by: "me", ability: "blaze", target: null, x: ME.x, y: ME.y, x2: ME.x + 100, y2: ME.y }] : []));
    const memory = createMemory({ tier: TIERS.hard, map: testMap(), selfId: "me", features: WISH_FEATURES });
    for (const p of own) memory.observe(p);
    expect(memory.view.fighters.get("foe")?.wishSeenAt ?? null).toBeNull();

    const far = sceneRun(30, (k) => (k === 12 ? [{ kind: "castLand", by: "foe", ability: "freeze", target: null, x: ME.x + 3000, y: ME.y }] : []), { x: ME.x + 3000, y: ME.y + 3000 });
    const m2 = createMemory({ tier: TIERS.hard, map: testMap(), selfId: "me", features: WISH_FEATURES });
    for (const p of far) m2.observe(p);
    expect(m2.view.fighters.get("foe")?.wishSeenAt ?? null).toBeNull();
  });
});

// ======================================================================== a whole brain against the server's cast rules

/**
 * A stand-in for the part of the server a Swarm bot meets: one standing foe that hits the bot every 400 ms (not while it is hidden),
 * the bot's lock (dropped by a `move` or by Swarm), and the cast pipeline: a cast is accepted once (if `accepts`), the bits show
 * casting and then hidden, a `target` sent while hidden reveals the bot (counted). The bot itself does not walk.
 */
class Stand {
  now = NOW;
  hp = 100;
  lock: string | null = null;
  readyAt = 0;
  castUntil = 0;
  hiddenUntil = 0;
  sent: TimedCommand[] = [];
  revealed = 0;
  hitAt = 0;
  private inbox: Array<{ at: number; cmd: Command }> = [];
  private events: ObservedEvent[] = [];

  /** Once a cast was refused the moment passes: the foe stops hitting and the bot is back at full hp. */
  calmed = false;

  constructor(private readonly accepts = true, private readonly faction: FactionId = "plague") {}

  get hidden(): boolean { return this.now < this.hiddenUntil; }

  percept(): Percept {
    const bits = (this.now < this.castUntil ? EFFECT_CASTING : 0) | (this.hidden ? EFFECT_HIDDEN : 0);
    const events = this.events;
    this.events = [];
    return percept({
      now: this.now, hud: hudView({ phase: "active" }), features: WISH_FEATURES, events,
      self: selfView({ x: ME.x, y: ME.y, faction: this.faction, weapons: ["wand", null], hp: this.hp, maxHp: 100, attackTarget: this.lock }),
      fighters: [fighter({ id: "foe", x: ME.x + 130, y: ME.y, dist: 130, faction: "fire", inHand: "sword", tint: 1 })],
      extras: { wish: wishView(this.faction, { readyAt: this.readyAt, casting: this.now < this.castUntil }), effects: { [ME.id]: bits } },
    });
  }

  send(cmds: readonly TimedCommand[]): void {
    for (const c of cmds) {
      this.sent.push(c);
      this.inbox.push({ at: c.at + 40, cmd: c.cmd });
    }
  }

  advance(): void {
    this.now += FRAME_MS;
    const due = this.inbox.filter((i) => i.at <= this.now);
    this.inbox = this.inbox.filter((i) => i.at > this.now);
    for (const { cmd } of due) this.apply(cmd);
    if (!this.hidden && !this.calmed && this.now >= this.hitAt && this.hp > 8) {
      this.hitAt = this.now + 400;
      this.hp -= 6;
      this.events.push({ kind: "hit", t: this.now, at: { x: ME.x, y: ME.y }, id: "me", by: "foe", amount: 6, weapon: "sword", sig: null });
    }
  }

  private apply(cmd: Command): void {
    if (cmd.type === "move" || cmd.type === "stop") this.lock = null;
    else if (cmd.type === "target") {
      if (this.hidden) this.revealed++;
      if (cmd.msg.id === "foe") this.lock = "foe";
    } else if (cmd.type === "cast" && !this.accepts) {
      this.calmed = true;
      this.hp = 100;
    } else if (cmd.type === "cast" && this.now >= this.readyAt && this.now >= this.castUntil && !this.hidden) {
      const castMs = ABILITIES.swarm.ranks[0]!.castMs;
      this.readyAt = this.now + WISH_COOLDOWN_SECONDS * 1000;
      this.castUntil = this.now + castMs;
      this.hiddenUntil = this.now + 8000;
      this.lock = null;
    }
  }
}

function brainFor(tier: TierId, seed: number): ReturnType<typeof createBrain> {
  return createBrain(brainConfig(tier, "hunter", { seed, features: WISH_FEATURES, modules: enabledModules(WISH_FEATURES) }));
}

function playStand(stand: Stand, seed: number, frames: number, tier: TierId = "hard"): ReturnType<typeof createBrain> {
  const brain = brainFor(tier, seed);
  for (let i = 0; i < frames; i++) {
    const cmds = brain.tick(stand.percept());
    stand.send(cmds);
    stand.advance();
  }
  return brain;
}

describe("a whole brain with the Swarm", () => {
  const types = (s: Stand, from: number, to: number): string[] => s.sent.filter((c) => c.at >= from && c.at < to).map((c) => c.cmd.type);

  it("casts it once in trouble, and from then on until the hiding is over locks nobody and walks away", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const stand = new Stand();
      playStand(stand, seed, 40 * 14);
      const cast = stand.sent.filter((c) => c.cmd.type === "cast");
      expect(cast, `seed ${seed}: one cast`).toHaveLength(1);
      expect(cast[0]!.cmd).toMatchObject({ type: "cast", msg: { slot: "wish" } });
      expect(stand.hiddenUntil, `seed ${seed}: the cast was accepted`).toBeGreaterThan(0);
      const from = cast[0]!.at;
      // From the click that sent the cast to the end of the hiding: no lock, so nothing revealed it.
      expect(stand.revealed, `seed ${seed}: revealed`).toBe(0);
      expect(types(stand, from, stand.hiddenUntil), `seed ${seed}`).not.toContain("target");
      // And it got away from the foe instead of standing: it walked.
      const walked = stand.sent.filter((c) => c.cmd.type === "move" && c.at >= from - 600);
      expect(walked.length, `seed ${seed}: walked`).toBeGreaterThan(0);
      for (const c of walked.slice(0, 3)) {
        const m = (c.cmd as Extract<Command, { type: "move" }>).msg;
        expect(Math.hypot(m.x - (ME.x + 130), m.y - ME.y), `seed ${seed}: walked away`).toBeGreaterThan(130);
      }
    }
  });

  it("a cast the server refused frees the bot within the pending time: it fights on once the moment has passed", () => {
    for (const seed of [1, 2, 3]) {
      const stand = new Stand(false);
      playStand(stand, seed, 40 * 14);
      const cast = stand.sent.filter((c) => c.cmd.type === "cast");
      expect(cast, `seed ${seed}: one try`).toHaveLength(1);
      expect(stand.hiddenUntil).toBe(0);
      const locks = stand.sent.filter((c) => c.cmd.type === "target" && c.at > cast[0]!.at);
      expect(locks.length, `seed ${seed}: it locks the foe again`).toBeGreaterThan(0);
      // Not before the cast's own time and the grace have run from the click that sent it (the old bot's rule); and soon after.
      expect(locks[0]!.at - cast[0]!.at, `seed ${seed}: not before the cast's time and the grace`).toBeGreaterThanOrEqual(ABILITIES.swarm.ranks[0]!.castMs + WISH_RULES.slipGraceMs);
      expect(locks[0]!.at - cast[0]!.at, `seed ${seed}: and soon after`).toBeLessThan(WISH_RULES.slipPendingMs + 2000);
    }
  });

  it("never casts below the lock time, and casts nothing for a faction whose moment has not come", () => {
    const stand = new Stand(true, "plague");
    stand.readyAt = NOW + 600_000;
    playStand(stand, 1, 40 * 8);
    expect(stand.sent.filter((c) => c.cmd.type === "cast")).toEqual([]);
  });
});
