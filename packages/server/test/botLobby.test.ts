// The lobby rules the fill bots rely on (docs/BOTS.md 7.2): filler never cuts a human's countdown and never closes the lobby
// early (only eight humans do, or the timer), and a last top-up hook runs once right before the raid starts, on both start paths.
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, mulberry32, TICK_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, removePlayer, step } from "../src/sim/step";
import { chainHook, type SimConfig, type World } from "../src/sim/world";

function makeWorld(cfg: Partial<SimConfig> = {}): World {
  return createGameWorld({
    seed: 1234,
    config: {
      minPlayers: 2, lobbySeconds: 60, fillSeconds: 3, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 600, ...cfg,
    },
    random: mulberry32(1235),
  });
}

const human = (w: World, n: number): void => { addPlayer(w, `h${n}`, `human${n}`); };
const bot = (w: World, n: number): void => { addPlayer(w, `bot~${n}`, `Bot${n}`, { bot: true }); };

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(w, TICK_MS);
}

describe("bots do not shorten a human's countdown", () => {
  it("a human and a crowd of bots reach minPlayers in head count only: the countdown stays whole", () => {
    const w = makeWorld({ minPlayers: 2 });
    human(w, 0);
    for (let i = 0; i < 4; i++) bot(w, i);
    run(w, 40);
    expect(w.state.phase).toBe("lobby");
    expect(w.state.lobbyEndsAt).toBe(60_000);
  });

  it("a second human does shorten it, from the tick they are counted", () => {
    const w = makeWorld({ minPlayers: 2, fillSeconds: 3 });
    human(w, 0);
    for (let i = 0; i < 3; i++) bot(w, i);
    run(w, 20);
    expect(w.state.lobbyEndsAt).toBe(60_000);
    human(w, 1);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 3000);
  });

  it("bots that joined first are not counted either: the humans' count starts from zero", () => {
    const w = makeWorld({ minPlayers: 2, fillSeconds: 3 });
    for (let i = 0; i < 3; i++) bot(w, i);
    human(w, 0);
    run(w, 5);
    expect(w.state.lobbyEndsAt).toBe(60_000);
    human(w, 1);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 3000);
  });

  it("with only humans it behaves as it always did", () => {
    const w = makeWorld({ minPlayers: 3, fillSeconds: 1 });
    human(w, 0);
    human(w, 1);
    run(w, 10);
    expect(w.state.lobbyEndsAt).toBe(60_000);
    human(w, 2);
    step(w, TICK_MS);
    expect(w.state.lobbyEndsAt).toBe(w.state.serverTime + 1000);
  });

  it("a minPlayers of 1 still starts a lone human's fill window (the dev default), and bots alone never do", () => {
    const solo = makeWorld({ minPlayers: 1, fillSeconds: 2 });
    human(solo, 0);
    step(solo, TICK_MS);
    expect(solo.state.lobbyEndsAt).toBe(solo.state.serverTime + 2000);

    const onlyBots = makeWorld({ minPlayers: 1, fillSeconds: 2 });
    bot(onlyBots, 0);
    bot(onlyBots, 1);
    run(onlyBots, 5);
    expect(onlyBots.state.lobbyEndsAt).toBe(60_000);
  });

  it("a lobby full of humans still starts at once", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS; i++) human(w, i);
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
  });
});

describe("bots do not close the lobby early", () => {
  it("a lobby of MAX_PLAYERS that holds bots waits for the countdown, so the next human can take a bot's seat", () => {
    for (const humans of [1, 2, MAX_PLAYERS - 1]) {
      const w = makeWorld({ minPlayers: 2, lobbySeconds: 600, fillSeconds: 3 });
      for (let i = 0; i < humans; i++) human(w, i);
      for (let i = 0; i < MAX_PLAYERS - humans; i++) bot(w, i);
      expect(w.state.players.size, `${humans} humans`).toBe(MAX_PLAYERS);
      run(w, 40); // 2 s: a moment, not a countdown
      expect(w.state.phase, `${humans} humans`).toBe("lobby");
      expect(w.state.players.size).toBe(MAX_PLAYERS);
    }
  });

  it("starts when the countdown runs out, with everyone placed and alive (a bot that arrived last included)", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 600, fillSeconds: 1 });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) human(w, i);
    bot(w, 0);
    let calls = 0;
    w.hooks.lobbyClosing = () => { calls++; };
    run(w, 20); // seven humans: the countdown is the fill window, 1 s from the first step
    expect(w.state.phase).toBe("lobby");
    step(w, TICK_MS);
    expect(calls).toBe(1);
    expect(w.state.phase).toBe("active");
    for (const [id, p] of w.state.players) expect(p.status, id).toBe("alive");
    expect(w.state.players.get("bot~0")!.bot).toBe(true);
  });

  it("the eighth human, seated by a bot's yield, is what closes it", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS - 1; i++) human(w, i);
    bot(w, 0);
    run(w, 5);
    expect(w.state.phase).toBe("lobby");
    removePlayer(w, "bot~0"); // the bot yields its seat, as RaidRoom.onJoin does ...
    human(w, MAX_PLAYERS - 1); // ... and the eighth human takes it
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect([...w.players.values()].filter((rt) => rt.bot)).toHaveLength(0);
  });
});

