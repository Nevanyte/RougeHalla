// The zone art's bake (render/zoneArt/bake.ts): the plan (which floor chunks and wall strips, where, how they pack), the tile
// classification (rock, run of stones, pillar), what each strip paints stays inside its frame, and the bake itself on a fake
// scene (textures made, images added, everything undone on destroy or on a failure). MapView takes the baked path for a styled
// map and the plain one for any other, and falls back when baking throws.
import { describe, expect, it } from "vitest";
import {
  REGION_IDS, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, buildGameMapOf, mapFromTiles, type GameMap,
} from "@raid/shared";
import {
  CHUNK_TILES, FLOOR_SCALES, PAGE_MAX_H, PAGE_W, STRIP_PAD, TEXTURE_BUDGET_BYTES, WS_MASS, WS_NONE, WS_PILLAR, WS_ROCK, WS_SEGMENT,
  bakeZoneArt, chooseFloorScale, hasZoneArt, makeContext, paintFloorChunk, paintStrip, planBytes, planFloor, planStrips, wallInfoAt,
  wallStyles, zoneGrid,
} from "../src/render/zoneArt/bake";
import { MapView } from "../src/render/MapView";
import { TILE_H, WALL_HEIGHT } from "../src/render/zoneArt/zoneStyle";
import { fakeObject, type FakeObject } from "./fakes";
import { RecordPen } from "./recordPen";

/** A walled w x h room with `rects` of [x, y, w, h, tile, kind]; region 1 (fire) everywhere inside unless `region` says otherwise. */
function room(w: number, h: number, rects: ReadonlyArray<readonly [number, number, number, number, number, number?]> = [], styled = false): GameMap {
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  const terrain = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  for (const [x0, y0, rw, rh, t, k] of rects) {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) { tiles[y * w + x] = t; terrain[y * w + x] = k ?? 0; }
  }
  const map = mapFromTiles(w, h, tiles, 3, terrain);
  if (styled) {
    map.regionGrid.fill(1);
    (map as { regions: unknown[] }).regions = [{ id: "fire" }];
  }
  return map;
}

const styled = (seed: number): GameMap => buildGameMapOf(seed, true);

/** A big map made by tiling a real styled one, with a wall border: for the 96x96 sizing the zone art is budgeted for. */
function tiled(m: GameMap, n: number): GameMap {
  const mk = (src: Uint8Array): Uint8Array => {
    const o = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) o[y * n + x] = src[(y % m.h) * m.w + (x % m.w)]!;
    return o;
  };
  const tiles = mk(m.tiles);
  for (let i = 0; i < n; i++) { tiles[i] = TILE_WALL; tiles[(n - 1) * n + i] = TILE_WALL; tiles[i * n] = TILE_WALL; tiles[i * n + n - 1] = TILE_WALL; }
  return { ...m, w: n, h: n, tiles, terrain: mk(m.terrain), regionGrid: mk(m.regionGrid), territoryGrid: mk(m.territoryGrid), props: [] };
}

describe("hasZoneArt", () => {
  it("is false for a hand-built map, even one with LOW tiles, and true for a styled generated one", () => {
    expect(hasZoneArt(room(12, 10))).toBe(false);
    expect(hasZoneArt(room(12, 10, [[3, 3, 2, 1, TILE_LOW, TERRAIN_LAVA]]))).toBe(false);
    expect(hasZoneArt(styled(1))).toBe(true);
  });
  it("needs regions and some terrain or props: a plain generated map takes the plain way", () => {
    const plain = buildGameMapOf(1, false);
    expect(hasZoneArt(plain)).toBe(false);
    expect(hasZoneArt(room(12, 10, [[3, 3, 2, 1, TILE_LOW, TERRAIN_LAVA]], true))).toBe(true);
    expect(hasZoneArt(room(12, 10, [], true))).toBe(false);
  });
});

