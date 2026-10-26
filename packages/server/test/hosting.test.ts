// Hosting for a public link, over real sockets: the real server in this process on a free port, a temp profile file and a
// made-up built client. One origin for the page, the API and the websocket (the page must not shadow /api, Colyseus's
// /matchmake routes or the upgrade); no cross-origin readers in production; and the cheap guards a public link needs: a cap
// on new profiles, a limit on the shop, a cap on rooms, and a per-player budget for in-match orders (the budget's maths is
// in guards.test.ts: what is checked here is that the Room applies it to every order and nothing else).
// The profiles the tests play with are written into the file before the server starts, so they never count as new ones.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { PASSCODE_HEADER, PROFILE_TOKEN_HEADER, ROOM_NAME, TRAINING_ROOM_NAME, type JoinOptions } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";

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

// ---------------------------------------------------------------- fixture
const INDEX_HTML = "<!doctype html><title>hosted</title><script type=module src=/assets/index-abc123.js></script>";
const SEEDED = Array.from({ length: 24 }, (_, i) => `seed${i + 1}`);
const tokenOf = (name: string) => `tok-${name}`;
const FRIEND = "https://friend.example";
const EVIL = "https://evil.example";

let server: RaidServer;
let port = 0;
let dir = "";
let client: Client;
let nextSeed = 0;
const open: ClientRoom[] = [];

