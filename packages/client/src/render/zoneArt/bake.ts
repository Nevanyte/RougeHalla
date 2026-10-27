// Bakes a styled map's ground and walls into textures once (part D 7.1). At 136x136 the old way (about 100 Graphics objects that
// Phaser replays every frame, with richer art on top) is the budget risk; this paints the art once and the scene then draws a few
// hundred images (about 650-750 strips and 81 floor chunks, under the 1200 scene children the plan allows):
//   * floor chunks: 16x16 tiles each, one texture per chunk (the zone floor, terrain tiles, flat props, the landmarks' shade, the
//     feature floors: a crater's ash bowl, a tunnel, the hall's paving, a shore, a landmark's interior);
//   * wall strips: one image per tile row and chunk column holding a wall or a fence (trimmed to the tiles it covers), packed into
//     a few atlas pages so the images share a texture. Each strip sits at the depth of its row's south edge, so fighters y-sort
//     against walls as they did before. A wall that belongs to a named feature (crater rim, barrow mound, pier, landmark masonry,
//     headland shard) is dressed by its look (featureArt.ts, featureStyle.ts) on the same footprint and faces, so the seams below hold.
//   * seams: a wall several rows tall is one strip per row, and a wall wider than a chunk is one strip per chunk column, so their
//     faces meet between Images. A wall tile's art is drawn through a SnapPen (every edge on a texel line), a top face reaches one
//     texel into the wall row under it (or the part of a front face a lower wall leaves open), and a strip that ends at a chunk edge
//     against another wall carries one texel of that wall's first column; see "seams" below.
// The plan (which chunks, which strips, where) is pure and tested; only `bakeZoneArt` touches Phaser. Phaser 4 draws into a texture
// through a command buffer: `texture.draw(graphics)` then `texture.render()`.
import Phaser from "phaser";
import {
  REGION_IDS, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_ICE, TERRAIN_LAVA, TILE, TILE_FLOOR, TILE_LOW, TILE_WALL, Y_SCALE,
  ZONE_PROP_KINDS,
  type GameMap, type MapProp,
} from "@raid/shared";
import { depthFor } from "../projection";
import { planProps } from "./propsView";
import { FLOOR_LOOKS, WALL_LOOKS, planFeatureLooks, type FeatureLooks } from "./featureArt";
import { drawFloorLook, type FloorSpot } from "./featureStyle";
import { NEUTRAL_PALETTE, ZONE_PALETTE, isZoneKey, type ZoneKey } from "./palette";
import {
  EDGE_E, EDGE_N, EDGE_S, EDGE_W, FLAT_PROPS, LOW_HEIGHT, SHARD_HEIGHT, TILE_H, TILE_W, WALL_HEIGHT, WALL_PROPS,
  drawFenceTile, drawFlatProp, drawFloorTile, drawTerrainFloor, drawWallProp, drawWallTile, hashTile, isFlatTerrain, terrainFamily,
  type Pen, type PropSpot, type TileSpot, type WallInfo, type WallLook, type WallStyle,
} from "./zoneStyle";

/** Tiles per floor chunk side. */
export const CHUNK_TILES = 16;
/** Atlas page width in pixels (a texture size every GPU takes) and the most shelves of strips on one page. */
export const PAGE_W = 2048;
export const PAGE_MAX_H = 2048;
/** Empty pixels around a packed strip, so a bilinear read at a fractional zoom never picks up its neighbour. */
export const STRIP_PAD = 2;

export const DEPTH_FLOOR = -1e6;
/** Animated floor overlays (lava glow, ember flicker, bog bubbles, ice shimmer): over the floor, under the gate mark. */
export const DEPTH_FLOOR_FX = -9e5;

// ------------------------------------------------------------------------------------------------------------------ plan: tiles

/** Whether a map has zone art to bake: a generated map (it has regions) that carries terrain, props or named features (a net's infill is no art). */
export function hasZoneArt(map: GameMap): boolean {
  if (map.regions.length === 0) return false;
  if (map.props.length > 0) return true;
  if (map.features.some((f) => f.kind !== "infill")) return true;
  const t = map.terrain;
  for (let i = 0; i < t.length; i++) if (t[i] !== 0) return true;
  return false;
}

const ZONE_BY_CODE: ReadonlyArray<ZoneKey | null> = REGION_IDS.map((id) => (isZoneKey(id) ? id : null));

/**
 * The zone each tile is drawn as: its own faction region, or, for a wall in no region (the border ring, the ridges between zones),
 * the nearest faction region within 4 tiles; null where nothing themed is near (the coliseum, a hand-built map).
 */
export function zoneGrid(map: GameMap): Array<ZoneKey | null> {
  const { w, h, regionGrid } = map;
  const out: Array<ZoneKey | null> = new Array(w * h).fill(null);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const own = ZONE_BY_CODE[regionGrid[ty * w + tx]] ?? null;
      if (own !== null || regionGrid[ty * w + tx] !== 0) {
        out[ty * w + tx] = own;
        continue;
      }
      let found: ZoneKey | null = null;
      for (let r = 1; r <= 4 && found === null; r++) {
        for (let dy = -r; dy <= r && found === null; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const z = ZONE_BY_CODE[regionGrid[ny * w + nx]];
            if (z) { found = z; break; }
          }
        }
      }
      out[ty * w + tx] = found;
    }
  }
  return out;
}

export const WS_NONE = 0;
export const WS_MASS = 1;
export const WS_ROCK = 2;
export const WS_SEGMENT = 3;
export const WS_PILLAR = 4;
const WS_NAMES: readonly WallStyle[] = ["mass", "mass", "rock", "segment", "pillar"];

/** A LOW feature (lava, fence, crevasse): the kinds a wall tile may keep to say it stands in one. */
function isLowKind(kind: number): boolean {
  return kind === TERRAIN_LAVA || kind === TERRAIN_FENCE || kind === TERRAIN_CREVASSE;
}

/** The map's wall at a tile, out of bounds counting as wall (as isWallTile does). */
function wallAt(map: GameMap, tx: number, ty: number): boolean {
  return tx < 0 || ty < 0 || tx >= map.w || ty >= map.h || map.tiles[ty * map.w + tx] === TILE_WALL;
}

/**
 * How each wall tile is drawn (WS_*): a pillar if it keeps a LOW kind; a lone rock when no wall touches it; a segment when it is part of
 * a straight run of three or more single stones (a thin line of stones reads as one low wall, not as stones); else
 * a mass. 0 for a tile that is not a wall.
 */
