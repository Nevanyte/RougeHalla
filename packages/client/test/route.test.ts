// The route a player draws (ui/route.ts and ui/planningMath.ts): the path through the stops from the shared pathfinder, the
// walking time, how far along it the player is, and the copy kept in sessionStorage by room id (never sent anywhere).
import { describe, expect, it } from "vitest";
import {
  PLAYER_SPEED, TILE, TILE_FLOOR, TILE_WALL, WORLD_H, WORLD_W, findPath, generateMap, mapFromTiles, walkLength, type GameMap, type Vec2,
} from "@raid/shared";
import {
  MAX_WAYPOINTS, ROUTE_REACH, advanceNext, clampToWorld, cycleIndex, describeMatchup, formatClock, formatEta, fullMapSize,
  planRoute, planningMapSize, previewMapSize, routeAhead,
} from "../src/ui/planningMath";
import { RouteState, loadRoute, routeStorageKey, sanitizeWaypoints, saveRoute, type RouteStorage } from "../src/ui/route";

const MAP: GameMap = generateMap(7);
const spawn = MAP.spawnPool[0]!;
const camps = MAP.camps;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: RouteStorage & { data: Map<string, string>; writes: number } = {
    data, writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem(k, v) { data.set(k, v); storage.writes++; },
  };
  return storage;
}
const throwing: RouteStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); } };

describe("planRoute: the walk through the stops", () => {
  it("is the shared pathfinder's legs one after another, from the start", () => {
    const stops = [camps[0]!, camps[4]!, camps[7]!].map((c) => ({ x: c.x, y: c.y }));
    const plan = planRoute(MAP, spawn, stops);
    const expected: Vec2[] = [{ x: spawn.x, y: spawn.y }];
    let at: Vec2 = spawn;
    for (const stop of stops) {
      const leg = findPath(MAP, at, stop);
      expect(leg.length).toBeGreaterThan(0);
      expected.push(...leg);
      at = leg[leg.length - 1]!;
    }
    expect(plan.points).toEqual(expected);
    expect(plan.legs.map((l) => l.wp)).toEqual([0, 1, 2]);
    expect(plan.unreachable).toEqual([]);
    expect(plan.start).toBe(spawn);
    // Each leg's end is the last point of its stretch of the polyline.
    for (const leg of plan.legs) expect(plan.points[leg.to]).toEqual(leg.end);
    expect(plan.legs[0]!.from).toBe(0);
    expect(plan.legs[1]!.from).toBe(plan.legs[0]!.to);
  });

  it("measures the walk, and the time it takes at the base move speed", () => {
    const stops = [{ x: camps[1]!.x, y: camps[1]!.y }, { x: camps[2]!.x, y: camps[2]!.y }];
    const plan = planRoute(MAP, spawn, stops);
    expect(plan.length).toBeCloseTo(walkLength(plan.points[0]!, plan.points.slice(1)), 9);
    expect(plan.length).toBeGreaterThan(Math.hypot(camps[1]!.x - spawn.x, camps[1]!.y - spawn.y) - 1);
    expect(plan.seconds).toBeCloseTo(plan.length / PLAYER_SPEED, 9);
    expect(formatEta(plan.seconds)).toMatch(/^\d+:\d\d$/);
  });

  it("is empty without stops, and begins at the first stop while there is no start yet", () => {
    expect(planRoute(MAP, spawn, [])).toMatchObject({ points: [{ x: spawn.x, y: spawn.y }], legs: [], length: 0, seconds: 0 });
    expect(planRoute(MAP, null, [])).toMatchObject({ points: [], legs: [], length: 0 });
    const noStart = planRoute(MAP, null, [{ x: camps[0]!.x, y: camps[0]!.y }, { x: camps[1]!.x, y: camps[1]!.y }]);
    expect(noStart.start).toBeNull();
    expect(noStart.points[0]).toEqual({ x: camps[0]!.x, y: camps[0]!.y });
    expect(noStart.legs.map((l) => l.wp)).toEqual([0, 1]);
    expect(noStart.length).toBeGreaterThan(0);
  });

  it("leaves out a stop nothing can walk to, and goes on from where it was", () => {
    // A box of floor sealed off from the rest by walls.
    const w = 20;
    const tiles = new Uint8Array(w * w).fill(TILE_FLOOR);
    for (let i = 0; i < w; i++) { tiles[i] = TILE_WALL; tiles[(w - 1) * w + i] = TILE_WALL; tiles[i * w] = TILE_WALL; tiles[i * w + w - 1] = TILE_WALL; }
    for (let i = 8; i <= 12; i++) { tiles[8 * w + i] = TILE_WALL; tiles[12 * w + i] = TILE_WALL; tiles[i * w + 8] = TILE_WALL; tiles[i * w + 12] = TILE_WALL; }
    const map = mapFromTiles(w, w, tiles);
    const start = { x: 3.5 * TILE, y: 3.5 * TILE };
    const inside = { x: 10.5 * TILE, y: 10.5 * TILE };
    const out = { x: 15.5 * TILE, y: 3.5 * TILE };
    const plan = planRoute(map, start, [out, inside, out]);
    expect(plan.unreachable).toEqual([1]);
    expect(plan.legs.map((l) => l.wp)).toEqual([0, 2]);
    expect(plan.points[0]).toEqual(start);
  });

  it("with no start, a first stop that cannot be reached is skipped and the next one begins the route", () => {
    const w = 12;
    const tiles = new Uint8Array(w * w).fill(TILE_WALL);
    const map = mapFromTiles(w, w, tiles);
    expect(planRoute(map, null, [{ x: 100, y: 100 }])).toMatchObject({ points: [], unreachable: [0] });
  });
});

