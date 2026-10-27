// The art of the zone shapes (zone-shapes contract 7.5): which look each feature's tiles take (render/zoneArt/featureArt.ts), what a
// wall or a floor of each look paints (featureStyle.ts, through zoneStyle.drawWallTile), and the twelve props the shapes appended.
// The maps here are hand-made with the frozen `p` layouts of contract 2.6, plus the synthetic one of test/synthFeatures.ts (a
// generated map dressed with every kind); the picture itself is judged on the dev page (test/dev/zoneart.html).
import { describe, expect, it } from "vitest";
import {
  FEATURE_KINDS, PROP_KINDS, TERRAIN_ICE, TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_WALL, mapFromTiles,
  type FeatureKind, type GameMap, type MapFeature, type RegionFaction,
} from "@raid/shared";
import { WS_MASS, WS_ROCK, WS_SEGMENT, inwardSides, makeContext, wallInfoAt, wallStyles } from "../src/render/zoneArt/bake";
import {
  FLOOR_LOOKS, WALL_LOOKS, floorLookCode, floorLookOf, masonryOf, planFeatureLooks, shapeOf, wallLookCode, wallLookOf,
} from "../src/render/zoneArt/featureArt";
import {
  SHAPE_FLAT_PROPS, SHAPE_WALL_PROPS, drawFloorLook, drawShapeFlatProp, drawShapeWallProp, paintsWholeWall, type FloorSpot,
} from "../src/render/zoneArt/featureStyle";
import { SHAPE_PALETTE, ZONE_PALETTE } from "../src/render/zoneArt/palette";
import {
  EDGE_E, EDGE_N, EDGE_S, EDGE_W, EMITTER_PROPS, FLAT_PROPS, SHARD_HEIGHT, TILE_H, TILE_W, WALL_HEIGHT, WALL_PROPS, drawFlatProp, drawWallProp,
  drawWallTile, type TileSpot, type WallInfo, type WallLook,
} from "../src/render/zoneArt/zoneStyle";
import { PROP_EMISSION } from "../src/render/zoneArt/propsView";
import { RecordPen } from "./recordPen";
import { synthMap } from "./synthFeatures";

const feature = (kind: FeatureKind, over: Partial<MapFeature> = {}): MapFeature => ({
  kind, variant: "", zone: "fire", jobs: [], ax: 0, ay: 0, p: [], bbox: { x: 0, y: 0, w: 0, h: 0 }, tiles: 0, ...over,
});

/** A walled 40 x 30 map of floor in the fire zone; `walls` and `owned` name tiles, `features` is the list, `own` gives tiles to a feature (1-based). */
function shaped(
  features: MapFeature[],
  own: ReadonlyArray<readonly [feature: number, kind: "wall" | "floor", tiles: ReadonlyArray<readonly [number, number]>]>,
): GameMap {
  const w = 40, h = 30;
  const tiles = new Uint8Array(w * h).fill(TILE_FLOOR);
  for (let x = 0; x < w; x++) { tiles[x] = TILE_WALL; tiles[(h - 1) * w + x] = TILE_WALL; }
  for (let y = 0; y < h; y++) { tiles[y * w] = TILE_WALL; tiles[y * w + w - 1] = TILE_WALL; }
  const map = mapFromTiles(w, h, tiles, 5);
  map.regionGrid.fill(1);
  (map as { regions: unknown[] }).regions = [{ id: "fire" }];
  map.features = features;
  for (const [f, kind, list] of own) for (const [x, y] of list) { map.featureGrid[y * w + x] = f; if (kind === "wall") tiles[y * w + x] = TILE_WALL; }
  return map;
}

const rectOf = (x0: number, y0: number, w: number, h: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  return out;
};