export function wallStyles(map: GameMap): Uint8Array {
  const { w, h } = map;
  const out = new Uint8Array(w * h);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const i = ty * w + tx;
      if (map.tiles[i] !== TILE_WALL) continue;
      if (isLowKind(map.terrain[i])) { out[i] = WS_PILLAR; continue; }
      const n = (wallAt(map, tx, ty - 1) ? 1 : 0) + (wallAt(map, tx + 1, ty) ? 1 : 0) + (wallAt(map, tx, ty + 1) ? 1 : 0) + (wallAt(map, tx - 1, ty) ? 1 : 0);
      out[i] = n === 0 ? WS_ROCK : WS_MASS;
    }
  }
  // Straight single-stone runs of three or more, either way (the stone's other two sides are open).
  const thinH = (tx: number, ty: number): boolean => out[ty * w + tx] !== WS_NONE && out[ty * w + tx] !== WS_PILLAR && !wallAt(map, tx, ty - 1) && !wallAt(map, tx, ty + 1);
  const thinV = (tx: number, ty: number): boolean => out[ty * w + tx] !== WS_NONE && out[ty * w + tx] !== WS_PILLAR && !wallAt(map, tx - 1, ty) && !wallAt(map, tx + 1, ty);
  const mark: number[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w;) {
      if (!thinH(tx, ty)) { tx++; continue; }
      let e = tx;
      while (e + 1 < w && thinH(e + 1, ty)) e++;
      if (e - tx + 1 >= 3) for (let k = tx; k <= e; k++) mark.push(ty * w + k);
      tx = e + 1;
    }
  }
  for (let tx = 0; tx < w; tx++) {
    for (let ty = 0; ty < h;) {
      if (!thinV(tx, ty)) { ty++; continue; }
      let e = ty;
      while (e + 1 < h && thinV(tx, e + 1)) e++;
      if (e - ty + 1 >= 3) for (let k = ty; k <= e; k++) mark.push(k * w + tx);
      ty = e + 1;
    }
  }
  for (const i of mark) out[i] = WS_SEGMENT;
  return out;
}

/** The sides of a wall tile with no wall beside them. Out of bounds is wall. */
function wallOpen(map: GameMap, tx: number, ty: number): number {
  return (wallAt(map, tx, ty - 1) ? 0 : EDGE_N) | (wallAt(map, tx + 1, ty) ? 0 : EDGE_E) | (wallAt(map, tx, ty + 1) ? 0 : EDGE_S) | (wallAt(map, tx - 1, ty) ? 0 : EDGE_W);
}

/** The kind a tile contributes to its neighbours' edges: a floor kind on floor, a LOW kind on LOW or on a pillar wall, else 0. */
function kindAt(map: GameMap, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return -1;
  const i = ty * map.w + tx;
  const tile = map.tiles[i];
  const k = map.terrain[i];
  if (tile === TILE_WALL) return isLowKind(k) ? k : 0;
  return k;
}

/** The sides where the neighbour is not the same kind of ground. Ember is one heat with lava, so an ember bank has no outline against it. */
function terrainOpen(map: GameMap, tx: number, ty: number, kind: number): number {
  const same = (k: number): boolean => (kind === TERRAIN_EMBER ? terrainFamily(k) === terrainFamily(kind) : k === kind);
  return (same(kindAt(map, tx, ty - 1)) ? 0 : EDGE_N) | (same(kindAt(map, tx + 1, ty)) ? 0 : EDGE_E) | (same(kindAt(map, tx, ty + 1)) ? 0 : EDGE_S) | (same(kindAt(map, tx - 1, ty)) ? 0 : EDGE_W);
}

/** A fence line's neighbour: a LOW tile of the fence kind (or one with no kind), or a gatepost. */
function fenceish(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  const tile = map.tiles[i];
  const k = map.terrain[i];
  if (tile === TILE_LOW) return !isFlatTerrain(k);
  return tile === TILE_WALL && k === TERRAIN_FENCE;
}

function fenceOpen(map: GameMap, tx: number, ty: number): number {
  return (fenceish(map, tx, ty - 1) ? 0 : EDGE_N) | (fenceish(map, tx + 1, ty) ? 0 : EDGE_E) | (fenceish(map, tx, ty + 1) ? 0 : EDGE_S) | (fenceish(map, tx - 1, ty) ? 0 : EDGE_W);
}

/** A LOW tile that is drawn as a raised block in a strip (a fence, or a LOW tile with no known kind), not flat into the floor. */
function isStripLow(map: GameMap, i: number): boolean {
  return map.tiles[i] === TILE_LOW && !isFlatTerrain(map.terrain[i]);
}

// ------------------------------------------------------------------------------------------------------------------ plan: textures

export interface FloorChunk {
  cx: number;
  cy: number;
  /** Tiles drawn: tx0..tx1 and ty0..ty1 INCLUSIVE (one tile of overlap into the next chunk, so no seam shows). */
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
  /** The image's top-left and size in projected pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Texture pixels per projected pixel (1, or less when the map is too big for the texture budget), and the texture's size (even). */
  scale: number;
  tw: number;
  th: number;
}

const even = (n: number): number => (n % 2 === 0 ? n : n + 1);

/** The floor chunks of a map at a texture scale. A chunk made only of plain walls is skipped (nothing shows through them). */
export function planFloor(map: GameMap, scale = 1): FloorChunk[] {
  const out: FloorChunk[] = [];
  const cols = Math.ceil(map.w / CHUNK_TILES);
  const rows = Math.ceil(map.h / CHUNK_TILES);
  const styles = wallStyles(map);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const tx0 = cx * CHUNK_TILES;
      const ty0 = cy * CHUNK_TILES;
      const tx1 = Math.min(map.w - 1, tx0 + CHUNK_TILES);
      const ty1 = Math.min(map.h - 1, ty0 + CHUNK_TILES);
      let show = false;
      for (let ty = ty0; ty < Math.min(map.h, ty0 + CHUNK_TILES) && !show; ty++) {
        for (let tx = tx0; tx < Math.min(map.w, tx0 + CHUNK_TILES); tx++) {
          const i = ty * map.w + tx;
          if (map.tiles[i] !== TILE_WALL || styles[i] === WS_PILLAR) { show = true; break; }
        }
      }
      if (!show) continue;
      const x = tx0 * TILE_W;
      const y = Math.floor(ty0 * TILE_H);
      const w = even((tx1 - tx0 + 1) * TILE_W);
      const h = even(Math.ceil((ty1 + 1) * TILE_H) - y);
      out.push({ cx, cy, tx0, ty0, tx1, ty1, x, y, w, h, scale, tw: even(Math.ceil(w * scale)), th: even(Math.ceil(h * scale)) });
    }
  }
  return out;
}

