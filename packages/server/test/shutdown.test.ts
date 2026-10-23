// A graceful shutdown (a deploy, or every tsx-watch restart in `npm run dev`) with raids in flight.
// The raid dies with the process, so nobody still in it is MIA: their own items go back to the stash,
// and no raid or death is recorded. One real server, one scenario set up in beforeAll, then stop();
// each test checks one fact about what ended up on disk. (Colyseus' matchmaker is a process-wide
// singleton and cannot be restarted here, which is why this has a file of its own.)
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, type ItemDTO, type JoinOptions, type ProfileResponse, type ProfileStats, type RaidResult } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { JsonStashStore } from "../src/persistence/StashStore";
import { startServer, type RaidServer } from "../src/index";
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

interface Account { name: string; token: string; stash: ItemDTO[] }
interface Player { room: ClientRoom; results: RaidResult[] }

interface ServerRoomView {
  world: World;
  clients: { getById(id: string): { ref: { terminate(): void } } | undefined };
}

const PLAYERS_IN_THE_RAID = 6;

let server: RaidServer;
let client: Client;
let port = 0;
let dir = "";
let stashFile = "";
let counter = 0;

const sorted = (items: ItemDTO[]) => [...items].sort((a, b) => a.uid.localeCompare(b.uid));
const zeroStats: ProfileStats = { raids: 0, extracts: 0, deaths: 0, kills: 0 };

async function claim(): Promise<Account> {
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/sd${++counter}`);
  const body = (await res.json()) as ProfileResponse;
  return { name: body.profile.name, token: body.token, stash: body.profile.stash };
}

function track(room: ClientRoom): Player {
  const p: Player = { room, results: [] };
  room.reconnection.enabled = false; // the server is about to go away for good
  room.onMessage("result", (r: RaidResult) => p.results.push(r));
  room.onMessage("toast", () => {});
  room.onMessage("fx", () => {});
  return p;
}

const options = (who: Account, loadout: ItemDTO[]): JoinOptions => ({ profile: who.name, token: who.token, loadout: loadout.map((i) => i.uid) });
const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const serverPlayer = (p: Player) => serverRoom(p).world.state.players.get(p.room.sessionId)!;
const carried = (p: Player): ItemDTO[] => Array.from(serverPlayer(p).inventory, (i) => ({ uid: i.uid, def: i.def }));

function placeOnServer(p: Player, x: number, y: number): void {
  const world = serverRoom(p).world;
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(p.room.sessionId)!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

type Saved = { stash: ItemDTO[]; stats: ProfileStats };
/** What the stash file holds once stop() has returned, and what a restart loading it would see. */
let disk: Record<string, Saved>;
let reloaded: Record<string, Saved>;
let dataDirListing: string[] = [];

// The accounts, by what happens to them.
let raider: Account;
let partner: Account;
let dropped: Account;
let extractor: Account;
let victim: Account;
let killer: Account;
let lobbyer: Account;
let loot: ItemDTO;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-shutdown-"));
  stashFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    port,
    minPlayers: PLAYERS_IN_THE_RAID, // the raid starts when the last of them walks in, so all of them are in it
    fillSeconds: 0,
    lobbySeconds: 120,
    raidSeconds: 120,
    extractSeconds: 0.3,
    latencyMs: 0,
    stashFile,
  });
  client = new Client(`http://127.0.0.1:${port}`);

  raider = await claim();
  partner = await claim();
  dropped = await claim();
  extractor = await claim();
  victim = await claim();
  killer = await claim();
  lobbyer = await claim();

  // --- the raid room: six players, started once the last one joins
  const first = track(await client.create<RaidState>(ROOM_NAME, options(raider, raider.stash.slice(0, 2))));
  const join = async (who: Account, loadout: ItemDTO[]) =>
    track(await client.joinById<RaidState>(first.room.roomId, options(who, loadout)));
  await join(partner, partner.stash.slice(0, 1));
  const pDropped = await join(dropped, dropped.stash.slice(0, 2));
  const pExtractor = await join(extractor, extractor.stash.slice(0, 1));
  const pVictim = await join(victim, victim.stash.slice(0, 1));
  const pKiller = await join(killer, []);
  const world = serverRoom(first).world;
  await until(() => world.state.phase === "active" && world.state.players.size === PLAYERS_IN_THE_RAID, "the raid to start");
  await until(() => [...world.state.players.values()].every((p) => p.status === "alive"), "everyone to be alive");

  // --- someone who extracted before the shutdown (banked and counted already)
  const zone = world.map.extracts[0]!;
  placeOnServer(pExtractor, zone.x, zone.y);
  pExtractor.room.send("extract", {});
  await until(() => pExtractor.results.length === 1, "the early extraction");

  // --- someone who was killed before the shutdown (lost and counted already)
  placeOnServer(pVictim, zone.x - 12, zone.y);
  placeOnServer(pKiller, zone.x + 12, zone.y);
  serverPlayer(pVictim).hp = 1;
  await sleep(120);
  const deadline = Date.now() + 10_000;
  while (pVictim.results.length === 0 && Date.now() < deadline) {
    pKiller.room.send("attack", { x: zone.x - 12, y: zone.y });
    await sleep(120);
  }
  await until(() => pVictim.results.length === 1, "the early death");

  // --- the raider loots a crate: that item is theirs only if they extract, so it must not reach the stash
  const crate = [...world.state.containers.values()].find((c) => c.kind === "crate" && c.items.length > 0)!;
  loot = { uid: crate.items[0]!.uid, def: crate.items[0]!.def };
  placeOnServer(first, crate.x, crate.y);
  await sleep(120);
  first.room.send("take", { containerId: crate.id, uid: loot.uid });
  await until(() => carried(first).some((i) => i.uid === loot.uid), "the pickup");

  // --- one raider loses their connection and is held in the reconnect window when the server stops
  const room = serverRoom(pDropped);
  const sid = pDropped.room.sessionId;
  await until(() => !!room.clients.getById(sid), "a live connection");
  room.clients.getById(sid)!.ref.terminate();
  await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
  expect(world.players.get(sid)?.resolved).toBe(false);

  // --- and a second room that is still in its lobby
  const pLobby = track(await client.create<RaidState>(ROOM_NAME, options(lobbyer, lobbyer.stash.slice(0, 2))));
  expect(serverPlayer(pLobby).status).toBe("lobby");
  expect(pLobby.room.roomId).not.toBe(first.room.roomId);
  expect(server.store.get(raider.name)!.stash).toEqual(raider.stash.slice(2)); // their items are out of the stash now
  expect(server.store.get(lobbyer.name)!.stash).toEqual(lobbyer.stash.slice(2));

  // --- the shutdown
  await server.stop();
  dataDirListing = fs.readdirSync(path.dirname(stashFile));
  const file = JSON.parse(fs.readFileSync(stashFile, "utf8")) as { profiles: Record<string, Saved> };
  const restart = new JsonStashStore(stashFile);
  const everyone = [raider, partner, dropped, extractor, victim, killer, lobbyer];
  disk = Object.fromEntries(everyone.map((a) => [a.name, file.profiles[a.name]!]));
  reloaded = Object.fromEntries(everyone.map((a) => [a.name, restart.get(a.name)!]));
}, 60_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const stashOf = (a: Account) => disk[a.name]!.stash;
const statsOf = (a: Account) => disk[a.name]!.stats;

