// The ground on the minimap (ui/mapPainter.ts, painted by ui/minimap.ts: floor hazards as faint tints, lava as a block, a fence as a thin line, a crevasse with a
// blue edge) and in the help card (ui/groundLegend.ts: the "Ground" section, read from the terrain catalog). The DOM and the canvas
// are fakes (test/fakes.ts, test/chromeDom.ts); no colour literal is pinned beyond "this kind differs from that one".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAP_STYLERS, TERRAINS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE_FLOOR, TILE_LOW,
  TILE_WALL, mapFromTiles, type GameMap,
} from "@raid/shared";
import { HELP_SECTIONS, HelpOverlay, groundLegendVisible } from "../src/ui/helpOverlay";
import { groundLegend, renderGround, shapeLegend } from "../src/ui/groundLegend";
import { COLOR_FEATURE_WALL } from "../src/ui/mapPainter";
import { Minimap } from "../src/ui/minimap";
import { setView } from "../src/view/viewState";
import { computeLayout } from "../src/view/viewport";
import { fake, installChromeDom } from "./chromeDom";
import { installFakeDom, type FakeEl } from "./fakes";

/** A walled w x h room; `cells` maps "tx,ty" to [tile, terrain kind]. */
function room(w: number, h: number, cells: Record<string, readonly [number, number]> = {}): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  for (const [key, [t, k]] of Object.entries(cells)) {
    const [tx, ty] = key.split(",").map(Number) as [number, number];
    tiles[ty * w + tx] = t;
    terrain[ty * w + tx] = k;
  }
  return mapFromTiles(w, h, tiles, 0, terrain);
}

interface Paint { color: string; rect: number[]; stroke?: string }

