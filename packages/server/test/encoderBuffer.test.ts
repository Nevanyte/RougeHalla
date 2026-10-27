// The schema encoder's buffer. At 136x136 a run's state is bigger than Colyseus' default 16 KB encoder buffer (the camps, the roster
// and about 160 mobs placed in one tick; a joiner's first full sync is about 23 KB), and the encoder answers by resizing and logging a
// "buffer overflow" warning once per room. It works, but every room would log the warning, so the server raises the buffer where it
// starts (index.ts ENCODER_BUFFER_BYTES). Pinned here with the real server and real clients: a run with its mobs placed, a full encode
// of that state, and no overflow warning anywhere.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { ENCODER_BUFFER_BYTES, startServer, type RaidServer } from "../src/index";
import type { World } from "../src/sim/world";

const DEFAULT_ENCODER_BYTES = 16 * 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* not there yet */ }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
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

interface ServerRoom { world: World; _serializer: { encoder: { sharedBuffer: Uint8Array; encodeAll(): Uint8Array } } }

let server: RaidServer;
let port = 0;
let dir = "";
let warn: MockInstance<typeof console.warn>;

beforeAll(async () => {
  warn = vi.spyOn(console, "warn");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-encoder-"));
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }),
    port, minPlayers: 2, fillSeconds: 0, lobbySeconds: 120, planSeconds: 0, firstPatienceSeconds: 0,
    patienceSeconds: 600, patienceMinSeconds: 600, suddenDeathSeconds: 600, latencyMs: 0, mobs: true,
    stashFile: path.join(dir, "data", "stash.json"),
  });
});

afterAll(async () => {
  try { await server?.stop(); } finally { fs.rmSync(dir, { recursive: true, force: true }); warn.mockRestore(); }
});

async function claim(name: string): Promise<JoinOptions> {
  const response = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  const body = (await response.json()) as { token: string };
  return { profile: name, token: body.token };
}

describe("the schema encoder buffer", () => {
  it("is raised above Colyseus' 16 KB default once the server module is loaded", () => {
    expect(ENCODER_BUFFER_BYTES).toBeGreaterThanOrEqual(64 * 1024);
    expect(Encoder.BUFFER_SIZE).toBe(ENCODER_BUFFER_BYTES);
    expect(Encoder.BUFFER_SIZE).toBeGreaterThan(DEFAULT_ENCODER_BYTES);
  });

  it("logs no overflow warning for a run with all its mobs placed, nor for a full encode of that state", async () => {
    const client = new Client(`http://127.0.0.1:${port}`);
    const rooms: Room<any, RaidState>[] = [];
    try {
      const a = await client.create<RaidState>(ROOM_NAME, await claim("enc1"));
      rooms.push(a);
      const world = (matchMaker.getLocalRoomById(a.roomId) as unknown as ServerRoom).world;
      rooms.push(await client.joinById<RaidState>(a.roomId, await claim("enc2")));
      world.state.lobbyEndsAt = world.state.serverTime;
      await until(() => world.state.phase === "active", "the run to start");
      await until(() => world.mobs.size > 100, "the camps' mobs to be placed");
      await until(() => a.state.mobs.size === world.mobs.size, "the clients to see every mob");
      await sleep(200); // a few more patches
      const room = matchMaker.getLocalRoomById(a.roomId) as unknown as ServerRoom;
      const full = room._serializer.encoder.encodeAll();
      // The scenario must be the real one: the state really is bigger than the default buffer, and the raised buffer holds it.
      expect(full.byteLength).toBeGreaterThan(DEFAULT_ENCODER_BYTES);
      const overflow = warn.mock.calls.filter((c) => /buffer overflow/i.test(String(c[0])));
      expect(overflow).toEqual([]);
      expect(room._serializer.encoder.sharedBuffer.byteLength).toBe(ENCODER_BUFFER_BYTES);
    } finally {
      for (const r of rooms) { try { await r.leave(true); } catch { /* already gone */ } }
    }
  }, 60_000);
});