export interface StripPlan {
  /** The tile row and the tile columns it covers (inclusive). */
  ty: number;
  tx0: number;
  tx1: number;
  /**
   * The strip ends at a chunk edge against a wall of the next chunk (`wallJoinsEast`), so its frame reaches one texel past tile `tx1`
   * with that wall's first column (see "seams"): `w` is then two texels wider, the second of them empty (widths stay even).
   */
  east: boolean;
  /** The image's top-left in projected pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The footprint's top in the strip (the fractional part of the row's projected top). */
  oy: number;
  /** The depth: the row's south edge, like the wall rows before. */
  depth: number;
  /** Its place in the atlas. */
  page: number;
  px: number;
  py: number;
}

/**
 * Whether the wall tile (tx, ty) and the one east of it make a join the bake must keep opaque: both are a mass or a segment (a rock
 * has no neighbour, a pillar is a shaft inside its tile and a fence is not a wall), whatever their lifts.
 */
export function wallJoinsEast(map: GameMap, kinds: Pick<BakeContext, "styles" | "zones">, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx + 1 >= map.w || ty >= map.h) return false;
  const i = ty * map.w + tx;
  const flat = (k: number): boolean => map.tiles[k] === TILE_WALL && (kinds.styles[k] === WS_MASS || kinds.styles[k] === WS_SEGMENT);
  return flat(i) && flat(i + 1);
}

/**
 * The strips of a map: for each tile row and chunk column, the span from the first to the last tile that is a wall or a fence, if any.
 * A strip whose last tile ends its chunk against a wall of the next chunk (`wallJoinsEast`) is two texels wider, for the join's sake.
 * They are packed onto pages PAGE_W wide (at most PAGE_MAX_H tall) in shelves of one height, widest first and each into the first shelf
 * with room, which wastes only a few percent of a page; the list stays in row order. `kinds` is the wall styles and zones of
 * the map when the caller has them (a BakeContext does); otherwise they are made when the first chunk edge needs them.
 */
export function planStrips(map: GameMap, kinds?: Pick<BakeContext, "styles" | "zones">): { strips: StripPlan[]; pages: Array<{ w: number; h: number }> } {
  const strips: StripPlan[] = [];
  const cols = Math.ceil(map.w / CHUNK_TILES);
  for (let ty = 0; ty < map.h; ty++) {
    const top = Math.floor(ty * TILE_H - WALL_HEIGHT);
    const oy = ty * TILE_H - top;
    const h = even(Math.ceil(oy + TILE_H));
    for (let c = 0; c < cols; c++) {
      let a = -1, b = -1;
      for (let tx = c * CHUNK_TILES; tx < Math.min(map.w, (c + 1) * CHUNK_TILES); tx++) {
        const i = ty * map.w + tx;
        if (map.tiles[i] === TILE_WALL || isStripLow(map, i)) {
          if (a < 0) a = tx;
          b = tx;
        }
      }
      if (a < 0) continue;
      let east = false;
      if (b === (c + 1) * CHUNK_TILES - 1 && map.tiles[ty * map.w + b] === TILE_WALL) {
        kinds ??= { styles: wallStyles(map), zones: zoneGrid(map) };
        east = wallJoinsEast(map, kinds, b, ty);
      }
      strips.push({ ty, tx0: a, tx1: b, east, x: a * TILE_W, y: top, w: even((b - a + 1) * TILE_W + (east ? 1 : 0)), h, oy, depth: depthFor((ty + 1) * TILE), page: 0, px: 0, py: 0 });
    }
  }
  if (strips.length === 0) return { strips, pages: [] };

  const shelfH = strips.reduce((m, s) => Math.max(m, s.h), 0);
  const perPage = Math.max(1, Math.floor((PAGE_MAX_H - STRIP_PAD) / (shelfH + STRIP_PAD)));
  const shelves: Array<{ page: number; py: number; x: number }> = [];
  const shelvesOnPage: number[] = [];
  const order = strips.map((_, i) => i).sort((p, q) => strips[q]!.w - strips[p]!.w || p - q);
  for (const i of order) {
    const s = strips[i]!;
    let shelf = shelves.find((sh) => sh.x + s.w + STRIP_PAD <= PAGE_W);
    if (!shelf) {
      let page = shelves.length === 0 ? 0 : shelves[shelves.length - 1]!.page;
      if ((shelvesOnPage[page] ?? 0) >= perPage) page++;
      shelf = { page, py: STRIP_PAD + (shelvesOnPage[page] ?? 0) * (shelfH + STRIP_PAD), x: STRIP_PAD };
      shelvesOnPage[page] = (shelvesOnPage[page] ?? 0) + 1;
      shelves.push(shelf);
    }
    s.page = shelf.page;
    s.px = shelf.x;
    s.py = shelf.py;
    shelf.x += s.w + STRIP_PAD;
  }
  const pages = shelvesOnPage.map((n) => ({ w: PAGE_W, h: even(STRIP_PAD + n * (shelfH + STRIP_PAD)) }));
  return { strips, pages };
}

/**
 * The texture memory the zone art may take (RGBA8): 64 MB since the map grew to 136 x 136 (zone-shapes contract 7.5). The floor alone
 * is 64.9 MB at scale 1 there (81 chunks of 17 x 17 tiles, 4352 x 3482 px of picture and the overlap), 36.7 MB at 0.75, and the wall
 * pages take 10-15 MB, so a map bakes its floors at 0.75 and fits with room to spare; a bigger map bakes them lower.
 */
export const TEXTURE_BUDGET_BYTES = 64 * 1024 * 1024;
/** The scales a floor may be baked at, best first. */
export const FLOOR_SCALES: readonly number[] = [1, 0.75, 0.625, 0.5];

/**
 * The best floor scale whose chunks and the wall pages fit `budget`; the smallest if none does (walls stay at 1x: they carry the
 * silhouettes, and the floors are the quiet part of the picture).
 */
export function chooseFloorScale(map: GameMap, budget = TEXTURE_BUDGET_BYTES, kinds?: Pick<BakeContext, "styles" | "zones">): number {
  const { pages } = planStrips(map, kinds);
  for (const s of FLOOR_SCALES) if (planBytes(planFloor(map, s), pages) <= budget) return s;
  return FLOOR_SCALES[FLOOR_SCALES.length - 1]!;
}

/** Bytes the planned textures take (RGBA8). */
export function planBytes(floors: readonly FloorChunk[], pages: ReadonlyArray<{ w: number; h: number }>): number {
  let n = 0;
  for (const c of floors) n += c.tw * c.th * 4;
  for (const p of pages) n += p.w * p.h * 4;
  return n;
}