describe("routeAhead and advanceNext: how far along the player is", () => {
  const stops = [camps[0]!, camps[3]!, camps[6]!].map((c) => ({ x: c.x, y: c.y }));
  const plan = planRoute(MAP, spawn, stops);

  it("is the whole route at the first stop, and what is left of it later", () => {
    const all = routeAhead(plan, 0);
    expect(all.points).toEqual(plan.points);
    expect(all.stops).toHaveLength(3);
    expect(all.next).toBe(0);
    const later = routeAhead(plan, 1);
    expect(later.stops).toEqual(plan.legs.slice(1).map((l) => l.end));
    expect(later.points).toEqual(plan.points.slice(plan.legs[1]!.from));
    expect(later.points.length).toBeLessThan(all.points.length);
    expect(routeAhead(plan, 3)).toEqual({ points: [], stops: [], next: 0 });
  });

  it("moves the next stop past every stop the player is within two tiles of, in order, never back", () => {
    expect(ROUTE_REACH).toBe(2 * TILE);
    expect(advanceNext(stops, 0, { x: spawn.x, y: spawn.y })).toBe(0);
    expect(advanceNext(stops, 0, { x: stops[0]!.x + ROUTE_REACH, y: stops[0]!.y })).toBe(1);
    expect(advanceNext(stops, 0, { x: stops[0]!.x + ROUTE_REACH + 1, y: stops[0]!.y })).toBe(0);
    // Standing on stop 2 does not skip stop 1: they are reached in order.
    expect(advanceNext(stops, 0, stops[1]!)).toBe(0);
    expect(advanceNext(stops, 1, stops[1]!)).toBe(2);
    expect(advanceNext(stops, 3, stops[2]!)).toBe(3);
    // Two stops in one place are passed together.
    expect(advanceNext([stops[0]!, stops[0]!], 0, stops[0]!)).toBe(2);
  });
});

