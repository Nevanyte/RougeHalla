// The map screens at 136 x 136 with 40 camps and the zone shapes (zone-shapes contract 7.5): the painter's feature layer (walls in their
// feature's colour, the floor a feature owns as a tint), how legible a minimap of 150 to 240 px, the planning screen and the hold-Tab
// map are (every feature wall reaches a pixel, no two camp marks meet, how many matchup chips stay), and the planning view's own
// markers for 40 camps and two crowns a zone. The 2D context is a call recorder or a tiny raster (a pixel holds the style of the last
// fill that covered it); the picture itself is judged in a browser (test/dev/zoneart.html?mode=minimap|tab|planning).
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FACTION_IDS, REGION_FACTIONS, TERRAIN_FENCE, TILE, TILE_LOW, TILE_WALL, generateMap, isEliteCamp, mapFromTiles, regionAt,
  type GameMap, type MapFeature,
} from "@raid/shared";
import {
  COLOR_FEATURE_WALL, COLOR_WALL, paintCamps, paintMapBase, type PaintCtx,
} from "../src/ui/mapPainter";
import { floorLookOf } from "../src/render/zoneArt/featureArt";
import { mapSpan, minimapBacking, minimapSize } from "../src/ui/minimapMath";
import {
  campBoxes, campMarkerPx, crowdedChips, fullMapSize, glyphScale, labelSizePx, placeLabels, planningMapSize, previewMapSize, type CampSpot,
} from "../src/ui/planningMath";
import { SettingsStore } from "../src/settings";
import { PlanningView, type PlanningFrame } from "../src/ui/planning";
import { RouteState } from "../src/ui/route";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { fakeObject, type FakeObject } from "./fakes";
import { asEl, installPlanningDom } from "./planningDom";
import { synthMap } from "./synthFeatures";

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });

const ctxOf = (o: FakeObject): PaintCtx => o as unknown as PaintCtx;
const hashOf = (o: FakeObject): string => createHash("sha256").update(JSON.stringify(o.calls)).digest("hex").slice(0, 16);

const feature = (kind: MapFeature["kind"], p: number[], tiles: ReadonlyArray<readonly [number, number]>, map: GameMap, variant = ""): MapFeature => {
  const f: MapFeature = { kind, variant, zone: "fire", jobs: [], ax: tiles[0]![0], ay: tiles[0]![1], p, bbox: { x: 0, y: 0, w: map.w, h: map.h }, tiles: tiles.length };
  map.features.push(f);
  for (const [x, y] of tiles) map.featureGrid[y * map.w + x] = map.features.length;
  return f;
};

/** A 30 x 20 map with a crater (rim walls and a bowl), a landmark, a fence row and a lake's shore, independent of the generator. */
function handFeatureMap(): GameMap {
  const w = 30, h = 20;
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1) tiles[y * w + x] = TILE_WALL;
  const map = mapFromTiles(w, h, tiles);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) map.regionGrid[y * w + x] = x < 15 ? 1 : 2;
  const rim: Array<[number, number]> = [];
  const bowl: Array<[number, number]> = [];
  for (let y = 3; y <= 9; y++) for (let x = 3; x <= 9; x++) {
    const d = Math.hypot(x - 6, y - 6);
    if (d >= 2.6 && d < 3.6) { tiles[y * w + x] = TILE_WALL; rim.push([x, y]); } else if (d < 2.6) bowl.push([x, y]);
  }
  feature("crater", [0, 14, 0], rim, map);
  feature("crater", [0, 14, 0], bowl, map);
  const house: Array<[number, number]> = [];
  for (let y = 12; y <= 16; y++) for (let x = 18; x <= 24; x++) if (x === 18 || x === 24 || y === 12 || y === 16) { tiles[y * w + x] = TILE_WALL; house.push([x, y]); }
  feature("landmark", [0, 0], house, map, "guardHouse");
  const fence: Array<[number, number]> = [];
  for (let x = 17; x <= 27; x++) { tiles[4 * w + x] = TILE_LOW; map.terrain[4 * w + x] = TERRAIN_FENCE; fence.push([x, 4]); }
  feature("fenceRow", [0, 0, 2], fence, map);
  feature("mere", [0, 0], rectTiles(20, 7, 5, 2), map);
  return map;
}
const rectTiles = (x0: number, y0: number, w: number, h: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
};

