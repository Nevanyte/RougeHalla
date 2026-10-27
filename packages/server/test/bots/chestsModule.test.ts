// The chests module (brain/modules/chests.ts, docs/BOTS.md 8): how a bot treats a cleared camp's shared reward chest. Perception's
// rule for what a chest shows (the minimap: place and seconds, map-wide; the panel: the cards, within pick range and in sight), the
// module's picks and its walks on synthetic percepts, a whole brain walking to a chest and taking a card, and whole headless games.
import { describe, expect, it } from "vitest";
import {
  CHEST_PANEL_SLACK, CHEST_RANGE, CHEST_SECONDS, EFFECT_CASTING, EFFECT_STUNNED, hasLineOfSight, PLAYER_SPEED, TICK_MS, TILE,
  type Vec2,
} from "@raid/shared";
import { createBrain } from "../../src/bots/brain/brain";
import { CHEST_HUNT, chooseOption } from "../../src/bots/chestHunt";
import { createFrameRing } from "../../src/bots/brain/frames";
import { createHumanizer } from "../../src/bots/brain/humanizer";
import { enabledModules } from "../../src/bots/brain/modules/index";
import { CHEST_RULES, chestsModule } from "../../src/bots/brain/modules/chests";
import { perceive, type PerceptionInput, type StateLike } from "../../src/bots/brain/perception";
import {
  BOT_FILL_DEFAULTS, TIERS,
  type BrainConfig, type Command, type FighterView, type Goal, type Intent, type MemoryView, type MobMemory, type PersonaId, type RewardChestView,
  type Stimulus, type TierId, type TimedCommand,
} from "../../src/bots/brain/types";
import { createHeadlessRoom } from "../../src/bots/tournament/headlessRoom";
import {
  FRAME_MS, plainContainer, plainPlayer, plainState, T0 as KIT_T0, toSchemaState,
} from "./fairnessKit";
import { brainConfig, ctx as makeCtx, emptyMemory, features, fighter, hudView, pathService, percept, rngs, selfView, testMap } from "./fixtures";

