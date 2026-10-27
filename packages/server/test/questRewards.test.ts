import { describe, expect, it } from "vitest";
import {
  buffDef, mapFromTiles, mulberry32, questDefById, QUEST_GV_CAP, rewardCurve, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { createGameWorld } from "../src/sim/gameplay";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

const GIVER: Vec2 = { x: 6 * TILE, y: 6 * TILE };

function openMap(side = 24) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return mapFromTiles(side, side, tiles);
}

function makeRun(feed = 0): World {
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
  P(world).kills = feed;
  return world;
}

const P = (world: World): PlayerState => world.state.players.get("p0")!;
const RT = (world: World) => world.players.get("p0")!;

function ready(world: World, defId: string): QuestRuntime {
  const qt = offerQuest(world, questDefById(defId)!, true, { at: GIVER });
  qt.s.progress.set("p0", qt.def.count);
  P(world).x = GIVER.x;
  P(world).y = GIVER.y;
  return qt;
}

function complete(world: World, qt: QuestRuntime): SimEvent[] {
  const events = step(world, TICK_MS);
  expect(qt.s.status).toBe("done");
  expect(qt.s.doneBy).toBe("alice");
  return events;
}

describe("quest rewards", () => {
  it("pays a real buff from the objective's far zone", () => {
    const world = makeRun();
    const qt = ready(world, "cull-fire");
    const reward = qt.def.reward;
    const before = P(world).buffs.get(reward.buff) ?? 0;

    complete(world, qt);

    expect(buffDef(reward.buff)?.zone).toBe(qt.def.farZone);
    expect(P(world).buffs.get(reward.buff)).toBeCloseTo(before + reward.stacks * rewardCurve(0), 5);
  });

  it("scales the buff grant by rewardCurve(feed), including a fed player's brake", () => {
    const hungry = makeRun(0);
    const fed = makeRun(20);
    const hungryQuest = ready(hungry, "cull-fire");
    const fedQuest = ready(fed, "cull-fire");

    complete(hungry, hungryQuest);
    complete(fed, fedQuest);

    const hungryStacks = P(hungry).buffs.get(hungryQuest.def.reward.buff)!;
    const fedStacks = P(fed).buffs.get(fedQuest.def.reward.buff)!;
    expect(hungryStacks).toBeCloseTo(hungryQuest.def.reward.stacks * rewardCurve(0), 5);
    expect(fedStacks).toBeCloseTo(fedQuest.def.reward.stacks * rewardCurve(20), 5);
    expect(fedStacks).toBeLessThan(hungryStacks * 0.5);
  });

  it("uses the feed brake without adding the mob catch-up multiplier", () => {
    const world = makeRun();
    world.state.players.get("p1")!.kills = 20;
    const qt = ready(world, "cull-fire");

    complete(world, qt);

    expect(P(world).buffs.get(qt.def.reward.buff)).toBeCloseTo(qt.def.reward.stacks * rewardCurve(0), 5);
  });

  it("caps only the separate per-run quest GV pot at QUEST_GV_CAP", () => {
    const world = makeRun();
    expect(QUEST_GV_CAP).toBe(24);

    complete(world, ready(world, "cull-fire"));
    complete(world, ready(world, "cull-sentenced"));
    const events = complete(world, ready(world, "cull-plague"));

    expect(RT(world).gv.quest).toBe(QUEST_GV_CAP);
    expect(P(world).gv).toBe(QUEST_GV_CAP);
    const questGv = events.filter((e): e is Extract<SimEvent, { type: "gv" }> => e.type === "gv" && e.reason === "quest");
    expect(questGv.map((e) => e.amount)).toEqual([4]);
    expect(RT(world).gv.mobs).toBe(0);
    expect(RT(world).gv.kills).toBe(0);

    const more = complete(world, ready(world, "elite-hunt"));
    expect(more.some((e) => e.type === "gv" && e.reason === "quest" && e.amount > 0)).toBe(false);
    expect(RT(world).gv.quest).toBe(QUEST_GV_CAP);
  });
});
