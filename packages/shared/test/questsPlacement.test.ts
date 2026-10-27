// Quest placement rules that need a purpose-built map (an island, a hazard band, a camp whose spots lie outside its
// clearing) or an attacker's point of view (what the five public givers say about the five hidden ones). The generated-map
// checks (seeds 1..30 and more) live in quests.test.ts.
import { describe, expect, it, vi } from "vitest";
import { QUEST_COUNT, QUEST_KNOWN_COUNT, QUEST_NPC_GAP_TILES, QUEST_NPC_SPAWN_MIN_TILES, QUEST_REVEAL_RADIUS, TILE } from "../src/constants";
import {
  TILE_FLOOR, TILE_WALL, mapFromTiles, moveComponents, tileIndex, tileToWorldCenter, worldToTile, type CampDef, type GameMap,
} from "../src/map";
import { generateMap } from "../src/mapgen";
import { mulberry32 } from "../src/rng";
import { TERRAIN_EMBER, TERRAIN_NONE, terrainAt } from "../src/terrain";
import type { Vec2 } from "../src/messages";

// Counts findPath calls without changing them: placement must be flood-based, not a path search per candidate.
const pathCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("../src/pathfind", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/pathfind")>();
  return { ...real, findPath: (...args: Parameters<typeof real.findPath>) => { pathCalls.n++; return real.findPath(...args); } };
});

import { findPath } from "../src/pathfind";
import {
  npcCandidates, placeQuests, questDefById, questHomeComponent, QUEST_HIDDEN_START_CLEARANCES, selectQuests, spreadSpots,
  type QuestPlacement, type RosterEntry,
} from "../src/quests";

const QUEST_UNKNOWN = QUEST_COUNT - QUEST_KNOWN_COUNT;
const tileOf = (p: Vec2): string => `${worldToTile(p.x)},${worldToTile(p.y)}`;
const keyOf = (placements: readonly QuestPlacement[]): string =>
  placements.map((p) => `${p.def.id}@${tileOf(p.at)}[${(p.tokens ?? []).map(tileOf).join(" ")}|${p.parcel ? tileOf(p.parcel) : ""}]`).sort().join(";");
const tileDistance = (a: Vec2, b: Vec2): number =>
  Math.max(Math.abs(worldToTile(a.x) - worldToTile(b.x)), Math.abs(worldToTile(a.y) - worldToTile(b.y)));
const pieces = (p: QuestPlacement): Vec2[] => [...(p.tokens ?? []), ...(p.parcel ? [p.parcel] : [])];

/** A ten-quest roster covering every kind and every token and parcel style; the first five are the public ones. */
const ROSTER_IDS = [
  "headhunter", "ashcap-fire", "banner-frost", "cache", "elite-hunt",
  "tithe-rim", "bloom-plague", "banner-fire", "grand-tour", "long-haul",
];
const roster = (): RosterEntry[] => ROSTER_IDS.map((id, i) => ({ def: questDefById(id)!, known: i < QUEST_KNOWN_COUNT }));

interface ArenaOpts {
  w?: number;
  h?: number;
  /** x of a full-height wall column: the coliseum centre stays on its left, everything right of it is an island. */
  islandAt?: number;
  /** An ember band over these columns (inclusive), full height. */
  emberBand?: [number, number];
  camps?: CampDef[];
}

function campAt(
  zone: CampDef["zone"], index: number, tx: number, ty: number, r: number, spots?: Vec2[], chestAt?: [number, number],
): CampDef {
  const centre = { x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) };
  // Default: four rest spots two tiles diagonally from the centre (inside any clearing of three tiles or more).
  const rest = spots ?? [[-2, -2], [2, -2], [-2, 2], [2, 2]].map(([dx, dy]) => ({ x: tileToWorldCenter(tx + dx!), y: tileToWorldCenter(ty + dy!) }));
  const chest = chestAt ? { x: tileToWorldCenter(chestAt[0]), y: tileToWorldCenter(chestAt[1]) } : centre;
  return { id: `${zone}-${index}`, zone, ...centre, r, spots: rest, eliteSpot: -1, chest, area: 1, radius: r };
}

