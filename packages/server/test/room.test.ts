// The Room adapter end to end over real sockets: the real server in this process on a free port, a temp profile
// file, short timers, and SDK clients that send inputs only. What is checked here is what the adapter adds to the
// sim: who may join, when GV and stats bank (once, through the store, at the player's own result), when the
// profile registry frees up, and what happens to a dropped connection. The rules of the run itself (who wins, the
// patience timer, sudden death) are the sim's and have their own headless tests.
// Every test uses its own freshly claimed profiles, so nothing leaks between them.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  defaultFaction, ENDED_LINGER_SECONDS, FACTIONS, GV_KILL, GV_WIN, monthKey, PROFILE_TOKEN_HEADER, RECONNECT_SECONDS,
  ROOM_NAME, SIGNATURE_WEAPONS, unpackFx, type FactionId, type FxBatch, type JoinOptions, type ProfileStats, type RunResult, type TimedFx,
  type Vec2,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { ActiveProfiles } from "../src/rooms/RaidRoom";
import type { SimConfig, World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (xs: Iterable<number>): number => { let n = 0; for (const x of xs) n += x; return n; };

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* state not there yet */ }
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

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let stopped = false;
let port = 0;
let dir = "";
let profileFile = "";
let client: Client;
let testStart = 0;
const restoreConsole: Array<() => void> = [];

beforeAll(async () => {
  // The SDK prints this on every join the server refuses, which is most of what these tests do.
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("Room connection was closed unexpectedly")) return;
      original(...args);
    };
    restoreConsole.push(() => { console[method] = original; });
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-room-"));
  profileFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120, // a lone player must stay in the lobby for as long as a test needs
    patienceSeconds: 120,
    patienceMinSeconds: 120,
    suddenDeathSeconds: 120,
    latencyMs: 0,
    stashFile: profileFile,
  });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  try {
    if (!stopped) await server.stop();
  } finally {
    for (const restore of restoreConsole) restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  testStart = Date.now();
});

