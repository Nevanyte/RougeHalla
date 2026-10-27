// A graceful shutdown (a deploy, or every tsx-watch restart in `npm run dev`) with runs in flight.
// The run dies with the process, so nobody still in it is MIA: no run is recorded and no stats move, but the GV each
// player had earned so far is paid once, through bankGv. Players whose result was already out were banked then and
// must not be paid again. One real server, one scenario set up in beforeAll, then stop(); each test checks one fact
// about what ended up on disk. (Colyseus' matchmaker is a process-wide singleton and cannot be restarted here, which
// is why this has a file of its own.)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  GV_KILL, GV_WIN, monthKey, ROOM_NAME, type JoinOptions, type ProfileResponse, type ProfileStats, type RunResult, type Vec2,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { JsonProfileStore, type ProfileRecord } from "../src/persistence/ProfileStore";
import { startServer, type RaidServer } from "../src/index";
import type { World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sum = (xs: Iterable<number>): number => { let n = 0; for (const x of xs) n += x; return n; };

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

interface Account { name: string; token: string }
interface Player { room: ClientRoom; results: RunResult[] }

interface ServerRoomView {
  world: World;
  clients: { getById(id: string): { ref: { terminate(): void } } | undefined };
}

const PLAYERS_IN_THE_RUN = 6;

let server: RaidServer;
let client: Client;
let port = 0;
let dir = "";
let profileFile = "";
let counter = 0;

const zeroStats: ProfileStats = { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 };

async function claim(): Promise<Account> {
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/sd${++counter}`);
  const body = (await res.json()) as ProfileResponse;
  return { name: body.profile.name, token: body.token };
}

function track(room: ClientRoom): Player {
  const p: Player = { room, results: [] };
  room.reconnection.enabled = false; // the server is about to go away for good
  room.onMessage("result", (r: RunResult) => p.results.push(r));
  room.onMessage("toast", () => {});
  room.onMessage("fxs", () => {});
  return p;
}

const options = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });
const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const serverPlayer = (p: Player) => worldOf(p).state.players.get(p.room.sessionId)!;

function placeOnServer(p: Player, x: number, y: number): void {
  const world = worldOf(p);
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(p.room.sessionId)!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

/** A spawn point nobody alive is near except the fighters, so the duel cannot hit a bystander. */
function duelSpot(world: World, fighters: string[]): Vec2 {
  let best = world.map.spawns[0]!;
  let bestDistance = -1;
  for (const spawn of world.map.spawns) {
    let nearest = Infinity;
    for (const [id, p] of world.state.players) {
      if (fighters.includes(id) || p.status !== "alive") continue;
      nearest = Math.min(nearest, Math.hypot(p.x - spawn.x, p.y - spawn.y));
    }
    if (nearest > bestDistance) { bestDistance = nearest; best = spawn; }
  }
  return best;
}

/**
 * `killer` attacks `victim` (brought down to a sliver of hp, so any hit that gets through is lethal) until the victim is
 * dead and has its result. Inputs only: an `attack` press toward the victim and its `release`, which is one swing, one
 * cast or one arrow at the minimum draw, whatever the killer holds. A tap the cooldown swallowed is repeated.
 */
async function kill(killer: Player, victim: Player): Promise<void> {
  const at = duelSpot(worldOf(killer), [killer.room.sessionId, victim.room.sessionId]);
  placeOnServer(victim, at.x + 12, at.y);
  placeOnServer(killer, at.x - 12, at.y);
  serverPlayer(victim).hp = 0.01;
  await sleep(120);
  const a = Math.atan2(0, 24); // the victim is due east
  const deadline = Date.now() + 10_000;
  while (victim.results.length === 0 && Date.now() < deadline) {
    killer.room.send("attack", { a });
    killer.room.send("release", { a });
    const settle = Date.now() + 300; // a windup, and the flight of whatever it looses
    while (victim.results.length === 0 && Date.now() < settle) await sleep(20);
  }
  await until(() => victim.results.length === 1, "the victim's result");
}

/** What the profile file holds once stop() has returned, and what a restart loading it would see. */
let disk: Record<string, ProfileRecord>;
let reloaded: Record<string, ProfileRecord | undefined>;
let before: Record<string, ProfileRecord>;
let dataDirListing: string[] = [];
let months: Set<string>;
let recordRun: MockInstance<typeof server.store.recordRun>;
let bankGv: MockInstance<typeof server.store.bankGv>;
let bankedDuringStop: Array<[string, number]>;
let recordedDuringStop: number;

// The accounts, by what happens to them.
let raider: Account; // alive at the stop; killed the trader, so holds GV_KILL not yet banked
let partner: Account; // alive at the stop, nothing earned
let dropped: Account; // alive at the stop but disconnected (held in the reconnect window); killed a victim
let trader: Account; // killed a victim, then was killed: their GV_KILL was banked with their result
let victim: Account; // killed by the trader
let victim2: Account; // killed by the dropped player
let hunter: Account; // in a second run that is down to two alive players when the server stops; killed prey
let bystander: Account; // the other one of those two
let prey: Account; // killed by the hunter
let lobbyer: Account; // waiting in another room's lobby

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-shutdown-"));
  profileFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    port,
    minPlayers: PLAYERS_IN_THE_RUN, // the run starts when the last of them walks in, so all of them are in it
    fillSeconds: 0,
    lobbySeconds: 120,
    patienceSeconds: 120, // nothing happens in the arena by itself
    patienceMinSeconds: 120,
    suddenDeathSeconds: 120,
    planSeconds: 0, // today's flow: the run starts straight from the lobby
    firstPatienceSeconds: 0,
    latencyMs: 0,
    stashFile: profileFile,
  });
  client = new Client(`http://127.0.0.1:${port}`);

  raider = await claim();
  partner = await claim();
  dropped = await claim();
  trader = await claim();
  victim = await claim();
  victim2 = await claim();
  hunter = await claim();
  bystander = await claim();
  prey = await claim();
  lobbyer = await claim();
  const everyone = [raider, partner, dropped, trader, victim, victim2, hunter, bystander, prey, lobbyer];
  before = Object.fromEntries(everyone.map((a) => [a.name, server.store.get(a.name)!]));
  const started = Date.now();

  // --- the run: six players, started once the last one joins
  const first = track(await client.create<RaidState>(ROOM_NAME, options(raider)));
  const join = async (who: Account) => track(await client.joinById<RaidState>(first.room.roomId, options(who)));
  const pPartner = await join(partner);
  const pDropped = await join(dropped);
  const pTrader = await join(trader);
  const pVictim = await join(victim);
  const pVictim2 = await join(victim2);
  const world = worldOf(first);
  await until(() => world.state.phase === "active" && world.state.players.size === PLAYERS_IN_THE_RUN, "the run to start");
  await until(() => [...world.state.players.values()].every((p) => p.status === "alive"), "everyone to be alive");

  // --- the trader kills (earning GV_KILL), then is killed: that result was banked before the shutdown, GV included
  await kill(pTrader, pVictim);
  expect(serverPlayer(pTrader).gv).toBe(GV_KILL);
  await kill(first, pTrader);
  expect(pTrader.results[0]).toMatchObject({ outcome: "died", killedBy: raider.name, kills: 1, gv: { kills: GV_KILL, total: GV_KILL } });
  expect(server.store.get(trader.name)!.gv).toBe(GV_KILL);
  expect(serverPlayer(first).gv).toBe(GV_KILL); // the raider's is still only in the run

  // --- the dropped player kills too, then loses their connection and is held in the reconnect window
  await kill(pDropped, pVictim2);
  expect(serverPlayer(pDropped).gv).toBe(GV_KILL);
  const room = serverRoom(pDropped);
  const sid = pDropped.room.sessionId;
  await until(() => !!room.clients.getById(sid), "a live connection");
  room.clients.getById(sid)!.ref.terminate();
  await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
  expect(world.players.get(sid)?.resolved).toBe(false);
  expect(pPartner.results).toEqual([]);

  // --- a second run, down to two alive players: while the server shuts down, leaving one of them must not make the
  // other the winner of a run that is void
  const pHunter = track(await client.create<RaidState>(ROOM_NAME, options(hunter)));
  const duoWorld = worldOf(pHunter);
  duoWorld.config = { ...duoWorld.config, minPlayers: 3 };
  const pBystander = track(await client.joinById<RaidState>(pHunter.room.roomId, options(bystander)));
  const pPrey = track(await client.joinById<RaidState>(pHunter.room.roomId, options(prey)));
  await until(() => duoWorld.state.phase === "active" && [...duoWorld.state.players.values()].every((p) => p.status === "alive"), "the second run to start");
  await kill(pHunter, pPrey);
  expect(serverPlayer(pHunter).gv).toBe(GV_KILL);
  expect(pBystander.results).toEqual([]);
  expect(duoWorld.state.phase).toBe("active"); // two alive: the run goes on

  // --- and a third room that is still in its lobby
  const pLobby = track(await client.create<RaidState>(ROOM_NAME, options(lobbyer)));
  expect(serverPlayer(pLobby).status).toBe("lobby");
  expect(pLobby.room.roomId).not.toBe(first.room.roomId);
  // raider, partner and dropped are still in the first run, hunter and bystander in the second, and the lobbyer is queued
  expect(server.profiles.size).toBe(6);

  // --- the shutdown: what the store is asked to do from here on is what the shutdown does
  recordRun = vi.spyOn(server.store, "recordRun");
  bankGv = vi.spyOn(server.store, "bankGv");
  await server.stop();
  recordedDuringStop = recordRun.mock.calls.length;
  bankedDuringStop = bankGv.mock.calls.map(([name, gv]) => [name, gv]);
  const finished = Date.now();
  months = new Set([monthKey(started), monthKey(finished)]);
  dataDirListing = fs.readdirSync(path.dirname(profileFile));
  const file = JSON.parse(fs.readFileSync(profileFile, "utf8")) as { version: number; profiles: Record<string, ProfileRecord> };
  expect(file.version).toBe(2);
  const restart = new JsonProfileStore(profileFile);
  disk = Object.fromEntries(everyone.map((a) => [a.name, file.profiles[a.name]!]));
  reloaded = Object.fromEntries(everyone.map((a) => [a.name, restart.get(a.name)]));
}, 60_000);

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const gvOf = (a: Account) => disk[a.name]!.gv;
const statsOf = (a: Account) => disk[a.name]!.stats;
const monthsOf = (a: Account) => disk[a.name]!.gvByMonth;