// ------------------------------------------------------------------------------------------------------------------ painting

/** What the painters need, derived once per map. */
export interface BakeContext {
  map: GameMap;
  zones: Array<ZoneKey | null>;
  styles: Uint8Array;
  /** Props by tile index, wall props only. */
  wallProps: Map<number, MapProp[]>;
  flatProps: Array<{ prop: MapProp; key: string }>;
  /** The tiles of the coliseum's gates: floor in the map and so not baked, drawn by MapView as wall rows at the exact y while closed. */
  gates: ReadonlySet<number>;
  /** The looks the map's named features give their tiles (featureArt.ts); all zero on a map with no features. */
  looks: FeatureLooks;
}

export function makeContext(map: GameMap): BakeContext {
  const plan = planProps(map);
  const gates = new Set<number>();
  for (const gate of map.coliseum.gates) for (const t of gate.tiles) gates.add(t.y * map.w + t.x);
  return { map, zones: zoneGrid(map), styles: wallStyles(map), wallProps: plan.wall, flatProps: plan.flat, gates, looks: planFeatureLooks(map) };
}

/** A zone to paint a tile with when it has none (the coliseum ring, a neutral wall): the plain grey cell stone. */
const NEUTRAL_WALL_ZONE: ZoneKey = "sentenced";

/** The hash of a tile on this map: the variants are the map's own. */
function tileSeedHash(map: GameMap, tx: number, ty: number): number {
  return hashTile(tx, ty, map.seed);
}

/** Paints one floor chunk: every tile's ground, the landmark buildings' shade, then the flat props. */
export function paintFloorChunk(g: Pen, ctx: BakeContext, c: FloorChunk): void {
  const { map, zones, looks } = ctx;
  const spot: TileSpot = { x: 0, y: 0, tx: 0, ty: 0, hash: 0, open: 0 };
  const fspot: FloorSpot = { x: 0, y: 0, tx: 0, ty: 0, hash: 0, open: 0, dist: 0, radius: 0 };
  for (let ty = c.ty0; ty <= c.ty1; ty++) {
    for (let tx = c.tx0; tx <= c.tx1; tx++) {
      const i = ty * map.w + tx;
      const zone = zones[i];
      const tile = map.tiles[i];
      const kind = map.terrain[i];
      spot.x = tx * TILE_W - c.x;
      spot.y = ty * TILE_H - c.y;
      spot.tx = tx;
      spot.ty = ty;
      spot.hash = tileSeedHash(map, tx, ty);
      spot.open = 0;
      if (tile === TILE_WALL) {
        // Under a wall: flat floor, except where a pillar stands in lava or a crevasse (the feature runs on beneath it).
        if (kind === TERRAIN_LAVA || kind === TERRAIN_CREVASSE) {
          spot.open = terrainOpen(map, tx, ty, kind);
          drawTerrainFloor(g, kind, spot);
        } else {
          g.fillStyle(zone ? ZONE_PALETTE[zone].floor : NEUTRAL_PALETTE.floor, 1).fillRect(spot.x, spot.y, TILE_W, TILE_H);
        }
        continue;
      }
      if (isFlatTerrain(kind)) {
        spot.open = terrainOpen(map, tx, ty, kind);
        drawTerrainFloor(g, kind, spot);
      } else if (zone) {
        drawFloorTile(g, zone, spot);
      } else {
        const inColiseum = REGION_IDS[map.regionGrid[i]] === "coliseum";
        g.fillStyle(inColiseum ? NEUTRAL_PALETTE.coliseumFloor : NEUTRAL_PALETTE.floor, 1).fillRect(spot.x, spot.y, TILE_W, TILE_H);
      }
      // A feature's floor: a crater's ash bowl, a tunnel, the hall's paving, a shore, a landmark's interior. A surface kind (ember, bog,
      // ice, light) keeps its own art, except under a doorway sill or a ford's slabs, which sit on whatever lies there.
      const fl = looks.floor[i]!;
      if (fl !== 0 && tile === TILE_FLOOR) {
        const look = FLOOR_LOOKS[fl]!;
        if (look === "door" || look === "ford" || !isFlatTerrain(kind)) {
          const shape = looks.shapes[map.featureGrid[i]! - 1];
          fspot.x = spot.x; fspot.y = spot.y; fspot.tx = tx; fspot.ty = ty; fspot.hash = spot.hash;
          fspot.open = look === "shore" ? sidesWhere(map, tx, ty, (nx, ny) => nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && map.terrain[ny * map.w + nx] === TERRAIN_ICE)
            : sidesWhere(map, tx, ty, (nx, ny) => wallAt(map, nx, ny));
          fspot.dist = shape ? Math.sqrt((tx + 0.5 - shape.cx) ** 2 + (ty + 0.5 - shape.cy) ** 2) : 0;
          fspot.radius = shape ? shape.r : 0;
          drawFloorLook(g, look, fspot);
        }
      }
    }
  }
  // A landmark building's box reads as indoors in every zone.
  g.fillStyle(NEUTRAL_PALETTE.indoor, NEUTRAL_PALETTE.indoorAlpha);
  for (const b of map.buildings) {
    const x0 = Math.max(b.x, c.tx0), x1 = Math.min(b.x + b.w, c.tx1 + 1);
    const y0 = Math.max(b.y, c.ty0), y1 = Math.min(b.y + b.h, c.ty1 + 1);
    if (x1 <= x0 || y1 <= y0) continue;
    g.fillRect(x0 * TILE_W - c.x, y0 * TILE_H - c.y, (x1 - x0) * TILE_W, (y1 - y0) * TILE_H);
  }
  const prop: PropSpot = { key: "", x: 0, y: 0, v: 0, lift: 0 };
  for (const { prop: p, key } of ctx.flatProps) {
    const px = p.x - c.x;
    const py = p.y * Y_SCALE - c.y;
    if (px < -16 || py < -16 || px > c.w + 16 || py > c.h + 16) continue;
    prop.key = key;
    prop.x = px;
    prop.y = py;
    prop.v = p.v;
    drawFlatProp(g, prop);
  }
}

/** The side of a tile (its 4-neighbours) bits of EDGE_* where the neighbour is `test`. */
function sidesWhere(map: GameMap, tx: number, ty: number, test: (nx: number, ny: number) => boolean): number {
  return (test(tx, ty - 1) ? EDGE_N : 0) | (test(tx + 1, ty) ? EDGE_E : 0) | (test(tx, ty + 1) ? EDGE_S : 0) | (test(tx - 1, ty) ? EDGE_W : 0);
}

