// The strategy layer (brain/strategy.ts, docs/BOTS.md 4, 5, 6.2) and the hunt adapter under it (brain/huntAdapter.ts, 3.6):
// personas order the goals as section 5 says, the current goal is kept against small gains, the softmax and lapse frequencies
// follow the tier, the learned bias is bounded, the pursuit-ring breaker (ported from botOrbit.test.ts) turns on someone else,
// and mobHunt is fed from what the bot has seen. The scenes are plain data over an open-field path service.
import { describe, expect, it } from "vitest";
import type { Vec2 } from "@raid/shared";
import {
  createHuntAdapter, huntConfigFor, mobLikeOf, NO_MOB_IN_REACH, wantsMobs,
} from "../../src/bots/brain/huntAdapter";
import {
  createStrategy, HYSTERESIS, ORBIT_AVOID_MS, ORBIT_JITTER_MS, ORBIT_MIN_DISTANCE, ORBIT_PROGRESS, type Strategy,
} from "../../src/bots/brain/strategy";
import {
  LEARN, PERSONAS, TIERS,
  type BrainConfig, type BrainContext, type BrainRngs, type BrainServices, type ContainerView, type FeatureModule, type FighterMemory,
  type FighterView, type Goal, type GoalDecision, type GoalKind, type GoalStatus, type HudView, type LearnedBias, type MobMemory,
  type PathService, type PersonaId, type PersonaParams, type SelfView, type TierId, type TierParams,
} from "../../src/bots/brain/types";
import { MOB_HUNT } from "../../src/bots/mobHunt";
import {
  brainConfig, container, ctx as makeCtx, emptyMemory, fighter, hudView, percept, rngs, selfView, testMap,
} from "./fixtures";

const NOW = 100_000;
const ME = selfView();
const RUNNING: GoalStatus = { state: "running", why: "" };
const IDLE: Goal = { kind: "idle" };

// --------------------------------------------------------------------------------------------------------------- builders

const openPaths: PathService = {
  walk: (a, b) => ({ dist: Math.hypot(a.x - b.x, a.y - b.y), exact: true }),
  path: (_a, b) => [b],
  los: () => true,
  clear: () => true,
  collisionMap: () => testMap(),
};
const openServices = (): BrainServices => ({ paths: openPaths, log: () => {} });

const tierOf = (id: TierId, over: Partial<TierParams> = {}): TierParams => ({ ...TIERS[id], ...over });
const personaOf = (id: PersonaId, over: Partial<PersonaParams> = {}): PersonaParams => ({ ...PERSONAS[id], ...over });

function config(tier: TierId | TierParams = "hard", persona: PersonaId | PersonaParams = "hunter", over: Partial<BrainConfig> = {}): BrainConfig {
  return brainConfig("hard", "hunter", {
    tier: typeof tier === "string" ? TIERS[tier] : tier,
    persona: typeof persona === "string" ? PERSONAS[persona] : persona,
    services: openServices(),
    ...over,
  });
}

/** Deterministic picks: argmax, never a lapse. */
const sharp = (id: TierId = "hard"): TierParams => tierOf(id, { softmaxT: 0, lapseP: 0 });

const at = (dx: number, dy = 0): Vec2 => ({ x: ME.x + dx, y: ME.y + dy });

function foe(id: string, dx: number, over: Partial<FighterView> = {}): FighterView {
  return fighter({ id, name: id, x: ME.x + dx, faction: "fire", inHand: "sword", ...over });
}

const plainFoe = foe;

function mobMem(id: string, dx: number, over: Partial<MobMemory> = {}): MobMemory {
  const pos = at(dx);
  return {
    id, kind: "mob", faction: "sentenced", home: pos, campId: "sentenced-1", pos, dotAt: NOW, seenAt: NOW, hpFrac: 1, inHand: "sword",
    awake: false, returning: false, alive: true, ...over,
  };
}

function fighterMem(id: string, over: Partial<FighterMemory> = {}): FighterMemory {
  return {
    id, name: id, bot: false, faction: "fire", weaponsSeen: ["sword"], inHand: "sword", otherSlot: null, seenAt: NOW, pos: at(300),
    vel: { x: 0, y: 0 }, hpFrac: 1, bounty: 0, alive: true, diedAt: null, hitMeAt: null, hitByMeAt: null, damageToMe: 0, damageByMe: 0,
    engagedWith: null, engagedAt: null, chasingMe: false, wishSeenAt: null, wishReadyGuess: null, feints: 0, lastFeintAt: null, ...over,
  };
}

interface Scene {
  now?: number;
  self?: Partial<SelfView>;
  hud?: Partial<HudView>;
  fighters?: FighterView[];
  containers?: ContainerView[];
  mobs?: MobMemory[];
  memFighters?: FighterMemory[];
  recentHits?: { t: number; by: string | null; amount: number }[];
  lastHitByPlayerAt?: number | null;
  choices?: string[];
  engaged?: boolean;
  /** A fighter's remembered whereabouts by id (a position; the radius is not read). */
  whereabouts?: Record<string, Vec2>;
  /** When the coliseum teleport was seen. */
  teleportedAt?: number;
}

function scene(cfg: BrainConfig, s: Scene = {}, rng: BrainRngs = rngs(1)): BrainContext {
  const now = s.now ?? NOW;
  const base = emptyMemory();
  const mem = emptyMemory({
    mobs: new Map((s.mobs ?? []).map((m) => [m.id, m])),
    fighters: new Map((s.memFighters ?? []).map((f) => [f.id, f])),
    self: { ...base.self, recentHits: s.recentHits ?? [], lastHitByPlayerAt: s.lastHitByPlayerAt ?? null, teleportedAt: s.teleportedAt ?? null },
    choices: (s.choices ?? []) as never,
    whereabouts: (id) => (s.whereabouts?.[id] ? { at: s.whereabouts[id]!, radius: 50 } : null),
  });
  return makeCtx({
    cfg,
    p: percept({
      now, self: selfView({ faction: "fire", weapons: ["sword", null], ...s.self }), hud: hudView(s.hud),
      fighters: s.fighters ?? [], containers: s.containers ?? [],
    }),
    mem,
    rng,
    engaged: s.engaged ?? false,
  });
}

function decide(strategy: Strategy, cfg: BrainConfig, s: Scene = {}, current: Goal = IDLE, status: GoalStatus = RUNNING, rng?: BrainRngs): GoalDecision {
  return strategy.decide(scene(cfg, s, rng), current, status);
}

const best = (strategy: Strategy, kind: GoalKind): number | undefined => {
  const us = strategy.state.candidates.filter((c) => c.goal.kind === kind).map((c) => c.utility);
  return us.length ? Math.max(...us) : undefined;
};
const kinds = (strategy: Strategy): GoalKind[] => strategy.state.candidates.map((c) => c.goal.kind);
/** Holding the coliseum ring (the fallback "wait where you stand" is a hold too). */
const holdsRing = (strategy: Strategy): boolean => strategy.state.candidates.some((c) => c.goal.kind === "hold" && c.goal.why === "coliseum");

/** A module that offers fixed goals, to put exact utilities next to the strategy's own. */
function offers(...goals: { n: number; utility: number; choice?: GoalDecision["choice"] }[]): FeatureModule {
  return {
    id: "t",
    enabled: () => true,
    goals: () => goals.map((g) => ({ goal: modGoal(g.n), utility: g.utility, why: `module ${g.n}`, ...(g.choice ? { choice: g.choice } : {}) })),
  };
}
const modGoal = (n: number): Goal => ({ kind: "module", module: "t", data: { n } });

/** What pickOption does, as a share per candidate (softmax at T, with lapseP spread over the top three). */
function expectedShares(utils: readonly number[], temperature: number, lapseP: number): number[] {
  const top = Math.max(...utils);
  const w = utils.map((u) => Math.exp((u - top) / temperature));
  const sum = w.reduce((a, b) => a + b, 0);
  const top3 = utils.map((u, i) => [u, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, i]) => i);
  return utils.map((_, i) => (1 - lapseP) * (w[i]! / sum) + (top3.includes(i) ? lapseP / top3.length : 0));
}

// ------------------------------------------------------------------------------------------------------------ personas