/** `gv` banked once: in the balance, the lifetime total and one of the months the test ran in. */
function expectPaid(a: Account, gv: number): void {
  expect(gvOf(a), `${a.name} balance`).toBe(gv);
  expect(disk[a.name]!.gvLifetime, `${a.name} lifetime`).toBe(gv);
  expect(Object.keys(monthsOf(a)).every((m) => months.has(m)), `${a.name} months`).toBe(true);
  expect(sum(Object.values(monthsOf(a))), `${a.name} month`).toBe(gv);
}

describe("stop() with a run and a lobby in flight", () => {
  it("pays the GV an alive player had earned so far, once, through bankGv", () => {
    expectPaid(raider, GV_KILL);
    expectPaid(dropped, GV_KILL);
    expectPaid(hunter, GV_KILL);
    const paid = [[dropped.name, GV_KILL], [hunter.name, GV_KILL], [raider.name, GV_KILL]];
    expect(bankedDuringStop.slice().sort()).toEqual(paid.sort());
  });

  it("records no run for them: the run is void, so nothing is counted, not even the kill", () => {
    for (const who of [raider, partner, dropped, hunter, bystander]) expect(statsOf(who), who.name).toEqual(zeroStats);
    expect(recordedDuringStop).toBe(0);
  });

  it("pays nothing to an alive player who had earned nothing", () => {
    for (const who of [partner, bystander]) {
      expectPaid(who, 0);
      expect(monthsOf(who)).toEqual({});
      expect(bankedDuringStop.some(([name]) => name === who.name)).toBe(false);
    }
  });

  it("does not make the last one of two alive players the winner of a void run: no win bonus, no recorded win", () => {
    // The hunter and the bystander were the only two alive in their run, so whoever the shutdown removed first
    // left the other alone. Neither may be paid GV_WIN or credited a win for it.
    expect(statsOf(hunter).wins).toBe(0);
    expect(statsOf(bystander).wins).toBe(0);
    for (const who of [hunter, bystander]) expect(gvOf(who), who.name).toBeLessThan(GV_WIN);
    expect(bankedDuringStop.some(([, gv]) => gv >= GV_WIN)).toBe(false);
    expect(Object.values(disk).some((saved) => saved.stats.wins > 0)).toBe(false);
  });

  it("also covers a player whose connection had dropped and whose seat was being held", () => {
    expectPaid(dropped, GV_KILL);
    expect(statsOf(dropped)).toEqual(zeroStats);
  });

  it("leaves a player who was waiting in a lobby untouched", () => {
    expect(disk[lobbyer.name]).toEqual(before[lobbyer.name]);
    expect(bankedDuringStop.some(([name]) => name === lobbyer.name)).toBe(false);
  });

  it("leaves what was settled before the shutdown exactly as it was, counted and paid once", () => {
    // Killed after a kill of their own: their result banked the kill GV then, and the death was counted then.
    expectPaid(trader, GV_KILL);
    expect(statsOf(trader)).toEqual({ ...zeroStats, runs: 1, deaths: 1, kills: 1 });
    // Killed with nothing earned.
    for (const who of [victim, victim2, prey]) {
      expectPaid(who, 0);
      expect(statsOf(who), who.name).toEqual({ ...zeroStats, runs: 1, deaths: 1 });
    }
    // None of them was paid again by the shutdown.
    for (const who of [trader, victim, victim2, prey]) expect(bankedDuringStop.some(([name]) => name === who.name)).toBe(false);
  });

  it("the ledger balances: every GV earned in the run is on disk exactly once", () => {
    // Four kills were made; none of them was lost and none was paid twice.
    const everyone = [raider, partner, dropped, trader, victim, victim2, hunter, bystander, prey];
    expect(sum(everyone.map(gvOf))).toBe(4 * GV_KILL);
    expect(sum(everyone.map((a) => disk[a.name]!.gvLifetime))).toBe(4 * GV_KILL);
  });

  it("the file a restart loads says the same, token and all", () => {
    for (const who of [raider, partner, dropped, trader, victim, victim2, hunter, bystander, prey, lobbyer]) {
      expect(reloaded[who.name]).toEqual(disk[who.name]);
      expect(reloaded[who.name]).toMatchObject({ name: who.name, token: who.token });
    }
  });

  it("frees every profile, so nobody is locked out after the restart", () => {
    expect(server.profiles.size).toBe(0);
  });

  it("leaves the data directory clean: the profile file and nothing half written", () => {
    expect(dataDirListing).toEqual(["stash.json"]);
  });
});