/**
 * The lift of the wall tile with index `i`: a Rime rock or run of stones, and a headland's or spire's facets, are shards; a crater's
 * rim is broken (one tile in four stands lower, one in eight lower still: the jitter of its crown), everything else a full wall.
 */
function liftAt(ctx: BakeContext, i: number): number {
  const style = ctx.styles[i];
  const look = WALL_LOOKS[ctx.looks.wall[i]!] ?? "plain";
  const flat = style === WS_MASS || style === WS_SEGMENT;
  if (flat && look === "shard") return SHARD_HEIGHT;
  if (ctx.zones[i] === "frost" && (style === WS_ROCK || style === WS_SEGMENT)) return SHARD_HEIGHT;
  if (flat && look === "rim") {
    const j = hashTile(i % ctx.map.w, Math.floor(i / ctx.map.w), ctx.map.seed + 7) >>> 8 & 7;
    return j === 0 ? WALL_HEIGHT - 5 : j <= 2 ? WALL_HEIGHT - 3 : WALL_HEIGHT;
  }
  return WALL_HEIGHT;
}

/** The sides of a crater-rim tile that face the camp's centre (both, near a diagonal). */
export function inwardSides(dx: number, dy: number): number {
  const ax = Math.abs(dx), ay = Math.abs(dy), m = Math.max(ax, ay);
  if (m === 0) return 0;
  return (ax > 0.38 * m ? (dx > 0 ? EDGE_E : EDGE_W) : 0) | (ay > 0.38 * m ? (dy > 0 ? EDGE_S : EDGE_N) : 0);
}

/** The wall info of a tile: its style, lift and which sides show a face; and the feature look it wears, with what that look reads of its feature. */
export function wallInfoAt(ctx: BakeContext, tx: number, ty: number): WallInfo {
  const { map } = ctx;
  const i = ty * map.w + tx;
  const style = ctx.styles[i];
  const info: WallInfo = {
    style: WS_NAMES[style] ?? "mass",
    lift: liftAt(ctx, i),
    open: wallOpen(map, tx, ty),
    front: ty + 1 >= map.h || map.tiles[(ty + 1) * map.w + tx] !== TILE_WALL,
    pillarKind: style === WS_PILLAR ? map.terrain[i] : 0,
  };
  // A feature look dresses a mass or a run of stones; a lone rock and a pillar keep their own art (and the seams never join them).
  const code = ctx.looks.wall[i]!;
  if (code !== 0 && (style === WS_MASS || style === WS_SEGMENT)) {
    const look: WallLook = WALL_LOOKS[code]!;
    info.look = look;
    const shape = ctx.looks.shapes[map.featureGrid[i]! - 1];
    if (shape && look === "rim") info.inward = inwardSides(shape.cx - (tx + 0.5), shape.cy - (ty + 0.5));
    else if (shape && look === "mound") info.dome = Math.max(0, 1 - Math.sqrt((tx + 0.5 - shape.cx) ** 2 + (ty + 0.5 - shape.cy) ** 2) / Math.max(1, shape.r));
  }
  return info;
}

// ------------------------------------------------------------------------------------------------------------------ seams
//
// A wall several rows tall is one strip (one Image) per tile row, and the top faces of two rows meet at (ty + 1) * TILE_H - lift, a
// fractional y (TILE_H is 25.6): between two texels of the pages, which hold one texel per projected pixel. Two things then draw a
// line, 9-25 levels darker than the wall top and baked into the texture (it moves with the map, not with the camera):
//   * Each strip anti-aliases its own rectangle, so the texel the boundary falls in is covered f by the upper face and 1 - f by the
//     lower one, in two Images: they composite to 1 - f(1 - f), up to a quarter of the floor showing through.
//   * Even with the boundary on a texel line, the upper strip's frame goes on below its top face (room for the front faces of its
//     neighbours), so at a fractional camera zoom the texture filter ramps the alpha of its last row down exactly where the lower
//     strip's first row ramps up.
// So, with the walls' pages at one texel per pixel: (1) every y of a mass or segment tile's drawing is rounded to a texel line (the
// EDGES are rounded, not the sizes, so a top face's bottom, the next row's top and the front face's top are one line); (2) a top
// face reaches ONE texel into the wall row below it, which draws over the extension and so only supplies cover where the filter
// ramps. Never over a front face: where the tile below is not a wall the edge is real, and the front face starts there. (3) A closed
// gate is not baked (MapView draws it as a row of its own at the exact y, and the open gate is floor), so where a gate meets a wall
// row, the rounding must not leave a gap between the two: see closeSeams. (4) A wall tile over a LOWER wall (a mass over a Rime
// shard) has no front face, but its top face ends 4 px above the shard's: the rows between are its south face, which the shard
// leaves open. closeSeams draws their first rows (the real front art, clipped), plus one texel under the shard's first row.
// The strips of a row are also cut at every chunk column, and two Images abut at an integer x the same way (the Image's edge texels
// blend with the empty page padding under the filter: up to half the floor showing through, at the 15|16, 31|32, ... tile columns).
// (5) A strip that ends at a chunk edge against another wall carries ONE texel of that wall's first column (`copyNextColumn`: the
// next tile's art, clipped to the column by a ClipPen, so it is that texel and not an imitation of it: a facet, a rim, a front face's
// bands). The two Images overlap there, and the next one is drawn over the first (bakeZoneArt adds the images in strip order, and
// equal depths keep it), so only the half texel where the filter ramps the next Image's left edge shows the copy under it.
// Draw order is part of this. Within a row a chunk column draws over its west neighbour (above); and a lower row draws over the row
// above it (a strip's depth is its row's south edge), which is how a taller wall south of a shorter one (a mass under a shard) covers
// the shard's last 4 px with its own top face and leaves no gap, and why the step in (4) needs no more than its first rows.

/** Rounds to a texel line of the wall pages. */
const snap = (v: number): number => Math.round(v);

/** Slack for the arithmetic of the projected y, so an edge on a texel line is not read as rounded away from a neighbour. */
const SNAP_EPS = 1e-9;

type PathStep = readonly [op: "move" | "line" | "close", x: number, y: number];

/**
 * A Pen that puts what it draws on the texel grid, for the top and front faces of the walls: the edges of rectangles (rounded ones
 * too) and the corners of triangles and filled paths are rounded; a lone horizontal one pixel line, a top face's rim, keeps its
 * place half a texel inside the row its face's top edge rounds to. Strokes, circles and ellipses are details and pass as they are.
 */
export class SnapPen implements Pen {
  private lineWidth = 1;
  private path: PathStep[] | null = null;

  constructor(private readonly g: Pen) {}