describe("personas order the goals (docs/BOTS.md 5)", () => {
  const farmScene: Scene = {
    mobs: [mobMem("m1", 400)],
    // A fire mirror at half its hp, far enough to leave the mob alone: a fight a hunter takes (it is well ahead on the bars) and a farmer does not.
    fighters: [foe("rival", -600, { hpFrac: 0.5 })],
  };

  it("a Farmer prefers a mob to an even fight with a player, a Hunter the opposite", () => {
    const farmer = createStrategy();
    const hunter = createStrategy();
    const f = decide(farmer, config("hard", "farmer"), farmScene);
    const h = decide(hunter, config("hard", "hunter"), farmScene);
    expect(best(farmer, "farm")!).toBeGreaterThan(best(farmer, "hunt")! + 0.3);
    expect(best(hunter, "hunt")!).toBeGreaterThan(best(hunter, "farm")! + 0.15);
    expect(f.goal).toEqual({ kind: "farm", mob: "m1", camp: "sentenced-1" });
    expect(h.goal).toEqual({ kind: "hunt", target: "rival" });
  });

  it("the Opportunist and the Cautious sit between them: a fight that is only a little better than even is not worth it to a Cautious one", () => {
    const opp = createStrategy();
    const cautious = createStrategy();
    decide(opp, config("hard", "opportunist"), farmScene);
    decide(cautious, config("hard", "cautious"), farmScene);
    expect(best(cautious, "farm")!).toBeGreaterThan(best(cautious, "hunt") ?? 0);
    expect(best(opp, "farm")!).toBeGreaterThan(best(opp, "hunt") ?? 0);
    // A bigger lead changes the Opportunist's mind (it engages from 69% to win), not the Cautious one's (83%) as much.
    const edge: Scene = { ...farmScene, fighters: [foe("rival", -600, { faction: "sentenced", inHand: "axe", hpFrac: 0.3 })] };
    const opp2 = createStrategy();
    const cautious2 = createStrategy();
    decide(opp2, config("hard", "opportunist"), edge);
    decide(cautious2, config("hard", "cautious"), edge);
    expect(best(opp2, "hunt")!).toBeGreaterThan(best(opp, "hunt") ?? 0);
    expect(best(opp2, "hunt")!).toBeGreaterThan(best(cautious2, "hunt") ?? 0);
  });

  it("a Cautious bot flees earlier than a Hunter: at 40% hp with an enemy near, one runs and the other fights on", () => {
    const hurt: Scene = { self: { hp: 40, maxHp: 100 }, fighters: [foe("rival", 200, { hpFrac: 0.2 })] };
    const cautious = decide(createStrategy(), config("hard", "cautious"), hurt);
    const hunter = decide(createStrategy(), config("hard", "hunter"), hurt);
    expect(cautious.goal.kind).toBe("flee");
    expect(hunter.goal.kind).not.toBe("flee");
    const worse: Scene = { self: { hp: 15, maxHp: 100 }, fighters: [foe("rival", 200)] };
    expect(decide(createStrategy(), config("hard", "hunter"), worse).goal.kind).toBe("flee");
  });

  it("a flee runs from the threats for 1.5 to 3 s, and nothing to run from means no flee", () => {
    const d = decide(createStrategy(), config("hard", "cautious"), { self: { hp: 30, maxHp: 100 }, fighters: [foe("rival", 200)] });
    expect(d.goal.kind).toBe("flee");
    if (d.goal.kind !== "flee") return;
    expect(d.goal.from).toContainEqual(at(200));
    expect(d.goal.until - NOW).toBeGreaterThanOrEqual(1500);
    expect(d.goal.until - NOW).toBeLessThanOrEqual(3000);
    const alone = createStrategy();
    decide(alone, config("hard", "cautious"), { self: { hp: 30, maxHp: 100 } });
    expect(kinds(alone)).not.toContain("flee");
  });

  it("keeps running until it has recovered or is out of reach, and gives up on a chaser it cannot shake", () => {
    const cfg = config("hard", "cautious");
    const s = createStrategy();
    const scn: Scene = { self: { hp: 70, maxHp: 100 }, fighters: [foe("rival", 300)] }; // above fleeHp .55, below reengage .9
    expect(decide(s, cfg, scn, IDLE).goal.kind).not.toBe("flee");
    const fleeing = decide(s, cfg, { ...scn, now: NOW }, { kind: "flee", from: [at(300)], until: NOW + 2000 });
    expect(fleeing.goal.kind).toBe("flee");
    // Eight seconds of running with the chaser still on its heels: turn and fight.
    const cornered = decide(s, cfg, { ...scn, now: NOW + 9000, fighters: [foe("rival", 100)] }, { kind: "flee", from: [at(100)], until: NOW + 9500 });
    expect(cornered.goal.kind).not.toBe("flee");
  });

  it("a flee that tactics reports failed (nowhere to run) is not offered again at once", () => {
    const cfg = config("hard", "cautious");
    const s = createStrategy();
    const scn: Scene = { self: { hp: 30, maxHp: 100 }, fighters: [foe("rival", 200)] };
    const first = decide(s, cfg, scn);
    expect(first.goal.kind).toBe("flee");
    const second = decide(s, cfg, { ...scn, now: NOW + 500 }, first.goal, { state: "failed", why: "cornered" });
    expect(second.goal.kind).not.toBe("flee");
  });

  it("opens no hunt on a player it expects to lose to, but does for a bountied one", () => {
    const cfg = config("hard", "hunter");
    const worse = foe("big", -500, { faction: "holy", inHand: "axe", hpFrac: 1 }); // holy beats fire, axe loses to sword: about even, and not enough for a hunter at full hp
    const plain = createStrategy();
    decide(plain, cfg, { fighters: [worse] });
    expect(best(plain, "hunt")).toBeUndefined();
    const bountied = createStrategy();
    decide(bountied, cfg, { fighters: [{ ...worse, bounty: 40 }] });
    expect(best(bountied, "hunt")!).toBeGreaterThan(0);
    // A bounty on the bot itself makes it pickier (bountyCaution): a fight it would take anyway gets worth less, or goes.
    const wounded = foe("small", -500, { faction: "holy", inHand: "axe", hpFrac: 0.35 });
    const unmarked = createStrategy();
    decide(unmarked, config("hard", "opportunist"), { fighters: [wounded] });
    const marked = createStrategy();
    decide(marked, config("hard", "opportunist"), { self: { bounty: 20 }, fighters: [wounded] });
    expect(best(unmarked, "hunt")!).toBeGreaterThan(0);
    expect(best(marked, "hunt") ?? 0).toBeLessThan(best(unmarked, "hunt")!);
  });

  it("a third party is worth more than an equal fight: a fighter already engaged with someone else is easier prey", () => {
    const cfg = config("hard", "opportunist");
    const a = foe("a", -500, { hpFrac: 0.8 }); // a little ahead on the bars: not enough alone
    const quiet = createStrategy();
    decide(quiet, cfg, { fighters: [a] });
    expect(best(quiet, "hunt")).toBeUndefined();
    const busy = createStrategy();
    decide(busy, cfg, {
      fighters: [a],
      memFighters: [fighterMem("a", { engagedWith: "b", engagedAt: NOW - 1000 }), fighterMem("b", { engagedWith: "a", engagedAt: NOW - 1000 })],
    });
    expect(best(busy, "hunt")!).toBeGreaterThan(0.1);
    // A stale cue counts for nothing, and a fight with the bot itself is not a third party.
    const stale = createStrategy();
    decide(stale, cfg, { fighters: [a], memFighters: [fighterMem("a", { engagedWith: "b", engagedAt: NOW - 20_000 })] });
    expect(best(stale, "hunt")).toBeUndefined();
    const me = createStrategy();
    decide(me, cfg, { fighters: [a], memFighters: [fighterMem("a", { engagedWith: ME.id, engagedAt: NOW - 500 })] });
    expect(best(me, "hunt")).toBeUndefined();
  });

  it("a mob is worth less to a bot that is already fed (the reward curve), and an elite less to a bot with little appetite for them", () => {
    const farmOf = (persona: PersonaId, scn: Scene) => {
      const s = createStrategy();
      decide(s, config("normal", persona), scn);
      return best(s, "farm")!;
    };
    const hungry = farmOf("farmer", { mobs: [mobMem("m1", 400)] });
    const fed = farmOf("farmer", { mobs: [mobMem("m1", 400)], self: { kills: 6, mobKills: 2 } });
    expect(fed).toBeLessThan(hungry - 0.2);
    const elite = { mobs: [mobMem("m1", 400, { kind: "elite" })] };
    const normal = { mobs: [mobMem("m1", 400)] };
    expect(farmOf("farmer", elite) / farmOf("farmer", normal)).toBeGreaterThan(farmOf("hunter", elite) / farmOf("hunter", normal));
  });

  it("a hurt bot is less keen to open a fight than a healthy one, and does not hunt the dead", () => {
    const cfg = config("hard", "cautious");
    const hunt = (hp: number, status = "alive") => {
      const s = createStrategy();
      decide(s, cfg, { self: { hp, maxHp: 100 }, fighters: [foe("a", -500, { faction: "sentenced", inHand: "axe", hpFrac: 0.4, status })] });
      return best(s, "hunt");
    };
    expect(hunt(80)!).toBeLessThan(hunt(100)!);
    expect(hunt(100, "dead")).toBeUndefined();
  });

  it("never reads the [BOT] flag", () => {
    const cfg = config("normal", "opportunist");
    const run = (bot: boolean) => {
      const s = createStrategy();
      const d = decide(s, cfg, { fighters: [foe("a", -500, { bot })], mobs: [mobMem("m1", 400)] });
      return JSON.stringify([d, s.state.candidates]);
    };
    expect(run(true)).toBe(run(false));
  });
});


// ----------------------------------------------------------------------------- restraint is the skill (docs/BOTS_TUNING.md 3)

