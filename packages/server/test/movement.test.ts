import { describe, expect, it } from "vitest";
import {
  circleClear, isWallAt, mapFromTiles, MAX_REWIND_MS, mulberry32, PLAYER_RADIUS, PLAYER_SPEED, segmentClear, TICK_MS, TILE,
  TILE_FLOOR, TILE_WALL, tileToWorldCenter, WORLD_H, WORLD_W, type GameMap, type Sample, type Vec2,
} from "@raid/shared";
import { PlayerState } from "@raid/shared/schema";
import { enqueueClientMessage, InputQueue } from "../src/sim/inputs";
import { advanceAlongPath, planPath, positionAt, recordHistory } from "../src/sim/movement";
import { addPlayer, step } from "../src/sim/step";
import { createWorld, type PlayerRuntime, type World } from "../src/sim/world";

const DT = TICK_MS / 1000;
/** Farthest a player may move in one fixed step. */
const STEP = PLAYER_SPEED * DT;

function makePlayer(x = 0, y = 0, facing = 0): PlayerState {
  const p = new PlayerState();
  p.x = x;
  p.y = y;
  p.facing = facing;
  return p;
}

function makeRuntime(path: Vec2[], history: Sample[] = []): PlayerRuntime {
  return {
    id: "p", profile: "p", inputs: new InputQueue(), path: path.map((w) => ({ ...w })), history,
    nextAttackAt: 0, killedBy: null, gv: { kills: 0, mobs: 0, bounty: 0 }, mobKills: 0, lastHit: null, damaged: new Set(), droppedAt: null, hpFracAtTickStart: 1, down: null, resolved: false,
  };
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

describe("advanceAlongPath", () => {
  describe("speed budget", () => {
    it("moves exactly PLAYER_SPEED * dt toward a distant waypoint", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 1000, y: 0 }]);
      advanceAlongPath(p, rt, DT);
      expect(p.x).toBeCloseTo(PLAYER_SPEED * DT, 9);
      expect(p.y).toBe(0);
      expect(rt.path).toHaveLength(1);
    });

    it("scales linearly with dt", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 1000, y: 0 }]);
      advanceAlongPath(p, rt, 1);
      expect(p.x).toBeCloseTo(PLAYER_SPEED, 9);
    });

    it("applies the budget along the straight line for diagonal moves", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 300, y: 400 }]); // 3-4-5 triangle, length 500
      advanceAlongPath(p, rt, 1);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(PLAYER_SPEED, 9);
      expect(p.x / p.y).toBeCloseTo(3 / 4, 9);
      expect(p.x).toBeCloseTo(PLAYER_SPEED * 0.6, 9);
      expect(p.y).toBeCloseTo(PLAYER_SPEED * 0.8, 9);
    });

    it("moves in negative directions too", () => {
      const p = makePlayer(500, 500);
      const rt = makeRuntime([{ x: 0, y: 500 }]);
      advanceAlongPath(p, rt, 1);
      expect(p.x).toBeCloseTo(500 - PLAYER_SPEED, 9);
      expect(p.y).toBe(500);
    });

    it("does nothing for dt = 0 or negative dt", () => {
      for (const dt of [0, -1, -0.05]) {
        const p = makePlayer(10, 10, 0.5);
        const rt = makeRuntime([{ x: 100, y: 100 }]);
        advanceAlongPath(p, rt, dt);
        expect([p.x, p.y, p.facing]).toEqual([10, 10, 0.5]);
        expect(rt.path).toHaveLength(1);
      }
    });

    it("does nothing with an empty path and leaves facing alone", () => {
      const p = makePlayer(10, 10, 1.25);
      const rt = makeRuntime([]);
      advanceAlongPath(p, rt, 1);
      expect([p.x, p.y, p.facing]).toEqual([10, 10, 1.25]);
    });

    it("covers speed * time over N fixed ticks", () => {
      const p = makePlayer(100, 100);
      const rt = makeRuntime([{ x: 2000, y: 100 }]);
      for (let i = 0; i < 40; i++) advanceAlongPath(p, rt, DT); // 2 seconds
      expect(p.x - 100).toBeCloseTo(PLAYER_SPEED * 2, 6);
    });
  });

  describe("reaching waypoints", () => {
    it("snaps exactly onto a waypoint closer than the budget and consumes it", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 5, y: 0 }]);
      advanceAlongPath(p, rt, 1);
      expect(p).toMatchObject({ x: 5, y: 0 });
      expect(rt.path).toEqual([]);
    });

    it("consumes a waypoint that is exactly the budget away", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: PLAYER_SPEED, y: 0 }]);
      advanceAlongPath(p, rt, 1);
      expect(p.x).toBe(PLAYER_SPEED);
      expect(rt.path).toEqual([]);
    });

    it("never overshoots, and stays put once the path is empty", () => {
      const p = makePlayer(0, 0);
      const target = { x: 37, y: 91 };
      const rt = makeRuntime([target]);
      let prev = dist(p, target);
      for (let i = 0; i < 100; i++) {
        advanceAlongPath(p, rt, DT);
        const d = dist(p, target);
        expect(d).toBeLessThanOrEqual(prev + 1e-9);
        prev = d;
      }
      expect(p).toMatchObject({ x: 37, y: 91 });
      expect(rt.path).toEqual([]);
    });

    it("never overshoots for large dt values either", () => {
      for (const dt of [0.05, 0.2, 1, 10, 1000]) {
        const p = makePlayer(0, 0);
        const rt = makeRuntime([{ x: 12, y: -34 }]);
        advanceAlongPath(p, rt, dt);
        const d = dist(p, { x: 12, y: -34 });
        if (PLAYER_SPEED * dt >= Math.hypot(12, 34)) expect(d).toBe(0);
        else expect(d).toBeCloseTo(Math.hypot(12, 34) - PLAYER_SPEED * dt, 9);
      }
    });

    it("consumes a waypoint at the current position without spending budget", () => {
      const p = makePlayer(50, 50);
      const rt = makeRuntime([{ x: 50, y: 50 }, { x: 1000, y: 50 }]);
      advanceAlongPath(p, rt, 1);
      expect(p.x).toBeCloseTo(50 + PLAYER_SPEED, 9);
      expect(rt.path).toHaveLength(1);
    });
  });

  describe("multiple waypoints in one step", () => {
    it("consumes several short segments and ends on the last waypoint", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }]); // length 150
      advanceAlongPath(p, rt, 1); // budget 170
      expect(p).toMatchObject({ x: 100, y: 50 });
      expect(rt.path).toEqual([]);
    });

    it("carries leftover budget across a corner and stops mid-segment", () => {
      const p = makePlayer(0, 0);
      const rt = makeRuntime([{ x: 100, y: 0 }, { x: 100, y: 200 }]);
      advanceAlongPath(p, rt, 1); // 100 along x, then 70 along y
      expect(p.x).toBeCloseTo(100, 9);
      expect(p.y).toBeCloseTo(PLAYER_SPEED - 100, 9);
      expect(rt.path).toEqual([{ x: 100, y: 200 }]);
    });

    it("splitting dt across calls matches a single call over a multi-waypoint path", () => {
      const path = [{ x: 30, y: 0 }, { x: 30, y: 40 }, { x: -20, y: 40 }, { x: -20, y: -60 }];
      const a = makePlayer(0, 0);
      const ra = makeRuntime(path);
      advanceAlongPath(a, ra, 1);
      const b = makePlayer(0, 0);
      const rb = makeRuntime(path);
      for (let i = 0; i < 20; i++) advanceAlongPath(b, rb, 1 / 20);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
      expect(rb.path).toEqual(ra.path);
    });
  });

  describe("facing", () => {
    it.each([
      ["east", { x: 100, y: 0 }, 0],
      ["south (+y)", { x: 0, y: 100 }, Math.PI / 2],
      ["west", { x: -100, y: 0 }, Math.PI],
      ["north (-y)", { x: 0, y: -100 }, -Math.PI / 2],
      ["north-west", { x: -100, y: -100 }, -3 * Math.PI / 4],
    ])("faces %s while walking", (_n, target, expected) => {
      const p = makePlayer(0, 0, 0.123);
      advanceAlongPath(p, makeRuntime([target]), DT);
      expect(p.facing).toBeCloseTo(expected, 9);
    });

    it("faces the direction of the final traversed segment on a multi-waypoint step", () => {
      const p = makePlayer(0, 0);
      advanceAlongPath(p, makeRuntime([{ x: 50, y: 0 }, { x: 50, y: 50 }]), 1);
      expect(p.facing).toBeCloseTo(Math.PI / 2, 9);
    });

    it("updates facing when arriving at the waypoint", () => {
      const p = makePlayer(0, 0, 2);
      advanceAlongPath(p, makeRuntime([{ x: 0, y: -3 }]), 1);
      expect(p.facing).toBeCloseTo(-Math.PI / 2, 9);
    });

    it("keeps the old facing for a waypoint at (or within 0.001 of) the current position", () => {
      const p = makePlayer(10, 10, 1.234);
      advanceAlongPath(p, makeRuntime([{ x: 10, y: 10 }]), 1);
      expect(p.facing).toBe(1.234);
      const q = makePlayer(10, 10, 1.234);
      advanceAlongPath(q, makeRuntime([{ x: 10.0005, y: 10 }]), 1);
      expect(q.facing).toBe(1.234);
      expect(q.x).toBe(10.0005); // still reaches it
    });

    it("keeps facing when the path is empty", () => {
      const p = makePlayer(0, 0, 0.75);
      advanceAlongPath(p, makeRuntime([]), 1);
      expect(p.facing).toBe(0.75);
    });
  });

  it("either finishes the polyline or leaves an untouched suffix of it (random polylines)", () => {
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let trial = 0; trial < 50; trial++) {
      const start = { x: rnd() * 500, y: rnd() * 500 };
      const path = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ x: rnd() * 500, y: rnd() * 500 }));
      const total = path.reduce((acc, w, i) => acc + dist(i === 0 ? start : path[i - 1], w), 0);
      const p = makePlayer(start.x, start.y);
      const rt = makeRuntime(path);
      const dt = 0.01 + rnd() * 0.5;
      advanceAlongPath(p, rt, dt);
      const budget = PLAYER_SPEED * dt;
      if (budget >= total) {
        expect(rt.path).toEqual([]);
        expect(p.x).toBeCloseTo(path[path.length - 1].x, 9);
        expect(p.y).toBeCloseTo(path[path.length - 1].y, 9);
      } else {
        expect(rt.path.length).toBeGreaterThan(0);
        // Whatever remains must be a suffix of the original path.
        expect(rt.path).toEqual(path.slice(path.length - rt.path.length));
      }
    }
  });
});


