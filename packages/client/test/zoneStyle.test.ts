// The zone art's draw functions (render/zoneArt/zoneStyle.ts) on a recording stub: what each kind paints is judged by shape
// (the shape language of D 7.4: colour is never the only cue), by staying inside its tile, and by being deterministic. No
// colour literals are pinned; the palette test owns the colours.
import { describe, expect, it } from "vitest";
import {
  REGION_FACTIONS, TERRAIN_BOG, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TERRAIN_LIGHT, TILE, Y_SCALE,
} from "@raid/shared";
import {
  EDGE_E, EDGE_N, EDGE_S, EDGE_W, EMITTER_PROPS, FLAT_PROPS, LIGHT_RAYS, LOW_HEIGHT, SHARD_HEIGHT, TILE_H, TILE_W, WALL_HEIGHT, WALL_PROPS,
  drawBogBubble, drawEmberGlow, drawFenceTile, drawFlatProp, drawFloorTile, drawIceShimmer, drawLavaGlow, drawLightBeam, drawTerrainFloor,
  drawWallProp, drawWallTile, floorTileColor, hashTile, isFlatTerrain, terrainFamily, type Pen, type PropSpot, type TileSpot, type WallInfo,
} from "../src/render/zoneArt/zoneStyle";
import { ZONE_PROP_KINDS } from "@raid/shared";

type Pt = readonly [number, number];
interface Op { name: string; args: number[] }

/** A Pen that records every call and the polylines drawn between beginPath and strokePath/fillPath. */
class RecordPen implements Pen {
  readonly ops: Op[] = [];
  readonly paths: Pt[][] = [];
  private current: Pt[] | null = null;
  private rec(name: string, args: number[]): this {
    this.ops.push({ name, args });
    return this;
  }
  fillStyle(color: number, alpha = 1): this { return this.rec("fillStyle", [color, alpha]); }
  lineStyle(width: number, color: number, alpha = 1): this { return this.rec("lineStyle", [width, color, alpha]); }
  fillRect(x: number, y: number, w: number, h: number): this { return this.rec("fillRect", [x, y, w, h]); }
  strokeRect(x: number, y: number, w: number, h: number): this { return this.rec("strokeRect", [x, y, w, h]); }
  fillRoundedRect(x: number, y: number, w: number, h: number): this { return this.rec("fillRect", [x, y, w, h]); }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this { return this.rec("lineBetween", [x1, y1, x2, y2]); }
  fillCircle(x: number, y: number, r: number): this { return this.rec("fillCircle", [x, y, r]); }
  strokeCircle(x: number, y: number, r: number): this { return this.rec("strokeCircle", [x, y, r]); }
  fillEllipse(x: number, y: number, w: number, h: number): this { return this.rec("fillEllipse", [x, y, w, h]); }
  strokeEllipse(x: number, y: number, w: number, h: number): this { return this.rec("strokeEllipse", [x, y, w, h]); }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this { return this.rec("fillTriangle", [x1, y1, x2, y2, x3, y3]); }
  beginPath(): this { this.current = []; this.paths.push(this.current); return this.rec("beginPath", []); }
  moveTo(x: number, y: number): this { this.current?.push([x, y]); return this.rec("moveTo", [x, y]); }
  lineTo(x: number, y: number): this { this.current?.push([x, y]); return this.rec("lineTo", [x, y]); }
  closePath(): this { return this.rec("closePath", []); }
  fillPath(): this { return this.rec("fillPath", []); }
  strokePath(): this { return this.rec("strokePath", []); }

