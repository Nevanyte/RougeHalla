// The bots' chest hunt against the real server (roguelike R5): real sockets, real BotClients reading the real synced state
// (ArraySchema options, a MapSchema build), the real sim answering their `choose`. A natural run rarely clears a camp inside the
// e2e's patience, so the test clears the camp nearest to a bot itself, through the sim's own kill (campMobDied -> the
// `campCleared` hook -> the chest), and then only watches what the bots do about the chest: walk to it, ask once, take an option.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import { CHEST_SECONDS, findPath, nextRank, type Vec2 } from "@raid/shared";
import { BotClient } from "../src/bots/BotClient";
import { loadConfig } from "../src/config";
import { startServer, type RaidServer } from "../src/index";
import { chestSpot, rewardChests } from "../src/sim/chests";
import { combatant } from "../src/sim/combatant";
import { killMob, type MobCombatant } from "../src/sim/mobLife";
import type { World } from "../src/sim/world";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(20);
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

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

let server: RaidServer;
let dir = "";
let port = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "raid-botchests-"));
  port = await freePort();
  server = await startServer({
    ...loadConfig({}),
    mobs: true,
    quests: false,
    port,
    stashFile: path.join(dir, "data", "stash.json"),
    latencyMs: 0,
    minPlayers: 2,
    fillSeconds: 0,
    lobbySeconds: 30,
    planSeconds: 0,
    firstPatienceSeconds: 0,
    patienceSeconds: 600,
    patienceMinSeconds: 600,
    suddenDeathSeconds: 600,
  });
});

afterAll(async () => {
  try { await server.stop(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

describe("bots at a real camp chest", () => {
  it("walk to the chest of a camp that was cleared, ask once, and take an option the server grants", async () => {
    const a = new BotClient({ timeoutMs: 60_000, faction: "plague", verbose: !!process.env.E2E_VERBOSE });
    const b = new BotClient({ timeoutMs: 60_000, faction: "holy", verbose: !!process.env.E2E_VERBOSE });
    await a.connect(`http://127.0.0.1:${port}`, "chestbotA");
    await b.connect(`http://127.0.0.1:${port}`, "chestbotB");
    try {
      const room = matchMaker.getLocalRoomById(a.roomId) as unknown as { world: World };
      const world = room.world;
      await until(() => world.state.phase === "active", "the run to start");

      // The camp whose chest is the shortest walk from bot A: cleared at once, every member dying to the sim's own kill.
      const me = world.state.players.get(a.sessionId)!;
      let camp = -1;
      let shortest = Infinity;
      world.map.camps.forEach((def, i) => {
        const spot = chestSpot(world, i)!;
        const path = findPath(world.map, me, spot);
        let walk = 0;
        for (let k = 0, at: Vec2 = me; k < path.length; at = path[k]!, k++) walk += dist(at, path[k]!);
        if (path.length > 0 && walk < shortest) { shortest = walk; camp = i; }
      });
      expect(camp, "a camp A can walk to").toBeGreaterThanOrEqual(0);
      const ids = [...world.state.mobs.entries()].filter(([, m]) => m.camp === camp + 1 && m.status === "alive").map(([id]) => id);
      expect(ids.length, "the camp has its mobs").toBeGreaterThan(0);
      for (const id of ids) killMob(world, combatant(world, id) as MobCombatant, [], []);
      expect(world.state.camps[camp]!.state, "the camp is cleared").toBe(2);
      const chests = rewardChests(world);
      expect(chests, "its chest dropped").toHaveLength(1);
      const chest = chests[0]!;
      const dropped = Date.now();

      // A walks there (within its 15 s) and takes its pick: one `choose`, an option the server wrote into `takenBy`.
      await until(() => a.chestStats.taken + a.chestStats.skipped >= 1, "bot A to make its pick at the chest", (CHEST_SECONDS + 3) * 1000);
      expect(a.chestChoices.get(chest.id), "one choose for the chest").toBe(1);
      expect(a.sent.choose).toBe(1);
      expect(a.chestStats).toMatchObject({ seen: 1, tried: 1 });
      const pickers = [...chest.pickers];
      expect(pickers).toContain(a.sessionId);
      const mine = [...chest.takenBy].indexOf(a.sessionId);
      if (a.chestStats.taken === 1) {
        expect(mine, "the option A took is marked as A's").toBeGreaterThanOrEqual(0);
        const skill = chest.options[mine]!;
        expect(me.build.get(skill), `${skill} is in A's build`).toBe(1);
        expect(nextRank(me.build, skill)).toBe(2);
      }
      expect(Date.now() - dropped, "the pick came inside the chest's life").toBeLessThan(CHEST_SECONDS * 1000);

      // Nobody asks again, whatever the state shows afterwards.
      await sleep(1500);
      expect(a.sent.choose).toBe(1);
      expect(b.sent.choose).toBeLessThanOrEqual(1);
      for (const bot of [a, b]) for (const n of bot.chestChoices.values()) expect(n).toBe(1);
    } finally {
      for (const bot of [a, b]) (bot as unknown as { finish(run: null): void }).finish(null); // leave the room
      await Promise.all([a.run(), b.run()]);
    }
  }, 60_000);
});
