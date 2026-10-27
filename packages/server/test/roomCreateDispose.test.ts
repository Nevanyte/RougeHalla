// A room is listed only if it was still alive when onCreate finished. Colyseus arms a room's auto-dispose timer (the seat
// reservation window, 15 s) before onCreate runs, and a room nobody has a seat in is disposed when it fires: if the map takes
// longer than that (a map worker that hangs, with its timeout longer than the window) the room used to be disposed in the middle
// of onCreate, then listed anyway once the fallback produced a map, and players landed in a lobby that never ticked.
// The window is 1 s here (COLYSEUS_SEAT_RESERVATION_TIME is read when core loads, hence the hoisted env) and the map takes 1.6 s.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client } from "@colyseus/sdk";
import { generateMap, ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";

const slow = vi.hoisted(() => {
  process.env.COLYSEUS_SEAT_RESERVATION_TIME = "1";
  return { ms: 0 };
});

vi.mock("../src/mapService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/mapService")>();
  return {
    ...real,
    generateMapAsync: async (seed: number) => {
      if (slow.ms > 0) await new Promise((r) => setTimeout(r, slow.ms));
      return generateMap(seed);
    },
  };
});

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let server: RaidServer;
let dir = "";
let client: Client;
let port = 0;
let counter = 0;
const restoreConsole: Array<() => void> = [];

beforeAll(async () => {
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && (args[0].startsWith("Room connection was closed unexpectedly") || args[0].includes("closed while its map"))) return;
      original(...args);
    };
    restoreConsole.push(() => { console[method] = original; });
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-create-"));
  port = 20_000 + Math.floor(Math.random() * 20_000);
  server = await startServer({
    ...loadConfig({}),
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120,
    planSeconds: 0,
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
    delete process.env.COLYSEUS_SEAT_RESERVATION_TIME;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function claim(): Promise<JoinOptions> {
  const name = `cd${++counter}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`, { headers: {} });
  const body = (await res.json()) as { token: string };
  return { profile: name, token: body.token };
}

const listed = async () => (await matchMaker.query({ name: ROOM_NAME })).length;

describe("a room disposed while its map is being made", () => {
  it("is refused, not listed as a room that never ticks, and gives back its place under the cap and the profile's claim", async () => {
    const who = await claim();
    slow.ms = 1600;
    try {
      await expect(client.create<RaidState>(ROOM_NAME, who)).rejects.toThrow();
    } finally {
      slow.ms = 0;
    }
    expect(await listed()).toBe(0);
    expect(server.rooms.count("arena")).toBe(0);
    // The claim "this profile just opened an unjoined room" is gone with the room: the same profile can open another at once.
    const again = await client.create<RaidState>(ROOM_NAME, who);
    try {
      expect(await listed()).toBe(1);
      expect(server.rooms.count("arena")).toBe(1);
      // A live room ticks: its clock advances with nobody to wait for (the lobby runs its simulation steps).
      await until(() => typeof again.state.serverTime === "number", "the first patch");
      const t0 = again.state.serverTime;
      await until(() => again.state.serverTime > t0 + 200, "the clock to advance");
    } finally {
      await again.leave();
    }
  }, 20_000);

  it("a room whose map is made inside the window is unaffected", async () => {
    const who = await claim();
    slow.ms = 300;
    try {
      const room = await client.create<RaidState>(ROOM_NAME, who);
      expect(await listed()).toBeGreaterThanOrEqual(1);
      await room.leave();
    } finally {
      slow.ms = 0;
    }
  }, 20_000);
});
