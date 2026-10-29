import { describe, expect, it } from "vitest";
import {
  mapFromTiles, mulberry32, questDefById, questRewardStats, QUEST_GV_CAP, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { createGameWorld } from "../src/sim/gameplay";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";
import { accept } from "./support/questRig";

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
  const world = createGameWorld({ config, random: mulberry32(100), rewardSalt: 123, map: openMap() });
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
  accept(world, qt);
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
  it("pays fixed normal-mob stat stacks, a completion toast, and the separate GV reward", () => {
    const world = makeRun();
    const qt = ready(world, "cull-fire");
    const reward = questRewardStats(qt.def);
    const events = complete(world, qt);
    expect(P(world).mobStats.get(reward.id)).toBe(reward.stacks);
    expect(P(world).build.size).toBe(0);
    expect(events.some((e) => e.type === "toast" && e.to === "p0" && e.text === `Quest complete: ${qt.def.name}`)).toBe(true);
    expect(RT(world).gv.quest).toBe(qt.def.reward.gv);
    step(world, TICK_MS);
    expect(P(world).mobStats.get(reward.id)).toBe(reward.stacks);
  });

  it("pays identical whole stacks regardless of feed or the lobby's catch-up gap", () => {
    for (const feed of [0, 5, 20]) {
      const world = makeRun(feed);
      world.state.players.get("p1")!.kills = 40;
      const qt = ready(world, "cull-fire");
      complete(world, qt);
      const reward = questRewardStats(qt.def);
      expect(P(world).mobStats.get(reward.id)).toBe(reward.stacks);
      expect(P(world).build.size).toBe(0);
    }
  });

  it("shares the mob's ten-stack cap and still awards GV when that stat is maxed", () => {
    const world = makeRun();
    P(world).mobStats.set("emberImp", 9);
    const qt = ready(world, "cull-fire");
    complete(world, qt);
    expect(P(world).mobStats.get("emberImp")).toBe(10);
    const second = ready(world, "cull-fire");
    complete(world, second);
    expect(P(world).mobStats.get("emberImp")).toBe(10);
    expect(P(world).build.size).toBe(0);
    expect(RT(world).gv.quest).toBe(qt.def.reward.gv * 2);
  });

  it("caps only the separate per-run quest GV pot at QUEST_GV_CAP", () => {
    const world = makeRun();
    expect(QUEST_GV_CAP).toBe(40);

    complete(world, ready(world, "cull-fire"));
    complete(world, ready(world, "cull-sentenced"));
    complete(world, ready(world, "cull-plague"));
    const events = complete(world, ready(world, "cull-frost"));

    expect(RT(world).gv.quest).toBe(QUEST_GV_CAP);
    expect(P(world).gv).toBe(QUEST_GV_CAP);
    const questGv = events.filter((e): e is Extract<SimEvent, { type: "gv" }> => e.type === "gv" && e.reason === "quest");
    expect(questGv.map((e) => e.amount)).toEqual([10]);
    expect(RT(world).gv.mobs).toBe(0);
    expect(RT(world).gv.kills).toBe(0);

    const more = complete(world, ready(world, "elite-hunt"));
    expect(more.some((e) => e.type === "gv" && e.reason === "quest" && e.amount > 0)).toBe(false);
    expect(RT(world).gv.quest).toBe(QUEST_GV_CAP);
  });
});
