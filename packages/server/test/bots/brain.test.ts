// brain.ts and modules/index.ts (docs/BOTS.md 4, 8): the tick loop that composes memory, strategy, tactics, the feature modules
// and the humanizer. The layers have their own tests; these check what only the composition does: the cadence, the order of
// the steps, the seq on orders, the missed-click round trip, the stall watch, the stats, the module seam and a long run.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BOT_VIEW, TIER_IDS, TIERS, PRIORITY } from "../../src/bots/brain/types";
import { findPath, mulberry32, PLAYER_SPEED, TARGET_RANGE, type RunResult, type Vec2, type WeaponId } from "@raid/shared";
import { createBrain } from "../../src/bots/brain/brain";
import {
  enabledModules, getCastPolicy, registerCastPolicy, registerModule, resetModules,
} from "../../src/bots/brain/modules/index";
import { createPathBudget, createPathService, type PathBudget } from "../../src/bots/brain/services";
import type {
  Brain, BrainConfig, BrainContext, Command, ContainerView, FeatureModule, Features, FighterView, Intent, ObservedEvent, Percept,
  PersonaId, Stimulus, TierId, TierParams, TimedCommand,
} from "../../src/bots/brain/types";
import { InputQueue, enqueueClientMessage } from "../../src/sim/inputs";
import { brainConfig, container, CORE_MESSAGES, features, fighter, hudView, mobView, percept, selfView, testMap } from "./fixtures";

const T0 = 100_000;
const FRAME_MS = 50;
const CORE_TYPES = new Set(["move", "stop", "target", "swap", "pickup"]);
const me = selfView();

interface Rig {
  readonly brain: Brain;
  readonly cfg: BrainConfig;
  readonly budget: PathBudget;
  readonly logs: string[];
}

function rig(tier: TierId | TierParams = "normal", persona: PersonaId = "hunter", over: Partial<BrainConfig> = {}): Rig {
  const map = over.map ?? testMap();
  const budget = createPathBudget();
  const logs: string[] = [];
  const t = typeof tier === "string" ? tier : tier.id;
  const cfg = brainConfig(t, persona, {
    seed: 1, services: { paths: createPathService(map, budget), log: (m) => logs.push(m) },
    ...(typeof tier === "string" ? {} : { tier }), ...over,
  });
  return { brain: createBrain(cfg), cfg, budget, logs };
}

interface Released {
  /** The frame it came out of. */
  readonly frame: number;
  readonly tc: TimedCommand;
}

/** Ticks `frames` percepts built by `scene(i, now)` and returns every released command. */
function drive(r: Rig, frames: number, scene: (i: number, now: number) => Partial<Percept> = () => ({})): Released[] {
  const out: Released[] = [];
  for (let i = 0; i < frames; i++) {
    r.budget.startTick();
    const now = T0 + i * FRAME_MS;
    for (const tc of r.brain.tick(percept({ now, ...scene(i, now) }))) out.push({ frame: now, tc });
  }
  return out;
}

/** A foe at half its hp: a fight even a Hard hunter wants (it does not open an even one, docs/BOTS_TUNING.md 3). */
const foeScene = () => ({ fighters: [prey({ hpFrac: 0.5 })] });

/** Asserts what a driver relies on: only core client messages, each accepted by the server's own validation. */
function assertSendable(cmds: readonly Released[]): void {
  for (const { tc } of cmds) {
    expect(["aim", "attack", "release"]).not.toContain(tc.cmd.type);
    if (CORE_TYPES.has(tc.cmd.type)) expect(enqueueClientMessage(new InputQueue(), tc.cmd.type, tc.cmd.msg)).toBe(true);
  }
}

/** The most commands in any 60 s window, and the shortest gap between two. */
function rate(cmds: readonly Released[]): { peak: number; minGap: number } {
  const ats = cmds.map((c) => c.tc.at).sort((a, b) => a - b);
  let peak = 0;
  let lo = 0;
  let minGap = Infinity;
  for (let i = 0; i < ats.length; i++) {
    while (ats[i]! - ats[lo]! >= 60_000) lo++;
    peak = Math.max(peak, i - lo + 1);
    if (i > 0) minGap = Math.min(minGap, ats[i]! - ats[i - 1]!);
  }
  return { peak, minGap };
}

// ----------------------------------------------------------------------------------------------------- a reactive stage

/** The foe the tests like to see: one fire beats, holding a weapon an axe beats, with its tint on (so even an Easy bot reads it). */
const prey = (over: Partial<FighterView> = {}): FighterView => fighter({ faction: "plague", inHand: "wand", tint: 1, ...over });

/**
 * A tiny world around one bot, enough for the brain to see its own orders take effect. The bot walks the shared A* path at full
 * speed, a lock chases the foe, a foe next to it trades blows (it dies, and another walks in a few seconds later), loose weapons
 * lie about, and every order lands 40 ms after it was clicked. The foe wanders between spawns at 100 u/s.
 */