describe("RouteState", () => {
  it("adds, removes and clears stops, bumping its version and telling the subscribers each time", () => {
    const r = new RouteState(null, null);
    const heard: number[] = [];
    const off = r.subscribe(() => heard.push(r.version));
    expect(r.add({ x: 100, y: 100 })).toBe(true);
    expect(r.add({ x: 200, y: 200 })).toBe(true);
    expect(r.waypoints).toEqual([{ x: 100, y: 100 }, { x: 200, y: 200 }]);
    expect(r.removeAt(0)).toBe(true);
    expect(r.removeAt(5)).toBe(false);
    expect(r.removeAt(-1)).toBe(false);
    expect(r.removeLast()).toBe(true);
    expect(r.removeLast()).toBe(false);
    r.add({ x: 1, y: 1 });
    r.clear();
    r.clear();
    expect(heard).toEqual([1, 2, 3, 4, 5, 6]);
    off();
    r.add({ x: 1, y: 1 });
    expect(heard).toHaveLength(6);
  });

  it("clamps a stop into the world and holds at most MAX_WAYPOINTS", () => {
    const r = new RouteState(null, null);
    r.add({ x: -50, y: WORLD_H + 900 });
    expect(r.waypoints[0]).toEqual({ x: 0, y: WORLD_H });
    for (let i = 1; i < MAX_WAYPOINTS; i++) expect(r.add({ x: i, y: i })).toBe(true);
    expect(r.add({ x: 9, y: 9 })).toBe(false);
    expect(r.waypoints).toHaveLength(MAX_WAYPOINTS);
    expect(clampToWorld({ x: WORLD_W + 1, y: -1 })).toEqual({ x: WORLD_W, y: 0 });
  });

  it("plans over a map from its start, and only again when the stops or the start change", () => {
    const r = new RouteState(null, null);
    r.setStart({ x: spawn.x, y: spawn.y });
    r.add({ x: camps[0]!.x, y: camps[0]!.y });
    const a = r.plan(MAP);
    expect(r.plan(MAP)).toBe(a);
    expect(a.points[0]).toEqual({ x: spawn.x, y: spawn.y });
    r.setStart({ x: spawn.x, y: spawn.y }); // the same place: nothing changed
    expect(r.plan(MAP)).toBe(a);
    r.setStart(null);
    const b = r.plan(MAP);
    expect(b).not.toBe(a);
    expect(b.start).toBeNull();
    expect(r.plan(generateMap(31))).not.toBe(b);
  });

  it("follows the player along: advance moves the next stop and ahead() shows what is left; restart starts over", () => {
    const r = new RouteState(null, null);
    r.setStart({ x: spawn.x, y: spawn.y });
    r.add({ x: camps[0]!.x, y: camps[0]!.y });
    r.add({ x: camps[2]!.x, y: camps[2]!.y });
    expect(r.next).toBe(0);
    expect(r.advance({ x: spawn.x, y: spawn.y })).toBe(false);
    const v = r.version;
    expect(r.advance({ x: camps[0]!.x, y: camps[0]!.y })).toBe(true);
    expect(r.next).toBe(1);
    expect(r.version).toBeGreaterThan(v);
    expect(r.ahead(MAP).stops).toHaveLength(1);
    expect(r.advance({ x: camps[0]!.x, y: camps[0]!.y })).toBe(false);
    r.restart();
    expect(r.next).toBe(0);
    expect(r.ahead(MAP).stops).toHaveLength(2);
    // Taking out a stop already passed keeps the next stop where it is.
    r.advance({ x: camps[0]!.x, y: camps[0]!.y });
    r.removeAt(0);
    expect(r.next).toBe(0);
    expect(r.waypoints).toEqual([{ x: camps[2]!.x, y: camps[2]!.y }]);
  });
});

describe("kept in sessionStorage by room id", () => {
  it("saves every change under the room's own key, and the next RouteState for that room finds it again", () => {
    const storage = memoryStorage();
    const a = new RouteState("room-1", storage);
    a.add({ x: 300.4, y: 500.6 });
    a.add({ x: 700, y: 900 });
    expect([...storage.data.keys()]).toEqual([routeStorageKey("room-1")]);
    expect(routeStorageKey("room-1")).toBe("raidbr.route.v1:room-1");
    const b = new RouteState("room-1", storage);
    expect(b.waypoints).toEqual([{ x: 300, y: 501 }, { x: 700, y: 900 }]);
    // Another room has its own, empty route; the first room's is untouched by it.
    const other = new RouteState("room-2", storage);
    expect(other.waypoints).toEqual([]);
    other.add({ x: 5, y: 5 });
    expect(new RouteState("room-1", storage).waypoints).toHaveLength(2);
    b.removeLast();
    expect(new RouteState("room-1", storage).waypoints).toEqual([{ x: 300, y: 501 }]);
    b.clear();
    expect(new RouteState("room-1", storage).waypoints).toEqual([]);
  });

  it("writes only what changes the stops: the start and the progress through the run are not kept", () => {
    const storage = memoryStorage();
    const r = new RouteState("room-1", storage);
    r.add({ x: camps[0]!.x, y: camps[0]!.y });
    const writes = storage.writes;
    r.setStart({ x: spawn.x, y: spawn.y });
    r.advance({ x: camps[0]!.x, y: camps[0]!.y });
    r.restart();
    expect(storage.writes).toBe(writes);
  });

  it("keeps nothing without a room id (practice), and works when the storage is blocked or missing", () => {
    const storage = memoryStorage();
    const r = new RouteState(null, storage);
    r.add({ x: 1, y: 1 });
    expect(storage.data.size).toBe(0);
    for (const bad of [throwing, null]) {
      const s = new RouteState("room-1", bad);
      expect(() => s.add({ x: 2, y: 2 })).not.toThrow();
      expect(s.waypoints).toHaveLength(1);
    }
    expect(saveRoute("room-1", [{ x: 1, y: 1 }], throwing)).toBe(false);
    expect(saveRoute("room-1", [{ x: 1, y: 1 }], null)).toBe(false);
    expect(saveRoute("room-1", [{ x: 1, y: 1 }], storage)).toBe(true);
  });

  it("reads bad data as an empty route", () => {
    for (const text of ["{not json", "", "null", "42", '"x"', "[1,2]", "{}", '{"wp": 5}', '{"wp": "abc"}']) {
      expect(loadRoute("r", memoryStorage({ [routeStorageKey("r")]: text }))).toEqual([]);
    }
    expect(loadRoute("r", throwing)).toEqual([]);
    expect(loadRoute("r", null)).toEqual([]);
  });

  it("drops bad entries, clamps the rest into the world and stops at MAX_WAYPOINTS", () => {
    const wp = [[10, 20], [1, 2, 3], ["a", 1], [Number.NaN, 4], null, [-5, WORLD_H + 50], [1e9, 2]];
    expect(sanitizeWaypoints({ wp })).toEqual([{ x: 10, y: 20 }, { x: 0, y: WORLD_H }, { x: WORLD_W, y: 2 }]);
    expect(sanitizeWaypoints({ wp: Array.from({ length: 40 }, (_, i) => [i, i]) })).toHaveLength(MAX_WAYPOINTS);
    expect(sanitizeWaypoints(undefined)).toEqual([]);
  });

  it("a reload finds the route again: a new RouteState on the same room and storage draws the same walk", () => {
    const storage = memoryStorage();
    const first = new RouteState("room-9", storage);
    first.setStart({ x: spawn.x, y: spawn.y });
    first.add({ x: camps[0]!.x, y: camps[0]!.y });
    first.add({ x: camps[5]!.x, y: camps[5]!.y });
    const after = new RouteState("room-9", storage);
    after.setStart({ x: spawn.x, y: spawn.y });
    expect(after.plan(MAP).points).toEqual(first.plan(MAP).points);
  });
});

