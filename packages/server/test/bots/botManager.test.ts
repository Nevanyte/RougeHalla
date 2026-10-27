// BotManager (docs/BOTS.md 7.2, 9.1), headless: a real world, stepped in the Room's order (lobbyTick and beforeStep before a
// step, the fx batch, then afterPatch), with scripted brains where the test needs to know exactly what a bot clicked and real ones
// where it needs a lobby of bots to play. What is pinned: the arrival schedule and the head count ticking up, the last top-up, a
// human taking a bot's seat, callsigns, the latency delay line, that every command a bot sends goes through the validation a
// human's message takes (and none is refused), that nothing a bot does can reach a profile, that the stats file is flushed, and
// that the whole manager replays from its seed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FACTION_IDS, MAX_PLAYERS, mulberry32, TICK_MS, type RunResult } from "@raid/shared";
import { BotManager, type BotManagerDeps } from "../../src/bots/BotManager";
import { createBrain } from "../../src/bots/brain/brain";
import {
  BOT_FILL_DEFAULTS, BOT_PATH_BUDGET_PER_TICK, PERSONA_IDS, TIER_IDS,
  type BotFillConfig, type BotStatsStoreApi, type Brain, type BrainConfig, type BrainFactory, type BrainStats, type ChoiceKey,
  type Command, type Features, type LearnedBias, type Percept, type PersonaId, type RunSummary, type TierId, type TimedCommand,
} from "../../src/bots/brain/types";
import { CALLSIGN_POOL } from "../../src/bots/callsigns";
import { createBotStatsStore, NO_BIAS } from "../../src/bots/learning/BotStatsStore";
import type { ProfileStore } from "../../src/persistence/ProfileStore";
import { FxChannel } from "../../src/rooms/FxChannel";
import { applyDamage } from "../../src/sim/arena";
import { createGameWorld } from "../../src/sim/gameplay";
import { abandonPlayer, addPlayer, removePlayer, step } from "../../src/sim/step";
import type { SimConfig, SimEvent, World } from "../../src/sim/world";
import { CORE_MESSAGES } from "./fixtures";

const CFG: BotFillConfig = { ...BOT_FILL_DEFAULTS, fillTo: 4, arrivalSeconds: 12, latencyMs: 30, jitterMs: 8 };

function makeWorld(cfg: Partial<SimConfig> = {}, seed = 1234): World {
  return createGameWorld({
    seed,
    config: {
      minPlayers: 2, lobbySeconds: 30, fillSeconds: 5, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 600, ...cfg,
    },
    random: mulberry32(seed + 1),
  });
}

const human = (w: World, n: number, name = `human${n}`): void => { addPlayer(w, `h${n}`, name); };
const humansIn = (w: World): number => [...w.players.values()].filter((rt) => !rt.bot).length;
const botsIn = (w: World): string[] => [...w.state.players].filter(([, p]) => p.bot).map(([id]) => id);

function manager(w: World, over: Partial<BotFillConfig> = {}, deps: Partial<BotManagerDeps> = {}, seed = 7): BotManager {
  return new BotManager(w, { ...CFG, ...over }, { store: null, isNameTaken: () => false, seed, ...deps });
}

/** The Room's tick, headless: arrivals and due commands before the step, the step's fx batch, the results, then one frame per patch. */
class Loop {
  readonly channel = new FxChannel();
  /** Called after the due commands reached the input queues and before the step drains them. */
  observe: (() => void) | undefined;
  readonly w: World;
  readonly m: BotManager;

  constructor(w: World, m: BotManager) {
    this.w = w;
    this.m = m;
  }

  tick(): SimEvent[] {
    const { w, m } = this;
    if (w.state.phase === "lobby") m.lobbyTick();
    m.beforeStep(w.state.serverTime + TICK_MS);
    this.observe?.();
    const events = step(w, TICK_MS);
    const batch = this.channel.batch(events.flatMap((e) => (e.type === "fx" ? [e.fx] : [])), w.state.serverTime, w.projectiles);
    for (const e of events) {
      if (e.type === "toast" && m.isBot(e.to)) m.onToast(e.to, e.text);
      else if (e.type === "resolved" && (e.bot === true || w.players.get(e.id)?.bot)) m.onResult(e.id, e.result);
    }
    this.channel.extendRoster(w.state);
    this.channel.rosterSent();
    m.afterPatch(batch ? [batch] : []);
    return events;
  }

  /** Ticks until `done`, at most `max` of them. */
  until(done: () => boolean, max = 4000): void {
    for (let i = 0; i < max && !done(); i++) this.tick();
  }
}

function spyStore(): { store: BotStatsStoreApi; record: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> } {
  const record = vi.fn();
  const flush = vi.fn();
  return { store: { snapshot: () => NO_BIAS, record, flush, close: vi.fn() }, record, flush };
}

// ------------------------------------------------------------------------------------------------------ scripted brains

interface Stub {
  readonly cfg: BrainConfig;
  /** What the next tick returns (then it empties). */
  todo: TimedCommand[];
  readonly percepts: Percept[];
  readonly ended: Array<RunResult | null>;
  fail: boolean;
}

const INTENT = { move: "move", stop: "stop", target: "lock", swap: "swap", pickup: "pickup" } as const;
const click = (at: number, cmd: Command): TimedCommand => ({
  at, cmd, intent: INTENT[cmd.type as keyof typeof INTENT] ?? "move", priority: 2, stimulus: null,
});
const move = (x: number): Command => ({ type: "move", msg: { x, y: 200 } });
const lock = (id: string): Command => ({ type: "target", msg: { id } });

function stubs(): { factory: BrainFactory; by: Map<string, Stub> } {
  const by = new Map<string, Stub>();
  const factory: BrainFactory = (cfg) => {
    const stub: Stub = { cfg, todo: [], percepts: [], ended: [], fail: false };
    by.set(cfg.id, stub);
    const brain: Brain = {
      id: cfg.id,
      tick(p) {
        if (stub.fail) throw new Error("scripted brain failure");
        stub.percepts.push(p);
        const out = stub.todo;
        stub.todo = [];
        return out;
      },
      end(result): RunSummary {
        stub.ended.push(result);
        return { tier: cfg.tier.id, persona: cfg.persona.id, faction: null, outcome: result?.outcome ?? "void", place: result?.place ?? 0, players: result?.players ?? 0, choices: [] };
      },
      goal: { kind: "idle" },
      stats: {} as BrainStats,
    };
    return brain;
  };
  return { factory, by };
}

