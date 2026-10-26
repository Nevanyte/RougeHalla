// The meta layer (cosmetics and achievements) through the real Room, over real sockets: the real server in this
// process on a free port, a temp profile file, short timers, and SDK clients that send inputs only. What is checked is
// what the adapter adds on top of the sim: the look word read from the profile when a player joins (and synced to
// everyone), and the achievements the store unlocks when the Room banks a run, which ride on the `result` message.
// A win unlocks win goals only when it passed the win bonus gate (3+ starters, 2+ opponents damaged): the Room hands that
// to the store as `winQualified`, so a two-player walkover is a win in the stats and nothing more. The same call carries
// the weapon in hand at the end, and the faction only if the player picked one at join (these clients do not, so the
// round-robin default is never recorded), so a qualified win counts for that weapon only.
// Fights use the Phase 9 inputs (`attack` + `release`); kills are made by putting the victim on a sliver of hp first.
// The rules themselves (which goal unlocks what, how a look word packs) have their own tests in shared/ and in
// profileStore.test.ts. Profiles that need hand-set cosmetics, stats or achievements are written into the profile file
// before the server starts (the same shape a hand-edited file has); everything else is claimed over HTTP.
// Every test uses profiles of its own, so nothing leaks between them.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  ACHIEVEMENTS, defaultFaction, KILL_CREDIT_SECONDS, mulberry32, packLook, PROFILE_TOKEN_HEADER, ROOM_NAME, SIGNATURE_WEAPONS,
  TICK_MS, unpackLook, type JoinOptions, type RunResult, type Vec2,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import type { ProfileRecord } from "../src/persistence/ProfileStore";
import { startServer, type RaidServer } from "../src/index";
import { enqueueClientMessage } from "../src/sim/inputs";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* state not there yet */ }
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

// ---------------------------------------------------------------- seeded profiles
interface Account { name: string; token: string }

const tokenOf = (name: string): string => `seed-token-${name}`;
const seedAccount = (name: string): Account => ({ name, token: tokenOf(name) });

type SeedFields = Partial<Omit<ProfileRecord, "name" | "token">>;

function seedRecord(name: string, fields: SeedFields = {}): ProfileRecord {
  return {
    name,
    token: tokenOf(name),
    gv: 0,
    gvLifetime: 0,
    gvByMonth: {},
    stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
    cosmetics: { owned: [], equipped: {} },
    achievements: {},
    progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
    ...fields,
  };
}

/** Everything equipped at once: a skin, an outline, a trail, a title and two golden variants (one faction, one weapon). */
const FULL_EQUIPPED: Record<string, string> = {
  skin: "skin-crimson",
  outline: "outline-white",
  trail: "trail-ember",
  title: "title-rookie",
  "gold-fire": "gilded-fire",
  "gold-axe": "gilded-axe",
};
/** Owned: the equipped set, and two more items that are not on. */
const FULL_OWNED = [...Object.values(FULL_EQUIPPED), "skin-amber", "title-gladiator"];

const fullLook = (name: string): ProfileRecord =>
  seedRecord(name, { cosmetics: { owned: [...FULL_OWNED], equipped: { ...FULL_EQUIPPED } } });

/** A profile's unlock time in the seeded achievements: long before any test runs. */
const LONG_AGO = 1000;

const SEEDS: ProfileRecord[] = [
  fullLook("mFullLook"),
  fullLook("mFullPair"),
  seedRecord("mSwap", { cosmetics: { owned: ["skin-crimson", "skin-amber", "title-rookie"], equipped: { skin: "skin-crimson" } } }),
  seedRecord("mBare", { cosmetics: { owned: ["skin-crimson", "title-rookie"], equipped: {} } }),
  // Hand-edited files: equipped ids that must not show.
  seedRecord("mNotOwned", {
    cosmetics: { owned: ["title-rookie"], equipped: { skin: "skin-amber", title: "title-rookie" } },
  }),
  seedRecord("mNothingOwned", { cosmetics: { owned: [], equipped: { skin: "skin-amber", title: "title-rookie" } } }),
  seedRecord("mUnknownId", {
    cosmetics: { owned: ["outline-white", "skin-nonesuch"], equipped: { skin: "skin-nonesuch", outline: "outline-white" } },
  }),
  seedRecord("mWrongSlot", {
    cosmetics: {
      owned: ["skin-crimson", "outline-white", "title-rookie", "trail-ember", "gilded-axe"],
      equipped: {
        skin: "skin-crimson",
        outline: "title-rookie", // a title in the outline slot
        trail: "outline-white", // an outline in the trail slot
        "gold-fire": "gilded-axe", // the axe in the fire slot
        "gold-axe": "gilded-axe", // the one right entry among the golden slots
        hat: "skin-crimson", // a slot that does not exist
      },
    },
  }),
  // Progress: nine kills and the achievements they and a first (qualified) win already paid for.
  seedRecord("mNineKills", {
    stats: { runs: 3, wins: 1, draws: 0, deaths: 2, kills: 9 },
    achievements: { first_blood: LONG_AGO, first_win: LONG_AGO },
    cosmetics: { owned: ["title-bloodied", "title-victor", "skin-laurel"], equipped: {} },
    progress: { qualifiedWins: 1, bountyRuns: 0, bestRunKills: 4, winsByFaction: {}, winsByWeapon: {} },
  }),
  seedRecord("mNineKillsB", {
    stats: { runs: 3, wins: 1, draws: 0, deaths: 2, kills: 9 },
    achievements: { first_blood: LONG_AGO, first_win: LONG_AGO },
    cosmetics: { owned: ["title-bloodied", "title-victor", "skin-laurel"], equipped: {} },
    progress: { qualifiedWins: 1, bountyRuns: 0, bestRunKills: 4, winsByFaction: {}, winsByWeapon: {} },
  }),
  // Twenty-four runs played: the next one makes 25.
  seedRecord("mVeteran24", { stats: { runs: 24, wins: 0, draws: 0, deaths: 24, kills: 0 } }),
];

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let stopped = false;
let port = 0;
let dir = "";
let profileFile = "";
let client: Client;
let testStart = 0;
const restoreConsole: Array<() => void> = [];

