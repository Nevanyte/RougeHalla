import { describe, expect, it } from "vitest";
import { mulberry32, QUEST_COUNT, QUEST_KNOWN_COUNT, TICK_MS } from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

const BASE: SimConfig = {
  minPlayers: 2,
  lobbySeconds: 15,
  fillSeconds: 0,
  patienceSeconds: 3600,
  patienceMinSeconds: 3600,
  suddenDeathSeconds: 60,
  mobs: false,
  quests: true,
  planSeconds: 10,
};

function planningWorld(planSeconds = 10): World {
  const world = createGameWorld({
    seed: 77,
    config: { ...BASE, planSeconds },
    random: mulberry32(78),
    rewardSalt: 9127,
  });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  const events = step(world, TICK_MS);
  expect(world.state.phase).toBe("planning");
  expect(events.some((e) => e.type === "planningStarted")).toBe(true);
  return world;
}

function finishPlanning(world: World): SimEvent[] {
  const events: SimEvent[] = [];
  while (world.state.phase === "planning") events.push(...step(world, TICK_MS));
  expect(world.state.phase).toBe("active");
  return events;
}

describe("quest planning", () => {
  it("rolls the full roster when planning starts but syncs only the known offers", () => {
    const world = planningWorld();

    expect(world.quests).not.toBeNull();
    expect(world.quests!.quests.size).toBe(QUEST_COUNT);
    expect(world.state.quests.size).toBe(QUEST_KNOWN_COUNT);
    expect(new Set([...world.state.quests.keys()])).toEqual(
      new Set([...world.quests!.quests.values()].filter((q) => q.published).map((q) => q.id)),
    );
    expect(world.state.mobs.size).toBe(0);
    expect([...world.state.containers.values()].some((c) => c.kind === "quest")).toBe(false);
  });

  it("does not reveal, expire, or otherwise advance quests during the planning freeze", () => {
    const world = planningWorld();
    const q = world.quests!;
    const unknown = [...q.quests.values()].find((qt) => !qt.published)!;
    const known = [...q.quests.values()].find((qt) => qt.published)!;
    const p = world.state.players.get("p0")!;
    p.x = unknown.s.x;
    p.y = unknown.s.y;
    known.s.expiresAt = world.state.serverTime + TICK_MS;

    for (let i = 0; i < 100; i++) step(world, TICK_MS);

    expect(world.state.phase).toBe("planning");
    expect(q.quests.size).toBe(QUEST_COUNT);
    expect(q.quests.has(unknown.id)).toBe(true);
    expect(world.state.quests.has(unknown.id)).toBe(false);
    expect(world.state.quests.get(known.id)?.status).toBe("open");
    expect(world.state.quests.size).toBe(QUEST_KNOWN_COUNT);
  });

  it("anchors offer timers to the run start, not to the planning clock", () => {
    const world = planningWorld(1);
    finishPlanning(world);

    expect(world.state.raidStartedAt).toBeGreaterThan(1000);
    for (const qt of world.quests!.quests.values()) {
      expect(qt.s.expiresAt - world.state.raidStartedAt).toBe(qt.def.expiresAtSec * 1000);
    }
    expect(world.state.quests.size).toBe(QUEST_KNOWN_COUNT);
  });
});