class Stage {
  now = T0;
  x: number;
  y: number;
  hp = 100;
  moveSeq = 0;
  lock: string | null = null;
  kills = 0;
  weapons: [WeaponId | null, WeaponId | null] = ["axe", null];
  foe: { id: string; x: number; y: number; hp: number; alive: boolean };
  private foeV: Vec2 = { x: 0, y: 0 };
  private path: Vec2[] = [];
  private foePath: Vec2[] = [];
  private inbox: Array<{ at: number; cmd: Command }> = [];
  private events: ObservedEvent[] = [];
  private foeCount = 1;
  private respawnAt = 0;
  private replanAt = 0;
  private blowAt = 0;
  private readonly loose = new Map<string, Vec2>();
  private readonly rnd;

  constructor(private readonly foeBot = false, seed = 1, private readonly features_: Features = features()) {
    const map = testMap();
    this.x = map.spawns[0]!.x;
    this.y = map.spawns[0]!.y;
    this.foe = { id: "foe", x: map.spawns[1]!.x, y: map.spawns[1]!.y, hp: 100, alive: true };
    for (const i of [2, 3, 4]) this.loose.set(`g${i}`, { x: map.spawns[i]!.x, y: map.spawns[i]!.y });
    this.rnd = mulberry32(seed * 7919 + 13);
  }

  percept(): Percept {
    const self = selfView({
      x: this.x, y: this.y, moveSeq: this.moveSeq, attackTarget: this.lock, hp: this.hp, kills: this.kills, weapons: this.weapons,
    });
    const inWindow = (q: Vec2): boolean => Math.abs(q.x - this.x) <= BOT_VIEW.halfW && Math.abs(q.y - this.y) <= BOT_VIEW.halfH;
    const f = this.foe;
    const containers: ContainerView[] = [];
    for (const [id, q] of this.loose) {
      if (!inWindow(q)) continue;
      const d = Math.hypot(q.x - this.x, q.y - this.y);
      containers.push(container({ id, x: q.x, y: q.y, dist: d, weapon: "bow", interactable: d <= 40 }));
    }
    const events = this.events;
    this.events = [];
    return percept({
      now: this.now, self, hud: hudView({ phase: "active" }), features: this.features_, events, containers,
      fighters: f.alive && inWindow(f)
        ? [prey({
          id: f.id, bot: this.foeBot, x: f.x, y: f.y, dist: Math.hypot(f.x - this.x, f.y - this.y), vx: this.foeV.x, vy: this.foeV.y,
          hpFrac: Math.round(f.hp / 5) / 20,
        })]
        : [],
    });
  }

  send(cmds: readonly TimedCommand[]): void {
    for (const c of cmds) this.inbox.push({ at: c.at + 40, cmd: c.cmd });
  }

  advance(): void {
    this.now += FRAME_MS;
    const due = this.inbox.filter((i) => i.at <= this.now);
    this.inbox = this.inbox.filter((i) => i.at > this.now);
    for (const { cmd } of due) this.apply(cmd);
    const dt = FRAME_MS / 1000;
    const f = this.foe;
    const gap = Math.hypot(f.x - this.x, f.y - this.y);
    if (this.lock !== null) {
      if (!f.alive || gap > TARGET_RANGE) this.lock = null;
      else if (gap <= 40) this.path = [];
      else if (this.now >= this.replanAt) {
        this.path = findPath(testMap(), this, f);
        this.replanAt = this.now + 400;
      }
    }
    this.walk(this, this.path, PLAYER_SPEED * dt, null);
    if (f.alive) {
      if (this.foePath.length === 0) {
        const s = testMap().spawns[Math.floor(this.rnd() * testMap().spawns.length)]!;
        this.foePath = findPath(testMap(), f, s);
      }
      this.walk(f, this.foePath, 100 * dt, this.foeV);
    } else if (this.now >= this.respawnAt) {
      const s = testMap().spawns[Math.floor(this.rnd() * testMap().spawns.length)]!;
      this.foe = { id: `foe${++this.foeCount}`, x: s.x, y: s.y, hp: 100, alive: true };
      this.foePath = [];
    }
    this.fight();
  }

  /** Next to a living foe the two trade a blow every half second; the foe dies at 0 and a new one comes a few seconds later. */
  private fight(): void {
    const f = this.foe;
    if (!f.alive || this.now < this.blowAt || Math.hypot(f.x - this.x, f.y - this.y) > 60) return;
    this.blowAt = this.now + 500;
    const at = { x: this.x, y: this.y };
    this.hp = Math.max(5, this.hp - 5);
    this.events.push({ kind: "hit", t: this.now, at, id: "me", by: f.id, amount: 5, weapon: "wand", sig: null });
    if (this.lock !== f.id) return;
    f.hp -= 12;
    this.events.push({ kind: "hit", t: this.now, at: { x: f.x, y: f.y }, id: f.id, by: "me", amount: 12, weapon: "axe", sig: null });
    if (f.hp > 0) return;
    f.alive = false;
    this.kills++;
    this.lock = null;
    this.respawnAt = this.now + 4000;
    this.events.push({ kind: "death", t: this.now, at: { x: f.x, y: f.y }, id: f.id, name: "Foe", by: "me", mob: false });
  }

