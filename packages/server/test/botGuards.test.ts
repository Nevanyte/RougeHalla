// The fill bots against the playtest guards (docs/BOTS.md 7; hosting.test.ts and passcode.test.ts test the guards alone). The real
// server on a free port with every guard switched on at once: a playtest passcode, a cap of one arena room, a cap on new callsigns,
// a small order budget, and fill bots. A bot is a PlayerState with no client, no profile, no seat and no address, so what is pinned
// here is that each guard counts what it is meant to count and nothing more:
//   caps         rooms are counted, never players: a lobby of one human and bots is open to the next human, the newest bot gives
//                its seat up when the lobby is full, and eight humans can displace seven bots under a cap of one room
//   addresses    a bot takes no callsign from the new-profile caps (it has no profile and no address) and is never in the store
//   orders       the budget belongs to the Room's message handler, which only real clients reach: a bot's commands go straight
//                to enqueueClientMessage, are never refused for it, and open no bucket; a human's budget stays its own
//   passcode     the fill arrives on a server with a passcode and asks for none, and bots count as no wrong guess
//   persistence  nothing a bot does reaches recordRun or bankGv (test/botRoom.test.ts has the sim-level tripwire)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_PLAYERS, PASSCODE_HEADER, ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { BotManager } from "../src/bots/BotManager";
import { BOT_ID_PREFIX, type Command } from "../src/bots/brain/types";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import type { World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* not there yet */ }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(10);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------- fixture
const PASSCODE = "open-sesame";
const FILL_TO = 6;
/** Seeded into the profile file before the server starts, so none of them counts as a new callsign. */
const SEEDED = Array.from({ length: 16 }, (_, i) => `human${i + 1}`);
const tokenOf = (name: string) => `tok-${name}`;
const BURST = 5;
const NEW_PER_IP = 2;

let server: RaidServer;
let port = 0;
let dir = "";
let client: Client;
let nextSeed = 0;
const open: ClientRoom[] = [];

const account = () => {
  const name = SEEDED[nextSeed++];
  if (name === undefined) throw new Error("out of seeded profiles");
  return { name, token: tokenOf(name) };
};
const joinOptions = (a: { name: string; token: string }): JoinOptions => ({ profile: a.name, token: a.token, passcode: PASSCODE });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-botguards-"));
  const profileFile = path.join(dir, "data", "stash.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  const profile = (name: string) => ({
    name, token: tokenOf(name), gv: 0, gvLifetime: 0, gvByMonth: {}, stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
    cosmetics: { owned: [], equipped: {} }, achievements: {}, progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
  });
  fs.writeFileSync(profileFile, JSON.stringify({ version: 2, profiles: Object.fromEntries(SEEDED.map((n) => [n, profile(n)])) }));
  port = await freePort();
  server = await startServer({
    ...loadConfig({
      BOTS_FILL_TO: String(FILL_TO), BOT_STATS_FILE: "off", BOTS_SEED: "7",
      PLAYTEST_PASSCODE: PASSCODE, PASSCODE_FAILS_PER_MINUTE: "3", PASSCODE_FAILS_PER_MINUTE_ALL: "50",
    }),
    port,
    latencyMs: 0,
    stashFile: profileFile,
    lobbySeconds: 600, // a lobby stays open for as long as a test needs
    minPlayers: 99, // and never counts as filled
    planSeconds: 0,
    // The whole guard set, on: one arena room, two new callsigns an hour from one address, five orders in a burst.
    maxArenaRooms: 1,
    maxTrainingRooms: 1,
    maxNewProfilesPerHour: 3,
    maxNewProfilesPerIpPerHour: NEW_PER_IP,
    orderBurst: BURST,
    orderPerSecond: BURST,
  });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  for (const room of open.splice(0)) await room.leave(true).catch(() => {});
  try {
    await server?.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const room of open.splice(0)) await room.leave(true).catch(() => {});
  await until(() => server.rooms.count("arena") === 0 && server.profiles.size === 0, "the room to be disposed and the profiles released");
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function join(a: { name: string; token: string }): Promise<ClientRoom> {
  const room = await client.joinOrCreate<RaidState>(ROOM_NAME, joinOptions(a));
  open.push(room);
  return room;
}

