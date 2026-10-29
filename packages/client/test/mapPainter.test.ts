// The shared map painter (ui/mapPainter.ts): the extraction out of the minimap changed no pixels, every zone has its own
// pattern and shape (hue is never the only cue), and camps, crates, the route and the player are drawn as described. The
// 2D context is a call recorder (test/fakes.ts).
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FACTION_IDS, FACTIONS, REGION_IDS, TILE, TILE_WALL, generateMap, isWallTile, mapFromTiles, type CampDef, type GameMap,
} from "@raid/shared";
import { mapSpan } from "../src/ui/minimapMath";
import { cssColor } from "../src/ui/dom";
import {
  COLOR_BG, COLOR_REGION, COLOR_WALL, CROWN_CLIP_PATH, SHAPE_POLYGON, ZONE_PATTERN, ZONE_SHAPE, gateRects, makePatternTile,
  paintCamps, paintCrates, paintMapBase, paintPlayer, paintRoute, patternPeriod, zoneClipPath, type PaintCtx,
} from "../src/ui/mapPainter";
import { Minimap } from "../src/ui/minimap";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { FakeEl, argsOf, fakeObject, installFakeDom, names, type FakeObject } from "./fakes";

afterEach(() => { vi.unstubAllGlobals(); });

const rec = (): FakeObject => fakeObject("ctx");
const ctxOf = (o: FakeObject): PaintCtx => o as unknown as PaintCtx;
const hashOf = (o: FakeObject): string => createHash("sha256").update(JSON.stringify(o.calls)).digest("hex").slice(0, 16);

/** Like hashOf for a recording that holds patterns: a pattern (the recorder itself) and its tile canvas become what they drew. */
const hashWithPatterns = (o: FakeObject): string => createHash("sha256")
  .update(JSON.stringify(o.calls, (_k, v: unknown) => {
    if (v instanceof FakeEl) return { canvas: [v.width, v.height, (v.getContext() as FakeObject).calls] };
    if (typeof v === "object" && v !== null && (v as { kind?: unknown }).kind === "ctx") return "[pattern]";
    return v;
  })).digest("hex").slice(0, 16);

/** A small map with a border and scattered walls, six region stripes and two gates: independent of the map generator. */
function handMap(): GameMap {
  const w = 24;
  const h = 20;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      if (border || (x * 7 + y * 3) % 11 === 0) tiles[y * w + x] = TILE_WALL;
    }
  }
  const map = mapFromTiles(w, h, tiles);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) map.regionGrid[y * w + x] = x < 3 ? 0 : x >= 20 ? 6 : 1 + (Math.floor((x - 3) / 3) % 5);
  }
  map.coliseum.gates = [
    { side: "n", tiles: [{ x: 11, y: 4 }, { x: 12, y: 4 }], x: 12 * 32, y: 4.5 * 32 },
    { side: "e", tiles: [{ x: 18, y: 9 }], x: 18.5 * 32, y: 9.5 * 32 },
  ];
  return map;
}

/**
 * A second small map, unlike the first: wider than tall, rock pillars, a wall bar, the five zones as blocks around a coliseum
 * block, so the pattern layer has every zone to paint. Hand-built too: no generator is involved.
 */
function handMapB(): GameMap {
  const w = 30;
  const h = 17;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const pillar = x % 5 === 2 && y % 4 === 2;
      const bar = y === 8 && x >= 12 && x <= 17;
      if (border || pillar || bar) tiles[y * w + x] = TILE_WALL;
    }
  }
  const map = mapFromTiles(w, h, tiles);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const coliseum = x >= 12 && x < 18 && y >= 5 && y < 12;
      map.regionGrid[y * w + x] = coliseum ? 6 : y < 8 ? 1 + (x < 10 ? 0 : x < 20 ? 1 : 2) : 4 + (x < 15 ? 0 : 1);
    }
  }
  return map;
}

/** A generated map without its features (and the landmark boxes they came with): the painter's output is the pre-feature one. */
function bare(map: GameMap): GameMap {
  return { ...map, features: [], featureGrid: new Uint8Array(map.w * map.h) };
}