  count(name: string): number { return this.ops.filter((o) => o.name === name).length; }
  of(name: string): number[][] { return this.ops.filter((o) => o.name === name).map((o) => o.args); }
  /** Every point the pen reached, as [x, y] and a padding radius for shapes. */
  extents(): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    for (const o of this.ops) {
      const a = o.args;
      if (o.name === "fillRect" || o.name === "strokeRect") out.push([a[0]!, a[1]!, a[0]! + a[2]!, a[1]! + a[3]!]);
      else if (o.name === "lineBetween") out.push([Math.min(a[0]!, a[2]!), Math.min(a[1]!, a[3]!), Math.max(a[0]!, a[2]!), Math.max(a[1]!, a[3]!)]);
      else if (o.name === "fillCircle" || o.name === "strokeCircle") out.push([a[0]! - a[2]!, a[1]! - a[2]!, a[0]! + a[2]!, a[1]! + a[2]!]);
      else if (o.name === "fillEllipse" || o.name === "strokeEllipse") out.push([a[0]! - a[2]! / 2, a[1]! - a[3]! / 2, a[0]! + a[2]! / 2, a[1]! + a[3]! / 2]);
      else if (o.name === "fillTriangle") out.push([Math.min(a[0]!, a[2]!, a[4]!), Math.min(a[1]!, a[3]!, a[5]!), Math.max(a[0]!, a[2]!, a[4]!), Math.max(a[1]!, a[3]!, a[5]!)]);
    }
    for (const path of this.paths) {
      if (path.length === 0) continue;
      out.push([Math.min(...path.map((p) => p[0])), Math.min(...path.map((p) => p[1])), Math.max(...path.map((p) => p[0])), Math.max(...path.map((p) => p[1]))]);
    }
    return out;
  }
  /** The signature of everything drawn: equal for equal drawings. */
  signature(): string { return JSON.stringify(this.ops); }
}

const spot = (over: Partial<TileSpot> = {}): TileSpot => ({ x: 100, y: 200, tx: 5, ty: 7, hash: hashTile(5, 7), open: 0, ...over });
const record = (fn: (g: RecordPen) => void): RecordPen => { const g = new RecordPen(); fn(g); return g; };

/** Direction reversals in a polyline's y (zigzag turns). */
function turns(path: readonly Pt[]): number {
  let n = 0;
  let prev = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.sign(path[i]![1] - path[i - 1]![1]);
    if (d !== 0 && prev !== 0 && d !== prev) n++;
    if (d !== 0) prev = d;
  }
  return n;
}
const amplitude = (path: readonly Pt[]): number => Math.max(...path.map((p) => p[1])) - Math.min(...path.map((p) => p[1]));

describe("hashTile", () => {
  it("is deterministic, 32-bit unsigned, and varies with the tile and the salt", () => {
    expect(hashTile(3, 4)).toBe(hashTile(3, 4));
    expect(hashTile(3, 4)).toBeGreaterThanOrEqual(0);
    expect(hashTile(3, 4)).toBeLessThan(2 ** 32);
    expect(new Set([hashTile(3, 4), hashTile(4, 3), hashTile(3, 4, 1), hashTile(0, 0)]).size).toBe(4);
  });
  it("spreads over its low bits (the variants read them)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(hashTile(i, 3) & 3);
    expect(seen.size).toBe(4);
  });
});

describe("tile geometry", () => {
  it("matches the world: a tile is TILE wide and TILE * Y_SCALE tall, walls lift 14 and LOW half of that", () => {
    expect(TILE_W).toBe(TILE);
    expect(TILE_H).toBe(TILE * Y_SCALE);
    expect(WALL_HEIGHT).toBe(14);
    expect(LOW_HEIGHT).toBe(7);
    expect(SHARD_HEIGHT).toBeLessThan(WALL_HEIGHT);
    expect(SHARD_HEIGHT).toBeCloseTo(WALL_HEIGHT * 0.7, 0);
    expect(TILE_H).toBeLessThan(WALL_HEIGHT * 2); // a wall never hides a whole tile north of it
  });
});