interface ServerRoomView {
  world: World;
  bots: BotManager | undefined;
  refusedOrders: number;
  budgets: Map<string, unknown>;
  tick(elapsedMs: number): void;
}
const serverRoom = (room: ClientRoom) => matchMaker.getLocalRoomById(room.roomId) as unknown as ServerRoomView;

const botsIn = (w: World) => [...w.state.players.values()].filter((p) => p.bot).length;
const humansIn = (w: World) => [...w.state.players.values()].filter((p) => !p.bot).length;

/** Everything that reaches persistence, with the name it was made for. The spies call through. */
function watchPersistence() {
  const runs = vi.spyOn(server.store, "recordRun");
  const banks = vi.spyOn(server.store, "bankGv");
  return { recorded: () => runs.mock.calls.map((c) => c[0]), banked: () => banks.mock.calls.map((c) => c[0]) };
}

// ---------------------------------------------------------------- the caps
describe("bots and the room caps", () => {
  it("a lobby of one human and bots is open to every human under a cap of one room, and each human takes a bot's seat", async () => {
    const watch = watchPersistence();
    const first = await join(account());
    const view = serverRoom(first);
    // Frozen between steps, so a lobby that reaches MAX_PLAYERS stays a lobby long enough for the next human to arrive in it
    // (the sim closes a full lobby on its next step; the window the yield exists for is the one before that step).
    vi.spyOn(view, "tick").mockImplementation(() => {});
    const bots = view.bots!;
    expect(bots).toBeDefined();
    for (let i = 0; i < FILL_TO; i++) expect(bots.addBot()).not.toBeNull();
    expect([humansIn(view.world), botsIn(view.world)]).toEqual([1, FILL_TO]);
    expect(server.rooms.count("arena")).toBe(1);

    // Every later human lands in the same room: no second room is asked for (it would be refused: the cap is 1), and bots are
    // not seats for the matchmaker (maxClients counts clients), so the room is never "full" while a bot holds a place.
    const joined = [first];
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      const room = await join(account());
      joined.push(room);
      expect(room.roomId, `human ${n} joined the open lobby`).toBe(first.roomId);
      expect(server.rooms.count("arena"), `human ${n}`).toBe(1);
      // The first fits beside the bots (7 of 8 places taken); from the second on the lobby is full and the newest bot yields.
      expect(view.world.state.players.size).toBe(MAX_PLAYERS);
      expect(humansIn(view.world)).toBe(n);
      expect(botsIn(view.world)).toBe(MAX_PLAYERS - n);
      expect(bots.stats.yielded).toBe(Math.max(0, n - 2));
      expect(view.world.state.players.has(room.sessionId)).toBe(true);
    }
    // Eight humans and no bot: the room is full of clients now, so the ninth needs a room of its own, which the cap refuses.
    expect(botsIn(view.world)).toBe(0);
    await expect(join(account())).rejects.toThrow(/server is full/i);
    expect(server.rooms.count("arena")).toBe(1);

    // Only humans hold the profile registry and the persistence.
    expect(server.profiles.size).toBe(MAX_PLAYERS);
    for (const room of joined) await room.leave(true);
    open.splice(0);
    await until(() => server.rooms.count("arena") === 0, "the room to be disposed");
    expect(watch.recorded()).toEqual([]); // a lobby leave records nothing
    expect(watch.banked()).toEqual([]);
  });
});

// ---------------------------------------------------------------- the per-address limits
describe("bots and the per-address limits", () => {
  const claim = (name: string) => fetch(url(`/api/profile/${name}`), { headers: { [PASSCODE_HEADER]: PASSCODE } });

  it("a bot takes no place in the new-callsign caps and leaves no profile behind", async () => {
    const room = await join(account());
    const view = serverRoom(room);
    for (let i = 0; i < 5; i++) expect(view.bots!.addBot()).not.toBeNull();
    const names = [...view.world.state.players.values()].filter((p) => p.bot).map((p) => p.name);
    expect(names).toHaveLength(5);
    // Five bots are in a room: if they counted as new callsigns (or took the address's place), the two claims would not both pass.
    for (let i = 1; i <= NEW_PER_IP; i++) {
      const res = await claim(`fresh${i}`);
      expect(res.status, `claim ${i}`).toBe(200);
      expect(((await res.json()) as { created: boolean }).created).toBe(true);
    }
    // And the cap is real: it is the humans' claims that fill it.
    const refused = await claim("fresh3");
    expect(refused.status).toBe(429);
    expect(server.store.get("fresh3")).toBeUndefined();

    // A bot's name is read from the store, never written to it.
    for (const name of names) expect(server.store.get(name), name).toBeUndefined();
    expect(server.profiles.size).toBe(1);
  });
});

