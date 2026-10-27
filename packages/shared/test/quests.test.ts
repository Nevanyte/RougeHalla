// The quest catalog, reward maths and contract-driven placement. Dense seeds 7829/10760 pin the placement fallbacks.
import { beforeAll, describe, expect, it } from "vitest";
import { buffDef, buffText, rewardCurve } from "../src/buffs";
import {
  QUEST_COUNT, QUEST_FETCH_MIN_TILES, QUEST_GV_CAP, QUEST_KNOWN_COUNT, QUEST_NPC_GAP_TILES,
  QUEST_NPC_SPAWN_MIN_TILES, QUEST_REVEAL_HEAD_START_MS, QUEST_UNKNOWN_COUNT, TILE,
} from "../src/constants";
import { circleClear } from "../src/geometry";
import {
  TILE_WALL, mapFromTiles, moveComponents, tileIndex, tileToWorldCenter, worldToTile, type CampDef, type GameMap,
} from "../src/map";
import { generateMap } from "../src/mapgen";
import { mulberry32 } from "../src/rng";
import { QuestState, RaidState } from "../src/schema";
import { TERRAIN_NONE, terrainAt } from "../src/terrain";
import {
  npcCandidates, parityGv, parityStacks, placeQuests, QUEST_DEFS, questDefById, questRewardStacks,
  questRewardText, selectQuests, spreadSpots, type QuestPlacement, type RosterEntry,
} from "../src/quests";

describe("the catalog", () => {
  it("has 20 data-driven quests with unique ids, at least five of each kind", () => {
    expect(QUEST_DEFS.length).toBe(20);
    expect(new Set(QUEST_DEFS.map((d) => d.id)).size).toBe(20);
    for (const kind of ["kill", "collect", "fetch"] as const) {
      expect(QUEST_DEFS.filter((d) => d.kind === kind).length).toBeGreaterThanOrEqual(5);
    }
    expect(questDefById("cull-fire")?.giver).toBeTruthy();
    expect(questDefById("nope")).toBeUndefined();
  });

  it("pays every reward inside the time-parity band of its objective and travel (a player kill has no mob parity)", () => {
    for (const d of QUEST_DEFS) {
      if (d.players) continue;
      const stacks = parityStacks(d.objSec, d.travelSec);
      const gv = parityGv(d.objSec, d.travelSec);
      expect(d.reward.stacks / stacks, `${d.id} stacks`).toBeGreaterThanOrEqual(0.7);
      expect(d.reward.stacks / stacks, `${d.id} stacks`).toBeLessThanOrEqual(1.35);
      expect(d.reward.gv / gv, `${d.id} gv`).toBeGreaterThanOrEqual(0.7);
      expect(d.reward.gv / gv, `${d.id} gv`).toBeLessThanOrEqual(1.35);
    }
  });

  it("pays a real, currently applicable buff from each quest's far zone", () => {
    for (const d of QUEST_DEFS) {
      const buff = buffDef(d.reward.buff);
      expect(buff, d.id).toBeDefined();
      expect(buff!.zone, d.id).toBe(d.farZone);
      expect(buff!.needs, `${d.id} reward must not be inert catalog-only text`).toBeUndefined();
      if (d.region) expect(d.farZone, d.id).toBe(d.region);
    }
  });

  it("makes nominal reward text useful to both the planning screen and quest log", () => {
    for (const d of QUEST_DEFS) {
      const buff = buffDef(d.reward.buff)!;
      const text = questRewardText(d);
      expect(text, d.id).toContain(buff.name);
      expect(text, d.id).toContain(buffText(buff.id, d.reward.stacks));
      expect(text, d.id).toContain(`${d.reward.gv} GV`);
    }
    expect(questRewardText(questDefById("cull-fire")!)).toBe("7 Ember Imp stacks (+20.7% damage) and 10 GV");
  });

  it("scales only the buff stacks through the mob feed curve", () => {
    for (const d of QUEST_DEFS) {
      expect(questRewardStacks(d, 0), d.id).toBeCloseTo(d.reward.stacks * rewardCurve(0), 12);
      expect(questRewardStacks(d, 12), d.id).toBeCloseTo(d.reward.stacks * rewardCurve(12), 12);
      expect(questRewardStacks(d, 12), d.id).toBeLessThan(questRewardStacks(d, 0));
    }
  });

  it("never offers more time than the patience timer would (every quest expires within five minutes)", () => {
    for (const d of QUEST_DEFS) expect(d.expiresAtSec, d.id).toBeLessThanOrEqual(300);
  });

  it("scatters more tokens than a collect quest asks for, so one rival picking can't starve the offer", () => {
    for (const d of QUEST_DEFS) {
      if (d.kind !== "collect") continue;
      expect(d.tokenSpawns ?? 0, d.id).toBeGreaterThan(d.count);
    }
  });
});