/** A seeded profile nobody has used yet. */
const account = () => {
  const name = SEEDED[nextSeed++]!;
  return { name, token: tokenOf(name) };
};
const joinOptions = (a: { name: string; token: string }): JoinOptions => ({ profile: a.name, token: a.token });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-hosting-"));
  const clientDir = path.join(dir, "client");
  fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(clientDir, "api"));
  fs.writeFileSync(path.join(clientDir, "index.html"), INDEX_HTML);
  fs.writeFileSync(path.join(clientDir, "assets", "index-abc123.js"), "console.log('game')");
  fs.writeFileSync(path.join(clientDir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  // A file under /api must never be served in place of the API's own answer.
  fs.writeFileSync(path.join(clientDir, "api", "health"), "this is not the health check");
  fs.writeFileSync(path.join(clientDir, "api", "leaked.json"), "{\"leaked\":true}");
  const profileFile = path.join(dir, "data", "stash.json");
  fs.mkdirSync(path.dirname(profileFile), { recursive: true });
  const profile = (name: string) => ({
    name, token: tokenOf(name), gv: 0, gvLifetime: 0, gvByMonth: {}, stats: { runs: 0, wins: 0, draws: 0, deaths: 0, kills: 0 },
    cosmetics: { owned: [], equipped: {} }, achievements: {}, progress: { qualifiedWins: 0, bountyRuns: 0, bestRunKills: 0, winsByFaction: {}, winsByWeapon: {} },
  });
  fs.writeFileSync(profileFile, JSON.stringify({ version: 2, profiles: Object.fromEntries(SEEDED.map((n) => [n, profile(n)])) }));
  port = await freePort();
  server = await startServer({
    ...loadConfig({ CLIENT_DIR: clientDir, CORS_ORIGINS: FRIEND }),
    port,
    latencyMs: 0,
    stashFile: profileFile,
    lobbySeconds: 120, // a lone player stays in the lobby for as long as a test needs
    minPlayers: 99, // and a lobby never counts as filled, so no run starts and locks it
    maxArenaRooms: 2,
    maxTrainingRooms: 1,
    maxNewProfilesPerHour: 6,
    maxNewProfilesPerIpPerHour: 3,
    shopBurst: 3,
    shopPerSecond: 1,
    orderBurst: 5,
    orderPerSecond: 5,
  });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  for (const room of open) await room.leave(true).catch(() => {});
  try {
    await server?.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function join(a: { name: string; token: string }, mode: "arena" | "training" = "arena"): Promise<ClientRoom> {
  const room = mode === "training"
    ? await client.create<RaidState>(TRAINING_ROOM_NAME, joinOptions(a))
    : await client.create<RaidState>(ROOM_NAME, joinOptions(a));
  open.push(room);
  return room;
}

async function leave(room: ClientRoom): Promise<void> {
  await room.leave(true).catch(() => {});
  open.splice(open.indexOf(room), 1);
}

// ---------------------------------------------------------------- one origin
describe("the client is served from the same origin", () => {
  it("serves index.html at / and /index.html, never cached", async () => {
    for (const p of ["/", "/index.html"]) {
      const res = await fetch(url(p));
      expect(res.status, p).toBe(200);
      expect(res.headers.get("content-type"), p).toMatch(/text\/html/);
      expect(res.headers.get("cache-control"), p).toBe("no-cache");
      expect(await res.text()).toBe(INDEX_HTML);
    }
  });

  it("serves hashed assets as immutable for a year, and other files for an hour", async () => {
    const asset = await fetch(url("/assets/index-abc123.js"));
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toMatch(/javascript/);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const icon = await fetch(url("/favicon.svg"));
    expect(icon.status).toBe(200);
    expect(icon.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("answers a missing file with 404, and never walks out of the folder", async () => {
    expect((await fetch(url("/nothing-here.js"))).status).toBe(404);
    const traversal = await fetch(url("/%2e%2e/%2e%2e/etc/passwd"));
    expect(traversal.status).toBeGreaterThanOrEqual(400);
    expect(await traversal.text()).not.toContain("root:");
  });

  it("does not shadow /api: the API answers, whatever files sit under that path", async () => {
    const health = await fetch(url("/api/health"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const leaked = await fetch(url("/api/leaked.json"));
    expect(leaked.status).toBe(404);
    expect(await leaked.json()).toEqual({ error: "not found" });
    const profile = await fetch(url(`/api/profile/${SEEDED[23]}`));
    expect(profile.status).toBe(403); // a real answer from the real route: the name is seeded, and no token came with it
  });

  it("does not shadow Colyseus's matchmaking route, and the websocket works on the same port", async () => {
    // The route's own refusal (an unknown profile), as JSON from Colyseus: the page did not answer it, and nothing was opened.
    const res = await fetch(url(`/matchmake/create/${TRAINING_ROOM_NAME}`), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: "nobody", token: "x" }),
    });
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(JSON.stringify(await res.json())).toMatch(/unknown profile or bad token/);
    expect(server.rooms.count("training")).toBe(0);
    // A real join (HTTP, then the websocket) shows the upgrade is not in the page's way either.
    const room = await join(account());
    expect(room.sessionId).toBeTruthy();
    await until(() => !!room.state?.players, "the first state over the websocket");
    await leave(room);
    expect((await fetch(url(`/matchmake/create/${TRAINING_ROOM_NAME}`))).status).toBe(404); // a GET is not the route, and not the page
  });
});

// ---------------------------------------------------------------- cors
describe("no other origin may read it", () => {
  const crossOrigin = (origin: string) => ({ origin });

  it("sends no Access-Control-Allow-Origin (or -Credentials) to a stranger, on pages, the API and matchmaking", async () => {
    const requests: Array<[string, () => Promise<Response>]> = [
      ["the page", () => fetch(url("/"), { headers: crossOrigin(EVIL) })],
      ["an asset", () => fetch(url("/assets/index-abc123.js"), { headers: crossOrigin(EVIL) })],
      ["/api/health", () => fetch(url("/api/health"), { headers: crossOrigin(EVIL) })],
      ["a profile claim refused", () => fetch(url(`/api/profile/${SEEDED[22]}`), { headers: crossOrigin(EVIL) })],
      ["an unknown /api path", () => fetch(url("/api/nope"), { headers: crossOrigin(EVIL) })],
      ["a request with no origin", () => fetch(url("/api/health"))],
      ["matchmaking", () => fetch(url(`/matchmake/create/${TRAINING_ROOM_NAME}`), {
        method: "POST", headers: { ...crossOrigin(EVIL), "content-type": "application/json" }, body: JSON.stringify({ profile: "x" }),
      })],
    ];
    for (const [label, request] of requests) {
      const res = await request();
      expect(res.headers.get("access-control-allow-origin"), label).toBeNull();
      expect(res.headers.get("access-control-allow-credentials"), label).toBeNull();
    }
  });

  it("answers a stranger's preflight with no permission", async () => {
    for (const p of ["/api/profile/abc", `/matchmake/create/${ROOM_NAME}`]) {
      const res = await fetch(url(p), {
        method: "OPTIONS",
        headers: { ...crossOrigin(EVIL), "access-control-request-method": "POST", "access-control-request-headers": PROFILE_TOKEN_HEADER },
      });
      expect(res.headers.get("access-control-allow-origin"), p).toBeNull();
    }
  });

  it("lets an origin on the CORS_ORIGINS allowlist in, with the headers our client sends", async () => {
    const api = await fetch(url("/api/health"), { headers: crossOrigin(FRIEND) });
    expect(api.headers.get("access-control-allow-origin")).toBe(FRIEND);
    expect(api.headers.get("access-control-allow-credentials")).toBeNull();
    const pre = await fetch(url(`/matchmake/create/${ROOM_NAME}`), {
      method: "OPTIONS",
      headers: { ...crossOrigin(FRIEND), "access-control-request-method": "POST", "access-control-request-headers": `content-type, ${PROFILE_TOKEN_HEADER}, ${PASSCODE_HEADER}` },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(FRIEND);
    const allowed = (pre.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const h of ["content-type", PROFILE_TOKEN_HEADER, PASSCODE_HEADER]) expect(allowed).toContain(h);
  });
});

// ---------------------------------------------------------------- new profiles
describe("new profiles are capped", () => {
  const claimFrom = (name: string, ip: string, token?: string) =>
    fetch(url(`/api/profile/${name}`), { headers: { "cf-connecting-ip": ip, ...(token ? { [PROFILE_TOKEN_HEADER]: token } : {}) } });

  it("allows 3 an address an hour, 6 in all, with 429 and Retry-After beyond, and never limits opening a profile you own", async () => {
    const firsts: Array<{ name: string; token: string }> = [];
    for (let i = 0; i < 3; i++) {
      const res = await claimFrom(`newa${i}`, "203.0.113.1");
      expect(res.status, `a${i}`).toBe(200);
      const body = (await res.json()) as { token: string; created: boolean };
      expect(body.created).toBe(true);
      firsts.push({ name: `newa${i}`, token: body.token });
    }
    const refused = await claimFrom("newa3", "203.0.113.1");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(server.store.get("newa3")).toBeUndefined(); // refused, so not created
    // Another address is fine until the whole server is at its 6.
    for (let i = 0; i < 3; i++) expect((await claimFrom(`newb${i}`, "203.0.113.2")).status, `b${i}`).toBe(200);
    const full = await claimFrom("newc0", "203.0.113.3");
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ error: expect.stringMatching(/too many new callsigns/i) });
    // Opening a profile that exists needs its token, never a slot: even from the address at its cap, even with everything full.
    for (const first of firsts) expect((await claimFrom(first.name, "203.0.113.1", first.token)).status).toBe(200);
    expect((await claimFrom(firsts[0]!.name, "203.0.113.1", "wrong-token")).status).toBe(403);
    // Seeded profiles were never new ones.
    expect((await claimFrom(SEEDED[21]!, "203.0.113.9", tokenOf(SEEDED[21]!))).status).toBe(200);
  });
});

// ---------------------------------------------------------------- shop
describe("the shop is limited per profile", () => {
  const equipAs = (name: string, token: string) => fetch(url(`/api/profile/${name}/equip`), {
    method: "POST", headers: { "content-type": "application/json", [PROFILE_TOKEN_HEADER]: token }, body: JSON.stringify({ slot: "title", id: null }),
  });

  it("lets a burst of 3 through, then answers 429 JSON with Retry-After; others and refills are unaffected", async () => {
    const a = account();
    const b = account();
    for (let i = 0; i < 3; i++) expect((await equipAs(a.name, a.token)).status, `equip ${i}`).toBe(200);
    const limited = await equipAs(a.name, a.token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(limited.headers.get("content-type")).toMatch(/json/);
    expect(await limited.json()).toMatchObject({ error: expect.any(String) });
    expect((await equipAs(b.name, b.token)).status).toBe(200); // its own bucket
    await sleep(1100);
    expect((await equipAs(a.name, a.token)).status).toBe(200); // one token came back
  });

  it("does not spend a bucket for a wrong token, so a stranger cannot lock the owner out", async () => {
    const a = account();
    for (let i = 0; i < 10; i++) expect((await equipAs(a.name, "not-the-token")).status).toBe(403);
    expect((await equipAs(a.name, a.token)).status).toBe(200);
  });
});

// ---------------------------------------------------------------- rooms
describe("rooms are capped", () => {
  it("refuses a room past MAX_ARENA_ROOMS with a plain message, still lets anyone join an open lobby, and gives the place back on dispose", async () => {
    const [a, b, c, d] = [account(), account(), account(), account()];
    const r1 = await join(a);
    const r2 = await join(b);
    expect(server.rooms.count("arena")).toBe(2);
    // A third room is refused...
    await expect(join(c)).rejects.toThrow(/server is full/i);
    // ...and refusing it neither counts nor frees anything (core also disposes the room that never got created).
    expect(server.rooms.count("arena")).toBe(2);
    // joinOrCreate finds the open lobby, so the cap does not touch it.
    const r3 = await client.joinOrCreate<RaidState>(ROOM_NAME, joinOptions(c));
    open.push(r3);
    expect(r3.roomId === r1.roomId || r3.roomId === r2.roomId).toBe(true);
    expect(server.rooms.count("arena")).toBe(2);
    // Everyone leaves: both rooms are disposed, and a new one can open.
    await leave(r3);
    await leave(r1);
    await leave(r2);
    await until(() => server.rooms.count("arena") === 0, "both rooms to be disposed");
    const r4 = await join(d);
    expect(server.rooms.count("arena")).toBe(1);
    await leave(r4);
    await until(() => server.rooms.count("arena") === 0, "the room to be disposed");
  });

  it("counts training rooms apart from arena rooms", async () => {
    const [a, b, c] = [account(), account(), account()];
    const t1 = await join(a, "training");
    expect(server.rooms.count("training")).toBe(1);
    await expect(join(b, "training")).rejects.toThrow(/server is full/i);
    const arena = await join(c);
    expect([server.rooms.count("arena"), server.rooms.count("training")]).toEqual([1, 1]);
    await leave(arena);
    await leave(t1);
    await until(() => server.rooms.count("arena") === 0 && server.rooms.count("training") === 0, "both rooms to be disposed");
    const t2 = await join(b, "training");
    expect(server.rooms.count("training")).toBe(1);
    await leave(t2);
    await until(() => server.rooms.count("training") === 0, "the room to be disposed");
  });
});

// ---------------------------------------------------------------- orders
describe("a player's orders spend a budget", () => {
  interface ServerRoomView { refusedOrders: number; lastInputAt: number }
  const serverRoom = (room: ClientRoom) => matchMaker.getLocalRoomById(room.roomId) as unknown as ServerRoomView;

  it("drops orders past the burst, never counts aim, and a dropped order is not presence", async () => {
    const room = await join(account());
    await until(() => !!room.state?.players, "the first state");
    const view = serverRoom(room);
    expect(view.refusedOrders).toBe(0);
    // Aim is not an order: a stream of it spends nothing.
    for (let i = 0; i < 30; i++) room.send("aim", { a: i / 10 });
    await sleep(150);
    expect(view.refusedOrders).toBe(0);
    // Orders: the 5-token burst, then the rest dropped (the bucket refills 5 a second, so a few ms add nothing).
    for (let i = 0; i < 40; i++) room.send(i % 2 ? "stop" : "move", i % 2 ? {} : { x: 100 + i, y: 100 });
    await until(() => view.refusedOrders >= 30, "the excess to be refused");
    expect(view.refusedOrders).toBeGreaterThanOrEqual(30);
    expect(view.refusedOrders).toBeLessThanOrEqual(36);
    // The drained bucket answers nothing: refused orders leave lastInputAt where it was.
    view.lastInputAt = 0;
    for (let i = 0; i < 4; i++) room.send("move", { x: 200, y: 200 });
    await sleep(150);
    expect(view.lastInputAt).toBe(0);
    // A second later tokens are back, and an accepted order is presence again.
    await sleep(1000);
    room.send("move", { x: 300, y: 300 });
    await until(() => view.lastInputAt > 0, "an accepted order to count as presence");
    await leave(room);
  });

  it("gives each player a budget of their own", async () => {
    const a = await join(account());
    await until(() => !!a.state?.players, "the first state");
    const b = await client.joinOrCreate<RaidState>(ROOM_NAME, joinOptions(account()));
    open.push(b);
    expect(b.roomId).toBe(a.roomId);
    const view = serverRoom(a);
    const before = view.refusedOrders;
    for (let i = 0; i < 6; i++) a.send("move", { x: 100, y: 100 }); // a spends its whole burst, and one more
    for (let i = 0; i < 5; i++) b.send("move", { x: 100, y: 100 }); // b still has all of its own
    await until(() => view.refusedOrders >= before + 1, "a's sixth order to be refused");
    await sleep(150);
    expect(view.refusedOrders).toBe(before + 1); // only a's: b's five were all inside b's own burst
    await leave(a);
    await leave(b);
  });
});