describe("the looks of the features", () => {
  it("names a wall look for every feature kind that has walls and a floor look for every kind that owns floor", () => {
    const wall: Partial<Record<FeatureKind, WallLook>> = {
      crater: "rim", barrow: "mound", hall: "pier", headland: "shard", spire: "shard", gallows: "gallows",
    };
    for (const kind of FEATURE_KINDS) expect(wallLookOf({ kind, variant: "" }), kind).toBe(wall[kind] ?? "plain");
    expect(wallLookOf({ kind: "landmark", variant: "forge" })).toBe("forge");
    expect(wallLookOf({ kind: "landmark", variant: "guardHouse" })).toBe("guardHouse");
    expect(wallLookOf({ kind: "landmark", variant: "burrow" })).toBe("burrow");
    expect(wallLookOf({ kind: "landmark", variant: "watchtower" })).toBe("watchtower");
    expect(wallLookOf({ kind: "landmark", variant: "shrine" })).toBe("shrine");
    // A design the art does not know is a plain building, never a crash.
    expect(wallLookOf({ kind: "landmark", variant: "lighthouse" })).toBe("plain");
    expect(masonryOf("lighthouse")).toBeNull();
    const floor: Partial<Record<FeatureKind, string>> = { crater: "bowl", barrow: "tunnel", hall: "hall", mere: "shore", causeway: "causeway" };
    for (const kind of FEATURE_KINDS) expect(floorLookOf({ kind, variant: "" }), kind).toBe(floor[kind] ?? "plain");
    expect(floorLookOf({ kind: "landmark", variant: "shrine" })).toBe("shrine");
  });

  it("keeps the look tables in code order, 'plain' first", () => {
    expect(WALL_LOOKS[0]).toBe("plain");
    expect(FLOOR_LOOKS[0]).toBe("plain");
    for (const [i, look] of WALL_LOOKS.entries()) expect(wallLookCode(look)).toBe(i);
    for (const [i, look] of FLOOR_LOOKS.entries()) expect(floorLookCode(look)).toBe(i);
    expect(new Set(WALL_LOOKS).size).toBe(WALL_LOOKS.length);
    expect(new Set(FLOOR_LOOKS).size).toBe(FLOOR_LOOKS.length);
  });

  it("gives all-zero layers to a map with no features, and to one whose featureGrid is not its size (a tiled test map)", () => {
    const plain = shaped([], []);
    const looks = planFeatureLooks(plain);
    expect(looks.wall.every((v) => v === 0)).toBe(true);
    expect(looks.floor.every((v) => v === 0)).toBe(true);
    expect(looks.shapes).toEqual([]);
    const odd = shaped([feature("crater")], [[1, "wall", [[10, 10]]]]);
    odd.featureGrid = new Uint8Array(3);
    expect(planFeatureLooks(odd).wall.every((v) => v === 0)).toBe(true);
  });

  it("dresses wall tiles by their feature and floor tiles by theirs, and leaves a wall of no feature plain", () => {
    const map = shaped(
      [feature("crater", { ax: 10, ay: 10, p: [0, 24, 2, 0, 8] }), feature("hall", { p: [0, 6, 19, 1, 0] }), feature("landmark", { variant: "watchtower", p: [0, 0] })],
      [
        [1, "wall", [[5, 5], [6, 5]]], [1, "floor", [[7, 7]]],
        [2, "wall", rectOf(20, 10, 3, 3)], [2, "floor", [[24, 11]]],
        [3, "wall", [[30, 20]]], [3, "floor", [[31, 21]]],
      ],
    );
    const { wall, floor } = planFeatureLooks(map);
    const at = (x: number, y: number): number => y * map.w + x;
    expect(WALL_LOOKS[wall[at(5, 5)]!]).toBe("rim");
    expect(WALL_LOOKS[wall[at(21, 11)]!]).toBe("pier");
    expect(WALL_LOOKS[wall[at(30, 20)]!]).toBe("watchtower");
    expect(wall[at(0, 0)]).toBe(0); // the border
    expect(FLOOR_LOOKS[floor[at(7, 7)]!]).toBe("bowl");
    expect(FLOOR_LOOKS[floor[at(24, 11)]!]).toBe("hall");
    expect(FLOOR_LOOKS[floor[at(31, 21)]!]).toBe("watchtower");
    expect(floor[at(5, 5)]).toBe(0); // a wall tile carries no floor look
    expect(wall[at(7, 7)]).toBe(0);
  });

  it("marks a landmark's doorways from p and a river's fords from p, and only on floor", () => {
    const door = 12 * 40 + 20; // p lists door tile indices after [rot, mirror]
    const wallDoor = 5 * 40 + 5;
    const ford = 15 * 40 + 25;
    const map = shaped(
      [feature("landmark", { variant: "forge", p: [0, 0, door, wallDoor] }), feature("lavaRiver", { p: [2, 1, ford] })],
      [[1, "floor", [[20, 12]]]],
    );
    // The river's lava, two tiles west of the ford's centre, so the bank tiles round it touch lava.
    map.tiles[15 * 40 + 22] = 2;
    map.terrain[15 * 40 + 22] = TERRAIN_LAVA;
    map.tiles[wallDoor] = TILE_WALL;
    const { floor } = planFeatureLooks(map);
    expect(FLOOR_LOOKS[floor[door]!]).toBe("door");
    expect(floor[wallDoor]).toBe(0); // a door index that is a wall is ignored
    expect(FLOOR_LOOKS[floor[15 * 40 + 23]!]).toBe("ford");
    expect(floor[15 * 40 + 22]).toBe(0); // the lava itself is not a bank
    expect(floor[15 * 40 + 30]).toBe(0); // too far from the ford's centre to touch the lava
  });

  it("centres a crater on its camp, a barrow on its anchor with its radius, and any other feature on its box", () => {
    const map = shaped([feature("crater", { ax: 3, ay: 4, p: [0, 26, 2, 0, 8] })], []);
    map.camps = [{ id: "fire-1", zone: "fire", x: 10 * TILE + TILE / 2, y: 12 * TILE + TILE / 2, r: 80, spots: [], eliteSpot: -1, chest: { x: 0, y: 0 }, area: 0, radius: 0 }];
    expect(shapeOf(map, map.features[0]!)).toEqual({ cx: 10.5, cy: 12.5, r: 6.5 });
    // A crater whose camp index is not on the map falls back to its anchor.
    expect(shapeOf(map, feature("crater", { ax: 3, ay: 4, p: [9, 20] }))).toEqual({ cx: 3.5, cy: 4.5, r: 5 });
    expect(shapeOf(map, feature("barrow", { ax: 20, ay: 8, p: [18, 1, 4, 1], bbox: { x: 15, y: 2, w: 12, h: 14 } }))).toEqual({ cx: 20.5, cy: 8.5, r: 4.5 });
    expect(shapeOf(map, feature("hall", { bbox: { x: 10, y: 10, w: 20, h: 20 } }))).toEqual({ cx: 20, cy: 20, r: 10 });
  });
});