describe("the roster", () => {
  it("offers QUEST_COUNT quests, five known and five unknown, at least two of each kind, no repeats", () => {
    const roster = selectQuests(mulberry32(7));
    expect(roster.length).toBe(QUEST_COUNT);
    expect(roster.filter((q) => q.known).length).toBe(QUEST_KNOWN_COUNT);
    expect(roster.filter((q) => !q.known).length).toBe(QUEST_UNKNOWN_COUNT);
    expect(QUEST_KNOWN_COUNT).toBe(5);
    expect(QUEST_UNKNOWN_COUNT).toBe(5);
    expect(new Set(roster.map((q) => q.def.id)).size).toBe(roster.length);
    for (const kind of ["kill", "collect", "fetch"] as const) {
      expect(roster.filter((q) => q.def.kind === kind).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is deterministic per random stream", () => {
    const a = selectQuests(mulberry32(42)).map((q) => `${q.def.id}:${q.known}`);
    const b = selectQuests(mulberry32(42)).map((q) => `${q.def.id}:${q.known}`);
    expect(a).toEqual(b);
  });
});

describe("hidden and reward wire contracts", () => {
  it("syncs only a numeric unknown count, with no hidden quest entries or known flag", () => {
    const state = new RaidState();
    state.unknownQuests = QUEST_UNKNOWN_COUNT;
    expect(state.unknownQuests).toBe(5);
    expect(state.quests.size).toBe(0);
    expect("known" in new QuestState()).toBe(false);
  });

  it("pins the K1 reveal head start and separate quest GV cap", () => {
    expect(QUEST_REVEAL_HEAD_START_MS).toBe(4000);
    expect(QUEST_GV_CAP).toBe(24);
  });
});

describe("placement", () => {
  const seeds = [...Array.from({ length: 30 }, (_, i) => i + 1), 1234, 7829, 10760];
  interface PlacementFixture {
    map: GameMap;
    roster: RosterEntry[];
    placements: QuestPlacement[];
    candidates: ReturnType<typeof npcCandidates>;
  }
  const fixtures = new Map<number, PlacementFixture>();
  const fixtureOf = (seed: number): PlacementFixture => {
    let fixture = fixtures.get(seed);
    if (!fixture) {
      const map = generateMap(seed);
      const roster = selectQuests(mulberry32(seed + 1));
      fixture = {
        map,
        roster,
        placements: placeQuests(map, roster, mulberry32(seed + 2)),
        candidates: npcCandidates(map),
      };
      fixtures.set(seed, fixture);
    }
    return fixture;
  };
  const tileDist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.max(Math.abs(worldToTile(a.x) - worldToTile(b.x)), Math.abs(worldToTile(a.y) - worldToTile(b.y)));

  beforeAll(() => {
    for (const seed of seeds) fixtureOf(seed);
  }, 120_000);

  it("puts every giver on safe plain floor, off starts and camps, out of the coliseum and spread apart", () => {
    for (const seed of seeds) {
      const { map, roster, placements } = fixtureOf(seed);
      expect(placements.length, `seed ${seed}`).toBe(roster.length);
      const rect = map.coliseum.rect;
      const components = moveComponents(map);
      const coliseumComponent = components[tileIndex(map, worldToTile(map.coliseum.centre.x), worldToTile(map.coliseum.centre.y))];
      for (const p of placements) {
        expect(circleClear(map, p.at, 12), `${p.def.id} on floor`).toBe(true);
        expect(terrainAt(map, p.at.x, p.at.y), `${p.def.id} off terrain`).toBe(TERRAIN_NONE);
        expect(components[tileIndex(map, worldToTile(p.at.x), worldToTile(p.at.y))], `${p.def.id} reachable`).toBe(coliseumComponent);
        for (const s of map.spawnPool) {
          expect(Math.hypot(s.x - p.at.x, s.y - p.at.y), `${p.def.id} off starts`).toBeGreaterThanOrEqual(Math.floor(QUEST_NPC_SPAWN_MIN_TILES / 2) * TILE);
        }
        for (const camp of map.camps) {
          expect(Math.hypot(camp.x - p.at.x, camp.y - p.at.y), `${p.def.id} outside ${camp.id}`).toBeGreaterThanOrEqual(camp.r + 3 * TILE);
        }
        const tx = Math.floor(p.at.x / TILE);
        const ty = Math.floor(p.at.y / TILE);
        const inColiseum = tx >= rect.x && tx < rect.x + rect.w && ty >= rect.y && ty < rect.y + rect.h;
        expect(inColiseum, `${p.def.id} out of the coliseum`).toBe(false);
      }
      const gap = Math.floor(QUEST_NPC_GAP_TILES / 2) * TILE;
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          expect(Math.hypot(placements[i]!.at.x - placements[j]!.at.x, placements[i]!.at.y - placements[j]!.at.y)).toBeGreaterThanOrEqual(gap);
        }
      }
    }
  });

  it("places enough reachable tokens and distant parcels off every camp chest and mob rest halo", () => {
    for (const seed of seeds) {
      const { map, placements } = fixtureOf(seed);
      const components = moveComponents(map);
      for (const p of placements) {
        const pieces = [...(p.tokens ?? []), ...(p.parcel ? [p.parcel] : [])];
        if (p.def.kind === "collect") expect(p.tokens!.length, p.def.id).toBeGreaterThanOrEqual(p.def.count);
        if (p.def.kind === "fetch") {
          expect(p.parcel, p.def.id).toBeDefined();
          expect(tileDist(p.parcel!, p.at), `${p.def.id} parcel far away`).toBeGreaterThanOrEqual(QUEST_FETCH_MIN_TILES);
        }
        const giverComponent = components[tileIndex(map, worldToTile(p.at.x), worldToTile(p.at.y))];
        for (const piece of pieces) {
          expect(circleClear(map, piece, 12), `${p.def.id} piece on floor`).toBe(true);
          expect(components[tileIndex(map, worldToTile(piece.x), worldToTile(piece.y))], `${p.def.id} piece reachable`).toBe(giverComponent);
          for (const camp of map.camps) {
            expect(tileDist(piece, camp.chest), `${p.def.id} off ${camp.id} chest`).toBeGreaterThan(1);
            for (const spot of camp.spots) {
              expect(tileDist(piece, spot), `${p.def.id} off ${camp.id} mob rest`).toBeGreaterThan(2);
            }
          }
        }
      }
    }
  });

  it("sends a region-themed quest's giver to the far side of the map from that region's pole", () => {
    for (const seed of seeds) {
      const { map, placements, candidates } = fixtureOf(seed);
      const seen = new Set<string>();
      for (const p of placements) {
        if (!p.def.region || seen.has(p.def.region)) continue;
        seen.add(p.def.region);
        const pole = map.regions.find((r) => r.id === p.def.region)!.pole;
        const best = Math.max(...candidates.map((c) => Math.hypot(c.x - pole.x, c.y - pole.y)));
        const d = Math.hypot(p.at.x - pole.x, p.at.y - pole.y);
        expect(d, `${p.def.id} across from ${p.def.region}`).toBeGreaterThanOrEqual(best * 0.6);
      }
    }
  });

  it("returns quest ids in privately shuffled order rather than region-themed order", () => {
    const interleaved = seeds.some((seed) => {
      const themed = fixtureOf(seed).placements.map((p) => !!p.def.region);
      return themed.some((region, i) => !region && themed.slice(i + 1).some(Boolean));
    });
    expect(interleaved).toBe(true);
  });

  it("allows identical public giver positions with different hidden sets", () => {
    const w = 80;
    const tiles = new Uint8Array(w * 3).fill(TILE_WALL);
    for (let i = 0; i < 12; i++) tiles[w + 2 + i * 6] = 0;
    tiles[w + 75] = 0;
    const map = mapFromTiles(w, 3, tiles);
    const campAt = { x: tileToWorldCenter(75), y: tileToWorldCenter(1) };
    const camp: CampDef = {
      id: "fire-1", zone: "fire", ...campAt, r: 0, spots: [], eliteSpot: -1, chest: campAt, area: 1, radius: 0,
    };
    map.camps.push(camp);
    const def = questDefById("headhunter")!;
    const roster: RosterEntry[] = Array.from({ length: QUEST_COUNT }, (_, i) => ({ def, known: i < QUEST_KNOWN_COUNT }));
    const positionSet = (placements: QuestPlacement[]): string => placements
      .map((p) => `${worldToTile(p.at.x)},${worldToTile(p.at.y)}`).sort().join(";");
    const seen = new Map<string, { hidden: string; stream: number }>();
    let pair: { a: number; b: number } | null = null;
    for (let stream = 1; stream <= 512 && !pair; stream++) {
      const placements = placeQuests(map, roster, mulberry32(stream));
      const known = positionSet(placements.filter((p) => p.known));
      const hidden = positionSet(placements.filter((p) => !p.known));
      const previous = seen.get(known);
      if (previous && previous.hidden !== hidden) pair = { a: previous.stream, b: stream };
      else if (!previous) seen.set(known, { hidden, stream });
    }
    if (!pair) throw new Error("no deterministic stream pair with equal public positions found");
    const a = placeQuests(map, roster, mulberry32(pair.a));
    const b = placeQuests(map, roster, mulberry32(pair.b));
    expect(positionSet(a.filter((p) => p.known))).toBe(positionSet(b.filter((p) => p.known)));
    expect(positionSet(a.filter((p) => !p.known))).not.toBe(positionSet(b.filter((p) => !p.known)));
  });

  it("does not read legacy spawns, regionGrid or region anchors", () => {
    const map = fixtureOf(7).map;
    const contractOnly: GameMap = {
      ...map,
      spawns: [],
      regionGrid: new Uint8Array(map.w * map.h),
      regions: map.regions.map((r) => ({ ...r, anchor: { x: 0, y: 0 } })),
    };
    const roster = selectQuests(mulberry32(8));
    expect(placeQuests(contractOnly, roster, mulberry32(9))).toEqual(placeQuests(map, roster, mulberry32(9)));
  });

  it("keeps bare hand-built maps quest-free and handles an empty spread request", () => {
    expect(placeQuests(mapFromTiles(20, 20, new Uint8Array(400)), selectQuests(mulberry32(1)), mulberry32(2))).toEqual([]);
    expect(spreadSpots([{ x: 32, y: 32 }], 0, () => { throw new Error("must not draw"); })).toEqual([]);
  });
});
