// The fair-information contract through the whole brain (docs/BOTS.md 3.7), perception.test.ts and fairness.test.ts being the
// same checks one layer down:
//   - open loop: a scripted 10 s around one bot, played by the real brain behind the real runner (Normal and Hard, every
//     persona); every hidden-information perturbation of fairnessKit.ts leaves its clicks and goals byte-identical;
//   - closed loop: whole headless games of six bots seated by BotManager and stepped in the Room's order. No bot ever holds,
//     in a percept, its memory, its goal or a command, the id or name of a player that was never near its screen and never
//     announced (checked against the world itself, not against the percepts); every lock lands on a fighter in the window of
//     the percept that clicked it and every F on the container that percept marks interactable; and flipping every [BOT] tag
//     changes no command of the game.
import { describe, expect, it } from "vitest";
import { mulberry32, TICK_MS, type FxEvent } from "@raid/shared";
import { BotManager } from "../../src/bots/BotManager";
import { createBrain } from "../../src/bots/brain/brain";
import {
  BOT_FILL_DEFAULTS, BOT_VIEW, PERSONA_IDS,
  type Goal, type MemoryView, type Percept, type PersonaId, type TierId, type TimedCommand,
} from "../../src/bots/brain/types";
import { FxChannel } from "../../src/rooms/FxChannel";
import { createGameWorld } from "../../src/sim/gameplay";
import { step } from "../../src/sim/step";
import type { World } from "../../src/sim/world";
import {
  buildScenario, clickViolations, createNeverSeenTracker, firstDiff, PERTURBATIONS, perturbed, recordingBrain, runBrain, stableJson,
  type BrainFrame, type BrainSpec, type NeverSeenTracker, type Perturbation, type Scenario,
} from "./fairnessKit";

// ================================================================================================================ open loop

/** 200 frames: 10 s. Seeds 1 and 3 play a branch with status effects (a hidden and an untargetable player). */
const SCENARIOS: readonly Scenario[] = [1, 2, 3].map((seed) => buildScenario(seed, { frames: 200 }));
const BOTS: readonly BrainSpec[] = (["normal", "hard"] as const).flatMap((tier, t) =>
  PERSONA_IDS.map((persona, i) => ({ tier, persona, seed: 17 + 10 * t + i })));

/** What the brain did, as compared: every click and the goal after every frame. */
const played = (frames: readonly BrainFrame[]): string => stableJson(frames.map((f) => ({ sent: f.sent, goal: f.goal })));
const specName = (b: BrainSpec): string => `${b.tier} ${b.persona}`;

const baselines = new Map<string, { frames: BrainFrame[]; json: string }>();
function baseline(s: Scenario, b: BrainSpec): { frames: BrainFrame[]; json: string } {
  const key = `${s.seed}|${b.seed}`;
  let out = baselines.get(key);
  if (!out) {
    const frames = runBrain(s, b);
    baselines.set(key, (out = { frames, json: played(frames) }));
  }
  return out;
}