// ---------------------------------------------------------------- the order budget
describe("bots and the order budget", () => {
  it("a bot's commands are never refused for the budget and open no bucket, and a human's budget stays its own", async () => {
    const room = await join(account());
    await until(() => !!room.state?.players, "the first state");
    const view = serverRoom(room);
    const bots = view.bots!;
    for (let i = 0; i < 3; i++) bots.addBot();
    const botId = [...view.world.state.players.entries()].find(([, p]) => p.bot)![0];
    expect(botId.startsWith(BOT_ID_PREFIX)).toBe(true);

    // Sixty commands from one bot at once: twelve times the burst. They are handed to the delay line exactly as a brain's clicks
    // are, and reach enqueueClientMessage a few ms of server time later.
    const seat = bots["seats"].get(botId)!;
    const at = view.world.state.serverTime;
    const COMMANDS = 60;
    for (let i = 0; i < COMMANDS; i++) {
      const cmd: Command = i % 2 ? { type: "stop", msg: {} } : { type: "move", msg: { x: 100 + i, y: 100 } };
      expect(bots["deliver"](seat.line, cmd, at)).toBe(true);
    }
    await until(() => bots.stats.applied >= COMMANDS, "the bot's commands to be applied", 4000);
    expect(bots.stats.refused).toBe(0);
    expect(bots.stats.lost).toBe(0);
    expect(view.refusedOrders).toBe(0); // the Room's budget never saw them...
    expect(view.budgets.size).toBe(0); // ...and no bucket was opened for the bot (only a client's first order opens one)

    // The human's budget is untouched by that traffic: its whole burst is still there, and the sixth order is the first refused.
    for (let i = 0; i < BURST; i++) room.send("move", { x: 100, y: 100 });
    await sleep(150);
    expect(view.refusedOrders).toBe(0);
    for (let i = 0; i < 20; i++) room.send(i % 2 ? "stop" : "move", i % 2 ? {} : { x: 200 + i, y: 100 });
    await until(() => view.refusedOrders >= 10, "the human's excess to be refused");
    expect(view.refusedOrders).toBeLessThanOrEqual(20);
    expect([...view.budgets.keys()]).toEqual([room.sessionId]);
  });
});

// ---------------------------------------------------------------- the passcode
describe("bots and the passcode gate", () => {
  it("the fill arrives on its own schedule on a server that asks for a passcode, asks for none, and leaves no trace in persistence", async () => {
    const watch = watchPersistence();
    const me = account();
    const room = await join(me);
    const view = serverRoom(room);
    const { world } = view;
    expect(humansIn(world)).toBe(1);
    expect(botsIn(world)).toBe(0);

    // The real arrival path (lobbyTick, then lobbyClosing's top-up): the countdown is cut to a couple of seconds.
    world.state.lobbyEndsAt = world.state.serverTime + 2500;
    await until(() => world.state.phase === "active", "the run to start", 10_000);
    expect([humansIn(world), botsIn(world)]).toEqual([1, FILL_TO - 1]);
    await until(() => room.state.phase === "active" && [...room.state.players.values()].filter((p) => p.bot).length === FILL_TO - 1, "the client to see the fill");

    // Nothing in this went through the gate: its counters hold no wrong guess, so the first one is still just a "no" (401),
    // not a throttle (429), and the profile registry holds the one human.
    expect(server.profiles.size).toBe(1);
    const wrong = await fetch(url("/api/profile/stranger"), { headers: { [PASSCODE_HEADER]: "nope" } });
    expect(wrong.status).toBe(401);

    // The human walks out: the run is recorded for the human alone, whatever the bots' names.
    await room.leave(true);
    open.splice(0);
    await until(() => server.rooms.count("arena") === 0, "the room to be disposed");
    expect(watch.recorded()).toEqual([me.name]);
    expect(watch.banked()).toEqual([]);
    for (const p of world.state.players.values()) if (p.bot) expect(server.store.get(p.name), p.name).toBeUndefined();
  });
});
