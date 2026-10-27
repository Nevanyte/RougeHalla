import { describe, expect, it } from "vitest";
import { generateMap, mulberry32, QUEST_ITEM_PREFIX, TICK_MS, type QuestKind } from "@raid/shared";
import { downPlayer, teleportToColiseum } from "../src/sim/arena";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { handlePickup } from "../src/sim/loot";
import type { QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, SimEvent, World } from "../src/sim/world";

// A real zone-shapes map (136x136, themed zones, a coliseum with gates), a real roster rolled by the room's own flow, the real
// pickup and turn-in rules. Hazards are off so a test that stands a player on a token cannot be burned out of it.
const MAP = generateMap(7);

function makeWorld(salt: number, patienceSeconds = 3600): World {
  const config: SimConfig = {
    minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds, patienceMinSeconds: patienceSeconds,
    firstPatienceSeconds: patienceSeconds, suddenDeathSeconds: 600, mobs: false, quests: true, hazards: false,
  };
  const world = createGameWorld({ map: MAP, config, random: mulberry32(salt), rewardSalt: [salt, 2, 3, 4] });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  return world;
}

/** The first world (salts 1.., all deterministic) whose five known offers include one of this kind. */
function worldWith(kind: QuestKind): { world: World; qt: QuestRuntime } {
  for (let salt = 1; salt < 80; salt++) {
    const world = makeWorld(salt);
    const qt = [...world.quests!.quests.values()].find((q) => q.published && q.def.kind === kind);
    if (qt) return { world, qt };
  }
  throw new Error(`no ${kind} offer among the first salts`);
}

const P = (w: World) => w.state.players.get("p0")!;
const questContainers = (w: World) => [...w.state.containers.values()].filter((c) => c.kind === "quest");
const questMobs = (w: World) => [...w.state.mobs.values()].filter((m) => m.kind === "quest");

function run(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) step(world, TICK_MS);
}

function take(world: World, containerId: string): void {
  const box = world.state.containers.get(containerId)!;
  P(world).x = box.x;
  P(world).y = box.y;
  run(world, 2);
  const c = combatant(world, "p0");
  if (!c || c.kind !== "player") throw new Error("player missing");
  handlePickup(world, c, { kind: "pickup", containerId });
}

describe("a quest through its whole life on a generated map", () => {
  it("is offered at raid start, collected, turned in and paid, and the rest close at the teleport", () => {
    const { world, qt } = worldWith("collect");
    const others = [...world.quests!.quests.values()].filter((q) => q !== qt);

    // Offered: a giver NPC and more tokens on the ground than the objective needs.
    expect(world.state.mobs.get(qt.npcId)?.kind).toBe("quest");
    expect(qt.containers.length).toBeGreaterThan(qt.def.count);
    expect(world.state.quests.get(qt.id)?.status).toBe("open");
    expect(world.state.unknownQuests).toBeGreaterThan(0);

    // Collected: ordinary pickups, counted for the picker alone.
    for (let i = 0; i < qt.def.count; i++) take(world, qt.containers[0]!);
    expect(qt.s.progress.get("p0")).toBe(qt.def.count);
    expect(qt.s.progress.get("p1") ?? 0).toBe(0);

    // Turned in: standing at the giver completes it, pays it, and takes the giver and the spare tokens away.
    P(world).x = qt.s.x;
    P(world).y = qt.s.y;
    const cardsBefore = P(world).build.get(qt.def.reward.card) ?? 0;
    step(world, TICK_MS);
    expect(qt.s.status).toBe("done");
    expect(qt.s.doneBy).toBe("alice");
    expect(world.players.get("p0")!.gv.quest).toBe(Math.min(qt.def.reward.gv, 24));
    expect(P(world).build.get(qt.def.reward.card) ?? 0).toBeGreaterThan(cardsBefore);
    expect(world.state.mobs.has(qt.npcId)).toBe(false);
    expect(qt.containers).toEqual([]);
    expect(questContainers(world).some((c) => c.items.at(0)?.def === QUEST_ITEM_PREFIX + qt.id)).toBe(false);

    // The teleport closes everything still open, unpaid: published rows expire, hidden offers vanish, nothing is left standing.
    const paid = world.players.get("p0")!.gv.quest;
    const open = others.filter((q) => q.s.status === "open" && q.published);
    expect(open.length).toBeGreaterThan(0);
    teleportToColiseum(world);
    for (const q of open) expect(q.s.status).toBe("expired");
    for (const q of others.filter((x) => !x.published)) expect(world.quests!.quests.has(q.id)).toBe(false);
    expect(world.state.unknownQuests).toBe(0);
    expect(questMobs(world)).toEqual([]);
    expect(questContainers(world)).toEqual([]);
    expect(world.quests!.carried.size).toBe(0);
    expect(world.players.get("p0")!.gv.quest).toBe(paid);

    // Twenty seconds later the closed rows leave the synced state and the runtime.
    run(world, 400);
    expect(world.state.quests.size).toBe(0);
    expect(world.quests!.quests.size).toBe(0);
  });

  it("closes everything when the patience timer teleports the lobby, and no scouting follows", () => {
    const world = makeWorld(1, 2);
    const hidden = [...world.quests!.quests.values()].filter((q) => !q.published);
    expect(hidden.length).toBeGreaterThan(0);
    expect(world.state.gatesLocked).toBe(false);

    const events: SimEvent[] = [];
    for (let i = 0; i < 200 && !world.state.gatesLocked; i++) events.push(...step(world, TICK_MS));
    expect(world.state.gatesLocked).toBe(true);

    expect(world.state.inColiseum).toBe(true);
    expect([...world.state.quests.values()].filter((q) => q.status === "open")).toEqual([]);
    expect(world.state.unknownQuests).toBe(0);
    expect(questMobs(world)).toEqual([]);
    expect(questContainers(world)).toEqual([]);

    // Every player now stands inside the gates; a giver they walk onto is no longer a discovery.
    for (const q of hidden) {
      P(world).x = q.s.x;
      P(world).y = q.s.y;
      events.length = 0;
      events.push(...step(world, TICK_MS));
      expect(events.some((e) => e.type === "questReveal")).toBe(false);
    }
    run(world, 400);
    expect(world.state.quests.size).toBe(0);
    expect(world.quests!.quests.size).toBe(0);
  });

  it("closes a carried parcel, the open rows and the hidden offers when the run ends", () => {
    const { world, qt } = worldWith("fetch");
    const hidden = [...world.quests!.quests.values()].filter((q) => !q.published);
    expect(hidden.length).toBeGreaterThan(0);

    take(world, qt.containers[0]!);
    expect(qt.s.carrier).toBe("p0");
    expect(world.quests!.carried.get("p0")).toBe(qt.id);

    // bob goes down: alice is the last one standing, so the next tick settles the run.
    downPlayer(world, world.state.players.get("p1")!, world.players.get("p1")!, "died");
    step(world, TICK_MS);
    expect(world.state.phase).toBe("ended");

    expect(qt.s.status).toBe("expired");
    expect(qt.s.carrier).toBe("");
    expect(world.quests!.carried.size).toBe(0);
    for (const q of hidden) expect(world.quests!.quests.has(q.id)).toBe(false);
    expect([...world.state.quests.values()].filter((q) => q.status === "open")).toEqual([]);
    expect(world.state.unknownQuests).toBe(0);
    expect(questMobs(world)).toEqual([]);
    expect(questContainers(world)).toEqual([]);
    expect(world.players.get("p0")!.gv.quest).toBe(0);
  });
});
