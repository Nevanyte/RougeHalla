// A bot through the real Room (docs/BOTS.md): the real server on a free port, a temp profile file, SDK clients for the humans,
// and a bot added to the room's world on the server side, as the bot manager will. What is pinned here is the Room's half of
// the rule "bots never touch persistence": whatever a bot does in a run (earn GV, kill, win, be removed, outlive a shutdown), nothing
// of it reaches ProfileStore (recordRun, bankGv), the profile registry or the pending results, not even when its display name
// is the callsign of a real profile. The sim's half (no GV for killing one, the win bonus and the kills it records) is in
// test/botSeat.test.ts.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { GV_KILL, GV_MOB, ROOM_NAME, type JoinOptions, type RunResult } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { applyDamage, awardGv } from "../src/sim/arena";
import { addPlayer, removePlayer } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

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

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let stopped = false;
let port = 0;
let dir = "";
let profileFile = "";
let client: Client;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-botroom-"));
  profileFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }),
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120,
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let counter = 0;
interface Account { name: string; token: string }

/** A brand new profile, claimed over HTTP the way the menu does it. */
async function claimNamed(name: string): Promise<Account> {
  const response = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { created: boolean; token: string };
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

const claim = (): Promise<Account> => claimNamed(`bt${++counter}`);

const record = (who: Account) => server.store.get(who.name)!;

// ---------------------------------------------------------------- room helpers
interface Player {
  who: Account;
  room: ClientRoom;
  results: RunResult[];
  toasts: string[];
  left: boolean;
}

const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, results: [], toasts: [], left: false };
  room.onMessage("result", (r: RunResult) => p.results.push(r));
  room.onMessage("toast", (m: { text: string }) => p.toasts.push(m.text));
  room.onLeave(() => { p.left = true; });
  players.push(p);
  return p;
}

const joinOptions = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });

interface ServerRoomView {
  world: World;
  pendingResults: Map<string, RunResult>;
}

const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const sessionOf = (p: Player) => p.room.sessionId;

async function leave(p: Player): Promise<void> {
  if (p.left) return;
  await p.room.leave(true);
  await until(() => p.left, "client to report the leave");
}

afterEach(async () => {
  for (const p of players.splice(0)) {
    try { await leave(p); } catch { /* connection already gone */ }
  }
  await until(() => server.profiles.size === 0, "all profiles to be released", 5000);
  vi.restoreAllMocks();
});

const BOT = "bot-1";

/**
 * Two humans in a room that waits for a third, then a bot joins as the third and the countdown runs out (a bot does not count
 * towards minPlayers, so it cannot start the run by itself): the run starts on the next tick.
 * `botName` is the bot's display name (its `profile`); pass a real callsign to see that it still reaches nothing.
 */
async function runWithBot(botName: string, timers: Partial<SimConfig> = {}): Promise<{ a: Player; b: Player; world: World }> {
  const [A, B] = [await claim(), await claim()];
  const a = track(A, await client.create<RaidState>(ROOM_NAME, joinOptions(A)));
  const world = worldOf(a);
  world.config = { ...world.config, minPlayers: 3, ...timers };
  const b = track(B, await client.joinById<RaidState>(a.room.roomId, joinOptions(B)));
  expect(world.state.phase).toBe("lobby");
  addPlayer(world, BOT, botName, { bot: true });
  world.state.lobbyEndsAt = world.state.serverTime;
  await until(() => world.state.phase === "active", "the run to start");
  await until(() => [a, b].every((p) => p.room.state.phase === "active"), "clients to see the run start");
  expect(world.state.players.get(BOT)).toMatchObject({ bot: true, status: "alive", name: botName });
  expect(a.room.state.players.get(BOT)!.bot).toBe(true); // marked for the clients too
  return { a, b, world };
}

/** A lethal blow from `killer` (a human's or the bot's id) on `victim`, between ticks. */
function slay(world: World, killer: string, victim: string): void {
  const v = world.state.players.get(victim)!;
  applyDamage(world, v, world.players.get(victim)!, v.hp + 1000, { id: killer, p: world.state.players.get(killer)!, rt: world.players.get(killer)! });
}

/** Counts every call that reaches the store, with the name it was made for. Calls through, so the store still behaves. */
function watchStore() {
  const runs = vi.spyOn(server.store, "recordRun");
  const banks = vi.spyOn(server.store, "bankGv");
  return {
    recorded: () => runs.mock.calls.map((c) => c[0]),
    banked: () => banks.mock.calls.map((c) => [c[0], c[1]] as const),
  };
}

