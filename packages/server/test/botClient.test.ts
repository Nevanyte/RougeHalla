// BotClient as the network adapter of the brain (bots/BotClient.ts, docs/BOTS.md 1): one runner frame per state patch, the
// brain's commands sent with `room.send` under the 90-a-second guard, the result closing the brain's run into the learning
// store, and the options that pick the tier, the persona and the seed. A fake room stands in for the SDK's: no socket, no
// server, no clock but the state's own (the brain reads time off `state.serverTime`). The brain itself is tested in
// test/bots/; the whole thing against a real server is e2e.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateMap, hasLineOfSight, packFx, PLAYER_RADIUS, segmentClear, type GameMap, type RunResult, type Vec2 } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { BotClient, type BotOptions } from "../src/bots/BotClient";
import { PERSONA_IDS } from "../src/bots/brain/types";
import { plainPlayer, plainState, type PlainState } from "./bots/fairnessKit";

const FRAME_MS = 50;
const SEED = 7;
/** How far the foe stands from the bot: in the server's reach for a lock, out of a sword's. */
const FOE_DISTANCE = 220;

type Handler = (...args: any[]) => void;

/** What the test reaches into: the connection steps `connect` would have run, and the adapter's send. */
interface Internals {
  room: unknown;
  profile: string;
  listen(room: unknown): void;
  start(room: unknown, gv: number): void;
  sendCommand(cmd: { type: string; msg: unknown }): boolean;
}

interface Rig {
  bot: BotClient;
  state: PlainState;
  sent: Array<{ type: string; msg: Record<string, unknown> }>;
  handlers: Map<string, Handler>;
  /** One patch: the state's clock moves on and every state-change listener is called, as the SDK does. */
  patch(ms?: number): void;
}

/** A spawn and a point `d` away from it that a player can stand on and see (and walk to) straight from there. */
function openingFor(map: GameMap, d: number): { home: Vec2; foe: Vec2 } {
  for (const home of map.spawns) {
    for (let a = 0; a < 360; a += 5) {
      const foe = { x: home.x + d * Math.cos((a * Math.PI) / 180), y: home.y + d * Math.sin((a * Math.PI) / 180) };
      if (hasLineOfSight(map, home, foe) && segmentClear(map, home, foe, PLAYER_RADIUS)) return { home: { x: home.x, y: home.y }, foe };
    }
  }
  throw new Error(`no spawn with a clear line ${d} u long`);
}

function rig(opts: BotOptions = {}): Rig {
  const map = generateMap(SEED);
  const { home, foe } = openingFor(map, FOE_DISTANCE);
  const state = plainState({ seed: SEED, serverTime: 100_000, raidStartedAt: 60_000 });
  state.players.set("me", plainPlayer({ name: "me", x: home.x, y: home.y, weapon0: "sword" }));
  state.players.set("foe", plainPlayer({ name: "foe", x: foe.x, y: foe.y, weapon0: "sword" }));
  const sent: Rig["sent"] = [];
  const handlers = new Map<string, Handler>();
  const patches: Handler[] = [];
  const room = {
    roomId: "room1",
    sessionId: "me",
    state,
    send: (type: string, msg: Record<string, unknown>) => sent.push({ type, msg }),
    onMessage: (type: string, cb: Handler) => { handlers.set(type, cb); },
    onStateChange: (cb: Handler) => { patches.push(cb); },
    onLeave: () => {},
    onError: () => {},
    reconnection: { enabled: true },
    connection: { isOpen: false },
    leave: async () => {},
  };
  const bot = new BotClient(opts);
  const inside = bot as unknown as Internals;
  inside.room = room;
  inside.profile = "tester";
  inside.listen(room);
  inside.start(room, 0);
  return {
    bot, state, sent, handlers,
    patch(ms = FRAME_MS) {
      state.serverTime += ms;
      for (const cb of patches) cb(state as unknown as RaidState);
    },
  };
}

const sendOf = (b: BotClient) => (cmd: { type: string; msg: unknown }): boolean => (b as unknown as Internals).sendCommand(cmd);

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    outcome: "won", profile: "tester", durationSec: 40, kills: 1, killedBy: null, place: 1, players: 4,
    gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 }, winBonusWithheld: false, ...over,
  };
}

