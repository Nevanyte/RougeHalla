// A client's messages can reach the room all at once: a stalled TCP uplink, a hop of the hosting path or this process's own event loop
// holds them back and then delivers them in one read. Colyseus's own cap counts them in a one-second window on the room clock, which
// only moves once a tick, so the whole backlog fell into one window and a moving player (about 55 messages a second) was closed with
// 4002 after an interruption of about 3 s, a close the game client did not reconnect from (docs/NETWORK_INVESTIGATION_2026-11-04.md).
// The room now meters every message with its own bucket (RaidRoom MESSAGE_BURST, MESSAGE_RATE): an honest backlog goes through, a
// flood is still closed, and a closed client's seat is held for the reconnect grace like any drop.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { MAX_MESSAGES_PER_SECOND, MESSAGE_BURST, MESSAGE_RATE } from "../src/rooms/RaidRoom";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe("the room's message budget", () => {
  it("is deep enough for a backlog well past the stalls the liveness checks ride out, and keeps the old steady cap", () => {
    // 55 a second is the busiest honest mix (client/src/net/uplinkPace.ts); 5.5 s is the server's liveness timeout plus a sweep.
    expect(MESSAGE_BURST).toBeGreaterThan(55 * 5.5 * 3);
    expect(MESSAGE_RATE).toBe(200);
    // Colyseus's window would close a client before the bucket does otherwise.
    expect(MAX_MESSAGES_PER_SECOND).toBeGreaterThan(MESSAGE_BURST + MESSAGE_RATE);
  });
});

describe("a burst of messages", { timeout: 30_000 }, () => {
  let server: RaidServer;
  let port = 0;
  let dir = "";
  let client: Client;
  const open: Array<Room<any, RaidState>> = [];
  let n = 0;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-burst-"));
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
    const name = `mb${++n}`;
    const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
    const body = (await res.json()) as { token: string };
    return { profile: name, token: body.token };
  }

  async function startRun() {
    const [oa, ob] = [await claim(), await claim()];
    const a = await client.create<RaidState>(ROOM_NAME, oa);
    const b = await client.joinById<RaidState>(a.roomId, ob);
    open.push(a, b);
    for (const r of [a, b]) for (const type of ["fxs", "plan", "vision", "toast", "result", "questReveal"]) r.onMessage(type, () => {});
    const room = matchMaker.getLocalRoomById(a.roomId) as unknown as {
      world: { state: { phase: string }; players: Map<string, unknown> };
      clients: { getById(id: string): unknown };
    };
    await until(() => room.world.state.phase === "active", "the run to start");
    return { a, b, oa, room };
  }

  /** What a stalled link hands over when it clears: aims, held moves and beats in their real mix, written in one go. */
  function backlog(r: Room<any, RaidState>, count: number): void {
    for (let i = 0; i < count; i++) {
      if (i % 50 === 49) r.send("beat", { n: i });
      else if (i % 5 === 4) r.send("move", { x: 2000 + (i % 7), y: 2000, seq: i & 255 });
      else r.send("aim", { a: (i % 628) / 100 });
    }
  }

  it("of an honest backlog (8 s of the busiest mix, read in one go) keeps the client and its run", async () => {
    const { a, room } = await startRun();
    let closed = 0;
    a.onLeave((code) => { closed = code; });
    a.onDrop((code) => { closed = code; });
    // 440 messages: at the old cap of 200 a window this was a close (4002) after any interruption of about 3 s.
    backlog(a, 440);
    // And the second that follows, at the steady rate: Colyseus counted it in the same window as the backlog.
    for (let t = 0; t < 20; t++) { backlog(a, 3); await sleep(50); }
    await sleep(500);
    expect(closed).toBe(0);
    expect(room.clients.getById(a.sessionId)).toBeDefined();
  });

  it("of a flood is still closed (4002), with the seat held for the reconnect grace as for any drop", async () => {
    const { a, oa, room } = await startRun();
    let left = 0;
    a.onLeave((code) => { left = code; });
    backlog(a, MESSAGE_BURST + 400);
    await until(() => left !== 0, "the flooding client to be closed");
    expect(left).toBe(4002);
    expect(room.clients.getById(a.sessionId)).toBeUndefined();
    // A drop, not a leave: the player is still in the run and the profile is held for the grace (RaidRoom.onDrop).
    expect(room.world.players.has(a.sessionId)).toBe(true);
    expect(server.profiles.isActive(oa.profile)).toBe(true);
    // The stored token wins the seat back, as the game client's rejoin does for a 4002 (client/src/net/rejoin.ts).
    const back = await client.reconnect<RaidState>(a.reconnectionToken);
    open.push(back);
    expect(back.sessionId).toBe(a.sessionId);
    await until(() => room.clients.getById(a.sessionId) !== undefined, "the seat to be taken back");
  });

  it("closes a client that keeps sending faster than the steady rate once the burst is spent", async () => {
    const { a } = await startRun();
    let left = 0;
    a.onLeave((code) => { left = code; });
    // About 600 a second, three times the steady rate: the bucket (1500 deep) is empty after about 4 s.
    const end = Date.now() + 12_000;
    while (left === 0 && Date.now() < end) { backlog(a, 30); await sleep(50); }
    expect(left).toBe(4002);
  });
});
