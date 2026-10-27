// MapView on a fake scene: the floor and the walls are built in chunks, a zone border is painted as dashes in each zone's colour,
// and just before each render the chunks the camera does not show are hidden. The map is hand-built (no generator involved).
import { describe, expect, it } from "vitest";
import { REGION_FACTIONS, TILE, TILE_WALL, Y_SCALE, mapFromTiles, type GameMap } from "@raid/shared";
import { ALPHA_EDGE, MapView, PRE_RENDER } from "../src/render/MapView";
import { EDGE_PX, ZONE_DASH } from "../src/render/zoneEdges";
import { argsOf, fakeObject, fakeScene, type FakeObject } from "./fakes";

const W = 96;
const H = 96;

/** A 96 x 96 map: a wall border, a few rock pillars, fire on the west half and sentenced on the east, split at x = 48. */
function bigMap(): GameMap {
  const tiles = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (border || (x % 9 === 4 && y % 7 === 3)) tiles[y * W + x] = TILE_WALL;
    }
  }
  const map = mapFromTiles(W, H, tiles);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) map.regionGrid[y * W + x] = x < 48 ? 1 : 2;
  return map;
}

/** A scene with the camera and the event emitter a MapView reads; `look` points the camera at world (x, y) ground units. */
function setup(map: GameMap = bigMap()) {
  const f = fakeScene();
  const events = fakeObject("events");
  const camera = f.scene as unknown as { cameras: { main: FakeObject } };
  const scene = { ...(f.scene as object), events } as never;
  const cam = camera.cameras.main;
  cam.width = 800;
  cam.height = 600;
  cam.zoom = 1;
  const look = (x: number, y: number): void => {
    cam.scrollX = x - 400;
    cam.scrollY = y * Y_SCALE - 300;
  };
  look(400, 300);
  const view = new MapView(scene, map);
  const preRender = (): void => {
    const handlers = argsOf(events, "on").filter(([name]) => name === PRE_RENDER).map(([, fn]) => fn as () => void);
    for (const fn of handlers) fn();
  };
  const graphics = f.ofKind("graphics");
  /** Graphics that currently draw: not hidden by `setVisible(false)` (the last call wins). */
  const shown = (): FakeObject[] => graphics.filter((g) => g.state.visible !== false);
  return { f, view, events, cam, look, preRender, graphics, shown };
}

describe("MapView chunks", () => {
  it("builds the floor in bands of rows by runs of columns, and the wall rows in chunks of columns", () => {
    const { graphics } = setup();
    // One base rectangle, 12 bands of 8 rows by 4 runs of 24 columns, then wall chunks (every row has the border's walls).
    const floorChunks = graphics.filter((g) => g.state.depth === -1e6 + 1);
    expect(floorChunks).toHaveLength(12 * 4);
    expect(graphics.filter((g) => g.state.depth === -1e6)).toHaveLength(1);
    // A wall chunk is one row of one run of columns that has a wall in it; the rest draw nothing.
    const map = bigMap();
    let expected = 0;
    for (let ty = 0; ty < H; ty++) {
      for (let cx = 0; cx < W; cx += 24) {
        let wall = false;
        for (let tx = cx; tx < cx + 24; tx++) wall ||= map.tiles[ty * W + tx] === TILE_WALL;
        if (wall) expected++;
      }
    }
    expect(graphics.filter((g) => typeof g.state.depth === "number" && g.state.depth >= 0)).toHaveLength(expected);
    expect(expected).toBeGreaterThan(200);
  });

  it("paints the whole map once between the chunks: every tile's region fill is drawn exactly once", () => {
    const { graphics } = setup();
    const area = graphics.filter((g) => g.state.depth === -1e6 + 1).reduce((sum, g) => {
      for (const [x, y, w, h] of argsOf(g, "fillRect") as number[][]) {
        void x; void y;
        if (Math.abs(h - TILE * Y_SCALE) < 1e-6) sum += w;
      }
      return sum;
    }, 0);
    // Width of every one-row fill: the 94 x 94 painted tiles, minus nothing (walls are painted on the floor too).
    expect(area / TILE).toBe(94 * 94);
  });

  it("paints the zone border as dashes in each zone's own colour, on its own side of the line", () => {
    const { graphics } = setup();
    const chunks = graphics.filter((g) => g.state.depth === -1e6 + 1);
    const fire = 0xff7043;
    const sentenced = 0x9575cd;
    const fills = (g: FakeObject, colour: number): number => g.calls.reduce((n, [name, a], i) => {
      if (name !== "fillStyle" || a[0] !== colour || a[1] !== ALPHA_EDGE) return n;
      // The next calls up to the following fillStyle are that strip's dashes.
      let rects = 0;
      for (let j = i + 1; j < g.calls.length && g.calls[j]![0] === "fillRect"; j++) rects++;
      return n + rects;
    }, 0);
    const fireDashes = chunks.reduce((n, g) => n + fills(g, fire), 0);
    const sentencedDashes = chunks.reduce((n, g) => n + fills(g, sentenced), 0);
    expect(fireDashes).toBeGreaterThan(20);
    expect(sentencedDashes).toBeGreaterThan(20);
    // Fire's strip lies west of the line at x = 48 tiles, sentenced's east of it, both EDGE_PX wide.
    const edge = 48 * TILE;
    const rects = (colour: number): number[][] => chunks.flatMap((g) => {
      const out: number[][] = [];
      g.calls.forEach(([name, a], i) => {
        if (name !== "fillStyle" || a[0] !== colour || a[1] !== ALPHA_EDGE) return;
        for (let j = i + 1; j < g.calls.length && g.calls[j]![0] === "fillRect"; j++) out.push(g.calls[j]![1] as number[]);
      });
      return out;
    });
    for (const [x, , w] of rects(fire)) { expect(x).toBe(edge - EDGE_PX); expect(w).toBe(EDGE_PX); }
    for (const [x, , w] of rects(sentenced)) { expect(x).toBe(edge); expect(w).toBe(EDGE_PX); }
    // The two zones' dashes differ in rhythm (their lengths along the line).
    const lens = (colour: number): Set<number> => new Set(rects(colour).map(([, , , h]) => Math.round(h! * 100) / 100));
    expect(lens(fire)).not.toEqual(lens(sentenced));
    expect(ZONE_DASH.fire).not.toEqual(ZONE_DASH.sentenced);
    expect(REGION_FACTIONS.length).toBe(5);
  });
});