/** The original Minimap.setMap body, kept verbatim as the reference the extraction must reproduce. */
function referenceBase(g: FakeObject, map: GameMap, w: number, h: number, k: number): void {
  const tile = TILE * k;
  g.clearRect(0, 0, w, h);
  g.fillStyle = COLOR_BG;
  g.fillRect(0, 0, w, h);
  const codes = map.regionGrid;
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.round(ty * tile);
    const bottom = Math.round((ty + 1) * tile);
    let start = 0;
    for (let tx = 1; tx <= map.w; tx++) {
      if (tx < map.w && codes[ty * map.w + tx] === codes[ty * map.w + start]) continue;
      const color = COLOR_REGION[REGION_IDS[codes[ty * map.w + start]!] ?? "none"];
      if (color) {
        const left = Math.round(start * tile);
        g.fillStyle = color;
        g.fillRect(left, top, Math.round(tx * tile) - left, bottom - top);
      }
      start = tx;
    }
  }
  g.fillStyle = COLOR_WALL;
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * tile);
    const bottom = Math.ceil((ty + 1) * tile);
    let start = -1;
    for (let tx = 0; tx <= map.w; tx++) {
      if (tx < map.w && isWallTile(map, tx, ty)) {
        if (start < 0) start = tx;
      } else if (start >= 0) {
        const left = Math.floor(start * tile);
        g.fillRect(left, top, Math.ceil(tx * tile) - left, bottom - top);
        start = -1;
      }
    }
  }
}

const BACKING = 208; // the minimap's backing store at a 1280 x 800 window, dpr 1
/**
 * The hand-built map's scale is a literal on purpose: the goldens below were recorded at it, so they pin the painter and
 * nothing else (not the generator, not the world's size). A generated map is painted at the scale the minimap really uses.
 */
const K = BACKING / 2048;
const K_GEN = BACKING / mapSpan();
/** Recorded from this code (a hand-built map, so only the painter can move them); re-record by hand when the painter's look changes on purpose. */
const GOLDEN_B_CALLS = 240;
const GOLDEN_B_HASH = "dc2b900de1462355";

describe("the extraction out of the minimap changed no pixels", () => {
  it("paints a hand-built map with exactly the calls the minimap made before (golden, taken from the pre-extraction code)", () => {
    const g = rec();
    paintMapBase(ctxOf(g), handMap(), BACKING, BACKING, K);
    expect(g.calls).toHaveLength(355);
    expect(hashOf(g)).toBe("bf0e83b2e9418bfe");
  });

  it("paints a second hand-built map with its zone patterns on exactly as it was recorded (golden, the patterns layer)", () => {
    installFakeDom();
    const g = rec();
    paintMapBase(ctxOf(g), handMapB(), BACKING, BACKING, K, { patterns: true });
    expect(argsOf(g, "createPattern")).toHaveLength(5);
    expect(g.calls).toHaveLength(GOLDEN_B_CALLS);
    expect(hashWithPatterns(g)).toBe(GOLDEN_B_HASH);
  });

  it("matches the reference body call for call on a generated map, with the patterns off", () => {
    // The reference body predates floor hazards, low ground and the zone shapes' feature colours, so it is held to maps that have
    // none (the stylers off, and the landmarks the plain generator keeps taken out): a map with no features paints as it always did.
    for (const seed of [7, 31]) {
      const map = bare(generateMap(seed, undefined, { styleZones: null }));
      const a = rec();
      const b = rec();
      paintMapBase(ctxOf(a), map, BACKING, BACKING, K_GEN, { patterns: false });
      referenceBase(b, map, BACKING, BACKING, K_GEN);
      expect(a.calls.length).toBeGreaterThan(500);
      expect(a.calls).toEqual(b.calls);
    }
  });

  it("is the default: no options means the original look", () => {
    const map = generateMap(7);
    const a = rec();
    const b = rec();
    paintMapBase(ctxOf(a), map, BACKING, BACKING, K_GEN);
    paintMapBase(ctxOf(b), map, BACKING, BACKING, K_GEN, { patterns: false });
    expect(a.calls).toEqual(b.calls);
  });

  it("the gate rectangles are the ones the minimap computed", () => {
    const map = handMap();
    const tile = TILE * K;
    const want: number[] = [];
    for (const gate of map.coliseum.gates) {
      for (const t of gate.tiles) {
        const left = Math.floor(t.x * tile);
        const top = Math.floor(t.y * tile);
        want.push(left, top, Math.ceil((t.x + 1) * tile) - left, Math.ceil((t.y + 1) * tile) - top);
      }
    }
    expect(gateRects(map, K)).toEqual(want);
    expect(want).toHaveLength(12);
  });

  it("the minimap's static layer still holds every fill the original drew (the patterns only add)", () => {
    installFakeDom();
    const made = trackCanvases();
    setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true }));
    const minimap = new Minimap();
    const map = generateMap(7);
    minimap.setMap(map);
    const layer = made[1]!.getContext() as FakeObject;
    const plain = rec();
    paintMapBase(ctxOf(plain), map, BACKING, BACKING, K_GEN);
    expect(layer.calls.length).toBeGreaterThan(plain.calls.length);
    const layerRects = new Set(argsOf(layer, "fillRect").map((a) => a.join()));
    for (const r of argsOf(plain, "fillRect")) expect(layerRects.has(r.join())).toBe(true);
    expect(argsOf(layer, "createPattern")).toHaveLength(5);
  });
});