// ---------------------------------------------------------------------------------------------
// Pathfinding: planPath = findPath(world.map, from, to, PLAYER_RADIUS)
// ---------------------------------------------------------------------------------------------

function makeWorld(seed = 1234): World {
  return createWorld({
    seed,
    config: { minPlayers: 1, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600, suddenDeathSeconds: 60 },
    random: mulberry32(seed),
  });
}

/** '#' is a wall, anything else floor. Hand-built maps keep the "unreachable" cases explicit. */
function gridMap(rows: string[]): GameMap {
  const h = rows.length;
  const w = rows[0]!.length;
  const tiles = new Uint8Array(w * h);
  rows.forEach((row, ty) => {
    if (row.length !== w) throw new Error(`row ${ty} has width ${row.length}, expected ${w}`);
    for (let tx = 0; tx < w; tx++) tiles[ty * w + tx] = row[tx] === "#" ? TILE_WALL : TILE_FLOOR;
  });
  return mapFromTiles(w, h, tiles);
}

const tileCenter = (tx: number, ty: number): Vec2 => ({ x: tileToWorldCenter(tx), y: tileToWorldCenter(ty) });

const polylineLength = (from: Vec2, wps: Vec2[]): number =>
  wps.reduce((acc, w, i) => acc + dist(i === 0 ? from : wps[i - 1]!, w), 0);