// ---------------------------------------------------------------- HTTP helpers
const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function api(name: string, token?: string) {
  const res = await fetch(url(`/api/profile/${name}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } });
  return { res, status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
}

let counter = 0;
interface Account { name: string; token: string }

/** A brand new profile, claimed over HTTP the way the menu does it. */
async function claim(): Promise<Account> {
  const name = `tp${++counter}`;
  const { status, body } = await api(name);
  expect(status).toBe(200);
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

const record = (who: Account) => server.store.get(who.name)!;
const isActive = (who: Account) => server.profiles.isActive(who.name);

/**
 * A profile that started empty holds exactly this much: `gv` in the balance, the lifetime total and the month, and the
 * stats that are named (the rest still zero).
 */
function expectBanked(who: Account, gv: number, stats: Partial<ProfileStats> = {}): void {
  const r = record(who);
  expect(r.gv, `${who.name} balance`).toBe(gv);
  expect(r.gvLifetime, `${who.name} lifetime`).toBe(gv);
  const months = new Set([monthKey(testStart), monthKey(Date.now())]);
  expect(Object.keys(r.gvByMonth).every((m) => months.has(m)), `${who.name} months ${JSON.stringify(r.gvByMonth)}`).toBe(true);
  expect(sum(Object.values(r.gvByMonth)), `${who.name} month`).toBe(gv);
  if (gv === 0) expect(r.gvByMonth).toEqual({});
  expect(r.stats, `${who.name} stats`).toEqual({ runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0, ...stats });
}

// ---------------------------------------------------------------- room helpers
interface Player {
  who: Account;
  room: ClientRoom;
  results: RunResult[];
  toasts: string[];
  fx: TimedFx[];
  left: boolean;
}

const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, results: [], toasts: [], fx: [], left: false };
  room.onMessage("result", (r: RunResult) => p.results.push(r));
  room.onMessage("toast", (m: { text: string }) => p.toasts.push(m.text));
  room.onMessage("fxs", (b: FxBatch) => p.fx.push(...unpackFx(b)));
  room.onLeave(() => { p.left = true; });
  players.push(p);
  return p;
}

const joinOptions = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });

/** The timers a test may change on its own room (the server's fixture values apply to everything else). */
type Timers = Partial<Pick<SimConfig, "minPlayers" | "patienceSeconds" | "patienceMinSeconds" | "suddenDeathSeconds">>;

/** Opens a brand new room (never someone else's lobby) with `who` in it. */
async function createRoom(who: Account, timers?: Timers): Promise<Player> {
  const p = track(who, await client.create<RaidState>(ROOM_NAME, joinOptions(who)));
  if (timers) retime(p, timers);
  return p;
}

async function joinRoom(into: Player, who: Account): Promise<Player> {
  return track(who, await client.joinById<RaidState>(into.room.roomId, joinOptions(who)));
}

interface ServerRoomView {
  world: World;
  clients: { getById(id: string): { ref: { terminate(): void } } | undefined };
  clock: { setTimeout(fn: () => void, ms: number, ...args: unknown[]): unknown };
  /** Private to the Room; peeked at to prove nothing is kept for a session that is gone. */
  pendingResults: Map<string, RunResult>;
}

const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const sessionOf = (p: Player) => p.room.sessionId;
const serverPlayer = (p: Player) => worldOf(p).state.players.get(sessionOf(p))!;

/** What a player starts a run with, given the order they joined their room in (0 = the first): nothing is brought in. */
function kitOf(faction: FactionId) {
  return { faction, hp: FACTIONS[faction].hp, maxHp: FACTIONS[faction].hp, weapon0: SIGNATURE_WEAPONS[faction], weapon1: "", slot: 0 };
}

function starterKit(joinIndex: number) {
  return kitOf(defaultFaction(joinIndex));
}

/** The server's player: faction, hp and weapon slots. */
const carried = (p: Player) => {
  const s = serverPlayer(p);
  return { faction: s.faction, hp: s.hp, maxHp: s.maxHp, weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot };
};

/** What the client itself sees of its own player (the synced state, not the server's objects). */
const syncedLoadout = (p: Player) => {
  const s = p.room.state.players.get(sessionOf(p))!;
  return { faction: s.faction, hp: s.hp, maxHp: s.maxHp, weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot };
};

/** The room's world reads its timers per run, so a test can give its own room shorter ones without touching others. */
function retime(p: Player, timers: Timers): void {
  const world = worldOf(p);
  // The patience timer scales with the players standing; flat (min = full) unless the test names its own minimum.
  const flat = timers.patienceSeconds !== undefined && timers.patienceMinSeconds === undefined
    ? { patienceMinSeconds: timers.patienceSeconds }
    : {};
  world.config = { ...world.config, ...timers, ...flat };
}

async function leave(p: Player): Promise<void> {
  if (p.left) return;
  await p.room.leave(true);
  await until(() => p.left, "client to report the leave");
}

/** Everyone in one room, waited until the run is on and all of them are alive. Nothing happens in it by itself. */
async function startRun(accounts: Account[], timers: Timers = {}): Promise<Player[]> {
  const [first, ...rest] = accounts;
  const lead = await createRoom(first!, { minPlayers: accounts.length, ...timers });
  const all = [lead];
  for (const who of rest) all.push(await joinRoom(lead, who));
  await until(
    () => worldOf(lead).state.phase === "active" && all.every((p) => serverPlayer(p).status === "alive"),
    "the run to start",
  );
  await until(() => all.every((p) => p.room.state.phase === "active"), "clients to see the run start");
  return all;
}

/** Moves a player on the server only: a dropped client never sees where it was put. */
function placeOnServer(p: Player, x: number, y: number): void {
  const world = worldOf(p);
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(sessionOf(p))!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

/** A spawn point nobody else is near, so a duel there cannot hit a bystander. */
function duelSpot(world: World, fighters: string[]): Vec2 {
  let best = world.map.spawns[0]!;
  let bestDistance = -1;
  for (const spawn of world.map.spawns) {
    let nearest = Infinity;
    for (const [id, p] of world.state.players) {
      if (fighters.includes(id) || p.status !== "alive") continue;
      nearest = Math.min(nearest, Math.hypot(p.x - spawn.x, p.y - spawn.y));
    }
    if (nearest > bestDistance) { bestDistance = nearest; best = spawn; }
  }
  return best;
}

/**
 * Puts `killer` next to `victim` (due east of them), away from everyone else, and has the killer attack the way a client
 * does, with inputs only, until `done()`: an `attack` press toward the victim and its `release`. That is one swing, one
 * cast or one arrow at the minimum draw, whatever the killer holds, and a tap the cooldown swallowed is simply repeated.
 */
async function strikeAt(killer: Player, victim: Player, done: () => boolean): Promise<void> {
  const at = duelSpot(worldOf(killer), [sessionOf(killer), sessionOf(victim)]);
  placeOnServer(victim, at.x + 12, at.y);
  placeOnServer(killer, at.x - 12, at.y);
  await sleep(120); // a tick or two, so the lag-compensation history holds the new spots
  const a = Math.atan2(0, 24);
  const deadline = Date.now() + 10_000;
  while (!done() && Date.now() < deadline) {
    killer.room.send("attack", { a });
    killer.room.send("release", { a });
    const settle = Date.now() + 300; // a windup, and the flight of whatever it looses
    while (!done() && Date.now() < settle) await sleep(20);
  }
  expect(done(), "the duel to reach its goal").toBe(true);
}

/** Small enough for any hit that gets through armor and shield to be lethal, whoever lands it. */
const DOOMED_HP = 0.01;

/** `killer` takes `victim` down. The victim is brought to DOOMED_HP first, so a single hit settles it. */
async function kill(killer: Player, victim: Player): Promise<void> {
  serverPlayer(victim).hp = DOOMED_HP;
  await strikeAt(killer, victim, () => serverPlayer(victim).status !== "alive");
  expect(serverPlayer(victim).status).toBe("dead");
}

/** Shrinks core's reconnect hold (RECONNECT_SECONDS) to `ms` so a test can wait for it to run out. */
function shortenReconnectHold(ms: number): void {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number, ...args: unknown[]) =>
    real(fn, delay === RECONNECT_SECONDS * 1000 ? ms : delay, ...args)) as unknown as typeof setTimeout);
}

/** Shrinks the ended room's linger (ENDED_LINGER_SECONDS) to `ms`. Returns the delays the room asked its clock for. */
function shortenLinger(p: Player, ms: number): number[] {
  const clock = serverRoom(p).clock;
  const real = clock.setTimeout.bind(clock);
  const asked: number[] = [];
  vi.spyOn(clock, "setTimeout").mockImplementation((fn, delay, ...args) => {
    asked.push(delay);
    return real(fn, delay === ENDED_LINGER_SECONDS * 1000 ? ms : delay, ...args);
  });
  return asked;
}

/** Cuts the player's socket from the server side, as a dropped connection would, and waits until the room noticed. */
async function dropConnection(p: Player): Promise<void> {
  const sid = sessionOf(p);
  const room = serverRoom(p);
  room.clients.getById(sid)!.ref.terminate();
  await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
}

/** Lets the SDK take its time before coming back, so a test can change the world while the player is away. */
function reconnectAfter(p: Player, ms: number): { reconnected: () => boolean } {
  p.room.reconnection.minUptime = 0;
  p.room.reconnection.delay = 1;
  p.room.reconnection.minDelay = ms;
  let reconnected = false;
  p.room.onReconnect(() => { reconnected = true; });
  return { reconnected: () => reconnected };
}

afterEach(async () => {
  for (const p of players.splice(0)) {
    try { await leave(p); } catch { /* connection already gone */ }
  }
  // Every test must end with no profile held: a leak here would lock a player out for good.
  await until(() => server.profiles.size === 0, "all profiles to be released", 5000);
  vi.restoreAllMocks();
});

// ================================================================= tests

describe("ActiveProfiles", () => {
  it("lets one owner hold a profile and refuses everyone else", () => {
    const reg = new ActiveProfiles();
    expect(reg.tryAcquire("alice", "r1:s1")).toBe(true);
    expect(reg.tryAcquire("alice", "r2:s2")).toBe(false);
    expect(reg.tryAcquire("alice", "r1:s1")).toBe(false);
    expect(reg.tryAcquire("bobby", "r2:s2")).toBe(true);
    expect(reg.isActive("alice")).toBe(true);
    expect(reg.ownerOf("alice")).toBe("r1:s1");
    expect(reg.size).toBe(2);
  });

  it("releases only for the owner", () => {
    const reg = new ActiveProfiles();
    reg.tryAcquire("alice", "r1:s1");
    expect(reg.release("alice", "r2:s2")).toBe(false);
    expect(reg.isActive("alice")).toBe(true);
    expect(reg.release("alice", "r1:s1")).toBe(true);
    expect(reg.release("alice", "r1:s1")).toBe(false);
    expect(reg.isActive("alice")).toBe(false);
  });

  it("a stale owner cannot free a newer owner's hold", () => {
    const reg = new ActiveProfiles();
    reg.tryAcquire("alice", "old:s1");
    reg.release("alice", "old:s1");
    reg.tryAcquire("alice", "new:s9");
    expect(reg.release("alice", "old:s1")).toBe(false);
    expect(reg.ownerOf("alice")).toBe("new:s9");
  });

  it("a hold that never reaches onJoin expires; a confirmed one does not", () => {
    const reg = new ActiveProfiles();
    const t0 = 1_000_000;
    expect(reg.tryAcquire("ghost", "r1:s1", t0)).toBe(true);
    expect(reg.tryAcquire("real1", "r1:s2", t0)).toBe(true);
    reg.confirm("real1", "r1:s2");
    expect(reg.isActive("ghost", t0 + 5_000)).toBe(true);
    expect(reg.isActive("ghost", t0 + 3_600_000)).toBe(false);
    expect(reg.isActive("real1", t0 + 3_600_000)).toBe(true);
    expect(reg.tryAcquire("ghost", "r2:s3", t0 + 3_600_000)).toBe(true);
    expect(reg.release("ghost", "r1:s1")).toBe(false); // the expired holder is stale now
    expect(reg.ownerOf("ghost")).toBe("r2:s3");
  });

  it("only the owner can confirm", () => {
    const reg = new ActiveProfiles();
    const t0 = 5;
    reg.tryAcquire("alice", "r1:s1", t0);
    reg.confirm("alice", "r2:s2");
    expect(reg.isActive("alice", t0 + 3_600_000)).toBe(false);
  });
});

describe("matchmaking without credentials", () => {
  it("creates no room and reserves no seat for an anonymous or bad-token request", async () => {
    const before = (await matchMaker.query({ name: ROOM_NAME })).length;
    for (const body of [{}, { profile: "nobody1", token: "x" }]) {
      for (const method of ["joinOrCreate", "create"]) {
        const res = await fetch(url(`/matchmake/${method}/${ROOM_NAME}`), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        expect(res.ok, `${method} ${JSON.stringify(body)}`).toBe(false);
      }
    }
    expect((await matchMaker.query({ name: ROOM_NAME })).length).toBe(before);
  });
});

describe("joining", () => {
  it("takes credentials only: the player starts with their faction's hp and signature weapon, picked by the server, and the store is untouched", async () => {
    const who = await claim();
    const before = record(who);
    const p = await createRoom(who);

    expect(carried(p)).toEqual(starterKit(0));
    await until(() => syncedLoadout(p).weapon0 !== "", "the weapon slots to sync");
    expect(syncedLoadout(p)).toEqual(starterKit(0));
    expect(serverPlayer(p).name).toBe(who.name);
    expect(serverPlayer(p).status).toBe("lobby");
    expect(isActive(who)).toBe(true);
    expect(server.profiles.ownerOf(who.name)).toBe(`${p.room.roomId}:${sessionOf(p)}`);
    expect(record(who)).toEqual(before);
  });

  it("the faction picked in the hub is taken, with its signature weapon; a loadout or hp in the options is ignored", async () => {
    const who = await claim();
    const options = { ...joinOptions(who), loadout: ["gpu", "gold", "rifle"], faction: "holy", weapon0: "sword", hp: 99_999 };
    const p = track(who, await client.create<RaidState>(ROOM_NAME, options));
    expect(carried(p)).toEqual(kitOf("holy"));
  });

  it("a faction that isn't one gets the round-robin default", async () => {
    const who = await claim();
    const p = track(who, await client.create<RaidState>(ROOM_NAME, { ...joinOptions(who), faction: "dragon" }));
    expect(carried(p)).toEqual(starterKit(0));
  });

  it("two different profiles can share a lobby, each with a faction of their own by join order", async () => {
    const a = await claim();
    const b = await claim();
    const pa = await createRoom(a, { minPlayers: 3 });
    const pb = await joinRoom(pa, b);
    expect(worldOf(pa).state.players.size).toBe(2);
    expect(carried(pa)).toEqual(starterKit(0));
    expect(carried(pb)).toEqual(starterKit(1));
    expect(carried(pa).faction).not.toBe(carried(pb).faction);
    expect(isActive(a) && isActive(b)).toBe(true);
  });

  describe("is refused, with the registry and the store untouched", () => {
    interface Case { label: string; options: (me: Account, other: Account) => unknown; message: RegExp }
    const cases: Case[] = [
      { label: "no token", options: (me) => ({ profile: me.name }), message: /unknown profile or bad token/ },
      { label: "a wrong token", options: (me) => ({ profile: me.name, token: "nope" }), message: /unknown profile or bad token/ },
      { label: "an empty token", options: (me) => ({ profile: me.name, token: "" }), message: /unknown profile or bad token/ },
      { label: "a numeric token", options: (me) => ({ profile: me.name, token: 123 }), message: /unknown profile or bad token/ },
      { label: "another profile's token", options: (me, other) => ({ profile: me.name, token: other.token }), message: /unknown profile or bad token/ },
      { label: "a profile nobody claimed", options: (me) => ({ profile: `${me.name}zz`, token: me.token }), message: /unknown profile or bad token/ },
      { label: "no profile", options: (me) => ({ token: me.token }), message: /invalid profile name/ },
      { label: "a malformed profile name", options: (me) => ({ profile: "no good!", token: me.token }), message: /invalid profile name/ },
      { label: "a profile name that is too short", options: (me) => ({ profile: "x", token: me.token }), message: /invalid profile name/ },
      { label: "a profile name that is too long", options: (me) => ({ profile: "x".repeat(17), token: me.token }), message: /invalid profile name/ },
      { label: "a non-string profile", options: (me) => ({ profile: 42, token: me.token }), message: /invalid profile name/ },
    ];

    it.each(cases)("$label", async ({ options, message }) => {
      const me = await claim();
      const other = await claim();
      const [meBefore, otherBefore] = [record(me), record(other)];
      await expect(client.create(ROOM_NAME, options(me, other) as object)).rejects.toThrow(message);
      expect(record(me)).toEqual(meBefore);
      expect(record(other)).toEqual(otherBefore);
      expect(isActive(me)).toBe(false);
      expect(isActive(other)).toBe(false);
      expect(server.profiles.size).toBe(0);
      // Nothing was left half done: the legitimate join works straight afterwards.
      const p = await createRoom(me);
      expect(carried(p)).toEqual(starterKit(0));
    });
  });

  describe("a failure inside onJoin gives everything back", () => {
    it("when the player cannot be added: the registry is free, the store untouched, and the room carries on", async () => {
      const first = await claim();
      const me = await claim();
      const meBefore = record(me);
      const pa = await createRoom(first, { minPlayers: 3 });
      const world = worldOf(pa);
      // Fails after the schema state already has the player but before the runtime does.
      vi.spyOn(world.players, "set").mockImplementationOnce(() => { throw new Error("no room for you"); });

      await expect(joinRoom(pa, me)).rejects.toThrow(/no room for you/);
      expect(isActive(me)).toBe(false);
      expect(record(me)).toEqual(meBefore);
      expect(server.profiles.ownerOf(first.name)).toBe(`${pa.room.roomId}:${sessionOf(pa)}`);
      expect(world.state.players.size).toBe(1); // no half-added player in the synced state
      expect(world.players.size).toBe(1);
      expect(carried(pa)).toEqual(starterKit(0));
      expect(world.state.phase).toBe("lobby");

      // addPlayer had already counted the failed join (the faction is picked from that counter), so the player who
      // joins next gets the third faction, not the second.
      const again = await joinRoom(pa, me);
      expect(carried(again)).toEqual(starterKit(2));
      expect(world.state.players.size).toBe(2);
    });

    it("when confirming the seat fails after the player was added", async () => {
      const first = await claim();
      const me = await claim();
      const pa = await createRoom(first, { minPlayers: 3 });
      const world = worldOf(pa);
      vi.spyOn(server.profiles, "confirm").mockImplementationOnce(() => { throw new Error("registry exploded"); });

      await expect(joinRoom(pa, me)).rejects.toThrow(/registry exploded/);
      expect(isActive(me)).toBe(false);
      expect(world.state.players.size).toBe(1);
      expect(world.players.size).toBe(1);
      expect(isActive(first)).toBe(true);

      await joinRoom(pa, me);
      expect(isActive(me)).toBe(true);
    });
  });

  describe("a profile that is already in a raid", () => {
    it("cannot join the same room twice", async () => {
      const who = await claim();
      const first = await createRoom(who, { minPlayers: 3 });
      const before = record(who);
      await expect(client.joinById(first.room.roomId, joinOptions(who))).rejects.toThrow(/already in a raid/);
      // The refused attempt must not disturb the first one.
      expect(server.profiles.ownerOf(who.name)).toBe(`${first.room.roomId}:${sessionOf(first)}`);
      expect(worldOf(first).state.players.size).toBe(1);
      expect(record(who)).toEqual(before);
    });

    it("cannot join another room either", async () => {
      const who = await claim();
      const first = await createRoom(who, { minPlayers: 3 });
      const before = record(who);
      await expect(client.create(ROOM_NAME, joinOptions(who))).rejects.toThrow(/already in a raid/);
      expect(carried(first)).toEqual(starterKit(0));
      expect(server.profiles.ownerOf(who.name)).toBe(`${first.room.roomId}:${sessionOf(first)}`);
      expect(record(who)).toEqual(before);
    });

    it("can join again once the first seat is gone", async () => {
      const who = await claim();
      const first = await createRoom(who);
      await leave(first);
      await until(() => !isActive(who), "profile to be released");
      const second = await createRoom(who);
      expect(carried(second)).toEqual(starterKit(0));
    });
  });

  it("refuses a join once the run has started", async () => {
    const [a, b, c] = [await claim(), await claim(), await claim()];
    const [lead] = await startRun([a, b]);
    const before = record(c);
    await expect(client.joinById(lead!.room.roomId, joinOptions(c))).rejects.toThrow();
    expect(isActive(c)).toBe(false);
    expect(record(c)).toEqual(before);
    expect(worldOf(lead!).state.players.size).toBe(2);
  });
});

describe("leaving during the lobby", () => {
  it("removes the player, records nothing, and frees the profile", async () => {
    const [a, b] = [await claim(), await claim()];
    const pa = await createRoom(a, { minPlayers: 3 });
    const pb = await joinRoom(pa, b);
    const world = worldOf(pa);
    const sid = sessionOf(pb);
    const before = [record(a), record(b)];

    await leave(pb);
    await until(() => !isActive(b), "profile to be released");
    expect(world.state.players.has(sid)).toBe(false);
    expect(world.players.has(sid)).toBe(false);
    expect(world.state.players.size).toBe(1);
    expect(world.state.phase).toBe("lobby");
    await sleep(100);
    expect([record(a), record(b)]).toEqual(before); // and nothing arrives late
    expect(isActive(a)).toBe(true);
  });

  it("a dropped connection is treated as a leave right away, not held for a reconnect", async () => {
    const who = await claim();
    const before = record(who);
    const p = await createRoom(who);
    p.room.reconnection.enabled = false;
    const sid = sessionOf(p);
    await until(() => p.room.state.players.has(sid), "the join to finish");
    await sleep(100); // core only offers a reconnect to a client that has completed its join handshake
    const world = worldOf(p); // the room is disposed along with its last player
    serverRoom(p).clients.getById(sid)!.ref.terminate();
    await until(() => !isActive(who), "profile to be released", 2000);
    expect(world.state.players.has(sid)).toBe(false);
    expect(record(who)).toEqual(before);
  });

  it("the profile can queue again straight away", async () => {
    const who = await claim();
    await leave(await createRoom(who));
    await until(() => !isActive(who), "profile to be released");
    const again = await createRoom(who);
    expect(carried(again)).toEqual(starterKit(0));
    expectBanked(who, 0);
  });

  it("a player alone in the lobby keeps waiting", async () => {
    const a = await claim();
    const pa = await createRoom(a);
    await sleep(300);
    expect(worldOf(pa).state.phase).toBe("lobby");
    expectBanked(a, 0);
  });
});

describe("a run", () => {
  it("a kill tells the killer in a toast; the dead player's result is banked at once and frees them to queue again", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);

    // While the run is on, the profile is committed to it.
    await expect(client.create(ROOM_NAME, joinOptions(B))).rejects.toThrow(/already in a raid/);

    await kill(a!, b!);
    await until(() => b!.results.length === 1, "B's result");
    await until(() => a!.toasts.includes(`+${GV_KILL} GV (kill)`), "the kill toast");
    // The swing and the death reach every client as fx, naming the fighters by session id.
    await until(() => [a!, b!, c!].every((p) => p.fx.some((f) => f.kind === "death")), "the death fx on every client");
    for (const p of [a!, b!, c!]) {
      expect(p.fx.find((f) => f.kind === "windup"), p.who.name).toMatchObject({ by: sessionOf(a!), weapon: SIGNATURE_WEAPONS.fire });
      expect(p.fx.find((f) => f.kind === "hit"), p.who.name).toMatchObject({ id: sessionOf(b!), by: sessionOf(a!), weapon: SIGNATURE_WEAPONS.fire });
      expect(p.fx.find((f) => f.kind === "death"), p.who.name).toMatchObject({ id: sessionOf(b!), by: sessionOf(a!) });
    }
    expect(b!.results[0]).toMatchObject({
      outcome: "died", profile: B.name, kills: 0, killedBy: A.name, place: 3, players: 3,
      gv: { kills: 0, mobs: 0, bounty: 0, win: 0, total: 0 },
    });
    expectBanked(B, 0, { runs: 1, deaths: 1 });
    expect(isActive(B)).toBe(false); // free to queue while still looking at the results
    expect(isActive(A) && isActive(C)).toBe(true);
    expect(serverPlayer(a!).gv).toBe(GV_KILL);
    expectBanked(A, 0); // the killer's GV banks with the killer's own result
    expect(b!.toasts).not.toContain(`+${GV_KILL} GV (kill)`); // and the toast goes to the killer only

    const next = await createRoom(B);
    const ownerNow = `${next.room.roomId}:${sessionOf(next)}`;
    expect(next.room.roomId).not.toBe(b!.room.roomId);
    expect(server.profiles.ownerOf(B.name)).toBe(ownerNow);

    await leave(b!); // closes the results screen of the first run
    await sleep(100);
    expect(server.profiles.ownerOf(B.name)).toBe(ownerNow); // a stale seat cannot release the new hold
    expectBanked(B, 0, { runs: 1, deaths: 1 }); // and the run is not counted twice

    await leave(next);
    await until(() => !isActive(B), "profile to be released");
    expectBanked(B, 0, { runs: 1, deaths: 1 }); // leaving a lobby records nothing
  });

  it("pickup and swap reach the sim: a chest's weapon fills the free slot, a swap puts it in hand, and the client sees both", async () => {
    const [A, B] = [await claim(), await claim()];
    const [a] = await startRun([A, B]);
    const world = worldOf(a!);
    const chest = [...world.state.containers.values()].find((c) => c.kind === "chest" && c.items.length > 0)!;
    const weapon = chest.items.at(0)!.def;
    expect(carried(a!)).toEqual(starterKit(0));
    placeOnServer(a!, chest.x, chest.y);
    await sleep(120);

    a!.room.send("pickup", { containerId: chest.id });
    await until(() => syncedLoadout(a!).weapon1 === weapon, "the chest's weapon in the second slot, on the client");
    expect(syncedLoadout(a!)).toEqual({ ...starterKit(0), weapon1: weapon }); // the weapon in hand did not change
    expect(chest.items.length).toBe(0); // the chest stays, opened

    a!.room.send("swap", {});
    await until(() => syncedLoadout(a!).slot === 1, "the swap to reach the client");
    a!.room.send("swap", { slot: 0 });
    await until(() => syncedLoadout(a!).slot === 0, "the swap back to reach the client");
    a!.room.send("swap", { slot: 2 }); // not a slot: refused by the parser, not an error
    a!.room.send("pickup", { containerId: "no-such-container" });
    await sleep(150);
    expect(syncedLoadout(a!)).toEqual({ ...starterKit(0), weapon1: weapon });
    expect(a!.left).toBe(false);
  });

  it("the last player standing wins: kill GV and the win bonus bank once, the room names the winner and then lets everyone go", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const asked = shortenLinger(a!, 300);
    const recorded = vi.spyOn(server.store, "recordRun");
    const banked = vi.spyOn(server.store, "bankGv");

    await kill(a!, b!);
    await until(() => b!.results.length === 1, "B's result");
    expectBanked(A, 0); // still in the run, nothing banked yet
    await kill(a!, c!);
    await until(() => a!.results.length === 1 && c!.results.length === 1, "the final results");

    // A hurt both others in a run that started with three: the win bonus is theirs, and the client is told it wasn't held back.
    expect(a!.results[0]).toMatchObject({
      outcome: "won", profile: A.name, kills: 2, killedBy: null, place: 1, players: 3,
      gv: { kills: 2 * GV_KILL, mobs: 0, bounty: 0, win: GV_WIN, total: 2 * GV_KILL + GV_WIN }, winBonusWithheld: false,
    });
    expect(b!.results[0]).toMatchObject({ outcome: "died", killedBy: A.name, place: 3, gv: { total: 0 }, winBonusWithheld: false });
    expect(c!.results[0]).toMatchObject({ outcome: "died", killedBy: A.name, place: 2, gv: { total: 0 }, winBonusWithheld: false });

    // Each result paid exactly once, in the balance, the lifetime total and the month.
    expectBanked(A, 2 * GV_KILL + GV_WIN, { runs: 1, wins: 1, kills: 2 });
    expectBanked(B, 0, { runs: 1, deaths: 1 });
    expectBanked(C, 0, { runs: 1, deaths: 1 });
    expect(sum([A, B, C].map((who) => record(who).gv))).toBe(2 * GV_KILL + GV_WIN); // the ledger balances
    expect(recorded.mock.calls.map(([name]) => name).sort()).toEqual([A.name, B.name, C.name]); // one record per player
    expect(recorded.mock.calls.find(([name]) => name === A.name)![1]).toEqual({ outcome: "won", kills: 2, gv: 2 * GV_KILL + GV_WIN, bounty: 0, weapon: expect.any(String), winQualified: true });
    expect(banked).not.toHaveBeenCalled(); // bankGv is for voided runs only
    expect([A, B, C].some(isActive)).toBe(false);
    expect((await api(A.name, A.token)).body.profile).toMatchObject({ gv: 2 * GV_KILL + GV_WIN, stats: { runs: 1, wins: 1, kills: 2 } });

    const state = worldOf(a!).state;
    expect(state.phase).toBe("ended");
    expect(state.winner).toBe(A.name);
    await until(() => [a!, b!, c!].every((p) => p.fx.some((f) => f.kind === "victory")), "the victory fx");
    for (const p of [a!, b!, c!]) {
      expect(p.fx.find((f) => f.kind === "victory")).toMatchObject({ id: sessionOf(a!), name: A.name, draw: false });
    }
    // The toast for a kill is feedback only; the win bonus has none, and nothing is paid twice.
    expect(a!.toasts.filter((t) => t === `+${GV_KILL} GV (kill)`)).toHaveLength(2);
    await sleep(150);
    expect(record(A).gv).toBe(2 * GV_KILL + GV_WIN);

    // Everyone is disconnected once the linger is over, and the room goes with them.
    expect(asked).toContain(ENDED_LINGER_SECONDS * 1000);
    const roomId = a!.room.roomId;
    await until(() => [a!, b!, c!].every((p) => p.left), "everyone to be disconnected", 3000);
    await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed");
    expectBanked(A, 2 * GV_KILL + GV_WIN, { runs: 1, wins: 1, kills: 2 }); // disconnecting changes nothing
    expectBanked(B, 0, { runs: 1, deaths: 1 });
    expectBanked(C, 0, { runs: 1, deaths: 1 });
  });

  it("a bounty is announced to everyone, and whoever claims it is paid a \"+N GV (bounty)\" toast and banks it", async () => {
    const [A, B, C, D, E] = [await claim(), await claim(), await claim(), await claim(), await claim()];
    const [a, b, c, d, e] = await startRun([A, B, C, D, E]);
    const all = [a!, b!, c!, d!, e!];
    const bountyToasts = (p: Player) => p.toasts.filter((t) => t.endsWith("(bounty)"));

    // E hurts B before A finishes them; E later kills A, so E will have hurt two different players and win with the bonus.
    await strikeAt(e!, b!, () => serverPlayer(b!).hp < serverPlayer(b!).maxHp);
    await kill(a!, b!);
    await kill(a!, c!);
    expect(all.some((p) => p.fx.some((f) => f.kind === "bounty"))).toBe(false); // two kills: not yet
    await kill(a!, d!); // the third: A is on a rampage
    await until(() => all.every((p) => p.fx.some((f) => f.kind === "bounty")), "the bounty fx on every client");
    for (const p of all) {
      const announced = p.fx.filter((f) => f.kind === "bounty");
      expect(announced, p.who.name).toHaveLength(1);
      expect(announced[0]).toMatchObject({ kind: "bounty", id: sessionOf(a!), name: A.name, bounty: 10 });
    }
    expect(serverPlayer(a!).bounty).toBe(10);
    await until(() => e!.room.state.players.get(sessionOf(a!))?.bounty === 10, "the bounty in the synced state");
    expect(all.flatMap(bountyToasts)).toEqual([]); // nothing has been paid yet

    await kill(e!, a!); // E collects it, and is the last one standing
    await until(() => a!.results.length === 1 && e!.results.length === 1, "the final results");
    expect(e!.toasts).toContain(`+${GV_KILL} GV (kill)`);
    expect(bountyToasts(e!)).toEqual(["+10 GV (bounty)"]); // to the killer only, once
    expect([a!, b!, c!, d!].flatMap(bountyToasts)).toEqual([]);

    expect(e!.results[0]).toMatchObject({
      outcome: "won", profile: E.name, kills: 1, gv: { kills: GV_KILL, mobs: 0, bounty: 10, win: GV_WIN, total: GV_KILL + 10 + GV_WIN },
      winBonusWithheld: false,
    });
    expect(a!.results[0]).toMatchObject({
      outcome: "died", profile: A.name, kills: 3, killedBy: E.name, gv: { kills: 3 * GV_KILL, mobs: 0, bounty: 0, win: 0, total: 3 * GV_KILL },
    });
    // Banked once, at each player's own result: the bounty is in E's balance, lifetime total and month.
    expectBanked(E, GV_KILL + 10 + GV_WIN, { runs: 1, wins: 1, kills: 1 });
    expectBanked(A, 3 * GV_KILL, { runs: 1, deaths: 1, kills: 3 });
    for (const who of [B, C, D]) expectBanked(who, 0, { runs: 1, deaths: 1 });
    expect(sum([A, B, C, D, E].map((who) => record(who).gv))).toBe(4 * GV_KILL + 10 + GV_WIN); // the ledger balances
  });

  describe("the win bonus", () => {
    // A three-player winner who hurt both others is the "last player standing wins" test above.
    it("a two-player winner is told the bonus was withheld: nothing banked for it, the win still counted", async () => {
      const [A, B] = [await claim(), await claim()];
      const [a, b] = await startRun([A, B]);
      const recorded = vi.spyOn(server.store, "recordRun");

      await kill(a!, b!);
      await until(() => a!.results.length === 1 && b!.results.length === 1, "both results");

      expect(a!.results[0]).toMatchObject({
        outcome: "won", profile: A.name, kills: 1, place: 1, players: 2,
        gv: { kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL }, winBonusWithheld: true,
      });
      expect(b!.results[0]).toMatchObject({ outcome: "died", place: 2, gv: { total: 0 }, winBonusWithheld: false });
      expect(recorded.mock.calls.find(([name]) => name === A.name)![1]).toEqual({ outcome: "won", kills: 1, gv: GV_KILL, bounty: 0, weapon: expect.any(String), winQualified: false });
      expectBanked(A, GV_KILL, { runs: 1, wins: 1, kills: 1 }); // the win counts, the bonus does not
      expectBanked(B, 0, { runs: 1, deaths: 1 });
      expect(worldOf(a!).state.winner).toBe(A.name);
    });

    it("a three-player winner who hurt only one of the others is told the same, though the other one left", async () => {
      const [A, B, C] = [await claim(), await claim(), await claim()];
      const [a, b, c] = await startRun([A, B, C]);
      const recorded = vi.spyOn(server.store, "recordRun");

      await kill(a!, b!);
      await leave(c!); // never touched: leaving is not damage
      await until(() => a!.results.length === 1, "A's result");

      expect(a!.results[0]).toMatchObject({
        outcome: "won", profile: A.name, kills: 1, place: 1, players: 3,
        gv: { kills: GV_KILL, win: 0, total: GV_KILL }, winBonusWithheld: true,
      });
      expect(recorded.mock.calls.find(([name]) => name === A.name)![1]).toEqual({ outcome: "won", kills: 1, gv: GV_KILL, bounty: 0, weapon: expect.any(String), winQualified: false });
      expectBanked(A, GV_KILL, { runs: 1, wins: 1, kills: 1 });
      expectBanked(B, 0, { runs: 1, deaths: 1 });
      expectBanked(C, 0, { runs: 1, deaths: 1 }); // MIA
      expect(worldOf(a!).state.winner).toBe(A.name);
    });
  });

  it("a draw banks as a draw: the kill GV is kept, there is no win bonus, and nobody wins", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);

    // The kill restarts the patience timer, now short; the arena then teleports A and B, and sudden death burns
    // them both from the same low hp in the same tick. The factions have different max hp, and a draw needs the same
    // hp *fraction* at the start of the tick: 1/1024 of each (exact in binary, so the two fractions compare equal).
    retime(a!, { patienceSeconds: 0.4, suddenDeathSeconds: 0.3 });
    await kill(a!, c!);
    for (const p of [a!, b!]) serverPlayer(p).hp = serverPlayer(p).maxHp / 1024;
    await until(() => a!.results.length === 1 && b!.results.length === 1, "both results", 8000);

    expect(a!.results[0]).toMatchObject({
      outcome: "draw", profile: A.name, kills: 1, killedBy: null, place: 1, players: 3,
      gv: { kills: GV_KILL, mobs: 0, bounty: 0, win: 0, total: GV_KILL }, winBonusWithheld: false, // a draw has no bonus to withhold
    });
    expect(b!.results[0]).toMatchObject({
      outcome: "draw", profile: B.name, kills: 0, killedBy: null, place: 1, gv: { total: 0 }, winBonusWithheld: false,
    });
    expectBanked(A, GV_KILL, { runs: 1, draws: 1, kills: 1 });
    expectBanked(B, 0, { runs: 1, draws: 1 });
    expectBanked(C, 0, { runs: 1, deaths: 1 });
    expect(c!.results[0]).toMatchObject({ outcome: "died", killedBy: A.name, place: 3 });

    const state = worldOf(a!).state;
    expect(state.phase).toBe("ended");
    expect(state.winner).toBe("");
    await until(() => a!.fx.some((f) => f.kind === "victory"), "the victory fx");
    expect(a!.fx.find((f) => f.kind === "victory")).toMatchObject({ id: null, name: null, draw: true });
    expect([A, B, C].some(isActive)).toBe(false);
  });

  it("the arena teleports everyone alive into the coliseum after patienceSeconds with no death", async () => {
    const [A, B] = [await claim(), await claim()];
    const [a, b] = await startRun([A, B], { patienceSeconds: 0.5, suddenDeathSeconds: 120 });
    const world = worldOf(a!);
    const before = [a!, b!].map((p) => ({ x: serverPlayer(p).x, y: serverPlayer(p).y }));
    expect(world.state.startedWith).toBe(2);
    expect(world.state.inColiseum).toBe(false);

    await until(() => world.state.gatesLocked, "the teleport", 3000);
    expect(world.state.inColiseum).toBe(true);
    expect(world.state.patienceEndsAt).toBe(0);
    expect(world.state.suddenDeathAt).toBeGreaterThan(world.state.serverTime);
    const after = [a!, b!].map((p) => ({ x: serverPlayer(p).x, y: serverPlayer(p).y }));
    after.forEach((spot, i) => expect(spot, `player ${i} moved`).not.toEqual(before[i]));
    expect(new Set(after.map((s) => `${s.x},${s.y}`)).size).toBe(2); // distinct spots
    for (const p of [a!, b!]) {
      expect(serverPlayer(p).status).toBe("alive");
      expect(serverPlayer(p).immuneUntil).toBeGreaterThan(world.state.serverTime);
    }

    // Nobody died, so nothing was resolved or banked; the clients see the whole thing.
    await until(() => [a!, b!].every((p) => p.room.state.gatesLocked && p.fx.some((f) => f.kind === "teleport")), "clients to see the teleport");
    for (const p of [a!, b!]) {
      const seen = p.room.state.players.get(sessionOf(p))!;
      expect(p.room.state.inColiseum).toBe(true);
      expect(seen.immuneUntil).toBeGreaterThan(0);
      expect(p.results).toEqual([]);
    }
    expectBanked(A, 0);
    expectBanked(B, 0);
    expect(isActive(A) && isActive(B)).toBe(true);
  });

  it("sends a step's fx as one `fxs` batch, and the teleport's batch reaches a client before the patch that moves everyone", async () => {
    const [A, B] = [await claim(), await claim()];
    const [a] = await startRun([A, B], { patienceSeconds: 2, suddenDeathSeconds: 120 });
    expect(worldOf(a!).state.gatesLocked).toBe(false);
    const batches: FxBatch[] = [];
    const arrivals: string[] = [];
    let teleportAt = NaN;
    let lockedPatchAt = NaN;
    a!.room.onMessage("fxs", (batch: FxBatch) => {
      batches.push(batch);
      for (const fx of unpackFx(batch)) if (fx.kind === "teleport") { teleportAt = fx.t; arrivals.push("fx"); }
    });
    a!.room.onStateChange((state) => {
      if (state.gatesLocked && arrivals.at(-1) !== "patch") { lockedPatchAt = state.serverTime; arrivals.push("patch"); }
    });
    await until(() => arrivals.includes("patch") && batches.length > 0, "the teleport and its patch", 6000);
    // The fx came first, stamped with the tick that the patch carries (a catch-up patch may be a later one).
    expect(arrivals).toEqual(["fx", "patch"]);
    expect(lockedPatchAt).toBeGreaterThanOrEqual(teleportAt);
    // A step with no fx sends nothing, and a step sends at most one batch.
    for (const batch of batches) expect(batch.l.length).toBeGreaterThan(0);
    expect(new Set(batches.map((batch) => batch.t)).size).toBe(batches.length);
  });

  describe("leaving", () => {
    it("is MIA: it counts as a death and frees the profile, and the player left alone wins", async () => {
      const [A, B] = [await claim(), await claim()];
      const [a, b] = await startRun([A, B]);
      const sid = sessionOf(a!);
      await leave(a!);
      await until(() => !isActive(A), "profile to be released");

      expectBanked(A, 0, { runs: 1, deaths: 1 });
      expect(worldOf(b!).state.players.has(sid)).toBe(false);
      await until(() => b!.results.length === 1, "B's result");
      // A two-player run: B wins, the win is counted, and the bonus is withheld.
      expect(b!.results[0]).toMatchObject({
        outcome: "won", profile: B.name, players: 2, gv: { kills: 0, win: 0, total: 0 }, winBonusWithheld: true,
      });
      expectBanked(B, 0, { runs: 1, wins: 1 });
      expect(serverRoom(b!).pendingResults.has(sid)).toBe(false); // nothing kept for a reconnect that can't come

      const next = await createRoom(A); // the first room is locked: this is a fresh lobby
      expect(next.room.roomId).not.toBe(a!.room.roomId);
      expect(isActive(A)).toBe(true);
    });

    it("after the player's result is out records nothing more", async () => {
      const [A, B, C] = [await claim(), await claim(), await claim()];
      const [a, b] = await startRun([A, B, C]);
      await kill(a!, b!);
      await until(() => b!.results.length === 1, "B's result");
      await leave(b!);
      await sleep(100);
      expectBanked(B, 0, { runs: 1, deaths: 1 });
      expect(worldOf(a!).state.players.has(sessionOf(b!))).toBe(false);
      expect(worldOf(a!).state.phase).toBe("active"); // A and C are still fighting
    });
  });

  describe("a dropped connection", () => {
    it("keeps the seat for the reconnect window: the player stays in the run and can win it", async () => {
      const [A, B] = [await claim(), await claim()];
      const [a, b] = await startRun([A, B]);
      const back = reconnectAfter(a!, 20);

      serverRoom(a!).clients.getById(sessionOf(a!))!.ref.terminate();
      await sleep(150);
      expect(isActive(A)).toBe(true);
      expect(serverPlayer(a!).status).toBe("alive");
      expect(worldOf(a!).state.phase).toBe("active");
      expectBanked(A, 0); // nothing recorded for a blip

      await until(back.reconnected, "the SDK to reconnect", 8000);
      expect(isActive(A)).toBe(true);
      expect(worldOf(a!).players.has(sessionOf(a!))).toBe(true);
      expect(b!.results).toEqual([]);

      await kill(a!, b!);
      await until(() => a!.results.length === 1, "the result after reconnecting");
      expect(a!.results[0]).toMatchObject({
        outcome: "won", profile: A.name, kills: 1, gv: { kills: GV_KILL, win: 0, total: GV_KILL }, winBonusWithheld: true, // two players
      });
      expectBanked(A, GV_KILL, { runs: 1, wins: 1, kills: 1 });
    });

    it("stays alive and hittable during the reconnect grace, and gets its pending result when it reconnects", async () => {
      const [A, B, C] = [await claim(), await claim(), await claim()];
      const [a, b] = await startRun([A, B, C]);
      const back = reconnectAfter(a!, 2000);
      const sid = sessionOf(a!);
      const room = serverRoom(a!);

      await dropConnection(a!);
      expect(isActive(A)).toBe(true); // still held
      expect(serverPlayer(a!).status).toBe("alive");
      expect(worldOf(a!).players.get(sid)?.resolved).toBe(false);
      expectBanked(A, 0);

      // A hit lands on the absent player...
      const full = serverPlayer(a!).hp;
      await strikeAt(b!, a!, () => serverPlayer(a!).hp < full);
      expect(serverPlayer(a!).hp).toBeLessThan(full);
      expect(serverPlayer(a!).status).toBe("alive");
      // ...and a lethal one kills.
      await kill(b!, a!);
      await until(() => room.pendingResults.has(sid), "the death to settle");
      expect(back.reconnected()).toBe(false);
      expect(a!.results).toEqual([]); // the client is not there to hear it
      expect(isActive(A)).toBe(false); // settled: banked, profile free
      expectBanked(A, 0, { runs: 1, deaths: 1 });

      await until(back.reconnected, "the SDK to reconnect", 8000);
      await until(() => a!.results.length === 1, "the pending result to arrive after reconnecting");
      expect(a!.results[0]).toMatchObject({ outcome: "died", profile: A.name, killedBy: B.name, gv: { total: 0 } });
      await sleep(200);
      expect(a!.results).toHaveLength(1); // delivered once
      expectBanked(A, 0, { runs: 1, deaths: 1 }); // and counted once
    });

    it("past the reconnect grace becomes MIA, banked like a death with the GV it had earned", async () => {
      shortenReconnectHold(400);
      const [A, B, C] = [await claim(), await claim(), await claim()];
      const [a, b, c] = await startRun([A, B, C]);
      await kill(a!, c!); // A has 1 kill's GV, not banked yet
      await until(() => c!.results.length === 1, "C's result");
      a!.room.reconnection.enabled = false; // the player stays away
      const sid = sessionOf(a!);
      const world = worldOf(a!);
      const room = serverRoom(a!);

      await dropConnection(a!);
      expect(isActive(A)).toBe(true); // still held
      expect(world.players.get(sid)?.resolved).toBe(false);
      expectBanked(A, 0);

      await until(() => !isActive(A), "the hold to run out", 3000);
      expect(world.players.has(sid)).toBe(false);
      expect(world.state.players.has(sid)).toBe(false);
      expectBanked(A, GV_KILL, { runs: 1, deaths: 1, kills: 1 }); // MIA is a death, and the kill GV is kept
      expect(room.pendingResults.has(sid)).toBe(false);
      expect(a!.results).toEqual([]); // nobody was there to receive it

      // B is the only one left, so B wins the run.
      await until(() => b!.results.length === 1, "B's result");
      // B won a run of three without hurting anyone: no bonus.
      expect(b!.results[0]).toMatchObject({
        outcome: "won", profile: B.name, players: 3, gv: { win: 0, total: 0 }, winBonusWithheld: true,
      });
      expectBanked(B, 0, { runs: 1, wins: 1 });
    });
  });
});

describe("shutdown", () => {
  it("stop() resolves only once pending profile writes are on disk", async () => {
    const who = await claim();
    await server.store.flush();

    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementation(async (...args: Parameters<typeof fs.promises.rename>) => {
      await sleep(150); // keep the write in flight while stop() runs
      return realRename(...args);
    });
    server.store.recordRun(who.name, { outcome: "won", kills: 4, gv: 90 });
    server.store.bankGv(who.name, 7);

    stopped = true;
    await server.stop();
    const disk = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    expect(disk.version).toBe(2);
    expect(disk.profiles[who.name]).toMatchObject({
      gv: 97, gvLifetime: 97, stats: { runs: 1, wins: 1, draws: 0, deaths: 0, kills: 4 },
    });
    expect(sum(Object.values(disk.profiles[who.name].gvByMonth) as number[])).toBe(97);
    expect(fs.existsSync(`${profileFile}.tmp`)).toBe(false);
  });
});