  private apply(cmd: Command): void {
    switch (cmd.type) {
      case "move":
        this.path = findPath(testMap(), this, cmd.msg);
        this.lock = null;
        if (cmd.msg.seq !== undefined) this.moveSeq = cmd.msg.seq;
        break;
      case "stop":
        this.path = [];
        this.lock = null;
        if (cmd.msg.seq !== undefined) this.moveSeq = cmd.msg.seq;
        break;
      case "target":
        if (cmd.msg.id === this.foe.id && this.foe.alive && Math.hypot(this.foe.x - this.x, this.foe.y - this.y) <= TARGET_RANGE) {
          this.lock = this.foe.id;
          this.path = [];
          this.replanAt = 0;
        }
        break;
      case "swap":
        if (this.weapons[1] !== null) this.weapons = [this.weapons[1], this.weapons[0]];
        break;
      case "pickup": {
        const q = this.loose.get(cmd.msg.containerId);
        if (q && this.weapons[1] === null && Math.hypot(q.x - this.x, q.y - this.y) <= 56) {
          this.weapons = [this.weapons[0], "bow"];
          this.loose.delete(cmd.msg.containerId);
        }
        break;
      }
      default:
    }
  }

  private walk(at: { x: number; y: number }, path: Vec2[], step: number, v: Vec2 | null): void {
    const x0 = at.x;
    const y0 = at.y;
    let left = step;
    while (left > 0 && path.length > 0) {
      const w = path[0]!;
      const d = Math.hypot(w.x - at.x, w.y - at.y);
      if (d <= left) {
        at.x = w.x;
        at.y = w.y;
        left -= d;
        path.shift();
      } else {
        at.x += ((w.x - at.x) / d) * left;
        at.y += ((w.y - at.y) / d) * left;
        left = 0;
      }
    }
    if (v) {
      v.x = (at.x - x0) / (FRAME_MS / 1000);
      v.y = (at.y - y0) / (FRAME_MS / 1000);
    }
  }
}

