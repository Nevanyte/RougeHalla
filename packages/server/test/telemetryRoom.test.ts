// Telemetry through the real Room (docs/TELEMETRY.md 5 and 6.1): the real server on a free port with a TELEMETRY_DIR file sink.
// A run with a bot is recorded and the bot tagged, the client's perf sample joins the record, pid is never the callsign, no
// token or address reaches the file, a training room writes nothing, and a shutdown mid-run writes `end: "void"`.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import { ROOM_NAME, TELEMETRY_PERF_MESSAGE, TRAINING_ROOM_NAME, validateRunRecord, type RunRecord } from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { applyDamage } from "../src/sim/arena";
import { addPlayer } from "../src/sim/step";
import type { World } from "../src/sim/world";
import { pidOf } from "../src/telemetry/identity";

type ClientRoom = Room<any, RaidState>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SALT = "salt-".repeat(10);

async function until(pred: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    let ok = false;
    try { ok = pred(); } catch { /* not yet */ }
    if (ok) return;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
  });
}

let server: RaidServer;
let stopped = false;
let port = 0;
let dir = "";
let telemetryDir = "";
let client: Client;
const saved: Record<string, string | undefined> = {};

function records(): RunRecord[] {
  if (!fs.existsSync(telemetryDir)) return [];
  const out: RunRecord[] = [];
  for (const f of fs.readdirSync(telemetryDir)) {
    for (const line of fs.readFileSync(path.join(telemetryDir, f), "utf8").split("\n")) if (line.trim()) out.push(JSON.parse(line) as RunRecord);
  }
  return out;
}
const rawText = (): string => fs.existsSync(telemetryDir) ? fs.readdirSync(telemetryDir).map((f) => fs.readFileSync(path.join(telemetryDir, f), "utf8")).join("") : "";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-telemetry-room-"));
  telemetryDir = path.join(dir, "telemetry");
  for (const k of ["TELEMETRY_DIR", "TELEMETRY_SALT", "TELEMETRY_SOURCE", "TELEMETRY_URL", "TELEMETRY_TOKEN"]) saved[k] = process.env[k];
  process.env.TELEMETRY_DIR = telemetryDir;
  process.env.TELEMETRY_SALT = SALT;
  process.env.TELEMETRY_SOURCE = "test";
  delete process.env.TELEMETRY_URL;
  delete process.env.TELEMETRY_TOKEN;
  port = await freePort();
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: "0" }),
    port, minPlayers: 2, fillSeconds: 0, lobbySeconds: 120, planSeconds: 0, firstPatienceSeconds: 0,
    patienceSeconds: 120, patienceMinSeconds: 120, suddenDeathSeconds: 120, latencyMs: 0, stashFile: path.join(dir, "data", "stash.json"),
  });
  client = new Client(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  try { if (!stopped) await server.stop(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let counter = 0;
async function claim(): Promise<{ name: string; token: string }> {
  const name = `tm${++counter}`;
  const res = await fetch(`http://127.0.0.1:${port}/api/profile/${name}`);
  const body = (await res.json()) as { token: string };
  return { name, token: body.token };
}

const worldOf = (room: ClientRoom) => (matchMaker.getLocalRoomById(room.roomId) as unknown as { world: World }).world;

function slay(world: World, killer: string, victim: string): void {
  const v = world.state.players.get(victim)!;
  applyDamage(world, v, world.players.get(victim)!, v.hp + 1000, { id: killer, p: world.state.players.get(killer)!, rt: world.players.get(killer)! });
}

async function twoHumansAndABot(): Promise<{ A: { name: string; token: string }; B: { name: string; token: string }; a: ClientRoom; b: ClientRoom; world: World }> {
  const A = await claim();
  const B = await claim();
  const a = await client.create<RaidState>(ROOM_NAME, { profile: A.name, token: A.token });
  const world = worldOf(a);
  world.config = { ...world.config, minPlayers: 3 };
  const b = await client.joinById<RaidState>(a.roomId, { profile: B.name, token: B.token });
  addPlayer(world, "bot-1", "botty", { bot: true });
  world.state.lobbyEndsAt = world.state.serverTime;
  await until(() => world.state.phase === "active", "the run to start");
  await until(() => a.state.phase === "active" && b.state.phase === "active", "clients to see it");
  return { A, B, a, b, world };
}

describe("telemetry through the Room", () => {
  it("records a finished run with its bot tagged, the perf sample joined, and no name, token or address in the file", async () => {
    const { A, B, a, b, world } = await twoHumansAndABot();
    slay(world, a.sessionId, "bot-1");
    await sleep(150);
    a.send(TELEMETRY_PERF_MESSAGE, { v: 1, fpsP50: 120, frameMsP95: 9, ua: "chrome", junk: "x" });
    await sleep(100);
    slay(world, a.sessionId, b.sessionId);
    await until(() => records().length === 1, "the record to be written");
    const r = records()[0]!;
    expect(validateRunRecord(r)).toBeNull();
    expect(r.source).toBe("test");
    expect(r.end).toBe("winner");
    expect(r.humans).toBe(2);
    expect(r.bots).toBe(1);
    const bySession = (id: string) => r.players.find((p) => p.slot === worldSlot(world, id))!;
    const botRec = r.players.find((p) => p.bot)!;
    expect(botRec.pid).toBeNull();
    expect(botRec.death?.kind).toBe("player");
    const winner = r.players[r.winnerSlot]!;
    expect(winner.pid).toBe(pidOf(SALT, A.name));
    expect(winner.client).toMatchObject({ v: 1, fpsP50: 120, frameMsP95: 9, ua: "chrome" });
    expect((winner.client as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(bySession(b.sessionId).pid).toBe(pidOf(SALT, B.name));
    const text = rawText();
    for (const secret of [A.name, B.name, A.token, B.token, "127.0.0.1", a.sessionId, b.sessionId]) expect(text).not.toContain(secret);
    await a.leave(true).catch(() => {});
    await b.leave(true).catch(() => {});
  }, 30_000);

  it("a training room writes nothing", async () => {
    const before = records().length;
    const T = await claim();
    const t = await client.create<RaidState>(TRAINING_ROOM_NAME, { profile: T.name, token: T.token, mode: "training" });
    await until(() => t.state.phase === "active", "training to start");
    await sleep(300);
    await t.leave(true);
    await sleep(300);
    expect(records().length).toBe(before);
  }, 20_000);

  it("a shutdown mid-run writes the run as a void", async () => {
    const before = records().length;
    await twoHumansAndABot();
    await server.stop();
    stopped = true;
    await until(() => records().length === before + 1, "the void record");
    const r = records()[before]!;
    expect(r.end).toBe("void");
    expect(validateRunRecord(r)).toBeNull();
  }, 30_000);
});

function worldSlot(world: World, id: string): number {
  return [...world.state.players.keys()].indexOf(id);
}