/** One human, `bots` scripted bots, the lobby closed and the raid running with every bot's ring warm. */
function scriptedRun(bots: number, over: Partial<BotFillConfig> = {}, deps: Partial<BotManagerDeps> = {}) {
  const w = makeWorld();
  human(w, 0);
  const s = stubs();
  const m = manager(w, { fillTo: 1 + bots, ...over }, { createBrain: s.factory, ...deps });
  const ids = Array.from({ length: bots }, () => m.addBot()!.id);
  const loop = new Loop(w, m);
  w.state.lobbyEndsAt = w.state.serverTime;
  loop.tick();
  expect(w.state.phase).toBe("active");
  loop.until(() => ids.every((id) => s.by.get(id)!.percepts.length > 0), 60);
  return { w, m, loop, ids, by: s.by };
}

// ------------------------------------------------------------------------------------------------------------ the lobby

describe("the arrival schedule", () => {
  it("seats the bots one at a time over the last arrivalSeconds of the countdown, and never moves the countdown", () => {
    const w = makeWorld();
    const m = manager(w);
    human(w, 0);
    const arrivals: Array<{ t: number; size: number }> = [];
    let known = w.state.players.size;
    while (w.state.phase === "lobby") {
      m.lobbyTick();
      if (w.state.players.size !== known) {
        known = w.state.players.size;
        arrivals.push({ t: w.state.serverTime, size: known });
      }
      m.beforeStep(w.state.serverTime + TICK_MS);
      step(w, TICK_MS);
      if (w.state.phase === "lobby") expect(w.state.lobbyEndsAt).toBe(30_000);
    }
    expect(arrivals.map((a) => a.size)).toEqual([2, 3, 4]);
    for (const a of arrivals) {
      expect(a.t).toBeGreaterThanOrEqual(30_000 - 12_000);
      expect(a.t).toBeLessThanOrEqual(30_000 - 1000);
    }
    expect(arrivals.map((a) => a.t)).toEqual([...arrivals.map((a) => a.t)].sort((a, b) => a - b));
    expect(w.state.serverTime).toBe(30_000);
    expect(w.state.players.size).toBe(4);
    expect(m.stats.arrived).toBe(3);

    const bots = botsIn(w);
    expect(bots).toEqual(["bot~1", "bot~2", "bot~3"]);
    for (const id of bots) {
      expect(w.state.players.get(id)).toMatchObject({ bot: true, status: "alive", look: 0 });
      expect(w.players.get(id)!.bot).toBe(true);
      expect(m.isBot(id)).toBe(true);
    }
    expect(w.state.players.get("h0")!.bot).toBe(false);
    expect(m.isBot("h0")).toBe(false);
    expect(m.specs().map((s) => s.id)).toEqual(bots);
  });

  it("starts nobody before the window, however long the countdown is", () => {
    const w = makeWorld({ lobbySeconds: 120 });
    const m = manager(w);
    human(w, 0);
    for (let i = 0; i < 1000; i++) { // 50 s of a 120 s countdown
      m.lobbyTick();
      step(w, TICK_MS);
    }
    expect(w.state.players.size).toBe(1);
    expect(m.stats.arrived).toBe(0);
  });

  it("seats no one in a lobby with no human in it, and none after the last human left", () => {
    const empty = makeWorld();
    const m0 = manager(empty);
    for (let i = 0; i < 700; i++) { m0.lobbyTick(); step(empty, TICK_MS); }
    expect(empty.state.players.size).toBe(0);

    const w = makeWorld();
    const m = manager(w);
    human(w, 0);
    while (w.state.serverTime < 20_000) { m.lobbyTick(); step(w, TICK_MS); }
    removePlayer(w, "h0");
    const bots = w.state.players.size;
    expect(humansIn(w)).toBe(0);
    for (let i = 0; i < 100; i++) { m.lobbyTick(); step(w, TICK_MS); }
    m.lobbyClosing();
    expect(w.state.players.size).toBe(bots);
  });

  it("fills nothing when the humans alone reach the fill target, and never past MAX_PLAYERS", () => {
    const full = makeWorld();
    const mf = manager(full, { fillTo: 3 });
    for (let i = 0; i < 3; i++) human(full, i);
    while (full.state.phase === "lobby") { mf.lobbyTick(); step(full, TICK_MS); }
    expect(botsIn(full)).toEqual([]);

    const crowd = makeWorld({ lobbySeconds: 4 });
    const mc = manager(crowd, { fillTo: 99 });
    for (let i = 0; i < 6; i++) human(crowd, i);
    while (crowd.state.phase === "lobby") { mc.lobbyTick(); step(crowd, TICK_MS); }
    expect(crowd.state.players.size).toBe(MAX_PLAYERS);
    expect(botsIn(crowd)).toHaveLength(MAX_PLAYERS - 6);
  });

  it("keeps the same schedule when the latency changes: its arrivals come from a stream of their own", () => {
    const times = (latencyMs: number): number[] => {
      const w = makeWorld();
      const m = manager(w, { latencyMs, jitterMs: 20 });
      human(w, 0);
      const out: number[] = [];
      let known = 1;
      while (w.state.phase === "lobby") {
        m.lobbyTick();
        if (w.state.players.size !== known) { known = w.state.players.size; out.push(w.state.serverTime); }
        step(w, TICK_MS);
      }
      return out;
    };
    expect(times(30)).toEqual(times(300));
  });
});

