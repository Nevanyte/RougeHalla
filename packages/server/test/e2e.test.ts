// The whole game, end to end: the real server in this process on a free port, a temp stash file, short
// timers, and four headless bots (src/bots) that play one complete raid by sending inputs only. Three
// play it out; the fourth walks out of the raid after its first take, which the server must settle as
// MIA. What is asserted is what must hold whoever wins: every player gets a result, each stash on the
// server is exactly what it should be (loot that was extracted is banked, everything else that was
// carried is gone), no item exists twice, the stats add up, and nothing blew up.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { matchMaker } from "@colyseus/core";
import {
  PROFILE_TOKEN_HEADER, ROOM_NAME, type ItemDTO, type ProfileResponse, type ProfileStats, type RaidOutcome, type RaidResult,
} from "@raid/shared";
import { BotClient, type BotRun } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";

const BOTS = 4;
/** Index of the bot that quits the raid with consent after its first take. */
const QUITTER = 0;
const OUTCOMES: readonly RaidOutcome[] = ["extracted", "died", "mia"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uids = (items: readonly ItemDTO[]): string[] => items.map((it) => it.uid).sort();

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

async function until(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
  }
}

let server: RaidServer;
let port = 0;
let dir = "";
let stashFile = "";
let stopped = false;
const fatal: string[] = [];
const onFatal = (err: unknown) => { fatal.push(err instanceof Error ? (err.stack ?? err.message) : String(err)); };
let errorSpy: MockInstance<typeof console.error>;

beforeAll(async () => {
  errorSpy = vi.spyOn(console, "error");
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", onFatal);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-e2e-"));
  stashFile = path.join(dir, "data", "stash.json");
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    port,
    stashFile,
    latencyMs: 0,
    minPlayers: BOTS,
    fillSeconds: 0,
    lobbySeconds: 3,
    raidSeconds: 45,
    extractSeconds: 2,
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