/** A walled rectangle of floor with the coliseum centre on the left half; quests need a camp, a pool entry or a region to exist. */
function arena(o: ArenaOpts = {}): GameMap {
  const w = o.w ?? 72;
  const h = o.h ?? 48;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  if (o.islandAt !== undefined) for (let y = 0; y < h; y++) tiles[y * w + o.islandAt] = TILE_WALL;
  const terrain = new Uint8Array(w * h);
  if (o.emberBand) {
    for (let y = 1; y < h - 1; y++) for (let x = o.emberBand[0]; x <= o.emberBand[1]; x++) terrain[y * w + x] = TERRAIN_EMBER;
  }
  const map = mapFromTiles(w, h, tiles, 0, terrain);
  map.coliseum.centre = { x: tileToWorldCenter(6), y: tileToWorldCenter(Math.floor(h / 2)) };
  map.camps = o.camps ?? [
    campAt("fire", 1, 12, 8, 3 * TILE), campAt("frost", 1, 20, 38, 3 * TILE), campAt("plague", 1, 30, 10, 3 * TILE),
    campAt("sentenced", 1, 46, 30, 3 * TILE), campAt("holy", 1, 60, 12, 3 * TILE), campAt("fire", 2, 56, 36, 3 * TILE),
  ];
  // Outer starts for the "rim" tokens (and the clearance givers keep from them).
  const rim: [number, number, CampDef["zone"]][] = [[3, 3, "fire"], [3, h - 4, "frost"], [w - 4, 3, "plague"], [w - 4, h - 4, "sentenced"], [w - 4, Math.floor(h / 2), "holy"], [Math.floor(w / 2), 3, "fire"]];
  map.spawnPool = rim.map(([tx, ty, zone]) => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty), zone }));
  return map;
}

const streams = (n: number): (() => number)[] => Array.from({ length: n }, (_, i) => mulberry32(1000 + i));