describe("lobbyClosing", () => {
  it("tops the lobby up at once, in the step that starts the raid, whatever the schedule did", () => {
    const w = makeWorld({ lobbySeconds: 5 });
    const m = manager(w, { arrivalSeconds: 0 }); // the schedule never opens: the top-up has to do it all
    human(w, 0);
    let last: SimEvent[] = [];
    while (w.state.phase === "lobby") {
      m.lobbyTick();
      expect(w.state.players.size).toBe(1);
      last = step(w, TICK_MS);
    }
    expect(last).toContainEqual({ type: "raidStarted" });
    expect(w.state.players.size).toBe(4);
    expect(m.stats.arrived).toBe(3);
    expect(botsIn(w)).toHaveLength(3);
    for (const [, p] of w.state.players) expect(p.status).toBe("alive");
    // startRaid placed the late bots like everyone else: distinct spawns.
    expect(new Set([...w.state.players.values()].map((p) => `${p.x},${p.y}`)).size).toBe(4);
  });

  it("adds only the shortfall, at most up to MAX_PLAYERS, and nothing without a human", () => {
    const w = makeWorld();
    const m = manager(w, { fillTo: 6 });
    human(w, 0);
    human(w, 1);
    m.lobbyClosing();
    expect(w.state.players.size).toBe(6);
    m.lobbyClosing();
    expect(w.state.players.size).toBe(6);

    const wide = makeWorld();
    const mw = manager(wide, { fillTo: MAX_PLAYERS });
    for (let i = 0; i < 5; i++) human(wide, i);
    mw.lobbyClosing();
    expect(wide.state.players.size).toBe(MAX_PLAYERS);

    const none = makeWorld();
    const mn = manager(none);
    mn.lobbyClosing();
    expect(none.state.players.size).toBe(0);
  });

  it("chains onto a hook that was already installed, which still runs first", () => {
    const w = makeWorld();
    const order: string[] = [];
    w.hooks.lobbyClosing = () => order.push(`earlier:${w.state.players.size}`);
    const m = manager(w);
    human(w, 0);
    w.state.lobbyEndsAt = w.state.serverTime;
    step(w, TICK_MS);
    order.push(`later:${w.state.players.size}`);
    expect(order).toEqual(["earlier:1", "later:4"]);
    expect(m.stats.arrived).toBe(3);
  });
});

describe("a human and a bot's seat", () => {
  it("a human joining takes the latest arrival still to come, so the lobby ends at the fill target", () => {
    const arrivalsWith = (second: boolean): number[] => {
      const w = makeWorld({ minPlayers: 3 }); // two humans do not shorten the countdown
      const m = manager(w);
      human(w, 0);
      const out: number[] = [];
      let known = 1;
      while (w.state.phase === "lobby") {
        if (second && w.state.serverTime === 18_050) { human(w, 1); known++; }
        m.lobbyTick();
        if (w.state.players.size !== known) { known = w.state.players.size; out.push(w.state.serverTime); }
        step(w, TICK_MS);
      }
      expect(w.state.players.size).toBe(4);
      expect(humansIn(w)).toBe(second ? 2 : 1);
      return out;
    };
    const alone = arrivalsWith(false);
    const joined = arrivalsWith(true);
    expect(alone).toHaveLength(3);
    expect(joined).toEqual(alone.slice(0, 2));
  });

  it("a human joining shortens the countdown: the bots still to come are squeezed into what is left", () => {
    const w = makeWorld({ minPlayers: 2, fillSeconds: 5 });
    const m = manager(w);
    human(w, 0);
    while (w.state.serverTime < 18_050) { m.lobbyTick(); step(w, TICK_MS); }
    human(w, 1);
    const arrivals: number[] = [];
    let known = w.state.players.size;
    while (w.state.phase === "lobby") {
      m.lobbyTick();
      if (w.state.players.size !== known) { known = w.state.players.size; arrivals.push(w.state.serverTime); }
      step(w, TICK_MS);
    }
    const end = w.state.serverTime;
    expect(end).toBeLessThanOrEqual(18_100 + 5000);
    expect(w.state.players.size).toBe(4);
    // Every bot came on the schedule, not in the closing top-up of the last step.
    expect(arrivals.length).toBeGreaterThanOrEqual(1);
    for (const t of arrivals) expect(t).toBeLessThanOrEqual(end - 1000);
  });

  it("yieldSeat removes the newest lobby bot, so a human can take a full lobby's last seat", () => {
    const w = makeWorld();
    const m = manager(w, { fillTo: MAX_PLAYERS });
    human(w, 0);
    for (let i = 0; i < MAX_PLAYERS - 1; i++) expect(m.addBot()).not.toBeNull();
    expect(m.addBot()).toBeNull(); // full
    expect(w.state.players.size).toBe(MAX_PLAYERS);

    expect(m.yieldSeat()).toBe(true);
    expect(w.state.players.size).toBe(MAX_PLAYERS - 1);
    expect(w.state.players.has("bot~7")).toBe(false);
    expect(w.players.has("bot~7")).toBe(false);
    expect(m.isBot("bot~7")).toBe(false);
    expect(botsIn(w)).toHaveLength(MAX_PLAYERS - 2);
    human(w, 1);
    expect(w.state.players.size).toBe(MAX_PLAYERS);
    expect(m.stats.yielded).toBe(1);

    // Ids are not reused.
    expect(m.yieldSeat()).toBe(true);
    expect(m.addBot()!.id).toBe("bot~8");
  });

  it("yieldSeat does nothing without a bot, or once the raid is on", () => {
    const w = makeWorld();
    const m = manager(w);
    human(w, 0);
    expect(m.yieldSeat()).toBe(false);
    m.addBot();
    w.state.lobbyEndsAt = w.state.serverTime;
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(m.yieldSeat()).toBe(false);
    expect(botsIn(w).length).toBeGreaterThan(0);
  });

  it("seats no bot outside a lobby", () => {
    const w = makeWorld();
    const m = manager(w);
    human(w, 0);
    w.state.lobbyEndsAt = w.state.serverTime;
    step(w, TICK_MS);
    const before = w.state.players.size;
    expect(m.addBot()).toBeNull();
    expect(w.state.players.size).toBe(before);
  });
});

/** RaidRoom.onJoin, headless: a human joining a lobby that holds MAX_PLAYERS makes the newest bot give its seat up first. */
function joinHuman(w: World, m: BotManager, n: number): void {
  if (w.state.players.size >= MAX_PLAYERS) m.yieldSeat();
  human(w, n);
}