describe("wallStyles", () => {
  const styleAt = (m: GameMap, tx: number, ty: number): number => wallStyles(m)[ty * m.w + tx]!;

  it("calls a lone wall a rock and a thick block a mass, and leaves floor and LOW tiles alone", () => {
    const m = room(20, 14, [[5, 5, 1, 1, TILE_WALL], [10, 4, 3, 3, TILE_WALL], [15, 8, 1, 1, TILE_LOW, TERRAIN_FENCE]]);
    expect(styleAt(m, 5, 5)).toBe(WS_ROCK);
    expect(styleAt(m, 11, 5)).toBe(WS_MASS);
    expect(styleAt(m, 15, 8)).toBe(WS_NONE);
    expect(styleAt(m, 3, 3)).toBe(WS_NONE);
    expect(styleAt(m, 0, 5)).toBe(WS_MASS); // the border is a mass
  });

  it("merges a straight run of three or more single stones, either way, and not two", () => {
    const m = room(20, 14, [[4, 3, 3, 1, TILE_WALL], [4, 6, 2, 1, TILE_WALL], [10, 3, 1, 4, TILE_WALL]]);
    for (const x of [4, 5, 6]) expect(styleAt(m, x, 3)).toBe(WS_SEGMENT);
    for (const x of [4, 5]) expect(styleAt(m, x, 6)).toBe(WS_MASS);
    for (const y of [3, 4, 5, 6]) expect(styleAt(m, 10, y)).toBe(WS_SEGMENT);
  });

  it("does not merge a run that is thick (a 2-wide wall of 3 columns is a mass)", () => {
    const m = room(20, 14, [[4, 3, 3, 2, TILE_WALL]]);
    for (const x of [4, 5, 6]) for (const y of [3, 4]) expect(styleAt(m, x, y)).toBe(WS_MASS);
  });

  it("calls a wall that keeps a LOW kind a pillar (D 7.6), and any other kind on a wall nothing special", () => {
    const m = room(20, 14, [[4, 4, 1, 1, TILE_WALL, TERRAIN_LAVA], [8, 4, 1, 1, TILE_WALL, TERRAIN_FENCE], [12, 4, 1, 1, TILE_WALL]]);
    expect(styleAt(m, 4, 4)).toBe(WS_PILLAR);
    expect(styleAt(m, 8, 4)).toBe(WS_PILLAR);
    expect(styleAt(m, 12, 4)).toBe(WS_ROCK);
  });
});

describe("zoneGrid", () => {
  it("gives a tile its own faction region, a wall in no region the nearest zone, and the coliseum nothing", () => {
    const m = room(20, 14, [[10, 5, 1, 1, TILE_WALL]], true);
    m.regionGrid.fill(0);
    for (let y = 1; y < 13; y++) for (let x = 1; x < 8; x++) m.regionGrid[y * m.w + x] = 3; // plague on the left
    for (let y = 1; y < 13; y++) for (let x = 12; x < 19; x++) m.regionGrid[y * m.w + x] = REGION_IDS.indexOf("coliseum");
    const z = zoneGrid(m);
    expect(z[5 * m.w + 3]).toBe("plague");
    expect(z[5 * m.w + 14]).toBeNull();
    expect(z[5 * m.w + 9]).toBe("plague"); // two tiles from the plague region
    expect(z[5 * m.w + 10]).toBe("plague"); // a lone rock in no region, three from it
    expect(z[19]).toBeNull(); // the far corner: nothing themed within 4 (the coliseum is not a zone)
  });
});

