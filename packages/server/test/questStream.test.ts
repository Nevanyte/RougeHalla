import { describe, expect, it } from "vitest";
import { generateMap, mapFromTiles, mulberry32, TICK_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

function config(quests: boolean, planSeconds: number, training = false): SimConfig {
  return {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
    suddenDeathSeconds: 60, mobs: true, quests, planSeconds, training,
  };
}

function generatedWorld(map: ReturnType<typeof generateMap>, quests: boolean, planSeconds: number): World {
  const world = createGameWorld({
    map, config: config(quests, planSeconds), random: mulberry32(100), rewardSalt: [1, 2, 3, 4],
  });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  step(world, TICK_MS);
  return world;
}

function nextRewards(world: World): number[] {
  return [world.rewardRandom(), world.rewardRandom(), world.rewardRandom()];
}

describe("private quest randomness", () => {
  it.each([0, 2])("leaves the reward stream invariant with quests on and off at planSeconds=%i", (planSeconds) => {
    const map = generateMap(77);
    const on = generatedWorld(map, true, planSeconds);
    const off = generatedWorld(map, false, planSeconds);

    expect(on.state.phase).toBe(planSeconds === 0 ? "active" : "planning");
    expect(on.quests!.quests.size).toBeGreaterThan(0);
    expect(off.quests).toBeNull();
    expect(nextRewards(on)).toEqual(nextRewards(off));
  });

  it.each([
    { name: "off", quests: false, training: false },
    { name: "training", quests: true, training: true },
    { name: "no camps", quests: true, training: false },
  ])("creates no quest runtime and draws no quest randomness when $name", ({ quests, training }) => {
    const map = mapFromTiles(12, 12, new Uint8Array(12 * 12));
    const world = createGameWorld({
      map, config: config(quests, 0, training), random: mulberry32(100), rewardSalt: [1, 2, 3, 4],
    });
    let draws = 0;
    const random = world.questRandom;
    world.questRandom = () => { draws++; return random(); };
    addPlayer(world, "p0", "alice");
    addPlayer(world, "p1", "bob");

    step(world, TICK_MS);

    expect(draws).toBe(0);
    expect(world.quests).toBeNull();
    expect(world.state.quests.size).toBe(0);
  });
});
