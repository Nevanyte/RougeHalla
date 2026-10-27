// The quest catalog, reward maths and contract-driven placement. Dense seeds 7829/10760 pin the placement fallbacks.
import { beforeAll, describe, expect, it } from "vitest";
import { cardDef, cardText, cardTitle } from "../src/cards";
import { rewardCurve } from "../src/rules";
import {
  QUEST_COUNT, QUEST_FETCH_MIN_TILES, QUEST_GV_CAP, QUEST_KNOWN_COUNT, QUEST_NPC_GAP_TILES,
  QUEST_NPC_SPAWN_MIN_TILES, QUEST_REVEAL_HEAD_START_MS, QUEST_REVEAL_RADIUS, QUEST_UNKNOWN_COUNT, TILE,
} from "../src/constants";
import { circleClear } from "../src/geometry";
import {
  MASK_MOVE, TILE_WALL, blocksTile, mapFromTiles, moveComponents, tileIndex, tileToWorldCenter, worldToTile, type CampDef, type GameMap,
} from "../src/map";
import { generateMap } from "../src/mapgen";
import { mulberry32 } from "../src/rng";
import { QuestState, RaidState } from "../src/schema";
import { TERRAIN_NONE, terrainAt } from "../src/terrain";
import {
  CAMP_SECONDS, CARD_TIER_RATE, npcCandidates, parityGv, placeQuests, QUEST_DEFS, QUEST_FEED_BRAKE, questBase, questDefById,
  questRewardCard, questRewardText, questTier, questTierPoints, selectQuests, spreadSpots, STACK_PREMIUM, type QuestPlacement,
  type RosterEntry,
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

  /** BALANCE_CONTRACT 8.4's table: quest -> [tier points, card, GV]. The points are the rule's, the card is the catalog's. */
  const CONTRACT_TABLE: Record<string, [number, string, number]> = {
    "cull-fire": [1.94, "ad2", 10], "cull-sentenced": [1.94, "ad2", 10], "cull-plague": [1.94, "haste2", 10], "cull-frost": [2.13, "vitality2", 11],
    "elite-hunt": [1.42, "ap1", 7], "headhunter": [0, "ad1", 5], "grand-tour": [2.46, "fleet2", 13], "bloom-plague": [1.46, "haste1", 8],
    "shards-frost": [1.46, "armor1", 8], "ashcap-fire": [1.46, "mr1", 8], "chains-sentenced": [1.46, "ap1", 8], "tithe-holy": [1.46, "ap1", 8],
    "cache": [1.81, "haste2", 10], "tithe-rim": [2.23, "vitality2", 12], "banner-fire": [1.55, "fleet2", 8], "banner-frost": [1.55, "vitality2", 8],
    "banner-plague": [1.55, "haste2", 8], "banner-sentenced": [1.55, "ad2", 8], "banner-holy": [1.55, "leech2", 8], "long-haul": [2.2, "haste2", 12],
  };

  it("pays the card the tier rule says: points = (objSec + 0.4 x travelSec) / 48 x 1.35 x 1.15, tier = round clamped to 1-3, a player kill at tier 1", () => {
    expect([CAMP_SECONDS, CARD_TIER_RATE, STACK_PREMIUM, QUEST_FEED_BRAKE]).toEqual([48, 1.35, 1.15, 0.65]);
    for (const d of QUEST_DEFS) {
      const want = d.players ? 1 : Math.max(1, Math.min(3, Math.round(questTierPoints(d.objSec, d.travelSec))));
      expect(questTier(d), d.id).toBe(want);
      const card = cardDef(d.reward.card);
      expect(card, d.id).toBeDefined();
      expect(card!.kind, d.id).toBe("base");
      expect(card!.tier, `${d.id} pays ${d.reward.card}`).toBe(want);
      expect(card!.ready, d.id).toBe("a");
      expect(questBase(d), d.id).toBe(card!.base);
      if (d.region) expect(d.farZone, d.id).toBe(d.region);
    }
  });

  it("matches the contract's table of twenty rows, points and GV included", () => {
    expect(Object.keys(CONTRACT_TABLE).sort()).toEqual(QUEST_DEFS.map((d) => d.id).sort());
    for (const d of QUEST_DEFS) {
      const [points, card, gv] = CONTRACT_TABLE[d.id]!;
      expect(d.reward.card, d.id).toBe(card);
      expect(d.reward.gv, d.id).toBe(gv);
      if (!d.players) expect(Math.round(questTierPoints(d.objSec, d.travelSec) * 100) / 100, d.id).toBeCloseTo(points, 2);
    }
  });

  it("keeps every GV amount inside the time-parity band of its objective and travel (a player kill has no mob parity)", () => {
    for (const d of QUEST_DEFS) {
      if (d.players) continue;
      const gv = parityGv(d.objSec, d.travelSec);
      expect(d.reward.gv / gv, `${d.id} gv`).toBeGreaterThanOrEqual(0.7);
      expect(d.reward.gv / gv, `${d.id} gv`).toBeLessThanOrEqual(1.35);
    }
  });

  it("makes nominal reward text useful to both the planning screen and quest log", () => {
    for (const d of QUEST_DEFS) {
      const text = questRewardText(d);
      expect(text, d.id).toContain(cardTitle(d.reward.card));
      expect(text, d.id).toContain(cardText(d.reward.card));
      expect(text, d.id).toContain(`${d.reward.gv} GV`);
    }
    expect(questRewardText(questDefById("cull-fire")!)).toBe("Attack Damage II (+21 attack damage) and 10 GV");
    expect(questRewardText(questDefById("bloom-plague")!)).toBe("Haste I (+9% attack speed) and 8 GV");
  });

  it("drops a fed player's card one tier (never below tier 1) once the mob reward curve is under the brake", () => {
    for (const d of QUEST_DEFS) {
      expect(questRewardCard(d, 0), d.id).toBe(d.reward.card);
      const tier = cardDef(d.reward.card)!.tier;
      const fed = questRewardCard(d, 12);
      expect(rewardCurve(12)).toBeLessThan(QUEST_FEED_BRAKE);
      expect(cardDef(fed)!.tier, d.id).toBe(Math.max(1, tier - 1));
      expect(cardDef(fed)!.base, d.id).toBe(cardDef(d.reward.card)!.base);
    }
    // The brake is the curve at a feed of 5 (0.65): a feed just under it keeps the tier, one just over drops it.
    const d = questDefById("cull-fire")!;
    expect(rewardCurve(4.9)).toBeGreaterThanOrEqual(QUEST_FEED_BRAKE);
    expect(questRewardCard(d, 4.9)).toBe("ad2");
    expect(rewardCurve(5.1)).toBeLessThan(QUEST_FEED_BRAKE);
    expect(questRewardCard(d, 5.1)).toBe("ad1");
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
        expect(blocksTile(map, worldToTile(p.at.x), worldToTile(p.at.y), MASK_MOVE), `${p.def.id} on walkable ground (no wall, no low ground)`).toBe(false);
        for (const camp of map.camps) {
          expect(Math.hypot(camp.x - p.at.x, camp.y - p.at.y), `${p.def.id} outside ${camp.id}`).toBeGreaterThanOrEqual(camp.r + 3 * TILE);
          expect(Math.hypot(camp.chest.x - p.at.x, camp.chest.y - p.at.y), `${p.def.id} off ${camp.id}'s chest`).toBeGreaterThanOrEqual(3 * TILE);
          for (const spot of camp.spots) {
            expect(Math.hypot(spot.x - p.at.x, spot.y - p.at.y), `${p.def.id} off ${camp.id}'s mob rest tiles`).toBeGreaterThanOrEqual(3 * TILE);
          }
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
          expect(terrainAt(map, piece.x, piece.y), `${p.def.id} piece off hazards`).toBe(TERRAIN_NONE);
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
        // A hidden giver chooses among the tiles beyond the reveal radius of every start, so that is its field to be far in.
        const field = p.known
          ? candidates
          : candidates.filter((c) => map.spawnPool.every((s) => Math.hypot(c.x - s.x, c.y - s.y) >= QUEST_REVEAL_RADIUS + 2 * TILE));
        const best = Math.max(...field.map((c) => Math.hypot(c.x - pole.x, c.y - pole.y)));
        const d = Math.hypot(p.at.x - pole.x, p.at.y - pole.y);
        // The farthest of the pass's private sample of spots, not of every candidate, so it can land short of the best tile (0.58 seen).
        expect(d, `${p.def.id} across from ${p.def.region}`).toBeGreaterThanOrEqual(best * 0.5);
      }
    }
  });

  it("returns the offers in a privately shuffled order: the region-themed ones do not come first within either half", () => {
    // Region-first within a half is what the placement passes produce internally and what a shuffle yields about one run in
    // ten at most; without the final shuffle every seed would be sorted, and the quest ids would give the themes away.
    const themedFirst = (flags: boolean[]): boolean => flags.every((region, i) => i === 0 || !(region && !flags[i - 1]));
    let informative = 0;
    let sorted = 0;
    for (const seed of seeds) {
      const placements = fixtureOf(seed).placements;
      const halves = [true, false].map((known) => placements.filter((p) => p.known === known).map((p) => !!p.def.region));
      if (halves.some((flags) => !flags.some(Boolean) || flags.every(Boolean))) continue;
      informative++;
      if (halves.every(themedFirst)) sorted++;
    }
    expect(informative).toBeGreaterThan(8);
    expect(sorted).toBeLessThanOrEqual(Math.ceil(informative / 5));
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