describe("the wall info a feature look adds", () => {
  /** A map with a 5x4 block of wall in feature 1 of `kind`, plus a lone wall tile in the same feature. */
  const withBlock = (kind: FeatureKind, variant = "", camps = false): GameMap => {
    const map = shaped([feature(kind, { variant, ax: 12, ay: 11, p: kind === "crater" ? [0, 24, 0] : kind === "barrow" ? [16, 0, 0, 1] : [] })], [[1, "wall", [...rectOf(10, 10, 5, 4), [25, 20]]]]);
    if (camps) map.camps = [{ id: "fire-1", zone: "fire", x: 12.5 * TILE, y: 11.5 * TILE, r: 80, spots: [], eliteSpot: -1, chest: { x: 0, y: 0 }, area: 0, radius: 0 }];
    return map;
  };

  it("leaves an unfeatured map's wall info exactly as it was (no extra keys), and puts a look on a mass or a run of stones", () => {
    const plain = shaped([], []);
    plain.tiles[10 * 40 + 10] = TILE_WALL;
    plain.tiles[10 * 40 + 11] = TILE_WALL;
    const info = wallInfoAt(makeContext(plain), 10, 10);
    expect(Object.keys(info).sort()).toEqual(["front", "lift", "open", "pillarKind", "style"]);
    const map = withBlock("hall");
    const ctx = makeContext(map);
    expect(wallInfoAt(ctx, 11, 11).look).toBe("pier");
    expect(wallInfoAt(ctx, 11, 11).style).toBe("mass");
    // A lone stone keeps its own art, whatever feature owns it (a rock is never joined, the seams rest on that).
    expect(ctx.styles[20 * 40 + 25]).toBe(WS_ROCK);
    expect(wallInfoAt(ctx, 25, 20).look).toBeUndefined();
  });

  it("lowers a headland's or a spire's facets to a shard's height and keeps every other feature at a full wall", () => {
    for (const kind of ["headland", "spire"] as const) expect(wallInfoAt(makeContext(withBlock(kind)), 11, 11).lift).toBe(SHARD_HEIGHT);
    for (const kind of ["hall", "barrow", "gallows"] as const) expect(wallInfoAt(makeContext(withBlock(kind)), 11, 11).lift).toBe(WALL_HEIGHT);
    expect(wallInfoAt(makeContext(withBlock("landmark", "forge")), 11, 11).lift).toBe(WALL_HEIGHT);
  });

  it("breaks a crater's rim: one tile in eight stands 5 px lower, two in eight 3 px lower, never taller than a wall", () => {
    // A wide rim: one row of 90 stones inside one crater.
    const map = shaped([feature("crater", { p: [0, 24, 0] })], [[1, "wall", [...rectOf(2, 5, 36, 3), ...rectOf(2, 15, 36, 3)]]]);
    const ctx = makeContext(map);
    const lifts = new Map<number, number>();
    for (let y of [5, 6, 7, 15, 16, 17]) for (let x = 2; x < 38; x++) lifts.set(wallInfoAt(ctx, x, y).lift, (lifts.get(wallInfoAt(ctx, x, y).lift) ?? 0) + 1);
    expect([...lifts.keys()].sort((a, b) => a - b)).toEqual([WALL_HEIGHT - 5, WALL_HEIGHT - 3, WALL_HEIGHT]);
    const n = 6 * 36;
    expect(lifts.get(WALL_HEIGHT - 5)! / n).toBeGreaterThan(0.05);
    expect(lifts.get(WALL_HEIGHT - 5)! / n).toBeLessThan(0.22);
    expect(lifts.get(WALL_HEIGHT)! / n).toBeGreaterThan(0.45);
    // The same map gives the same lifts again: the jitter is the map's own (its seed), not a random draw.
    expect(wallInfoAt(makeContext(map), 9, 6).lift).toBe(wallInfoAt(ctx, 9, 6).lift);
  });

  it("tells a crater rim which sides face the camp (both near a diagonal) and a barrow's mound how near its crown it is", () => {
    expect(inwardSides(5, 0)).toBe(EDGE_E);
    expect(inwardSides(-5, 0.5)).toBe(EDGE_W);
    expect(inwardSides(0, 4)).toBe(EDGE_S);
    expect(inwardSides(0.2, -4)).toBe(EDGE_N);
    expect(inwardSides(3, 3)).toBe(EDGE_E | EDGE_S);
    expect(inwardSides(-3, -2.5)).toBe(EDGE_W | EDGE_N);
    expect(inwardSides(0, 0)).toBe(0);
    const rim = withBlock("crater", "", true);
    const rctx = makeContext(rim);
    // The camp is at (12.5, 11.5): the tile west of it faces east, the one north of it faces south.
    expect(wallInfoAt(rctx, 10, 11).inward! & EDGE_E).toBe(EDGE_E);
    expect(wallInfoAt(rctx, 12, 10).inward! & EDGE_S).toBe(EDGE_S);
    const mound = makeContext(withBlock("barrow"));
    const crown = wallInfoAt(mound, 12, 11).dome!;
    const edge = wallInfoAt(mound, 14, 13).dome!;
    expect(crown).toBeGreaterThan(edge);
    expect(crown).toBeLessThanOrEqual(1);
    expect(edge).toBeGreaterThanOrEqual(0);
  });

  it("reads the styles a look may dress as mass or segment only", () => {
    const ctx = makeContext(withBlock("barrow"));
    for (const [x, y] of rectOf(10, 10, 5, 4)) expect([WS_MASS, WS_SEGMENT]).toContain(wallStyles(withBlock("barrow"))[y * 40 + x]);
    expect(ctx.looks.wall[11 * 40 + 11]).toBe(wallLookCode("mound"));
  });
});