describe("sizing up a fight: the appraisal, the opening and the wariness", () => {
  /** Hard hunter with no lapses; a foe the bot can see, at the given hp share. */
  const hunterCfg = (tier: TierId = "hard") => config(sharp(tier), "hunter");
  const huntU = (tier: TierId, scn: Scene, persona: PersonaId = "hunter"): number => {
    const s = createStrategy();
    decide(s, config(sharp(tier), persona), scn);
    return best(s, "hunt") ?? 0;
  };
  const late = { now: NOW + 30_000, hud: { raidStartedAt: 0 } }; // past the opening whatever NOW is

  it("a bot opens only fights it expects to win by the persona's margin: the same foe at full hp is left alone, a wounded one is taken", () => {
    expect(huntU("hard", { fighters: [foe("a", -500, { hpFrac: 1 })] })).toBe(0);
    expect(huntU("hard", { fighters: [foe("a", -500, { hpFrac: 0.7 })] })).toBeGreaterThan(0);
    expect(huntU("hard", { fighters: [foe("a", -500, { hpFrac: 0.4 })] })).toBeGreaterThan(huntU("hard", { fighters: [foe("a", -500, { hpFrac: 0.7 })] }));
  });

  it("a better tier reads the hp bars harder, and a newcomer leans on the hue: lead moves the Hard bot's utility more than the Easy one's", () => {
    const wounded = (hp: number): Scene => ({ fighters: [foe("a", -500, { hpFrac: hp })] });
    const gain = (tier: TierId) => huntU(tier, wounded(0.4)) - huntU(tier, wounded(0.8));
    expect(TIERS.hard.appraisal.lead).toBeGreaterThan(TIERS.normal.appraisal.lead);
    expect(TIERS.normal.appraisal.lead).toBeGreaterThan(TIERS.easy.appraisal.lead);
    expect(TIERS.hard.appraisal.noise).toBeLessThan(TIERS.easy.appraisal.noise);
    expect(TIERS.hard.appraisal.hue).toBeLessThan(TIERS.easy.appraisal.hue);
    expect(gain("hard")).toBeGreaterThan(gain("easy"));
  });

  it("a misjudgement of a foe is drawn once and held for a few seconds, then drawn afresh", () => {
    const noisy = tierOf("easy", { softmaxT: 0, lapseP: 0, appraisal: { ...TIERS.easy.appraisal, noise: 2 } });
    const cfg = config(noisy, "hunter");
    const s = createStrategy();
    const scn: Scene = { fighters: [foe("a", -500, { hpFrac: 0.5 })] };
    const rng = rngs(5);
    const u = (t: number): number => { decide(s, cfg, { ...scn, now: t }, IDLE, RUNNING, rng); return best(s, "hunt") ?? 0; };
    const a = u(NOW);
    expect(u(NOW + 1000)).toBe(a);
    expect(u(NOW + 4000)).toBe(a);
    const later = new Set([u(NOW + 6000), u(NOW + 12_000), u(NOW + 18_000), u(NOW + 24_000), u(NOW + 30_000)]);
    expect(later.size).toBeGreaterThan(1);
  });

  it("the first minute is for the camps: a fight that is a coin flip waits for it, a sure thing does not", () => {
    const start = { hud: { raidStartedAt: NOW - 5000 } as Partial<HudView>, now: NOW };
    const mid = foe("a", -500, { hpFrac: 0.45 });
    const sure = foe("b", -500, { hpFrac: 0.05 });
    expect(huntU("hard", { ...start, fighters: [mid] })).toBe(0);
    expect(huntU("hard", { ...start, fighters: [sure] })).toBeGreaterThan(0);
    // The restraint fades over OPENING_MS...
    expect(huntU("hard", { now: NOW, hud: { raidStartedAt: NOW - 70_000 }, fighters: [mid] })).toBeGreaterThan(0);
    // ...and goes when the patience timer is about to teleport everyone anyway.
    expect(huntU("hard", { ...start, hud: { raidStartedAt: NOW - 5000, patienceEndsAt: NOW + 10_000 }, fighters: [mid] })).toBeGreaterThan(0);
  });

  it("a bot that does not want to fight a player coming at it keeps away; one that wants the fight, or has no sense of the danger, does not", () => {
    const coming = fighterMem("big", { chasingMe: true });
    const scn = (hp: number): Scene => ({ ...late, fighters: [foe("big", 300, { hpFrac: hp })], memFighters: [coming] });
    const evade = (tier: TierId, hp: number) => decide(createStrategy(), hunterCfg(tier), scn(hp));
    const hard = evade("hard", 1);
    expect(hard.goal.kind).toBe("flee");
    expect(hard.why).toContain("keeping away");
    expect(evade("hard", 0.3).goal.kind).toBe("hunt"); // a wounded foe is a fight it wants
    expect(TIERS.easy.wary).toBe(0);
    expect(evade("easy", 1).goal.kind).not.toBe("flee");
    // Far away, or standing still and not close, is no reason to move.
    expect(decide(createStrategy(), hunterCfg("hard"), { ...late, fighters: [foe("big", 700)], memFighters: [coming] }).goal.kind).not.toBe("flee");
    expect(decide(createStrategy(), hunterCfg("hard"), { ...late, fighters: [foe("big", 300)] }).goal.kind).not.toBe("flee");
    // It never walks away from a fight it is in.
    expect(decide(createStrategy(), hunterCfg("hard"), { ...scn(1), engaged: true, self: { attackTarget: "big" } }).goal.kind).not.toBe("flee");
  });

  it("the Hard bot notices from farther off than the Normal one", () => {
    expect(TIERS.hard.wary).toBeGreaterThan(TIERS.normal.wary);
    const coming = fighterMem("big", { chasingMe: true });
    const at = (tier: TierId, d: number) => decide(createStrategy(), hunterCfg(tier), { ...late, fighters: [foe("big", d)], memFighters: [coming] }).goal.kind;
    expect(at("hard", 400)).toBe("flee");
    expect(at("normal", 400)).not.toBe("flee");
  });
});

describe("nothing to do", () => {
  it("a healthy bot walks to the camp it saw longest ago instead of standing, and never offers 'wait' beside a real option", () => {
    const s = createStrategy();
    const d = decide(s, config("easy", "farmer"), { self: { hp: 100, maxHp: 100 } });
    expect(["roam"]).toContain(d.goal.kind);
    expect(s.state.candidates.some((c) => c.goal.kind === "hold" && c.goal.why === "wait")).toBe(false);
  });

  it("a hurt bot lies low where it stands instead of wandering into the others, and a healthy one does not", () => {
    const hurt = createStrategy();
    const d = decide(hurt, config(sharp("hard"), "farmer"), { self: { hp: 45, maxHp: 100 } });
    expect(d.goal).toMatchObject({ kind: "hold", why: "ambush" });
    expect(best(hurt, "hold")).toBeGreaterThan(best(hurt, "roam") ?? 0);
    const whole = createStrategy();
    decide(whole, config(sharp("hard"), "farmer"), { self: { hp: 100, maxHp: 100 } });
    expect(whole.state.candidates.some((c) => c.goal.kind === "hold" && c.goal.why === "ambush")).toBe(false);
  });

  it("with nothing at all to do (every camp cleared and just visited, the middle reached), it waits", () => {
    const s = createStrategy();
    const camps = testMap().camps.map((c) => [c.id, { id: c.id, zone: c.zone, elite: c.eliteSpot >= 0, aliveSeen: 0, clearedAt: NOW - 500, contestedAt: null, visitedAt: NOW - 1000 }] as const);
    const scn = scene(config(sharp("hard"), "hunter"), { self: { x: testMap().w * 16, y: testMap().h * 16 } });
    (scn.mem as { camps: unknown }).camps = new Map(camps);
    expect(s.decide(scn, IDLE, RUNNING).goal).toMatchObject({ kind: "hold", why: "wait" });
  });
});

// ----------------------------------------------------------------------------------------- picking and keeping the goal

