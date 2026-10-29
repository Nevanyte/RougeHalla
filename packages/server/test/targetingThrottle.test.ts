import { VISION_RADIUS, VISION_TRAIL_MS } from "@raid/shared";
import { getVisionMemory } from "../src/sim/vision";
// The target lock's path searches are throttled per player (sim/targeting.ts handleTarget): a `target` order may cost one
// search at most every TARGET_REPATH_MS, so a modified client spamming orders (up to MAX_ACTIONS_PER_TICK a tick) can't buy
// one per message, and the chase's own re-plan throttle survives a lock being set or dropped. Every search is counted
// through a wrapped findPath (the sim plans paths only through it).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapFromTiles, mulberry32, TARGET_REPATH_MS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, type GameMap, type Vec2,
} from "@raid/shared";
import { applyDamage } from "../src/sim/arena";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage, MAX_ACTIONS_PER_TICK } from "../src/sim/inputs";
import { addPlayer, step } from "../src/sim/step";
import type { World } from "../src/sim/world";

const searches = vi.hoisted(() => ({ n: 0 }));
vi.mock("@raid/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@raid/shared")>();
  return {
    ...mod,
    findPath: (...args: Parameters<typeof mod.findPath>) => {
      searches.n++;
      return mod.findPath(...args);
    },
  };
});

const W_TILES = 40;
const H_TILES = 20;

/** A walled room with a wall at tile column 12, rows 1..16: the far side is out of sight, reached round the bottom. */
function walledMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let x = 0; x < W_TILES; x++) { tiles[x] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + x] = TILE_WALL; }
  for (let y = 0; y < H_TILES; y++) { tiles[y * W_TILES] = TILE_WALL; tiles[y * W_TILES + W_TILES - 1] = TILE_WALL; }
  for (let y = 1; y <= 16; y++) tiles[y * W_TILES + 12] = TILE_WALL;
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (2 + i) * TILE, y: 18 * TILE })) };
}

const AT: readonly Vec2[] = [{ x: 300, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 220 }];

/** An active run: p0 west of the wall, p1 and p2 standing east of it, out of p0's sight. */
function world3(): World {
  const world = createGameWorld({
    seed: 7,
    config: { minPlayers: 3, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 3600 },
    random: mulberry32(8),
  }, { signatures: false });
  world.map = walledMap();
  for (let i = 0; i < 3; i++) {
    const p = addPlayer(world, `p${i}`, `player${i}`);
    p.faction = "plague";
    p.weapon0 = "sword";
  }
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  AT.forEach((at, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.maxHp = p.hp = 1e9;
    p.x = at.x;
    p.y = at.y;
    const rt = world.players.get(`p${i}`)!;
    rt.path = [];
    rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
  });
  // Visibility admits these previously discovered targets before the path-search throttle is exercised.
  const memory = getVisionMemory(world, "p0")!;
  memory.clear();
  memory.update(world.map, AT[1]!, world.state.serverTime, VISION_TRAIL_MS, VISION_RADIUS);
  return world;
}

const lockOf = (world: World): string | null => world.players.get("p0")!.weapon.lock;
function order(world: World, id: string): void {
  expect(enqueueClientMessage(world.players.get("p0")!.inputs, "target", { id })).toBe(true);
}

describe("lock-on path searches", () => {
  beforeEach(() => { searches.n = 0; });

  it("a single click on an enemy out of sight locks at once and walks the path its one search found", () => {
    const world = world3();
    searches.n = 0;
    order(world, "p1");
    step(world, TICK_MS);
    expect(lockOf(world)).toBe("p1");
    expect(world.state.players.get("p0")!.attackTarget).toBe("p1");
    expect(world.players.get("p0")!.path.length).toBeGreaterThan(0);
    expect(searches.n).toBe(1); // the order's search doubled as the chase's first plan
    step(world, TICK_MS);
    expect(world.state.players.get("p0")!.y).toBeGreaterThan(AT[0]!.y); // heading down to the gap
  });

  it("an order out of sight within TARGET_REPATH_MS of the last search is refused with nothing changed, and accepted after it", () => {
    const world = world3();
    order(world, "p1");
    step(world, TICK_MS);
    expect(lockOf(world)).toBe("p1");
    const t0 = world.state.serverTime;
    searches.n = 0;
    order(world, "p2");
    step(world, TICK_MS);
    expect(lockOf(world)).toBe("p1");
    expect(searches.n).toBe(0);
    while (world.state.serverTime < t0 + TARGET_REPATH_MS) step(world, TICK_MS);
    order(world, "p2");
    step(world, TICK_MS);
    expect(lockOf(world)).toBe("p2");
  });

  it("spamming orders out of sight (MAX_ACTIONS_PER_TICK a tick, two ids, with stops between) runs at most two searches per TARGET_REPATH_MS", () => {
    const world = world3();
    const ticks = 80;
    searches.n = 0;
    for (let k = 0; k < ticks; k++) {
      const q = world.players.get("p0")!.inputs;
      for (let i = 0; i < MAX_ACTIONS_PER_TICK; i++) order(world, i % 2 === 0 ? "p1" : "p2");
      // A stop dropped the lock and used to reset the chase's throttle.
      if (k % 2 === 1) expect(enqueueClientMessage(q, "stop", {})).toBe(true);
      step(world, TICK_MS);
    }
    const windows = Math.ceil((ticks * TICK_MS) / TARGET_REPATH_MS) + 1;
    // One for the orders and one for the chase's re-plans per window, at most; unthrottled it was one per order.
    expect(searches.n).toBeLessThanOrEqual(2 * windows);
    expect(searches.n).toBeLessThan((ticks * MAX_ACTIONS_PER_TICK) / 10);
  });

  it("the winner holds no lock once the run is over", () => {
    const world = world3();
    order(world, "p1");
    step(world, TICK_MS);
    expect(lockOf(world)).toBe("p1");
    for (const id of ["p1", "p2"]) {
      const p = world.state.players.get(id)!;
      applyDamage(world, p, world.players.get(id)!, p.hp + 1000, "test");
    }
    for (let i = 0; i < 3 && world.state.phase !== "ended"; i++) step(world, TICK_MS);
    expect(world.state.phase).toBe("ended");
    expect(lockOf(world)).toBeNull();
    expect(world.state.players.get("p0")!.attackTarget).toBe("");
  });
});
