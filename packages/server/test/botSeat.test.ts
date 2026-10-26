// A server-filled bot in the sim (docs/BOTS.md): the identity flag it carries and the anti-farming rules that follow from
// it. A bot is a normal player in every way the fight can see (spawns, immunity, results, the patience timer), but
//   a. killing it pays no kill GV and no bounty GV, while the kill still counts in the run (kills, the stack transfer and
//      the kill combos) but not on the killer's bounty ladder (a bounty built on bots would be cashable by an alt);
//   b. a RunResult's `kills` (what the Room records as stats) leaves its kills out;
//   c. the win bonus counts human starters and human opponents only;
//   d. its own result is flagged, so the Room drops it (test/botRoom.test.ts runs that part through a real Room).
import { describe, expect, it } from "vitest";
import {
  bountyFor, bountyStacks, GV_KILL, GV_WIN, mulberry32, TICK_MS, WIN_BONUS_MIN_OPPONENTS, WIN_BONUS_MIN_PLAYERS, type RunResult,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { applyDamage, type Attacker } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import type { PlayerRuntime, SimEvent, World } from "../src/sim/world";

type EventOf<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;

const ofType = <T extends SimEvent["type"]>(events: SimEvent[], type: T): Array<EventOf<T>> =>
  events.filter((e): e is EventOf<T> => e.type === type);

/** Humans `h0..` (callsigns human0..) and bots `b0..` (Bot0..), in that join order, and a run that started on the first step. */
function startRun(humans: number, bots: number): World {
  const world = createGameWorld({
    seed: 1234,
    config: {
      minPlayers: humans, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 600, patienceMinSeconds: 600, suddenDeathSeconds: 600,
    },
    random: mulberry32(1235),
  });
  for (let i = 0; i < humans; i++) addPlayer(world, `h${i}`, `human${i}`);
  for (let i = 0; i < bots; i++) addPlayer(world, `b${i}`, `Bot${i}`, { bot: true });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

const P = (w: World, id: string): PlayerState => w.state.players.get(id)!;
const RT = (w: World, id: string): PlayerRuntime => w.players.get(id)!;
const by = (w: World, id: string): Attacker => ({ id, p: P(w, id), rt: RT(w, id) });

/** `killer` lands a lethal blow on `victim` between ticks. */
function slay(w: World, killer: string, victim: string): number {
  return applyDamage(w, P(w, victim), RT(w, victim), P(w, victim).hp + 1000, by(w, killer));
}

/** A death nobody is credited for (a stray source), so the victim is out without anyone's kill or damage. */
function drop(w: World, victim: string): void {
  RT(w, victim).lastHit = null;
  applyDamage(w, P(w, victim), RT(w, victim), P(w, victim).hp + 1000, "test");
}

const tick = (w: World): SimEvent[] => step(w, TICK_MS);

function resultsOf(events: SimEvent[]): Record<string, RunResult> {
  const out: Record<string, RunResult> = {};
  for (const e of ofType(events, "resolved")) out[e.id] = e.result;
  return out;
}

describe("a bot's identity", () => {
  it("addPlayer marks the synced state and the runtime, and only when asked", () => {
    const w = startRun(1, 1);
    expect(P(w, "b0").bot).toBe(true);
    expect(RT(w, "b0").bot).toBe(true);
    expect(P(w, "h0").bot).toBe(false);
    expect("bot" in RT(w, "h0")).toBe(false);
  });

  it("a bot is the same player as a human otherwise: lobby spot, faction, hp, weapon, status, its own input queue", () => {
    const w = startRun(1, 1);
    const [h, b] = [P(w, "h0"), P(w, "b0")];
    expect(b).toMatchObject({ name: "Bot0", status: "alive", look: 0 });
    expect(b.hp).toBe(b.maxHp);
    expect(b.weapon0).not.toBe("");
    expect(RT(w, "b0").inputs).not.toBe(RT(w, "h0").inputs);
    expect(RT(w, "b0").profile).toBe("Bot0");
    expect(h.status).toBe("alive");
  });

  it("the run counts bots in startedWith (the place line, contested) and not in startedHumans", () => {
    const w = startRun(2, 3);
    expect(w.arena.startedWith).toBe(5);
    expect(w.state.startedWith).toBe(5);
    expect(w.arena.startedHumans).toBe(2);
  });

  it("a run of bots and one human is contested: the last one standing ends it, whoever it is", () => {
    const w = startRun(1, 1);
    drop(w, "b0");
    const events = tick(w);
    expect(w.state.phase).toBe("ended");
    expect(resultsOf(events).h0).toMatchObject({ outcome: "won", players: 2 });
  });

  it("a bot's resolved event is flagged, a human's is not, and a bot removed before the event is handled keeps its flag", () => {
    const w = startRun(2, 2);
    drop(w, "b0");
    drop(w, "h1");
    // Between ticks, like BotManager retiring a bot: the runtime is gone by the time the Room reads the event.
    removePlayer(w, "b1");
    expect(w.players.has("b1")).toBe(false);
    const resolved = ofType(tick(w), "resolved");
    const flags = Object.fromEntries(resolved.map((e) => [e.id, e.bot === true]));
    expect(flags).toEqual({ b0: true, h1: false, b1: true, h0: false });
    expect(resolved.find((e) => e.id === "b1")!.result.outcome).toBe("mia");
  });
});

describe("killing a bot", () => {
  it("pays no kill GV and no GV event, and counts as a kill in the run", () => {
    const w = startRun(2, 3);
    slay(w, "h0", "b0");
    expect(RT(w, "h0").gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(P(w, "h0").gv).toBe(0);
    expect(ofType(w.events, "gv")).toEqual([]);
    expect(P(w, "h0").kills).toBe(1);
    expect(RT(w, "h0").botKills).toBe(1);
  });

  it("a human victim still pays GV_KILL: the rule is about the victim, not the killer", () => {
    const w = startRun(3, 1);
    slay(w, "h0", "h1");
    expect(RT(w, "h0").gv.kills).toBe(GV_KILL);
    expect(ofType(w.events, "gv")).toEqual([{ type: "gv", id: "h0", amount: GV_KILL, reason: "kill" }]);
    expect(RT(w, "h0").botKills ?? 0).toBe(0);
  });

  it("a bot's bounty is not paid, but its stacks still move to the killer", () => {
    const w = startRun(2, 5);
    P(w, "b0").bounty = 90;
    P(w, "b0").stacksHp = 4;
    slay(w, "h0", "b0");
    expect(RT(w, "h0").gv.bounty).toBe(0);
    expect(ofType(w.events, "gv").filter((e) => e.reason === "bounty")).toEqual([]);
    expect(P(w, "h0").stacksHp).toBeCloseTo(bountyStacks(4), 6); // the bountyClaimed hook ran
  });

  it("three bot kills put no bounty on the killer, though the run counts them", () => {
    const w = startRun(2, 5);
    for (const b of ["b0", "b1", "b2"]) slay(w, "h0", b);
    expect(P(w, "h0").kills).toBe(3);
    expect(RT(w, "h0").botKills).toBe(3);
    expect(P(w, "h0").bounty).toBe(0);
    expect(ofType(w.events, "fx").filter((e) => e.fx.kind === "bounty")).toEqual([]);
    expect(RT(w, "h0").gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    // A rival who then kills the "rampaging" bot-farmer is paid the kill and nothing more.
    slay(w, "h1", "h0");
    expect(RT(w, "h1").gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 0 });
  });

  it("the ladder counts the killer's human kills only, whatever order the bot kills come in", () => {
    const w = startRun(5, 4);
    slay(w, "h0", "b0");
    slay(w, "h0", "b1");
    slay(w, "h0", "h1");
    slay(w, "h0", "h2");
    expect(P(w, "h0").kills).toBe(4);
    expect(P(w, "h0").bounty).toBe(0); // two human kills: still free
    slay(w, "h0", "b2");
    slay(w, "h0", "b3");
    expect(P(w, "h0").kills).toBe(6);
    expect(P(w, "h0").bounty).toBe(0);
    slay(w, "h0", "h3");
    expect(P(w, "h0").kills).toBe(7);
    expect(P(w, "h0").bounty).toBe(bountyFor(3)); // three human kills, not seven
    expect(bountyFor(3)).toBeGreaterThan(0);
    const rampages = ofType(w.events, "fx").filter((e) => e.fx.kind === "bounty");
    expect(rampages).toHaveLength(1);
    expect(rampages[0]!.fx).toMatchObject({ kind: "bounty", id: "h0", bounty: bountyFor(3) });
  });

  it("a human who has earned a bounty on humans keeps it as bot kills pile on, and the next human kill climbs the ladder", () => {
    const w = startRun(5, 3);
    slay(w, "h0", "h1");
    slay(w, "h0", "h2");
    slay(w, "h0", "h3");
    expect(P(w, "h0").bounty).toBe(bountyFor(3));
    for (const b of ["b0", "b1", "b2"]) slay(w, "h0", b);
    expect(P(w, "h0").kills).toBe(6);
    expect(P(w, "h0").bounty).toBe(bountyFor(3));
    slay(w, "h0", "h4");
    expect(P(w, "h0").bounty).toBe(bountyFor(4));
  });

  it("control: the same bounty on a human victim is paid", () => {
    const w = startRun(3, 1);
    P(w, "h1").bounty = 90;
    slay(w, "h0", "h1");
    expect(RT(w, "h0").gv).toEqual({ kills: GV_KILL, mobs: 0, bounty: 90 });
  });

  it("the kill combos fire for it like for any kill (the playerKilled hook runs)", () => {
    const w = startRun(2, 3);
    let kills = 0;
    const prev = w.hooks.playerKilled;
    w.hooks.playerKilled = (world, killer) => { prev?.(world, killer); kills++; };
    slay(w, "h0", "b0");
    expect(kills).toBe(1);
  });

  it("a bot that leaves the run soon after a human hit it is that human's kill, and still pays nothing", () => {
    const w = startRun(2, 3);
    applyDamage(w, P(w, "b0"), RT(w, "b0"), 1, by(w, "h0"));
    removePlayer(w, "b0");
    expect(P(w, "h0").kills).toBe(1);
    expect(RT(w, "h0").botKills).toBe(1);
    expect(RT(w, "h0").gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
  });

  it("two bots killing each other change nothing outside the run: nothing is banked for either", () => {
    const w = startRun(2, 3);
    slay(w, "b0", "b1");
    expect(RT(w, "b0").gv).toEqual({ kills: 0, mobs: 0, bounty: 0 });
    expect(P(w, "b0").kills).toBe(1);
  });

  it("a bot's kill of a human still pays the bot its GV in the run (the Room drops it; the sim does not special-case it)", () => {
    const w = startRun(2, 2);
    slay(w, "b0", "h1");
    expect(RT(w, "b0").gv.kills).toBe(GV_KILL);
  });
});

describe("the kills a result records", () => {
  it("leave the kills of bots out; the run's own count (the HUD) keeps all of them", () => {
    const w = startRun(3, 2);
    slay(w, "h0", "b0");
    slay(w, "h0", "b1");
    slay(w, "h0", "h1");
    expect(P(w, "h0").kills).toBe(3);
    drop(w, "h0");
    const results = resultsOf(tick(w));
    expect(results.h0).toMatchObject({ outcome: "died", kills: 1 });
    expect(results.h1).toMatchObject({ outcome: "died", kills: 0 });
    expect(results.h2).toMatchObject({ outcome: "won", kills: 0 });
  });

  it("count a winner's human kills only, and the players figure still counts the bots", () => {
    const w = startRun(2, 3);
    slay(w, "h0", "b0");
    slay(w, "h0", "b1");
    slay(w, "h0", "b2");
    slay(w, "h0", "h1");
    const results = resultsOf(tick(w));
    expect(results.h0).toMatchObject({ outcome: "won", kills: 1, players: 5 });
    expect(P(w, "h0").kills).toBe(4);
  });

  it("a result with no bot kills is unchanged", () => {
    const w = startRun(3, 1);
    slay(w, "h0", "h1");
    drop(w, "h0");
    expect(resultsOf(tick(w)).h0).toMatchObject({ kills: 1 });
  });
});

describe("who killed a player", () => {
  it("a result says when the killer was a bot", () => {
    const w = startRun(2, 2);
    slay(w, "b0", "h1");
    const r = resultsOf(tick(w)).h1!;
    expect(r).toMatchObject({ outcome: "died", killedBy: "Bot0", killedByBot: true });
  });

  it("says nothing when the killer was human or the arena", () => {
    const w = startRun(3, 1);
    slay(w, "h0", "h1");
    drop(w, "h2");
    const results = resultsOf(tick(w));
    expect(results.h1).toMatchObject({ killedBy: "human0" });
    expect(results.h1).not.toHaveProperty("killedByBot");
    expect(results.h2).not.toHaveProperty("killedByBot");
  });
});

describe("the win bonus counts humans only", () => {
  it("is withheld with fewer than WIN_BONUS_MIN_PLAYERS humans, however many bots started and were damaged", () => {
    expect(WIN_BONUS_MIN_PLAYERS).toBe(3);
    const w = startRun(2, 5);
    for (const b of ["b0", "b1", "b2", "b3", "b4"]) slay(w, "h0", b);
    slay(w, "h0", "h1");
    expect(RT(w, "h0").damaged.size).toBe(6); // plenty of opponents, but only one of them human
    const r = resultsOf(tick(w)).h0!;
    expect(r).toMatchObject({ outcome: "won", winBonusWithheld: true, players: 7 });
    expect(r.gv.win).toBe(0);
  });

  it("is withheld when the humans started in numbers but the winner damaged fewer than WIN_BONUS_MIN_OPPONENTS of them", () => {
    expect(WIN_BONUS_MIN_OPPONENTS).toBe(2);
    const w = startRun(3, 3);
    for (const b of ["b0", "b1", "b2"]) slay(w, "h0", b);
    slay(w, "h0", "h1");
    drop(w, "h2"); // died to something else: not damage from the winner
    expect(RT(w, "h0").damaged.size).toBe(4);
    const r = resultsOf(tick(w)).h0!;
    expect(r).toMatchObject({ outcome: "won", winBonusWithheld: true });
    expect(r.gv.win).toBe(0);
  });

  it("is paid with WIN_BONUS_MIN_PLAYERS humans and damage on WIN_BONUS_MIN_OPPONENTS human opponents, bots or no bots", () => {
    const w = startRun(3, 3);
    for (const b of ["b0", "b1", "b2"]) slay(w, "h0", b);
    slay(w, "h0", "h1");
    slay(w, "h0", "h2");
    const r = resultsOf(tick(w)).h0!;
    expect(r).toMatchObject({ outcome: "won", winBonusWithheld: false, kills: 2 });
    expect(r.gv.win).toBe(GV_WIN);
    // The kills of bots paid no GV; the two human kills did.
    expect(r.gv.kills).toBe(2 * GV_KILL);
  });

  it("is unchanged for a human-only run (the control)", () => {
    const w = startRun(3, 0);
    slay(w, "h0", "h1");
    slay(w, "h0", "h2");
    expect(resultsOf(tick(w)).h0).toMatchObject({ outcome: "won", winBonusWithheld: false, gv: { win: GV_WIN } });
  });

  it("a bot's death is damage to a bot, not a human opponent, even when the bot is gone from the world by the end", () => {
    const w = startRun(3, 2);
    slay(w, "h0", "b0");
    removePlayer(w, "b1"); // retired mid-run
    slay(w, "h0", "h1");
    drop(w, "h2");
    expect(RT(w, "h0").damagedHumans?.size).toBe(1);
    expect(resultsOf(tick(w)).h0).toMatchObject({ outcome: "won", winBonusWithheld: true });
  });
});
