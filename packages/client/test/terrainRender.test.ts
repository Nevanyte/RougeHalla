// LOW tiles on the client (zone terrain): the pickup hint uses the movement reach like the server, and a barrier that stops
// bodies is drawn. MapView and the minimap draw LOW as a minimum (the real art is a later task): a low block per kind on the
// map, a colour per kind on the minimap, and a wall's front face unchanged. The scene and the DOM are fake (test/fakes.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERACT_RANGE, mapFromTiles, PLAYER_RADIUS, TERRAIN_CREVASSE, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, Y_SCALE,
  type GameMap, type Vec2,
} from "@raid/shared";
import type { ContainerState } from "@raid/shared/schema";
import { canInteract, nearestContainer } from "../src/render/interact";
import { LOW_HEIGHT, MapView, WALL_HEIGHT } from "../src/render/MapView";
import { Minimap } from "../src/ui/minimap";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { argsOf, fakeScene, installFakeDom, type FakeEl, type FakeObject } from "./fakes";

/** A walled `w` x `h` room of floor; `low` maps "tx,ty" to a terrain kind for a LOW tile, `walls` are extra WALL tiles. */
function room(w: number, h: number, low: Record<string, number> = {}, walls: ReadonlyArray<readonly [number, number]> = []): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  for (const [key, kind] of Object.entries(low)) {
    const [tx, ty] = key.split(",").map(Number) as [number, number];
    tiles[ty * w + tx] = TILE_LOW;
    terrain[ty * w + tx] = kind;
  }
  for (const [tx, ty] of walls) tiles[ty * w + tx] = TILE_WALL;
  return mapFromTiles(w, h, tiles, 0, terrain);
}

/** A strip of LOW at column `tx`, rows 1..h-2. */
const strip = (w: number, h: number, tx: number, kind = TERRAIN_FENCE): GameMap =>
  room(w, h, Object.fromEntries(Array.from({ length: h - 2 }, (_, i) => [`${tx},${i + 1}`, kind])));

// ---- the pickup hint ---------------------------------------------------------------------------------------------------------

describe("canInteract across a LOW fence", () => {
  const west: Vec2 = { x: 12 * TILE - PLAYER_RADIUS, y: 256 };
  const east: Vec2 = { x: 13 * TILE + PLAYER_RADIUS, y: 256 };

  it("is refused at exactly INTERACT_RANGE (a hand does not reach through bars), as the server refuses the pickup", () => {
    expect(Math.hypot(east.x - west.x, east.y - west.y)).toBe(INTERACT_RANGE);
    expect(canInteract(strip(24, 16, 12), west, east)).toBe(false);
    expect(canInteract(strip(24, 16, 12, TERRAIN_LAVA), west, east)).toBe(false);
  });

  it("is accepted at the same distance on open floor, and refused beyond the range", () => {
    expect(canInteract(room(24, 16), west, east)).toBe(true);
    expect(canInteract(room(24, 16), west, { x: east.x + 1, y: east.y })).toBe(false);
  });

  it("a wall still refuses it", () => {
    const walls = Array.from({ length: 14 }, (_, i): [number, number] => [12, i + 1]);
    expect(canInteract(room(24, 16, {}, walls), west, east)).toBe(false);
  });

  it("nearestContainer skips a weapon behind the fence and takes the one on this side", () => {
    const box = (id: string, at: Vec2): ContainerState => ({ id, x: at.x, y: at.y, items: [{ def: "bow" }] }) as never;
    const boxes = [box("far", east), box("near", { x: west.x - 20, y: west.y })];
    const containers = { forEach: (cb: (c: ContainerState, id: string) => void) => boxes.forEach((c) => cb(c, c.id)) };
    expect(nearestContainer(containers, strip(24, 16, 12), west)?.id).toBe("near");
    // Only the weapon behind the fence: nothing to take across it, the weapon on open floor.
    const behind = { forEach: (cb: (c: ContainerState, id: string) => void) => cb(boxes[0]!, "far") };
    expect(nearestContainer(behind, strip(24, 16, 12), west)).toBeNull();
    expect(nearestContainer(behind, room(24, 16), west)?.id).toBe("far");
  });
});