/** Every element document.createElement makes from now on, in order (the first two of a Minimap are its canvas and its layer). */
function trackCanvases(): FakeEl[] {
  const made: FakeEl[] = [];
  const doc = document as unknown as { createElement(tag: string): FakeEl };
  const create = doc.createElement;
  doc.createElement = (tag: string) => { const e = create(tag); made.push(e); return e; };
  return made;
}

describe("quiet tactical terrain", () => {
  it("keeps wall geometry while lowering terrain and region opacity", () => {
    const standard = rec(), tactical = rec();
    paintMapBase(ctxOf(standard), handMap(), BACKING, BACKING, K);
    paintMapBase(ctxOf(tactical), handMap(), BACKING, BACKING, K, { subdued: true });
    expect(argsOf(tactical, "fillRect")).toEqual(argsOf(standard, "fillRect"));
    expect(argsOf(tactical, "fillStyle=").map(([c]) => c)).toContain("#111a22");
    const regions = argsOf(tactical, "fillStyle=").map(([c]) => String(c)).filter((c) => c.startsWith("rgba("));
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((c) => c.endsWith("0.075)"))).toBe(true);
    expect(argsOf(tactical, "globalAlpha=").map(([v]) => v)).toContain(0.3);
    expect(names(tactical).at(-1)).toBe("restore");
  });

  it("retains zone patterns with thinner, much fainter strokes", () => {
    installFakeDom();
    const made = trackCanvases();
    const g = rec();
    makePatternTile("fire", 8, ctxOf(g));
    makePatternTile("fire", 8, ctxOf(g), true);
    const standard = made[0]!.getContext() as FakeObject;
    const tactical = made[1]!.getContext() as FakeObject;
    expect(argsOf(tactical, "lineWidth=")[0]![0]).toBeLessThan(argsOf(standard, "lineWidth=")[0]![0] as number);
    expect(String(argsOf(tactical, "strokeStyle=")[0]![0])).toContain("0.12)");
    expect(argsOf(tactical, "moveTo")).toEqual(argsOf(standard, "moveTo"));
  });
});