describe("planPath on a generated map", () => {
  const world = makeWorld(1234);
  const { spawns, groundSpots } = world.map;
  const from = spawns[0]!;
  const targets = [...spawns.slice(1), ...groundSpots];

  it("ends exactly on the target for every reachable spawn and ground spot", () => {
    expect(targets.length).toBeGreaterThan(10);
    for (const to of targets) {
      const path = planPath(world, from, to);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(to);
    }
  });

  it("ends on the exact floor target rather than the centre of its tile", () => {
    const spot = groundSpots[0]!;
    const to = { x: spot.x + 5, y: spot.y - 7 }; // same tile, off centre
    expect(isWallAt(world.map, to.x, to.y)).toBe(false);
    const path = planPath(world, from, to);
    expect(path[path.length - 1]).toEqual(to);
  });

  it("only produces waypoints a player-sized disc can walk between, none inside a wall", () => {
    for (const to of targets) {
      let prev: Vec2 = from;
      for (const wp of planPath(world, from, to)) {
        expect(isWallAt(world.map, wp.x, wp.y)).toBe(false);
        expect(segmentClear(world.map, prev, wp, PLAYER_RADIUS)).toBe(true);
        prev = wp;
      }
    }
  });

  it("is never shorter than the straight line", () => {
    for (const to of targets) {
      expect(polylineLength(from, planPath(world, from, to))).toBeGreaterThanOrEqual(dist(from, to) - 1e-9);
    }
  });

  it("returns just the target when the player already stands on its tile", () => {
    expect(planPath(world, from, from)).toEqual([from]);
    const nearby = { x: from.x + 3, y: from.y - 2 };
    expect(planPath(world, from, nearby)).toEqual([nearby]);
  });

  it("snaps a target outside the world to floor near the nearest corner (never into the wall)", () => {
    for (const to of [{ x: 0, y: 0 }, { x: WORLD_W, y: WORLD_H }, { x: -50, y: WORLD_H / 2 }]) {
      const path = planPath(world, from, to);
      expect(path.length).toBeGreaterThan(0);
      const end = path[path.length - 1]!;
      expect(isWallAt(world.map, end.x, end.y)).toBe(false);
      expect(end.x).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(end.x).toBeLessThanOrEqual(WORLD_W - PLAYER_RADIUS);
      expect(end.y).toBeGreaterThanOrEqual(PLAYER_RADIUS);
      expect(end.y).toBeLessThanOrEqual(WORLD_H - PLAYER_RADIUS);
      expect(dist(end, { x: Math.min(Math.max(to.x, 0), WORLD_W), y: Math.min(Math.max(to.y, 0), WORLD_H) }))
        .toBeLessThan(6 * 32);
    }
  });

  it("returns [] for a non-finite target or start", () => {
    expect(planPath(world, from, { x: NaN, y: 5 })).toEqual([]);
    expect(planPath(world, from, { x: Infinity, y: 5 })).toEqual([]);
    expect(planPath(world, { x: NaN, y: 0 }, spawns[1]!)).toEqual([]);
  });

  it("does not mutate its arguments and is deterministic", () => {
    const start = { x: from.x, y: from.y };
    const to = { x: spawns[1]!.x, y: spawns[1]!.y };
    const a = planPath(world, start, to);
    const b = planPath(world, start, to);
    expect(a).toEqual(b);
    expect(start).toEqual(from);
    expect(to).toEqual(spawns[1]);
    // The caller consumes the path (advanceAlongPath shifts it); that must not corrupt the target.
    a.length = 0;
    expect(to).toEqual(spawns[1]);
  });

  it("accepts a PlayerState as `from` (the sim passes the player itself)", () => {
    const p = makePlayer(from.x, from.y);
    expect(planPath(world, p, spawns[1]!)).toEqual(planPath(world, from, spawns[1]!));
  });

  it("follows world.map: assigning a different map changes the plan", () => {
    const w = makeWorld(1234);
    w.map = gridMap([
      "########",
      "#......#",
      "#......#",
      "#......#",
      "########",
    ]);
    const from = tileCenter(1, 1);
    const to = tileCenter(6, 3);
    expect(planPath(w, from, to)).toEqual([to]); // open room: straight there
    w.map = gridMap([
      "########",
      "#......#",
      "#.####.#",
      "#.####.#",
      "#......#",
      "########",
    ]);
    const detour = planPath(w, from, to);
    expect(detour.length).toBeGreaterThan(1); // same endpoints, now walled in the middle
    expect(detour[detour.length - 1]).toEqual(to);
  });
});