// ------------------------------------------------------------------------------------------------------------------ painting

const spotAt = (over: Partial<TileSpot> = {}): TileSpot => ({ x: 100, y: 100, tx: 6, ty: 5, hash: 0x9e3779b9, open: 0, ...over });
const info = (look: WallLook | undefined, over: Partial<WallInfo> = {}): WallInfo => ({ style: "mass", lift: WALL_HEIGHT, open: EDGE_N | EDGE_W, front: true, pillarKind: 0, look, ...over });
const wall = (zone: RegionFaction, w: WallInfo, s: TileSpot = spotAt()): RecordPen => {
  const g = new RecordPen();
  drawWallTile(g, zone, s, w);
  return g;
};
const MASONRY: WallLook[] = ["forge", "guardHouse", "burrow", "watchtower", "shrine"];
const WHOLE: WallLook[] = ["mound", "pier", "gallows", ...MASONRY];
const ALL: WallLook[] = ["rim", "shard", ...WHOLE];

describe("a wall of each look", () => {
  it("draws the zone's own wall for no look, for 'plain' and for a shard (a shard only lowers it)", () => {
    for (const zone of ["fire", "sentenced", "plague", "frost", "holy"] as const) {
      const base = wall(zone, info(undefined)).signature();
      expect(wall(zone, info("plain")).signature()).toBe(base);
      expect(wall(zone, info("shard", { lift: SHARD_HEIGHT })).signature()).toBe(wall(zone, info(undefined, { lift: SHARD_HEIGHT })).signature());
    }
  });

  it("says which looks paint the whole tile: the mound, the pier, the masonry and the gallows, not the rim or the shard", () => {
    for (const look of WHOLE) expect(paintsWholeWall(look), look).toBe(true);
    for (const look of ["rim", "shard", "plain", undefined] as const) expect(paintsWholeWall(look), String(look)).toBe(false);
  });

  it("draws every look differently from the plain wall and from each other", () => {
    const sigs = new Set<string>();
    for (const look of ALL) {
      const zone: RegionFaction = look === "rim" ? "fire" : look === "mound" ? "plague" : look === "pier" ? "holy" : look === "shard" ? "frost" : "fire";
      const own = wall(zone, info(look, { inward: EDGE_E | EDGE_S, dome: 0.5 })).signature();
      if (look !== "shard") expect(own, look).not.toBe(wall(zone, info(undefined)).signature());
      sigs.add(`${zone}:${own}`);
    }
    // Masonry is zone-independent: five designs, five drawings.
    expect(new Set(MASONRY.map((look) => wall("fire", info(look)).signature())).size).toBe(MASONRY.length);
    expect(sigs.size).toBe(ALL.length);
  });

  it("is deterministic: the same tile, the same look, the same drawing", () => {
    for (const look of ALL) expect(wall("fire", info(look, { inward: EDGE_N, dome: 0.3 })).signature()).toBe(wall("fire", info(look, { inward: EDGE_N, dome: 0.3 })).signature());
  });

  it("lights a crater rim's lip on the sides that face the camp and darkens the sides that look away", () => {
    const plain = wall("fire", info("plain", { open: EDGE_N | EDGE_W | EDGE_E, front: false })).ops.length;
    const lit = wall("fire", info("rim", { open: EDGE_N | EDGE_W | EDGE_E, inward: EDGE_N, front: false }));
    expect(lit.ops.length).toBeGreaterThan(plain);
    const lip = SHAPE_PALETTE.crater.lip;
    const bands = lit.ops.map((o, i) => [o, lit.ops[i + 1]] as const).filter(([style, next]) => style.name === "fillStyle" && style.args[0] === lip && next?.name === "fillRect");
    expect(bands.length).toBeGreaterThanOrEqual(1);
    // The north lip is a 3 px band along the top face's edge.
    const north = bands.map(([, rect]) => rect!.args).find(([, , w, h]) => w === TILE_W && h === 3);
    expect(north).toBeDefined();
    expect(north![1]).toBe(100 - WALL_HEIGHT);
    // A rim tile with no open side that faces the camp has no lip; a tile with the camp to its south lights the front face.
    const none = wall("fire", info("rim", { open: EDGE_W, inward: EDGE_E }));
    expect(none.ops.some((o) => o.name === "fillStyle" && o.args[0] === lip)).toBe(false);
    const front = wall("fire", info("rim", { open: EDGE_S, inward: EDGE_S, front: true }));
    expect(front.of("fillRect").some(([, y, w, h]) => w === TILE_W && h === 4 && y === 100 + TILE_H - WALL_HEIGHT)).toBe(true);
  });

  it("draws a pier's capital round the column's outer edges and its flutes on the front, so the nine tiles read as one column", () => {
    const corner = wall("holy", info("pier", { open: EDGE_N | EDGE_W }));
    const centre = wall("holy", info("pier", { open: 0, front: false }));
    // The corner tile has the pale capital band on its open sides and a gold rivet (rectangles the centre tile does not draw).
    const cap = SHAPE_PALETTE.pier.cap;
    const gold = SHAPE_PALETTE.pier.gold;
    const used = (g: RecordPen, colour: number): boolean => g.ops.some((o) => o.name === "fillStyle" && o.args[0] === colour);
    expect(used(corner, cap)).toBe(true);
    expect(used(corner, gold)).toBe(true);
    expect(corner.count("fillRect")).toBeGreaterThanOrEqual(centre.count("fillRect") + 6);
    expect(centre.of("fillRect").filter(([, , w, h]) => (w === TILE_W && h === 3) || (w === 3 && h === TILE_H))).toHaveLength(0);
    // A tile with the south open shows the fluted shaft (the front face) in the shaft colour.
    expect(used(wall("holy", info("pier", { open: EDGE_S, front: true })), SHAPE_PALETTE.pier.shaft)).toBe(true);
  });

  it("greens a mound toward its crown: a brighter top where the dome is high", () => {
    const top = (dome: number): number => {
      const g = wall("plague", info("mound", { open: 0, front: false, dome }));
      return g.ops.find((o) => o.name === "fillStyle")!.args[0]!;
    };
    expect(top(1)).not.toBe(top(0));
    const green = (c: number): number => ((c >> 8) & 255) - ((c >> 16) & 255);
    expect(green(top(1))).toBeGreaterThan(green(top(0)));
  });

  it("keeps every look inside its tile's column and between its top face and its foot, for every open side and front", () => {
    for (const look of ALL) {
      for (let open = 0; open < 16; open++) {
        for (const front of [false, true]) {
          const w = info(look, { open, front, lift: look === "shard" ? SHARD_HEIGHT : WALL_HEIGHT, inward: EDGE_N | EDGE_E, dome: 0.7 });
          const g = wall("fire", w);
          for (const [x0, y0, x1, y1] of g.extents()) {
            const why = `${look} open ${open} front ${front}`;
            expect(x0, why).toBeGreaterThanOrEqual(100 - 0.01);
            expect(x1, why).toBeLessThanOrEqual(100 + TILE_W + 0.01);
            expect(y0, why).toBeGreaterThanOrEqual(100 - w.lift - 0.01);
            expect(y1, why).toBeLessThanOrEqual(100 + TILE_H + 0.01);
          }
        }
      }
    }
  });
});