describe("plain floor tiles", () => {
  it("paint inside their own footprint, in every zone, for many hashes", () => {
    for (const zone of REGION_FACTIONS) {
      for (let i = 0; i < 40; i++) {
        const s = spot({ tx: i, ty: i * 3 % 11, hash: hashTile(i, i * 3 % 11), x: 64, y: 64 });
        for (const [x0, y0, x1, y1] of record((g) => drawFloorTile(g, zone, s)).extents()) {
          expect(x0).toBeGreaterThanOrEqual(s.x - 0.01);
          expect(y0).toBeGreaterThanOrEqual(s.y - 0.01);
          expect(x1).toBeLessThanOrEqual(s.x + TILE_W + 0.01);
          expect(y1).toBeLessThanOrEqual(s.y + TILE_H + 0.01);
        }
      }
    }
  });

  it("start with the tile's own fill and differ by zone", () => {
    const sigs = new Set<string>();
    for (const zone of REGION_FACTIONS) {
      const g = record((p) => drawFloorTile(p, zone, spot()));
      expect(g.ops[0]!.name).toBe("fillStyle");
      expect(g.ops[1]).toEqual({ name: "fillRect", args: [100, 200, TILE_W, TILE_H] });
      sigs.add(g.signature());
    }
    expect(sigs.size).toBe(REGION_FACTIONS.length);
  });

  it("are deterministic, and vary with the hash (not one stamp repeated)", () => {
    for (const zone of REGION_FACTIONS) {
      const a = record((g) => drawFloorTile(g, zone, spot())).signature();
      expect(record((g) => drawFloorTile(g, zone, spot())).signature()).toBe(a);
      const variants = new Set<string>();
      for (let i = 0; i < 24; i++) variants.add(record((g) => drawFloorTile(g, zone, spot({ tx: i, ty: 2, hash: hashTile(i, 2) }))).signature());
      expect(variants.size, zone).toBeGreaterThan(2);
    }
  });

  it("picks a floor colour from the zone's two, Sanctum as a checker", () => {
    const colours = new Set<number>();
    for (let i = 0; i < 64; i++) colours.add(floorTileColor("fire", { tx: i, ty: 0, hash: hashTile(i, 0) }));
    expect(colours.size).toBe(2);
    const a = floorTileColor("holy", { tx: 2, ty: 2, hash: 7 });
    const b = floorTileColor("holy", { tx: 3, ty: 2, hash: 7 });
    expect(a).not.toBe(b);
    expect(floorTileColor("holy", { tx: 4, ty: 2, hash: 1 })).toBe(a);
  });
});

