import { describe, expect, it } from "vitest";
import {
  blinkLanding, mapFromTiles, mulberry32, questDefById, SWARM_CAST_MS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL,
  type FactionId, type GameMap, type Vec2,
} from "@raid/shared";
import type { PlayerState } from "@raid/shared/schema";
import { teleportToColiseum } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { handlePickup } from "../src/sim/loot";
import { offerQuest, type QuestRuntime } from "../src/sim/quests";
import { isHidden } from "../src/sim/status";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";
import { accept } from "./support/questRig";

const PARCEL = { x: 20 * TILE, y: 6 * TILE };

function arenaMap(): GameMap {
  const side = 30;
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return {
    ...mapFromTiles(side, side, tiles),
    spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })),
  };
}

function makeRun(faction: FactionId): World {
  const config: SimConfig = {
    minPlayers: 2,
    lobbySeconds: 15,
    fillSeconds: 0,
    patienceSeconds: 3600,
    patienceMinSeconds: 3600,
    suddenDeathSeconds: 3600,
    mobs: false,
    quests: true,
    wishLockSeconds: 0,
  };
  const world = createGameWorld({ config, random: mulberry32(8), rewardSalt: 71, map: arenaMap() });
  addPlayer(world, "p0", "alice", { faction });
  addPlayer(world, "p1", "bob", { faction: "frost" });
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  for (const p of world.state.players.values()) {
    p.maxHp = 1e9;
    p.hp = 1e9;
  }
  return world;
}

const P = (world: World, id = "p0"): PlayerState => world.state.players.get(id)!;

function place(world: World, id: string, at: Vec2): void {
  const c = combatant(world, id)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: world.state.serverTime, x: at.x, y: at.y }];
}

function carrying(world: World): QuestRuntime {
  const qt = offerQuest(world, questDefById("banner-frost")!, true, { at: { x: 6 * TILE, y: 6 * TILE }, parcel: PARCEL });
  accept(world, qt);
  place(world, "p0", PARCEL);
  step(world, TICK_MS);
  step(world, TICK_MS);
  const player = combatant(world, "p0")!;
  if (player.kind !== "player") throw new Error("player missing");
  handlePickup(world, player, { kind: "pickup", containerId: qt.containers[0]! });
  expect(qt.s.carrier).toBe("p0");
  expect(world.quests!.carried.get("p0")).toBe(qt.id);
  expect(world.state.containers.size).toBe(0);
  return qt;
}

function cast(world: World, x: number, y: number): void {
  expect(enqueueClientMessage(world.players.get("p0")!.inputs, "cast", { slot: "wish", x, y })).toBe(true);
}

/**
 * A carried parcel has no position of its own: everyone sees it at the player the synced quest row names as its carrier.
 * So what must hold is that the row names the carrier, that this player stands at `at` (a point the test worked out before
 * the step or from the shared blink rule, never read back from the player it is compared with), that the sim's carried link
 * agrees, and that no parcel was left on the ground at the old place.
 */
function expectPublicParcelAt(world: World, qt: QuestRuntime, at: Vec2): void {
  const row = world.state.quests.get(qt.id);
  expect(row?.carrier, "the synced row names the carrier").toBe("p0");
  const carrier = world.state.players.get(row!.carrier);
  expect(carrier, "and that carrier is a player in the room").toBeDefined();
  expect({ x: carrier!.x, y: carrier!.y }).toEqual(at);
  expect(world.quests!.carried.get("p0")).toBe(qt.id);
  expect([...world.state.containers.values()].some((c) => c.kind === "quest")).toBe(false);
}

/** The parcel goes where the carrier goes: move the carrier somewhere new and the same synced row follows it there. */
function expectParcelFollows(world: World, qt: QuestRuntime): void {
  const to = { x: 9 * TILE, y: 21 * TILE };
  place(world, "p0", to);
  step(world, TICK_MS);
  expectPublicParcelAt(world, qt, to);
}

describe("quest parcel carriers", () => {
  it("keeps the parcel and its public carrier position through Swarm", () => {
    const world = makeRun("plague");
    const qt = carrying(world);
    const at = { x: P(world).x, y: P(world).y }; // Swarm does not move the caster
    cast(world, at.x, at.y);
    step(world, TICK_MS);
    const landsAt = world.players.get("p0")!.cast!.landsAt;
    while (world.state.serverTime < landsAt) step(world, TICK_MS);

    expect(isHidden(world, combatant(world, "p0")!)).toBe(true);
    expect(world.state.serverTime).toBeGreaterThanOrEqual(SWARM_CAST_MS);
    expectPublicParcelAt(world, qt, at);
    step(world, TICK_MS);
    expectPublicParcelAt(world, qt, at);
    expectParcelFollows(world, qt);
  });

  it("keeps the parcel at the carrier's new position after Blaze Step", () => {
    const world = makeRun("fire");
    const qt = carrying(world);
    const before = { x: P(world).x, y: P(world).y };
    const target = { x: before.x - 250, y: before.y };
    const landing = blinkLanding(world.map, false, before, target);
    expect(landing, "the arena lets the blink land").not.toBeNull();
    cast(world, target.x, target.y);
    step(world, TICK_MS);

    expect(Math.hypot(P(world).x - before.x, P(world).y - before.y)).toBeGreaterThan(100);
    expectPublicParcelAt(world, qt, landing!);
    expectParcelFollows(world, qt);
  });

  it("expires the quest and removes the carried parcel on the coliseum teleport", () => {
    const world = makeRun("fire");
    const qt = carrying(world);
    const before = { x: P(world).x, y: P(world).y };
    const npcId = qt.npcId;

    teleportToColiseum(world);

    expect(Math.hypot(P(world).x - before.x, P(world).y - before.y)).toBeGreaterThan(0);
    expect(world.state.inColiseum).toBe(true);
    expect(qt.s.status).toBe("expired");
    expect(qt.s.carrier).toBe("");
    expect(world.quests!.carried.size).toBe(0);
    expect(world.state.mobs.has(npcId)).toBe(false);
    expect([...world.state.containers.values()].some((c) => c.kind === "quest")).toBe(false);
    step(world, TICK_MS);
    expect(qt.s.status).toBe("expired");
  });
});
