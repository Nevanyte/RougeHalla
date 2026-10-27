import { describe, expect, it } from "vitest";
import { Decoder, Encoder, Reflection } from "@colyseus/schema";
import type { RaidState } from "@raid/shared/schema";
import {
  mapFromTiles, mulberry32, QUEST_REVEAL_RADIUS, TICK_MS, TILE, TILE_FLOOR, TILE_WALL, questDefById,
} from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { offerQuest } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import { tieRank, type SimConfig, type SimEvent, type World } from "../src/sim/world";

function openMap(side = 24) {
  const tiles = new Uint8Array(side * side).fill(TILE_FLOOR);
  for (let i = 0; i < side; i++) {
    for (const [x, y] of [[i, 0], [i, side - 1], [0, i], [side - 1, i]] as const) tiles[y * side + x] = TILE_WALL;
  }
  return mapFromTiles(side, side, tiles);
}

function makeRun(players = 2): World {
  const config: SimConfig = {
    minPlayers: players,
    lobbySeconds: 15,
    fillSeconds: 0,
    patienceSeconds: 3600,
    patienceMinSeconds: 3600,
    suddenDeathSeconds: 60,
    mobs: false,
    quests: true,
  };
  const world = createGameWorld({ config, random: mulberry32(1), rewardSalt: 123, map: openMap() });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  if (players > 2) addPlayer(world, "p2", "carol");
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

  // step() raises the tick before the quest system reads the ranks, so the rank that decides the reveal is the NEXT tick's.
  function rankNextTick(world: World, id: string): number {
    const tick = world.state.tick;
    world.state.tick = tick + 1;
    try { return tieRank(world, id); } finally { world.state.tick = tick; }
  }
  /** Picks a secret salt under which `low` outranks `high` at the reveal tick. */
  function rig(world: World, low: string, high: string): void {
    for (let salt = 1; salt < 4000; salt++) {
      world.orderSalt = salt;
      if (rankNextTick(world, low) < rankNextTick(world, high)) return;
    }
    throw new Error("no salt found");
  }
  const revealsTo = (events: SimEvent[]): string[] =>
    events.flatMap((e) => (e.type === "questReveal" ? [e.to] : []));

  it.each([["p1", "p0"], ["p0", "p1"]])(
    "makes the lowest-tieRank player the finder, not the first to join: %s outranks %s",
    (low, high) => {
      const world = makeRun();
      const qt = offerHidden(world);
      for (const id of [low, high]) {
        const p = world.state.players.get(id)!;
        p.x = qt.s.x + QUEST_REVEAL_RADIUS - 10;
        p.y = qt.s.y;
      }
      rig(world, low, high);

      const first = step(world, TICK_MS);

      expect(revealsTo(first)).toEqual([low]);
      expect(qt.finder).toBe(low);
      expect(JSON.stringify(first.find((e) => e.type === "questReveal"))).toContain(qt.id);
      expect(world.state.quests.has(qt.id)).toBe(false);
    },
  );

  it("passes over a lower-ranked player who is out of range or down", () => {
    const world = makeRun(3);
    const near = world.state.players.get("p0")!;
    const far = world.state.players.get("p1")!;
    const dead = world.state.players.get("p2")!;
    const place = (p: typeof near, qt: { s: { x: number; y: number } }, dx: number): void => {
      p.x = qt.s.x + dx;
      p.y = qt.s.y;
    };

    const first = offerHidden(world);
    place(near, first, QUEST_REVEAL_RADIUS - 10);
    place(far, first, QUEST_REVEAL_RADIUS + 40);
    place(dead, first, -1000);
    rig(world, "p1", "p0");
    expect(revealsTo(step(world, TICK_MS))).toEqual(["p0"]);

    const second = offerHidden(world);
    place(near, second, QUEST_REVEAL_RADIUS - 10);
    place(far, second, -1000);
    place(dead, second, 0);
    dead.status = "dead";
    rig(world, "p2", "p0");
    expect(revealsTo(step(world, TICK_MS))).toEqual(["p0"]);
  });

  it("gives only the finder a private discovery, then publishes after exactly four seconds", () => {
    const world = makeRun();
    const qt = offerHidden(world);
    for (const id of ["p0", "p1"]) {
      const p = world.state.players.get(id)!;
      p.x = qt.s.x + QUEST_REVEAL_RADIUS - 10;
      p.y = qt.s.y;
    }
    rig(world, "p1", "p0");

    const discoveredAt = world.state.serverTime + TICK_MS;
    const events = step(world, TICK_MS);
    expect(revealsTo(events)).toEqual(["p1"]);
    expect(world.state.quests.has(qt.id)).toBe(false);
    expect(world.state.unknownQuests).toBe(1);

    // The other scout stands there the whole head start and never hears of it; only the finder is ever told.
    events.push(...run(world, 79));
    expect(world.state.serverTime).toBe(discoveredAt + 3950);
    expect(world.state.quests.has(qt.id)).toBe(false);

    events.push(...step(world, TICK_MS));
    expect(world.state.serverTime).toBe(discoveredAt + 4000);
    expect(revealsTo(events)).toEqual(["p1"]);
    expect(world.state.quests.get(qt.id)?.def).toBe(qt.def.id);
    expect(world.state.quests.get(qt.id)?.status).toBe("open");
    expect(world.state.unknownQuests).toBe(0);
    expect(events.some((e) => e.type === "toast" && e.to === null && e.text.includes("bob") && e.text.includes(qt.def.name))).toBe(true);
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

  it("keeps hidden offers out of the encoded wire state until publication", () => {
    const world = makeRun();
    const qt = offerHidden(world);
    const encoder = new Encoder(world.state);
    const decoder = Reflection.decode(Reflection.encode(encoder)) as Decoder<RaidState>;
    decoder.decode(encoder.encodeAll());

    expect(decoder.state.quests.has(qt.id)).toBe(false);
    expect([...decoder.state.mobs.values()].some((m) => m.kind === "quest")).toBe(false);
    expect([...decoder.state.containers.values()].some((c) => c.kind === "quest")).toBe(false);
    const p = world.state.players.get("p0")!;
    p.x = qt.s.x;
    p.y = qt.s.y;
    run(world, 81);
    decoder.decode(encoder.encode());

    expect(decoder.state.quests.get(qt.id)?.def).toBe(qt.def.id);
    expect(decoder.state.mobs.has(qt.npcId)).toBe(true);
    expect(decoder.state.containers.has(qt.containers[0]!)).toBe(true);
  });
});