beforeAll(async () => {
  // The SDK prints this on every connection the server closes on purpose, which is most of what these tests do.
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("Room connection was closed unexpectedly")) return;
      original(...args);
    };
    restoreConsole.push(() => { console[method] = original; });
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-meta-"));
  profileFile = path.join(dir, "data", "stash.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  fs.writeFileSync(
    profileFile,
    JSON.stringify({ version: 2, profiles: Object.fromEntries(SEEDS.map((r) => [r.name, r])) }),
  );
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }),
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120, // a lone player must stay in the lobby for as long as a test needs
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
    for (const restore of restoreConsole) restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  testStart = Date.now();
});

// ---------------------------------------------------------------- HTTP helpers
const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function api(name: string, token?: string) {
  const res = await fetch(url(`/api/profile/${name}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } });
  return { res, status: res.status, body: (await res.json()) as any };
}

let counter = 0;

/** A brand new profile, claimed over HTTP the way the menu does it. */
async function claim(): Promise<Account> {
  const name = `mp${++counter}`;
  const { status, body } = await api(name);
  expect(status).toBe(200);
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

async function equipOverHttp(who: Account, slot: string, id: string | null): Promise<number> {
  const res = await fetch(url(`/api/profile/${who.name}/equip`), {
    method: "POST",
    headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: who.token },
    body: JSON.stringify({ slot, id }),
  });
  return res.status;
}

const record = (who: Account) => server.store.get(who.name)!;
const isActive = (who: Account) => server.profiles.isActive(who.name);

// ---------------------------------------------------------------- room helpers
interface Player {
  who: Account;
  room: ClientRoom;
  results: RunResult[];
  left: boolean;
}

const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, results: [], left: false };
  room.onMessage("result", (r: RunResult) => p.results.push(r));
  room.onMessage("toast", () => {});
  room.onMessage("fxs", () => {});
  room.onLeave(() => { p.left = true; });
  players.push(p);
  return p;
}

const joinOptions = (who: Account): JoinOptions => ({ profile: who.name, token: who.token });

type Timers = Partial<Pick<SimConfig, "minPlayers" | "patienceSeconds" | "patienceMinSeconds" | "suddenDeathSeconds">>;

/** Opens a brand new room (never someone else's lobby) with `who` in it. */
async function createRoom(who: Account, timers?: Timers): Promise<Player> {
  const p = track(who, await client.create<RaidState>(ROOM_NAME, joinOptions(who)));
  if (timers) worldOf(p).config = { ...worldOf(p).config, ...timers };
  return p;
}

async function joinRoom(into: Player, who: Account): Promise<Player> {
  return track(who, await client.joinById<RaidState>(into.room.roomId, joinOptions(who)));
}

interface ServerRoomView {
  world: World;
  clients: { getById(id: string): { ref: { terminate(): void } } | undefined };
  /** Private to the Room; peeked at to compare what a reconnecting client is sent with what was banked. */
  pendingResults: Map<string, RunResult>;
}

const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const sessionOf = (p: Player) => p.room.sessionId;
const serverPlayer = (p: Player) => worldOf(p).state.players.get(sessionOf(p))!;

/** The look word `viewer`'s client has for `of` (undefined until the player has synced). */
const seenLook = (viewer: Player, of: Player): number | undefined => viewer.room.state.players.get(sessionOf(of))?.look;

/** What a look word shows, as ids. */
function shows(word: number) {
  const look = unpackLook(word);
  return {
    skin: look.skin?.id, outline: look.outline?.id, trail: look.trail?.id, title: look.title?.id, gold: look.gold.map((g) => g.id),
  };
}

async function leave(p: Player): Promise<void> {
  if (p.left) return;
  await p.room.leave(true);
  await until(() => p.left, "client to report the leave");
}

/** Waits until the run is on, for the server and for every client. */
async function untilActive(all: Player[]): Promise<void> {
  await until(
    () => worldOf(all[0]!).state.phase === "active" && all.every((p) => serverPlayer(p).status === "alive"),
    "the run to start",
  );
  await until(() => all.every((p) => p.room.state.phase === "active"), "clients to see the run start");
}

/** Everyone in one room, waited until the run is on and all of them are alive. Nothing happens in it by itself. */
async function startRun(accounts: Account[]): Promise<Player[]> {
  const [first, ...rest] = accounts;
  const lead = await createRoom(first!, { minPlayers: accounts.length });
  const all = [lead];
  for (const who of rest) all.push(await joinRoom(lead, who));
  await untilActive(all);
  return all;
}

/** Moves a player on the server only: a dropped client never sees where it was put. */
function placeOnServer(p: Player, x: number, y: number): void {
  const world = worldOf(p);
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(sessionOf(p))!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
}

/** A spawn point nobody else is near, so a duel there cannot hit a bystander. */
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
 * Puts `attacker` next to `victim` (due east of them), away from everyone else, and has the attacker strike the way a
 * client does, with inputs only, until `done()`: an `attack` press toward the victim and its `release`. That is one
 * swing, one cast or one arrow at the minimum draw, whatever the attacker holds, and a tap the cooldown swallowed is
 * simply repeated.
 */
async function strikeAt(attacker: Player, victim: Player, done: () => boolean): Promise<void> {
  const at = duelSpot(worldOf(attacker), [sessionOf(attacker), sessionOf(victim)]);
  placeOnServer(victim, at.x + 12, at.y);
  placeOnServer(attacker, at.x - 12, at.y);
  await sleep(120); // a tick or two, so the lag-compensation history holds the new spots
  const a = Math.atan2(0, 24);
  const deadline = Date.now() + 10_000;
  while (!done() && Date.now() < deadline) {
    attacker.room.send("attack", { a });
    attacker.room.send("release", { a });
    const settle = Date.now() + 300; // a windup, and the flight of whatever it looses
    while (!done() && Date.now() < settle) await sleep(20);
  }
  expect(done(), "the duel to reach its goal").toBe(true);
}

/** Small enough for any hit that gets through armor and shield to be lethal, whoever lands it. */
const DOOMED_HP = 0.01;

/** `killer` takes `victim` down. The victim is brought to DOOMED_HP first, so a single hit settles it. */
async function kill(killer: Player, victim: Player): Promise<void> {
  serverPlayer(victim).hp = DOOMED_HP;
  await strikeAt(killer, victim, () => serverPlayer(victim).status !== "alive");
  expect(serverPlayer(victim).status).toBe("dead");
}

/**
 * `attacker` damages `victim` without killing them: the damage counts toward the win bonus gate, and nothing else. One
 * hit is a fraction of the smallest faction's hp, so a victim at full health always survives it.
 */
async function hurt(attacker: Player, victim: Player): Promise<void> {
  await strikeAt(attacker, victim, () => serverPlayer(victim).hp < serverPlayer(victim).maxHp);
  expect(serverPlayer(victim).status).toBe("alive");
}

/**
 * Pushes the last hit on each of `victims` back past KILL_CREDIT_SECONDS, as if it had landed long ago. Otherwise a victim
 * who walks out soon after being hurt is the attacker's kill (leave credit), and these tests want a win with no kill.
 */
function hitsLongAgo(world: World, victims: Player[]): void {
  for (const v of victims) {
    const rt = world.players.get(sessionOf(v))!;
    expect(rt.lastHit, "the victim was hit").not.toBeNull();
    rt.lastHit = { ...rt.lastHit!, at: rt.lastHit!.at - (KILL_CREDIT_SECONDS + 1) * 1000 };
  }
}

/** The weapon a player holds in hand: the slot the Room reads when it banks their run. */
function inHand(p: Player): string {
  const s = serverPlayer(p);
  return s.slot === 1 ? s.weapon1 : s.weapon0;
}

/** What the first player into a room is given by the server's round-robin default: the weapon of `defaultFaction(0)`. */
const FIRST_JOINER_WEAPON = SIGNATURE_WEAPONS[defaultFaction(0)];

/** A winner's result and the weapon they held when the run was decided. */
interface Win { result: RunResult; weapon: string }

/**
 * The winner's result once it is out, then the winner leaves and the profile is free to queue again. `weapon` is what
 * the winner held, read by the caller while the run was still on.
 */
async function finish(winner: Player, accounts: Account[], weapon: string): Promise<Win> {
  await until(() => winner.results.length === 1, "the winner's result");
  const result = winner.results[0]!;
  await leave(winner);
  await until(() => accounts.every((who) => !isActive(who)), "the profiles to be released");
  return { result, weapon };
}

/**
 * A two-player run won by a walkover: `loser` walks out, so `winner` is the last one standing without a single kill.
 * The run started with fewer than WIN_BONUS_MIN_PLAYERS, so the win is not qualified: it counts in stats and nothing else.
 * The winner joins first, so they hold the first joiner's weapon.
 */
async function walkover(winner: Account): Promise<Win> {
  const other = await claim();
  const [w, l] = await startRun([winner, other]);
  const weapon = inHand(w!);
  expect(weapon).toBe(FIRST_JOINER_WEAPON);
  await leave(l!);
  return finish(w!, [winner, other], weapon);
}

/**
 * A contested win with no kill: three players start, the winner hurts both others, and both walk out (their hits are
 * old news by then). The win passes the bonus gate, so it is a qualified win. The winner joins first, so they hold the
 * first joiner's weapon.
 */
async function contestedWalkover(winner: Account): Promise<Win> {
  const [x, y] = [await claim(), await claim()];
  const [w, px, py] = await startRun([winner, x, y]);
  const weapon = inHand(w!);
  expect(weapon).toBe(FIRST_JOINER_WEAPON);
  await hurt(w!, px!);
  await hurt(w!, py!);
  hitsLongAgo(worldOf(w!), [px!, py!]);
  await leave(px!);
  await leave(py!);
  return finish(w!, [winner, x, y], weapon);
}

/** Shrinks the SDK's reconnect delay to `ms`, so a test can change the world while the player is away. */
function reconnectAfter(p: Player, ms: number): { reconnected: () => boolean } {
  p.room.reconnection.minUptime = 0;
  p.room.reconnection.delay = 1;
  p.room.reconnection.minDelay = ms;
  let reconnected = false;
  p.room.onReconnect(() => { reconnected = true; });
  return { reconnected: () => reconnected };
}

/** Cuts the player's socket from the server side, as a dropped connection would, and waits until the room noticed. */
async function dropConnection(p: Player): Promise<void> {
  const sid = sessionOf(p);
  const room = serverRoom(p);
  room.clients.getById(sid)!.ref.terminate();
  await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
}

afterEach(async () => {
  for (const p of players.splice(0)) {
    try { await leave(p); } catch { /* connection already gone */ }
  }
  // Every test must end with no profile held: a leak here would lock a player out for good.
  await until(() => server.profiles.size === 0, "all profiles to be released", 5000);
  vi.restoreAllMocks();
});

// ================================================================= tests

describe("the look word", () => {
  it("equipped cosmetics reach the server's state and every client, in the lobby and when the run starts", async () => {
    const F = seedAccount("mFullLook");
    const O = await claim();
    const C = await claim();
    const seeded = record(F);
    expect(Object.keys(seeded.cosmetics.equipped).sort()).toEqual(Object.keys(FULL_EQUIPPED).sort());
    const expected = packLook(seeded.cosmetics.equipped, seeded.cosmetics.owned);
    expect(expected).toBeGreaterThan(0);

    const f = await createRoom(F, { minPlayers: 3 });
    const o = await joinRoom(f, O);
    expect(serverPlayer(f).look).toBe(expected);
    expect(serverPlayer(o).look).toBe(0);
    await until(
      () => [f, o].every((p) => seenLook(p, f) === expected && seenLook(p, o) === 0),
      "both clients to see both looks",
    );
    // What the word means: each equipped item, golden variants in catalog order.
    expect(shows(expected)).toEqual({
      skin: "skin-crimson", outline: "outline-white", trail: "trail-ember", title: "title-rookie", gold: ["gilded-fire", "gilded-axe"],
    });

    // A player who joins later sees the ones already there; the run starting changes nothing.
    const c = await joinRoom(f, C);
    await untilActive([f, o, c]);
    await until(() => [f, o, c].every((p) => seenLook(p, f) === expected && seenLook(p, o) === 0 && seenLook(p, c) === 0), "the looks after the start");
    expect(serverPlayer(f).look).toBe(expected);
    expect(serverPlayer(o).look).toBe(0);
  });

  describe("an equipped item that should not show is left out of the look", () => {
    interface Case { label: string; name: string; shown: ReturnType<typeof shows> | null }
    const cases: Case[] = [
      { label: "one the profile does not own", name: "mNotOwned", shown: { skin: undefined, outline: undefined, trail: undefined, title: "title-rookie", gold: [] } },
      { label: "an id that is not in the catalog", name: "mUnknownId", shown: { skin: undefined, outline: "outline-white", trail: undefined, title: undefined, gold: [] } },
      { label: "an id in the wrong slot (and a slot that does not exist)", name: "mWrongSlot", shown: { skin: "skin-crimson", outline: undefined, trail: undefined, title: undefined, gold: ["gilded-axe"] } },
      { label: "everything equipped while owning nothing", name: "mNothingOwned", shown: null },
    ];

    it.each(cases)("$label", async ({ name, shown }) => {
      const who = seedAccount(name);
      const before = record(who);
      expect(Object.keys(before.cosmetics.equipped).length).toBeGreaterThan(0); // the file does say something is equipped
      const p = await createRoom(who, { minPlayers: 3 });
      const word = serverPlayer(p).look;
      if (shown === null) expect(word).toBe(0);
      else expect(shows(word)).toEqual(shown);
      await until(() => seenLook(p, p) === word, "the client to see its look");
      expect(record(who)).toEqual(before); // joining reads the profile; it never repairs it
    });
  });

  it("a player with nothing equipped has look 0, whether or not they own anything", async () => {
    const bare = seedAccount("mBare");
    const fresh = await claim();
    expect(record(bare).cosmetics.owned.length).toBeGreaterThan(0);
    const pb = await createRoom(bare, { minPlayers: 3 });
    const pf = await joinRoom(pb, fresh);
    expect(serverPlayer(pb).look).toBe(0);
    expect(serverPlayer(pf).look).toBe(0);
    await until(() => seenLook(pf, pb) === 0 && seenLook(pb, pf) === 0 && seenLook(pf, pf) === 0, "the clients to sync");
  });

  it("equipping after joining changes nothing during that run; it applies to the next one", async () => {
    const S = seedAccount("mSwap");
    const X = await claim();
    const owned = record(S).cosmetics.owned;
    const first = packLook({ skin: "skin-crimson" }, owned);
    expect(first).toBeGreaterThan(0);

    const [s, x] = await startRun([S, X]);
    expect(serverPlayer(s).look).toBe(first);

    // Through the API and through the store, a new slot and a different item: the wardrobe accepts them all.
    expect(await equipOverHttp(S, "skin", "skin-amber")).toBe(200);
    expect(server.store.equip(S.name, S.token, "title", "title-rookie").ok).toBe(true);
    expect(record(S).cosmetics.equipped).toEqual({ skin: "skin-amber", title: "title-rookie" });
    await sleep(200); // several ticks and patches
    expect(serverPlayer(s).look).toBe(first);
    expect(seenLook(s, s)).toBe(first);
    expect(seenLook(x, s)).toBe(first);

    // The seat ends (MIA) and the profile queues again: the new wardrobe is the look now.
    await leave(s);
    await until(() => !isActive(S), "the profile to be released");
    const next = packLook({ skin: "skin-amber", title: "title-rookie" }, owned);
    expect(next).not.toBe(first);
    const again = await createRoom(S, { minPlayers: 3 });
    expect(serverPlayer(again).look).toBe(next);
    expect(shows(next)).toMatchObject({ skin: "skin-amber", title: "title-rookie" });
    await until(() => seenLook(again, again) === next, "the client to see the new look");
  });
});

describe("a look is cosmetic only", () => {
  // The server hands out factions round-robin by join order, and a faction fixes hp and weapon. So the players compared
  // here are always the first joiner of a room of their own (or of a world of their own): the same faction, one wearing
  // a full look and one wearing nothing.
  /** Everything the sim and the schema keep about a player except what a look (or a spawn point) legitimately differs in. */
  function stateOf(p: Player): Record<string, unknown> {
    const json = (serverPlayer(p) as unknown as { toJSON(): Record<string, unknown> }).toJSON();
    for (const key of ["name", "look", "x", "y", "facing"]) delete json[key];
    return json;
  }

  function runtimeOf(p: Player) {
    const rt = worldOf(p).players.get(sessionOf(p))!;
    return {
      keys: Object.keys(rt).sort(), weapon: rt.weapon, gv: rt.gv, mobKills: rt.mobKills, killedBy: rt.killedBy,
      droppedAt: rt.droppedAt, down: rt.down, resolved: rt.resolved, damaged: rt.damaged.size, hpFracAtTickStart: rt.hpFracAtTickStart,
    };
  }

  /** What a client sees of another player's fighter fields. */
  const seenFighter = (viewer: Player, of: Player) => {
    const s = viewer.room.state.players.get(sessionOf(of))!;
    return { hp: s.hp, maxHp: s.maxHp, status: s.status, faction: s.faction, weapon0: s.weapon0, weapon1: s.weapon1, slot: s.slot };
  };

  it("a player with a full look and one without start with the same faction, hp, weapons and sim state", async () => {
    const F = seedAccount("mFullPair");
    const O = await claim();
    const [C1, C2, D1, D2] = [await claim(), await claim(), await claim(), await claim()];
    // Two rooms, each with its subject as the first joiner (so the same faction) and two others to make the run start.
    const f = await createRoom(F, { minPlayers: 3 });
    const o = await createRoom(O, { minPlayers: 3 });

    const same = (phase: string) => {
      expect(serverPlayer(f).look, `${phase}: F wears a look`).toBeGreaterThan(0);
      expect(serverPlayer(o).look, `${phase}: O does not`).toBe(0);
      const [sf, so] = [stateOf(f), stateOf(o)];
      expect(Object.keys(sf), `${phase}: the fields compared`).toEqual(
        expect.arrayContaining(["hp", "maxHp", "status", "faction", "weapon0", "weapon1", "slot", "drawStartedAt", "readyAt", "kills", "gv", "bounty", "immuneUntil"]),
      );
      expect(sf, phase).toEqual(so);
      expect(sf.faction, `${phase}: the first joiner's faction`).toBe(defaultFaction(0));
      expect(sf.weapon0, `${phase}: and its weapon`).toBe(FIRST_JOINER_WEAPON);
      expect(runtimeOf(f), `${phase}: runtime`).toEqual(runtimeOf(o));
    };
    same("in the lobby");

    const [c1, c2] = [await joinRoom(f, C1), await joinRoom(f, C2)];
    const [d1, d2] = [await joinRoom(o, D1), await joinRoom(o, D2)];
    await untilActive([f, c1, c2]);
    await untilActive([o, d1, d2]);
    same("when the run starts");
    expect(serverPlayer(f).hp).toBe(serverPlayer(f).maxHp);

    // And what the other clients receive agrees.
    await until(() => seenLook(c1, f) !== 0 && seenLook(c1, f) !== undefined && seenLook(d1, o) === 0, "the clients to sync");
    expect(seenFighter(c1, f)).toEqual(seenFighter(d1, o));
    expect(seenFighter(c2, f)).toEqual(seenFighter(d2, o));
  });

  it("walks the same path at the same speed with a look as without (headless sim)", () => {
    const config: SimConfig = {
      minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60,
    };
    const seeded = seedRecord("x", { cosmetics: { owned: [...FULL_OWNED], equipped: { ...FULL_EQUIPPED } } });
    const full = packLook(seeded.cosmetics.equipped, seeded.cosmetics.owned);
    // Two identical worlds (same map, same shuffle) that differ only in what alice, the first joiner, wears.
    const build = (look: number) => {
      const world = createGameWorld({ seed: 4242, config, random: mulberry32(4243) });
      const alice = addPlayer(world, "a", "alice", { look });
      addPlayer(world, "b", "bobby");
      return { world, alice };
    };
    const { world: wearingWorld, alice: wearing } = build(full);
    const { world: bareWorld, alice: bare } = build(0);
    expect(wearing.look).toBeGreaterThan(0);
    expect(bare.look).toBe(0);
    for (const world of [wearingWorld, bareWorld]) {
      step(world, TICK_MS); // the lobby becomes the run
      expect(world.state.phase).toBe("active");
    }
    expect([wearing.faction, wearing.hp, wearing.maxHp, wearing.weapon0, wearing.weapon1, wearing.slot])
      .toEqual([bare.faction, bare.hp, bare.maxHp, bare.weapon0, bare.weapon1, bare.slot]);

    // Both alices start on the same spot and are sent to the same target.
    const from = wearingWorld.map.groundSpots[0]!;
    const to = wearingWorld.map.groundSpots[1]!;
    for (const [world, p] of [[wearingWorld, wearing], [bareWorld, bare]] as const) {
      p.x = from.x;
      p.y = from.y;
      const rt = world.players.get("a")!;
      rt.path = [];
      rt.history = [];
      expect(enqueueClientMessage(rt.inputs, "move", to)).toBe(true);
    }
    for (let i = 0; i < 20; i++) {
      step(wearingWorld, TICK_MS);
      step(bareWorld, TICK_MS);
    }
    expect(Math.hypot(wearing.x - from.x, wearing.y - from.y)).toBeGreaterThan(0);
    expect([wearing.x, wearing.y]).toEqual([bare.x, bare.y]);
    // Nothing else in the sim differs either: every player, field by field, but the look.
    for (const id of ["a", "b"]) {
      const [w, b] = [wearingWorld, bareWorld].map((world) => {
        const json = (world.state.players.get(id) as unknown as { toJSON(): Record<string, unknown> }).toJSON();
        delete json.look;
        return json;
      });
      expect(w, id).toEqual(b);
    }
    expect(wearing.look).toBe(full); // and the look is still what it was
  });
});