describe("the lobbyClosing hook", () => {
  it("runs once, with the lobby still open, when the countdown runs out", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 2, fillSeconds: 5 });
    human(w, 0);
    const seen: Array<{ phase: string; players: number; tick: number }> = [];
    w.hooks.lobbyClosing = (world) => seen.push({ phase: world.state.phase, players: world.state.players.size, tick: world.state.tick });
    run(w, 39); // serverTime 1950: one tick short
    expect(seen).toEqual([]);
    const events = step(w, TICK_MS);
    expect(events).toEqual([{ type: "raidStarted" }]);
    expect(seen).toEqual([{ phase: "lobby", players: 1, tick: w.state.tick }]);
    run(w, 40); // an active raid does not call it again
    expect(seen).toHaveLength(1);
  });

  it("runs once, with the lobby still open, when the lobby is full", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 600 });
    for (let i = 0; i < MAX_PLAYERS; i++) human(w, i);
    let calls = 0;
    let phase = "";
    w.hooks.lobbyClosing = (world) => { calls++; phase = world.state.phase; };
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(calls).toBe(1);
    expect(phase).toBe("lobby");
  });

  it("does not run while the lobby waits, or for an empty lobby", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 60 });
    let calls = 0;
    w.hooks.lobbyClosing = () => { calls++; };
    run(w, 5); // empty
    human(w, 0);
    run(w, 100);
    expect(calls).toBe(0);
    expect(w.state.phase).toBe("lobby");
  });

  it("a player it adds is placed on a spawn, alive and counted when the raid starts", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1, fillSeconds: 5 });
    human(w, 0);
    human(w, 1);
    w.hooks.lobbyClosing = (world) => { bot(world, 7); bot(world, 8); };
    run(w, 19);
    expect(w.state.players.size).toBe(2);
    step(w, TICK_MS);
    expect(w.state.phase).toBe("active");
    expect(w.state.players.size).toBe(4);
    expect(w.state.startedWith).toBe(4);
    expect(w.arena.startedWith).toBe(4);
    expect(w.arena.startedHumans).toBe(2);

    const spawns = w.map.spawns;
    const at = new Set<string>();
    for (const [id, p] of w.state.players) {
      expect(p.status, id).toBe("alive");
      expect(spawns.some((s) => s.x === p.x && s.y === p.y), `${id} on a spawn`).toBe(true);
      at.add(`${p.x},${p.y}`);
      const rt = w.players.get(id)!;
      expect(rt.history, id).toEqual([{ t: w.state.serverTime, x: p.x, y: p.y }]);
    }
    expect(at.size).toBe(4); // distinct spawns
    expect(w.state.players.get("bot~7")!.bot).toBe(true);
    expect(w.players.get("bot~8")!.bot).toBe(true);
    expect(w.state.players.get("bot~7")!.weapon0).not.toBe("");
  });

  it("chained hooks all run, in the order they were added", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1 });
    human(w, 0);
    const order: string[] = [];
    chainHook(w, "lobbyClosing", () => { order.push("first"); });
    chainHook(w, "lobbyClosing", () => { order.push("second"); });
    run(w, 20);
    expect(order).toEqual(["first", "second"]);
    expect(w.state.phase).toBe("active");
  });

  it("an unset hook costs nothing: the raid starts as before", () => {
    const w = makeWorld({ minPlayers: 2, lobbySeconds: 1 });
    human(w, 0);
    expect(w.hooks.lobbyClosing).toBeUndefined();
    run(w, 20);
    expect(w.state.phase).toBe("active");
    expect(w.state.players.size).toBe(1);
  });
});
