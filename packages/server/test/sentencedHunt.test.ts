import { describe, expect, it } from "vitest";
import { TICK_MS, TILE_FLOOR, TILE_WALL, mapFromTiles, mulberry32 } from "@raid/shared";
import { canPlayerSee, canPlayerSeeActor } from "../src/sim/vision";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { downPlayer } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { addPlayer, step } from "../src/sim/step";
import { handleHuntTarget, huntMoveMultiplier, install as installHunt } from "../src/sim/sentencedHunt";
import type { World } from "../src/sim/world";

function makeWorld(): World {
  const width = 80, height = 30;
  const tiles = new Uint8Array(width * height).fill(TILE_FLOOR);
  for (let x = 0; x < width; x++) tiles[x] = tiles[(height - 1) * width + x] = TILE_WALL;
  for (let y = 0; y < height; y++) tiles[y * width] = tiles[y * width + width - 1] = TILE_WALL;
  const map = mapFromTiles(width, height, tiles);
  map.spawns = [{ x: 200, y: 200 }, { x: 300, y: 200 }, { x: 400, y: 200 }];
  const world = createGameWorld({
    config: { minPlayers: 3, lobbySeconds: 0, fillSeconds: 0, patienceSeconds: 1e9, patienceMinSeconds: 1e9, suddenDeathSeconds: 1e9, pvpRules: false, mobs: false },
    random: mulberry32(13), map,
  });
  addPlayer(world, "hunter", "Hunter", { faction: "sentenced" });
  addPlayer(world, "rival", "Rival", { faction: "fire" });
  addPlayer(world, "other", "Other", { faction: "holy" });
  if (!world.actions.huntTarget) installHunt(world);
  step(world, TICK_MS);
  return world;
}

describe("Sentenced hunt", () => {
  it("validates a single living target, then clears and rewards only a real target death", () => {
    const world = makeWorld();
    const hunter = world.state.players.get("hunter")!;
    expect(enqueueClientMessage(world.players.get("hunter")!.inputs, "huntTarget", { id: "rival" })).toBe(true);
    step(world, TICK_MS);
    expect(hunter.huntTarget).toBe("rival");

    expect(enqueueClientMessage(world.players.get("hunter")!.inputs, "huntTarget", { id: "other" })).toBe(true);
    step(world, TICK_MS);
    expect(hunter.huntTarget).toBe("rival");
    expect(enqueueClientMessage(world.players.get("hunter")!.inputs, "huntTarget", { id: 5 })).toBe(false);

    const rival = world.state.players.get("rival")!;
    downPlayer(world, rival, world.players.get("rival")!, "died");
    expect(hunter.huntTarget).toBe("");
    expect(hunter.huntStacks).toBe(1);
    expect(world.state.players.get("other")!.huntStacks).toBe(0);
  });

  it("clears an MIA target without granting a hunt stack and clears the hunter's own lock on death", () => {
    const world = makeWorld();
    const hunter = world.state.players.get("hunter")!;
    hunter.huntTarget = "rival";
    downPlayer(world, world.state.players.get("rival")!, world.players.get("rival")!, "mia");
    expect(hunter.huntTarget).toBe("");
    expect(hunter.huntStacks).toBe(0);
    hunter.huntTarget = "other";
    downPlayer(world, hunter, world.players.get("hunter")!, "died");
    expect(hunter.huntTarget).toBe("");
    expect(hunter.huntStacks).toBe(0);
  });

  it("adds movement speed only along a route leg toward its tracked target", () => {
    const world = makeWorld();
    const hunter = world.state.players.get("hunter")!;
    hunter.huntTarget = "rival";
    hunter.x = 300; hunter.y = 400;
    const target = world.state.players.get("rival")!;
    target.x = 600; target.y = 400;
    const c = combatant(world, "hunter")!;
    c.rt.path = [{ x: 450, y: 400 }];
    expect(huntMoveMultiplier(world, c)).toBeCloseTo(1.05);
    c.rt.path = [{ x: 200, y: 400 }];
    expect(huntMoveMultiplier(world, c)).toBe(1);
    c.rt.path = [{ x: 300, y: 600 }];
    expect(huntMoveMultiplier(world, c)).toBe(1);
    c.rt.path = [];
    expect(huntMoveMultiplier(world, c)).toBe(1);
  });

  it("reveals only the selected actor through fog, not another actor at the same location", () => {
    const world = makeWorld();
    const hunter = world.state.players.get("hunter")!;
    const rival = world.state.players.get("rival")!;
    const other = world.state.players.get("other")!;
    hunter.x = 300; hunter.y = 400;
    rival.x = other.x = 2100; rival.y = other.y = 400;
    hunter.huntTarget = "rival";
    expect(canPlayerSee(world, "hunter", rival)).toBe(false);
    expect(canPlayerSeeActor(world, "hunter", "rival", rival)).toBe(true);
    expect(canPlayerSeeActor(world, "hunter", "other", other)).toBe(false);
    rival.status = "dead";
    expect(canPlayerSeeActor(world, "hunter", "rival", rival)).toBe(false);
  });
});
