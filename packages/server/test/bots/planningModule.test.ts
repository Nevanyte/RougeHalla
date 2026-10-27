// The planning module (brain/modules/planning.ts, docs/BOTS.md 8): how a bot uses the planning screen. The module is driven on
// synthetic percepts with a small stand-in for the server's side of the deal (the echo of a pick in the next private message), then
// through a whole brain (the planning branch of Brain.tick and the humanizer's gate), then in whole headless games.
import { describe, expect, it } from "vitest";
import { PLAN_SECONDS, TICK_MS, type WeaponId } from "@raid/shared";
import { BotManager } from "../../src/bots/BotManager";
import { createBrain } from "../../src/bots/brain/brain";
import { enabledModules } from "../../src/bots/brain/modules/index";
import { PLAN_RULES, planningModule } from "../../src/bots/brain/modules/planning";
import {
  BOT_FILL_DEFAULTS,
  type BrainConfig, type Command, type Goal, type Intent, type LearnedBias, type ObservedEvent, type TierId, type TimedCommand,
} from "../../src/bots/brain/types";
import { planSpawnScore } from "../../src/bots/mobHunt";
import { createHeadlessRoom } from "../../src/bots/tournament/headlessRoom";
import { brainConfig, ctx as makeCtx, features, hudView, percept, rngs, selfView, testMap } from "./fixtures";

const WINDOW = PLAN_SECONDS * 1000;
const T0 = 100_000;
const IDLE: Goal = { kind: "idle" };
const PLAN_FEATURES = features({ messageTypes: ["move", "stop", "target", "aim", "attack", "release", "swap", "pickup", "plan"], planning: true });

/**
 * On the test map (seed 7, 136x136) for a fire bot with a sword: the best start of the pool and the poorest, found from planSpawnScore itself so
 * the picks follow the map whenever its pins move (phase A: spawn 15 scored 1.98 and spawn 5 0.27).
 */
const FIRE_SWORD = { faction: "fire" as const, weapons: ["sword", null] as const };
const POOL_SCORES = testMap().spawnPool.map((_, i) => planSpawnScore(testMap(), i, "fire", "sword"));
const GOOD = POOL_SCORES.indexOf(Math.max(...POOL_SCORES));
const POOR = POOL_SCORES.indexOf(Math.min(...POOL_SCORES));

/** The private `plan` message (shared PlanMessage) as the server sends it. */
interface Msg { endsAt: number; spawns: [number, number]; taken: [boolean, boolean]; pick: number; boons: string[]; boon: number }

const deal = (over: Partial<Msg> = {}): Msg => ({ endsAt: T0 + WINDOW, spawns: [POOR, GOOD], taken: [false, false], pick: -1, boons: [], boon: -1, ...over });
const priv = (t: number, msg: Msg): ObservedEvent => ({ kind: "private", t, at: null, type: "plan", msg: { ...msg } });

/** The server's side of one player's deal: a pick or boon asked for is echoed 150 ms later (unless it is `deaf`), a Ready is kept. */
class Table {
  msg: Msg;
  ready = false;
  private queue: Array<{ at: number; cmd: Extract<Command, { type: "plan" }>["msg"] }> = [];
  private sent = false;
  private dirty = false;
  constructor(over: Partial<Msg> = {}, readonly latencyMs = 150, readonly deaf = false) {
    this.msg = deal(over);
  }

  /** The deal changes (another player took an option, say): the next message says so. */
  update(over: Partial<Msg>): void {
    this.msg = { ...this.msg, ...over };
    this.dirty = true;
  }

  /** The message to hand the bot at `t`, or none (the first at once, then one whenever it changed). */
  events(t: number): ObservedEvent[] {
    let changed = !this.sent || this.dirty;
    this.dirty = false;
    this.sent = true;
    for (const q of this.queue.filter((x) => x.at <= t)) {
      if (q.cmd.spawn !== undefined && !this.msg.taken[q.cmd.spawn] && !this.deaf) { this.msg = { ...this.msg, pick: q.cmd.spawn }; changed = true; }
      if (q.cmd.boon !== undefined && !this.deaf) { this.msg = { ...this.msg, boon: q.cmd.boon }; changed = true; }
      if (q.cmd.ready === true) this.ready = true;
    }
    this.queue = this.queue.filter((x) => x.at > t);
    return changed ? [priv(t, this.msg)] : [];
  }

