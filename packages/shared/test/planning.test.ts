// The planning screen's shared maths (planning.ts): walking distances to the coliseum, the tier rule, the camps near a
// spawn and the faction matchups the server, the bots and the client all read.
import { describe, expect, it } from "vitest";
import {
  campMatchup, duel, FACTION_IDS, FACTIONS, findPath, generateMap, isEliteCamp, matchupShare, mobFaction, nearestCamps,
  PLAN_WALK_TOLERANCE, PLAYER_SPEED, primeSpawnWalks, sameTier, spawnWalks, tierRatio, walkLength, walkSeconds,
} from "../src/index";

describe("spawnWalks", () => {
  it("is the shared pathfinder's walk from every pool spawn to the coliseum centre, gates open, cached per map", () => {
    const map = generateMap(7);
    const walks = spawnWalks(map);
    expect(walks).toHaveLength(map.spawnPool.length);
    map.spawnPool.forEach((s, i) => {
      const path = findPath(map, s, map.coliseum.centre);
      expect(path.length).toBeGreaterThan(0);
      expect(walks[i]).toBeCloseTo(walkLength(s, path), 9);
      // Never shorter than the straight line.
      expect(walks[i]!).toBeGreaterThanOrEqual(Math.hypot(s.x - map.coliseum.centre.x, s.y - map.coliseum.centre.y) - 1e-6);
    });
    expect(spawnWalks(map)).toBe(walks);
    expect(spawnWalks(generateMap(7))).toEqual(walks); // deterministic: the client computes the same numbers
  });

  it("primeSpawnWalks hands a map walks computed elsewhere: taken once, only one number per pool spawn, never over the cache", () => {
    const worked = spawnWalks(generateMap(7)); // what a worker thread would compute and ship
    const fresh = generateMap(7);
    expect(primeSpawnWalks(fresh, worked)).toBe(true);
    // The cache now answers (a copy: the shipped list is the sender's), with the same numbers a computation gives.
    expect(spawnWalks(fresh)).toEqual(worked);
    expect(spawnWalks(fresh)).toBe(spawnWalks(fresh));
    // A second prime, even with other numbers, changes nothing: the first answer stands.
    expect(primeSpawnWalks(fresh, worked.map((w) => w + 1))).toBe(false);
    expect(spawnWalks(fresh)).toEqual(worked);

    for (const bad of [worked.slice(1), [...worked, 1], worked.map(() => Number.NaN), worked.map((_, i) => (i === 0 ? -5 : 1)), "walks" as never]) {
      const map = generateMap(7);
      expect(primeSpawnWalks(map, bad)).toBe(false);
      expect(spawnWalks(map)).toEqual(worked); // refused: it computes its own
    }
    // Infinity (a spawn with no path) is a legal walk.
    const open = generateMap(7);
    expect(primeSpawnWalks(open, worked.map((w, i) => (i === 0 ? Infinity : w)))).toBe(true);
    expect(spawnWalks(open)[0]).toBe(Infinity);
  });

  it("every spawn of a wedge map reaches the centre, and most have a partner in their tier in another zone", () => {
    let isolated = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateMap(seed);
      const walks = spawnWalks(map);
      expect(walks.every(Number.isFinite), `seed ${seed}`).toBe(true);
      map.spawnPool.forEach((s, i) => {
        if (!map.spawnPool.some((o, j) => j !== i && o.zone !== s.zone && sameTier(walks[i]!, walks[j]!))) isolated++;
      });
    }
    expect(isolated / (20 * 15)).toBeLessThan(0.1);
  });

  it("walkSeconds is the ETA at the base PLAYER_SPEED", () => {
    expect(walkSeconds(PLAYER_SPEED * 3)).toBeCloseTo(3, 12);
  });
});

describe("sameTier", () => {
  it("holds when one contour value has both walks within the tolerance either side of it", () => {
    const r = tierRatio();
    expect(r).toBeCloseTo((1 + PLAN_WALK_TOLERANCE) / (1 - PLAN_WALK_TOLERANCE), 12);
    expect(sameTier(1000, 1000)).toBe(true);
    expect(sameTier(1000, 1000 * r)).toBe(true);
    expect(sameTier(1000 * r, 1000)).toBe(true);
    expect(sameTier(1000, 1000 * r * 1.001)).toBe(false);
    // The contour value between them: 1000 and 1170 both lie within 8% of c = 1083.
    const c = (1000 / (1 - PLAN_WALK_TOLERANCE) + 1170 / (1 + PLAN_WALK_TOLERANCE)) / 2;
    expect(Math.abs(1000 - c) / c).toBeLessThanOrEqual(PLAN_WALK_TOLERANCE);
    expect(Math.abs(1170 - c) / c).toBeLessThanOrEqual(PLAN_WALK_TOLERANCE);
    expect(sameTier(1000, 1170)).toBe(true);
  });

  it("never holds for an unreachable or zero walk", () => {
    expect(sameTier(Infinity, Infinity)).toBe(false);
    expect(sameTier(1000, Infinity)).toBe(false);
    expect(sameTier(0, 0)).toBe(false);
    expect(sameTier(NaN, 1000)).toBe(false);
  });
});

describe("camps near a spawn", () => {
  it("nearestCamps lists the map's camps by straight distance, nearest first", () => {
    const map = generateMap(3);
    const at = map.spawnPool[0]!;
    const near = nearestCamps(map, at, 3);
    expect(near).toHaveLength(3);
    const d = (c: { x: number; y: number }) => Math.hypot(c.x - at.x, c.y - at.y);
    for (const c of map.camps) if (!near.includes(c)) expect(d(c)).toBeGreaterThanOrEqual(d(near[2]!));
    expect(d(near[0]!)).toBeLessThanOrEqual(d(near[1]!));
    expect(nearestCamps(map, at, 0)).toEqual([]);
    expect(nearestCamps(map, at, 999)).toHaveLength(map.camps.length);
  });

  it("an elite camp is one with an elite spot, and its matchup is the elite's", () => {
    const map = generateMap(3);
    const elite = map.camps.find((c) => isEliteCamp(c))!;
    const normal = map.camps.find((c) => !isEliteCamp(c))!;
    expect(campMatchup("holy", elite)).toBe(matchupShare("holy", elite.zone, true));
    expect(campMatchup("holy", normal)).toBe(matchupShare("holy", normal.zone, false));
  });
});

describe("matchupShare (moved here from the bots for the planning screen)", () => {
  it("is the hp share kept in the shared duel against the mob's scaled faction, 0 for a loss", () => {
    for (const me of FACTION_IDS) {
      for (const region of FACTION_IDS) {
        for (const elite of [false, true]) {
          const d = duel(FACTIONS[me], mobFaction(region, elite), 0.01);
          const want = d.winner === 0 ? d.hpA / FACTIONS[me].hp : 0;
          expect(matchupShare(me, region, elite), `${me} vs ${region}${elite ? " elite" : ""}`).toBeCloseTo(want, 12);
          expect(matchupShare(me, region, elite)).toBeGreaterThanOrEqual(0);
          expect(matchupShare(me, region, elite)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("follows the duel table: everyone beats a normal mob of their own region, an elite is never easier than its camp-mates", () => {
    for (const f of FACTION_IDS) expect(matchupShare(f, f, false)).toBeGreaterThan(0.5);
    for (const me of FACTION_IDS) for (const region of FACTION_IDS) {
      expect(matchupShare(me, region, true)).toBeLessThanOrEqual(matchupShare(me, region, false));
    }
    expect(matchupShare("fire", "holy", true)).toBe(0);
  });
});