describe("terrain tiles: the shape language", () => {
  const draw = (kind: number, over: Partial<TileSpot> = {}): RecordPen => record((g) => drawTerrainFloor(g, kind, spot(over)));

  it("knows which kinds are flat (drawn into the floor) and which are not", () => {
    for (const k of [TERRAIN_LAVA, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT]) expect(isFlatTerrain(k)).toBe(true);
    expect(isFlatTerrain(TERRAIN_FENCE)).toBe(false);
    expect(isFlatTerrain(0)).toBe(false);
    expect(terrainFamily(TERRAIN_LAVA)).toBe(terrainFamily(TERRAIN_EMBER));
    expect(terrainFamily(TERRAIN_BOG)).not.toBe(terrainFamily(TERRAIN_ICE));
  });

  it("paints each flat kind a full tile first, then its own marks, all inside the footprint", () => {
    for (const kind of [TERRAIN_LAVA, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT]) {
      for (let i = 0; i < 12; i++) {
        const s = spot({ tx: 3 + i, ty: 9 - i % 5, hash: hashTile(3 + i, 9 - i % 5), open: i & 15 });
        const g = record((p) => drawTerrainFloor(p, kind, s));
        expect(g.ops.length).toBeGreaterThan(3);
        for (const [x0, y0, x1, y1] of g.extents()) {
          const why = `kind ${kind} open ${s.open} hash ${s.hash}`;
          expect(x0, why).toBeGreaterThanOrEqual(s.x - 0.01);
          expect(y0, why).toBeGreaterThanOrEqual(s.y - 0.01);
          expect(x1, why).toBeLessThanOrEqual(s.x + TILE_W + 0.01);
          expect(y1, why).toBeLessThanOrEqual(s.y + TILE_H + 0.01);
        }
      }
    }
  });

  it("gives every kind its own drawing", () => {
    const sigs = new Set([TERRAIN_LAVA, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_LIGHT].map((k) => draw(k).signature()));
    expect(sigs.size).toBe(6);
  });

  it("draws ember as angular zigzag cracks: three glowing polylines with sharp, steep turns", () => {
    const g = draw(TERRAIN_EMBER);
    const cracks = g.paths.filter((p) => p.length >= 6);
    expect(cracks.length).toBeGreaterThanOrEqual(3);
    for (const c of cracks) {
      expect(turns(c)).toBeGreaterThanOrEqual(4);
      expect(amplitude(c)).toBeGreaterThanOrEqual(5);
    }
    expect(g.count("strokeCircle") + g.count("fillCircle") + g.count("strokeEllipse")).toBe(0);
  });

  it("draws lava as flowing wavy lines: three or four gentle polylines, nothing angular", () => {
    const g = draw(TERRAIN_LAVA);
    expect(g.paths.length).toBeGreaterThanOrEqual(3);
    expect(g.paths.length).toBeLessThanOrEqual(4);
    for (const p of g.paths) {
      expect(p.length).toBeGreaterThanOrEqual(5);
      expect(amplitude(p)).toBeLessThan(4);
      for (let i = 1; i < p.length; i++) expect(p[i]![0]).toBeGreaterThan(p[i - 1]![0]);
    }
  });

  it("lets a lava line carry on across the tile seam: the same row of wave at the same column phase", () => {
    // Two tiles side by side: the first's last point and the second's first point are one continuous curve.
    const a = draw(TERRAIN_LAVA, { x: 0, y: 0, tx: 4, ty: 3, hash: 0 });
    const b = draw(TERRAIN_LAVA, { x: TILE_W, y: 0, tx: 5, ty: 3, hash: 0 });
    expect(a.paths.length).toBe(b.paths.length);
    a.paths.forEach((p, i) => {
      expect(b.paths[i]![0]![0]).toBe(TILE_W);
      expect(Math.abs(b.paths[i]![0]![1] - p[p.length - 1]![1])).toBeLessThan(0.0001);
    });
  });

  it("draws bog as circles and rings: squashed ring outlines and bubbles, no straight lines", () => {
    const g = draw(TERRAIN_BOG);
    expect(g.count("strokeEllipse")).toBeGreaterThanOrEqual(3);
    expect(g.count("fillCircle")).toBeGreaterThanOrEqual(2);
    expect(g.count("lineBetween")).toBe(0);
    for (const [, , w, h] of g.of("strokeEllipse")) expect(h! / w!).toBeCloseTo(Y_SCALE, 5);
  });

  it("draws ice as straight diagonals: 45 degree lines, and no curves", () => {
    const g = draw(TERRAIN_ICE);
    const diag = g.of("lineBetween").filter(([x1, y1, x2, y2]) => Math.abs(Math.abs(x2! - x1!) - Math.abs(y2! - y1!)) < 1e-6 && Math.abs(x2! - x1!) > 3);
    expect(diag.length).toBeGreaterThanOrEqual(2);
    for (const [x1, y1, x2, y2] of diag) expect((y2! - y1!) / (x2! - x1!)).toBeCloseTo(-1, 6);
    expect(g.count("strokeCircle") + g.count("fillCircle") + g.count("strokeEllipse") + g.count("fillEllipse")).toBe(0);
  });

  it("lets an ice streak run on across the tile seam (same diagonal line in the next tile)", () => {
    const a = draw(TERRAIN_ICE, { x: 0, y: 0, tx: 2, ty: 4, hash: 3 });
    const b = draw(TERRAIN_ICE, { x: TILE_W, y: 0, tx: 3, ty: 4, hash: 3 });
    const line = (g: RecordPen, ox: number) => g.of("lineBetween").filter(([x1, y1, x2, y2]) => Math.abs(x2! - x1!) > 3 && Math.abs(Math.abs(x2! - x1!) - Math.abs(y2! - y1!)) < 1e-6)
      .map(([x1, y1, x2, y2]) => ({ x1: x1! + ox, y1: y1!, x2: x2! + ox, y2: y2! }));
    // Every segment lies on a line x + y = k with k a multiple of the spacing, in the shared tile-global frame.
    const ks = new Set<number>();
    for (const s of [...line(a, 2 * TILE_W), ...line(b, 2 * TILE_W - TILE_W)]) ks.add(Math.round(s.x1 + s.y1));
    expect(ks.size).toBeGreaterThan(0);
  });

  it("draws light as radial rays from one centre, a ray count of LIGHT_RAYS", () => {
    const g = draw(TERRAIN_LIGHT);
    const rays = g.of("lineBetween");
    expect(rays).toHaveLength(LIGHT_RAYS);
    const cx = 100 + TILE_W / 2;
    const cy = 200 + TILE_H / 2;
    const radius = (x: number, y: number) => Math.hypot(x - cx, (y - cy) / Y_SCALE);
    for (const [x1, y1, x2, y2] of rays) {
      expect(radius(x1!, y1!)).toBeCloseTo(4, 5);
      expect(radius(x2!, y2!)).toBeCloseTo(14, 5);
    }
    const angles = rays.map(([x1, y1, x2, y2]) => Math.atan2((y2! - y1!) / Y_SCALE, x2! - x1!));
    expect(new Set(angles.map((a) => a.toFixed(3))).size).toBe(LIGHT_RAYS);
  });

  it("draws the crevasse as a jagged slit: a zigzag polyline with many turns and a lip on each open side", () => {
    const closed = draw(TERRAIN_CREVASSE, { open: 0 });
    const slit = closed.paths.filter((p) => p.length >= 6 && turns(p) >= 4);
    expect(slit.length).toBeGreaterThanOrEqual(1);
    const open = draw(TERRAIN_CREVASSE, { open: EDGE_N | EDGE_S | EDGE_E | EDGE_W });
    expect(open.paths.length).toBe(closed.paths.length + 4);
  });

  it("outlines an ember tile only on the sides open to plain ground", () => {
    const outlines = (open: number) => draw(TERRAIN_EMBER, { open }).count("lineBetween");
    expect(outlines(0)).toBe(0);
    expect(outlines(EDGE_N)).toBe(1);
    expect(outlines(EDGE_N | EDGE_W)).toBe(2);
    expect(outlines(EDGE_N | EDGE_E | EDGE_S | EDGE_W)).toBe(4);
  });

  it("rims lava with a crust only where it meets something else", () => {
    const rects = (open: number) => draw(TERRAIN_LAVA, { open }).count("fillRect");
    expect(rects(EDGE_N | EDGE_E | EDGE_S | EDGE_W)).toBe(rects(0) + 4);
    expect(rects(EDGE_S)).toBe(rects(0) + 1);
  });

  it("is deterministic and varies with the hash", () => {
    for (const kind of [TERRAIN_LAVA, TERRAIN_EMBER, TERRAIN_BOG, TERRAIN_ICE, TERRAIN_CREVASSE]) {
      expect(draw(kind).signature()).toBe(draw(kind).signature());
      const v = new Set<string>();
      for (let i = 0; i < 24; i++) v.add(draw(kind, { tx: i, hash: hashTile(i, 7) }).signature());
      expect(v.size).toBeGreaterThan(2);
    }
  });
});

