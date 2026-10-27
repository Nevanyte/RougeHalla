// Fill bots through the real server (docs/BOTS.md 9.2): one human, an SDK client with a profile claimed over HTTP like the menu does,
// joins an arena lobby on a server with BOTS_FILL_TO=4. The bots arrive in the last seconds of the countdown, flagged `bot`, play the
// run out against the clock (short patience and sudden death), and leave no trace in persistence: no profile for any of their names,
// nothing banked for them, the human's result and record free of anything they earned or lost. The run is planned first (the live
// server's planning phase): the human presses ready at once, and each bot does too, 1 to 3 s in (the adapter's stand-in until the
// brain has a planning module), so the phase ends well before its timer. Their learning file is written
// next to the profile file. A training room never gets any. Every `fxs` batch is read by the human's own copy of the roster
// with no tuple dropped, and nothing logged an error.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  MAX_PLAYERS, ROOM_NAME, TRAINING_ROOM_NAME, unpackFx, type FxBatch, type JoinOptions, type ProfileResponse, type RunResult,
} from "@raid/shared";
import type { RaidState } from "@raid/shared/schema";
import type { BotManager } from "../src/bots/BotManager";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import type { World } from "../src/sim/world";

type ClientRoom = Room<any, RaidState>;

/** The countdown, and how much of its end the bots arrive in: they come between 1 s into the countdown and 1 s before its end. */
const LOBBY_SECONDS = 5;
const ARRIVAL_SECONDS = 4;
const FILL_TO = 4;
/** The planning phase's timer: far longer than the 1 to 3 s the bots take to press ready, so the phase ends because they did. */
const PLAN_SECONDS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(15);
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

const fatal: string[] = [];
const onFatal = (err: unknown) => { fatal.push(err instanceof Error ? (err.stack ?? err.message) : String(err)); };
let errorSpy: MockInstance<typeof console.error>;

let server: RaidServer;
let stopped = false;
let dir = "";
let profileFile = "";
let statsFile = "";
let url = "";

beforeAll(async () => {
  errorSpy = vi.spyOn(console, "error");
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-e2efill-"));
  profileFile = path.join(dir, "data", "stash.json");
  statsFile = path.join(dir, "data", "bot-stats.json"); // where the server puts it when BOT_STATS_FILE is unset
  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  server = await startServer({
    ...loadConfig({ BOTS_FILL_TO: String(FILL_TO), BOTS_ARRIVAL_SECONDS: String(ARRIVAL_SECONDS), BOTS_SEED: "11" }),
    mobs: true,
    port,
    stashFile: profileFile,
    latencyMs: 0,
    minPlayers: 2,
    fillSeconds: 5,
    lobbySeconds: LOBBY_SECONDS,
    // Nobody has to die for the run to end: the arena teleports the survivors together, and sudden death burns them down.
    planSeconds: PLAN_SECONDS,
    firstPatienceSeconds: 0, // the first timer scales like the others, so patienceSeconds below is the run's pace
    patienceSeconds: 6,
    patienceMinSeconds: 6,
    suddenDeathSeconds: 3,
  });
});