describe("the sizes and the words", () => {
  it("sizes the planning map from the overlay: big on a wide one, shrinking with the text, under the width on a narrow one", () => {
    expect(planningMapSize(1280, 800)).toBe(620);
    expect(planningMapSize(1280, 800, 1.5)).toBeLessThanOrEqual(planningMapSize(1280, 800, 1));
    expect(planningMapSize(900, 800, 1.5)).toBeLessThan(planningMapSize(900, 800, 1));
    expect(planningMapSize(4000, 4000)).toBe(780);
    expect(planningMapSize(500, 800)).toBeLessThanOrEqual(500 - 24);
    expect(planningMapSize(100, 100)).toBe(180);
    expect(previewMapSize(1280, 800)).toBe(288);
    expect(previewMapSize(300, 300)).toBe(150);
    expect(previewMapSize(4000, 4000)).toBe(300);
    expect(fullMapSize(1280, 800)).toBe(600);
    expect(fullMapSize(400, 300)).toBe(240);
  });

  it("formats clocks and walks", () => {
    expect(formatClock(12_000)).toBe("0:12");
    expect(formatClock(11_001)).toBe("0:12");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(125_000)).toBe("2:05");
    expect(formatEta(41.4)).toBe("0:41");
    expect(formatEta(41.6)).toBe("0:42");
    expect(formatEta(-1)).toBe("0:00");
    expect(formatEta(61)).toBe("1:01");
  });

  it("reads a duel as a chip with a sign (not only a colour) and as words", () => {
    expect(describeMatchup(0.74)).toEqual({ tone: "good", chip: "+74%", words: "you win a straight fight with 74% hp left" });
    expect(describeMatchup(0.5).tone).toBe("good");
    expect(describeMatchup(0.3).chip).toBe("~30%");
    expect(describeMatchup(0.3).tone).toBe("even");
    expect(describeMatchup(0.07)).toMatchObject({ tone: "risky", chip: "!7%" });
    expect(describeMatchup(0)).toMatchObject({ tone: "lose", chip: "lose" });
    expect(describeMatchup(Number.NaN).tone).toBe("lose");
    // Four tones, four different chip openings: none relies on colour.
    const chips = [0.9, 0.3, 0.05, 0].map((s) => describeMatchup(s).chip[0]);
    expect(new Set(chips).size).toBe(4);
  });

  it("cycles through a list, wrapping, starting from either end when nothing is current", () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(2, 3, 1)).toBe(0);
    expect(cycleIndex(0, 3, -1)).toBe(2);
    expect(cycleIndex(-1, 3, 1)).toBe(0);
    expect(cycleIndex(-1, 3, -1)).toBe(2);
    expect(cycleIndex(0, 0, 1)).toBe(-1);
    expect(cycleIndex(0, 1, 1)).toBe(0);
  });
});