  accept(cmd: Command, at: number): void {
    if (cmd.type === "plan") this.queue.push({ at: at + this.latencyMs, cmd: cmd.msg });
  }
}

interface Sent { t: number; msg: Extract<Command, { type: "plan" }>["msg"] }

/** The module alone, tick by tick (50 ms) from the deal to the end of the window: what it asks for and when. */
function playModule(
  tier: TierId, seed: number, table: Table, over: Partial<BrainConfig> = {}, hook: (t: number, sent: readonly Sent[]) => void = () => {},
): Sent[] {
  const cfg = brainConfig(tier, "farmer", { seed, features: PLAN_FEATURES, ...over });
  const rng = rngs(seed);
  const out: Sent[] = [];
  for (let t = T0; t <= table.msg.endsAt + 500; t += TICK_MS) {
    hook(t, out);
    const c = makeCtx({
      cfg, rng, p: percept({ now: t, self: selfView({ status: "lobby", ...FIRE_SWORD }), hud: hudView({ phase: "planning" }), events: table.events(t), features: PLAN_FEATURES }),
    });
    planningModule.observe!(c);
    for (const i of planningModule.intents!(c, IDLE)) {
      if (i.kind !== "plan") throw new Error(`a planning module intent of kind ${i.kind}`);
      const cmd: Command = { type: "plan", msg: i.msg };
      out.push({ t, msg: i.msg });
      table.accept(cmd, t);
    }
  }
  return out;
}

const firstOf = (sent: readonly Sent[], key: "spawn" | "boon" | "ready"): Sent | undefined => sent.find((s) => s.msg[key] !== undefined);
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

