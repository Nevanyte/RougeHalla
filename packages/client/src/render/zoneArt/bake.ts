// Bakes a styled map's ground and walls into textures once (part D 7.1). At 96x96 the old way (about 64 Graphics objects that Phaser
// replays every frame, with richer art on top) is the budget risk; this paints the art once and the scene then draws a few dozen
// images:
//   * floor chunks: 16x16 tiles each, one texture per chunk (the zone floor, terrain tiles, flat props, the ruins' shade);
//   * wall strips: one image per tile row and chunk column holding a wall or a fence (trimmed to the tiles it covers), packed into
//     a few atlas pages so the images share a texture. Each strip sits at the depth of its row's south edge, so fighters y-sort
//     against walls as they did before.
// The plan (which chunks, which strips, where) is pure and tested; only `bakeZoneArt` touches Phaser. Phaser 4 draws into a texture
// through a command buffer: `texture.draw(graphics)` then `texture.render()`.
import Phaser from "phaser";
import {
  REGION_IDS, TERRAIN_CREVASSE, TERRAIN_EMBER, TERRAIN_FENCE, TERRAIN_LAVA, TILE, TILE_LOW, TILE_WALL, Y_SCALE, ZONE_PROP_KINDS,
  type GameMap, type MapProp,
} from "@raid/shared";
import { depthFor } from "../projection";
import { planProps } from "./propsView";
import { NEUTRAL_PALETTE, ZONE_PALETTE, isZoneKey, type ZoneKey } from "./palette";
import {
  EDGE_E, EDGE_N, EDGE_S, EDGE_W, FLAT_PROPS, LOW_HEIGHT, SHARD_HEIGHT, TILE_H, TILE_W, WALL_HEIGHT, WALL_PROPS,
  drawFenceTile, drawFlatProp, drawFloorTile, drawTerrainFloor, drawWallProp, drawWallTile, hashTile, isFlatTerrain, terrainFamily,
  type Pen, type PropSpot, type TileSpot, type WallInfo, type WallStyle,
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

/** Whether a map has zone art to bake: a generated map (it has regions) that carries terrain or props. */
export function hasZoneArt(map: GameMap): boolean {
  if (map.regions.length === 0) return false;
  if (map.props.length > 0) return true;
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
 * a straight run of three or more single stones (D 7.6: the cover pass lays rows of rocks, drawn as one low wall, not as stones); else
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
 * The strips of a map: for each tile row and chunk column, the span from the first to the last tile that is a wall or a fence, if any.
 * They are packed onto pages PAGE_W wide (at most PAGE_MAX_H tall) in shelves of one height, widest first and each into the first shelf
 * with room, which wastes only a few percent of a page; the list stays in row order.
 */
export function planStrips(map: GameMap): { strips: StripPlan[]; pages: Array<{ w: number; h: number }> } {
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
      strips.push({ ty, tx0: a, tx1: b, x: a * TILE_W, y: top, w: even((b - a + 1) * TILE_W), h, oy, depth: depthFor((ty + 1) * TILE), page: 0, px: 0, py: 0 });
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

/** The texture memory the zone art may take at 1x (RGBA8): D 7.1's budget. A bigger map bakes its floors at a lower scale to fit. */
export const TEXTURE_BUDGET_BYTES = 48 * 1024 * 1024;
/** The scales a floor may be baked at, best first. */
export const FLOOR_SCALES: readonly number[] = [1, 0.75, 0.5];

/**
 * The best floor scale whose chunks and the wall pages fit `budget`; the smallest if none does (walls stay at 1x: they carry the
 * silhouettes, and the floors are the quiet part of the picture).
 */
export function chooseFloorScale(map: GameMap, budget = TEXTURE_BUDGET_BYTES): number {
  const { pages } = planStrips(map);
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
}

export function makeContext(map: GameMap): BakeContext {
  const plan = planProps(map);
  return { map, zones: zoneGrid(map), styles: wallStyles(map), wallProps: plan.wall, flatProps: plan.flat };
}

/** A zone to paint a tile with when it has none (the coliseum ring, a neutral wall): the plain grey cell stone. */
const NEUTRAL_WALL_ZONE: ZoneKey = "sentenced";

/** The hash of a tile on this map: the variants are the map's own. */
function tileSeedHash(map: GameMap, tx: number, ty: number): number {
  return hashTile(tx, ty, map.seed);
}

/** Paints one floor chunk: every tile's ground, the ruins' shade, then the flat props. */
export function paintFloorChunk(g: Pen, ctx: BakeContext, c: FloorChunk): void {
  const { map, zones } = ctx;
  const spot: TileSpot = { x: 0, y: 0, tx: 0, ty: 0, hash: 0, open: 0 };
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
    }
  }
  // Ruins read as indoors in every zone.
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

/** The wall info of a tile: its style, lift and which sides show a face. */
export function wallInfoAt(ctx: BakeContext, tx: number, ty: number): WallInfo {
  const { map } = ctx;
  const i = ty * map.w + tx;
  const style = ctx.styles[i];
  const zone = ctx.zones[i];
  const shard = zone === "frost" && (style === WS_ROCK || style === WS_SEGMENT);
  return {
    style: WS_NAMES[style] ?? "mass",
    lift: shard ? SHARD_HEIGHT : WALL_HEIGHT,
    open: wallOpen(map, tx, ty),
    front: ty + 1 >= map.h || map.tiles[(ty + 1) * map.w + tx] !== TILE_WALL,
    pillarKind: style === WS_PILLAR ? map.terrain[i] : 0,
  };
}

/** Paints one strip into its place on a page: `g` is the page's Graphics, the strip sits at (s.px, s.py). */
export function paintStrip(g: Pen, ctx: BakeContext, s: StripPlan): void {
  const { map } = ctx;
  const spot: TileSpot = { x: 0, y: 0, tx: 0, ty: s.ty, hash: 0, open: 0 };
  const prop: PropSpot = { key: "", x: 0, y: 0, v: 0, lift: 0 };
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
      drawWallTile(g, ctx.zones[i] ?? NEUTRAL_WALL_ZONE, spot, info);
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
  const floors = planFloor(map, chooseFloorScale(map, budget));
  const { strips, pages } = planStrips(map);
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
    for (let p = 0; p < pages.length; p++) {
      const key = `${prefix}s${p}`;
      const dt = scene.textures.addDynamicTexture(key, pages[p]!.w, pages[p]!.h);
      if (!dt) throw new Error(`zone art: no dynamic texture for ${key}`);
      art.addTexture(key);
      g.clear();
      const onPage = strips.filter((s) => s.page === p);
      for (const s of onPage) paintStrip(g, ctx, s);
      dt.draw(g);
      dt.render();
      onPage.forEach((s, n) => {
        const frame = `s${n}`;
        dt.add(frame, 0, s.px, s.py, s.w, s.h);
        const image = scene.add.image(s.x, s.y, key, frame).setOrigin(0, 0).setDepth(s.depth);
        art.addImage(image, s.x, s.y, s.x + s.w, s.y + s.h);
      });
    }
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
