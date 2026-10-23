// End to end over real sockets: the real server in this process on a free port, a temp stash file,
// short timers, and SDK clients. Every test uses its own freshly claimed profiles, so nothing leaks between them.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  INVENTORY_SLOTS, PROFILE_TOKEN_HEADER, RECONNECT_SECONDS, ROOM_NAME, STARTER_KIT,
  type ItemDTO, type JoinOptions, type ProfileResponse, type RaidResult,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { ActiveProfiles } from "../src/rooms/RaidRoom";
import { enqueueClientMessage } from "../src/sim/inputs";
import type { World } from "../src/sim/world";

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

// ---------------------------------------------------------------- server fixture
let server: RaidServer;
let stopped = false;
let port = 0;
let dir = "";
let stashFile = "";
let client: Client;
const restoreConsole: Array<() => void> = [];

beforeAll(async () => {
  // The SDK prints this on every join the server refuses, which is most of what these tests do.
  for (const method of ["error", "warn"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => {
      if (typeof args[0] === "string" && args[0].startsWith("Room connection was closed unexpectedly")) return;
      original(...args);
    };
    restoreConsole.push(() => { console[method] = original; });
  }
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-room-"));
  stashFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    port,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 120, // a lone player must stay in the lobby for as long as a test needs
    raidSeconds: 120,
    extractSeconds: 0.3,
    latencyMs: 0,
    stashFile,
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

// ---------------------------------------------------------------- HTTP helpers
const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function api(name: string, token?: string) {
  const res = await fetch(url(`/api/profile/${name}`), { headers: token === undefined ? {} : { [PROFILE_TOKEN_HEADER]: token } });
  return { res, status: res.status, text: await res.clone().text(), body: (await res.json()) as any };
}

let counter = 0;
interface Account { name: string; token: string; stash: ItemDTO[] }

/** A brand new profile, claimed over HTTP the way the menu does it. */
async function claim(): Promise<Account> {
  const name = `tp${++counter}`;
  const { status, body } = await api(name);
  expect(status).toBe(200);
  expect(body.created).toBe(true);
  return { name, token: body.token, stash: body.profile.stash };
}

const uidsOf = (items: ItemDTO[]) => items.map((i) => i.uid);
const sorted = (items: ItemDTO[]) => [...items].sort((a, b) => a.uid.localeCompare(b.uid));
const stashOf = (who: Account | string): ItemDTO[] => server.store.get(typeof who === "string" ? who : who.name)!.stash;
const statsOf = (who: Account) => server.store.get(who.name)!.stats;
const isActive = (who: Account) => server.profiles.isActive(who.name);

// ---------------------------------------------------------------- room helpers
interface Player {
  who: Account;
  room: ClientRoom;
  results: RaidResult[];
  toasts: string[];
  left: boolean;
}

const players: Player[] = [];

function track(who: Account, room: ClientRoom): Player {
  const p: Player = { who, room, results: [], toasts: [], left: false };
  room.onMessage("result", (r: RaidResult) => p.results.push(r));
  room.onMessage("toast", (m: { text: string }) => p.toasts.push(m.text));
  room.onMessage("fx", () => {});
  room.onLeave(() => { p.left = true; });
  players.push(p);
  return p;
}

const joinOptions = (who: Account, loadout: ItemDTO[] | string[] = []): JoinOptions => ({
  profile: who.name,
  token: who.token,
  loadout: loadout.map((i) => (typeof i === "string" ? i : i.uid)),
});

/** Opens a brand new room (never someone else's lobby) with `who` in it. */
async function createRoom(who: Account, loadout: ItemDTO[] | string[] = []): Promise<Player> {
  return track(who, await client.create<RaidState>(ROOM_NAME, joinOptions(who, loadout)));
}

async function joinRoom(into: Player, who: Account, loadout: ItemDTO[] | string[] = []): Promise<Player> {
  return track(who, await client.joinById<RaidState>(into.room.roomId, joinOptions(who, loadout)));
}

interface ServerRoomView {
  world: World;
  clients: { getById(id: string): { ref: { terminate(): void } } | undefined };
  /** Private to the Room; peeked at to prove nothing is kept for a session that is gone. */
  pendingResults: Map<string, RaidResult>;
}

const serverRoom = (p: Player) => matchMaker.getLocalRoomById(p.room.roomId) as unknown as ServerRoomView;
const worldOf = (p: Player) => serverRoom(p).world;
const sessionOf = (p: Player) => p.room.sessionId;
const serverPlayer = (p: Player) => worldOf(p).state.players.get(sessionOf(p))!;
const carried = (p: Player): ItemDTO[] => Array.from(serverPlayer(p).inventory, (i) => ({ uid: i.uid, def: i.def }));

/** What the client itself sees of its own inventory (the synced state, not the server's objects). */
const syncedInventory = (p: Player): ItemDTO[] =>
  Array.from(p.room.state.players.get(sessionOf(p))!.inventory, (i) => ({ uid: i.uid, def: i.def }));

async function leave(p: Player): Promise<void> {
  if (p.left) return;
  await p.room.leave(true);
  await until(() => p.left, "client to report the leave");
}

/** Two players in one room, waited until the raid is running and both are alive. */
async function startRaid(a: Account, aLoadout: ItemDTO[], b: Account, bLoadout: ItemDTO[]) {
  const pa = await createRoom(a, aLoadout);
  const pb = await joinRoom(pa, b, bLoadout);
  await until(
    () => worldOf(pa).state.phase === "active" && serverPlayer(pa).status === "alive" && serverPlayer(pb).status === "alive",
    "raid to start",
  );
  await until(() => pa.room.state.phase === "active" && pb.room.state.phase === "active", "clients to see the raid start");
  return { a: pa, b: pb, world: worldOf(pa) };
}

async function teleport(p: Player, x: number, y: number): Promise<void> {
  const world = worldOf(p);
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(sessionOf(p))!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
  await until(() => {
    const seen = p.room.state.players.get(sessionOf(p))!;
    return Math.abs(seen.x - x) < 0.5 && Math.abs(seen.y - y) < 0.5;
  }, "teleport to reach the client");
  await sleep(60); // one more tick so the lag-compensation history has the new spot
}

/** Shrinks core's reconnect hold (RECONNECT_SECONDS) to `ms` so a test can wait for it to run out. */
function shortenReconnectHold(ms: number): void {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, delay?: number, ...args: unknown[]) =>
    real(fn, delay === RECONNECT_SECONDS * 1000 ? ms : delay, ...args)) as unknown as typeof setTimeout);
}

