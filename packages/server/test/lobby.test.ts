import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@colyseus/sdk";
import {
  LOBBY_PRESENCE_PATH, LOBBY_PRESENCE_TTL_MS, LOBBY_SNAPSHOT_PATH, PASSCODE_HEADER, PROFILE_TOKEN_HEADER,
  ROOM_NAME, TRAINING_ROOM_NAME,
} from "@raid/shared";
import type { LobbySnapshot, JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { LobbyStatus } from "../src/guards/lobbyStatus";
import { startServer, type RaidServer } from "../src/index";

const PASSCODE = "lobby-secret";
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}

describe("lobby status service", () => {
  it("deduplicates tabs and keeps a profile online until its last tab leaves", () => {
    const lobby = new LobbyStatus();
    expect(lobby.touch("Waiting", "tab-aaaaaa", 100)).toBe(true);
    expect(lobby.touch("Waiting", "tab-bbbbbb", 100)).toBe(true);
    expect(lobby.snapshot(1, 0, 101).waiting).toEqual([{ name: "Waiting" }]);
    lobby.leave("Waiting", "tab-aaaaaa");
    expect(lobby.snapshot(1, 0, 102).onlineCount).toBe(1);
    expect(lobby.snapshot(1, 0, 102).waiting).toEqual([{ name: "Waiting" }]);
  });

  it("expires a lease exactly at its TTL boundary without a background timer", () => {
    const lobby = new LobbyStatus();
    const touchedAt = 1_000;
    expect(lobby.touch("Boundary", "tab-boundary", touchedAt)).toBe(true);
    expect(lobby.snapshot(1, 0, touchedAt + LOBBY_PRESENCE_TTL_MS - 1).waiting).toEqual([{ name: "Boundary" }]);
    expect(lobby.snapshot(1, 0, touchedAt + LOBBY_PRESENCE_TTL_MS).waiting).toEqual([]);
  });

  it("bounds profiles and tabs, then frees capacity when tabs expire or leave", () => {
    const lobby = new LobbyStatus();
    for (let i = 0; i < 512; i++) expect(lobby.touch("User_" + i, "tab-user-" + i, 0)).toBe(true);
    expect(lobby.touch("Overflow", "tab-overflow", 0)).toBe(false);
    expect(lobby.snapshot(1, 0, 1).waiting).toHaveLength(512);

    const tabs = new LobbyStatus();
    for (let i = 0; i < 8; i++) expect(tabs.touch("Tabs", "tab-user-" + i, 1)).toBe(true);
    expect(tabs.touch("Tabs", "tab-overflow", 1)).toBe(false);
    tabs.leave("Tabs", "tab-user-0");
    expect(tabs.touch("Tabs", "tab-overflow", 2)).toBe(true);
    expect(tabs.snapshot(1, 0, 3).waiting.filter(person => person.name === "Tabs")).toHaveLength(1);
  });

  it("hides training occupants from both public game details and hub waiting names", () => {
    const lobby = new LobbyStatus();
    lobby.touch("Training", "tab-training", 100);
    lobby.updateRoom("practice", { training: true, joinable: false, phase: "active", startedAt: 100, players: [{ name: "Training", kind: "human", alive: true }], joinedNames: ["Training"] });
    expect(lobby.snapshot(1, 1, 103)).toMatchObject({ activeGame: null, waiting: [], onlineCount: 0 });
    lobby.removeRoom("practice");
    expect(lobby.snapshot(1, 1, 104).waiting).toEqual([{ name: "Training" }]);
  });
});

let server: RaidServer;
let port = 0;
let dir = "";
let client: Client;
const url = (p: string) => "http://127.0.0.1:" + port + p;
const requestPresence = (a: Account, tabId: string, method: "POST" | "DELETE" = "POST", token = a.token, passcode: string | null = PASSCODE) => fetch(url(LOBBY_PRESENCE_PATH), {
  method,
  headers: { "content-type": "application/json", ...(token ? { [PROFILE_TOKEN_HEADER]: token } : {}), ...(passcode !== null ? { [PASSCODE_HEADER]: passcode } : {}) },
  body: JSON.stringify({ name: a.name, tabId }),
});
interface Account { name: string; token: string }
async function account(name: string): Promise<Account> {
  const res = await fetch(url("/api/profile/" + name), { headers: { [PASSCODE_HEADER]: PASSCODE } });
  expect(res.status).toBe(200);
  return { name, token: ((await res.json()) as { token: string }).token };
}
async function snapshot(): Promise<LobbySnapshot> {
  const res = await fetch(url(LOBBY_SNAPSHOT_PATH));
  expect(res.status).toBe(200);
  return res.json() as Promise<LobbySnapshot>;
}
async function waitForPhase(phase: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const s = await snapshot();
    if (s.activeGame?.phase === phase) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("lobby phase did not become " + phase);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-lobby-"));
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0", PLAYTEST_PASSCODE: PASSCODE, PASSCODE_FAILS_PER_MINUTE: "0", PASSCODE_FAILS_PER_MINUTE_ALL: "0" }),
    port, maxArenaRooms: 1, maxTrainingRooms: 1, minPlayers: 2, fillSeconds: 0, lobbySeconds: 120, planSeconds: 0,
    latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"),
  });
  client = new Client("http://127.0.0.1:" + port);
});