describe("zone identity without hue", () => {
  it("gives each of the five zones its own pattern and its own shape", () => {
    expect(new Set(FACTION_IDS.map((z) => ZONE_PATTERN[z])).size).toBe(5);
    expect(new Set(FACTION_IDS.map((z) => ZONE_SHAPE[z])).size).toBe(5);
    expect(new Set(FACTION_IDS.map((z) => zoneClipPath(z))).size).toBe(5);
    expect(Object.keys(ZONE_PATTERN).sort()).toEqual([...FACTION_IDS].sort());
  });

  it("every shape fits the unit box and has at least three corners", () => {
    for (const poly of Object.values(SHAPE_POLYGON)) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of poly) {
        expect(Math.abs(x)).toBeLessThanOrEqual(1);
        expect(Math.abs(y)).toBeLessThanOrEqual(1);
      }
    }
    expect(zoneClipPath("fire")).toMatch(/^polygon\(50% 0%, /);
    expect(CROWN_CLIP_PATH).toMatch(/^polygon\(/);
  });

  it("with the patterns on, fills each faction zone with a pattern of its own, and never the coliseum or the border", () => {
    installFakeDom();
    const made = trackCanvases();
    const g = rec();
    paintMapBase(ctxOf(g), handMap(), BACKING, BACKING, K, { patterns: true });
    // One tile canvas and one createPattern per faction zone present in the map (five); none for the coliseum or "none".
    expect(made.filter((e) => e.tag === "canvas")).toHaveLength(5);
    const patterns = argsOf(g, "createPattern");
    expect(patterns).toHaveLength(5);
    expect(new Set(patterns.map(([tile]) => tile)).size).toBe(5);
    for (const [, repeat] of patterns) expect(repeat).toBe("repeat");
    const patternFills = g.calls.filter(([n, a]) => n === "fillStyle=" && typeof a[0] === "object");
    expect(patternFills.length).toBeGreaterThan(5);
    // The walls are painted after the patterns, so they stay on top.
    const lastPattern = g.calls.map(([n, a], i) => (n === "fillStyle=" && typeof a[0] === "object" ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
    const wallColour = g.calls.findIndex(([n, a]) => n === "fillStyle=" && a[0] === COLOR_WALL);
    expect(wallColour).toBeGreaterThan(lastPattern);
  });

  it("each zone's tile is drawn differently", () => {
    installFakeDom();
    const made = trackCanvases();
    const drawn = FACTION_IDS.map((zone) => {
      made.length = 0;
      makePatternTile(zone, 10, ctxOf(rec()));
      const tileCtx = made.find((e) => e.tag === "canvas")!.getContext() as FakeObject;
      return JSON.stringify(tileCtx.calls.filter(([n]) => n !== "strokeStyle=" && n !== "fillStyle="));
    });
    expect(new Set(drawn).size).toBe(5);
  });

  it("makes no pattern where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(makePatternTile("fire", 8, ctxOf(rec()))).toBeNull();
  });

  it("scales the pattern with the map's size, within sane bounds", () => {
    expect(patternPeriod(100)).toBe(4);
    expect(patternPeriod(208)).toBe(5);
    expect(patternPeriod(1024)).toBe(22);
    expect(patternPeriod(4000)).toBe(22);
  });
});

describe("camps", () => {
  const camp = (zone: CampDef["zone"], x: number, y: number, eliteSpot = -1): Pick<CampDef, "zone" | "x" | "y" | "eliteSpot"> => ({ zone, x, y, eliteSpot });

  it("draws a camp as its zone's shape in its zone's colour with a dark outline", () => {
    const g = rec();
    paintCamps(ctxOf(g), [camp("frost", 400, 300)], K, 1.4);
    expect(argsOf(g, "fillStyle=").map(([c]) => c)).toEqual([cssColor(FACTIONS.frost.color)]);
    // A hexagon: a moveTo and five lineTos, closed, filled, stroked.
    expect(names(g).filter((n) => n === "moveTo")).toHaveLength(1);
    expect(names(g).filter((n) => n === "lineTo")).toHaveLength(5);
    expect(names(g)).toContain("fill");
    expect(names(g)).toContain("stroke");
  });

  it("draws every zone's camp with its own number of corners or outline", () => {
    const corners = FACTION_IDS.map((zone) => {
      const g = rec();
      paintCamps(ctxOf(g), [camp(zone, 400, 300)], K, 1);
      return names(g).filter((n) => n === "lineTo").length + 1;
    });
    // triangle, square, diamond, hexagon, cross: 3, 4, 4, 6, 12 corners. Square and diamond differ by orientation.
    expect(corners).toEqual([3, 4, 4, 6, 12]);
    const first = (zone: CampDef["zone"]) => { const g = rec(); paintCamps(ctxOf(g), [camp(zone, 400, 300)], K, 1); return argsOf(g, "moveTo")[0]!.join(); };
    expect(first("sentenced")).not.toBe(first("plague"));
  });

  it("gives an elite camp a bigger mark and a gold crown", () => {
    const plain = rec();
    const elite = rec();
    paintCamps(ctxOf(plain), [camp("fire", 400, 300)], K, 1);
    paintCamps(ctxOf(elite), [camp("fire", 400, 300, 0)], K, 1);
    expect(argsOf(elite, "fillStyle=").map(([c]) => c)).toEqual([cssColor(FACTIONS.fire.color), "#ffd54f"]);
    expect(argsOf(plain, "fillStyle=")).toHaveLength(1);
    const width = (g: FakeObject): number => {
      const xs = argsOf(g, "lineTo").map(([x]) => x as number).concat(argsOf(g, "moveTo").map(([x]) => x as number));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(elite)).toBeGreaterThan(width(plain));
  });

  it("scales with the minimap's own pixel unit and stays readable at the smallest size", () => {
    const extent = (g: FakeObject): number => {
      const xs = argsOf(g, "lineTo").map(([x]) => x as number).concat(argsOf(g, "moveTo").map(([x]) => x as number));
      return Math.max(...xs) - Math.min(...xs);
    };
    const at = (px: number): number => { const g = rec(); paintCamps(ctxOf(g), [camp("fire", 1000, 1000)], 1, px); return extent(g); };
    expect(at(7)).toBeGreaterThan(at(0.7));
    // The narrowest minimap (110 px, px = 110 / 150): a camp is still at least 4 device pixels across.
    expect(at(110 / 150)).toBeGreaterThanOrEqual(4);
  });
});

describe("crates, route and player", () => {
  it("draws a small square per crate", () => {
    const g = rec();
    paintCrates(ctxOf(g), [{ x: 100, y: 200 }, { x: 300, y: 400 }], 0.1, 1);
    expect(argsOf(g, "fillRect")).toHaveLength(2);
    expect(argsOf(g, "strokeRect")).toHaveLength(2);
  });

  it("draws the route as a dashed line with a ring per stop, the next one bigger, at the opacity asked", () => {
    const g = rec();
    g.globalAlpha = 1; // a real context starts at 1; the recorder has no properties of its own
    g.calls.length = 0;
    paintRoute(ctxOf(g), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], [{ x: 100, y: 0 }, { x: 100, y: 100 }], 1, 1, { alpha: 0.5, next: 1 });
    expect(argsOf(g, "globalAlpha=").map(([a]) => a)).toEqual([0.5, 1]);
    expect(argsOf(g, "setLineDash").some(([d]) => (d as number[]).length === 2)).toBe(true);
    const arcs = argsOf(g, "arc");
    expect(arcs).toHaveLength(2);
    expect(arcs[1]![2] as number).toBeGreaterThan(arcs[0]![2] as number);
  });

  it("draws nothing for an empty route, and the player as a dot", () => {
    const g = rec();
    paintRoute(ctxOf(g), [], [], 1, 1, { alpha: 1, next: -1 });
    expect(g.calls).toEqual([]);
    paintPlayer(ctxOf(g), { x: 10, y: 20 }, true, 2, 1);
    expect(argsOf(g, "arc")[0]!.slice(0, 2)).toEqual([20, 40]);
    expect(argsOf(g, "fillStyle=")[0]![0]).toBe("#69f0ae");
    paintPlayer(ctxOf(g), { x: 10, y: 20 }, false, 2, 1);
    expect(argsOf(g, "fillStyle=")[1]![0]).toBe("#78909c");
  });
});