describe("a bot in a run", () => {
  it("is marked for every client, and killing it pays no GV and nothing for it is recorded", async () => {
    const ghost = await claimNamed("realprofile"); // a real profile with the bot's display name
    const watch = watchStore();
    const { a, b, world } = await runWithBot(ghost.name);
    const before = record(ghost);

    slay(world, sessionOf(a), BOT);
    await sleep(200); // a tick or two: the bot's result is emitted and handled
    expect(world.state.players.get(BOT)!.status).toBe("dead");
    expect(watch.recorded()).toEqual([]); // nobody else is resolved yet
    expect(a.toasts).not.toContain(`+${GV_KILL} GV (kill)`);
    expect(world.state.players.get(sessionOf(a))!.kills).toBe(1);
    expect(world.state.players.get(sessionOf(a))!.gv).toBe(0);
    expect(serverRoom(a).pendingResults.has(BOT)).toBe(false);
    expect(server.profiles.ownerOf(ghost.name)).toBeUndefined();

    slay(world, sessionOf(a), sessionOf(b));
    await until(() => a.results.length === 1 && b.results.length === 1, "both results");

    // Exactly the two humans were recorded, and the bot's namesake saw nothing.
    expect(watch.recorded().sort()).toEqual([a.who.name, b.who.name].sort());
    expect(watch.banked()).toEqual([]);
    expect(record(ghost)).toEqual(before);
    expect(record(ghost).stats).toMatchObject({ runs: 0, wins: 0, deaths: 0, kills: 0 });
    expect(record(ghost).gv).toBe(0);

    // The winner's figures leave the bot out: one kill recorded (B), one kill's GV, no win bonus (two humans).
    expect(a.results[0]).toMatchObject({ outcome: "won", kills: 1, players: 3, winBonusWithheld: true, gv: { kills: GV_KILL, win: 0, total: GV_KILL } });
    expect(record(a.who)).toMatchObject({ gv: GV_KILL, stats: { runs: 1, wins: 1, kills: 1 } });
    expect(b.results[0]).toMatchObject({ outcome: "died", kills: 0, killedBy: a.who.name });
    expect(b.results[0]).not.toHaveProperty("killedByBot");
  });

  it("that kills a human is named as a bot in the human's result, and its win and its GV bank nothing", async () => {
    const ghost = await claimNamed("realprofile2");
    const watch = watchStore();
    const { a, b, world } = await runWithBot(ghost.name);
    const before = record(ghost);

    slay(world, BOT, sessionOf(b));
    await until(() => b.results.length === 1, "B's result");
    expect(b.results[0]).toMatchObject({ outcome: "died", killedBy: ghost.name, killedByBot: true });
    expect(world.players.get(BOT)!.gv.kills).toBe(GV_KILL); // the sim pays it in the run; the Room drops what it would bank

    slay(world, BOT, sessionOf(a)); // and the bot wins
    await until(() => a.results.length === 1 && world.state.phase === "ended", "A's result and the end");
    await sleep(150);
    expect(world.state.winner).toBe(ghost.name);
    expect(a.results[0]).toMatchObject({ outcome: "died", killedBy: ghost.name, killedByBot: true });

    expect(watch.recorded().sort()).toEqual([a.who.name, b.who.name].sort());
    expect(watch.banked()).toEqual([]);
    expect(record(ghost)).toEqual(before);
    expect(serverRoom(a).pendingResults.has(BOT)).toBe(false);
    expect([...serverRoom(a).pendingResults.keys()].sort()).toEqual([sessionOf(a), sessionOf(b)].sort());
  });

  it("removed mid-run, its result (flushed after it is gone from the world) is dropped too", async () => {
    const ghost = await claimNamed("realprofile3");
    const watch = watchStore();
    const { a, b, world } = await runWithBot(ghost.name);
    awardGv(world, world.state.players.get(BOT)!, world.players.get(BOT)!, "mob"); // it has GV a careless Room would bank

    removePlayer(world, BOT);
    expect(world.players.has(BOT)).toBe(false);
    await sleep(200);
    expect(watch.recorded()).toEqual([]);

    slay(world, sessionOf(a), sessionOf(b));
    await until(() => a.results.length === 1 && b.results.length === 1, "both results");
    expect(watch.recorded().sort()).toEqual([a.who.name, b.who.name].sort());
    expect(watch.banked()).toEqual([]);
    expect(record(ghost).stats.runs).toBe(0);
    expect(record(ghost).gv).toBe(0);
    expect(serverRoom(a).pendingResults.has(BOT)).toBe(false);
  });
});

describe("shutdown", () => {
  it("with a bot still in a run pays the humans' unbanked GV and nothing for the bot", async () => {
    const ghost = await claimNamed("realprofile4");
    const watch = watchStore();
    const { a, b, world } = await runWithBot(ghost.name);
    awardGv(world, world.state.players.get(sessionOf(a))!, world.players.get(sessionOf(a))!, "mob");
    awardGv(world, world.state.players.get(BOT)!, world.players.get(BOT)!, "mob");
    slay(world, BOT, sessionOf(b)); // the bot earns a kill's GV too
    await until(() => b.results.length === 1, "B's result");
    expect(world.players.get(BOT)!.gv).toEqual({ kills: GV_KILL, mobs: GV_MOB, bounty: 0 });

    stopped = true;
    await server.stop();

    // The one live human is paid what it earned; the bot's GV and its namesake's profile are untouched.
    expect(watch.banked()).toEqual([[a.who.name, GV_MOB]]);
    expect(watch.recorded()).toEqual([b.who.name]);
    const disk = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    expect(disk.profiles[ghost.name]).toMatchObject({ gv: 0, gvLifetime: 0, stats: { runs: 0, wins: 0, deaths: 0, kills: 0 } });
    expect(disk.profiles[a.who.name]).toMatchObject({ gv: GV_MOB });
  });
});