describe("reachability: players must be able to walk to every giver and piece", () => {
  it("never places a giver, token or parcel on a floor island the coliseum cannot reach", () => {
    const map = arena({ islandAt: 36 });
    const comps = moveComponents(map);
    const home = questHomeComponent(map);
    expect(home).toBeGreaterThanOrEqual(0);
    const at = (p: Vec2): number => comps[tileIndex(map, worldToTile(p.x), worldToTile(p.y))]!;
    // The island must hold plenty of otherwise-legal tiles, or the test proves nothing.
    let islandFloor = 0;
    for (let y = 1; y < map.h - 1; y++) for (let x = 37; x < map.w - 1; x++) if (comps[y * map.w + x]! >= 0 && comps[y * map.w + x] !== home) islandFloor++;
    expect(islandFloor).toBeGreaterThan(500);
    expect(npcCandidates(map).every((c) => at(c) === home)).toBe(true);
    let placed = 0;
    for (const random of streams(20)) {
      for (const p of placeQuests(map, roster(), random)) {
        placed++;
        expect(at(p.at), `${p.def.id} giver`).toBe(home);
        for (const piece of pieces(p)) expect(at(piece), `${p.def.id} piece`).toBe(home);
      }
    }
    expect(placed).toBeGreaterThan(100);
  });

  it("agrees with the pathfinder the sim walks with, and costs no path search per candidate", () => {
    const map = generateMap(5);
    pathCalls.n = 0;
    const placements = placeQuests(map, roster(), mulberry32(7));
    expect(placements.length).toBe(QUEST_COUNT);
    expect(pathCalls.n).toBe(0);
    for (const p of placements) {
      for (const spot of [p.at, ...pieces(p)]) {
        expect(findPath(map, map.coliseum.centre, spot).length, `${p.def.id} walkable from the coliseum`).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to the spawn pool's component when a hand-built centre is a wall, and to no restriction without either", () => {
    const wall = arena({ islandAt: 6 });
    // The coliseum centre sits on the wall column: no component there.
    wall.coliseum.centre = { x: tileToWorldCenter(6), y: tileToWorldCenter(24) };
    wall.spawnPool = [60, 61, 62].map((x) => ({ x: tileToWorldCenter(x), y: tileToWorldCenter(10), zone: "fire" as const }));
    const comps = moveComponents(wall);
    expect(questHomeComponent(wall)).toBe(comps[tileIndex(wall, 60, 10)]);
    wall.spawnPool = [];
    expect(questHomeComponent(wall)).toBe(-1);
    expect(npcCandidates(wall).length).toBeGreaterThan(0);
  });
});

describe("hazards and protected camp tiles", () => {
  it("keeps givers, tokens and parcels off zone hazard floor", () => {
    const map = arena({ emberBand: [20, 52] });
    let hazardTiles = 0;
    for (let y = 1; y < map.h - 1; y++) for (let x = 20; x <= 52; x++) if (terrainAt(map, tileToWorldCenter(x), tileToWorldCenter(y)) !== TERRAIN_NONE) hazardTiles++;
    expect(hazardTiles).toBeGreaterThan(1000);
    expect(npcCandidates(map).every((c) => terrainAt(map, c.x, c.y) === TERRAIN_NONE)).toBe(true);
    let placed = 0;
    for (const random of streams(20)) {
      for (const p of placeQuests(map, roster(), random)) {
        placed++;
        for (const spot of [p.at, ...pieces(p)]) expect(terrainAt(map, spot.x, spot.y), `${p.def.id}`).toBe(TERRAIN_NONE);
      }
    }
    expect(placed).toBeGreaterThan(100);
  });

  it("keeps givers three tiles off every camp's chest and mob rest tiles even when both lie outside the clearing", () => {
    // r is 0 and the chest is six tiles from the centre, so only the chest/spot clearances can keep a giver off them.
    const spots = (tx: number, ty: number): Vec2[] => [-4, 0, 4].map((dx) => ({ x: tileToWorldCenter(tx + dx), y: tileToWorldCenter(ty + 4) }));
    const camps = [campAt("fire", 1, 20, 12, 0, spots(20, 12), [26, 12]), campAt("frost", 1, 50, 30, 0, spots(50, 30), [44, 30])];
    const candidates = npcCandidates(arena({ camps }));
    expect(candidates.length).toBeGreaterThan(500);
    for (const camp of camps) {
      for (const c of candidates) {
        expect(Math.hypot(c.x - camp.chest.x, c.y - camp.chest.y), "off the chest").toBeGreaterThanOrEqual(3 * TILE);
        for (const s of camp.spots) expect(Math.hypot(c.x - s.x, c.y - s.y), "off the mob rest tiles").toBeGreaterThanOrEqual(3 * TILE);
      }
    }
  });

  it("keeps tokens and parcels one tile off a camp's chest and two off its mob rest tiles", () => {
    const camps = [
      campAt("fire", 1, 12, 8, 4 * TILE, undefined, [14, 8]), campAt("frost", 1, 20, 38, 4 * TILE), campAt("plague", 1, 30, 10, 4 * TILE, []),
      campAt("sentenced", 1, 46, 30, 4 * TILE), campAt("holy", 1, 60, 12, 4 * TILE), campAt("fire", 2, 56, 36, 4 * TILE),
    ];
    const map = arena({ camps });
    let checked = 0;
    for (const random of streams(12)) {
      for (const p of placeQuests(map, roster(), random)) {
        for (const piece of pieces(p)) {
          checked++;
          for (const camp of camps) {
            expect(tileDistance(piece, camp.chest), `${p.def.id} off ${camp.id}'s chest`).toBeGreaterThan(1);
            for (const s of camp.spots) expect(tileDistance(piece, s), `${p.def.id} off ${camp.id}'s rest tiles`).toBeGreaterThan(2);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("gives no two pieces, or a piece and a giver, the same tile", () => {
    for (const map of [arena(), arena({ w: 34, h: 12, camps: [campAt("fire", 1, 8, 5, 2 * TILE), campAt("frost", 1, 25, 6, 2 * TILE)] }), generateMap(2)]) {
      for (const random of streams(8)) {
        const seen = new Set<string>();
        for (const p of placeQuests(map, roster(), random)) {
          for (const spot of [p.at, ...pieces(p)]) {
            expect(seen.has(tileOf(spot)), `${p.def.id} shares ${tileOf(spot)}`).toBe(false);
            seen.add(tileOf(spot));
          }
        }
      }
    }
  });
});

describe("the hidden givers are not a function of the public ones", () => {
  const knownOf = (ps: readonly QuestPlacement[]): QuestPlacement[] => ps.filter((p) => p.known);
  const hiddenOf = (ps: readonly QuestPlacement[]): QuestPlacement[] => ps.filter((p) => !p.known);

  it("keeps the known positions fixed and varies the hidden ones with the hidden pass's own stream", () => {
    const map = generateMap(3);
    const base = placeQuests(map, roster(), mulberry32(11), { hiddenRandom: mulberry32(100) });
    const hiddenSets = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const other = placeQuests(map, roster(), mulberry32(11), { hiddenRandom: mulberry32(200 + i) });
      expect(keyOf(knownOf(other)), "same known stream, same public offers").toBe(keyOf(knownOf(base)));
      hiddenSets.add(keyOf(hiddenOf(other)));
    }
    // Twenty hidden streams, twenty different hidden layouts: the five public givers pin none of them down.
    expect(hiddenSets.size).toBe(20);
    expect(hiddenSets.has(keyOf(hiddenOf(base)))).toBe(false);
    // Nor do the hidden positions pile up near anything the known ones fix: they spread over the map.
    const spots = new Set<string>();
    for (let i = 0; i < 20; i++) for (const p of hiddenOf(placeQuests(map, roster(), mulberry32(11), { hiddenRandom: mulberry32(200 + i) }))) spots.add(tileOf(p.at));
    expect(spots.size).toBeGreaterThan(60);
  });

  it("keeps every hidden giver the relaxed gap away from the public ones, even on a cramped map", () => {
    const map = arena({ w: 40, h: 16, camps: [campAt("fire", 1, 10, 5, 2 * TILE), campAt("frost", 1, 30, 10, 2 * TILE)] });
    const gap = Math.floor(QUEST_NPC_GAP_TILES / 2) * TILE;
    let pairs = 0;
    for (const random of streams(30)) {
      const placed = placeQuests(map, roster(), random);
      for (const h of hiddenOf(placed)) for (const k of knownOf(placed)) {
        pairs++;
        expect(Math.hypot(h.at.x - k.at.x, h.at.y - k.at.y)).toBeGreaterThanOrEqual(gap);
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });

  /** The old layout: one secret first pick, then max-min greedy (each pick the candidate farthest from those taken) at the gap. */
  function maxMin(candidates: Vec2[], count: number, first: number): Vec2[] {
    const gap = QUEST_NPC_GAP_TILES * TILE;
    const minD = new Float64Array(candidates.length).fill(Infinity);
    const taken = [candidates[first]!];
    const touch = (t: Vec2): void => {
      for (let i = 0; i < candidates.length; i++) {
        const d = Math.hypot(t.x - candidates[i]!.x, t.y - candidates[i]!.y);
        if (d < minD[i]!) minD[i] = d;
      }
    };
    touch(taken[0]!);
    while (taken.length < count) {
      let pick = -1;
      let pickD = -1;
      for (let i = 0; i < candidates.length; i++) if (minD[i]! >= gap && minD[i]! > pickD) { pick = i; pickD = minD[i]!; }
      if (pick < 0) break;
      taken.push(candidates[pick]!);
      touch(candidates[pick]!);
    }
    return taken;
  }

  /**
   * The review's attack: read the public givers and the map, try every candidate as the one secret first pick, keep the
   * first picks whose max-min layout contains every public giver, and read the hidden ones off the rest of it.
   */
  function attack(candidates: Vec2[], count: number, known: Vec2[]): Vec2[][] {
    const knownKeys = new Set(known.map(tileOf));
    const recovered: Vec2[][] = [];
    for (let first = 0; first < candidates.length; first++) {
      const layout = maxMin(candidates, count, first);
      const keys = new Set(layout.map(tileOf));
      if (layout.length === count && [...knownKeys].every((k) => keys.has(k))) recovered.push(layout.filter((t) => !knownKeys.has(tileOf(t))));
    }
    return recovered;
  }

  it("defeats the first-pick brute force that recovered the old max-min layout (control: it still recovers that one)", () => {
    const map = arena({ w: 80, h: 56 });
    const candidates = npcCandidates(map);
    // Control: a layout that is a deterministic max-min greedy after one secret draw gives itself away.
    const oldLayout = maxMin(candidates, QUEST_COUNT, Math.floor(mulberry32(31)() * candidates.length));
    expect(oldLayout.length).toBe(QUEST_COUNT);
    const oldKnown = oldLayout.slice(0, QUEST_KNOWN_COUNT);
    const oldHidden = new Set(oldLayout.slice(QUEST_KNOWN_COUNT).map(tileOf));
    const hits = attack(candidates, QUEST_COUNT, oldKnown);
    expect(hits.some((h) => h.length === oldHidden.size && h.every((t) => oldHidden.has(tileOf(t)))), "the attack works on a max-min layout").toBe(true);

    // Treatment: the same attacker against placeQuests's public givers recovers none of the hidden ones.
    for (const seed of [1, 2, 3]) {
      const placed = placeQuests(map, roster(), mulberry32(seed));
      const known = knownOf(placed).map((p) => p.at);
      const hidden = new Set(hiddenOf(placed).map((p) => tileOf(p.at)));
      expect(hidden.size).toBe(QUEST_UNKNOWN);
      const found = attack(candidates, QUEST_COUNT, known);
      expect(found.some((h) => h.some((t) => hidden.has(tileOf(t)))), `seed ${seed}: a hidden giver recovered`).toBe(false);
    }
  });

  it("returns the offers in a private shuffle: neither region-themed offers nor known ones come first", () => {
    const map = generateMap(6);
    let themedFirst = 0;
    let knownFirst = 0;
    const runs = 40;
    for (let i = 0; i < runs; i++) {
      const placed = placeQuests(map, roster(), mulberry32(500 + i));
      const themed = placed.map((p) => !!p.def.region);
      if (themed.every((t, j) => j === 0 || !(t && !themed[j - 1]))) themedFirst++; // never a themed offer after a plain one
      if (placed.slice(0, QUEST_KNOWN_COUNT).every((p) => p.known)) knownFirst++;
    }
    // A shuffle lands in these orders about 1 time in 200 (the region-first sort did it every time).
    expect(themedFirst).toBeLessThan(runs / 4);
    expect(knownFirst).toBeLessThan(runs / 4);
  });
});

describe("hidden givers keep out of the reveal radius of every start", () => {
  const nearestStart = (map: GameMap, at: Vec2): number => Math.min(...map.spawnPool.map((s) => Math.hypot(at.x - s.x, at.y - s.y)));
  const clear = QUEST_REVEAL_RADIUS + 2 * TILE;

  it("never puts a hidden giver within the reveal radius plus two tiles of any spawn-pool member (seeds 1..30, all offers placed)", () => {
    let hidden = 0;
    let knownInside = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const map = generateMap(seed);
      const offers = selectQuests(mulberry32(seed + 1));
      const placed = placeQuests(map, offers, mulberry32(seed + 2));
      expect(placed.length, `seed ${seed}: no offer dropped`).toBe(offers.length);
      for (const p of placed) {
        if (p.known) {
          // The public givers keep only the ordinary start clearance: a third of them DO lie inside the reveal radius.
          expect(nearestStart(map, p.at), `seed ${seed}: ${p.def.id}`).toBeGreaterThanOrEqual(Math.floor(QUEST_NPC_SPAWN_MIN_TILES / 2) * TILE);
          if (nearestStart(map, p.at) < QUEST_REVEAL_RADIUS) knownInside++;
          continue;
        }
        hidden++;
        expect(nearestStart(map, p.at), `seed ${seed}: hidden ${p.def.id}`).toBeGreaterThanOrEqual(clear);
      }
    }
    expect(hidden).toBe(30 * QUEST_UNKNOWN);
    expect(knownInside, "the known givers are not subject to the hidden clearance").toBeGreaterThan(0);
  });

  it("leaves the known pass exactly as it was: the same known givers with or without any hidden offer in the roster", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const map = generateMap(seed);
      const offers = selectQuests(mulberry32(seed + 1));
      const full = placeQuests(map, offers, mulberry32(seed + 2)).filter((p) => p.known);
      const knownOnly = placeQuests(map, offers.filter((o) => o.known), mulberry32(seed + 2));
      expect(keyOf(full), `seed ${seed}`).toBe(keyOf(knownOnly));
    }
  });

  it("relaxes the clearance on a cramped map instead of dropping a hidden offer, and keeps the stricter one where there is room", () => {
    const roomy = arena();
    const cramped = arena({ w: 40, h: 16, camps: [campAt("fire", 1, 10, 5, 2 * TILE), campAt("frost", 1, 30, 10, 2 * TILE)] });
    // Control: the cramped map really has no ground beyond the strict clearance for the hidden offers.
    const beyond = npcCandidates(cramped).filter((c) => nearestStart(cramped, c) >= clear);
    expect(beyond.length).toBeLessThan(QUEST_UNKNOWN * 2);
    let relaxedPlaced = 0;
    for (const random of streams(10)) {
      for (const [map, strict] of [[roomy, true], [cramped, false]] as const) {
        const placed = placeQuests(map, roster(), random);
        const hidden = placed.filter((p) => !p.known);
        if (strict) {
          expect(hidden.length).toBe(QUEST_UNKNOWN);
          for (const h of hidden) expect(nearestStart(map, h.at)).toBeGreaterThanOrEqual(clear);
        } else {
          relaxedPlaced += hidden.length;
          expect(placed.filter((p) => p.known).length, "the known offers are placed as before").toBe(QUEST_KNOWN_COUNT);
        }
      }
    }
    expect(relaxedPlaced, "the hidden offers of a cramped map still get placed").toBeGreaterThan(0);
  });

  it("steps down from the reveal radius plus two tiles to none, strictest first", () => {
    expect([...QUEST_HIDDEN_START_CLEARANCES]).toEqual([clear, QUEST_REVEAL_RADIUS, QUEST_REVEAL_RADIUS / 2, 0]);
  });
});

describe("spreadSpots", () => {
  it("honours the spots it must avoid and still reaches for every other candidate", () => {
    const row: Vec2[] = Array.from({ length: 40 }, (_, i) => ({ x: tileToWorldCenter(i), y: tileToWorldCenter(1) }));
    const avoid = [{ x: tileToWorldCenter(20), y: tileToWorldCenter(1) }];
    for (const random of streams(10)) {
      const spots = spreadSpots(row, 4, random, avoid);
      expect(spots.length).toBeGreaterThan(0);
      for (const s of spots) expect(Math.abs(s.x - avoid[0]!.x)).toBeGreaterThanOrEqual(Math.floor(QUEST_NPC_GAP_TILES / 2) * TILE);
    }
  });
});