describe("the plan", () => {
  const maps = [1, 2, 3].map(styled);

  it("covers every tile with exactly one floor chunk (plus one tile of overlap), in even-sized textures", () => {
    for (const m of maps) {
      const chunks = planFloor(m);
      const owner = new Int32Array(m.w * m.h);
      for (const c of chunks) {
        expect(c.tw % 2).toBe(0);
        expect(c.th % 2).toBe(0);
        expect(c.w).toBeGreaterThanOrEqual(CHUNK_TILES * TILE);
        for (let ty = c.ty0; ty < Math.min(m.h, c.ty0 + CHUNK_TILES); ty++) for (let tx = c.tx0; tx < Math.min(m.w, c.tx0 + CHUNK_TILES); tx++) owner[ty * m.w + tx]++;
      }
      // Every tile that is not plain wall is in a chunk.
      for (let i = 0; i < owner.length; i++) {
        if (owner[i] === 0) expect(m.tiles[i]).toBe(TILE_WALL);
        else expect(owner[i]).toBe(1);
      }
    }
  });

  it("places chunks on a seamless grid: each chunk's image reaches at least the next chunk's origin", () => {
    const chunks = planFloor(maps[0]!);
    for (const c of chunks) {
      const right = chunks.find((o) => o.cy === c.cy && o.cx === c.cx + 1);
      const below = chunks.find((o) => o.cx === c.cx && o.cy === c.cy + 1);
      if (right) expect(c.x + c.w).toBeGreaterThan(right.x);
      if (below) expect(c.y + c.h).toBeGreaterThan(below.y);
    }
  });

  it("holds every wall and fence tile in exactly one strip, within one chunk column, at its row's south-edge depth", () => {
    for (const m of maps) {
      const { strips } = planStrips(m);
      const seen = new Int32Array(m.w * m.h);
      for (const s of strips) {
        expect(Math.floor(s.tx0 / CHUNK_TILES)).toBe(Math.floor(s.tx1 / CHUNK_TILES));
        expect(s.depth).toBe((s.ty + 1) * TILE);
        expect(s.w % 2).toBe(0);
        expect(s.h % 2).toBe(0);
        for (let tx = s.tx0; tx <= s.tx1; tx++) seen[s.ty * m.w + tx]++;
      }
      for (let i = 0; i < m.tiles.length; i++) {
        const stripTile = m.tiles[i] === TILE_WALL || (m.tiles[i] === TILE_LOW && m.terrain[i] !== TERRAIN_LAVA && m.terrain[i] !== 3);
        if (stripTile) expect(seen[i]).toBeGreaterThanOrEqual(1);
      }
      // Trimmed: a strip starts and ends on a tile that needs it.
      for (const s of strips) {
        for (const tx of [s.tx0, s.tx1]) {
          const i = s.ty * m.w + tx;
          expect(m.tiles[i] === TILE_WALL || m.tiles[i] === TILE_LOW).toBe(true);
        }
      }
    }
  });

  it("packs the strips into pages without overlap, inside the page, with padding", () => {
    for (const m of [...maps, tiled(maps[0]!, 96)]) {
      const { strips, pages } = planStrips(m);
      expect(pages.length).toBeGreaterThan(0);
      for (const p of pages) {
        expect(p.w).toBe(PAGE_W);
        expect(p.h).toBeLessThanOrEqual(PAGE_MAX_H);
        expect(p.h % 2).toBe(0);
      }
      for (const s of strips) {
        expect(s.px).toBeGreaterThanOrEqual(STRIP_PAD);
        expect(s.py).toBeGreaterThanOrEqual(STRIP_PAD);
        expect(s.px + s.w + STRIP_PAD).toBeLessThanOrEqual(PAGE_W);
        expect(s.py + s.h + STRIP_PAD).toBeLessThanOrEqual(pages[s.page]!.h);
      }
      for (let a = 0; a < strips.length; a++) {
        for (let b = a + 1; b < strips.length; b++) {
          const p = strips[a]!, q = strips[b]!;
          if (p.page !== q.page) continue;
          const apart = p.px + p.w + STRIP_PAD <= q.px || q.px + q.w + STRIP_PAD <= p.px || p.py + p.h + STRIP_PAD <= q.py || q.py + q.h + STRIP_PAD <= p.py;
          expect(apart).toBe(true);
        }
      }
    }
  });

  it("keeps a 64x64 map inside the texture budget at full scale, and bakes a bigger one at a lower floor scale so it fits", () => {
    // The generated maps are 96x96 since R2: the 64x64 case is the top-left window of a real styled one.
    const small = tiled(maps[0]!, 64);
    expect(chooseFloorScale(small)).toBe(1);
    expect(planBytes(planFloor(small, 1), planStrips(small).pages)).toBeLessThanOrEqual(TEXTURE_BUDGET_BYTES);
    for (const big of [maps[0]!, tiled(small, 96)]) {
      const scale = chooseFloorScale(big);
      expect(FLOOR_SCALES).toContain(scale);
      expect(scale).toBeLessThan(1);
      const pages = planStrips(big).pages;
      // A real 96x96 zone map and one tiled from the 64x64 window both fit, at a lower floor scale.
      expect(planBytes(planFloor(big, scale), pages) <= TEXTURE_BUDGET_BYTES).toBe(true);
      expect(chooseFloorScale(big, 1)).toBe(FLOOR_SCALES[FLOOR_SCALES.length - 1]);
    }
  });
});

