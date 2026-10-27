// The zone art's bake at 136 x 136 with the zone shapes (zone-shapes contract 7.5): the texture budget (64 MB) and the floor scale it
// picks, the strip and scene-child counts against the 1200 the plan allows, what the painters draw stays inside the frames they are
// cut to, and the bake of a map with features on a fake scene. Real generated maps and the synthetic one of test/synthFeatures.ts
// (every feature kind, the Gallows' rows along either axis); the milliseconds and the frame cost are measured in a real browser
// (test/dev/zoneart.html), not here.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAP_TILES_H, MAP_TILES_W, TILE, generateMap, type GameMap } from "@raid/shared";
import {
  CHUNK_TILES, FLOOR_SCALES, PAGE_W, STRIP_PAD, TEXTURE_BUDGET_BYTES, bakeZoneArt, chooseFloorScale, makeContext, paintFloorChunk, paintStrip,
  planBytes, planFloor, planStrips,
} from "../src/render/zoneArt/bake";
import { MapView } from "../src/render/MapView";
import { planFx } from "../src/render/zoneArt/TerrainFx";
import { SHAPE_PALETTE } from "../src/render/zoneArt/palette";
import { TILE_H } from "../src/render/zoneArt/zoneStyle";
import { fakeObject, type FakeObject } from "./fakes";
import { oldKindsMap } from "./oldKinds";
import { RecordPen } from "./recordPen";
import { synthMap } from "./synthFeatures";

const MB = 1024 * 1024;
const REAL = [1, 2, 3, 4, 5, 6].map((seed) => generateMap(seed));
const SYNTH = [3, 4, 5, 6].flatMap((seed) => (["x", "y"] as const).map((gallowsAxis) => synthMap({ seed, gallowsAxis })));

interface Fake {
  scene: never;
  images: FakeObject[];
  graphics: FakeObject[];
  textures: Map<string, FakeObject>;
}

function fake(): Fake {
  const images: FakeObject[] = [];
  const graphics: FakeObject[] = [];
  const textures = new Map<string, FakeObject>();
  const scene = {
    add: {
      image: (...args: unknown[]) => { const o = fakeObject("image", args); images.push(o); return o; },
      graphics: () => { const o = fakeObject("graphics"); graphics.push(o); return o; },
    },
    make: { graphics: () => { const o = fakeObject("graphics"); graphics.push(o); return o; } },
    textures: {
      addDynamicTexture: (key: string, w: number, h: number) => { const t = fakeObject("dynamictexture", [key, w, h]); textures.set(key, t); return t; },
      remove: (key: string) => { textures.delete(key); },
    },
    cameras: { main: Object.assign(fakeObject("camera"), { scrollX: 0, scrollY: 0, width: 400, height: 300, zoom: 1 }) },
    events: { on: () => undefined, off: () => undefined },
  } as never;
  return { scene, images, graphics, textures };
}