const CHEST_FEATURES = features({ messageTypes: ["move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "choose"], chests: true, camps: true });
const IDLE: Goal = { kind: "idle" };
const NOW = 200_000;
const PICK = CHEST_HUNT.pickRange;
const CARDS = ["whetstone", "swiftBoots", "thickHide"] as const;

/** The longest straight, walkable run of the cave-like test map that is at least this long (u). */
const RUN = 410;

/** Where the bot stands and which way a chest lies: open floor with RUN u of clear, direct line one way. */
function openSpot(): { spot: Vec2; dir: Vec2 } {
  const map = testMap();
  const paths = pathService(map);
  for (let ty = 2; ty < map.h - 2; ty++) {
    for (let tx = 2; tx < map.w - 2; tx++) {
      const a = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      for (const dir of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]) {
        const b = { x: a.x + dir.x * RUN, y: a.y + dir.y * RUN };
        if (paths.clear(a, b) && paths.walk(a, b)!.dist < RUN + 30) return { spot: a, dir };
      }
    }
  }
  throw new Error("no open spot on the test map");
}
const { spot: SPOT, dir: DIR } = openSpot();
const ME = selfView({ x: SPOT.x, y: SPOT.y, faction: "fire", weapons: ["sword", null], hp: 100, maxHp: 100 });
/** The point `d` u from the bot's spot along the open run. */
const along = (d: number): Vec2 => ({ x: SPOT.x + DIR.x * d, y: SPOT.y + DIR.y * d });

/** A chest `d` u along the run, 12 s to live; its cards shut unless `open` (as perception hands it over). */
function chest(id: string, d: number, over: Partial<RewardChestView> & { open?: boolean } = {}): RewardChestView {
  const { open = d <= PICK, ...rest } = over;
  return {
    id, ...along(d), expiresAt: NOW + 12_000, options: open ? [...CARDS] : null, takenBy: open ? ["", "", ""] : [], picked: false, ...rest,
  };
}

interface Scene {
  cfg?: BrainConfig;
  now?: number;
  chests?: RewardChestView[];
  tier?: TierId;
  persona?: PersonaId;
  hp?: number;
  bits?: number;
  fighters?: FighterView[];
  engaged?: boolean;
  mobs?: MobMemory[];
  stimuli?: Stimulus[];
  inColiseum?: boolean;
  at?: Vec2;
}

function mobMemory(over: Partial<MobMemory> = {}): MobMemory {
  return { id: "m1", kind: "mob", faction: "fire", home: null, campId: null, pos: along(100), dotAt: NOW, seenAt: NOW, hpFrac: 1, inHand: "axe", awake: true, returning: false, alive: true, ...over };
}

function scene(s: Scene = {}): ReturnType<typeof makeCtx> {
  const cfg = s.cfg ?? brainConfig(s.tier ?? "hard", s.persona ?? "farmer", { seed: 1, features: CHEST_FEATURES, modules: [chestsModule] });
  const now = s.now ?? NOW;
  const base = emptyMemory();
  const mem: MemoryView = { ...base, stimuli: s.stimuli ?? [], mobs: new Map((s.mobs ?? []).map((m) => [m.id, m])) };
  const self = { ...ME, ...(s.at ?? {}), hp: s.hp ?? 100 };
  return makeCtx({
    cfg, mem, rng: rngs(cfg.seed), engaged: s.engaged ?? false,
    p: percept({
      now, self, hud: hudView({ phase: "active", inColiseum: s.inColiseum ?? false }), features: CHEST_FEATURES, fighters: s.fighters ?? [],
      extras: { chests: s.chests ?? [], effects: { [self.id]: s.bits ?? 0 } },
    }),
  });
}

/** One module call for a scene: observe, then the intents of a goal. Pass the same `cfg` to keep a bot's state between calls. */
function intentsOf(s: Scene, goal: Goal = IDLE): readonly Intent[] {
  const c = scene(s);
  chestsModule.observe!(c);
  return chestsModule.intents!(c, goal);
}
const goalsOf = (s: Scene) => {
  const c = scene(s);
  chestsModule.observe!(c);
  return chestsModule.goals!(c);
};
const chooses = (list: readonly Intent[]): Extract<Intent, { kind: "choose" }>[] => list.filter((i): i is Extract<Intent, { kind: "choose" }> => i.kind === "choose");

const cfgFor = (tier: TierId = "hard", persona: PersonaId = "farmer", seed = 1): BrainConfig =>
  brainConfig(tier, persona, { seed, features: CHEST_FEATURES, modules: [chestsModule] });

// =============================================================================================== what perception shows of a chest

describe("what a bot sees of a reward chest (perception)", () => {
  const map = testMap();
  const SELF: Vec2 = { x: SPOT.x, y: SPOT.y };

  function view(chests: Array<Parameters<typeof plainContainer>[0]>, over: { selfAt?: Vec2; status?: string; gatesLocked?: boolean; feats?: typeof CHEST_FEATURES } = {}): ReturnType<typeof perceive> {
    const state = plainState({ serverTime: KIT_T0, camps: map.camps.map((c, i) => ({ type: "emberImp", reward: "", alive: 3 - (i % 3), state: i % 3 })), gatesLocked: over.gatesLocked ?? false });
    const at = over.selfAt ?? SELF;
    state.players.set("me", plainPlayer({ name: "Me", x: at.x, y: at.y, faction: "fire", ...(over.status ? { status: over.status } : {}) }));
    state.players.set("p1", plainPlayer({ name: "P1", x: at.x - DIR.x * 100, y: at.y - DIR.y * 100 }));
    state.players.set("far", plainPlayer({ name: "Far", x: at.x + 3000, y: at.y + 2000 }));
    for (const c of chests) state.containers.set(c.id, plainContainer(c));
    state.roster = ["me", "p1", "far"];
    return perceive({ state }, { selfId: "me", map, features: over.feats ?? CHEST_FEATURES, lastMinimap: null });
  }
  const reward = (id: string, d: number, over: Partial<Parameters<typeof plainContainer>[0]> = {}) => ({
    id, kind: "reward", ...along(d), camp: 3, expiresAt: KIT_T0 + 9000, options: [...CARDS], takenBy: ["", "far", "me"], pickers: ["far", "me"], ...over,
  });

  it("every chest that is up is known wherever it stands, with its seconds: the minimap draws them all", () => {
    const f = view([reward("near", 40), reward("midmap", 1500), reward("faraway", 5200, { expiresAt: KIT_T0 + 3000 })]);
    expect(f.extras.chests!.map((c) => [c.id, c.expiresAt])).toEqual([["faraway", KIT_T0 + 3000], ["midmap", KIT_T0 + 9000], ["near", KIT_T0 + 9000]]);
  });

  it("the cards, and which are taken, only within pick range (CHEST_RANGE less the panel's slack) and in sight", () => {
    const edge = CHEST_RANGE - CHEST_PANEL_SLACK;
    const f = view([reward("in", edge - 0.5), reward("out", edge + 0.5), reward("away", 400)]);
    const by = Object.fromEntries(f.extras.chests!.map((c) => [c.id, c]));
    expect(by["in"]!.options).toEqual([...CARDS]);
    expect(by["out"]).toMatchObject({ options: null, takenBy: [] });
    expect(by["away"]).toMatchObject({ options: null, takenBy: [] });
  });

  it("not through a wall: a chest within range with no line of sight shows no cards", () => {
    // Somewhere in the map a point within 80 u of another with a wall between them.
    let pair: [Vec2, Vec2] | null = null;
    for (let ty = 2; ty < map.h - 2 && !pair; ty++) {
      for (let tx = 2; tx < map.w - 4 && !pair; tx++) {
        const a = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
        for (const d of [{ x: 60, y: 0 }, { x: 0, y: 60 }, { x: 56, y: 56 }]) {
          const b = { x: a.x + d.x, y: a.y + d.y };
          if (!pathService(map).walk(a, a) || hasLineOfSight(map, a, b)) continue;
          // b must be open ground (a chest stands on a floor tile).
          if (pathService(map).walk(b, b)) { pair = [a, b]; break; }
        }
      }
    }
    expect(pair, "the test map has a wall between two points 60 u apart").not.toBeNull();
    const [a, b] = pair!;
    const f = view([reward("behind", 0, { x: b.x, y: b.y })], { selfAt: a });
    expect(f.extras.chests![0]).toMatchObject({ id: "behind", options: null });
    const open = view([reward("clear", 0, { x: a.x + 20, y: a.y })], { selfAt: a });
    expect(open.extras.chests![0]!.options).not.toBeNull();
  });

  it("a down bot reads no cards; and the cards of one chest do not leak into another", () => {
    const f = view([reward("c", 30)], { status: "dead" });
    expect(f.extras.chests![0]).toMatchObject({ options: null, takenBy: [] });
    const g = view([reward("a", 30, { options: ["whetstone", "a", "b"] }), reward("b", 60, { options: ["c", "d", "swiftBoots"] })]);
    expect(g.extras.chests!.map((c) => c.options)).toEqual([["whetstone", "a", "b"], ["c", "d", "swiftBoots"]]);
  });

  it("another player's pick is a '?', its own is its id; picked says whether the bot has picked (a skip counts), in range or not", () => {
    const f = view([reward("c", 30, { takenBy: ["p1", "", "me"], pickers: ["p1", "me"] }), reward("away", 700, { pickers: ["me"] }), reward("fresh", 40, { takenBy: ["", "", ""], pickers: ["far"] })]);
    const by = Object.fromEntries(f.extras.chests!.map((c) => [c.id, c]));
    expect(by["c"]).toMatchObject({ takenBy: ["?", "", "me"], picked: true });
    expect(by["away"]).toMatchObject({ takenBy: [], picked: true });
    expect(by["fresh"]).toMatchObject({ takenBy: ["", "", ""], picked: false });
    expect(JSON.stringify(f.extras.chests)).not.toContain("far");
    expect(JSON.stringify(f.extras.chests)).not.toContain("p1");
  });

  it("reads the cards of a chest only when the bot is within pick range of it (the state is read lazily)", () => {
    const reads = new Set<string>();
    const guard = (c: ReturnType<typeof plainContainer>): ReturnType<typeof plainContainer> =>
      new Proxy(c, { get: (t, k, r) => { if (typeof k === "string") reads.add(`${t.id}.${k}`); return Reflect.get(t, k, r); } });
    const state = plainState({ serverTime: KIT_T0 });
    state.players.set("me", plainPlayer({ name: "Me", x: SPOT.x, y: SPOT.y, faction: "fire" }));
    state.containers.set("far", guard(plainContainer(reward("far", 900))));
    state.containers.set("near", guard(plainContainer(reward("near", 40))));
    state.roster = ["me"];
    perceive({ state }, { selfId: "me", map, features: CHEST_FEATURES, lastMinimap: null });
    expect([...reads].filter((r) => r.startsWith("far.") && /options|takenBy/.test(r))).toEqual([]);
    expect([...reads].filter((r) => r.startsWith("near.") && /options|takenBy/.test(r)).length).toBe(2);
  });

  it("the camps are filled in map order with the map's own ids, only on a server that has them", () => {
    const f = view([]);
    expect(f.extras.camps).toHaveLength(map.camps.length);
    expect(f.extras.camps![0]).toEqual({ index: 0, id: map.camps[0]!.id, type: "emberImp", reward: "", alive: 3, state: 0 });
    expect(f.extras.camps!.map((c) => c.state).slice(0, 4)).toEqual([0, 1, 2, 0]);
    const off = view([reward("c", 30)], { feats: features() });
    expect(off.extras.chests).toBeUndefined();
    expect(off.extras.camps).toBeUndefined();
  });

  it("works on the real schema objects (ArraySchema options, takenBy and pickers; RaidState.camps)", () => {
    const state = plainState({ serverTime: KIT_T0, camps: [{ type: "emberImp", reward: "", alive: 2, state: 1 }] });
    state.players.set("me", plainPlayer({ name: "Me", x: SPOT.x, y: SPOT.y, faction: "fire" }));
    state.containers.set("c", plainContainer(reward("c", 30, { takenBy: ["", "", "me"], pickers: ["me"] })));
    state.roster = ["me"];
    const real = toSchemaState(state);
    const a = perceive({ state: real as unknown as StateLike }, { selfId: "me", map, features: CHEST_FEATURES, lastMinimap: null });
    const b = perceive({ state }, { selfId: "me", map, features: CHEST_FEATURES, lastMinimap: null });
    expect(a.extras.chests).toEqual(b.extras.chests);
    expect(a.extras.camps).toEqual([{ index: 0, id: map.camps[0]!.id, type: "emberImp", reward: "", alive: 2, state: 1 }]);
    expect(a.extras.chests![0]).toMatchObject({ options: [...CARDS], takenBy: ["", "", "me"], picked: true });
  });
});

// ================================================================================================================== the pick

describe("the pick: one choose per chest, within reach, whatever the bot is doing", () => {
  it("sends the best free card as a reaction to the panel opening, at combat priority", () => {
    const list = intentsOf({ chests: [chest("rc1", 40)] });
    expect(list).toHaveLength(1);
    const pick = chooses(list)[0]!;
    expect(pick.msg).toEqual({ chest: "rc1", pick: chooseOption(CARDS, ["", "", ""], { faction: "fire", weapons: ["sword", null], build: null }) });
    expect(pick.priority).toBe(1);
    expect(pick.timing).toEqual({ kind: "react", stimulus: { kind: "chestUp", at: NOW, subject: "rc1", central: true } });
  });

  it("whatever it is doing: fighting, farming, fleeing, walking somewhere else", () => {
    for (const goal of [{ kind: "fight", target: "foe" }, { kind: "farm", mob: "m1", camp: null }, { kind: "flee", from: [], until: NOW + 1000 }, { kind: "roam", to: { x: 0, y: 0 }, why: "explore" }] as Goal[]) {
      expect(chooses(intentsOf({ cfg: cfgFor(), chests: [chest("rc1", 40)], engaged: true }, goal)), goal.kind).toHaveLength(1);
    }
  });

  it("asks for the same pick at every think until it shows it picked, then never again", () => {
    const cfg = cfgFor();
    const first = chooses(intentsOf({ cfg, chests: [chest("rc1", 40)] }));
    const again = chooses(intentsOf({ cfg, now: NOW + 100, chests: [chest("rc1", 40)] }));
    expect(again.map((i) => i.msg)).toEqual(first.map((i) => i.msg));
    // The reaction runs from when the cards first opened, not from each think.
    expect((again[0]!.timing as { stimulus: Stimulus }).stimulus.at).toBe(NOW);
    expect(intentsOf({ cfg, now: NOW + 200, chests: [chest("rc1", 40, { picked: true })] })).toEqual([]);
    expect(intentsOf({ cfg, now: NOW + 5000, chests: [chest("rc1", 40, { picked: true })] })).toEqual([]);
  });

  it("skips (-1) when nothing is left it can use: every card taken by others", () => {
    const list = chooses(intentsOf({ chests: [chest("rc1", 40, { takenBy: ["?", "?", "?"] })] }));
    expect(list[0]!.msg).toEqual({ chest: "rc1", pick: -1 });
  });

  it("asks for another card when the one it wanted went first to somebody else, three cards at most, and not after a few seconds", () => {
    const cfg = cfgFor();
    const picks: number[] = [];
    const gone: string[] = ["", "", ""];
    // Each time a card is asked for, somebody else gets it first: the next percept shows it taken.
    for (let k = 0; k < 5; k++) {
      const list = chooses(intentsOf({ cfg, now: NOW + k * 100, chests: [chest("rc1", 40, { takenBy: [...gone] })] }));
      if (!list[0]) continue;
      picks.push(list[0].msg.pick);
      if (list[0].msg.pick >= 0) gone[list[0].msg.pick] = "?";
    }
    expect(picks).toHaveLength(CHEST_RULES.maxAsks);
    expect(new Set(picks).size).toBe(CHEST_RULES.maxAsks);
    expect(picks.every((p) => p >= 0)).toBe(true);
    // Too late: the first ask is older than the window.
    expect(intentsOf({ cfg, now: NOW + CHEST_RULES.askWindowMs + 100, chests: [chest("rc1", 40, { takenBy: ["?", "?", ""] })] })).toEqual([]);
  });

  it("leaves a card the bot holds at the top rank, and keeps count of what it took (the HUD's own record)", () => {
    const cfg = cfgFor();
    const mine = (id: string, cards: string[], took: number) =>
      chest(id, 40, { options: cards, takenBy: ["", "", ""].map((_, i) => (i === took ? "me" : "")), picked: true });
    // Two chests it took whetstone at: the third offers it again, but it holds it at rank 2.
    intentsOf({ cfg, now: NOW, chests: [mine("a", ["whetstone", "x", "y"], 0)] });
    intentsOf({ cfg, now: NOW + 50, chests: [mine("a", ["whetstone", "x", "y"], 0), mine("b", ["whetstone", "swiftBoots", "y"], 0)] });
    const list = chooses(intentsOf({ cfg, now: NOW + 100, chests: [chest("c", 40, { options: ["whetstone", "swiftBoots", "thickHide"] })] }));
    expect(list[0]!.msg.pick, "whetstone is maxed").not.toBe(0);
  });

  it("is silent about a chest whose cards are shut, one it has picked at, one about to vanish, and out of the run", () => {
    expect(intentsOf({ chests: [chest("far", 300)] })).toEqual([]);
    expect(intentsOf({ chests: [chest("c", 40, { options: null })] })).toEqual([]);
    expect(intentsOf({ chests: [chest("c", 40, { expiresAt: NOW + CHEST_HUNT.pickMarginMs })] })).toEqual([]);
    expect(intentsOf({ chests: [chest("c", 40)], inColiseum: true })).toEqual([]);
    expect(chooses(intentsOf({ chests: [chest("c", 40, { expiresAt: NOW + CHEST_HUNT.pickMarginMs + 50 })] }))).toHaveLength(1);
  });

  it("waits out a stun or a cast (the server refuses a pick then, and a refusal is a try spent)", () => {
    expect(intentsOf({ chests: [chest("c", 40)], bits: EFFECT_STUNNED })).toEqual([]);
    expect(intentsOf({ chests: [chest("c", 40)], bits: EFFECT_CASTING })).toEqual([]);
    expect(chooses(intentsOf({ chests: [chest("c", 40)], bits: 0 }))).toHaveLength(1);
  });

  it("takes the nearest of two chests in reach first", () => {
    const list = chooses(intentsOf({ chests: [chest("far", 80), chest("near", 20)] }));
    expect(list[0]!.msg.chest).toBe("near");
  });
});

// ================================================================================================================== the walk

describe("the walk: a module goal to a chest it knows from the minimap", () => {
  const one = (s: Scene) => goalsOf(s)[0];

  it("offers a walk to a chest it can reach in the time it has, and none when it cannot", () => {
    const g = one({ chests: [chest("rc1", 300)] });
    expect(g?.goal).toEqual({ kind: "module", module: "chests", data: { chest: "rc1" } });
    expect(g!.utility).toBeGreaterThan(0);
    // 300 u at 85% of PLAYER_SPEED is about two seconds: gone in one is out of reach, with the arrival slack.
    const walkMs = ((300 - PICK) / (PLAYER_SPEED * CHEST_HUNT.paceShare)) * 1000;
    expect(one({ chests: [chest("rc1", 300, { expiresAt: NOW + walkMs + CHEST_HUNT.arriveSlackMs - 200 })] })).toBeUndefined();
    expect(one({ chests: [chest("rc1", 300, { expiresAt: NOW + walkMs + CHEST_HUNT.arriveSlackMs + 200 })] })).toBeDefined();
  });

  it("goes for the nearest of several, and not for one picked at already or in the coliseum", () => {
    expect(one({ chests: [chest("far", 400), chest("mid", 250)] })?.goal).toMatchObject({ data: { chest: "mid" } });
    expect(one({ chests: [chest("c", 300, { picked: true })] })).toBeUndefined();
    expect(one({ chests: [chest("c", 300)], inColiseum: true })).toBeUndefined();
    expect(goalsOf({ chests: [] })).toEqual([]);
  });

  it("does not look at the cards: a chest in pick range is stayed at for the pick, and a far one is a skill like any other", () => {
    expect(goalsOf({ chests: [chest("rc1", 40)] }).map((g) => g.why)).toEqual(["taking its pick at chest rc1"]);
    // The same far chest, whatever the module could imagine inside it (perception shuts it): the same goal.
    const a = one({ chests: [chest("rc1", 300, { options: null })] });
    const b = one({ chests: [chest("rc1", 300, { options: null, takenBy: [] })] });
    expect(a).toEqual(b);
  });

  it("skips a chest while fighting or with an awake mob close, unless it is within twelve tiles", () => {
    // 8 tiles are within the twelve a fight allows; 400 u (12.5 tiles) are not.
    const near = chest("near", 8 * TILE);
    const far = chest("far", 400);
    for (const fight of [{ engaged: true }, { mobs: [mobMemory()] }, { fighters: [fighter({ id: "foe", ...along(150), dist: 150 })] }] as Scene[]) {
      expect(one({ ...fight, chests: [far] }), JSON.stringify(Object.keys(fight))).toBeUndefined();
      expect(one({ ...fight, chests: [near] }), JSON.stringify(Object.keys(fight))).toBeDefined();
    }
    // A mob that sleeps, or is a long way off, is not a fight.
    expect(one({ mobs: [mobMemory({ awake: false })], chests: [far] })).toBeDefined();
    expect(one({ mobs: [mobMemory({ pos: along(900) })], chests: [far] })).toBeDefined();
  });

  it("never walks to a chest while fleeing or too hurt to be walking", () => {
    const cfg = cfgFor("hard", "farmer");
    const chests = [chest("rc1", 300)];
    expect(one({ cfg, chests, hp: 100 })).toBeDefined();
    expect(one({ cfg, chests, hp: 100 * (cfg.persona.fleeHp - 0.05) })).toBeUndefined();
    // The brain's current goal is a flee: the module learns it from the intents call of the same think.
    const c = scene({ cfg, chests });
    chestsModule.observe!(c);
    chestsModule.intents!(c, { kind: "flee", from: [], until: NOW + 1000 });
    expect(chestsModule.goals!(c)).toEqual([]);
    chestsModule.intents!(c, IDLE);
    expect(chestsModule.goals!(c)).toHaveLength(1);
  });

  it("is worth more to a bot that lives for loot, more when it is near, more to the crowd-minded when somebody stands at it, and never above a fight", () => {
    const at = (persona: PersonaId, d = 300, more: Partial<Scene> = {}) => one({ cfg: cfgFor("hard", persona), chests: [chest("rc1", d)], ...more })!.utility;
    expect(at("opportunist")).toBeGreaterThan(at("farmer"));
    expect(at("farmer")).toBeGreaterThan(at("cautious"));
    expect(at("cautious")).toBeGreaterThan(at("hunter"));
    expect(at("farmer", 150)).toBeGreaterThan(at("farmer", 450));
    const crowd = [fighter({ id: "foe", ...along(300), dist: 300 })];
    expect(at("farmer", 300, { fighters: crowd })).toBeGreaterThan(at("farmer"));
    expect(at("hunter", 300, { fighters: crowd }) - at("hunter")).toBeLessThan(at("farmer", 300, { fighters: crowd }) - at("farmer") + 1e-9 + CHEST_RULES.crowd);
    for (const persona of ["farmer", "hunter", "opportunist", "cautious"] as const) expect(at(persona, 100, { fighters: crowd })).toBeLessThanOrEqual(CHEST_RULES.cap);
    expect(CHEST_RULES.cap).toBeLessThan(0.85);
  });

  it("an Easy bot, which does not path, still walks to a chest it can see a straight line to", () => {
    expect(one({ tier: "easy", chests: [chest("rc1", 300)] })).toBeDefined();
  });
});

describe("running the walk goal", () => {
  const goal = (id: string): Extract<Goal, { kind: "module" }> => ({ kind: "module", module: "chests", data: { chest: id } });
  const act = (s: Scene, id = "rc1") => {
    const c = scene(s);
    chestsModule.observe!(c);
    return chestsModule.act!(c, goal(id));
  };

  it("walks to the chest's place, as a reaction to its appearing when this percept brought it, else as a step", () => {
    const cfg = cfgFor();
    const first = act({ cfg, chests: [chest("rc1", 300)], stimuli: [{ kind: "chestUp", at: NOW, subject: "rc1", central: false }] });
    expect(first.status.state).toBe("running");
    expect(first.intents).toEqual([expect.objectContaining({ kind: "move", to: along(300), timing: { kind: "react", stimulus: expect.objectContaining({ kind: "chestUp", subject: "rc1" }) } })]);
    const next = act({ cfg, now: NOW + 200, chests: [chest("rc1", 280)] });
    expect(next.intents).toEqual([expect.objectContaining({ kind: "move", timing: { kind: "step" } })]);
  });

  it("stands once the cards are in reach and sends the pick; ends when it has picked", () => {
    const cfg = cfgFor();
    const at = act({ cfg, chests: [chest("rc1", 60)] });
    expect(at.status.state).toBe("running");
    expect(at.intents.map((i) => i.kind)).toEqual(["choose"]);
    expect(act({ cfg, now: NOW + 300, chests: [chest("rc1", 60, { picked: true })] }).status.state).toBe("done");
  });

  it("ends when the chest is gone, expired, or the run left the field", () => {
    expect(act({ chests: [] }).status.state).toBe("done");
    expect(act({ chests: [chest("rc1", 300, { expiresAt: NOW })] }).status.state).toBe("done");
    expect(act({ chests: [chest("rc1", 300)], inColiseum: true }).status.state).toBe("done");
  });

  it("hands over to a chest that has become the better one", () => {
    expect(act({ chests: [chest("rc1", 400), chest("rc2", 200)] }, "rc1").status.state).toBe("done");
  });

  it("gives up a walk that stops closing in, and does not offer that chest again", () => {
    const cfg = cfgFor();
    let state = "running";
    let t = NOW;
    // The bot stands where it is (a wall, a stuck path) while its goal says walk.
    for (; t < NOW + 5000 && state === "running"; t += 100) state = act({ cfg, now: t, chests: [chest("rc1", 300, { expiresAt: t + 12_000 })] }).status.state;
    expect(state).toBe("done");
    expect(t - NOW, "after about the stall time").toBeGreaterThanOrEqual(CHEST_HUNT.stallMs - 200);
    expect(t - NOW).toBeLessThan(CHEST_HUNT.stallMs + 1500);
    const c = scene({ cfg, now: t, chests: [chest("rc1", 300, { expiresAt: t + 12_000 })] });
    chestsModule.observe!(c);
    expect(chestsModule.goals!(c)).toEqual([]);
  });

  it("a walk that does close in is never given up", () => {
    const cfg = cfgFor();
    let state = "running";
    for (let k = 0; k < 40 && state === "running"; k++) {
      const d = 300 - k * 7; // the bot walks 7 u every 100 ms (a little over 70 u/s: slow, but it closes in)
      if (d <= PICK) break;
      state = act({ cfg, now: NOW + k * 100, chests: [chest("rc1", 300, { expiresAt: NOW + 20_000 })], at: along(300 - d) }).status.state;
    }
    expect(state).toBe("running");
  });
});

// ========================================================================================== the click on the panel's card

describe("the humanizer clicks a card only while the panel is open", () => {
  const send = (open: boolean, gone = false): readonly TimedCommand[] => {
    const h = createHumanizer({ tier: TIERS.hard, map: testMap(), features: CHEST_FEATURES });
    const intent: Intent = { kind: "choose", msg: { chest: "rc1", pick: 1 }, priority: 1, timing: { kind: "step" }, why: "test" };
    const at = (now: number, chests: RewardChestView[]) => makeCtx({ cfg: cfgFor(), p: percept({ now, features: CHEST_FEATURES, extras: { chests } }) });
    h.submit([intent], at(NOW, [chest("rc1", 40)]));
    // By the click time the bot has walked out of reach (or the chest is gone, or it is still in reach).
    return h.release(at(NOW + 3000, gone ? [] : [chest("rc1", open ? 40 : 300)]));
  };

  it("sends it in reach, and clicks nothing once the cards are shut or the chest has gone", () => {
    expect(send(true).map((c) => c.cmd)).toEqual([{ type: "choose", msg: { chest: "rc1", pick: 1 } }]);
    expect(send(false)).toEqual([]);
    expect(send(true, true)).toEqual([]);
  });
});

// ============================================================================================== a whole brain at a chest

/** The bot at a spot with a chest `dx` u along the run: the stand walks it at PLAYER_SPEED to the last place it was told to (a click lands 60 ms on). */
class Stand {
  x = SPOT.x;
  y = SPOT.y;
  hp = 100;
  now = 100_000;
  readonly chest = { id: "rc1", dx: 380, expiresAt: this.now + CHEST_SECONDS * 1000 };
  picked = false;
  pickAt: number | null = null;
  pickFrom = Infinity;
  pick = -2;
  walkTo: Vec2 | null = null;
  private inbox: Array<{ at: number; cmd: Command }> = [];
  readonly sent: TimedCommand[] = [];
  readonly moves: Vec2[] = [];

  get d(): number { const c = along(this.chest.dx); return Math.hypot(c.x - this.x, c.y - this.y); }

  percept() {
    const readable = this.d <= PICK;
    return percept({
      now: this.now, self: selfView({ x: this.x, y: this.y, faction: "fire", weapons: ["sword", null], hp: this.hp, maxHp: 100 }),
      hud: hudView({ phase: "active" }), features: CHEST_FEATURES,
      extras: {
        chests: [{
          id: this.chest.id, ...along(this.chest.dx), expiresAt: this.chest.expiresAt,
          options: readable ? [...CARDS] : null, takenBy: readable ? ["", "", ""] : [], picked: this.picked,
        }],
        effects: { me: 0 },
      },
    });
  }

  send(cmds: readonly TimedCommand[]): void {
    for (const c of cmds) { this.sent.push(c); this.inbox.push({ at: c.at + 60, cmd: c.cmd }); }
  }

  advance(): void {
    this.now += FRAME_MS;
    const due = this.inbox.filter((i) => i.at <= this.now);
    this.inbox = this.inbox.filter((i) => i.at > this.now);
    for (const { cmd } of due) {
      if (cmd.type === "move") { this.walkTo = { x: cmd.msg.x, y: cmd.msg.y }; this.moves.push(this.walkTo); }
      else if (cmd.type === "choose" && cmd.msg.chest === this.chest.id && this.d <= CHEST_RANGE && !this.picked && this.now < this.chest.expiresAt) {
        this.picked = true;
        this.pickAt = this.now;
        this.pickFrom = this.d;
        this.pick = cmd.msg.pick;
      }
    }
    if (this.walkTo) {
      const dx = this.walkTo.x - this.x, dy = this.walkTo.y - this.y;
      const len = Math.hypot(dx, dy);
      const step = (PLAYER_SPEED * FRAME_MS) / 1000;
      if (len <= step) { this.x = this.walkTo.x; this.y = this.walkTo.y; this.walkTo = null; }
      else { this.x += (dx / len) * step; this.y += (dy / len) * step; }
    }
  }
}

function playStand(tier: TierId, persona: PersonaId, seed: number, seconds = 14): Stand {
  const stand = new Stand();
  const brain = createBrain(brainConfig(tier, persona, { seed, features: CHEST_FEATURES, modules: enabledModules(CHEST_FEATURES) }));
  for (let k = 0; k < (seconds * 1000) / FRAME_MS; k++) {
    stand.send(brain.tick(stand.percept()));
    stand.advance();
  }
  return stand;
}

describe("a whole brain, a chest on the minimap and nothing else to do", () => {
  it("walks to it, takes a card in reach, once, and the pick lands", () => {
    for (const tier of ["hard", "normal", "easy"] as const) {
      for (const seed of [1, 2, 3]) {
        const stand = playStand(tier, "farmer", seed);
        const chooses = stand.sent.filter((c) => c.cmd.type === "choose");
        expect(chooses, `${tier} ${seed}: one choose`).toHaveLength(1);
        expect(stand.picked, `${tier} ${seed}: the pick landed`).toBe(true);
        expect(stand.pick).toBeGreaterThanOrEqual(0);
        expect(stand.moves.length, `${tier} ${seed}: it walked`).toBeGreaterThan(0);
        // The chest was walked to: the pick came from within reach, well after the start.
        expect(stand.pickFrom).toBeLessThanOrEqual(CHEST_RANGE);
        expect(chooses[0]!.at).toBeGreaterThan(100_000 + 1000);
      }
    }
  });

  it("a Hard bot gets its card sooner than an Easy one: it reacts and clicks faster", () => {
    const meanPick = (tier: TierId) => {
      const stands = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => playStand(tier, "farmer", seed));
      expect(stands.every((s) => s.picked), tier).toBe(true);
      const times = stands.map((s) => s.pickAt! - 100_000);
      return times.reduce((a, b) => a + b, 0) / times.length;
    };
    expect(meanPick("hard")).toBeLessThan(meanPick("easy"));
  });

  it("a Hunter, who cares little for loot, still takes the card when it passes within reach", () => {
    // Put the chest on its way: it is 40 u from the spot.
    const stand = new Stand();
    (stand.chest as { dx: number }).dx = 40;
    const brain = createBrain(brainConfig("hard", "hunter", { seed: 2, features: CHEST_FEATURES, modules: enabledModules(CHEST_FEATURES) }));
    for (let k = 0; k < 120; k++) { stand.send(brain.tick(stand.percept())); stand.advance(); }
    expect(stand.picked).toBe(true);
  });

  it("a chest that vanishes before the bot can arrive is never walked to", () => {
    const stand = new Stand();
    stand.chest.expiresAt = stand.now + 1200;
    const brain = createBrain(brainConfig("hard", "farmer", { seed: 2, features: CHEST_FEATURES, modules: enabledModules(CHEST_FEATURES) }));
    for (let k = 0; k < 60; k++) { stand.send(brain.tick(stand.percept())); stand.advance(); }
    // Whatever else it does, it does not set out for a chest that will be gone before it is there.
    const chestAt = along(stand.chest.dx);
    expect(stand.moves.filter((m) => Math.hypot(m.x - chestAt.x, m.y - chestAt.y) < 150)).toEqual([]);
    expect(stand.picked).toBe(false);
  });

  it("without the module (a server with no chests) the same percepts make no choose and no walk to a chest", () => {
    const stand = new Stand();
    const brain = createBrain(brainConfig("hard", "farmer", { seed: 2, features: features(), modules: [] }));
    for (let k = 0; k < 120; k++) { stand.send(brain.tick(stand.percept())); stand.advance(); }
    expect(stand.sent.filter((c) => c.cmd.type === "choose")).toEqual([]);
  });
});

// The frame ring windows the extras to the screen: chests are not cut (the minimap draws every one).
describe("chests through the frame ring", () => {
  it("a chest far off screen is still in the percept's extras, with its place and expiry and shut cards", () => {
    const map = testMap();
    const state = plainState({ serverTime: KIT_T0 });
    state.players.set("me", plainPlayer({ name: "Me", x: SPOT.x, y: SPOT.y, faction: "fire" }));
    state.containers.set("away", plainContainer({ id: "away", kind: "reward", x: SPOT.x + 2400, y: SPOT.y + 900, camp: 2, expiresAt: KIT_T0 + 9000, options: [...CARDS], takenBy: ["", "", ""], pickers: [] }));
    state.roster = ["me"];
    const ring = createFrameRing();
    let last = null;
    for (let k = 0; k < 8; k++) {
      state.serverTime = KIT_T0 + k * FRAME_MS;
      ring.push(perceive({ state: { ...state } as PerceptionInput["state"] }, { selfId: "me", map, features: CHEST_FEATURES, lastMinimap: null }));
      last = ring.compose({ selfDelayMs: 30, worldDelayMs: 130, map, features: CHEST_FEATURES, attentionCentral: 0.65 }) ?? last;
    }
    expect(last!.extras.chests).toEqual([{ id: "away", x: SPOT.x + 2400, y: SPOT.y + 900, expiresAt: KIT_T0 + 9000, options: null, takenBy: [], picked: false }]);
    expect(last!.containers.find((c) => c.id === "away")).toBeUndefined();
  });
});

// ============================================================================================================== whole games

describe("bots in whole games", () => {
  /** A short game of six bots of every tier and persona: the camps they clear drop chests, and what they take of them. */
  function game(seed: number) {
    const room = createHeadlessRoom({
      seed,
      config: { patienceSeconds: 120, patienceMinSeconds: 48, suddenDeathSeconds: 30, firstPatienceSeconds: 0 },
      bots: { ...BOT_FILL_DEFAULTS, fillTo: 6 },
      lineup: [
        { tier: "hard", persona: "farmer" }, { tier: "hard", persona: "opportunist" }, { tier: "normal", persona: "farmer" },
        { tier: "normal", persona: "cautious" }, { tier: "easy", persona: "farmer" }, { tier: "easy", persona: "hunter" },
      ],
      startAtOnce: true,
    });
    let cleared = 0;
    const taken: Array<{ chest: string; by: string; option: number }> = [];
    const refusals: string[] = [];
    room.runUntilEnd(400_000, (events) => {
      for (const e of events) {
        if (e.type === "toast" && room.manager.isBot(e.to) && /^(Already|Too far|Can't reach|Chest gone|You already)/.test(e.text)) refusals.push(`${e.to}: ${e.text}`);
        if (e.type !== "fx") continue;
        if (e.fx.kind === "campCleared") cleared++;
        if (e.fx.kind === "chestTaken") taken.push({ chest: e.fx.chest, by: e.fx.by, option: e.fx.option });
      }
    });
    const chooseCommands = room.seats.reduce((n, s) => n + (room.manager.brainOf(s.id)?.stats.commands.choose ?? 0), 0);
    return { room, cleared, taken, refusals, chooseCommands };
  }

  it("across five short games the bots walk to the chests camps drop and take cards from them", () => {
    let cleared = 0, picks = 0, skips = 0, commands = 0, refused = 0, takers = new Set<string>();
    for (const seed of [3, 4, 7, 8, 9]) {
      const g = game(seed);
      cleared += g.cleared;
      picks += g.taken.filter((t) => t.option >= 0).length;
      skips += g.taken.filter((t) => t.option < 0).length;
      commands += g.chooseCommands;
      refused += g.refusals.length;
      for (const t of g.taken) takers.add(t.by);
      // The server's own rule, seen from the bots: nobody picked twice at one chest.
      expect(new Set(g.taken.map((t) => `${t.chest}/${t.by}`)).size, `seed ${seed}`).toBe(g.taken.length);
      expect(g.room.manager.stats, `seed ${seed}`).toMatchObject({ refused: 0, errors: 0 });
    }
    expect(cleared, "camps were cleared").toBeGreaterThan(5);
    expect(picks, "cards taken").toBeGreaterThanOrEqual(5);
    expect(takers.size, "by several bots").toBeGreaterThanOrEqual(3);
    // A choose is nearly always a pick the server took (a race lost is the exception), and the humanizer holds back one for a chest it
    // is no longer in reach of: refusals are rare.
    expect(commands).toBeLessThanOrEqual(picks + skips + 4);
    expect(refused).toBeLessThanOrEqual(3);
  });
});