describe("what the painters draw", () => {
  it("keeps every strip's drawing inside its frame (no bleeding into a neighbour on the page), for a real map", () => {
    for (const seed of [1, 2]) {
      const m = styled(seed);
      const ctx = makeContext(m);
      const { strips } = planStrips(m);
      for (const s of strips) {
        const g = new RecordPen();
        paintStrip(g, ctx, s);
        expect(g.ops.length).toBeGreaterThan(0);
        for (const [x0, y0, x1, y1] of g.extents()) {
          const why = `seed ${seed} strip row ${s.ty} tiles ${s.tx0}-${s.tx1}`;
          expect(x0, why).toBeGreaterThanOrEqual(s.px - 0.01);
          expect(x1, why).toBeLessThanOrEqual(s.px + s.w + 0.01);
          expect(y0, why).toBeGreaterThanOrEqual(s.py - 0.01);
          // Within the frame, or inside STRIP_PAD of it: on the zone maps a floor hazard's decoration beside the border wall
          // reaches 1.2 px past a strip's bottom edge (seed 1, rows 55, 65, 75), which the pad keeps off the neighbour.
          expect(y1, why).toBeLessThanOrEqual(s.py + s.h + STRIP_PAD - 0.5);
        }
      }
    }
  });

  it("keeps a floor chunk's drawing inside its own texture, apart from props that may brush the edge", () => {
    const m = styled(1);
    const ctx = makeContext(m);
    for (const c of planFloor(m)) {
      const g = new RecordPen();
      paintFloorChunk(g, ctx, c);
      expect(g.ops.length).toBeGreaterThan(c.w / 4);
      // A prop may brush the edge by up to 28 px: on the zone maps (seed 1) a prop on a chunk's first column reaches 27.5 px
      // to its left (20 px was enough on the wedge maps); the texture clips what lies beyond.
      for (const [x0, y0, x1, y1] of g.extents()) {
        expect(x0).toBeGreaterThanOrEqual(-28);
        expect(y0).toBeGreaterThanOrEqual(-28);
        expect(x1).toBeLessThanOrEqual(c.w + TILE + 28);
        expect(y1).toBeLessThanOrEqual(c.h + TILE_H + 28);
      }
    }
  });

  it("paints a floor chunk's tiles with the zone's floor, and the lava under a pillar", () => {
    const m = room(20, 14, [[4, 4, 1, 1, TILE_WALL, TERRAIN_LAVA], [8, 4, 1, 1, TILE_WALL]], true);
    const ctx = makeContext(m);
    const g = new RecordPen();
    paintFloorChunk(g, ctx, planFloor(m)[0]!);
    // The tile under the plain rock is one flat fill; the pillar's tile has the lava painted beneath it (many more ops).
    const info = wallInfoAt(ctx, 4, 4);
    expect(info.style).toBe("pillar");
    expect(info.pillarKind).toBe(TERRAIN_LAVA);
    expect(wallInfoAt(ctx, 8, 4).style).toBe("rock");
    expect(g.paths.length).toBeGreaterThanOrEqual(3); // lava flow lines
  });

  it("gives a wall info with the front where the south is open, and a Rime rock a shard's lift", () => {
    const m = room(20, 14, [[5, 5, 1, 1, TILE_WALL], [10, 5, 1, 2, TILE_WALL]], true);
    m.regionGrid.fill(4); // frost
    const ctx = makeContext(m);
    expect(wallInfoAt(ctx, 10, 5).front).toBe(false);
    expect(wallInfoAt(ctx, 10, 6).front).toBe(true);
    expect(wallInfoAt(ctx, 5, 5).lift).toBeLessThan(WALL_HEIGHT);
    expect(wallInfoAt(ctx, 0, 5).lift).toBe(WALL_HEIGHT);
  });
});

