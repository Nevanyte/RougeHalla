// The tournament harness (docs/BOTS.md 9.3), fast: a game replays byte for byte from its options, the lineup is what the game
// plays, a game ends in one winner or a draw with a place for every bot, the report's arithmetic on handcrafted summaries, the CLI
// parser and the even deal of factions and personas, and a CI smoke of two games through the real CLI and its worker threads.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACTION_IDS, type FactionId } from "@raid/shared";
import { BOT_FILL_DEFAULTS, PERSONA_IDS, PERSONAS, TIERS, type CommandType, type PersonaId, type TierId } from "../../src/bots/brain/types";
import { runGame, type BotBehaviour, type BotGameSummary, type GameSummary, type SeatSpec } from "../../src/bots/tournament/game";
import { createHeadlessRoom } from "../../src/bots/tournament/headlessRoom";
import { aggregate, evaluate, formatReport, meanInterval, percentile, wilson } from "../../src/bots/tournament/report";
import {
  defaultWorkers, parseArgs, parseLineup, planOf, split,
} from "../../src/bots/tournament/runTournament";
import { applyTune } from "../../src/bots/tournament/tune";
import { dealEvenly, planGame, runBatch, type TournamentPlan } from "../../src/bots/tournament/worker";
import { addPlayer } from "../../src/sim/step";

/** Timers short enough that a 6-bot game ends in well under a minute of simulated time. */
const SHORT = { patienceSeconds: 20, patienceMinSeconds: 8, suddenDeathSeconds: 6 };
const LINEUP: readonly SeatSpec[] = [
  { tier: "easy", persona: "farmer", faction: "fire" },
  { tier: "easy", persona: "hunter", faction: "holy" },
  { tier: "normal", persona: "opportunist", faction: "frost" },
  { tier: "normal", persona: "cautious", faction: "plague" },
  { tier: "hard", persona: "hunter", faction: "sentenced" },
  { tier: "hard", persona: "farmer", faction: "fire" },
];

// ============================================================================================================== the headless room

describe("headlessRoom", () => {
  it("seats the lineup in order and starts the raid on the first tick, as a lobby at its countdown's end does", () => {
    const room = createHeadlessRoom({ seed: 3, bots: { ...BOT_FILL_DEFAULTS, fillTo: LINEUP.length }, lineup: LINEUP });
    expect(room.world.state.phase).toBe("lobby");
    expect(room.seats.map((s) => [s.tier, s.persona, s.faction])).toEqual(LINEUP.map((s) => [s.tier, s.persona, s.faction]));
    const events = room.tick();
    expect(room.world.state.phase).toBe("active");
    expect(events.some((e) => e.type === "raidStarted")).toBe(true);
    for (const spec of room.seats) expect(room.world.state.players.get(spec.id)).toMatchObject({ bot: true, status: "alive", faction: spec.faction });
  });

  it("runs the same game from the same options and a different one from another seed", () => {
    const play = (seed: number): string => {
      const room = createHeadlessRoom({ seed, config: SHORT, bots: { ...BOT_FILL_DEFAULTS, fillTo: LINEUP.length }, lineup: LINEUP });
      room.runUntilEnd(30_000);
      return JSON.stringify([...room.world.state.players].map(([id, p]) => [id, p.x, p.y, p.hp, p.status, p.kills]));
    };
    const first = play(4);
    expect(play(4)).toBe(first);
    expect(play(5)).not.toBe(first);
  });

  it("fills a lobby around a human the way the Room does, when no lineup is given", () => {
    const room = createHeadlessRoom({
      seed: 3, config: { lobbySeconds: 6, fillSeconds: 6 }, bots: { ...BOT_FILL_DEFAULTS, fillTo: 4, arrivalSeconds: 4 },
    });
    addPlayer(room.world, "h0", "Human");
    while (room.world.state.phase === "lobby") room.tick();
    const { players } = room.world.state;
    expect(players.size).toBe(4);
    expect([...players.values()].filter((p) => p.bot)).toHaveLength(3);
    expect(players.get("h0")!.bot).toBe(false);
    expect(room.manager.stats.arrived).toBe(3);
    room.runUntilEnd(2000);
    expect(room.manager.stats.frames).toBeGreaterThan(0);
  });

  it("stops at the cap and says so", () => {
    const room = createHeadlessRoom({ seed: 3, bots: { ...BOT_FILL_DEFAULTS, fillTo: 2 }, lineup: LINEUP.slice(0, 2) });
    const r = room.runUntilEnd(2000);
    expect(r.ended).toBe(false);
    expect(r.simMs).toBeGreaterThanOrEqual(2000);
    expect(r.simMs).toBeLessThan(2100);
  });
});