describe("planPath on handcrafted maps", () => {
  const worldWith = (rows: string[]): World => {
    const w = makeWorld();
    w.map = gridMap(rows);
    return w;
  };

  // The pocket at tile (3,3) is sealed by walls on all eight sides.
  const POCKET = [
    "############",
    "#..........#",
    "#.###......#",
    "#.#.#......#",
    "#.###......#",
    "#..........#",
    "############",
  ];

  it("returns [] when the target is fully enclosed by walls", () => {
    const w = worldWith(POCKET);
    expect(w.map.tiles[3 * w.map.w + 3]).toBe(TILE_FLOOR); // the pocket itself is floor
    expect(planPath(w, tileCenter(8, 3), tileCenter(3, 3))).toEqual([]);
  });

  it("returns [] when the player is the one sealed in", () => {
    const w = worldWith(POCKET);
    expect(planPath(w, tileCenter(3, 3), tileCenter(8, 3))).toEqual([]);
  });

  it("returns [] for a floor target on a disconnected island", () => {
    const w = worldWith([
      "##########",
      "#...#....#",
      "#...#....#",
      "#...#....#",
      "##########",
    ]);
    expect(planPath(w, tileCenter(2, 2), tileCenter(7, 2))).toEqual([]);
    // Same room is fine.
    expect(planPath(w, tileCenter(2, 2), tileCenter(3, 3))).toEqual([tileCenter(3, 3)]);
  });

  it("returns [] for a target inside solid wall with no floor within snapping reach", () => {
    const w = worldWith([
      "##############",
      "#...##########",
      "#...##########",
      "#...##########",
      "##############",
      "##############",
      "##############",
      "##############",
      "##############",
      "##############",
    ]);
    expect(planPath(w, tileCenter(2, 2), tileCenter(11, 8))).toEqual([]);
    expect(planPath(w, tileCenter(2, 2), { x: -500, y: -500 })).toEqual([]);
  });

  it("snaps a wall target to the centre of the nearest floor tile", () => {
    const w = worldWith(POCKET);
    // Inside wall tile (2,2), hugging its west edge: floor tile (1,2) is the closest.
    const target = { x: 2 * 32 + 4, y: 2 * 32 + 16 };
    expect(isWallAt(w.map, target.x, target.y)).toBe(true);
    const path = planPath(w, tileCenter(8, 3), target);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(tileCenter(1, 2));
  });

  it("returns a single waypoint, the target, when the straight line is clear", () => {
    const w = worldWith([
      "########",
      "#......#",
      "#......#",
      "#......#",
      "########",
    ]);
    const to = { x: 6 * 32 + 10, y: 3 * 32 + 5 };
    expect(planPath(w, tileCenter(1, 1), to)).toEqual([to]);
  });

  it("bends around a wall: several waypoints, the last is the target, every hop is clear", () => {
    const w = worldWith([
      "########",
      "#......#",
      "#.######",
      "#.######",
      "#......#",
      "########",
    ]);
    const from = tileCenter(6, 1);
    const to = tileCenter(6, 4);
    const path = planPath(w, from, to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path[path.length - 1]).toEqual(to);
    let prev = from;
    for (const wp of path) {
      expect(isWallAt(w.map, wp.x, wp.y)).toBe(false);
      expect(segmentClear(w.map, prev, wp, PLAYER_RADIUS)).toBe(true);
      prev = wp;
    }
    // It really goes down the west corridor: some waypoint sits near column 1.
    expect(path.some((wp) => wp.x < 2 * 32)).toBe(true);
  });

  it("does not cut a diagonal corner between two touching wall tiles", () => {
    const w = worldWith([
      "######",
      "#..#.#",
      "#.#..#",
      "#....#",
      "######",
    ]);
    // Walls at (3,1) and (2,2) touch only at a corner, which blocks the diagonal from (2,1) to (3,2).
    const from = tileCenter(2, 1);
    const to = tileCenter(3, 2);
    const path = planPath(w, from, to);
    expect(path.length).toBeGreaterThan(1);
    let prev = from;
    for (const wp of path) {
      expect(segmentClear(w.map, prev, wp, PLAYER_RADIUS)).toBe(true);
      prev = wp;
    }
    expect(path[path.length - 1]).toEqual(to);
  });
});