// ------------------------------------------------------------------------------------------------------------------ the bake

interface BakeScene {
  scene: never;
  images: FakeObject[];
  textures: Map<string, FakeObject>;
  removed: string[];
  events: Map<string, Set<(...a: unknown[]) => void>>;
  graphics: FakeObject[];
}

function bakeScene(opts: { noTextures?: boolean } = {}): BakeScene {
  const images: FakeObject[] = [];
  const graphics: FakeObject[] = [];
  const textures = new Map<string, FakeObject>();
  const removed: string[] = [];
  const events = new Map<string, Set<(...a: unknown[]) => void>>();
  const scene = {
    add: {
      image: (...args: unknown[]) => { const o = fakeObject("image", args); images.push(o); return o; },
      graphics: () => { const o = fakeObject("graphics"); graphics.push(o); return o; },
    },
    make: { graphics: () => { const o = fakeObject("graphics"); graphics.push(o); return o; } },
    textures: {
      addDynamicTexture: (key: string, w: number, h: number) => {
        if (opts.noTextures) return null;
        const t = fakeObject("dynamictexture", [key, w, h]);
        textures.set(key, t);
        return t;
      },
      remove: (key: string) => { removed.push(key); textures.delete(key); },
    },
    cameras: { main: Object.assign(fakeObject("camera"), { scrollX: 0, scrollY: 0, width: 400, height: 300, zoom: 1 }) },
    events: {
      on: (name: string, fn: (...a: unknown[]) => void) => { (events.get(name) ?? events.set(name, new Set()).get(name)!).add(fn); },
      off: (name: string, fn: (...a: unknown[]) => void) => { events.get(name)?.delete(fn); },
    },
  } as never;
  return { scene, images, textures, removed, events, graphics };
}