// ================================================================================================================== one game

describe("runGame", () => {
  // 150 s of sim: on the 136x136 zone maps with fists starts the short games run 53-99 s (seeds 11-13), about a second of wall each.
  const options = { seed: 11, lineup: LINEUP, config: SHORT, maxSimMs: 150_000 };

  it("replays byte for byte from the same seed, and plays differently from another", () => {
    const a = JSON.stringify(runGame(options));
    const b = JSON.stringify(runGame(options));
    expect(b).toBe(a);
    expect(JSON.stringify(runGame({ ...options, seed: 12 }))).not.toBe(a);
    expect(JSON.stringify(runGame({ ...options, botSeed: 99 }))).not.toBe(a);
  });

  it("plays the lineup it is given: tier, persona and faction of every seat, in order", () => {
    const g = runGame(options);
    expect(g.bots.map((b) => [b.tier, b.persona, b.faction])).toEqual(LINEUP.map((s) => [s.tier, s.persona, s.faction]));
    expect(new Set(g.bots.map((b) => b.id)).size).toBe(LINEUP.length);
    expect(new Set(g.bots.map((b) => b.name)).size).toBe(LINEUP.length);
  });

  it("ends in exactly one winner or a draw, with a place for every bot, and the books agree", () => {
    for (const seed of [11, 12, 13]) {
      const g = runGame({ ...options, seed });
      expect(g.ended).toBe(true);
      const n = g.bots.length;
      const won = g.bots.filter((b) => b.outcome === "won");
      const drew = g.bots.filter((b) => b.outcome === "draw");
      if (g.draw) {
        expect(g.winner).toBeNull();
        expect(won).toHaveLength(0);
        expect(drew.length).toBeGreaterThan(1);
      } else {
        expect(won).toHaveLength(1);
        expect(g.winner).toBe(g.bots.indexOf(won[0]!));
        expect(drew).toHaveLength(0);
      }
      for (const b of g.bots) {
        expect(b.place).toBeGreaterThanOrEqual(1);
        expect(b.place).toBeLessThanOrEqual(n);
        expect(["won", "draw", "died"]).toContain(b.outcome);
        expect(b.deaths).toBe(b.outcome === "died" ? 1 : 0);
        // The winner (or a drawer) may have fallen in the very tick of the last rival's death: the higher hp share at the tick's
        // start takes the run (arena.ts settle). Equal shares can instead draw with both final fighters falling together.
        const fellWithTheLast = b.diedAtMs !== null && g.bots.some((o) => o !== b
          && (o.outcome === "died" || o.outcome === "draw") && o.diedAtMs === b.diedAtMs);
        expect(b.diedAtMs !== null && (b.outcome === "died" || fellWithTheLast)).toBe(b.diedAtMs !== null);
        if (b.outcome === "died") expect(b.diedAtMs).not.toBeNull();
        expect(b.diedTo !== null).toBe(b.outcome === "died");
      }
      // The winner placed first; nobody who died placed first unless a draw.
      if (g.winner !== null) expect(g.bots[g.winner]!.place).toBe(1);
      expect(g.bots.filter((b) => b.place === 1).length).toBe(won.length + drew.length);
      // Every kill by a bot is a death to a bot, and every death to a bot is a kill.
      expect(g.bots.reduce((a, b) => a + b.kills, 0)).toBe(g.bots.filter((b) => b.diedTo === "bot").length);
      // Nothing was refused or lost, and no brain threw.
      expect(g.manager).toMatchObject({ refused: 0, lost: 0, errors: 0 });
      expect(g.manager.applied).toBeLessThanOrEqual(g.manager.sent);
      expect(g.durationMs).toBeGreaterThan(0);
    }
  });

  it("a game cut off by the cap leaves its survivors without a result", () => {
    const g = runGame({ seed: 11, lineup: LINEUP.slice(0, 2), config: { patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 }, maxSimMs: 5000 });
    expect(g.ended).toBe(false);
    expect(g.winner).toBeNull();
    for (const b of g.bots) expect(b).toMatchObject({ outcome: "capped", place: 1, deaths: 0 });
  });

  it("measures behaviour: commands by type, bounded APM, reaction samples as whole milliseconds", () => {
    const g = runGame(options);
    for (const b of g.bots) {
      const bh = b.behaviour;
      expect(bh.commandsTotal).toBe(Object.values(bh.commands).reduce((x, y) => x + y, 0));
      expect(bh.apmPeak).toBeLessThanOrEqual(TIERS[b.tier].apm + TIERS[b.tier].burst);
      for (const samples of Object.values(bh.reactions)) {
        expect(samples.length).toBeLessThanOrEqual(256);
        for (const s of samples) expect(Number.isInteger(s)).toBe(true);
      }
      expect(bh.targetClicks).toBeGreaterThanOrEqual(bh.clickMissed);
    }
    expect(g.bots.some((b) => b.behaviour.commandsTotal > 0)).toBe(true);
  });
});