describe("the texture budget at 136 x 136", () => {
  it("is 64 MB, with the floor scales best first down to a half", () => {
    expect(TEXTURE_BUDGET_BYTES).toBe(64 * MB);
    expect(FLOOR_SCALES).toEqual([1, 0.75, 0.625, 0.5]);
    expect(MAP_TILES_W).toBe(136);
    expect(MAP_TILES_H).toBe(136);
  });

  it("cuts a map into 81 floor chunks (nine by nine: 136 is eight and a half chunks), the last row and column half chunks", () => {
    for (const map of [...REAL, SYNTH[0]!]) {
      const chunks = planFloor(map);
      expect(chunks).toHaveLength(81);
      expect(Math.ceil(map.w / CHUNK_TILES)).toBe(9);
      const last = chunks.find((c) => c.cx === 8 && c.cy === 8)!;
      expect(last.tx1).toBe(map.w - 1);
      expect(last.w).toBeLessThan(chunks[0]!.w);
    }
  });

  it("puts the floor at 64.9 MB at full scale (over the budget on its own) and 36.7 MB at 0.75 (computed over 81 chunks of 17 x 17 tiles)", () => {
    const map = REAL[0]!;
    const bytes = (scale: number): number => planBytes(planFloor(map, scale), []);
    expect(bytes(1) / MB).toBeGreaterThan(64);
    expect(bytes(1) / MB).toBeLessThan(66);
    expect(bytes(0.75) / MB).toBeGreaterThan(36);
    expect(bytes(0.75) / MB).toBeLessThan(38);
    expect(bytes(0.625) / MB).toBeLessThan(26);
    expect(bytes(0.5) / MB).toBeLessThan(17);
  });

  it("bakes every map at floor scale 0.75, inside the budget, whatever the shapes put in the wall pages", () => {
    for (const map of [...REAL, ...SYNTH]) {
      const ctx = makeContext(map);
      const scale = chooseFloorScale(map, undefined, ctx);
      const { pages } = planStrips(map, ctx);
      expect(scale).toBe(0.75);
      const bytes = planBytes(planFloor(map, scale), pages);
      expect(bytes).toBeLessThanOrEqual(TEXTURE_BUDGET_BYTES);
      // The wall pages leave room: they would have to double to push the floor down a scale.
      expect(bytes / MB).toBeLessThan(62);
      expect(pages.reduce((n, p) => n + p.w * p.h * 4, 0) / MB).toBeLessThan(27);
    }
  });

  it("falls to the next scale as the budget shrinks, never up, and to the smallest when none fits", () => {
    const map = REAL[0]!;
    let last = 1;
    for (const budget of [96, 64, 56, 48, 40, 32, 24, 8].map((m) => m * MB)) {
      const scale = chooseFloorScale(map, budget);
      expect(FLOOR_SCALES).toContain(scale);
      expect(scale).toBeLessThanOrEqual(last);
      last = scale;
    }
    expect(chooseFloorScale(map, 1)).toBe(0.5);
  });

  it("needed the 64 MB: a map with the shapes' many strips (the Rows along y) is over the old 48 MB at the 0.75 floor and bakes at 0.625 there", () => {
    const heavy = SYNTH.map((m) => ({ m, bytes: planBytes(planFloor(m, 0.75), planStrips(m).pages) })).sort((a, b) => b.bytes - a.bytes)[0]!;
    expect(heavy.bytes).toBeGreaterThan(48 * MB);
    expect(chooseFloorScale(heavy.m, 48 * MB)).toBeLessThan(0.75);
    expect(chooseFloorScale(heavy.m, 64 * MB)).toBe(0.75);
  });
});

describe("the strips and the scene's children at 136 x 136", () => {
  it("packs the strips into pages 2048 wide, without overlap, and keeps their count under 800 on every map", () => {
    for (const map of [...REAL, ...SYNTH]) {
      const { strips, pages } = planStrips(map);
      expect(strips.length).toBeGreaterThan(300);
      expect(strips.length).toBeLessThan(800);
      for (const p of pages) expect(p.w).toBe(PAGE_W);
      for (const s of strips) {
        expect(s.px + s.w + STRIP_PAD).toBeLessThanOrEqual(PAGE_W);
        expect(s.py + s.h + STRIP_PAD).toBeLessThanOrEqual(pages[s.page]!.h);
      }
    }
  });

  it("adds fewer than 1200 children to the scene (baked images, the animated overlays, the zone borders, the gates)", () => {
    let worst = 0;
    for (const map of [...REAL.slice(0, 3), ...SYNTH]) {
      const s = fake();
      const view = new MapView(s.scene, map);
      expect(view.bakeStats).not.toBeNull();
      const fx = planFx(map);
      // The overlays and the beams are Graphics too (each shown only while in view); the particles are at most four more.
      const children = s.images.length + s.graphics.length;
      worst = Math.max(worst, children);
      expect(children, `seed ${map.seed}`).toBeLessThan(1200);
      expect(fx.groups.length + fx.beams.length).toBeGreaterThan(0);
      view.destroy();
    }
    // The synthetic maps (every kind, the rows along y) are the heavy case: stay clear of the cap by a margin.
    expect(worst).toBeLessThan(1100);
  });

  it("makes one texture per floor chunk and per page, renders each once, and adds every strip's image at its row's depth", () => {
    const map = SYNTH[0]!;
    const s = fake();
    const art = bakeZoneArt(s.scene, map);
    const floors = planFloor(map, 0.75);
    const { strips, pages } = planStrips(map);
    expect(art.stats.floorChunks).toBe(81);
    expect(art.stats.strips).toBe(strips.length);
    expect(s.textures.size).toBe(floors.length + pages.length);
    expect(s.images).toHaveLength(floors.length + strips.length);
    for (const t of s.textures.values()) {
      expect(t.calls.filter(([n]) => n === "draw")).toHaveLength(1);
      expect(t.calls.filter(([n]) => n === "render")).toHaveLength(1);
    }
    expect(art.stats.textureBytes).toBe(planBytes(floors, pages));
    const depths = new Set(strips.map((st) => st.depth));
    for (const im of s.images.filter((i) => i.args.length === 4)) expect(depths.has(im.state.depth as number)).toBe(true);
  });
});