  fillStyle(color: number, alpha = 1): this { this.g.fillStyle(color, alpha); return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.lineWidth = width; this.g.lineStyle(width, color, alpha); return this; }
  fillRect(x: number, y: number, w: number, h: number): this {
    const x0 = snap(x), y0 = snap(y);
    this.g.fillRect(x0, y0, snap(x + w) - x0, snap(y + h) - y0);
    return this;
  }
  strokeRect(x: number, y: number, w: number, h: number): this { this.g.strokeRect(x, y, w, h); return this; }
  fillRoundedRect(x: number, y: number, w: number, h: number, radius: number | { tl: number; tr: number; bl: number; br: number }): this {
    const x0 = snap(x), y0 = snap(y);
    this.g.fillRoundedRect(x0, y0, snap(x + w) - x0, snap(y + h) - y0, radius);
    return this;
  }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    if (y1 === y2 && this.lineWidth === 1) {
      const y = snap(y1 - 0.5) + 0.5;
      this.g.lineBetween(x1, y, x2, y);
    } else this.g.lineBetween(x1, y1, x2, y2);
    return this;
  }
  fillCircle(x: number, y: number, r: number): this { this.g.fillCircle(x, y, r); return this; }
  strokeCircle(x: number, y: number, r: number): this { this.g.strokeCircle(x, y, r); return this; }
  fillEllipse(x: number, y: number, w: number, h: number): this { this.g.fillEllipse(x, y, w, h); return this; }
  strokeEllipse(x: number, y: number, w: number, h: number): this { this.g.strokeEllipse(x, y, w, h); return this; }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    this.g.fillTriangle(snap(x1), snap(y1), snap(x2), snap(y2), snap(x3), snap(y3));
    return this;
  }
  // A path is held until it is filled (corners rounded) or stroked (as drawn): the pen cannot tell which before then.
  beginPath(): this { this.path = []; return this; }
  moveTo(x: number, y: number): this { if (this.path) this.path.push(["move", x, y]); else this.g.moveTo(x, y); return this; }
  lineTo(x: number, y: number): this { if (this.path) this.path.push(["line", x, y]); else this.g.lineTo(x, y); return this; }
  closePath(): this { if (this.path) this.path.push(["close", 0, 0]); else this.g.closePath(); return this; }
  fillPath(): this { this.flush(true); this.g.fillPath(); return this; }
  strokePath(): this { this.flush(false); this.g.strokePath(); return this; }

  private flush(rounded: boolean): void {
    const path = this.path;
    this.path = null;
    if (!path) return;
    this.g.beginPath();
    for (const [op, x, y] of path) {
      const px = rounded ? snap(x) : x;
      const py = rounded ? snap(y) : y;
      if (op === "close") this.g.closePath();
      else if (op === "move") this.g.moveTo(px, py);
      else this.g.lineTo(px, py);
    }
  }
}

type Pt = readonly [x: number, y: number];

/** The part of a polygon on one side of the axis-aligned line `p[axis] = edge` (Sutherland-Hodgman); an infinite edge keeps it all. */
function clipSide(poly: readonly Pt[], axis: 0 | 1, edge: number, keepAbove: boolean): Pt[] {
  const inside = (p: Pt): boolean => (keepAbove ? p[axis] >= edge : p[axis] <= edge);
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      out.push(axis === 0 ? [edge, a[1] + (b[1] - a[1]) * t] : [a[0] + (b[0] - a[0]) * t, edge]);
    }
  }
  return out;
}