describe("an open lobby always has a seat for the next human", () => {
  it("each human the matchmaker admits gets one, until eight humans fill the lobby: only then does it close", () => {
    const w = makeWorld({ lobbySeconds: 600, minPlayers: 99 });
    const m = manager(w, { fillTo: MAX_PLAYERS });
    human(w, 0);
    for (let i = 0; i < MAX_PLAYERS - 1; i++) expect(m.addBot()).not.toBeNull();
    const loop = new Loop(w, m);
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      for (let i = 0; i < 3; i++) loop.tick(); // the lobby is full of players and has been for a while
      expect(w.state.phase, `before human ${n}`).toBe("lobby");
      joinHuman(w, m, n - 1);
      expect(w.state.players.has(`h${n - 1}`), `human ${n} has a seat`).toBe(true);
      expect(w.state.players.size).toBe(MAX_PLAYERS);
      expect(humansIn(w)).toBe(n);
      // The newest bot goes first: bot~1 is the last one standing.
      expect(botsIn(w), `human ${n}`).toEqual(Array.from({ length: MAX_PLAYERS - n }, (_, i) => `bot~${i + 1}`));
      loop.tick();
      expect(w.state.phase, `human ${n}`).toBe(n < MAX_PLAYERS ? "lobby" : "active");
    }
    expect(m.stats.yielded).toBe(MAX_PLAYERS - 1); // all seven bots, one per human after the first
    // Eight humans and not a bot to displace: the matchmaker's maxClients is what turns the ninth away (test/botGuards.test.ts).
    expect(botsIn(w)).toEqual([]);
    expect(m.yieldSeat()).toBe(false);
  });

  it("bots alone never start the raid: a lobby the fill brought to MAX_PLAYERS waits for the countdown", () => {
    const w = makeWorld();
    const m = manager(w, { fillTo: MAX_PLAYERS });
    human(w, 0);
    const loop = new Loop(w, m);
    let fullAt = -1;
    loop.until(() => {
      if (fullAt < 0 && w.state.players.size === MAX_PLAYERS) fullAt = w.state.serverTime;
      if (w.state.phase === "lobby") expect(w.state.lobbyEndsAt).toBe(30_000);
      return w.state.phase !== "lobby";
    });
    expect(fullAt).toBeGreaterThan(0);
    expect(fullAt).toBeLessThanOrEqual(30_000 - 1000); // the last arrival, with the lobby still open
    expect(w.state.serverTime).toBe(30_000); // and the raid starts when the countdown ends, not when the last bot is in
    expect(w.state.phase).toBe("active");
    expect(w.state.players.size).toBe(MAX_PLAYERS);
    expect(botsIn(w)).toHaveLength(MAX_PLAYERS - 1);
  });

  it("a lone human gets the same lobby time with BOTS_FILL_TO 8 as with no bots at all", () => {
    const lobby = (fillTo: number): { startedAt: number; size: number } => {
      const w = makeWorld();
      const m = manager(w, { fillTo });
      human(w, 0);
      const loop = new Loop(w, m);
      loop.until(() => w.state.phase !== "lobby");
      expect(w.state.lobbyEndsAt).toBe(30_000);
      return { startedAt: w.state.serverTime, size: w.state.players.size };
    };
    expect(lobby(0)).toEqual({ startedAt: 30_000, size: 1 });
    expect(lobby(MAX_PLAYERS)).toEqual({ startedAt: 30_000, size: MAX_PLAYERS });
  });

  it("humans joining while the bots arrive still end at the fill target, and the top-up never passes MAX_PLAYERS", () => {
    const w = makeWorld({ minPlayers: 99 }); // nobody shortens the countdown
    const m = manager(w, { fillTo: MAX_PLAYERS });
    human(w, 0);
    const loop = new Loop(w, m);
    loop.until(() => w.state.serverTime >= 22_000);
    expect(w.state.players.size).toBeGreaterThan(1);
    joinHuman(w, m, 1);
    joinHuman(w, m, 2);
    loop.until(() => w.state.phase !== "lobby");
    expect(w.state.serverTime).toBe(30_000);
    expect(w.state.players.size).toBe(MAX_PLAYERS);
    expect(humansIn(w)).toBe(3);
    expect(botsIn(w)).toHaveLength(MAX_PLAYERS - 3);
    for (const [id, p] of w.state.players) expect(p.status, id).toBe("alive");
  });

  it("the closing top-up seats bots up to the fill target and never above MAX_PLAYERS minus the humans", () => {
    for (const humans of [1, 2, 5, MAX_PLAYERS - 1, MAX_PLAYERS]) {
      for (const fillTo of [4, 6, MAX_PLAYERS, 99]) {
        const w = makeWorld();
        const m = manager(w, { fillTo });
        for (let i = 0; i < humans; i++) human(w, i);
        m.lobbyClosing();
        const wanted = Math.max(humans, Math.min(fillTo, MAX_PLAYERS));
        expect(w.state.players.size, `${humans} humans, fill ${fillTo}`).toBe(wanted);
        expect(botsIn(w), `${humans} humans, fill ${fillTo}`).toHaveLength(wanted - humans);
      }
    }
  });
});

// --------------------------------------------------------------------------------------------------------------- the fill

