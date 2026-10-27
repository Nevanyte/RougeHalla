import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, QUEST_REVEAL_RADIUS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, questDefById,
} from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { offerQuest } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

function openMap(side = 24) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return mapFromTiles(side, side, tiles);
}

function makeRun(): World {
  const config: SimConfig = {
    minPlayers: 2,
    lobbySeconds: 15,
    fillSeconds: 0,
    patienceSeconds: 3600,
    patienceMinSeconds: 3600,
    suddenDeathSeconds: 60,
    mobs: false,
    quests: true,
  };
  const world = createGameWorld({ seed: 99, config, random: mulberry32(100), rewardSalt: 123, map: openMap() });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

function offerHidden(world: World) {
  const def = questDefById("banner-frost")!;
  return offerQuest(world, def, false, { at: { x: 6 * TILE, y: 6 * TILE }, parcel: { x: 20 * TILE, y: 6 * TILE } });
}

function run(world: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...step(world, TICK_MS));
  return events;
}

describe("hidden quests", () => {
  it("keeps an unknown offer, its giver, and its parcel out of every synced collection", () => {
    const world = makeRun();
    const qt = offerHidden(world);

    expect(world.quests!.quests.get(qt.id)).toBe(qt);
    expect(world.state.quests.has(qt.id)).toBe(false);
    expect(world.state.quests.size).toBe(0);
    expect(world.state.unknownQuests).toBe(1);
    expect([...world.state.mobs.values()].filter((m) => m.kind === "quest")).toEqual([]);
    expect([...world.state.containers.values()].filter((c) => c.kind === "quest")).toEqual([]);
    const synced = JSON.stringify(world.state.toJSON());
    expect(synced).not.toContain(qt.id);
    expect(synced).not.toContain(qt.def.id);
    expect(synced).not.toContain(qt.def.giver);
  });

  it("gives only the finder a private discovery, then publishes after exactly four seconds", () => {
    const world = makeRun();
    const qt = offerHidden(world);
    for (const id of ["p0", "p1"]) {
      const p = world.state.players.get(id)!;
      p.x = qt.s.x + QUEST_REVEAL_RADIUS - 10;
      p.y = qt.s.y;
    }

    const discoveredAt = world.state.serverTime + TICK_MS;
    const first = step(world, TICK_MS);
    const privateDiscoveries = first.filter((e) => {
      const candidate = e as unknown as { type: string; to?: string };
      return candidate.type === "questReveal" && candidate.to === "p0";
    });
    expect(privateDiscoveries).toHaveLength(1);
    expect(JSON.stringify(privateDiscoveries[0])).toContain(qt.id);
    expect(JSON.stringify(privateDiscoveries[0])).toContain(qt.def.id);
    expect(first.some((e) => {
      const candidate = e as unknown as { type: string; to?: string };
      return candidate.type === "questReveal" && candidate.to === "p1";
    })).toBe(false);
    expect(world.state.quests.has(qt.id)).toBe(false);
    expect(world.state.unknownQuests).toBe(1);

    run(world, 79);
    expect(world.state.serverTime).toBe(discoveredAt + 3950);
    expect(world.state.quests.has(qt.id)).toBe(false);

    step(world, TICK_MS);
    expect(world.state.serverTime).toBe(discoveredAt + 4000);
    expect(world.state.quests.get(qt.id)?.def).toBe(qt.def.id);
    expect(world.state.quests.get(qt.id)?.status).toBe("open");
    expect(world.state.unknownQuests).toBe(0);
  });

  it("does not let a second scout shorten the finder's head start", () => {
    const world = makeRun();
    const qt = offerHidden(world);
    const p0 = world.state.players.get("p0")!;
    const p1 = world.state.players.get("p1")!;
    p0.x = qt.s.x;
    p0.y = qt.s.y;
    p1.x = -1000;
    p1.y = -1000;
    step(world, TICK_MS);
    run(world, 20);

    p1.x = qt.s.x;
    p1.y = qt.s.y;
    run(world, 59);
    expect(world.state.quests.has(qt.id)).toBe(false);
    step(world, TICK_MS);
    expect(world.state.quests.has(qt.id)).toBe(true);
  });
});