describe("what the shapes paint stays in its frame", () => {
  it("keeps every strip's drawing inside its frame (and the pad), on real maps and the synthetic ones", () => {
    for (const map of [...REAL.slice(0, 3), ...SYNTH]) {
      const ctx = makeContext(map);
      for (const s of planStrips(map, ctx).strips) {
        const g = new RecordPen();
        paintStrip(g, ctx, s);
        for (const [x0, y0, x1, y1] of g.extents()) {
          const why = `seed ${map.seed} row ${s.ty} tiles ${s.tx0}-${s.tx1}`;
          expect(x0, why).toBeGreaterThanOrEqual(s.px - 0.01);
          expect(x1, why).toBeLessThanOrEqual(s.px + s.w + 3);
          expect(y0, why).toBeGreaterThanOrEqual(s.py - 0.01);
          expect(y1, why).toBeLessThanOrEqual(s.py + s.h + STRIP_PAD - 0.5);
        }
      }
    }
  });

  it("keeps a floor chunk's drawing inside its texture, apart from props that brush the edge", () => {
    // A chunk paints the props whose anchor is up to 16 px outside it (the neighbour paints them too), and a prop is up to 17 px
    // from its anchor (the glow of a slag heap or a brazier), so 33 px is the most any of them reaches; the texture clips the rest.
    const reach = 34;
    for (const map of [REAL[0]!, SYNTH[0]!, SYNTH[1]!]) {
      const ctx = makeContext(map);
      for (const c of planFloor(map)) {
        const g = new RecordPen();
        paintFloorChunk(g, ctx, c);
        for (const [x0, y0, x1, y1] of g.extents()) {
          expect(x0).toBeGreaterThanOrEqual(-reach);
          expect(y0).toBeGreaterThanOrEqual(-reach);
          expect(x1).toBeLessThanOrEqual(c.w + TILE + reach);
          expect(y1).toBeLessThanOrEqual(c.h + TILE_H + reach);
        }
      }
    }
  });
});

describe("a map with no features", () => {
  it("is painted as the art painted it before the zone shapes (golden: recorded against the phase-A code, which this matches call for call)", () => {
    // Over real maps (features and the twelve new props taken off) the new and the phase-A bake drew 3836 of 3836 floor chunks and strips
    // identically; this pins a hand-built map with every old kind of wall and ground, so the guard needs no generator.
    const map = oldKindsMap();
    const ctx = makeContext(map);
    const sig = createHash("sha256");
    let ops = 0;
    for (const c of planFloor(map)) { const g = new RecordPen(); paintFloorChunk(g, ctx, c); sig.update(g.signature()); ops += g.ops.length; }
    for (const s of planStrips(map, ctx).strips) { const g = new RecordPen(); paintStrip(g, ctx, s); sig.update(g.signature()); ops += g.ops.length; }
    expect(ops).toBe(OLD_KINDS_OPS);
    expect(sig.digest("hex").slice(0, 16)).toBe(OLD_KINDS_HASH);
  });
});
// Recorded from the phase-A art (git 76232bc), and equal to what the art draws now.
const OLD_KINDS_OPS = 10270;
const OLD_KINDS_HASH = "1da88f4d4bce410d";