describe("who arrives", () => {
  it("draws tiers and personas by relative weight, not by share", () => {
    const w = makeWorld();
    const m = manager(w, { tierMix: { easy: 0, normal: 0, hard: 5 }, personaMix: { farmer: 0, hunter: 0, opportunist: 3, cautious: 0 }, fillTo: 8 });
    human(w, 0);
    for (let i = 0; i < 7; i++) m.addBot();
    expect(new Set(m.specs().map((s) => s.tier))).toEqual(new Set(["hard"]));
    expect(new Set(m.specs().map((s) => s.persona))).toEqual(new Set(["opportunist"]));
  });

  it("follows the tier mix over many draws (3:1 here), and every persona shows up with the default mix", () => {
    const w = makeWorld();
    const m = manager(w, { tierMix: { easy: 30, normal: 10, hard: 0 } }, {}, 11);
    human(w, 0);
    const seen = { easy: 0, normal: 0, hard: 0 };
    const personas = new Set<PersonaId>();
    for (let i = 0; i < 400; i++) {
      const spec = m.addBot()!;
      seen[spec.tier]++;
      personas.add(spec.persona);
      m.yieldSeat();
    }
    expect(seen.hard).toBe(0);
    expect(seen.easy / 400).toBeGreaterThan(0.65);
    expect(seen.easy / 400).toBeLessThan(0.85);
    expect(personas).toEqual(new Set(PERSONA_IDS));
  });

  it("never seats more than two of a faction, humans' picks counted, when there is room to avoid it", () => {
    const w = makeWorld();
    const m = manager(w, { fillTo: MAX_PLAYERS }, {}, 31);
    addPlayer(w, "h0", "human0", { faction: "frost" });
    for (let round = 0; round < 80; round++) {
      for (let i = 0; i < MAX_PLAYERS - 1; i++) m.addBot();
      const counts = new Map<string, number>();
      for (const p of w.state.players.values()) counts.set(p.faction, (counts.get(p.faction) ?? 0) + 1);
      for (const [faction, n] of counts) expect(n, `round ${round}: ${faction}`).toBeLessThanOrEqual(2);
      while (m.yieldSeat()) { /* the same lobby again */ }
    }
  });

  it("leans toward the factions the learned biases favour, and still plays them all", () => {
    const fireShare = (learned: LearnedBias): number => {
      const w = makeWorld();
      const store: BotStatsStoreApi = { snapshot: () => learned, record: () => {}, flush: () => {}, close: () => {} };
      const m = manager(w, {}, { store }, 21);
      human(w, 0);
      const seen = new Set<string>();
      let fire = 0;
      for (let i = 0; i < 500; i++) {
        const spec = m.addBot({ persona: "hunter" })!;
        seen.add(spec.faction);
        if (spec.faction === "fire") fire++;
        m.yieldSeat();
      }
      expect(seen).toEqual(new Set(FACTION_IDS));
      return fire / 500;
    };
    const favour: LearnedBias = { enabled: true, bias: (key: ChoiceKey) => (key === "faction|hunter|fire" ? 0.25 : 0) };
    const flat = fireShare(NO_BIAS);
    expect(flat).toBeGreaterThan(0.14);
    expect(flat).toBeLessThan(0.27);
    expect(fireShare(favour)).toBeGreaterThan(flat + 0.08);
  });
});

describe("callsigns", () => {
  const lower = (names: Iterable<string>): string[] => [...names].map((n) => n.toLowerCase());

  it("never repeats a name in the room, in any case, and never takes one a profile has", () => {
    const w = makeWorld();
    // Humans with pool names in odd cases, and profiles that own many more.
    const owned = new Set(CALLSIGN_POOL.filter((_, i) => i % 3 === 0).map((n) => n.toLowerCase()));
    const m = manager(w, { fillTo: MAX_PLAYERS }, { isNameTaken: (n) => owned.has(n.toLowerCase()) }, 17);
    const mine = ["WREN", "kestrel_7", "Mossy"].filter((n) => !owned.has(n.toLowerCase()));
    mine.forEach((name, i) => human(w, i, name));
    for (let round = 0; round < 60; round++) {
      while (m.addBot() !== null) { /* fill the lobby */ }
      const names = lower([...w.state.players.values()].map((p) => p.name));
      expect(new Set(names).size, `round ${round}: ${names.join(",")}`).toBe(names.length);
      for (const spec of m.specs()) expect(owned.has(spec.name.toLowerCase()), `round ${round}: ${spec.name}`).toBe(false);
      while (m.yieldSeat()) { /* and again */ }
    }
  });

  it("falls back to a numbered name when the whole pool is taken", () => {
    const w = makeWorld();
    const m = manager(w, {}, { isNameTaken: (n) => CALLSIGN_POOL.some((p) => p.toLowerCase() === n.toLowerCase()) });
    human(w, 0);
    const a = m.addBot()!;
    const b = m.addBot()!;
    expect(CALLSIGN_POOL.map((n) => n.toLowerCase())).not.toContain(a.name.toLowerCase());
    expect(a.name).toMatch(/^[A-Za-z_]+\d\d$/);
    expect(b.name.toLowerCase()).not.toBe(a.name.toLowerCase());
  });
});

// ----------------------------------------------------------------------------------------------------------- the delay line

