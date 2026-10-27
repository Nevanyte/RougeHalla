// The quest stream and where the offers go, through the sim: quest rolls and placement draw only from the private quest
// stream (never rewardRandom or random), that stream is independent of the reward salt when the Room gives it its own, the
// hidden givers cannot be recomputed from the public seed and the five known ones, ids come out in a private shuffle, and
// every giver and piece on a generated map is a place players can walk to and nothing guards or burns. (questStream.test.ts
// holds the on/off invariance and the no-draw worlds; the pure placement rules are in shared/test/questsPlacement.test.ts.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findPath, generateMap, mapFromTiles, mulberry32, TERRAIN_NONE, terrainAt, TICK_MS, TILE, worldToTile, QUEST_COUNT, QUEST_KNOWN_COUNT, type GameMap, type Vec2,
} from "@raid/shared";
import { createGameWorld } from "../src/sim/gameplay";
import { spawnQuests, type QuestRuntime } from "../src/sim/quests";
import { addPlayer, step } from "../src/sim/step";
import type { SimConfig, World } from "../src/sim/world";

const config = (quests: boolean, planSeconds: number): SimConfig => ({
  minPlayers: 2, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
  suddenDeathSeconds: 600, mobs: true, quests, planSeconds,
});

interface Counted { random: () => number; calls: () => number }
function counted(seed: number): Counted {
  const base = mulberry32(seed);
  let n = 0;
  return { random: () => { n++; return base(); }, calls: () => n };
}

interface Build { map: GameMap; quests?: boolean; planSeconds?: number; rewardSalt?: number | number[]; questSalt?: number | number[]; random?: () => number }

function makeWorld(o: Build): World {
  const world = createGameWorld({
    map: o.map,
    config: config(o.quests ?? true, o.planSeconds ?? 0),
    random: o.random ?? mulberry32(100),
    rewardSalt: o.rewardSalt ?? [1, 2, 3, 4],
    ...(o.questSalt === undefined ? {} : { questSalt: o.questSalt }),
  });
  addPlayer(world, "p0", "alice");
  addPlayer(world, "p1", "bob");
  step(world, TICK_MS);
  return world;
}

const tileKey = (p: Vec2): string => `${worldToTile(p.x)},${worldToTile(p.y)}`;
const runtimeQuests = (w: World): QuestRuntime[] => [...(w.quests?.quests.values() ?? [])];

/** Every roster entry with its giver and pieces, hidden ones included, in a canonical order (not whether it has been revealed). */
function layout(world: World): string {
  return runtimeQuests(world)
    .map((qt) => `${qt.def.id}@${tileKey(qt.placement.at)}[${(qt.placement.tokens ?? []).map(tileKey).join(" ")}|${qt.placement.parcel ? tileKey(qt.placement.parcel) : ""}]`)
    .sort()
    .join(";");
}

const MAP = generateMap(7);