describe("a floor of each look", () => {
  const floorSpot = (over: Partial<FloorSpot> = {}): FloorSpot => ({ ...spotAt(), dist: 4, radius: 6, ...over });
  const floor = (look: (typeof FLOOR_LOOKS)[number], s: FloorSpot = floorSpot()): RecordPen => {
    const g = new RecordPen();
    drawFloorLook(g, look, s);
    return g;
  };

  it("paints nothing for 'plain' and something distinct for every other look", () => {
    expect(floor("plain").ops).toHaveLength(0);
    const sigs = new Set<string>();
    for (const look of FLOOR_LOOKS.filter((l) => l !== "plain")) {
      const g = floor(look, floorSpot({ open: EDGE_N | EDGE_E }));
      expect(g.ops.length, look).toBeGreaterThan(0);
      sigs.add(g.signature());
    }
    expect(sigs.size).toBe(FLOOR_LOOKS.length - 1);
  });

  it("darkens a crater's bowl toward its rim, and leaves the middle of the bowl paler", () => {
    const alpha = (dist: number): number => {
      const g = floor("bowl", floorSpot({ dist, radius: 6, hash: 1 }));
      const style = g.ops.find((o) => o.name === "fillStyle" && o.args[0] === SHAPE_PALETTE.crater.ash);
      return style ? style.args[1]! : 0;
    };
    expect(alpha(0.5)).toBe(0);
    expect(alpha(5.4)).toBeGreaterThan(alpha(3.5));
    expect(alpha(5.4)).toBeGreaterThan(0.3);
    expect(alpha(5.4)).toBeLessThanOrEqual(0.65);
  });

  it("draws the shore's bright rim only along the sides that meet the ice, and a doorway's sill across the way through", () => {
    const rims = (open: number): number => floor("shore", floorSpot({ open, hash: 3 })).of("fillRect").filter(([, , w, h]) => (w === TILE_W && h === 2) || (w === 2 && h === TILE_H)).length;
    expect(rims(0)).toBe(0);
    expect(rims(EDGE_N)).toBe(1);
    expect(rims(EDGE_N | EDGE_S | EDGE_E | EDGE_W)).toBe(4);
    const across = floor("door", floorSpot({ open: EDGE_W | EDGE_E })).of("fillRect")[0]!;
    const along = floor("door", floorSpot({ open: EDGE_N | EDGE_S })).of("fillRect")[0]!;
    expect(across[2]).toBe(TILE_W);
    expect(along[3]).toBe(TILE_H);
  });

  it("keeps every floor look inside its tile's footprint", () => {
    for (const look of FLOOR_LOOKS) {
      for (let open = 0; open < 16; open += 3) {
        for (const hash of [0, 0x9e3779b9, 0xffffffff, 0x12345678]) {
          const g = floor(look, floorSpot({ open, hash, dist: 5.5, radius: 6 }));
          for (const [x0, y0, x1, y1] of g.extents()) {
            const why = `${look} open ${open} hash ${hash}`;
            expect(x0, why).toBeGreaterThanOrEqual(100 - 0.01);
            expect(y0, why).toBeGreaterThanOrEqual(100 - 0.01);
            expect(x1, why).toBeLessThanOrEqual(100 + TILE_W + 0.01);
            expect(y1, why).toBeLessThanOrEqual(100 + TILE_H + 0.01);
          }
        }
      }
    }
  });
});