describe("the delay line", () => {
  it("applies a command at the first step at or after its click plus the latency (no jitter)", () => {
    for (const latencyMs of [0, 30, 120, 175]) {
      const { w, loop, ids, by } = scriptedRun(1, { latencyMs, jitterMs: 0 });
      const id = ids[0]!;
      const seen: Array<{ stepT: number; id: string }> = [];
      loop.observe = () => {
        for (const a of w.players.get(id)!.inputs.actions) if (a.kind === "target") seen.push({ stepT: w.state.serverTime + TICK_MS, id: a.id });
      };
      const expected: Array<{ stepT: number; id: string }> = [];
      for (let i = 0; i < 16; i++) {
        const stepT = w.state.serverTime + TICK_MS; // the step this tick runs; the frame after it sends
        const at = stepT - [0, 10, 25, 49][i % 4]!;
        by.get(id)!.todo = [click(at, lock(`c${i}`))];
        // Sent after this step, so it can arrive at the next one at the earliest; then not before at + latency.
        let due = stepT + TICK_MS;
        while (due < at + latencyMs) due += TICK_MS;
        expected.push({ stepT: due, id: `c${i}` });
        loop.tick();
      }
      loop.until(() => seen.length >= 16, 20);
      expect(seen, `latency ${latencyMs}`).toEqual(expected);
    }
  });

  it("never reorders, however the jitter falls, and keeps every arrival inside its latency band", () => {
    const latencyMs = 100, jitterMs = 60;
    const { w, loop, ids, by, m } = scriptedRun(1, { latencyMs, jitterMs });
    const id = ids[0]!;
    const got: Array<{ id: string; stepT: number }> = [];
    loop.observe = () => {
      for (const a of w.players.get(id)!.inputs.actions) if (a.kind === "target") got.push({ id: a.id, stepT: w.state.serverTime + TICK_MS });
    };
    const clicks = new Map<string, number>();
    for (let i = 0; i < 40; i++) {
      const stepT = w.state.serverTime + TICK_MS;
      const tag = `t${i}`;
      // A pair every other tick, the second timestamped earlier than the first: the line must still deliver them in the order sent.
      if (i % 2 === 0) {
        clicks.set(`${tag}a`, stepT);
        clicks.set(`${tag}b`, stepT - 40);
        by.get(id)!.todo = [click(stepT, lock(`${tag}a`)), click(stepT - 40, lock(`${tag}b`))];
      }
      loop.tick();
    }
    loop.until(() => got.length >= 40, 30);
    expect(w.players.get(id)!.inputs.dropped).toBe(0); // the queue's per-tick limit never cut into the order
    expect(got.map((g) => g.id)).toEqual(Array.from({ length: 20 }, (_, i) => [`t${i * 2}a`, `t${i * 2}b`]).flat());
    for (let i = 1; i < got.length; i++) expect(got[i]!.stepT).toBeGreaterThanOrEqual(got[i - 1]!.stepT);
    for (const g of got) expect(g.stepT, g.id).toBeGreaterThanOrEqual(clicks.get(g.id)! + latencyMs - jitterMs);
    expect(m.stats).toMatchObject({ sent: 40, applied: 40, refused: 0, lost: 0 });
    expect(m.inFlight).toBe(0);
  });

  it("draws its jitter from a stream of its own: the same seed and clicks give the same arrivals", () => {
    const arrivals = (): number[] => {
      const { w, loop, ids, by } = scriptedRun(1, { latencyMs: 60, jitterMs: 40 });
      const seen: number[] = [];
      loop.observe = () => { if (w.players.get(ids[0]!)!.inputs.move !== null) seen.push(w.state.serverTime); };
      for (let i = 0; i < 30; i++) {
        by.get(ids[0]!)!.todo = [click(w.state.serverTime + TICK_MS - 5, move(10 + i))];
        loop.tick();
      }
      loop.until(() => seen.length >= 30, 20);
      return seen;
    };
    expect(arrivals()).toEqual(arrivals());
  });

  it("hands every command to enqueueClientMessage and counts the ones it refuses", () => {
    const { w, m, loop, ids, by } = scriptedRun(1);
    const id = ids[0]!;
    by.get(id)!.todo = [
      click(w.state.serverTime, move(300)),
      click(w.state.serverTime, { type: "move", msg: { x: Number.NaN, y: 5 } }),
      click(w.state.serverTime, { type: "target", msg: { id: "" } }),
      click(w.state.serverTime, { type: "swap", msg: { slot: 1 } }),
    ];
    loop.until(() => m.inFlight === 0 && m.stats.sent > 0, 30);
    expect(m.stats).toMatchObject({ sent: 4, applied: 2, refused: 2 });
  });

  it("never sends a message the server does not take", () => {
    const only: Features = {
      messageTypes: ["move", "stop"], wishes: false, statusEffects: false, fields: false, planning: false, chests: false,
      skills: false, relics: false, camps: false, hazards: false,
    };
    const { w, m, loop, ids, by } = scriptedRun(1, {}, { features: only });
    by.get(ids[0]!)!.todo = [click(w.state.serverTime, lock("x")), click(w.state.serverTime, move(5))];
    loop.until(() => m.inFlight === 0 && m.stats.sent > 0, 30);
    expect(m.stats).toMatchObject({ sent: 1, applied: 1, refused: 0 });
  });

  it("drops commands that come due for a bot that is gone, and a bot's result empties its line", () => {
    const { w, m, loop, ids, by } = scriptedRun(2, { latencyMs: 200, jitterMs: 0 });
    const [gone, out] = ids as [string, string];
    by.get(gone)!.todo = [click(w.state.serverTime, move(5))];
    by.get(out)!.todo = [click(w.state.serverTime, move(6))];
    loop.tick();
    expect(m.inFlight).toBe(2);
    abandonPlayer(w, gone); // out of the world with no result: the manager is not told
    removePlayer(w, out); // goes MIA: its result ends it, and what it had in flight is dropped with it
    loop.until(() => m.inFlight === 0, 20);
    expect(m.stats).toMatchObject({ sent: 2, applied: 0, lost: 1, results: 1 });
  });
});

// -------------------------------------------------------------------------------------------------------------- the frames

describe("the frames", () => {
  it("runs a brain only for a bot standing in a running raid, one frame per patch", () => {
    const w = makeWorld();
    human(w, 0);
    const s = stubs();
    const m = manager(w, { fillTo: 2 }, { createBrain: s.factory });
    const id = m.addBot()!.id;
    const loop = new Loop(w, m);
    for (let i = 0; i < 20; i++) loop.tick();
    expect(w.state.phase).toBe("lobby");
    expect(s.by.get(id)!.percepts).toHaveLength(0);

    w.state.lobbyEndsAt = w.state.serverTime;
    loop.until(() => s.by.get(id)!.percepts.length > 0, 60);
    const framesAtFirst = m.stats.frames;
    const ticks = s.by.get(id)!.percepts.length;
    for (let i = 0; i < 10; i++) loop.tick();
    expect(s.by.get(id)!.percepts.length).toBe(ticks + 10);
    expect(m.stats.frames).toBe(framesAtFirst + 10);

    // Down: no more frames.
    const p = w.state.players.get(id)!;
    applyDamage(w, p, w.players.get(id)!, p.hp + 1000, { id: "h0", p: w.state.players.get("h0")!, rt: w.players.get("h0")! });
    loop.tick();
    expect(p.status).toBe("dead");
    const after = s.by.get(id)!.percepts.length;
    for (let i = 0; i < 10; i++) loop.tick();
    expect(s.by.get(id)!.percepts).toHaveLength(after);
  });

  it("gives each frame the very state and the fx batches of the patch, and the toasts addressed to the bot", () => {
    const { w, m, loop, ids, by } = scriptedRun(1);
    const id = ids[0]!;
    m.onToast(id, "Too far away");
    m.onToast("someone-else", "ignored");
    m.onPrivate(id, "plan", { spawn: 1 });
    const p = by.get(id)!;
    const before = p.percepts.length;
    loop.until(() => p.percepts.slice(before).some((x) => x.events.some((e) => e.kind === "toast")), 20);
    const events = p.percepts.slice(before).flatMap((x) => x.events);
    expect(events.filter((e) => e.kind === "toast")).toMatchObject([{ text: "Too far away" }]);
    expect(events.filter((e) => e.kind === "private")).toMatchObject([{ type: "plan", msg: { spawn: 1 } }]);
    // Delivered once.
    expect(p.percepts.slice(before).flatMap((x) => x.events).filter((e) => e.kind === "toast")).toHaveLength(1);
    expect(m.isBot("someone-else")).toBe(false);
  });

  it("a brain that throws costs that bot its turn, not the room its tick", () => {
    const { m, loop, ids, by } = scriptedRun(2);
    const [a, b] = ids as [string, string];
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      by.get(a)!.fail = true;
      const bBefore = by.get(b)!.percepts.length;
      for (let i = 0; i < 10; i++) loop.tick();
      expect(m.stats.errors).toBe(1);
      expect(quiet).toHaveBeenCalledTimes(1);
      expect(by.get(b)!.percepts.length).toBe(bBefore + 10);
    } finally {
      quiet.mockRestore();
    }
  });

  it("gives all of a room's bots one path-search allowance per patch", () => {
    const w = makeWorld();
    human(w, 0);
    const searches: number[] = [];
    const seen: BrainConfig[] = [];
    const factory: BrainFactory = (cfg) => {
      seen.push(cfg);
      return {
        id: cfg.id,
        tick(p) {
          // Every bot asks for many different trips every frame.
          for (let i = 0; i < 20; i++) cfg.services.paths.walk(p.self, { x: 200 + i * 40 + seen.indexOf(cfg) * 7, y: 400 });
          return [];
        },
        end: () => ({ tier: "easy", persona: "farmer", faction: null, outcome: "void", place: 0, players: 0, choices: [] }),
        goal: { kind: "idle" },
        stats: {} as BrainStats,
      };
    };
    const m = manager(w, { fillTo: 4 }, { createBrain: factory });
    for (let i = 0; i < 3; i++) m.addBot();
    const loop = new Loop(w, m);
    w.state.lobbyEndsAt = w.state.serverTime;
    loop.until(() => w.state.phase === "active", 10);
    const stat = (): number => seen.reduce((n, c) => n + (c.services.paths as unknown as { stats: { searches: number } }).stats.searches, 0);
    loop.until(() => stat() > 0, 30);
    for (let i = 0; i < 5; i++) {
      const before = stat();
      loop.tick();
      searches.push(stat() - before);
    }
    expect(Math.max(...searches)).toBeLessThanOrEqual(BOT_PATH_BUDGET_PER_TICK);
    expect(searches.some((n) => n > 0)).toBe(true);
  });
});

