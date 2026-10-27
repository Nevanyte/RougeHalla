// The optional playtest passcode (PLAYTEST_PASSCODE), over real sockets: needed to claim a new callsign and to matchmake
// (a room, a seat), never to open a profile you already own over HTTP, and off unless the host set it.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import { PASSCODE_HEADER, PROFILE_TOKEN_HEADER, ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";

const PASSCODE = "open-sesame";

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

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-passcode-"));
  port = await freePort();
  // The wrong-guess limit has its own tests (passcodeThrottle.test.ts); these make dozens of wrong guesses from one address.
  server = await startServer({ ...loadConfig({ PLAYTEST_PASSCODE: PASSCODE, PASSCODE_FAILS_PER_MINUTE: "0", PASSCODE_FAILS_PER_MINUTE_ALL: "0" }), port, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"), lobbySeconds: 120, minPlayers: 99 });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  try {
    await server?.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const claimWith = (name: string, passcode?: string, token?: string) => fetch(url(`/api/profile/${name}`), {
  headers: { ...(passcode === undefined ? {} : { [PASSCODE_HEADER]: passcode }), ...(token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token }) },
});

/** A profile claimed the way a friend with the link does it. */
async function friend(name: string): Promise<{ name: string; token: string }> {
  const res = await claimWith(name, PASSCODE);
  expect(res.status).toBe(200);
  return { name, token: ((await res.json()) as { token: string }).token };
}

describe("claiming a callsign", () => {
  it("is refused without the passcode, with a plain message, and creates nothing", async () => {
    for (const given of [undefined, "", "open-sesamE", "nope"]) {
      const res = await claimWith("stranger1", given);
      expect(res.status, String(given)).toBe(401);
      expect(await res.json()).toEqual({ error: "this playtest needs a passcode", code: "passcode_required" });
    }
    expect(server.store.get("stranger1")).toBeUndefined();
  });

  it("works with the passcode, and the token it hands out opens the profile later without it", async () => {
    const a = await friend("friend1");
    expect(server.store.get("friend1")).toBeDefined();
    const again = await claimWith("friend1", undefined, a.token);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { created: boolean }).created).toBe(false);
    // Someone else's name is still someone else's, passcode or not.
    expect((await claimWith("friend1", PASSCODE)).status).toBe(403);
  });
});

describe("matchmaking", () => {
  const options = (a: { name: string; token: string }, passcode?: string): JoinOptions => ({ profile: a.name, token: a.token, ...(passcode === undefined ? {} : { passcode }) });

  it("refuses a join with no passcode or a wrong one, before anything is opened", async () => {
    const a = await friend("friend2");
    for (const given of [undefined, "wrong", ""]) {
      await expect(client.joinOrCreate<RaidState>(ROOM_NAME, options(a, given)), `arena ${given}`).rejects.toThrow(/passcode/i);
      await expect(client.create<RaidState>(TRAINING_ROOM_NAME, options(a, given)), `training ${given}`).rejects.toThrow(/passcode/i);
    }
    expect([server.rooms.count("arena"), server.rooms.count("training")]).toEqual([0, 0]);
  });

  it("the passcode is asked for first: a refusal says nothing about the profile", async () => {
    await expect(client.joinOrCreate<RaidState>(ROOM_NAME, { profile: "nobody-at-all", token: "x" })).rejects.toThrow(/passcode/i);
    await expect(client.joinOrCreate<RaidState>(ROOM_NAME, { profile: "nobody-at-all", token: "x", passcode: PASSCODE })).rejects.toThrow(/unknown profile or bad token/i);
  });

  it("lets the right passcode into a run and into training", async () => {
    const a = await friend("friend3");
    const arena = await client.joinOrCreate<RaidState>(ROOM_NAME, options(a, PASSCODE));
    expect(arena.sessionId).toBeTruthy();
    await arena.leave(true);
    const b = await friend("friend4");
    const training = await client.create<RaidState>(TRAINING_ROOM_NAME, options(b, PASSCODE));
    expect(training.sessionId).toBeTruthy();
    await training.leave(true);
  });
});