describe("the planning module", () => {
  it("exists only where the server plans, and is registered with the others", () => {
    expect(planningModule.enabled(features())).toBe(false);
    expect(planningModule.enabled(PLAN_FEATURES)).toBe(true);
    expect(enabledModules(PLAN_FEATURES).map((m) => m.id)).toContain("planning");
    expect(enabledModules(features()).map((m) => m.id)).not.toContain("planning");
  });

  it("does nothing outside the planning phase", () => {
    const cfg = brainConfig("normal", "farmer", { features: PLAN_FEATURES });
    for (const phase of ["lobby", "active", "ended"]) {
      const c = makeCtx({ cfg, p: percept({ now: T0, hud: hudView({ phase }), events: [priv(T0, deal())], features: PLAN_FEATURES }) });
      planningModule.observe!(c);
      expect(planningModule.intents!(c, IDLE), phase).toEqual([]);
    }
  });

  it("reads the screen first, for as long as its tier does, and only then picks a spawn", () => {
    const firsts: Record<TierId, number[]> = { easy: [], normal: [], hard: [] };
    for (const tier of ["easy", "normal", "hard"] as const) {
      for (const seed of SEEDS) {
        const sent = playModule(tier, seed, new Table());
        const spawn = firstOf(sent, "spawn");
        expect(spawn, `${tier} ${seed}`).toBeDefined();
        firsts[tier].push(spawn!.t - T0);
      }
      const [lo, hi] = PLAN_RULES.read[tier];
      // From the deal's arrival (the first percept) to the read's end: the tier's range, cut at 55% of the window.
      expect(Math.min(...firsts[tier]), tier).toBeGreaterThanOrEqual(lo - TICK_MS);
      expect(Math.max(...firsts[tier]), tier).toBeLessThanOrEqual(Math.min(hi, PLAN_RULES.readShare * WINDOW) + TICK_MS);
    }
    expect(mean(firsts.hard)).toBeLessThan(mean(firsts.normal));
    expect(mean(firsts.normal)).toBeLessThan(mean(firsts.easy));
  });

  it("scales its reading down to a short window and still finishes inside it", () => {
    for (const tier of ["easy", "hard"] as const) {
      for (const seed of SEEDS.slice(0, 10)) {
        const endsAt = T0 + 3000;
        const table = new Table({ endsAt });
        const sent = playModule(tier, seed, table);
        expect(firstOf(sent, "spawn")!.t, `${tier} ${seed}`).toBeLessThan(endsAt - 1000);
        expect(table.ready, `${tier} ${seed}: ready in time`).toBe(true);
        expect(firstOf(sent, "ready")!.t).toBeLessThan(endsAt);
      }
    }
  });

  it("takes the better spawn by the camps' matchup (planSpawnScore), Hard more surely than Easy", () => {
    const map = testMap();
    expect(planSpawnScore(map, GOOD, "fire", "sword")).toBeGreaterThan(planSpawnScore(map, POOR, "fire", "sword") + 1);
    const hits: Record<TierId, number> = { easy: 0, normal: 0, hard: 0 };
    for (const tier of ["easy", "normal", "hard"] as const) {
      for (const seed of SEEDS) {
        const spawn = firstOf(playModule(tier, seed, new Table()), "spawn")!;
        if (spawn.msg.spawn === 1) hits[tier]++; // option 1 is the GOOD spawn
      }
    }
    expect(hits.hard).toBeGreaterThanOrEqual(SEEDS.length * 0.9);
    expect(hits.easy).toBeGreaterThan(SEEDS.length * 0.5);
    expect(hits.hard).toBeGreaterThanOrEqual(hits.easy);
    // The other way round (the poor spawn is option 1): the pick follows the spawn, not the option's place.
    for (const seed of SEEDS.slice(0, 10)) {
      expect(firstOf(playModule("hard", seed, new Table({ spawns: [GOOD, POOR] })), "spawn")!.msg.spawn, `seed ${seed}`).toBe(0);
    }
  });

  it("takes the other spawn when the better one is held by somebody else, and only presses ready when both are", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const held = playModule("hard", seed, new Table({ taken: [false, true] }));
      expect(firstOf(held, "spawn")!.msg.spawn, `seed ${seed}`).toBe(0);
    }
    const none = new Table({ taken: [true, true] });
    const sent = playModule("hard", 3, none);
    expect(sent.map((s) => Object.keys(s.msg)[0])).toEqual(["ready"]);
    expect(none.ready).toBe(true);
  });

  it("sends the pick once, then ready a moment after it is echoed, once, and before the timer", () => {
    for (const tier of ["easy", "normal", "hard"] as const) {
      for (const seed of SEEDS.slice(0, 12)) {
        const table = new Table();
        const sent = playModule(tier, seed, table);
        expect(sent.map((s) => Object.keys(s.msg)[0]), `${tier} ${seed}`).toEqual(["spawn", "ready"]);
        const [spawn, ready] = sent;
        expect(table.msg.pick).toBe(spawn!.msg.spawn);
        // The message shows the pick 150 ms later; Ready follows after the tier's settling time, never before.
        const [slo, shi] = PLAN_RULES.settle[tier];
        expect(ready!.t - spawn!.t, `${tier} ${seed}`).toBeGreaterThanOrEqual(slo + 150 - TICK_MS);
        expect(ready!.t - spawn!.t, `${tier} ${seed}`).toBeLessThanOrEqual(shi + 150 + 2 * TICK_MS);
        expect(ready!.t).toBeLessThan(table.msg.endsAt);
      }
    }
  });

  it("asks again when the message still shows no pick, after 400 ms and its reaction, and gives up after three asks", () => {
    const table = new Table({}, 150, true);
    const sent = playModule("normal", 5, table);
    const spawns = sent.filter((s) => s.msg.spawn !== undefined);
    expect(spawns).toHaveLength(PLAN_RULES.maxAsks);
    const wait = PLAN_RULES.resendMs + brainConfig("normal").tier.reaction.mu;
    for (let i = 1; i < spawns.length; i++) expect(spawns[i]!.t - spawns[i - 1]!.t).toBeGreaterThanOrEqual(wait - TICK_MS);
    // Having given up on the pick it still presses ready, once, before the timer.
    expect(sent.filter((s) => s.msg.ready === true)).toHaveLength(1);
    expect(table.ready).toBe(true);
  });

  it("asks for the other spawn when the first it wanted was taken before its pick landed", () => {
    let checked = 0;
    for (const seed of SEEDS.slice(0, 12)) {
      const table = new Table({}, 150, true);
      let grabbed = false;
      // Somebody else takes the good spawn (option 1) right after the bot's first ask; the next message says so.
      const sent = playModule("hard", seed, table, {}, (_t, out) => {
        if (!grabbed && out.length === 1 && out[0]!.msg.spawn === 1) { grabbed = true; table.update({ taken: [false, true] }); }
      });
      if (!grabbed) continue;
      checked++;
      const spawns = sent.filter((s) => s.msg.spawn !== undefined).map((s) => s.msg.spawn);
      expect(spawns.slice(0, 2), `seed ${seed}`).toEqual([1, 0]);
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  it("picks a start boon after the spawn when one is dealt (the stats file's favourite for its faction, else any), then presses ready", () => {
    const favourite: LearnedBias = { enabled: true, bias: (key) => (key === "boon|fire|b" ? 0.25 : 0) };
    let b = 0;
    for (const seed of SEEDS) {
      const sent = playModule("hard", seed, new Table({ boons: ["a", "b"] }), { learned: favourite });
      expect(sent.map((s) => Object.keys(s.msg)[0]), `seed ${seed}`).toEqual(["spawn", "boon", "ready"]);
      if (firstOf(sent, "boon")!.msg.boon === 1) b++;
    }
    expect(b).toBeGreaterThan(SEEDS.length * 0.6);
    const seen = new Set<number>();
    for (const seed of SEEDS) seen.add(firstOf(playModule("normal", seed, new Table({ boons: ["a", "b"] })), "boon")!.msg.boon!);
    expect([...seen].sort()).toEqual([0, 1]); // no basis at all: whichever the stream gives
  });

  it("a deal that never arrives: it presses ready about a second in, once, and lets the server place it", () => {
    const cfg = brainConfig("normal", "farmer", { seed: 2, features: PLAN_FEATURES });
    const rng = rngs(2);
    const sent: number[] = [];
    for (let t = T0; t <= T0 + 6000; t += TICK_MS) {
      const c = makeCtx({ cfg, rng, p: percept({ now: t, self: selfView({ status: "lobby" }), hud: hudView({ phase: "planning" }), features: PLAN_FEATURES }) });
      planningModule.observe!(c);
      for (const i of planningModule.intents!(c, IDLE)) {
        expect(i).toMatchObject({ kind: "plan", msg: { ready: true } });
        sent.push(t);
      }
    }
    expect(sent).toHaveLength(1);
    expect(sent[0]! - T0).toBeGreaterThanOrEqual(PLAN_RULES.noDealMs);
    expect(sent[0]! - T0).toBeLessThanOrEqual(PLAN_RULES.noDealMs + TICK_MS);
  });

  it("is a pure function of its stream: the same seed asks for the same things at the same times", () => {
    const run = () => playModule("easy", 9, new Table({ boons: ["a", "b"] }));
    expect(run()).toEqual(run());
  });

  it("ignores a private message that is not a deal, and other private messages", () => {
    const cfg = brainConfig("hard", "farmer", { features: PLAN_FEATURES });
    const rng = rngs(1);
    const junk: ObservedEvent[] = [
      { kind: "private", t: T0, at: null, type: "reveal", msg: { camps: { 3: "relic" } } },
      { kind: "private", t: T0, at: null, type: "plan", msg: { spawns: "nope" } },
    ];
    for (let t = T0; t < T0 + 600; t += TICK_MS) {
      const c = makeCtx({ cfg, rng, p: percept({ now: t, self: selfView({ status: "lobby" }), hud: hudView({ phase: "planning" }), events: junk, features: PLAN_FEATURES }) });
      expect(() => planningModule.observe!(c)).not.toThrow();
      expect(planningModule.intents!(c, IDLE)).toEqual([]);
    }
  });
});

// ================================================================================================================ the brain

/** A whole brain on the planning screen: percepts of a lobby-status player in the planning phase, the server echoing what it is sent. */
function playBrain(tier: TierId, seed: number, table = new Table(), opts: { phase?: string } = {}): TimedCommand[] {
  const brain = createBrain(brainConfig(tier, "farmer", { seed, features: PLAN_FEATURES, modules: enabledModules(PLAN_FEATURES) }));
  const sent: TimedCommand[] = [];
  for (let t = T0; t <= T0 + WINDOW + 500; t += TICK_MS) {
    const cmds = brain.tick(percept({
      now: t, self: selfView({ status: "lobby", ...FIRE_SWORD }), hud: hudView({ phase: opts.phase ?? "planning" }), events: table.events(t), features: PLAN_FEATURES,
    }));
    for (const c of cmds) { sent.push(c); table.accept(c.cmd, c.at); }
  }
  return sent;
}

describe("a whole brain on the planning screen", () => {
  it("clicks a spawn and then ready, and nothing else: no walk, no lock, no goal", () => {
    for (const tier of ["easy", "normal", "hard"] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const table = new Table();
        const sent = playBrain(tier, seed, table);
        expect(sent.map((c) => c.cmd.type), `${tier} ${seed}`).toEqual(["plan", "plan"]);
        expect(sent.map((c) => Object.keys((c.cmd as Extract<Command, { type: "plan" }>).msg)[0])).toEqual(["spawn", "ready"]);
        expect(table.msg.pick).toBeGreaterThanOrEqual(0);
        expect(table.ready).toBe(true);
        // The clicks are the humanizer's: after the reading, never before the deal, in click order.
        expect(sent[0]!.at).toBeGreaterThanOrEqual(T0 + PLAN_RULES.read[tier][0]);
        expect(sent[1]!.at).toBeGreaterThan(sent[0]!.at);
        expect(sent[1]!.at).toBeLessThan(table.msg.endsAt);
      }
    }
  });

  it("a Hard bot is quicker than an Easy one", () => {
    const readyAt = (tier: TierId): number => mean(SEEDS.slice(0, 12).map((seed) => playBrain(tier, seed).at(-1)!.at - T0));
    expect(readyAt("hard")).toBeLessThan(readyAt("normal"));
    expect(readyAt("normal")).toBeLessThan(readyAt("easy"));
  });

  it("sends nothing when the phase is not planning (the module's intents are only the planning screen's)", () => {
    expect(playBrain("hard", 1, new Table(), { phase: "lobby" })).toEqual([]);
  });

  it("without the module (a server that does not plan) the same percepts send nothing", () => {
    const brain = createBrain(brainConfig("hard", "farmer", { seed: 1, features: PLAN_FEATURES, modules: [] }));
    for (let t = T0; t <= T0 + 4000; t += TICK_MS) {
      expect(brain.tick(percept({ now: t, self: selfView({ status: "lobby" }), hud: hudView({ phase: "planning" }), events: [priv(t, deal())] }))).toEqual([]);
    }
  });

  it("a module that throws is switched off, and the room goes on (the server places the bot)", () => {
    const broken = { ...planningModule, intents: (): readonly Intent[] => { throw new Error("boom"); } };
    const logs: string[] = [];
    const cfg = brainConfig("hard", "farmer", { seed: 1, features: PLAN_FEATURES, modules: [broken], services: { ...brainConfig().services, log: (m) => logs.push(m) } });
    const brain = createBrain(cfg);
    for (let t = T0; t <= T0 + 4000; t += TICK_MS) {
      expect(() => brain.tick(percept({ now: t, self: selfView({ status: "lobby" }), hud: hudView({ phase: "planning" }), events: [priv(t, deal())], features: PLAN_FEATURES }))).not.toThrow();
    }
    expect(logs.filter((l) => l.includes("planning")).length).toBe(1);
  });
});