describe("the twelve props the zone shapes appended", () => {
  const SHAPE_KEYS = ["crater_lip", "anvil", "slag_heap", "gate_post", "stocks", "tunnel_beam", "burrow_rubble", "reed", "tower_frost", "ice_crack", "altar", "brazier"];
  const prop = (key: string, over: Partial<{ x: number; y: number; v: number; lift: number }> = {}) => ({ key, x: 300, y: 300, v: 5, lift: WALL_HEIGHT, ...over });

  it("are the table's last twelve, in contract order, and every one has art of its own kind", () => {
    expect(PROP_KINDS.slice(-12).map((k) => k.key)).toEqual(SHAPE_KEYS);
    for (const k of SHAPE_KEYS) expect(FLAT_PROPS.has(k) || WALL_PROPS.has(k), k).toBe(true);
    for (const k of SHAPE_KEYS) expect(FLAT_PROPS.has(k) !== WALL_PROPS.has(k), k).toBe(true);
    expect(new Set([...SHAPE_FLAT_PROPS, ...SHAPE_WALL_PROPS])).toEqual(new Set(SHAPE_KEYS));
    // What the table says of the tile class a kind stands on is what decides how it is drawn.
    for (const k of PROP_KINDS.slice(-12)) {
      if (k.on === TILE_FLOOR) expect(FLAT_PROPS.has(k.key), k.key).toBe(true);
      else expect(WALL_PROPS.has(k.key), k.key).toBe(true);
    }
  });

  it("draw something each, differently, and are ignored by a key they do not own", () => {
    const sigs = new Set<string>();
    for (const k of SHAPE_KEYS) {
      const g = new RecordPen();
      if (SHAPE_FLAT_PROPS.has(k)) expect(drawShapeFlatProp(g, prop(k))).toBe(true);
      else expect(drawShapeWallProp(g, prop(k))).toBe(true);
      expect(g.ops.length, k).toBeGreaterThan(0);
      sigs.add(g.signature());
      // Through the zone art's own entry points as well (the bake calls these).
      const via = new RecordPen();
      if (FLAT_PROPS.has(k)) drawFlatProp(via, prop(k)); else drawWallProp(via, prop(k));
      expect(via.signature(), k).toBe(g.signature());
    }
    expect(sigs.size).toBe(12);
    expect(drawShapeFlatProp(new RecordPen(), prop("anvil_of_the_gods"))).toBe(false);
    expect(drawShapeWallProp(new RecordPen(), prop("ember_vent"))).toBe(false);
  });

  it("keep a floor prop within 26 px of its anchor and a wall prop within its tile's column and a strip's head room", () => {
    for (const k of SHAPE_FLAT_PROPS) {
      for (const v of [0, 5, 77, 255]) {
        const g = new RecordPen();
        drawShapeFlatProp(g, prop(k, { v }));
        for (const [x0, y0, x1, y1] of g.extents()) {
          expect(x0, k).toBeGreaterThanOrEqual(300 - 26);
          expect(x1, k).toBeLessThanOrEqual(300 + 26);
          // 22 px above the anchor at most: a prop on the first row of a chunk may reach 16 px above the texture and stays inside the 28 px the bake tolerates.
          expect(y0, k).toBeGreaterThanOrEqual(300 - 22);
          expect(y1, k).toBeLessThanOrEqual(300 + 12);
        }
      }
    }
    for (const k of SHAPE_WALL_PROPS) {
      for (const lift of [WALL_HEIGHT, 7]) {
        const g = new RecordPen();
        drawShapeWallProp(g, prop(k, { lift }));
        for (const [x0, y0, x1] of g.extents()) {
          expect(x0, k).toBeGreaterThanOrEqual(300 - TILE_W / 2 - 0.01);
          expect(x1, k).toBeLessThanOrEqual(300 + TILE_W / 2 + 0.01);
          // The strip's frame reaches 14 px above the footprint: the footprint's top is y - TILE_H / 2.
          expect(y0, k).toBeGreaterThanOrEqual(300 - TILE_H / 2 - WALL_HEIGHT - 0.01);
        }
      }
    }
  });

  it("send golden motes up from a brazier, and nothing else of the twelve emits", () => {
    expect(EMITTER_PROPS.has("brazier")).toBe(true);
    expect(PROP_EMISSION.brazier).toBe("mote");
    for (const k of SHAPE_KEYS.filter((s) => s !== "brazier")) expect(EMITTER_PROPS.has(k), k).toBe(false);
    for (const k of EMITTER_PROPS) expect(PROP_EMISSION[k], k).toBeDefined();
  });
});