describe("BotClient over a fake room", () => {
  it("plays a frame per patch: locks the foe once it is in reach and never sends aim, attack or release", () => {
    const r = rig({ tier: "hard", persona: "hunter", seed: 3 });
    for (let i = 0; i < 100; i++) {
      r.patch();
      // The server takes a lock the moment it hears one.
      if (r.sent.some((m) => m.type === "target")) r.state.players.get("me")!.attackTarget = "foe";
    }
    const targets = r.sent.filter((m) => m.type === "target");
    expect(targets.length, "it clicked the foe").toBeGreaterThanOrEqual(1);
    expect(targets.length, "and clicked once the server had taken the lock").toBeLessThanOrEqual(2);
    expect(targets[0]!.msg).toEqual({ id: "foe" });
    expect(r.sent.filter((m) => ["aim", "attack", "release"].includes(m.type))).toEqual([]);
    expect(r.bot.sent.target).toBe(targets.length);
    expect(r.bot.sent.aim + r.bot.sent.attack + r.bot.sent.release).toBe(0);
    expect(r.bot.sent.move + r.bot.sent.stop + r.bot.sent.target + r.bot.sent.swap + r.bot.sent.pickup).toBe(r.sent.length);
  });

  it("sends nothing in a lobby and starts to act only once the run is active", () => {
    const r = rig({ tier: "hard", persona: "hunter", seed: 3 });
    r.state.phase = "lobby";
    for (let i = 0; i < 60; i++) r.patch();
    expect(r.sent).toEqual([]);
    r.state.phase = "active";
    for (let i = 0; i < 100; i++) r.patch();
    expect(r.sent.length).toBeGreaterThan(0);
  });

  it("reports the brain's stats under the old names, and zeros before it has joined", () => {
    expect(new BotClient().stats).toEqual({ mobTargets: 0, mobDrops: 0, retreats: 0, mobFocusMs: 0, grabs: 0, maxStallMs: 0 });
    const r = rig({ seed: 3 });
    for (let i = 0; i < 40; i++) r.patch();
    const stats = r.bot.stats;
    expect(Object.keys(stats).sort()).toEqual(["grabs", "maxStallMs", "mobDrops", "mobFocusMs", "mobTargets", "retreats"]);
    for (const v of Object.values(stats)) expect(Number.isFinite(v) && v >= 0).toBe(true);
  });

  it("counts the teleport fx it is sent, and gives the brain the batches with the next patch", () => {
    const r = rig({ seed: 3 });
    r.handlers.get("fxs")!(packFx([{ kind: "teleport" }], r.state.serverTime));
    expect(r.bot.teleports).toBe(1);
    expect(() => r.patch()).not.toThrow();
  });

  it("takes the tier and the persona it is given; without a persona the seed draws one, the same one every time", () => {
    const given = rig({ tier: "easy", persona: "cautious", seed: 1 }).bot;
    expect([given.tierId, given.personaId]).toEqual(["easy", "cautious"]);
    const a = rig({ seed: 12345 }).bot;
    const b = rig({ seed: 12345 }).bot;
    expect(a.tierId, "the default tier").toBe("hard");
    expect(PERSONA_IDS).toContain(a.personaId);
    expect(b.personaId).toBe(a.personaId);
    const seen = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((s) => rig({ seed: s }).bot.personaId));
    expect(seen.size, "different seeds draw different personas").toBeGreaterThan(1);
  });

  it("plays the same from the same seed", () => {
    const play = (): string[] => {
      const r = rig({ tier: "normal", persona: "hunter", seed: 99 });
      for (let i = 0; i < 120; i++) {
        r.patch();
        if (r.sent.some((m) => m.type === "target")) r.state.players.get("me")!.attackTarget = "foe";
      }
      return r.sent.map((m) => JSON.stringify(m));
    };
    const first = play();
    expect(first.length).toBeGreaterThan(0);
    expect(play()).toEqual(first);
  });

  it("leaves with consent once the run is old enough, without a result (abandonAfterMs)", async () => {
    const r = rig({ seed: 3, abandonAfterMs: 1000 });
    r.state.raidStartedAt = r.state.serverTime - 500;
    r.patch();
    r.patch(300);
    let settled = false;
    void r.bot.run().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled, "not yet: 800 ms in").toBe(false);
    r.patch(400);
    const run = await r.bot.run();
    expect(run).toEqual({ profile: "tester", result: null, abandoned: true });
  });

  it("finishes with the result it is sent, counts it, and ignores patches after that", async () => {
    const r = rig({ seed: 3 });
    for (let i = 0; i < 10; i++) r.patch();
    const sentBefore = r.sent.length;
    r.handlers.get("result")!(result());
    const run = await r.bot.run();
    expect(run.result).toMatchObject({ outcome: "won", place: 1 });
    expect(run.error).toBeUndefined();
    expect(r.bot.resultsSeen).toBe(1);
    for (let i = 0; i < 40; i++) r.patch();
    expect(r.sent.length).toBe(sentBefore);
  });

  it("turns a crash of the brain into an error, not an exception in the SDK's callback", async () => {
    const r = rig({ seed: 3 });
    r.patch();
    (r.state as unknown as { players: unknown }).players = null;
    expect(() => r.patch()).not.toThrow();
    const run = await r.bot.run();
    expect(run.result).toBeNull();
    expect(run.error).toMatch(/^brain crashed/);
  });
});