// ----------------------------------------------------------------------------------------------------- results and storage

describe("results", () => {
  /** A ProfileStore that fails the test on any call but a name lookup: the manager has no business with the rest. */
  function tripwire(): { profiles: ProfileStore; lookups: string[] } {
    const lookups: string[] = [];
    const profiles = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "get") return (name: string) => { lookups.push(name); return undefined; };
        return () => { throw new Error(`the profile store was touched: ${String(prop)}`); };
      },
    }) as ProfileStore;
    return { profiles, lookups };
  }

  function playedOut(extra: Partial<BotManagerDeps> = {}) {
    const w = makeWorld();
    const { profiles, lookups } = tripwire();
    const spy = spyStore();
    const m = manager(w, { fillTo: 4 }, { store: spy.store, isNameTaken: (n) => profiles.get(n) !== undefined, ...extra });
    human(w, 0);
    for (let i = 0; i < 3; i++) m.addBot();
    const loop = new Loop(w, m);
    w.state.lobbyEndsAt = w.state.serverTime;
    loop.tick();
    for (let i = 0; i < 10; i++) loop.tick(); // the brains have seen themselves by now
    return { w, m, loop, profiles, lookups, spy };
  }

  it("go to the learning store only: nothing is banked, no profile is created, whatever the bot did", () => {
    const { w, m, loop, lookups, spy } = playedOut();
    expect(lookups.length).toBeGreaterThan(0);
    const human0 = { id: "h0", p: w.state.players.get("h0")!, rt: w.players.get("h0")! };
    const [first, ...rest] = botsIn(w);
    // The human kills two bots; the third dies to the first (a bot's kill of a bot).
    for (const id of [first!, rest[0]!]) {
      const p = w.state.players.get(id)!;
      applyDamage(w, p, w.players.get(id)!, p.hp + 1000, human0);
    }
    const last = w.state.players.get(rest[1]!)!;
    applyDamage(w, last, w.players.get(rest[1]!)!, last.hp + 1000, { id: first!, p: w.state.players.get(first!)!, rt: w.players.get(first!)! });
    loop.tick();

    expect(m.stats.results).toBe(3);
    expect(spy.record).toHaveBeenCalledTimes(3);
    const specs = new Map(m.specs().map((s) => [s.id, s]));
    for (const [summary] of spy.record.mock.calls as Array<[RunSummary]>) {
      expect(summary).toMatchObject({ outcome: "died", players: 4 });
      expect(TIER_IDS).toContain(summary.tier);
      expect(PERSONA_IDS).toContain(summary.persona);
    }
    expect(new Set((spy.record.mock.calls as Array<[RunSummary]>).map(([s]) => `${s.tier}/${s.persona}/${s.faction}`)))
      .toEqual(new Set([...specs.values()].map((s) => `${s.tier}/${s.persona}/${s.faction}`)));
    // The tripwire never went off (it would have thrown inside the loop); the only thing asked of the registry was names.
    for (const name of new Set(lookups)) expect(typeof name).toBe("string");
    // A bot's result is delivered once.
    m.onResult(first!, {} as RunResult);
    expect(spy.record).toHaveBeenCalledTimes(3);
  });

  it("are not recorded for a bot the room closed on: dispose records nothing", () => {
    const { m, spy } = playedOut();
    m.dispose();
    expect(spy.record).not.toHaveBeenCalled();
    expect(spy.flush).toHaveBeenCalledTimes(1);
    m.dispose();
    expect(spy.flush).toHaveBeenCalledTimes(1);
  });

  it("do not need a store at all (learning off)", () => {
    const w = makeWorld();
    const m = manager(w, { fillTo: 2 });
    human(w, 0);
    const id = m.addBot()!.id;
    const loop = new Loop(w, m);
    w.state.lobbyEndsAt = w.state.serverTime;
    loop.tick();
    const p = w.state.players.get(id)!;
    applyDamage(w, p, w.players.get(id)!, p.hp + 1000, { id: "h0", p: w.state.players.get("h0")!, rt: w.players.get("h0")! });
    loop.tick();
    expect(m.stats.results).toBe(1);
  });

  it("ignore a result for someone who is not one of its bots", () => {
    const { m, spy } = playedOut();
    m.onResult("h0", {} as RunResult);
    m.onResult("bot~99", {} as RunResult);
    expect(spy.record).not.toHaveBeenCalled();
  });

  it("the manager's source has no way to the profile store", () => {
    const src = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../src/bots/BotManager.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*(persistence|ProfileStore)/);
    expect(src).not.toMatch(/\brecordRun\b|\bbankGv\b|\.claim\(/);
  });
});