describe("the brain is blind to hidden information (a scripted 10 s, Normal and Hard, every persona)", () => {
  it("the scripted scenario makes every bot act: locks, goals, and moves for most", () => {
    for (const s of SCENARIOS) {
      let moved = 0;
      for (const b of BOTS) {
        const frames = baseline(s, b).frames;
        const sent = frames.flatMap((f) => f.sent);
        expect(sent.filter((c) => c.cmd.type === "target").length, `${s.seed} ${specName(b)}`).toBeGreaterThan(0);
        expect(new Set(frames.map((f) => f.goal.kind)).size).toBeGreaterThan(1);
        if (sent.some((c) => c.cmd.type === "move")) moved++;
      }
      expect(moved).toBeGreaterThanOrEqual(BOTS.length / 2);
    }
  });

  for (const p of PERTURBATIONS) {
    it(p.name, () => {
      for (const s of SCENARIOS) {
        const copy = perturbed(s, p, 3);
        for (const b of BOTS) {
          const want = baseline(s, b).json;
          const got = played(runBrain(copy, b));
          if (got !== want) throw new Error(`"${p.name}" changed what ${specName(b)} did (scenario ${s.seed}) ${firstDiff(want, got)}`);
        }
      }
    });
  }

  it("every lock and every F of those runs names what the releasing percept shows", () => {
    for (const s of SCENARIOS) {
      for (const b of BOTS) {
        const bad = baseline(s, b).frames.flatMap((f) => (f.percept ? clickViolations(f.percept, f.sent) : f.sent.map(() => "a click with no percept")));
        expect(bad, `${s.seed} ${specName(b)}`).toEqual([]);
      }
    }
  });

  it("is not blind itself: what a human does see (an on-screen enemy's hp and weapon) changes what most bots do", () => {
    const visible: Perturbation = {
      name: "on-screen enemies hurt and re-armed",
      apply(s) {
        for (const f of s.frames) {
          for (const id of s.roles.onscreenPlayers) {
            const q = f.state.players.get(id)!;
            q.hp = q.maxHp * 0.1;
            if (q.slot === 1) q.weapon1 = "bow"; else q.weapon0 = "bow";
          }
        }
      },
    };
    let changed = 0;
    for (const s of SCENARIOS) {
      const copy = perturbed(s, visible);
      for (const b of BOTS) if (played(runBrain(copy, b)) !== baseline(s, b).json) changed++;
    }
    expect(changed).toBeGreaterThanOrEqual((SCENARIOS.length * BOTS.length) / 2);
  });
});

// ============================================================================================================== closed loop

const LINEUP: ReadonlyArray<{ tier: TierId; persona: PersonaId }> = [
  { tier: "easy", persona: "farmer" }, { tier: "easy", persona: "hunter" }, { tier: "normal", persona: "opportunist" },
  { tier: "normal", persona: "cautious" }, { tier: "hard", persona: "hunter" }, { tier: "hard", persona: "farmer" },
];
/** A player within the window plus this (u) of a bot, at any step, may legitimately be on its screen (delays, interpolation). */
const EXPOSE_MARGIN = 100;
const MAX_TICKS = 2400;

interface BotAudit {
  readonly id: string;
  readonly name: string;
  frames: number;
  /** Frames at which something about another player was still unknown to it (the check had something to catch). */
  framesWatching: number;
  /** Every fighter, mob, container and event subject it was ever shown. */
  readonly perceived: Set<string>;
  readonly sent: TimedCommand[];
  readonly leaks: NeverSeenTracker;
  readonly clicks: string[];
  readonly goals: string[];
  readonly memory: string[];
  /** FighterSeen.bot values it was shown. */
  readonly tags: Set<boolean>;
}

interface Game {
  readonly world: World;
  readonly bots: ReadonlyMap<string, BotAudit>;
  readonly ticks: number;
  readonly unwatched: number;
}

const goalTarget = (g: Goal): string | null =>
  g.kind === "hunt" || g.kind === "fight" ? g.target : g.kind === "farm" ? g.mob : g.kind === "loot" ? g.container : null;

/** The ids a percept showed the bot: on screen, on the minimap, or named by an event it observed. */
function notePerceived(set: Set<string>, p: Percept): void {
  for (const f of p.fighters) set.add(f.id);
  for (const m of p.mobs) set.add(m.id);
  for (const m of p.minimap.mobs) set.add(m.id);
  for (const c of p.containers) set.add(c.id);
  for (const e of p.events) {
    const r = e as unknown as Record<string, unknown>;
    for (const k of ["id", "by"]) if (typeof r[k] === "string") set.add(r[k] as string);
  }
  if (p.self.attackTarget) set.add(p.self.attackTarget);
}

function memoryBeyond(perceived: ReadonlySet<string>, mem: MemoryView): string[] {
  const bad: string[] = [];
  for (const [what, map] of [["fighter", mem.fighters], ["mob", mem.mobs], ["container", mem.containers]] as const) {
    for (const id of map.keys()) if (!perceived.has(id)) bad.push(`remembers ${what} ${id} it was never shown`);
  }
  return bad;
}

/**
 * A whole game of six bots, headless, in the Room's order (botManager.test.ts Loop): due commands before the step, the step's
 * fx batch, results, then one frame per patch. Before the bots' frames, what each could legitimately know is worked out from
 * the world: who stood near its screen, and every announcement (a player's death, a bounty, the winner, an elite's killer).
 */