/** A pixel raster: the style of the last fill that covered each pixel, for the fills the base painter makes (rects only). */
class Raster {
  readonly px: string[];
  fillStyle: string | CanvasPattern = "";
  strokeStyle = "";
  lineWidth = 1;
  constructor(readonly n: number) { this.px = new Array(n * n).fill(""); }
  clearRect(): void { this.px.fill(""); }
  fillRect(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.n, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.n, Math.round(y + h));
    for (let py = y0; py < y1; py++) for (let qx = x0; qx < x1; qx++) this.px[py * this.n + qx] = String(this.fillStyle);
  }
  strokeRect(): void { /* the crevasse's edge: a detail */ }
  at(x: number, y: number): string { return this.px[y * this.n + x] ?? ""; }
}

describe("the painter's feature layer", () => {
  const map = handFeatureMap();
  const K = 240 / (30 * TILE); // the hand map's own scale: 8 px a tile, so the tiles are easy to find

  it("is a no-op for a map with no features: the original calls, exactly (the goldens of test/mapPainter.test.ts rest on it)", () => {
    const bare: GameMap = { ...map, features: [], featureGrid: new Uint8Array(map.w * map.h) };
    const a = fakeObject("ctx");
    paintMapBase(ctxOf(a), bare, 240, 240, K);
    expect(a.calls.some(([n, args]) => n === "fillStyle=" && Object.values(COLOR_FEATURE_WALL).includes(args[0] as string))).toBe(false);
    // The feature map paints the same fills and more.
    const b = fakeObject("ctx");
    paintMapBase(ctxOf(b), map, 240, 240, K);
    expect(b.calls.length).toBeGreaterThan(a.calls.length);
  });

  it("paints each feature's walls in its kind's colour and every other wall (the border) in the plain one", () => {
    const r = new Raster(240);
    paintMapBase(r as unknown as PaintCtx, map, 240, 240, K);
    const at = (tx: number, ty: number): string => r.at(Math.floor((tx + 0.5) * 8), Math.floor((ty + 0.5) * 8));
    // A crater rim tile, a landmark wall tile and the border.
    const rim = [...map.featureGrid.keys()].find((i) => map.featureGrid[i] === 1)!;
    expect(at(rim % map.w, Math.floor(rim / map.w))).toBe(COLOR_FEATURE_WALL.crater);
    expect(at(18, 14)).toBe(COLOR_FEATURE_WALL.landmark);
    expect(at(0, 5)).toBe(COLOR_WALL);
    expect(at(29, 19)).toBe(COLOR_WALL);
    expect(COLOR_FEATURE_WALL.crater).not.toBe(COLOR_WALL);
    expect(new Set(Object.values(COLOR_FEATURE_WALL)).size).toBeGreaterThanOrEqual(5);
  });

  it("tints the floor a feature owns: a crater's bowl dark, a lake's shore pale, and nothing on floor no feature owns", () => {
    const r = new Raster(240);
    paintMapBase(r as unknown as PaintCtx, map, 240, 240, K);
    const at = (tx: number, ty: number): string => r.at(Math.floor((tx + 0.5) * 8), Math.floor((ty + 0.5) * 8));
    expect(at(6, 6)).toBe("rgba(0, 0, 0, 0.26)"); // the bowl
    expect(at(22, 7)).toBe("rgba(220, 244, 255, 0.28)"); // the shore
    expect(floorLookOf({ kind: "crater", variant: "" })).toBe("bowl");
    expect(at(12, 16)).toMatch(/^rgba\(255, 112, 67/); // plain fire floor: the region tint only
  });

  it("is deterministic and pinned (golden, a hand-built map: only the painter can move it; re-record by hand when the look changes on purpose)", () => {
    const a = fakeObject("ctx");
    const b = fakeObject("ctx");
    paintMapBase(ctxOf(a), map, 240, 240, K);
    paintMapBase(ctxOf(b), map, 240, 240, K);
    expect(hashOf(a)).toBe(hashOf(b));
    // Recorded from this code. A change here means the look of the shapes on every map screen changed: look at the dev page, then re-pin.
    expect(a.calls).toHaveLength(GOLDEN_FEATURE_CALLS);
    expect(hashOf(a)).toBe(GOLDEN_FEATURE_HASH);
  });
});

// Recorded from handFeatureMap() at 240 px (see the test above).
const GOLDEN_FEATURE_CALLS = 208;
const GOLDEN_FEATURE_HASH = "e96a2d8f534afcf7";

describe("what the map screens show of the shapes at the sizes they are drawn", () => {
  const synth = synthMap({ seed: 3 });
  const real = [1, 2, 3, 7].map((seed) => generateMap(seed));

  /** The fraction of `tiles` whose centre pixel, on a map painted at `n` px, holds `style(tile)`. */
  function share(map: GameMap, n: number, tiles: Iterable<number>, style: (i: number) => string): number {
    const r = new Raster(n);
    paintMapBase(r as unknown as PaintCtx, map, n, n, n / mapSpan());
    const t = (TILE * n) / mapSpan();
    let hit = 0, all = 0;
    for (const i of tiles) {
      all++;
      const tx = i % map.w, ty = Math.floor(i / map.w);
      if (r.at(Math.floor((tx + 0.5) * t), Math.floor((ty + 0.5) * t)) === style(i)) hit++;
    }
    return all === 0 ? 1 : hit / all;
  }
  const featureWalls = (map: GameMap, kind: string): number[] => {
    const out: number[] = [];
    for (let i = 0; i < map.tiles.length; i++) {
      const f = map.featureGrid[i]!;
      if (f !== 0 && map.tiles[i] === TILE_WALL && map.features[f - 1]!.kind === kind) out.push(i);
    }
    return out;
  };

  it("reaches a pixel with the feature's own colour for nearly every wall tile of a crater, a barrow, the hall and a landmark, from the smallest minimap (150 px) up", () => {
    // At 150 px a tile is 1.1 px: a one-tile rim can lose its centre pixel to a neighbour's overlap, so the share is a floor, not 100%.
    const floors: Record<number, number> = { 150: 0.9, 208: 0.93, 240: 0.95, 620: 1 };
    for (const [n, floor] of Object.entries(floors)) {
      for (const kind of ["crater", "barrow", "hall", "landmark"] as const) {
        const tiles = featureWalls(synth, kind);
        expect(tiles.length, kind).toBeGreaterThan(40);
        expect(share(synth, Number(n), tiles, () => COLOR_FEATURE_WALL[kind]!), `${kind} at ${n} px`).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it("draws a fence line at least one pixel thick at every size, so a fence row never drops out of the minimap", () => {
    for (const n of [150, 208, 240, 620]) {
      const r = new Raster(n);
      paintMapBase(r as unknown as PaintCtx, synth, n, n, n / mapSpan());
      const t = (TILE * n) / mapSpan();
      let fences = 0, drawn = 0;
      for (let i = 0; i < synth.tiles.length; i++) {
        if (synth.tiles[i] !== TILE_LOW || synth.terrain[i] !== TERRAIN_FENCE) continue;
        fences++;
        const tx = i % synth.w, ty = Math.floor(i / synth.w);
        let any = false;
        for (let py = Math.floor(ty * t); py < Math.ceil((ty + 1) * t) && !any; py++) for (let px = Math.floor(tx * t); px < Math.ceil((tx + 1) * t); px++) if (r.at(px, py) === "#b9b0d6") { any = true; break; }
        if (any) drawn++;
      }
      expect(fences).toBeGreaterThan(100);
      expect(drawn / fences, `${n} px`).toBeGreaterThanOrEqual(0.97);
    }
  });

  it("keeps the 40 camp marks of a real map apart at every size the screens use (no two marks meet), and the minimap's own at 150 to 240 px", () => {
    for (const map of real) {
      expect(map.camps).toHaveLength(40);
      expect(map.camps.filter(isEliteCamp)).toHaveLength(10);
      for (const zone of REGION_FACTIONS) expect(map.camps.filter((c) => c.zone === zone && isEliteCamp(c))).toHaveLength(2);
      // The minimap: paintCamps draws a camp CAMP_R (3.4) reference pixels from its centre, an elite 4.6, a reference pixel being size / 150.
      for (const size of [150, 208, 240]) {
        const px = size / 150, k = size / mapSpan();
        for (let i = 0; i < map.camps.length; i++) for (let j = i + 1; j < map.camps.length; j++) {
          const a = map.camps[i]!, b = map.camps[j]!;
          const ra = (isEliteCamp(a) ? 4.6 : 3.4) * px, rb = (isEliteCamp(b) ? 4.6 : 3.4) * px;
          const d = Math.hypot((a.x - b.x) * k, (a.y - b.y) * k);
          expect(d, `seed ${map.seed} camps ${a.id} ${b.id} at ${size} px`).toBeGreaterThanOrEqual(ra + rb);
        }
      }
    }
  });

  it("paints every camp once, an elite with its crown, and a cleared camp crossed out, at the minimap's smallest size", () => {
    const map = real[0]!;
    const g = fakeObject("ctx");
    paintCamps(ctxOf(g), map.camps, 150 / mapSpan(), 1);
    // A polygon and an outline each (fill and stroke), plus a crown's two for each of the 10 elites.
    expect(g.calls.filter(([n]) => n === "fill")).toHaveLength(40 + 10);
    const crossed = fakeObject("ctx");
    paintCamps(ctxOf(crossed), map.camps, 150 / mapSpan(), 1, map.camps.map((_, i) => (i === 0 ? 2 : 0)));
    expect(crossed.calls.length).toBeGreaterThan(g.calls.length);
  });
});

describe("the planning screens at 40 camps", () => {
  const maps = [1, 2, 3, 7].map((seed) => generateMap(seed));

  /** The camps as the layout sees them on a map `size` px wide, each with a chip text of 4 characters ("+97%"). */
  const spots = (map: GameMap, size: number): CampSpot[] => {
    const k = size / mapSpan();
    return map.camps.map((c) => ({ x: c.x * k, y: c.y * k, elite: isEliteCamp(c), chars: 4 }));
  };
  const shown = (map: GameMap, size: number): number => crowdedChips(spots(map, size), [], glyphScale(size), 1).filter((v) => !v).length;
  const marksMeet = (camps: readonly CampSpot[], glyph: number): number => {
    let n = 0;
    for (let i = 0; i < camps.length; i++) for (let j = i + 1; j < camps.length; j++) {
      const a = camps[i]!, b = camps[j]!;
      const reach = (campMarkerPx(a.elite, glyph) + campMarkerPx(b.elite, glyph)) / 2;
      if (Math.abs(a.x - b.x) < reach && Math.abs(a.y - b.y) < reach) n++;
    }
    return n;
  };

  it("sizes the three map screens for a 1280 x 800 overlay, with the marks and chips each leaves room for", () => {
    const preview = previewMapSize(1280, 800), planning = planningMapSize(1280, 800), tab = fullMapSize(1280, 800);
    expect([preview, planning, tab]).toEqual([288, 620, 600]);
    for (const map of maps) {
      // Planning and the held map: every one of the 40 chips has room; the lobby's corner loses a few to crowding.
      expect(shown(map, planning), `seed ${map.seed} planning`).toBe(40);
      expect(shown(map, tab), `seed ${map.seed} tab`).toBe(40);
      expect(shown(map, preview), `seed ${map.seed} preview`).toBeGreaterThanOrEqual(34);
      for (const size of [preview, planning, tab]) expect(marksMeet(spots(map, size), glyphScale(size)), `seed ${map.seed} at ${size}`).toBe(0);
    }
  });

  it("still fits the marks at the planning screen's smallest map (260 px: 1.9 px a tile) and loses chips only to crowding, 26 of 40 at worst", () => {
    for (const map of maps) {
      expect(marksMeet(spots(map, 260), glyphScale(260)), `seed ${map.seed}`).toBe(0);
      expect(shown(map, 260)).toBeGreaterThanOrEqual(24);
    }
  });

  it("keeps the corner preview of the tiniest window (150 px, 1.1 px a tile) readable as camps, if not as chips: at most a pair of marks meets", () => {
    for (const map of maps) {
      expect(marksMeet(spots(map, 150), glyphScale(150)), `seed ${map.seed}`).toBeLessThanOrEqual(2);
      expect(shown(map, 150)).toBeGreaterThanOrEqual(1);
    }
  });

  it("places all five zone names inside their zones and clear of every camp mark, at the planning and the hold-Tab sizes", () => {
    for (const map of maps) {
      for (const size of [planningMapSize(1280, 800), fullMapSize(1280, 800)]) {
        const k = size / mapSpan(), glyph = glyphScale(size);
        const camps = spots(map, size);
        const crowded = crowdedChips(camps, [], glyph, 1);
        const wishes = map.regions.map((region) => {
          const { w, h } = labelSizePx(FACTION_IDS.includes(region.id) ? region.id.length + 4 : 8, glyph, 1);
          return { x: region.pole.x * k, y: region.pole.y * k, w, h, inside: (px: number, py: number) => regionAt(map, px / k, py / k) === region.id };
        });
        const at = placeLabels(wishes, campBoxes(camps, crowded, glyph, 1), size);
        expect(at).toHaveLength(5);
        at.forEach((p, i) => {
          const wish = wishes[i]!;
          expect(wish.inside(p.x, p.y), `seed ${map.seed} ${size} px zone ${i}`).toBe(true);
        });
      }
    }
  });
});

describe("the planning view with 40 camps", () => {
  const map = generateMap(7);

  function open() {
    const dom = installPlanningDom();
    const store = new SettingsStore({ getItem: () => null, setItem: () => undefined });
    const view = new PlanningView({ map, route: new RouteState(null, null), send: () => undefined, settings: store });
    const frame: PlanningFrame = {
      mode: "planning", serverNow: 0, endsAt: 12_000, meReady: false,
      players: [{ faction: "plague", ready: false, me: true }, { faction: "holy", ready: false, me: false }],
      campTypes: [], local: null,
    };
    const b = map.spawnPool.findIndex((s) => s.zone !== map.spawnPool[0]!.zone);
    view.setPlan({ endsAt: 12_000, spawns: [0, b], taken: [false, false], pick: -1, boons: [], boon: -1 });
    view.update(frame);
    const root = asEl(view.element);
    return { dom, view, root, camps: root.byClass("pl-camp") };
  }

  it("builds a marker for each of the 40 camps, two crowned elites in every zone, and a chip on each", () => {
    const { camps } = open();
    expect(camps).toHaveLength(40);
    expect(camps.filter((c) => c.classList.contains("elite"))).toHaveLength(10);
    // Every camp is reachable by name: its label says its zone, its number and whether it is an elite.
    const labels = camps.map((c) => c.getAttribute("aria-label") ?? "");
    for (const zone of ["Fire", "Sentenced", "Plague", "Frost", "Demon Blood"]) expect(labels.filter((l) => l.startsWith(`${zone} camp`))).toHaveLength(8);
    expect(labels.filter((l) => l.includes("(elite)"))).toHaveLength(10);
  });
});

// ------------------------------------------------------------------------------------------------------------------ sizes

describe("the minimap's size at 136 x 136", () => {
  it("scales by the world's larger side: 150 to 240 px for the corner minimap, a tile 1.1 to 1.8 px wide", () => {
    for (const [uiW, uiH] of [[1280, 800], [1600, 900], [900, 900], [1920, 1080]] as const) {
      const size = minimapSize(uiW, uiH);
      expect(size).toBeGreaterThanOrEqual(110);
      expect(size).toBeLessThanOrEqual(240);
      const tile = (TILE * size) / mapSpan();
      expect(tile).toBeGreaterThan(0.8);
      expect(tile).toBeLessThan(1.8);
    }
    expect(mapSpan()).toBe(136 * TILE);
    expect(minimapBacking(240, 1.5, 2)).toBe(720);
  });
});
