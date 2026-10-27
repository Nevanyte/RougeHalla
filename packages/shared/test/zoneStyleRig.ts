// A runtime on an ASCII grid, for the guard and kit tests. Legend:
//   #  wall outside the zone (the border)      .  floor of the zone       ,  floor of the zone, protected (hard)
//   o  floor of ANOTHER zone                   W  wall inside the zone    F  LOW fence      V  LOW lava      i  ICE floor
import { expect } from "vitest";
import { TILE_LOW, TILE_WALL } from "../src/map";
import { TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA } from "../src/terrain";
import type { PropKindSpec } from "../src/terrain";
import { ZONE_STYLE_CAPS } from "../src/zoneStyle";
import type { ShapeCtx, StyleCaps, SurfaceCtx } from "../src/zoneStyle";
import { makeScratch, shapeCtx, surfaceCtx, ZoneRuntime, zoneInfoOf } from "../src/zoneStyle/context";
import { chamfer } from "../src/zoneStyle/kit";

export interface Rig {
  rt: ZoneRuntime;
  shape: ShapeCtx;
  surf: SurfaceCtx;
  tiles: Uint8Array;
  terrain: Uint8Array;
  w: number;
  h: number;
  at: (x: number, y: number) => number;
}

/** Builds a runtime on an ASCII grid. `territory` rows of digits, when given, are the territory grid. */
export function rig(rows: string[], opts: { caps?: Partial<StyleCaps>; territory?: string[]; noBlock?: Record<string, number>; propKinds?: readonly PropKindSpec[] } = {}): Rig {
  const h = rows.length, w = rows[0].length;
  const n = w * h;
  const tiles = new Uint8Array(n), terrain = new Uint8Array(n), mask = new Uint8Array(n), hard = new Uint8Array(n);
  rows.forEach((row, y) => {
    expect(row.length).toBe(w);
    [...row].forEach((ch, x) => {
      const i = y * w + x;
      if (ch === "#") tiles[i] = TILE_WALL;
      else if (ch === "W") { tiles[i] = TILE_WALL; mask[i] = 1; }
      else if (ch === "F") { tiles[i] = TILE_LOW; terrain[i] = TERRAIN_FENCE; mask[i] = 1; }
      else if (ch === "V") { tiles[i] = TILE_LOW; terrain[i] = TERRAIN_LAVA; mask[i] = 1; }
      else if (ch === "o") { /* floor of another zone */ }
      else { mask[i] = 1; if (ch === ",") hard[i] = 1; if (ch === "i") terrain[i] = TERRAIN_ICE; }
    });
  });
  const territory = opts.territory ? Uint8Array.from(opts.territory.join("").split("").map(Number)) : null;
  // no rim, no budget, and the detour caps off unless a test asks for them
  const caps: StyleCaps = { ...ZONE_STYLE_CAPS, rimTiles: 0, footprintPct: 100, fenceDetour: 1000, wallDetour: 1000, ...opts.caps };
  const edgeDist = chamfer(mask, w, h);
  const info = zoneInfoOf(1, "fire", mask, tiles, edgeDist, w, h);
  const noBlock = hard.slice();
  const rt = new ZoneRuntime({
    w, h, seed: 1, attempt: 0, info, mask, hard, noBlock, noProp: hard, tiles, terrain, props: [], edgeDist, territory, camps: [], caps,
    scratch: makeScratch(n), wrote: new Uint8Array(n), propKinds: opts.propKinds ?? [],
  });
  return { rt, shape: shapeCtx(rt), surf: surfaceCtx(rt), tiles, terrain, w, h, at: (x, y) => y * w + x };
}