// ============================================================================================================= the deal and CLI

describe("dealing factions and personas", () => {
  const plan: TournamentPlan = { games: 20, seed: 5, tiers: parseLineup("E,E,N,N,H,H"), persona: "mix", learn: false, maxSimMs: 1 };

  it("gives every seat, so every tier, every faction once in each block of five games", () => {
    for (const block of [0, 1, 2, 3]) {
      const seen = plan.tiers.map(() => new Set<FactionId>());
      for (let g = block * 5; g < block * 5 + 5; g++) {
        const lineup = planGame(plan, g).lineup as SeatSpec[];
        lineup.forEach((s, i) => seen[i]!.add(s.faction));
      }
      for (const s of seen) expect([...s].sort()).toEqual([...FACTION_IDS].sort());
    }
  });

  it("gives every seat every persona once in each block of four games, and no faction more than twice to a lobby", () => {
    for (const block of [0, 1, 2]) {
      const seen = plan.tiers.map(() => new Set<PersonaId>());
      for (let g = block * 4; g < block * 4 + 4; g++) {
        const lineup = planGame(plan, g).lineup as SeatSpec[];
        lineup.forEach((s, i) => seen[i]!.add(s.persona));
        const perFaction = new Map<FactionId, number>();
        for (const s of lineup) perFaction.set(s.faction, (perFaction.get(s.faction) ?? 0) + 1);
        expect(Math.max(...perFaction.values())).toBeLessThanOrEqual(2);
      }
      for (const s of seen) expect([...s].sort()).toEqual([...PERSONA_IDS].sort());
    }
  });

  it("is a function of the plan and the index, and a fixed persona is the same for every seat", () => {
    expect(planGame(plan, 7)).toEqual(planGame(plan, 7));
    expect(planGame(plan, 7).seed).not.toBe(planGame(plan, 8).seed);
    expect(planGame({ ...plan, seed: 6 }, 7)).not.toEqual(planGame(plan, 7));
    const farm = planGame({ ...plan, persona: "farmer", faction: "holy" }, 3).lineup as SeatSpec[];
    expect(new Set(farm.map((s) => s.faction))).toEqual(new Set(["holy"]));
    expect(new Set(farm.map((s) => s.persona))).toEqual(new Set(["farmer"]));
    expect(farm.map((s) => s.tier)).toEqual(["easy", "easy", "normal", "normal", "hard", "hard"]);
    expect(dealEvenly(["a", "b", "c"], 4, 1, 1, 0)).toHaveLength(4);
  });
});

