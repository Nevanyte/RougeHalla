// App-level liveness: a client that sends nothing (not even its `beat`) for livenessTimeoutMs is dropped with close code 4010, so
// core runs onDrop (not onLeave) and the seat enters the reconnect grace as for any dropped connection; a client that beats is never
// touched, the fill bots (no client) are not in the sweep, and the headless BotClient beats like the game client.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { MAX_PLAYERS, ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { BotClient } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { LivenessTracker } from "../src/guards/liveness";
import { startServer, type RaidServer } from "../src/index";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Above two of the client's beats (HEARTBEAT_MS), so one late beat is no drop; the sweep adds up to LIVENESS_SWEEP_MS. */
const TIMEOUT_MS = 2200;
const WAIT_PAST_SWEEP_MS = TIMEOUT_MS + 2200;

async function until(pred: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* not yet */ }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(10);
  }
}

describe("LivenessTracker", () => {
  it("reports only the clients whose last word is older than the timeout", () => {
    const t = new LivenessTracker();
    t.touch("a", 1000);
    t.touch("b", 4000);
    expect(t.silent(["a", "b"], 5000, 4500)).toEqual([]);
    expect(t.silent(["a", "b"], 5600, 4500)).toEqual(["a"]);
    t.touch("a", 5600);
    expect(t.silent(["a", "b"], 5600, 4500)).toEqual([]);
  });

  it("never reports one it has not heard of (still joining, or a bot that is not a client), nor one it forgot", () => {
    const t = new LivenessTracker();
    t.touch("a", 0);
    t.forget("a");
    expect(t.silent(["a", "bot1"], 1e9, 1)).toEqual([]);
  });
});

describe("the room's liveness sweep", { timeout: 30_000 }, () => {
  let server: RaidServer;
  let port = 0;
  let dir = "";
  let client: Client;
  const open: Array<Room<any, RaidState>> = [];
  let n = 0;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-live-"));
    port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    });
    server = await startServer({
      ...loadConfig({ BOTS_FILL_TO: "0" }),
      port,
      minPlayers: 2,
      fillSeconds: 0,
      lobbySeconds: 120,
      patienceSeconds: 120,
      patienceMinSeconds: 120,
      suddenDeathSeconds: 120,
      planSeconds: 0,
      firstPatienceSeconds: 0,
      latencyMs: 0,
      livenessTimeoutMs: TIMEOUT_MS,
      stashFile: path.join(dir, "data", "stash.json"),
    });
    client = new Client(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    for (const r of open) void r.leave(false).catch(() => {});
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function claim(): Promise<JoinOptions> {
    const name = `lv${++n}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
    const body = (await res.json()) as { token: string };
    return { profile: name, token: body.token };
  }

  /** Two players in one room, the run on. Only the second beats (`beatB`), and only when asked. */
  async function startRun() {
    const [oa, ob] = [await claim(), await claim()];
    const a = await client.create<RaidState>(ROOM_NAME, oa);
    const b = await client.joinById<RaidState>(a.roomId, ob);
    open.push(a, b);
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as {
      world: { state: { phase: string }; players: Map<string, { dropped?: boolean }> };
      clients: { getById(id: string): unknown };
    };
    await until(() => room.world.state.phase === "active", "the run to start");
    return { a, b, oa, room };
  }

  it("drops a silent client with 4010 into the reconnect grace (never MIA) while a client that beats stays", async () => {
    const { a, b, oa, room } = await startRun();
    let dropCode = 0;
    a.onDrop((code) => { dropCode = code; });
    let reconnected = false;
    a.reconnection.minUptime = 0;
    a.reconnection.delay = 1;
    a.reconnection.minDelay = 100;
    a.onReconnect(() => { reconnected = true; });
    const beat = setInterval(() => { try { b.send("beat", {}); } catch { /* closed */ } }, 150);
    try {
      await until(() => room.clients.getById(a.sessionId) === undefined, "the silent client to be dropped");
      await until(() => dropCode !== 0, "the client to see the close");
      expect(dropCode).toBe(4010);
      expect(room.clients.getById(b.sessionId)).toBeDefined();
      // A drop, not a leave: the seat and the profile are held, the player is in the run, and nothing was recorded.
      expect(server.profiles.isActive(oa.profile)).toBe(true);
      expect(room.world.players.has(a.sessionId)).toBe(true);
      expect(server.store.get(oa.profile)!.stats.runs).toBe(0);
      await until(() => reconnected, "the SDK to take the seat back");
      expect(server.profiles.isActive(oa.profile)).toBe(true);
    } finally {
      clearInterval(beat);
    }
  });

  it("never drops a client that beats, however long it is otherwise idle", async () => {
    const { a, b, room } = await startRun();
    let dropped = false;
    a.onDrop(() => { dropped = true; });
    b.onDrop(() => { dropped = true; });
    const beat = setInterval(() => { try { a.send("beat", { n: 1 }); b.send("beat"); } catch { /* closed */ } }, 150);
    try {
      await sleep(WAIT_PAST_SWEEP_MS);
      expect(dropped).toBe(false);
      expect(room.clients.getById(a.sessionId)).toBeDefined();
      expect(room.clients.getById(b.sessionId)).toBeDefined();
    } finally {
      clearInterval(beat);
    }
  });

  it("counts a refused message as alive too, and the fill bots (no client) are not in the sweep", async () => {
    const { a, b, room } = await startRun();
    const junk = setInterval(() => { try { a.send("move", { x: "no" }); b.send("beat", {}); } catch { /* closed */ } }, 150);
    try {
      await sleep(WAIT_PAST_SWEEP_MS);
      expect(room.clients.getById(a.sessionId)).toBeDefined();
    } finally {
      clearInterval(junk);
    }
    expect(MAX_PLAYERS).toBeGreaterThan(2); // the room has seats for bots, which are never `clients`
  });

  it("is kept up by the headless BotClient, which beats like the game client", async () => {
    const bot = new BotClient({ timeoutMs: 5_000 });
    await bot.connect(`http://127.0.0.1:${port}`, `lvbot${++n}`);
    const id = bot.sessionId;
    const roomId = bot.roomId;
    const room = matchMaker.getLocalRoomById(roomId) as unknown as { clients: { getById(id: string): unknown } };
    await sleep(WAIT_PAST_SWEEP_MS);
    expect(room.clients.getById(id)).toBeDefined();
  });
});