afterAll(async () => {
  try { await server?.stop(); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

describe("lobby HTTP and room lifecycle", () => {
  it("authenticates tab heartbeats, hides stale/room occupants, and tracks capacity through run start", async () => {
    const initialRes = await fetch(url(LOBBY_SNAPSHOT_PATH));
    expect(initialRes.headers.get("cache-control")).toBe("no-store");
    const initial = await initialRes.json() as LobbySnapshot;
    expect(initial).toMatchObject({ arenaLimit: 1, arenaRoomCount: 0, arenaAvailable: true, waiting: [], activeGame: null });
    expect(initial.serverNow).toBeGreaterThan(0);

    const a = await account("Lobby_A");
    const tab1 = "tab-lobby-a1", tab2 = "tab-lobby-a2";
    const heartbeat = await requestPresence(a, tab1);
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.headers.get("cache-control")).toBe("no-store");
    expect(((await heartbeat.json()) as LobbySnapshot).waiting).toEqual([{ name: a.name }]);
    expect((await requestPresence(a, tab2)).status).toBe(200);
    expect((await snapshot()).waiting).toEqual([{ name: a.name }]);
    expect((await requestPresence(a, tab1, "POST", "forged-token")).status).toBe(403);
    const fake = await fetch(url(LOBBY_PRESENCE_PATH), {
      method: "POST",
      headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: a.token, [PASSCODE_HEADER]: PASSCODE },
      body: JSON.stringify({ name: "Never_Claimed", tabId: "tab-fake-001" }),
    });
    expect(fake.status).toBe(403);
    expect(fake.headers.get("cache-control")).toBe("no-store");
    expect(server.store.get("Never_Claimed")).toBeUndefined();
    expect((await requestPresence(a, tab1, "POST", a.token, null)).status).toBe(401);
    expect((await requestPresence(a, tab1, "DELETE")).status).toBe(200);
    expect((await snapshot()).waiting).toEqual([{ name: a.name }]);

    const join = (who: Account): JoinOptions => ({ profile: who.name, token: who.token, passcode: PASSCODE });
    const first = await client.joinOrCreate<RaidState>(ROOM_NAME, join(a));
    let lobby = await snapshot();
    expect(lobby).toMatchObject({ arenaRoomCount: 1, arenaAvailable: true, waiting: [] });
    expect(lobby.activeGame).toMatchObject({ phase: "lobby", startedAt: null, players: [{ name: a.name, kind: "human", alive: false }] });

    const trainingUser = await account("Lobby_Train");
    await requestPresence(trainingUser, "tab-train-01");
    const training = await client.create<RaidState>(TRAINING_ROOM_NAME, join(trainingUser));
    expect((await snapshot()).waiting).toEqual([]);

    const b = await account("Lobby_B");
    await requestPresence(b, "tab-lobby-b1");
    const second = await client.joinOrCreate<RaidState>(ROOM_NAME, join(b));
    await waitForPhase("active");
    lobby = await snapshot();
    expect(lobby.activeGame?.players.filter(p => p.kind === "human").map(p => p.name).sort()).toEqual([a.name, b.name].sort());
    expect(lobby.activeGame?.startedAt).toBeGreaterThan(0);
    expect(lobby.arenaAvailable).toBe(false);
    expect(lobby.onlineCount).toBe(2);
    expect(lobby.waiting).toEqual([]);
    await first.leave(true);
    lobby = await snapshot();
    expect(lobby.activeGame?.players.map(p => p.name)).not.toContain(a.name);
    expect(lobby.activeGame?.players.some(p => p.kind === "bot" && p.name === a.name)).toBe(false);
    expect(lobby.waiting).toContainEqual({ name: a.name });
    await Promise.all([second.leave(true), training.leave(true)]);
  });
});