describe("achievements through a run", () => {
  it("a faction picked in the hub is recorded with the win (counts toward its titles); B and C didn't pick", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const lead = track(A, await client.create<RaidState>(ROOM_NAME, { ...joinOptions(A), faction: "frost" }));
    worldOf(lead).config = { ...worldOf(lead).config, minPlayers: 3 };
    const all = [lead, await joinRoom(lead, B), await joinRoom(lead, C)];
    await untilActive(all);
    const [a, b, c] = all;
    expect(serverPlayer(a!).faction).toBe("frost");
    const recorded = vi.spyOn(server.store, "recordRun");
    await hurt(a!, b!);
    await hurt(a!, c!);
    hitsLongAgo(worldOf(a!), [b!, c!]);
    await leave(b!);
    await leave(c!);
    await until(() => a!.results.length === 1, "A's result");
    expect(recorded.mock.calls.find(([name]) => name === A.name)![1]).toMatchObject({ outcome: "won", faction: "frost" });
    expect(record(A).progress.winsByFaction).toEqual({ frost: 1 });
    for (const who of [B, C]) {
      const call = recorded.mock.calls.find(([name]) => name === who.name);
      if (call) expect(call[1]).not.toHaveProperty("faction");
    }
  });

  it("the last one standing in a contested run unlocks First Win and its rewards; the players who walked out do not", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const recorded = vi.spyOn(server.store, "recordRun");
    expect(record(A).achievements).toEqual({});
    expect(record(A).cosmetics.owned).toEqual([]);
    const weapon = inHand(a!);
    expect(weapon).toBe(FIRST_JOINER_WEAPON);

    // A hurts both of the others (the gate) without a kill, and they walk out.
    await hurt(a!, b!);
    await hurt(a!, c!);
    hitsLongAgo(worldOf(a!), [b!, c!]);
    await leave(b!);
    await leave(c!);
    await until(() => a!.results.length === 1, "A's result");
    const result = a!.results[0]!;
    expect(result).toMatchObject({ outcome: "won", profile: A.name, kills: 0, players: 3, winBonusWithheld: false });
    expect(result.achievements).toEqual(["first_win"]); // no kill happened, so no First Blood

    const after = record(A);
    expect(Object.keys(after.achievements)).toEqual(["first_win"]);
    expect(after.achievements.first_win).toBeGreaterThanOrEqual(testStart);
    expect(after.achievements.first_win).toBeLessThanOrEqual(Date.now());
    expect(after.cosmetics.owned).toEqual(["title-victor", "skin-laurel"]);
    expect(after.stats).toMatchObject({ runs: 1, wins: 1, kills: 0 });
    expect(after.progress.qualifiedWins).toBe(1);
    const over = (await api(A.name, A.token)).body.profile;
    expect(over.achievements).toEqual(after.achievements);
    expect(over.cosmetics.owned).toEqual(["title-victor", "skin-laurel"]);
    expect(over.progress.qualifiedWins).toBe(1);

    // The winner's run was banked as a qualified win, the room having read that off the result, with the weapon in hand.
    const wins = recorded.mock.calls.find(([name]) => name === A.name)![1];
    expect(wins).toMatchObject({ outcome: "won", kills: 0, winQualified: true, weapon });
    expect(wins).not.toHaveProperty("faction"); // nobody picked one: the round-robin default is not recorded
    expect(after.progress.winsByWeapon).toEqual({ [weapon]: 1 });
    expect(after.progress.winsByFaction).toEqual({});

    // The leavers are MIA: nothing unlocked for them, and nothing granted. (They are gone, so the store is where to look.)
    await until(() => !isActive(B) && !isActive(C), "the leavers' profiles to be released");
    for (const who of [B, C]) {
      const at = recorded.mock.calls.findIndex(([name]) => name === who.name);
      expect(at, who.name).toBeGreaterThanOrEqual(0);
      expect(recorded.mock.calls[at]![1]).toMatchObject({ outcome: "mia", kills: 0, winQualified: false });
      expect(recorded.mock.results[at]).toMatchObject({ type: "return", value: { unlocked: [] } });
      expect(record(who).achievements).toEqual({});
      expect(record(who).cosmetics.owned).toEqual([]);
      expect(record(who).stats).toMatchObject({ runs: 1, deaths: 1, wins: 0 });
      expect(record(who).progress.qualifiedWins).toBe(0);
      expect(record(who).progress.winsByWeapon).toEqual({});
      expect(record(who).progress.winsByFaction).toEqual({});
    }
  });

  it("a two-player walkover is a win in the stats and unlocks nothing: no ids in the result, no timestamp, no cosmetics", async () => {
    const A = await claim();
    const recorded = vi.spyOn(server.store, "recordRun");
    const { result, weapon } = await walkover(A);
    expect(result).toMatchObject({ outcome: "won", profile: A.name, kills: 0, players: 2, winBonusWithheld: true });
    expect("achievements" in result).toBe(false);

    const after = record(A);
    expect(after.stats).toMatchObject({ runs: 1, wins: 1, kills: 0 }); // the win still counts here
    expect(after.achievements).toEqual({});
    expect(after.cosmetics.owned).toEqual([]);
    expect(after.progress).toEqual({ qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} });
    const wins = recorded.mock.calls.find(([name]) => name === A.name)!;
    expect(wins[1]).toMatchObject({ outcome: "won", winQualified: false, weapon }); // the weapon is handed over; it counts for nothing
    expect(recorded.mock.results[recorded.mock.calls.indexOf(wins)]).toMatchObject({ type: "return", value: { unlocked: [] } });

    // What the API serves agrees.
    const over = (await api(A.name, A.token)).body.profile;
    expect(over.stats.wins).toBe(1);
    expect(over.achievements).toEqual({});
    expect(over.cosmetics.owned).toEqual([]);
    expect(over.progress.qualifiedWins).toBe(0);
  });

  it("a three-player win over only one of the others is not qualified either: the kill still counts, the win does not", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const recorded = vi.spyOn(server.store, "recordRun");
    await kill(a!, b!);
    await leave(c!); // never touched: leaving is not damage
    await until(() => a!.results.length === 1, "A's result");
    expect(a!.results[0]).toMatchObject({ outcome: "won", profile: A.name, kills: 1, players: 3, winBonusWithheld: true });
    expect(recorded.mock.calls.find(([name]) => name === A.name)![1]).toMatchObject({ outcome: "won", winQualified: false, weapon: FIRST_JOINER_WEAPON });
    expect(a!.results[0]!.achievements).toEqual(["first_blood"]); // First Win is not among them

    const after = record(A);
    expect(Object.keys(after.achievements)).toEqual(["first_blood"]);
    expect(after.cosmetics.owned).toEqual(["title-bloodied"]);
    expect(after.stats).toMatchObject({ runs: 1, wins: 1, kills: 1 });
    expect(after.progress.qualifiedWins).toBe(0);
    expect(after.progress.winsByWeapon).toEqual({}); // not qualified, so no weapon win either
    await leave(a!);
    await until(() => !isActive(A), "A's profile to be released");
  });

  it("a second contested win does not unlock First Win again: no ids in the result, the timestamp and the owned list stay as they were", async () => {
    const A = await claim();
    const { result: first } = await contestedWalkover(A);
    expect(first.achievements).toEqual(["first_win"]);
    const stamp = record(A).achievements.first_win!;
    const ownedAfterFirst = record(A).cosmetics.owned;
    expect(stamp).toBeGreaterThanOrEqual(testStart);

    await sleep(20); // a re-stamp would show as a later time
    const { result: second } = await contestedWalkover(A);
    expect(second).toMatchObject({ outcome: "won", profile: A.name, players: 3, winBonusWithheld: false });
    expect("achievements" in second).toBe(false);

    const after = record(A);
    expect(after.stats).toMatchObject({ runs: 2, wins: 2 });
    expect(after.progress.qualifiedWins).toBe(2); // counted, but the goal was already met
    expect(after.progress.winsByWeapon).toEqual({ [FIRST_JOINER_WEAPON]: 2 }); // one per qualified win, no more
    expect(after.achievements).toEqual({ first_win: stamp });
    expect(after.cosmetics.owned).toEqual(ownedAfterFirst);
    expect(new Set(after.cosmetics.owned).size).toBe(after.cosmetics.owned.length);
    expect(after.cosmetics.owned.filter((id) => id === "title-victor")).toHaveLength(1);
  });

  it("a walkover win followed by a contested win: First Win unlocks on the contested one only, and both count in stats.wins", async () => {
    const A = await claim();
    const { result: first } = await walkover(A);
    expect(first).toMatchObject({ outcome: "won", winBonusWithheld: true });
    expect("achievements" in first).toBe(false);
    expect(record(A).stats).toMatchObject({ runs: 1, wins: 1 });
    expect(record(A).achievements).toEqual({});
    expect(record(A).cosmetics.owned).toEqual([]);
    expect(record(A).progress.qualifiedWins).toBe(0);
    expect(record(A).progress.winsByWeapon).toEqual({});

    const { result: second } = await contestedWalkover(A);
    expect(second).toMatchObject({ outcome: "won", profile: A.name, players: 3, winBonusWithheld: false });
    expect(second.achievements).toEqual(["first_win"]);

    const after = record(A);
    expect(after.stats).toMatchObject({ runs: 2, wins: 2 });
    expect(after.progress.qualifiedWins).toBe(1);
    expect(after.progress.winsByWeapon).toEqual({ [FIRST_JOINER_WEAPON]: 1 }); // the walkover's weapon was not counted
    expect(Object.keys(after.achievements)).toEqual(["first_win"]);
    expect(after.cosmetics.owned).toEqual(["title-victor", "skin-laurel"]);
    const over = (await api(A.name, A.token)).body.profile;
    expect(over.stats.wins).toBe(2);
    expect(over.progress.qualifiedWins).toBe(1);
    expect(over.achievements).toEqual(after.achievements);
  });

  it("a contested win with kills unlocks both goals in catalog order; the players who died get no achievements", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const weapon = inHand(a!);
    await kill(a!, b!);
    await kill(a!, c!);
    await until(() => a!.results.length === 1 && b!.results.length === 1 && c!.results.length === 1, "all results");

    expect(a!.results[0]).toMatchObject({ outcome: "won", kills: 2, players: 3, winBonusWithheld: false });
    const ids = a!.results[0]!.achievements!;
    expect(ids).toEqual(["first_blood", "first_win"]);
    const catalogOrder = ACHIEVEMENTS.map((x) => x.id);
    expect(ids).toEqual(catalogOrder.filter((id) => ids.includes(id)));
    expect(Object.keys(record(A).achievements).sort()).toEqual(["first_blood", "first_win"]);
    expect(record(A).cosmetics.owned).toEqual(["title-bloodied", "title-victor", "skin-laurel"]); // rewards in the same order
    expect(record(A).progress).toMatchObject({ qualifiedWins: 1, bestRunKills: 2, winsByWeapon: { [weapon]: 1 }, winsByFaction: {} });

    for (const [p, who] of [[b!, B], [c!, C]] as const) {
      expect(p.results[0], who.name).toMatchObject({ outcome: "died", killedBy: A.name });
      expect("achievements" in p.results[0]!, who.name).toBe(false);
      expect(record(who).achievements).toEqual({});
      expect(record(who).cosmetics.owned).toEqual([]);
      expect(record(who).stats).toMatchObject({ runs: 1, deaths: 1 });
      expect(record(who).progress.qualifiedWins).toBe(0);
      expect(record(who).progress.winsByWeapon).toEqual({}); // a loss adds nothing, whatever they held
      expect(record(who).progress.winsByFaction).toEqual({});
    }
  });

  it("a result held for a dropped player carries the same achievements when it is re-sent after the reconnect", async () => {
    const A = seedAccount("mVeteran24"); // their 25th run is a Veteran
    const [B, C] = [await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const back = reconnectAfter(a!, 3000);
    const sid = sessionOf(a!);
    const room = serverRoom(a!);
    const weaponB = inHand(b!); // the second joiner: not the first joiner's weapon

    await dropConnection(a!);
    await kill(b!, c!);
    await kill(b!, a!); // B wins having hurt both others, A dies while away
    await until(() => room.pendingResults.has(sid), "A's death to settle");
    expect(back.reconnected()).toBe(false);
    expect(a!.results).toEqual([]); // the client is not there to hear it
    const held = room.pendingResults.get(sid)!;
    expect(held).toMatchObject({ outcome: "died", profile: A.name, killedBy: B.name });
    expect(held.achievements).toEqual(["veteran"]);
    expect(record(A).achievements.veteran).toBeGreaterThanOrEqual(testStart);
    expect(record(A).cosmetics.owned).toEqual(["title-veteran", "skin-ghost"]);
    await until(() => b!.results.length === 1, "B's result");
    expect(b!.results[0]).toMatchObject({ outcome: "won", winBonusWithheld: false });
    expect(b!.results[0]!.achievements).toEqual(["first_blood", "first_win"]);
    expect(weaponB).toBe(SIGNATURE_WEAPONS[defaultFaction(1)]);
    expect(record(B).progress.winsByWeapon).toEqual({ [weaponB]: 1 });

    await until(back.reconnected, "the SDK to reconnect", 8000);
    await until(() => a!.results.length === 1, "the held result to arrive after reconnecting");
    expect(a!.results[0]).toEqual(held);
    expect(a!.results[0]!.achievements).toEqual(["veteran"]);
    await sleep(200);
    expect(a!.results).toHaveLength(1); // delivered once
    expect(Object.keys(record(A).achievements)).toEqual(["veteran"]); // and unlocked once
  });
});