// ---- MapView -------------------------------------------------------------------------------------------------------------------

describe("MapView draws LOW tiles", () => {
  const LAVA_TOP = 0xff5a14;
  const CREVASSE_TOP = 0x0a1626;

  /** Every call of `name` on a Graphics, as argument lists. */
  const calls = (g: FakeObject, name: string): unknown[][] => argsOf(g, name);
  const depthOf = (g: FakeObject): number => g.state.depth as number;
  const fillColors = (g: FakeObject): unknown[] => calls(g, "fillStyle").map(([c]) => c);

  function graphics(map: GameMap): FakeObject[] {
    const { scene, ofKind } = fakeScene();
    new MapView(scene, map);
    return ofKind("graphics");
  }

  it("adds one Graphics per row that has LOW, at the row's south-edge depth, and none for a map without LOW", () => {
    const base = graphics(room(12, 10));
    // Rows 3 and 5 have LOW (a lava tile, a fence run).
    const lowMap = room(12, 10, { "4,3": TERRAIN_LAVA, "6,5": TERRAIN_FENCE, "7,5": TERRAIN_FENCE });
    const withLow = graphics(lowMap);
    expect(withLow.length).toBe(base.length + 2);
    const lowRows = withLow.filter((g) => fillColors(g).includes(LAVA_TOP) || fillColors(g).includes(0x5a606a));
    expect(lowRows.map(depthOf).sort((a, b) => a - b)).toEqual([4 * TILE, 6 * TILE]);
  });

  it("draws a LOW tile as a low block: a top face lifted by LOW_HEIGHT and a front face LOW_HEIGHT tall (half a wall)", () => {
    expect(LOW_HEIGHT).toBeLessThan(WALL_HEIGHT);
    const map = room(12, 10, { "4,3": TERRAIN_LAVA });
    const g = graphics(map).find((o) => fillColors(o).includes(LAVA_TOP))!;
    const rects = calls(g, "fillRect");
    const top = (3 * TILE) * Y_SCALE - LOW_HEIGHT;
    const front = (4 * TILE) * Y_SCALE - LOW_HEIGHT;
    // The front face (under the south edge) and the top face (the footprint lifted), each one tile wide.
    expect(rects).toContainEqual([4 * TILE, front, TILE, LOW_HEIGHT]);
    expect(rects).toContainEqual([4 * TILE, top, TILE, TILE * Y_SCALE]);
    // A lighter rim round the top.
    expect(calls(g, "strokeRect")).toContainEqual([4 * TILE, top, TILE, TILE * Y_SCALE]);
  });

  it("colours each kind its own: lava orange, crevasse near-black, a fence (and a kind-less LOW) grey; a run keeps one kind", () => {
    const map = room(14, 8, { "2,3": TERRAIN_LAVA, "3,3": TERRAIN_LAVA, "4,3": TERRAIN_CREVASSE, "5,3": TERRAIN_FENCE, "6,3": 0 });
    const g = graphics(map).find((o) => fillColors(o).includes(LAVA_TOP))!;
    const colors = new Set(fillColors(g));
    expect(colors.has(LAVA_TOP)).toBe(true);
    expect(colors.has(CREVASSE_TOP)).toBe(true);
    expect(colors.has(0x5a606a)).toBe(true); // the fence and the kind-less tile share the grey
    // The two lava tiles are one run: one top face two tiles wide.
    const top = (3 * TILE) * Y_SCALE - LOW_HEIGHT;
    expect(calls(g, "fillRect")).toContainEqual([2 * TILE, top, 2 * TILE, TILE * Y_SCALE]);
  });

  it("hides the front face of a LOW tile that has LOW to its south (the south tile's top covers it)", () => {
    const map = room(12, 10, { "4,3": TERRAIN_FENCE, "4,4": TERRAIN_FENCE });
    const rows = graphics(map).filter((o) => fillColors(o).includes(0x5a606a));
    expect(rows).toHaveLength(2);
    const frontOf = (g: FakeObject, southEdge: number) =>
      calls(g, "fillRect").filter(([, y, , h]) => y === southEdge * Y_SCALE - LOW_HEIGHT && h === LOW_HEIGHT);
    const [upper, lower] = rows.sort((a, b) => depthOf(a) - depthOf(b)) as [FakeObject, FakeObject];
    expect(frontOf(upper, 4 * TILE)).toHaveLength(0);
    expect(frontOf(lower, 5 * TILE)).toHaveLength(1);
  });

  it("leaves a wall's front face whole when a LOW tile is south of it, and a wall row's drawing as it was", () => {
    // A wall at (4, 2) with a fence tile below it at (4, 3): the wall keeps its full WALL_HEIGHT front face.
    const map = room(12, 10, { "4,3": TERRAIN_FENCE }, [[4, 2]]);
    const wallRow = graphics(map).find((o) => depthOf(o) === 3 * TILE && !fillColors(o).includes(0x5a606a))!;
    const southEdge = 3 * TILE;
    expect(calls(wallRow, "fillRect")).toContainEqual([4 * TILE, southEdge * Y_SCALE - WALL_HEIGHT, TILE, WALL_HEIGHT]);
    // Identical to the same wall on a map with no LOW at all.
    const plain = graphics(room(12, 10, {}, [[4, 2]])).find((o) => depthOf(o) === 3 * TILE)!;
    expect(calls(wallRow, "fillRect")).toEqual(calls(plain, "fillRect"));
    expect(fillColors(wallRow)).toEqual(fillColors(plain));
  });
});