/** Cuts the player's socket from the server side, as a dropped connection would, and waits until the room noticed. */
async function dropConnection(p: Player): Promise<void> {
  const sid = sessionOf(p);
  const room = serverRoom(p);
  room.clients.getById(sid)!.ref.terminate();
  await until(() => room.clients.getById(sid) === undefined, "the room to notice the drop");
}

/** Moves a player on the server only. (teleport() waits for the client to see it, which a dropped client never will.) */
function placeOnServer(p: Player, x: number, y: number): void {
  const world = worldOf(p);
  const sp = serverPlayer(p);
  sp.x = x;
  sp.y = y;
  const rt = world.players.get(sessionOf(p))!;
  rt.path = [];
  rt.history = [{ t: world.state.serverTime, x, y }];
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

describe("GET /api/profile/:name", () => {
  it("claims a free name: token, starter kit, zeroed stats, never cached", async () => {
    const { res, status, body } = await api("claim-me");
    expect(status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(["created", "profile", "token"]);
    expect(body.created).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f-]{36}$/);
    const profile = (body as ProfileResponse).profile;
    expect(profile.name).toBe("claim-me");
    expect(profile.stash.map((i) => i.def)).toEqual([...STARTER_KIT]);
    expect(profile.stats).toEqual({ raids: 0, extracts: 0, deaths: 0, kills: 0 });
    expect(Object.keys(profile).sort()).toEqual(["name", "stash", "stats"]);
  });

  it("returns the same profile to its owner", async () => {
    const first = await api("owner1");
    const again = await api("owner1", first.body.token);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.token).toBe(first.body.token);
    expect(again.body.profile).toEqual(first.body.profile);
  });

  it("answers 403 to anyone else, and never leaks a token", async () => {
    const victim = await api("victim1");
    const other = await api("other1");
    const secrets = [victim.body.token, other.body.token];
    for (const attempt of [undefined, "", "wrong", other.body.token]) {
      const r = await api("victim1", attempt);
      expect(r.status).toBe(403);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      for (const s of secrets) expect(r.text).not.toContain(s);
      expect(r.body.profile).toBeUndefined();
    }
  });

  it.each(["a", "x".repeat(17), "bad%20name", "a.b", "%E2%82%AC%E2%82%AC", "a%2Fb", "%00%00"])("answers 400 for the invalid name %s", async (name) => {
    const { status, body } = await api(name);
    expect(status).toBe(400);
    expect(body.profile).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it("a refused request changes nothing", async () => {
    const keeper = await api("keeper1");
    expect((await api("keeper1")).status).toBe(403);
    expect((await api("x")).status).toBe(400);
    expect(server.store.get("x")).toBeUndefined();
    expect((await api("keeper1", keeper.body.token)).body.profile).toEqual(keeper.body.profile);
  });

  it("ignores a token sent for a free name and issues a fresh one", async () => {
    const r = await api("fresh1", "stale-token-from-a-wiped-server");
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(true);
    expect(r.body.token).not.toBe("stale-token-from-a-wiped-server");
  });

  it("accepts names that clash with Object.prototype", async () => {
    const r = await api("__proto__");
    expect(r.status).toBe(200);
    expect(r.body.profile.name).toBe("__proto__");
    expect((await api("__proto__", r.body.token)).body.created).toBe(false);
    expect((await api("__proto__")).status).toBe(403);
  });

  it("keeps /api/health", async () => {
    const res = await fetch(url("/api/health"));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("claims reach the stash file", async () => {
    const who = await claim();
    await server.store.flush();
    const disk = JSON.parse(fs.readFileSync(stashFile, "utf8"));
    expect(disk.version).toBe(1);
    expect(disk.profiles[who.name].token).toBe(who.token);
    expect(disk.profiles[who.name].stash).toEqual(who.stash);
  });
});

describe("/api: method and CORS rules", () => {
  const ALLOW_HEADERS = `${PROFILE_TOKEN_HEADER}, content-type`;
  const foreign = { origin: "http://game.example.test" };

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE"])("%s on a profile is refused with 405 and claims nothing", async (method) => {
    const name = `m${method.toLowerCase()}${++counter}`;
    const res = await fetch(url(`/api/profile/${name}`), { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(server.store.get(name)).toBeUndefined(); // the name was not burned
    const mine = await api(name);
    expect(mine.status).toBe(200);
    expect(mine.body.created).toBe(true);
    expect(mine.body.token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a non-GET with the owner's token is refused too, and hands out no token", async () => {
    const who = await claim();
    for (const method of ["HEAD", "POST"]) {
      const res = await fetch(url(`/api/profile/${who.name}`), { method, headers: { [PROFILE_TOKEN_HEADER]: who.token } });
      expect(res.status).toBe(405);
      expect(await res.text()).not.toContain(who.token);
    }
  });

  it("an invalid name gets 405 for a non-GET as well: the method is judged first", async () => {
    expect((await fetch(url("/api/profile/x"), { method: "HEAD" })).status).toBe(405);
    expect((await fetch(url("/api/profile/x"))).status).toBe(400);
  });

  it("GET still works and is unchanged", async () => {
    const first = await api(`get${++counter}`);
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
  });

  it.each([
    ["a profile claim", () => fetch(url(`/api/profile/cors${++counter}`), { headers: foreign })],
    ["a refused claim (403)", async () => {
      const who = await claim();
      return fetch(url(`/api/profile/${who.name}`), { headers: foreign });
    }],
    ["an invalid name (400)", () => fetch(url("/api/profile/x"), { headers: foreign })],
    ["a refused method (405)", () => fetch(url("/api/profile/anything"), { method: "HEAD", headers: foreign })],
    ["/api/health", () => fetch(url("/api/health"), { headers: foreign })],
  ])("%s allows any origin and the token header", async (_label, request) => {
    const res = await request();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe(ALLOW_HEADERS);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull(); // no cookies: nothing to allow
  });

  it("answers the preflight for a request that carries the token header", async () => {
    const name = `pre${++counter}`;
    const res = await fetch(url(`/api/profile/${name}`), {
      method: "OPTIONS",
      headers: { ...foreign, "access-control-request-method": "GET", "access-control-request-headers": PROFILE_TOKEN_HEADER },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(/\s*,\s*/);
    expect(allowed).toContain(PROFILE_TOKEN_HEADER);
    expect(allowed).toContain("content-type");
    expect(["*", foreign.origin]).toContain(res.headers.get("access-control-allow-origin"));
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
    expect(server.store.get(name)).toBeUndefined(); // a preflight is not a claim
  });

  it("matchmaking preflights keep the headers the SDK needs", async () => {
    const res = await fetch(url(`/matchmake/create/${ROOM_NAME}`), {
      method: "OPTIONS",
      headers: { ...foreign, "access-control-request-method": "POST", "access-control-request-headers": "content-type, authorization" },
    });
    expect(res.status).toBe(204);
    const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["content-type", "authorization", PROFILE_TOKEN_HEADER]) expect(allowed).toContain(h);
  });
});

describe("ActiveProfiles", () => {
  it("lets one owner hold a profile and refuses everyone else", () => {
    const reg = new ActiveProfiles();
    expect(reg.tryAcquire("alice", "r1:s1")).toBe(true);
    expect(reg.tryAcquire("alice", "r2:s2")).toBe(false);
    expect(reg.tryAcquire("alice", "r1:s1")).toBe(false);
    expect(reg.tryAcquire("bobby", "r2:s2")).toBe(true);
    expect(reg.isActive("alice")).toBe(true);
    expect(reg.ownerOf("alice")).toBe("r1:s1");
    expect(reg.size).toBe(2);
  });

  it("releases only for the owner", () => {
    const reg = new ActiveProfiles();
    reg.tryAcquire("alice", "r1:s1");
    expect(reg.release("alice", "r2:s2")).toBe(false);
    expect(reg.isActive("alice")).toBe(true);
    expect(reg.release("alice", "r1:s1")).toBe(true);
    expect(reg.release("alice", "r1:s1")).toBe(false);
    expect(reg.isActive("alice")).toBe(false);
  });

  it("a stale owner cannot free a newer owner's hold", () => {
    const reg = new ActiveProfiles();
    reg.tryAcquire("alice", "old:s1");
    reg.release("alice", "old:s1");
    reg.tryAcquire("alice", "new:s9");
    expect(reg.release("alice", "old:s1")).toBe(false);
    expect(reg.ownerOf("alice")).toBe("new:s9");
  });

  it("a hold that never reaches onJoin expires; a confirmed one does not", () => {
    const reg = new ActiveProfiles();
    const t0 = 1_000_000;
    expect(reg.tryAcquire("ghost", "r1:s1", t0)).toBe(true);
    expect(reg.tryAcquire("real1", "r1:s2", t0)).toBe(true);
    reg.confirm("real1", "r1:s2");
    expect(reg.isActive("ghost", t0 + 5_000)).toBe(true);
    expect(reg.isActive("ghost", t0 + 3_600_000)).toBe(false);
    expect(reg.isActive("real1", t0 + 3_600_000)).toBe(true);
    expect(reg.tryAcquire("ghost", "r2:s3", t0 + 3_600_000)).toBe(true);
    expect(reg.release("ghost", "r1:s1")).toBe(false); // the expired holder is stale now
    expect(reg.ownerOf("ghost")).toBe("r2:s3");
  });

  it("only the owner can confirm", () => {
    const reg = new ActiveProfiles();
    const t0 = 5;
    reg.tryAcquire("alice", "r1:s1", t0);
    reg.confirm("alice", "r2:s2");
    expect(reg.isActive("alice", t0 + 3_600_000)).toBe(false);
  });
});

describe("matchmaking without credentials", () => {
  it("creates no room and reserves no seat for an anonymous or bad-token request", async () => {
    const before = (await matchMaker.query({ name: ROOM_NAME })).length;
    for (const body of [{}, { profile: "nobody1", token: "x", loadout: [] }]) {
      for (const method of ["joinOrCreate", "create"]) {
        const res = await fetch(url(`/matchmake/${method}/${ROOM_NAME}`), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        expect(res.ok, `${method} ${JSON.stringify(body)}`).toBe(false);
      }
    }
    expect((await matchMaker.query({ name: ROOM_NAME })).length).toBe(before);
  });
});

describe("joining", () => {
  it("takes the loadout out of the stash and puts it in the inventory", async () => {
    const who = await claim();
    const [knife, bandage, watch] = who.stash as [ItemDTO, ItemDTO, ItemDTO];
    const p = await createRoom(who, [watch, knife]);

    expect(stashOf(who)).toEqual([bandage]);
    expect((await api(who.name, who.token)).body.profile.stash).toEqual([bandage]);
    expect(carried(p)).toEqual([watch, knife]);
    await until(() => syncedInventory(p).length === 2, "inventory to sync");
    expect(syncedInventory(p)).toEqual([watch, knife]);
    expect(serverPlayer(p).name).toBe(who.name);
    expect(serverPlayer(p).status).toBe("lobby");
    expect(isActive(who)).toBe(true);
    expect(server.profiles.ownerOf(who.name)).toBe(`${p.room.roomId}:${sessionOf(p)}`);
  });

  it("an empty loadout brings nothing and leaves the stash alone", async () => {
    const who = await claim();
    const p = await createRoom(who, []);
    expect(carried(p)).toEqual([]);
    expect(stashOf(who)).toEqual(who.stash);
  });

  it("the whole kit can go, and a full set of INVENTORY_SLOTS is accepted", async () => {
    const who = await claim();
    const extra: ItemDTO[] = Array.from({ length: INVENTORY_SLOTS }, (_, i) => ({ uid: `${who.name}-x${i}`, def: "gold" }));
    server.store.deposit(who.name, extra);
    const loadout = [...who.stash, ...extra].slice(0, INVENTORY_SLOTS);
    const p = await createRoom(who, loadout);
    expect(carried(p)).toEqual(loadout);
    expect(stashOf(who)).toHaveLength(who.stash.length + extra.length - INVENTORY_SLOTS);
  });

  it("two different profiles can share a lobby", async () => {
    const a = await claim();
    const b = await claim();
    const pa = await createRoom(a, [a.stash[0]!]);
    const pb = await joinRoom(pa, b, [b.stash[1]!]);
    expect(worldOf(pa).state.players.size).toBe(2);
    expect(carried(pb)).toEqual([b.stash[1]]);
    expect(isActive(a) && isActive(b)).toBe(true);
  });

  describe("is refused, with the stash and the registry untouched", () => {
    interface Case { label: string; options: (me: Account, other: Account) => unknown; message: RegExp }
    const cases: Case[] = [
      { label: "no token", options: (me) => ({ profile: me.name, loadout: [] }), message: /unknown profile or bad token/ },
      { label: "a wrong token", options: (me) => ({ profile: me.name, token: "nope", loadout: [] }), message: /unknown profile or bad token/ },
      { label: "an empty token", options: (me) => ({ profile: me.name, token: "", loadout: [] }), message: /unknown profile or bad token/ },
      { label: "a numeric token", options: (me) => ({ profile: me.name, token: 123, loadout: [] }), message: /unknown profile or bad token/ },
      { label: "another profile's token", options: (me, other) => ({ profile: me.name, token: other.token, loadout: [] }), message: /unknown profile or bad token/ },
      { label: "a profile nobody claimed", options: (me) => ({ profile: `${me.name}zz`, token: me.token, loadout: [] }), message: /unknown profile or bad token/ },
      { label: "no profile", options: (me) => ({ token: me.token, loadout: [] }), message: /invalid profile name/ },
      { label: "a malformed profile name", options: (me) => ({ profile: "no good!", token: me.token, loadout: [] }), message: /invalid profile name/ },
      { label: "a non-string profile", options: (me) => ({ profile: 42, token: me.token, loadout: [] }), message: /invalid profile name/ },
      { label: "no loadout", options: (me) => ({ profile: me.name, token: me.token }), message: /invalid loadout/ },
      { label: "a loadout that is a string", options: (me) => ({ profile: me.name, token: me.token, loadout: "knife" }), message: /invalid loadout/ },
      { label: "a loadout that is an object", options: (me) => ({ profile: me.name, token: me.token, loadout: { 0: "x" } }), message: /invalid loadout/ },
      { label: "a null loadout", options: (me) => ({ profile: me.name, token: me.token, loadout: null }), message: /invalid loadout/ },
      { label: "a non-string uid", options: (me) => ({ profile: me.name, token: me.token, loadout: [me.stash[0]!.uid, 7] }), message: /invalid loadout/ },
      { label: "an empty uid", options: (me) => ({ profile: me.name, token: me.token, loadout: [""] }), message: /invalid loadout/ },
      { label: "more than INVENTORY_SLOTS uids", options: (me) => ({ profile: me.name, token: me.token, loadout: Array.from({ length: INVENTORY_SLOTS + 1 }, (_, i) => `u${i}`) }), message: /invalid loadout/ },
      { label: "a repeated uid", options: (me) => ({ profile: me.name, token: me.token, loadout: [me.stash[0]!.uid, me.stash[0]!.uid] }), message: /duplicate item/ },
      { label: "an item that is not in the stash", options: (me) => ({ profile: me.name, token: me.token, loadout: ["not-a-real-uid"] }), message: /not in the stash/ },
      { label: "one good and one missing item", options: (me) => ({ profile: me.name, token: me.token, loadout: [me.stash[0]!.uid, "missing"] }), message: /not in the stash/ },
      { label: "someone else's item", options: (me, other) => ({ profile: me.name, token: me.token, loadout: [other.stash[0]!.uid] }), message: /not in the stash/ },
      { label: "own item plus someone else's", options: (me, other) => ({ profile: me.name, token: me.token, loadout: [me.stash[0]!.uid, other.stash[1]!.uid] }), message: /not in the stash/ },
    ];

    it.each(cases)("$label", async ({ options, message }) => {
      const me = await claim();
      const other = await claim();
      await expect(client.create(ROOM_NAME, options(me, other) as object)).rejects.toThrow(message);
      expect(stashOf(me)).toEqual(me.stash);
      expect(stashOf(other)).toEqual(other.stash);
      expect(isActive(me)).toBe(false);
      expect(isActive(other)).toBe(false);
      // Nothing was left half done: the legitimate join works straight afterwards.
      const p = await createRoom(me, me.stash);
      expect(carried(p)).toEqual(me.stash);
    });

    it("more than INVENTORY_SLOTS real items", async () => {
      const me = await claim();
      const extra: ItemDTO[] = Array.from({ length: 4 }, (_, i) => ({ uid: `${me.name}-y${i}`, def: "medkit" }));
      server.store.deposit(me.name, extra);
      const all = stashOf(me);
      expect(all.length).toBeGreaterThan(INVENTORY_SLOTS);
      await expect(client.create(ROOM_NAME, joinOptions(me, all))).rejects.toThrow(/invalid loadout/);
      expect(stashOf(me)).toEqual(all);
      expect(isActive(me)).toBe(false);
    });
  });

  describe("a failure inside onJoin gives everything back", () => {
    it("when taking the items out of the stash throws", async () => {
      const me = await claim();
      vi.spyOn(server.store, "withdraw").mockImplementationOnce(() => { throw new Error("stash exploded"); });
      await expect(client.create(ROOM_NAME, joinOptions(me, me.stash))).rejects.toThrow(/stash exploded/);
      expect(stashOf(me)).toEqual(me.stash);
      expect(isActive(me)).toBe(false);
      expect(server.profiles.size).toBe(0);
      // Nothing was left half done: the same join works straight afterwards.
      const p = await createRoom(me, me.stash);
      expect(carried(p)).toEqual(me.stash);
      expect(stashOf(me)).toEqual([]);
    });

    it("when the player cannot be added after the items were taken: restored, and the room carries on", async () => {
      const first = await claim();
      const me = await claim();
      const pa = await createRoom(first, [first.stash[0]!]);
      const world = worldOf(pa);
      // Fails after the schema state already has the player but before the runtime does.
      vi.spyOn(world.players, "set").mockImplementationOnce(() => { throw new Error("no room for you"); });

      await expect(joinRoom(pa, me, me.stash)).rejects.toThrow(/no room for you/);
      expect(sorted(stashOf(me))).toEqual(sorted(me.stash));
      expect(stashOf(me)).toHaveLength(me.stash.length); // not doubled
      expect(isActive(me)).toBe(false);
      expect(server.profiles.ownerOf(first.name)).toBe(`${pa.room.roomId}:${sessionOf(pa)}`);
      expect(world.state.players.size).toBe(1); // no half-added player in the synced state
      expect(world.players.size).toBe(1);
      expect(carried(pa)).toEqual([first.stash[0]]);
      expect(world.state.phase).toBe("lobby");

      const again = await joinRoom(pa, me, me.stash);
      expect(carried(again)).toEqual(me.stash);
      expect(stashOf(me)).toEqual([]);
    });
  });

  describe("a profile that is already in a raid", () => {
    it("cannot join the same room twice", async () => {
      const who = await claim();
      const first = await createRoom(who, [who.stash[0]!]);
      await expect(client.joinById(first.room.roomId, joinOptions(who, []))).rejects.toThrow(/already in a raid/);
      // The refused attempt must not disturb the first one.
      expect(carried(first)).toEqual([who.stash[0]]);
      expect(server.profiles.ownerOf(who.name)).toBe(`${first.room.roomId}:${sessionOf(first)}`);
      expect(worldOf(first).state.players.size).toBe(1);
    });

    it("cannot join another room either, whatever it brings", async () => {
      const who = await claim();
      const first = await createRoom(who, [who.stash[0]!]);
      await expect(client.create(ROOM_NAME, joinOptions(who, []))).rejects.toThrow(/already in a raid/);
      await expect(client.create(ROOM_NAME, joinOptions(who, [who.stash[1]!]))).rejects.toThrow(/already in a raid|not in the stash/);
      expect(stashOf(who)).toEqual(who.stash.slice(1));
      expect(carried(first)).toEqual([who.stash[0]]);
    });

    it("can join again once the first seat is gone", async () => {
      const who = await claim();
      const first = await createRoom(who, [who.stash[0]!]);
      await leave(first);
      await until(() => !isActive(who), "profile to be released");
      const second = await createRoom(who, [who.stash[0]!]);
      expect(carried(second)).toEqual([who.stash[0]]);
    });
  });

  it("refuses a join once the raid has started", async () => {
    const a = await claim();
    const b = await claim();
    const c = await claim();
    const { a: pa } = await startRaid(a, [], b, []);
    await expect(client.joinById(pa.room.roomId, joinOptions(c, []))).rejects.toThrow();
    expect(isActive(c)).toBe(false);
    expect(stashOf(c)).toEqual(c.stash);
  });
});

describe("leaving during the lobby", () => {
  it("refunds the loadout exactly once and frees the profile", async () => {
    const who = await claim();
    const p = await createRoom(who, who.stash);
    expect(stashOf(who)).toEqual([]);
    await leave(p);
    await until(() => !isActive(who), "profile to be released");
    expect(stashOf(who)).toEqual(who.stash);
    expect(statsOf(who)).toEqual({ raids: 0, extracts: 0, deaths: 0, kills: 0 });
    await sleep(100);
    expect(stashOf(who)).toEqual(who.stash); // still not doubled
    expect((await api(who.name, who.token)).body.profile.stash).toEqual(who.stash);
  });

  it("refunds only what was brought, leaving the rest where it was", async () => {
    const who = await claim();
    const p = await createRoom(who, [who.stash[1]!]);
    await leave(p);
    await until(() => !isActive(who), "profile to be released");
    expect(sorted(stashOf(who))).toEqual(sorted(who.stash));
    expect(stashOf(who)).toHaveLength(STARTER_KIT.length);
  });

  it("a dropped connection is treated as a leave right away, not held for a reconnect", async () => {
    const who = await claim();
    const p = await createRoom(who, who.stash);
    p.room.reconnection.enabled = false;
    const sid = sessionOf(p);
    await until(() => p.room.state.players.has(sid), "the join to finish");
    await sleep(100); // core only offers a reconnect to a client that has completed its join handshake
    const world = worldOf(p); // the room is disposed along with its last player
    serverRoom(p).clients.getById(sid)!.ref.terminate();
    await until(() => !isActive(who), "profile to be released", 2000);
    expect(stashOf(who)).toEqual(who.stash);
    expect(world.state.players.has(sid)).toBe(false);
  });

  it("the profile can queue straight away with the refunded items", async () => {
    const who = await claim();
    await leave(await createRoom(who, who.stash));
    await until(() => !isActive(who), "profile to be released");
    const again = await createRoom(who, who.stash);
    expect(carried(again)).toEqual(who.stash);
  });

  it("a player alone in the lobby keeps waiting and keeps their items out of the stash", async () => {
    const a = await claim();
    const pa = await createRoom(a, [a.stash[0]!]);
    await sleep(300);
    expect(worldOf(pa).state.phase).toBe("lobby");
    expect(stashOf(a)).toEqual(a.stash.slice(1));
  });
});

describe("a raid", () => {
  it("extracting banks result.extracted into the stash, counts the raid, and frees the profile", async () => {
    const A = await claim();
    const B = await claim();
    const loadout = A.stash.slice(0, 2);
    const { a, b, world } = await startRaid(A, loadout, B, []);
    expect(stashOf(A)).toEqual(A.stash.slice(2));
    expect(isActive(A)).toBe(true);

    const zone = world.map.extracts[0]!;
    await teleport(a, zone.x, zone.y);
    a.room.send("extract", {});
    await until(() => a.results.length === 1, "extraction result");
    const [result] = a.results;
    expect(result).toMatchObject({ outcome: "extracted", profile: A.name, kills: 0, killedBy: null, lost: [] });
    expect(result!.broughtIn).toEqual(loadout);
    expect(result!.extracted).toEqual(loadout);

    expect(sorted(stashOf(A))).toEqual(sorted(A.stash));
    expect(stashOf(A)).toHaveLength(A.stash.length);
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });
    expect(isActive(A)).toBe(false); // free to queue while still looking at the results
    expect(isActive(B)).toBe(true);
    expect(serverPlayer(b).status).toBe("alive");
    expect(statsOf(B).raids).toBe(0); // B has not finished their raid

    const profile = (await api(A.name, A.token)).body.profile;
    expect(sorted(profile.stash)).toEqual(sorted(A.stash));
    expect(profile.stats).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });
  });

  it("the extractor can queue again while the old room is still open, and leaving that room later changes nothing", async () => {
    const A = await claim();
    const B = await claim();
    const { a, world } = await startRaid(A, A.stash.slice(0, 1), B, []);
    const zone = world.map.extracts[0]!;
    await teleport(a, zone.x, zone.y);
    a.room.send("extract", {});
    await until(() => a.results.length === 1, "extraction result");

    const second = await createRoom(A, A.stash.slice(0, 1));
    const ownerNow = `${second.room.roomId}:${sessionOf(second)}`;
    expect(server.profiles.ownerOf(A.name)).toBe(ownerNow);
    expect(stashOf(A)).toHaveLength(A.stash.length - 1);

    await leave(a); // closes the results screen of the first raid
    await sleep(100);
    expect(server.profiles.ownerOf(A.name)).toBe(ownerNow); // a stale seat cannot release the new hold
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 }); // and the raid is not counted twice
    expect(stashOf(A)).toHaveLength(A.stash.length - 1);

    await leave(second);
    await until(() => !isActive(A), "profile to be released");
    expect(sorted(stashOf(A))).toEqual(sorted(A.stash)); // lobby leave refunds the second loadout
  });

  it("an item picked up in the raid is banked with the rest", async () => {
    const A = await claim();
    const B = await claim();
    const { a, world } = await startRaid(A, [], B, []);
    const crate = [...world.state.containers.values()].find((c) => c.kind === "crate" && c.items.length > 0)!;
    const loot: ItemDTO = { uid: crate.items[0]!.uid, def: crate.items[0]!.def };
    await teleport(a, crate.x, crate.y);
    a.room.send("take", { containerId: crate.id, uid: loot.uid });
    await until(() => carried(a).length === 1, "pickup");
    expect(carried(a)).toEqual([loot]);

    const zone = world.map.extracts[0]!;
    await teleport(a, zone.x, zone.y);
    a.room.send("extract", {});
    await until(() => a.results.length === 1, "extraction result");
    expect(a.results[0]!.extracted).toEqual([loot]);
    expect(a.results[0]!.broughtIn).toEqual([]);
    expect(stashOf(A)).toEqual([...A.stash, loot]);
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });
  });

  it("dying loses the loadout; the killer can loot it from the body and bank it", async () => {
    const A = await claim();
    const B = await claim();
    const bKnife = B.stash[0]!;
    const { a, b, world } = await startRaid(A, A.stash, B, [bKnife]);
    expect(stashOf(A)).toEqual([]);

    const zone = world.map.extracts[0]!;
    await teleport(a, zone.x - 12, zone.y);
    await teleport(b, zone.x + 12, zone.y);
    const deadline = Date.now() + 10_000;
    while (a.results.length === 0 && Date.now() < deadline) {
      b.room.send("attack", { x: zone.x - 12, y: zone.y });
      await sleep(120);
    }
    await until(() => a.results.length === 1, "A to die");

    const result = a.results[0]!;
    expect(result).toMatchObject({ outcome: "died", profile: A.name, killedBy: B.name, extracted: [] });
    expect(result.lost).toEqual(A.stash);
    expect(stashOf(A)).toEqual([]); // nothing comes back
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    expect(isActive(A)).toBe(false);
    expect(isActive(B)).toBe(true);
    expect(statsOf(B).raids).toBe(0);

    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(Array.from(body.items, (i) => i.uid).sort()).toEqual(uidsOf(A.stash).sort());
    await teleport(b, body.x, body.y);
    for (const it of A.stash) b.room.send("take", { containerId: body.id, uid: it.uid });
    await until(() => carried(b).length === 1 + A.stash.length, "B to loot the body");

    await teleport(b, zone.x, zone.y);
    b.room.send("extract", {});
    await until(() => b.results.length === 1, "B's extraction result");
    expect(b.results[0]).toMatchObject({ outcome: "extracted", kills: 1 });
    expect(sorted(b.results[0]!.extracted)).toEqual(sorted([bKnife, ...A.stash]));
    expect(sorted(stashOf(B))).toEqual(sorted([...B.stash, ...A.stash])); // A's items, same uids, now B's
    expect(statsOf(B)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 1 });
    expect(stashOf(A)).toEqual([]);
    expect(isActive(B)).toBe(false);
  });

  it("leaving mid-raid is MIA: the loadout is lost, it counts as a death, and the profile can queue again", async () => {
    const A = await claim();
    const B = await claim();
    const { a, b, world } = await startRaid(A, A.stash, B, []);
    await leave(a);
    await until(() => !isActive(A), "profile to be released");

    expect(stashOf(A)).toEqual([]);
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(Array.from(body.items, (i) => i.uid).sort()).toEqual(uidsOf(A.stash).sort());
    expect(serverPlayer(b).status).toBe("alive");
    expect(isActive(B)).toBe(true);

    const next = await createRoom(A, []); // the first room is locked: this is a fresh lobby
    expect(next.room.roomId).not.toBe(a.room.roomId);
    expect(isActive(A)).toBe(true);
  });

  it("leaving mid-raid keeps no pending result for the gone session", async () => {
    const A = await claim();
    const B = await claim();
    const { a, b } = await startRaid(A, A.stash.slice(0, 1), B, []);
    const room = serverRoom(a);
    await leave(a);
    await until(() => !isActive(A), "profile to be released");
    expect(statsOf(A).deaths).toBe(1); // the MIA did settle...
    expect(room.pendingResults.has(sessionOf(a))).toBe(false); // ...and nothing was stored for a reconnect that can't come
    expect(room.pendingResults.size).toBe(0);
    expect(serverPlayer(b).status).toBe("alive");
  });

  it("a reconnect hold that runs out turns the player MIA through the real room", async () => {
    shortenReconnectHold(400);
    const A = await claim();
    const B = await claim();
    const loadout = A.stash.slice(0, 2);
    const { a, b, world } = await startRaid(A, loadout, B, []);
    a.room.reconnection.enabled = false; // the player stays away
    const sid = sessionOf(a);
    const room = serverRoom(a);

    await dropConnection(a);
    expect(isActive(A)).toBe(true); // still held
    expect(world.players.get(sid)?.resolved).toBe(false);
    expect(stashOf(A)).toEqual(A.stash.slice(2));
    expect(statsOf(A).raids).toBe(0);

    await until(() => !isActive(A), "the hold to run out", 3000);
    expect(world.players.has(sid)).toBe(false);
    expect(world.state.players.has(sid)).toBe(false);
    expect(stashOf(A)).toEqual(A.stash.slice(2)); // what they brought is gone for good
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    const body = [...world.state.containers.values()].find((c) => c.kind === "body")!;
    expect(Array.from(body.items, (i) => i.uid).sort()).toEqual(uidsOf(loadout).sort());
    expect(room.pendingResults.size).toBe(0);
    expect(serverPlayer(b).status).toBe("alive");
    expect(isActive(B)).toBe(true);
    expect(statsOf(B).raids).toBe(0);
    expect(a.results).toEqual([]); // nobody was there to receive it
  });

  /** Lets the SDK take its time before coming back, so a test can change the world while the player is away. */
  function reconnectAfter(p: Player, ms: number): { reconnected: () => boolean } {
    p.room.reconnection.minUptime = 0;
    p.room.reconnection.delay = 1;
    p.room.reconnection.minDelay = ms;
    let reconnected = false;
    p.room.onReconnect(() => { reconnected = true; });
    return { reconnected: () => reconnected };
  }

  it("a player who extracts while disconnected gets the result when they reconnect", async () => {
    const A = await claim();
    const B = await claim();
    const loadout = A.stash.slice(0, 2);
    const { a, world } = await startRaid(A, loadout, B, []);
    const back = reconnectAfter(a, 1200);
    const sid = sessionOf(a);

    await dropConnection(a);
    const zone = world.map.extracts[0]!;
    placeOnServer(a, zone.x, zone.y);
    expect(enqueueClientMessage(world.players.get(sid)!.inputs, "extract", {})).toBe(true);
    await until(() => serverRoom(a).pendingResults.has(sid), "the extraction to complete while A is away");
    expect(back.reconnected()).toBe(false);
    expect(a.results).toEqual([]); // the client is not there to hear it
    expect(isActive(A)).toBe(false); // settled: stash banked, profile free
    expect(sorted(stashOf(A))).toEqual(sorted(A.stash));
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });

    await until(back.reconnected, "the SDK to reconnect", 8000);
    await until(() => a.results.length === 1, "the pending result to arrive after reconnecting");
    expect(a.results[0]).toMatchObject({ outcome: "extracted", profile: A.name, lost: [] });
    expect(a.results[0]!.extracted).toEqual(loadout);
    await sleep(200);
    expect(a.results).toHaveLength(1); // delivered once
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 }); // and counted once
  });

  it("a player who is killed while disconnected gets the result when they reconnect", async () => {
    const A = await claim();
    const B = await claim();
    const { a, b, world } = await startRaid(A, A.stash, B, [B.stash[0]!]);
    const back = reconnectAfter(a, 3000);
    const sid = sessionOf(a);

    await dropConnection(a);
    const zone = world.map.extracts[0]!;
    placeOnServer(a, zone.x - 12, zone.y);
    serverPlayer(a).hp = 1; // one hit settles it, well inside the time the SDK waits before coming back
    await teleport(b, zone.x + 12, zone.y);
    const deadline = Date.now() + 10_000;
    while (serverPlayer(a).status === "alive" && Date.now() < deadline) {
      b.room.send("attack", { x: zone.x - 12, y: zone.y });
      await sleep(120);
    }
    expect(serverPlayer(a).status).toBe("dead");
    await until(() => serverRoom(a).pendingResults.has(sid), "the death to settle");
    expect(back.reconnected()).toBe(false);
    expect(a.results).toEqual([]);
    expect(isActive(A)).toBe(false);
    expect(stashOf(A)).toEqual([]);
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });

    await until(back.reconnected, "the SDK to reconnect", 8000);
    await until(() => a.results.length === 1, "the pending result to arrive after reconnecting");
    expect(a.results[0]).toMatchObject({ outcome: "died", profile: A.name, killedBy: B.name, extracted: [] });
    expect(a.results[0]!.lost).toEqual(A.stash);
    await sleep(200);
    expect(a.results).toHaveLength(1);
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
  });

  it("the raid timing out turns everyone still alive into MIA", async () => {
    const A = await claim();
    const B = await claim();
    const { a, b, world } = await startRaid(A, A.stash.slice(0, 1), B, B.stash.slice(0, 1));
    world.state.raidEndsAt = world.state.serverTime;
    await until(() => a.results.length === 1 && b.results.length === 1, "both results");
    expect(a.results[0]!.outcome).toBe("mia");
    expect(b.results[0]!.outcome).toBe("mia");
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    expect(statsOf(B)).toEqual({ raids: 1, extracts: 0, deaths: 1, kills: 0 });
    expect(stashOf(A)).toEqual(A.stash.slice(1));
    expect(stashOf(B)).toEqual(B.stash.slice(1));
    expect(isActive(A) || isActive(B)).toBe(false);
  });

  it("a dropped connection keeps the seat for the reconnect window: nothing refunded, nothing lost", async () => {
    const A = await claim();
    const B = await claim();
    const loadout = A.stash.slice(0, 2);
    const { a, world } = await startRaid(A, loadout, B, []);
    a.room.reconnection.minUptime = 0;
    a.room.reconnection.minDelay = 20;
    let reconnected = false;
    a.room.onReconnect(() => { reconnected = true; });

    serverRoom(a).clients.getById(sessionOf(a))!.ref.terminate();
    await sleep(150);
    expect(isActive(A)).toBe(true);
    expect(serverPlayer(a).status).toBe("alive");
    expect(carried(a)).toEqual(loadout);
    expect(stashOf(A)).toEqual(A.stash.slice(2)); // no refund
    expect(statsOf(A).raids).toBe(0);

    await until(() => reconnected, "the SDK to reconnect", 8000);
    expect(isActive(A)).toBe(true);
    expect(world.players.has(sessionOf(a))).toBe(true);

    const zone = world.map.extracts[0]!;
    await teleport(a, zone.x, zone.y);
    a.room.send("extract", {});
    await until(() => a.results.length === 1, "extraction result after reconnecting");
    expect(a.results[0]!.extracted).toEqual(loadout);
    expect(sorted(stashOf(A))).toEqual(sorted(A.stash));
    expect(statsOf(A)).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 0 });
  });
});

describe("shutdown", () => {
  it("stop() resolves only once pending stash writes are on disk", async () => {
    const who = await claim();
    await server.store.flush();

    const realRename = fs.promises.rename.bind(fs.promises);
    vi.spyOn(fs.promises, "rename").mockImplementation(async (...args: Parameters<typeof fs.promises.rename>) => {
      await sleep(150); // keep the write in flight while stop() runs
      return realRename(...args);
    });
    server.store.deposit(who.name, [{ uid: "last-second", def: "gold" }]);
    server.store.recordRaid(who.name, "extracted", 4);

    stopped = true;
    await server.stop();
    const disk = JSON.parse(fs.readFileSync(stashFile, "utf8"));
    expect(disk.profiles[who.name].stash.at(-1)).toEqual({ uid: "last-second", def: "gold" });
    expect(disk.profiles[who.name].stats).toEqual({ raids: 1, extracts: 1, deaths: 0, kills: 4 });
    expect(fs.existsSync(`${stashFile}.tmp`)).toBe(false);
  });
});
