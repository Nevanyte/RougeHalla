// Frost Wall (Frost's Wish since 2026-11-04, the first placed ability): driven through the real step() on a hand-built open room.
// The cast lands at the aim point clamped to its range, its tiles (the server's own rule, shared/barriers.ts) are LOW in
// collisionMap while it stands, anyone standing in it is set down on their own side, a walk planned through it is planned again,
// and it falls at its time. The shared rule itself (wallSegmentFor, wallCells, the wire form) is shared/test/barriers.test.ts.
import { describe, expect, it } from "vitest";
import {
  decodeCells, FIELD_KINDS, FROST_WALL_CAST_MS, FROST_WALL_LENGTH, FROST_WALL_MS, FROST_WALL_RANGE, mapFromTiles, mulberry32, PLAYER_RADIUS,
  TICK_MS, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, WISHES, circleClear, type FactionId, type FieldKind, type GameMap, type Vec2,
} from "@raid/shared";
import { combatant } from "../src/sim/combatant";
import { createGameWorld } from "../src/sim/gameplay";
import { enqueueClientMessage } from "../src/sim/inputs";
import { addPlayer, step } from "../src/sim/step";
import { collisionMap, type World } from "../src/sim/world";

const W_TILES = 40;
const H_TILES = 20;

function roomMap(): GameMap {
  const tiles = new Uint8Array(W_TILES * H_TILES).fill(TILE_FLOOR);
  for (let x = 0; x < W_TILES; x++) { tiles[x] = TILE_WALL; tiles[(H_TILES - 1) * W_TILES + x] = TILE_WALL; }
  for (let y = 0; y < H_TILES; y++) { tiles[y * W_TILES] = TILE_WALL; tiles[y * W_TILES + W_TILES - 1] = TILE_WALL; }
  return { ...mapFromTiles(W_TILES, H_TILES, tiles), spawns: Array.from({ length: 8 }, (_, i) => ({ x: (3 + i) * TILE + 16, y: 3 * TILE + 16 })) };
}

const T = (w: World) => w.state.serverTime;

function rig(factions: FactionId[]): World {
  const map = roomMap();
  const world = createGameWorld({
    seed: 7, map: { ...map, seed: 7 },
    config: {
      minPlayers: factions.length, lobbySeconds: 15, fillSeconds: 0, patienceSeconds: 3600, patienceMinSeconds: 3600,
      suddenDeathSeconds: 3600, pvpRules: false, wishLockSeconds: 0, regen: false,
    },
    random: mulberry32(8),
  }, { signatures: false });
  world.map = map;
  factions.forEach((f, i) => addPlayer(world, `p${i}`, `player${i}`, { faction: f }));
  step(world, TICK_MS);
  expect(world.state.phase).toBe("active");
  factions.forEach((_, i) => {
    const p = world.state.players.get(`p${i}`)!;
    p.maxHp = 1e9;
    p.hp = 1e9;
  });
  return world;
}

function place(world: World, who: string, at: Vec2): void {
  const c = combatant(world, who)!;
  c.s.x = at.x;
  c.s.y = at.y;
  c.rt.path = [];
  c.rt.history = [{ t: T(world), x: at.x, y: at.y }];
}

function castAt(world: World, who: string, x: number, y: number): void {
  expect(enqueueClientMessage(world.players.get(who)!.inputs, "cast", { slot: "wish", x, y, seq: 1 })).toBe(true);
}

function runFor(world: World, ms: number): void {
  const end = T(world) + ms;
  while (T(world) < end) step(world, TICK_MS);
}

const walls = (w: World) => [...w.state.fields.values()].filter((f) => FIELD_KINDS[f.kind] === ("wall" satisfies FieldKind));

/** Tile centre in world units. */
const tc = (t: number) => t * TILE + TILE / 2;

