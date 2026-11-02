// TRACE_INPUTS through the Room adapter, over real sockets: an arena room writes its movement trace (rows named for the room, the
// player as a human) as JSONL while it runs and has it all on disk once the server has stopped; a training room never records.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { traceWritesSettled } from "../src/rooms/traceWriter";
import type { TraceRow } from "../src/sim/trace";

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

let dir = "";
let server: RaidServer;
let port = 0;
let traceFile = "";
let stopped = false;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-trace-room-"));
  traceFile = path.join(dir, "out", "trace.jsonl");
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0", TRACE_INPUTS: traceFile }),
    port,
    minPlayers: 1,
    fillSeconds: 0,
    lobbySeconds: 30,
    planSeconds: 0,
    firstPatienceSeconds: 0,
    patienceSeconds: 600,
    patienceMinSeconds: 600,
    suddenDeathSeconds: 600,
    latencyMs: 0,
    stashFile: path.join(dir, "data", "stash.json"),
  });
});

afterAll(async () => {
  try {
    if (!stopped) await server.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function claim(name: string): Promise<JoinOptions> {
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  const body = (await res.json()) as { token: string };
  return { profile: name, token: body.token };
}

describe("TRACE_INPUTS in the room", () => {
  it("a training room records nothing", async () => {
    const client = new Client(`http://127.0.0.1:${port}`);
    const room = await client.create<RaidState>(TRAINING_ROOM_NAME, await claim("trainee"));
    room.onMessage("fxs", () => {});
    room.onMessage("toast", () => {});
    await until(() => room.state.phase === "active", "the training run");
    room.send("move", { x: room.state.players.get(room.sessionId)!.x + 200, y: room.state.players.get(room.sessionId)!.y });
    await sleep(1500);
    await room.leave(true);
    await sleep(100);
    await traceWritesSettled();
    expect(fs.existsSync(traceFile)).toBe(false);
  });

  it("an arena room writes one JSONL row per standing player per active tick, all of it on disk once the server has stopped", async () => {
    const client = new Client(`http://127.0.0.1:${port}`);
    const room = await client.create<RaidState>(ROOM_NAME, await claim("tracer"));
    room.onMessage("fxs", () => {});
    room.onMessage("toast", () => {});
    room.onMessage("result", () => {});
    room.onMessage("plan", () => {});
    await until(() => room.state.phase === "active", "the arena run");
    const me = room.state.players.get(room.sessionId)!;
    room.send("move", { x: me.x + 200, y: me.y, seq: 1 });
    await sleep(2200);
    const roomId = room.roomId;
    const sessionId = room.sessionId;
    stopped = true;
    await server.stop();
    await traceWritesSettled();
    const rows = fs.readFileSync(traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l) as TraceRow);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => r.run === roomId && r.id === sessionId && r.bot === false)).toBe(true);
    // Ticks follow one another, and the move order is on the one row it was applied on.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.tick).toBe(rows[i - 1]!.tick + 1);
    const ordered = rows.filter((r) => r.orders.length > 0);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]!.orders[0]).toMatchObject({ k: "move" });
    // And it stays complete: nothing more is written once the server is down.
    const size = fs.statSync(traceFile).size;
    await sleep(300);
    expect(fs.statSync(traceFile).size).toBe(size);
  });
});