function playGame(seed: number, opts: { flipTags?: boolean; audit?: boolean } = {}): Game {
  const world = createGameWorld({
    seed,
    config: {
      minPlayers: 2, lobbySeconds: 1, fillSeconds: 0, patienceSeconds: 40, patienceMinSeconds: 20, suddenDeathSeconds: 10, mobs: true,
    },
    random: mulberry32(seed + 1),
  });
  const bots = new Map<string, BotAudit>();
  const names = new Map<string, string>();
  const exposed = new Map<string, Set<string>>();
  const expose = (bot: string, ...tokens: string[]): void => {
    const set = exposed.get(bot)!;
    const fresh = tokens.filter((t) => !set.has(t));
    if (fresh.length === 0) return;
    for (const t of fresh) set.add(t);
    bots.get(bot)?.leaks.unwatch(...fresh);
  };
  const exposeAll = (...tokens: string[]): void => { for (const id of exposed.keys()) expose(id, ...tokens); };
  let unwatched = 0;

  const tap = recordingBrain(createBrain, {
    onTick(id, p, mem, goal, sent) {
      const a = bots.get(id)!;
      a.frames++;
      a.sent.push(...sent);
      if (!opts.audit) {
        for (const f of p.fighters) a.tags.add(f.bot);
        return;
      }
      if (a.leaks.watching > 0) a.framesWatching++;
      notePerceived(a.perceived, p);
      a.leaks.scan(`percept@${p.now}`, p);
      a.leaks.scan(`goal@${p.now}`, goal);
      a.leaks.scan(`sent@${p.now}`, sent);
      a.clicks.push(...clickViolations(p, sent));
      const target = goalTarget(goal);
      if (target !== null && !a.perceived.has(target)) a.goals.push(`${goal.kind} ${target} at ${p.now}, never shown`);
      // Memory keeps what it learns for 25 s and more: a look every half second, and at every click, misses nothing it holds.
      if (mem && (a.frames % 10 === 0 || sent.length > 0)) {
        a.leaks.scan(`memory@${p.now}`, mem);
        a.memory.push(...memoryBeyond(a.perceived, mem));
      }
    },
  });
  const manager = new BotManager(world, { ...BOT_FILL_DEFAULTS, fillTo: 0 }, { store: null, isNameTaken: () => false, seed: seed * 7 + 3, createBrain: tap });
  for (const over of LINEUP) {
    const spec = manager.addBot(over)!;
    names.set(spec.id, spec.name);
    exposed.set(spec.id, new Set());
    bots.set(spec.id, {
      id: spec.id, name: spec.name, frames: 0, framesWatching: 0, perceived: new Set(), sent: [], leaks: createNeverSeenTracker(),
      clicks: [], goals: [], memory: [], tags: new Set(),
    });
    if (opts.flipTags) world.state.players.get(spec.id)!.bot = !world.state.players.get(spec.id)!.bot;
  }
  for (const a of bots.values()) {
    for (const [other, name] of names) if (other !== a.id) a.leaks.watch(other, name);
  }

  const channel = new FxChannel();
  let ticks = 0;
  for (; ticks < MAX_TICKS && world.state.phase !== "ended"; ticks++) {
    manager.beforeStep(world.state.serverTime + TICK_MS);
    const events = step(world, TICK_MS);
    const fxs = events.flatMap((e): FxEvent[] => (e.type === "fx" ? [e.fx] : []));
    const batch = channel.batch(fxs, world.state.serverTime, world.projectiles);
    for (const e of events) {
      if (e.type === "toast" && manager.isBot(e.to)) manager.onToast(e.to, e.text);
      else if (e.type === "resolved") manager.onResult(e.id, e.result);
    }
    channel.extendRoster(world.state);
    channel.rosterSent();

    if (opts.audit) {
      const before = [...bots.values()].reduce((n, a) => n + a.leaks.watching, 0);
      const s = world.state;
      for (const id of bots.keys()) {
        const me = s.players.get(id);
        if (!me) continue;
        for (const [other, q] of s.players) {
          if (other === id) continue;
          if (Math.abs(q.x - me.x) <= BOT_VIEW.halfW + EXPOSE_MARGIN && Math.abs(q.y - me.y) <= BOT_VIEW.halfH + EXPOSE_MARGIN) expose(id, other, q.name);
        }
      }
      for (const fx of fxs) {
        if (fx.kind === "death") {
          const player = s.players.get(fx.id);
          if (player) exposeAll(fx.id, player.name);
          else if (s.mobs.get(fx.id)?.kind === "elite" && fx.by) exposeAll(fx.by);
        } else if (fx.kind === "bounty") exposeAll(fx.id, fx.name);
        else if (fx.kind === "victory") {
          if (fx.id) exposeAll(fx.id);
          if (fx.name) exposeAll(fx.name);
        }
      }
      if (s.winner) exposeAll(s.winner);
      unwatched += before - [...bots.values()].reduce((n, a) => n + a.leaks.watching, 0);
    }
    manager.afterPatch(batch ? [batch] : []);
  }
  return { world, bots, ticks, unwatched };
}