describe("keeping the current goal", () => {
  const cfg = (tier: TierParams = sharp()): BrainConfig => config(tier, "hunter", { modules: [] });
  const withMods = (tier: TierParams, ...goals: { n: number; utility: number }[]): BrainConfig => config(tier, "hunter", { modules: [offers(...goals)] });

  it("keeps the current goal against a candidate that is better by less than the hysteresis, and drops it for one that is better by more", () => {
    const small = withMods(sharp(), { n: 1, utility: 0.6 }, { n: 2, utility: 0.6 + HYSTERESIS - 0.02 });
    const kept = decide(createStrategy(), small, {}, modGoal(1));
    expect(kept.goal).toEqual(modGoal(1));
    expect(kept.why).toContain("keeping");
    const big = withMods(sharp(), { n: 1, utility: 0.6 }, { n: 2, utility: 0.6 + HYSTERESIS + 0.02 });
    expect(decide(createStrategy(), big, {}, modGoal(1)).goal).toEqual(modGoal(2));
    // With nothing current, the best candidate wins outright.
    expect(decide(createStrategy(), small, {}, IDLE).goal).toEqual(modGoal(2));
  });

  it("holds even when the softmax would pick the other: Easy's noise cannot flip a goal on a small gain", () => {
    const c = withMods(tierOf("easy"), { n: 1, utility: 0.6 }, { n: 2, utility: 0.68 });
    let switched = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const d = decide(createStrategy(), c, {}, modGoal(1), RUNNING, rngs(seed));
      if (d.goal.kind === "module" && (d.goal.data as { n: number }).n === 2) switched++;
    }
    expect(switched).toBe(0);
  });

  it("switches on a big gain only when the pick lands on it", () => {
    const c = withMods(tierOf("easy"), { n: 1, utility: 0.5 }, { n: 2, utility: 0.9 });
    let switched = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const d = decide(createStrategy(), c, {}, modGoal(1), RUNNING, rngs(seed));
      if (d.goal.kind === "module" && (d.goal.data as { n: number }).n === 2) switched++;
    }
    expect(switched).toBeGreaterThan(110);
    expect(switched).toBeLessThan(190); // the softmax still lets the current goal win sometimes
  });

  it("does not offer a goal tactics has just reported done or failed", () => {
    const c = withMods(sharp(), { n: 1, utility: 0.9 }, { n: 2, utility: 0.5 });
    const s = createStrategy();
    expect(decide(s, c, {}, modGoal(1), { state: "failed", why: "unreachable" }).goal).toEqual(modGoal(2));
    expect(decide(s, c, { now: NOW + 1000 }, IDLE).goal).toEqual(modGoal(2)); // still shut out
    expect(decide(s, c, { now: NOW + 6000 }, IDLE).goal).toEqual(modGoal(1)); // the exclusion has run out
  });

  it("a blocked goal (a reflex took the channel) is still a candidate", () => {
    const c = withMods(sharp(), { n: 1, utility: 0.9 }, { n: 2, utility: 0.5 });
    expect(decide(createStrategy(), c, {}, modGoal(1), { state: "blocked", why: "dodge" }).goal).toEqual(modGoal(1));
  });

  it("commits to a fight for reconsiderMs, then weighs it against the rest; a flee still interrupts", () => {
    const tier = sharp();
    const c = withMods(tier, { n: 1, utility: 0.98 });
    const trading: Scene = { fighters: [foe("rival", 120)], engaged: true, self: { attackTarget: "rival" } };
    const s = createStrategy();
    const fight: Goal = { kind: "fight", target: "rival" };
    // The fight begins at NOW. A module offers more than the fight is worth (0.85) + the hysteresis.
    expect(decide(s, c, trading, fight).goal).toEqual(fight);
    expect(decide(s, c, { ...trading, now: NOW + tier.attention.reconsiderMs - 200 }, fight).goal).toEqual(fight);
    expect(decide(s, c, { ...trading, now: NOW + tier.attention.reconsiderMs + 200 }, fight).goal).toEqual(modGoal(1));
    // Hurt, it runs at once.
    const s2 = createStrategy();
    decide(s2, c, trading, fight);
    const hurt = decide(s2, c, { ...trading, now: NOW + 300, self: { attackTarget: "rival", hp: 10, maxHp: 100 } }, fight);
    expect(hurt.goal.kind).toBe("flee");
  });

  it("a fight is trading blows with a player; trading blows with a mob is the farm goal's business", () => {
    const s = createStrategy();
    const d = decide(s, cfg(), { mobs: [mobMem("m1", 100)], engaged: true, self: { attackTarget: "m1" } }, IDLE);
    expect(kinds(s)).not.toContain("fight");
    expect(d.goal.kind).toBe("farm");
    const s2 = createStrategy();
    decide(s2, cfg(), { fighters: [foe("rival", 300)], engaged: true, recentHits: [{ t: NOW - 500, by: "rival", amount: 10 }] }, IDLE);
    expect(kinds(s2)).toContain("fight"); // shot at from a distance: it is a fight although nothing is locked
  });

  it("re-decides nothing for a bot that is not standing", () => {
    expect(decide(createStrategy(), cfg(), { self: { status: "dead" } }).goal).toEqual(IDLE);
  });

  it("is deterministic: the same percept, memory and seed give the same decision", () => {
    const c = config("normal", "opportunist");
    const scn: Scene = { mobs: [mobMem("m1", 400)], fighters: [foe("a", -500)], containers: [container({ id: "c1", weapon: "bow" })] };
    const run = () => JSON.stringify(decide(createStrategy(), c, scn, IDLE, RUNNING, rngs(9)));
    expect(run()).toBe(run());
  });
});

describe("the pick follows the tier's temperature and lapse chance", () => {
  const offered = [{ n: 1, utility: 0.8 }, { n: 2, utility: 0.6 }, { n: 3, utility: 0.5 }];

  for (const id of ["easy", "normal", "hard"] as const) {
    it(`${id}: how often each option wins matches the softmax with lapses`, () => {
      const tier = TIERS[id];
      const cfg = config(tier, "hunter", { modules: [offers(...offered)] });
      const probe = createStrategy();
      decide(probe, cfg, {});
      const cands = probe.state.candidates;
      const expected = expectedShares(cands.map((c) => c.utility), tier.softmaxT, tier.lapseP);
      const wins = cands.map(() => 0);
      const draws = 3000;
      for (let seed = 1; seed <= draws; seed++) {
        const d = decide(createStrategy(), cfg, {}, IDLE, RUNNING, rngs(seed * 7919));
        const i = cands.findIndex((c) => JSON.stringify(c.goal) === JSON.stringify(d.goal));
        wins[i]!++;
      }
      cands.forEach((c, i) => {
        if (c.goal.kind !== "module") return;
        const share = wins[i]! / draws;
        const tol = 4 * Math.sqrt((expected[i]! * (1 - expected[i]!)) / draws) + 0.005;
        expect(Math.abs(share - expected[i]!), `${id} option ${(c.goal.data as { n: number }).n}`).toBeLessThanOrEqual(tol);
      });
    });
  }

  it("a harder tier takes the best option more often", () => {
    const share = (id: TierId) => {
      const cfg = config(TIERS[id], "hunter", { modules: [offers(...offered)] });
      let top = 0;
      for (let seed = 1; seed <= 1500; seed++) {
        const d = decide(createStrategy(), cfg, {}, IDLE, RUNNING, rngs(seed));
        if (JSON.stringify(d.goal) === JSON.stringify(modGoal(1))) top++;
      }
      return top / 1500;
    };
    expect(share("hard")).toBeGreaterThan(share("normal"));
    expect(share("normal")).toBeGreaterThan(share("easy"));
  });
});

// -------------------------------------------------------------------------------------------------------------- learning

describe("the learned bias (docs/BOTS.md 6.2)", () => {
  const learnedWith = (f: (key: string) => number, enabled = true): LearnedBias => ({ enabled, bias: f as LearnedBias["bias"] });
  const first: Scene = { mobs: [mobMem("m1", 400)] };

  it("moves the utility of the key it names by LEARN.weight x the bias, at most weight x cap either way, and reports the key", () => {
    const run = (learned: LearnedBias) => {
      const s = createStrategy();
      const d = decide(s, config("hard", "farmer", { learned }), first);
      return { d, farm: best(s, "farm")! };
    };
    const none = run(learnedWith(() => 0));
    expect(none.d.choice).toBe("opener|fire|sentenced");
    const up = run(learnedWith(() => LEARN.cap));
    const down = run(learnedWith(() => -LEARN.cap));
    expect(up.farm - none.farm).toBeCloseTo(LEARN.weight * LEARN.cap, 9);
    expect(none.farm - down.farm).toBeCloseTo(LEARN.weight * LEARN.cap, 9);
    // A store that misbehaves cannot buy more than that, nor poison the score with NaN.
    expect(run(learnedWith(() => 50)).farm - none.farm).toBeCloseTo(LEARN.weight * LEARN.cap, 9);
    expect(run(learnedWith(() => -50)).farm).toBeCloseTo(down.farm, 9);
    expect(run(learnedWith(() => NaN)).farm).toBeCloseTo(none.farm, 9);
    // Learning off: no bias at all.
    expect(run(learnedWith(() => LEARN.cap, false)).farm).toBeCloseTo(none.farm, 9);
  });

  it("asks only for keys of the choices it can name: the opener camp and the second weapon", () => {
    const asked = new Set<string>();
    const learned = learnedWith((k) => { asked.add(k); return 0; });
    decide(createStrategy(), config("hard", "opportunist", { learned }), {
      mobs: [mobMem("m1", 400)], containers: [container({ id: "c1", kind: "ground", weapon: "bow" })],
    });
    expect([...asked].sort()).toEqual(["opener|fire|sentenced", "second|fire|bow"]);
  });

  it("asks for the opener once: after one is recorded it is no longer a choice", () => {
    const asked: string[] = [];
    const learned = learnedWith((k) => { asked.push(k); return 0; });
    const s = createStrategy();
    const d = decide(s, config("hard", "farmer", { learned }), { ...first, choices: ["opener|fire|holy"] });
    expect(d.choice).toBeUndefined();
    expect(asked.filter((k) => k.startsWith("opener"))).toEqual([]);
  });

  it("tilts the pick between two options that are otherwise equal, and does not repeat the choice while the goal is kept", () => {
    const two: Scene = {
      self: { weapons: ["sword", null] },
      containers: [container({ id: "east", kind: "ground", weapon: "bow", x: ME.x + 100 }), container({ id: "west", kind: "ground", weapon: "wand", x: ME.x - 100 })],
    };
    const pick = (favour: string) => decide(createStrategy(), config(sharp(), "opportunist", { learned: learnedWith((k) => (k === favour ? LEARN.cap : -LEARN.cap)) }), two);
    const bow = pick("second|fire|bow");
    const wand = pick("second|fire|wand");
    expect(bow.goal).toEqual({ kind: "loot", container: "east" });
    expect(bow.choice).toBe("second|fire|bow");
    expect(wand.goal).toEqual({ kind: "loot", container: "west" });
    expect(wand.choice).toBe("second|fire|wand");
    const kept = decide(createStrategy(), config(sharp(), "opportunist"), two, bow.goal);
    expect(kept.goal).toEqual(bow.goal);
    expect(kept.choice).toBeUndefined();
  });

  it("is smaller than the gap a softmax at Easy's temperature cares about, so it cannot lock a choice in", () => {
    expect(LEARN.weight * LEARN.cap).toBeLessThan(TIERS.easy.softmaxT / 2);
  });
});