describe("the weapon a win is counted for", () => {
  // The Room hands the store the weapon in hand when the run ends, and a faction only when the player picked one (these
  // clients join without, so none is recorded: a round-robin default must not count toward faction titles). Only a
  // qualified win counts, so winsByWeapon moves on a contested win and nowhere else.
  it("a contested win counts one win for the weapon in hand and none for the faction", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b, c] = await startRun([A, B, C]);
    const recorded = vi.spyOn(server.store, "recordRun");
    const s = serverPlayer(a!);
    expect([s.slot, s.weapon1]).toEqual([0, ""]);
    const weapon = inHand(a!);
    expect(weapon).toBe(s.weapon0);

    await hurt(a!, b!);
    await hurt(a!, c!);
    hitsLongAgo(worldOf(a!), [b!, c!]);
    await leave(b!);
    await leave(c!);
    await until(() => a!.results.length === 1, "A's result");
    expect(a!.results[0]).toMatchObject({ outcome: "won", winBonusWithheld: false });

    const calls = recorded.mock.calls.filter(([name]) => name === A.name);
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toEqual({ outcome: "won", kills: 0, gv: expect.any(Number), bounty: 0, weapon, winQualified: true });
    expect(record(A).progress.winsByWeapon).toEqual({ [weapon]: 1 });
    expect(record(A).progress.winsByFaction).toEqual({});
    expect((await api(A.name, A.token)).body.profile.progress).toMatchObject({ winsByWeapon: { [weapon]: 1 }, winsByFaction: {} });
  });

  it("it is the weapon in the slot in hand at the end, not the one the run started with", async () => {
    const [X, W, Y] = [await claim(), await claim(), await claim()];
    const [x, w, y] = await startRun([X, W, Y]);
    const recorded = vi.spyOn(server.store, "recordRun");
    const started = inHand(w!);
    expect(started).toBe(SIGNATURE_WEAPONS[defaultFaction(1)]); // the second joiner's own: not the first joiner's

    // A second weapon in the other slot, swapped to the way a client does it (the pickup itself is room.test's business).
    serverPlayer(w!).weapon1 = "sword";
    w!.room.send("swap", { slot: 1 });
    await until(() => w!.room.state.players.get(sessionOf(w!))?.slot === 1, "the swap to reach the client");
    expect(inHand(w!)).toBe("sword");
    expect(started).not.toBe("sword");

    await hurt(w!, x!);
    await hurt(w!, y!);
    hitsLongAgo(worldOf(w!), [x!, y!]);
    await leave(x!);
    await leave(y!);
    await until(() => w!.results.length === 1, "W's result");
    expect(w!.results[0]).toMatchObject({ outcome: "won", winBonusWithheld: false });
    expect(recorded.mock.calls.find(([name]) => name === W.name)![1]).toMatchObject({ outcome: "won", winQualified: true, weapon: "sword" });
    expect(record(W).progress.winsByWeapon).toEqual({ sword: 1 }); // the sword, and not the bow it started with
    expect(record(W).progress.winsByFaction).toEqual({});
  });

  it("a loss adds nothing to either counter", async () => {
    const [A, B, C] = [await claim(), await claim(), await claim()];
    const [a, b] = await startRun([A, B, C]);
    const recorded = vi.spyOn(server.store, "recordRun");

    await kill(a!, b!);
    await until(() => b!.results.length === 1, "B's result");
    expect(b!.results[0]).toMatchObject({ outcome: "died", killedBy: A.name });
    expect(recorded.mock.calls.find(([name]) => name === B.name)![1]).toMatchObject({ outcome: "died", winQualified: false });
    expect(record(B).progress.winsByWeapon).toEqual({});
    expect(record(B).progress.winsByFaction).toEqual({});
  });
});

