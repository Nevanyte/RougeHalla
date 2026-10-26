// The planning phase through the Room adapter (roguelike R3), over real sockets: the real server with planning on, SDK
// clients that send inputs only. What the adapter adds to sim/planning.ts: the room locks when planning starts (a join is
// refused), each player's deal reaches that player alone as a private `plan` message, a pick over the wire comes back in
// the next message, a dropped client keeps its seat (as in the run, unlike the lobby) and is sent its plan again when it
// reconnects, and a training room never plans.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions, type PlanMessage } from "@raid/shared";
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
    ...loadConfig({}),
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

interface Player { who: Account; room: ClientRoom; plans: PlanMessage[]; left: boolean }
const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, plans: [], left: false };
  room.onMessage("plan", (m: PlanMessage) => p.plans.push(m));
  room.onMessage("result", () => {});
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

afterEach(async () => {
  for (const p of players.splice(0)) {
    if (p.left) continue;
    try { await p.room.leave(true); } catch { /* already gone */ }
  }
  await until(() => server.profiles.size === 0, "every profile to be released");
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