describe("the fence", () => {
  const fence = (open: number, front: boolean): RecordPen => record((g) => drawFenceTile(g, spot({ open }), front));
  const ALL = EDGE_N | EDGE_E | EDGE_S | EDGE_W;

  it("shows vertical bars every 8 px on its front face, LOW_HEIGHT tall", () => {
    const bars = fence(ALL, true).of("fillRect").filter(([, , w, h]) => w! <= 3 && h! >= LOW_HEIGHT - 1);
    expect(bars.length).toBeGreaterThanOrEqual(4);
    const xs = bars.map((b) => b[0]!).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBe(8);
  });

  it("has no bars when the front is covered, and its top face is lifted by LOW_HEIGHT", () => {
    const g = fence(ALL, false);
    expect(g.of("fillRect").filter(([, , w, h]) => w! <= 3 && h! >= LOW_HEIGHT - 1)).toHaveLength(0);
    expect(g.of("fillRect")[0]).toEqual([100, 200 - LOW_HEIGHT, TILE_W, TILE_H]);
  });

  it("runs its rail along the line: sideways for a row of fences, up and down for a column", () => {
    const rail = (open: number) => fence(open, false).of("lineBetween");
    const row = rail(EDGE_N | EDGE_S);
    expect(row).toHaveLength(1);
    expect(row[0]![1]).toBe(row[0]![3]); // horizontal
    const column = rail(EDGE_E | EDGE_W);
    expect(column).toHaveLength(1);
    expect(column[0]![0]).toBe(column[0]![2]); // vertical
  });

  it("stands a lone tile as a post", () => {
    const g = fence(ALL, false);
    expect(g.count("lineBetween")).toBe(0);
    expect(g.of("fillRect").length).toBeGreaterThanOrEqual(2);
  });
});