describe("progress carried over from earlier runs", () => {
  it("the kill that makes ten unlocks Slayer and nothing already earned again", async () => {
    const A = seedAccount("mNineKills");
    const B = await claim();
    const [a, b] = await startRun([A, B]);
    expect(Object.keys(record(A).achievements).sort()).toEqual(["first_blood", "first_win"]);

    await kill(a!, b!);
    await until(() => a!.results.length === 1, "A's result");
    expect(a!.results[0]).toMatchObject({ outcome: "won", kills: 1 });
    expect(a!.results[0]!.achievements).toEqual(["slayer"]);

    const after = record(A);
    expect(after.stats).toMatchObject({ runs: 4, wins: 2, kills: 10 });
    expect(after.progress.winsByWeapon).toEqual({}); // a two-player win is not qualified
    expect(after.achievements.first_blood).toBe(LONG_AGO); // not stamped again
    expect(after.achievements.first_win).toBe(LONG_AGO);
    expect(after.achievements.slayer).toBeGreaterThanOrEqual(testStart);
    expect(Object.keys(after.achievements).sort()).toEqual(["first_blood", "first_win", "slayer"]);
    expect(after.cosmetics.owned).toEqual(["title-bloodied", "title-victor", "skin-laurel", "title-slayer"]);
  });

  it("a run that stays one kill short unlocks nothing and says nothing; its walkover win counts in stats.wins but not as a qualified one", async () => {
    const A = seedAccount("mNineKillsB");
    const { result } = await walkover(A);
    expect(result).toMatchObject({ outcome: "won", kills: 0 });
    expect("achievements" in result).toBe(false);
    const after = record(A);
    expect(after.stats).toMatchObject({ runs: 4, wins: 2, kills: 9 });
    expect(after.progress.qualifiedWins).toBe(1); // the seeded one; the walkover added none
    expect(after.progress.winsByWeapon).toEqual({});
    expect(Object.keys(after.achievements).sort()).toEqual(["first_blood", "first_win"]);
    expect(after.cosmetics.owned).toEqual(["title-bloodied", "title-victor", "skin-laurel"]);
  });
});