// ============================================================================================================== whole games

describe("bots in whole planned games", () => {
  /** One planning phase, 6 bots of every tier: who picked what, when, and where each started the run. */
  function planned(seed: number) {
    const room = createHeadlessRoom({
      seed,
      config: { planSeconds: PLAN_SECONDS, firstPatienceSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
      bots: { ...BOT_FILL_DEFAULTS, fillTo: 6 },
      lineup: [{ tier: "hard" }, { tier: "hard" }, { tier: "normal" }, { tier: "normal" }, { tier: "easy" }, { tier: "easy" }],
      startAtOnce: true,
    });
    const s = room.world.state;
    while (s.phase === "lobby") room.tick();
    const pool = room.world.map.spawnPool;
    const picks = new Map<string, { index: number; at: number }>();
    const readyAt = new Map<string, number>();
    const t0 = s.serverTime;
    let guard = 0;
    while (s.phase === "planning" && guard++ < (PLAN_SECONDS + 2) * 20) {
      room.tick();
      for (const [id, p] of s.players) {
        const d = room.world.planning?.deals.get(id);
        if (d && d.pick !== -1 && !picks.has(id)) picks.set(id, { index: d.spawns[d.pick], at: s.serverTime - t0 });
        if (p.planReady && !readyAt.has(id)) readyAt.set(id, s.serverTime - t0);
      }
    }
    return { room, picks, readyAt, pool, planMs: s.serverTime - t0 };
  }

  it("every bot picks one of its dealt spawns, presses ready, and starts the run on the spawn it picked", () => {
    for (const seed of [5, 6, 7, 8, 9]) {
      const { room, picks, readyAt, pool, planMs } = planned(seed);
      const s = room.world.state;
      expect(s.phase, `seed ${seed}`).toBe("active");
      expect(picks.size, `seed ${seed}: picks`).toBe(6);
      expect(readyAt.size, `seed ${seed}: ready`).toBe(6);
      for (const seat of room.seats) {
        const pick = picks.get(seat.id)!;
        const p = s.players.get(seat.id)!;
        const spot = pool[pick.index]!;
        expect(Math.hypot(p.x - spot.x, p.y - spot.y), `seed ${seed} ${seat.id} starts on its pick`).toBeLessThan(2 * 32);
        const [lo] = PLAN_RULES.read[seat.tier];
        expect(pick.at, `seed ${seed} ${seat.id} (${seat.tier}) read first`).toBeGreaterThanOrEqual(lo - TICK_MS);
        expect(readyAt.get(seat.id)!).toBeGreaterThan(pick.at);
      }
      expect(planMs, `seed ${seed}`).toBeLessThan(PLAN_SECONDS * 1000);
      expect(room.manager.stats).toMatchObject({ refused: 0, errors: 0 });
    }
  });

  it("the picks are better than a coin flip: the chosen spawn out-scores the other dealt one more often than not", () => {
    let better = 0, worse = 0;
    for (const seed of [5, 6, 7, 8, 9, 10, 11, 12]) {
      const { room, picks } = planned(seed);
      for (const seat of room.seats) {
        const deal = room.world.planning!.deals.get(seat.id)!;
        const pick = picks.get(seat.id);
        const me = room.world.state.players.get(seat.id)!;
        if (!pick || deal.pick < 0) continue;
        const weapon = (me.slot === 1 ? me.weapon1 : me.weapon0) as WeaponId;
        const picked = deal.pick as 0 | 1;
        const mine = planSpawnScore(room.world.map, deal.spawns[picked], seat.faction, weapon);
        const other = planSpawnScore(room.world.map, deal.spawns[picked === 0 ? 1 : 0], seat.faction, weapon);
        if (mine > other) better++; else if (mine < other) worse++;
      }
    }
    expect(better).toBeGreaterThan(worse * 2);
  });
});

// The manager no longer presses ready for a bot: the module does (BotManager.pressReady is gone), so a manager whose brain has no
// planning module leaves the phase to its timer.
describe("the manager leaves planning to the brain", () => {
  it("a scripted brain that never answers leaves the phase to run out its timer", () => {
    const silent = (cfg: BrainConfig) => ({ id: cfg.id, tick: () => [], end: () => ({ tier: cfg.tier.id, persona: cfg.persona.id, faction: null, outcome: "void" as const, place: 0, players: 0, choices: [] }), goal: IDLE, stats: {} as never });
    const room = createHeadlessRoom({
      seed: 3,
      config: { planSeconds: 4, firstPatienceSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
      bots: { ...BOT_FILL_DEFAULTS, fillTo: 2 },
      lineup: [{}, {}],
      startAtOnce: true,
      createBrain: silent,
    });
    const s = room.world.state;
    while (s.phase === "lobby") room.tick();
    const t0 = s.serverTime;
    while (s.phase === "planning") room.tick();
    expect(s.serverTime - t0).toBeGreaterThanOrEqual(4000 - TICK_MS);
    expect(room.manager instanceof BotManager).toBe(true);
    expect(room.manager.stats.sent).toBe(0);
  });
});
