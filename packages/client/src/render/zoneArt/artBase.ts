// The leaf the zone art's draw files share (zoneStyle.ts re-exports all of it, so its importers did not change): the Pen interface,
// the tile footprint, the lifts of walls and low blocks, the sides of a tile, and the tile hash. No Phaser, no map, no palette: a
// file that draws a tile (zoneStyle.ts, featureStyle.ts) imports this and never the other, so the two never form a cycle.
import { TILE, Y_SCALE } from "@raid/shared";

/** One tile's ground footprint in projected pixels. */
export const TILE_W = TILE;
export const TILE_H = TILE * Y_SCALE;
/** Pixels a wall's top face is lifted above its footprint (MapView re-exports it). Under one projected tile so a wall never hides the tile north of it. */
export const WALL_HEIGHT = 14;
/** A LOW block (a fence) is knee-high: half a wall. */
export const LOW_HEIGHT = 7;
/** Rime rocks are shards at 70% of a wall (D 7.3); so are a headland's and a spire's facets. */
export const SHARD_HEIGHT = Math.round(WALL_HEIGHT * 0.7);

/** The Graphics methods the art uses, so a stub can stand in for Phaser's Graphics. */
export interface Pen {
  fillStyle(color: number, alpha?: number): this;
  lineStyle(width: number, color: number, alpha?: number): this;
  fillRect(x: number, y: number, w: number, h: number): this;
  strokeRect(x: number, y: number, w: number, h: number): this;
  fillRoundedRect(x: number, y: number, w: number, h: number, radius: number | { tl: number; tr: number; bl: number; br: number }): this;
  lineBetween(x1: number, y1: number, x2: number, y2: number): this;
  fillCircle(x: number, y: number, r: number): this;
  strokeCircle(x: number, y: number, r: number): this;
  fillEllipse(x: number, y: number, w: number, h: number): this;
  strokeEllipse(x: number, y: number, w: number, h: number): this;
  fillTriangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): this;
  beginPath(): this;
  moveTo(x: number, y: number): this;
  lineTo(x: number, y: number): this;
  closePath(): this;
  fillPath(): this;
  strokePath(): this;
}

/** Sides of a tile, as a bit set: the side faces north (up the screen), east, south, west. */
export const EDGE_N = 1;
export const EDGE_E = 2;
export const EDGE_S = 4;
export const EDGE_W = 8;

/** Where one tile is painted. */
export interface TileSpot {
  /** Top-left of the tile's ground footprint in the target space (the texture being painted). */
  x: number;
  y: number;
  /** Tile coordinates: features that must run on across neighbouring tiles read their phase from these. */
  tx: number;
  ty: number;
  /** A 32-bit hash of the tile: which variant, how the marks fall. */
  hash: number;
  /** The sides whose neighbour is not the same kind of tile (an open edge gets the rim, the outline, the post). */
  open: number;
}

/** A 32-bit integer mix of a tile and a salt; deterministic, integer maths only. */
export function hashTile(tx: number, ty: number, salt = 0): number {
  let h = Math.imul(tx + 0x9e37, 0x85ebca6b) ^ Math.imul(ty + 0x7f4a, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** `n` bits of `h` from bit `shift`, as 0..2^n-1. */
export function bits(h: number, shift: number, n: number): number {
  return (h >>> shift) & ((1 << n) - 1);
}

/** A 0..1 value from 8 bits of `h`. */
export function unit(h: number, shift: number): number {
  return bits(h, shift, 8) / 255;
}

// ------------------------------------------------------------------------------------------------------------------ looks

/**
 * How a wall tile that belongs to a named feature (map.features, contract 7.5) is dressed on top of the zone's own wall: a crater's
 * rim with its lip lit toward the camp, a barrow's mossy mound, a hall's pier with its capital, a landmark's masonry (one per
 * design), a headland's or spire's facet at a shard's height, the gallows' timber. "plain" is every other wall: the border, the
 * coliseum, a net's infill, and any map with no features (it draws exactly as it did before the features).
 */
export type WallLook = "plain" | "rim" | "mound" | "pier" | "forge" | "guardHouse" | "burrow" | "watchtower" | "shrine" | "shard" | "gallows";

/** The landmark designs (MapFeature.variant of a "landmark"), each with a masonry look of its own. */
export type MasonryLook = "forge" | "guardHouse" | "burrow" | "watchtower" | "shrine";

/**
 * How a floor tile that a feature owns is dressed under the zone's floor: a crater's ash bowl, a barrow's tunnel, the hall's paving,
 * the mere's shore and the causeway's packed snow, a landmark's interior floor (per design), its doorway sill, and a ford's slabs.
 */
export type FloorLook = "plain" | "bowl" | "tunnel" | "hall" | "shore" | "causeway" | "forge" | "guardHouse" | "burrow" | "watchtower" | "shrine" | "door" | "ford";