let audited: Game | null = null;
const auditedGame = (): Game => (audited ??= playGame(31, { audit: true }));

describe("a whole game of six bots (BotManager, the Room's tick order)", () => {
  it("is played out: the raid ends, every bot perceived and acted, none was refused", () => {
    const g = auditedGame();
    expect(g.world.state.phase).toBe("ended");
    for (const a of g.bots.values()) {
      expect(a.frames, a.name).toBeGreaterThan(100);
      expect(a.sent.length, a.name).toBeGreaterThan(0);
    }
    expect(g.ticks).toBeLessThan(MAX_TICKS);
  });

  it("no bot ever holds the id or name of a player never near its screen and never announced", () => {
    const g = auditedGame();
    const report = Object.fromEntries([...g.bots.values()].map((a) => [a.name, a.leaks.hits]));
    expect(report).toEqual(Object.fromEntries([...g.bots.values()].map((a) => [a.name, []])));
    // Not vacuous: each bot spent frames with players still unknown to it, and learnt of them one by one.
    for (const a of g.bots.values()) expect(a.framesWatching, a.name).toBeGreaterThan(20);
    expect(g.unwatched).toBeGreaterThan(10);
  });

  it("goals and memory name only what the bot was shown", () => {
    const g = auditedGame();
    for (const a of g.bots.values()) {
      expect(a.goals, a.name).toEqual([]);
      expect(a.memory, a.name).toEqual([]);
      expect(a.perceived.size, a.name).toBeGreaterThan(10);
    }
  });

  it("every lock resolves to a standing fighter in the window of the percept that clicked it, every F to the interactable container", () => {
    const g = auditedGame();
    let targets = 0;
    for (const a of g.bots.values()) {
      expect(a.clicks, a.name).toEqual([]);
      targets += a.sent.filter((c) => c.cmd.type === "target").length;
    }
    expect(targets).toBeGreaterThan(20);
  });

  it("flipping every [BOT] tag changes no command of the whole game", () => {
    const run = (flipTags: boolean) => {
      const g = playGame(47, { flipTags });
      return {
        g,
        sent: Object.fromEntries([...g.bots.values()].map((a) => [a.id, stableJson(a.sent)])),
        end: stableJson([...g.world.state.players].map(([id, p]) => [id, p.status, p.x, p.y, p.hp, p.kills, p.mobKills])),
      };
    };
    const tagged = run(false), flipped = run(true);
    // The tag really was what they saw: every fighter flagged in one game, none in the other.
    expect([...new Set([...tagged.g.bots.values()].flatMap((a) => [...a.tags]))]).toEqual([true]);
    expect([...new Set([...flipped.g.bots.values()].flatMap((a) => [...a.tags]))]).toEqual([false]);
    for (const id of Object.keys(tagged.sent)) {
      const a = tagged.sent[id]!, b = flipped.sent[id]!;
      if (a !== b) throw new Error(`${id} played differently once the tags flipped: ${firstDiff(a, b)}`);
    }
    expect(flipped.end).toBe(tagged.end);
    expect(Object.values(tagged.sent).join("").length).toBeGreaterThan(1000);
  });
});