/** The area of a polygon (shoelace). */
function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x1, y1] = poly[k]!, [x2, y2] = poly[(k + 1) % poly.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * A Pen that lets through only what falls inside the rectangle x0 <= x <= x1, y0 <= y <= y1 (infinite bounds allowed): rectangles
 * (rounded ones as plain rectangles: a wall tile's rounded corners are on open sides, not in a column of a joined wall), triangles
 * and filled paths cut to it, and horizontal and vertical lines cut to it. Strokes, circles, ellipses and slanted lines are details
 * inside a tile and are dropped. It draws a part of what a wall tile would paint: the column of a join (`copyNextColumn`) and the
 * first rows of a front face (`closeSeams`' step).
 *
 * Phaser draws no path polygon that is only one texel wide (a fill path of 10 to 11 shows nothing, and a short line likewise), and
 * the columns this pen cuts are one texel wide. So a cut shape is painted as rectangles: a line as the rectangle of its stroke, a
 * polygon that is a rectangle as a rectangle, and a thin one (a facet's edge across the column, on the texel grid) as one rectangle a
 * texel row high, its alpha scaled by the part of the texel the polygon covers. A wide polygon is a path.
 */
export class ClipPen implements Pen {
  private path: Pt[] | null = null;
  private fill: readonly [color: number, alpha: number] = [0, 1];
  private stroke: readonly [width: number, color: number, alpha: number] = [1, 0, 1];

  constructor(private readonly g: Pen, private readonly x0: number, private readonly y0: number, private readonly x1: number, private readonly y1: number) {}

  fillStyle(color: number, alpha = 1): this { this.fill = [color, alpha]; this.g.fillStyle(color, alpha); return this; }
  lineStyle(width: number, color: number, alpha = 1): this { this.stroke = [width, color, alpha]; this.g.lineStyle(width, color, alpha); return this; }
  fillRect(x: number, y: number, w: number, h: number): this { return this.paint(x, y, w, h, this.fill[0], this.fill[1]); }
  fillRoundedRect(x: number, y: number, w: number, h: number): this { return this.fillRect(x, y, w, h); }
  strokeRect(): this { return this; }
  lineBetween(x1: number, y1: number, x2: number, y2: number): this {
    const [width, color, alpha] = this.stroke;
    if (y1 === y2) return this.paint(Math.min(x1, x2), y1 - width / 2, Math.abs(x2 - x1), width, color, alpha);
    if (x1 === x2) return this.paint(x1 - width / 2, Math.min(y1, y2), width, Math.abs(y2 - y1), color, alpha);
    return this;
  }
  fillCircle(): this { return this; }
  strokeCircle(): this { return this; }
  fillEllipse(): this { return this; }
  strokeEllipse(): this { return this; }
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this {
    this.fillPolygon([[x1, y1], [x2, y2], [x3, y3]]);
    return this;
  }
  beginPath(): this { this.path = []; return this; }
  moveTo(x: number, y: number): this { this.path?.push([x, y]); return this; }
  lineTo(x: number, y: number): this { this.path?.push([x, y]); return this; }
  closePath(): this { return this; }
  fillPath(): this {
    const path = this.path;
    this.path = null;
    if (path) this.fillPolygon(path);
    return this;
  }
  strokePath(): this { this.path = null; return this; }

  /** The rectangle cut to the bounds, filled in a colour of its own; the pen's fill style is back as it was after. */
  private paint(x: number, y: number, w: number, h: number, color: number, alpha: number): this {
    const ax = Math.max(x, this.x0), bx = Math.min(x + w, this.x1);
    const ay = Math.max(y, this.y0), by = Math.min(y + h, this.y1);
    if (bx > ax && by > ay) {
      const [fc, fa] = this.fill;
      if (color !== fc || alpha !== fa) this.g.fillStyle(color, alpha);
      this.g.fillRect(ax, ay, bx - ax, by - ay);
      if (color !== fc || alpha !== fa) this.g.fillStyle(fc, fa);
    }
    return this;
  }

  private fillPolygon(poly: readonly Pt[]): void {
    let p = clipSide(poly, 0, this.x0, true);
    p = clipSide(p, 0, this.x1, false);
    p = clipSide(p, 1, this.y0, true);
    p = clipSide(p, 1, this.y1, false);
    if (p.length < 3) return;
    const area = polygonArea(p);
    if (area < 1e-6) return;
    const minX = Math.min(...p.map((q) => q[0])), maxX = Math.max(...p.map((q) => q[0]));
    const minY = Math.min(...p.map((q) => q[1])), maxY = Math.max(...p.map((q) => q[1]));
    const [color, alpha] = this.fill;
    if (Math.abs(area - (maxX - minX) * (maxY - minY)) < 1e-6) {
      this.paint(minX, minY, maxX - minX, maxY - minY, color, alpha);
    } else if (maxX - minX <= 1 + 1e-9) {
      const col = Math.floor(minX + 1e-9);
      for (let row = Math.floor(minY); row < Math.ceil(maxY); row++) {
        const covered = polygonArea(clipSide(clipSide(p, 1, row, true), 1, row + 1, false));
        if (covered > 1e-3) this.paint(col, row, 1, 1, color, alpha * Math.min(1, covered));
      }
    } else {
      this.g.beginPath().moveTo(p[0]![0], p[0]![1]);
      for (let k = 1; k < p.length; k++) this.g.lineTo(p[k]![0], p[k]![1]);
      this.g.closePath().fillPath();
    }
  }
}

/**
 * What closes the seams of a mass or segment wall tile; `spot.y` is the tile's footprint in the page. All of it is drawn after the
 * tile, on the tile's own columns.
 *   * A wall row under it (no front face) that starts at the same line: the top face reaches one texel into it. A pillar under it
 *     starts elsewhere, and the extension would be a stray line, so it gets none.
 *   * A LOWER wall row under it (a Rime shard under a mass: the top face of the shard starts `lift - below.lift` px below the
 *     mass's ends): those px are the mass's south face, which the shard leaves open, so the first rows of the front face are drawn
 *     there (the tile's own front art, clipped to them) and one texel more, under the shard's first row, for the filter's ramp. The
 *     shard's row is drawn over the rest. A TALLER row under it needs nothing: its top face starts above this one's end and covers it.
 *   * A closed gate under it (the gate row is drawn at the exact y, over this tile's front face): when its edge was rounded UP into
 *     the gate nothing is open, but rounded down the first row of the front face would show between the top face and the gate's
 *     top, a dark line, so the top face takes that row.
 *   * A closed gate above it (the gate row ends at the exact y, under this tile's top face): rounded down into the gate nothing is
 *     open; rounded up, a sliver of floor would show between them, so the top face takes the row above.
 * `g` is the page's pen (or a clip of it).
 */
function closeSeams(g: Pen, ctx: BakeContext, spot: TileSpot, info: WallInfo, zone: ZoneKey): void {
  const { map } = ctx;
  const { tx, ty } = spot;
  const top = spot.y - info.lift;
  const bottom = top + TILE_H;
  const colour = ZONE_PALETTE[zone].wallTop;
  const strip = (y: number): void => { g.fillStyle(colour, 1).fillRect(spot.x, y, TILE_W, 1); };
  if (!info.front) {
    const below = wallInfoAt(ctx, tx, ty + 1);
    if (below.style !== "pillar" && below.lift === info.lift) strip(snap(bottom));
    else if (below.style !== "pillar" && below.lift < info.lift) {
      const clip = new ClipPen(g, spot.x, snap(bottom), spot.x + TILE_W, snap(spot.y + TILE_H - below.lift) + 1);
      drawWallTile(new SnapPen(clip), zone, spot, { ...info, front: true });
    }
  } else if (ty + 1 < map.h && ctx.gates.has((ty + 1) * map.w + tx) && snap(bottom) < bottom - SNAP_EPS) {
    strip(snap(bottom));
  }
  if (ty > 0 && ctx.gates.has((ty - 1) * map.w + tx) && snap(top) > top + SNAP_EPS) strip(snap(top) - 1);
}

/**
 * The texel one past the right edge of the wall tile at `spot`, in the strip's frame: the first column of the wall tile east of it,
 * drawn the way that tile draws it (art and seams, through a SnapPen) and clipped to the column. It is for a strip that ends at a
 * chunk edge (`StripPlan.east`); the wall east of it is the next strip, whose left edge would otherwise blend with the empty page
 * padding and leave up to half the floor showing at the join.
 */
function copyNextColumn(g: Pen, ctx: BakeContext, spot: TileSpot): void {
  const { map } = ctx;
  const tx = spot.tx + 1;
  const info = wallInfoAt(ctx, tx, spot.ty);
  const zone = ctx.zones[spot.ty * map.w + tx] ?? NEUTRAL_WALL_ZONE;
  const x = spot.x + TILE_W;
  const column = new ClipPen(g, x, -Infinity, x + 1, Infinity);
  const next: TileSpot = { x, y: spot.y, tx, ty: spot.ty, hash: tileSeedHash(map, tx, spot.ty), open: info.open };
  drawWallTile(new SnapPen(column), zone, next, info);
  closeSeams(column, ctx, next, info, zone);
}

/** Paints one strip into its place on a page: `g` is the page's Graphics, the strip sits at (s.px, s.py). */
export function paintStrip(g: Pen, ctx: BakeContext, s: StripPlan): void {
  const { map } = ctx;
  const spot: TileSpot = { x: 0, y: 0, tx: 0, ty: s.ty, hash: 0, open: 0 };
  const prop: PropSpot = { key: "", x: 0, y: 0, v: 0, lift: 0 };
  const snapped = new SnapPen(g);
  for (let tx = s.tx0; tx <= s.tx1; tx++) {
    const i = s.ty * map.w + tx;
    const tile = map.tiles[i];
    if (tile !== TILE_WALL && !isStripLow(map, i)) continue;
    spot.x = s.px + (tx - s.tx0) * TILE_W;
    spot.y = s.py + s.oy;
    spot.tx = tx;
    spot.hash = tileSeedHash(map, tx, s.ty);
    let lift = LOW_HEIGHT;
    if (tile === TILE_WALL) {
      const info = wallInfoAt(ctx, tx, s.ty);
      lift = info.lift;
      spot.open = info.open;
      const zone = ctx.zones[i] ?? NEUTRAL_WALL_ZONE;
      // Rocks stand alone and pillars are shafts: only a mass or a segment has a top face that meets another row's.
      if (info.style === "mass" || info.style === "segment") {
        drawWallTile(snapped, zone, spot, info);
        closeSeams(g, ctx, spot, info, zone);
        if (s.east && tx === s.tx1) copyNextColumn(g, ctx, spot);
      } else drawWallTile(g, zone, spot, info);
    } else {
      spot.open = fenceOpen(map, tx, s.ty);
      drawFenceTile(g, spot);
    }
    const props = ctx.wallProps.get(i);
    if (props) {
      for (const p of props) {
        const spec = ZONE_PROP_KINDS[p.kind];
        if (!spec) continue;
        prop.key = spec.key;
        prop.x = spot.x + TILE_W / 2;
        prop.y = spot.y + TILE_H / 2;
        prop.v = p.v;
        prop.lift = lift;
        drawWallProp(g, prop);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------------------------ Phaser

export interface BakeStats {
  ms: number;
  floorChunks: number;
  strips: number;
  pages: number;
  /** RGBA8 bytes of every texture made. */
  textureBytes: number;
  /** Game objects the bake added to the scene. */
  images: number;
}

/** The images of one bake, with their bounds, so a frame can show only those in view. */
export class BakedArt {
  readonly images: Phaser.GameObjects.Image[] = [];
  private bounds: number[] = [];
  private shown: boolean[] = [];
  private readonly textureKeys: string[] = [];
  /** The first floor chunk's texture and a pixel inside it, for the smoke test. */
  probe: { key: string; x: number; y: number } | null = null;

  constructor(private readonly scene: Phaser.Scene, readonly stats: BakeStats) {}

  addImage(image: Phaser.GameObjects.Image, x0: number, y0: number, x1: number, y1: number): void {
    this.images.push(image);
    this.bounds.push(x0, y0, x1, y1);
    this.shown.push(true);
  }

  addTexture(key: string): void {
    this.textureKeys.push(key);
  }

  /** Shows only the images that meet the rectangle (projected pixels). */
  cull(left: number, top: number, right: number, bottom: number): void {
    const b = this.bounds;
    for (let k = 0; k < this.images.length; k++) {
      const o = k * 4;
      const visible = b[o + 2]! >= left && b[o]! <= right && b[o + 3]! >= top && b[o + 1]! <= bottom;
      if (visible !== this.shown[k]) {
        this.shown[k] = visible;
        this.images[k]!.setVisible(visible);
      }
    }
  }

  showAll(): void {
    this.cull(-Infinity, -Infinity, Infinity, Infinity);
  }

  destroy(): void {
    for (const im of this.images) im.destroy();
    this.images.length = 0;
    this.bounds = [];
    this.shown = [];
    for (const key of this.textureKeys) this.scene.textures?.remove?.(key);
    this.textureKeys.length = 0;
  }
}

let bakeSerial = 0;

/**
 * Bakes the map's ground and walls. Throws if the scene cannot make a dynamic texture (no WebGL or canvas renderer to draw into);
 * MapView then draws the old way.
 */
export function bakeZoneArt(scene: Phaser.Scene, map: GameMap, ctx: BakeContext = makeContext(map), budget = TEXTURE_BUDGET_BYTES): BakedArt {
  const t0 = performance.now();
  const floors = planFloor(map, chooseFloorScale(map, budget, ctx));
  const { strips, pages } = planStrips(map, ctx);
  const prefix = `zoneart${bakeSerial++}`;
  const art = new BakedArt(scene, {
    ms: 0, floorChunks: floors.length, strips: strips.length, pages: pages.length, textureBytes: planBytes(floors, pages), images: 0,
  });
  // The scratch Graphics is never in the display list; it is drawn into one texture at a time.
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  try {
    for (const c of floors) {
      const key = `${prefix}f${c.cx}_${c.cy}`;
      const dt = scene.textures.addDynamicTexture(key, c.tw, c.th);
      if (!dt) throw new Error(`zone art: no dynamic texture for ${key}`);
      art.addTexture(key);
      g.clear();
      g.setScale(c.scale);
      paintFloorChunk(g, ctx, c);
      dt.draw(g);
      dt.render();
      const image = scene.add.image(c.x, c.y, key).setOrigin(0, 0).setDepth(DEPTH_FLOOR).setScale(1 / c.scale);
      art.addImage(image, c.x, c.y, c.x + c.w, c.y + c.h);
      if (!art.probe) art.probe = { key, x: 0, y: 0 };
    }
    g.setScale(1);
    // The strips' frames are cut page by page, but the images are added in strip order (row by row, a chunk column after its west
    // neighbour): equal depths draw in the order they were added, and a strip's join copy (`StripPlan.east`) is under the next one.
    const cut: Array<{ key: string; frame: string }> = new Array(strips.length);
    for (let p = 0; p < pages.length; p++) {
      const key = `${prefix}s${p}`;
      const dt = scene.textures.addDynamicTexture(key, pages[p]!.w, pages[p]!.h);
      if (!dt) throw new Error(`zone art: no dynamic texture for ${key}`);
      art.addTexture(key);
      g.clear();
      const onPage: number[] = [];
      strips.forEach((s, k) => { if (s.page === p) onPage.push(k); });
      for (const k of onPage) paintStrip(g, ctx, strips[k]!);
      dt.draw(g);
      dt.render();
      onPage.forEach((k, n) => {
        const s = strips[k]!;
        const frame = `s${n}`;
        dt.add(frame, 0, s.px, s.py, s.w, s.h);
        cut[k] = { key, frame };
      });
    }
    strips.forEach((s, k) => {
      const image = scene.add.image(s.x, s.y, cut[k]!.key, cut[k]!.frame).setOrigin(0, 0).setDepth(s.depth);
      art.addImage(image, s.x, s.y, s.x + s.w, s.y + s.h);
    });
  } catch (e) {
    g.destroy();
    art.destroy();
    throw e;
  }
  g.destroy();
  art.stats.images = art.images.length;
  art.stats.ms = performance.now() - t0;
  return art;
}