describe("the stats file", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function filed() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-botmgr-"));
    dirs.push(dir);
    const file = path.join(dir, "bot-stats.json");
    let clock = 0;
    const store = createBotStatsStore(file, { forbid: [path.join(dir, "stash.json")], now: () => clock });
    const w = makeWorld();
    const m = manager(w, { fillTo: 3 }, { store });
    human(w, 0);
    m.addBot();
    m.addBot();
    const loop = new Loop(w, m);
    w.state.lobbyEndsAt = w.state.serverTime;
    loop.tick();
    const kill = (id: string): void => {
      const p = w.state.players.get(id)!;
      applyDamage(w, p, w.players.get(id)!, p.hp + 1000, { id: "h0", p: w.state.players.get("h0")!, rt: w.players.get("h0")! });
      loop.tick();
    };
    return { file, store, m, w, loop, kill, advance: (ms: number) => { clock += ms; } };
  }

  const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as { baseline: Record<string, { n: number }> };
  const runsIn = (file: string): number => Object.values(read(file).baseline).reduce((n, c) => n + c.n, 0);

  it("is written when a bot's result comes in, and a result still waiting for the next write is flushed on dispose", () => {
    const { file, m, kill } = filed();
    const [a, b] = botsOf(m);
    expect(fs.existsSync(file)).toBe(false);
    kill(a!);
    expect(runsIn(file)).toBeCloseTo(1, 9); // the first result writes at once
    kill(b!);
    expect(runsIn(file)).toBeCloseTo(1, 9); // the second waits for the 10 s coalescing window
    m.dispose();
    expect(runsIn(file)).toBeGreaterThan(1.9); // two runs (a tier's count decays 1% a run)
  });

  it("is not created for bots that never got a result", () => {
    const { file, m, loop } = filed();
    for (let i = 0; i < 20; i++) loop.tick();
    m.dispose();
    expect(fs.existsSync(file)).toBe(false);
  });

  it("is read back by the bots that join afterwards", () => {
    const { store, kill, m } = filed();
    kill(botsOf(m)[0]!);
    expect(store.snapshot().enabled).toBe(true);
  });
});

function botsOf(m: BotManager): string[] {
  return m.specs().map((s) => s.id);
}

// ------------------------------------------------------------------------------------------------------------- real brains

describe("real brains", () => {
  interface Played {
    specs: unknown;
    stats: unknown;
    state: unknown;
    moved: number;
    phase: string;
  }

  function play(seed: number, ticks = 700): Played {
    const w = makeWorld({ mobs: true, lobbySeconds: 6 }, 99);
    human(w, 0);
    const m = manager(w, { fillTo: 4, arrivalSeconds: 4 }, {}, seed);
    const loop = new Loop(w, m);
    let spawn: Record<string, { x: number; y: number }> = {};
    for (let i = 0; i < ticks; i++) {
      loop.tick();
      if (i === 160 && Object.keys(spawn).length === 0) {
        spawn = Object.fromEntries(botsIn(w).map((id) => [id, { x: w.state.players.get(id)!.x, y: w.state.players.get(id)!.y }]));
      }
    }
    let moved = 0;
    for (const id of botsIn(w)) {
      const p = w.state.players.get(id)!;
      if (p.status === "alive" && Math.hypot(p.x - spawn[id]!.x, p.y - spawn[id]!.y) > 60) moved++;
    }
    return {
      specs: m.specs(),
      stats: { ...m.stats },
      state: [...w.state.players].map(([id, p]) => [id, p.name, p.faction, p.status, Math.round(p.x), Math.round(p.y), Math.round(p.hp), p.kills, p.moveSeq]),
      moved,
      phase: w.state.phase,
    };
  }

  it("play a run: they move, act and send only what the server accepts", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const run = play(5);
      expect(run.phase).toBe("active");
      const stats = run.stats as { sent: number; applied: number; refused: number; errors: number; frames: number; lost: number; arrived: number };
      expect(stats.arrived).toBe(3);
      expect(stats.errors).toBe(0);
      expect(stats.refused).toBe(0);
      expect(stats.sent).toBeGreaterThan(20);
      expect(stats.applied).toBeGreaterThan(0);
      expect(stats.applied + stats.lost).toBeLessThanOrEqual(stats.sent);
      expect(stats.frames).toBeGreaterThan(300);
      expect(run.moved).toBeGreaterThanOrEqual(1);
      expect(quiet).not.toHaveBeenCalled();
    } finally {
      quiet.mockRestore();
    }
  });

  it("replay exactly from the seed, and differ with another", () => {
    const a = play(5, 500);
    expect(play(5, 500)).toEqual(a);
    const other = play(6, 500);
    expect(other.specs).not.toEqual(a.specs);
  });

  it("run the same brain the network client does: createBrain, seeded from the spec", () => {
    const seen: BrainConfig[] = [];
    const w = makeWorld();
    human(w, 0);
    const m = manager(w, { fillTo: 3 }, { createBrain: (cfg) => { seen.push(cfg); return createBrain(cfg); } }, 3);
    const a = m.addBot()!;
    const b = m.addBot()!;
    expect(a.seed).not.toBe(b.seed);
    expect(seen.map((c) => [c.id, c.name, c.seed, c.tier.id, c.persona.id])).toEqual(
      [a, b].map((s) => [s.id, s.name, s.seed, s.tier, s.persona]),
    );
    for (const c of seen) {
      expect(c.map).toBe(w.map);
      expect(c.features.messageTypes).toEqual(expect.arrayContaining([...CORE_MESSAGES]));
      expect(c.learned).toBe(NO_BIAS);
    }
  });
});