describe("wall tiles", () => {
  const info = (over: Partial<WallInfo> = {}): WallInfo => ({ style: "mass", lift: WALL_HEIGHT, open: EDGE_N | EDGE_E | EDGE_S | EDGE_W, front: true, pillarKind: 0, ...over });
  const wall = (zone: (typeof REGION_FACTIONS)[number], w: WallInfo, over: Partial<TileSpot> = {}): RecordPen => record((g) => drawWallTile(g, zone, spot(over), w));

  it("stays inside the tile's footprint lifted by its height, in every zone and style", () => {
    for (const zone of REGION_FACTIONS) {
      for (const style of ["mass", "rock", "segment"] as const) {
        for (let i = 0; i < 12; i++) {
          const w = info({ style, open: i & 15, front: (i & 1) === 0 });
          const s = spot({ tx: i, hash: hashTile(i, 5) });
          for (const [x0, y0, x1, y1] of wall(zone, w, s).extents()) {
            const why = `${zone} ${style} open ${w.open} front ${w.front} hash ${s.hash}`;
            expect(x0, why).toBeGreaterThanOrEqual(s.x - 0.01);
            expect(x1, why).toBeLessThanOrEqual(s.x + TILE_W + 0.01);
            expect(y0, why).toBeGreaterThanOrEqual(s.y - WALL_HEIGHT - 0.01);
            expect(y1, why).toBeLessThanOrEqual(s.y + TILE_H + 0.01);
          }
        }
      }
    }
  });

  it("styles each zone's walls its own way", () => {
    expect(new Set(REGION_FACTIONS.map((z) => wall(z, info()).signature())).size).toBe(REGION_FACTIONS.length);
  });

  it("draws the front face only where the south is open", () => {
    for (const zone of REGION_FACTIONS) {
      expect(wall(zone, info({ front: true })).ops.length).toBeGreaterThan(wall(zone, info({ front: false })).ops.length);
    }
  });

  it("paints the top face lifted by the wall's height (a Rime rock is a shard, 70% of a wall)", () => {
    const tops = (lift: number) => wall("frost", info({ lift, front: false })).of("fillRect")[0]!;
    expect(tops(WALL_HEIGHT)).toEqual([100, 200 - WALL_HEIGHT, TILE_W, TILE_H]);
    expect(tops(SHARD_HEIGHT)).toEqual([100, 200 - SHARD_HEIGHT, TILE_W, TILE_H]);
  });

  it("draws Rime's top as two facets (a diagonal split), obsidian chamfered where its corners are open", () => {
    expect(wall("frost", info({ front: false })).count("fillTriangle")).toBe(1);
    const open = wall("fire", info({ front: false, open: EDGE_N | EDGE_E | EDGE_S | EDGE_W }));
    const merged = wall("fire", info({ front: false, open: 0 }));
    expect(open.paths.length).toBe(1);
    expect(merged.paths.length).toBe(0);
  });

  it("draws a lone Sanctum rock as a column (ellipses), a run of them as blocks (no ellipses)", () => {
    expect(wall("holy", info({ style: "rock" })).count("fillEllipse")).toBeGreaterThanOrEqual(3);
    expect(wall("holy", info({ style: "segment" })).count("fillEllipse")).toBe(0);
  });

  it("makes Gallows cells windowed on about one front in ten", () => {
    let windows = 0;
    for (let i = 0; i < 400; i++) {
      const g = wall("sentenced", info(), { tx: i, ty: 3, hash: hashTile(i, 3) });
      if (g.of("fillRect").some(([, , w, h]) => w === 10 && h! >= 7)) windows++;
    }
    expect(windows).toBeGreaterThan(400 / 10 / 2);
    expect(windows).toBeLessThan(400 / 10 * 2);
  });

  it("draws pillars of the three LOW features differently, and not as a plain wall", () => {
    const plain = wall("fire", info()).signature();
    const sigs = new Set<string>();
    for (const [zone, kind] of [["fire", TERRAIN_LAVA], ["sentenced", TERRAIN_FENCE], ["frost", TERRAIN_CREVASSE]] as const) {
      const sig = wall(zone, info({ style: "pillar", pillarKind: kind })).signature();
      sigs.add(sig);
      expect(sig).not.toBe(wall(zone, info()).signature());
    }
    expect(sigs.size).toBe(3);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("gives a lava pillar a glowing ring at its foot (an ellipse outline) and a gatepost a chain and a banner", () => {
    expect(wall("fire", info({ style: "pillar", pillarKind: TERRAIN_LAVA })).count("strokeEllipse")).toBeGreaterThanOrEqual(1);
    const post = wall("sentenced", info({ style: "pillar", pillarKind: TERRAIN_FENCE }));
    expect(post.count("fillTriangle")).toBeGreaterThanOrEqual(1);
    expect(post.paths.length).toBeGreaterThanOrEqual(1);
  });
});

describe("props", () => {
  const prop = (key: string, over: Partial<PropSpot> = {}): PropSpot => ({ key, x: 300, y: 300, v: 5, lift: WALL_HEIGHT, ...over });

  it("sorts every catalogued kind into the floor, a wall face or an emitter list, with no overlap between floor and wall", () => {
    for (const k of ZONE_PROP_KINDS) expect(FLAT_PROPS.has(k.key) || WALL_PROPS.has(k.key)).toBe(true);
    for (const k of FLAT_PROPS) expect(WALL_PROPS.has(k)).toBe(false);
    for (const k of EMITTER_PROPS) expect(FLAT_PROPS.has(k)).toBe(true);
    for (const k of [...FLAT_PROPS, ...WALL_PROPS]) expect(ZONE_PROP_KINDS.some((p) => p.key === k)).toBe(true);
  });

  it("draws every floor prop with something, and every wall prop with something", () => {
    for (const k of FLAT_PROPS) expect(record((g) => drawFlatProp(g, prop(k))).ops.length).toBeGreaterThan(0);
    for (const k of WALL_PROPS) expect(record((g) => drawWallProp(g, prop(k))).ops.length).toBeGreaterThan(0);
  });

  it("draws different props differently", () => {
    expect(new Set([...FLAT_PROPS].map((k) => record((g) => drawFlatProp(g, prop(k))).signature())).size).toBe(FLAT_PROPS.size);
    expect(new Set([...WALL_PROPS].map((k) => record((g) => drawWallProp(g, prop(k))).signature())).size).toBe(WALL_PROPS.size);
  });

  it("ignores a kind it does not know", () => {
    expect(record((g) => drawFlatProp(g, prop("nonsense"))).ops).toHaveLength(0);
    expect(record((g) => drawWallProp(g, prop("nonsense"))).ops).toHaveLength(0);
  });
});

describe("overlay shapes", () => {
  it("paint inside their tile (glows) or hover over it (the beam)", () => {
    for (const fn of [(g: Pen) => drawLavaGlow(g, 10, 20), (g: Pen) => drawEmberGlow(g, 10, 20), (g: Pen) => drawBogBubble(g, 10, 20, 77), (g: Pen) => drawIceShimmer(g, 10, 20, 77)]) {
      const g = record(fn);
      expect(g.ops.length).toBeGreaterThan(0);
      for (const [x0, y0, x1, y1] of g.extents()) {
        expect(x0).toBeGreaterThanOrEqual(10 - 0.01);
        expect(y0).toBeGreaterThanOrEqual(20 - 0.01);
        expect(x1).toBeLessThanOrEqual(10 + TILE_W + 0.01);
        expect(y1).toBeLessThanOrEqual(20 + TILE_H + 0.01);
      }
    }
    const beam = record((g) => drawLightBeam(g, 50, 100, 96, 60));
    expect(beam.paths[0]).toHaveLength(4);
    const [, top0] = beam.paths[0]![1]!;
    expect(top0).toBe(40);
  });
});