describe("walking a planned path (planPath + advanceAlongPath)", () => {
  it.each([1234, 99, 4242])("seed %i: arrives at every target within the speed limit, never inside a wall", (seed) => {
    const world = makeWorld(seed);
    const { spawns, groundSpots } = world.map;
    const targets = [...spawns.slice(1, 5), ...groundSpots.slice(0, 5)];
    for (const to of targets) {
      const p = makePlayer(spawns[0]!.x, spawns[0]!.y);
      const rt = makeRuntime(planPath(world, p, to));
      const length = polylineLength(p, rt.path);
      let ticks = 0;
      while (rt.path.length > 0) {
        const before = { x: p.x, y: p.y };
        advanceAlongPath(p, rt, DT);
        ticks++;
        expect(dist(before, p)).toBeLessThanOrEqual(STEP + 1e-6);
        expect(isWallAt(world.map, p.x, p.y)).toBe(false);
        expect(ticks).toBeLessThan(1000);
      }
      expect(p.x).toBeCloseTo(to.x, 9);
      expect(p.y).toBeCloseTo(to.y, 9);
      // Speed is spent along the polyline, so the trip takes exactly length / STEP ticks.
      expect(ticks).toBe(Math.ceil(length / STEP - 1e-9));
    }
  });
});

describe("a walking player's disc stays out of the walls", () => {
  // Clicks aimed at the awkward places: just inside wall faces and corners, at offsets either side of the clamp line.
  const OFFSETS = [0, 0.001, 1, 6, 11.999, 12, 12.001, 16, 19.999, 20, 20.001, 26, 31, 31.999];
  const nearWallTiles = (map: GameMap): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let ty = 1; ty < map.h - 1; ty++) {
      for (let tx = 1; tx < map.w - 1; tx++) {
        if (map.tiles[ty * map.w + tx] !== TILE_FLOOR) continue;
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) walls += map.tiles[(ty + dy) * map.w + tx + dx]!;
        if (walls > 0) out.push([tx, ty]);
      }
    }
    return out;
  };

  it.each([1234, 99, 4242])("seed %i: planPath + advanceAlongPath, chained wall-hugging clicks", (seed) => {
    const world = makeWorld(seed);
    const rng = mulberry32(seed);
    const tiles = nearWallTiles(world.map);
    const p = makePlayer(world.map.spawns[0]!.x, world.map.spawns[0]!.y);
    let arrivals = 0;
    for (let n = 0; n < 150; n++) {
      const [tx, ty] = tiles[Math.floor(rng() * tiles.length)]!;
      const click = { x: tx * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)]!, y: ty * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)]! };
      const rt = makeRuntime(planPath(world, p, click));
      if (rt.path.length === 0) continue;
      for (let ticks = 0; rt.path.length > 0; ticks++) {
        advanceAlongPath(p, rt, DT);
        expect(circleClear(world.map, p, PLAYER_RADIUS), `seed ${seed} click ${n} tick ${ticks} at ${p.x},${p.y}`).toBe(true);
        expect(ticks).toBeLessThan(1000);
      }
      arrivals++;
    }
    expect(arrivals).toBeGreaterThan(100);
  });

  it("through the real step loop: move messages in, a clear disc at every tick and on arrival", () => {
    const world = makeWorld(1234);
    world.config.minPlayers = 1;
    addPlayer(world, "a", "alice");
    step(world, TICK_MS); // lobby -> active
    expect(world.state.phase).toBe("active");
    const p = world.state.players.get("a")!;
    const rt = world.players.get("a")!;
    const rng = mulberry32(5);
    const tiles = nearWallTiles(world.map);
    let walks = 0;
    for (let n = 0; n < 60; n++) {
      const [tx, ty] = tiles[Math.floor(rng() * tiles.length)]!;
      const click = { x: tx * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)]!, y: ty * TILE + OFFSETS[Math.floor(rng() * OFFSETS.length)]! };
      const from = { x: p.x, y: p.y };
      expect(enqueueClientMessage(rt.inputs, "move", click)).toBe(true);
      step(world, TICK_MS);
      for (let ticks = 0; rt.path.length > 0; ticks++) {
        expect(circleClear(world.map, p, PLAYER_RADIUS), `click ${n} tick ${ticks} at ${p.x},${p.y}`).toBe(true);
        step(world, TICK_MS);
        expect(ticks).toBeLessThan(1000);
      }
      expect(circleClear(world.map, p, PLAYER_RADIUS), `click ${n}: arrival at ${p.x},${p.y}`).toBe(true);
      if (dist(from, p) > 1) walks++;
    }
    expect(walks).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------------------------