describe("a store that fails while banking", () => {
  it("still delivers every result, without achievements, and frees the profiles", async () => {
    const [A, B] = [await claim(), await claim()];
    const [a, b] = await startRun([A, B]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = [record(A), record(B)];
    const recorded = vi.spyOn(server.store, "recordRun").mockImplementation(() => { throw new Error("the disk is on fire"); });

    // A would have unlocked First Blood and First Win; the store is down instead.
    await kill(a!, b!);
    await until(() => a!.results.length === 1 && b!.results.length === 1, "both results");

    expect(a!.results[0]).toMatchObject({ outcome: "won", profile: A.name, kills: 1 });
    expect(b!.results[0]).toMatchObject({ outcome: "died", profile: B.name, killedBy: A.name });
    for (const p of [a!, b!]) expect("achievements" in p.results[0]!, p.who.name).toBe(false);
    expect(recorded.mock.calls.map(([name]) => name).sort()).toEqual([A.name, B.name].sort());
    for (const who of [A, B]) {
      expect(errors.mock.calls.some(([msg]) => typeof msg === "string" && msg.includes(`failed to persist the result of ${who.name}`)), who.name).toBe(true);
    }
    expect([record(A), record(B)]).toEqual(before); // nothing half-banked
    expect(isActive(A) || isActive(B)).toBe(false); // freed to queue again, though nothing was banked
    expect(worldOf(a!).state.winner).toBe(A.name); // and the run itself went on to its end

    // The next time the store works, the profile is as good as new.
    vi.restoreAllMocks();
    const next = await createRoom(A, { minPlayers: 3 });
    expect(serverPlayer(next).status).toBe("lobby");
  });
});