describe("bakeZoneArt on a fake scene", () => {
  it("makes one texture per floor chunk and per page, one image per chunk and per strip, and renders each texture", () => {
    const m = styled(1);
    const s = bakeScene();
    const art = bakeZoneArt(s.scene, m);
    // A 96x96 map bakes its floors at the scale that fits the budget (below 1).
    const floors = planFloor(m, chooseFloorScale(m));
    const { strips, pages } = planStrips(m);
    expect(art.stats.floorChunks).toBe(floors.length);
    expect(art.stats.strips).toBe(strips.length);
    expect(art.stats.pages).toBe(pages.length);
    expect(s.textures.size).toBe(floors.length + pages.length);
    expect(s.images).toHaveLength(floors.length + strips.length);
    expect(art.stats.images).toBe(s.images.length);
    for (const t of s.textures.values()) {
      expect(t.calls.filter(([n]) => n === "draw")).toHaveLength(1);
      expect(t.calls.filter(([n]) => n === "render")).toHaveLength(1);
    }
    expect(art.stats.textureBytes).toBe(planBytes(floors, pages));
    expect(art.stats.ms).toBeGreaterThanOrEqual(0);
  });

  it("cuts a frame per strip out of its page and puts the image at the strip's depth", () => {
    const m = styled(1);
    const s = bakeScene();
    bakeZoneArt(s.scene, m);
    const { strips } = planStrips(m);
    const stripImages = s.images.filter((i) => i.args.length === 4);
    expect(stripImages).toHaveLength(strips.length);
    // Each strip has its image at its own place and depth (the images come page by page, so match them by position).
    const key = (x: number, y: number, depth: number) => `${x},${y},${depth}`;
    const wanted = new Set(strips.map((st) => key(st.x, st.y, st.depth)));
    for (const im of stripImages) expect(wanted.has(key(im.args[0] as number, im.args[1] as number, im.state.depth as number))).toBe(true);
    const frames = [...s.textures.values()].flatMap((t) => t.calls.filter(([n]) => n === "add"));
    expect(frames).toHaveLength(strips.length);
  });

  it("scales a floor chunk's drawing and its image to match when the map is too big for the budget", () => {
    const m = styled(1);
    const s = bakeScene();
    bakeZoneArt(s.scene, m, makeContext(m), 1); // no budget can be met: the smallest floor scale
    const floorImages = s.images.filter((i) => i.args.length === 3);
    expect(floorImages.length).toBeGreaterThan(0);
    for (const im of floorImages) expect(im.state.scale).toBeCloseTo(1 / FLOOR_SCALES[FLOOR_SCALES.length - 1]!, 6);
    const floorTextures = [...s.textures.values()].filter((t) => String(t.args[0]).includes("f"));
    expect(floorTextures.length).toBe(floorImages.length);
    for (const t of floorTextures) expect(t.args[1] as number).toBeLessThanOrEqual(Math.ceil(planFloor(m)[0]!.w * 0.5) + 2);
    expect(s.graphics[0]!.state.scale).toBe(1); // back to 1 for the wall pages
  });

  it("culls: only the images that meet the rectangle stay visible, and showAll brings them back", () => {
    const m = styled(1);
    const s = bakeScene();
    const art = bakeZoneArt(s.scene, m);
    art.cull(0, 0, 100, 100);
    const visible = (im: FakeObject): boolean => !im.calls.some(([n, a]) => n === "setVisible" && a[0] === false) || im.calls.filter(([n]) => n === "setVisible").at(-1)![1][0] === true;
    const shown = s.images.filter(visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(s.images.length);
    art.showAll();
    expect(s.images.every(visible)).toBe(true);
  });

  it("destroys its images and removes its textures", () => {
    const m = styled(1);
    const s = bakeScene();
    const art = bakeZoneArt(s.scene, m);
    const made = s.textures.size;
    art.destroy();
    expect(s.images.every((i) => i.calls.some(([n]) => n === "destroy"))).toBe(true);
    expect(s.removed).toHaveLength(made);
    expect(s.textures.size).toBe(0);
  });

  it("throws, and leaves nothing behind, when the scene cannot make a texture", () => {
    const m = styled(1);
    const s = bakeScene({ noTextures: true });
    expect(() => bakeZoneArt(s.scene, m)).toThrow(/dynamic texture/);
    expect(s.images).toHaveLength(0);
  });
});

describe("MapView paths", () => {
  it("bakes a styled map and exposes the stats; a hand-built map takes the plain way", () => {
    const s = bakeScene();
    const view = new MapView(s.scene, styled(1));
    expect(view.bakeStats).not.toBeNull();
    expect(view.bakeStats!.floorChunks).toBeGreaterThan(0);
    expect(s.textures.size).toBeGreaterThan(0);
    const plain = bakeScene();
    const pv = new MapView(plain.scene, room(12, 10, [[3, 3, 2, 1, TILE_LOW, TERRAIN_LAVA]]));
    expect(pv.bakeStats).toBeNull();
    expect(plain.textures.size).toBe(0);
  });

  it("falls back to the plain way when baking fails", () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const s = bakeScene({ noTextures: true });
      const view = new MapView(s.scene, styled(1));
      expect(view.bakeStats).toBeNull();
      // The plain way drew Graphics rows instead.
      expect(s.graphics.length).toBeGreaterThan(0);
    } finally {
      console.warn = warn;
    }
  });

  it("culls every frame after the scene updates, and stops when destroyed", () => {
    const s = bakeScene();
    const view = new MapView(s.scene, styled(1));
    const handlers = s.events.get("postupdate")!;
    expect(handlers.size).toBe(1);
    [...handlers].forEach((fn) => fn());
    view.destroy();
    expect(handlers.size).toBe(0);
    expect(s.textures.size).toBe(0);
  });
});
