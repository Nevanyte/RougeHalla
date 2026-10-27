// The planning phase through the Room adapter (roguelike R3), over real sockets: the real server with planning on, SDK
// clients that send inputs only. What the adapter adds to sim/planning.ts: the room locks when planning starts (a join is
// refused), each player's deal reaches that player alone as a private `plan` message, a pick over the wire comes back in
// the next message, a dropped client keeps its seat (as in the run, unlike the lobby) and is sent its plan again when it
// reconnects, and a training room never plans. Leaving during planning is a loss (owner ruling): a consented leave, or a
// dropped client whose reconnect grace runs out, goes MIA through the real store (a run and a death, no GV), the others see
// what it held freed, and a restart voids the run instead; leaving the lobby, and a training room, stay free.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { RECONNECT_SECONDS, ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions, type PlanMessage, type ProfileStats, type RunResult } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { planFor } from "../src/sim/planning";
import type { World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
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

let server: RaidServer;
let port = 0;
let dir = "";
let client: Client;
const restoreConsole: Array<() => void> = [];

beforeAll(async () => {
  // The SDK prints this on every join the server refuses and on every cut connection.
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("Room connection was closed unexpectedly")) return;
      original(...args);
    };
    restoreConsole.push(() => { console[method] = original; });
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-planning-"));
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }), // the server's own bot fill off: these rooms hold the clients and nobody else
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120,
    planSeconds: 60, // long: every test here ends planning with ready, or not at all
    patienceSeconds: 120,
    patienceMinSeconds: 120,
    suddenDeathSeconds: 120,
    latencyMs: 0,
    stashFile: path.join(dir, "data", "stash.json"),
  });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  try {
    await server.stop();
  } finally {
    for (const restore of restoreConsole) restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let counter = 0;
interface Account { name: string; token: string }
async function claim(): Promise<Account> {
  const name = `pl${++counter}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  const body = (await res.json()) as { token: string };
  return { name, token: body.token };
}
const joinOptions = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });

interface Player { who: Account; room: ClientRoom; plans: PlanMessage[]; results: RunResult[]; left: boolean }
const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, plans: [], results: [], left: false };
  room.onMessage("plan", (m: PlanMessage) => p.plans.push(m));
  room.onMessage("result", (r: RunResult) => p.results.push(r));
  room.onMessage("toast", () => {});
  room.onMessage("fxs", () => {});
  room.onLeave(() => { p.left = true; });
  players.push(p);
  return p;
}

interface ServerRoomView { world: World; clients: { getById(id: string): { ref: { terminate(): void } } | undefined } }
const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const sid = (p: Player) => p.room.sessionId;

/** Two players in a fresh room, waited until the room plans and both have their deal. */
async function planningPair(): Promise<[Player, Player]> {
  const [A, B] = [await claim(), await claim()];
  const a = track(A, await client.create<RaidState>(ROOM_NAME, joinOptions(A)));
  const b = track(B, await client.joinById<RaidState>(a.room.roomId, joinOptions(B)));
  await until(() => worldOf(a).state.phase === "planning", "the room to plan");
  await until(() => a.plans.length > 0 && b.plans.length > 0, "both deals");
  return [a, b];
}

/** `n` players in a fresh room (its minPlayers raised so the lobby waits for the last), waited until it plans and each has a deal. */
async function planningGroup(n: number): Promise<Player[]> {
  const accounts: Account[] = [];
  for (let i = 0; i < n; i++) accounts.push(await claim());
  const lead = track(accounts[0]!, await client.create<RaidState>(ROOM_NAME, joinOptions(accounts[0]!)));
  const world = worldOf(lead);
  world.config = { ...world.config, minPlayers: n };
  const all = [lead];
  for (const who of accounts.slice(1)) all.push(track(who, await client.joinById<RaidState>(lead.room.roomId, joinOptions(who))));
  await until(() => world.state.phase === "planning", "the room to plan");
  await until(() => all.every((p) => p.plans.length > 0), "every deal");
  return all;
}

const record = (who: Account) => server.store.get(who.name)!;
/** What a profile that has played nothing, or played `stats` and was paid nothing, holds. */
function expectPlayed(who: Account, stats: Partial<ProfileStats> = {}): void {
  const r = record(who);
  expect(r.stats, `${who.name} stats`).toEqual({ runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0, ...stats });
  expect([r.gv, r.gvLifetime, r.gvByMonth], `${who.name} gv`).toEqual([0, 0, {}]);
}

/** Makes the reconnect hold (RECONNECT_SECONDS) last `ms`: only the delay the Room asks core for is shortened. */
function shortenReconnectHold(ms: number): void {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number, ...args: unknown[]) =>
    real(fn, delay === RECONNECT_SECONDS * 1000 ? ms : delay, ...args)) as unknown as typeof setTimeout);
}

/** Replaces the deal of `p` (a test sets up shared options) and forgets what it was sent, so the next tick resends it. */
function handDeal(p: Player, spawns: [number, number]): void {
  const d = worldOf(p).planning!.deals.get(sid(p))!;
  d.spawns = spawns;
  d.pick = -1;
  d.sent = "";
}

afterEach(async () => {
  for (const p of players.splice(0)) {
    if (p.left) continue;
    try { await p.room.leave(true); } catch { /* already gone */ }
  }
  await until(() => server.profiles.size === 0, "every profile to be released");
  vi.restoreAllMocks();
});

describe("planning through the Room", () => {
  it("locks the room and sends each player its own deal, privately, matching the server's; the state says only planning", async () => {
    const [a, b] = await planningPair();
    const world = worldOf(a);
    for (const p of [a, b]) {
      expect(p.plans).toHaveLength(1);
      expect(p.plans[0]).toEqual(planFor(world, sid(p)));
      expect(p.plans[0]!.spawns).toEqual(world.planning!.deals.get(sid(p))!.spawns);
    }
    expect(a.plans[0]!.spawns).not.toEqual(b.plans[0]!.spawns);
    await until(() => a.room.state.phase === "planning", "the client to see planning");
    expect(a.room.state.planEndsAt).toBe(world.state.planEndsAt);
    // A third player is refused: planning is part of the run.
    const C = await claim();
    await expect(client.joinById<RaidState>(a.room.roomId, joinOptions(C))).rejects.toThrow(/raid already started|locked/);
    expect((await matchMaker.query({ name: ROOM_NAME })).find((r) => r.roomId === a.room.roomId)?.locked).toBe(true);
  });

  it("a pick sent over the wire comes back in the player's next message; ready from both starts the run at the picks", async () => {
    const [a, b] = await planningPair();
    const world = worldOf(a);
    a.room.send("plan", { spawn: 1 });
    await until(() => a.plans.at(-1)!.pick === 1, "the pick to come back");
    expect(world.planning!.deals.get(sid(a))!.pick).toBe(1);
    a.room.send("plan", { ready: true });
    await until(() => a.room.state.players.get(sid(a))!.planReady, "ready to be synced");
    expect(world.state.phase).toBe("planning");
    b.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start early");
    const pool = world.map.spawnPool;
    const spot = pool[a.plans.at(-1)!.spawns[1]]!;
    expect(world.state.players.get(sid(a))).toMatchObject({ x: spot.x, y: spot.y, status: "alive" });
  });

  it("a dropped client keeps its seat through planning, is sent its plan again on reconnecting, and its pick stands", async () => {
    const [a, b] = await planningPair();
    const world = worldOf(a);
    a.room.send("plan", { spawn: 0 });
    await until(() => a.plans.at(-1)!.pick === 0, "the pick");
    const seen = a.plans.length;
    a.room.reconnection.minUptime = 0;
    a.room.reconnection.delay = 1;
    a.room.reconnection.minDelay = 300;
    let back = false;
    a.room.onReconnect(() => { back = true; });
    await sleep(100);
    const room = serverRoom(a);
    room.clients.getById(sid(a))!.ref.terminate();
    await until(() => room.clients.getById(sid(a)) === undefined, "the room to notice the drop");
    // Held: still a player of the run, the profile still taken, and not holding up the others' ready.
    expect(world.state.players.has(sid(a))).toBe(true);
    expect(server.profiles.isActive(a.who.name)).toBe(true);
    await until(() => back, "the SDK to reconnect", 8000);
    await until(() => a.plans.length > seen, "the plan to be sent again");
    expect(a.plans.at(-1)).toEqual(planFor(world, sid(a)));
    expect(a.plans.at(-1)!.pick).toBe(0);
    expectPlayed(a.who); // a blip inside the grace costs nothing: no result, no run
    for (const p of [a, b]) p.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start");
    const spot = world.map.spawnPool[a.plans.at(-1)!.spawns[0]]!;
    expect(world.state.players.get(sid(a))).toMatchObject({ x: spot.x, y: spot.y, status: "alive" });
  });

  it("a client that drops and stays away does not hold up the others: the run starts when the rest are ready, with the seat held", async () => {
    const [a, b] = await planningPair();
    const world = worldOf(a);
    a.room.reconnection.enabled = false;
    await sleep(100);
    const room = serverRoom(a);
    room.clients.getById(sid(a))!.ref.terminate();
    await until(() => world.players.get(sid(a))?.droppedAt !== null, "the drop to be marked");
    b.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start without the dropped player");
    expect(world.state.players.get(sid(a))!.status).toBe("alive"); // in the run, on the default spawn, its seat still held
    expect(world.state.startedWith).toBe(2);
  });

  it("a training room never plans, whatever the server's planSeconds", async () => {
    const T = await claim();
    const t = track(T, await client.create<RaidState>(TRAINING_ROOM_NAME, joinOptions(T)));
    await until(() => t.room.state.phase === "active", "the training run");
    expect(t.plans).toEqual([]);
    expect(worldOf(t).config.planSeconds).toBe(0);
  });
});

describe("leaving during planning (owner ruling: a loss)", () => {
  it("a consented leave goes MIA once, through the store (a run and a death, no GV), frees its options for the others, and leaves them planning", async () => {
    const [a, b, c] = await planningGroup(3);
    const world = worldOf(a);
    const recorded = vi.spyOn(server.store, "recordRun");
    handDeal(a, [9, 10]);
    handDeal(b, [11, 9]);
    handDeal(c, [12, 13]);
    await until(() => [a, b, c].every((p) => p.plans.at(-1)!.spawns[0] === world.planning!.deals.get(sid(p))!.spawns[0]), "the hand-dealt options to be sent");
    a.room.send("plan", { spawn: 0 });
    await until(() => b.plans.at(-1)!.taken[1] === true, "b to be told that a holds its second option");
    const cSeen = c.plans.length;

    await a.room.leave(true);
    await until(() => b.plans.at(-1)!.taken[1] === false, "b to be told the option is free again");
    expect(b.plans.at(-1)).toEqual(planFor(world, sid(b)));
    expect(c.plans).toHaveLength(cSeen); // nothing changed for c: nothing sent
    await until(() => !server.profiles.isActive(a.who.name), "a's profile to be released");
    expect(world.state.players.has(sid(a))).toBe(false);
    expect(world.planning!.holders.size).toBe(0);
    expect(world.state.phase).toBe("planning");
    expectPlayed(a.who, { runs: 1, deaths: 1 });
    expectPlayed(b.who);
    expectPlayed(c.who);
    await sleep(150);
    expect(recorded).toHaveBeenCalledTimes(1); // not once more from the Room's own onLeave
    expect(recorded.mock.calls[0]).toEqual([a.who.name, expect.objectContaining({ outcome: "mia", kills: 0, gv: 0, bounty: 0, winQualified: false })]);

    // The two left are the run: three started, one of them is MIA, and nothing was paid for it.
    for (const p of [b, c]) p.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start with the two left");
    expect(world.state.startedWith).toBe(3);
    expect([...world.state.players.values()].map((p) => p.status)).toEqual(["alive", "alive"]);
    // The profile is free the normal way (nothing else holds it): queueing again is allowed, and the loss stands.
    const again = track(a.who, await client.create<RaidState>(ROOM_NAME, joinOptions(a.who)));
    expect(server.profiles.isActive(a.who.name)).toBe(true);
    await again.room.leave(true); // the lobby of the new room: free
    await until(() => !server.profiles.isActive(a.who.name), "the new lobby to be left");
    expectPlayed(a.who, { runs: 1, deaths: 1 });
  });

  it("a dropped client whose reconnect grace runs out during planning goes MIA the same way; the others are unaffected", async () => {
    shortenReconnectHold(400);
    const [a, b, c] = await planningGroup(3);
    const world = worldOf(a);
    a.room.reconnection.enabled = false; // stays away
    await sleep(100);
    serverRoom(a).clients.getById(sid(a))!.ref.terminate();
    await until(() => world.players.get(sid(a))?.droppedAt !== null, "the drop to be marked");
    expect(server.profiles.isActive(a.who.name)).toBe(true); // held
    expectPlayed(a.who);
    await until(() => !server.profiles.isActive(a.who.name), "the hold to run out", 3000);
    expect(world.state.players.has(sid(a))).toBe(false);
    expectPlayed(a.who, { runs: 1, deaths: 1 });
    expectPlayed(b.who);
    expectPlayed(c.who);
    expect(world.state.phase).toBe("planning");
    for (const p of [b, c]) p.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start without it");
    expect(world.state.startedWith).toBe(3);
    expect(world.state.players.size).toBe(2);
  });

  it("a dropped client that is back inside the grace is still in: no result, and it is placed in the run", async () => {
    shortenReconnectHold(3000);
    const [a, b, c] = await planningGroup(3);
    const world = worldOf(a);
    a.room.reconnection.minUptime = 0;
    a.room.reconnection.delay = 1;
    a.room.reconnection.minDelay = 300;
    let back = false;
    a.room.onReconnect(() => { back = true; });
    await sleep(100);
    serverRoom(a).clients.getById(sid(a))!.ref.terminate();
    await until(() => back, "the SDK to reconnect", 8000);
    await sleep(200);
    expect(world.state.players.has(sid(a))).toBe(true);
    expect(a.results).toEqual([]);
    expectPlayed(a.who);
    for (const p of [a, b, c]) p.room.send("plan", { ready: true });
    await until(() => world.state.phase === "active", "the run to start");
    expect(world.state.players.get(sid(a))!.status).toBe("alive");
    expectPlayed(a.who);
  });

  it("7 of 8 leave: seven results (lost), and the last one, who got no solo run, wins at once with no bonus", async () => {
    const group = await planningGroup(8);
    const world = worldOf(group[0]!);
    const recorded = vi.spyOn(server.store, "recordRun");
    const last = group[7]!;
    for (const p of group.slice(0, 7)) await p.room.leave(true);
    await until(() => last.results.length === 1, "the last player's result");
    expect(last.results[0]).toMatchObject({
      outcome: "won", profile: last.who.name, players: 8, kills: 0, gv: { kills: 0, mobs: 0, bounty: 0, quest: 0, win: 0, total: 0 }, winBonusWithheld: true,
    });
    expect(world.state.phase).toBe("ended");
    expect(world.state.startedWith).toBe(8);
    await until(() => group.slice(0, 7).every((p) => !server.profiles.isActive(p.who.name)), "the leavers' profiles to be released");
    for (const p of group.slice(0, 7)) expectPlayed(p.who, { runs: 1, deaths: 1 });
    expectPlayed(last.who, { runs: 1, wins: 1 }); // a win in the stats, and nothing more: no GV, so no achievement from it
    expect(record(last.who).progress.qualifiedWins).toBe(0);
    await sleep(150);
    expect(recorded).toHaveBeenCalledTimes(8); // one per player
  });

  it("a restart during planning voids the run: no result, no loss for anyone", async () => {
    const [a, b] = await planningPair();
    const recorded = vi.spyOn(server.store, "recordRun");
    const banked = vi.spyOn(server.store, "bankGv");
    (serverRoom(a) as unknown as { onBeforeShutdown(): void }).onBeforeShutdown();
    await until(() => a.left && b.left, "both clients to be sent away");
    await until(() => server.profiles.size === 0, "the profiles to be released");
    expect(recorded).not.toHaveBeenCalled();
    expect(banked).not.toHaveBeenCalled();
    expectPlayed(a.who);
    expectPlayed(b.who);
  });

  it("the lobby stays free to leave: nothing is recorded, and the profile is free at once", async () => {
    const A = await claim();
    const recorded = vi.spyOn(server.store, "recordRun");
    const a = track(A, await client.create<RaidState>(ROOM_NAME, joinOptions(A)));
    await until(() => worldOf(a).state.players.size === 1, "the lobby");
    expect(worldOf(a).state.phase).toBe("lobby");
    await a.room.leave(true);
    await until(() => !server.profiles.isActive(A.name), "the profile to be released");
    expect(recorded).not.toHaveBeenCalled();
    expectPlayed(A);
  });

  it("a training room stays free to leave: nothing is recorded", async () => {
    const T = await claim();
    const recorded = vi.spyOn(server.store, "recordRun");
    const t = track(T, await client.create<RaidState>(TRAINING_ROOM_NAME, joinOptions(T)));
    await until(() => t.room.state.phase === "active", "the training run");
    await t.room.leave(true);
    await until(() => !server.profiles.isActive(T.name), "the profile to be released");
    expect(recorded).not.toHaveBeenCalled();
    expectPlayed(T);
  });
});