describe("headless bots play a full raid", () => {
  it("settles every bot exactly once and leaves the stashes consistent", async () => {
    const url = `http://127.0.0.1:${port}`;
    const names = Array.from({ length: BOTS }, (_, i) => `e2ebot${i + 1}`);
    const bots = names.map((_, i) => new BotClient({
      timeoutMs: 100_000,
      verbose: !!process.env.E2E_VERBOSE,
      ...(i === QUITTER ? { abandonAfterLoot: 1 } : {}),
    }));
    const quitter = bots[QUITTER]!;
    const players = names.map((_, i) => i).filter((i) => i !== QUITTER);
    const started = Date.now();

    // All four walk into the same lobby; the fourth one starts the raid.
    await Promise.all(bots.map((bot, i) => bot.connect(url, names[i]!)));
    expect(new Set(bots.map((b) => b.roomId)).size).toBe(1);
    const roomId = bots[0]!.roomId;
    // The loadout left the stash at join; whatever stayed home must survive the raid untouched.
    const leftBehind = names.map((n) => server.store.get(n)!.stash);

    const runs: BotRun[] = await Promise.all(bots.map((b) => b.run()));
    const seconds = (Date.now() - started) / 1000;

    // --- the quitter left on purpose and got no result (the server had dropped it before settling it)
    expect(runs[QUITTER]!.error, `${names[QUITTER]} failed`).toBeUndefined();
    expect(runs[QUITTER]!.abandoned, `${names[QUITTER]} never reached its first take, so it never quit`).toBe(true);
    expect(runs[QUITTER]!.result).toBeNull();
    expect(quitter.loadout.length, "the quitter brought something that can be lost").toBeGreaterThan(0);
    expect(quitter.looted.length, "the quitter took exactly one item").toBe(1);

    // --- everyone else got a result, and a sensible one. `resultsSeen` only counts what arrived while the
    // bot was still in the room, so it cannot see a duplicate sent after it left; a double settlement is
    // caught by `raids: 1` in the stats below.
    const results: Array<RaidResult | null> = runs.map((run) => run.result);
    for (const i of players) {
      const run = runs[i]!;
      expect(run.error, `${names[i]} failed`).toBeUndefined();
      expect(run.abandoned).toBeUndefined();
      expect(run.profile).toBe(names[i]);
      expect(run.result, `${names[i]} got no result`).not.toBeNull();
      expect(bots[i]!.resultsSeen, `${names[i]} result count`).toBe(1);
      expect(OUTCOMES).toContain(run.result!.outcome);
      expect(run.result!.profile).toBe(names[i]);
    }
    const played = (i: number): RaidResult => results[i]!;
    console.log(`[e2e] ${seconds.toFixed(1)}s ${names.map((n, i) => `${n}=${results[i]?.outcome ?? "quit"}`).join(" ")}`);
    const extractors = players.filter((i) => played(i).outcome === "extracted");
    expect(extractors.length).toBeGreaterThanOrEqual(1);

    // --- the stash each player can see over HTTP
    const stashes: ItemDTO[][] = [];
    const stats: ProfileStats[] = [];
    for (const [i, bot] of bots.entries()) {
      const res = await fetch(`${url}/api/profile/${names[i]}`, { headers: { [PROFILE_TOKEN_HEADER]: bot.token } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as ProfileResponse;
      stashes.push(body.profile.stash);
      stats.push(body.profile.stats);
    }

    // --- exact stashes: what stayed home, plus exactly what was carried out. Compared as sorted lists,
    // so a duplicate or a stray item fails as well as a missing one.
    for (const i of players) {
      const result = played(i);
      const banked = result.outcome === "extracted" ? result.extracted : [];
      expect(uids(stashes[i]!), `${names[i]} (${result.outcome}) stash`).toEqual(uids([...leftBehind[i]!, ...banked]));
      for (const it of result.lost) expect(uids(stashes[i]!), `${names[i]} lost ${it.def} is not in the stash`).not.toContain(it.uid);
      if (result.outcome !== "extracted") expect(result.extracted).toEqual([]);
      // Nothing that stayed home can also have been brought in.
      expect(result.broughtIn.every((it) => !leftBehind[i]!.some((l) => l.uid === it.uid))).toBe(true);
    }

    // --- loot reaches the stash: somebody left with something that was not in their loadout, and it is banked
    const looters = extractors.filter((i) => {
      const r = played(i);
      return r.extracted.some((it) => !r.broughtIn.some((b) => b.uid === it.uid));
    });
    expect(looters.length, "at least one extractor banked raid loot").toBeGreaterThanOrEqual(1);
    for (const i of looters) {
      const r = played(i);
      const loot = r.extracted.filter((it) => !r.broughtIn.some((b) => b.uid === it.uid));
      for (const it of loot) expect(uids(stashes[i]!), `${names[i]} banked looted ${it.def}`).toContain(it.uid);
    }

    // --- death loses it: the quitter was resolved as MIA the moment it left, so its stash is exactly what
    // stayed home, and neither its loadout nor its loot came back to it
    expect(uids(stashes[QUITTER]!), `${names[QUITTER]} (quit) stash`).toEqual(uids(leftBehind[QUITTER]!));
    expect(stats[QUITTER]).toMatchObject({ raids: 1, extracts: 0, deaths: 1 });
    expect(Number.isInteger(stats[QUITTER]!.kills) && stats[QUITTER]!.kills >= 0).toBe(true);
    // What it dropped is on a body anyone can loot: it is nowhere, unless another bot looted it and
    // extracted, in which case it is in exactly that bot's stash.
    for (const uid of [...quitter.loadout, ...quitter.looted]) {
      const holders = names.filter((_, i) => stashes[i]!.some((it) => it.uid === uid));
      const banked = players.filter((i) => played(i).outcome === "extracted" && played(i).extracted.some((it) => it.uid === uid));
      expect(holders, `who holds the quitter's item ${uid}`).toEqual(banked.map((i) => names[i]));
      expect(holders.length).toBeLessThanOrEqual(1);
    }

    // --- nothing duplicated, within a stash or across stashes
    const everyUid = stashes.flatMap((s) => s.map((it) => it.uid));
    expect(new Set(everyUid).size).toBe(everyUid.length);

    // --- stats follow the outcomes
    for (const i of players) {
      const result = played(i);
      const extracted = result.outcome === "extracted";
      expect(stats[i], names[i]).toEqual({
        raids: 1, extracts: extracted ? 1 : 0, deaths: extracted ? 0 : 1, kills: result.kills,
      });
    }

    // --- the file on disk says the same
    await server.store.flush();
    const onDisk = JSON.parse(fs.readFileSync(stashFile, "utf8")) as { profiles: Record<string, { stash: ItemDTO[] }> };
    for (const [i, name] of names.entries()) expect(onDisk.profiles[name]!.stash).toEqual(stashes[i]);

    // --- the raid is over: the room is gone and nobody is still marked as in a raid
    await until(() => matchMaker.getLocalRoomById(roomId) === undefined, "the room to be disposed");
    expect((await matchMaker.query({ name: ROOM_NAME })).length).toBe(0);
    await until(() => server.profiles.size === 0, "every profile to be free again");

    // --- and it was quiet
    await server.stop();
    stopped = true;
    expect(fatal).toEqual([]);
    expect(errorSpy.mock.calls).toEqual([]);
  }, 120_000);
});