describe("Frost Wall", () => {
  it("is Frost's Wish, aimed with a preview", () => {
    expect(WISHES.frost).toBe("frostWall");
  });

  it("stands at the aim point square to the caster for FROST_WALL_MS: its tiles are LOW, then floor again", () => {
    const w = rig(["frost", "fire"]);
    place(w, "p0", { x: tc(5), y: tc(10) });
    place(w, "p1", { x: tc(30), y: tc(3) });
    castAt(w, "p0", tc(12), tc(10));
    runFor(w, FROST_WALL_CAST_MS + TICK_MS);
    const [f] = walls(w);
    expect(f, "a wall field").toBeDefined();
    const cells = decodeCells(f!.cells, W_TILES * H_TILES);
    // Aimed east along a row: a column of tiles at x = 12, about FROST_WALL_LENGTH long.
    const xs = new Set(cells.map((i) => i % W_TILES));
    expect([...xs]).toEqual([12]);
    expect(cells.length).toBeGreaterThanOrEqual(Math.floor(FROST_WALL_LENGTH / TILE));
    expect(cells.length).toBeLessThanOrEqual(Math.ceil(FROST_WALL_LENGTH / TILE) + 2);
    const cm = collisionMap(w);
    for (const i of cells) expect(cm.tiles[i]).toBe(TILE_LOW);
    expect(w.map.tiles[cells[0]!]).toBe(TILE_FLOOR); // the map itself never changes
    expect(f!.endsAt - f!.startedAt).toBe(FROST_WALL_MS);
    runFor(w, FROST_WALL_MS + TICK_MS);
    expect(walls(w)).toHaveLength(0);
    expect(collisionMap(w)).toBe(w.map);
  });

  it("is clamped to its range: a cursor far away raises it FROST_WALL_RANGE from the caster", () => {
    const w = rig(["frost", "fire"]);
    place(w, "p0", { x: tc(3), y: tc(10) });
    place(w, "p1", { x: tc(30), y: tc(3) });
    castAt(w, "p0", tc(38), tc(10));
    runFor(w, FROST_WALL_CAST_MS + TICK_MS);
    const cells = decodeCells(walls(w)[0]!.cells, W_TILES * H_TILES);
    const x = cells[0]! % W_TILES;
    expect(Math.abs(tc(x) - (tc(3) + FROST_WALL_RANGE))).toBeLessThanOrEqual(TILE);
  });

  it("sets a fighter it lands on down on its own side, clear of the ice; the caster stays on its side", () => {
    const w = rig(["frost", "fire"]);
    place(w, "p0", { x: tc(5), y: tc(10) });
    // Right on the wall's column: the far side of the line from the caster is east.
    place(w, "p1", { x: tc(12) - 4, y: tc(10) });
    castAt(w, "p0", tc(12), tc(10));
    runFor(w, FROST_WALL_CAST_MS + TICK_MS);
    const p1 = w.state.players.get("p1")!;
    const cm = collisionMap(w);
    expect(circleClear(cm, p1, PLAYER_RADIUS)).toBe(true);
    // p1 stood west of the wall's centre line (4 u), so it is set down west, on its own side.
    expect(p1.x).toBeLessThan(tc(12));
    const p0 = w.state.players.get("p0")!;
    expect(circleClear(cm, p0, PLAYER_RADIUS)).toBe(true);
  });

  it("a walk planned through it is planned again round it, and nobody walks into the ice", () => {
    const w = rig(["frost", "fire"]);
    place(w, "p0", { x: tc(3), y: tc(16) });
    place(w, "p1", { x: tc(8), y: tc(10) });
    // p1 walks east across where the wall will stand.
    expect(enqueueClientMessage(w.players.get("p1")!.inputs, "move", { x: tc(20), y: tc(10) })).toBe(true);
    step(w, TICK_MS);
    castAt(w, "p0", tc(13), tc(10));
    // The wall is square to the line from p0 (south-west) to the aim: a diagonal across p1's walk.
    let inside = 0;
    for (let t = 0; t < 120; t++) {
      step(w, TICK_MS);
      if (!circleClear(collisionMap(w), w.state.players.get("p1")!, PLAYER_RADIUS - 1)) inside++;
    }
    expect(walls(w).length + (T(w) > FROST_WALL_MS ? 1 : 0)).toBeGreaterThan(0);
    expect(inside, "ticks p1 spent overlapping the ice").toBe(0);
    // It still got where it was going (round the wall, or after it fell).
    const p1 = w.state.players.get("p1")!;
    expect(Math.hypot(p1.x - tc(20), p1.y - tc(10))).toBeLessThan(TILE);
  });

  it("outlives its caster, and the teleport and the run's end take it down with every other area", () => {
    const w = rig(["frost", "fire", "holy"]);
    place(w, "p0", { x: tc(5), y: tc(10) });
    place(w, "p1", { x: tc(30), y: tc(3) });
    place(w, "p2", { x: tc(30), y: tc(16) });
    castAt(w, "p0", tc(12), tc(10));
    runFor(w, FROST_WALL_CAST_MS + TICK_MS);
    expect(walls(w)).toHaveLength(1);
    w.state.players.get("p0")!.hp = 0;
    w.state.players.get("p0")!.maxHp = 1;
    runFor(w, 200);
    expect(walls(w)).toHaveLength(1);
  });
});