describe("the argument parser", () => {
  it("has the documented defaults", () => {
    const a = parseArgs([], 18);
    expect(a).toMatchObject({
      games: 400, workers: 6, tiers: ["easy", "easy", "normal", "normal", "hard", "hard"], seed: 1, learn: true, persona: "mix",
      json: null, maxMinutes: 12, patience: null, sudden: null, quiet: false, help: false,
    });
    expect(defaultWorkers(2)).toBe(1);
    expect(defaultWorkers(4)).toBe(3);
    expect(defaultWorkers(64)).toBe(6);
  });

  it("reads the flags of the documented command line, with a value after a space or an equals sign", () => {
    const a = parseArgs(["--", "--games", "60", "--workers=2", "--lineup", "H,n,Easy", "--seed", "9", "--learn", "off", "--persona", "Hunter", "--faction", "FROST",
      "--json", "out.json", "--max-minutes", "6", "--patience", "90", "--sudden=20", "--latency", "50", "--jitter", "0", "--quiet"]);
    expect(a).toMatchObject({
      games: 60, workers: 2, tiers: ["hard", "normal", "easy"], seed: 9, learn: false, persona: "hunter", faction: "frost", json: "out.json",
      maxMinutes: 6, patience: 90, sudden: 20, latencyMs: 50, jitterMs: 0, quiet: true,
    });
    expect(parseArgs(["--help"]).help).toBe(true);
    const plan = planOf(a);
    expect(plan).toMatchObject({ games: 60, maxSimMs: 360_000, config: { patienceSeconds: 90, patienceMinSeconds: 36, suddenDeathSeconds: 20 }, latencyMs: 50, jitterMs: 0 });
  });

  it("refuses what it does not understand, in plain words", () => {
    expect(() => parseArgs(["--games", "0"])).toThrow(/--games/);
    expect(() => parseArgs(["--games", "x"])).toThrow(/--games/);
    expect(() => parseArgs(["--games"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--lineup", "E,X"])).toThrow(/unknown tier "x"/);
    expect(() => parseArgs(["--lineup", "E"])).toThrow(/2 to 8 seats/);
    expect(() => parseArgs(["--lineup", "E,E,E,E,E,E,E,E,E"])).toThrow(/2 to 8 seats/);
    expect(() => parseArgs(["--learn", "maybe"])).toThrow(/on or off/);
    expect(() => parseArgs(["--persona", "bard"])).toThrow(/--persona/);
    expect(() => parseArgs(["--faction", "water"])).toThrow(/--faction/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown option "--nope"/);
    expect(parseLineup(" e , n ,h")).toEqual(["easy", "normal", "hard"]);
  });

  it("splits games over workers by index modulo, with no idle worker", () => {
    expect(split(7, 3)).toEqual([[0, 3, 6], [1, 4], [2, 5]]);
    expect(split(2, 6)).toEqual([[0], [1]]);
    expect(split(5, 1)).toEqual([[0, 1, 2, 3, 4]]);
  });
});

// ============================================================================================================== the statistics

describe("statistics", () => {
  it("Wilson intervals match the textbook values", () => {
    const near = (a: number, b: number): void => expect(a).toBeCloseTo(b, 3);
    const half = wilson(5, 10);
    near(half.p, 0.5); near(half.lo, 0.2366); near(half.hi, 0.7634);
    const none = wilson(0, 10);
    near(none.lo, 0); near(none.hi, 0.2775);
    const all = wilson(10, 10);
    near(all.lo, 0.7225); near(all.hi, 1);
    const seven = wilson(7, 10);
    near(seven.lo, 0.3968); near(seven.hi, 0.8922);
    const big = wilson(120, 400); // 30%
    near(big.lo, 0.2572); near(big.hi, 0.3466);
    expect(wilson(0, 0).p).toBeNaN();
  });

  it("percentiles interpolate and a mean interval shrinks with the sample", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(percentile(xs, 0.1)).toBe(2);
    expect(percentile(xs, 0.5)).toBe(6);
    expect(percentile(xs, 0.9)).toBe(10);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBeNaN();
    const small = meanInterval([1, 2, 3, 4]);
    expect(small.mean).toBe(2.5);
    expect(small.hi - small.lo).toBeGreaterThan(0);
    const wide = Array.from({ length: 400 }, (_, i) => 1 + (i % 4));
    expect(meanInterval(wide).hi - meanInterval(wide).lo).toBeLessThan(small.hi - small.lo);
    expect(meanInterval([3]).lo).toBe(3);
  });
});

// ================================================================================================================== the report

const ZERO_COMMANDS: Record<CommandType, number> = { move: 0, stop: 0, target: 0, swap: 0, pickup: 0, cast: 0, plan: 0, choose: 0 };

function behaviour(over: Partial<BotBehaviour> = {}): BotBehaviour {
  return {
    commands: { ...ZERO_COMMANDS, move: 10, target: 10 }, commandsTotal: 20, reactions: {}, targetClicks: 10, clickMissed: 0, clickWrong: 0,
    hesitations: 0, lapses: 0, throttled: 0, superseded: 0, apmPeak: 20, mobTargets: 0, mobDrops: 0, retreats: 0, mobFocusMs: 0, grabs: 0,
    maxStallMs: 0, dodges: 0, jukes: 0, kiteCycles: 0, goals: {}, ...over,
  };
}

function bot(tier: TierId, outcome: BotGameSummary["outcome"], place: number, over: Partial<BotGameSummary> = {}): BotGameSummary {
  return {
    id: `bot~${tier}`, name: tier, tier, persona: "hunter", faction: "fire", place, outcome, kills: 0, mobKills: 0, damage: 0, mobDamage: 0,
    deaths: outcome === "died" ? 1 : 0, gv: 0, diedAtMs: outcome === "died" ? 30_000 : null, diedTo: outcome === "died" ? "bot" : null,
    behaviour: behaviour(), ...over,
  };
}

function game(bots: BotGameSummary[], over: Partial<GameSummary> = {}): GameSummary {
  const winner = bots.findIndex((b) => b.outcome === "won");
  return {
    seed: 1, ended: true, winner: winner >= 0 ? winner : null, draw: false, durationMs: 60_000, ticks: 1200, firstDeathMs: 10_000,
    teleportMs: null, suddenDeathMs: null, bots, manager: { sent: 10, applied: 10, refused: 0, lost: 0, frames: 100, errors: 0 }, ...over,
  };
}

describe("the report", () => {
  // Ten games of one Hard bot against one Easy: Hard wins seven of them.
  const games = Array.from({ length: 10 }, (_, i) => {
    const hardWins = i < 7;
    return game([
      bot("hard", hardWins ? "won" : "died", hardWins ? 1 : 2, { kills: hardWins ? 1 : 0, damage: 100, faction: "fire", persona: "hunter" }),
      bot("easy", hardWins ? "died" : "won", hardWins ? 2 : 1, { kills: hardWins ? 0 : 1, damage: 50, faction: "holy", persona: "farmer" }),
    ], { durationMs: (i + 1) * 10_000 });
  });
  const r = aggregate(games);

  it("counts games, wins and placements per tier", () => {
    expect(r.games).toBe(10);
    expect(r.decided).toBe(10);
    expect(r.draws).toBe(0);
    expect(r.capped).toBe(0);
    expect(r.tiers.map((t) => t.tier)).toEqual(["easy", "hard"]);
    const [easy, hard] = r.tiers as [typeof r.tiers[number], typeof r.tiers[number]];
    expect(hard).toMatchObject({ botGames: 10, wins: 7, shareOfWins: 0.7, killsPerBot: 0.7, damagePerBot: 100 });
    expect(hard.winRate.p).toBe(0.7);
    expect(hard.winRate.lo).toBeCloseTo(0.3968, 3);
    expect(hard.winRate.hi).toBeCloseTo(0.8922, 3);
    expect(easy).toMatchObject({ botGames: 10, wins: 3, shareOfWins: 0.3 });
    expect(hard.place.mean).toBeCloseTo(1.3, 10);
    expect(easy.place.mean).toBeCloseTo(1.7, 10);
    expect(hard.place.lo).toBeLessThan(hard.place.mean);
    expect(hard.place.hi).toBeGreaterThan(hard.place.mean);
    expect(r.duration).toMatchObject({ meanS: 55, p50S: 55, minS: 10, maxS: 100 });
  });

  it("groups by persona and faction", () => {
    expect(r.personas.map((p) => [p.key, p.botGames, p.winRate.k])).toEqual([["farmer", 10, 3], ["hunter", 10, 7]]);
    expect(r.factions.map((f) => [f.key, f.botGames, f.winRate.k])).toEqual([["fire", 10, 7], ["holy", 10, 3]]);
  });

  it("pools reaction delays per tier and stimulus into percentiles, and judges the plain ones against the table", () => {
    const hardMean = TIERS.hard.reaction.mu + TIERS.hard.reaction.tau; // 200
    const samples = Array.from({ length: 11 }, (_, i) => hardMean - 50 + i * 10); // 150..250, mean 200
    const withReactions = aggregate([
      game([
        bot("hard", "won", 1, { behaviour: behaviour({ reactions: { hpLoss: samples, newThreat: [600, 700], teleport: [400] } }) }),
        bot("easy", "died", 2, { behaviour: behaviour({ reactions: { hpLoss: [900, 900] } }) }),
      ]),
    ]);
    const hard = withReactions.tiers.find((t) => t.tier === "hard")!;
    const hp = hard.reactions.find((x) => x.kind === "hpLoss")!;
    expect(hp).toMatchObject({ n: 11, p10: 160, p50: 200, p90: 240, mean: 200, table: hardMean });
    expect(hard.reactions.find((x) => x.kind === "teleport")!.table).toBe(TIERS.hard.daze.mu + TIERS.hard.daze.tau);
    // Only the plain stimuli are pooled: newThreat and teleport are scaled by attention and daze.
    expect(hard.pooled).toMatchObject({ n: 11, mean: 200, table: hardMean, ratio: 1 });
    const easy = withReactions.tiers.find((t) => t.tier === "easy")!;
    expect(easy.pooled.ratio).toBeCloseTo(900 / 450, 10);
    const verdict = evaluate(withReactions).filter((c) => c.text.includes("reaction mean"));
    expect(verdict.find((c) => c.text.startsWith("hard"))!.ok).toBe(true);
    expect(verdict.find((c) => c.text.startsWith("easy"))!.ok).toBe(false);
  });

  it("rates lock misses per click, APM per minute alive, and flags a breach, a stall and a refused command", () => {
    const bad = aggregate([
      game([
        bot("hard", "died", 2, {
          diedAtMs: 120_000, behaviour: behaviour({ commandsTotal: 240, targetClicks: 50, clickMissed: 5, clickWrong: 2, apmPeak: TIERS.hard.apm + TIERS.hard.burst + 1, maxStallMs: 9000 }),
        }),
        bot("easy", "won", 1, { behaviour: behaviour({ commandsTotal: 30, targetClicks: 50, clickMissed: 5, clickWrong: 0 }) }),
      ], { durationMs: 120_000, manager: { sent: 5, applied: 4, refused: 1, lost: 0, frames: 10, errors: 0 } }),
    ]);
    const hard = bad.tiers.find((t) => t.tier === "hard")!;
    expect(hard.missRate).toBeCloseTo(0.1, 10);
    expect(hard.wrongRate).toBeCloseTo(0.04, 10);
    expect(hard.apmMean).toBeCloseTo(120, 10);
    expect(hard).toMatchObject({ apmBreaches: 1, stalls: 1, apmLimit: TIERS.hard.apm + TIERS.hard.burst });
    const verdicts = evaluate(bad);
    const verdict = (needle: string): boolean | null => verdicts.find((c) => c.text.includes(needle))!.ok;
    expect(verdict("zero commands refused")).toBe(false);
    expect(verdict("zero APM breaches")).toBe(false);
    expect(verdict("stalled")).toBe(false);
  });

  it("judges the pass criteria of 9.3", () => {
    const verdicts = evaluate(r);
    const verdict = (needle: string): boolean | null => verdicts.find((c) => c.text.includes(needle))!.ok;
    // Hard wins 70% of the time here: the ordering holds, but Hard is far over its 0.40 ceiling and its band.
    expect(verdict("win share orders")).toBe(true);
    expect(verdict("mean placement orders")).toBe(true);
    expect(verdict("Hard per-bot win share")).toBe(false);
    expect(verdict("Easy per-bot win share")).toBe(true);
    expect(verdict("hard per-bot win share 0.70 in the starting band")).toBe(false);
    expect(verdict("zero commands refused")).toBe(true);
    expect(verdict("zero APM breaches")).toBe(true);
    expect(verdict("12-minute cap")).toBe(true);
  });

  it("a lineup of one tier cannot order tiers: those criteria say so instead of failing", () => {
    const one = aggregate([game([bot("hard", "won", 1), bot("hard", "died", 2)])]);
    expect(evaluate(one).find((c) => c.text.includes("mean placement orders"))!.ok).toBeNull();
  });

  it("prints a report with the headline figures and survives an empty tournament", () => {
    const meta = { lineup: "E,H", seed: 1, learn: false, persona: "mix", faction: "mix", workers: 2, wallMs: 2000, gameMs: 500 };
    const text = formatReport(r, meta);
    expect(text).toContain("TOURNAMENT  10 games  lineup E,H");
    expect(text).toContain("throughput: 10 games in 2.0 s wall = 5.00 games/s with 2 workers");
    expect(text).toContain("per game: 500 ms of wall in a worker");
    expect(text).toContain("70.0% [39.7%, 89.2%]");
    expect(text).toContain("PER PERSONA");
    expect(text).toMatch(/PASS {2}zero commands refused/);
    expect(text).toMatch(/FAIL {2}Hard per-bot win share 0\.70/);
    const empty = formatReport(aggregate([]), { ...meta, wallMs: null });
    expect(empty).toContain("0 games");
    expect(empty).not.toContain("throughput");
  });

  it("counts draws and cut-off games", () => {
    const odd = aggregate([
      game([bot("hard", "draw", 1), bot("easy", "draw", 1)], { draw: true, winner: null }),
      game([bot("hard", "capped", 1), bot("easy", "capped", 1)], { ended: false, winner: null }),
    ]);
    expect(odd).toMatchObject({ games: 2, decided: 0, draws: 1, capped: 1 });
    expect(odd.tiers[0]!.winRate.k).toBe(0);
    expect(odd.tiers[0]).toMatchObject({ draws: 1, capped: 1 });
  });
});

// =============================================================================================================== batch and CLI

describe("the batch", () => {
  const plan: TournamentPlan = {
    games: 2, seed: 3, tiers: parseLineup("E,N,H"), persona: "mix", learn: false, maxSimMs: 60_000, config: SHORT,
  };

  it("replays byte for byte, game by game, with learning off", () => {
    const a = runBatch(plan, [0, 1]).map((r) => JSON.stringify(r.summary));
    const b = runBatch(plan, [0, 1]).map((r) => JSON.stringify(r.summary));
    expect(b).toEqual(a);
    expect(a[0]).not.toBe(a[1]);
    // A game does not depend on the batch around it.
    expect(runBatch(plan, [1]).map((r) => JSON.stringify(r.summary))[0]).toBe(a[1]);
  });

  it("replays with learning on too: a batch's store is its own and in memory", () => {
    const learning = { ...plan, learn: true };
    const a = runBatch(learning, [0, 1]).map((r) => JSON.stringify(r.summary));
    expect(runBatch(learning, [0, 1]).map((r) => JSON.stringify(r.summary))).toEqual(a);
  });
});

describe("the tuning patch (--tune)", () => {
  it("patches the tier and persona tables in place, deep and typed, and refuses a key the tables do not have", () => {
    const easy = JSON.stringify(TIERS.easy);
    const hunter = JSON.stringify(PERSONAS.hunter);
    try {
      applyTune({ tiers: { easy: { appraisal: { lead: 9 }, wary: 123 } }, personas: { hunter: { engageEdge: -4 } } });
      expect(TIERS.easy.appraisal.lead).toBe(9);
      expect(TIERS.easy.appraisal.noise).toBe(JSON.parse(easy).appraisal.noise); // a sibling is left alone
      expect(TIERS.easy.wary).toBe(123);
      expect(PERSONAS.hunter.engageEdge).toBe(-4);
      expect(() => applyTune({ tiers: { easy: { nothing: 1 } } })).toThrow(/unknown key/);
      expect(() => applyTune({ tiers: { easy: { wary: "far" } } })).toThrow(/must be a number/);
      expect(() => applyTune({ tiers: { expert: { wary: 1 } } })).toThrow(/unknown tier/);
      expect(() => applyTune({ personas: { bard: { pve: 1 } } })).toThrow(/unknown persona/);
    } finally {
      Object.assign(TIERS.easy, JSON.parse(easy));
      Object.assign(PERSONAS.hunter, JSON.parse(hunter));
    }
    expect(JSON.stringify(TIERS.easy)).toBe(easy);
    expect(JSON.stringify(PERSONAS.hunter)).toBe(hunter);
    expect(parseArgs(["--tune", '{"tiers":{"hard":{"wary":1}}}']).tune).toEqual({ tiers: { hard: { wary: 1 } } });
    expect(parseArgs([]).tune).toBeNull();
    expect(planOf(parseArgs(["--tune", "{}"])).tune).toEqual({});
  });

  it("a game reports when the first player died and the first mob fell", () => {
    const g = runGame({ seed: 7, lineup: LINEUP, config: SHORT, maxSimMs: 60_000 });
    expect(g.deathLog?.length).toBeGreaterThan(0);
    for (const [t, victim, killer] of g.deathLog ?? []) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(victim).toBeGreaterThanOrEqual(0);
      expect(killer).toBeGreaterThanOrEqual(-1);
    }
    for (const b of g.bots) if (b.mobKills > 0) expect(b.firstMobKillMs).not.toBeNull();
  });
});

describe("the CLI", () => {
  it("plays two games on two worker threads, prints the report and writes the games as JSON", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const server = path.resolve(here, "../..");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-tournament-"));
    const json = path.join(dir, "out.json");
    try {
      const run = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/bots/tournament/runTournament.ts", "--games", "2", "--workers", "2", "--lineup", "E,N,H", "--seed", "4",
          "--patience", "20", "--sudden", "6", "--max-minutes", "1", "--learn", "off", "--quiet", "--json", json],
        { cwd: server, encoding: "utf8", timeout: 50_000 },
      );
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("TOURNAMENT  2 games  lineup E,N,H");
      expect(run.stdout).toContain("PER TIER");
      expect(run.stdout).toContain("CRITERIA");
      const out = JSON.parse(fs.readFileSync(json, "utf8")) as { games: GameSummary[]; criteria: unknown[] };
      expect(out.games).toHaveLength(2);
      expect(out.games.map((g) => g.bots.length)).toEqual([3, 3]);
      expect(out.criteria.length).toBeGreaterThan(0);
      // The same games in this thread: workers change nothing.
      const mine = runBatch(planOf(parseArgs(["--games", "2", "--lineup", "E,N,H", "--seed", "4", "--patience", "20", "--sudden", "6", "--max-minutes", "1", "--learn", "off"])), [0, 1]);
      expect(out.games).toEqual(JSON.parse(JSON.stringify(mine.map((m) => m.summary))));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a bad option with a message and a non-zero status", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/bots/tournament/runTournament.ts", "--lineup", "Q"], {
      cwd: path.resolve(here, "../.."), encoding: "utf8", timeout: 30_000,
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('unknown tier "q"');
    expect(run.stderr).toContain("usage:");
  });
});