describe("the minimap's ground", () => {
  beforeEach(() => { setView(computeLayout({ cssW: 1280, cssH: 800, dpr: 1, hiDpi: true })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** The static layer's fills in order, and the strokes (colour and rect) of strokeRect calls. */
  function paint(map: GameMap): { fills: Paint[]; strokes: Array<{ color: string; rect: number[] }> } {
    const { doc } = installFakeDom();
    const made: FakeEl[] = [];
    const create = doc.createElement;
    doc.createElement = (tag: string) => { const e = create(tag); made.push(e); return e; };
    const minimap = new Minimap({});
    minimap.setMap(map);
    const ctx = made[1]!.getContext();
    const fills: Paint[] = [];
    const strokes: Array<{ color: string; rect: number[] }> = [];
    let fill = "";
    let stroke = "";
    for (const [name, args] of ctx.calls) {
      if (name === "fillStyle=") fill = args[0] as string;
      else if (name === "strokeStyle=") stroke = args[0] as string;
      else if (name === "fillRect") fills.push({ color: fill, rect: [...args] as number[] });
      else if (name === "strokeRect") strokes.push({ color: stroke, rect: [...args] as number[] });
    }
    return { fills, strokes };
  }

  const plainColors = (): Set<string> => new Set(paint(room(32, 12)).fills.map((f) => f.color));
  /** The colours `map` paints beyond a plain room's. */
  const added = (map: GameMap): string[] => [...new Set(paint(map).fills.map((f) => f.color))].filter((c) => !plainColors().has(c));
  const one = (kind: number, tile = TILE_FLOOR): Paint => {
    const fills = paint(room(32, 12, { "5,5": [tile, kind] })).fills;
    const known = plainColors();
    return fills.find((f) => !known.has(f.color))!;
  };

  it("tints each floor hazard its own colour, faintly (a translucent fill), and paints nothing for a map without them", () => {
    expect(added(room(32, 12))).toEqual([]);
    const colours = [TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT].map((k) => one(k).color);
    expect(new Set(colours).size).toBe(4);
    for (const c of colours) expect(c).toMatch(/^rgba\(/);
    for (const c of colours) expect(Number(/,\s*([\d.]+)\)$/.exec(c)![1])).toBeLessThanOrEqual(0.8);
  });

  it("paints one fillRect per run of one hazard per row, over the region tints and under the LOW tiles and the walls", () => {
    const map = room(32, 12, {
      "4,4": [TILE_FLOOR, TERRAIN_BOG], "5,4": [TILE_FLOOR, TERRAIN_BOG], "6,4": [TILE_FLOOR, TERRAIN_BOG], "9,4": [TILE_FLOOR, TERRAIN_ICE],
      "12,6": [TILE_LOW, TERRAIN_LAVA],
    });
    map.regionGrid.fill(1);
    const fills = paint(map).fills;
    const bog = one(TERRAIN_BOG).color;
    const ice = one(TERRAIN_ICE).color;
    expect(fills.filter((f) => f.color === bog)).toHaveLength(1);
    expect(fills.filter((f) => f.color === ice)).toHaveLength(1);
    const run = fills.find((f) => f.color === bog)!;
    const single = fills.find((f) => f.color === ice)!;
    expect(run.rect[2]!).toBeGreaterThan(single.rect[2]!); // three tiles against one
    const colors = fills.map((f) => f.color);
    const lava = one(TERRAIN_LAVA, TILE_LOW).color;
    const wall = plainWall();
    expect(colors.indexOf(bog)).toBeGreaterThan(colors.indexOf(plainRegionTint()));
    expect(colors.indexOf(bog)).toBeLessThan(colors.indexOf(lava));
    expect(colors.indexOf(lava)).toBeLessThan(colors.lastIndexOf(wall));
  });

  function plainRegionTint(): string {
    const m = room(32, 12);
    m.regionGrid.fill(1);
    return [...new Set(paint(m).fills.map((f) => f.color))].find((c) => !plainColors().has(c))!;
  }
  function plainWall(): string {
    return paint(room(32, 12)).fills.at(-1)!.color;
  }

  it("paints a hazard only on floor: a wall that keeps a floor kind is a wall, and the kinds under a pillar do not tint", () => {
    expect(added(room(32, 12, { "5,5": [TILE_WALL, TERRAIN_BOG] }))).toEqual([]);
  });

  it("paints lava a block, as one run per row", () => {
    const fills = paint(room(32, 12, { "5,5": [TILE_LOW, TERRAIN_LAVA], "6,5": [TILE_LOW, TERRAIN_LAVA] })).fills;
    const lava = one(TERRAIN_LAVA, TILE_LOW);
    expect(fills.filter((f) => f.color === lava.color)).toHaveLength(1);
    expect(fills.find((f) => f.color === lava.color)!.rect[2]!).toBeGreaterThan(lava.rect[2]!);
  });

  it("paints a fence as a thin line, thinner than a tile, in its own colour", () => {
    const fence = one(TERRAIN_FENCE, TILE_LOW);
    const lava = one(TERRAIN_LAVA, TILE_LOW);
    expect(fence.color).not.toBe(lava.color);
    expect(fence.rect[3]!).toBeLessThan(lava.rect[3]!); // shorter than a block of the same tile
    expect(fence.rect[3]!).toBeGreaterThanOrEqual(1);
  });

  it("runs a fence line the way it goes: a long thin bar across a row, a long thin bar down a column", () => {
    const horizontal: Record<string, readonly [number, number]> = {};
    for (let x = 4; x < 12; x++) horizontal[`${x},5`] = [TILE_LOW, TERRAIN_FENCE];
    const vertical: Record<string, readonly [number, number]> = {};
    for (let y = 2; y < 10; y++) vertical[`5,${y}`] = [TILE_LOW, TERRAIN_FENCE];
    const known = plainColors();
    const bars = (cells: Record<string, readonly [number, number]>): Paint[] => paint(room(32, 12, cells)).fills.filter((f) => !known.has(f.color));
    const h = bars(horizontal);
    expect(h).toHaveLength(1);
    expect(h[0]!.rect[2]!).toBeGreaterThan(h[0]!.rect[3]! * 3);
    const v = bars(vertical);
    expect(v).toHaveLength(1);
    expect(v[0]!.rect[3]!).toBeGreaterThan(v[0]!.rect[2]! * 3);
  });

  it("draws a yard's corner (a line that turns) without doubling a tile: every fence tile is covered once", () => {
    const cells: Record<string, readonly [number, number]> = {};
    for (let x = 4; x < 10; x++) cells[`${x},4`] = [TILE_LOW, TERRAIN_FENCE];
    for (let y = 5; y < 9; y++) cells[`4,${y}`] = [TILE_LOW, TERRAIN_FENCE];
    const known = plainColors();
    const bars = paint(room(32, 12, cells)).fills.filter((f) => !known.has(f.color));
    expect(bars).toHaveLength(2); // the row, and the column below its corner
  });

  it("gives a crevasse a dark block with a blue edge (a stroke of another colour)", () => {
    const m = room(32, 12, { "5,5": [TILE_LOW, TERRAIN_CREVASSE] });
    const { fills, strokes } = paint(m);
    const block = one(TERRAIN_CREVASSE, TILE_LOW);
    expect(fills.some((f) => f.color === block.color)).toBe(true);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.color).not.toBe(block.color);
    // The edge lies inside the block.
    expect(strokes[0]!.rect[0]!).toBeGreaterThanOrEqual(block.rect[0]!);
    expect(strokes[0]!.rect[2]!).toBeLessThanOrEqual(block.rect[2]!);
  });
});

describe("the Ground legend", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const entries = groundLegend();
  const byKey = (key: string) => entries.find((e) => e.key === key)!;

  it("lists every terrain kind but plain ground, hazards first, once each", () => {
    expect(entries.map((e) => e.kind).sort((a, b) => a - b)).toEqual(TERRAINS.map((_, i) => i).filter((i) => i !== 0));
    expect(entries.slice(0, 4).map((e) => e.key)).toEqual(["ember", "bog", "ice", "light"]);
    for (const e of entries) {
      expect(e.name).toBe(TERRAINS[e.kind]!.name);
      expect(e.effect.length).toBeGreaterThan(10);
    }
  });

  it("states each effect from the catalog's numbers and names the faction that is spared", () => {
    expect(byKey("ember").effect).toBe(`Burns ${TERRAINS[TERRAIN_EMBER]!.burnShare * 100}% of max hp per second; Fire is immune`);
    expect(byKey("bog").effect).toBe(`Slows you to ${TERRAINS[TERRAIN_BOG]!.speedMult * 100}%; Plague is immune`);
    expect(byKey("ice").effect).toMatch(/slide.*Frost keeps full grip/);
    // Holy is shown to players as Holy.
    expect(byKey("light").effect).toBe(`Heals ${TERRAINS[TERRAIN_LIGHT]!.healShare * 100}% of max hp per second out of combat; Holy heals double`);
    expect(byKey("lava").effect).toMatch(/Blocks walking and melee swings; shots, sight and spells pass over/);
    expect(byKey("fence").effect).toBe(byKey("lava").effect);
    expect(byKey("crevasse").effect).toBe(byKey("lava").effect);
    void TERRAIN_ICE;
    void TERRAIN_LAVA;
    void TERRAIN_FENCE;
    void TERRAIN_CREVASSE;
  });

  it("renders a section titled Ground with a swatch, a name and the effect per kind", () => {
    installChromeDom();
    const section = fake(renderGround());
    expect(section.byClass("help-section-title")[0]!.textContent).toBe("Ground");
    const terms = section.byClass("help-ground-term").filter((t) => !t.hasClass("help-shape-term"));
    expect(terms).toHaveLength(entries.length);
    entries.forEach((e, i) => {
      const swatch = terms[i]!.byClass("ground-swatch")[0]!;
      expect(swatch.hasClass(`ground-swatch-${e.key}`)).toBe(true);
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
      expect(terms[i]!.byClass("help-ground-name")[0]!.textContent).toBe(e.name);
    });
    expect(section.allText).toContain(entries[0]!.effect);
  });

  it("lists the shapes of the land after the terrain: five of them, each in the colour the maps paint its walls in, and each with a way past it", () => {
    installChromeDom();
    const shapes = shapeLegend();
    expect(shapes.map((e) => e.key)).toEqual(["crater", "barrow", "hall", "headland", "landmark"]);
    for (const e of shapes) {
      expect(e.effect.length).toBeGreaterThan(30);
      expect(e.color).toBe(COLOR_FEATURE_WALL[e.key as "crater"]);
    }
    expect(new Set(shapes.map((e) => e.color)).size).toBe(5);
    const section = fake(renderGround());
    const terms = section.byClass("help-shape-term");
    expect(terms).toHaveLength(5);
    shapes.forEach((e, i) => {
      expect(terms[i]!.byClass("help-ground-name")[0]!.textContent).toBe(e.name);
      expect(terms[i]!.byClass("ground-swatch")[0]!.getAttribute("aria-hidden")).toBe("true");
    });
    expect(section.byClass("help-ground-sub")[0]!.textContent).toBe("Shapes of the land");
    expect(section.allText).toContain(shapes[0]!.effect);
  });

  it("is in the help card after the controls, whichever place is first, when the card carries it", () => {
    const { doc } = installChromeDom();
    const help = new HelpOverlay({ ground: true });
    const root = fake(help.element);
    doc.ui.append(root);
    expect(root.byClass("help-ground")).toHaveLength(1);
    help.open("hub");
    const ground = root.byClass("help-ground")[0]!;
    const sections = root.byClass("help-section");
    expect(Number(ground.style.order)).toBe(sections.length - 1);
    for (const s of sections.filter((s) => s !== ground)) expect(Number(s.style.order)).toBeLessThan(Number(ground.style.order));
    help.open("run");
    expect(Number(ground.style.order)).toBe(sections.length - 1);
  });

  it("is left out of the help card when it is told not to carry it: the controls alone, as before the stylers", () => {
    const { doc } = installChromeDom();
    const help = new HelpOverlay({ ground: false });
    const root = fake(help.element);
    doc.ui.append(root);
    expect(root.byClass("help-ground")).toHaveLength(0);
    expect(root.byClass("help-section")).toHaveLength(HELP_SECTIONS.length);
    expect(root.allText).not.toMatch(/Ground|Embers|Bog|Crevasse/);
    help.open("hub");
    help.open("run");
    expect(help.isOpen).toBe(true);
  });

  it("follows MAP_STYLERS by default: the Ground legend is in the card while the zone stylers are on (they are, since ZT-6)", () => {
    expect(MAP_STYLERS).toBe(true);
    expect(groundLegendVisible()).toBe(true);
    const { doc } = installChromeDom();
    const help = new HelpOverlay();
    const root = fake(help.element);
    doc.ui.append(root);
    expect(root.byClass("help-ground")).toHaveLength(1);
    expect(root.byClass("help-section")).toHaveLength(HELP_SECTIONS.length + 1);
  });

  it("follows MAP_STYLERS by default: no Ground legend when the flag is off (plain maps have no terrain to explain)", async () => {
    vi.resetModules();
    vi.doMock("@raid/shared", async (importOriginal) => ({ ...(await importOriginal<typeof import("@raid/shared")>()), MAP_STYLERS: false }));
    try {
      const fresh = await import("../src/ui/helpOverlay");
      expect(fresh.groundLegendVisible()).toBe(false);
      const { doc } = installChromeDom();
      const help = new fresh.HelpOverlay();
      const root = fake(help.element);
      doc.ui.append(root);
      expect(root.byClass("help-ground")).toHaveLength(0);
      expect(root.byClass("help-section")).toHaveLength(HELP_SECTIONS.length);
    } finally {
      vi.doUnmock("@raid/shared");
      vi.resetModules();
    }
  });
});
