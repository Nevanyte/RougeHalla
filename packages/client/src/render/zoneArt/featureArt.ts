// The map's named features as the art sees them (zone-shapes contract 7.5): which look every owned tile takes, from
// `map.features` and `map.featureGrid` and nothing else. The client regenerates the map itself from (seed, attempt), so the
// features are the same on both sides and the art never infers a shape from tiles. Pure and free of Phaser; bake.ts plans it once
// per map (`makeContext`), and a map with no features gets all-zero layers, which paint exactly as the map did before features.
//
//   wall tile   crater  -> rim       (lip lit toward the camp, `shape` = the camp's centre and the rim's radius)
//               barrow  -> mound     (rounded top, moss; `shape` = the disc)
//               hall    -> pier      (a 3x3 column with a capital)
//               landmark -> forge | guardHouse | burrow | watchtower | shrine   (masonry per design, `variant`)
//               headland, spire -> shard   (a facet at SHARD_HEIGHT)
//               gallows -> gallows   (timber)
//               fenceRow, lavaRiver, infill and the rest -> plain
//   floor tile  crater  -> bowl      (the ash ring)
//               barrow  -> tunnel    (the shadowed slot: only the floor the barrow owns and no surface kind covers)
//               hall    -> hall      (aisle paving)
//               mere    -> shore     (owned lake floor with no ice on it)
//               causeway -> causeway (packed snow)
//               landmark -> its design's interior floor, and `door` on the doorway tiles of `p`
//               lavaRiver -> ford    (the bank tiles round each ford centre of `p`)
import {
  TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_WALL, type CampDef, type GameMap, type MapFeature,
} from "@raid/shared";
import type { FloorLook, MasonryLook, WallLook } from "./artBase";

/** The looks in code order: the layers hold the index. */
export const WALL_LOOKS: readonly WallLook[] = ["plain", "rim", "mound", "pier", "forge", "guardHouse", "burrow", "watchtower", "shrine", "shard", "gallows"];
export const FLOOR_LOOKS: readonly FloorLook[] = ["plain", "bowl", "tunnel", "hall", "shore", "causeway", "forge", "guardHouse", "burrow", "watchtower", "shrine", "door", "ford"];

const WALL_CODE = Object.fromEntries(WALL_LOOKS.map((l, i) => [l, i])) as Readonly<Record<WallLook, number>>;
const FLOOR_CODE = Object.fromEntries(FLOOR_LOOKS.map((l, i) => [l, i])) as Readonly<Record<FloorLook, number>>;

export const wallLookCode = (look: WallLook): number => WALL_CODE[look];
export const floorLookCode = (look: FloorLook): number => FLOOR_CODE[look];

/** The landmark designs the art knows (anything else is a plain building). */
export function masonryOf(variant: string): MasonryLook | null {
  return variant === "forge" || variant === "guardHouse" || variant === "burrow" || variant === "watchtower" || variant === "shrine" ? variant : null;
}

/** The wall look of a feature's walls. */
export function wallLookOf(f: Pick<MapFeature, "kind" | "variant">): WallLook {
  switch (f.kind) {
    case "crater": return "rim";
    case "barrow": return "mound";
    case "hall": return "pier";
    case "headland":
    case "spire": return "shard";
    case "gallows": return "gallows";
    case "landmark": return masonryOf(f.variant) ?? "plain";
    default: return "plain";
  }
}

/** The floor look of a feature's owned floor (the doorway and ford tiles are marked on top of it). */
export function floorLookOf(f: Pick<MapFeature, "kind" | "variant">): FloorLook {
  switch (f.kind) {
    case "crater": return "bowl";
    case "barrow": return "tunnel";
    case "hall": return "hall";
    case "mere": return "shore";
    case "causeway": return "causeway";
    case "landmark": return masonryOf(f.variant) ?? "plain";
    default: return "plain";
  }
}

/** Where a feature's shading is centred, in tile units (a tile centre is x + 0.5), and how far it reaches in tiles. */
export interface FeatureShape { cx: number; cy: number; r: number }

/** A crater's camp: `p[0]` names it (an index into `map.camps`); the anchor is the camp's tile when it does not. */
function craterCentre(map: GameMap, f: MapFeature): FeatureShape {
  const camp: CampDef | undefined = map.camps[f.p[0] ?? -1];
  const r = (f.p[1] ?? 24) / 4;
  return camp ? { cx: camp.x / TILE, cy: camp.y / TILE, r } : { cx: f.ax + 0.5, cy: f.ay + 0.5, r };
}

export function shapeOf(map: GameMap, f: MapFeature): FeatureShape {
  if (f.kind === "crater") return craterCentre(map, f);
  // A barrow's anchor is its disc's centre tile and p[0] the radius in quarter tiles; its box also holds the bog flank, so it is not the disc's.
  if (f.kind === "barrow" && (f.p[0] ?? 0) > 0) return { cx: f.ax + 0.5, cy: f.ay + 0.5, r: f.p[0]! / 4 };
  const b = f.bbox;
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.max(b.w, b.h) / 2 };
}

export interface FeatureLooks {
  /** WALL_LOOKS index per tile, for wall tiles a feature owns (0 elsewhere). */
  wall: Uint8Array;
  /** FLOOR_LOOKS index per tile, for floor tiles a feature owns or marks (0 elsewhere). */
  floor: Uint8Array;
  /** Per feature, in `map.features` order. */
  shapes: FeatureShape[];
}

/** The looks of a map's features. A map with none (or a hand-built one) gets zeros. */
export function planFeatureLooks(map: GameMap): FeatureLooks {
  const n = map.w * map.h;
  const wall = new Uint8Array(n);
  const floor = new Uint8Array(n);
  const shapes = map.features.map((f) => shapeOf(map, f));
  if (map.features.length === 0 || map.featureGrid.length !== n) return { wall, floor, shapes };
  const wallOf = map.features.map((f) => WALL_CODE[wallLookOf(f)]);
  const floorOf = map.features.map((f) => FLOOR_CODE[floorLookOf(f)]);
  const { tiles, terrain, featureGrid } = map;
  for (let i = 0; i < n; i++) {
    const g = featureGrid[i]!;
    if (g === 0) continue;
    const t = tiles[i];
    if (t === TILE_WALL) wall[i] = wallOf[g - 1] ?? 0;
    else if (t === TILE_FLOOR) floor[i] = floorOf[g - 1] ?? 0;
  }
  const mark = (i: number, look: FloorLook): void => {
    if (i >= 0 && i < n && tiles[i] === TILE_FLOOR) floor[i] = FLOOR_CODE[look];
  };
  map.features.forEach((f) => {
    if (f.kind === "landmark") for (let k = 2; k < f.p.length; k++) mark(f.p[k]!, "door");
    else if (f.kind === "lavaRiver") {
      // Slabs on the bank tiles within two of each ford's centre that touch the lava.
      for (let k = 2; k < f.p.length; k++) {
        const c = f.p[k]!;
        const cx = c % map.w, cy = (c - cx) / map.w;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = cx + dx, y = cy + dy;
            if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1 || tiles[y * map.w + x] !== TILE_FLOOR) continue;
            let lava = false;
            for (let oy = -1; oy <= 1 && !lava; oy++) for (let ox = -1; ox <= 1; ox++) if (terrain[(y + oy) * map.w + x + ox] === TERRAIN_LAVA) { lava = true; break; }
            if (lava) mark(y * map.w + x, "ford");
          }
        }
      }
    }
  });
  return { wall, floor, shapes };
}