// Lag-compensation history
// ---------------------------------------------------------------------------------------------

describe("recordHistory", () => {
  const WINDOW = MAX_REWIND_MS + TICK_MS;

  it("appends the player's position at the given server time, oldest first", () => {
    const p = makePlayer(10, 20);
    const rt = makeRuntime([]);
    recordHistory(rt, p, 1000);
    p.x = 30;
    recordHistory(rt, p, 1050);
    expect(rt.history).toEqual([{ t: 1000, x: 10, y: 20 }, { t: 1050, x: 30, y: 20 }]);
  });

  it("stores a snapshot: later movement does not rewrite recorded positions", () => {
    const p = makePlayer(1, 2);
    const rt = makeRuntime([]);
    recordHistory(rt, p, 0);
    p.x = 500;
    p.y = 600;
    expect(rt.history[0]).toEqual({ t: 0, x: 1, y: 2 });
  });

  it("forgets samples older than MAX_REWIND_MS + TICK_MS, keeping one exactly on the cutoff", () => {
    const p = makePlayer(0, 0);
    const rt = makeRuntime([]);
    for (let t = 0; t <= 500; t += TICK_MS) recordHistory(rt, p, t);
    expect(rt.history[0]!.t).toBe(500 - WINDOW); // on the cutoff: kept
    expect(rt.history[rt.history.length - 1]!.t).toBe(500);
    recordHistory(rt, p, 500 + TICK_MS);
    expect(rt.history[0]!.t).toBe(500 + TICK_MS - WINDOW); // the previous oldest is now past the cutoff
    for (const s of rt.history) expect(s.t).toBeGreaterThanOrEqual(500 + TICK_MS - WINDOW);
  });

  it("at the tick rate it covers the whole rewind window and stays bounded", () => {
    const p = makePlayer(0, 0);
    const rt = makeRuntime([]);
    for (let i = 0; i < 300; i++) {
      const now = i * TICK_MS;
      p.x += 1;
      recordHistory(rt, p, now);
      if (now >= MAX_REWIND_MS) {
        expect(now - rt.history[0]!.t).toBeGreaterThanOrEqual(MAX_REWIND_MS);
      }
      expect(now - rt.history[0]!.t).toBeLessThanOrEqual(WINDOW);
      expect(rt.history.length).toBeLessThanOrEqual(WINDOW / TICK_MS + 1);
    }
  });

  it("never trims below two samples, so positionAt can still lerp after a stall", () => {
    const p = makePlayer(0, 0);
    const rt = makeRuntime([]);
    recordHistory(rt, p, 0);
    recordHistory(rt, p, 100_000);
    expect(rt.history.map((s) => s.t)).toEqual([0, 100_000]);
    recordHistory(rt, p, 100_050);
    expect(rt.history.map((s) => s.t)).toEqual([100_000, 100_050]);
  });
});