describe("the quest stream draws from nothing else", () => {
  it("takes the same number of draws from rewardRandom and from random with quests on and off", () => {
    for (const planSeconds of [0, 2]) {
      const counts = [true, false].map((quests) => {
        const random = counted(100);
        const world = createGameWorld({
          map: MAP, config: config(quests, planSeconds), random: random.random, rewardSalt: [1, 2, 3, 4],
        });
        let reward = 0;
        const rewardRandom = world.rewardRandom;
        world.rewardRandom = () => { reward++; return rewardRandom(); };
        addPlayer(world, "p0", "alice");
        addPlayer(world, "p1", "bob");
        for (let i = 0; i < 60; i++) step(world, TICK_MS);
        expect(runtimeQuests(world).length > 0, `quests ${quests}`).toBe(quests);
        return { reward, random: random.calls() };
      });
      expect(counts[0], `planSeconds ${planSeconds}`).toEqual(counts[1]);
    }
  });

  it.each([
    { name: "quests are off", quests: false, training: false, camps: true },
    { name: "the room is a training room", quests: true, training: true, camps: true },
    { name: "the map has no camps", quests: true, training: false, camps: false },
  ])("draws nothing from any of the three streams when $name", ({ quests, training, camps }) => {
    const map = camps ? MAP : mapFromTiles(12, 12, new Uint8Array(12 * 12));
    const run = (withQuests: boolean): { reward: number; random: number; quest: number; quests: boolean } => {
      const random = counted(100);
      const world = createGameWorld({
        map, config: { ...config(withQuests, 2), training }, random: random.random, rewardSalt: [1, 2, 3, 4],
      });
      let reward = 0;
      let quest = 0;
      const rewardRandom = world.rewardRandom;
      const questRandom = world.questRandom;
      world.rewardRandom = () => { reward++; return rewardRandom(); };
      world.questRandom = () => { quest++; return questRandom(); };
      addPlayer(world, "p0", "alice");
      addPlayer(world, "p1", "bob");
      for (let i = 0; i < 60; i++) step(world, TICK_MS);
      return { reward, random: random.calls(), quest, quests: world.quests !== null };
    };
    const on = run(quests);
    const off = run(false);
    expect(on.quest).toBe(0);
    expect(on.quests).toBe(false);
    expect({ reward: on.reward, random: on.random }).toEqual({ reward: off.reward, random: off.random });
  });

  it("rolls the roster and every position at planning start, and never again once the run is going", () => {
    const world = createGameWorld({
      map: MAP, config: config(true, 1), random: mulberry32(100), rewardSalt: [1, 2, 3, 4],
    });
    let draws = 0;
    const questRandom = world.questRandom;
    world.questRandom = () => { draws++; return questRandom(); };
    addPlayer(world, "p0", "alice");
    addPlayer(world, "p1", "bob");
    step(world, TICK_MS);
    expect(world.state.phase).toBe("planning");
    expect(runtimeQuests(world).length).toBe(QUEST_COUNT);
    expect(draws).toBeGreaterThan(0);
    const rolled = layout(world);
    const rolledDraws = draws;

    for (let i = 0; i < 40; i++) step(world, TICK_MS);
    expect(world.state.phase).toBe("active");
    spawnQuests(world); // a second call (the raid start makes one too) is a no-op
    for (let i = 0; i < 100; i++) step(world, TICK_MS);
    expect(draws).toBe(rolledDraws);
    expect(layout(world)).toBe(rolled);
  });

  it("gives a different quest layout for a different reward salt and the same layout for the same salt", () => {
    const a = layout(makeWorld({ map: MAP, rewardSalt: [11, 2, 3, 4] }));
    expect(a.length).toBeGreaterThan(0);
    expect(layout(makeWorld({ map: MAP, rewardSalt: [11, 2, 3, 4] }))).toBe(a);
    const others = new Set([12, 13, 14, 15, 16, 17].map((first) => layout(makeWorld({ map: MAP, rewardSalt: [first, 2, 3, 4] }))));
    expect(others.has(a)).toBe(false);
    expect(others.size).toBe(6);
    // Each salt word matters: a change anywhere in the four moves the layout (the quest salt is mixed from all of them).
    for (const salt of [[11, 9, 3, 4], [11, 2, 9, 4], [11, 2, 3, 9]]) {
      expect(layout(makeWorld({ map: MAP, rewardSalt: salt })), `salt ${salt}`).not.toBe(a);
    }
  });

  it("follows its own salt, not the reward salt, when the Room hands it one", () => {
    const base = layout(makeWorld({ map: MAP, rewardSalt: [1, 2, 3, 4], questSalt: [21, 22, 23, 24] }));
    expect(layout(makeWorld({ map: MAP, rewardSalt: [99, 98, 97, 96], questSalt: [21, 22, 23, 24] }))).toBe(base);
    expect(layout(makeWorld({ map: MAP, rewardSalt: [1, 2, 3, 4], questSalt: [21, 22, 23, 25] }))).not.toBe(base);
    // And the reward stream is the one it always was, whatever the quest salt.
    const rewards = (questSalt: number[]): number[] => {
      const world = makeWorld({ map: MAP, rewardSalt: [1, 2, 3, 4], questSalt });
      return [world.rewardRandom(), world.rewardRandom(), world.rewardRandom()];
    };
    expect(rewards([21, 22, 23, 24])).toEqual(rewards([5, 6, 7, 8]));
  });

  it("shares no state with the reward stream: its output is neither the reward stream's nor a shift of it", () => {
    for (const rewardSalt of [[1, 2, 3, 4], [1, 2, 3, 5], 77]) {
      const world = makeWorld({ map: MAP, quests: false, rewardSalt });
      const reward = Array.from({ length: 32 }, () => world.rewardRandom());
      const quest = Array.from({ length: 32 }, () => world.questRandom());
      expect(quest).not.toEqual(reward);
      for (let shift = 0; shift < 16; shift++) expect(quest.slice(shift, shift + 8)).not.toEqual(reward.slice(0, 8));
    }
  });

  it("is read by no quest code through rewardRandom, random or Math.random, and is seeded by the Room from its own crypto words", () => {
    const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const read = (rel: string): string => strip(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
    for (const file of ["../src/sim/quests.ts", "../../shared/src/quests.ts"]) {
      const code = read(file);
      expect(code, file).not.toMatch(/\brewardRandom\b/);
      expect(code, file).not.toMatch(/\bMath\.random\b/);
      expect(code, file).not.toMatch(/\bworld\.random\b/);
    }
    expect(read("../src/rooms/RaidRoom.ts")).toMatch(/questSalt:\s*Array\.from\(new Uint32Array\(randomBytes\(16\)\.buffer, 0, 4\)\)/);
  });
});

describe("the hidden offers cannot be recomputed", () => {
  const SALTS = Array.from({ length: 16 }, (_, i) => [200 + i, 2, 3, 4]);

  it("hands out ids in a private shuffle: neither theme nor the known/hidden split shows in their order", () => {
    const themedFirst = (flags: boolean[]): boolean => flags.every((region, i) => i === 0 || !(region && !flags[i - 1]));
    let informative = 0;
    let sorted = 0;
    let knownFirst = 0;
    for (const rewardSalt of SALTS) {
      const world = makeWorld({ map: MAP, rewardSalt });
      const inIdOrder = runtimeQuests(world); // the map keeps insertion order: the order the ids were handed out in
      expect(inIdOrder.length).toBe(QUEST_COUNT);
      const ids = inIdOrder.map((qt) => qt.id);
      expect(ids).toEqual([...ids].sort((a, b) => parseInt(a.slice(5), 36) - parseInt(b.slice(5), 36)));
      for (const known of [true, false]) {
        const flags = inIdOrder.filter((qt) => qt.published === known).map((qt) => !!qt.def.region);
        if (!flags.some(Boolean) || flags.every(Boolean)) continue;
        informative++;
        if (themedFirst(flags)) sorted++;
      }
      if (inIdOrder.slice(0, QUEST_KNOWN_COUNT).every((qt) => qt.published)) knownFirst++;
    }
    // A shuffle lands in these orders now and then (about one in ten per half, one in 250 for the split); a sort, always.
    expect(informative).toBeGreaterThan(12);
    expect(sorted).toBeLessThanOrEqual(Math.ceil(informative / 4));
    expect(knownFirst).toBeLessThanOrEqual(2);
  });

  it("does not let the map decide the hidden ones: over many salts the hidden positions spread out instead of repeating", () => {
    // (The exact claim, equal known positions with different hidden ones, is shared/test/questsPlacement.test.ts's.)
    const hidden = new Set<string>();
    let total = 0;
    for (const rewardSalt of SALTS) {
      for (const qt of runtimeQuests(makeWorld({ map: MAP, rewardSalt }))) {
        if (qt.published) continue;
        hidden.add(tileKey(qt.placement.at));
        total++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(60);
    expect(hidden.size).toBeGreaterThan(total * 0.8);
  });
});

describe("placement on generated maps, seen through the sim", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("puts every giver and piece of seed %i where players can walk and nothing guards or burns", (seed) => {
    const map = generateMap(seed);
    const world = makeWorld({ map, rewardSalt: [seed, 2, 3, 4] });
    const quests = runtimeQuests(world);
    expect(quests.length).toBe(QUEST_COUNT);
    for (const qt of quests) {
      const places: Vec2[] = [qt.placement.at, ...(qt.placement.tokens ?? []), ...(qt.placement.parcel ? [qt.placement.parcel] : [])];
      for (const at of places) {
        // The pathfinder the sim walks with: a path from where everyone is sent when the gates lock.
        expect(findPath(world.map, world.map.coliseum.centre, at).length, `${qt.def.id} walkable from the coliseum`).toBeGreaterThan(0);
        expect(terrainAt(world.map, at.x, at.y), `${qt.def.id} on plain floor`).toBe(TERRAIN_NONE);
        for (const camp of world.map.camps) {
          expect(Math.hypot(camp.chest.x - at.x, camp.chest.y - at.y), `${qt.def.id} off ${camp.id}'s chest`).toBeGreaterThan(TILE);
          for (const spot of camp.spots) expect(Math.hypot(spot.x - at.x, spot.y - at.y), `${qt.def.id} off ${camp.id}'s rest tiles`).toBeGreaterThan(TILE);
        }
      }
      for (const camp of world.map.camps) {
        const at = qt.placement.at;
        expect(Math.hypot(camp.x - at.x, camp.y - at.y), `${qt.def.id} giver outside ${camp.id}'s clearing`).toBeGreaterThanOrEqual(camp.r + 3 * TILE);
      }
    }
  });
});