// ---- the minimap ---------------------------------------------------------------------------------------------------------------

describe("the minimap paints LOW tiles", () => {
  beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** The offscreen layer's calls after setMap(map): fill colours and rects in order. */
  function paint(map: GameMap): Array<{ color: string; rect: unknown[] }> {
    const { doc } = installFakeDom();
    const made: FakeEl[] = [];
    const create = doc.createElement;
    doc.createElement = (tag: string) => { const e = create(tag); made.push(e); return e; };
    const minimap = new Minimap({});
    minimap.setMap(map);
    const ctx = made[1]!.getContext();
    const out: Array<{ color: string; rect: unknown[] }> = [];
    let color = "";
    for (const [name, args] of ctx.calls) {
      if (name === "fillStyle=") color = args[0] as string;
      else if (name === "fillRect") out.push({ color, rect: [...args] });
    }
    return out;
  }

  const LAVA = "#ff5a14";
  const FENCE = "#b4aed2";
  const CREVASSE = "#0a1626";
  const WALL = "#9aa3ad";

  it("paints lava orange, fence light grey-violet and crevasse dark, one fillRect per run of one kind per row", () => {
    const map = room(16, 8, { "3,3": TERRAIN_LAVA, "4,3": TERRAIN_LAVA, "5,3": TERRAIN_FENCE, "8,3": TERRAIN_CREVASSE });
    const fills = paint(map);
    expect(fills.filter((f) => f.color === LAVA)).toHaveLength(1); // two lava tiles, one run
    expect(fills.filter((f) => f.color === FENCE)).toHaveLength(1);
    expect(fills.filter((f) => f.color === CREVASSE)).toHaveLength(1);
    const lava = fills.find((f) => f.color === LAVA)!;
    const fence = fills.find((f) => f.color === FENCE)!;
    expect((lava.rect[2] as number)).toBeGreaterThan(fence.rect[2] as number); // two tiles wide against one
  });

  it("paints LOW after the region tints and before the walls", () => {
    const map = room(16, 8, { "3,3": TERRAIN_LAVA });
    map.regionGrid.fill(1); // fire everywhere: a region tint on every row
    const fills = paint(map);
    const at = (color: string) => fills.findIndex((f) => f.color === color);
    const lastTint = fills.map((f) => f.color).lastIndexOf("rgba(255, 112, 67, 0.22)");
    expect(lastTint).toBeGreaterThanOrEqual(0);
    expect(at(LAVA)).toBeGreaterThan(lastTint);
    expect(at(LAVA)).toBeLessThan(at(WALL));
  });

  it("paints nothing extra for a map without LOW", () => {
    const colors = new Set(paint(room(16, 8)).map((f) => f.color));
    expect(colors.has(LAVA) || colors.has(FENCE) || colors.has(CREVASSE)).toBe(false);
  });
});