describe("MapView culling", () => {
  it("shows every chunk at first when the camera sees the whole map, and hides those it does not once it looks at a corner", () => {
    const { graphics, shown, look, preRender, cam } = setup();
    // The whole map: zoom out far enough.
    cam.zoom = 0.2;
    look(W * TILE / 2, H * TILE / 2);
    preRender();
    expect(shown().length).toBe(graphics.length);
    cam.zoom = 1;
    look(200, 200);
    preRender();
    const visible = shown();
    expect(visible.length).toBeLessThan(graphics.length / 4);
    // The base rectangle is never hidden.
    expect(visible.some((g) => g.state.depth === -1e6)).toBe(true);
  });

  it("brings the chunks back in the same frame the camera jumps (a teleport), not one frame later", () => {
    const { graphics, shown, look, preRender } = setup();
    look(200, 200);
    preRender();
    const nearOrigin = new Set(shown());
    look((W - 4) * TILE, (H - 4) * TILE);
    preRender();
    const nearEnd = new Set(shown());
    expect(nearEnd.size).toBeGreaterThan(5);
    // Nothing is shown at both ends: they are 90 tiles apart.
    for (const g of nearEnd) if (g.state.depth !== -1e6) expect(nearOrigin.has(g)).toBe(false);
    expect(graphics.filter((g) => !nearEnd.has(g)).length).toBeGreaterThan(graphics.length / 2);
  });

  it("only calls setVisible when a chunk changes", () => {
    const { graphics, look, preRender } = setup();
    look(200, 200);
    preRender();
    const count = (): number => graphics.reduce((n, g) => n + argsOf(g, "setVisible").length, 0);
    const before = count();
    preRender();
    preRender();
    expect(count()).toBe(before);
  });

  it("shows everything while the camera has no size yet", () => {
    const { graphics, shown, cam, preRender } = setup();
    cam.width = 0;
    cam.height = 0;
    preRender();
    expect(shown().length).toBe(graphics.length);
  });

  it("stops listening when it is destroyed, and a late event does nothing", () => {
    const { view, events, preRender, graphics } = setup();
    view.destroy();
    expect(argsOf(events, "off").some(([name]) => name === PRE_RENDER)).toBe(true);
    const calls = graphics.reduce((n, g) => n + g.calls.length, 0);
    preRender();
    expect(graphics.reduce((n, g) => n + g.calls.length, 0)).toBe(calls);
  });
});