describe("the network adapter's send", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); });
  afterEach(() => { vi.useRealTimers(); });

  it("refuses the 91st message inside a second and sends again when the second has passed", () => {
    const r = rig({ seed: 3 });
    const send = sendOf(r.bot);
    const stop = { type: "stop", msg: {} };
    const results = Array.from({ length: 100 }, () => send(stop));
    expect(results.filter(Boolean)).toHaveLength(90);
    expect(results.slice(90).every((ok) => !ok)).toBe(true);
    expect(r.sent).toHaveLength(90);
    expect(r.bot.sent.stop).toBe(90);
    vi.advanceTimersByTime(1000);
    expect(send(stop)).toBe(true);
    expect(r.bot.sent.stop).toBe(91);
  });

  it("sends nothing once the bot is done", async () => {
    const r = rig({ seed: 3 });
    r.handlers.get("result")!(result());
    await r.bot.run();
    expect(sendOf(r.bot)({ type: "stop", msg: {} })).toBe(false);
    expect(r.sent).toEqual([]);
  });
});

describe("the learning file", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-botclient-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it("is written with the run when one is given, and the bot reads what earlier runs left", async () => {
    const file = path.join(dir, "bot-stats.json");
    const first = rig({ seed: 3, tier: "hard", persona: "hunter", statsFile: file });
    for (let i = 0; i < 40; i++) first.patch();
    first.handlers.get("result")!(result({ place: 2, outcome: "died", killedBy: "foe" }));
    await first.bot.run();
    const written = JSON.parse(fs.readFileSync(file, "utf8")) as { version: number; baseline: Record<string, { n: number }> };
    expect(written.version).toBe(1);
    expect(written.baseline.hard!.n).toBe(1);
    // A second bot of the same process shares the store: its run adds to the same file instead of replacing it.
    const second = rig({ seed: 4, tier: "hard", persona: "farmer", statsFile: file });
    for (let i = 0; i < 40; i++) second.patch();
    second.handlers.get("result")!(result());
    await second.bot.run();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).baseline.hard.n).toBeGreaterThan(1);
  });

  it("is not touched by a bot that was not given one, nor by a run that never resolved", async () => {
    const none = rig({ seed: 3 });
    none.handlers.get("result")!(result());
    await none.bot.run();
    const file = path.join(dir, "never.json");
    const left = rig({ seed: 3, statsFile: file, abandonAfterMs: 100 });
    left.state.raidStartedAt = left.state.serverTime - 500;
    left.patch();
    await left.bot.run();
    expect(fs.existsSync(file), "a voided run is recorded nowhere").toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