afterAll(async () => {
  process.off("uncaughtException", onFatal);
  process.off("unhandledRejection", onFatal);
  errorSpy?.mockRestore();
  try {
    if (!stopped) await server.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function claim(name: string): Promise<{ name: string; token: string }> {
  const res = await fetch(`${url}/api/profile/${name}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as ProfileResponse;
  expect(body.created).toBe(true);
  return { name, token: body.token };
}

interface ServerRoomView {
  world: World;
  bots: BotManager | undefined;
}
const serverRoom = (roomId: string) => matchMaker.getLocalRoomById(roomId) as unknown as ServerRoomView;

describe("fill bots in a real arena room", () => {
  it("arrive in the last seconds of the lobby, play the run out, and leave nothing in persistence", async () => {
    const me = await claim("fillhuman");
    // Everything that reaches the profile store, with the name it was made for. The spies call through.
    const recorded = vi.spyOn(server.store, "recordRun");
    const banked = vi.spyOn(server.store, "bankGv");
    const options: JoinOptions = { profile: me.name, token: me.token, faction: "frost" };
    const room: ClientRoom = await new Client(url).create<RaidState>(ROOM_NAME, options);
    const joinedAt = Date.now();

    const results: RunResult[] = [];
    room.onMessage("result", (r: RunResult) => results.push(r));
    // Every batch the human gets is read against its own roster, as RaidScene does: nothing may be lost to a bot's id.
    const decoding = { tuples: 0, decoded: 0, dropped: [] as unknown[] };
    room.onMessage("fxs", (batch: FxBatch) => {
      decoding.tuples += batch.l.length;
      decoding.decoded += unpackFx(batch, room.state.roster, (tuple) => decoding.dropped.push(tuple)).length;
    });

    // What the lobby looked like from the human's seat, whenever it changed.
    interface Sample { t: number; wall: number; phase: string; players: number; bots: number; endsAt: number; botsReady: number }
    const samples: Sample[] = [];
    let readySent = false;
    const sample = (): void => {
      const s = room.state;
      if (!s?.players) return;
      let bots = 0;
      let botsReady = 0;
      for (const p of s.players.values()) if (p.bot) { bots++; if (p.planReady) botsReady++; }
      const last = samples[samples.length - 1];
      if (!last || last.phase !== s.phase || last.players !== s.players.size || last.bots !== bots || last.botsReady !== botsReady) {
        samples.push({ t: s.serverTime, wall: Date.now() - joinedAt, phase: s.phase, players: s.players.size, bots, endsAt: s.lobbyEndsAt, botsReady });
      }
      // The human takes what it is dealt and presses ready, as soon as there is something to press it in.
      if (s.phase === "planning" && !readySent) {
        readySent = true;
        room.send("plan", { ready: true });
      }
    };
    const watcher = setInterval(sample, 10);

    // A person who goes for whoever is nearest: lock it, and again whenever the lock is gone.
    const fighter = setInterval(() => {
      const s = room.state;
      const mine = s?.players?.get(room.sessionId);
      if (!mine || s.phase !== "active" || mine.status !== "alive") return;
      if (mine.attackTarget !== "") return;
      let best: string | null = null;
      let bestD = Infinity;
      for (const [id, p] of s.players) {
        if (id === room.sessionId || p.status !== "alive") continue;
        const d = Math.hypot(p.x - mine.x, p.y - mine.y);
        if (d < bestD) { best = id; bestD = d; }
      }
      if (best !== null) room.send("target", { id: best });
    }, 250);

    try {
      await until(() => room.state?.players?.size > 0, "the lobby state");
      const roomId = room.roomId;
      const { world, bots } = serverRoom(roomId);
      expect(bots, "an arena room with fillTo above 0 has a bot manager").toBeDefined();
      expect(server.botStats, "the process's learning store").not.toBeNull();

      // --- the lobby: alone for a while, then 3 bots one after another, flagged, inside the arrival window
      await until(() => samples.some((s) => s.phase === "active"), "the run to start", (LOBBY_SECONDS + PLAN_SECONDS + 4) * 1000);
      expect(samples[0]).toMatchObject({ phase: "lobby", players: 1, bots: 0 });
      const lobby = samples.filter((s) => s.phase === "lobby");
      const counts = lobby.map((s) => s.bots);
      expect(counts, "the head count only goes up, by one bot at a time").toEqual([...new Set(counts)]);
      expect(Math.max(...counts)).toBeGreaterThanOrEqual(1);
      const firstBot = lobby.find((s) => s.bots > 0)!;
      const endsAt = lobby[0]!.endsAt;
      expect(endsAt - firstBot.t, "no bot before the arrival window").toBeLessThanOrEqual(ARRIVAL_SECONDS * 1000 + 150);
      expect(firstBot.wall, "and none at the very start of the countdown").toBeGreaterThan(300);
      // The countdown ran its course: bots did not shorten it, and a lone human still waited the whole of it.
      const planning = samples.find((s) => s.phase === "planning")!;
      expect(planning, "the run was planned first").toBeDefined();
      expect(planning.wall).toBeGreaterThanOrEqual(LOBBY_SECONDS * 1000 - 250);
      expect(planning).toMatchObject({ players: FILL_TO, bots: FILL_TO - 1 });
      // ...then planning: every bot pressed ready (the last to do so ended the phase in its tick, so the first sample of the run
      // is the one that shows it; `planReady` is not reset when the run starts), and that, not the timer, ended it.
      const started = samples.find((s) => s.phase === "active")!;
      expect(started.wall - planning.wall, "planning ended before its timer").toBeLessThan(PLAN_SECONDS * 1000 - 1500);
      expect(started.wall - planning.wall, "the bots took a second or more to press ready").toBeGreaterThanOrEqual(900);
      expect(started.botsReady, "every bot was ready").toBe(FILL_TO - 1);
      expect(started).toMatchObject({ players: FILL_TO, bots: FILL_TO - 1 });
      expect(world.state.players.size).toBe(FILL_TO);

      const botIds = [...room.state.players].filter(([, p]) => p.bot).map(([id]) => id);
      const botNames = botIds.map((id) => room.state.players.get(id)!.name);
      expect(botIds).toHaveLength(FILL_TO - 1);
      expect(botIds.every((id) => id.startsWith("bot~") && world.players.get(id)?.bot === true)).toBe(true);
      expect(new Set(botNames.map((n) => n.toLowerCase())).size).toBe(botNames.length);
      expect(botNames).not.toContain(me.name);
      expect(room.state.players.get(room.sessionId)!.bot).toBe(false);
      for (const id of botIds) expect(room.state.players.get(id)!.status).toBe("alive");

      // --- the bots play: they walk and act on their own inputs, validated like a human's, none refused
      const spawnAt = new Map(botIds.map((id) => [id, { x: world.state.players.get(id)!.x, y: world.state.players.get(id)!.y }]));
      await until(
        () => botIds.some((id) => world.state.players.get(id)!.moveSeq > 0),
        "a bot to give an order", 15_000,
      );
      await sleep(2500);
      const moved = botIds.filter((id) => {
        const p = world.state.players.get(id)!;
        return p.status !== "alive" || Math.hypot(p.x - spawnAt.get(id)!.x, p.y - spawnAt.get(id)!.y) > 40;
      });
      expect(moved.length, "bots left their spawns").toBeGreaterThanOrEqual(1);
      expect(bots!.stats.sent).toBeGreaterThan(0);
      expect(bots!.stats.applied).toBeGreaterThan(0);
      expect(bots!.stats.refused).toBe(0);
      expect(bots!.stats.errors).toBe(0);

      // --- the run completes; the human has its result
      await until(() => room.state.phase === "ended", "the run to end", 90_000);
      await until(() => results.length > 0, "the human's result");
      expect(results).toHaveLength(1);
      const result = results[0]!;
      expect(["won", "died", "draw"]).toContain(result.outcome);
      expect(result.players).toBe(FILL_TO);
      // Nothing a bot earned, lost or was killed for is the human's: no GV, no kills, no win bonus (it fought no human).
      expect(result.kills).toBe(0);
      expect(result.gv).toMatchObject({ kills: 0, bounty: 0, win: 0, total: 0 });
      if (result.outcome === "won") expect(result.winBonusWithheld).toBe(true);
      expect(bots!.stats.refused).toBe(0);
      expect(bots!.stats.errors).toBe(0);
      expect(bots!.stats.results, "every bot got its result").toBe(FILL_TO - 1);

      // --- no profile for any bot name, nothing recorded or banked for one, and the human's record is its own run
      expect(recorded.mock.calls.map((c) => c[0])).toEqual([me.name]);
      expect(banked).not.toHaveBeenCalled();
      for (const name of botNames) expect(server.store.get(name), `a profile for the bot ${name}`).toBeUndefined();
      const record = server.store.get(me.name)!;
      expect(record.stats).toMatchObject({ runs: 1, kills: 0 });
      expect(record.gv).toBe(0);
      await server.store.flush();
      const onDisk = JSON.parse(fs.readFileSync(profileFile, "utf8")) as { profiles: Record<string, unknown> };
      expect(Object.keys(onDisk.profiles)).toEqual([me.name]);

      // --- the learning file is written, from the bots' results, before the room is even disposed
      expect(fs.existsSync(statsFile), "bot-stats.json next to the profile file").toBe(true);
      const learned = JSON.parse(fs.readFileSync(statsFile, "utf8")) as { version: number; baseline: Record<string, { n: number }> };
      expect(learned.version).toBe(1);
      const runs = Object.values(learned.baseline).reduce((n, c) => n + c.n, 0);
      expect(runs).toBeGreaterThanOrEqual(1);
      expect(path.dirname(statsFile)).toBe(path.dirname(profileFile));
      expect(statsFile).not.toBe(profileFile);

      // --- the room closes, the bots are disposed, and the profile is free again
      clearInterval(fighter);
      await room.leave(true);
      await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed", 15_000);
      await until(() => server.profiles.size === 0, "every profile to be free again");
      expect(JSON.parse(fs.readFileSync(statsFile, "utf8")).baseline).toBeDefined();

      // --- the human read every fx batch of the run, bots' included, with nothing lost
      expect(decoding.dropped).toEqual([]);
      expect(decoding.decoded).toBe(decoding.tuples);
      expect(decoding.tuples).toBeGreaterThan(0);
      expect(MAX_PLAYERS).toBeGreaterThanOrEqual(FILL_TO);
    } finally {
      clearInterval(watcher);
      clearInterval(fighter);
      recorded.mockRestore();
      banked.mockRestore();
      if (room.connection?.isOpen) await room.leave(true).catch(() => {});
    }
  }, 150_000);

  it("never seats a bot in a training room", async () => {
    const me = await claim("filltrainee");
    const options: JoinOptions = { profile: me.name, token: me.token };
    const room: ClientRoom = await new Client(url).create<RaidState>(TRAINING_ROOM_NAME, options);
    try {
      await until(() => room.state?.players?.size > 0, "the training room's state");
      await sleep(1500);
      expect(room.state.players.size).toBe(1);
      expect([...room.state.players.values()].some((p) => p.bot)).toBe(false);
      expect(serverRoom(room.roomId).bots).toBeUndefined();
    } finally {
      await room.leave(true).catch(() => {});
      await until(() => server.profiles.size === 0, "the training seat to be freed");
    }
  });

  it("was quiet: no uncaught error, nothing logged as an error", async () => {
    await server.stop();
    stopped = true;
    expect(fatal).toEqual([]);
    expect(errorSpy.mock.calls).toEqual([]);
  });
});