describe("positionAt", () => {
  const history = (): Sample[] => [
    { t: 1000, x: 0, y: 0 },
    { t: 1050, x: 10, y: 0 },
    { t: 1100, x: 10, y: 20 },
    { t: 1200, x: 50, y: 20 },
  ];
  /** Live position deliberately differs from the newest sample so the two cases are distinguishable. */
  const setup = () => ({ p: makePlayer(60, 25), rt: makeRuntime([], history()) });

  it("lerps between the two samples around t", () => {
    const { p, rt } = setup();
    expect(positionAt(rt, p, 1025)).toEqual({ x: 5, y: 0 });
    expect(positionAt(rt, p, 1075)).toEqual({ x: 10, y: 10 });
    const late = positionAt(rt, p, 1150); // halfway through the longer 1100..1200 segment
    expect(late.x).toBeCloseTo(30, 9);
    expect(late.y).toBeCloseTo(20, 9);
  });

  it("returns the recorded sample when t lands exactly on one", () => {
    const { p, rt } = setup();
    expect(positionAt(rt, p, 1050)).toEqual({ x: 10, y: 0 });
    expect(positionAt(rt, p, 1100)).toEqual({ x: 10, y: 20 });
  });

  it("clamps to the oldest sample for t before the recorded history", () => {
    const { p, rt } = setup();
    expect(positionAt(rt, p, 1000)).toEqual({ x: 0, y: 0 });
    expect(positionAt(rt, p, 999)).toEqual({ x: 0, y: 0 });
    expect(positionAt(rt, p, -1e9)).toEqual({ x: 0, y: 0 });
  });

  it("returns the live position for t at or after the newest sample", () => {
    const { p, rt } = setup();
    expect(positionAt(rt, p, 1200)).toEqual({ x: 60, y: 25 });
    expect(positionAt(rt, p, 1201)).toEqual({ x: 60, y: 25 });
    expect(positionAt(rt, p, 1e9)).toEqual({ x: 60, y: 25 });
  });

  it("returns the live position when nothing has been recorded", () => {
    const p = makePlayer(7, 8);
    expect(positionAt(makeRuntime([]), p, 0)).toEqual({ x: 7, y: 8 });
    expect(positionAt(makeRuntime([]), p, -5)).toEqual({ x: 7, y: 8 });
  });

  it("copes with a single recorded sample: clamp before it, live from it onward", () => {
    const p = makePlayer(9, 9);
    const rt = makeRuntime([], [{ t: 500, x: 1, y: 2 }]);
    expect(positionAt(rt, p, 499)).toEqual({ x: 1, y: 2 });
    expect(positionAt(rt, p, 500)).toEqual({ x: 9, y: 9 });
    expect(positionAt(rt, p, 501)).toEqual({ x: 9, y: 9 });
  });

  it("returns a fresh object and leaves the history and the player untouched", () => {
    const { p, rt } = setup();
    const before = history();
    const a = positionAt(rt, p, 0);
    a.x = 999;
    const b = positionAt(rt, p, 1e9);
    b.x = 999;
    const c = positionAt(rt, p, 1025);
    c.x = 999;
    expect(rt.history).toEqual(before);
    expect([p.x, p.y]).toEqual([60, 25]);
  });

  it("is consistent with recordHistory for a player walking at PLAYER_SPEED", () => {
    const p = makePlayer(100, 100);
    const rt = makeRuntime([{ x: 5000, y: 100 }]);
    const trail: Vec2[] = [];
    const TICKS = 8; // exactly fills the rewind window, so nothing has been trimmed yet
    for (let i = 0; i < TICKS; i++) {
      advanceAlongPath(p, rt, DT);
      recordHistory(rt, p, 1000 + i * TICK_MS);
      trail.push({ x: p.x, y: p.y });
    }
    expect(rt.history).toHaveLength(TICKS);
    // On a tick boundary: exactly where they were. (The newest sample is the live position anyway.)
    for (let i = 0; i < TICKS; i++) {
      const got = positionAt(rt, p, 1000 + i * TICK_MS);
      expect(got.x).toBeCloseTo(trail[i]!.x, 9);
      expect(got.y).toBeCloseTo(trail[i]!.y, 9);
    }
    // Half a tick behind the newest sample: half a step back from the live position.
    const mid = positionAt(rt, p, 1000 + (TICKS - 1.5) * TICK_MS);
    expect(mid.x).toBeCloseTo((trail[TICKS - 2]!.x + trail[TICKS - 1]!.x) / 2, 9);
    expect(p.x - mid.x).toBeCloseTo(STEP / 2, 9);
    // Older than anything recorded: clamp to the oldest sample.
    const oldest = rt.history[0]!;
    expect(positionAt(rt, p, 0)).toEqual({ x: oldest.x, y: oldest.y });
  });
});