// --------------------------------------------------------------------------------------------------- the pursuit-ring breaker

describe("the pursuit-ring breaker (ported from botOrbit.test.ts)", () => {
  // The old bot gave up a chase after ORBIT_MS + up to ORBIT_JITTER_MS; here that is the persona's chaseGiveUpMs.
  const persona = personaOf("hunter", { chaseGiveUpMs: 3000 });
  const cfg = config(sharp(), persona); // no lapses: a slip of attention would hide what is tested
  /** The players here are wounded, so that a hunter wants them (a Hard bot does not open an even fight). */
  const foe = (id: string, dx: number, over: Partial<FighterView> = {}): FighterView => plainFoe(id, dx, { hpFrac: 0.4, ...over });
  const HUNTING: Goal = { kind: "hunt", target: "orbiter" };
  const STEP = 250;

  /** Drives one think every STEP ms for `ms`, the bot hunting `orbiter` the whole time (or the given goal), over a scene built by `at(t)`. */
  function run(s: Strategy, rng: BrainRngs, from: number, ms: number, scn: (t: number) => Scene, goal: Goal = HUNTING): number {
    let t = from;
    for (; t < from + ms; t += STEP) decide(s, cfg, { ...scn(t), now: t }, goal, RUNNING, rng);
    return t;
  }
  const standoff = (orbiterDx = 400, others: FighterView[] = []) => (_t: number): Scene => ({ fighters: [foe("orbiter", orbiterDx), ...others] });
  const give = persona.chaseGiveUpMs + ORBIT_JITTER_MS + 2 * STEP;

  it("turns on someone else after a chase that goes nowhere, and the target stays out of the choice while it is far", () => {
    const s = createStrategy();
    const rng = rngs(3);
    const other = foe("other", 500);
    const scn = standoff(400, [other]);
    const t = run(s, rng, NOW, give, scn);
    expect(s.state.avoidId).toBe("orbiter");
    const d = decide(s, cfg, { ...scn(t), now: t }, HUNTING, RUNNING, rng);
    expect(s.state.candidates.some((c) => c.goal.kind === "hunt" && c.goal.target === "orbiter")).toBe(false);
    expect(d.goal).toEqual({ kind: "hunt", target: "other" });
  });

  it("does not give up while the chase is closing in, or while the bot is attacking", () => {
    const closing = createStrategy();
    run(closing, rngs(3), NOW, 2 * give, (t) => ({ fighters: [foe("orbiter", 1700 - ((t - NOW) / STEP) * (ORBIT_PROGRESS + 10))] }));
    expect(closing.state.avoidId).toBeNull();
    const fighting = createStrategy();
    const attacking = (t: number): Scene => ({ fighters: [foe("orbiter", 400)], engaged: true, self: { attackTarget: "orbiter" }, now: t });
    run(fighting, rngs(3), NOW, 3 * give, attacking);
    expect(fighting.state.avoidId).toBeNull();
    // A tactics-supplied "attacking" counts the same.
    const custom = createStrategy({ attacking: () => true });
    run(custom, rngs(3), NOW, 3 * give, standoff());
    expect(custom.state.avoidId).toBeNull();
  });

  it("does not time a chase within fighting distance, nor one that is already a fight", () => {
    const s = createStrategy();
    run(s, rngs(3), NOW, 3 * give, standoff(ORBIT_MIN_DISTANCE - 1));
    expect(s.state.avoidId).toBeNull();
  });

  it("takes the avoided player again the moment it comes within the fight distance, and stays that way when it drifts back out", () => {
    const s = createStrategy();
    const rng = rngs(3);
    const other = foe("other", 500);
    const t = run(s, rng, NOW, give, standoff(400, [other]));
    expect(s.state.avoidId).toBe("orbiter");
    decide(s, cfg, { fighters: [foe("orbiter", ORBIT_MIN_DISTANCE - 1), other], now: t }, IDLE, RUNNING, rng);
    expect(s.state.avoidId).toBeNull();
    expect(s.state.candidates.some((c) => c.goal.kind === "hunt" && c.goal.target === "orbiter")).toBe(true);
    decide(s, cfg, { fighters: [foe("orbiter", 300), other], now: t + 50 }, IDLE, RUNNING, rng);
    expect(s.state.candidates.some((c) => c.goal.kind === "hunt" && c.goal.target === "orbiter")).toBe(true);
  });

  it("takes it again once it hits the bot, and not for anyone else's blow", () => {
    const rng = rngs(3);
    const other = foe("other", 500);
    const avoided = () => {
      const s = createStrategy();
      const t = run(s, rng, NOW, give, standoff(400, [other]));
      expect(s.state.avoidId).toBe("orbiter");
      return { s, t };
    };
    // It hit someone else, someone else hit us, the arena did, we hit it: still avoided.
    const { s, t } = avoided();
    decide(s, cfg, {
      fighters: [foe("orbiter", 400), other], now: t + 100,
      memFighters: [fighterMem("orbiter", { hitByMeAt: t + 50, engagedWith: "other", engagedAt: t + 50 }), fighterMem("other", { hitMeAt: t + 50 })],
      recentHits: [{ t: t + 50, by: "other", amount: 5 }, { t: t + 60, by: null, amount: 5 }],
    }, IDLE, RUNNING, rng);
    expect(s.state.avoidId).toBe("orbiter");
    // It hit us.
    decide(s, cfg, {
      fighters: [foe("orbiter", 400), other], now: t + 200,
      memFighters: [fighterMem("orbiter", { hitMeAt: t + 150 })],
    }, IDLE, RUNNING, rng);
    expect(s.state.avoidId).toBeNull();
    const second = avoided();
    decide(second.s, cfg, {
      fighters: [foe("orbiter", 400), other], now: second.t + 200,
      recentHits: [{ t: second.t + 150, by: "orbiter", amount: 5 }],
    }, IDLE, RUNNING, rng);
    expect(second.s.state.avoidId).toBeNull();
  });

  it("lets the avoidance run out after ORBIT_AVOID_MS", () => {
    const s = createStrategy();
    const rng = rngs(3);
    const t = run(s, rng, NOW, give, standoff(400, [foe("other", 500)]));
    decide(s, cfg, { fighters: [foe("orbiter", 400), foe("other", 500)], now: t + ORBIT_AVOID_MS + 100 }, IDLE, RUNNING, rng);
    expect(s.state.avoidId).toBeNull();
  });

  it("still hunts the avoided player when it is the last one standing", () => {
    const s = createStrategy();
    const rng = rngs(3);
    const t = run(s, rng, NOW, give, standoff());
    expect(s.state.avoidId).toBe("orbiter");
    const d = decide(s, cfg, { fighters: [foe("orbiter", 400)], now: t }, IDLE, RUNNING, rng);
    expect(d.goal).toEqual({ kind: "hunt", target: "orbiter" });
  });

  it("does not run while the bot walks off for a weapon (a detour is not a chase going nowhere), and runs again afterwards", () => {
    const s = createStrategy();
    const rng = rngs(3);
    const loot: Goal = { kind: "loot", container: "c1" };
    const t = run(s, rng, NOW, 2 * give, standoff(), loot);
    expect(s.state.avoidId).toBeNull();
    run(s, rng, t, give, standoff(), HUNTING);
    expect(s.state.avoidId).toBe("orbiter");
  });

  it("jitters the limit so the bots do not all turn at once", () => {
    const limits = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) {
      const s = createStrategy();
      decide(s, cfg, { fighters: [foe("orbiter", 400)] }, HUNTING, RUNNING, rngs(seed));
      limits.add(Math.round(s.state.chase!.limit));
    }
    expect(limits.size).toBeGreaterThan(4);
    for (const l of limits) {
      expect(l).toBeGreaterThanOrEqual(persona.chaseGiveUpMs);
      expect(l).toBeLessThanOrEqual(persona.chaseGiveUpMs + ORBIT_JITTER_MS);
    }
  });
});

// ------------------------------------------------------------------------------------------------ the arena and the clock