describe("stop() with an active raid and a lobby in flight", () => {
  it("returns the items a raider brought and still carried, none missing and none doubled", () => {
    expect(raider.stash).toHaveLength(3);
    expect(sorted(stashOf(raider))).toEqual(sorted(raider.stash));
    expect(sorted(stashOf(partner))).toEqual(sorted(partner.stash));
  });

  it("records no raid and no death for them", () => {
    for (const who of [raider, partner, dropped]) expect(statsOf(who)).toEqual(zeroStats);
  });

  it("does not keep what the raider looted in the raid", () => {
    for (const saved of Object.values(disk)) expect(saved.stash.some((i) => i.uid === loot.uid)).toBe(false);
  });

  it("also covers a raider whose connection had dropped and whose seat was being held", () => {
    expect(sorted(stashOf(dropped))).toEqual(sorted(dropped.stash));
    expect(statsOf(dropped)).toEqual(zeroStats);
  });

  it("still refunds a player who was waiting in a lobby", () => {
    expect(sorted(stashOf(lobbyer))).toEqual(sorted(lobbyer.stash));
    expect(statsOf(lobbyer)).toEqual(zeroStats);
  });

  it("leaves what was settled before the shutdown exactly as it was, counted once", () => {
    // Extracted earlier: the item came back then, and the raid was counted then.
    expect(sorted(stashOf(extractor))).toEqual(sorted(extractor.stash));
    expect(statsOf(extractor)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });
    // Killed earlier: the item stays lost, and the death stays a death.
    expect(sorted(stashOf(victim))).toEqual(sorted(victim.stash.slice(1)));
    expect(statsOf(victim)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    // The killer was still in the raid when the server stopped.
    expect(sorted(stashOf(killer))).toEqual(sorted(killer.stash));
    expect(statsOf(killer)).toEqual(zeroStats);
  });

  it("the file a restart loads says the same, token and all", () => {
    for (const who of [raider, partner, dropped, extractor, victim, killer, lobbyer]) {
      expect(reloaded[who.name]).toMatchObject({ name: who.name, token: who.token, stash: stashOf(who), stats: statsOf(who) });
    }
  });

  it("frees every profile, so nobody is locked out after the restart", () => {
    expect(server.profiles.size).toBe(0);
  });

  it("leaves the data directory clean: the stash file and nothing half written", () => {
    expect(dataDirListing).toEqual(["stash.json"]);
  });
});