describe("the feature art in the bake", () => {
  const map = SYNTH[0]!;
  const ctx = makeContext(map);
  const usesColour = (g: RecordPen, colour: number): boolean => g.ops.some((o) => o.name === "fillStyle" && o.args[0] === colour);

  /** The chunk that holds a feature's tile `tile`. */
  const chunkOf = (tile: number) => planFloor(map).find((c) => { const x = tile % map.w, y = Math.floor(tile / map.w); return x >= c.tx0 && x <= c.tx1 && y >= c.ty0 && y <= c.ty1; })!;
  const stripOf = (tile: number) => planStrips(map, ctx).strips.find((s) => s.ty === Math.floor(tile / map.w) && tile % map.w >= s.tx0 && tile % map.w <= s.tx1)!;
  const firstTile = (kind: string, tiles: "wall" | "floor"): number => {
    for (let i = 0; i < map.tiles.length; i++) {
      const f = map.featureGrid[i]!;
      if (f !== 0 && map.features[f - 1]!.kind === kind && (map.tiles[i] === 1) === (tiles === "wall")) return i;
    }
    throw new Error(`no ${tiles} tile of ${kind}`);
  };

  it("paints a crater's ash bowl into the floor chunk and its lit lip into the strip, and a barrow's tunnel in the dark", () => {
    const bowl = new RecordPen();
    paintFloorChunk(bowl, ctx, chunkOf(firstTile("crater", "floor")));
    expect(usesColour(bowl, SHAPE_PALETTE.crater.ash)).toBe(true);
    const rim = new RecordPen();
    paintStrip(rim, ctx, stripOf(firstTile("crater", "wall")));
    expect(usesColour(rim, SHAPE_PALETTE.crater.lip)).toBe(true);
    const tunnel = new RecordPen();
    paintFloorChunk(tunnel, ctx, chunkOf(firstTile("barrow", "floor")));
    expect(usesColour(tunnel, SHAPE_PALETTE.tunnel.dark)).toBe(true);
  });

  it("paints every landmark design's masonry and a pier's capital, and a doorway's sill", () => {
    for (const [kind, colour] of [["hall", SHAPE_PALETTE.pier.cap], ["landmark", SHAPE_PALETTE.forge.top]] as const) {
      const g = new RecordPen();
      paintStrip(g, ctx, stripOf(firstTile(kind, "wall")));
      expect(usesColour(g, colour), kind).toBe(true);
    }
    const masonry = new Set<number>();
    for (const f of map.features.filter((x) => x.kind === "landmark")) {
      const tile = [...map.featureGrid.keys()].find((i) => map.featureGrid[i] === map.features.indexOf(f) + 1 && map.tiles[i] === 1)!;
      const g = new RecordPen();
      paintStrip(g, ctx, stripOf(tile));
      const design = SHAPE_PALETTE[f.variant as "forge"];
      masonry.add(design.top);
      expect(usesColour(g, design.top), f.variant).toBe(true);
    }
    expect(masonry.size).toBe(5);
  });

  it("paints nothing of the shapes on a map with no features: no shape colour in any floor chunk or strip", () => {
    // no props either: the styler's own props (a crater lip on a rim wall) are drawn in the shape palette's colours on purpose
    const bare: GameMap = { ...REAL[0]!, features: [], featureGrid: new Uint8Array(REAL[0]!.w * REAL[0]!.h), props: [] };
    const bctx = makeContext(bare);
    const shape = new Set<number>();
    for (const group of Object.values(SHAPE_PALETTE)) for (const c of Object.values(group)) shape.add(c);
    let paints = 0;
    for (const c of planFloor(bare)) {
      const g = new RecordPen();
      paintFloorChunk(g, bctx, c);
      paints += g.ops.length;
    }
    for (const s of planStrips(bare, bctx).strips) {
      const g = new RecordPen();
      paintStrip(g, bctx, s);
      paints += g.ops.length;
      // The zone art's own colours may coincide with a shape colour by chance; the shapes' accents (lips, ash, tunnel, ford) may not appear.
      for (const [name, c] of [["crater.lip", SHAPE_PALETTE.crater.lip], ["crater.ash", SHAPE_PALETTE.crater.ash], ["tunnel.dark", SHAPE_PALETTE.tunnel.dark], ["pier.cap", SHAPE_PALETTE.pier.cap]] as const) {
        expect(usesColour(g, c), `strip row ${s.ty}: ${name}`).toBe(false);
      }
    }
    expect(paints).toBeGreaterThan(10000);
    expect(shape.size).toBeGreaterThan(30);
  });
});