/** Runs the brain against the stage for `frames` frames. */
function play(r: Rig, stage: Stage, frames: number, each?: (i: number) => void): Released[] {
  const out: Released[] = [];
  for (let i = 0; i < frames; i++) {
    r.budget.startTick();
    const cmds = r.brain.tick(stage.percept());
    for (const tc of cmds) out.push({ frame: stage.now, tc });
    stage.send(cmds);
    each?.(i);
    stage.advance();
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ modules

interface FakeModule extends FeatureModule {
  readonly calls: { enabled: number; observe: number; goals: number; intents: number; act: number };
}

function fakeModule(over: Partial<FeatureModule> = {}, id = "fake"): FakeModule {
  const calls = { enabled: 0, observe: 0, goals: 0, intents: 0, act: 0 };
  const m: FakeModule = {
    id,
    calls,
    enabled(f) { calls.enabled++; return over.enabled ? over.enabled(f) : true; },
    observe(ctx) { calls.observe++; over.observe?.(ctx); },
    goals(ctx) { calls.goals++; return over.goals?.(ctx) ?? []; },
    intents(ctx, g) { calls.intents++; return over.intents?.(ctx, g) ?? []; },
    act(ctx, g) {
      calls.act++;
      return over.act?.(ctx, g) ?? { intents: [], status: { state: "running", why: "fake" }, attacking: false };
    },
  };
  return m;
}

const WITH_CAST: Features = features({ messageTypes: [...CORE_MESSAGES, "cast"], wishes: true });

const castIntent = (priority: Intent["priority"] = PRIORITY.combat): Intent => ({
  kind: "cast", slot: "wish", x: me.x + 100, y: me.y, priority, timing: { kind: "step" }, why: "fake cast",
});

// The registry starts with the built modules (the Wishes module): these tests are about the seam, with only their own modules in it.
beforeEach(() => resetModules());
afterEach(() => resetModules());

// ================================================================================================================= tests

describe("a visible enemy", () => {
  it.each(TIER_IDS)("is answered with a lock click after the %s tier's reaction time, and not before", (id) => {
    // Decisions are made greedy here (no softmax noise, no lapses) so that every seed hunts; the reaction timing is the tier's own.
    const tier: TierParams = { ...TIERS[id], softmaxT: 0.01, lapseP: 0 };
    for (let seed = 1; seed <= 6; seed++) {
      const r = rig(tier, "hunter", { seed });
      const cmds = drive(r, 120, foeScene);
      assertSendable(cmds);
      const first = cmds[0]!;
      expect(first.tc.cmd).toEqual({ type: "target", msg: { id: "foe" } });
      expect(first.tc.stimulus?.kind).toBe("newThreat");
      expect(first.tc.at - T0).toBeGreaterThanOrEqual(tier.reaction.floor);
      expect(first.tc.at).toBeLessThanOrEqual(first.frame);
      expect(first.tc.at - T0).toBeLessThan(4000);
      // Nothing at all before the floor: the first percept is the only thing the bot has reacted to.
      expect(cmds.filter((c) => c.tc.at - T0 < tier.reaction.floor)).toEqual([]);
    }
  });

  it("is hunted: the strategy's goal and the log say so", () => {
    const r = rig("normal", "hunter");
    drive(r, 4, foeScene);
    expect(r.brain.goal).toEqual({ kind: "hunt", target: "foe" });
    expect(r.logs.some((l) => l.includes("hunt foe"))).toBe(true);
  });

  it("is locked once, then again only when the lock never shows (orderFailed), the way a person would", () => {
    const r = rig("normal", "hunter");
    const cmds = drive(r, 200, foeScene); // the fixture never shows the lock
    const locks = cmds.filter((c) => c.tc.cmd.type === "target");
    expect(locks.length).toBeGreaterThan(1);
    for (let i = 1; i < locks.length; i++) expect(locks[i]!.tc.at - locks[i - 1]!.tc.at).toBeGreaterThanOrEqual(300);
    expect(r.brain.stats.reactions.orderFailed?.length).toBeGreaterThan(0);
  });

  it("is not told apart by the [BOT] flag", () => {
    const run = (bot: boolean): string => JSON.stringify(play(rig("hard", "hunter", { seed: 9 }), new Stage(bot, 3), 600).map((c) => c.tc));
    expect(run(true)).toBe(run(false));
  });
});

describe("when the bot cannot act", () => {
  it("sends nothing while dead, in the lobby, or outside an active raid", () => {
    const scenes: Array<Partial<Percept>> = [
      { self: selfView({ status: "dead" }), fighters: [fighter()] },
      { self: selfView({ status: "mia" }), fighters: [fighter()] },
      { self: selfView({ status: "lobby" }), hud: hudView({ phase: "lobby" }), fighters: [fighter()] },
      { hud: hudView({ phase: "lobby" }), fighters: [fighter()] },
      { hud: hudView({ phase: "ended" }), fighters: [fighter()] },
    ];
    for (const scene of scenes) {
      const r = rig("normal", "hunter");
      expect(drive(r, 100, () => scene)).toEqual([]);
      expect(r.brain.goal).toEqual({ kind: "idle" });
    }
  });

  it("drops what it was about to click when it goes down", () => {
    const r = rig("normal", "hunter");
    const cmds = drive(r, 100, (i) => (i === 0 ? foeScene() : { self: selfView({ status: "dead" }), fighters: [fighter()] }));
    expect(cmds).toEqual([]);
  });

  it("starts afresh with a decision as soon as it is alive and the raid is active", () => {
    const r = rig("normal", "hunter");
    drive(r, 20, () => ({ self: selfView({ status: "lobby" }), hud: hudView({ phase: "lobby" }), fighters: [fighter()] }));
    const cmds = drive(r, 100, foeScene);
    expect(cmds[0]?.tc.cmd.type).toBe("target");
  });
});

describe("orders carry the client's seq", () => {
  it("numbers every move and stop 1..255 and round again, and leaves other commands alone", () => {
    const r = rig("hard", "opportunist", { seed: 4 });
    const stage = new Stage(false, 2);
    const cmds = play(r, stage, 6000);
    const orders = cmds.filter((c) => c.tc.cmd.type === "move" || c.tc.cmd.type === "stop");
    expect(orders.length).toBeGreaterThan(20);
    let expected = 0;
    for (const { tc } of orders) {
      expected = (expected % 255) + 1;
      const msg = tc.cmd.msg as { seq?: number };
      expect(msg.seq).toBe(expected);
    }
    for (const { tc } of cmds) {
      if (tc.cmd.type !== "move" && tc.cmd.type !== "stop") expect((tc.cmd.msg as { seq?: number }).seq).toBeUndefined();
    }
    assertSendable(cmds);
  });

  it("lets memory see an order take effect: a stage that echoes the seq raises no orderFailed", () => {
    const r = rig("hard", "hunter", { seed: 2 });
    play(r, new Stage(false, 5), 800);
    expect(r.brain.stats.commands.move).toBeGreaterThan(0);
    expect(r.brain.stats.reactions.orderFailed).toBeUndefined();
  });

  it("wraps after 255 orders", () => {
    const r = rig("hard", "hunter", { seed: 21 });
    // The stage never heals: a bot that lost a fight lies low for the rest of the run and stops walking, so it is kept whole here
    // (this test is about the numbering, not about when a hurt bot gives up).
    const stage = new Stage(false, 8);
    const cmds = play(r, stage, 12_000, () => { stage.hp = 100; });
    const seqs = cmds.filter((c) => c.tc.cmd.type === "move" || c.tc.cmd.type === "stop").map((c) => (c.tc.cmd.msg as { seq: number }).seq);
    expect(seqs.length).toBeGreaterThan(300);
    seqs.forEach((q, k) => expect(q).toBe((k % 255) + 1));
    expect(seqs).toContain(255);
    expect(seqs[255]).toBe(1);
  });
});

describe("a click that picks nobody", () => {
  const sloppy: TierParams = { ...TIERS.normal, targetScatter: { sigma: 5000, lagS: 0, slipP: 0, slipMult: 1 } };

  it("becomes a clickMissed stimulus and a second lock click after a reaction", () => {
    const seen: Stimulus[] = [];
    const mod = fakeModule({ observe: (ctx) => { for (const s of ctx.mem.stimuli) if (s.kind === "clickMissed") seen.push(s); } });
    const r = rig(sloppy, "hunter", { modules: [mod], features: WITH_CAST });
    const cmds = drive(r, 200, foeScene);
    const s = r.brain.stats;
    expect(cmds.filter((c) => c.tc.cmd.type === "target")).toEqual([]); // every click lands far from anybody
    expect(s.clickMissed).toBeGreaterThanOrEqual(2);
    expect(s.targetClicks).toBeGreaterThanOrEqual(2);
    expect(s.reactions.clickMissed?.length).toBeGreaterThanOrEqual(1);
    for (const ms of s.reactions.clickMissed ?? []) expect(ms).toBeGreaterThanOrEqual(sloppy.reaction.floor);
    // The module saw the stimulus on the view it was handed, central, stamped with the percept it was noticed in.
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.every((x) => x.central && x.subject === "foe" && x.at >= T0)).toBe(true);
  });

  it("is not noticed by a bot that was knocked down before it could see the miss", () => {
    const seen: Stimulus[] = [];
    const mod = fakeModule({ observe: (ctx) => { for (const s of ctx.mem.stimuli) if (s.kind === "clickMissed") seen.push(s); } });
    const r = rig(sloppy, "hunter", { modules: [mod], features: WITH_CAST });
    let i = 0;
    const tick = (scene: Partial<Percept>): void => {
      r.budget.startTick();
      r.brain.tick(percept({ now: T0 + i++ * FRAME_MS, ...scene }));
    };
    while (r.brain.stats.clickMissed === 0 && i < 100) tick(foeScene());
    expect(r.brain.stats.clickMissed).toBe(1);
    for (let k = 0; k < 40; k++) tick({ self: selfView({ status: "dead" }), fighters: [prey()] });
    expect(seen).toEqual([]);
  });
});

describe("determinism", () => {
  it("replays exactly from the same seed and the same percepts, and differs with another seed", () => {
    const run = (seed: number): { cmds: string; stats: string; goal: string } => {
      const r = rig("normal", "opportunist", { seed });
      const cmds = play(r, new Stage(false, 3), 1500);
      return { cmds: JSON.stringify(cmds.map((c) => c.tc)), stats: JSON.stringify(r.brain.stats), goal: JSON.stringify(r.brain.goal) };
    };
    const a = run(11);
    expect(run(11)).toEqual(a);
    expect(JSON.parse(a.cmds).length).toBeGreaterThan(5);
    expect(run(12).cmds).not.toBe(a.cmds);
  });
});

describe("end", () => {
  const result = (over: Partial<RunResult> = {}): RunResult => ({
    outcome: "died", profile: "Me", durationSec: 200, kills: 1, killedBy: "Foe", place: 4, players: 6,
    gv: { kills: 0, bounty: 0, mobs: 0, win: 0, total: 0 } as RunResult["gv"], winBonusWithheld: false, ...over,
  });

  it("summarises a run that resolved: tier, persona, the faction it played, its place and the choices it made", () => {
    const r = rig("hard", "farmer");
    drive(r, 10, () => ({ mobs: [mobView({ faction: "plague", kind: "mob" })], self: selfView({ faction: "frost" }) }));
    expect(r.brain.end(result())).toEqual({
      tier: "hard", persona: "farmer", faction: "frost", outcome: "died", place: 4, players: 6, choices: ["opener|frost|plague"],
    });
    expect(r.brain.end(result({ outcome: "won", place: 1, players: 8 }))).toMatchObject({ outcome: "won", place: 1, players: 8 });
  });

  it("is void when the run never resolved, and keeps a null faction if none was ever seen", () => {
    const r = rig("easy", "cautious");
    expect(r.brain.end(null)).toEqual({ tier: "easy", persona: "cautious", faction: null, outcome: "void", place: 0, players: 0, choices: [] });
  });

  it("hands out a copy of the choices, not the live list", () => {
    const r = rig("normal", "farmer");
    drive(r, 10, () => ({ mobs: [mobView({ faction: "plague", kind: "mob" })] }));
    const summary = r.brain.end(null);
    expect(summary.choices).toEqual(["opener|fire|plague"]);
    expect(Object.isFrozen(summary.choices)).toBe(false);
    (summary.choices as string[]).push("x");
    expect(r.brain.end(null).choices).toEqual(["opener|fire|plague"]);
  });
});

describe("stats", () => {
  it("is live, and its counts agree with what was released", () => {
    const r = rig("normal", "hunter", { seed: 3 });
    const stage = new Stage(false, 4);
    const before = r.brain.stats;
    expect(before.commands.move + before.commands.target).toBe(0);
    const cmds = play(r, stage, 2400);
    const s = r.brain.stats;
    const byType = (t: string): number => cmds.filter((c) => c.tc.cmd.type === t).length;
    for (const t of ["move", "stop", "target", "swap", "pickup", "cast", "plan", "choose"] as const) expect(s.commands[t]).toBe(byType(t));
    expect(s.commands.move + s.commands.stop + s.commands.target).toBeGreaterThan(5);
    expect(s.targetClicks).toBeGreaterThanOrEqual(s.commands.target);
    expect(s.targetClicks).toBe(s.commands.target + s.clickMissed);
    expect(s.apmPeak).toBeLessThanOrEqual(TIERS.normal.apm + TIERS.normal.burst);
    const goals = Object.values(s.goals).reduce((a, b) => a + (b ?? 0), 0);
    const adopted = r.logs.filter((l) => /^Me: (idle|farm|hunt|fight|loot|flee|roam|hold|module)\b/.test(l)).length;
    expect(goals).toBeGreaterThan(0);
    expect(goals).toBe(adopted);
    expect(s.maxStallMs).toBeGreaterThanOrEqual(0);
    expect(s.dodges).toBeGreaterThanOrEqual(0);
    expect(s.jukes).toBeGreaterThanOrEqual(0);
    expect(s.kiteCycles).toBeGreaterThanOrEqual(0);
    expect(before).not.toBe(s);
  });

  it("counts the mob hunt's targets the way the old bot did", () => {
    const r = rig("normal", "farmer");
    drive(r, 40, () => ({ mobs: [mobView({ faction: "plague", kind: "mob" })] }));
    expect(r.brain.stats.mobTargets).toBeGreaterThanOrEqual(1);
    expect(r.brain.stats.goals.farm).toBe(1);
  });

  it("counts a weapon picked up while a loot goal was current as a grab, once", () => {
    const r = rig("normal", "opportunist");
    drive(r, 80, (i) => ({ containers: [container({ interactable: true })], self: selfView({ weapons: i < 40 ? ["axe", null] : ["axe", "bow"] }) }));
    expect(r.brain.stats.goals.loot).toBe(1);
    expect(r.brain.stats.grabs).toBe(1);
  });

  it("does not count a weapon that came from nowhere near a loot goal", () => {
    const r = rig("normal", "hunter");
    drive(r, 80, (i) => ({ self: selfView({ weapons: i < 40 ? ["axe", null] : ["axe", "bow"] }) }));
    expect(r.brain.stats.grabs).toBe(0);
  });

  it("presses F on a weapon it is standing next to", () => {
    const r = rig("normal", "opportunist");
    const cmds = drive(r, 100, () => ({ containers: [container({ x: me.x + 20, interactable: true, dist: 20 })] }));
    const pick = cmds.find((c) => c.tc.cmd.type === "pickup");
    expect(pick?.tc.cmd).toEqual({ type: "pickup", msg: { containerId: "c1" } });
  });
});

describe("the stall watch", () => {
  it("measures a bot that stands still with nothing to show for it", () => {
    const r = rig("normal", "hunter");
    drive(r, 200, () => ({})); // ten seconds in which the percept never shows it moving
    expect(r.brain.stats.maxStallMs).toBeGreaterThan(8000);
    expect(r.brain.stats.maxStallMs).toBeLessThanOrEqual(10_000 - 600);
  });

  it("does not count a bow pull as standing still", () => {
    const r = rig("normal", "hunter");
    drive(r, 200, (_i, now) => ({ self: selfView({ drawStartedAt: now - 100 }) }));
    expect(r.brain.stats.maxStallMs).toBe(0);
  });

  it("does not count a pickup in progress", () => {
    const r = rig("normal", "opportunist");
    drive(r, 120, () => ({ containers: [container({ x: me.x + 20, interactable: true, dist: 20, closed: true })] }));
    expect(r.brain.goal.kind === "loot" || r.brain.stats.maxStallMs < 3000).toBe(true);
  });

  it("does not count the sudden-death standoff: the bot ahead keeps its distance on purpose and the burn is the clock", () => {
    const r = rig("normal", "hunter");
    drive(r, 200, (_i, now) => ({ hud: hudView({ suddenDeathAt: now - 3000 }) }));
    expect(r.brain.stats.maxStallMs).toBe(0);
  });

  it("does not count time while dead or in the lobby", () => {
    const r = rig("normal", "hunter");
    drive(r, 200, () => ({ self: selfView({ status: "dead" }) }));
    expect(r.brain.stats.maxStallMs).toBe(0);
  });

  it("stays short for a bot that walks", () => {
    const r = rig("hard", "hunter", { seed: 8 });
    play(r, new Stage(false, 6), 1200);
    expect(r.brain.stats.maxStallMs).toBeLessThan(4000);
  });
});

describe("the path service", () => {
  it("is told every frame's clock and gate state", () => {
    const calls: Array<[number, boolean]> = [];
    const paths = { ...createPathService(testMap(), createPathBudget()), setFrame: (t: number, g: boolean) => { calls.push([t, g]); } };
    const r = rig("normal", "hunter", { services: { paths, log: () => {} } });
    drive(r, 3, (i) => ({ hud: hudView({ gatesLocked: i === 1 }) }));
    expect(calls).toEqual([[T0, false], [T0 + 50, true], [T0 + 100, false]]);
  });

  it("works with a service that has no setFrame", () => {
    const base = createPathService(testMap(), createPathBudget());
    const { setFrame: _unused, ...plain } = base;
    const r = rig("normal", "hunter", { services: { paths: plain, log: () => {} } });
    expect(() => drive(r, 30, foeScene)).not.toThrow();
  });

  it("makes the collision map the locked one while the HUD says the gates are locked", () => {
    let map: unknown = null;
    const mod = fakeModule({ observe: (ctx) => { map = ctx.svc.paths.collisionMap(); } });
    const r = rig("normal", "hunter", { modules: [mod], features: WITH_CAST });
    drive(r, 2, () => ({ hud: hudView({ gatesLocked: true }) }));
    expect(map).not.toBe(testMap());
    drive(r, 2, () => ({}));
    expect(map).toBe(testMap());
  });
});

describe("what the layers are handed", () => {
  it("engaged is true after a hit traded within ENGAGE_TRADE_SECONDS and false again after it", () => {
    const seen: Array<{ t: number; engaged: boolean }> = [];
    const mod = fakeModule({ observe: (ctx) => { seen.push({ t: ctx.p.now, engaged: ctx.engaged }); } });
    const r = rig("normal", "hunter", { modules: [mod], features: WITH_CAST });
    drive(r, 140, (i, now) => ({
      fighters: [prey()],
      events: i === 20
        ? [{ kind: "hit", t: now, at: { x: me.x, y: me.y }, id: "me", by: "foe", amount: 6, weapon: "sword", sig: null }]
        : [],
    }));
    const at = (i: number): boolean => seen[i]!.engaged;
    expect(at(10)).toBe(false);
    expect(at(21)).toBe(true);
    expect(at(60)).toBe(true);
    expect(at(139)).toBe(false);
  });

  it("memory's view is the live one, with this percept's stimuli", () => {
    const views: BrainContext["mem"][] = [];
    const firstStimuli: string[][] = [];
    const mod = fakeModule({ observe: (ctx) => { views.push(ctx.mem); firstStimuli.push(ctx.mem.stimuli.map((s) => s.kind)); } });
    const r = rig("normal", "hunter", { modules: [mod], features: WITH_CAST });
    drive(r, 6, foeScene);
    expect(views.length).toBe(6);
    expect(views[5]!.fighters.has("foe")).toBe(true);
    expect(views[0]!.fighters).toBe(views[5]!.fighters);
    expect(firstStimuli[0]).toContain("newThreat");
    expect(firstStimuli[3]).not.toContain("newThreat");
    expect(views[0]!.whereabouts("foe", T0)).not.toBeNull();
  });
});

describe("feature modules", () => {
  it("never calls a module that is not enabled for these features", () => {
    const mod = fakeModule({
      enabled: (f) => f.wishes,
      goals: () => [{ goal: { kind: "module", module: "fake", data: {} }, utility: 1.2, why: "fake" }],
      intents: () => [castIntent()],
    });
    const r = rig("normal", "hunter", { modules: [mod], features: features() });
    const cmds = drive(r, 200, foeScene);
    expect(mod.calls.enabled).toBeGreaterThan(0);
    expect(mod.calls).toMatchObject({ observe: 0, goals: 0, intents: 0, act: 0 });
    expect(cmds.some((c) => c.tc.cmd.type === "cast")).toBe(false);
    expect(r.brain.goal.kind).toBe("hunt");
  });

  it("observes every tick when enabled, even the ones in which the bot is down", () => {
    const mod = fakeModule();
    const r = rig("normal", "hunter", { modules: [mod], features: WITH_CAST });
    drive(r, 10, () => ({ self: selfView({ status: "dead" }) }));
    drive(r, 10, () => ({ hud: hudView({ phase: "lobby" }) }));
    drive(r, 10, foeScene);
    expect(mod.calls.observe).toBe(30);
  });

  it("runs its own goal: the strategy scores it, only its act() plays it, and tactics is not asked", () => {
    const data = { chest: "c9" };
    const mod = fakeModule({
      goals: () => [{ goal: { kind: "module", module: "fake", data }, utility: 1.25, why: "a chest is up" }],
      act: () => ({ intents: [castIntent()], status: { state: "running", why: "casting" }, attacking: false }),
    });
    const r = rig({ ...TIERS.normal, lapseP: 0 }, "hunter", { modules: [mod], features: WITH_CAST });
    const cmds = drive(r, 100, foeScene);
    expect(r.brain.goal).toEqual({ kind: "module", module: "fake", data });
    expect(mod.calls.act).toBeGreaterThan(0);
    const cast = cmds.find((c) => c.tc.cmd.type === "cast");
    expect(cast?.tc.cmd).toMatchObject({ type: "cast", msg: { slot: "wish" } });
    expect(cmds.some((c) => c.tc.cmd.type === "target")).toBe(false);
    expect(r.brain.stats.goals.module).toBe(1);
  });

  it("fails a module goal whose module is gone, so the strategy moves on", () => {
    let on = true;
    const mod = fakeModule({
      enabled: () => on,
      goals: () => [{ goal: { kind: "module", module: "fake", data: {} }, utility: 1.25, why: "up" }],
    });
    const r = rig({ ...TIERS.normal, lapseP: 0 }, "hunter", { modules: [mod], features: WITH_CAST });
    drive(r, 10, foeScene);
    expect(r.brain.goal.kind).toBe("module");
    on = false;
    drive(r, 80, foeScene);
    expect(r.brain.goal.kind).toBe("hunt");
  });

  it("merges a module's intents into tactics' output: a cast beside the lock", () => {
    const mod = fakeModule({ intents: (_c, g) => (g.kind === "hunt" ? [castIntent()] : []) });
    const r = rig("normal", "hunter", { modules: [mod], features: WITH_CAST });
    const cmds = drive(r, 80, foeScene);
    expect(mod.calls.intents).toBeGreaterThan(0);
    const types = new Set(cmds.map((c) => c.tc.cmd.type));
    expect(types.has("target")).toBe(true);
    expect(types.has("cast")).toBe(true);
  });

  it("lets a module's reflex take the order channel from a lock, and not a chore", () => {
    const walk = (priority: Intent["priority"]): Intent => ({
      kind: "move", to: { x: me.x - 300, y: me.y }, priority, timing: { kind: "step" }, why: "step out of the hazard",
    });
    const run = (priority: Intent["priority"]): ReadonlySet<string> => {
      const mod = fakeModule({ intents: (_c, g) => (g.kind === "hunt" ? [walk(priority)] : []) });
      const r = rig("normal", "hunter", { modules: [mod], features: features() });
      const first = drive(r, 12, foeScene).filter((c) => c.tc.cmd.type === "move" || c.tc.cmd.type === "target");
      return new Set(first.map((c) => c.tc.cmd.type));
    };
    // Modules are asked only when enabled(features): the fake is always on.
    expect(run(PRIORITY.reflex).has("move")).toBe(true);
    expect(run(PRIORITY.reflex).has("target")).toBe(false);
    expect(run(PRIORITY.chore).has("target")).toBe(true);
    expect(run(PRIORITY.chore).has("move")).toBe(false);
  });

  it("switches off a module that throws, logs it once, and keeps playing", () => {
    for (const where of ["observe", "goals", "intents", "act"] as const) {
      const boom = (): never => { throw new Error(`boom in ${where}`); };
      const mod = fakeModule({
        observe: where === "observe" ? boom : undefined,
        goals: where === "goals" ? boom : () => [{ goal: { kind: "module", module: "fake", data: {} }, utility: where === "act" ? 1.25 : 0, why: "x" }],
        intents: where === "intents" ? boom : undefined,
        act: where === "act" ? boom : undefined,
      });
      const r = rig({ ...TIERS.normal, lapseP: 0 }, "hunter", { modules: [mod], features: WITH_CAST });
      let cmds: Released[] = [];
      expect(() => { cmds = drive(r, 120, foeScene); }).not.toThrow();
      expect(r.logs.filter((l) => l.includes("module fake") && l.includes("switched off"))).toHaveLength(1);
      const calls = mod.calls[where];
      drive(r, 40, foeScene);
      expect(mod.calls[where]).toBe(calls);
      expect(cmds.length + r.brain.stats.targetClicks).toBeGreaterThan(0);
    }
  });
});

describe("the module registry", () => {
  it("registers modules, filters them by features and keeps registration order", () => {
    const a = fakeModule({ enabled: () => true }, "a");
    const b = fakeModule({ enabled: (f) => f.wishes }, "b");
    const c = fakeModule({ enabled: () => true }, "c");
    registerModule(a);
    registerModule(b);
    registerModule(c);
    expect(enabledModules(features()).map((m) => m.id)).toEqual(["a", "c"]);
    expect(enabledModules(features({ wishes: true })).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("replaces a module registered again under the same id, in place", () => {
    const first = fakeModule({}, "x");
    const second = fakeModule({}, "x");
    registerModule(first);
    registerModule(fakeModule({}, "y"));
    registerModule(second);
    const list = enabledModules(features());
    expect(list.map((m) => m.id)).toEqual(["x", "y"]);
    expect(list[0]).toBe(second);
  });

  it("holds the cast policy the Wishes adapter registers, and forgets everything on reset", () => {
    expect(getCastPolicy()).toBeNull();
    const policy = (): null => null;
    registerCastPolicy(policy);
    expect(getCastPolicy()).toBe(policy);
    registerModule(fakeModule());
    resetModules();
    expect(getCastPolicy()).toBeNull();
    expect(enabledModules(features({ wishes: true }))).toEqual([]);
  });
});

describe("a long run", () => {
  const LONG_FRAMES = (600 * 1000) / FRAME_MS;
  const LINEUP: ReadonlyArray<readonly [TierId, PersonaId]> = [["easy", "farmer"], ["normal", "opportunist"], ["hard", "cautious"], ["hard", "hunter"]];

  it.each(LINEUP)("never throws, sends only accepted core commands and keeps to the %s tier's rate over 600 s (%s)", (id, persona) => {
    const tier = TIERS[id];
    const r = rig(id, persona, { seed: 21 });
    const stage = new Stage(false, 8);
    const cmds = play(r, stage, LONG_FRAMES);
    assertSendable(cmds);
    expect(cmds.length).toBeGreaterThan(60);
    for (const { tc, frame } of cmds) expect(tc.at).toBeLessThanOrEqual(frame);
    const { peak, minGap } = rate(cmds);
    expect(peak).toBeLessThanOrEqual(tier.apm + tier.burst);
    expect(minGap).toBeGreaterThanOrEqual(tier.minGapMs - 1e-6);
    expect(r.brain.stats.apmPeak).toBeLessThanOrEqual(tier.apm + tier.burst);
    // Commands come out in click order.
    const ats = cmds.map((c) => c.tc.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    // The bot played: it met the stage's foe (fought it, or, for a cautious bot on the 136x136 map, where the foe wanders twice the
    // ground, fled from it), and it did more than one thing. WP8 rechecks the bots on the zone-shape maps.
    expect(stage.kills + (r.brain.stats.goals.flee ?? 0), `goals ${JSON.stringify(r.brain.stats.goals)}`).toBeGreaterThan(0);
    expect(Object.keys(r.brain.stats.goals).length).toBeGreaterThan(1); // 3+ on the 96x96 map; a cautious bot may only roam and flee on 136x136
    // The order numbers never skipped, however many there were.
    const seqs = cmds.filter((c) => c.tc.cmd.type === "move" || c.tc.cmd.type === "stop").map((c) => (c.tc.cmd.msg as { seq: number }).seq);
    seqs.forEach((q, k) => expect(q).toBe((k % 255) + 1));
    expect(r.brain.stats.maxStallMs).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