describe("the synthetic map of every feature kind", () => {
  const map = synthMap({ seed: 3 });
  const kinds = new Set(map.features.map((f) => f.kind));

  it("has a feature of every kind the art draws, with the frozen p layouts, and a look on every owned wall", () => {
    for (const kind of ["landmark", "crater", "lavaRiver", "fenceRow", "gallows", "barrow", "mere", "headland", "causeway", "hall"] as const) expect(kinds.has(kind), kind).toBe(true);
    const { wall, floor } = planFeatureLooks(map);
    let walls = 0, looked = 0;
    for (let i = 0; i < map.tiles.length; i++) {
      const f = map.featureGrid[i]!;
      if (f === 0 || map.tiles[i] !== TILE_WALL) continue;
      walls++;
      if (wall[i] === wallLookCode(wallLookOf(map.features[f - 1]!))) looked++;
    }
    expect(walls).toBeGreaterThan(300);
    expect(looked).toBe(walls);
    // The mere's owned floor has the shore look; the bake paints it only where there is no ICE (the ICE keeps its own art).
    let shore = 0, bare = 0;
    for (let i = 0; i < map.tiles.length; i++) if (FLOOR_LOOKS[floor[i]!] === "shore") { shore++; if (map.terrain[i] !== TERRAIN_ICE) bare++; }
    expect(shore).toBeGreaterThan(100);
    expect(bare).toBeGreaterThan(20);
  });

  it("dresses all five landmark designs' walls in their own masonry", () => {
    const seen = new Set<string>();
    const { wall } = planFeatureLooks(map);
    for (let i = 0; i < wall.length; i++) seen.add(WALL_LOOKS[wall[i]!]!);
    for (const look of ["forge", "guardHouse", "burrow", "watchtower", "shrine", "rim", "mound", "pier", "shard", "gallows"]) expect(seen.has(look), look).toBe(true);
  });

  it("holds the palette's own landmark colours apart: no two designs share a top colour, and none is the zone's own wall", () => {
    const tops: number[] = MASONRY.map((l) => SHAPE_PALETTE[l as "forge"].top);
    expect(new Set(tops).size).toBe(5);
    for (const zone of Object.values(ZONE_PALETTE)) expect(tops.includes(zone.wallTop)).toBe(false);
  });
});

// Keeps the helper imports honest: the size of one tile in the projected frame the painters assume.
describe("the frame the shapes are drawn in", () => {
  it("is the zone art's own: a 32 x 25.6 footprint", () => {
    expect(TILE_W).toBe(TILE);
    expect(TILE_H).toBeCloseTo(25.6, 9);
  });
});