describe("the coliseum, sudden death and the patience timer", () => {
  const inside = (over: Partial<HudView> = {}): Partial<HudView> => ({ inColiseum: true, gatesLocked: true, alive: 4, patienceEndsAt: 0, ...over });
  const ring: Scene = {
    mobs: [mobMem("m1", 400)], // a mob remembered from outside: there is nothing to farm in here
    fighters: [foe("strong", 320, { hpFrac: 0.9 }), foe("weak", 420, { hpFrac: 0.3 })],
    hud: inside(),
  };

  it("never farms inside: only players remain", () => {
    for (const persona of ["farmer", "hunter", "opportunist", "cautious"] as const) {
      const s = createStrategy();
      decide(s, config("hard", persona), ring);
      expect(kinds(s), persona).not.toContain("farm");
      for (const c of s.state.candidates) if (c.goal.kind === "roam") expect(c.goal.why, persona).toBe("coliseum"); // no camps in here
    }
  });

  it("a bot with coliseum < 0.5 holds a spot on the ring, a bolder one opens on the weakest visible enemy", () => {
    const calm = createStrategy();
    const h = decide(calm, config("hard", "cautious"), { ...ring, fighters: [foe("a", 320), foe("b", 420)] });
    expect(h.goal.kind).toBe("hold");
    if (h.goal.kind === "hold") {
      expect(h.goal.why).toBe("coliseum");
      const spot = h.goal.at;
      const spots = [...testMap().coliseum.innerSpawns, { x: ME.x, y: ME.y }];
      expect(spots.some((p) => p.x === spot.x && p.y === spot.y)).toBe(true);
    }
    expect(decide(createStrategy(), config("hard", "farmer"), { ...ring, fighters: [foe("a", 320), foe("b", 420)] }).goal.kind).toBe("hold");
    for (const persona of ["hunter", "opportunist"] as const) {
      expect(decide(createStrategy(), config("hard", persona), ring).goal, persona).toEqual({ kind: "hunt", target: "weak" });
    }
  });

  it("holds the same spot while it stays clear of the others, and does not wait for a fight that cannot happen", () => {
    const cfg = config("hard", "cautious");
    const s = createStrategy();
    const first = decide(s, cfg, { ...ring, fighters: [foe("a", 400)] });
    expect(first.goal.kind).toBe("hold");
    const again = decide(s, cfg, { ...ring, fighters: [foe("a", 400)], now: NOW + 1500 }, first.goal);
    expect(again.goal).toEqual(first.goal);
    const duel = createStrategy();
    decide(duel, cfg, { ...ring, hud: inside({ alive: 2 }), fighters: [foe("a", 400)] });
    expect(holdsRing(duel)).toBe(false);
  });

  it("a holder's patience runs out: the longer since the teleport the less waiting is worth, the bolder first, and then it joins the fight", () => {
    const holdU = (persona: PersonaId, since: number): number => {
      const s = createStrategy();
      decide(s, config("hard", persona), { ...ring, fighters: [foe("a", 320), foe("b", 420)], teleportedAt: NOW - since });
      return best(s, "hold") ?? 0;
    };
    expect(holdU("cautious", 20_000)).toBeLessThan(holdU("cautious", 0));
    expect(holdU("cautious", 20_000)).toBeGreaterThan(0);
    expect(holdU("farmer", 38_000)).toBe(0);
    expect(holdU("cautious", 38_000)).toBeGreaterThan(0);
    expect(holdU("cautious", 45_000)).toBe(0);
    const waited = decide(createStrategy(), config("hard", "cautious"), { ...ring, fighters: [foe("a", 320), foe("b", 420)], teleportedAt: NOW - 45_000 });
    expect(waited.goal.kind).toBe("hunt");
  });

  it("a holder joins when it sees two others trading blows", () => {
    const eager = config("hard", personaOf("cautious", { thirdParty: 1 }));
    const a = foe("a", 400);
    const b = foe("b", 460);
    const quiet = decide(createStrategy(), eager, { ...ring, fighters: [a, b] });
    expect(quiet.goal.kind).toBe("hold");
    const brawl = decide(createStrategy(), eager, {
      ...ring, fighters: [a, b],
      memFighters: [fighterMem("a", { engagedWith: "b", engagedAt: NOW - 800 }), fighterMem("b", { engagedWith: "a", engagedAt: NOW - 800 })],
    });
    expect(brawl.goal.kind).toBe("hunt");
  });

  it("with nobody in sight it goes to the middle of the ring, and hunts one it saw a moment ago", () => {
    const hunter = config("hard", "hunter");
    const mid = testMap().coliseum.centre;
    const far = { x: mid.x + 600, y: mid.y };
    const lost = decide(createStrategy(), hunter, { ...ring, fighters: [], mobs: [], self: { x: far.x, y: far.y } });
    expect(lost.goal).toEqual({ kind: "roam", to: { x: mid.x, y: mid.y }, why: "coliseum" });
    const remembered = decide(createStrategy(), hunter, {
      ...ring, fighters: [], mobs: [], self: { x: far.x, y: far.y }, memFighters: [fighterMem("ghost", { seenAt: NOW - 2000 })], whereabouts: { ghost: { x: mid.x, y: mid.y } },
    });
    expect(remembered.goal).toEqual({ kind: "hunt", target: "ghost" });
  });

  it("ignores a fighter that is still immune from the teleport", () => {
    const s = createStrategy();
    decide(s, config("hard", "hunter"), { ...ring, fighters: [foe("sleeper", 300, { immune: true })] });
    expect(kinds(s)).not.toContain("hunt");
  });

  it("once sudden death has begun, nobody holds and the nearest weak target is hunted", () => {
    for (const persona of ["farmer", "cautious", "hunter"] as const) {
      const s = createStrategy();
      const d = decide(s, config("hard", persona), { ...ring, hud: inside({ suddenDeathAt: NOW - 1000 }), fighters: [foe("strong", 250, { hpFrac: 0.9 }), foe("weak", 300, { hpFrac: 0.3 })] });
      expect(holdsRing(s), persona).toBe(false);
      expect(d.goal, persona).toEqual({ kind: "hunt", target: "weak" });
    }
    // The sudden death clock that has not struck yet changes nothing.
    const early = createStrategy();
    decide(early, config("hard", "farmer"), { ...ring, hud: inside({ suddenDeathAt: NOW + 20_000 }) });
    expect(holdsRing(early)).toBe(true);
  });

  it("drifts toward the coliseum when the patience timer is under 20 s, not before", () => {
    const outside = (left: number): Scene => ({ hud: { patienceEndsAt: NOW + left } });
    const s = createStrategy();
    decide(s, config("hard", "cautious"), outside(10_000));
    const dash = s.state.candidates.find((c) => c.goal.kind === "roam" && c.goal.why === "coliseum");
    expect(dash).toBeDefined();
    const centre = testMap().coliseum.centre;
    if (dash?.goal.kind === "roam") expect(dash.goal.to).toEqual({ x: centre.x, y: centre.y });
    const early = createStrategy();
    decide(early, config("hard", "cautious"), outside(100_000));
    expect(early.state.candidates.some((c) => c.goal.kind === "roam" && c.goal.why === "coliseum")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------ the rest

describe("roaming and looting", () => {
  it("heads for a camp when the hunt finds no mob in reach, and carries the opener key", () => {
    const cfg = config("hard", "farmer");
    const s = createStrategy();
    const d = decide(s, cfg, {});
    // The patrol's walk ("looking for people", no opener) is a roam to a camp too; on the seed-7 zone map it picks a camp (the
    // fire elite next to the default self) that the camp roam skips, so the two no longer merge into one candidate.
    const camps = s.state.candidates.filter((c) => c.goal.kind === "roam" && (c.goal.why === "explore" || c.goal.why === "camp")
      && !c.why.startsWith("looking for people"));
    expect(camps.length).toBeGreaterThan(0);
    for (const c of camps) expect(c.choice).toMatch(/^opener\|fire\|(sentenced|fire|frost)$/);
    expect(["roam", "farm"]).toContain(d.goal.kind);
    // Enough mobs killed: it stops looking for more.
    const full = createStrategy();
    decide(full, cfg, { self: { mobKills: cfg.persona.mobKillGoal } });
    expect(full.state.candidates.some((c) => c.goal.kind === "roam" && c.choice !== undefined)).toBe(false); // patrolling has no opener to learn
  });

  it("does not walk to a camp its weapons cannot work on or that the mob hunt never takes (ranged mobs)", () => {
    const cfg = config("hard", "farmer");
    const s = createStrategy();
    decide(s, cfg, {});
    const zones = s.state.candidates.flatMap((c) => (c.goal.kind === "roam" && c.choice ? [c.choice.split("|")[2]] : []));
    expect(zones).not.toContain("plague"); // bow mobs
    expect(zones).not.toContain("holy"); // wand mobs
    expect(zones).not.toContain("frost"); // a sword is useless against a shield
  });

  it("skips a camp it saw cleared", () => {
    const cfg = config("hard", "farmer");
    const probe = createStrategy();
    decide(probe, cfg, {});
    const camp = testMap().camps.find((c) => c.id !== undefined && probe.state.candidates.some((d) => d.goal.kind === "roam" && d.goal.why !== "centre" && d.goal.to.x === c.x && d.goal.to.y === c.y))!;
    expect(camp).toBeDefined();
    const s = createStrategy();
    const ctx0 = scene(cfg, {});
    const camps = new Map([[camp.id, { id: camp.id, zone: camp.zone, elite: camp.eliteSpot >= 0, aliveSeen: 0, clearedAt: NOW - 5000, contestedAt: null, visitedAt: NOW - 9000 }]]);
    s.decide({ ...ctx0, mem: { ...ctx0.mem, camps } }, IDLE, RUNNING);
    expect(s.state.candidates.some((d) => d.goal.kind === "roam" && d.goal.to.x === camp.x && d.goal.to.y === camp.y)).toBe(false);
  });

  it("walks toward where a bountied player was last seen, and only a Hunter-minded bot chases an unmarked one", () => {
    const seenLongAgo = (bounty: number): Scene => ({
      now: NOW + 40_000, memFighters: [fighterMem("rat", { bounty, seenAt: NOW, pos: at(900) })], whereabouts: { rat: at(900) },
    });
    const hunter = createStrategy();
    decide(hunter, config("hard", "hunter"), seenLongAgo(40));
    const roam = hunter.state.candidates.find((c) => c.goal.kind === "roam" && c.goal.why === "lastSeen");
    expect(roam?.goal).toEqual({ kind: "roam", to: at(900), why: "lastSeen" });
    const farmer = createStrategy();
    decide(farmer, config("hard", "farmer"), seenLongAgo(0));
    expect(farmer.state.candidates.some((c) => c.goal.kind === "roam" && c.goal.why === "lastSeen")).toBe(false);
  });

  it("goes for a loose weapon when it carries one, not when it carries two unless the weapon counters something", () => {
    const cfg = config("hard", "opportunist");
    const bow = container({ id: "bow", kind: "ground", weapon: "bow", x: ME.x + 100 });
    const one = createStrategy();
    expect(decide(one, cfg, { containers: [bow] }).goal).toEqual({ kind: "loot", container: "bow" });
    const two = createStrategy();
    decide(two, cfg, { self: { weapons: ["sword", "shield"] }, containers: [bow] });
    expect(kinds(two)).not.toContain("loot");
    // A rival seen with an axe: the bow beats it and is better than the sword in hand and the shield (neither counters it).
    const rival = fighterMem("rival", { faction: "fire", inHand: "axe", weaponsSeen: ["axe"], alive: true, pos: at(2000) });
    const counters = createStrategy();
    decide(counters, cfg, { self: { weapons: ["wand", "shield"] }, containers: [bow], memFighters: [rival], whereabouts: { rival: at(2000) } });
    expect(kinds(counters)).toContain("loot");
  });

  it("skips weapons it already holds, empty containers, given-up ones, and weapons somebody else is nearer to", () => {
    const cfg = config("hard", "opportunist");
    const s = createStrategy();
    decide(s, cfg, {
      containers: [
        container({ id: "same", kind: "ground", weapon: "sword", x: ME.x + 60 }),
        container({ id: "empty", kind: "ground", weapon: null, x: ME.x + 70 }),
        container({ id: "shut", kind: "ground", weapon: "bow", closed: false, x: ME.x + 80 }),
      ],
    });
    expect(kinds(s)).not.toContain("loot");
    const raced = createStrategy();
    decide(raced, cfg, { containers: [container({ id: "c", kind: "ground", weapon: "bow", x: ME.x + 200 })], fighters: [foe("quick", 380)] });
    expect(kinds(raced)).not.toContain("loot");
    const skipped = createStrategy();
    const c0 = scene(cfg, { containers: [container({ id: "c", kind: "ground", weapon: "bow", x: ME.x + 100 })] });
    skipped.decide({ ...c0, mem: { ...c0.mem, containers: new Map([["c", { id: "c", kind: "ground", pos: at(100), closed: true, weapon: "bow", seenAt: NOW, skipped: true }]]) } }, IDLE, RUNNING);
    expect(kinds(skipped)).not.toContain("loot");
  });

  it("leaves weapons alone with an enemy close or while fighting, and gives up on one that failed", () => {
    const cfg = config("hard", "opportunist");
    const bow = container({ id: "bow", kind: "ground", weapon: "bow", x: ME.x + 100 });
    const near = createStrategy();
    decide(near, cfg, { containers: [bow], fighters: [foe("close", -200)] });
    expect(kinds(near)).not.toContain("loot");
    const busy = createStrategy();
    decide(busy, cfg, { containers: [bow], engaged: true });
    expect(kinds(busy)).not.toContain("loot");
    const s = createStrategy();
    const loot: Goal = { kind: "loot", container: "bow" };
    decide(s, cfg, { containers: [bow] }, loot, { state: "failed", why: "too far" });
    decide(s, cfg, { containers: [bow], now: NOW + 20_000 }, IDLE);
    expect(kinds(s)).not.toContain("loot"); // not for 30 s
  });

  it("gives up a weapon detour that takes too long", () => {
    const cfg = config("hard", "opportunist");
    const bow = container({ id: "bow", kind: "ground", weapon: "bow", x: ME.x + 100 });
    const s = createStrategy();
    const loot: Goal = { kind: "loot", container: "bow" };
    decide(s, cfg, { containers: [bow] }, loot);
    decide(s, cfg, { containers: [bow], now: NOW + 9000 }, loot);
    expect(kinds(s)).not.toContain("loot");
  });

  it("with nothing else to do it looks for people at the camp it has seen least recently", () => {
    const cfg = config(sharp(), "hunter");
    const done = { mobKills: cfg.persona.mobKillGoal }; // enough mobs: no camp to farm
    const visited = (age: (i: number) => number | null) => new Map(testMap().camps.map((c, i) => [c.id, {
      id: c.id, zone: c.zone, elite: c.eliteSpot >= 0, aliveSeen: 3, clearedAt: null, contestedAt: null, visitedAt: age(i) === null ? null : NOW - age(i)!,
    }]));
    const run = (camps: ReturnType<typeof visited>) => {
      const s = createStrategy();
      const c0 = scene(cfg, { self: done });
      return s.decide({ ...c0, mem: { ...c0.mem, camps } }, IDLE, RUNNING);
    };
    // Camp 7 was visited long ago, all the others a moment ago: that one it is.
    const stale = run(visited((i) => (i === 7 ? 100_000 : 1000)));
    expect(stale.goal).toEqual({ kind: "roam", to: { x: testMap().camps[7]!.x, y: testMap().camps[7]!.y }, why: "explore" });
    // Every camp visited lately: back to the map centre.
    expect(run(visited(() => 1000)).goal).toMatchObject({ kind: "roam", why: "centre" });
  });

  it("waits where it stands when it is at the map centre and there is nowhere left to look", () => {
    const cfg = config(sharp(), "hunter");
    const mid = { x: (testMap().w * 32) / 2, y: (testMap().h * 32) / 2 };
    const camps = new Map(testMap().camps.map((c) => [c.id, { id: c.id, zone: c.zone, elite: false, aliveSeen: 3, clearedAt: null, contestedAt: null, visitedAt: NOW - 1000 }]));
    const c0 = scene(cfg, { self: { mobKills: cfg.persona.mobKillGoal, x: mid.x, y: mid.y } });
    const d = createStrategy().decide({ ...c0, mem: { ...c0.mem, camps } }, IDLE, RUNNING);
    expect(d.goal).toMatchObject({ kind: "hold", why: "wait" });
  });

  it("renews a flee when its leg runs out while the threat is still on it", () => {
    const cfg = config("hard", "cautious");
    const s = createStrategy();
    const scn: Scene = { self: { hp: 30, maxHp: 100 }, fighters: [foe("rival", 250)] };
    const first = decide(s, cfg, scn);
    const next = decide(s, cfg, { ...scn, now: NOW + 3000 }, first.goal, { state: "done", why: "ran" });
    expect(next.goal.kind).toBe("flee");
  });

  it("scores the goals of enabled modules and never calls a disabled one", () => {
    let calls = 0;
    const off: FeatureModule = { id: "off", enabled: () => false, goals: () => { calls++; return [{ goal: modGoal(9), utility: 5, why: "x" }]; } };
    const on = offers({ n: 1, utility: 0.99 });
    const d = decide(createStrategy(), config(sharp(), "hunter", { modules: [off, on] }), {});
    expect(calls).toBe(0);
    expect(d.goal).toEqual(modGoal(1));
  });
});

// ------------------------------------------------------------------------------------------------------ the hunt adapter

describe("the hunt adapter feeds mobHunt from the percept and the memory (docs/BOTS.md 3.6)", () => {
  const cfgFor = (persona: PersonaId = "farmer", tier: TierId = "hard") => config(tier, persona);

  it("gives each bot its own MobHuntConfig: the persona's thresholds and the tier's route", () => {
    const c = huntConfigFor(config("normal", "cautious"));
    expect(c.killGoal).toBe(PERSONAS.cautious.mobKillGoal);
    expect(c.retreatHp).toBe(PERSONAS.cautious.fleeHp);
    expect(c.playerThreat).toBe(PERSONAS.cautious.playerThreat);
    expect(c.reach).toBe(TIERS.normal.route.reach);
    expect(c.firstReach).toBeCloseTo(1.6 * TIERS.normal.route.reach, 9);
    expect(c.maxCandidates).toBe(TIERS.normal.route.horizon);
    // The tier's caution: which mobs it takes (the matchup share) and the hp it starts a mob fight at, lowered by a persona that likes mobs.
    expect(c.mobMinShare).toBe(TIERS.normal.caution.mobShare);
    expect(c.eliteMinShare).toBe(TIERS.normal.caution.eliteShare);
    expect(c.startMinHp).toBeCloseTo(Math.max(PERSONAS.cautious.fleeHp + 0.05, TIERS.normal.caution.startHp - 0.25 * PERSONAS.cautious.pve), 9);
    expect(huntConfigFor(config("normal", "farmer")).startMinHp).toBeLessThan(huntConfigFor(config("normal", "hunter")).startMinHp + 1e-9);
    expect(huntConfigFor(config("hard", "farmer")).mobMinShare).toBeGreaterThan(huntConfigFor(config("easy", "farmer")).mobMinShare);
    // The rest is mobHunt's.
    expect(c.focusBudgetMs).toBe(MOB_HUNT.focusBudgetMs);
    // A fight is not started at an hp that would retreat from it at once.
    expect(c.startMinHp).toBeGreaterThan(PERSONAS.cautious.fleeHp);
    expect(huntConfigFor(config("hard", "hunter")).playerRelease).toBeGreaterThan(PERSONAS.hunter.playerThreat);
  });

  it("builds a mob from memory: maxHp is the region's scaled hp, hp the last share seen", () => {
    const like = mobLikeOf(mobMem("m", 100, { hpFrac: 0.5, faction: "sentenced", kind: "elite" }))!;
    expect(like.maxHp).toBeGreaterThan(0);
    expect(like.hp).toBeCloseTo(like.maxHp * 0.5, 9);
    expect(like.kind).toBe("elite");
    expect(like.status).toBe("alive");
    expect(mobLikeOf(mobMem("m", 100, { alive: false }))!.status).toBe("dead");
    expect(mobLikeOf(mobMem("m", 100, { kind: "dummy" }))).toBeNull();
  });

  it("picks a mob in reach, and says 'no mob in reach' when there is none", () => {
    const a = createHuntAdapter(cfgFor());
    expect(a.decide(scene(cfgFor(), { mobs: [mobMem("m1", 400)] }))).toMatchObject({ kind: "mob", id: "m1" });
    const b = createHuntAdapter(cfgFor());
    const none = b.decide(scene(cfgFor(), {}));
    expect(none).toEqual({ kind: "player", why: NO_MOB_IN_REACH });
    expect(wantsMobs(none)).toBe(true);
  });

  it("a player close by wins over the mob; one behind a wall counts as twice as far", () => {
    const cfg = cfgFor("farmer"); // playerThreat 250
    const mobs = [mobMem("m1", 600)];
    const close = createHuntAdapter(cfg).decide(scene(cfg, { mobs, fighters: [foe("p", -200)] }));
    expect(close).toMatchObject({ kind: "player", why: "a player is close" });
    expect(wantsMobs(close)).toBe(false);
    const walled = createHuntAdapter(cfg).decide(scene(cfg, { mobs, fighters: [foe("p", -200, { los: false })] }));
    expect(walled).toMatchObject({ kind: "mob", id: "m1" });
  });

  it("a player who hit the bot lately counts as shooting at it (shotByPlayerAt from memory)", () => {
    const cfg = cfgFor("farmer");
    const mobs = [mobMem("m1", 600)];
    const shot = createHuntAdapter(cfg).decide(scene(cfg, { mobs, fighters: [foe("p", -400)], lastHitByPlayerAt: NOW - 500 }));
    expect(shot).toMatchObject({ kind: "player" });
    const quiet = createHuntAdapter(cfg).decide(scene(cfg, { mobs, fighters: [foe("p", -400)], lastHitByPlayerAt: NOW - 5000 }));
    expect(quiet).toMatchObject({ kind: "mob" });
  });

  it("counts a player seen in the last 5 s as one that is there (it contests a mob), and forgets it after that", () => {
    const cfg = cfgFor("farmer");
    const mobs = [mobMem("near", 500), mobMem("far", 500, { pos: at(0, 520), home: at(0, 520) })];
    // A rival stands just behind "near": the other mob is the safer meal. `contest` only bites when a player is closer to the mob.
    const rival = (seenAt: number) => ({ memFighters: [fighterMem("rival", { seenAt, pos: at(560) })], whereabouts: { rival: at(560) } });
    const pick = (age: number) => createHuntAdapter(cfg).decide(scene(cfg, { mobs, ...rival(NOW - age) }));
    expect(pick(3000)).toMatchObject({ kind: "mob", id: "far" });
    expect(pick(8000)).toMatchObject({ kind: "mob", id: "near" });
  });

  it("a mob that leaves the screen never heals: its hp stays the last share seen, so it is not read as walking home", () => {
    const cfg = cfgFor("farmer");
    const a = createHuntAdapter(cfg);
    const hurt = mobMem("m1", 400, { hpFrac: 0.4 });
    expect(a.decide(scene(cfg, { mobs: [hurt] }))).toMatchObject({ kind: "mob", id: "m1" });
    // Many thinks later it is off screen: memory still says 40%.
    for (let i = 1; i <= 6; i++) {
      const d = a.decide(scene(cfg, { mobs: [{ ...hurt, seenAt: NOW - 1000 * i }], now: NOW + 1500 * i }));
      expect(d).toMatchObject({ kind: "mob", id: "m1" });
    }
    expect(a.hunter.tracker.returning("m1", NOW + 9000)).toBe(false);
    expect(a.stats.drops).toBe(0);
  });

  it("a mob whose hp is seen rising is walking home and is dropped, and one memory marks as returning is not in the hunt at all", () => {
    const cfg = cfgFor("farmer");
    const a = createHuntAdapter(cfg);
    a.decide(scene(cfg, { mobs: [mobMem("m1", 400, { hpFrac: 0.4 })] }));
    const healing = a.decide(scene(cfg, { mobs: [mobMem("m1", 400, { hpFrac: 0.6 })], now: NOW + 500 }));
    expect(healing.kind).toBe("player");
    expect(a.stats.drops).toBe(1);
    const b = createHuntAdapter(cfg);
    expect(b.decide(scene(cfg, { mobs: [mobMem("m1", 400, { returning: true })] }))).toMatchObject({ kind: "player" });
  });

  it("runs the hunt's timers at the pace of the clock although it is asked only every second or so", () => {
    const cfg = cfgFor("farmer");
    const a = createHuntAdapter(cfg, { attacking: () => true });
    const mobs = [mobMem("m1", 100)];
    let t = NOW;
    let drops = 0;
    for (let i = 0; i < 6 && drops === 0; i++, t += 1200) {
      a.decide(scene(cfg, { mobs, now: t }));
      drops = a.stats.drops;
    }
    // Attacking for 3 s without the mob losing hp ("attacks do not hurt it") ends in a drop within a few thinks.
    expect(drops).toBe(1);
    expect(t - NOW).toBeLessThanOrEqual(5 * 1200);
  });

  it("lets go of the mob when the strategy chooses something else", () => {
    const cfg = cfgFor("hunter");
    const s = createStrategy();
    const mobScene: Scene = { mobs: [mobMem("m1", 400)] };
    decide(s, cfg, mobScene); // the hunter would rather hunt, but with no player in sight it farms
    expect(s.state.candidates.some((c) => c.goal.kind === "farm")).toBe(true);
    const offerMod = config("hard", "hunter", { modules: [offers({ n: 1, utility: 1.2 })] });
    const t = createStrategy();
    expect(decide(t, offerMod, mobScene).goal).toEqual(modGoal(1));
    // The strategy's hunt no longer holds the mob as its target.
    expect(t.huntTarget).toBeNull();
    const farming = createStrategy();
    decide(farming, cfg, mobScene);
    expect(farming.huntTarget).toBe("m1");
  });

  it("walks by straight line x 1.3 for a tier that does not path, and asks the path service otherwise", () => {
    let asked = 0;
    const counting: PathService = { ...openPaths, walk: (a, b) => { asked++; return openPaths.walk(a, b); } };
    const easy = config("easy", "farmer", { services: { paths: counting, log: () => {} } });
    createHuntAdapter(easy).decide(scene(easy, { mobs: [mobMem("m1", 400)] }));
    expect(asked).toBe(0);
    asked = 0;
    const normal = config("normal", "farmer", { services: { paths: counting, log: () => {} } });
    createHuntAdapter(normal).decide(scene(normal, { mobs: [mobMem("m1", 400)] }));
    expect(asked).toBeGreaterThan(0);
  });

  it("only the farm goal carries the first camp as the opener choice", () => {
    const s = createStrategy();
    const d = decide(s, config("hard", "farmer"), { mobs: [mobMem("m1", 400, { faction: "sentenced", campId: "sentenced-2" })] });
    expect(d.goal).toEqual({ kind: "farm", mob: "m1", camp: "sentenced-2" });
    expect(d.choice).toBe("opener|fire|sentenced");
    const again = decide(s, config("hard", "farmer"), { mobs: [mobMem("m1", 400, { faction: "sentenced", campId: "sentenced-2" })], now: NOW + 1500 }, d.goal);
    expect(again.choice).toBeUndefined();
  });

  it("is told what tactics is doing through the attacking getter, not guessed", () => {
    // Without a getter and without a lock the stall timer reads 'approaching': a mob that cannot be reached is dropped at 12 s.
    const cfg = cfgFor("farmer");
    const a = createHuntAdapter(cfg);
    const mobs = [mobMem("m1", 100)];
    let t = NOW;
    for (let i = 0; i < 6; i++, t += 1200) a.decide(scene(cfg, { mobs, now: t }));
    expect(a.stats.drops).toBe(0);
  });
});
